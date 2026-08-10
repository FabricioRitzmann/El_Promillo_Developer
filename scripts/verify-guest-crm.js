import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const includes = (label, source, values) => values.forEach((value) => assert(source.includes(value), `${label} fehlt: ${value}`));

const schema = read('supabase/schema.sql');
const edge = read('supabase/functions/guest-crm/index.ts');
const claimEdge = read('supabase/functions/claim-card/index.ts');
const localServer = read('server/index.js');
const publicResponses = read('supabase/functions/_shared/publicResponses.ts');
const account = `${read('public/account.html')}\n${read('public/js/account.js')}`;
const editor = `${read('public/editor.html')}\n${read('public/js/editor.js')}`;
const claim = `${read('public/claim.html')}\n${read('public/js/claim.js')}`;
const crm = `${read('public/crm.html')}\n${read('public/js/crm.js')}\n${read('public/styles.css')}`;
const walletProviders = `${read('supabase/functions/_shared/appleWalletProvider.ts')}\n${read('supabase/functions/_shared/googleWalletProvider.ts')}\n${read('supabase/functions/_shared/samsungWalletProvider.ts')}`;

includes('Optionale Tenant-Einstellung', schema, ['guest_crm_enabled boolean not null default false', 'crm_active_guest_days integer not null default 30', 'businesses_crm_active_guest_days_check']);
includes('Zentrale Guest-Erweiterung', schema, [
  'create table if not exists public.guest_crm_profiles (', 'guest_profile_id uuid primary key',
  'references public.guest_profiles(id, business_id)', 'create table if not exists public.guest_social_links (',
  'create table if not exists public.crm_field_definitions (', 'create table if not exists public.crm_field_values (',
  'create table if not exists public.guest_crm_audit_events ('
]);
for (const fieldType of ['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTISELECT', 'URL']) assert(schema.includes(`'${fieldType}'`), `Custom Field ${fieldType} fehlt.`);
includes('Tenant- und Audit-Schutz', schema, [
  'validate_guest_crm_child_tenant', 'CRM_TENANT_MISMATCH', 'CRM_FIELD_TENANT_MISMATCH',
  'prevent_guest_crm_audit_mutation', 'alter table public.guest_crm_profiles enable row level security',
  'business members can read guest crm profiles', 'Guest-CRM-Edge-Function oder den streng validierten Claim-Flow'
]);
assert(!schema.includes('grant insert on public.guest_crm_profiles to authenticated'), 'Browser darf CRM-Profile nicht direkt schreiben.');

includes('Rollen und serverseitige API', edge, [
  "const editableRoles = new Set(['admin', 'manager'])", 'can_export', 'can_manage_fields', 'can_anonymize',
  ".eq('business_id', context.business.id)", "action === 'list'", "action === 'detail'", "action === 'update'",
  "action === 'stats'", "action === 'export'", "action === 'anonymize'", 'page_size'
]);
includes('Suche und Filter', edge, ['first_name.ilike', 'card_instance_number.ilike', 'template_type', 'visit_bucket', 'profile_state', 'age_group', 'registration_from', 'last_seen']);
includes('Duplikate ohne Auto-Merge', claimEdge, ['possible_duplicate', "metadata: { created_from: 'public_crm_registration'", ".eq('business_id', template.business_id)"]);
assert(!claimEdge.includes('.update({ guest_profile_id'), 'Öffentliche Registrierung darf bestehende Profile nicht aggressiv zusammenführen.');
includes('Strukturierte CRM-Feldvalidierung', claimEdge, ['CRM_CUSTOM_URL_INVALID', 'CRM_CUSTOM_NUMBER_INVALID', 'CRM_CUSTOM_DATE_INVALID', 'CRM_CUSTOM_BOOLEAN_INVALID', 'CRM_CUSTOM_OPTION_INVALID']);
includes('Gehärteter lokaler Claim-Fallback', localServer, ['CRM_CUSTOM_URL_INVALID', 'CRM_CUSTOM_NUMBER_INVALID', 'CRM_CUSTOM_DATE_INVALID', 'CRM_CUSTOM_BOOLEAN_INVALID', 'CRM_CUSTOM_OPTION_INVALID', 'possible_duplicate', 'if (auditResult.error) throw auditResult.error']);

includes('Öffentliche Feldfreigabe', `${claimEdge}\n${publicResponses}\n${claim}`, [
  'crm_registration_enabled', 'crm_registration_fields', 'personalizedGuestDataEnabled', 'crmRegistrationFields',
  'CRM_REGISTRATION_NOT_ALLOWED', 'CRM_REQUIRED_FIELD_MISSING', 'CRM_EMAIL_INVALID', 'CRM_SOCIAL_URL_INVALID',
  'configuredStandardKeys', 'configuredSocialKeys', 'crmRegistrationPayload'
]);
assert(!publicResponses.includes('guest_crm_profiles'), 'Öffentliche Template-Response darf keine gespeicherten CRM-Profile laden.');

includes('Account und Editor', `${account}\n${editor}`, ['Guest CRM aktivieren', 'Personalisierung / CRM', 'Personalisierte Gastdaten erfassen', 'Pflichtfeld', 'public_registration_allowed']);
includes('CRM UI', crm, ['Name, E-Mail, Telefon, Karten-ID, Mitgliedsnummer', 'CSV exportieren', 'Eigene CRM-Felder', 'data-crm-tab="visits"', 'data-crm-tab="cards"', 'data-crm-tab="internal"', 'crm-pagination', '@media (max-width: 640px)']);

for (const sensitiveName of ['guest_crm_profiles', 'guest_social_links', 'crm_field_values']) assert(!walletProviders.includes(sensitiveName), `Wallet-Provider darf ${sensitiveName} nicht laden.`);

console.log('Optionales Guest-/Member-CRM, RLS-Grenzen, Rollen, Personalisierung, Filter, Export und Wallet-Trennung sind statisch abgesichert.');
