import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const functionsDir = path.join(rootDir, 'supabase', 'functions');

const requiredWalletPromptFunctions = [
  'issue-apple-pass',
  'apple-wallet-webservice',
  'update-apple-pass',
  'send-apple-wallet-update',
  'issue-google-wallet-pass',
  'update-google-wallet-pass',
  'send-google-wallet-message',
  'create-wallet-notification-campaign',
  'send-wallet-notification',
  'process-scheduled-wallet-notifications',
  'process-wallet-update-queue',
  'resolve-wallet-notification-recipients',
  'check-wallet-notification-limits'
];

const walletOperatorFunctions = [
  'create-wallet-notification-campaign',
  'send-wallet-notification',
  'resolve-wallet-notification-recipients',
  'check-wallet-notification-limits',
  'issue-apple-pass',
  'update-apple-pass',
  'send-apple-wallet-update',
  'issue-google-wallet-pass',
  'update-google-wallet-pass',
  'send-google-wallet-message'
];

const automationFunctions = [
  'process-scheduled-wallet-notifications',
  'process-wallet-update-queue'
];

const serviceRoleOperatorFunctions = [
  'confirm-topup-payment',
  'generate-card-pdf',
  'redeem-balance',
  'scanner-actions'
];

const publicServiceRoleFunctions = {
  'claim-card': [
    'validateWalletObjectId(walletObjectId)',
    'CLAIM_WALLET_OBJECT_ID_REQUIRED',
    'publicClaimCard(card)'
  ],
  'get-public-template': [
    'publicCardTemplateResponse(template)',
    'CLAIM_LINK_REQUIRED',
    'get-public-template'
  ],
  'get-wallet-message': [
    'verifyWalletMessageToken(cardInstance, token)',
    'MESSAGE_LINK_INVALID',
    'enforcePublicClaimRateLimit(supabaseAdmin, request, \'get-wallet-message\'',
    'walletMessageLinkPayload'
  ],
  'claim-apple-pass': [
    'walletObjectId',
    'APPLE_CLAIM_TOKEN_MISMATCH',
    'passJsonHasAppleWebServiceFields'
  ],
  'google-wallet-save-link': [
    'walletObjectId',
    'GOOGLE_CLAIM_TOKEN_MISMATCH',
    'https://pay.google.com/gp/v/save/'
  ],
  'register-operator': [
    'validateOperatorEmail(body.email)',
    'DISPOSABLE_EMAIL_DOMAINS',
    'supabaseAdmin.auth.admin.createUser',
    'OPERATOR_EMAIL_VERIFICATION_REQUIRED',
    'email_confirm: !requireEmailVerification',
    'unlock: false',
    'enforcePublicClaimRateLimit(supabaseAdmin, request, \'register-operator\''
  ],
  'send-operator-verification-email': [
    'OPERATOR_VERIFICATION_CRON_SECRET',
    'WALLET_CRON_SECRET',
    'timingSafeSecretMatches(configured, bearerToken)',
    'signInWithOtp',
    'generateLink',
    'verification_email_status',
    'verification_email_sent_at'
  ],
  'apple-wallet-webservice': [
    'applePassToken(request)',
    'Authorization: ApplePass <authenticationToken>',
    'appleWalletProvider.registerDevice'
  ],
  'create-topup-payment-session': [
    'create_topup_payment_session',
    'Payment Provider ist noch nicht verbunden.',
    'TOPUP_CARD_INSTANCE_REQUIRED',
    'TOPUP_SESSION_SAVE_FAILED'
  ],
  'confirm-topup-payment': [
    'requireProviderOrOperator(supabaseAdmin, request)',
    'MIN_PAYMENT_WEBHOOK_SECRET_LENGTH',
    'paymentWebhookSecretMatches(configuredSecret, receivedSecret)',
    'PAYMENT_WEBHOOK_SECRET_MISSING',
    'PAYMENT_CONFIRMATION_UNAUTHORIZED'
  ]
};

const idempotentManualWalletFunctions = [
  'issue-apple-pass',
  'update-apple-pass',
  'send-apple-wallet-update',
  'issue-google-wallet-pass',
  'update-google-wallet-pass',
  'send-google-wallet-message'
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function activeFunctionNames() {
  return fs.readdirSync(functionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== '_shared')
    .filter((name) => fs.existsSync(path.join(functionsDir, name, 'index.ts')))
    .sort((a, b) => a.localeCompare(b));
}

function sourceFor(name) {
  return fs.readFileSync(path.join(functionsDir, name, 'index.ts'), 'utf8');
}

function assertIncludesAll(label, source, needles) {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} fehlt: ${needle}`);
  }
}

function hasOwnOrSharedStructuredErrors(source) {
  return source.includes('createStructuredError')
    || source.includes("from '../_shared/walletNotificationService.ts'");
}

function verifyCommonEdgeContract(name, source) {
  assert(source.includes('Deno.serve(async (request)'), `${name} muss Deno.serve(async (request) verwenden.`);
  assert(source.includes("request.method === 'OPTIONS'"), `${name} muss CORS OPTIONS Preflight behandeln.`);
  assert(source.includes('corsHeaders'), `${name} muss CORS Header setzen.`);
  assert(source.includes('try {') && source.includes('catch (error)'), `${name} muss Fehler in try/catch strukturiert abfangen.`);
  assert(source.includes('errorJson(error'), `${name} muss Fehler über errorJson(...) zurückgeben.`);
  assert(source.includes('error_code'), `${name} muss strukturierte error_code Antworten verwenden.`);
  assert(source.includes('error_message'), `${name} muss strukturierte error_message Antworten verwenden.`);
  assert(hasOwnOrSharedStructuredErrors(source), `${name} muss createStructuredError oder die gemeinsame Fehlerstruktur nutzen.`);

  if (name !== 'apple-wallet-webservice') {
    assert(source.includes('METHOD_NOT_ALLOWED'), `${name} muss unerlaubte HTTP-Methoden strukturiert blockieren.`);
  } else {
    assert(source.includes('APPLE_ROUTE_NOT_FOUND'), 'apple-wallet-webservice muss unbekannte Apple-Webservice-Routen strukturiert beantworten.');
  }
}

function verifyServiceRoleClient(name, source) {
  if (!source.includes('SUPABASE_SERVICE_ROLE_KEY')) {
    return;
  }

  assertIncludesAll(name, source, [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_EDGE_CONFIG_MISSING',
    'persistSession: false',
    'autoRefreshToken: false'
  ]);
}

function verifyAutomationContextHardening(walletServiceSource) {
  assertIncludesAll('walletNotificationService automationContext', walletServiceSource, [
    'const MIN_CRON_SECRET_LENGTH = 32',
    'async function timingSafeSecretMatches',
    "Deno.env.get('WALLET_CRON_SECRET') || Deno.env.get('CRON_SECRET')",
    "request.headers.get('x-cron-secret')",
    "request.headers.get('authorization')",
    "id: 'system-cron'",
    'system: true',
    'return authenticatedContext(request)'
  ]);

  assert(
    walletServiceSource.includes('await timingSafeSecretMatches(cronSecret, bearerToken)')
      && walletServiceSource.includes('await timingSafeSecretMatches(cronSecret, headerSecret)'),
    'automationContext muss Bearer- und x-cron-secret Werte timing-safe gegen WALLET_CRON_SECRET prüfen.'
  );
}

function verifyCampaignRecipientClaiming(walletServiceSource) {
  assertIncludesAll('walletNotificationService Kampagnen-Claiming', walletServiceSource, [
    'async function claimRecipientForProcessing',
    ".from('wallet_notification_recipients')",
    "status: 'processing'",
    "processing_started_at: nowIso",
    ".eq('status', 'pending')",
    "reason: 'already_claimed'",
    'recoverStaleProcessingRecipients',
    'recipient_already_claimed'
  ]);
}

function verifyOperatorServiceRoleAuth(name, source) {
  assertIncludesAll(name, source, [
    'supabaseAdmin.auth.getUser(token)',
    ".from('operator_profiles')",
    ".select('id, unlock')",
    'OPERATOR_LOCKED'
  ]);
}

const names = activeFunctionNames();
const walletServiceSource = fs.readFileSync(path.join(functionsDir, '_shared', 'walletNotificationService.ts'), 'utf8');

assert(names.length >= 18, `Unerwartet wenige Supabase Edge Functions gefunden: ${names.length}.`);

for (const name of requiredWalletPromptFunctions) {
  assert(names.includes(name), `Prompt-Edge-Function fehlt: ${name}.`);
}

for (const name of names) {
  const source = sourceFor(name);
  verifyCommonEdgeContract(name, source);
  verifyServiceRoleClient(name, source);
}

for (const name of walletOperatorFunctions) {
  assert(
    sourceFor(name).includes('walletNotificationService.context(request)'),
    `${name} muss walletNotificationService.context(request) für Betreiber-Auth, Unlock und Business-Isolation verwenden.`
  );
}

for (const name of automationFunctions) {
  assert(
    sourceFor(name).includes('walletNotificationService.automationContext(request)'),
    `${name} muss automationContext(request) für Cron-Secret oder Betreiber-Auth verwenden.`
  );
}

verifyAutomationContextHardening(walletServiceSource);
verifyCampaignRecipientClaiming(walletServiceSource);

for (const name of serviceRoleOperatorFunctions) {
  verifyOperatorServiceRoleAuth(name, sourceFor(name));
}

for (const [name, guards] of Object.entries(publicServiceRoleFunctions)) {
  assertIncludesAll(name, sourceFor(name), guards);
}

for (const name of idempotentManualWalletFunctions) {
  const source = sourceFor(name);

  assertIncludesAll(name, source, [
    'idempotency-key',
    'idempotency_scope'
  ]);

  assert(
    source.includes('reserveManualIdempotency')
      || source.includes('reserveWalletOperationIdempotency'),
    `${name} muss Idempotency vor Provider-Aufrufen reservieren.`
  );
}

console.log('Supabase Edge-Function-Verträge sind für CORS, Fehlerstruktur, Auth-Kontext und Idempotenz statisch abgesichert.');
