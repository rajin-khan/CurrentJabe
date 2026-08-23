-- Community-created localities below an existing thana/upazila.
--
-- This migration is additive: a locality remains an ordinary row in
-- public.upazilas, so every existing report foreign key, location key, live
-- aggregate, and forecast function continues to work without rewriting data.

create or replace function public.normalize_locality_name(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            translate(normalize(btrim(p_value), NFKD), '০১২৩৪৫৬৭৮৯', '0123456789'),
            'defen[cs]e officers housing societ(y|ies)',
            'dohs',
            'gi'
          ),
          'residential areas?',
          'ra',
          'gi'
        ),
        '\m(road|rd)\M|রোড',
        '',
        'gi'
      ),
      '[^[:alnum:]ঀ-৿]+',
      '',
      'g'
    )
  );
$$;

create or replace function public.normalize_locality_name_for_parent(
  p_value text,
  p_parent_name_en text,
  p_parent_name_bn text
) returns text
language sql
immutable
strict
set search_path = ''
as $$
  with names as (
    select
      public.normalize_locality_name(p_value) as value,
      public.normalize_locality_name(p_parent_name_en) as parent_en,
      public.normalize_locality_name(p_parent_name_bn) as parent_bn
  )
  select case
    when value like parent_en || '%'
      and char_length(value) - char_length(parent_en) >= 2
      then substr(value, char_length(parent_en) + 1)
    when value like parent_bn || '%'
      and char_length(value) - char_length(parent_bn) >= 2
      then substr(value, char_length(parent_bn) + 1)
    else value
  end
  from names;
$$;

alter table public.upazilas
  add column if not exists origin text not null default 'catalog',
  add column if not exists normalized_name text,
  add column if not exists input_locale text;

update public.upazilas as child
set normalized_name = public.normalize_locality_name_for_parent(
  child.name_en,
  parent.name_en,
  parent.name_bn
)
from public.upazilas as parent
where child.location_kind = 'locality'
  and child.parent_location_id = parent.id
  and child.normalized_name is distinct from public.normalize_locality_name_for_parent(
    child.name_en,
    parent.name_en,
    parent.name_bn
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.upazilas'::regclass
      and conname = 'upazilas_origin_check'
  ) then
    alter table public.upazilas
      add constraint upazilas_origin_check
      check (origin in ('catalog', 'community', 'admin'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.upazilas'::regclass
      and conname = 'upazilas_input_locale_check'
  ) then
    alter table public.upazilas
      add constraint upazilas_input_locale_check
      check (input_locale is null or input_locale in ('en', 'bn', 'und'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.upazilas'::regclass
      and conname = 'upazilas_locality_normalized_name_check'
  ) then
    alter table public.upazilas
      add constraint upazilas_locality_normalized_name_check
      check (
        location_kind <> 'locality'
        or (
          normalized_name is not null
          and char_length(normalized_name) between 2 and 120
          and normalized_name = btrim(normalized_name)
        )
      );
  end if;
end
$$;

create unique index if not exists upazilas_parent_normalized_locality_unique
  on public.upazilas(parent_location_id, normalized_name)
  where location_kind = 'locality';

create index if not exists upazilas_community_locality_parent_name_idx
  on public.upazilas(parent_location_id, name_en)
  where location_kind = 'locality' and not disabled;

create or replace function public.maintain_locality_metadata()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent_name_en text;
  v_parent_name_bn text;
begin
  if new.location_kind <> 'locality' then
    new.normalized_name := null;
    return new;
  end if;

  select name_en, name_bn
  into v_parent_name_en, v_parent_name_bn
  from public.upazilas
  where id = new.parent_location_id;

  if not found then
    raise exception using message = 'invalid_locality_parent';
  end if;

  new.normalized_name := public.normalize_locality_name_for_parent(
    new.name_en,
    v_parent_name_en,
    v_parent_name_bn
  );

  if char_length(new.normalized_name) not between 2 and 120 then
    raise exception using message = 'invalid_locality_normalized_name';
  end if;

  return new;
end;
$$;

drop trigger if exists maintain_locality_metadata_trigger on public.upazilas;
create trigger maintain_locality_metadata_trigger
before insert or update of location_kind, parent_location_id, name_en, normalized_name
on public.upazilas
for each row
execute function public.maintain_locality_metadata();

create table if not exists public.locality_contributions (
  locality_id text not null
    references public.upazilas(id) on update cascade on delete cascade,
  visitor_hash text not null check (char_length(visitor_hash) between 40 and 128),
  created_at timestamptz not null default now(),
  primary key (locality_id, visitor_hash)
);

create index if not exists locality_contributions_created_idx
  on public.locality_contributions(created_at desc);

create index if not exists locality_contributions_visitor_idx
  on public.locality_contributions(visitor_hash);

alter table public.locality_contributions enable row level security;
revoke all on table public.locality_contributions from public, anon, authenticated;
grant all on table public.locality_contributions to service_role;

-- Extend the existing rate-limit action without deleting or rewriting any
-- operational events. The broader constraint is validated before the old one
-- is removed, so the table is constrained throughout the migration.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.rate_limit_events'::regclass
      and conname = 'rate_limit_events_action_check_v2'
  ) then
    alter table public.rate_limit_events
      add constraint rate_limit_events_action_check_v2
      check (
        action in (
          'live_status',
          'daily_report',
          'analytics',
          'admin_login',
          'delete_data',
          'create_locality'
        )
      ) not valid;
  end if;
end
$$;

alter table public.rate_limit_events
  validate constraint rate_limit_events_action_check_v2;

alter table public.rate_limit_events
  drop constraint if exists rate_limit_events_action_check;

alter table public.rate_limit_events
  rename constraint rate_limit_events_action_check_v2
  to rate_limit_events_action_check;

create or replace function public.enforce_rate_limit(
  p_visitor_hash text,
  p_ip_hash text,
  p_action text,
  p_visitor_limit integer,
  p_ip_limit integer,
  p_window interval
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_visitor_count integer;
  v_ip_count integer;
begin
  if p_action not in (
    'live_status',
    'daily_report',
    'analytics',
    'admin_login',
    'delete_data',
    'create_locality'
  ) then
    raise exception using message = 'invalid_rate_limit_action';
  end if;
  if char_length(p_visitor_hash) < 40 or char_length(p_ip_hash) < 40 then
    raise exception using message = 'invalid_identity_hash';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('visitor:' || p_visitor_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_action || ':ip:' || p_ip_hash, 0));

  select count(*) into v_visitor_count
  from public.rate_limit_events
  where visitor_hash = p_visitor_hash
    and action = p_action
    and created_at >= v_now - p_window;

  select count(*) into v_ip_count
  from public.rate_limit_events
  where ip_hash = p_ip_hash
    and action = p_action
    and created_at >= v_now - p_window;

  if v_visitor_count >= p_visitor_limit or v_ip_count >= p_ip_limit then
    raise exception using message = 'rate_limit_exceeded';
  end if;

  insert into public.rate_limit_events(visitor_hash, ip_hash, action, created_at)
  values (p_visitor_hash, p_ip_hash, p_action, v_now);

  if random() < 0.01
    and pg_try_advisory_xact_lock(hashtextextended('currentjabe:operational-prune', 0))
  then
    perform public.close_stale_live_outages(null);
    delete from public.rate_limit_events where created_at < v_now - interval '7 days';
    delete from public.admin_login_attempts where attempted_at < v_now - interval '30 days';
    delete from public.live_area_states where expires_at < v_now - interval '1 day';
    delete from public.forecast_runs
    where generated_at < v_now - interval '180 days'
      and evaluated_at is not null;
  end if;
end;
$$;

create or replace function public.api_create_community_locality(
  p_parent_location_id text,
  p_display_name text,
  p_normalized_name text,
  p_slug_part text,
  p_input_locale text,
  p_visitor_hash text,
  p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.upazilas%rowtype;
  v_locality public.upazilas%rowtype;
  v_display_name text;
  v_normalized_name text := lower(btrim(p_normalized_name));
  v_hash text;
  v_id text;
  v_slug text;
  v_map_coverage text;
  v_map_feature_refs text[];
  v_parent_community_count integer;
  v_created boolean := false;
begin
  if p_display_name is null
    or p_normalized_name is null
    or p_slug_part is null
    or p_input_locale is null
  then
    raise exception using message = 'invalid_locality';
  end if;

  v_display_name := regexp_replace(
    normalize(btrim(p_display_name), NFKC),
    '[[:space:]]+',
    ' ',
    'g'
  );

  if char_length(v_display_name) not between 2 and 72
    or v_display_name ~ '[[:cntrl:]]'
    or v_display_name ~* '(https?://|www\.|@)'
    or char_length(v_normalized_name) not between 2 and 120
    or v_normalized_name ~ '[[:space:][:punct:]]'
    or p_slug_part !~ '^[a-z0-9][a-z0-9-]{0,55}$'
    or p_input_locale not in ('en', 'bn', 'und')
  then
    raise exception using message = 'invalid_locality';
  end if;

  if char_length(p_visitor_hash) not between 40 and 128
    or char_length(p_ip_hash) not between 40 and 128
  then
    raise exception using message = 'invalid_identity_hash';
  end if;

  perform public.assert_reporting_open(p_parent_location_id, null, null);

  select *
  into v_parent
  from public.upazilas
  where id = p_parent_location_id
    and location_kind in ('upazila', 'thana')
    and not disabled
  for update;

  if not found then
    raise exception using message = 'invalid_locality_parent';
  end if;

  if v_normalized_name is distinct from public.normalize_locality_name_for_parent(
    v_display_name,
    v_parent.name_en,
    v_parent.name_bn
  ) then
    raise exception using message = 'invalid_locality_normalized_name';
  end if;

  if v_normalized_name = public.normalize_locality_name(v_parent.name_en)
    or v_normalized_name = public.normalize_locality_name(v_parent.name_bn)
  then
    raise exception using message = 'invalid_locality_same_as_parent';
  end if;

  perform public.enforce_rate_limit(
    p_visitor_hash,
    p_ip_hash,
    'create_locality',
    5,
    100,
    interval '24 hours'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      'community-locality:' || p_parent_location_id || ':' || v_normalized_name,
      0
    )
  );

  select *
  into v_locality
  from public.upazilas
  where parent_location_id = p_parent_location_id
    and location_kind = 'locality'
    and normalized_name = v_normalized_name
  for update;

  if found then
    if v_locality.disabled then
      raise exception using message = 'area_disabled';
    end if;
  else
    select count(*)
    into v_parent_community_count
    from public.upazilas
    where parent_location_id = p_parent_location_id
      and location_kind = 'locality'
      and origin = 'community'
      and not disabled;
    if v_parent_community_count >= 250 then
      raise exception using message = 'locality_parent_capacity_reached';
    end if;

    if cardinality(v_parent.map_feature_refs) > 0 then
      v_map_coverage := 'approximate';
      v_map_feature_refs := v_parent.map_feature_refs;
    else
      v_map_coverage := 'district_fallback';
      v_map_feature_refs := '{}'::text[];
    end if;

    v_hash := encode(
      extensions.digest(
        p_parent_location_id || chr(31) || v_normalized_name,
        'sha256'
      ),
      'hex'
    );
    v_id := 'community:' || substr(v_hash, 1, 32);
    v_slug := left(v_parent.slug || '-' || p_slug_part, 90)
      || '-'
      || substr(v_hash, 1, 8);

    begin
      insert into public.upazilas(
        id,
        district_id,
        parent_location_id,
        slug,
        name_en,
        name_bn,
        location_kind,
        boundary_ref,
        map_coverage,
        map_feature_refs,
        disabled,
        origin,
        normalized_name,
        input_locale
      ) values (
        v_id,
        v_parent.district_id,
        v_parent.id,
        v_slug,
        v_display_name,
        v_display_name,
        'locality',
        null,
        v_map_coverage,
        v_map_feature_refs,
        false,
        'community',
        v_normalized_name,
        p_input_locale
      )
      returning * into v_locality;
      v_created := true;
    exception when unique_violation then
      select *
      into v_locality
      from public.upazilas
      where parent_location_id = p_parent_location_id
        and location_kind = 'locality'
        and normalized_name = v_normalized_name
      for update;

      if not found then
        raise;
      end if;
      if v_locality.disabled then
        raise exception using message = 'area_disabled';
      end if;
    end;
  end if;

  insert into public.locality_contributions(locality_id, visitor_hash)
  values (v_locality.id, p_visitor_hash)
  on conflict (locality_id, visitor_hash) do nothing;

  return jsonb_build_object(
    'created', v_created,
    'locality', jsonb_build_object(
      'id', v_locality.id,
      'district_id', v_locality.district_id,
      'parent_location_id', v_locality.parent_location_id,
      'slug', v_locality.slug,
      'name_en', v_locality.name_en,
      'name_bn', v_locality.name_bn,
      'location_kind', v_locality.location_kind,
      'boundary_ref', v_locality.boundary_ref,
      'map_coverage', v_locality.map_coverage,
      'map_feature_refs', to_jsonb(v_locality.map_feature_refs),
      'disabled', v_locality.disabled,
      'origin', v_locality.origin,
      'normalized_name', v_locality.normalized_name
    )
  );
end;
$$;

-- Keep a small, defensible starter set available before any community-created
-- names arrive. These are community reporting scopes with approximate parent
-- highlights, not administrative or electricity-feeder boundaries.
insert into public.districts(id, slug, name_en, name_bn)
values ('dhaka', 'dhaka', 'Dhaka', 'ঢাকা')
on conflict (id) do nothing;

insert into public.upazilas(
  id,
  district_id,
  slug,
  name_en,
  name_bn,
  location_kind,
  boundary_ref,
  map_coverage,
  map_feature_refs,
  origin
) values
  (
    'dhaka-dhanmondi', 'dhaka', 'dhaka-dhanmondi', 'Dhanmondi', 'ধানমন্ডি',
    'thana', 'dhaka-dhanmondi', 'exact', array['dhaka-dhanmondi'], 'catalog'
  ),
  (
    'dhaka-mirpur', 'dhaka', 'dhaka-mirpur', 'Mirpur', 'মিরপুর',
    'thana', 'dhaka-mirpur', 'exact', array['dhaka-mirpur'], 'catalog'
  ),
  (
    'dhaka-pallabi', 'dhaka', 'dhaka-pallabi', 'Pallabi', 'পল্লবী',
    'thana', 'dhaka-pallabi', 'exact', array['dhaka-pallabi'], 'catalog'
  )
on conflict (id) do nothing;

insert into public.upazilas(
  id,
  district_id,
  parent_location_id,
  slug,
  name_en,
  name_bn,
  location_kind,
  boundary_ref,
  map_coverage,
  map_feature_refs,
  disabled,
  origin,
  normalized_name,
  input_locale
) values
  (
    'dhaka-mirpur-dohs', 'dhaka', 'dhaka-pallabi', 'dhaka-mirpur-dohs',
    'Mirpur DOHS', 'মিরপুর ডিওএইচএস', 'locality', null, 'approximate',
    array['dhaka-pallabi', 'dhaka-turag'], false, 'catalog', 'mirpurdohs', 'en'
  ),
  (
    'dhaka-mirpur-section-1', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-1',
    'Mirpur Section 1', 'মিরপুর সেকশন ১', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection1', 'en'
  ),
  (
    'dhaka-mirpur-section-2', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-2',
    'Mirpur Section 2', 'মিরপুর সেকশন ২', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection2', 'en'
  ),
  (
    'dhaka-mirpur-section-6', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-6',
    'Mirpur Section 6', 'মিরপুর সেকশন ৬', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection6', 'en'
  ),
  (
    'dhaka-mirpur-section-7', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-7',
    'Mirpur Section 7', 'মিরপুর সেকশন ৭', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection7', 'en'
  ),
  (
    'dhaka-mirpur-section-9', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-9',
    'Mirpur Section 9', 'মিরপুর সেকশন ৯', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection9', 'en'
  ),
  (
    'dhaka-mirpur-section-10', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-10',
    'Mirpur Section 10', 'মিরপুর সেকশন ১০', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection10', 'en'
  ),
  (
    'dhaka-mirpur-section-11', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-11',
    'Mirpur Section 11', 'মিরপুর সেকশন ১১', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection11', 'en'
  ),
  (
    'dhaka-mirpur-section-12', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-12',
    'Mirpur Section 12', 'মিরপুর সেকশন ১২', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection12', 'en'
  ),
  (
    'dhaka-mirpur-section-13', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-13',
    'Mirpur Section 13', 'মিরপুর সেকশন ১৩', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection13', 'en'
  ),
  (
    'dhaka-mirpur-section-13-a', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-13-a',
    'Mirpur Section 13/A', 'মিরপুর সেকশন ১৩/এ', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection13a', 'en'
  ),
  (
    'dhaka-mirpur-section-13-b', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-13-b',
    'Mirpur Section 13/B', 'মিরপুর সেকশন ১৩/বি', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection13b', 'en'
  ),
  (
    'dhaka-mirpur-section-13-c', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-13-c',
    'Mirpur Section 13/C', 'মিরপুর সেকশন ১৩/সি', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection13c', 'en'
  ),
  (
    'dhaka-mirpur-section-14', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-14',
    'Mirpur Section 14', 'মিরপুর সেকশন ১৪', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection14', 'en'
  ),
  (
    'dhaka-mirpur-section-15', 'dhaka', 'dhaka-mirpur', 'dhaka-mirpur-section-15',
    'Mirpur Section 15', 'মিরপুর সেকশন ১৫', 'locality', null, 'approximate',
    array['dhaka-mirpur'], false, 'catalog', 'mirpursection15', 'en'
  ),
  (
    'dhaka-dhanmondi-road-2-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-2-a', 'Dhanmondi Road 2/A', 'ধানমন্ডি রোড ২/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi2a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-3-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-3-a', 'Dhanmondi Road 3/A', 'ধানমন্ডি রোড ৩/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi3a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-4-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-4-a', 'Dhanmondi Road 4/A', 'ধানমন্ডি রোড ৪/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi4a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-5-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-5-a', 'Dhanmondi Road 5/A', 'ধানমন্ডি রোড ৫/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi5a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-6-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-6-a', 'Dhanmondi Road 6/A', 'ধানমন্ডি রোড ৬/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi6a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-7-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-7-a', 'Dhanmondi Road 7/A', 'ধানমন্ডি রোড ৭/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi7a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-8-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-8-a', 'Dhanmondi Road 8/A', 'ধানমন্ডি রোড ৮/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi8a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-9-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-9-a', 'Dhanmondi Road 9/A', 'ধানমন্ডি রোড ৯/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi9a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-10-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-10-a', 'Dhanmondi Road 10/A', 'ধানমন্ডি রোড ১০/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi10a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-11-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-11-a', 'Dhanmondi Road 11/A', 'ধানমন্ডি রোড ১১/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi11a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-12-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-12-a', 'Dhanmondi Road 12/A', 'ধানমন্ডি রোড ১২/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi12a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-13-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-13-a', 'Dhanmondi Road 13/A', 'ধানমন্ডি রোড ১৩/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi13a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-14-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-14-a', 'Dhanmondi Road 14/A', 'ধানমন্ডি রোড ১৪/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi14a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-15-a', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-15-a', 'Dhanmondi Road 15/A', 'ধানমন্ডি রোড ১৫/এ',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi15a', 'en'
  ),
  (
    'dhaka-dhanmondi-road-3', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-3', 'Dhanmondi Road 3', 'ধানমন্ডি রোড ৩',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi3', 'en'
  ),
  (
    'dhaka-dhanmondi-road-4', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-4', 'Dhanmondi Road 4', 'ধানমন্ডি রোড ৪',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi4', 'en'
  ),
  (
    'dhaka-dhanmondi-road-5', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-5', 'Dhanmondi Road 5', 'ধানমন্ডি রোড ৫',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi5', 'en'
  ),
  (
    'dhaka-dhanmondi-road-6', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-6', 'Dhanmondi Road 6', 'ধানমন্ডি রোড ৬',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi6', 'en'
  ),
  (
    'dhaka-dhanmondi-road-7', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-7', 'Dhanmondi Road 7', 'ধানমন্ডি রোড ৭',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi7', 'en'
  ),
  (
    'dhaka-dhanmondi-road-27', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-27', 'Dhanmondi Road 27', 'ধানমন্ডি রোড ২৭',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi27', 'en'
  ),
  (
    'dhaka-dhanmondi-road-32', 'dhaka', 'dhaka-dhanmondi',
    'dhaka-dhanmondi-road-32', 'Dhanmondi Road 32', 'ধানমন্ডি রোড ৩২',
    'locality', null, 'approximate', array['dhaka-dhanmondi'], false, 'catalog',
    'dhanmondi32', 'en'
  )
on conflict do nothing;

-- A disabled broad parent also closes all of its specific reporting areas.
create or replace function public.assert_reporting_open(
  p_upazila_id text,
  p_provider_id text default null,
  p_feeder_id text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.app_settings%rowtype;
  v_area public.upazilas%rowtype;
  v_parent_disabled boolean := false;
begin
  perform public.assert_location_scope(p_upazila_id, p_provider_id, p_feeder_id);

  select * into v_settings from public.app_settings where singleton = true;
  if v_settings.site_kill_switch or not v_settings.submissions_enabled then
    raise exception using message = 'submissions_disabled';
  end if;

  select * into v_area from public.upazilas where id = p_upazila_id;
  if v_area.parent_location_id is not null then
    select coalesce(disabled, false)
    into v_parent_disabled
    from public.upazilas
    where id = v_area.parent_location_id;
  end if;
  if v_area.disabled or v_parent_disabled then
    raise exception using message = 'area_disabled';
  end if;
end;
$$;

-- Keep community-created-name attribution inside the existing atomic privacy
-- deletion transaction while preserving the established v1 RPC.
create or replace function public.api_delete_visitor_data_v2(
  p_visitor_hash text,
  p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_locality_contributions integer;
begin
  v_result := public.api_delete_visitor_data(p_visitor_hash, p_ip_hash);
  delete from public.locality_contributions
  where visitor_hash = p_visitor_hash;
  get diagnostics v_locality_contributions = row_count;
  return v_result || jsonb_build_object(
    'localityContributions',
    v_locality_contributions
  );
end;
$$;

-- Project live locality states onto their explicitly approximate map features.
-- If multiple reporting scopes share a feature, an active outage takes visual
-- precedence; the detailed cards remain scoped to the selected location.
create or replace function public.get_map_status()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  with settings as (
    select site_kill_switch, public_message
    from public.app_settings
    where singleton = true
  ), projected as (
    select distinct on (feature.slug)
      feature.slug,
      s.state,
      s.contributor_count,
      s.observed_at,
      s.expires_at
    from public.live_area_states s
    join public.upazilas u on u.id = s.upazila_id
    left join public.upazilas parent on parent.id = u.parent_location_id
    cross join lateral unnest(u.map_feature_refs) as feature(slug)
    where s.precision = 'upazila'
      and s.expires_at > clock_timestamp()
      and not u.disabled
      and not coalesce(parent.disabled, false)
    order by
      feature.slug,
      (s.state = 'out') desc,
      s.observed_at desc,
      s.contributor_count desc
  ), active_areas as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'upazilaId', projected.slug,
          'slug', projected.slug,
          'state', case when projected.state = 'out' then 'appears_out' else 'appears_on' end,
          'contributorCount', projected.contributor_count,
          'observedAt', projected.observed_at,
          'expiresAt', projected.expires_at
        )
        order by projected.observed_at desc
      ),
      '[]'::jsonb
    ) as value
    from projected
  )
  select jsonb_build_object(
    'generatedAt', clock_timestamp(),
    'halted', settings.site_kill_switch,
    'message', settings.public_message,
    'areas', case when settings.site_kill_switch then '[]'::jsonb else active_areas.value end
  )
  from settings cross join active_areas;
$$;

revoke execute on function public.normalize_locality_name(text)
  from public, anon, authenticated;
grant execute on function public.normalize_locality_name(text)
  to service_role;

revoke execute on function public.normalize_locality_name_for_parent(text, text, text)
  from public, anon, authenticated;
grant execute on function public.normalize_locality_name_for_parent(text, text, text)
  to service_role;

revoke execute on function public.maintain_locality_metadata()
  from public, anon, authenticated;
grant execute on function public.maintain_locality_metadata()
  to service_role;

revoke execute on function public.enforce_rate_limit(text, text, text, integer, integer, interval)
  from public, anon, authenticated;
grant execute on function public.enforce_rate_limit(text, text, text, integer, integer, interval)
  to service_role;

revoke execute on function public.api_create_community_locality(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.api_create_community_locality(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

revoke execute on function public.assert_reporting_open(text, text, text)
  from public, anon, authenticated;
grant execute on function public.assert_reporting_open(text, text, text)
  to service_role;

revoke execute on function public.api_delete_visitor_data_v2(text, text)
  from public, anon, authenticated;
grant execute on function public.api_delete_visitor_data_v2(text, text)
  to service_role;

revoke execute on function public.get_map_status()
  from public, anon, authenticated;
grant execute on function public.get_map_status()
  to service_role;
