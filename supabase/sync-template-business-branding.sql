-- Synchronisiert bestehende Karten-Templates mit dem zentralen Business-Profil.
-- Nicht-destruktiv: Es werden nur Snapshot-Felder aktualisiert, damit alte
-- Templates denselben Firmennamen und dasselbe Firmenlogo wie das Konto nutzen.

with primary_business as (
  select distinct on (owner_id)
    id,
    owner_id,
    name,
    logo_url
  from public.businesses
  order by owner_id, updated_at desc nulls last, created_at desc
)
update public.card_templates as template
set
  business_id = coalesce(template.business_id, business.id),
  business_name = coalesce(nullif(business.name, ''), template.business_name),
  logo_url = coalesce(nullif(business.logo_url, ''), template.logo_url),
  updated_at = now()
from primary_business as business
where (
    template.business_id = business.id
    or (template.business_id is null and business.owner_id = template.owner_id)
  )
  and (
    template.business_id is null
    or (
      nullif(business.name, '') is not null
      and template.business_name is distinct from business.name
    )
    or (
      nullif(business.logo_url, '') is not null
      and template.logo_url is distinct from business.logo_url
    )
  );
