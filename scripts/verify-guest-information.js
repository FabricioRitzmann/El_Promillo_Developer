import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const schema = read('supabase/schema.sql');
const edge = read('supabase/functions/scanner-actions/index.ts');
const server = read('server/index.js');
const scanner = read('public/js/scanner.js');
const html = read('public/scanner.html');
const account = read('public/js/account.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(schema.includes('create table if not exists public.guest_regular_information ('), 'Getrennte Stammgastinformationen fehlen.');
assert(schema.includes('create table if not exists public.guest_notes ('), 'Chronologische Gastnotizen fehlen.');
assert(schema.includes("priority in ('NORMAL', 'IMPORTANT', 'WARNING')"), 'Notizprioritaeten sind unvollstaendig.');
assert(schema.includes('create table if not exists public.guest_note_events ('), 'Notiz-Audit fehlt.');
assert(schema.includes("event_type in ('CREATED', 'UPDATED', 'DELETED')"), 'Notiz-Audittypen sind unvollstaendig.');
assert(schema.includes('deleted_at timestamptz') && schema.includes('prevent_guest_notes_delete'), 'Soft-Delete bzw. Hard-Delete-Schutz fehlt.');
assert(schema.includes('create or replace function public.manage_guest_regular_information('), 'Stammgast-RPC fehlt.');
assert(schema.includes('create or replace function public.manage_guest_note('), 'Notiz-RPC fehlt.');
assert(schema.includes('create or replace function public.get_guest_information_for_scan('), 'Scan-Kontext-RPC fehlt.');
assert(schema.includes('business members can read guest notes'), 'Tenant-RLS fuer Gastnotizen fehlt.');
assert(schema.includes('revoke all on function public.manage_guest_note') && schema.includes('to service_role'), 'Notiz-RPC ist nicht service-role-only.');

for (const source of [edge, server]) {
  assert(source.includes("['regular-info-save', 'guest-note-create', 'guest-note-update', 'guest-note-delete']"), 'Gastinformations-Aktionen fehlen im Backend.');
  assert(source.includes('can_edit_regular_information') && source.includes('can_create_note'), 'Rollenrechte fehlen im Backend.');
  assert(source.includes('guest_information:'), 'Scannerantwort enthaelt keinen Gastinformationskontext.');
}

assert(account.includes('regular_info_auto_show') && account.includes('notes_auto_show_warning'), 'Firmeneinstellungen fuer Auto-Anzeige fehlen.');
assert(html.includes('id="regularInfoModal"') && html.includes('id="guestNoteModal"'), 'Scanner-Editoren fehlen.');
assert(html.includes('id="guestNotificationModal"'), 'Zentrales Hinweis-Modal fehlt.');
assert(scanner.includes("addNotes('WARNING'") && scanner.indexOf("addNotes('WARNING'") < scanner.indexOf('regular_info_auto_show'), 'Warnungen stehen nicht vor Stammgastinformationen.');
assert(scanner.includes("addNotes('IMPORTANT'") && scanner.includes("addNotes('NORMAL'"), 'Wichtige oder normale Auto-Hinweise fehlen.');
assert(schema.includes('order by note.created_at desc'), 'Notizen sind nicht neueste-zuerst sortiert.');
assert(!scanner.includes('window.alert('), 'Hinweisfolge darf keinen alert()-Stapel verwenden.');

console.log('Stammgastinformationen, Gastnotizen, Rollen, Audit, Auto-Anzeige und Hinweisprioritaet sind statisch abgesichert.');
