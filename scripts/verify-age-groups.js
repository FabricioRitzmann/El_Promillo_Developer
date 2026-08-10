import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const preciseGroups = ['18_24', '25_29', '30_39', '40_49', '50_59', '60_69', '70_plus'];
const legacyGroups = ['18_plus', '25_plus', '30_plus'];
const schema = read('supabase/schema.sql');
const scannerHtml = read('public/scanner.html');
const dashboardHtml = read('public/dashboard.html');
const dashboardJs = read('public/js/dashboard.js');
const scannerEdge = read('supabase/functions/scanner-actions/index.ts');
const statsEdge = read('supabase/functions/get-business-scan-statistics/index.ts');
const server = read('server/index.js');

for (const group of preciseGroups) {
  assert(schema.includes(`'${group}'`), `Schema unterstützt ${group} nicht.`);
  assert(scannerHtml.includes(`value="${group}"`), `Erstscan-Auswahl enthält ${group} nicht.`);
  assert(dashboardHtml.includes(`value="${group}"`), `Dashboard-Filter enthält ${group} nicht.`);
  assert(dashboardJs.includes(`'${group}'`), `Dashboard-Auswertung enthält ${group} nicht.`);
  assert(scannerEdge.includes(`'${group}'`), `Scanner Edge Function akzeptiert ${group} nicht.`);
  assert(statsEdge.includes(`'${group}'`), `Statistik Edge Function aggregiert ${group} nicht.`);
  assert(server.includes(`'${group}'`), `Lokaler Fallback unterstützt ${group} nicht.`);
}

for (const group of legacyGroups) {
  assert(schema.includes(`'${group}'`), `Legacy-Wert ${group} würde vom Schema verworfen.`);
  assert(dashboardHtml.includes(`value="${group}"`), `Legacy-Wert ${group} ist nicht mehr filterbar.`);
  assert(dashboardJs.includes(`'${group}': 'Legacy`), `Legacy-Wert ${group} ist nicht eindeutig gekennzeichnet.`);
  assert(statsEdge.includes(`'${group}': 'Legacy`), `Statistik kennzeichnet ${group} nicht als Legacy.`);
}

assert(!scannerHtml.includes('value="18_plus"'), 'Neue Erstscan-Erfassung darf den überlappenden Legacy-Wert 18_plus nicht anbieten.');
assert(!scannerHtml.includes('value="25_plus"'), 'Neue Erstscan-Erfassung darf den überlappenden Legacy-Wert 25_plus nicht anbieten.');
assert(!scannerHtml.includes('value="30_plus"'), 'Neue Erstscan-Erfassung darf den überlappenden Legacy-Wert 30_plus nicht anbieten.');
assert(!scannerEdge.match(/demographicAgeGroups[^;]+18_plus/s), 'Neue Edge-Erfassung darf Legacy-Altersgruppen nicht akzeptieren.');
assert(!server.match(/demographicAgeGroups[^;]+18_plus/s), 'Neuer lokaler Erstscan darf Legacy-Altersgruppen nicht akzeptieren.');
assert(!schema.match(/update\s+public\.(guest_profiles|card_instances|scan_events)[\s\S]{0,300}age_group\s*=/i), 'Migration darf bestehende Altersgruppen nicht heuristisch umschreiben.');

console.log('Eindeutige Altersgruppen und verlustfreie Legacy-Kompatibilität sind statisch abgesichert.');
