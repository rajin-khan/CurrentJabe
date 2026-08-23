-- Approximate orientation features must never look like exact live boundaries.
-- A same-name match against the 2020 ADM3 snapshot is not enough to establish a
-- current metro-thana extent, so demote the legacy one-feature thana rows while
-- preserving their evidence and stable IDs.
update public.upazilas
set
  boundary_ref = null,
  map_coverage = 'approximate',
  map_feature_refs = array['geo-' || id || '-legacy-approximate']::text[],
  updated_at = clock_timestamp()
where location_kind = 'thana'
  and map_coverage = 'exact'
  and boundary_ref = id
  and map_feature_refs = array[id]::text[];

-- Current split units can use their old parent outlines for orientation only.
update public.upazilas as u
set
  name_en = corrected.name_en,
  name_bn = corrected.name_bn,
  boundary_ref = null,
  map_coverage = 'approximate',
  map_feature_refs = array[corrected.feature_id]::text[]
from (
  values
    ('chattogram-fatikchhari', 'Fatikchhari', 'ফটিকছড়ি', 'geo-chattogram-fatikchhari-2020-aggregate'),
    ('cumilla-muradnagar', 'Muradnagar', 'মুরাদনগর', 'geo-cumilla-muradnagar-2020-aggregate'),
    ('dhaka-badda', 'Badda', 'বাড্ডা', 'geo-dhaka-badda-2020-aggregate'),
    ('mymensingh-gafargaon', 'Gafargaon', 'গফরগাঁও', 'geo-mymensingh-gafargaon-2020-aggregate')
) as corrected(id, name_en, name_bn, feature_id)
where u.id = corrected.id;

-- The old ID represented undivided Uttara. Keep all linked production evidence
-- in place, but retire the bucket instead of relabelling it as either current
-- BBS scope without row-level geographic provenance.
update public.upazilas
set
  name_en = 'Uttara (legacy aggregate)',
  name_bn = 'উত্তরা (পুরোনো সমষ্টিগত এলাকা)',
  boundary_ref = null,
  map_coverage = 'approximate',
  map_feature_refs = array['geo-dhaka-uttara-2020-aggregate']::text[],
  disabled = true,
  disable_reason = coalesce(
    nullif(btrim(disable_reason), ''),
    'Retired undivided Uttara scope; historical evidence cannot be assigned to Purba or Pashchim without provenance.'
  ),
  updated_at = clock_timestamp()
where id = 'dhaka-uttara';

-- Location detail pages can still show their own scoped state; the national map
-- projects a state only when the catalog has an exact sourced outline.

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
      and u.map_coverage = 'exact'
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
