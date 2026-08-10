-- El_Promillo
-- Direkt im Supabase SQL Editor ausführbar.
-- Erstellt Betreiberprofile, Businesses, Karten-Templates,
-- individuelle Kundenkarten und einfache Aenderungslogs.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.operator_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  unlock boolean not null default false,
  approved_at timestamptz,
  verification_email_requested_at timestamptz,
  verification_email_sent_at timestamptz,
  verification_email_last_error text,
  verification_email_attempts integer not null default 0,
  verification_email_status text not null default 'not_requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.operator_profiles
add column if not exists approved_at timestamptz,
add column if not exists verification_email_requested_at timestamptz,
add column if not exists verification_email_sent_at timestamptz,
add column if not exists verification_email_last_error text,
add column if not exists verification_email_attempts integer not null default 0,
add column if not exists verification_email_status text not null default 'not_requested';

alter table public.operator_profiles
drop constraint if exists operator_profiles_verification_email_attempts_check;

alter table public.operator_profiles
add constraint operator_profiles_verification_email_attempts_check
check (verification_email_attempts >= 0) not valid;

alter table public.operator_profiles
drop constraint if exists operator_profiles_verification_email_status_check;

alter table public.operator_profiles
add constraint operator_profiles_verification_email_status_check
check (verification_email_status in ('not_requested', 'pending', 'sent', 'failed')) not valid;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  name text not null default '',
  description text,
  address text,
  location_lat numeric,
  location_lng numeric,
  phone text,
  website text,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_one_per_owner unique (owner_id),
  constraint businesses_location_lat_check check (location_lat is null or location_lat between -90 and 90),
  constraint businesses_location_lng_check check (location_lng is null or location_lng between -180 and 180)
);

alter table public.businesses
add column if not exists location_lat numeric,
add column if not exists location_lng numeric;

alter table public.businesses
drop constraint if exists businesses_location_lat_check;

alter table public.businesses
add constraint businesses_location_lat_check
check (location_lat is null or location_lat between -90 and 90) not valid;

alter table public.businesses
drop constraint if exists businesses_location_lng_check;

alter table public.businesses
add constraint businesses_location_lng_check
check (location_lng is null or location_lng between -180 and 180) not valid;

alter table public.businesses
add column if not exists company_logo_path text,
add column if not exists company_logo_updated_at timestamptz;

create table if not exists public.card_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  business_name text not null default '',
  card_name text not null,
  card_type text not null default 'generic'
    check (card_type in ('generic', 'stamp', 'streak', 'vip')),
  template_type text not null default 'generic_card'
    check (template_type in (
      'stamp_card',
      'streak_card',
      'vip_card',
      'balance_card',
      'cloakroom_card',
      'generic_card',
      'event_card',
      'coupon_card',
      'membership_card',
      'club_card'
    )),
  description text,
  primary_color text not null default '#fffaf2',
  text_color text not null default '#5b3423',
  logo_url text,
  reward_text text,
  stamps_required integer not null default 10 check (stamps_required > 0),
  streak_goal integer check (streak_goal is null or streak_goal > 0),
  vip_tier text,
  settings jsonb not null default '{}'::jsonb,
  club_features jsonb not null default '{
    "vip": false,
    "balance": false,
    "cloakroom": false,
    "coupon": false,
    "membership": false
  }'::jsonb,
  club_settings jsonb not null default '{}'::jsonb,
  public_claim_token text not null default encode(gen_random_bytes(18), 'hex'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.card_templates
add column if not exists template_type text;

alter table public.card_templates
add column if not exists public_claim_token text;

update public.card_templates
set public_claim_token = encode(gen_random_bytes(18), 'hex')
where coalesce(public_claim_token, '') = '';

alter table public.card_templates
alter column public_claim_token set default encode(gen_random_bytes(18), 'hex'),
alter column public_claim_token set not null;

alter table public.card_templates
drop constraint if exists card_templates_public_claim_token_format_check;

alter table public.card_templates
add constraint card_templates_public_claim_token_format_check
check (public_claim_token ~ '^[a-f0-9]{36}$') not valid;

update public.card_templates
set template_type = case card_type
  when 'stamp' then 'stamp_card'
  when 'streak' then 'streak_card'
  when 'vip' then 'vip_card'
  else coalesce(template_type, 'generic_card')
end
where template_type is null
   or template_type not in (
    'stamp_card',
    'streak_card',
    'vip_card',
    'balance_card',
    'cloakroom_card',
    'generic_card',
    'event_card',
    'coupon_card',
    'membership_card',
    'club_card'
  );

alter table public.card_templates
alter column template_type set default 'generic_card';

alter table public.card_templates
alter column template_type set not null;

alter table public.card_templates
drop constraint if exists card_templates_template_type_check;

alter table public.card_templates
add constraint card_templates_template_type_check
check (template_type in (
  'stamp_card',
  'streak_card',
  'vip_card',
  'balance_card',
  'cloakroom_card',
  'generic_card',
  'event_card',
  'coupon_card',
  'membership_card',
  'club_card'
));

alter table public.card_templates
add column if not exists club_features jsonb default '{
  "vip": false,
  "balance": false,
  "cloakroom": false,
  "coupon": false,
  "membership": false
}'::jsonb;

alter table public.card_templates
add column if not exists club_settings jsonb default '{}'::jsonb;

update public.card_templates
set
  club_features = coalesce(club_features, '{}'::jsonb) || jsonb_build_object(
    'vip', lower(coalesce(club_features->>'vip', 'false')) = 'true',
    'balance', lower(coalesce(club_features->>'balance', 'false')) = 'true',
    'cloakroom', lower(coalesce(club_features->>'cloakroom', 'false')) = 'true',
    'coupon', lower(coalesce(club_features->>'coupon', 'false')) = 'true',
    'membership', lower(coalesce(club_features->>'membership', 'false')) = 'true'
  ),
  club_settings = coalesce(club_settings, '{}'::jsonb);

update public.card_templates
set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{club_features}', club_features, true)
where template_type = 'club_card';

alter table public.card_templates
alter column club_features set default '{
  "vip": false,
  "balance": false,
  "cloakroom": false,
  "coupon": false,
  "membership": false
}'::jsonb,
alter column club_features set not null,
alter column club_settings set default '{}'::jsonb,
alter column club_settings set not null;

alter table public.card_templates
drop constraint if exists card_templates_club_features_shape_check;

alter table public.card_templates
add constraint card_templates_club_features_shape_check
check (
  jsonb_typeof(club_features) = 'object'
  and jsonb_typeof(club_settings) = 'object'
  and lower(coalesce(club_features->>'vip', 'false')) in ('true', 'false')
  and lower(coalesce(club_features->>'balance', 'false')) in ('true', 'false')
  and lower(coalesce(club_features->>'cloakroom', 'false')) in ('true', 'false')
  and lower(coalesce(club_features->>'coupon', 'false')) in ('true', 'false')
  and lower(coalesce(club_features->>'membership', 'false')) in ('true', 'false')
) not valid;

-- Zentrales, mandantenbezogenes Gastprofil. Eine Wallet-Karte bleibt eine
-- eigene Entitaet und verweist lediglich auf genau ein Profil. Mehrere Karten
-- desselben Businesses duerfen spaeter dasselbe Profil verwenden.
create table if not exists public.guest_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  display_name text,
  external_customer_id uuid,
  gender text,
  age_group text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_profiles_id_business_key unique (id, business_id),
  constraint guest_profiles_gender_check
    check (gender is null or gender in ('male', 'female')),
  constraint guest_profiles_age_group_check
    check (age_group is null or age_group in ('18_plus', '25_plus', '30_plus')),
  constraint guest_profiles_seen_order_check
    check (first_seen_at is null or last_seen_at is null or first_seen_at <= last_seen_at),
  constraint guest_profiles_metadata_shape_check
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 20000)
);

alter table public.guest_profiles
add column if not exists display_name text,
add column if not exists external_customer_id uuid,
add column if not exists gender text,
add column if not exists age_group text,
add column if not exists first_seen_at timestamptz,
add column if not exists last_seen_at timestamptz,
add column if not exists metadata jsonb not null default '{}'::jsonb,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

-- Additive Rollenabbildung fuer Mitarbeitende eines Businesses. Der bestehende
-- Business-Owner bleibt implizit Admin und braucht keinen Membership-Datensatz.
create table if not exists public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.operator_profiles(id) on delete cascade,
  role text not null default 'staff'
    check (role in ('admin', 'manager', 'security', 'staff')),
  active boolean not null default true,
  created_by uuid references public.operator_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_memberships_business_user_key unique (business_id, user_id)
);

-- Hausverbot und Casinosperre bleiben getrennte, interne Restriction-Typen.
-- Aufhebungen werden als Statuswechsel gespeichert; DELETE wird per Trigger
-- vollstaendig blockiert, damit die Historie erhalten bleibt.
create table if not exists public.guest_restrictions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  guest_profile_id uuid not null,
  restriction_type text not null
    check (restriction_type in ('HOUSE_BAN', 'CASINO_BAN')),
  status text not null default 'active'
    check (status in ('active', 'lifted')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  reason text not null,
  internal_note text,
  created_by uuid not null references public.operator_profiles(id) on delete restrict,
  updated_by uuid not null references public.operator_profiles(id) on delete restrict,
  lifted_at timestamptz,
  lifted_by uuid references public.operator_profiles(id) on delete restrict,
  lift_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_restrictions_guest_business_fkey
    foreign key (guest_profile_id, business_id)
    references public.guest_profiles(id, business_id) on delete restrict,
  constraint guest_restrictions_reason_length_check
    check (char_length(btrim(reason)) between 1 and 2000),
  constraint guest_restrictions_note_length_check
    check (internal_note is null or char_length(internal_note) <= 5000),
  constraint guest_restrictions_date_order_check
    check (ends_at is null or ends_at > starts_at),
  constraint guest_restrictions_lift_state_check
    check (
      (status = 'active' and lifted_at is null and lifted_by is null)
      or (status = 'lifted' and lifted_at is not null and lifted_by is not null)
    )
);

create table if not exists public.guest_restriction_events (
  id uuid primary key default gen_random_uuid(),
  restriction_id uuid not null references public.guest_restrictions(id) on delete restrict,
  owner_id uuid not null references public.operator_profiles(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  guest_profile_id uuid not null,
  event_type text not null check (event_type in ('CREATED', 'UPDATED', 'LIFTED')),
  previous_state jsonb,
  new_state jsonb not null,
  reason text,
  performed_by uuid not null references public.operator_profiles(id) on delete restrict,
  performed_at timestamptz not null default now(),
  constraint guest_restriction_events_guest_business_fkey
    foreign key (guest_profile_id, business_id)
    references public.guest_profiles(id, business_id) on delete restrict,
  constraint guest_restriction_events_state_shape_check
    check (
      (previous_state is null or jsonb_typeof(previous_state) = 'object')
      and jsonb_typeof(new_state) = 'object'
    )
);

create table if not exists public.customer_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  template_id uuid not null references public.card_templates(id) on delete cascade,
  guest_profile_id uuid references public.guest_profiles(id) on delete restrict,
  card_instance_number text not null default ('CI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  customer_code text not null unique,
  status text not null default 'active'
    check (status in ('active', 'paused', 'redeemed', 'blocked')),
  stamp_count integer not null default 0 check (stamp_count >= 0),
  streak_count integer not null default 0 check (streak_count >= 0),
  vip_status text,
  pass_serial_number text unique,
  pass_authentication_token text,
  wallet_platform text not null default 'apple'
    check (wallet_platform in ('apple', 'google', 'pdf', 'unknown')),
  wallet_object_id text,
  wallet_serial_number text,
  balance_cents integer not null default 0 check (balance_cents >= 0),
  currency text not null default 'CHF',
  cloakroom_active boolean not null default false,
  cloakroom_started_at timestamptz,
  cloakroom_completed_at timestamptz,
  last_scanned_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  last_claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_cards_card_instance_number_key unique (card_instance_number)
);

drop trigger if exists validate_customer_cards_features on public.customer_cards;

alter table public.customer_cards
add column if not exists card_instance_number text;

alter table public.customer_cards
add column if not exists guest_profile_id uuid references public.guest_profiles(id) on delete restrict;

update public.customer_cards
set card_instance_number = coalesce(
  nullif(card_instance_number, ''),
  nullif(metadata->>'card_instance_number', ''),
  'CI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
)
where card_instance_number is null or card_instance_number = '';

alter table public.customer_cards
alter column card_instance_number set default ('CI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)));

alter table public.customer_cards
alter column card_instance_number set not null;

alter table public.customer_cards
drop constraint if exists customer_cards_card_instance_number_key;

alter table public.customer_cards
add constraint customer_cards_card_instance_number_key unique (card_instance_number);

alter table public.customer_cards
add column if not exists wallet_platform text default 'apple';

alter table public.customer_cards
add column if not exists wallet_object_id text;

alter table public.customer_cards
add column if not exists wallet_serial_number text;

alter table public.customer_cards
add column if not exists pass_authentication_token text;

alter table public.customer_cards
alter column pass_authentication_token set default (
  'apple-' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);

alter table public.customer_cards
add column if not exists balance_cents integer default 0;

alter table public.customer_cards
add column if not exists currency text default 'CHF';

alter table public.customer_cards
add column if not exists cloakroom_active boolean default false;

alter table public.customer_cards
add column if not exists cloakroom_started_at timestamptz;

alter table public.customer_cards
add column if not exists cloakroom_completed_at timestamptz;

alter table public.customer_cards
add column if not exists last_scanned_at timestamptz;

update public.customer_cards
set
  wallet_platform = coalesce(wallet_platform, 'apple'),
  pass_authentication_token = case
    when coalesce(wallet_platform, 'apple') = 'apple' and coalesce(pass_authentication_token, '') = ''
      then 'apple-' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
    else pass_authentication_token
  end,
  balance_cents = greatest(coalesce(balance_cents, (metadata->>'balance_cents')::integer, 0), 0),
  currency = coalesce(nullif(currency, ''), 'CHF'),
  cloakroom_active = coalesce(cloakroom_active, (metadata->>'cloakroom_active')::boolean, false);

alter table public.customer_cards
alter column wallet_platform set default 'apple',
alter column wallet_platform set not null,
alter column balance_cents set default 0,
alter column balance_cents set not null,
alter column currency set default 'CHF',
alter column currency set not null,
alter column cloakroom_active set default false,
alter column cloakroom_active set not null;

alter table public.customer_cards
drop constraint if exists customer_cards_wallet_platform_check;

alter table public.customer_cards
add constraint customer_cards_wallet_platform_check
check (wallet_platform in ('apple', 'google', 'pdf', 'unknown'));

alter table public.customer_cards
drop constraint if exists customer_cards_balance_cents_check;

alter table public.customer_cards
add constraint customer_cards_balance_cents_check
check (balance_cents >= 0);

create table if not exists public.card_instances (
  id uuid primary key default gen_random_uuid(),
  customer_card_id uuid unique references public.customer_cards(id) on delete cascade,
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  template_id uuid not null references public.card_templates(id) on delete cascade,
  customer_id uuid,
  card_instance_number text not null unique,
  wallet_platform text not null default 'apple'
    check (wallet_platform in ('apple', 'google', 'pdf', 'unknown')),
  resolved_emblem_key text,
  resolved_emblem_url text,
  emblem_updated_at timestamptz,
  wallet_object_id text,
  wallet_serial_number text,
  current_streak integer not null default 0 check (current_streak >= 0),
  current_stamps integer not null default 0 check (current_stamps >= 0),
  vip_level text,
  vip_benefits_used jsonb not null default '[]'::jsonb,
  custom_counter integer not null default 0 check (custom_counter >= 0),
  balance_cents integer not null default 0 check (balance_cents >= 0),
  currency text not null default 'CHF',
  cloakroom_active boolean not null default false,
  cloakroom_started_at timestamptz,
  cloakroom_completed_at timestamptz,
  coupon_status text not null default 'unused'
    check (coupon_status in ('unused', 'redeemed', 'expired', 'blocked')),
  coupon_redeemed_at timestamptz,
  membership_number text,
  membership_status text not null default 'active',
  membership_started_at timestamptz,
  membership_expires_at timestamptz,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists validate_card_instances_features on public.card_instances;

alter table public.card_instances
add column if not exists vip_benefits_used jsonb default '[]'::jsonb;

alter table public.card_instances
add column if not exists coupon_status text default 'unused';

alter table public.card_instances
add column if not exists coupon_redeemed_at timestamptz;

alter table public.card_instances
add column if not exists membership_number text;

alter table public.card_instances
add column if not exists membership_status text default 'active';

alter table public.card_instances
add column if not exists membership_started_at timestamptz;

alter table public.card_instances
add column if not exists membership_expires_at timestamptz;

alter table public.card_instances
add column if not exists demographics_collected boolean default false;

alter table public.card_instances
add column if not exists customer_gender text;

alter table public.card_instances
add column if not exists customer_age_group text;

alter table public.card_instances
add column if not exists resolved_emblem_key text;

alter table public.card_instances
add column if not exists resolved_emblem_url text;

alter table public.card_instances
add column if not exists emblem_updated_at timestamptz;

alter table public.card_instances
add column if not exists demographics_collected_at timestamptz;

alter table public.card_instances
add column if not exists demographics_collected_by uuid references auth.users(id) on delete set null;

alter table public.card_instances
add column if not exists first_scanned_at timestamptz;

alter table public.card_instances
add column if not exists scan_count integer default 0;

update public.card_instances
set
  vip_benefits_used = coalesce(vip_benefits_used, '[]'::jsonb),
  coupon_status = coalesce(nullif(coupon_status, ''), 'unused'),
  membership_status = coalesce(nullif(membership_status, ''), 'active'),
  demographics_collected = coalesce(demographics_collected, false),
  resolved_emblem_key = coalesce(
    nullif(resolved_emblem_key, ''),
    case
      when coalesce(demographics_collected, false) and customer_gender = 'male' then 'male_gentleman'
      when coalesce(demographics_collected, false) and customer_gender = 'female' then 'female_lady'
      else 'neutral_couple'
    end
  ),
  scan_count = greatest(coalesce(scan_count, 0), 0);

alter table public.card_instances
alter column vip_benefits_used set default '[]'::jsonb,
alter column vip_benefits_used set not null,
alter column coupon_status set default 'unused',
alter column coupon_status set not null,
alter column membership_status set default 'active',
alter column membership_status set not null,
alter column demographics_collected set default false,
alter column demographics_collected set not null,
alter column scan_count set default 0,
alter column scan_count set not null;

alter table public.card_instances
drop constraint if exists card_instances_coupon_status_check;

alter table public.card_instances
add constraint card_instances_coupon_status_check
check (coupon_status in ('unused', 'redeemed', 'expired', 'blocked'));

alter table public.card_instances
drop constraint if exists card_instances_vip_benefits_used_shape_check;

alter table public.card_instances
add constraint card_instances_vip_benefits_used_shape_check
check (jsonb_typeof(vip_benefits_used) = 'array') not valid;

alter table public.card_instances
drop constraint if exists card_instances_customer_gender_check;

alter table public.card_instances
add constraint card_instances_customer_gender_check
check (customer_gender is null or customer_gender in ('male', 'female')) not valid;

alter table public.card_instances
drop constraint if exists card_instances_customer_age_group_check;

alter table public.card_instances
add constraint card_instances_customer_age_group_check
check (customer_age_group is null or customer_age_group in ('18_plus', '25_plus', '30_plus')) not valid;

alter table public.card_instances
drop constraint if exists card_instances_resolved_emblem_key_check;

alter table public.card_instances
add constraint card_instances_resolved_emblem_key_check
check (resolved_emblem_key is null or resolved_emblem_key in ('neutral_couple', 'male_gentleman', 'female_lady')) not valid;

alter table public.card_instances
drop constraint if exists card_instances_scan_count_check;

alter table public.card_instances
add constraint card_instances_scan_count_check
check (scan_count >= 0) not valid;

create table if not exists public.club_card_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  template_id uuid not null references public.card_templates(id) on delete cascade,
  card_instance_id uuid not null references public.card_instances(id) on delete cascade,
  action_type text not null
    check (action_type in (
      'update_vip_level',
      'redeem_vip_benefit',
      'topup_balance',
      'redeem_balance',
      'adjust_balance',
      'cloakroom_dropoff',
      'cloakroom_pickup',
      'redeem_coupon',
      'check_membership',
      'extend_membership',
      'update_membership_status'
    )),
  feature_type text not null
    check (feature_type in ('vip', 'balance', 'cloakroom', 'coupon', 'membership')),
  old_value jsonb,
  new_value jsonb,
  performed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.balance_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  card_instance_id uuid not null references public.card_instances(id) on delete cascade,
  amount_cents integer not null,
  currency text not null default 'CHF',
  type text not null
    check (type in ('topup', 'redeem', 'refund', 'manual_adjustment')),
  payment_provider text,
  payment_reference text,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.topup_payment_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  customer_card_id uuid not null references public.customer_cards(id) on delete cascade,
  card_instance_id uuid references public.card_instances(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'CHF',
  payment_provider text not null default 'manual',
  provider_session_id text not null unique,
  provider_reference text,
  checkout_url text,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  confirmed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_update_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  template_id uuid references public.card_templates(id) on delete cascade,
  customer_card_id uuid not null references public.customer_cards(id) on delete cascade,
  card_instance_id uuid references public.card_instances(id) on delete set null,
  wallet_platform text not null check (wallet_platform in ('apple', 'google')),
  wallet_serial_number text,
  wallet_object_id text,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  details jsonb not null default '{}'::jsonb,
  last_error text,
  locked_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_device_registrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  template_id uuid references public.card_templates(id) on delete cascade,
  customer_card_id uuid not null references public.customer_cards(id) on delete cascade,
  card_instance_id uuid references public.card_instances(id) on delete set null,
  wallet_platform text not null default 'apple' check (wallet_platform in ('apple', 'google')),
  device_library_identifier text not null,
  pass_type_identifier text not null,
  serial_number text not null,
  push_token text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_device_registrations_unique_device_pass
    unique (device_library_identifier, pass_type_identifier, serial_number)
);

alter table public.card_instances
add column if not exists apple_serial_number text;

alter table public.card_instances
add column if not exists google_object_id text;

alter table public.card_instances
add column if not exists push_enabled boolean default true;

alter table public.card_instances
add column if not exists last_wallet_update_at timestamptz;

alter table public.card_instances
add column if not exists last_notification_at timestamptz;

alter table public.card_instances
add column if not exists notification_count_24h integer default 0;

update public.card_instances ci
set
  apple_serial_number = coalesce(ci.apple_serial_number, c.pass_serial_number, c.wallet_serial_number),
  google_object_id = coalesce(ci.google_object_id, c.wallet_object_id),
  push_enabled = coalesce(ci.push_enabled, true),
  notification_count_24h = greatest(coalesce(ci.notification_count_24h, 0), 0)
from public.customer_cards c
where c.id = ci.customer_card_id;

alter table public.card_instances
alter column push_enabled set default true,
alter column push_enabled set not null,
alter column notification_count_24h set default 0,
alter column notification_count_24h set not null;

alter table public.card_instances
drop constraint if exists card_instances_notification_count_24h_check;

alter table public.card_instances
add constraint card_instances_notification_count_24h_check
check (notification_count_24h >= 0);

create table if not exists public.apple_wallet_devices (
  id uuid primary key default gen_random_uuid(),
  device_library_identifier text not null unique,
  push_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.apple_wallet_registrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  template_id uuid references public.card_templates(id) on delete cascade,
  card_instance_id uuid not null references public.card_instances(id) on delete cascade,
  device_library_identifier text not null references public.apple_wallet_devices(device_library_identifier) on delete cascade,
  pass_type_identifier text not null,
  serial_number text not null,
  authentication_token_hash text not null,
  created_at timestamptz not null default now(),
  constraint apple_wallet_registrations_unique_device_pass
    unique (device_library_identifier, pass_type_identifier, serial_number)
);

create table if not exists public.apple_pass_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  template_id uuid references public.card_templates(id) on delete cascade,
  card_instance_id uuid not null references public.card_instances(id) on delete cascade,
  serial_number text not null,
  pass_type_identifier text not null,
  pass_json jsonb not null,
  assets jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  last_updated_at timestamptz not null default now(),
  constraint apple_pass_versions_card_version_unique unique (card_instance_id, version)
);

create table if not exists public.google_wallet_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  card_instance_id uuid not null references public.card_instances(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  template_id uuid not null references public.card_templates(id) on delete cascade,
  issuer_id text not null,
  class_id text not null,
  object_id text not null unique,
  object_type text not null,
  save_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_wallet_objects
drop constraint if exists google_wallet_objects_object_type_check;

alter table public.google_wallet_objects
add constraint google_wallet_objects_object_type_check
check (object_type in ('genericObject', 'loyaltyObject', 'offerObject', 'eventTicketObject'));

create table if not exists public.samsung_wallet_instances (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  template_id uuid not null references public.card_templates(id) on delete cascade,
  ref_id text not null unique,
  customer_code text not null unique,
  card_id text not null,
  card_type text not null default 'loyalty',
  card_sub_type text not null default 'others',
  country_code text not null default 'CH',
  add_flow text not null default 'data_fetch',
  card_status text not null default 'pending',
  samsung_callback_url text,
  samsung_wallet_id text,
  last_event text,
  last_event_at timestamptz,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.samsung_wallet_instances
drop constraint if exists samsung_wallet_instances_ref_id_format_check;

alter table public.samsung_wallet_instances
add constraint samsung_wallet_instances_ref_id_format_check
check (char_length(ref_id) between 8 and 32 and ref_id ~ '^[A-Za-z0-9_-]+$') not valid;

alter table public.samsung_wallet_instances
drop constraint if exists samsung_wallet_instances_add_flow_check;

alter table public.samsung_wallet_instances
add constraint samsung_wallet_instances_add_flow_check
check (add_flow in ('data_fetch', 'cdata')) not valid;

alter table public.samsung_wallet_instances
drop constraint if exists samsung_wallet_instances_card_status_check;

alter table public.samsung_wallet_instances
add constraint samsung_wallet_instances_card_status_check
check (card_status in ('pending', 'active', 'expired', 'redeemed', 'held', 'deleted', 'cancelled', 'suspended')) not valid;

alter table public.samsung_wallet_instances
drop constraint if exists samsung_wallet_instances_metadata_shape_check;

alter table public.samsung_wallet_instances
add constraint samsung_wallet_instances_metadata_shape_check
check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 20000) not valid;

create table if not exists public.samsung_wallet_events (
  id uuid primary key default gen_random_uuid(),
  samsung_wallet_instance_id uuid references public.samsung_wallet_instances(id) on delete cascade,
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  template_id uuid references public.card_templates(id) on delete cascade,
  ref_id text,
  event_type text not null,
  samsung_request_id text,
  samsung_event text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.samsung_wallet_events
drop constraint if exists samsung_wallet_events_event_type_format_check;

alter table public.samsung_wallet_events
add constraint samsung_wallet_events_event_type_format_check
check (event_type ~ '^[a-z][a-z0-9_]{0,79}$') not valid;

alter table public.samsung_wallet_events
drop constraint if exists samsung_wallet_events_payload_shape_check;

alter table public.samsung_wallet_events
add constraint samsung_wallet_events_payload_shape_check
check (
  jsonb_typeof(request_payload) = 'object'
  and jsonb_typeof(response_payload) = 'object'
  and octet_length(request_payload::text) <= 20000
  and octet_length(response_payload::text) <= 20000
) not valid;

create table if not exists public.wallet_notification_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  template_id uuid references public.card_templates(id) on delete set null,
  name text not null,
  title text not null,
  message text not null,
  target_type text not null default 'template',
  target_filter jsonb not null default '{}'::jsonb,
  trigger_type text not null check (trigger_type in ('recurring', 'location_based')),
  recurrence text not null check (recurrence in ('daily', 'weekly', 'biweekly', 'monthly', 'location_window')),
  weekdays smallint[] not null default array[]::smallint[],
  month_day smallint,
  time_of_day time,
  time_zone text not null default 'Europe/Zurich',
  starts_on date not null default current_date,
  ends_on date,
  active_from_time time,
  active_until_time time,
  location_lat numeric,
  location_lng numeric,
  location_radius_m integer,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  next_run_at timestamptz,
  location_active_until_at timestamptz,
  location_is_active boolean not null default false,
  last_run_at timestamptz,
  last_status text,
  last_result jsonb not null default '{}'::jsonb,
  processing_started_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_notification_rules_name_length check (char_length(trim(name)) between 1 and 120),
  constraint wallet_notification_rules_title_length check (char_length(trim(title)) between 1 and 120),
  constraint wallet_notification_rules_message_length check (char_length(trim(message)) between 1 and 500),
  constraint wallet_notification_rules_target_type_check check (target_type in (
    'all_active', 'template', 'platform_apple', 'platform_google', 'stamp_count', 'streak_count',
    'vip_level', 'balance_range', 'cloakroom_open', 'event', 'coupon_unredeemed', 'membership_status'
  )),
  constraint wallet_notification_rules_weekdays_check check (weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  constraint wallet_notification_rules_month_day_check check (month_day is null or month_day between 1 and 31),
  constraint wallet_notification_rules_date_range_check check (ends_on is null or ends_on >= starts_on),
  constraint wallet_notification_rules_location_check check (
    trigger_type <> 'location_based'
    or (
      location_lat is not null
      and location_lng is not null
      and location_radius_m is not null
      and location_lat between -90 and 90
      and location_lng between -180 and 180
      and location_radius_m between 50 and 100000
      and active_from_time is not null
      and active_until_time is not null
      and cardinality(weekdays) > 0
    )
  ),
  constraint wallet_notification_rules_schedule_check check (
    trigger_type <> 'recurring'
    or (
      time_of_day is not null
      and (recurrence = 'daily' or recurrence = 'monthly' or cardinality(weekdays) > 0)
    )
  )
);

create table if not exists public.wallet_notification_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  template_id uuid references public.card_templates(id) on delete set null,
  notification_rule_id uuid references public.wallet_notification_rules(id) on delete set null,
  title text not null,
  message text not null,
  target_type text not null,
  target_filter jsonb not null default '{}'::jsonb,
  send_type text not null check (send_type in ('now', 'scheduled', 'location_based')),
  scheduled_at timestamptz,
  location_lat numeric,
  location_lng numeric,
  location_radius_m integer,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'sent', 'partially_failed', 'failed', 'cancelled')),
  idempotency_key text,
  created_by uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_notification_campaigns_message_length
    check (char_length(trim(message)) between 1 and 500),
  constraint wallet_notification_campaigns_title_length
    check (char_length(trim(title)) between 1 and 120),
  constraint wallet_notification_campaigns_location_radius_check
    check (location_radius_m is null or location_radius_m between 50 and 100000)
);

alter table public.wallet_notification_campaigns
add column if not exists notification_rule_id uuid references public.wallet_notification_rules(id) on delete set null;

alter table public.wallet_notification_campaigns
drop constraint if exists wallet_notification_campaigns_target_type_check;

alter table public.wallet_notification_campaigns
add constraint wallet_notification_campaigns_target_type_check
check (target_type in (
  'all_active',
  'template',
  'platform_apple',
  'platform_google',
  'stamp_count',
  'streak_count',
  'vip_level',
  'balance_range',
  'cloakroom_open',
  'event',
  'coupon_unredeemed',
  'membership_status'
));

alter table public.wallet_notification_campaigns
drop constraint if exists wallet_notification_campaigns_scheduled_required_check;

alter table public.wallet_notification_campaigns
add constraint wallet_notification_campaigns_scheduled_required_check
check (send_type <> 'scheduled' or scheduled_at is not null);

alter table public.wallet_notification_campaigns
drop constraint if exists wallet_notification_campaigns_location_required_check;

alter table public.wallet_notification_campaigns
add constraint wallet_notification_campaigns_location_required_check
check (
  send_type <> 'location_based'
  or (
    location_lat is not null
    and location_lng is not null
    and location_radius_m is not null
    and location_lat between -90 and 90
    and location_lng between -180 and 180
    and location_radius_m between 50 and 100000
  )
);

create table if not exists public.wallet_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  campaign_id uuid not null references public.wallet_notification_campaigns(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  card_instance_id uuid not null references public.card_instances(id) on delete cascade,
  wallet_platform text not null check (wallet_platform in ('apple', 'google')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'prepared', 'sent', 'failed', 'skipped', 'limited')),
  provider_response jsonb,
  error_code text,
  error_message text,
  processing_started_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint wallet_notification_recipients_unique_campaign_card
    unique (campaign_id, card_instance_id, wallet_platform)
);

alter table public.wallet_notification_recipients
drop constraint if exists wallet_notification_recipients_status_check;

alter table public.wallet_notification_recipients
add constraint wallet_notification_recipients_status_check
check (status in ('pending', 'processing', 'prepared', 'sent', 'failed', 'skipped', 'limited'));

alter table public.wallet_notification_recipients
add column if not exists processing_started_at timestamptz;

create table if not exists public.wallet_push_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  card_instance_id uuid references public.card_instances(id) on delete set null,
  campaign_id uuid references public.wallet_notification_campaigns(id) on delete set null,
  wallet_platform text not null check (wallet_platform in ('apple', 'google', 'system')),
  action text not null,
  status text not null,
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.wallet_push_logs
drop constraint if exists wallet_push_logs_wallet_platform_check;

alter table public.wallet_push_logs
add constraint wallet_push_logs_wallet_platform_check
check (wallet_platform in ('apple', 'google', 'system'));

alter table public.wallet_push_logs
drop constraint if exists wallet_push_logs_action_format_check;

alter table public.wallet_push_logs
add constraint wallet_push_logs_action_format_check
check (action ~ '^[a-z][a-z0-9_]{0,79}$') not valid;

alter table public.wallet_push_logs
drop constraint if exists wallet_push_logs_status_check;

alter table public.wallet_push_logs
add constraint wallet_push_logs_status_check
check (
  status in (
    'processing',
    'pending',
    'queued',
    'sent',
    'partially_failed',
    'failed',
    'skipped',
    'limited',
    'prepared',
    'signed'
  )
) not valid;

alter table public.wallet_push_logs
drop constraint if exists wallet_push_logs_payload_shape_check;

alter table public.wallet_push_logs
add constraint wallet_push_logs_payload_shape_check
check (
  (request_payload is null or (jsonb_typeof(request_payload) = 'object' and octet_length(request_payload::text) <= 20000))
  and (response_payload is null or (jsonb_typeof(response_payload) = 'object' and octet_length(response_payload::text) <= 20000))
  and (error_message is null or length(error_message) <= 2000)
) not valid;

create table if not exists public.wallet_update_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  card_instance_id uuid not null references public.card_instances(id) on delete cascade,
  campaign_id uuid references public.wallet_notification_campaigns(id) on delete set null,
  wallet_platform text not null check (wallet_platform in ('apple', 'google')),
  update_type text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz default now(),
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.wallet_emblem_update_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  card_instance_id uuid not null references public.card_instances(id) on delete cascade,
  customer_card_id uuid references public.customer_cards(id) on delete set null,
  wallet_platform text check (wallet_platform is null or wallet_platform in ('apple', 'google', 'pdf', 'unknown')),
  previous_emblem_key text,
  resolved_emblem_key text not null,
  resolved_emblem_url text,
  reason text not null default 'demographics_scan',
  update_queued boolean not null default false,
  update_error text,
  created_at timestamptz not null default now(),
  constraint wallet_emblem_update_logs_previous_key_check
    check (previous_emblem_key is null or previous_emblem_key in ('neutral_couple', 'male_gentleman', 'female_lady')),
  constraint wallet_emblem_update_logs_resolved_key_check
    check (resolved_emblem_key in ('neutral_couple', 'male_gentleman', 'female_lady')),
  constraint wallet_emblem_update_logs_payload_size_check
    check (
      octet_length(coalesce(resolved_emblem_url, '')::text) <= 2000
      and octet_length(coalesce(update_error, '')::text) <= 2000
    )
);

create table if not exists public.public_edge_rate_limits (
  id uuid primary key default gen_random_uuid(),
  route_key text not null,
  subject_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count >= 0),
  last_request_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_edge_rate_limits_route_key_check
    check (route_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  constraint public_edge_rate_limits_subject_hash_check
    check (subject_hash ~ '^[a-f0-9]{64}$'),
  constraint public_edge_rate_limits_unique_route_subject
    unique (route_key, subject_hash)
);

alter table public.wallet_update_queue
add column if not exists processing_started_at timestamptz;

alter table public.wallet_update_queue
alter column next_attempt_at drop not null;

alter table public.wallet_update_queue
drop constraint if exists wallet_update_queue_update_type_format_check;

alter table public.wallet_update_queue
add constraint wallet_update_queue_update_type_format_check
check (update_type ~ '^[a-z][a-z0-9_]{0,79}$') not valid;

alter table public.wallet_update_queue
drop constraint if exists wallet_update_queue_payload_shape_check;

alter table public.wallet_update_queue
add constraint wallet_update_queue_payload_shape_check
check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 20000) not valid;

drop index if exists public.wallet_notification_campaigns_owner_idempotency_idx;
create unique index if not exists wallet_notification_campaigns_owner_idempotency_idx
on public.wallet_notification_campaigns(owner_id, business_id, idempotency_key)
where idempotency_key is not null;

-- Sicherer Legacy-Backfill: vorhandene customer_id-Gruppen werden nur innerhalb
-- desselben Businesses zusammengefuehrt. Karten ohne bestehende customer_id
-- erhalten jeweils ein eigenes Profil; es werden keine Personen erraten.
drop table if exists pg_temp.guest_profile_backfill_map;
create temporary table guest_profile_backfill_map (
  customer_card_id uuid primary key,
  guest_profile_id uuid not null
);

with unlinked_cards as (
  select
    c.id as customer_card_id,
    c.owner_id,
    c.business_id,
    case
      when ci.customer_id is not null then 'customer:' || ci.customer_id::text
      else 'card:' || c.id::text
    end as tenant_customer_key
  from public.customer_cards c
  left join public.card_instances ci on ci.customer_card_id = c.id
  where c.guest_profile_id is null
    and c.business_id is not null
), guest_group_keys as (
  select
    distinct
    owner_id,
    business_id,
    tenant_customer_key
  from unlinked_cards
), guest_groups as (
  select
    owner_id,
    business_id,
    tenant_customer_key,
    gen_random_uuid() as guest_profile_id
  from guest_group_keys
)
insert into guest_profile_backfill_map (customer_card_id, guest_profile_id)
select cards.customer_card_id, groups.guest_profile_id
from unlinked_cards cards
join guest_groups groups
  on groups.owner_id = cards.owner_id
 and groups.business_id = cards.business_id
 and groups.tenant_customer_key = cards.tenant_customer_key;

insert into public.guest_profiles (
  id,
  owner_id,
  business_id,
  external_customer_id,
  gender,
  age_group,
  first_seen_at,
  last_seen_at,
  metadata,
  created_at,
  updated_at
)
select
  map.guest_profile_id,
  min(c.owner_id::text)::uuid,
  min(c.business_id::text)::uuid,
  case
    when count(distinct ci.customer_id) <= 1 then max(ci.customer_id::text)::uuid
  end,
  case when count(distinct ci.customer_gender) <= 1 then max(ci.customer_gender) end,
  case when count(distinct ci.customer_age_group) <= 1 then max(ci.customer_age_group) end,
  min(coalesce(ci.first_scanned_at, c.created_at)),
  max(coalesce(ci.last_scanned_at, c.last_scanned_at)),
  jsonb_build_object('backfill_source', 'customer_cards'),
  min(c.created_at),
  max(c.updated_at)
from guest_profile_backfill_map map
join public.customer_cards c on c.id = map.customer_card_id
left join public.card_instances ci on ci.customer_card_id = c.id
group by map.guest_profile_id
on conflict (id) do nothing;

update public.customer_cards c
set guest_profile_id = map.guest_profile_id
from guest_profile_backfill_map map
where c.id = map.customer_card_id
  and c.guest_profile_id is null;

drop table if exists pg_temp.guest_profile_backfill_map;

insert into public.card_instances (
  id,
  customer_card_id,
  owner_id,
  business_id,
  template_id,
  card_instance_number,
  wallet_platform,
  wallet_serial_number,
  current_streak,
  current_stamps,
  vip_level,
  balance_cents,
  currency,
  cloakroom_active,
  cloakroom_started_at,
  cloakroom_completed_at,
  last_scanned_at,
  created_at,
  updated_at
)
select
  c.id,
  c.id,
  c.owner_id,
  c.business_id,
  c.template_id,
  c.card_instance_number,
  c.wallet_platform,
  c.pass_serial_number,
  c.streak_count,
  c.stamp_count,
  c.vip_status,
  c.balance_cents,
  c.currency,
  c.cloakroom_active,
  c.cloakroom_started_at,
  c.cloakroom_completed_at,
  c.last_scanned_at,
  c.created_at,
  c.updated_at
from public.customer_cards c
on conflict (id) do nothing;

create table if not exists public.card_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  template_id uuid references public.card_templates(id) on delete cascade,
  customer_card_id uuid references public.customer_cards(id) on delete cascade,
  event_type text not null,
  delta integer,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.card_events
drop constraint if exists card_events_event_type_format_check;

alter table public.card_events
add constraint card_events_event_type_format_check
check (event_type ~ '^[a-z][a-z0-9_-]{0,79}$') not valid;

alter table public.card_events
drop constraint if exists card_events_details_shape_check;

alter table public.card_events
add constraint card_events_details_shape_check
check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 20000) not valid;

create table if not exists public.scan_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.operator_profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  guest_profile_id uuid references public.guest_profiles(id) on delete set null,
  template_id uuid references public.card_templates(id) on delete set null,
  customer_card_id uuid references public.customer_cards(id) on delete set null,
  card_instance_id uuid references public.card_instances(id) on delete set null,
  card_instance_number text,
  template_name text,
  scanned_by uuid references auth.users(id) on delete set null,
  scanned_at timestamptz not null default now(),
  scan_hour integer,
  scan_weekday integer,
  template_type text not null default 'generic_card',
  active_club_features jsonb not null default '{}'::jsonb,
  customer_gender text,
  customer_age_group text,
  is_first_scan boolean not null default false,
  demographics_were_collected boolean not null default false,
  action_type text not null default 'visit',
  action_label text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.scan_events
add column if not exists business_id uuid references public.businesses(id) on delete set null;

alter table public.scan_events
add column if not exists guest_profile_id uuid references public.guest_profiles(id) on delete set null;

alter table public.scan_events
add column if not exists template_id uuid references public.card_templates(id) on delete set null;

alter table public.scan_events
add column if not exists customer_card_id uuid references public.customer_cards(id) on delete set null;

alter table public.scan_events
add column if not exists card_instance_id uuid references public.card_instances(id) on delete set null;

alter table public.scan_events
add column if not exists card_instance_number text;

alter table public.scan_events
add column if not exists template_name text;

alter table public.scan_events
add column if not exists scanned_by uuid references auth.users(id) on delete set null;

alter table public.scan_events
add column if not exists scanned_at timestamptz default now();

alter table public.scan_events
add column if not exists scan_hour integer;

alter table public.scan_events
add column if not exists scan_weekday integer;

alter table public.scan_events
add column if not exists template_type text default 'generic_card';

alter table public.scan_events
add column if not exists active_club_features jsonb default '{}'::jsonb;

alter table public.scan_events
add column if not exists customer_gender text;

alter table public.scan_events
add column if not exists customer_age_group text;

alter table public.scan_events
add column if not exists is_first_scan boolean default false;

alter table public.scan_events
add column if not exists demographics_were_collected boolean default false;

alter table public.scan_events
add column if not exists action_type text default 'visit';

alter table public.scan_events
add column if not exists action_label text;

alter table public.scan_events
add column if not exists details jsonb default '{}'::jsonb;

update public.scan_events
set
  scanned_at = coalesce(scanned_at, created_at, now()),
  template_type = coalesce(nullif(template_type, ''), 'generic_card'),
  active_club_features = coalesce(active_club_features, '{}'::jsonb),
  is_first_scan = coalesce(is_first_scan, false),
  demographics_were_collected = coalesce(demographics_were_collected, false),
  action_type = coalesce(nullif(action_type, ''), 'visit'),
  details = coalesce(details, '{}'::jsonb);

update public.scan_events
set
  scan_hour = extract(hour from scanned_at)::integer,
  scan_weekday = extract(isodow from scanned_at)::integer
where scan_hour is null or scan_weekday is null;

update public.scan_events event
set guest_profile_id = card.guest_profile_id
from public.customer_cards card
where event.customer_card_id = card.id
  and card.guest_profile_id is not null
  and event.guest_profile_id is distinct from card.guest_profile_id;

alter table public.scan_events
alter column scanned_at set default now(),
alter column scanned_at set not null,
alter column template_type set default 'generic_card',
alter column template_type set not null,
alter column active_club_features set default '{}'::jsonb,
alter column active_club_features set not null,
alter column is_first_scan set default false,
alter column is_first_scan set not null,
alter column demographics_were_collected set default false,
alter column demographics_were_collected set not null,
alter column action_type set default 'visit',
alter column action_type set not null,
alter column details set default '{}'::jsonb,
alter column details set not null;

alter table public.scan_events
drop constraint if exists scan_events_scan_hour_check;

alter table public.scan_events
add constraint scan_events_scan_hour_check
check (scan_hour is null or scan_hour between 0 and 23) not valid;

alter table public.scan_events
drop constraint if exists scan_events_scan_weekday_check;

alter table public.scan_events
add constraint scan_events_scan_weekday_check
check (scan_weekday is null or scan_weekday between 1 and 7) not valid;

alter table public.scan_events
drop constraint if exists scan_events_customer_gender_check;

alter table public.scan_events
add constraint scan_events_customer_gender_check
check (customer_gender is null or customer_gender in ('male', 'female')) not valid;

alter table public.scan_events
drop constraint if exists scan_events_customer_age_group_check;

alter table public.scan_events
add constraint scan_events_customer_age_group_check
check (customer_age_group is null or customer_age_group in ('18_plus', '25_plus', '30_plus')) not valid;

alter table public.scan_events
drop constraint if exists scan_events_active_club_features_shape_check;

alter table public.scan_events
add constraint scan_events_active_club_features_shape_check
check (jsonb_typeof(active_club_features) = 'object') not valid;

alter table public.scan_events
drop constraint if exists scan_events_details_shape_check;

alter table public.scan_events
add constraint scan_events_details_shape_check
check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 20000) not valid;

alter table public.club_card_actions
add column if not exists scan_event_id uuid references public.scan_events(id) on delete set null;

alter table public.club_card_actions
add column if not exists customer_gender text;

alter table public.club_card_actions
add column if not exists customer_age_group text;

alter table public.club_card_actions
add column if not exists scanned_at timestamptz;

alter table public.club_card_actions
drop constraint if exists club_card_actions_customer_gender_check;

alter table public.club_card_actions
add constraint club_card_actions_customer_gender_check
check (customer_gender is null or customer_gender in ('male', 'female')) not valid;

alter table public.club_card_actions
drop constraint if exists club_card_actions_customer_age_group_check;

alter table public.club_card_actions
add constraint club_card_actions_customer_age_group_check
check (customer_age_group is null or customer_age_group in ('18_plus', '25_plus', '30_plus')) not valid;

create index if not exists businesses_owner_id_idx on public.businesses(owner_id);
create index if not exists guest_profiles_owner_id_idx on public.guest_profiles(owner_id);
create index if not exists guest_profiles_business_id_idx on public.guest_profiles(business_id);
create index if not exists guest_profiles_last_seen_at_idx on public.guest_profiles(business_id, last_seen_at desc);
create index if not exists business_memberships_user_business_idx on public.business_memberships(user_id, business_id) where active;
create index if not exists guest_restrictions_guest_active_idx on public.guest_restrictions(guest_profile_id, restriction_type, status, starts_at, ends_at);
create index if not exists guest_restrictions_business_created_idx on public.guest_restrictions(business_id, created_at desc);
create index if not exists guest_restriction_events_restriction_idx on public.guest_restriction_events(restriction_id, performed_at desc);
create index if not exists guest_restriction_events_guest_idx on public.guest_restriction_events(guest_profile_id, performed_at desc);
create index if not exists card_templates_owner_id_idx on public.card_templates(owner_id);
create index if not exists card_templates_business_id_idx on public.card_templates(business_id);
create unique index if not exists card_templates_public_claim_token_idx on public.card_templates(public_claim_token);
create index if not exists customer_cards_owner_id_idx on public.customer_cards(owner_id);
create index if not exists customer_cards_template_id_idx on public.customer_cards(template_id);
create index if not exists customer_cards_guest_profile_id_idx on public.customer_cards(guest_profile_id);
create index if not exists customer_cards_customer_code_idx on public.customer_cards(customer_code);
create index if not exists customer_cards_card_instance_number_idx on public.customer_cards(card_instance_number);
create unique index if not exists customer_cards_wallet_object_unique_idx
on public.customer_cards(wallet_platform, wallet_object_id)
where wallet_object_id is not null;

alter table public.customer_cards
drop constraint if exists customer_cards_wallet_object_id_format_check;

alter table public.customer_cards
add constraint customer_cards_wallet_object_id_format_check
check (
  wallet_object_id is null
  or (
    char_length(wallet_object_id) between 1 and 180
    and wallet_object_id ~ '^[A-Za-z0-9._:-]+$'
  )
) not valid;

create index if not exists card_instances_owner_id_idx on public.card_instances(owner_id);
create index if not exists card_instances_business_id_idx on public.card_instances(business_id);
create index if not exists card_instances_template_id_idx on public.card_instances(template_id);
create index if not exists card_instances_customer_card_id_idx on public.card_instances(customer_card_id);
create index if not exists card_instances_card_instance_number_idx on public.card_instances(card_instance_number);
create index if not exists card_instances_apple_serial_number_idx on public.card_instances(apple_serial_number);
create unique index if not exists card_instances_apple_serial_number_unique_idx
on public.card_instances(apple_serial_number)
where apple_serial_number is not null;

alter table public.card_instances
drop constraint if exists card_instances_wallet_object_id_format_check;

alter table public.card_instances
add constraint card_instances_wallet_object_id_format_check
check (
  wallet_object_id is null
  or (
    char_length(wallet_object_id) between 1 and 180
    and wallet_object_id ~ '^[A-Za-z0-9._:-]+$'
  )
) not valid;
create index if not exists card_instances_google_object_id_idx on public.card_instances(google_object_id);
create unique index if not exists card_instances_google_object_id_unique_idx
on public.card_instances(google_object_id)
where google_object_id is not null;
create index if not exists card_instances_notification_idx on public.card_instances(owner_id, business_id, wallet_platform, push_enabled);
create index if not exists card_instances_resolved_emblem_key_idx on public.card_instances(resolved_emblem_key);
create index if not exists club_card_actions_owner_id_idx on public.club_card_actions(owner_id);
create index if not exists club_card_actions_business_id_idx on public.club_card_actions(business_id);
create index if not exists club_card_actions_template_id_idx on public.club_card_actions(template_id);
create index if not exists club_card_actions_card_instance_id_idx on public.club_card_actions(card_instance_id);
create index if not exists club_card_actions_scan_event_id_idx on public.club_card_actions(scan_event_id);
create index if not exists scan_events_owner_id_idx on public.scan_events(owner_id);
create index if not exists scan_events_business_id_idx on public.scan_events(business_id);
create index if not exists scan_events_guest_profile_id_idx on public.scan_events(guest_profile_id, scanned_at desc);
create index if not exists scan_events_template_id_idx on public.scan_events(template_id);
create index if not exists scan_events_customer_card_id_idx on public.scan_events(customer_card_id);
create index if not exists scan_events_card_instance_id_idx on public.scan_events(card_instance_id);
create index if not exists scan_events_scanned_at_idx on public.scan_events(scanned_at desc);
create index if not exists scan_events_template_type_idx on public.scan_events(template_type);
create index if not exists scan_events_gender_age_idx on public.scan_events(customer_gender, customer_age_group);
create index if not exists scan_events_owner_scanned_at_idx on public.scan_events(owner_id, scanned_at desc);
create index if not exists balance_transactions_owner_id_idx on public.balance_transactions(owner_id);
create index if not exists balance_transactions_business_id_idx on public.balance_transactions(business_id);
create index if not exists balance_transactions_card_instance_id_idx on public.balance_transactions(card_instance_id);
create index if not exists topup_payment_sessions_owner_id_idx on public.topup_payment_sessions(owner_id);
create index if not exists topup_payment_sessions_customer_card_id_idx on public.topup_payment_sessions(customer_card_id);
create index if not exists topup_payment_sessions_provider_session_id_idx on public.topup_payment_sessions(provider_session_id);
create index if not exists wallet_update_jobs_owner_id_idx on public.wallet_update_jobs(owner_id);
create index if not exists wallet_update_jobs_status_idx on public.wallet_update_jobs(status, created_at);
create index if not exists wallet_update_jobs_customer_card_id_idx on public.wallet_update_jobs(customer_card_id);
create index if not exists wallet_update_jobs_card_instance_id_idx on public.wallet_update_jobs(card_instance_id);
create index if not exists wallet_device_registrations_owner_id_idx on public.wallet_device_registrations(owner_id);
create index if not exists wallet_device_registrations_customer_card_id_idx on public.wallet_device_registrations(customer_card_id);
create index if not exists wallet_device_registrations_device_idx on public.wallet_device_registrations(device_library_identifier, pass_type_identifier);
create index if not exists wallet_device_registrations_serial_number_idx on public.wallet_device_registrations(serial_number);
create index if not exists card_events_owner_id_idx on public.card_events(owner_id);
create index if not exists card_events_customer_card_id_idx on public.card_events(customer_card_id);
create index if not exists apple_wallet_devices_device_idx on public.apple_wallet_devices(device_library_identifier);
create index if not exists apple_wallet_registrations_owner_id_idx on public.apple_wallet_registrations(owner_id);
create index if not exists apple_wallet_registrations_card_instance_idx on public.apple_wallet_registrations(card_instance_id);
create index if not exists apple_wallet_registrations_device_idx on public.apple_wallet_registrations(device_library_identifier, pass_type_identifier);
create index if not exists apple_pass_versions_owner_id_idx on public.apple_pass_versions(owner_id);
create index if not exists apple_pass_versions_card_instance_idx on public.apple_pass_versions(card_instance_id, version desc);
create index if not exists google_wallet_objects_owner_id_idx on public.google_wallet_objects(owner_id);
create index if not exists google_wallet_objects_card_instance_idx on public.google_wallet_objects(card_instance_id);
create unique index if not exists google_wallet_objects_card_instance_unique_idx on public.google_wallet_objects(card_instance_id);
create index if not exists samsung_wallet_instances_owner_id_idx on public.samsung_wallet_instances(owner_id);
create index if not exists samsung_wallet_instances_business_id_idx on public.samsung_wallet_instances(business_id);
create index if not exists samsung_wallet_instances_template_id_idx on public.samsung_wallet_instances(template_id);
create index if not exists samsung_wallet_instances_card_id_ref_id_idx on public.samsung_wallet_instances(card_id, ref_id);
create index if not exists samsung_wallet_instances_customer_code_idx on public.samsung_wallet_instances(customer_code);
create index if not exists samsung_wallet_events_owner_id_idx on public.samsung_wallet_events(owner_id, created_at desc);
create index if not exists samsung_wallet_events_instance_id_idx on public.samsung_wallet_events(samsung_wallet_instance_id, created_at desc);
create index if not exists samsung_wallet_events_ref_id_idx on public.samsung_wallet_events(ref_id);
create index if not exists wallet_notification_campaigns_owner_id_idx on public.wallet_notification_campaigns(owner_id);
create index if not exists wallet_notification_campaigns_business_id_idx on public.wallet_notification_campaigns(business_id);
create index if not exists wallet_notification_campaigns_status_idx on public.wallet_notification_campaigns(status, scheduled_at);
create index if not exists wallet_notification_campaigns_rule_id_idx on public.wallet_notification_campaigns(notification_rule_id, created_at desc);
create index if not exists wallet_notification_rules_owner_id_idx on public.wallet_notification_rules(owner_id);
create index if not exists wallet_notification_rules_business_id_idx on public.wallet_notification_rules(business_id);
create index if not exists wallet_notification_rules_due_idx on public.wallet_notification_rules(status, next_run_at);
create index if not exists wallet_notification_rules_location_end_idx on public.wallet_notification_rules(status, location_active_until_at)
where location_is_active = true;
create index if not exists wallet_notification_recipients_campaign_id_idx on public.wallet_notification_recipients(campaign_id);
create index if not exists wallet_notification_recipients_card_instance_id_idx on public.wallet_notification_recipients(card_instance_id);
create index if not exists wallet_notification_recipients_processing_idx on public.wallet_notification_recipients(campaign_id, status, processing_started_at);
create index if not exists wallet_push_logs_owner_id_idx on public.wallet_push_logs(owner_id);
create index if not exists wallet_push_logs_campaign_id_idx on public.wallet_push_logs(campaign_id);
drop index if exists public.wallet_push_logs_manual_idempotency_idx;
create unique index if not exists wallet_push_logs_manual_idempotency_idx
on public.wallet_push_logs(owner_id, business_id, card_instance_id, wallet_platform, ((request_payload->>'idempotency_scope')), ((request_payload->>'idempotency_key')))
where campaign_id is null
  and request_payload ? 'idempotency_scope'
  and request_payload ? 'idempotency_key';
create index if not exists wallet_update_queue_owner_id_idx on public.wallet_update_queue(owner_id);
create index if not exists wallet_update_queue_status_idx on public.wallet_update_queue(status, next_attempt_at);
create index if not exists wallet_update_queue_processing_idx on public.wallet_update_queue(owner_id, status, processing_started_at);
create index if not exists wallet_update_queue_card_instance_id_idx on public.wallet_update_queue(card_instance_id);
create index if not exists wallet_emblem_update_logs_owner_id_idx on public.wallet_emblem_update_logs(owner_id, created_at desc);
create index if not exists wallet_emblem_update_logs_card_instance_id_idx on public.wallet_emblem_update_logs(card_instance_id, created_at desc);
create index if not exists public_edge_rate_limits_cleanup_idx on public.public_edge_rate_limits(updated_at);

drop trigger if exists set_operator_profiles_updated_at on public.operator_profiles;
create trigger set_operator_profiles_updated_at
before update on public.operator_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_businesses_updated_at on public.businesses;
create trigger set_businesses_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

drop trigger if exists set_guest_profiles_updated_at on public.guest_profiles;
create trigger set_guest_profiles_updated_at
before update on public.guest_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_business_memberships_updated_at on public.business_memberships;
create trigger set_business_memberships_updated_at
before update on public.business_memberships
for each row execute function public.set_updated_at();

drop trigger if exists set_guest_restrictions_updated_at on public.guest_restrictions;
create trigger set_guest_restrictions_updated_at
before update on public.guest_restrictions
for each row execute function public.set_updated_at();

drop trigger if exists set_card_templates_updated_at on public.card_templates;
create trigger set_card_templates_updated_at
before update on public.card_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_customer_cards_updated_at on public.customer_cards;
create trigger set_customer_cards_updated_at
before update on public.customer_cards
for each row execute function public.set_updated_at();

drop trigger if exists set_card_instances_updated_at on public.card_instances;
create trigger set_card_instances_updated_at
before update on public.card_instances
for each row execute function public.set_updated_at();

drop trigger if exists set_topup_payment_sessions_updated_at on public.topup_payment_sessions;
create trigger set_topup_payment_sessions_updated_at
before update on public.topup_payment_sessions
for each row execute function public.set_updated_at();

drop trigger if exists set_wallet_update_jobs_updated_at on public.wallet_update_jobs;
create trigger set_wallet_update_jobs_updated_at
before update on public.wallet_update_jobs
for each row execute function public.set_updated_at();

drop trigger if exists set_wallet_device_registrations_updated_at on public.wallet_device_registrations;
create trigger set_wallet_device_registrations_updated_at
before update on public.wallet_device_registrations
for each row execute function public.set_updated_at();

drop trigger if exists set_apple_wallet_devices_updated_at on public.apple_wallet_devices;
create trigger set_apple_wallet_devices_updated_at
before update on public.apple_wallet_devices
for each row execute function public.set_updated_at();

drop trigger if exists set_google_wallet_objects_updated_at on public.google_wallet_objects;
create trigger set_google_wallet_objects_updated_at
before update on public.google_wallet_objects
for each row execute function public.set_updated_at();

drop trigger if exists set_samsung_wallet_instances_updated_at on public.samsung_wallet_instances;
create trigger set_samsung_wallet_instances_updated_at
before update on public.samsung_wallet_instances
for each row execute function public.set_updated_at();

drop trigger if exists set_wallet_notification_campaigns_updated_at on public.wallet_notification_campaigns;
create trigger set_wallet_notification_campaigns_updated_at
before update on public.wallet_notification_campaigns
for each row execute function public.set_updated_at();

drop trigger if exists set_wallet_notification_rules_updated_at on public.wallet_notification_rules;
create trigger set_wallet_notification_rules_updated_at
before update on public.wallet_notification_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_public_edge_rate_limits_updated_at on public.public_edge_rate_limits;
create trigger set_public_edge_rate_limits_updated_at
before update on public.public_edge_rate_limits
for each row execute function public.set_updated_at();

create or replace function public.consume_public_edge_rate_limit(
  p_route_key text,
  p_subject_hash text,
  p_limit integer default 80,
  p_window_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_limit integer := greatest(coalesce(p_limit, 80), 1);
  current_window_seconds integer := greatest(coalesce(p_window_seconds, 900), 60);
  current_route text := lower(trim(coalesce(p_route_key, '')));
  current_subject text := lower(trim(coalesce(p_subject_hash, '')));
  now_value timestamptz := now();
  rate_row public.public_edge_rate_limits%rowtype;
  reset_at timestamptz;
begin
  if current_route !~ '^[a-z][a-z0-9_-]{1,79}$' then
    raise exception 'PUBLIC_RATE_LIMIT_ROUTE_INVALID: route_key ist ungültig.';
  end if;

  if current_subject !~ '^[a-f0-9]{64}$' then
    raise exception 'PUBLIC_RATE_LIMIT_SUBJECT_INVALID: subject_hash ist ungültig.';
  end if;

  loop
    select *
      into rate_row
    from public.public_edge_rate_limits
    where route_key = current_route
      and subject_hash = current_subject
    for update;

    if found then
      reset_at := rate_row.window_started_at + make_interval(secs => current_window_seconds);

      if reset_at <= now_value then
        update public.public_edge_rate_limits
        set
          window_started_at = now_value,
          request_count = 1,
          last_request_at = now_value
        where id = rate_row.id;

        return jsonb_build_object(
          'allowed', true,
          'route_key', current_route,
          'limit', current_limit,
          'remaining', greatest(current_limit - 1, 0),
          'request_count', 1,
          'reset_at', now_value + make_interval(secs => current_window_seconds)
        );
      end if;

      if rate_row.request_count >= current_limit then
        update public.public_edge_rate_limits
        set last_request_at = now_value
        where id = rate_row.id;

        return jsonb_build_object(
          'allowed', false,
          'route_key', current_route,
          'limit', current_limit,
          'remaining', 0,
          'request_count', rate_row.request_count,
          'reset_at', reset_at,
          'retry_after_seconds', greatest(ceil(extract(epoch from (reset_at - now_value)))::integer, 1)
        );
      end if;

      update public.public_edge_rate_limits
      set
        request_count = rate_row.request_count + 1,
        last_request_at = now_value
      where id = rate_row.id;

      return jsonb_build_object(
        'allowed', true,
        'route_key', current_route,
        'limit', current_limit,
        'remaining', greatest(current_limit - rate_row.request_count - 1, 0),
        'request_count', rate_row.request_count + 1,
        'reset_at', reset_at
      );
    end if;

    begin
      insert into public.public_edge_rate_limits (
        route_key,
        subject_hash,
        window_started_at,
        request_count,
        last_request_at
      )
      values (
        current_route,
        current_subject,
        now_value,
        1,
        now_value
      );

      return jsonb_build_object(
        'allowed', true,
        'route_key', current_route,
        'limit', current_limit,
        'remaining', greatest(current_limit - 1, 0),
        'request_count', 1,
        'reset_at', now_value + make_interval(secs => current_window_seconds)
      );
    exception
      when unique_violation then
        -- A parallel request created the row. Loop and process it under lock.
    end;
  end loop;
end;
$$;

create or replace function public.validate_business_owner_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and new.owner_id <> auth.uid() then
    raise exception 'BUSINESS_OWNER_FORBIDDEN: Geschäft darf nicht für einen anderen Betreiber geschrieben werden.';
  end if;

  if TG_OP = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'BUSINESS_IMMUTABLE_OWNER: Betreiber des Geschäfts darf nachträglich nicht verändert werden.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_businesses_owner_consistency on public.businesses;
create trigger validate_businesses_owner_consistency
before insert or update on public.businesses
for each row execute function public.validate_business_owner_consistency();

create or replace function public.validate_guest_profile_tenant_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  business_owner_id uuid;
begin
  select owner_id
  into business_owner_id
  from public.businesses
  where id = new.business_id;

  if business_owner_id is null then
    raise exception 'GUEST_BUSINESS_NOT_FOUND: Gastprofil verweist auf ein unbekanntes Business.';
  end if;

  if new.owner_id <> business_owner_id then
    raise exception 'GUEST_TENANT_MISMATCH: Gastprofil und Business gehoeren nicht zum selben Betreiber.';
  end if;

  if TG_OP = 'UPDATE' and (
    new.owner_id is distinct from old.owner_id
    or new.business_id is distinct from old.business_id
  ) then
    raise exception 'GUEST_TENANT_IMMUTABLE: Betreiber und Business eines Gastprofils sind unveraenderlich.';
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  return new;
end;
$$;

drop trigger if exists validate_guest_profiles_tenant_consistency on public.guest_profiles;
create trigger validate_guest_profiles_tenant_consistency
before insert or update on public.guest_profiles
for each row execute function public.validate_guest_profile_tenant_consistency();

create or replace function public.ensure_customer_card_guest_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row record;
begin
  if new.business_id is null then
    if new.guest_profile_id is not null then
      raise exception 'GUEST_BUSINESS_REQUIRED: Eine Karte ohne Business darf keinem Gastprofil zugeordnet werden.';
    end if;

    return new;
  end if;

  if new.guest_profile_id is null then
    insert into public.guest_profiles (
      owner_id,
      business_id,
      first_seen_at,
      last_seen_at,
      metadata,
      created_at,
      updated_at
    )
    values (
      new.owner_id,
      new.business_id,
      null,
      null,
      jsonb_build_object('created_from', 'customer_card'),
      coalesce(new.created_at, now()),
      coalesce(new.updated_at, now())
    )
    returning id into new.guest_profile_id;

    return new;
  end if;

  select id, owner_id, business_id
  into profile_row
  from public.guest_profiles
  where id = new.guest_profile_id;

  if not found then
    raise exception 'GUEST_PROFILE_NOT_FOUND: Zugeordnetes Gastprofil wurde nicht gefunden.';
  end if;

  if profile_row.owner_id <> new.owner_id or profile_row.business_id <> new.business_id then
    raise exception 'GUEST_CARD_TENANT_MISMATCH: Karte und Gastprofil gehoeren nicht zum selben Business.';
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_customer_cards_guest_profile on public.customer_cards;
create trigger ensure_customer_cards_guest_profile
before insert or update of guest_profile_id, owner_id, business_id on public.customer_cards
for each row execute function public.ensure_customer_card_guest_profile();

create or replace function public.attach_guest_profile_to_scan_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  card_row record;
  effective_scanned_at timestamptz;
begin
  if new.customer_card_id is null then
    if new.guest_profile_id is not null then
      raise exception 'SCAN_CARD_REQUIRED_FOR_GUEST: Gastbezogene Scan-Events brauchen eine Kundenkarte.';
    end if;

    return new;
  end if;

  select owner_id, business_id, template_id, guest_profile_id
  into card_row
  from public.customer_cards
  where id = new.customer_card_id;

  if not found then
    raise exception 'SCAN_CARD_NOT_FOUND: Scan-Event verweist auf eine unbekannte Kundenkarte.';
  end if;

  if new.owner_id <> card_row.owner_id
    or new.business_id is distinct from card_row.business_id
    or new.template_id is distinct from card_row.template_id then
    raise exception 'SCAN_TENANT_MISMATCH: Scan-Event und Kundenkarte gehoeren nicht zum selben Tenant/Template.';
  end if;

  if new.guest_profile_id is not null
    and new.guest_profile_id is distinct from card_row.guest_profile_id then
    raise exception 'SCAN_GUEST_MISMATCH: Scan-Event verweist auf ein anderes Gastprofil als die Karte.';
  end if;

  new.guest_profile_id := card_row.guest_profile_id;
  effective_scanned_at := coalesce(new.scanned_at, now());

  if new.guest_profile_id is not null then
    update public.guest_profiles
    set
      first_seen_at = case
        when first_seen_at is null then effective_scanned_at
        else least(first_seen_at, effective_scanned_at)
      end,
      last_seen_at = case
        when last_seen_at is null then effective_scanned_at
        else greatest(last_seen_at, effective_scanned_at)
      end,
      gender = coalesce(gender, new.customer_gender),
      age_group = coalesce(age_group, new.customer_age_group)
    where id = new.guest_profile_id
      and owner_id = new.owner_id
      and business_id = new.business_id;

    if not found then
      raise exception 'SCAN_GUEST_TENANT_MISMATCH: Gastprofil ist fuer den Scan-Tenant nicht zugaenglich.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists attach_scan_events_guest_profile on public.scan_events;
create trigger attach_scan_events_guest_profile
before insert on public.scan_events
for each row execute function public.attach_guest_profile_to_scan_event();

create or replace function public.get_guest_profile_for_scan(p_customer_card_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', guest.id,
    'display_name', guest.display_name,
    'gender', guest.gender,
    'age_group', guest.age_group,
    'first_seen_at', guest.first_seen_at,
    'last_seen_at', guest.last_seen_at,
    'created_at', guest.created_at,
    'updated_at', guest.updated_at,
    'card_count', (
      select count(*)
      from public.customer_cards related_card
      where related_card.guest_profile_id = guest.id
        and related_card.owner_id = card.owner_id
        and related_card.business_id = card.business_id
    ),
    'scan_count', (
      select count(*)
      from public.scan_events event
      where event.guest_profile_id = guest.id
        and event.owner_id = card.owner_id
        and event.business_id = card.business_id
    )
  )
  from public.customer_cards card
  join public.guest_profiles guest
    on guest.id = card.guest_profile_id
   and guest.owner_id = card.owner_id
   and guest.business_id = card.business_id
  where card.id = p_customer_card_id;
$$;

revoke all on function public.get_guest_profile_for_scan(uuid) from public, anon, authenticated;
grant execute on function public.get_guest_profile_for_scan(uuid) to service_role;

create or replace function public.business_role_for_user(p_business_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.businesses business
      where business.id = p_business_id
        and business.owner_id = p_user_id
    ) then 'admin'
    else (
      select membership.role
      from public.business_memberships membership
      where membership.business_id = p_business_id
        and membership.user_id = p_user_id
        and membership.active
      limit 1
    )
  end;
$$;

revoke all on function public.business_role_for_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.business_role_for_user(uuid, uuid) to service_role;

create or replace function public.current_user_business_role(p_business_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.business_role_for_user(p_business_id, auth.uid());
$$;

revoke all on function public.current_user_business_role(uuid) from public, anon;
grant execute on function public.current_user_business_role(uuid) to authenticated;

create or replace function public.get_guest_restrictions_for_scan(p_customer_card_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'guest_profile_id', card.guest_profile_id,
    'active', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', restriction.id,
          'restriction_type', restriction.restriction_type,
          'status', restriction.status,
          'starts_at', restriction.starts_at,
          'ends_at', restriction.ends_at,
          'reason', restriction.reason,
          'internal_note', restriction.internal_note,
          'created_by', restriction.created_by,
          'created_at', restriction.created_at,
          'updated_by', restriction.updated_by,
          'updated_at', restriction.updated_at,
          'is_currently_active', true
        ) order by restriction.restriction_type, restriction.starts_at desc
      )
      from public.guest_restrictions restriction
      where restriction.guest_profile_id = card.guest_profile_id
        and restriction.owner_id = card.owner_id
        and restriction.business_id = card.business_id
        and restriction.status = 'active'
        and restriction.starts_at <= now()
        and (restriction.ends_at is null or restriction.ends_at > now())
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', restriction.id,
          'restriction_type', restriction.restriction_type,
          'status', restriction.status,
          'starts_at', restriction.starts_at,
          'ends_at', restriction.ends_at,
          'reason', restriction.reason,
          'internal_note', restriction.internal_note,
          'created_by', restriction.created_by,
          'created_at', restriction.created_at,
          'updated_by', restriction.updated_by,
          'updated_at', restriction.updated_at,
          'lifted_at', restriction.lifted_at,
          'lifted_by', restriction.lifted_by,
          'lift_reason', restriction.lift_reason,
          'is_currently_active', (
            restriction.status = 'active'
            and restriction.starts_at <= now()
            and (restriction.ends_at is null or restriction.ends_at > now())
          )
        ) order by restriction.created_at desc
      )
      from public.guest_restrictions restriction
      where restriction.guest_profile_id = card.guest_profile_id
        and restriction.owner_id = card.owner_id
        and restriction.business_id = card.business_id
    ), '[]'::jsonb)
  )
  from public.customer_cards card
  where card.id = p_customer_card_id
    and card.business_id is not null
    and card.guest_profile_id is not null;
$$;

revoke all on function public.get_guest_restrictions_for_scan(uuid) from public, anon, authenticated;
grant execute on function public.get_guest_restrictions_for_scan(uuid) to service_role;

create or replace function public.manage_guest_restriction(
  p_customer_card_id uuid,
  p_action text,
  p_actor_id uuid,
  p_restriction_id uuid default null,
  p_restriction_type text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_reason text default null,
  p_internal_note text default null,
  p_lift_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  card_row record;
  restriction_row public.guest_restrictions%rowtype;
  previous_state jsonb;
  next_state jsonb;
  actor_role text;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  normalized_type text := upper(btrim(coalesce(p_restriction_type, '')));
  effective_starts_at timestamptz;
begin
  select id, owner_id, business_id, guest_profile_id
  into card_row
  from public.customer_cards
  where id = p_customer_card_id;

  if not found or card_row.business_id is null or card_row.guest_profile_id is null then
    raise exception 'RESTRICTION_CARD_GUEST_REQUIRED: Karte besitzt kein mandantenfaehiges Gastprofil.';
  end if;

  actor_role := public.business_role_for_user(card_row.business_id, p_actor_id);

  if actor_role is null then
    raise exception 'RESTRICTION_FORBIDDEN: Kein Zugriff auf dieses Business.';
  end if;

  if normalized_action = 'create' then
    if actor_role not in ('admin', 'manager', 'security') then
      raise exception 'RESTRICTION_WRITE_FORBIDDEN: Rolle darf keine Restriktion erfassen.';
    end if;

    if normalized_type not in ('HOUSE_BAN', 'CASINO_BAN') then
      raise exception 'RESTRICTION_TYPE_INVALID: Unbekannter Restriction-Typ.';
    end if;

    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      raise exception 'RESTRICTION_REASON_REQUIRED: Grund fehlt.';
    end if;

    effective_starts_at := coalesce(p_starts_at, now());

    if p_ends_at is not null and p_ends_at <= effective_starts_at then
      raise exception 'RESTRICTION_DATE_INVALID: Enddatum muss nach dem Startdatum liegen.';
    end if;

    if exists (
      select 1
      from public.guest_restrictions existing
      where existing.guest_profile_id = card_row.guest_profile_id
        and existing.business_id = card_row.business_id
        and existing.restriction_type = normalized_type
        and existing.status = 'active'
        and tstzrange(existing.starts_at, existing.ends_at, '[)')
          && tstzrange(effective_starts_at, p_ends_at, '[)')
    ) then
      raise exception 'RESTRICTION_ACTIVE_EXISTS: Fuer diesen Typ existiert bereits ein ueberlappender aktiver Zeitraum.';
    end if;

    insert into public.guest_restrictions (
      owner_id,
      business_id,
      guest_profile_id,
      restriction_type,
      starts_at,
      ends_at,
      reason,
      internal_note,
      created_by,
      updated_by
    ) values (
      card_row.owner_id,
      card_row.business_id,
      card_row.guest_profile_id,
      normalized_type,
      effective_starts_at,
      p_ends_at,
      btrim(p_reason),
      nullif(btrim(coalesce(p_internal_note, '')), ''),
      p_actor_id,
      p_actor_id
    ) returning * into restriction_row;

    next_state := to_jsonb(restriction_row);

    insert into public.guest_restriction_events (
      restriction_id, owner_id, business_id, guest_profile_id, event_type,
      previous_state, new_state, reason, performed_by
    ) values (
      restriction_row.id, card_row.owner_id, card_row.business_id,
      card_row.guest_profile_id, 'CREATED', null, next_state,
      restriction_row.reason, p_actor_id
    );
  elsif normalized_action in ('update', 'lift') then
    if actor_role not in ('admin', 'manager') then
      raise exception 'RESTRICTION_WRITE_FORBIDDEN: Rolle darf Restriktionen nicht aendern oder aufheben.';
    end if;

    select * into restriction_row
    from public.guest_restrictions restriction
    where restriction.id = p_restriction_id
      and restriction.guest_profile_id = card_row.guest_profile_id
      and restriction.owner_id = card_row.owner_id
      and restriction.business_id = card_row.business_id
    for update;

    if not found then
      raise exception 'RESTRICTION_NOT_FOUND: Restriktion wurde nicht gefunden.';
    end if;

    previous_state := to_jsonb(restriction_row);

    if normalized_action = 'update' then
      if restriction_row.status <> 'active' then
        raise exception 'RESTRICTION_ALREADY_LIFTED: Aufgehobene Restriktionen bleiben unveraenderlich.';
      end if;

      effective_starts_at := coalesce(p_starts_at, restriction_row.starts_at);

      if p_ends_at is not null and p_ends_at <= effective_starts_at then
        raise exception 'RESTRICTION_DATE_INVALID: Enddatum muss nach dem Startdatum liegen.';
      end if;

      update public.guest_restrictions
      set
        starts_at = effective_starts_at,
        ends_at = p_ends_at,
        reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), restriction_row.reason),
        internal_note = nullif(btrim(coalesce(p_internal_note, '')), ''),
        updated_by = p_actor_id,
        updated_at = now()
      where id = restriction_row.id
      returning * into restriction_row;

      next_state := to_jsonb(restriction_row);

      insert into public.guest_restriction_events (
        restriction_id, owner_id, business_id, guest_profile_id, event_type,
        previous_state, new_state, reason, performed_by
      ) values (
        restriction_row.id, card_row.owner_id, card_row.business_id,
        card_row.guest_profile_id, 'UPDATED', previous_state, next_state,
        restriction_row.reason, p_actor_id
      );
    else
      if restriction_row.status <> 'active' then
        raise exception 'RESTRICTION_ALREADY_LIFTED: Restriktion wurde bereits aufgehoben.';
      end if;

      if nullif(btrim(coalesce(p_lift_reason, '')), '') is null then
        raise exception 'RESTRICTION_LIFT_REASON_REQUIRED: Aufhebungsgrund fehlt.';
      end if;

      update public.guest_restrictions
      set
        status = 'lifted',
        lifted_at = now(),
        lifted_by = p_actor_id,
        lift_reason = btrim(p_lift_reason),
        updated_by = p_actor_id,
        updated_at = now()
      where id = restriction_row.id
      returning * into restriction_row;

      next_state := to_jsonb(restriction_row);

      insert into public.guest_restriction_events (
        restriction_id, owner_id, business_id, guest_profile_id, event_type,
        previous_state, new_state, reason, performed_by
      ) values (
        restriction_row.id, card_row.owner_id, card_row.business_id,
        card_row.guest_profile_id, 'LIFTED', previous_state, next_state,
        restriction_row.lift_reason, p_actor_id
      );
    end if;
  else
    raise exception 'RESTRICTION_ACTION_INVALID: Aktion muss create, update oder lift sein.';
  end if;

  return public.get_guest_restrictions_for_scan(p_customer_card_id);
end;
$$;

revoke all on function public.manage_guest_restriction(uuid, text, uuid, uuid, text, timestamptz, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.manage_guest_restriction(uuid, text, uuid, uuid, text, timestamptz, timestamptz, text, text, text) to service_role;

create or replace function public.prevent_guest_restriction_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'RESTRICTION_DELETE_FORBIDDEN: Restriktionen und ihre Historie duerfen nicht hart geloescht werden.';
end;
$$;

drop trigger if exists prevent_guest_restrictions_delete on public.guest_restrictions;
create trigger prevent_guest_restrictions_delete
before delete on public.guest_restrictions
for each row execute function public.prevent_guest_restriction_delete();

drop trigger if exists prevent_guest_restriction_events_delete on public.guest_restriction_events;
create trigger prevent_guest_restriction_events_delete
before delete on public.guest_restriction_events
for each row execute function public.prevent_guest_restriction_delete();

create or replace function public.validate_card_template_business_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  business_owner_id uuid;
  normalized_club_features jsonb;
begin
  if auth.uid() is not null and new.owner_id <> auth.uid() then
    raise exception 'TEMPLATE_OWNER_FORBIDDEN: Karten-Template darf nicht für einen anderen Betreiber geschrieben werden.';
  end if;

  if TG_OP = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'TEMPLATE_IMMUTABLE_FIELD: Betreiber des Karten-Templates darf nachträglich nicht verändert werden.';
    end if;

    if old.business_id is not null and new.business_id is distinct from old.business_id then
      raise exception 'TEMPLATE_IMMUTABLE_FIELD: Business des Karten-Templates darf nachträglich nicht umgehängt werden.';
    end if;
  end if;

  if new.business_id is not null then
    select owner_id
    into business_owner_id
    from public.businesses
    where id = new.business_id;

    if business_owner_id is null then
      raise exception 'TEMPLATE_BUSINESS_NOT_FOUND: Karten-Template verweist auf ein unbekanntes Business.';
    end if;

    if new.owner_id <> business_owner_id then
      raise exception 'TEMPLATE_FORBIDDEN: Karten-Template gehört zu einem anderen Betreiber als das Business.';
    end if;
  end if;

  new.settings := coalesce(new.settings, '{}'::jsonb);
  new.club_settings := coalesce(new.club_settings, '{}'::jsonb);
  normalized_club_features := jsonb_build_object(
    'vip', lower(coalesce(new.club_features->>'vip', new.settings->'club_features'->>'vip', 'false')) = 'true',
    'balance', lower(coalesce(new.club_features->>'balance', new.settings->'club_features'->>'balance', 'false')) = 'true',
    'cloakroom', lower(coalesce(new.club_features->>'cloakroom', new.settings->'club_features'->>'cloakroom', 'false')) = 'true',
    'coupon', lower(coalesce(new.club_features->>'coupon', new.settings->'club_features'->>'coupon', 'false')) = 'true',
    'membership', lower(coalesce(new.club_features->>'membership', new.settings->'club_features'->>'membership', 'false')) = 'true'
  );
  new.club_features := normalized_club_features;

  if public.normalize_template_type(new.template_type, new.card_type) = 'club_card' then
    new.settings := jsonb_set(new.settings, '{club_features}', normalized_club_features, true);
  end if;

  return new;
end;
$$;

drop trigger if exists validate_card_templates_business_consistency on public.card_templates;
create trigger validate_card_templates_business_consistency
before insert or update on public.card_templates
for each row execute function public.validate_card_template_business_consistency();

create or replace function public.normalize_template_type(
  p_template_type text,
  p_card_type text default null
)
returns text
language sql
immutable
as $$
  select case
    when p_template_type in (
      'stamp_card',
      'streak_card',
      'vip_card',
      'balance_card',
      'cloakroom_card',
      'generic_card',
      'event_card',
      'coupon_card',
      'membership_card',
      'club_card'
    ) then p_template_type
    when p_card_type = 'stamp' then 'stamp_card'
    when p_card_type = 'streak' then 'streak_card'
    when p_card_type = 'vip' then 'vip_card'
    else 'generic_card'
  end;
$$;

create or replace function public.settings_feature_enabled(
  p_settings jsonb,
  p_feature text
)
returns boolean
language sql
immutable
as $$
  select coalesce((p_settings->'features'->>p_feature)::boolean, false)
    or coalesce((p_settings->>(p_feature || 'Enabled'))::boolean, false)
    or coalesce(p_settings->'enabledFeatures' ? p_feature, false)
    or lower(coalesce(
      p_settings->'club_features'->>case when p_feature = 'redemption' then 'coupon' else p_feature end,
      p_settings->'clubFeatures'->>case when p_feature = 'redemption' then 'coupon' else p_feature end,
      'false'
    )) = 'true';
$$;

create or replace function public.template_feature_allowed(
  p_template_type text,
  p_settings jsonb,
  p_feature text
)
returns boolean
language sql
stable
as $$
  select case p_feature
    when 'stamps' then public.normalize_template_type(p_template_type) = 'stamp_card'
    when 'streak' then public.normalize_template_type(p_template_type) = 'streak_card'
    when 'vip' then public.normalize_template_type(p_template_type) = 'vip_card'
      or (
        public.normalize_template_type(p_template_type) = 'membership_card'
        and public.settings_feature_enabled(coalesce(p_settings, '{}'::jsonb), 'vip')
      )
      or (
        public.normalize_template_type(p_template_type) = 'club_card'
        and public.settings_feature_enabled(coalesce(p_settings, '{}'::jsonb), 'vip')
      )
    when 'balance' then public.normalize_template_type(p_template_type) = 'balance_card'
      or (
        public.normalize_template_type(p_template_type) in ('vip_card', 'generic_card')
        and public.settings_feature_enabled(coalesce(p_settings, '{}'::jsonb), 'balance')
      )
      or (
        public.normalize_template_type(p_template_type) = 'club_card'
        and public.settings_feature_enabled(coalesce(p_settings, '{}'::jsonb), 'balance')
      )
    when 'cloakroom' then public.normalize_template_type(p_template_type) = 'cloakroom_card'
      or (
        public.normalize_template_type(p_template_type) in (
          'stamp_card',
          'streak_card',
          'vip_card',
          'balance_card',
          'generic_card',
          'event_card',
          'coupon_card',
          'membership_card',
          'club_card'
        )
        and public.settings_feature_enabled(coalesce(p_settings, '{}'::jsonb), 'cloakroom')
      )
    when 'checkin' then public.normalize_template_type(p_template_type) = 'event_card'
    when 'redemption' then public.normalize_template_type(p_template_type) = 'coupon_card'
      or (
        public.normalize_template_type(p_template_type) = 'club_card'
        and public.settings_feature_enabled(coalesce(p_settings, '{}'::jsonb), 'redemption')
      )
    when 'membership' then public.normalize_template_type(p_template_type) = 'membership_card'
      or (
        public.normalize_template_type(p_template_type) = 'club_card'
        and public.settings_feature_enabled(coalesce(p_settings, '{}'::jsonb), 'membership')
      )
    when 'qrPdf' then true
    when 'notifications' then coalesce(
      (p_settings->'features'->>'notifications')::boolean,
      (p_settings->>'notificationsEnabled')::boolean,
      true
    )
    when 'customFields' then public.normalize_template_type(p_template_type) in (
      'vip_card',
      'generic_card',
      'event_card',
      'membership_card',
      'club_card'
    )
    when 'visit' then public.normalize_template_type(p_template_type) in (
      'generic_card',
      'vip_card',
      'club_card'
    )
    when 'eventBackgroundImage' then public.normalize_template_type(p_template_type) = 'event_card'
    else false
  end;
$$;

create or replace function public.validate_customer_card_feature_values()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  template_row record;
begin
  select owner_id, business_id, template_type, card_type, settings
  into template_row
  from public.card_templates
  where id = new.template_id;

  if not found then
    raise exception 'Template zur Kundenkarte nicht gefunden.';
  end if;

  if new.owner_id <> template_row.owner_id then
    raise exception 'CARD_FORBIDDEN: Kundenkarte gehört zu einem anderen Betreiber als das Template.';
  end if;

  if new.business_id is distinct from template_row.business_id then
    raise exception 'CARD_FORBIDDEN: Kundenkarte gehört zu einem anderen Business als das Template.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'stamps'
  ) and coalesce(new.stamp_count, 0) <> 0 then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karte unterstützt keine Stempel-Funktion.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'streak'
  ) and coalesce(new.streak_count, 0) <> 0 then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karte unterstützt keine Streak-Funktion.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'vip'
  ) and new.vip_status is not null then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karte unterstützt keine VIP-Funktion.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'balance'
  ) and coalesce(new.balance_cents, 0) <> 0 then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karte unterstützt keine Guthaben-Funktion.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'cloakroom'
  ) and coalesce(new.cloakroom_active, false) then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karte unterstützt keine Garderoben-Funktion.';
  end if;

  return new;
end;
$$;

update public.customer_cards c
set
  stamp_count = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'stamps'
    ) then 0
    else c.stamp_count
  end,
  streak_count = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'streak'
    ) then 0
    else c.streak_count
  end,
  vip_status = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'vip'
    ) then null
    else c.vip_status
  end,
  balance_cents = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'balance'
    ) then 0
    else c.balance_cents
  end,
  cloakroom_active = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'cloakroom'
    ) then false
    else c.cloakroom_active
  end
from public.card_templates t
where t.id = c.template_id
  and (
    (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'stamps'
      )
      and coalesce(c.stamp_count, 0) <> 0
    )
    or (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'streak'
      )
      and coalesce(c.streak_count, 0) <> 0
    )
    or (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'vip'
      )
      and c.vip_status is not null
    )
    or (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'balance'
      )
      and coalesce(c.balance_cents, 0) <> 0
    )
    or (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'cloakroom'
      )
      and coalesce(c.cloakroom_active, false)
    )
  );

drop trigger if exists validate_customer_cards_features on public.customer_cards;
create trigger validate_customer_cards_features
before insert or update on public.customer_cards
for each row execute function public.validate_customer_card_feature_values();

create or replace function public.validate_card_instance_feature_values()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  template_row record;
  customer_card_row record;
begin
  select owner_id, business_id, template_type, card_type, settings
  into template_row
  from public.card_templates
  where id = new.template_id;

  if not found then
    raise exception 'Template zur Karteninstanz nicht gefunden.';
  end if;

  if new.owner_id <> template_row.owner_id then
    raise exception 'CARD_INSTANCE_FORBIDDEN: Karteninstanz gehört zu einem anderen Betreiber als das Template.';
  end if;

  if new.business_id is distinct from template_row.business_id then
    raise exception 'CARD_INSTANCE_FORBIDDEN: Karteninstanz gehört zu einem anderen Business als das Template.';
  end if;

  if new.customer_card_id is not null then
    select owner_id, business_id, template_id
    into customer_card_row
    from public.customer_cards
    where id = new.customer_card_id;

    if not found then
      raise exception 'CARD_INSTANCE_CUSTOMER_CARD_NOT_FOUND: Karteninstanz verweist auf eine unbekannte Kundenkarte.';
    end if;

    if customer_card_row.owner_id <> new.owner_id then
      raise exception 'CARD_INSTANCE_FORBIDDEN: Karteninstanz verweist auf eine fremde Kundenkarte.';
    end if;

    if customer_card_row.business_id is distinct from new.business_id then
      raise exception 'CARD_INSTANCE_FORBIDDEN: Karteninstanz verweist auf ein fremdes Business.';
    end if;

    if customer_card_row.template_id <> new.template_id then
      raise exception 'CARD_INSTANCE_TEMPLATE_MISMATCH: Karteninstanz passt nicht zum Kundenkarten-Template.';
    end if;

    -- customer_id bleibt die bestehende Relation zu customer_profiles. Die
    -- neue Gastzuordnung liegt separat auf customer_cards.guest_profile_id.
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'stamps'
  ) and coalesce(new.current_stamps, 0) <> 0 then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karteninstanz unterstützt keine Stempel-Funktion.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'streak'
  ) and coalesce(new.current_streak, 0) <> 0 then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karteninstanz unterstützt keine Streak-Funktion.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'vip'
  ) and new.vip_level is not null then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karteninstanz unterstützt keine VIP-Funktion.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'vip'
  ) and coalesce(jsonb_array_length(coalesce(new.vip_benefits_used, '[]'::jsonb)), 0) <> 0 then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karteninstanz unterstützt keine VIP-Vorteile.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'balance'
  ) and coalesce(new.balance_cents, 0) <> 0 then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karteninstanz unterstützt keine Guthaben-Funktion.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'cloakroom'
  ) and coalesce(new.cloakroom_active, false) then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karteninstanz unterstützt keine Garderoben-Funktion.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'redemption'
  ) and (
    coalesce(new.coupon_status, 'unused') <> 'unused'
    or new.coupon_redeemed_at is not null
  ) then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karteninstanz unterstützt keine Coupon-Funktion.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'membership'
  ) and (
    new.membership_number is not null
    or coalesce(new.membership_status, 'active') <> 'active'
    or new.membership_started_at is not null
    or new.membership_expires_at is not null
  ) then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karteninstanz unterstützt keine Mitgliedschafts-Funktion.';
  end if;

  return new;
end;
$$;

update public.card_instances ci
set
  current_stamps = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'stamps'
    ) then 0
    else ci.current_stamps
  end,
  current_streak = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'streak'
    ) then 0
    else ci.current_streak
  end,
  vip_level = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'vip'
    ) then null
    else ci.vip_level
  end,
  balance_cents = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'balance'
    ) then 0
    else ci.balance_cents
  end,
  cloakroom_active = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'cloakroom'
    ) then false
    else ci.cloakroom_active
  end,
  vip_benefits_used = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'vip'
    ) then '[]'::jsonb
    else ci.vip_benefits_used
  end,
  coupon_status = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'redemption'
    ) then 'unused'
    else ci.coupon_status
  end,
  coupon_redeemed_at = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'redemption'
    ) then null
    else ci.coupon_redeemed_at
  end,
  membership_number = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'membership'
    ) then null
    else ci.membership_number
  end,
  membership_status = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'membership'
    ) then 'active'
    else ci.membership_status
  end,
  membership_started_at = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'membership'
    ) then null
    else ci.membership_started_at
  end,
  membership_expires_at = case
    when not public.template_feature_allowed(
      public.normalize_template_type(t.template_type, t.card_type),
      coalesce(t.settings, '{}'::jsonb),
      'membership'
    ) then null
    else ci.membership_expires_at
  end
from public.card_templates t
where t.id = ci.template_id
  and (
    (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'stamps'
      )
      and coalesce(ci.current_stamps, 0) <> 0
    )
    or (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'streak'
      )
      and coalesce(ci.current_streak, 0) <> 0
    )
    or (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'vip'
      )
      and ci.vip_level is not null
    )
    or (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'balance'
      )
      and coalesce(ci.balance_cents, 0) <> 0
    )
	    or (
	      not public.template_feature_allowed(
	        public.normalize_template_type(t.template_type, t.card_type),
	        coalesce(t.settings, '{}'::jsonb),
	        'cloakroom'
	      )
	      and coalesce(ci.cloakroom_active, false)
	    )
    or (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'vip'
      )
      and coalesce(jsonb_array_length(coalesce(ci.vip_benefits_used, '[]'::jsonb)), 0) <> 0
    )
    or (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'redemption'
      )
      and (
        coalesce(ci.coupon_status, 'unused') <> 'unused'
        or ci.coupon_redeemed_at is not null
      )
    )
    or (
      not public.template_feature_allowed(
        public.normalize_template_type(t.template_type, t.card_type),
        coalesce(t.settings, '{}'::jsonb),
        'membership'
      )
      and (
        ci.membership_number is not null
        or coalesce(ci.membership_status, 'active') <> 'active'
        or ci.membership_started_at is not null
        or ci.membership_expires_at is not null
      )
    )
	  );

drop trigger if exists validate_card_instances_features on public.card_instances;
create trigger validate_card_instances_features
before insert or update on public.card_instances
for each row execute function public.validate_card_instance_feature_values();

create or replace function public.validate_club_card_action_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  instance_row record;
  required_feature text;
begin
  if auth.uid() is not null and new.performed_by is not null and new.performed_by <> auth.uid() then
    raise exception 'CLUB_ACTION_PERFORMED_BY_FORBIDDEN: Clubkarten-Aktion darf nicht für einen anderen User geschrieben werden.';
  end if;

  select
    ci.owner_id,
    ci.business_id,
    ci.template_id,
    t.template_type,
    t.card_type,
    t.settings
  into instance_row
  from public.card_instances ci
  join public.card_templates t on t.id = ci.template_id
  where ci.id = new.card_instance_id;

  if not found then
    raise exception 'CARD_INSTANCE_NOT_FOUND: Clubkarten-Aktion verweist auf eine unbekannte Karteninstanz.';
  end if;

  if new.owner_id <> instance_row.owner_id then
    raise exception 'CLUB_ACTION_FORBIDDEN: Clubkarten-Aktion gehört zu einem anderen Betreiber.';
  end if;

  if new.business_id is distinct from instance_row.business_id then
    raise exception 'CLUB_ACTION_FORBIDDEN: Clubkarten-Aktion gehört zu einem anderen Business.';
  end if;

  if new.template_id <> instance_row.template_id then
    raise exception 'CLUB_ACTION_TEMPLATE_MISMATCH: Clubkarten-Aktion passt nicht zum Template der Karteninstanz.';
  end if;

  if public.normalize_template_type(instance_row.template_type, instance_row.card_type) <> 'club_card' then
    raise exception 'CLUB_ACTION_TEMPLATE_REQUIRED: Clubkarten-Aktionen sind nur für Clubkarten erlaubt.';
  end if;

  required_feature := case new.feature_type
    when 'coupon' then 'redemption'
    else new.feature_type
  end;

  if not public.template_feature_allowed(
    public.normalize_template_type(instance_row.template_type, instance_row.card_type),
    coalesce(instance_row.settings, '{}'::jsonb),
    required_feature
  ) then
    raise exception 'FEATURE_NOT_ENABLED: Diese Funktion ist für diese Clubkarte nicht aktiviert.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_club_card_actions_consistency on public.club_card_actions;
create trigger validate_club_card_actions_consistency
before insert or update on public.club_card_actions
for each row execute function public.validate_club_card_action_consistency();

create or replace function public.validate_balance_transaction_feature_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  template_row record;
begin
  select ci.owner_id, ci.business_id, t.template_type, t.card_type, t.settings
  into template_row
  from public.card_instances ci
  join public.card_templates t on t.id = ci.template_id
  where ci.id = new.card_instance_id;

  if not found then
    raise exception 'Karteninstanz zur Guthaben-Transaktion nicht gefunden.';
  end if;

  if new.owner_id <> template_row.owner_id then
    raise exception 'CARD_FORBIDDEN: Guthaben-Transaktion gehört zu einem anderen Betreiber.';
  end if;

  if new.business_id is distinct from template_row.business_id then
    raise exception 'CARD_FORBIDDEN: Guthaben-Transaktion gehört zu einem anderen Business.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'balance'
  ) then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karte unterstützt keine Guthaben-Transaktionen.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_balance_transactions_features on public.balance_transactions;
create trigger validate_balance_transactions_features
before insert or update on public.balance_transactions
for each row execute function public.validate_balance_transaction_feature_allowed();

create or replace function public.validate_topup_payment_session_feature_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  template_row record;
begin
  select c.owner_id, c.business_id, t.template_type, t.card_type, t.settings
  into template_row
  from public.customer_cards c
  join public.card_templates t on t.id = c.template_id
  where c.id = new.customer_card_id;

  if not found then
    raise exception 'Kundenkarte zur Topup-Session nicht gefunden.';
  end if;

  if new.owner_id <> template_row.owner_id then
    raise exception 'CARD_FORBIDDEN: Topup-Session gehört zu einem anderen Betreiber.';
  end if;

  if new.business_id is distinct from template_row.business_id then
    raise exception 'CARD_FORBIDDEN: Topup-Session gehört zu einem anderen Business.';
  end if;

  if new.card_instance_id is not null and not exists (
    select 1
    from public.card_instances ci
    where ci.id = new.card_instance_id
      and ci.customer_card_id = new.customer_card_id
      and ci.owner_id = new.owner_id
  ) then
    raise exception 'CARD_FORBIDDEN: Topup-Session verweist auf eine fremde Karteninstanz.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    'balance'
  ) then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karte unterstützt keine Guthaben-Aufladung.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_topup_payment_sessions_features on public.topup_payment_sessions;
create trigger validate_topup_payment_sessions_features
before insert or update on public.topup_payment_sessions
for each row execute function public.validate_topup_payment_session_feature_allowed();

create or replace function public.validate_wallet_device_registration_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  card_row record;
begin
  select
    c.id as customer_card_id,
    c.owner_id,
    c.business_id,
    c.template_id,
    c.pass_serial_number,
    c.wallet_platform,
    c.wallet_object_id,
    c.wallet_serial_number,
    ci.id as card_instance_id
  into card_row
  from public.customer_cards c
  left join public.card_instances ci on ci.customer_card_id = c.id
  where c.id = new.customer_card_id
  order by ci.created_at desc nulls last
  limit 1;

  if not found then
    raise exception 'CARD_NOT_FOUND: Wallet-Registrierung verweist auf eine unbekannte Kundenkarte.';
  end if;

  if new.owner_id <> card_row.owner_id then
    raise exception 'CARD_FORBIDDEN: Wallet-Registrierung gehört zu einem anderen Betreiber.';
  end if;

  if new.business_id is distinct from card_row.business_id then
    raise exception 'CARD_FORBIDDEN: Wallet-Registrierung gehört zu einem anderen Business.';
  end if;

  if new.template_id is distinct from card_row.template_id then
    raise exception 'CARD_FORBIDDEN: Wallet-Registrierung verweist auf ein anderes Template.';
  end if;

  if new.card_instance_id is not null and new.card_instance_id is distinct from card_row.card_instance_id then
    raise exception 'CARD_FORBIDDEN: Wallet-Registrierung verweist auf eine andere Karteninstanz.';
  end if;

  if new.wallet_platform <> 'apple' then
    raise exception 'WALLET_PLATFORM_NOT_SUPPORTED: Device-Registrierungen sind im MVP nur für Apple Wallet aktiv.';
  end if;

  if coalesce(new.serial_number, '') <> coalesce(card_row.pass_serial_number, card_row.wallet_serial_number, '') then
    raise exception 'WALLET_SERIAL_MISMATCH: Wallet-Registrierung passt nicht zur Karten-Seriennummer.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_wallet_device_registrations_consistency on public.wallet_device_registrations;
create trigger validate_wallet_device_registrations_consistency
before insert or update on public.wallet_device_registrations
for each row execute function public.validate_wallet_device_registration_consistency();

create or replace function public.validate_wallet_campaign_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  business_owner_id uuid;
  template_row record;
  required_feature text;
  filter_key text;
  min_filter text;
  max_filter text;
  min_cents_filter text;
  max_cents_filter text;
  from_filter text;
  to_filter text;
  min_numeric numeric;
  max_numeric numeric;
  min_cents_numeric numeric;
  max_cents_numeric numeric;
  from_timestamp timestamptz;
  to_timestamp timestamptz;
begin
  if new.created_by is distinct from new.owner_id then
    raise exception 'CAMPAIGN_FORBIDDEN: Wallet-Kampagne muss vom Betreiber selbst erstellt werden.';
  end if;

  if char_length(coalesce(new.idempotency_key, '')) > 200 then
    raise exception 'CAMPAIGN_IDEMPOTENCY_KEY_TOO_LONG: Idempotency-Key darf maximal 200 Zeichen enthalten.';
  end if;

  if TG_OP = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id
      or new.business_id is distinct from old.business_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.idempotency_key is distinct from old.idempotency_key then
      raise exception 'CAMPAIGN_IMMUTABLE_FIELD: Betreiber, Business, Ersteller, Erstellzeit und Idempotency-Key dürfen nachträglich nicht verändert werden.';
    end if;
  end if;

  select owner_id
  into business_owner_id
  from public.businesses
  where id = new.business_id;

  if business_owner_id is null then
    raise exception 'BUSINESS_NOT_FOUND: Wallet-Kampagne verweist auf ein unbekanntes Business.';
  end if;

  if new.owner_id <> business_owner_id then
    raise exception 'CAMPAIGN_FORBIDDEN: Wallet-Kampagne gehört zu einem anderen Betreiber als das Business.';
  end if;

  if jsonb_typeof(coalesce(new.target_filter, '{}'::jsonb)) <> 'object' then
    raise exception 'CAMPAIGN_TARGET_FILTER_INVALID: target_filter muss ein JSON-Objekt sein.';
  end if;

  if char_length(coalesce(new.target_filter::text, '{}')) > 2000 then
    raise exception 'CAMPAIGN_TARGET_FILTER_TOO_LARGE: target_filter darf maximal 2000 Zeichen enthalten.';
  end if;

  for filter_key in select jsonb_object_keys(coalesce(new.target_filter, '{}'::jsonb))
  loop
    if filter_key not in (
      'activeFrom',
      'active_from',
      'activeUntil',
      'active_until',
      'createdAfter',
      'created_after',
      'createdBefore',
      'created_before'
    ) then
      if new.target_type in ('stamp_count', 'streak_count') then
        if filter_key not in ('min', 'max') then
          raise exception 'CAMPAIGN_TARGET_FILTER_FIELD_FORBIDDEN: target_filter Feld ist für diese Zielgruppe nicht erlaubt.';
        end if;
      elsif new.target_type = 'balance_range' then
        if filter_key not in ('minCents', 'min_cents', 'maxCents', 'max_cents') then
          raise exception 'CAMPAIGN_TARGET_FILTER_FIELD_FORBIDDEN: target_filter Feld ist für diese Zielgruppe nicht erlaubt.';
        end if;
      elsif new.target_type = 'vip_level' then
        if filter_key not in ('vipLevel', 'vip_level') then
          raise exception 'CAMPAIGN_TARGET_FILTER_FIELD_FORBIDDEN: target_filter Feld ist für diese Zielgruppe nicht erlaubt.';
        end if;
      elsif new.target_type = 'membership_status' then
        if filter_key not in ('membershipStatus', 'membership_status', 'status') then
          raise exception 'CAMPAIGN_TARGET_FILTER_FIELD_FORBIDDEN: target_filter Feld ist für diese Zielgruppe nicht erlaubt.';
        end if;
      elsif new.target_type = 'event' then
        if filter_key not in ('eventId', 'event_id', 'eventName', 'event_name') then
          raise exception 'CAMPAIGN_TARGET_FILTER_FIELD_FORBIDDEN: target_filter Feld ist für diese Zielgruppe nicht erlaubt.';
        end if;
      else
        raise exception 'CAMPAIGN_TARGET_FILTER_FIELD_FORBIDDEN: target_filter Feld ist für diese Zielgruppe nicht erlaubt.';
      end if;
    end if;
  end loop;

  min_filter := nullif(new.target_filter->>'min', '');
  max_filter := nullif(new.target_filter->>'max', '');
  min_cents_filter := nullif(coalesce(new.target_filter->>'minCents', new.target_filter->>'min_cents'), '');
  max_cents_filter := nullif(coalesce(new.target_filter->>'maxCents', new.target_filter->>'max_cents'), '');
  from_filter := nullif(coalesce(
    new.target_filter->>'activeFrom',
    new.target_filter->>'active_from',
    new.target_filter->>'createdAfter',
    new.target_filter->>'created_after'
  ), '');
  to_filter := nullif(coalesce(
    new.target_filter->>'activeUntil',
    new.target_filter->>'active_until',
    new.target_filter->>'createdBefore',
    new.target_filter->>'created_before'
  ), '');

  if min_filter is not null then
    if min_filter !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'CAMPAIGN_TARGET_FILTER_NUMBER_INVALID: min muss eine gültige Zahl sein.';
    end if;

    min_numeric := min_filter::numeric;

    if min_numeric < 0 then
      raise exception 'CAMPAIGN_TARGET_FILTER_RANGE_INVALID: min darf nicht negativ sein.';
    end if;
  end if;

  if max_filter is not null then
    if max_filter !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'CAMPAIGN_TARGET_FILTER_NUMBER_INVALID: max muss eine gültige Zahl sein.';
    end if;

    max_numeric := max_filter::numeric;

    if max_numeric < 0 then
      raise exception 'CAMPAIGN_TARGET_FILTER_RANGE_INVALID: max darf nicht negativ sein.';
    end if;
  end if;

  if min_numeric is not null and max_numeric is not null and min_numeric > max_numeric then
    raise exception 'CAMPAIGN_TARGET_FILTER_RANGE_INVALID: min darf nicht grösser als max sein.';
  end if;

  if min_cents_filter is not null then
    if min_cents_filter !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'CAMPAIGN_TARGET_FILTER_NUMBER_INVALID: minCents muss eine gültige Zahl sein.';
    end if;

    min_cents_numeric := min_cents_filter::numeric;

    if min_cents_numeric < 0 then
      raise exception 'CAMPAIGN_TARGET_FILTER_RANGE_INVALID: minCents darf nicht negativ sein.';
    end if;
  end if;

  if max_cents_filter is not null then
    if max_cents_filter !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'CAMPAIGN_TARGET_FILTER_NUMBER_INVALID: maxCents muss eine gültige Zahl sein.';
    end if;

    max_cents_numeric := max_cents_filter::numeric;

    if max_cents_numeric < 0 then
      raise exception 'CAMPAIGN_TARGET_FILTER_RANGE_INVALID: maxCents darf nicht negativ sein.';
    end if;
  end if;

  if min_cents_numeric is not null and max_cents_numeric is not null and min_cents_numeric > max_cents_numeric then
    raise exception 'CAMPAIGN_TARGET_FILTER_RANGE_INVALID: minCents darf nicht grösser als maxCents sein.';
  end if;

  if from_filter is not null then
    if from_filter !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:?[0-9]{2})?)?$' then
      raise exception 'CAMPAIGN_TARGET_FILTER_DATE_INVALID: Startdatum muss ein gültiger ISO-Zeitpunkt sein.';
    end if;

    begin
      from_timestamp := from_filter::timestamptz;
    exception when others then
      raise exception 'CAMPAIGN_TARGET_FILTER_DATE_INVALID: Startdatum muss ein gültiger ISO-Zeitpunkt sein.';
    end;
  end if;

  if to_filter is not null then
    if to_filter !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:?[0-9]{2})?)?$' then
      raise exception 'CAMPAIGN_TARGET_FILTER_DATE_INVALID: Enddatum muss ein gültiger ISO-Zeitpunkt sein.';
    end if;

    begin
      to_timestamp := to_filter::timestamptz;
    exception when others then
      raise exception 'CAMPAIGN_TARGET_FILTER_DATE_INVALID: Enddatum muss ein gültiger ISO-Zeitpunkt sein.';
    end;
  end if;

  if from_timestamp is not null and to_timestamp is not null and from_timestamp > to_timestamp then
    raise exception 'CAMPAIGN_TARGET_FILTER_DATE_RANGE_INVALID: Startdatum darf nicht nach dem Enddatum liegen.';
  end if;

  if char_length(coalesce(new.target_filter->>'vipLevel', new.target_filter->>'vip_level', '')) > 80 then
    raise exception 'CAMPAIGN_TARGET_FILTER_TEXT_TOO_LONG: VIP-Level darf maximal 80 Zeichen enthalten.';
  end if;

  if char_length(coalesce(new.target_filter->>'membershipStatus', new.target_filter->>'membership_status', new.target_filter->>'status', '')) > 80 then
    raise exception 'CAMPAIGN_TARGET_FILTER_TEXT_TOO_LONG: Mitgliedschaftsstatus darf maximal 80 Zeichen enthalten.';
  end if;

  if char_length(coalesce(new.target_filter->>'eventId', new.target_filter->>'event_id', '')) > 120 then
    raise exception 'CAMPAIGN_TARGET_FILTER_TEXT_TOO_LONG: Event-ID darf maximal 120 Zeichen enthalten.';
  end if;

  if char_length(coalesce(new.target_filter->>'eventName', new.target_filter->>'event_name', '')) > 120 then
    raise exception 'CAMPAIGN_TARGET_FILTER_TEXT_TOO_LONG: Eventname darf maximal 120 Zeichen enthalten.';
  end if;

  if new.template_id is not null then
    select owner_id, business_id, template_type, card_type, settings
    into template_row
    from public.card_templates
    where id = new.template_id;

    if not found then
      raise exception 'TEMPLATE_NOT_FOUND: Wallet-Kampagne verweist auf ein unbekanntes Template.';
    end if;

    if template_row.owner_id <> new.owner_id then
      raise exception 'CAMPAIGN_FORBIDDEN: Wallet-Kampagne verweist auf ein fremdes Template.';
    end if;

    if template_row.business_id is distinct from new.business_id then
      raise exception 'CAMPAIGN_FORBIDDEN: Wallet-Kampagne verweist auf ein Template aus einem anderen Business.';
    end if;
  end if;

  required_feature := case new.target_type
    when 'stamp_count' then 'stamps'
    when 'streak_count' then 'streak'
    when 'vip_level' then 'vip'
    when 'balance_range' then 'balance'
    when 'cloakroom_open' then 'cloakroom'
    when 'event' then 'checkin'
    when 'coupon_unredeemed' then 'redemption'
    when 'membership_status' then 'membership'
    else null
  end;

  if new.target_type = 'template' and new.template_id is null then
    raise exception 'CAMPAIGN_TEMPLATE_REQUIRED: Template-Zielgruppe braucht ein Template.';
  end if;

  if required_feature is not null and new.template_id is null then
    raise exception 'CAMPAIGN_TEMPLATE_REQUIRED: Feature-Zielgruppen brauchen ein Template.';
  end if;

  if new.template_id is not null then
    if not public.template_feature_allowed(
      coalesce(template_row.template_type, template_row.card_type),
      coalesce(template_row.settings, '{}'::jsonb),
      'notifications'
    ) then
      raise exception 'CAMPAIGN_NOTIFICATIONS_DISABLED: Benachrichtigungen sind für dieses Template nicht erlaubt.';
    end if;

    if required_feature is not null and not public.template_feature_allowed(
      coalesce(template_row.template_type, template_row.card_type),
      coalesce(template_row.settings, '{}'::jsonb),
      required_feature
    ) then
      raise exception 'CAMPAIGN_TARGET_FEATURE_FORBIDDEN: Zielgruppe passt nicht zum Template-Feature.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_wallet_notification_campaigns_consistency on public.wallet_notification_campaigns;
create trigger validate_wallet_notification_campaigns_consistency
before insert or update on public.wallet_notification_campaigns
for each row execute function public.validate_wallet_campaign_consistency();

create or replace function public.validate_wallet_recipient_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  campaign_row record;
  instance_row record;
begin
  select owner_id, business_id, template_id
  into campaign_row
  from public.wallet_notification_campaigns
  where id = new.campaign_id;

  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND: Wallet-Empfänger verweist auf eine unbekannte Kampagne.';
  end if;

  select owner_id, business_id, template_id, wallet_platform
  into instance_row
  from public.card_instances
  where id = new.card_instance_id;

  if not found then
    raise exception 'CARD_INSTANCE_NOT_FOUND: Wallet-Empfänger verweist auf eine unbekannte Karteninstanz.';
  end if;

  if new.owner_id <> campaign_row.owner_id or new.owner_id <> instance_row.owner_id then
    raise exception 'RECIPIENT_FORBIDDEN: Wallet-Empfänger gehört zu einem anderen Betreiber.';
  end if;

  if new.business_id is distinct from campaign_row.business_id or new.business_id is distinct from instance_row.business_id then
    raise exception 'RECIPIENT_FORBIDDEN: Wallet-Empfänger gehört zu einem anderen Business.';
  end if;

  if campaign_row.template_id is not null and instance_row.template_id is distinct from campaign_row.template_id then
    raise exception 'RECIPIENT_TEMPLATE_MISMATCH: Wallet-Empfänger passt nicht zum Kampagnen-Template.';
  end if;

  if new.wallet_platform <> instance_row.wallet_platform then
    raise exception 'RECIPIENT_PLATFORM_MISMATCH: Wallet-Empfänger passt nicht zur Kartenplattform.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_wallet_notification_recipients_consistency on public.wallet_notification_recipients;
create trigger validate_wallet_notification_recipients_consistency
before insert or update on public.wallet_notification_recipients
for each row execute function public.validate_wallet_recipient_consistency();

create or replace function public.validate_wallet_update_queue_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  instance_row record;
  campaign_row record;
begin
  select owner_id, business_id, template_id, wallet_platform
  into instance_row
  from public.card_instances
  where id = new.card_instance_id;

  if not found then
    raise exception 'CARD_INSTANCE_NOT_FOUND: Wallet-Queue verweist auf eine unbekannte Karteninstanz.';
  end if;

  if new.owner_id <> instance_row.owner_id then
    raise exception 'QUEUE_FORBIDDEN: Wallet-Queue-Job gehört zu einem anderen Betreiber.';
  end if;

  if new.business_id is distinct from instance_row.business_id then
    raise exception 'QUEUE_FORBIDDEN: Wallet-Queue-Job gehört zu einem anderen Business.';
  end if;

  if new.wallet_platform <> instance_row.wallet_platform then
    raise exception 'QUEUE_PLATFORM_MISMATCH: Wallet-Queue-Job passt nicht zur Kartenplattform.';
  end if;

  if new.campaign_id is not null then
    select owner_id, business_id, template_id
    into campaign_row
    from public.wallet_notification_campaigns
    where id = new.campaign_id;

    if not found then
      raise exception 'CAMPAIGN_NOT_FOUND: Wallet-Queue-Job verweist auf eine unbekannte Kampagne.';
    end if;

    if campaign_row.owner_id <> new.owner_id or campaign_row.business_id is distinct from new.business_id then
      raise exception 'QUEUE_CAMPAIGN_MISMATCH: Wallet-Queue-Job passt nicht zur Kampagne.';
    end if;

    if campaign_row.template_id is not null and campaign_row.template_id is distinct from instance_row.template_id then
      raise exception 'QUEUE_TEMPLATE_MISMATCH: Wallet-Queue-Job passt nicht zum Kampagnen-Template.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_wallet_update_queue_consistency on public.wallet_update_queue;
create trigger validate_wallet_update_queue_consistency
before insert or update on public.wallet_update_queue
for each row execute function public.validate_wallet_update_queue_consistency();

create or replace function public.validate_direct_wallet_object_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  instance_row record;
  expected_serial text;
begin
  select
    owner_id,
    business_id,
    template_id,
    wallet_platform,
    coalesce(apple_serial_number, wallet_serial_number, id::text) as apple_serial
  into instance_row
  from public.card_instances
  where id = new.card_instance_id;

  if not found then
    raise exception 'CARD_INSTANCE_NOT_FOUND: Wallet-Objekt verweist auf eine unbekannte Karteninstanz.';
  end if;

  if tg_table_name = 'google_wallet_objects' then
    if new.owner_id <> instance_row.owner_id then
      raise exception 'GOOGLE_WALLET_OBJECT_FORBIDDEN: Google Wallet Object gehört zu einem anderen Betreiber.';
    end if;

    if new.business_id is distinct from instance_row.business_id then
      raise exception 'GOOGLE_WALLET_OBJECT_FORBIDDEN: Google Wallet Object gehört zu einem anderen Business.';
    end if;

    if new.template_id is distinct from instance_row.template_id then
      raise exception 'GOOGLE_WALLET_OBJECT_FORBIDDEN: Google Wallet Object verweist auf ein anderes Template.';
    end if;

    if instance_row.wallet_platform <> 'google' then
      raise exception 'GOOGLE_WALLET_OBJECT_PLATFORM_MISMATCH: Google Wallet Object darf nur zu Google-Karten gehören.';
    end if;

    return new;
  end if;

  if tg_table_name in ('apple_wallet_registrations', 'apple_pass_versions') then
    if new.owner_id <> instance_row.owner_id then
      raise exception 'APPLE_WALLET_OBJECT_FORBIDDEN: Apple Wallet Datensatz gehört zu einem anderen Betreiber.';
    end if;

    if new.business_id is distinct from instance_row.business_id then
      raise exception 'APPLE_WALLET_OBJECT_FORBIDDEN: Apple Wallet Datensatz gehört zu einem anderen Business.';
    end if;

    if new.template_id is distinct from instance_row.template_id then
      raise exception 'APPLE_WALLET_OBJECT_FORBIDDEN: Apple Wallet Datensatz verweist auf ein anderes Template.';
    end if;

    if instance_row.wallet_platform <> 'apple' then
      raise exception 'APPLE_WALLET_OBJECT_PLATFORM_MISMATCH: Apple Wallet Datensatz darf nur zu Apple-Karten gehören.';
    end if;

    expected_serial := instance_row.apple_serial;

    if coalesce(new.serial_number, '') <> coalesce(expected_serial, '') then
      raise exception 'APPLE_SERIAL_MISMATCH: Apple Wallet Datensatz passt nicht zur Karten-Seriennummer.';
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_apple_wallet_registrations_direct_consistency on public.apple_wallet_registrations;
create trigger validate_apple_wallet_registrations_direct_consistency
before insert or update on public.apple_wallet_registrations
for each row execute function public.validate_direct_wallet_object_consistency();

drop trigger if exists validate_apple_pass_versions_direct_consistency on public.apple_pass_versions;
create trigger validate_apple_pass_versions_direct_consistency
before insert or update on public.apple_pass_versions
for each row execute function public.validate_direct_wallet_object_consistency();

drop trigger if exists validate_google_wallet_objects_direct_consistency on public.google_wallet_objects;
create trigger validate_google_wallet_objects_direct_consistency
before insert or update on public.google_wallet_objects
for each row execute function public.validate_direct_wallet_object_consistency();

create or replace function public.validate_wallet_push_log_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  business_owner_id uuid;
  campaign_row record;
  instance_row record;
begin
  select owner_id
  into business_owner_id
  from public.businesses
  where id = new.business_id;

  if business_owner_id is null then
    raise exception 'BUSINESS_NOT_FOUND: Wallet-Push-Log verweist auf ein unbekanntes Business.';
  end if;

  if new.owner_id <> business_owner_id then
    raise exception 'PUSH_LOG_FORBIDDEN: Wallet-Push-Log gehört zu einem anderen Betreiber als das Business.';
  end if;

  if new.campaign_id is not null then
    select owner_id, business_id, template_id
    into campaign_row
    from public.wallet_notification_campaigns
    where id = new.campaign_id;

    if not found then
      raise exception 'CAMPAIGN_NOT_FOUND: Wallet-Push-Log verweist auf eine unbekannte Kampagne.';
    end if;

    if campaign_row.owner_id <> new.owner_id or campaign_row.business_id is distinct from new.business_id then
      raise exception 'PUSH_LOG_CAMPAIGN_MISMATCH: Wallet-Push-Log passt nicht zur Kampagne.';
    end if;
  end if;

  if new.card_instance_id is not null then
    select owner_id, business_id, template_id, wallet_platform
    into instance_row
    from public.card_instances
    where id = new.card_instance_id;

    if not found then
      raise exception 'CARD_INSTANCE_NOT_FOUND: Wallet-Push-Log verweist auf eine unbekannte Karteninstanz.';
    end if;

    if instance_row.owner_id <> new.owner_id then
      raise exception 'PUSH_LOG_FORBIDDEN: Wallet-Push-Log gehört zu einem anderen Betreiber als die Karteninstanz.';
    end if;

    if instance_row.business_id is distinct from new.business_id then
      raise exception 'PUSH_LOG_FORBIDDEN: Wallet-Push-Log gehört zu einem anderen Business als die Karteninstanz.';
    end if;

    if instance_row.wallet_platform <> new.wallet_platform then
      raise exception 'PUSH_LOG_CARD_PLATFORM_MISMATCH: Wallet-Push-Log passt nicht zur Kartenplattform.';
    end if;

    if new.campaign_id is not null then
      if campaign_row.template_id is not null and instance_row.template_id is distinct from campaign_row.template_id then
        raise exception 'PUSH_LOG_TEMPLATE_MISMATCH: Wallet-Push-Log passt nicht zum Kampagnen-Template.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_wallet_push_logs_consistency on public.wallet_push_logs;
create trigger validate_wallet_push_logs_consistency
before insert or update on public.wallet_push_logs
for each row execute function public.validate_wallet_push_log_consistency();

create or replace function public.card_event_required_feature(
  p_event_type text
)
returns text
language sql
immutable
as $$
  select case p_event_type
    when 'stamp-plus' then 'stamps'
    when 'stamp-minus' then 'stamps'
    when 'stamp-redeem' then 'stamps'
    when 'streak-plus' then 'streak'
    when 'streak-reset' then 'streak'
    when 'streak-complete' then 'streak'
    when 'vip-update' then 'vip'
    when 'vip-benefit-redeem' then 'vip'
    when 'balance-redeem' then 'balance'
    when 'balance-adjust' then 'balance'
    when 'balance-topup' then 'balance'
    when 'cloakroom-toggle' then 'cloakroom'
    when 'visit' then 'visit'
    when 'checkin' then 'checkin'
    when 'event-checkout' then 'checkin'
    when 'event-ticket-use' then 'checkin'
    when 'redeem' then 'redemption'
    when 'membership-check' then 'membership'
    when 'membership-status-update' then 'membership'
    when 'membership-extend' then 'membership'
    else null
  end;
$$;

create or replace function public.validate_card_event_feature_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  required_feature text;
  template_row record;
  business_owner_id uuid;
begin
  required_feature := public.card_event_required_feature(new.event_type);

  if auth.uid() is not null and new.created_by is not null and new.created_by <> auth.uid() then
    raise exception 'CARD_EVENT_CREATED_BY_FORBIDDEN: Karten-Event darf nicht für einen anderen User geschrieben werden.';
  end if;

  if new.business_id is not null then
    select owner_id
    into business_owner_id
    from public.businesses
    where id = new.business_id;

    if business_owner_id is null then
      raise exception 'CARD_EVENT_BUSINESS_NOT_FOUND: Karten-Event verweist auf ein unbekanntes Business.';
    end if;

    if new.owner_id <> business_owner_id then
      raise exception 'CARD_EVENT_FORBIDDEN: Karten-Event gehört zu einem anderen Betreiber als das Business.';
    end if;
  end if;

  if required_feature is null and new.template_id is null and new.customer_card_id is null then
    return new;
  end if;

  select
    t.id as template_id,
    t.owner_id as template_owner_id,
    t.business_id as template_business_id,
    t.template_type,
    t.card_type,
    t.settings,
    c.id as customer_card_id,
    c.owner_id as customer_card_owner_id,
    c.business_id as customer_card_business_id
  into template_row
  from public.card_templates t
  left join public.customer_cards c on c.id = new.customer_card_id
  where t.id = coalesce(new.template_id, c.template_id);

  if not found then
    raise exception 'TEMPLATE_NOT_FOUND: Template zum Karten-Event nicht gefunden.';
  end if;

  if new.owner_id <> template_row.template_owner_id then
    raise exception 'CARD_FORBIDDEN: Karten-Event gehört zu einem anderen Betreiber.';
  end if;

  if new.business_id is distinct from template_row.template_business_id then
    raise exception 'CARD_FORBIDDEN: Karten-Event gehört zu einem anderen Business.';
  end if;

  if new.template_id is not null and new.template_id <> template_row.template_id then
    raise exception 'CARD_FORBIDDEN: Karten-Event verweist auf ein anderes Template.';
  end if;

  if new.customer_card_id is not null then
    if template_row.customer_card_id is null then
      raise exception 'CARD_NOT_FOUND: Kundenkarte zum Karten-Event nicht gefunden.';
    end if;

    if template_row.customer_card_owner_id <> new.owner_id then
      raise exception 'CARD_FORBIDDEN: Karten-Event verweist auf eine fremde Kundenkarte.';
    end if;

    if template_row.customer_card_business_id is distinct from new.business_id then
      raise exception 'CARD_FORBIDDEN: Karten-Event verweist auf ein fremdes Business.';
    end if;
  end if;

  if required_feature is null then
    return new;
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(template_row.template_type, template_row.card_type),
    coalesce(template_row.settings, '{}'::jsonb),
    required_feature
  ) then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Dieses Karten-Event ist für den Kartentyp nicht erlaubt.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_card_events_features on public.card_events;
create trigger validate_card_events_features
before insert or update on public.card_events
for each row execute function public.validate_card_event_feature_allowed();

create or replace function public.redeem_card_balance(
  p_customer_card_id uuid,
  p_amount_cents integer,
  p_created_by uuid,
  p_source text default 'redeem_balance_edge_function'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  card_row record;
  previous_balance integer;
  new_balance integer;
  currency_value text;
  instance_id uuid;
  transaction_id uuid;
begin
  if p_customer_card_id is null then
    raise exception 'CARD_ID_REQUIRED: Kundenkarten-ID fehlt.';
  end if;

  if p_created_by is null then
    raise exception 'AUTH_REQUIRED: Betreiber-ID fehlt.';
  end if;

  if auth.uid() is not null and auth.uid() <> p_created_by then
    raise exception 'CARD_FORBIDDEN: Betreiber-ID stimmt nicht mit dem Login ueberein.';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_REDEEM_AMOUNT: Der Abbuchungsbetrag muss grösser als 0 sein.';
  end if;

  select
    c.*,
    t.template_type,
    t.card_type,
    t.settings as template_settings
  into card_row
  from public.customer_cards c
  join public.card_templates t on t.id = c.template_id
  where c.id = p_customer_card_id
  for update of c;

  if not found then
    raise exception 'CARD_NOT_FOUND: Kundenkarte nicht gefunden.';
  end if;

  if card_row.owner_id <> p_created_by then
    raise exception 'CARD_FORBIDDEN: Die Kundenkarte gehört zu einem anderen Betreiber.';
  end if;

  if not exists (
    select 1
    from public.operator_profiles op
    where op.id = p_created_by and op.unlock = true
  ) then
    raise exception 'OPERATOR_LOCKED: Betreiber ist nicht freigeschaltet.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(card_row.template_type, card_row.card_type),
    coalesce(card_row.template_settings, '{}'::jsonb),
    'balance'
  ) then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karte unterstützt keine Guthaben-Funktion.';
  end if;

  previous_balance := greatest(coalesce(card_row.balance_cents, 0), 0);
  new_balance := previous_balance - p_amount_cents;
  currency_value := coalesce(nullif(card_row.currency, ''), coalesce(card_row.template_settings->>'currency', 'CHF'));

  if new_balance < 0 then
    raise exception 'BALANCE_TOO_LOW: Guthaben reicht nicht aus.';
  end if;

  update public.customer_cards
  set
    balance_cents = new_balance,
    currency = currency_value,
    metadata = coalesce(card_row.metadata, '{}'::jsonb) || jsonb_build_object(
      'balance_cents', new_balance,
      'last_balance_redeem_at', now(),
      'last_balance_redeem_cents', p_amount_cents
    ),
    last_scanned_at = now()
  where id = card_row.id;

  insert into public.card_instances (
    id,
    customer_card_id,
    owner_id,
    business_id,
    template_id,
    card_instance_number,
    wallet_platform,
    wallet_object_id,
    wallet_serial_number,
    apple_serial_number,
    google_object_id,
    current_streak,
    current_stamps,
    vip_level,
    balance_cents,
    currency,
    cloakroom_active,
    cloakroom_started_at,
    cloakroom_completed_at,
    last_scanned_at
  )
  values (
    card_row.id,
    card_row.id,
    card_row.owner_id,
    card_row.business_id,
    card_row.template_id,
    card_row.card_instance_number,
    card_row.wallet_platform,
    card_row.wallet_object_id,
    case
      when card_row.wallet_platform = 'google' then coalesce(card_row.wallet_object_id, card_row.wallet_serial_number, card_row.pass_serial_number)
      else coalesce(card_row.pass_serial_number, card_row.wallet_serial_number)
    end,
    case
      when card_row.wallet_platform = 'apple' then coalesce(card_row.pass_serial_number, card_row.wallet_serial_number)
      else null
    end,
    case
      when card_row.wallet_platform = 'google' then card_row.wallet_object_id
      else null
    end,
    card_row.streak_count,
    card_row.stamp_count,
    card_row.vip_status,
    new_balance,
    currency_value,
    card_row.cloakroom_active,
    card_row.cloakroom_started_at,
    card_row.cloakroom_completed_at,
    now()
  )
  on conflict (customer_card_id) do update
  set
    balance_cents = excluded.balance_cents,
    currency = excluded.currency,
    wallet_object_id = coalesce(excluded.wallet_object_id, public.card_instances.wallet_object_id),
    wallet_serial_number = excluded.wallet_serial_number,
    apple_serial_number = coalesce(excluded.apple_serial_number, public.card_instances.apple_serial_number),
    google_object_id = coalesce(excluded.google_object_id, public.card_instances.google_object_id),
    last_scanned_at = excluded.last_scanned_at
  returning id into instance_id;

  insert into public.balance_transactions (
    owner_id,
    business_id,
    card_instance_id,
    amount_cents,
    currency,
    type,
    status,
    created_by,
    details
  )
  values (
    card_row.owner_id,
    card_row.business_id,
    instance_id,
    -p_amount_cents,
    currency_value,
    'redeem',
    'succeeded',
    p_created_by,
    jsonb_build_object(
      'source', coalesce(nullif(p_source, ''), 'redeem_balance_edge_function'),
      'previous_balance_cents', previous_balance,
      'new_balance_cents', new_balance
    )
  )
  returning id into transaction_id;

  insert into public.card_events (
    owner_id,
    business_id,
    template_id,
    customer_card_id,
    event_type,
    delta,
    details,
    created_by
  )
  values (
    card_row.owner_id,
    card_row.business_id,
    card_row.template_id,
    card_row.id,
    'balance-redeem',
    -p_amount_cents,
    jsonb_build_object(
      'source', coalesce(nullif(p_source, ''), 'redeem_balance_edge_function'),
      'previous_balance_cents', previous_balance,
      'new_balance_cents', new_balance,
      'transaction_id', transaction_id
    ),
    p_created_by
  );

  return jsonb_build_object(
    'ok', true,
    'card_id', card_row.id,
    'card_instance_id', instance_id,
    'transaction_id', transaction_id,
    'previous_balance_cents', previous_balance,
    'balance_cents', new_balance,
    'currency', currency_value
  );
end;
$$;

create or replace function public.confirm_card_topup(
  p_topup_session_id uuid,
  p_provider_session_id text,
  p_provider_reference text,
  p_created_by uuid,
  p_source text default 'confirm_topup_payment_edge_function'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row record;
  previous_balance integer;
  new_balance integer;
  instance_id uuid;
  transaction_id uuid;
begin
  if p_topup_session_id is null and nullif(p_provider_session_id, '') is null then
    raise exception 'PAYMENT_SESSION_REQUIRED: Payment-Session fehlt.';
  end if;

  if auth.uid() is not null and p_created_by is not null and auth.uid() <> p_created_by then
    raise exception 'CARD_FORBIDDEN: Betreiber-ID stimmt nicht mit dem Login ueberein.';
  end if;

  select
    ps.*,
    c.owner_id as card_owner_id,
    c.business_id as card_business_id,
    c.template_id,
    c.card_instance_number,
    c.wallet_platform,
    c.wallet_object_id,
    c.wallet_serial_number as card_wallet_serial_number,
    c.pass_serial_number,
    c.streak_count,
    c.stamp_count,
    c.vip_status,
    c.balance_cents as card_balance_cents,
    c.currency as card_currency,
    c.cloakroom_active,
    c.cloakroom_started_at,
    c.cloakroom_completed_at,
    c.metadata as card_metadata,
    t.template_type,
    t.card_type,
    t.settings as template_settings
  into session_row
  from public.topup_payment_sessions ps
  join public.customer_cards c on c.id = ps.customer_card_id
  join public.card_templates t on t.id = c.template_id
  where (
    p_topup_session_id is not null and ps.id = p_topup_session_id
  ) or (
    nullif(p_provider_session_id, '') is not null and ps.provider_session_id = p_provider_session_id
  )
  for update of ps, c;

  if not found then
    raise exception 'PAYMENT_SESSION_NOT_FOUND: Payment-Session nicht gefunden.';
  end if;

  if session_row.status <> 'pending' then
    raise exception 'PAYMENT_SESSION_ALREADY_CLOSED: Payment-Session ist nicht mehr offen.';
  end if;

  if session_row.expires_at < now() then
    update public.topup_payment_sessions
    set status = 'cancelled',
        metadata = coalesce(session_row.metadata, '{}'::jsonb) || jsonb_build_object(
          'cancel_reason', 'expired'
        )
    where id = session_row.id;

    raise exception 'PAYMENT_SESSION_EXPIRED: Payment-Session ist abgelaufen.';
  end if;

  if p_created_by is not null and session_row.owner_id <> p_created_by then
    raise exception 'CARD_FORBIDDEN: Die Payment-Session gehört zu einem anderen Betreiber.';
  end if;

  if p_created_by is not null and not exists (
    select 1
    from public.operator_profiles op
    where op.id = p_created_by and op.unlock = true
  ) then
    raise exception 'OPERATOR_LOCKED: Betreiber ist nicht freigeschaltet.';
  end if;

  if not public.template_feature_allowed(
    public.normalize_template_type(session_row.template_type, session_row.card_type),
    coalesce(session_row.template_settings, '{}'::jsonb),
    'balance'
  ) then
    raise exception 'ACTION_NOT_ALLOWED_FOR_TEMPLATE: Diese Karte unterstützt keine Guthaben-Aufladung.';
  end if;

  previous_balance := greatest(coalesce(session_row.card_balance_cents, 0), 0);
  new_balance := previous_balance + session_row.amount_cents;

  update public.customer_cards
  set
    balance_cents = new_balance,
    currency = session_row.currency,
    metadata = coalesce(session_row.card_metadata, '{}'::jsonb) || jsonb_build_object(
      'balance_cents', new_balance,
      'last_balance_topup_at', now(),
      'last_balance_topup_cents', session_row.amount_cents
    ),
    last_scanned_at = now()
  where id = session_row.customer_card_id;

  insert into public.card_instances (
    id,
    customer_card_id,
    owner_id,
    business_id,
    template_id,
    card_instance_number,
    wallet_platform,
    wallet_object_id,
    wallet_serial_number,
    apple_serial_number,
    google_object_id,
    current_streak,
    current_stamps,
    vip_level,
    balance_cents,
    currency,
    cloakroom_active,
    cloakroom_started_at,
    cloakroom_completed_at,
    last_scanned_at
  )
  values (
    session_row.customer_card_id,
    session_row.customer_card_id,
    session_row.card_owner_id,
    session_row.card_business_id,
    session_row.template_id,
    session_row.card_instance_number,
    session_row.wallet_platform,
    session_row.wallet_object_id,
    case
      when session_row.wallet_platform = 'google' then coalesce(session_row.wallet_object_id, session_row.card_wallet_serial_number, session_row.pass_serial_number)
      else coalesce(session_row.pass_serial_number, session_row.card_wallet_serial_number)
    end,
    case
      when session_row.wallet_platform = 'apple' then coalesce(session_row.pass_serial_number, session_row.card_wallet_serial_number)
      else null
    end,
    case
      when session_row.wallet_platform = 'google' then session_row.wallet_object_id
      else null
    end,
    session_row.streak_count,
    session_row.stamp_count,
    session_row.vip_status,
    new_balance,
    session_row.currency,
    session_row.cloakroom_active,
    session_row.cloakroom_started_at,
    session_row.cloakroom_completed_at,
    now()
  )
  on conflict (customer_card_id) do update
  set
    balance_cents = excluded.balance_cents,
    currency = excluded.currency,
    wallet_object_id = coalesce(excluded.wallet_object_id, public.card_instances.wallet_object_id),
    wallet_serial_number = excluded.wallet_serial_number,
    apple_serial_number = coalesce(excluded.apple_serial_number, public.card_instances.apple_serial_number),
    google_object_id = coalesce(excluded.google_object_id, public.card_instances.google_object_id),
    last_scanned_at = excluded.last_scanned_at
  returning id into instance_id;

  update public.topup_payment_sessions
  set
    card_instance_id = instance_id,
    provider_reference = coalesce(nullif(p_provider_reference, ''), provider_reference),
    status = 'succeeded',
    confirmed_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'confirmed_source', coalesce(nullif(p_source, ''), 'confirm_topup_payment_edge_function'),
      'previous_balance_cents', previous_balance,
      'new_balance_cents', new_balance
    )
  where id = session_row.id;

  insert into public.balance_transactions (
    owner_id,
    business_id,
    card_instance_id,
    amount_cents,
    currency,
    type,
    payment_provider,
    payment_reference,
    status,
    created_by,
    details
  )
  values (
    session_row.owner_id,
    session_row.business_id,
    instance_id,
    session_row.amount_cents,
    session_row.currency,
    'topup',
    session_row.payment_provider,
    coalesce(nullif(p_provider_reference, ''), session_row.provider_session_id),
    'succeeded',
    p_created_by,
    jsonb_build_object(
      'source', coalesce(nullif(p_source, ''), 'confirm_topup_payment_edge_function'),
      'topup_payment_session_id', session_row.id,
      'previous_balance_cents', previous_balance,
      'new_balance_cents', new_balance
    )
  )
  returning id into transaction_id;

  insert into public.card_events (
    owner_id,
    business_id,
    template_id,
    customer_card_id,
    event_type,
    delta,
    details,
    created_by
  )
  values (
    session_row.owner_id,
    session_row.business_id,
    session_row.template_id,
    session_row.customer_card_id,
    'balance-topup',
    session_row.amount_cents,
    jsonb_build_object(
      'source', coalesce(nullif(p_source, ''), 'confirm_topup_payment_edge_function'),
      'topup_payment_session_id', session_row.id,
      'transaction_id', transaction_id,
      'previous_balance_cents', previous_balance,
      'new_balance_cents', new_balance
    ),
    p_created_by
  );

  return jsonb_build_object(
    'ok', true,
    'topup_payment_session_id', session_row.id,
    'card_id', session_row.customer_card_id,
    'card_instance_id', instance_id,
    'transaction_id', transaction_id,
    'previous_balance_cents', previous_balance,
    'balance_cents', new_balance,
    'amount_cents', session_row.amount_cents,
    'currency', session_row.currency
  );
end;
$$;

create or replace function public.enqueue_wallet_update_job(
  p_customer_card_id uuid,
  p_reason text,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  card_row record;
  job_id uuid;
begin
  if p_customer_card_id is null then
    return null;
  end if;

	  select
	    c.id,
	    c.owner_id,
	    c.business_id,
	    c.template_id,
	    c.wallet_platform,
	    c.wallet_object_id,
	    c.pass_serial_number,
	    case
	      when c.wallet_platform = 'google' then coalesce(c.wallet_object_id, c.wallet_serial_number, c.pass_serial_number)
	      else coalesce(c.pass_serial_number, c.wallet_serial_number, c.wallet_object_id)
	    end as wallet_serial_number,
	    c.stamp_count,
	    c.streak_count,
	    c.vip_status,
	    c.balance_cents,
	    c.currency,
	    c.cloakroom_active,
	    c.cloakroom_started_at,
	    c.cloakroom_completed_at,
	    c.last_scanned_at,
	    ci.id as card_instance_id
	  into card_row
	  from public.customer_cards c
	  left join public.card_instances ci on ci.customer_card_id = c.id
	  where c.id = p_customer_card_id
	  order by ci.created_at desc nulls last
	  limit 1;
	
	  if card_row is null or card_row.wallet_platform not in ('apple', 'google') then
	    return null;
	  end if;

	  if card_row.card_instance_id is not null then
	    update public.card_instances as ci
	    set
	      wallet_platform = card_row.wallet_platform,
	      wallet_object_id = card_row.wallet_object_id,
	      wallet_serial_number = card_row.wallet_serial_number,
	      apple_serial_number = case
	        when card_row.wallet_platform = 'apple' then coalesce(card_row.pass_serial_number, card_row.wallet_serial_number)
	        else ci.apple_serial_number
	      end,
	      google_object_id = case
	        when card_row.wallet_platform = 'google' then card_row.wallet_object_id
	        else ci.google_object_id
	      end,
	      current_streak = coalesce(card_row.streak_count, 0),
	      current_stamps = coalesce(card_row.stamp_count, 0),
	      vip_level = card_row.vip_status,
	      balance_cents = coalesce(card_row.balance_cents, 0),
	      currency = coalesce(card_row.currency, 'CHF'),
	      cloakroom_active = coalesce(card_row.cloakroom_active, false),
	      cloakroom_started_at = card_row.cloakroom_started_at,
	      cloakroom_completed_at = card_row.cloakroom_completed_at,
	      last_scanned_at = coalesce(card_row.last_scanned_at, ci.last_scanned_at)
	    where ci.id = card_row.card_instance_id
	      and ci.owner_id = card_row.owner_id
	      and ci.business_id is not distinct from card_row.business_id;
	  end if;
	
	  insert into public.wallet_update_jobs (
    owner_id,
    business_id,
    template_id,
    customer_card_id,
    card_instance_id,
    wallet_platform,
    wallet_serial_number,
    wallet_object_id,
    reason,
    details
  )
  values (
    card_row.owner_id,
    card_row.business_id,
    card_row.template_id,
    card_row.id,
    card_row.card_instance_id,
    card_row.wallet_platform,
    card_row.wallet_serial_number,
    card_row.wallet_object_id,
    coalesce(nullif(p_reason, ''), 'card_changed'),
    coalesce(p_details, '{}'::jsonb)
  )
  returning id into job_id;

  if card_row.card_instance_id is not null and card_row.business_id is not null then
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
    values (
      card_row.owner_id,
      card_row.business_id,
      card_row.card_instance_id,
      card_row.wallet_platform,
      coalesce(nullif(p_reason, ''), 'card_changed'),
      jsonb_build_object(
        'source', 'customer_cards_update_trigger',
        'customer_card_id', card_row.id,
        'template_id', card_row.template_id,
        'wallet_serial_number', card_row.wallet_serial_number,
        'object_id', card_row.wallet_object_id,
        'legacy_wallet_update_job_id', job_id,
        'details', coalesce(p_details, '{}'::jsonb)
      ),
      'pending',
      now()
    );
  end if;

  return job_id;
end;
$$;

create or replace function public.enqueue_wallet_update_after_customer_card_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_fields text[] := array[]::text[];
  update_reason text := 'card_changed';
begin
  if new.status is distinct from old.status then
    changed_fields := array_append(changed_fields, 'status');
    update_reason := 'status_changed';
  end if;

  if new.stamp_count is distinct from old.stamp_count then
    changed_fields := array_append(changed_fields, 'stamps');
    update_reason := 'stamps_changed';
  end if;

  if new.streak_count is distinct from old.streak_count then
    changed_fields := array_append(changed_fields, 'streak');
    update_reason := 'streak_changed';
  end if;

  if new.vip_status is distinct from old.vip_status then
    changed_fields := array_append(changed_fields, 'vip');
    update_reason := 'vip_changed';
  end if;

  if new.balance_cents is distinct from old.balance_cents
    or new.currency is distinct from old.currency then
    changed_fields := array_append(changed_fields, 'balance');
    update_reason := 'balance_changed';
  end if;

  if new.cloakroom_active is distinct from old.cloakroom_active
    or new.cloakroom_started_at is distinct from old.cloakroom_started_at
    or new.cloakroom_completed_at is distinct from old.cloakroom_completed_at then
    changed_fields := array_append(changed_fields, 'cloakroom');
    update_reason := 'cloakroom_changed';
  end if;

  if new.metadata is distinct from old.metadata then
    changed_fields := array_append(changed_fields, 'metadata');
  end if;

  if array_length(changed_fields, 1) is null then
    return new;
  end if;

  perform public.enqueue_wallet_update_job(
    new.id,
    update_reason,
    jsonb_build_object(
      'source', 'customer_cards_update_trigger',
      'changed_fields', changed_fields,
      'old', jsonb_build_object(
        'status', old.status,
        'stamp_count', old.stamp_count,
        'streak_count', old.streak_count,
        'vip_status', old.vip_status,
        'balance_cents', old.balance_cents,
        'currency', old.currency,
        'cloakroom_active', old.cloakroom_active
      ),
      'new', jsonb_build_object(
        'status', new.status,
        'stamp_count', new.stamp_count,
        'streak_count', new.streak_count,
        'vip_status', new.vip_status,
        'balance_cents', new.balance_cents,
        'currency', new.currency,
        'cloakroom_active', new.cloakroom_active
      )
    )
  );

  return new;
end;
$$;

drop trigger if exists enqueue_wallet_update_jobs_after_customer_card_update on public.customer_cards;
create trigger enqueue_wallet_update_jobs_after_customer_card_update
after update on public.customer_cards
for each row execute function public.enqueue_wallet_update_after_customer_card_change();

create or replace function public.handle_new_operator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.operator_profiles (id, email, display_name, unlock)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_operator_profile on auth.users;
create trigger on_auth_user_created_create_operator_profile
after insert on auth.users
for each row execute function public.handle_new_operator();

create or replace function public.request_operator_verification_on_unlock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unlock is true and coalesce(old.unlock, false) is false then
    new.approved_at = coalesce(new.approved_at, now());
    new.verification_email_requested_at = null;
    new.verification_email_sent_at = null;
    new.verification_email_last_error = null;
    new.verification_email_status = 'not_requested';
  end if;

  if new.unlock is false and coalesce(old.unlock, false) is true then
    new.approved_at = null;
    new.verification_email_requested_at = null;
    new.verification_email_sent_at = null;
    new.verification_email_last_error = null;
    new.verification_email_status = 'not_requested';
  end if;

  return new;
end;
$$;

drop trigger if exists request_operator_verification_on_unlock on public.operator_profiles;
create trigger request_operator_verification_on_unlock
before update of unlock on public.operator_profiles
for each row execute function public.request_operator_verification_on_unlock();

create or replace function public.current_operator_unlocked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select op.unlock
      from public.operator_profiles op
      where op.id = auth.uid()
    ),
    false
  );
$$;

alter table public.operator_profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.guest_profiles enable row level security;
alter table public.business_memberships enable row level security;
alter table public.guest_restrictions enable row level security;
alter table public.guest_restriction_events enable row level security;
alter table public.card_templates enable row level security;
alter table public.customer_cards enable row level security;
alter table public.card_instances enable row level security;
alter table public.club_card_actions enable row level security;
alter table public.balance_transactions enable row level security;
alter table public.topup_payment_sessions enable row level security;
alter table public.wallet_update_jobs enable row level security;
alter table public.wallet_device_registrations enable row level security;
alter table public.apple_wallet_devices enable row level security;
alter table public.apple_wallet_registrations enable row level security;
alter table public.apple_pass_versions enable row level security;
alter table public.google_wallet_objects enable row level security;
alter table public.samsung_wallet_instances enable row level security;
alter table public.samsung_wallet_events enable row level security;
alter table public.wallet_notification_campaigns enable row level security;
alter table public.wallet_notification_rules enable row level security;
alter table public.wallet_notification_recipients enable row level security;
alter table public.wallet_push_logs enable row level security;
alter table public.wallet_update_queue enable row level security;
alter table public.wallet_emblem_update_logs enable row level security;
alter table public.public_edge_rate_limits enable row level security;
alter table public.card_events enable row level security;
alter table public.scan_events enable row level security;

drop policy if exists "operators can read own profile" on public.operator_profiles;
create policy "operators can read own profile"
on public.operator_profiles
for select
to authenticated
using (id = auth.uid());

-- Kein Update-Policy für operator_profiles:
-- unlock wird im MVP bewusst manuell mit Service Role bzw. im Supabase Dashboard gesetzt.

drop policy if exists "unlocked operators can read own business" on public.businesses;
create policy "unlocked operators can read own business"
on public.businesses
for select
to authenticated
using (
  public.current_operator_unlocked()
  and public.current_user_business_role(id) is not null
);

drop policy if exists "unlocked operators can insert own business" on public.businesses;
create policy "unlocked operators can insert own business"
on public.businesses
for insert
to authenticated
with check (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can update own business" on public.businesses;
create policy "unlocked operators can update own business"
on public.businesses
for update
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked())
with check (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own guest profiles" on public.guest_profiles;
create policy "unlocked operators can read own guest profiles"
on public.guest_profiles
for select
to authenticated
using (
  public.current_operator_unlocked()
  and public.current_user_business_role(business_id) is not null
);

-- Guest-Profile-Writes bleiben vollstaendig serverseitig. Dadurch koennen
-- weder oeffentliche Claim-Seiten noch Browserclients interne Gastdaten setzen.
drop policy if exists "unlocked operators can insert own guest profiles" on public.guest_profiles;
drop policy if exists "unlocked operators can update own guest profiles" on public.guest_profiles;
drop policy if exists "unlocked operators can delete own guest profiles" on public.guest_profiles;

drop policy if exists "business members can read own membership" on public.business_memberships;
create policy "business members can read own membership"
on public.business_memberships
for select
to authenticated
using (
  public.current_operator_unlocked()
  and (
    user_id = auth.uid()
    or public.current_user_business_role(business_id) = 'admin'
  )
);

drop policy if exists "business members can read guest restrictions" on public.guest_restrictions;
create policy "business members can read guest restrictions"
on public.guest_restrictions
for select
to authenticated
using (
  public.current_operator_unlocked()
  and public.current_user_business_role(business_id) is not null
);

drop policy if exists "business members can read restriction history" on public.guest_restriction_events;
create policy "business members can read restriction history"
on public.guest_restriction_events
for select
to authenticated
using (
  public.current_operator_unlocked()
  and public.current_user_business_role(business_id) is not null
);

-- Keine Browser-Schreibpolicies: Restriktionen werden ausschliesslich ueber
-- die atomare, service-role-only Management-RPC gepflegt.
drop policy if exists "business members can insert guest restrictions" on public.guest_restrictions;
drop policy if exists "business members can update guest restrictions" on public.guest_restrictions;
drop policy if exists "business members can delete guest restrictions" on public.guest_restrictions;
drop policy if exists "business members can insert restriction history" on public.guest_restriction_events;
drop policy if exists "business members can update restriction history" on public.guest_restriction_events;
drop policy if exists "business members can delete restriction history" on public.guest_restriction_events;

drop policy if exists "operators and public can read templates" on public.card_templates;
drop policy if exists "unlocked operators can read own templates" on public.card_templates;
create policy "unlocked operators can read own templates"
on public.card_templates
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can insert own templates" on public.card_templates;
create policy "unlocked operators can insert own templates"
on public.card_templates
for insert
to authenticated
with check (
  owner_id = auth.uid()
  and public.current_operator_unlocked()
  and (
    business_id is null
    or exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = auth.uid()
    )
  )
);

drop policy if exists "unlocked operators can update own templates" on public.card_templates;
create policy "unlocked operators can update own templates"
on public.card_templates
for update
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked())
with check (
  owner_id = auth.uid()
  and public.current_operator_unlocked()
  and (
    business_id is null
    or exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = auth.uid()
    )
  )
);

drop policy if exists "unlocked operators can delete own templates" on public.card_templates;
create policy "unlocked operators can delete own templates"
on public.card_templates
for delete
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own customer cards" on public.customer_cards;
create policy "unlocked operators can read own customer cards"
on public.customer_cards
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can update own customer cards" on public.customer_cards;
-- Keine direkte Browser-Update-Policy für customer_cards:
-- Kartenstatus, Wallet-Identität, Apple-Auth-Token, Guthaben und Scanner-Aenderungen
-- werden über Edge Functions, SQL-Trigger, RPCs oder Service-Role-Pfade geschrieben.

drop policy if exists "unlocked operators can read own card instances" on public.card_instances;
create policy "unlocked operators can read own card instances"
on public.card_instances
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can update own card instances" on public.card_instances;
-- Keine direkte Browser-Update-Policy für card_instances:
-- Wallet-Identität, Push-Status und Zähler werden über Edge Functions,
-- SQL-Trigger oder Service-Role-Pfade geschrieben.

drop policy if exists "unlocked operators can read own club card actions" on public.club_card_actions;
create policy "unlocked operators can read own club card actions"
on public.club_card_actions
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own scan events" on public.scan_events;
create policy "unlocked operators can read own scan events"
on public.scan_events
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can insert own scan events" on public.scan_events;
drop policy if exists "unlocked operators can update own scan events" on public.scan_events;
drop policy if exists "unlocked operators can delete own scan events" on public.scan_events;
-- Keine direkte Browser-Write-Policy für scan_events:
-- Scanner- und Statistikdaten werden über Service-Role Edge Functions geschrieben.

drop policy if exists "unlocked operators can insert own club card actions" on public.club_card_actions;
-- Keine direkte Browser-Insert-Policy für club_card_actions:
-- Kritische Clubkarten-Aktionen werden über Scanner-/Wallet-Edge-Functions
-- oder Service-Role-Pfade geschrieben.

drop policy if exists "unlocked operators can read own balance transactions" on public.balance_transactions;
create policy "unlocked operators can read own balance transactions"
on public.balance_transactions
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can insert own balance transactions" on public.balance_transactions;
-- Keine direkte Browser-Insert-Policy für balance_transactions:
-- Guthabenbewegungen werden über Scanner-/Topup-Edge-Functions oder RPCs geschrieben.

drop policy if exists "unlocked operators can read own topup sessions" on public.topup_payment_sessions;
create policy "unlocked operators can read own topup sessions"
on public.topup_payment_sessions
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can insert own topup sessions" on public.topup_payment_sessions;
-- Keine direkte Browser-Insert-Policy für topup_payment_sessions:
-- Öffentliche Topups laufen über create-topup-payment-session.

drop policy if exists "unlocked operators can update own topup sessions" on public.topup_payment_sessions;
-- Keine direkte Browser-Update-Policy für topup_payment_sessions:
-- Bestätigungen laufen über confirm-topup-payment bzw. Provider-Webhooks.

drop policy if exists "unlocked operators can read own wallet update jobs" on public.wallet_update_jobs;
create policy "unlocked operators can read own wallet update jobs"
on public.wallet_update_jobs
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can update own wallet update jobs" on public.wallet_update_jobs;
-- Keine direkte Browser-Update-Policy für wallet_update_jobs:
-- Legacy-Jobstatus und Retry-Zähler werden über Edge Functions, Queue-Processor
-- oder Service-Role-Pfade geschrieben.

drop policy if exists "unlocked operators can read own wallet device registrations" on public.wallet_device_registrations;
create policy "unlocked operators can read own wallet device registrations"
on public.wallet_device_registrations
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can insert own wallet device registrations" on public.wallet_device_registrations;
-- Keine direkte Browser-Insert-Policy für wallet_device_registrations:
-- Wallet-Geräte werden über Apple Web Service bzw. Edge Functions registriert.

drop policy if exists "unlocked operators can update own wallet device registrations" on public.wallet_device_registrations;
-- Keine direkte Browser-Update-Policy für wallet_device_registrations:
-- Device-Status, Seriennummern und Push-Token bleiben serverseitige Daten.

-- apple_wallet_devices hat bewusst keine authenticated Policies:
-- Apple registriert Geräte über öffentliche Edge Functions, intern abgesichert per Service Role.

-- public_edge_rate_limits hat bewusst keine authenticated Policies:
-- Öffentliche Claim-/Installationslimits werden nur per Service-Role-RPC verbraucht.

drop policy if exists "unlocked operators can read own apple registrations" on public.apple_wallet_registrations;
create policy "unlocked operators can read own apple registrations"
on public.apple_wallet_registrations
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own apple pass versions" on public.apple_pass_versions;
create policy "unlocked operators can read own apple pass versions"
on public.apple_pass_versions
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own google wallet objects" on public.google_wallet_objects;
create policy "unlocked operators can read own google wallet objects"
on public.google_wallet_objects
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own samsung wallet instances" on public.samsung_wallet_instances;
create policy "unlocked operators can read own samsung wallet instances"
on public.samsung_wallet_instances
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own samsung wallet events" on public.samsung_wallet_events;
create policy "unlocked operators can read own samsung wallet events"
on public.samsung_wallet_events
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own wallet notification campaigns" on public.wallet_notification_campaigns;
create policy "unlocked operators can read own wallet notification campaigns"
on public.wallet_notification_campaigns
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own wallet notification rules" on public.wallet_notification_rules;
create policy "unlocked operators can read own wallet notification rules"
on public.wallet_notification_rules
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

-- Schreibzugriffe auf Regeln laufen ausschliesslich über die validierende
-- manage-wallet-notification-rule Edge Function.

drop policy if exists "unlocked operators can update own draft wallet notification campaigns" on public.wallet_notification_campaigns;
-- Keine direkte Browser-Update-Policy für wallet_notification_campaigns:
-- Kampagnen werden über create-wallet-notification-campaign,
-- send-wallet-notification, Cron-/Queue-Functions oder Service-Role-Pfade geschrieben.

drop policy if exists "unlocked operators can read own wallet notification recipients" on public.wallet_notification_recipients;
create policy "unlocked operators can read own wallet notification recipients"
on public.wallet_notification_recipients
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own wallet push logs" on public.wallet_push_logs;
create policy "unlocked operators can read own wallet push logs"
on public.wallet_push_logs
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own wallet update queue" on public.wallet_update_queue;
create policy "unlocked operators can read own wallet update queue"
on public.wallet_update_queue
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own wallet emblem update logs" on public.wallet_emblem_update_logs;
create policy "unlocked operators can read own wallet emblem update logs"
on public.wallet_emblem_update_logs
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can read own card events" on public.card_events;
create policy "unlocked operators can read own card events"
on public.card_events
for select
to authenticated
using (owner_id = auth.uid() and public.current_operator_unlocked());

drop policy if exists "unlocked operators can insert own card events" on public.card_events;
-- Keine direkte Browser-Insert-Policy für card_events:
-- Audit-Events werden über Claim-/Scanner-/Wallet-Edge-Functions,
-- RPCs oder Service-Role-Pfade geschrieben.

grant usage on schema public to anon, authenticated;
revoke select on public.card_templates from anon;
revoke select, insert, update, delete on public.operator_profiles from authenticated;
grant select (
  id,
  email,
  display_name,
  unlock,
  approved_at,
  verification_email_requested_at,
  verification_email_sent_at,
  verification_email_last_error,
  verification_email_attempts,
  verification_email_status,
  created_at,
  updated_at
) on public.operator_profiles to authenticated;
revoke select, insert, update, delete on public.businesses from authenticated;
grant select (
  id,
  owner_id,
  name,
  description,
  address,
  location_lat,
  location_lng,
  phone,
  website,
  logo_url,
  company_logo_path,
  company_logo_updated_at,
  created_at,
  updated_at
) on public.businesses to authenticated;
grant insert (
  owner_id,
  name,
  description,
  address,
  location_lat,
  location_lng,
  phone,
  website,
  logo_url,
  company_logo_path,
  company_logo_updated_at
) on public.businesses to authenticated;
grant update (
  name,
  description,
  address,
  location_lat,
  location_lng,
  phone,
  website,
  logo_url,
  company_logo_path,
  company_logo_updated_at
) on public.businesses to authenticated;
revoke select, insert, update, delete on public.guest_profiles from anon, authenticated;
grant select (
  id,
  owner_id,
  business_id,
  display_name,
  gender,
  age_group,
  first_seen_at,
  last_seen_at,
  created_at,
  updated_at
) on public.guest_profiles to authenticated;
revoke select, insert, update, delete on public.business_memberships from anon, authenticated;
grant select (
  id,
  business_id,
  user_id,
  role,
  active,
  created_at,
  updated_at
) on public.business_memberships to authenticated;
revoke select, insert, update, delete on public.guest_restrictions from anon, authenticated;
grant select (
  id,
  owner_id,
  business_id,
  guest_profile_id,
  restriction_type,
  status,
  starts_at,
  ends_at,
  created_at,
  updated_at,
  lifted_at
) on public.guest_restrictions to authenticated;
revoke select, insert, update, delete on public.guest_restriction_events from anon, authenticated;
grant select (
  id,
  restriction_id,
  owner_id,
  business_id,
  guest_profile_id,
  event_type,
  performed_at
) on public.guest_restriction_events to authenticated;
revoke select, insert, update, delete on public.card_templates from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  business_name,
  card_name,
  card_type,
  template_type,
  description,
  primary_color,
  text_color,
  logo_url,
  reward_text,
  stamps_required,
  streak_goal,
  vip_tier,
  settings,
  club_features,
  club_settings,
  public_claim_token,
  is_active,
  created_at,
  updated_at
) on public.card_templates to authenticated;
grant insert (
  owner_id,
  business_id,
  business_name,
  card_name,
  card_type,
  template_type,
  description,
  primary_color,
  text_color,
  logo_url,
  reward_text,
  stamps_required,
  streak_goal,
  vip_tier,
  settings,
  club_features,
  club_settings,
  is_active
) on public.card_templates to authenticated;
grant update (
  business_id,
  business_name,
  card_name,
  card_type,
  template_type,
  description,
  primary_color,
  text_color,
  logo_url,
  reward_text,
  stamps_required,
  streak_goal,
  vip_tier,
  settings,
  club_features,
  club_settings,
  is_active
) on public.card_templates to authenticated;
grant delete on public.card_templates to authenticated;
revoke select, insert, update, delete on public.customer_cards from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  card_instance_number,
  customer_code,
  status,
  stamp_count,
  streak_count,
  vip_status,
  pass_serial_number,
  wallet_platform,
  wallet_object_id,
  wallet_serial_number,
  balance_cents,
  currency,
  cloakroom_active,
  cloakroom_started_at,
  cloakroom_completed_at,
  last_scanned_at,
  metadata,
  last_claimed_at,
  created_at,
  updated_at
) on public.customer_cards to authenticated;
revoke select, insert, update, delete on public.card_instances from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  customer_card_id,
  customer_id,
  card_instance_number,
  wallet_platform,
  demographics_collected,
  customer_gender,
  customer_age_group,
  demographics_collected_at,
  first_scanned_at,
  scan_count,
  resolved_emblem_key,
  resolved_emblem_url,
  emblem_updated_at,
  push_enabled,
  current_streak,
  current_stamps,
  vip_level,
  vip_benefits_used,
  custom_counter,
  balance_cents,
  currency,
  cloakroom_active,
  cloakroom_started_at,
  cloakroom_completed_at,
  coupon_status,
  coupon_redeemed_at,
  membership_number,
  membership_status,
  membership_started_at,
  membership_expires_at,
  last_scanned_at,
  last_wallet_update_at,
  last_notification_at,
  notification_count_24h,
  created_at,
  updated_at
) on public.card_instances to authenticated;
revoke select, insert, update, delete on public.club_card_actions from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  card_instance_id,
  action_type,
  feature_type,
  old_value,
  new_value,
  performed_by,
  created_at
) on public.club_card_actions to authenticated;
revoke select, insert, update, delete on public.scan_events from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  customer_card_id,
  card_instance_id,
  card_instance_number,
  template_name,
  scanned_by,
  scanned_at,
  scan_hour,
  scan_weekday,
  template_type,
  active_club_features,
  customer_gender,
  customer_age_group,
  is_first_scan,
  demographics_were_collected,
  action_type,
  action_label,
  created_at
) on public.scan_events to authenticated;
revoke select, insert, update, delete on public.balance_transactions from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  card_instance_id,
  amount_cents,
  currency,
  type,
  payment_provider,
  status,
  created_by,
  created_at
) on public.balance_transactions to authenticated;
revoke select, insert, update, delete on public.topup_payment_sessions from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  customer_card_id,
  card_instance_id,
  amount_cents,
  currency,
  payment_provider,
  status,
  expires_at,
  confirmed_at,
  created_by,
  created_at,
  updated_at
) on public.topup_payment_sessions to authenticated;
revoke select, insert, update, delete on public.wallet_update_jobs from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  customer_card_id,
  card_instance_id,
  wallet_platform,
  wallet_serial_number,
  wallet_object_id,
  reason,
  status,
  attempts,
  locked_at,
  processed_at,
  created_at,
  updated_at
) on public.wallet_update_jobs to authenticated;
revoke select, insert, update, delete on public.wallet_device_registrations from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  customer_card_id,
  card_instance_id,
  wallet_platform,
  pass_type_identifier,
  serial_number,
  status,
  last_seen_at,
  created_at,
  updated_at
) on public.wallet_device_registrations to authenticated;
revoke select on public.apple_wallet_registrations from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  card_instance_id,
  pass_type_identifier,
  serial_number,
  created_at
) on public.apple_wallet_registrations to authenticated;
revoke select on public.apple_pass_versions from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  card_instance_id,
  serial_number,
  pass_type_identifier,
  version,
  last_updated_at
) on public.apple_pass_versions to authenticated;
revoke select on public.google_wallet_objects from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  card_instance_id,
  issuer_id,
  class_id,
  object_id,
  object_type,
  created_at,
  updated_at
) on public.google_wallet_objects to authenticated;
revoke select, insert, update, delete on public.samsung_wallet_instances from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  ref_id,
  customer_code,
  card_id,
  card_type,
  card_sub_type,
  country_code,
  add_flow,
  card_status,
  last_event,
  last_event_at,
  last_synced_at,
  created_at,
  updated_at
) on public.samsung_wallet_instances to authenticated;
revoke select, insert, update, delete on public.samsung_wallet_events from authenticated;
grant select (
  id,
  samsung_wallet_instance_id,
  owner_id,
  business_id,
  template_id,
  ref_id,
  event_type,
  samsung_event,
  created_at
) on public.samsung_wallet_events to authenticated;
revoke select, insert, update, delete on public.wallet_notification_rules from authenticated;
grant select (
  id,
  business_id,
  template_id,
  name,
  title,
  message,
  target_type,
  target_filter,
  trigger_type,
  recurrence,
  weekdays,
  month_day,
  time_of_day,
  time_zone,
  starts_on,
  ends_on,
  active_from_time,
  active_until_time,
  location_lat,
  location_lng,
  location_radius_m,
  status,
  next_run_at,
  location_active_until_at,
  location_is_active,
  last_run_at,
  last_status,
  last_result,
  created_at,
  updated_at
) on public.wallet_notification_rules to authenticated;
revoke select, insert, update, delete on public.wallet_notification_campaigns from authenticated;
grant select (
  id,
  business_id,
  template_id,
  notification_rule_id,
  title,
  message,
  target_type,
  send_type,
  scheduled_at,
  location_lat,
  location_lng,
  location_radius_m,
  status,
  created_at,
  sent_at
) on public.wallet_notification_campaigns to authenticated;
revoke select on public.wallet_notification_recipients from authenticated;
grant select (
  id,
  campaign_id,
  business_id,
  card_instance_id,
  wallet_platform,
  status,
  error_code,
  error_message,
  created_at,
  sent_at
) on public.wallet_notification_recipients to authenticated;
revoke select on public.wallet_push_logs from authenticated;
grant select (
  id,
  business_id,
  card_instance_id,
  campaign_id,
  wallet_platform,
  action,
  status,
  error_message,
  created_at
) on public.wallet_push_logs to authenticated;
revoke select on public.wallet_update_queue from authenticated;
grant select (
  id,
  business_id,
  card_instance_id,
  campaign_id,
  wallet_platform,
  update_type,
  status,
  attempt_count,
  next_attempt_at,
  processing_started_at,
  created_at,
  processed_at
) on public.wallet_update_queue to authenticated;
revoke select, insert, update, delete on public.wallet_emblem_update_logs from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  card_instance_id,
  customer_card_id,
  wallet_platform,
  previous_emblem_key,
  resolved_emblem_key,
  resolved_emblem_url,
  reason,
  update_queued,
  update_error,
  created_at
) on public.wallet_emblem_update_logs to authenticated;
revoke all on public.public_edge_rate_limits from public, anon, authenticated;
revoke execute on function public.consume_public_edge_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_edge_rate_limit(text, text, integer, integer) to service_role;
revoke select, insert, update, delete on public.card_events from authenticated;
grant select (
  id,
  owner_id,
  business_id,
  template_id,
  customer_card_id,
  event_type,
  created_by,
  created_at
) on public.card_events to authenticated;
grant execute on function public.normalize_template_type(text, text) to anon, authenticated;
grant execute on function public.settings_feature_enabled(jsonb, text) to anon, authenticated;
grant execute on function public.template_feature_allowed(text, jsonb, text) to anon, authenticated;
grant execute on function public.card_event_required_feature(text) to anon, authenticated;
revoke all on function public.enqueue_wallet_update_job(uuid, text, jsonb) from public, anon;
grant execute on function public.enqueue_wallet_update_job(uuid, text, jsonb) to authenticated, service_role;
revoke all on function public.redeem_card_balance(uuid, integer, uuid, text) from public, anon;
grant execute on function public.redeem_card_balance(uuid, integer, uuid, text) to authenticated, service_role;
revoke all on function public.confirm_card_topup(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.confirm_card_topup(uuid, text, text, uuid, text) to authenticated, service_role;

-- Supabase Storage für Logos und Karten-Icons.
-- Oeffentlich lesbar, aber Upload/Update/Delete nur für freigeschaltete Betreiber
-- und nur im eigenen Ordner: wallet-assets/<auth.uid()>/...
-- Erlaubt sind nur kleine PNG/JPEG/WebP-Dateien, weil der Bucket öffentlich ist
-- und diese Assets direkt in Wallet-Passes, Vorschauen und PDFs auftauchen.
insert into storage.buckets (id, name, public)
values ('wallet-assets', 'wallet-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "wallet assets are public" on storage.objects;
create policy "wallet assets are public"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'wallet-assets');

drop policy if exists "unlocked operators can upload own wallet assets" on storage.objects;
create policy "unlocked operators can upload own wallet assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'wallet-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(name) ~ '\.(png|jpg|jpeg|webp)$'
  and coalesce(metadata->>'mimetype', '') in ('image/png', 'image/jpeg', 'image/webp')
  and metadata ? 'size'
  and (metadata->>'size') ~ '^[0-9]+$'
  and (metadata->>'size')::bigint <= 2097152
  and public.current_operator_unlocked()
);

drop policy if exists "unlocked operators can update own wallet assets" on storage.objects;
create policy "unlocked operators can update own wallet assets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'wallet-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.current_operator_unlocked()
)
with check (
  bucket_id = 'wallet-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(name) ~ '\.(png|jpg|jpeg|webp)$'
  and coalesce(metadata->>'mimetype', '') in ('image/png', 'image/jpeg', 'image/webp')
  and metadata ? 'size'
  and (metadata->>'size') ~ '^[0-9]+$'
  and (metadata->>'size')::bigint <= 2097152
  and public.current_operator_unlocked()
);

drop policy if exists "unlocked operators can delete own wallet assets" on storage.objects;
create policy "unlocked operators can delete own wallet assets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'wallet-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.current_operator_unlocked()
);

-- Supabase Storage für zentrale Firmenlogos.
-- Pfad: business-logos/<business_id>/<timestamp>-logo.<png|jpg|jpeg|webp>
-- Oeffentlich lesbar, damit Apple Wallet, Google Wallet, PDFs und Claim-Seiten
-- das Logo ohne Service-Role im Browser bzw. Wallet-Provider anzeigen können.
insert into storage.buckets (id, name, public)
values ('business-logos', 'business-logos', true)
on conflict (id) do update set public = true;

drop policy if exists "business logos are public" on storage.objects;
create policy "business logos are public"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'business-logos');

drop policy if exists "unlocked operators can upload own business logos" on storage.objects;
create policy "unlocked operators can upload own business logos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'business-logos'
  and lower(name) ~ '\.(png|jpg|jpeg|webp)$'
  and public.current_operator_unlocked()
  and exists (
    select 1
    from public.businesses business
    where business.id::text = (storage.foldername(storage.objects.name))[1]
      and business.owner_id = auth.uid()
  )
);

drop policy if exists "unlocked operators can update own business logos" on storage.objects;
create policy "unlocked operators can update own business logos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'business-logos'
  and public.current_operator_unlocked()
  and exists (
    select 1
    from public.businesses business
    where business.id::text = (storage.foldername(storage.objects.name))[1]
      and business.owner_id = auth.uid()
  )
)
with check (
  bucket_id = 'business-logos'
  and lower(name) ~ '\.(png|jpg|jpeg|webp)$'
  and public.current_operator_unlocked()
  and exists (
    select 1
    from public.businesses business
    where business.id::text = (storage.foldername(storage.objects.name))[1]
      and business.owner_id = auth.uid()
  )
);

drop policy if exists "unlocked operators can delete own business logos" on storage.objects;
create policy "unlocked operators can delete own business logos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'business-logos'
  and public.current_operator_unlocked()
  and exists (
    select 1
    from public.businesses business
    where business.id::text = (storage.foldername(storage.objects.name))[1]
      and business.owner_id = auth.uid()
  )
);

-- Supabase Storage für Wallet-Embleme.
-- Globale Defaults liegen unter wallet-emblems/default/*.png und werden per Service Role
-- hochgeladen. Business-spezifische Overrides sind vorbereitet unter
-- wallet-emblems/<business_id>/<emblem-key>.png.
insert into storage.buckets (id, name, public)
values ('wallet-emblems', 'wallet-emblems', true)
on conflict (id) do update set public = true;

drop policy if exists "wallet emblems are public" on storage.objects;
create policy "wallet emblems are public"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'wallet-emblems');

drop policy if exists "unlocked operators can upload own wallet emblems" on storage.objects;
create policy "unlocked operators can upload own wallet emblems"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'wallet-emblems'
  and (storage.foldername(name))[1] <> 'default'
  and lower(name) ~ '\.(png|jpg|jpeg|webp)$'
  and coalesce(metadata->>'mimetype', '') in ('image/png', 'image/jpeg', 'image/webp')
  and metadata ? 'size'
  and (metadata->>'size') ~ '^[0-9]+$'
  and (metadata->>'size')::bigint <= 2097152
  and public.current_operator_unlocked()
  and exists (
    select 1
    from public.businesses business
    where business.id::text = (storage.foldername(name))[1]
      and business.owner_id = auth.uid()
  )
);

drop policy if exists "unlocked operators can update own wallet emblems" on storage.objects;
create policy "unlocked operators can update own wallet emblems"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'wallet-emblems'
  and (storage.foldername(name))[1] <> 'default'
  and public.current_operator_unlocked()
  and exists (
    select 1
    from public.businesses business
    where business.id::text = (storage.foldername(name))[1]
      and business.owner_id = auth.uid()
  )
)
with check (
  bucket_id = 'wallet-emblems'
  and (storage.foldername(name))[1] <> 'default'
  and lower(name) ~ '\.(png|jpg|jpeg|webp)$'
  and coalesce(metadata->>'mimetype', '') in ('image/png', 'image/jpeg', 'image/webp')
  and metadata ? 'size'
  and (metadata->>'size') ~ '^[0-9]+$'
  and (metadata->>'size')::bigint <= 2097152
  and public.current_operator_unlocked()
  and exists (
    select 1
    from public.businesses business
    where business.id::text = (storage.foldername(name))[1]
      and business.owner_id = auth.uid()
  )
);

drop policy if exists "unlocked operators can delete own wallet emblems" on storage.objects;
create policy "unlocked operators can delete own wallet emblems"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'wallet-emblems'
  and (storage.foldername(name))[1] <> 'default'
  and public.current_operator_unlocked()
  and exists (
    select 1
    from public.businesses business
    where business.id::text = (storage.foldername(name))[1]
      and business.owner_id = auth.uid()
  )
);

-- Manuelle Freischaltung im MVP:
-- update public.operator_profiles
-- set unlock = true
-- where email = 'betreiber@example.com';
