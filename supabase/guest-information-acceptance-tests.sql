-- Prompt-3-Abnahmetest. Transaktional; es bleiben keine Testdaten zurueck.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'guest-info-owner-a@example.invalid', crypt('test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'guest-info-manager@example.invalid', crypt('test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'guest-info-security@example.invalid', crypt('test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'guest-info-staff@example.invalid', crypt('test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'guest-info-owner-b@example.invalid', crypt('test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now());

update public.operator_profiles set unlock = true
where id::text like 'e1000000-%' or id = 'f1000000-0000-4000-8000-000000000001';

insert into public.businesses (id, owner_id, name, guest_scan_settings) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Guest Info A', '{"regular_info_auto_show":true,"notes_auto_show_warning":true,"notes_auto_show_important":false,"notes_auto_show_normal":true}'),
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Guest Info B', default);

insert into public.business_memberships (business_id, user_id, role, created_by) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'manager', 'e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 'security', 'e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'staff', 'e1000000-0000-4000-8000-000000000001');

insert into public.card_templates (id, owner_id, business_id, business_name, card_name, card_type, template_type) values
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'A', 'Info A', 'generic', 'generic_card'),
  ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'B', 'Info B', 'generic', 'generic_card');

insert into public.customer_cards (id, owner_id, business_id, template_id, card_instance_number, customer_code, wallet_platform) values
  ('e4000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'INFO-A-1', 'INFO-CODE-A-1', 'apple'),
  ('f4000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'INFO-B-1', 'INFO-CODE-B-1', 'google');

-- Ohne Informationen bleibt das Objekt leer und die vier Firmenschalter gelten exakt.
do $$
declare payload jsonb;
begin
  payload := public.get_guest_information_for_scan('e4000000-0000-4000-8000-000000000001');
  if payload->'regular_information' <> 'null'::jsonb or jsonb_array_length(payload->'notes') <> 0 then
    raise exception 'TEST_FAILED: Leerer Gastkontext ist nicht leer: %', payload;
  end if;
  if (payload->'settings'->>'regular_info_auto_show')::boolean is not true
     or (payload->'settings'->>'notes_auto_show_important')::boolean is not false then
    raise exception 'TEST_FAILED: Auto-Anzeige-Einstellungen wurden nicht uebernommen: %', payload;
  end if;
end;
$$;

select public.manage_guest_regular_information(
  'e4000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002',
  'Besucht uns freitags', 'Mineralwasser', 'Lounge Tisch 4', 'Ruhiger Bereich', 'Nur intern'
);

-- Security darf erfassen; Warnung, Wichtig und Normal werden chronologisch gespeichert.
select public.manage_guest_note('e4000000-0000-4000-8000-000000000001', 'create', 'e1000000-0000-4000-8000-000000000003', null, 'Normale Notiz', 'NORMAL', null);
select public.manage_guest_note('e4000000-0000-4000-8000-000000000001', 'create', 'e1000000-0000-4000-8000-000000000003', null, 'Wichtige Notiz', 'IMPORTANT', null);
select public.manage_guest_note('e4000000-0000-4000-8000-000000000001', 'create', 'e1000000-0000-4000-8000-000000000003', null, 'Warnhinweis', 'WARNING', null);

do $$
declare payload jsonb; warning_id uuid; original_created timestamptz;
begin
  payload := public.get_guest_information_for_scan('e4000000-0000-4000-8000-000000000001');
  if payload->'regular_information'->>'favorite_drink' <> 'Mineralwasser' or jsonb_array_length(payload->'notes') <> 3 then
    raise exception 'TEST_FAILED: Stammgastinfo oder mehrere Notizen fehlen: %', payload;
  end if;
  if payload->'notes'->0->>'priority' <> 'WARNING' then
    raise exception 'TEST_FAILED: Neueste Notiz steht nicht zuerst: %', payload;
  end if;

  warning_id := (payload->'notes'->0->>'id')::uuid;
  select created_at into original_created from public.guest_notes where id = warning_id;
  perform public.manage_guest_note('e4000000-0000-4000-8000-000000000001', 'update', 'e1000000-0000-4000-8000-000000000002', warning_id, 'Warnhinweis aktualisiert', 'WARNING', null);
  if (select created_at from public.guest_notes where id = warning_id) <> original_created then
    raise exception 'TEST_FAILED: created_at wurde beim Bearbeiten veraendert.';
  end if;
  perform public.manage_guest_note('e4000000-0000-4000-8000-000000000001', 'delete', 'e1000000-0000-4000-8000-000000000002', warning_id, null, null, 'Erledigt');
  if (select deleted_at from public.guest_notes where id = warning_id) is null then
    raise exception 'TEST_FAILED: Soft Delete fehlt.';
  end if;
  if (select count(*) from public.guest_note_events where guest_note_id = warning_id) <> 3 then
    raise exception 'TEST_FAILED: CREATED/UPDATED/DELETED-Audit ist unvollstaendig.';
  end if;
end;
$$;

-- Staff darf nicht schreiben, fremde Businesses ebenfalls nicht.
do $$
begin
  begin
    perform public.manage_guest_note('e4000000-0000-4000-8000-000000000001', 'create', 'e1000000-0000-4000-8000-000000000004', null, 'Unzulaessig', 'NORMAL', null);
    raise exception 'TEST_FAILED: Staff durfte Notiz schreiben.';
  exception when others then
    if position('GUEST_NOTE_WRITE_FORBIDDEN' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.manage_guest_regular_information('e4000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', null, 'Cross Tenant', null, null, null);
    raise exception 'TEST_FAILED: Cross-Tenant-Stammgastinfo wurde akzeptiert.';
  exception when others then
    if position('GUEST_INFO_WRITE_FORBIDDEN' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

-- Browserrollen duerfen die internen Management-RPCs nicht direkt ausfuehren.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    perform public.get_guest_information_for_scan('e4000000-0000-4000-8000-000000000001');
    raise exception 'TEST_FAILED: Browserrolle durfte Scan-Kontext-RPC ausfuehren.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;
