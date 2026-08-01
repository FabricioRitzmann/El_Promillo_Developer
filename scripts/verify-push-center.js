import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label}: ${needle}`);
  }
}

const pushHtml = read('public/push-center.html');
const pushJs = read('public/js/pushCenter.js');
const editorHtml = read('public/editor.html');
const editorJs = read('public/js/editor.js');
const styles = read('public/styles.css');
const schema = read('supabase/schema.sql');
const service = read('supabase/functions/_shared/walletNotificationService.ts');
const rules = read('supabase/functions/_shared/walletNotificationRules.ts');
const manager = read('supabase/functions/manage-wallet-notification-rule/index.ts');
const processor = read('supabase/functions/process-wallet-notification-rules/index.ts');
const cron = read('supabase/cron.example.sql');
const deploy = read('scripts/deploy-wallet-functions.sh');

[
  'id="notificationRuleEditor"',
  'name="trigger_type"',
  'value="recurring"',
  'value="location_based"',
  'name="recurring_weekdays"',
  'name="location_weekdays"',
  'name="active_from_time"',
  'name="active_until_time"',
  'id="notificationRuleList"',
  'id="pushCampaignHistory"',
  'data-rule-filter="paused"',
  'name="use_event_location"'
].forEach((needle) => assertIncludes(pushHtml, needle, 'Push Center Oberfläche ist unvollständig'));

[
  'function recurrenceText',
  'function rulePayload',
  "action: 'set_status'",
  "action: 'duplicate'",
  "action: 'archive'",
  'useEventLocation',
  'eventLocationLat',
  "selectRows('wallet_notification_rules'"
].forEach((needle) => assertIncludes(pushJs, needle, 'Push Center Logik ist unvollständig'));

[
  'create table if not exists public.wallet_notification_rules',
  "trigger_type text not null check (trigger_type in ('recurring', 'location_based'))",
  'next_run_at timestamptz',
  'location_active_until_at timestamptz',
  'notification_rule_id uuid references public.wallet_notification_rules',
  'unlocked operators can read own wallet notification rules'
].forEach((needle) => assertIncludes(schema, needle, 'Push Center Datenmodell ist unvollständig'));

[
  'export function nextRuleRunAt',
  'export function locationWindowEndAt',
  "recurrence === 'biweekly'",
  "timeZone"
].forEach((needle) => assertIncludes(rules, needle, 'Wiederholungsberechnung ist unvollständig'));

[
  "action === 'create'",
  "action === 'update'",
  "action === 'duplicate'",
  "action === 'set_status'",
  "action === 'archive'",
  'locationContextForRule'
].forEach((needle) => assertIncludes(manager, needle, 'Regelverwaltung ist unvollständig'));

[
  "from('wallet_notification_rules')",
  'nextRuleRunAt(rule, dueAt)',
  'locationWindowEndAt(rule, dueAt)',
  'walletNotificationService.createCampaign',
  'walletNotificationService.setLocationRuleActive'
].forEach((needle) => assertIncludes(processor, needle, 'Regelprozessor ist unvollständig'));

[
  'async setLocationRuleActive',
  'merchantLocations',
  "notificationRuleId"
].forEach((needle) => assertIncludes(service, needle, 'Wallet Provider Anbindung ist unvollständig'));

[
  'name="event_location_latitude"',
  'name="event_location_longitude"',
  'id="openPushCenterLink"'
].forEach((needle) => assertIncludes(editorHtml, needle, 'Event-/Editor-Anbindung ist unvollständig'));

[
  'eventLocationLatitude',
  'eventLocationLongitude',
  'push-center.html?new=1'
].forEach((needle) => assertIncludes(editorJs, needle, 'Event-/Editor-Logik ist unvollständig'));

assertIncludes(styles, '.notification-rule-card', 'Push Center Styling fehlt');
assertIncludes(cron, 'wallet-process-notification-rules', 'Cron-Regelprozessor fehlt');
assertIncludes(deploy, 'process-wallet-notification-rules', 'Regelprozessor fehlt im Deployment');
assertIncludes(deploy, 'manage-wallet-notification-rule', 'Regelverwaltung fehlt im Deployment');

['dashboard', 'editor', 'scanner', 'account'].forEach((page) => {
  assertIncludes(read(`public/${page}.html`), 'href="push-center.html"', `${page} Tabbar muss das Push Center verlinken`);
});

console.log('Push Center, Wiederholungsregeln und Standort-Zeitfenster sind statisch abgesichert.');

