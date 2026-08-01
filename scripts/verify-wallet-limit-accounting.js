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

function assertIncludes(source, needles, label) {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} fehlt: ${needle}`);
  }
}

const walletService = read('supabase/functions/_shared/walletNotificationService.ts');
const contextDoc = read('docs/WALLET_INTEGRATION_CONTEXT.md');
const readme = read('README.md');
const packageJson = read('package.json');

assertIncludes(walletService, [
  'const NOTIFICATION_LIMIT_ACTIONS = [',
  "'apple_pass_update'",
  "'manual_apple_push_update'",
  "'manual_apple_pass_update'",
  "'google_text_and_notify'",
  "'google_object_message_fallback'",
  "'manual_google_object_update'",
  "'google_location_object_update'",
  "'google_nearby_location_update'",
  "const NOTIFICATION_LIMIT_STATUSES = ['sent', 'queued', 'prepared']"
], 'Limit-Zähler-Aktionen');

assertIncludes(walletService, [
  'const VISIBLE_NOTIFICATION_ACTIONS = [',
  "'apple_pass_update'",
  "'manual_apple_push_update'",
  "'google_text_and_notify'",
  "const VISIBLE_NOTIFICATION_STATUSES = ['sent']"
], 'Sichtbare Benachrichtigungs-Aktionen');

const visibleActionsBlock = walletService.match(/const VISIBLE_NOTIFICATION_ACTIONS = \[[\s\S]*?\];/)?.[0] || '';
const limitActionsBlock = walletService.match(/const NOTIFICATION_LIMIT_ACTIONS = \[[\s\S]*?\];/)?.[0] || '';
assert(
  !visibleActionsBlock.includes('google_object_message_fallback')
    && !visibleActionsBlock.includes('google_location_object_update')
    && !visibleActionsBlock.includes('google_nearby_location_update'),
  'Google-Fallbacks dürfen nicht als sichtbare notification_count_24h-Pushs zählen.'
);
assert(
  !visibleActionsBlock.includes('manual_google_object_update'),
  'Manuelle Google-Object-Updates dürfen nicht als sichtbare notification_count_24h-Pushs zählen.'
);
assert(
  !visibleActionsBlock.includes('manual_duplicate_skipped')
    && !limitActionsBlock.includes('manual_duplicate_skipped'),
  'Uebersprungene manuelle Duplikate dürfen keine Tageslimits oder sichtbaren Push-Zähler verbrauchen.'
);
assert(
  !visibleActionsBlock.includes('campaign_duplicate_skipped')
    && !limitActionsBlock.includes('campaign_duplicate_skipped'),
  'Uebersprungene Kampagnen-Duplikate dürfen keine Tageslimits oder sichtbaren Push-Zähler verbrauchen.'
);

assertIncludes(walletService, [
  'function visibleNotificationWasSent(status: string, recipient: Row, providerResult: Row)',
  "if (status !== 'sent')",
  "if (recipient.wallet_platform === 'apple')",
  'return Boolean(providerResult.push?.ok)',
  "if (recipient.wallet_platform === 'google' && providerResult.fallback)",
  'return false'
], 'Sichtbare Push-Erkennung');

assertIncludes(walletService, [
  'manualWalletDuplicateKey',
  'recentManualDuplicateWalletLog',
  'logManualDuplicateSkipped',
  'manual_duplicate_skipped',
  "request_payload->>manual_duplicate_key",
  ".in('status', ['processing', 'queued', 'prepared', 'sent'])",
], 'Manuelle Duplicate-Sends');

assertIncludes(walletService, [
  'campaignDuplicatePlatforms',
  'logCampaignDuplicateSkipped',
  'campaign_duplicate_skipped',
  'duplicate_scope',
  'duplicate_campaign_id',
  'Identische Wallet-Kampagne'
], 'Kampagnen-Duplicate-Audit');

assertIncludes(walletService, [
  "customerDailyLimit: positiveInteger(Deno.env.get('WALLET_CUSTOMER_DAILY_LIMIT'), 12)",
  'function customerLimitIdentity(cardInstance: Row)',
  'async function loadCustomerLimitCardInstanceIds(context: Row, cardInstance: Row)',
  ".eq(identity.type, identity.value)",
  "error_code: 'CUSTOMER_DAILY_LIMIT_REACHED'",
  'customerRemaining: Math.max(0, customerDailyLimit - (customerCount || 0))',
  'customerLimitKey: customerLimit.identity.key',
  'simulatedCustomerRemainingByKey',
  'CUSTOMER_DAILY_LIMIT_REACHED'
], 'Kunden-Tageslimit');

assertIncludes(walletService, [
  '.from(\'wallet_push_logs\')',
  ".in('status', NOTIFICATION_LIMIT_STATUSES)",
  ".in('action', NOTIFICATION_LIMIT_ACTIONS)",
  ".in('card_instance_id', customerLimit.cardInstanceIds)",
  ".gte('created_at', since)",
  ".eq('wallet_platform', 'google')",
  ".eq('action', 'google_text_and_notify')",
  ".eq('status', 'sent')"
], 'Platform-Limit-Queries');

assertIncludes(walletService, [
  'updatePayload.notification_count_24h = count || 0',
  ".eq('card_instance_id', cardInstanceId)",
  ".in('status', VISIBLE_NOTIFICATION_STATUSES)",
  ".in('action', VISIBLE_NOTIFICATION_ACTIONS)",
  'countNotifications: visibleNotification',
  'walletUpdated: walletUpdateWasPrepared(status, providerResult)',
  'card_wallet_state_sync_failed',
  'provider_action: action',
  'visibleNotification'
], 'Karten-Wallet-State-Zähler');

assertIncludes(contextDoc, [
  'NOTIFICATION_LIMIT_ACTIONS',
  'VISIBLE_NOTIFICATION_ACTIONS',
  'WALLET_CUSTOMER_DAILY_LIMIT',
  'customer_id',
  'customer_card_id',
  'Google-Fallbacks',
  'notification_count_24h'
], 'Kontextdoku Limit Accounting');

assertIncludes(readme, [
  'verify-wallet-limit-accounting.js',
  'WALLET_CUSTOMER_DAILY_LIMIT',
  'Google-Fallbacks'
], 'README Limit Accounting Check');

assert(
  packageJson.includes('verify-wallet-limit-accounting.js'),
  'package.json muss verify-wallet-limit-accounting.js in pnpm check ausführen.'
);

console.log('Wallet-Limit-Accounting trennt Tageslimits, sichtbare Pushs und Google-Fallbacks statisch korrekt.');
