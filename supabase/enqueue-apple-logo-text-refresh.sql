-- El Promillo: Apple Wallet Logozeile erneut anstossen
-- Direkt im Supabase SQL Editor ausführbar.
--
-- Zweck:
-- Nachdem appleWalletProvider.ts den Firmennamen wieder als logoText setzt,
-- reiht diese Migration Apple-only Update-Jobs ein. Dadurch erzeugt
-- process-wallet-update-queue neue .pkpass-Versionen und sendet APNS-Pushs
-- an registrierte Apple-Wallet-Geräte.

begin;

with target_templates as (
  select
    t.id as template_id,
    t.owner_id,
    coalesce(t.business_id, b.id) as business_id
  from public.card_templates as t
  left join public.businesses as b
    on b.owner_id = t.owner_id
   and lower(trim(coalesce(b.name, ''))) = 'el promillo'
  where lower(trim(coalesce(t.business_name, b.name, ''))) = 'el promillo'
),
target_instances as (
  select
    ci.id as card_instance_id,
    ci.owner_id,
    coalesce(ci.business_id, tt.business_id) as business_id
  from public.card_instances as ci
  join target_templates as tt
    on tt.template_id = ci.template_id
  where ci.wallet_platform = 'apple'
    and coalesce(ci.push_enabled, true) = true
),
inserted_jobs as (
  insert into public.wallet_update_queue (
    owner_id,
    business_id,
    card_instance_id,
    wallet_platform,
    update_type,
    payload,
    status,
    scheduled_at
  )
  select
    ti.owner_id,
    ti.business_id,
    ti.card_instance_id,
    'apple',
    'apple_logo_text_refresh',
    jsonb_build_object(
      'source', 'el_promillo_apple_logo_text_refresh',
      'reason', 'restore_business_name_beside_logo',
      'visible_notification', false,
      'queued_at', now()
    ),
    'pending',
    now()
  from target_instances as ti
  where not exists (
    select 1
    from public.wallet_update_queue as q
    where q.card_instance_id = ti.card_instance_id
      and q.wallet_platform = 'apple'
      and q.update_type = 'apple_logo_text_refresh'
      and q.status in ('pending', 'processing')
  )
  returning id
)
select
  (select count(*) from target_instances) as apple_instances_found,
  (select count(*) from inserted_jobs) as apple_update_jobs_created;

commit;
