-- Updates only the default colors for newly inserted card templates.
-- Existing templates keep their saved primary_color and text_color values.

alter table public.card_templates
  alter column primary_color set default '#fffaf2',
  alter column text_color set default '#5b3423';

-- Refresh Supabase REST/PostgREST schema cache after the DDL change.
notify pgrst, 'reload schema';
