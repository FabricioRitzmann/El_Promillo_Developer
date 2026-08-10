select jsonb_build_object(
  'crm_enabled_default_off', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'businesses' and column_name = 'guest_crm_enabled' and column_default = 'false'
  ),
  'crm_profile_table', to_regclass('public.guest_crm_profiles') is not null,
  'social_links_table', to_regclass('public.guest_social_links') is not null,
  'field_definitions_table', to_regclass('public.crm_field_definitions') is not null,
  'field_values_table', to_regclass('public.crm_field_values') is not null,
  'audit_table', to_regclass('public.guest_crm_audit_events') is not null,
  'crm_rls', coalesce((select relrowsecurity from pg_class where oid = 'public.guest_crm_profiles'::regclass), false),
  'social_rls', coalesce((select relrowsecurity from pg_class where oid = 'public.guest_social_links'::regclass), false),
  'values_rls', coalesce((select relrowsecurity from pg_class where oid = 'public.crm_field_values'::regclass), false),
  'browser_write_policies', (
    select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('guest_crm_profiles', 'guest_social_links', 'crm_field_definitions', 'crm_field_values', 'guest_crm_audit_events')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'cross_tenant_triggers', (
    select count(*) from pg_trigger
    where not tgisinternal and tgname in (
      'validate_guest_crm_profiles_tenant', 'validate_guest_social_links_tenant',
      'validate_crm_field_values_tenant', 'validate_guest_crm_audit_tenant', 'validate_crm_field_definitions_tenant'
    )
  ),
  'legacy_cards_without_crm_valid', (
    select count(*) from public.customer_cards card
    left join public.guest_crm_profiles crm on crm.guest_profile_id = card.guest_profile_id
    where crm.guest_profile_id is null
  ) >= 0
) as prompt_8_acceptance;
