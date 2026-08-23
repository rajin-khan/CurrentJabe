-- CurrentJabe isolated schema.
-- Apply only to a brand-new Supabase project dedicated to CurrentJabe.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.make_location_key(
  p_upazila_id text,
  p_provider_id text default null,
  p_feeder_id text default null
) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_feeder_id is not null then 'feeder:' || p_feeder_id
    when p_provider_id is not null then 'provider:' || p_provider_id || ':upazila:' || p_upazila_id
    else 'upazila:' || p_upazila_id
  end;
$$;

create table public.districts (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$'),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  name_en text not null check (char_length(name_en) between 1 and 120),
  name_bn text not null check (char_length(name_bn) between 1 and 120),
  division_name_en text,
  division_name_bn text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.upazilas (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$'),
  district_id text not null references public.districts(id) on update cascade on delete restrict,
  parent_location_id text constraint upazilas_parent_location_fk
    references public.upazilas(id) on update cascade on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  name_en text not null check (char_length(name_en) between 1 and 120),
  name_bn text not null check (char_length(name_bn) between 1 and 120),
  location_kind text not null default 'upazila'
    constraint upazilas_location_kind_check
    check (location_kind in ('upazila', 'thana', 'locality')),
  boundary_ref text,
  map_coverage text not null default 'exact'
    constraint upazilas_map_coverage_check
    check (map_coverage in ('exact', 'approximate', 'district_fallback')),
  map_feature_refs text[] not null default '{}',
  disabled boolean not null default false,
  disable_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not disabled or nullif(btrim(disable_reason), '') is not null),
  constraint upazilas_parent_not_self_check
    check (parent_location_id is null or parent_location_id <> id),
  constraint upazilas_locality_parent_check
    check (location_kind <> 'locality' or parent_location_id is not null),
  constraint upazilas_map_geometry_check check (
    (map_coverage = 'exact' and boundary_ref is not null and cardinality(map_feature_refs) = 1)
    or (map_coverage = 'approximate' and boundary_ref is null and cardinality(map_feature_refs) > 0)
    or (map_coverage = 'district_fallback' and boundary_ref is null and cardinality(map_feature_refs) = 0)
  )
);

create index upazilas_district_idx on public.upazilas(district_id, name_en);
create index upazilas_parent_idx on public.upazilas(parent_location_id) where parent_location_id is not null;

create table public.providers (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$'),
  short_name text not null unique check (char_length(short_name) between 2 and 24),
  name_en text not null check (char_length(name_en) between 2 and 180),
  name_bn text not null check (char_length(name_bn) between 1 and 180),
  official_url text not null check (official_url ~ '^https://'),
  source_url text not null check (source_url ~ '^https://'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.area_provider_mappings (
  id uuid primary key default gen_random_uuid(),
  upazila_id text not null references public.upazilas(id) on update cascade on delete cascade,
  provider_id text not null references public.providers(id) on update cascade on delete restrict,
  source_url text not null check (source_url ~ '^https://'),
  source_label text not null check (char_length(source_label) between 2 and 180),
  source_verified_at date,
  confidence text not null default 'unverified' check (confidence in ('confirmed', 'probable', 'unverified')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (upazila_id, provider_id)
);

create table public.feeders (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$'),
  upazila_id text not null references public.upazilas(id) on update cascade on delete cascade,
  provider_id text not null references public.providers(id) on update cascade on delete restrict,
  name_en text not null check (char_length(name_en) between 1 and 160),
  name_bn text,
  official_reference text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (upazila_id, provider_id, name_en)
);

create index feeders_area_idx on public.feeders(upazila_id, provider_id) where active;

create table public.daily_submissions (
  id uuid primary key default gen_random_uuid(),
  visitor_hash text not null check (char_length(visitor_hash) between 40 and 128),
  upazila_id text not null references public.upazilas(id) on update cascade on delete restrict,
  provider_id text references public.providers(id) on update cascade on delete restrict,
  feeder_id text references public.feeders(id) on update cascade on delete restrict,
  location_key text not null,
  occurred_on date not null,
  count_known boolean not null,
  outage_count smallint check (outage_count between 0 and 24),
  remembered_window_count smallint not null default 0 check (remembered_window_count between 0 and 24),
  created_at timestamptz not null default now(),
  suppressed_at timestamptz,
  suppression_reason text,
  suppressed_by text,
  check (feeder_id is null or provider_id is not null),
  check (location_key = public.make_location_key(upazila_id, provider_id, feeder_id)),
  check ((count_known and outage_count is not null) or (not count_known and outage_count is null)),
  check (outage_count is null or remembered_window_count <= outage_count),
  unique (visitor_hash, location_key, occurred_on)
);

create index daily_submissions_area_date_idx
  on public.daily_submissions(location_key, occurred_on desc)
  where suppressed_at is null;

create table public.outage_events (
  id uuid primary key default gen_random_uuid(),
  daily_submission_id uuid references public.daily_submissions(id) on delete cascade,
  visitor_hash text not null check (char_length(visitor_hash) between 40 and 128),
  network_hash text not null check (char_length(network_hash) between 40 and 128),
  upazila_id text not null references public.upazilas(id) on update cascade on delete restrict,
  provider_id text references public.providers(id) on update cascade on delete restrict,
  feeder_id text references public.feeders(id) on update cascade on delete restrict,
  location_key text not null,
  source text not null check (source in ('live', 'daily')),
  started_at timestamptz not null,
  ended_at timestamptz,
  time_precision text not null check (time_precision in ('exact', 'approximate')),
  close_reason text check (close_reason is null or close_reason in ('contributor', 'retrospective', 'automatic')),
  created_at timestamptz not null default now(),
  suppressed_at timestamptz,
  suppression_reason text,
  suppressed_by text,
  check (feeder_id is null or provider_id is not null),
  check (location_key = public.make_location_key(upazila_id, provider_id, feeder_id)),
  check (ended_at is null or (ended_at > started_at and ended_at <= started_at + interval '24 hours')),
  check ((source = 'live') or (daily_submission_id is not null and ended_at is not null))
);

create index outage_events_area_time_idx
  on public.outage_events(location_key, started_at desc)
  where suppressed_at is null;
create index outage_events_upazila_time_idx
  on public.outage_events(upazila_id, started_at desc)
  where suppressed_at is null;
create index outage_events_visitor_date_idx
  on public.outage_events(visitor_hash, upazila_id, started_at desc);
create unique index one_open_live_outage_per_leaf
  on public.outage_events(visitor_hash, location_key)
  where source = 'live' and ended_at is null and suppressed_at is null;

create table public.status_confirmations (
  id uuid primary key default gen_random_uuid(),
  visitor_hash text not null check (char_length(visitor_hash) between 40 and 128),
  network_hash text not null check (char_length(network_hash) between 40 and 128),
  upazila_id text not null references public.upazilas(id) on update cascade on delete restrict,
  provider_id text references public.providers(id) on update cascade on delete restrict,
  feeder_id text references public.feeders(id) on update cascade on delete restrict,
  location_key text not null,
  state text not null check (state in ('on', 'out')),
  observed_at timestamptz not null default now(),
  linked_event_id uuid references public.outage_events(id) on delete set null,
  created_at timestamptz not null default now(),
  suppressed_at timestamptz,
  suppression_reason text,
  suppressed_by text,
  check (feeder_id is null or provider_id is not null),
  check (location_key = public.make_location_key(upazila_id, provider_id, feeder_id))
);

create index status_confirmations_upazila_recent_idx
  on public.status_confirmations(upazila_id, observed_at desc)
  where suppressed_at is null;
create index status_confirmations_provider_recent_idx
  on public.status_confirmations(upazila_id, provider_id, observed_at desc)
  where suppressed_at is null and provider_id is not null;
create index status_confirmations_feeder_recent_idx
  on public.status_confirmations(feeder_id, observed_at desc)
  where suppressed_at is null and feeder_id is not null;
create index status_confirmations_visitor_recent_idx
  on public.status_confirmations(visitor_hash, observed_at desc);
create index status_confirmations_network_recent_idx
  on public.status_confirmations(network_hash, observed_at desc)
  where suppressed_at is null;

create table public.visitor_reputation (
  visitor_hash text primary key check (char_length(visitor_hash) between 40 and 128),
  score numeric(5,4) not null default 0.7500 check (score between 0.2500 and 1.2500),
  corroborated_count integer not null default 0 check (corroborated_count >= 0),
  contradicted_count integer not null default 0 check (contradicted_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.live_area_states (
  location_key text primary key,
  precision text not null check (precision in ('upazila', 'provider_upazila', 'feeder')),
  upazila_id text not null references public.upazilas(id) on update cascade on delete cascade,
  provider_id text references public.providers(id) on update cascade on delete cascade,
  feeder_id text references public.feeders(id) on update cascade on delete cascade,
  state text not null check (state in ('on', 'out')),
  contributor_count integer not null check (contributor_count >= 10),
  observed_at timestamptz not null,
  activated_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (expires_at > activated_at),
  check (location_key = public.make_location_key(upazila_id, provider_id, feeder_id)),
  check (
    (precision = 'upazila' and provider_id is null and feeder_id is null)
    or (precision = 'provider_upazila' and provider_id is not null and feeder_id is null)
    or (precision = 'feeder' and provider_id is not null and feeder_id is not null)
  )
);

create index live_area_states_active_idx on public.live_area_states(expires_at desc);

create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  visitor_hash text not null,
  ip_hash text not null,
  action text not null check (action in ('live_status', 'daily_report', 'analytics', 'admin_login', 'delete_data')),
  created_at timestamptz not null default now()
);

create index rate_limit_visitor_idx on public.rate_limit_events(visitor_hash, action, created_at desc);
create index rate_limit_ip_idx on public.rate_limit_events(ip_hash, action, created_at desc);
create index rate_limit_created_idx on public.rate_limit_events(created_at);

create table public.analytics_daily (
  id bigint generated always as identity primary key,
  event_date date not null,
  event_name text not null check (event_name in ('area_search', 'report_completed', 'share', 'return_visit', 'forecast_view')),
  upazila_id text references public.upazilas(id) on update cascade on delete set null,
  event_count bigint not null default 0 check (event_count >= 0),
  updated_at timestamptz not null default now()
);

create unique index analytics_daily_scope_unique
  on public.analytics_daily(event_date, event_name, coalesce(upazila_id, '*'));

create table public.analytics_daily_visitors (
  event_date date not null,
  visitor_hash text not null,
  first_seen_at timestamptz not null default now(),
  primary key (event_date, visitor_hash)
);

create table public.forecast_runs (
  id uuid primary key default gen_random_uuid(),
  location_key text not null,
  precision text not null check (precision in ('upazila', 'provider_upazila', 'feeder')),
  upazila_id text not null references public.upazilas(id) on update cascade on delete cascade,
  provider_id text references public.providers(id) on update cascade on delete cascade,
  feeder_id text references public.feeders(id) on update cascade on delete cascade,
  generated_at timestamptz not null default now(),
  generated_hour timestamptz not null,
  evidence jsonb not null,
  predicted_windows jsonb not null,
  evaluated_at timestamptz,
  hit boolean,
  check (jsonb_typeof(evidence) = 'object'),
  check (jsonb_typeof(predicted_windows) = 'array'),
  unique (location_key, generated_hour)
);

create index forecast_runs_due_idx on public.forecast_runs(location_key, generated_at)
  where evaluated_at is null;
create index forecast_runs_generated_idx on public.forecast_runs(generated_at);

create table public.app_settings (
  singleton boolean primary key default true check (singleton),
  submissions_enabled boolean not null default true,
  site_kill_switch boolean not null default false,
  public_message text,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system'
);

insert into public.app_settings(singleton) values (true) on conflict do nothing;

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log(created_at desc);

create table public.admin_login_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

create index admin_login_attempts_ip_idx on public.admin_login_attempts(ip_hash, attempted_at desc);
create index admin_login_attempts_created_idx on public.admin_login_attempts(attempted_at);

-- Official distribution entities only; administrative mappings are loaded separately
-- from cited public sources. No provider is inferred merely from district/upazila.
insert into public.providers(id, short_name, name_en, name_bn, official_url, source_url)
values
  ('bpdb', 'BPDB', 'Bangladesh Power Development Board', 'বাংলাদেশ বিদ্যুৎ উন্নয়ন বোর্ড', 'https://bpdb.gov.bd/', 'https://powerdivision.gov.bd/'),
  ('breb', 'BREB', 'Bangladesh Rural Electrification Board', 'বাংলাদেশ পল্লী বিদ্যুতায়ন বোর্ড', 'https://reb.gov.bd/', 'https://powerdivision.gov.bd/'),
  ('dpdc', 'DPDC', 'Dhaka Power Distribution Company', 'ঢাকা পাওয়ার ডিস্ট্রিবিউশন কোম্পানি', 'https://dpdc.org.bd/', 'https://powerdivision.gov.bd/'),
  ('desco', 'DESCO', 'Dhaka Electric Supply Company', 'ঢাকা ইলেকট্রিক সাপ্লাই কোম্পানি', 'https://desco.gov.bd/', 'https://powerdivision.gov.bd/'),
  ('nesco', 'NESCO', 'Northern Electricity Supply Company', 'নর্দান ইলেকট্রিসিটি সাপ্লাই কোম্পানি', 'https://nesco.gov.bd/', 'https://powerdivision.gov.bd/'),
  ('wzpdcl', 'WZPDCL', 'West Zone Power Distribution Company', 'ওয়েস্ট জোন পাওয়ার ডিস্ট্রিবিউশন কোম্পানি', 'https://wzpdcl.gov.bd/', 'https://powerdivision.gov.bd/')
on conflict (id) do update set
  short_name = excluded.short_name,
  name_en = excluded.name_en,
  name_bn = excluded.name_bn,
  official_url = excluded.official_url,
  source_url = excluded.source_url,
  updated_at = now();
