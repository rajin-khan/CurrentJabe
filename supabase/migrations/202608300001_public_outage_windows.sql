-- Public, privacy-safe outage history for the progressive evidence feed.
-- This is additive: it does not rewrite or delete any production report data.

create or replace function public.get_public_outage_windows(
  p_upazila_id text,
  p_provider_id text default null,
  p_feeder_id text default null,
  p_since timestamptz default (now() - interval '35 days')
) returns table (
  local_start_minute integer,
  local_end_minute integer,
  duration_minutes integer,
  contributor_count integer,
  event_count integer,
  distinct_day_count integer,
  most_recent_date date,
  newest_event_at timestamptz,
  time_precision text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_location_scope(p_upazila_id, p_provider_id, p_feeder_id);
  perform public.close_stale_live_outages(p_upazila_id);

  return query
  with eligible as (
    select
      e.*,
      dense_rank() over (
        partition by e.network_hash, (e.started_at at time zone 'Asia/Dhaka')::date
        order by e.visitor_hash
      ) as network_contributor_rank
    from public.outage_events e
    left join public.daily_submissions d on d.id = e.daily_submission_id
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
  ), bucketed as (
    select
      e.*,
      floor(
        (
          extract(hour from e.started_at at time zone 'Asia/Dhaka') * 60
          + extract(minute from e.started_at at time zone 'Asia/Dhaka')
        ) / 30
      )::integer * 30 as start_bucket,
      greatest(
        30,
        round(extract(epoch from (e.ended_at - e.started_at)) / 1800)::integer * 30
      ) as duration_bucket
    from eligible e
    where e.network_contributor_rank <= 3
  )
  select
    b.start_bucket as local_start_minute,
    (b.start_bucket + b.duration_bucket) % 1440 as local_end_minute,
    b.duration_bucket as duration_minutes,
    count(distinct b.visitor_hash)::integer as contributor_count,
    count(*)::integer as event_count,
    count(distinct (b.started_at at time zone 'Asia/Dhaka')::date)::integer as distinct_day_count,
    max((b.started_at at time zone 'Asia/Dhaka')::date) as most_recent_date,
    max(b.ended_at) as newest_event_at,
    case
      when bool_and(b.time_precision = 'exact') then 'exact'
      when bool_and(b.time_precision = 'approximate') then 'approximate'
      else 'mixed'
    end as time_precision
  from bucketed b
  group by b.start_bucket, b.duration_bucket
  order by
    count(distinct b.visitor_hash) desc,
    b.start_bucket asc,
    max(b.ended_at) desc
  limit 120;
end;
$$;

revoke all on function public.get_public_outage_windows(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_public_outage_windows(text, text, text, timestamptz)
  to service_role;
