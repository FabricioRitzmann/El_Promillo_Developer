-- Prompt-1-Abnahmetest fuer eine lokale bzw. separate Developer-Supabase-DB.
-- WICHTIG: Das Skript laeuft vollstaendig in einer Transaktion und endet mit
-- ROLLBACK. Es ist nicht fuer die produktive Datenbankfreigabe bestimmt.
-- Voraussetzung: supabase/schema.sql wurde zuvor erfolgreich angewendet.

begin;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'a1000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'guest-profile-a@example.invalid',
    crypt('developer-test-only', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b1000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'guest-profile-b@example.invalid',
    crypt('developer-test-only', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

update public.operator_profiles
set unlock = true
where id in (
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001'
);

insert into public.businesses (id, owner_id, name)
values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Guest Test Firma A'),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Guest Test Firma B');

insert into public.card_templates (
  id,
  owner_id,
  business_id,
  business_name,
  card_name,
  card_type,
  template_type
)
values
  (
    'a3000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'Firma A',
    'Guest Testkarte A',
    'generic',
    'generic_card'
  ),
  (
    'b3000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'Firma B',
    'Guest Testkarte B',
    'generic',
    'generic_card'
  );

-- Gast A/Firma A: erste neue Karte erzeugt automatisch ein Guest Profile.
insert into public.customer_cards (
  id,
  owner_id,
  business_id,
  template_id,
  card_instance_number,
  customer_code,
  wallet_platform
)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'GP-A-CARD-1',
  'GP-A-CODE-1',
  'apple'
);

-- Zweite Karte desselben Gastes verwendet explizit dasselbe Profil.
insert into public.customer_cards (
  id,
  owner_id,
  business_id,
  template_id,
  guest_profile_id,
  card_instance_number,
  customer_code,
  wallet_platform
)
select
  'a4000000-0000-4000-8000-000000000002',
  owner_id,
  business_id,
  template_id,
  guest_profile_id,
  'GP-A-CARD-2',
  'GP-A-CODE-2',
  'google'
from public.customer_cards
where id = 'a4000000-0000-4000-8000-000000000001';

-- Gast A/Firma B bleibt trotz gleicher fachlicher Bezeichnung strikt separat.
insert into public.customer_cards (
  id,
  owner_id,
  business_id,
  template_id,
  card_instance_number,
  customer_code,
  wallet_platform
)
values (
  'b4000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001',
  'GP-B-CARD-1',
  'GP-B-CODE-1',
  'apple'
);

insert into public.card_instances (
  id,
  customer_card_id,
  owner_id,
  business_id,
  template_id,
  card_instance_number,
  wallet_platform
)
select
  card.id,
  card.id,
  card.owner_id,
  card.business_id,
  card.template_id,
  card.card_instance_number,
  card.wallet_platform
from public.customer_cards card
where card.id in (
  'a4000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000002',
  'b4000000-0000-4000-8000-000000000001'
);

do $$
declare
  guest_a uuid;
  guest_a_second uuid;
  guest_b uuid;
begin
  select guest_profile_id into guest_a
  from public.customer_cards
  where id = 'a4000000-0000-4000-8000-000000000001';

  select guest_profile_id into guest_a_second
  from public.customer_cards
  where id = 'a4000000-0000-4000-8000-000000000002';

  select guest_profile_id into guest_b
  from public.customer_cards
  where id = 'b4000000-0000-4000-8000-000000000001';

  if guest_a is null or guest_b is null then
    raise exception 'TEST_FAILED: neue Karten brauchen ein Gastprofil.';
  end if;

  if guest_a <> guest_a_second then
    raise exception 'TEST_FAILED: mehrere Karten desselben Gastes sind nicht verknuepft.';
  end if;

  if guest_a = guest_b then
    raise exception 'TEST_FAILED: Firmen A und B teilen unzulaessig dasselbe Gastprofil.';
  end if;

  if exists (
    select 1
    from public.card_instances instance
    join public.customer_cards card on card.id = instance.customer_card_id
    where instance.id in (
      'a4000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000002',
      'b4000000-0000-4000-8000-000000000001'
    )
      and instance.customer_id is distinct from card.guest_profile_id
  ) then
    raise exception 'TEST_FAILED: card_instances.customer_id spiegelt die Guest-ID nicht.';
  end if;
end;
$$;

-- Cross-Tenant-Zuordnung muss an der Datenbankgrenze scheitern.
do $$
declare
  foreign_guest uuid;
begin
  select guest_profile_id into foreign_guest
  from public.customer_cards
  where id = 'b4000000-0000-4000-8000-000000000001';

  begin
    update public.customer_cards
    set guest_profile_id = foreign_guest
    where id = 'a4000000-0000-4000-8000-000000000001';

    raise exception 'TEST_FAILED: Cross-Tenant-Guest-Zuordnung wurde akzeptiert.';
  exception
    when others then
      if position('GUEST_CARD_TENANT_MISMATCH' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$$;

-- Erfolgreicher Scan erbt Guest-/Tenant-Bezug und aktualisiert first/last seen.
insert into public.scan_events (
  id,
  owner_id,
  business_id,
  template_id,
  customer_card_id,
  card_instance_id,
  card_instance_number,
  scanned_by,
  scanned_at,
  customer_gender,
  customer_age_group,
  action_type
)
values (
  'a5000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'GP-A-CARD-1',
  'a1000000-0000-4000-8000-000000000001',
  '2026-08-10 20:00:00+00',
  'male',
  '25_plus',
  'visit'
);

do $$
declare
  card_guest uuid;
  event_guest uuid;
  profile_payload jsonb;
begin
  select guest_profile_id into card_guest
  from public.customer_cards
  where id = 'a4000000-0000-4000-8000-000000000001';

  select guest_profile_id into event_guest
  from public.scan_events
  where id = 'a5000000-0000-4000-8000-000000000001';

  if event_guest is distinct from card_guest then
    raise exception 'TEST_FAILED: Scan-Historie verweist nicht auf das Karten-Gastprofil.';
  end if;

  select public.get_guest_profile_for_scan('a4000000-0000-4000-8000-000000000001')
  into profile_payload;

  if (profile_payload->>'card_count')::integer <> 2
    or (profile_payload->>'scan_count')::integer <> 1
    or profile_payload->>'gender' <> 'male'
    or profile_payload->>'age_group' <> '25_plus' then
    raise exception 'TEST_FAILED: zentrale Scan-Aufloesung liefert falsche Werte: %', profile_payload;
  end if;
end;
$$;

-- RLS: Firma A sieht nur eigene Guest Profiles und darf die Service-RPC nicht
-- direkt aus dem Browser aufrufen.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

do $$
begin
  if exists (
    select 1
    from public.guest_profiles
    where business_id = 'b2000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'TEST_FAILED: RLS zeigt Firma A ein Gastprofil von Firma B.';
  end if;

  if not exists (
    select 1
    from public.guest_profiles
    where business_id = 'a2000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'TEST_FAILED: RLS versteckt das eigene Gastprofil von Firma A.';
  end if;

  begin
    perform public.get_guest_profile_for_scan('a4000000-0000-4000-8000-000000000001');
    raise exception 'TEST_FAILED: Browserrolle durfte die serverseitige Guest-RPC ausfuehren.';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

-- Keine Testdaten bleiben bestehen.
rollback;
