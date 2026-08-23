-- Expose recent, threshold-qualified confirmation counts without weakening the
-- ten-contributor rule that activates a public live state. This is additive and
-- does not rewrite or delete existing reports.

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
      and c.observed_at >= v_now - interval '30 minutes'
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
    if coalesce(v_latest_out, '-infinity'::timestamptz) >= coalesce(v_latest_on, '-infinity'::timestamptz) then
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

revoke execute on function public.get_live_evidence_summary(text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_live_evidence_summary(text, text, text)
  to service_role;
