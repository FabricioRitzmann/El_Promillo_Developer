import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const schema = read('supabase/schema.sql');
const editor = read('public/js/editor.js');
const scanner = read('public/js/scanner.js');
const html = read('public/editor.html');
const edge = read('supabase/functions/scanner-actions/index.ts');
const apple = read('supabase/functions/_shared/appleWalletProvider.ts');
const google = read('supabase/functions/_shared/googleWalletProvider.ts');
const samsung = read('supabase/functions/_shared/samsungWalletProvider.ts');

const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(schema.includes('create table if not exists public.card_visit_events ('), 'ENTRY_SCAN-Ereignistabelle fehlt.');
assert(schema.includes("event_type text not null default 'ENTRY_SCAN'"), 'Eindeutiger ENTRY_SCAN-Eventtyp fehlt.');
assert(schema.includes('create or replace function public.register_card_entry_visit('), 'Atomare Besuchs-RPC fehlt.');
assert(schema.includes('for update') && schema.includes('card_visit_events_card_key unique'), 'Concurrency-/Idempotency-Schutz fehlt.');
assert(schema.includes('create table if not exists public.card_visit_milestones ('), 'Einmalige Meilensteine fehlen.');
assert(schema.includes('card_visit_milestones_once unique'), 'Meilenstein kann mehrfach ausgeloest werden.');
assert(schema.includes("'visit_counter_update'"), 'Bestehende Wallet-Update-Queue wird nicht genutzt.');
assert(html.includes('Besuchszähler aktivieren') && html.includes('Meilensteine (kommagetrennt)'), 'Editorbereich fehlt.');
assert(editor.includes('visitCounterWalletVisible') && editor.includes('visitMilestones'), 'Editor speichert Besuchsoptionen nicht.');
assert(scanner.includes('crypto.randomUUID()') && scanner.includes('result.visit_stats?.milestone_reached'), 'Scanner-Idempotency oder Popup fehlt.');
assert(edge.includes("normalizedAction === 'visit'") && edge.includes('registerEntryVisit'), 'Scanner-Backend registriert keinen atomaren Eintritt.');
for (const provider of [apple, google, samsung]) assert(provider.includes('lifetime_visits'), 'Wallet-Provider zeigt Besuchszaehler nicht an.');
console.log('Besuchszaehler, ENTRY_SCAN-Idempotency, Meilensteine und Wallet-Integration sind statisch abgesichert.');
