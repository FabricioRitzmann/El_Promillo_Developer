-- Prompt-2-Abnahmetest. Vollstaendig transaktional; keine Testdaten bleiben.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'restriction-owner-a@example.invalid', crypt('test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'restriction-manager@example.invalid', crypt('test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'restriction-security@example.invalid', crypt('test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'restriction-staff@example.invalid', crypt('test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'restriction-owner-b@example.invalid', crypt('test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

update public.operator_profiles
set unlock = true
where id::text like 'c1000000-%' or id = 'd1000000-0000-4000-8000-000000000001';

insert into public.businesses (id, owner_id, name)
values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Restriction Firma A'),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Restriction Firma B');

insert into public.business_memberships (business_id, user_id, role, created_by)
values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'manager', 'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003', 'security', 'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000004', 'staff', 'c1000000-0000-4000-8000-000000000001');

insert into public.card_templates (id, owner_id, business_id, business_name, card_name, card_type, template_type)
values
  ('c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Firma A', 'Restriction A', 'generic', 'generic_card'),
  ('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Firma B', 'Restriction B', 'generic', 'generic_card');

insert into public.customer_cards (id, owner_id, business_id, template_id, card_instance_number, customer_code, wallet_platform)
values
  ('c4000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'RESTRICTION-A-1', 'RESTRICTION-CODE-A-1', 'apple'),
  ('c4000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'RESTRICTION-A-2', 'RESTRICTION-CODE-A-2', 'google'),
  ('d4000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 'RESTRICTION-B-1', 'RESTRICTION-CODE-B-1', 'apple');

-- Admin erstellt Hausverbot, Manager getrennt davon Casinosperre.
select public.manage_guest_restriction(
  'c4000000-0000-4000-8000-000000000001', 'create', 'c1000000-0000-4000-8000-000000000001',
  null, 'HOUSE_BAN', now() - interval '1 day', null, 'Hausverbot Test', 'Nur Admin sichtbar', null
);
select public.manage_guest_restriction(
  'c4000000-0000-4000-8000-000000000001', 'create', 'c1000000-0000-4000-8000-000000000002',
  null, 'CASINO_BAN', now() - interval '2 hours', now() + interval '5 days', 'Casinosperre Test', 'Managernotiz', null
);

do $$
declare payload jsonb;
begin
  payload := public.get_guest_restrictions_for_scan('c4000000-0000-4000-8000-000000000001');
  if jsonb_array_length(payload->'active') <> 2 then
    raise exception 'TEST_FAILED: Haus- und Casinosperre muessen gleichzeitig aktiv sein: %', payload;
  end if;
  if (select count(*) from public.guest_restriction_events where business_id = 'c2000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'TEST_FAILED: CREATED-Audit fehlt.';
  end if;
end;
$$;

-- Staff darf keine Restriktion erstellen.
do $$
begin
  begin
    perform public.manage_guest_restriction(
      'c4000000-0000-4000-8000-000000000002', 'create', 'c1000000-0000-4000-8000-000000000004',
      null, 'HOUSE_BAN', now(), null, 'Unzulaessig', null, null
    );
    raise exception 'TEST_FAILED: Staff durfte Restriktion erstellen.';
  exception when others then
    if position('RESTRICTION_WRITE_FORBIDDEN' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

-- Security darf erfassen, aber nicht aufheben.
select public.manage_guest_restriction(
  'c4000000-0000-4000-8000-000000000002', 'create', 'c1000000-0000-4000-8000-000000000003',
  null, 'HOUSE_BAN', now() - interval '10 days', now() - interval '1 day', 'Abgelaufen', null, null
);

do $$
declare house_id uuid;
begin
  select id into house_id from public.guest_restrictions
  where guest_profile_id = (select guest_profile_id from public.customer_cards where id = 'c4000000-0000-4000-8000-000000000001')
    and restriction_type = 'HOUSE_BAN';
  begin
    perform public.manage_guest_restriction(
      'c4000000-0000-4000-8000-000000000001', 'lift', 'c1000000-0000-4000-8000-000000000003',
      house_id, null, null, null, null, null, 'Unzulaessig'
    );
    raise exception 'TEST_FAILED: Security durfte Restriktion aufheben.';
  exception when others then
    if position('RESTRICTION_WRITE_FORBIDDEN' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

-- Manager bearbeitet und hebt Hausverbot auf; Historie bleibt.
do $$
declare house_id uuid;
begin
  select id into house_id from public.guest_restrictions
  where guest_profile_id = (select guest_profile_id from public.customer_cards where id = 'c4000000-0000-4000-8000-000000000001')
    and restriction_type = 'HOUSE_BAN';
  perform public.manage_guest_restriction(
    'c4000000-0000-4000-8000-000000000001', 'update', 'c1000000-0000-4000-8000-000000000002',
    house_id, null, now() - interval '1 day', null, 'Aktualisierter Grund', 'Aktualisierte Notiz', null
  );
  perform public.manage_guest_restriction(
    'c4000000-0000-4000-8000-000000000001', 'lift', 'c1000000-0000-4000-8000-000000000002',
    house_id, null, null, null, null, null, 'Entscheid aufgehoben'
  );
end;
$$;

do $$
declare payload jsonb;
begin
  payload := public.get_guest_restrictions_for_scan('c4000000-0000-4000-8000-000000000001');
  if jsonb_array_length(payload->'active') <> 1 then
    raise exception 'TEST_FAILED: Nach Aufhebung darf nur Casinosperre aktiv sein: %', payload;
  end if;
  if jsonb_array_length(public.get_guest_restrictions_for_scan('c4000000-0000-4000-8000-000000000002')->'active') <> 0 then
    raise exception 'TEST_FAILED: Abgelaufene Restriktion darf nicht aktiv sein.';
  end if;
  if (select count(*) from public.guest_restriction_events where event_type in ('UPDATED', 'LIFTED')) <> 2 then
    raise exception 'TEST_FAILED: Update-/Lift-Audit fehlt.';
  end if;
end;
$$;

-- Firma B hat denselben fachlichen Gast, aber strikt separate Restriktionen.
select public.manage_guest_restriction(
  'd4000000-0000-4000-8000-000000000001', 'create', 'd1000000-0000-4000-8000-000000000001',
  null, 'HOUSE_BAN', now(), null, 'Firma B separat', null, null
);

do $$
begin
  begin
    perform public.manage_guest_restriction(
      'c4000000-0000-4000-8000-000000000001', 'create', 'd1000000-0000-4000-8000-000000000001',
      null, 'HOUSE_BAN', now(), null, 'Cross Tenant', null, null
    );
    raise exception 'TEST_FAILED: Cross-Tenant-Akteur wurde akzeptiert.';
  exception when others then
    if position('RESTRICTION_FORBIDDEN' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

-- Hard Delete ist auch fuer privilegierte SQL-Pfade verboten.
do $$
begin
  begin
    delete from public.guest_restrictions where business_id = 'c2000000-0000-4000-8000-000000000001';
    raise exception 'TEST_FAILED: Restriktion konnte hart geloescht werden.';
  exception when others then
    if position('RESTRICTION_DELETE_FORBIDDEN' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

-- RLS: Firma A sieht Firma B nicht; Browserrollen duerfen Management-RPCs nicht ausfuehren.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);

do $$
begin
  if exists (select 1 from public.guest_restrictions where business_id = 'd2000000-0000-4000-8000-000000000001') then
    raise exception 'TEST_FAILED: RLS zeigt Firma A Restriktionen von Firma B.';
  end if;
  if not exists (select 1 from public.guest_restrictions where business_id = 'c2000000-0000-4000-8000-000000000001') then
    raise exception 'TEST_FAILED: RLS versteckt eigene Restriktionen.';
  end if;
  begin
    perform public.get_guest_restrictions_for_scan('c4000000-0000-4000-8000-000000000001');
    raise exception 'TEST_FAILED: Browserrolle durfte interne Scan-RPC ausfuehren.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;
