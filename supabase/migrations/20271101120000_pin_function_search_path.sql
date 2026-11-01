-- Pin search_path on functions flagged by the Supabase advisor
-- 'function_search_path_mutable' (security check 2026-11-01).
-- Every body below references only pg_catalog built-ins or schema-qualified
-- public.* objects, so search_path = '' keeps behaviour identical.
--
-- Deliberately NOT changed (per-row in hot matching/search paths; SQL functions
-- that are currently inlined, and SET would disable inlining):
--   public.client_property_match(agent_clients, properties)
--   public.client_property_match(agent_clients, properties, text[])
--   public.city_name_key(text)        -- via city_id_for_name inside client_property_match; generated cols
--   public.street_name_key(text)      -- properties.street_key generated col, crm_search/admin_search
--   public.geo_distance_meters(float8, float8, float8, float8) -- per-row in CMA deal pools

alter function public.cities_set_region()                                   set search_path = '';
alter function public.notif_cadence_since_ok(jsonb)                         set search_path = '';
alter function public.notif_cadence_ts(text)                                set search_path = '';
alter function public.point_in_ring(jsonb, double precision, double precision) set search_path = '';
alter function public.property_marketing_fingerprint(public.properties)     set search_path = '';
alter function public.lead_source_channel(text)                             set search_path = '';
alter function public.lead_temperature(numeric, numeric, numeric, numeric)  set search_path = '';
alter function public.customer_spread_minute(text)                          set search_path = '';
