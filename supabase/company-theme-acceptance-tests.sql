begin;

do $$
declare
  definition text;
  default_value text;
  theme_name text;
  allowed_themes constant text[] := array[
    'promillo-standard', 'blue-white', 'green-white', 'violet-white',
    'navy-lightgray', 'black-white', 'anthracite-gold'
  ];
begin
  select pg_get_constraintdef(c.oid)
    into definition
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'businesses'
     and c.conname = 'businesses_app_theme_check';

  if definition is null then
    raise exception 'businesses_app_theme_check fehlt';
  end if;

  foreach theme_name in array allowed_themes loop
    if position(theme_name in definition) = 0 then
      raise exception 'Theme % fehlt im Constraint', theme_name;
    end if;
  end loop;

  select column_default
    into default_value
    from information_schema.columns
   where table_schema = 'public' and table_name = 'businesses' and column_name = 'app_theme';

  if default_value is null or position('promillo-standard' in default_value) = 0 then
    raise exception 'Sicheres Standard-Theme fehlt';
  end if;

  if exists (select 1 from public.businesses where not (app_theme = any (allowed_themes))) then
    raise exception 'Ungültiges Theme in Bestandsdaten';
  end if;

  if not has_column_privilege('authenticated', 'public.businesses', 'app_theme', 'SELECT')
     or not has_column_privilege('authenticated', 'public.businesses', 'app_theme', 'INSERT')
     or not has_column_privilege('authenticated', 'public.businesses', 'app_theme', 'UPDATE') then
    raise exception 'Authenticated-Spaltenrechte für app_theme fehlen';
  end if;
end $$;

rollback;
