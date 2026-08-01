import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, needle, message) {
  assert(source.includes(needle), `${message}: ${needle}`);
}

const schema = read('supabase/schema.sql');
const server = read('server/index.js');
const scannerEdge = read('supabase/functions/scanner-actions/index.ts');
const statsEdge = read('supabase/functions/get-business-scan-statistics/index.ts');
const scannerHtml = read('public/scanner.html');
const scannerJs = read('public/js/scanner.js');
const dashboardHtml = read('public/dashboard.html');
const dashboardJs = read('public/js/dashboard.js');
const testData = read('supabase/test-data.sql');
const deployScript = read('scripts/deploy-wallet-functions.sh');

[
  'create table if not exists public.scan_events',
  'demographics_collected boolean default false',
  'customer_gender text',
  'customer_age_group text',
  'first_scanned_at timestamptz',
  'scan_count integer default 0',
  'scan_event_id uuid references public.scan_events',
  'scan_events_customer_gender_check',
  'unlocked operators can read own scan events',
  'revoke select, insert, update, delete on public.scan_events from authenticated'
].forEach((needle) => assertIncludes(schema, needle, 'Schema muss Erstscan-Demografie und scan_events absichern'));

[
  'requires_demographics',
  'normalizeDemographics',
  'loadLocalCardInstanceForScan',
  'insertLocalScanEvent',
  'CLUB_FEATURE_NOT_ENABLED',
  'demographics_were_collected',
  'scan_count',
  "app.post('/api/statistics/scans'"
].forEach((needle) => assertIncludes(server, needle, 'Lokaler Node-Fallback muss Erstscan und Statistik unterstützen'));

[
  'requires_demographics',
  'normalizeDemographics',
  'loadCardInstanceForScan',
  'insertScanEvent',
  'CLUB_FEATURE_NOT_ENABLED',
  'demographics_were_collected',
  'scan_count'
].forEach((needle) => assertIncludes(scannerEdge, needle, 'Scanner Edge Function muss Erstscan und scan_events unterstützen'));

[
  'get-business-scan-statistics',
  'buildBusinessScanStatistics',
  'BUSINESS_FORBIDDEN',
  'scan_events',
  'club_feature_combinations',
  'last_scans'
].forEach((needle) => assertIncludes(statsEdge, needle, 'Statistik Edge Function muss sichere aggregierte Besucherstatistik liefern'));

[
  'demographicsModal',
  'Erster Besuch erfassen',
  'Speichern und Scan fortsetzen',
  'Hinweis: Diese Erfassung dient der anonymisierten Besucherstatistik'
].forEach((needle) => assertIncludes(scannerHtml, needle, 'Scanner HTML muss Pflichtdialog und Datenschutzhinweis enthalten'));

[
  'showDemographicsModal',
  'continuePendingDemographics',
  'requires_demographics',
  'pendingDemographicsAction',
  'active_club_features'
].forEach((needle) => assertIncludes(scannerJs, needle, 'Scanner JS muss Erstscan-Fortsetzen-Flow enthalten'));

['accessStatusModal', 'VIP-/Mitgliedschaft erkannt', 'accessStatusItems', 'accessStatusClose']
  .forEach((needle) => assertIncludes(scannerHtml, needle, 'Scanner HTML muss den Eintrittshinweis für VIP und Mitgliedschaft enthalten'));

['scannerAccessHighlights', 'showAccessStatusModal', 'showAccessStatusModal(card)', 'navigator.vibrate([120, 50, 120])']
  .forEach((needle) => assertIncludes(scannerJs, needle, 'Scanner JS muss VIP- und Mitgliedschaftsdaten direkt nach dem Kartenladen hervorheben'));

[
  'Besucherstatistik',
  'statsFilterForm',
  'statsKpiGrid',
  'statsCharts',
  'lastScansTable',
  'Hinweis: Diese Erfassung dient der anonymisierten Besucherstatistik'
].forEach((needle) => assertIncludes(dashboardHtml, needle, 'Dashboard muss Besucherstatistik-UI enthalten'));

[
  'callStatisticsEdge',
  'callStatisticsLocal',
  'get-business-scan-statistics',
  'renderStatsKpis',
  'renderStatsCharts',
  'renderLastScans',
  'club_feature'
].forEach((needle) => assertIncludes(dashboardJs, needle, 'Dashboard JS muss Statistikfilter und Rendering enthalten'));

[
  'insert into public.scan_events',
  'demographics_collected = true',
  "'male'",
  "'female'",
  "'18_plus'",
  "'25_plus'",
  "'30_plus'",
  'insert into public.club_card_actions',
  'scan_event_id'
].forEach((needle) => assertIncludes(testData, needle, 'Testdaten müssen Demografie, Scans und Clubaktionen abdecken'));

assertIncludes(deployScript, 'get-business-scan-statistics', 'Deploy-Script muss die Statistik Edge Function deployen');

console.log('Erstscan-Demografie und Besucherstatistik sind statisch abgesichert.');
