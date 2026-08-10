select jsonb_build_object(
  'claim_source_column', exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customer_cards'
      and column_name = 'claim_source'
      and is_nullable = 'NO'
      and column_default like '%legacy%'
  ),
  'origin_template_fk', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customer_cards'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (template_id)%REFERENCES card_templates(id)%'
  ),
  'claim_source_constraint', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customer_cards'::regclass
      and conname = 'customer_cards_claim_source_check'
      and pg_get_constraintdef(oid) like '%wallet_share%'
      and pg_get_constraintdef(oid) like '%direct_qr%'
  ),
  'invalid_claim_sources', (
    select count(*)
    from public.customer_cards
    where claim_source not in ('legacy', 'direct_qr', 'wallet_share', 'operator')
  ),
  'templates_without_public_token', (
    select count(*)
    from public.card_templates
    where public_claim_token !~ '^[a-f0-9]{36}$'
  )
) as prompt_7_acceptance;
