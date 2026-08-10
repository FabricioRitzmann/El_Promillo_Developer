import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(rootDir, file), 'utf8');
const schema = read('supabase/schema.sql');
const edge = read('supabase/functions/scanner-actions/index.ts');
const responses = read('supabase/functions/_shared/publicResponses.ts');
const server = read('server/index.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(schema.includes('create table if not exists public.guest_profiles ('), 'guest_profiles-Tabelle fehlt.');
assert(schema.includes('business_id uuid not null references public.businesses(id)'), 'Gastprofile brauchen ein verpflichtendes Business.');
assert(schema.includes('constraint guest_profiles_id_business_key unique (id, business_id)'), 'Tenant-Schluessel des Gastprofils fehlt.');
assert(schema.includes('guest_profile_id uuid references public.guest_profiles(id) on delete restrict'), 'customer_cards muss auf das Gastprofil verweisen.');
assert(schema.includes('guest_profile_id uuid references public.guest_profiles(id) on delete set null'), 'scan_events muss die historische Gastrelation speichern.');
assert(schema.includes('guest_profile_backfill_map'), 'Idempotenter Legacy-Backfill fehlt.');
assert(schema.includes("when ci.customer_id is not null then 'customer:' || ci.customer_id::text"), 'Bestehende customer_id-Gruppen werden nicht erhalten.');
assert(schema.includes('groups.business_id = cards.business_id'), 'Backfill ist nicht sichtbar pro Business getrennt.');
assert(schema.includes('create or replace function public.ensure_customer_card_guest_profile()'), 'Automatische Profilzuordnung fuer neue Karten fehlt.');
assert(schema.includes('GUEST_CARD_TENANT_MISMATCH'), 'Cross-Tenant-Kartenzuordnung wird nicht explizit blockiert.');
assert(schema.includes('create or replace function public.attach_guest_profile_to_scan_event()'), 'Scan-Guest-Trigger fehlt.');
assert(schema.includes('SCAN_TENANT_MISMATCH') && schema.includes('SCAN_GUEST_MISMATCH'), 'Scan-Tenant-Pruefungen fehlen.');
assert(schema.includes('create or replace function public.get_guest_profile_for_scan(p_customer_card_id uuid)'), 'Zentrale Scan-Aufloesung fehlt.');
assert(schema.includes('revoke all on function public.get_guest_profile_for_scan(uuid) from public, anon, authenticated'), 'Scan-RPC ist fuer Browserrollen nicht gesperrt.');
assert(schema.includes('grant execute on function public.get_guest_profile_for_scan(uuid) to service_role'), 'Scan-RPC ist nicht fuer den Server freigegeben.');
assert(schema.includes('alter table public.guest_profiles enable row level security'), 'RLS fuer guest_profiles fehlt.');
assert(schema.includes('unlocked operators can read own guest profiles'), 'Tenant-Read-Policy fuer guest_profiles fehlt.');
assert(schema.includes('revoke select, insert, update, delete on public.guest_profiles from anon, authenticated'), 'Guest-Tabellenrechte sind nicht restriktiv genug.');
assert(!schema.includes('grant insert on public.guest_profiles to authenticated'), 'Browser darf Gastprofile nicht direkt anlegen.');

assert(edge.includes(".rpc('get_guest_profile_for_scan'"), 'Scanner Edge Function nutzt die zentrale Guest-Aufloesung nicht.');
assert(edge.includes('guest_profile: guestProfile'), 'Scanner Edge Function liefert kein minimiertes Guest-Profil.');
assert(server.includes(".rpc('get_guest_profile_for_scan'"), 'Lokaler Scanner-Fallback nutzt die zentrale Guest-Aufloesung nicht.');
assert(server.includes('guest_profile: guestProfile'), 'Lokaler Scanner-Fallback liefert kein minimiertes Guest-Profil.');
assert(responses.includes('export function publicOperatorGuestProfile'), 'Guest-Response-Sanitizer fehlt.');
const operatorCardResponse = responses.slice(
  responses.indexOf('export function publicOperatorCard'),
  responses.indexOf('export function publicOperatorGuestProfile')
);
assert(!operatorCardResponse.includes('guest_profile_id'), 'Interne Guest-ID darf nicht pauschal in Karten-/Wallet-Antworten gelangen.');

const publicClaimCard = server.slice(server.indexOf('function publicClaimCard'), server.indexOf('const sensitiveResponseKeys'));
assert(!publicClaimCard.includes('guest_profile'), 'Oeffentliche Claim-Antwort darf keine Guest-Profile-Daten enthalten.');

console.log('Guest-Profile-Architektur, Tenant-Isolation, Backfill und Scanner-Grenzen sind statisch abgesichert.');
