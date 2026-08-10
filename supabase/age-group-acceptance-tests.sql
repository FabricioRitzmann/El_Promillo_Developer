begin;

do $$
declare
  table_name text;
  constraint_name text;
  constraint_definition text;
  group_name text;
  allowed_groups constant text[] := array[
    '18_24', '25_29', '30_39', '40_49', '50_59', '60_69', '70_plus',
    '18_plus', '25_plus', '30_plus'
  ];
begin
  for table_name, constraint_name in
    values
      ('guest_profiles', 'guest_profiles_age_group_check'),
      ('card_instances', 'card_instances_customer_age_group_check'),
      ('scan_events', 'scan_events_customer_age_group_check'),
      ('club_card_actions', 'club_card_actions_customer_age_group_check')
  loop
    select pg_get_constraintdef(c.oid)
      into constraint_definition
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = table_name
       and c.conname = constraint_name;

    if constraint_definition is null then
      raise exception 'Fehlender Altersgruppen-Constraint %.%', table_name, constraint_name;
    end if;

    foreach group_name in array allowed_groups loop
      if position(group_name in constraint_definition) = 0 then
        raise exception 'Constraint % unterstützt % nicht', constraint_name, group_name;
      end if;
    end loop;
  end loop;

  if exists (
    select 1 from public.guest_profiles
     where age_group is not null and not (age_group = any (allowed_groups))
  ) or exists (
    select 1 from public.card_instances
     where customer_age_group is not null and not (customer_age_group = any (allowed_groups))
  ) or exists (
    select 1 from public.scan_events
     where customer_age_group is not null and not (customer_age_group = any (allowed_groups))
  ) or exists (
    select 1 from public.club_card_actions
     where customer_age_group is not null and not (customer_age_group = any (allowed_groups))
  ) then
    raise exception 'Nicht unterstützte Altersgruppe in Bestandsdaten gefunden';
  end if;
end $$;

do $$
declare
  precise_groups constant text[] := array['18_24', '25_29', '30_39', '40_49', '50_59', '60_69', '70_plus'];
  legacy_groups constant text[] := array['18_plus', '25_plus', '30_plus'];
  sample_groups text[];
begin
  sample_groups := precise_groups || legacy_groups;

  if cardinality(sample_groups) <> 10
     or cardinality(array(select distinct unnest(sample_groups))) <> 10 then
    raise exception 'Altersgruppen sind nicht eindeutig';
  end if;

  if cardinality(precise_groups) <> 7 or cardinality(legacy_groups) <> 3 then
    raise exception 'Unerwartete Altersgruppenanzahl';
  end if;
end $$;

rollback;
