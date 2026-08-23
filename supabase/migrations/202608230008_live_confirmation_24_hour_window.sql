-- Extend live-confirmation aggregation from 30 minutes to 24 hours. The public
-- activation threshold, identity/network/reputation safeguards, and one-hour
-- expiry of an activated live state are intentionally unchanged.

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
  v_aggregation_window interval := interval '24 hours';
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
      and c.observed_at >= v_now - v_aggregation_window
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
    if v_out_count > v_on_count then
      v_candidate := 'out';
    elsif v_on_count > v_out_count then
      v_candidate := 'on';
    elsif coalesce(v_latest_out, '-infinity'::timestamptz)
      >= coalesce(v_latest_on, '-infinity'::timestamptz)
    then
      v_candidate := 'out';
    else
      v_candidate := 'on';
    end if;
  end if;

  if v_candidate = 'out' then
    v_candidate_count := v_out_count;
    v_candidate_observed := v_latest_out;
  elsif v_candidate = 'on' then
    v_candidate_count := v_on_count;
    v_candidate_observed := v_latest_on;
  end if;

  select *
  into v_existing
  from public.live_area_states
  where location_key = v_key
  for update;

  if v_candidate is not null then
    if not found or v_existing.state <> v_candidate or p_trigger_state = v_candidate then
      insert into public.live_area_states(
        location_key,
        precision,
        upazila_id,
        provider_id,
        feeder_id,
        state,
        contributor_count,
        observed_at,
        activated_at,
        expires_at,
        updated_at
      ) values (
        v_key,
        p_precision,
        p_upazila_id,
        p_provider_id,
        p_feeder_id,
        v_candidate,
        v_candidate_count,
        v_candidate_observed,
        v_now,
        v_now + interval '1 hour',
        v_now
      )
      on conflict (location_key) do update set
        state = excluded.state,
        contributor_count = excluded.contributor_count,
        observed_at = excluded.observed_at,
        activated_at = case
          when public.live_area_states.state = excluded.state
            then public.live_area_states.activated_at
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

create or replace function public.get_live_evidence_summary(
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
  v_aggregation_window interval := interval '24 hours';
  v_precision text := case
    when p_feeder_id is not null then 'feeder'
    when p_provider_id is not null then 'provider_upazila'
    else 'upazila'
  end;
  v_on_count integer := 0;
  v_out_count integer := 0;
  v_latest_on timestamptz;
  v_latest_out timestamptz;
  v_leading_state text;
  v_leading_count integer := 0;
  v_latest_at timestamptz;
begin
  perform public.assert_location_scope(p_upazila_id, p_provider_id, p_feeder_id);

  with latest_per_visitor as (
    select distinct on (c.visitor_hash)
      c.id,
      c.visitor_hash,
      c.network_hash,
      c.state,
      c.observed_at
    from public.status_confirmations c
    where c.suppressed_at is null
      and c.observed_at >= v_now - v_aggregation_window
      and c.upazila_id = p_upazila_id
      and (
        (v_precision = 'upazila')
        or (v_precision = 'provider_upazila' and c.provider_id = p_provider_id)
        or (v_precision = 'feeder' and c.feeder_id = p_feeder_id)
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

  if v_on_count > v_out_count then
    v_leading_state := 'on';
    v_leading_count := v_on_count;
  elsif v_out_count > v_on_count then
    v_leading_state := 'out';
    v_leading_count := v_out_count;
  elsif v_on_count > 0 then
    if coalesce(v_latest_out, '-infinity'::timestamptz)
      >= coalesce(v_latest_on, '-infinity'::timestamptz)
    then
      v_leading_state := 'out';
      v_leading_count := v_out_count;
    else
      v_leading_state := 'on';
      v_leading_count := v_on_count;
    end if;
  end if;

  v_latest_at := case
    when v_latest_on is null then v_latest_out
    when v_latest_out is null then v_latest_on
    else greatest(v_latest_on, v_latest_out)
  end;

  return jsonb_build_object(
    'on_count', v_on_count,
    'out_count', v_out_count,
    'leading_state', v_leading_state,
    'leading_count', v_leading_count,
    'latest_at', v_latest_at,
    'precision', v_precision
  );
end;
$$;

revoke execute on function public.refresh_live_area_state(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.refresh_live_area_state(text, text, text, text, text)
  to service_role;

revoke execute on function public.get_live_evidence_summary(text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_live_evidence_summary(text, text, text)
  to service_role;
