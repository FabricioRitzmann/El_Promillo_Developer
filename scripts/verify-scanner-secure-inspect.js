import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(rootDir, file), 'utf8');
const scanner = read('public/js/scanner.js');
const edge = read('supabase/functions/scanner-actions/index.ts');
const server = read('server/index.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!scanner.includes("selectRows('card_instances'"), 'Browser-Scanner darf card_instances nicht direkt lesen.');
assert(scanner.includes('callScannerRequest({') && scanner.includes("action: 'inspect'"), 'Kartenscan muss die abgesicherte Inspect-API nutzen.');
assert(scanner.includes("action: 'inspect',\n      cardId: card.id"), 'Apple-Wallet-Abruf muss die Karteninstanz sicher nachladen können.');
assert(edge.includes("if (action === 'inspect')"), 'Scanner Edge Function braucht den Inspect-Modus.');
assert(edge.includes("card: publicOperatorCard(card)"), 'Inspect darf nur die bereinigte Betreiber-Kartenantwort liefern.');
assert(edge.includes("card_instance: {"), 'Inspect muss sichere Karteninstanzdaten liefern.');
assert(server.includes("if (action === 'inspect')"), 'Render-Fallback braucht denselben Inspect-Modus.');
assert(server.includes(".eq('customer_code', code)"), 'Render-Fallback muss Kundencodes laden.');
assert(server.includes(".eq('card_instance_number', code)"), 'Render-Fallback muss Karten-IDs laden.');

console.log('Scanner lädt card_instances ausschliesslich über abgesicherte Serverpfade.');
