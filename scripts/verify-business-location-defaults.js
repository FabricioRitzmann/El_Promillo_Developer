import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function includes(source, needle, label) {
  assert(source.includes(needle), `${label}: ${needle}`);
}

const accountHtml = read('public/account.html');
const accountJs = read('public/js/account.js');
const i18nJs = read('public/js/i18n.js');
const editorJs = read('public/js/editor.js');
const schemaSql = read('supabase/schema.sql');

[
  'name="location_lat"',
  'name="location_lng"',
  'min="-90"',
  'max="90"',
  'min="-180"',
  'max="180"'
].forEach((needle) => includes(accountHtml, needle, 'Konto muss Standortkoordinaten erfassen'));

[
  "'location_lat'",
  "'location_lng'",
  'numberOrNull(formData.get(\'location_lat\'))',
  'numberOrNull(formData.get(\'location_lng\'))',
  "t('account.latitudeInvalid')",
  "t('account.longitudeInvalid')"
].forEach((needle) => includes(accountJs, needle, 'Konto muss Koordinaten laden, validieren und speichern'));

[
  'Latitude muss zwischen -90 und 90 liegen.',
  'Longitude muss zwischen -180 und 180 liegen.'
].forEach((needle) => includes(i18nJs, needle, 'Konto muss Standort-Fehlermeldungen uebersetzen'));

[
  "'location_lat'",
  "'location_lng'",
  'function applyBusinessLocationDefaults',
  "businessLocationValue('location_lat')",
  "businessLocationValue('location_lng')",
  "sendType === 'location_based'",
  "notificationField('send_type')?.value === 'location_based'"
].forEach((needle) => includes(editorJs, needle, 'Editor muss Konto-Koordinaten für standortbasierte Pushs uebernehmen'));

[
  'location_lat numeric',
  'location_lng numeric',
  'businesses_location_lat_check',
  'businesses_location_lng_check',
  'location_lat,\n  location_lng,\n  phone',
  'alter table public.businesses\nadd column if not exists location_lat numeric,\nadd column if not exists location_lng numeric;'
].forEach((needle) => includes(schemaSql, needle, 'SQL muss Business-Koordinaten und Browser-Grants enthalten'));

console.log('Business-Standortkoordinaten und Push-Defaults sind statisch abgesichert.');
