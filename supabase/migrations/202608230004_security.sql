-- Defense in depth: browser clients have no direct table or RPC access.
-- Every public request goes through the Next.js server with the isolated
-- Supabase service role. Never expose that key via NEXT_PUBLIC_* variables.

alter table public.districts enable row level security;
alter table public.upazilas enable row level security;
alter table public.providers enable row level security;
alter table public.area_provider_mappings enable row level security;
alter table public.feeders enable row level security;
alter table public.daily_submissions enable row level security;
alter table public.outage_events enable row level security;
alter table public.status_confirmations enable row level security;
alter table public.visitor_reputation enable row level security;
alter table public.live_area_states enable row level security;
alter table public.rate_limit_events enable row level security;
alter table public.analytics_daily enable row level security;
alter table public.analytics_daily_visitors enable row level security;
alter table public.forecast_runs enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_log enable row level security;
alter table public.admin_login_attempts enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

