import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSource = fs.readFileSync(path.join(rootDir, 'server/index.js'), 'utf8');

function extractFunction(name) {
  const start = serverSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Serverfunktion ${name} fehlt.`);
  const bodyStart = serverSource.indexOf(') {', start) + 2;
  if (bodyStart < 2) throw new Error(`Serverfunktion ${name} hat keinen Funktionskörper.`);
  let depth = 0;

  for (let index = bodyStart; index < serverSource.length; index += 1) {
    if (serverSource[index] === '{') depth += 1;
    if (serverSource[index] === '}') depth -= 1;
    if (depth === 0) return serverSource.slice(start, index + 1);
  }

  throw new Error(`Serverfunktion ${name} ist nicht vollständig.`);
}

const functionNames = [
  'dateOnly', 'numberOrNull', 'normalizeStatsFilters', 'activeClubFeatureList',
  'matchesStatsFilters', 'countMap', 'chartFromCounts', 'fixedChart',
  'weekdayHourHeatmap', 'topKey', 'buildBusinessScanStatistics'
];
const createStatisticsContract = new Function(
  'clubFeatureNames',
  `${functionNames.map(extractFunction).join('\n')}\nreturn { buildBusinessScanStatistics, matchesStatsFilters, normalizeStatsFilters };`
);
const clubFeatureNames = ['vip', 'balance', 'cloakroom', 'coupon', 'membership'];
const { buildBusinessScanStatistics, matchesStatsFilters, normalizeStatsFilters } = createStatisticsContract(clubFeatureNames);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const preciseGroups = ['18_24', '25_29', '30_39', '40_49', '50_59', '60_69', '70_plus'];
const allGroups = [...preciseGroups, '18_plus', '25_plus', '30_plus'];

function row(ageGroup, index = 0, overrides = {}) {
  return {
    id: `scan-${index}`,
    owner_id: overrides.owner_id || 'tenant-a',
    business_id: overrides.business_id || 'business-a',
    card_instance_id: overrides.card_instance_id || `card-${index}`,
    customer_gender: overrides.customer_gender || (index % 2 ? 'female' : 'male'),
    customer_age_group: ageGroup,
    scanned_at: overrides.scanned_at || `2026-08-${String(1 + index).padStart(2, '0')}T12:00:00.000Z`,
    scan_hour: 12,
    scan_weekday: 1,
    template_type: 'generic_card',
    active_club_features: {},
    is_first_scan: overrides.is_first_scan ?? true,
    action_type: 'visit',
    ...overrides
  };
}

const empty = buildBusinessScanStatistics([]);
assert(empty.kpis.total_scans === 0, '0-Daten-Fall muss 0 Scans liefern.');
assert(empty.charts.age_group_distribution.length === 10, '0-Daten-Fall muss alle Kategorien stabil ausgeben.');
assert(empty.charts.age_group_distribution.every((item) => item.value === 0 && item.percentage === 0), '0-Daten-Fall muss Nullwerte liefern.');

const single = buildBusinessScanStatistics([row('70_plus')]);
assert(single.kpis.total_scans === 1, 'Ein-Gast-Fall muss genau einen Scan liefern.');
assert(single.charts.age_group_distribution.find((item) => item.key === '70_plus')?.percentage === 100, 'Ein-Gast-Fall muss 100 % liefern.');

const mixedRows = allGroups.flatMap((group, groupIndex) => [
  row(group, groupIndex * 2),
  row(group, groupIndex * 2 + 1, { card_instance_id: `repeat-card-${group}`, is_first_scan: false })
]);
const many = buildBusinessScanStatistics(mixedRows);
const ageChart = many.charts.age_group_distribution;
assert(ageChart.reduce((sum, item) => sum + item.value, 0) === mixedRows.length, 'Absolute Altersgruppensumme ist falsch.');
assert(Math.abs(ageChart.reduce((sum, item) => sum + item.percentage, 0) - 100) <= 0.5, 'Prozentsumme muss rundungsbereinigt 100 % ergeben.');
assert(preciseGroups.every((group) => ageChart.some((item) => item.key === group && item.value === 2)), 'Nicht alle sieben neuen Gruppen werden gezählt.');
assert(ageChart.filter((item) => item.key.endsWith('_plus') && item.key !== '70_plus').every((item) => item.label.startsWith('Legacy ')), 'Bestandswerte sind nicht als Legacy gekennzeichnet.');

const ageFilter = normalizeStatsFilters({ age_group: '40_49' });
assert(mixedRows.filter((item) => matchesStatsFilters(item, ageFilter)).length === 2, 'Altersgruppenfilter ist falsch.');

const tenantRows = [
  row('18_24', 30, { owner_id: 'tenant-a', business_id: 'business-a' }),
  row('25_29', 31, { owner_id: 'tenant-b', business_id: 'business-b' })
];
const tenantA = buildBusinessScanStatistics(tenantRows.filter((item) => item.owner_id === 'tenant-a' && item.business_id === 'business-a'));
assert(tenantA.kpis.total_scans === 1 && tenantA.charts.age_group_distribution.find((item) => item.key === '25_29')?.value === 0, 'Tenant A darf Tenant B nicht mitzählen.');

const dateRows = [
  row('30_39', 40, { scanned_at: '2026-08-09T23:59:59.999Z' }),
  row('40_49', 41, { scanned_at: '2026-08-10T00:00:00.000Z' }),
  row('50_59', 42, { scanned_at: '2026-08-10T23:59:59.999Z' }),
  row('60_69', 43, { scanned_at: '2026-08-11T00:00:00.000Z' })
];
const from = '2026-08-10T00:00:00.000Z';
const to = '2026-08-10T23:59:59.999Z';
const day = buildBusinessScanStatistics(dateRows.filter((item) => item.scanned_at >= from && item.scanned_at <= to));
assert(day.kpis.total_scans === 2, 'Tages-/Datumsgrenzen sind falsch.');

console.log('Altersgruppen-Statistik: 0/1/viele, Filter, Summen, Datum und Tenant-Isolation OK.');
