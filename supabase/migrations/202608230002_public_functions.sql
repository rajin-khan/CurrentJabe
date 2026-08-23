-- Atomic server-only RPCs for reporting, aggregation, forecasts, and privacy.

create or replace function public.assert_location_scope(
  p_upazila_id text,
  p_provider_id text default null,
  p_feeder_id text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_area_exists boolean;
begin
  select exists(select 1 from public.upazilas where id = p_upazila_id) into v_area_exists;
  if not v_area_exists then raise exception using message = 'invalid_upazila'; end if;

  if p_provider_id is null and p_feeder_id is not null then
    raise exception using message = 'invalid_feeder_without_provider';
  end if;

  if p_provider_id is not null and not exists (
    select 1
    from public.area_provider_mappings m
    join public.providers p on p.id = m.provider_id
    where m.upazila_id = p_upazila_id
      and m.provider_id = p_provider_id
      and m.active
      and p.enabled
  ) then
    raise exception using message = 'invalid_provider_for_area';
  end if;

  if p_feeder_id is not null and not exists (
    select 1
    from public.feeders
    where id = p_feeder_id
      and upazila_id = p_upazila_id
      and provider_id = p_provider_id
      and active
  ) then
    raise exception using message = 'invalid_feeder';
  end if;
end;
$$;

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
begin
  perform public.assert_location_scope(p_upazila_id, p_provider_id, p_feeder_id);

  select * into v_settings from public.app_settings where singleton = true;
  if v_settings.site_kill_switch or not v_settings.submissions_enabled then
    raise exception using message = 'submissions_disabled';
  end if;

  select * into v_area from public.upazilas where id = p_upazila_id;
  if v_area.disabled then raise exception using message = 'area_disabled'; end if;
end;
$$;

create or replace function public.close_stale_live_outages(p_upazila_id text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_closed integer;
begin
  update public.outage_events
  set ended_at = started_at + interval '1 hour',
      close_reason = 'automatic',
      time_precision = 'approximate'
  where source = 'live'
    and ended_at is null
    and suppressed_at is null
    and started_at <= clock_timestamp() - interval '1 hour'
    and (p_upazila_id is null or upazila_id = p_upazila_id);
  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

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
  if p_action not in ('live_status', 'daily_report', 'analytics', 'admin_login', 'delete_data') then
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

  -- Opportunistic, lock-safe retention keeps the free-tier operational tables
  -- bounded without a cron job or daily operator task.
  if random() < 0.01 and pg_try_advisory_xact_lock(hashtextextended('currentjabe:operational-prune', 0)) then
    perform public.close_stale_live_outages(null);
    delete from public.rate_limit_events where created_at < v_now - interval '7 days';
    delete from public.admin_login_attempts where attempted_at < v_now - interval '30 days';
    delete from public.live_area_states where expires_at < v_now - interval '1 day';
    delete from public.forecast_runs
    where generated_at < v_now - interval '180 days' and evaluated_at is not null;
  end if;
end;
$$;

create or replace function public.increment_analytics(
  p_event_name text,
  p_visitor_hash text,
  p_upazila_id text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (clock_timestamp() at time zone 'Asia/Dhaka')::date;
begin
  if p_event_name not in ('area_search', 'report_completed', 'share', 'return_visit', 'forecast_view') then
    raise exception using message = 'invalid_analytics_event';
  end if;

  insert into public.analytics_daily(event_date, event_name, upazila_id, event_count)
  values (v_today, p_event_name, p_upazila_id, 1)
  on conflict (event_date, event_name, (coalesce(upazila_id, '*')))
  do update set event_count = public.analytics_daily.event_count + 1, updated_at = clock_timestamp();

  insert into public.analytics_daily_visitors(event_date, visitor_hash)
  values (v_today, p_visitor_hash)
  on conflict do nothing;
end;
$$;

create or replace function public.update_visitor_reputation(p_confirmation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_confirmation public.status_confirmations%rowtype;
  v_same integer := 0;
  v_opposite integer := 0;
begin
  select * into v_confirmation
  from public.status_confirmations
  where id = p_confirmation_id and suppressed_at is null;
  if not found then return; end if;

  select
    count(distinct visitor_hash) filter (where state = v_confirmation.state),
    count(distinct visitor_hash) filter (where state <> v_confirmation.state)
  into v_same, v_opposite
  from public.status_confirmations
  where upazila_id = v_confirmation.upazila_id
    and visitor_hash <> v_confirmation.visitor_hash
    and suppressed_at is null
    and observed_at between v_confirmation.observed_at - interval '15 minutes'
                        and v_confirmation.observed_at + interval '15 minutes';

  insert into public.visitor_reputation(visitor_hash)
  values (v_confirmation.visitor_hash)
  on conflict do nothing;

  if v_same >= 2 then
    update public.visitor_reputation
    set corroborated_count = corroborated_count + 1,
        score = least(1.2500, score + 0.0250),
        updated_at = clock_timestamp()
    where visitor_hash = v_confirmation.visitor_hash;
  elsif v_opposite >= 5 and v_same = 0 then
    update public.visitor_reputation
    set contradicted_count = contradicted_count + 1,
        score = greatest(0.2500, score - 0.0500),
        updated_at = clock_timestamp()
    where visitor_hash = v_confirmation.visitor_hash;
  end if;
end;
$$;

create or replace function public.refresh_live_area_state(
  p_precision text,
  p_upazila_id text,
  p_provider_id text,
  p_feeder_id text,
  p_trigger_state text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.make_location_key(p_upazila_id, p_provider_id, p_feeder_id);
  v_now timestamptz := clock_timestamp();
  v_on_count integer := 0;
  v_out_count integer := 0;
  v_latest_on timestamptz;
  v_latest_out timestamptz;
  v_candidate text;
  v_candidate_count integer;
  v_candidate_observed timestamptz;
  v_existing public.live_area_states%rowtype;
  v_result public.live_area_states%rowtype;
begin
  if p_precision not in ('upazila', 'provider_upazila', 'feeder') then
    raise exception using message = 'invalid_location_precision';
  end if;

  with latest_per_visitor as (
    select distinct on (c.visitor_hash)
      c.id,
      c.visitor_hash,
      c.network_hash,
      c.state,
      c.observed_at
    from public.status_confirmations c
    where c.suppressed_at is null
      and c.observed_at >= v_now - interval '30 minutes'
      and c.upazila_id = p_upazila_id
      and (
        (p_precision = 'upazila')
        or (p_precision = 'provider_upazila' and c.provider_id = p_provider_id)
        or (p_precision = 'feeder' and c.feeder_id = p_feeder_id)
      )
    order by c.visitor_hash, c.observed_at desc, c.id desc
  ), network_ranked as (
    select
      latest.*,
      row_number() over (
        partition by latest.network_hash
        order by latest.observed_at desc, latest.id desc
      ) as network_rank
    from latest_per_visitor latest
    left join public.visitor_reputation r on r.visitor_hash = latest.visitor_hash
    where coalesce(r.score, 0.7500) >= 0.5000
  )
  select
    count(*) filter (where state = 'on' and network_rank <= 3),
    count(*) filter (where state = 'out' and network_rank <= 3),
    max(observed_at) filter (where state = 'on' and network_rank <= 3),
    max(observed_at) filter (where state = 'out' and network_rank <= 3)
  into v_on_count, v_out_count, v_latest_on, v_latest_out
  from network_ranked;

  if v_on_count >= 10 or v_out_count >= 10 then
    if v_out_count > v_on_count then v_candidate := 'out';
    elsif v_on_count > v_out_count then v_candidate := 'on';
    elsif coalesce(v_latest_out, '-infinity'::timestamptz) >= coalesce(v_latest_on, '-infinity'::timestamptz) then v_candidate := 'out';
    else v_candidate := 'on';
    end if;
  end if;

  if v_candidate = 'out' then
    v_candidate_count := v_out_count;
    v_candidate_observed := v_latest_out;
  elsif v_candidate = 'on' then
    v_candidate_count := v_on_count;
    v_candidate_observed := v_latest_on;
  end if;

  select * into v_existing from public.live_area_states where location_key = v_key for update;

  if v_candidate is not null then
    if not found or v_existing.state <> v_candidate or p_trigger_state = v_candidate then
      insert into public.live_area_states(
        location_key, precision, upazila_id, provider_id, feeder_id, state,
        contributor_count, observed_at, activated_at, expires_at, updated_at
      ) values (
        v_key, p_precision, p_upazila_id, p_provider_id, p_feeder_id, v_candidate,
        v_candidate_count, v_candidate_observed, v_now, v_now + interval '1 hour', v_now
      )
      on conflict (location_key) do update set
        state = excluded.state,
        contributor_count = excluded.contributor_count,
        observed_at = excluded.observed_at,
        activated_at = case
          when public.live_area_states.state = excluded.state then public.live_area_states.activated_at
          else excluded.activated_at
        end,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      returning * into v_result;
    else
      v_result := v_existing;
    end if;
  elsif found and v_existing.expires_at > v_now then
    v_result := v_existing;
  else
    delete from public.live_area_states where location_key = v_key;
    return null;
  end if;

  return jsonb_build_object(
    'state', v_result.state,
    'contributor_count', v_result.contributor_count,
    'observed_at', v_result.observed_at,
    'expires_at', v_result.expires_at,
    'precision', v_result.precision
  );
end;
$$;

create or replace function public.api_submit_live_status(
  p_visitor_hash text,
  p_ip_hash text,
  p_network_hash text,
  p_state text,
  p_upazila_id text,
  p_provider_id text default null,
  p_feeder_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_location_key text := public.make_location_key(p_upazila_id, p_provider_id, p_feeder_id);
  v_confirmation_id uuid;
  v_event_id uuid;
  v_duplicate boolean := false;
  v_live_state jsonb;
begin
  if p_state not in ('on', 'out') then raise exception using message = 'invalid_power_state'; end if;
  if p_network_hash is null or char_length(p_network_hash) < 40 then raise exception using message = 'invalid_network_hash'; end if;
  perform public.assert_reporting_open(p_upazila_id, p_provider_id, p_feeder_id);
  perform public.enforce_rate_limit(p_visitor_hash, p_ip_hash, 'live_status', 12, 2000, interval '1 hour');

  perform pg_advisory_xact_lock(hashtextextended('live:' || p_visitor_hash || ':' || v_location_key, 0));
  -- Serialize one administrative area's threshold refreshes so the tenth
  -- simultaneous independent report cannot be lost to transaction snapshots.
  perform pg_advisory_xact_lock(hashtextextended('live-area:' || p_upazila_id, 0));
  perform public.close_stale_live_outages(p_upazila_id);
  if exists (
    select 1 from public.status_confirmations
    where visitor_hash = p_visitor_hash
      and location_key = v_location_key
      and state = p_state
      and observed_at >= v_now - interval '5 minutes'
      and suppressed_at is null
  ) then
    v_duplicate := true;
    if p_state = 'out' then
      select id into v_event_id
      from public.outage_events
      where visitor_hash = p_visitor_hash
        and location_key = v_location_key
        and source = 'live'
        and ended_at is null
        and suppressed_at is null
      order by started_at desc
      limit 1;
    end if;
  else
    if p_state = 'out' then
      select id into v_event_id
      from public.outage_events
      where visitor_hash = p_visitor_hash
        and location_key = v_location_key
        and source = 'live'
        and ended_at is null
        and suppressed_at is null
      order by started_at desc
      limit 1;

      if v_event_id is null then
        insert into public.outage_events(
          visitor_hash, network_hash, upazila_id, provider_id, feeder_id, location_key,
          source, started_at, time_precision
        ) values (
          p_visitor_hash, p_network_hash, p_upazila_id, p_provider_id, p_feeder_id, v_location_key,
          'live', v_now, 'exact'
        ) returning id into v_event_id;
      end if;
    else
      update public.outage_events
      set ended_at = greatest(v_now, started_at + interval '1 second'), close_reason = 'contributor'
      where id = (
        select id from public.outage_events
        where visitor_hash = p_visitor_hash
          and location_key = v_location_key
          and source = 'live'
          and ended_at is null
          and suppressed_at is null
        order by started_at desc
        limit 1
      ) returning id into v_event_id;
    end if;

    insert into public.status_confirmations(
      visitor_hash, network_hash, upazila_id, provider_id, feeder_id, location_key,
      state, observed_at, linked_event_id
    ) values (
      p_visitor_hash, p_network_hash, p_upazila_id, p_provider_id, p_feeder_id, v_location_key,
      p_state, v_now, v_event_id
    ) returning id into v_confirmation_id;

    perform public.update_visitor_reputation(v_confirmation_id);
    perform public.increment_analytics('report_completed', p_visitor_hash, p_upazila_id);
  end if;

  if not v_duplicate then
    perform public.refresh_live_area_state('upazila', p_upazila_id, null, null, p_state);
    if p_provider_id is not null then
      perform public.refresh_live_area_state('provider_upazila', p_upazila_id, p_provider_id, null, p_state);
    end if;
    if p_feeder_id is not null then
      v_live_state := public.refresh_live_area_state('feeder', p_upazila_id, p_provider_id, p_feeder_id, p_state);
    elsif p_provider_id is not null then
      v_live_state := public.refresh_live_area_state('provider_upazila', p_upazila_id, p_provider_id, null, p_state);
    else
      v_live_state := public.refresh_live_area_state('upazila', p_upazila_id, null, null, p_state);
    end if;
  else
    select jsonb_build_object(
      'state', state,
      'contributor_count', contributor_count,
      'observed_at', observed_at,
      'expires_at', expires_at,
      'precision', precision
    ) into v_live_state
    from public.live_area_states
    where location_key = v_location_key and expires_at > v_now;
  end if;

  return jsonb_build_object(
    'duplicate', v_duplicate,
    'event_id', v_event_id,
    'live_state', v_live_state
  );
end;
$$;

create or replace function public.api_close_live_outage(
  p_visitor_hash text,
  p_ip_hash text,
  p_network_hash text,
  p_event_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.outage_events%rowtype;
  v_result jsonb;
begin
  select * into v_event
  from public.outage_events
  where id = p_event_id
    and visitor_hash = p_visitor_hash
    and source = 'live'
    and ended_at is null
    and suppressed_at is null;
  if not found then raise exception using message = 'outage_event_not_found'; end if;

  v_result := public.api_submit_live_status(
    p_visitor_hash,
    p_ip_hash,
    p_network_hash,
    'on',
    v_event.upazila_id,
    v_event.provider_id,
    v_event.feeder_id
  );
  return jsonb_set(v_result, '{closed}', 'true'::jsonb, true);
end;
$$;

create or replace function public.api_submit_daily_report(
  p_visitor_hash text,
  p_ip_hash text,
  p_network_hash text,
  p_occurred_on date,
  p_count_known boolean,
  p_outage_count integer,
  p_windows jsonb,
  p_upazila_id text,
  p_provider_id text default null,
  p_feeder_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (clock_timestamp() at time zone 'Asia/Dhaka')::date;
  v_location_key text := public.make_location_key(p_upazila_id, p_provider_id, p_feeder_id);
  v_submission_id uuid;
  v_window jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_precision text;
  v_event_id uuid;
  v_inserted_ids uuid[] := array[]::uuid[];
  v_existing_ids uuid[] := array[]::uuid[];
  v_skipped integer := 0;
  v_existing_count integer := 0;
  v_window_count integer;
begin
  if p_network_hash is null or char_length(p_network_hash) < 40 then raise exception using message = 'invalid_network_hash'; end if;
  perform public.assert_reporting_open(p_upazila_id, p_provider_id, p_feeder_id);
  perform public.enforce_rate_limit(p_visitor_hash, p_ip_hash, 'daily_report', 3, 1000, interval '1 day');

  if p_occurred_on not in (v_today, v_today - 1) then
    raise exception using message = 'invalid_report_date';
  end if;
  if jsonb_typeof(p_windows) <> 'array' then raise exception using message = 'invalid_windows'; end if;
  v_window_count := jsonb_array_length(p_windows);
  if v_window_count > 24 then raise exception using message = 'invalid_windows'; end if;
  if p_count_known and (p_outage_count is null or p_outage_count < 0 or p_outage_count > 24) then
    raise exception using message = 'invalid_outage_count';
  end if;
  if not p_count_known and p_outage_count is not null then raise exception using message = 'invalid_outage_count'; end if;
  if p_count_known and v_window_count > p_outage_count then raise exception using message = 'invalid_outage_count'; end if;
  if not p_count_known and v_window_count = 0 then raise exception using message = 'invalid_windows'; end if;

  perform pg_advisory_xact_lock(hashtextextended('daily:' || p_visitor_hash || ':' || v_location_key || ':' || p_occurred_on::text, 0));
  select id into v_submission_id
  from public.daily_submissions
  where visitor_hash = p_visitor_hash
    and location_key = v_location_key
    and occurred_on = p_occurred_on;
  if found then
    select coalesce(array_agg(id order by started_at), array[]::uuid[]) into v_existing_ids
    from public.outage_events
    where visitor_hash = p_visitor_hash
      and location_key = v_location_key
      and (started_at at time zone 'Asia/Dhaka')::date = p_occurred_on;
    return jsonb_build_object(
      'submission_id', v_submission_id,
      'duplicate', true,
      'inserted_event_ids', '[]'::jsonb,
      'skipped_duplicate_windows', 0,
      'existing_event_ids', to_jsonb(v_existing_ids)
    );
  end if;

  select
    count(*),
    coalesce(array_agg(id order by started_at), array[]::uuid[])
  into v_existing_count, v_existing_ids
  from public.outage_events
  where visitor_hash = p_visitor_hash
    and location_key = v_location_key
    and suppressed_at is null
    and (started_at at time zone 'Asia/Dhaka')::date = p_occurred_on;

  if p_count_known and p_outage_count < v_existing_count then
    raise exception using message = 'invalid_outage_count_below_existing';
  end if;

  insert into public.daily_submissions(
    visitor_hash, upazila_id, provider_id, feeder_id, location_key,
    occurred_on, count_known, outage_count, remembered_window_count
  ) values (
    p_visitor_hash, p_upazila_id, p_provider_id, p_feeder_id, v_location_key,
    p_occurred_on, p_count_known, p_outage_count, v_window_count
  ) returning id into v_submission_id;

  for v_window in select value from jsonb_array_elements(p_windows)
  loop
    begin
      v_start := (v_window ->> 'startedAt')::timestamptz;
      v_end := (v_window ->> 'endedAt')::timestamptz;
    exception when others then
      raise exception using message = 'invalid_window_timestamp';
    end;
    v_precision := v_window ->> 'precision';
    if v_precision not in ('exact', 'approximate')
      or v_end <= v_start
      or v_end > v_start + interval '24 hours'
      or (v_start at time zone 'Asia/Dhaka')::date <> p_occurred_on
    then
      raise exception using message = 'invalid_window';
    end if;

    if exists (
      select 1 from public.outage_events
      where visitor_hash = p_visitor_hash
        and location_key = v_location_key
        and suppressed_at is null
        and tstzrange(started_at, coalesce(ended_at, clock_timestamp()), '[)') && tstzrange(v_start, v_end, '[)')
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.outage_events(
      daily_submission_id, visitor_hash, network_hash, upazila_id, provider_id, feeder_id,
      location_key, source, started_at, ended_at, time_precision, close_reason
    ) values (
      v_submission_id, p_visitor_hash, p_network_hash, p_upazila_id, p_provider_id, p_feeder_id,
      v_location_key, 'daily', v_start, v_end, v_precision, 'retrospective'
    ) returning id into v_event_id;
    v_inserted_ids := array_append(v_inserted_ids, v_event_id);
  end loop;

  if p_count_known and v_existing_count + coalesce(array_length(v_inserted_ids, 1), 0) > p_outage_count then
    raise exception using message = 'invalid_outage_count_below_windows';
  end if;

  insert into public.visitor_reputation(visitor_hash) values (p_visitor_hash) on conflict do nothing;
  perform public.increment_analytics('report_completed', p_visitor_hash, p_upazila_id);

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'duplicate', false,
    'inserted_event_ids', to_jsonb(v_inserted_ids),
    'skipped_duplicate_windows', v_skipped,
    'existing_event_ids', to_jsonb(v_existing_ids)
  );
end;
$$;

create or replace function public.api_get_my_reports(
  p_visitor_hash text,
  p_occurred_on date,
  p_upazila_id text,
  p_provider_id text default null,
  p_feeder_id text default null
) returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  with wanted as (
    select public.make_location_key(p_upazila_id, p_provider_id, p_feeder_id) as location_key
  ), events as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'started_at', e.started_at,
      'ended_at', e.ended_at,
      'source', e.source,
      'time_precision', e.time_precision
    ) order by e.started_at), '[]'::jsonb) as value
    from public.outage_events e, wanted w
    where e.visitor_hash = p_visitor_hash
      and e.location_key = w.location_key
      and e.suppressed_at is null
      and (e.started_at at time zone 'Asia/Dhaka')::date = p_occurred_on
  ), submission as (
    select jsonb_build_object(
      'id', d.id,
      'count_known', d.count_known,
      'outage_count', d.outage_count,
      'remembered_window_count', d.remembered_window_count
    ) as value
    from public.daily_submissions d, wanted w
    where d.visitor_hash = p_visitor_hash
      and d.location_key = w.location_key
      and d.occurred_on = p_occurred_on
      and d.suppressed_at is null
    limit 1
  )
  select jsonb_build_object(
    'date', p_occurred_on,
    'events', events.value,
    'daily_submission', (select value from submission)
  ) from events;
$$;

create or replace function public.api_delete_visitor_data(
  p_visitor_hash text,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_daily integer;
  v_events integer;
  v_status integer;
  v_analytics integer;
  v_scopes jsonb;
  v_scope record;
begin
  perform public.enforce_rate_limit(p_visitor_hash, p_ip_hash, 'delete_data', 3, 200, interval '1 day');
  select count(*) into v_daily from public.daily_submissions where visitor_hash = p_visitor_hash;
  select count(*) into v_events from public.outage_events where visitor_hash = p_visitor_hash;
  select count(*) into v_status from public.status_confirmations where visitor_hash = p_visitor_hash;
  select count(*) into v_analytics from public.analytics_daily_visitors where visitor_hash = p_visitor_hash;

  select coalesce(
    jsonb_agg(to_jsonb(scope) order by scope.upazila_id, scope.provider_id, scope.feeder_id),
    '[]'::jsonb
  ) into v_scopes
  from (
    select distinct upazila_id, provider_id, feeder_id
    from public.status_confirmations where visitor_hash = p_visitor_hash
    union
    select distinct upazila_id, provider_id, feeder_id
    from public.outage_events where visitor_hash = p_visitor_hash
  ) scope;

  -- Serialize against new live confirmations in only the administrative areas
  -- this visitor actually touched.
  for v_scope in
    select * from jsonb_to_recordset(v_scopes)
      as scope(upazila_id text, provider_id text, feeder_id text)
  loop
    perform pg_advisory_xact_lock(hashtextextended('live-area:' || v_scope.upazila_id, 0));
  end loop;

  update public.audit_log
  set before_state = case
        when before_state ->> 'visitor_hash' = p_visitor_hash then before_state - array['visitor_hash', 'network_hash']
        else before_state
      end,
      after_state = case
        when after_state ->> 'visitor_hash' = p_visitor_hash then after_state - array['visitor_hash', 'network_hash']
        else after_state
      end
  where before_state ->> 'visitor_hash' = p_visitor_hash
     or after_state ->> 'visitor_hash' = p_visitor_hash;
  delete from public.status_confirmations where visitor_hash = p_visitor_hash;
  delete from public.daily_submissions where visitor_hash = p_visitor_hash;
  delete from public.outage_events where visitor_hash = p_visitor_hash;
  delete from public.analytics_daily_visitors where visitor_hash = p_visitor_hash;
  delete from public.visitor_reputation where visitor_hash = p_visitor_hash;
  delete from public.rate_limit_events where visitor_hash = p_visitor_hash and action <> 'delete_data';

  -- Remove and rebuild only the exact aggregate scopes affected by the deleted
  -- evidence. Unrelated provider/feeder states in the same upazila survive.
  for v_scope in
    select * from jsonb_to_recordset(v_scopes)
      as scope(upazila_id text, provider_id text, feeder_id text)
  loop
    delete from public.live_area_states
    where location_key = public.make_location_key(v_scope.upazila_id, null, null);
    perform public.refresh_live_area_state('upazila', v_scope.upazila_id, null, null, null);

    if v_scope.provider_id is not null then
      delete from public.live_area_states
      where location_key = public.make_location_key(v_scope.upazila_id, v_scope.provider_id, null);
      perform public.refresh_live_area_state(
        'provider_upazila', v_scope.upazila_id, v_scope.provider_id, null, null
      );
    end if;

    if v_scope.feeder_id is not null then
      delete from public.live_area_states
      where location_key = public.make_location_key(
        v_scope.upazila_id, v_scope.provider_id, v_scope.feeder_id
      );
      perform public.refresh_live_area_state(
        'feeder', v_scope.upazila_id, v_scope.provider_id, v_scope.feeder_id, null
      );
    end if;
  end loop;

  return jsonb_build_object(
    'dailySubmissions', v_daily,
    'outageEvents', v_events,
    'statusConfirmations', v_status,
    'analyticsVisitorDays', v_analytics
  );
end;
$$;

create or replace function public.record_analytics_event(
  p_event_name text,
  p_visitor_hash text,
  p_ip_hash text,
  p_upazila_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (clock_timestamp() at time zone 'Asia/Dhaka')::date;
begin
  perform public.enforce_rate_limit(p_visitor_hash, p_ip_hash, 'analytics', 60, 10000, interval '1 hour');
  if p_upazila_id is not null and not exists (select 1 from public.upazilas where id = p_upazila_id) then
    raise exception using message = 'invalid_upazila';
  end if;
  if p_event_name = 'report_completed' then
    -- Successful report RPCs increment this authoritatively. Ignore the
    -- client-side celebratory event so one submission never counts twice.
    return jsonb_build_object('recorded', true, 'counted', false);
  end if;
  if p_event_name = 'return_visit' and not exists (
    select 1 from public.analytics_daily_visitors
    where visitor_hash = p_visitor_hash and event_date < v_today
  ) then
    insert into public.analytics_daily_visitors(event_date, visitor_hash)
    values (v_today, p_visitor_hash)
    on conflict do nothing;
    return jsonb_build_object('recorded', true, 'countedAsReturn', false);
  end if;
  perform public.increment_analytics(p_event_name, p_visitor_hash, p_upazila_id);
  return jsonb_build_object('recorded', true, 'countedAsReturn', p_event_name = 'return_visit');
end;
$$;

create or replace function public.get_forecast_evidence(
  p_upazila_id text,
  p_provider_id text default null,
  p_feeder_id text default null,
  p_since timestamptz default (now() - interval '35 days')
) returns table (
  id uuid,
  visitor_hash text,
  network_hash text,
  started_at timestamptz,
  ended_at timestamptz,
  time_precision text,
  reputation_score numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_location_scope(p_upazila_id, p_provider_id, p_feeder_id);
  perform public.close_stale_live_outages(p_upazila_id);

  return query select
    e.id,
    e.visitor_hash,
    e.network_hash,
    e.started_at,
    e.ended_at,
    e.time_precision,
    coalesce(r.score, 0.7500) as reputation_score
  from public.outage_events e
  left join public.daily_submissions d on d.id = e.daily_submission_id
  left join public.visitor_reputation r on r.visitor_hash = e.visitor_hash
  where e.upazila_id = p_upazila_id
    and e.ended_at is not null
    and e.ended_at >= p_since
    and e.started_at <= clock_timestamp()
    and e.suppressed_at is null
    and (d.id is null or d.suppressed_at is null)
    and (
      (p_feeder_id is not null and e.feeder_id = p_feeder_id)
      or (p_feeder_id is null and p_provider_id is not null and e.provider_id = p_provider_id)
      or (p_feeder_id is null and p_provider_id is null)
    )
  order by e.started_at desc
  limit 5000;
end;
$$;

create or replace function public.get_area_official_sources(
  p_upazila_id text,
  p_provider_id text default null
) returns table (
  provider_id text,
  provider_name_en text,
  provider_name_bn text,
  provider_short_name text,
  official_url text,
  mapping_source_url text,
  mapping_source_label text,
  confidence text,
  source_verified_at date
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.name_en,
    p.name_bn,
    p.short_name,
    p.official_url,
    m.source_url,
    m.source_label,
    m.confidence,
    m.source_verified_at
  from public.area_provider_mappings m
  join public.providers p on p.id = m.provider_id
  where m.upazila_id = p_upazila_id
    and m.active
    and p.enabled
    and (p_provider_id is null or m.provider_id = p_provider_id)
  order by p.short_name;
$$;

create or replace function public.evaluate_due_forecasts(p_location_key text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.forecast_runs%rowtype;
  v_window jsonb;
  v_max_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_contributors integer;
  v_hit boolean;
  v_evaluated integer := 0;
begin
  for v_run in
    select *
    from public.forecast_runs
    where location_key = p_location_key and evaluated_at is null
    order by generated_at
    for update skip locked
  loop
    select max((value ->> 'endsAt')::timestamptz)
    into v_max_end
    from jsonb_array_elements(v_run.predicted_windows);
    if v_max_end is null or v_max_end > clock_timestamp() then continue; end if;

    v_hit := false;
    for v_window in select value from jsonb_array_elements(v_run.predicted_windows)
    loop
      begin
        v_window_start := (v_window ->> 'startsAt')::timestamptz;
        v_window_end := (v_window ->> 'endsAt')::timestamptz;
      exception when others then
        continue;
      end;

      select count(distinct e.visitor_hash) into v_contributors
      from public.outage_events e
      left join public.daily_submissions d on d.id = e.daily_submission_id
      where e.upazila_id = v_run.upazila_id
        and e.ended_at is not null
        and e.suppressed_at is null
        and (d.id is null or d.suppressed_at is null)
        and tstzrange(e.started_at, e.ended_at, '[)') && tstzrange(v_window_start, v_window_end, '[)')
        and (
          (v_run.precision = 'upazila')
          or (v_run.precision = 'provider_upazila' and e.provider_id = v_run.provider_id)
          or (v_run.precision = 'feeder' and e.feeder_id = v_run.feeder_id)
        );
      if v_contributors >= 3 then
        v_hit := true;
        exit;
      end if;
    end loop;

    update public.forecast_runs
    set evaluated_at = clock_timestamp(), hit = v_hit
    where id = v_run.id;
    v_evaluated := v_evaluated + 1;
  end loop;
  return v_evaluated;
end;
$$;

create or replace function public.log_forecast_run(
  p_location_key text,
  p_precision text,
  p_upazila_id text,
  p_provider_id text,
  p_feeder_id text,
  p_forecast jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hour timestamptz := date_trunc('hour', clock_timestamp());
  v_id uuid;
begin
  if p_precision not in ('upazila', 'provider_upazila', 'feeder')
    or p_location_key <> public.make_location_key(p_upazila_id, p_provider_id, p_feeder_id)
    or jsonb_typeof(p_forecast -> 'evidence') <> 'object'
    or jsonb_typeof(p_forecast -> 'windows') <> 'array'
  then
    raise exception using message = 'invalid_forecast';
  end if;

  perform public.evaluate_due_forecasts(p_location_key);
  insert into public.forecast_runs(
    location_key, precision, upazila_id, provider_id, feeder_id,
    generated_hour, evidence, predicted_windows
  ) values (
    p_location_key, p_precision, p_upazila_id, p_provider_id, p_feeder_id,
    v_hour, p_forecast -> 'evidence', p_forecast -> 'windows'
  )
  on conflict (location_key, generated_hour) do nothing
  returning id into v_id;
  return jsonb_build_object('logged', v_id is not null, 'id', v_id);
end;
$$;

create or replace function public.get_forecast_accuracy(p_location_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_accuracy numeric;
begin
  perform public.evaluate_due_forecasts(p_location_key);
  select count(*), avg(case when hit then 1.0 else 0.0 end)
  into v_count, v_accuracy
  from public.forecast_runs
  where location_key = p_location_key and evaluated_at is not null;
  return jsonb_build_object(
    'evaluated_count', coalesce(v_count, 0),
    'accuracy', case when v_count = 0 then null else round(v_accuracy, 4) end
  );
end;
$$;

create or replace function public.get_map_status()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  with settings as (
    select site_kill_switch, public_message from public.app_settings where singleton = true
  ), active_areas as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'upazilaId', s.upazila_id,
      'slug', u.slug,
      'state', case when s.state = 'out' then 'appears_out' else 'appears_on' end,
      'contributorCount', s.contributor_count,
      'observedAt', s.observed_at,
      'expiresAt', s.expires_at
    ) order by s.observed_at desc), '[]'::jsonb) as value
    from public.live_area_states s
    join public.upazilas u on u.id = s.upazila_id
    where s.precision = 'upazila'
      and s.expires_at > clock_timestamp()
      and not u.disabled
  )
  select jsonb_build_object(
    'generatedAt', clock_timestamp(),
    'halted', settings.site_kill_switch,
    'message', settings.public_message,
    'areas', case when settings.site_kill_switch then '[]'::jsonb else active_areas.value end
  )
  from settings cross join active_areas;
$$;
