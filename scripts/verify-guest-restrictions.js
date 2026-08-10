import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(rootDir, file), 'utf8');
const schema = read('supabase/schema.sql');
const edge = read('supabase/functions/scanner-actions/index.ts');
const server = read('server/index.js');
const scanner = read('public/js/scanner.js');
const html = read('public/scanner.html');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(schema.includes('create table if not exists public.guest_restrictions ('), 'Restriction-Tabelle fehlt.');
assert(schema.includes("restriction_type in ('HOUSE_BAN', 'CASINO_BAN')"), 'Haus- und Casinosperre sind nicht getrennt.');
assert(schema.includes('create table if not exists public.guest_restriction_events ('), 'Restriction-Audit-Historie fehlt.');
assert(schema.includes("event_type in ('CREATED', 'UPDATED', 'LIFTED')"), 'Audit-Eventtypen sind unvollstaendig.');
assert(schema.includes('create table if not exists public.business_memberships ('), 'Vorhandene Auth-Struktur ist nicht um Business-Rollen erweitert.');
assert(schema.includes("role in ('admin', 'manager', 'security', 'staff')"), 'Rollenmodell ist unvollstaendig.');
assert(schema.includes('create or replace function public.manage_guest_restriction('), 'Atomare Restriction-Management-RPC fehlt.');
assert(schema.includes('create or replace function public.get_guest_restrictions_for_scan('), 'Zentrale Scan-Restriction-Aufloesung fehlt.');
assert(schema.includes('RESTRICTION_DELETE_FORBIDDEN'), 'Restriktionen sind nicht gegen Hard Delete geschuetzt.');
assert(schema.includes('business members can read guest restrictions'), 'Tenant-RLS fuer Restriktionen fehlt.');
assert(schema.includes('Keine Browser-Schreibpolicies'), 'Serverseitige Schreibgrenze ist nicht dokumentiert.');
assert(schema.includes('revoke all on function public.manage_guest_restriction') && schema.includes('to service_role'), 'Management-RPC ist nicht service-role-only.');

for (const source of [edge, server]) {
  assert(source.includes("['restriction-create', 'restriction-update', 'restriction-lift']"), 'Restriction-Aktionen fehlen im Scanner-Backend.');
  assert(source.includes('requires_restriction_acknowledgement'), 'Backend erzwingt keine Warnbestaetigung vor Scanner-Aktionen.');
  assert(source.includes('guest_restrictions:'), 'Scanner-Antwort liefert keinen Gaststatus.');
  assert(source.includes('can_view_internal_note'), 'Rollenbasierte Redaction interner Bemerkungen fehlt.');
}

assert(html.includes('id="restrictionWarningModal"'), 'Deutliches Restriction-Warnmodal fehlt.');
assert(html.includes('id="restrictionEditorModal"'), 'Restriction-Editor-Modal fehlt.');
assert(scanner.includes('restrictionStatusHtml'), 'Gaststatus-Bereich fehlt im Scanner.');
assert(scanner.includes('state.pendingRestrictionAction'), 'Bestaetigte Fortsetzung der Scanner-Aktion fehlt.');
assert(scanner.includes('Weiter zur Bestätigung') && scanner.includes('Jetzt verbindlich speichern'), 'Zweistufige Speicherbestaetigung fehlt.');
assert(!scanner.includes('window.alert('), 'Scanner darf keinen alert()-Stapel fuer Restriktionen verwenden.');

console.log('Guest Restrictions, Rollen, Audit, Warnbestaetigung und Tenant-Grenzen sind statisch abgesichert.');
