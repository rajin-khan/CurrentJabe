-- Make repeat reporting forgiving while preserving the existing identity,
-- network, reputation, moderation, event, and aggregate safeguards.
--
-- This migration only replaces server-only functions. It does not delete or
-- rewrite existing reports.

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
  v_visitor_limit integer := p_visitor_limit;
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
  if p_visitor_hash is null
    or p_ip_hash is null
    or char_length(p_visitor_hash) < 40
    or char_length(p_ip_hash) < 40
  then
    raise exception using message = 'invalid_identity_hash';
  end if;
  if p_visitor_limit is null
    or p_ip_limit is null
    or p_window is null
    or p_visitor_limit < 1
    or p_ip_limit < 1
    or p_window <= interval '0 seconds'
  then
    raise exception using message = 'invalid_rate_limit';
  end if;

  -- These floors apply only to the two high-frequency community actions and
  -- only at their intended windows. Every other action retains its caller-
  -- supplied limit unchanged.
  if p_action = 'daily_report' and p_window >= interval '1 day' then
    v_visitor_limit := greatest(v_visitor_limit, 48);
  elsif p_action = 'live_status' and p_window >= interval '1 hour' then
    v_visitor_limit := greatest(v_visitor_limit, 60);
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

  if v_visitor_count >= v_visitor_limit or v_ip_count >= p_ip_limit then
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
  v_latest_state text;
  v_latest_observed_at timestamptz;
  v_latest_found boolean := false;
begin
  if p_state is null or p_state not in ('on', 'out') then
    raise exception using message = 'invalid_power_state';
  end if;
  if p_visitor_hash is null
    or p_ip_hash is null
    or char_length(p_visitor_hash) < 40
    or char_length(p_ip_hash) < 40
  then
    raise exception using message = 'invalid_identity_hash';
  end if;
  if p_network_hash is null or char_length(p_network_hash) < 40 then
    raise exception using message = 'invalid_network_hash';
  end if;

  perform public.assert_reporting_open(p_upazila_id, p_provider_id, p_feeder_id);

  -- Serialize this browser and location before checking its latest state. An
  -- exact retry can then return successfully without consuming a rate-limit
  -- event, while a real transition is never mistaken for an older same-state
  -- confirmation.
  perform pg_advisory_xact_lock(
    hashtextextended('live:' || p_visitor_hash || ':' || v_location_key, 0)
  );

  select c.state, c.observed_at
  into v_latest_state, v_latest_observed_at
  from public.status_confirmations c
  where c.visitor_hash = p_visitor_hash
    and c.location_key = v_location_key
    and c.suppressed_at is null
  order by c.observed_at desc, c.id desc
  limit 1;

  v_latest_found := found;
  if v_latest_found
    and v_latest_state = p_state
    and v_latest_observed_at >= v_now - interval '5 minutes'
  then
    v_duplicate := true;

    if p_state = 'out' then
      select e.id
      into v_event_id
      from public.outage_events e
      where e.visitor_hash = p_visitor_hash
        and e.location_key = v_location_key
        and e.source = 'live'
        and e.ended_at is null
        and e.suppressed_at is null
      order by e.started_at desc, e.id desc
      limit 1;
    end if;

    select jsonb_build_object(
      'state', s.state,
      'contributor_count', s.contributor_count,
      'observed_at', s.observed_at,
      'expires_at', s.expires_at,
      'precision', s.precision
    )
    into v_live_state
    from public.live_area_states s
    where s.location_key = v_location_key
      and s.expires_at > v_now;

    return jsonb_build_object(
      'duplicate', true,
      'event_id', v_event_id,
      'live_state', v_live_state
    );
  end if;

  perform public.enforce_rate_limit(
    p_visitor_hash,
    p_ip_hash,
    'live_status',
    60,
    2000,
    interval '1 hour'
  );

  -- Serialize one administrative area's threshold refreshes so the tenth
  -- simultaneous independent report cannot be lost to transaction snapshots.
  perform pg_advisory_xact_lock(hashtextextended('live-area:' || p_upazila_id, 0));
  perform public.close_stale_live_outages(p_upazila_id);

  if p_state = 'out' then
    select e.id
    into v_event_id
    from public.outage_events e
    where e.visitor_hash = p_visitor_hash
      and e.location_key = v_location_key
      and e.source = 'live'
      and e.ended_at is null
      and e.suppressed_at is null
    order by e.started_at desc, e.id desc
    limit 1;

    if v_event_id is null then
      insert into public.outage_events(
        visitor_hash,
        network_hash,
        upazila_id,
        provider_id,
        feeder_id,
        location_key,
        source,
        started_at,
        time_precision
      ) values (
        p_visitor_hash,
        p_network_hash,
        p_upazila_id,
        p_provider_id,
        p_feeder_id,
        v_location_key,
        'live',
        v_now,
        'exact'
      )
      returning id into v_event_id;
    end if;
  else
    update public.outage_events
    set ended_at = greatest(v_now, started_at + interval '1 second'),
        close_reason = 'contributor'
    where id = (
      select e.id
      from public.outage_events e
      where e.visitor_hash = p_visitor_hash
        and e.location_key = v_location_key
        and e.source = 'live'
        and e.ended_at is null
        and e.suppressed_at is null
      order by e.started_at desc, e.id desc
      limit 1
    )
    returning id into v_event_id;
  end if;

  insert into public.status_confirmations(
    visitor_hash,
    network_hash,
    upazila_id,
    provider_id,
    feeder_id,
    location_key,
    state,
    observed_at,
    linked_event_id
  ) values (
    p_visitor_hash,
    p_network_hash,
    p_upazila_id,
    p_provider_id,
    p_feeder_id,
    v_location_key,
    p_state,
    v_now,
    v_event_id
  )
  returning id into v_confirmation_id;

  perform public.update_visitor_reputation(v_confirmation_id);
  perform public.increment_analytics('report_completed', p_visitor_hash, p_upazila_id);

  perform public.refresh_live_area_state('upazila', p_upazila_id, null, null, p_state);
  if p_provider_id is not null then
    perform public.refresh_live_area_state(
      'provider_upazila',
      p_upazila_id,
      p_provider_id,
      null,
      p_state
    );
  end if;
  if p_feeder_id is not null then
    v_live_state := public.refresh_live_area_state(
      'feeder',
      p_upazila_id,
      p_provider_id,
      p_feeder_id,
      p_state
    );
  elsif p_provider_id is not null then
    v_live_state := public.refresh_live_area_state(
      'provider_upazila',
      p_upazila_id,
      p_provider_id,
      null,
      p_state
    );
  else
    v_live_state := public.refresh_live_area_state(
      'upazila',
      p_upazila_id,
      null,
      null,
      p_state
    );
  end if;

  return jsonb_build_object(
    'duplicate', v_duplicate,
    'event_id', v_event_id,
    'live_state', v_live_state
  );
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
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'Asia/Dhaka')::date;
  v_location_key text := public.make_location_key(p_upazila_id, p_provider_id, p_feeder_id);
  v_submission public.daily_submissions%rowtype;
  v_submission_id uuid;
  v_submission_exists boolean := false;
  v_submission_changed boolean := false;
  v_window jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_precision text;
  v_event_id uuid;
  v_open_live_id uuid;
  v_inserted_ids uuid[] := array[]::uuid[];
  v_reused_ids uuid[] := array[]::uuid[];
  v_accepted_ids uuid[] := array[]::uuid[];
  v_existing_ids uuid[] := array[]::uuid[];
  v_skipped integer := 0;
  v_existing_count integer := 0;
  v_final_event_count integer := 0;
  v_final_completed_count integer := 0;
  v_final_remembered_count integer := 0;
  v_window_count integer;
  v_effective_count_known boolean;
  v_effective_outage_count integer;
begin
  if p_visitor_hash is null
    or p_ip_hash is null
    or char_length(p_visitor_hash) < 40
    or char_length(p_ip_hash) < 40
  then
    raise exception using message = 'invalid_identity_hash';
  end if;
  if p_network_hash is null or char_length(p_network_hash) < 40 then
    raise exception using message = 'invalid_network_hash';
  end if;

  perform public.assert_reporting_open(p_upazila_id, p_provider_id, p_feeder_id);

  if p_occurred_on is null or p_occurred_on not in (v_today, v_today - 1) then
    raise exception using message = 'invalid_report_date';
  end if;
  if p_count_known is null then
    raise exception using message = 'invalid_outage_count';
  end if;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' then
    raise exception using message = 'invalid_windows';
  end if;

  v_window_count := jsonb_array_length(p_windows);
  if v_window_count > 24 then
    raise exception using message = 'invalid_windows';
  end if;
  if p_count_known
    and (p_outage_count is null or p_outage_count < 0 or p_outage_count > 24)
  then
    raise exception using message = 'invalid_outage_count';
  end if;
  if not p_count_known and p_outage_count is not null then
    raise exception using message = 'invalid_outage_count';
  end if;

  -- Validate every supplied window before acquiring mutation-rate capacity.
  -- A remembered window may exceed a stale submitted count; the total is
  -- corrected monotonically after the evidence rows are merged.
  for v_window in select value from jsonb_array_elements(p_windows)
  loop
    begin
      v_start := (v_window ->> 'startedAt')::timestamptz;
      v_end := (v_window ->> 'endedAt')::timestamptz;
    exception when others then
      raise exception using message = 'invalid_window_timestamp';
    end;

    v_precision := v_window ->> 'precision';
    if jsonb_typeof(v_window) <> 'object'
      or v_start is null
      or v_end is null
      or v_precision is null
      or v_precision not in ('exact', 'approximate')
      or v_end <= v_start
      or v_end > v_start + interval '24 hours'
      or v_end > v_now + interval '5 minutes'
      or (v_start at time zone 'Asia/Dhaka')::date <> p_occurred_on
    then
      raise exception using message = 'invalid_window';
    end if;
  end loop;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'daily:' || p_visitor_hash || ':' || v_location_key || ':' || p_occurred_on::text,
      0
    )
  );

  select *
  into v_submission
  from public.daily_submissions
  where visitor_hash = p_visitor_hash
    and location_key = v_location_key
    and occurred_on = p_occurred_on
  for update;

  v_submission_exists := found;

  -- Never revive or append evidence to a moderator-suppressed submission.
  if v_submission_exists and v_submission.suppressed_at is not null then
    select coalesce(array_agg(id order by started_at), array[]::uuid[])
    into v_existing_ids
    from public.outage_events
    where visitor_hash = p_visitor_hash
      and location_key = v_location_key
      and suppressed_at is null
      and (started_at at time zone 'Asia/Dhaka')::date = p_occurred_on;

    return jsonb_build_object(
      'submission_id', v_submission.id,
      'duplicate', true,
      'merged', false,
      'suppressed', true,
      'inserted_event_ids', '[]'::jsonb,
      'created_event_ids', '[]'::jsonb,
      'reused_event_ids', '[]'::jsonb,
      'skipped_duplicate_windows', v_window_count,
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

  v_effective_count_known := p_count_known
    or (v_submission_exists and v_submission.count_known);

  if v_effective_count_known then
    v_effective_outage_count := least(
      24,
      greatest(
        case when p_count_known then p_outage_count else 0 end,
        case
          when v_submission_exists and v_submission.count_known
            then v_submission.outage_count
          else 0
        end,
        case
          when v_submission_exists then v_submission.remembered_window_count
          else 0
        end,
        v_existing_count
      )
    );
  else
    v_effective_outage_count := null;
  end if;

  if v_submission_exists then
    v_submission_id := v_submission.id;
  else
    insert into public.daily_submissions(
      visitor_hash,
      upazila_id,
      provider_id,
      feeder_id,
      location_key,
      occurred_on,
      count_known,
      outage_count,
      remembered_window_count
    ) values (
      p_visitor_hash,
      p_upazila_id,
      p_provider_id,
      p_feeder_id,
      v_location_key,
      p_occurred_on,
      v_effective_count_known,
      v_effective_outage_count,
      0
    )
    returning id into v_submission_id;

    v_submission_changed := true;
  end if;

  for v_window in select value from jsonb_array_elements(p_windows)
  loop
    v_start := (v_window ->> 'startedAt')::timestamptz;
    v_end := (v_window ->> 'endedAt')::timestamptz;
    v_precision := v_window ->> 'precision';

    -- The one-tap "current is out" action creates an open live event. If a
    -- later remembered window describes that same outage, reuse its row so the
    -- linked live confirmation keeps its identity while the event immediately
    -- becomes eligible timed evidence.
    v_open_live_id := null;
    select e.id
    into v_open_live_id
    from public.outage_events e
    where e.visitor_hash = p_visitor_hash
      and e.location_key = v_location_key
      and e.source = 'live'
      and e.ended_at is null
      and e.suppressed_at is null
      and tstzrange(
        e.started_at,
        greatest(v_now, e.started_at + interval '1 second'),
        '[)'
      ) && tstzrange(v_start, v_end, '[)')
    order by e.started_at desc, e.id desc
    limit 1
    for update;

    if v_open_live_id is not null then
      if exists (
        select 1
        from public.outage_events e
        where e.id <> v_open_live_id
          and e.visitor_hash = p_visitor_hash
          and e.location_key = v_location_key
          and e.suppressed_at is null
          and tstzrange(
            e.started_at,
            coalesce(e.ended_at, greatest(v_now, e.started_at + interval '1 second')),
            '[)'
          ) && tstzrange(v_start, v_end, '[)')
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      update public.outage_events
      set daily_submission_id = v_submission_id,
          started_at = v_start,
          ended_at = v_end,
          time_precision = v_precision,
          close_reason = 'retrospective'
      where id = v_open_live_id
      returning id into v_event_id;

      v_reused_ids := array_append(v_reused_ids, v_event_id);
      v_accepted_ids := array_append(v_accepted_ids, v_event_id);
      v_submission_changed := true;
      continue;
    end if;

    if exists (
      select 1
      from public.outage_events e
      where e.visitor_hash = p_visitor_hash
        and e.location_key = v_location_key
        and e.suppressed_at is null
        and tstzrange(
          e.started_at,
          coalesce(e.ended_at, greatest(v_now, e.started_at + interval '1 second')),
          '[)'
        ) && tstzrange(v_start, v_end, '[)')
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- The public model intentionally caps remembered daily evidence at 24.
    -- Extra distinct windows are ignored instead of invalidating everything
    -- the visitor already submitted.
    if v_existing_count + coalesce(array_length(v_inserted_ids, 1), 0) >= 24 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.outage_events(
      daily_submission_id,
      visitor_hash,
      network_hash,
      upazila_id,
      provider_id,
      feeder_id,
      location_key,
      source,
      started_at,
      ended_at,
      time_precision,
      close_reason
    ) values (
      v_submission_id,
      p_visitor_hash,
      p_network_hash,
      p_upazila_id,
      p_provider_id,
      p_feeder_id,
      v_location_key,
      'daily',
      v_start,
      v_end,
      v_precision,
      'retrospective'
    )
    returning id into v_event_id;

    v_inserted_ids := array_append(v_inserted_ids, v_event_id);
    v_accepted_ids := array_append(v_accepted_ids, v_event_id);
    v_submission_changed := true;
  end loop;

  select
    count(*),
    count(*) filter (where ended_at is not null)
  into v_final_event_count, v_final_completed_count
  from public.outage_events
  where visitor_hash = p_visitor_hash
    and location_key = v_location_key
    and suppressed_at is null
    and (started_at at time zone 'Asia/Dhaka')::date = p_occurred_on;

  if v_effective_count_known then
    v_effective_outage_count := least(
      24,
      greatest(v_effective_outage_count, v_final_event_count)
    );
  end if;

  v_final_remembered_count := least(
    24,
    greatest(
      case
        when v_submission_exists then v_submission.remembered_window_count
        else 0
      end,
      v_final_completed_count
    )
  );

  if not v_submission_exists
    or v_submission.count_known is distinct from v_effective_count_known
    or v_submission.outage_count is distinct from v_effective_outage_count
    or v_submission.remembered_window_count is distinct from v_final_remembered_count
  then
    update public.daily_submissions
    set count_known = v_effective_count_known,
        outage_count = v_effective_outage_count,
        remembered_window_count = v_final_remembered_count
    where id = v_submission_id;

    v_submission_changed := true;
  end if;

  -- Only actual mutations consume rate-limit capacity. Replaying an exact
  -- report (including overlapping windows) is a successful, free no-op.
  if v_submission_changed then
    perform public.enforce_rate_limit(
      p_visitor_hash,
      p_ip_hash,
      'daily_report',
      48,
      1000,
      interval '1 day'
    );

    insert into public.visitor_reputation(visitor_hash)
    values (p_visitor_hash)
    on conflict do nothing;

    perform public.increment_analytics('report_completed', p_visitor_hash, p_upazila_id);
  end if;

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'duplicate', not v_submission_changed,
    'merged', v_submission_exists and v_submission_changed,
    'inserted_event_ids', to_jsonb(v_accepted_ids),
    'created_event_ids', to_jsonb(v_inserted_ids),
    'reused_event_ids', to_jsonb(v_reused_ids),
    'skipped_duplicate_windows', v_skipped,
    'existing_event_ids', to_jsonb(v_existing_ids),
    'effective_count_known', v_effective_count_known,
    'effective_outage_count', v_effective_outage_count,
    'remembered_window_count', v_final_remembered_count
  );
end;
$$;

revoke execute on function public.enforce_rate_limit(
  text,
  text,
  text,
  integer,
  integer,
  interval
) from public, anon, authenticated;

grant execute on function public.enforce_rate_limit(
  text,
  text,
  text,
  integer,
  integer,
  interval
) to service_role;

revoke execute on function public.api_submit_live_status(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.api_submit_live_status(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

revoke execute on function public.api_submit_daily_report(
  text,
  text,
  text,
  date,
  boolean,
  integer,
  jsonb,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.api_submit_daily_report(
  text,
  text,
  text,
  date,
  boolean,
  integer,
  jsonb,
  text,
  text,
  text
) to service_role;
