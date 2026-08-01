-- Firmenlogo-Varianten: Original und freigestellte Version getrennt erhalten.
-- logo_url/company_logo_path bleiben der aktive, rückwärtskompatible Alias für
-- alle bestehenden Vorschauen, PDFs und Wallet-Provider.

alter table public.businesses
add column if not exists company_logo_original_url text,
add column if not exists company_logo_original_path text,
add column if not exists company_logo_processed_url text,
add column if not exists company_logo_processed_path text,
add column if not exists company_logo_background_mode text not null default 'removed',
add column if not exists company_logo_card_color text;

update public.businesses
set
  company_logo_processed_url = coalesce(company_logo_processed_url, nullif(logo_url, '')),
  company_logo_processed_path = coalesce(company_logo_processed_path, company_logo_path),
  company_logo_background_mode = coalesce(nullif(company_logo_background_mode, ''), 'removed')
where logo_url is not null or company_logo_path is not null;

alter table public.businesses
drop constraint if exists businesses_company_logo_background_mode_check;

alter table public.businesses
add constraint businesses_company_logo_background_mode_check
check (company_logo_background_mode in ('removed', 'original')) not valid;

alter table public.businesses
drop constraint if exists businesses_company_logo_card_color_check;

alter table public.businesses
add constraint businesses_company_logo_card_color_check
check (company_logo_card_color is null or company_logo_card_color ~ '^#[0-9A-Fa-f]{6}$') not valid;

revoke select, insert, update, delete on public.businesses from authenticated;
grant select (
  id, owner_id, name, description, address, location_lat, location_lng, phone,
  website, logo_url, company_logo_path, company_logo_original_url,
  company_logo_original_path, company_logo_processed_url,
  company_logo_processed_path, company_logo_background_mode,
  company_logo_card_color, company_logo_updated_at, created_at, updated_at
) on public.businesses to authenticated;
grant insert (
  owner_id, name, description, address, location_lat, location_lng, phone,
  website, logo_url, company_logo_path, company_logo_original_url,
  company_logo_original_path, company_logo_processed_url,
  company_logo_processed_path, company_logo_background_mode,
  company_logo_card_color, company_logo_updated_at
) on public.businesses to authenticated;
grant update (
  name, description, address, location_lat, location_lng, phone, website,
  logo_url, company_logo_path, company_logo_original_url,
  company_logo_original_path, company_logo_processed_url,
  company_logo_processed_path, company_logo_background_mode,
  company_logo_card_color, company_logo_updated_at
) on public.businesses to authenticated;
