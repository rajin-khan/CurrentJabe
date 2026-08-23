-- Let a visitor add remembered times to an existing daily submission and turn
-- an overlapping open live outage into completed forecast evidence. This only
-- replaces the server-only RPC; it does not rewrite existing report data.

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
  if p_network_hash is null or char_length(p_network_hash) < 40 then
    raise exception using message = 'invalid_network_hash';
  end if;

  perform public.assert_reporting_open(p_upazila_id, p_provider_id, p_feeder_id);
  perform public.enforce_rate_limit(
    p_visitor_hash,
    p_ip_hash,
    'daily_report',
    3,
    1000,
    interval '1 day'
  );

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
  if p_count_known and (p_outage_count is null or p_outage_count < 0 or p_outage_count > 24) then
    raise exception using message = 'invalid_outage_count';
  end if;
  if not p_count_known and p_outage_count is not null then
    raise exception using message = 'invalid_outage_count';
  end if;
  if p_count_known and v_window_count > p_outage_count then
    raise exception using message = 'invalid_outage_count';
  end if;
  if not p_count_known and v_window_count = 0 then
    raise exception using message = 'invalid_windows';
  end if;

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

  if p_count_known and p_outage_count < v_existing_count then
    raise exception using message = 'invalid_outage_count_below_existing';
  end if;

  if p_count_known then
    v_effective_count_known := true;
    v_effective_outage_count := greatest(
      p_outage_count,
      case
        when v_submission_exists and v_submission.count_known then v_submission.outage_count
        else 0
      end
    );
  elsif v_submission_exists and v_submission.count_known then
    v_effective_count_known := true;
    v_effective_outage_count := v_submission.outage_count;
  else
    v_effective_count_known := false;
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
      or v_end > v_now + interval '5 minutes'
      or (v_start at time zone 'Asia/Dhaka')::date <> p_occurred_on
    then
      raise exception using message = 'invalid_window';
    end if;

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
    order by e.started_at desc
    limit 1
    for update;

    if v_open_live_id is not null then
      -- Do not reshape the live event over a second event already representing
      -- the same remembered interval. This retains the existing no-duplicate
      -- evidence guarantee even for anomalous legacy data.
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

  if v_effective_count_known and v_effective_outage_count < v_final_event_count then
    if p_count_known then
      raise exception using message = 'invalid_outage_count_below_windows';
    end if;

    -- A later "I don't remember" merge can add valid evidence without leaving
    -- an older asserted total contradicted by more completed events.
    v_effective_count_known := false;
    v_effective_outage_count := null;
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

  if v_submission_changed then
    insert into public.visitor_reputation(visitor_hash)
    values (p_visitor_hash)
    on conflict do nothing;

    perform public.increment_analytics('report_completed', p_visitor_hash, p_upazila_id);
  end if;

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'duplicate', not v_submission_changed,
    'merged', v_submission_exists and v_submission_changed,
    -- Keep the established response useful to older clients: this contains
    -- every newly accepted timed-evidence row, whether inserted or reused.
    'inserted_event_ids', to_jsonb(v_accepted_ids),
    'created_event_ids', to_jsonb(v_inserted_ids),
    'reused_event_ids', to_jsonb(v_reused_ids),
    'skipped_duplicate_windows', v_skipped,
    'existing_event_ids', to_jsonb(v_existing_ids)
  );
end;
$$;

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
