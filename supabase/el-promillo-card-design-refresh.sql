-- El Promillo Design-Refresh fuer bestehende und neue Karten.
-- Direkt im Supabase SQL Editor ausfuehrbar.
-- Wirkung:
-- 1. Neue card_templates erhalten standardmaessig das helle Header-Beige und Braun.
-- 2. Bestehende El-Promillo-Templates werden auf diese Farben und das zentrale Business-Branding gezogen.
-- 3. Bestehende Apple-/Google-Wallet-Karten dieser Templates werden fuer ein Wallet-Update queued.
-- Nicht-destruktiv: Karten, Kunden, Stempel, Streaks, Guthaben und Feature-Settings bleiben erhalten.

begin;

alter table public.card_templates
  alter column primary_color set default '#fffaf2',
  alter column text_color set default '#5b3423';

create temp table _el_promillo_refreshed_templates (
  id uuid,
  owner_id uuid,
  business_id uuid,
  card_name text,
  previous_primary_color text,
  previous_text_color text,
  new_primary_color text,
  new_text_color text
) on commit drop;

with target_templates as (
  select
    template.id,
    template.owner_id,
    template.business_id,
    template.card_name,
    template.primary_color as previous_primary_color,
    template.text_color as previous_text_color,
    business.id as resolved_business_id,
    nullif(business.name, '') as resolved_business_name,
    nullif(business.logo_url, '') as resolved_business_logo_url
  from public.card_templates as template
  left join lateral (
    select candidate.*
    from public.businesses as candidate
    where candidate.id = template.business_id
       or (
         template.business_id is null
         and candidate.owner_id = template.owner_id
         and lower(trim(candidate.name)) = 'el promillo'
       )
    order by
      case when candidate.id = template.business_id then 0 else 1 end,
      candidate.updated_at desc nulls last,
      candidate.created_at desc
    limit 1
  ) as business on true
  where lower(trim(coalesce(business.name, template.business_name, ''))) = 'el promillo'
), updated_templates as (
  update public.card_templates as template
  set
    business_id = coalesce(template.business_id, target.resolved_business_id),
    business_name = coalesce(target.resolved_business_name, 'El Promillo'),
    logo_url = coalesce(target.resolved_business_logo_url, template.logo_url),
    primary_color = '#fffaf2',
    text_color = '#5b3423',
    settings = jsonb_strip_nulls(
      coalesce(template.settings, '{}'::jsonb)
      || jsonb_build_object(
        'background', '#fffaf2',
        'primaryColor', '#fffaf2',
        'textColor', '#5b3423',
        'brandRefresh', 'el_promillo_2026_08'
      )
    ),
    updated_at = now()
  from target_templates as target
  where template.id = target.id
  returning
    template.id,
    template.owner_id,
    template.business_id,
    template.card_name,
    target.previous_primary_color,
    target.previous_text_color,
    template.primary_color as new_primary_color,
    template.text_color as new_text_color
)
insert into _el_promillo_refreshed_templates
select * from updated_templates;

create temp table _el_promillo_wallet_jobs (
  id uuid,
  card_instance_id uuid,
  wallet_platform text,
  template_id uuid
) on commit drop;

with queued_jobs as (
  insert into public.wallet_update_queue (
    owner_id,
    business_id,
    card_instance_id,
    wallet_platform,
    update_type,
    payload,
    status,
    next_attempt_at
  )
  select
    card_instance.owner_id,
    card_instance.business_id,
    card_instance.id,
    card_instance.wallet_platform,
    'template_design_refresh',
    jsonb_build_object(
      'source', 'el_promillo_card_design_refresh_sql',
      'reason', 'existing_template_design_refresh',
      'template_id', card_instance.template_id,
      'customer_card_id', card_instance.customer_card_id,
      'primary_color', '#fffaf2',
      'text_color', '#5b3423'
    ),
    'pending',
    now()
  from public.card_instances as card_instance
  join _el_promillo_refreshed_templates as refreshed
    on refreshed.id = card_instance.template_id
  left join public.customer_cards as customer_card
    on customer_card.id = card_instance.customer_card_id
  where card_instance.wallet_platform in ('apple', 'google')
    and card_instance.business_id is not null
    and coalesce(customer_card.status, 'active') = 'active'
    and not exists (
      select 1
      from public.wallet_update_queue as existing_job
      where existing_job.card_instance_id = card_instance.id
        and existing_job.wallet_platform = card_instance.wallet_platform
        and existing_job.update_type = 'template_design_refresh'
        and existing_job.status in ('pending', 'processing')
    )
  returning id, card_instance_id, wallet_platform, (payload->>'template_id')::uuid as template_id
)
insert into _el_promillo_wallet_jobs
select * from queued_jobs;

select
  'templates_refreshed' as metric,
  count(*)::integer as count
from _el_promillo_refreshed_templates
union all
select
  'wallet_update_jobs_created' as metric,
  count(*)::integer as count
from _el_promillo_wallet_jobs;

select
  card_name,
  previous_primary_color,
  previous_text_color,
  new_primary_color,
  new_text_color
from _el_promillo_refreshed_templates
order by card_name;

commit;
