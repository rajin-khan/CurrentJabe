-- Server-authenticated administrator operations. Authentication happens in Next.js;
-- these functions provide atomic mutation + audit logging.

create or replace function public.admin_reserve_login_attempt(p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_failed integer;
  v_attempt_id bigint;
begin
  if char_length(p_ip_hash) < 40 then raise exception using message = 'invalid_identity_hash'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-login:' || p_ip_hash, 0));

  select count(*) into v_failed
  from public.admin_login_attempts
  where ip_hash = p_ip_hash
    and not succeeded
    and attempted_at >= clock_timestamp() - interval '15 minutes';

  if v_failed >= 10 then
    return jsonb_build_object('allowed', false, 'attempt_id', null);
  end if;

  -- Reserve as failed before the expensive password derivation. Parallel
  -- requests therefore count immediately instead of racing the later write.
  insert into public.admin_login_attempts(ip_hash, succeeded)
  values (p_ip_hash, false)
  returning id into v_attempt_id;
  return jsonb_build_object('allowed', true, 'attempt_id', v_attempt_id);
end;
$$;

create or replace function public.admin_finish_login_attempt(
  p_attempt_id bigint,
  p_ip_hash text,
  p_succeeded boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.admin_login_attempts
  set succeeded = p_succeeded
  where id = p_attempt_id and ip_hash = p_ip_hash;
  if not found then raise exception using message = 'admin_login_attempt_not_found'; end if;
  return jsonb_build_object('recorded', true);
end;
$$;

create or replace function public.admin_set_report_suppression(
  p_entity_type text,
  p_entity_id uuid,
  p_suppressed boolean,
  p_reason text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_upazila_id text;
  v_provider_id text;
  v_feeder_id text;
begin
  if p_entity_type not in ('daily_submission', 'outage_event', 'status_confirmation') then
    raise exception using message = 'invalid_report_entity';
  end if;
  if p_suppressed and nullif(btrim(p_reason), '') is null then
    raise exception using message = 'invalid_suppression_reason';
  end if;

  if p_entity_type = 'daily_submission' then
    select to_jsonb(d), d.upazila_id, d.provider_id, d.feeder_id
    into v_before, v_upazila_id, v_provider_id, v_feeder_id
    from public.daily_submissions d where id = p_entity_id for update;
    if not found then raise exception using message = 'report_not_found'; end if;
    update public.daily_submissions as d
    set suppressed_at = case when p_suppressed then clock_timestamp() else null end,
        suppression_reason = case when p_suppressed then p_reason else null end,
        suppressed_by = case when p_suppressed then p_actor else null end
    where d.id = p_entity_id returning to_jsonb(d) into v_after;
  elsif p_entity_type = 'outage_event' then
    select to_jsonb(e), e.upazila_id, e.provider_id, e.feeder_id
    into v_before, v_upazila_id, v_provider_id, v_feeder_id
    from public.outage_events e where id = p_entity_id for update;
    if not found then raise exception using message = 'report_not_found'; end if;
    update public.outage_events as e
    set suppressed_at = case when p_suppressed then clock_timestamp() else null end,
        suppression_reason = case when p_suppressed then p_reason else null end,
        suppressed_by = case when p_suppressed then p_actor else null end
    where e.id = p_entity_id returning to_jsonb(e) into v_after;
  else
    select to_jsonb(c), c.upazila_id, c.provider_id, c.feeder_id
    into v_before, v_upazila_id, v_provider_id, v_feeder_id
    from public.status_confirmations c where id = p_entity_id for update;
    if not found then raise exception using message = 'report_not_found'; end if;
    update public.status_confirmations as c
    set suppressed_at = case when p_suppressed then clock_timestamp() else null end,
        suppression_reason = case when p_suppressed then p_reason else null end,
        suppressed_by = case when p_suppressed then p_actor else null end
    where c.id = p_entity_id returning to_jsonb(c) into v_after;
  end if;

  if p_entity_type = 'status_confirmation' then
    perform pg_advisory_xact_lock(hashtextextended('live-area:' || v_upazila_id, 0));
    delete from public.live_area_states
    where location_key = public.make_location_key(v_upazila_id, null, null);
    perform public.refresh_live_area_state('upazila', v_upazila_id, null, null, null);

    if v_provider_id is not null then
      delete from public.live_area_states
      where location_key = public.make_location_key(v_upazila_id, v_provider_id, null);
      perform public.refresh_live_area_state(
        'provider_upazila', v_upazila_id, v_provider_id, null, null
      );
    end if;

    if v_feeder_id is not null then
      delete from public.live_area_states
      where location_key = public.make_location_key(v_upazila_id, v_provider_id, v_feeder_id);
      perform public.refresh_live_area_state(
        'feeder', v_upazila_id, v_provider_id, v_feeder_id, null
      );
    end if;
  end if;

  insert into public.audit_log(actor, action, entity_type, entity_id, before_state, after_state, reason)
  values (
    p_actor,
    case when p_suppressed then 'suppress' else 'restore' end,
    p_entity_type,
    p_entity_id::text,
    v_before,
    v_after,
    p_reason
  );
  return v_after;
end;
$$;

create or replace function public.admin_update_area(
  p_upazila_id text,
  p_patch jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_area public.upazilas%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_mapping jsonb;
  v_provider_ids text[] := array[]::text[];
  v_provider_id text;
  v_source_url text;
  v_source_label text;
  v_confidence text;
begin
  if jsonb_typeof(p_patch) <> 'object' then raise exception using message = 'invalid_area_patch'; end if;
  select * into v_area from public.upazilas where id = p_upazila_id for update;
  if not found then raise exception using message = 'area_not_found'; end if;

  select jsonb_build_object(
    'area', to_jsonb(v_area),
    'mappings', coalesce(jsonb_agg(to_jsonb(m)) filter (where m.id is not null), '[]'::jsonb)
  ) into v_before
  from public.area_provider_mappings m
  where m.upazila_id = p_upazila_id;

  if p_patch ? 'nameEn' and (jsonb_typeof(p_patch -> 'nameEn') <> 'string' or char_length(p_patch ->> 'nameEn') not between 1 and 120) then
    raise exception using message = 'invalid_area_name';
  end if;
  if p_patch ? 'nameBn' and (jsonb_typeof(p_patch -> 'nameBn') <> 'string' or char_length(p_patch ->> 'nameBn') not between 1 and 120) then
    raise exception using message = 'invalid_area_name';
  end if;
  if p_patch ? 'disabled' and jsonb_typeof(p_patch -> 'disabled') <> 'boolean' then
    raise exception using message = 'invalid_area_disabled';
  end if;
  if p_patch ? 'providerMappings' and jsonb_typeof(p_patch -> 'providerMappings') <> 'array' then
    raise exception using message = 'invalid_provider_mappings';
  end if;

  update public.upazilas
  set name_en = case when p_patch ? 'nameEn' then p_patch ->> 'nameEn' else name_en end,
      name_bn = case when p_patch ? 'nameBn' then p_patch ->> 'nameBn' else name_bn end,
      boundary_ref = case when p_patch ? 'boundaryRef' then nullif(p_patch ->> 'boundaryRef', '') else boundary_ref end,
      disabled = case when p_patch ? 'disabled' then (p_patch ->> 'disabled')::boolean else disabled end,
      disable_reason = case when p_patch ? 'disableReason' then nullif(p_patch ->> 'disableReason', '') else disable_reason end,
      updated_at = clock_timestamp()
  where id = p_upazila_id;

  if exists (select 1 from public.upazilas where id = p_upazila_id and disabled and nullif(btrim(disable_reason), '') is null) then
    raise exception using message = 'invalid_disable_reason';
  end if;

  if p_patch ? 'providerMappings' then
    for v_mapping in select value from jsonb_array_elements(p_patch -> 'providerMappings')
    loop
      v_provider_id := v_mapping ->> 'providerId';
      v_source_url := v_mapping ->> 'sourceUrl';
      v_source_label := v_mapping ->> 'sourceLabel';
      v_confidence := coalesce(v_mapping ->> 'confidence', 'unverified');
      if not exists (select 1 from public.providers where id = v_provider_id)
        or v_source_url !~ '^https://'
        or char_length(v_source_label) not between 2 and 180
        or v_confidence not in ('confirmed', 'probable', 'unverified')
      then
        raise exception using message = 'invalid_provider_mapping';
      end if;
      v_provider_ids := array_append(v_provider_ids, v_provider_id);
      insert into public.area_provider_mappings(
        upazila_id, provider_id, source_url, source_label, source_verified_at, confidence, active
      ) values (
        p_upazila_id,
        v_provider_id,
        v_source_url,
        v_source_label,
        case when v_mapping ? 'sourceVerifiedAt' then (v_mapping ->> 'sourceVerifiedAt')::date else null end,
        v_confidence,
        true
      )
      on conflict (upazila_id, provider_id) do update set
        source_url = excluded.source_url,
        source_label = excluded.source_label,
        source_verified_at = excluded.source_verified_at,
        confidence = excluded.confidence,
        active = true,
        updated_at = clock_timestamp();
    end loop;

    update public.area_provider_mappings
    set active = false, updated_at = clock_timestamp()
    where upazila_id = p_upazila_id
      and not (provider_id = any(v_provider_ids));
  end if;

  if (select disabled from public.upazilas where id = p_upazila_id) then
    delete from public.live_area_states where upazila_id = p_upazila_id;
  end if;

  select jsonb_build_object(
    'area', to_jsonb(u),
    'mappings', coalesce(jsonb_agg(to_jsonb(m)) filter (where m.id is not null), '[]'::jsonb)
  ) into v_after
  from public.upazilas u
  left join public.area_provider_mappings m on m.upazila_id = u.id and m.active
  where u.id = p_upazila_id
  group by u.id;

  insert into public.audit_log(actor, action, entity_type, entity_id, before_state, after_state)
  values (p_actor, 'update', 'upazila', p_upazila_id, v_before, v_after);
  return v_after;
end;
$$;

create or replace function public.admin_update_settings(
  p_patch jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if jsonb_typeof(p_patch) <> 'object' then raise exception using message = 'invalid_settings_patch'; end if;
  if p_patch ? 'submissionsEnabled' and jsonb_typeof(p_patch -> 'submissionsEnabled') <> 'boolean' then
    raise exception using message = 'invalid_settings_patch';
  end if;
  if p_patch ? 'siteKillSwitch' and jsonb_typeof(p_patch -> 'siteKillSwitch') <> 'boolean' then
    raise exception using message = 'invalid_settings_patch';
  end if;

  select to_jsonb(s) into v_before from public.app_settings s where singleton = true for update;
  update public.app_settings as s
  set submissions_enabled = case
        when p_patch ? 'submissionsEnabled' then (p_patch ->> 'submissionsEnabled')::boolean
        else submissions_enabled
      end,
      site_kill_switch = case
        when p_patch ? 'siteKillSwitch' then (p_patch ->> 'siteKillSwitch')::boolean
        else site_kill_switch
      end,
      public_message = case when p_patch ? 'publicMessage' then nullif(p_patch ->> 'publicMessage', '') else public_message end,
      updated_at = clock_timestamp(),
      updated_by = p_actor
  where s.singleton = true
  returning to_jsonb(s) into v_after;

  if (v_after ->> 'site_kill_switch')::boolean then delete from public.live_area_states; end if;
  insert into public.audit_log(actor, action, entity_type, entity_id, before_state, after_state)
  values (p_actor, 'update', 'settings', 'singleton', v_before, v_after);
  return v_after;
end;
$$;

create or replace function public.prune_operational_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rate integer;
  v_login integer;
  v_state integer;
  v_forecast integer;
  v_stale_live integer;
begin
  v_stale_live := public.close_stale_live_outages(null);
  delete from public.rate_limit_events where created_at < clock_timestamp() - interval '7 days';
  get diagnostics v_rate = row_count;
  delete from public.admin_login_attempts where attempted_at < clock_timestamp() - interval '30 days';
  get diagnostics v_login = row_count;
  delete from public.live_area_states where expires_at < clock_timestamp() - interval '1 day';
  get diagnostics v_state = row_count;
  delete from public.forecast_runs
  where generated_at < clock_timestamp() - interval '180 days' and evaluated_at is not null;
  get diagnostics v_forecast = row_count;
  return jsonb_build_object(
    'rateLimitEvents', v_rate,
    'loginAttempts', v_login,
    'staleLiveOutagesClosed', v_stale_live,
    'expiredStates', v_state,
    'evaluatedForecasts', v_forecast
  );
end;
$$;

create or replace function public.admin_get_analytics(p_days integer default 30)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    select (clock_timestamp() at time zone 'Asia/Dhaka')::date - greatest(1, least(p_days, 90)) + 1 as since
  ), daily as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', a.event_date,
      'event', a.event_name,
      'upazilaId', a.upazila_id,
      'count', a.event_count
    ) order by a.event_date desc, a.event_name), '[]'::jsonb) as value
    from public.analytics_daily a, bounds b
    where a.event_date >= b.since
  ), visitors as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', grouped.event_date,
      'uniqueVisitors', grouped.visitor_count
    ) order by grouped.event_date desc), '[]'::jsonb) as value
    from (
      select v.event_date, count(*) as visitor_count
      from public.analytics_daily_visitors v, bounds b
      where v.event_date >= b.since
      group by v.event_date
    ) grouped
  ), summary as (
    select coalesce(jsonb_object_agg(grouped.event_name, grouped.event_count), '{}'::jsonb) as value
    from (
      select a.event_name, sum(a.event_count) as event_count
      from public.analytics_daily a, bounds b
      where a.event_date >= b.since
      group by a.event_name
    ) grouped
  )
  select jsonb_build_object(
    'days', greatest(1, least(p_days, 90)),
    'summary', summary.value,
    'daily', daily.value,
    'visitors', visitors.value
  )
  from daily cross join visitors cross join summary;
$$;
