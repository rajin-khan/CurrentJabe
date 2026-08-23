-- Add the finer-location fields introduced after the original schema was first deployed.
-- This migration is additive and preserves existing reports and location rows.

alter table public.upazilas
  add column if not exists parent_location_id text,
  add column if not exists location_kind text,
  add column if not exists map_coverage text,
  add column if not exists map_feature_refs text[];

update public.upazilas
set
  location_kind = coalesce(location_kind, 'upazila'),
  map_coverage = coalesce(
    map_coverage,
    case when boundary_ref is null then 'district_fallback' else 'exact' end
  ),
  map_feature_refs = coalesce(
    map_feature_refs,
    case
      when boundary_ref is null then '{}'::text[]
      else array[boundary_ref]
    end
  );

alter table public.upazilas
  alter column location_kind set default 'upazila',
  alter column location_kind set not null,
  alter column map_coverage set default 'exact',
  alter column map_coverage set not null,
  alter column map_feature_refs set default '{}',
  alter column map_feature_refs set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.upazilas'::regclass
      and conname = 'upazilas_parent_location_fk'
  ) then
    alter table public.upazilas
      add constraint upazilas_parent_location_fk
      foreign key (parent_location_id)
      references public.upazilas(id)
      on update cascade
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.upazilas'::regclass
      and conname = 'upazilas_location_kind_check'
  ) then
    alter table public.upazilas
      add constraint upazilas_location_kind_check
      check (location_kind in ('upazila', 'thana', 'locality'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.upazilas'::regclass
      and conname = 'upazilas_map_coverage_check'
  ) then
    alter table public.upazilas
      add constraint upazilas_map_coverage_check
      check (map_coverage in ('exact', 'approximate', 'district_fallback'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.upazilas'::regclass
      and conname = 'upazilas_parent_not_self_check'
  ) then
    alter table public.upazilas
      add constraint upazilas_parent_not_self_check
      check (parent_location_id is null or parent_location_id <> id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.upazilas'::regclass
      and conname = 'upazilas_locality_parent_check'
  ) then
    alter table public.upazilas
      add constraint upazilas_locality_parent_check
      check (location_kind <> 'locality' or parent_location_id is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.upazilas'::regclass
      and conname = 'upazilas_map_geometry_check'
  ) then
    alter table public.upazilas
      add constraint upazilas_map_geometry_check
      check (
        (map_coverage = 'exact' and boundary_ref is not null and cardinality(map_feature_refs) = 1)
        or (map_coverage = 'approximate' and boundary_ref is null and cardinality(map_feature_refs) > 0)
        or (map_coverage = 'district_fallback' and boundary_ref is null and cardinality(map_feature_refs) = 0)
      );
  end if;
end
$$;

create index if not exists upazilas_parent_idx
  on public.upazilas(parent_location_id)
  where parent_location_id is not null;
