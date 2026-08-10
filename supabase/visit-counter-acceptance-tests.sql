-- Prompt-4-Abnahmetest. Transaktional; alle Testdaten werden zurueckgerollt.
begin;

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','a5000000-0000-4000-8000-000000000001','authenticated','authenticated','visit-a@example.invalid',crypt('test-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','b5000000-0000-4000-8000-000000000001','authenticated','authenticated','visit-b@example.invalid',crypt('test-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.operator_profiles set unlock=true where id in ('a5000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001');

insert into public.businesses (id,owner_id,name) values
('a5100000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','Visit A'),
('b5100000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','Visit B');

insert into public.card_templates (id,owner_id,business_id,business_name,card_name,card_type,template_type,settings) values
('a5200000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','A','Counter ON','generic','generic_card','{"visitCounterEnabled":true,"visitCounterWalletVisible":false,"visitMilestonesEnabled":true,"visitMilestones":[10,100]}'),
('a5200000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','A','Counter OFF','generic','generic_card','{"visitCounterEnabled":false}'),
('b5200000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','b5100000-0000-4000-8000-000000000001','B','Counter B','generic','generic_card','{"visitCounterEnabled":true}');

insert into public.customer_cards (id,owner_id,business_id,template_id,card_instance_number,customer_code,wallet_platform) values
('a5300000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000001','VISIT-A-1','VISIT-A-CODE-1','apple'),
('a5300000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000001','VISIT-A-2','VISIT-A-CODE-2','google'),
('a5300000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000002','VISIT-OFF','VISIT-OFF-CODE','apple'),
('b5300000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','b5100000-0000-4000-8000-000000000001','b5200000-0000-4000-8000-000000000001','VISIT-B-1','VISIT-B-CODE','apple');

insert into public.card_instances (id,customer_card_id,owner_id,business_id,template_id,card_instance_number,wallet_platform) values
('a5400000-0000-4000-8000-000000000001','a5300000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000001','VISIT-A-1','apple'),
('a5400000-0000-4000-8000-000000000002','a5300000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000001','VISIT-A-2','google'),
('a5400000-0000-4000-8000-000000000003','a5300000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000002','VISIT-OFF','apple'),
('b5400000-0000-4000-8000-000000000001','b5300000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','b5100000-0000-4000-8000-000000000001','b5200000-0000-4000-8000-000000000001','VISIT-B-1','apple');

do $$
begin
  begin
    perform public.register_card_entry_visit('a5300000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000001','counter-off-0001');
    raise exception 'TEST_FAILED: Deaktivierter Zaehler wurde erhoeht.';
  exception when others then if position('VISIT_COUNTER_DISABLED' in sqlerrm)=0 then raise; end if; end;
end; $$;

-- 101 eindeutige Eintrittsscans; 10 und 100 duerfen genau einmal ausloesen.
do $$
declare i integer; payload jsonb;
begin
  for i in 1..101 loop
    payload := public.register_card_entry_visit('a5300000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','entry-'||lpad(i::text,8,'0'));
    if i in (1,10,100,101) and (payload->>'lifetime_visits')::integer <> i then
      raise exception 'TEST_FAILED: Zaehlerstand % ist falsch: %', i, payload;
    end if;
    if i in (10,100) and (payload->>'milestone_reached')::integer <> i then
      raise exception 'TEST_FAILED: Meilenstein % fehlt: %', i, payload;
    end if;
    if i=101 and payload->>'milestone_reached' is not null then
      raise exception 'TEST_FAILED: 100er-Meilenstein wurde beim 101. Besuch erneut ausgeloest.';
    end if;
  end loop;
end; $$;

-- Retry/Doppelklick mit demselben Key bleibt exakt bei 101.
do $$
declare payload jsonb;
begin
  payload := public.register_card_entry_visit('a5300000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','entry-00000100');
  if (payload->>'idempotent_replay')::boolean is not true or (payload->>'lifetime_visits')::integer <> 101 then
    raise exception 'TEST_FAILED: Request-Retry war nicht idempotent: %', payload;
  end if;
  if (select count(*) from public.card_visit_events where customer_card_id='a5300000-0000-4000-8000-000000000001') <> 101 then
    raise exception 'TEST_FAILED: Doppelscan hat zusaetzliches Event erzeugt.';
  end if;
  if (select count(*) from public.card_visit_milestones where customer_card_id='a5300000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'TEST_FAILED: Meilensteine wurden nicht genau einmal gespeichert.';
  end if;
end; $$;

-- Andere Karte und anderes Business bleiben isoliert; Cross-Tenant wird abgewiesen.
select public.register_card_entry_visit('a5300000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001','other-card-0001');
do $$ begin
  if (select lifetime_visits from public.card_instances where customer_card_id='a5300000-0000-4000-8000-000000000002') <> 1 then raise exception 'TEST_FAILED: Kartenisolation fehlt.'; end if;
  begin
    perform public.register_card_entry_visit('a5300000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','cross-tenant-01');
    raise exception 'TEST_FAILED: Cross-Tenant-Eintritt wurde akzeptiert.';
  exception when others then if position('VISIT_FORBIDDEN' in sqlerrm)=0 then raise; end if; end;
end; $$;

-- Wallet-Anzeige AN nutzt die vorhandene Update-Queue.
update public.card_templates set settings=jsonb_set(settings,'{visitCounterWalletVisible}','true') where id='a5200000-0000-4000-8000-000000000001';
select public.register_card_entry_visit('a5300000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001','wallet-visible-01');
do $$ begin
  if not exists (select 1 from public.wallet_update_queue where update_type='visit_counter_update' and card_instance_id=(select id from public.card_instances where customer_card_id='a5300000-0000-4000-8000-000000000002')) then
    raise exception 'TEST_FAILED: Wallet-Update wurde nicht in bestehende Queue gelegt.';
  end if;
end; $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
do $$ begin
  begin perform public.register_card_entry_visit('a5300000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','browser-direct-1'); raise exception 'TEST_FAILED: Browser durfte RPC direkt ausfuehren.';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
