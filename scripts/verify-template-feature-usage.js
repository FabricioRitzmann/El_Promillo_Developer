import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label} fehlt: ${needle}`);
  }
}

function assertAll(relativePath, label, needles) {
  const source = read(relativePath);

  for (const needle of needles) {
    assertIncludes(source, needle, `${label} (${relativePath})`);
  }
}

function assertAny(relativePath, label, needles) {
  const source = read(relativePath);

  if (!needles.some((needle) => source.includes(needle))) {
    throw new Error(`${label} (${relativePath}) fehlt eine der erwarteten Matrix-Anbindungen: ${needles.join(' | ')}`);
  }
}

assertAll('public/js/templateFeatures.js', 'Zentrale Browser/Node-Matrix', [
  'export const TEMPLATE_FEATURES',
  'export function featureEnabled',
  'export function validateScannerAction',
  'export function cardFeatureRows'
]);

assertAll('public/js/editor.js', 'Editor und Template Settings', [
  "from './templateFeatures.js'",
  'featureValue(draft, featureName)',
  'featureEnabled(draft, featureName)',
  'getTemplateFeatures(templateType)',
  'eventBackgroundImageUrl',
  'notificationsEnabled',
  'customFieldsText'
]);

assertAll('public/js/dashboard.js', 'Dashboard Kundenkarten-Uebersicht', [
  "from './templateFeatures.js'",
  'customerCardDashboardSelect',
  'select: customerCardDashboardSelect',
  "selectRows('customer_cards'",
  'cardFeatureRows(template, card)',
  "featureEnabled(template, 'balance')",
  'formatBalance',
  'data-scanner-url'
]);

assertAll('public/dashboard.html', 'Dashboard Kundenkarten-Bereich', [
  'Ausgestellte Kundenkarten',
  'customerCardList'
]);

assertAll('public/editor.html', 'Editor Feature-Gruppen', [
  'data-feature-group=',
  'data-optional-toggle=',
  'data-feature-setting=',
  'data-feature-group="eventBackgroundImage"',
  'data-feature-group="notifications"',
  'data-feature-group="customFields"'
]);

assertAll('public/js/ui.js', 'Wallet Preview', [
  'cardFeatureRows(template, card)',
  'featureEnabled(template,',
  "featureEnabled(template, 'eventBackgroundImage')",
  'walletPreviewHtml'
]);

assertAll('public/js/claim.js', 'Public Wallet Download Page', [
  "import { byId, escapeHtml, showMessage, walletPreviewHtml } from './ui.js'",
  "import { featureEnabled } from './templateFeatures.js'",
  'preview.innerHTML = walletPreviewHtml(template)',
  '/functions/v1/claim-card',
  '/functions/v1/google-wallet-save-link',
  '/functions/v1/create-topup-payment-session',
  'createGoogleWalletSaveLink',
  'createTopupPaymentSession',
  'safeGoogleWalletSaveUrl',
  'escapeHtml(cardCode)',
  'topupPanelHtml',
  "featureEnabled(template, 'balance')",
  'template.settings?.minTopupCents',
  'template.settings?.maxTopupCents',
  'getClaimWalletObjectId',
  'rememberClaimWalletObjectId',
  'walletObjectId',
  'claimCardViaEdge'
]);

assertAll('public/js/scanner.js', 'Scanner UI und Scanner-Feedback', [
  "from './templateFeatures.js'",
  'featureEnabled(template,',
  'validateScannerAction(template, action)',
  'showBlockedScannerAction',
  '/functions/v1/scanner-actions',
  'callScannerActionEdge',
  'callScannerActionLocal',
  'shouldFallbackToLocalScanner',
  "new URLSearchParams(window.location.search).get('code')"
]);

assertAll('public/scanner.html', 'Mobile Scanner-only Navigation', [
  'desktop-only-link',
  'Kundenkarte laden'
]);

assertAll('public/styles.css', 'Mobile Scanner-only Styles', [
  '.desktop-only-link',
  'display: inline-flex;',
  '.scanner-only-mode .app-tabbar a[href^="dashboard.html"]'
]);

assertAll('server/index.js', 'Server Scanner API', [
  "from '../public/js/templateFeatures.js'",
  'featureEnabled(template, featureName)',
  'validateScannerAction(template, action)'
]);

assertAll('server/index.js', 'Lokaler Claim-Reuse-Fallback', [
  'walletObjectId',
  "eq('wallet_object_id', walletObjectId)",
  "eventType = 'claim_reused'",
  'event_type: eventType'
]);

assertAll('server/index.js', 'Direkter Wallet-Pfad im lokalen Server', [
  'generateWalletAuthenticationToken',
  'legacyWalletRouteDisabled',
  'LEGACY_PASSKIT_ROUTE_DISABLED',
  'claim-apple-pass',
  'issue-apple-pass',
  'apple-wallet-webservice',
  "app.all('/api/passes/:fileName'",
  "app.all('/api/passkit/*'"
]);

assertAll('server/pdf.js', 'QR/PDF Generator', [
  "from '../public/js/templateFeatures.js'",
  'cardFeatureRows(template)',
  'templateFeatureSummary(template)'
]);

assertAll('supabase/schema.sql', 'Supabase Validierung', [
  'create or replace function public.template_feature_allowed',
  'settings_feature_enabled',
  'validate_customer_card_feature_values',
  'validate_card_instance_feature_values',
  'validate_balance_transaction_feature_allowed',
  'validate_topup_payment_session_feature_allowed',
  'validate_wallet_device_registration_consistency',
  'card_event_required_feature',
  'validate_card_event_feature_allowed',
  'wallet_update_jobs',
  'wallet_device_registrations',
  'validate_wallet_device_registrations_consistency',
  'enqueue_wallet_update_job',
  'enqueue_wallet_update_after_customer_card_change',
  'redeem_card_balance',
  'confirm_card_topup'
]);

assertAll('supabase/functions/_shared/templateFeatures.ts', 'Edge Function Matrix Helper', [
  'export const TEMPLATE_FEATURES',
  'export function featureEnabled',
  'export function assertFeatureAllowed',
  'export function validateScannerAction'
]);

[
  'supabase/functions/scanner-actions/index.ts',
  'supabase/functions/create-topup-payment-session/index.ts',
  'supabase/functions/confirm-topup-payment/index.ts',
  'supabase/functions/redeem-balance/index.ts',
  'supabase/functions/generate-card-pdf/index.ts',
  'supabase/functions/google-wallet-save-link/index.ts',
  'supabase/functions/claim-card/index.ts'
].forEach((relativePath) => {
  if (relativePath.includes('scanner-actions')) {
    assertAll(relativePath, 'Edge Function Scanner-Gate', [
      "../_shared/templateFeatures.ts",
      'validateScannerAction(template, action)',
      'validation.allowed',
      'STAMP_CARD_NOT_FULL',
      'MEMBERSHIP_STATUS_REQUIRED',
      'MEMBERSHIP_EXPIRY_REQUIRED',
      'INVALID_BALANCE_ADJUSTMENT',
      "from('customer_cards')",
      "from('card_instances')",
      "const walletSerialNumber = updatedCard.wallet_platform === 'google'",
      'wallet_serial_number: walletSerialNumber',
      "from('balance_transactions')",
      "from('card_events')",
      'error_code'
    ]);
    return;
  }

  if (relativePath.includes('redeem-balance')) {
    assertAll(relativePath, 'Edge Function Atomare Guthaben-Abbuchung', [
      "../_shared/templateFeatures.ts",
      'assertFeatureAllowed(template,',
      "rpc('redeem_card_balance'",
      'BALANCE_TOO_LOW',
      'INVALID_REDEEM_AMOUNT'
    ]);
    return;
  }

  if (relativePath.includes('create-topup-payment-session')) {
    assertAll(relativePath, 'Edge Function Topup-Session', [
      "../_shared/templateFeatures.ts",
      'assertFeatureAllowed(template,',
      "from('topup_payment_sessions')",
      'minTopupCents',
      'maxTopupCents',
      'minBalanceAmount',
      'PAYMENT_PROVIDER_NOT_CONFIGURED',
      'INVALID_TOPUP_AMOUNT',
      'TOPUP_CARD_INSTANCE_REQUIRED',
      'TOPUP_SESSION_SAVE_FAILED'
    ]);
    return;
  }

  if (relativePath.includes('google-wallet-save-link')) {
    assertAll(relativePath, 'Edge Function Google Wallet Save Link', [
      "../_shared/templateFeatures.ts",
      'featureEnabled(template,',
      'GOOGLE_WALLET_ISSUER_ID',
      'GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL',
      'GOOGLE_WALLET_PRIVATE_KEY',
      'https://pay.google.com/gp/v/save/',
      "from('customer_cards')",
      "from('card_instances')",
      "from('card_events')",
      'error_code'
    ]);
    return;
  }

  if (relativePath.includes('confirm-topup-payment')) {
    assertAll(relativePath, 'Edge Function Topup-Bestätigung', [
      "../_shared/templateFeatures.ts",
      'assertFeatureAllowed(template,',
      "rpc('confirm_card_topup'",
      'PAYMENT_WEBHOOK_SECRET',
      'PAYMENT_NOT_SUCCEEDED'
    ]);
    return;
  }

  if (relativePath.includes('claim-card')) {
    assertAll(relativePath, 'Edge Function Public Claim', [
      "../_shared/templateFeatures.ts",
      'featureEnabled(template,',
      'normalizeTemplateType(template)',
      'walletObjectId',
      'claim_reused',
      'insertClaimCardInstance',
      'insertClaimEvent',
      'CLAIM_CARD_INSTANCE_SAVE_FAILED',
      'CLAIM_CARD_EVENT_SAVE_FAILED',
      "from('customer_cards')",
      "from('card_instances')",
      "from('card_events')",
      'claim_created'
    ]);
    return;
  }

  if (relativePath.includes('generate-card-pdf')) {
    assertAll(relativePath, 'Edge Function QR/PDF', [
      "../_shared/templateFeatures.ts",
      "assertFeatureAllowed(template, 'qrPdf')",
      'featureEnabled(template,',
      "from('card_templates')",
      'QRCode.create',
      'Content-Type',
      'application/pdf',
      'claim.html?template='
    ]);
    return;
  }

  assertAll(relativePath, 'Edge Function Feature-Gate', [
    "../_shared/templateFeatures.ts",
    'assertFeatureAllowed(template,'
  ]);
});

console.log('Alle Pflichtbereiche verwenden die zentrale Template-Feature-Matrix.');
