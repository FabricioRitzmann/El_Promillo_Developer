import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'supabase', 'config.toml');
const functionsDir = path.join(rootDir, 'supabase', 'functions');
const config = fs.readFileSync(configPath, 'utf8');

const expectedNoJwtFunctions = new Set([
  'claim-card',
  'get-public-template',
  'get-wallet-message',
  'claim-apple-pass',
  'google-wallet-save-link',
  'register-operator',
  'send-operator-verification-email',
  'create-topup-payment-session',
  'confirm-topup-payment',
  'apple-wallet-webservice',
  'process-scheduled-wallet-notifications',
  'process-wallet-update-queue'
]);

const walletOperatorFunctions = new Set([
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
]);

const publicClaimGuards = {
  'claim-card': [
    'validateWalletObjectId(walletObjectId)',
    'CLAIM_WALLET_OBJECT_ID_REQUIRED',
    'CLAIM_WALLET_OBJECT_ID_INVALID',
    'CLAIM_WALLET_OBJECT_ID_CONFLICT',
    'publicClaimCard(card)'
  ],
  'get-public-template': [
    'enforcePublicClaimRateLimit(supabaseAdmin, request, \'get-public-template\')',
    'publicCardTemplateResponse(template)',
    ".eq('is_active', true)",
    'CLAIM_LINK_REQUIRED'
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
    'storedWalletObjectId !== walletObjectId',
    'passJsonHasAppleWebServiceFields'
  ],
  'google-wallet-save-link': [
    'walletObjectId',
    'GOOGLE_CLAIM_TOKEN_MISMATCH',
    'acceptedClaimKeys.has(walletObjectId)',
    'signJwt(payload, config.privateKey)',
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
    'type: \'magiclink\'',
    'verification_email_status',
    'verification_email_sent_at'
  ],


  'create-topup-payment-session': [
    'validateTopupClaimKey(walletObjectId)',
    'assertTopupClaimKey(card, walletObjectId)',
    'enforcePublicClaimRateLimit(supabaseAdmin, request, \'create-topup-payment-session\'',
    'TOPUP_CLAIM_KEY_MISMATCH'
  ],
  'confirm-topup-payment': [
    'requireProviderOrOperator(supabaseAdmin, request)',
    'MIN_PAYMENT_WEBHOOK_SECRET_LENGTH',
    'paymentWebhookSecretMatches(configuredSecret, receivedSecret)',
    'PAYMENT_WEBHOOK_SECRET_MISSING',
    'PAYMENT_CONFIRMATION_UNAUTHORIZED'
  ]
};

const additionalOperatorGuardedFunctions = {
  'generate-card-pdf': [
    'requireAuthenticatedOperator(supabaseAdmin, request)',
    'supabaseAdmin.auth.getUser(token)',
    ".from('operator_profiles')",
    ".select('id, unlock')",
    ".eq('owner_id', user.id)"
  ]
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseFunctionConfig(text) {
  const entries = new Map();
  let currentFunction = null;

  text.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.replace(/#.*/, '').trim();

    if (!line) {
      return;
    }

    const header = line.match(/^\[functions\.([A-Za-z0-9_-]+)\]$/);

    if (header) {
      currentFunction = header[1];
      entries.set(currentFunction, entries.get(currentFunction) || {});
      return;
    }

    const verifyJwt = line.match(/^verify_jwt\s*=\s*(true|false)$/);

    if (verifyJwt) {
      assert(currentFunction, `verify_jwt steht ausserhalb eines [functions.*]-Blocks in Zeile ${lineIndex + 1}.`);
      entries.get(currentFunction).verify_jwt = verifyJwt[1] === 'true';
    }
  });

  return entries;
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function activeFunctionNames() {
  return fs.readdirSync(functionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== '_shared')
    .filter((name) => fs.existsSync(path.join(functionsDir, name, 'index.ts')))
    .sort((a, b) => a.localeCompare(b));
}

function functionSource(name) {
  return fs.readFileSync(path.join(functionsDir, name, 'index.ts'), 'utf8');
}

function assertIncludesAll(label, source, needles) {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} fehlt: ${needle}`);
  }
}

const entries = parseFunctionConfig(config);
const noJwtFunctions = sorted([...entries.entries()]
  .filter(([, values]) => values.verify_jwt === false)
  .map(([name]) => name));
const expectedNoJwt = sorted(expectedNoJwtFunctions);

assert(
  JSON.stringify(noJwtFunctions) === JSON.stringify(expectedNoJwt),
  `supabase/config.toml darf verify_jwt=false nur für ${expectedNoJwt.join(', ')} setzen. Aktuell: ${noJwtFunctions.join(', ') || 'keine'}.`
);

for (const name of expectedNoJwtFunctions) {
  assert(entries.has(name), `supabase/config.toml fehlt [functions.${name}].`);
  assert(entries.get(name).verify_jwt === false, `[functions.${name}] muss verify_jwt=false haben.`);
}

for (const name of activeFunctionNames()) {
  if (expectedNoJwtFunctions.has(name)) {
    continue;
  }

  assert(
    entries.get(name)?.verify_jwt !== false,
    `[functions.${name}] darf nicht verify_jwt=false setzen. Operator-Funktionen behalten Supabase JWT-Prüfung.`
  );
}

for (const name of walletOperatorFunctions) {
  const source = functionSource(name);

  assert(
    source.includes('walletNotificationService.context(request)'),
    `${name} muss walletNotificationService.context(request) nutzen, damit Betreiber-Auth, Unlock und Business-Isolation geprüft werden.`
  );
}

for (const [name, guards] of Object.entries(additionalOperatorGuardedFunctions)) {
  assertIncludesAll(name, functionSource(name), guards);
}

for (const name of ['process-scheduled-wallet-notifications', 'process-wallet-update-queue']) {
  const source = functionSource(name);

  assert(
    source.includes('walletNotificationService.automationContext(request)'),
    `${name} muss automationContext(request) nutzen, damit WALLET_CRON_SECRET oder Betreiber-Auth geprüft wird.`
  );
}

assertIncludesAll('apple-wallet-webservice', functionSource('apple-wallet-webservice'), [
  'applePassToken(request)',
  'Authorization: ApplePass <authenticationToken>',
  'pass_authentication_token',
  'appleWalletProvider.registerDevice'
]);

assertIncludesAll('appleWalletProvider.registerDevice', fs.readFileSync(path.join(functionsDir, '_shared', 'appleWalletProvider.ts'), 'utf8'), [
  'async registerDevice',
  'sha256(stringValue(params.authenticationToken))',
  'authentication_token_hash: authenticationTokenHash'
]);

for (const [name, guards] of Object.entries(publicClaimGuards)) {
  assertIncludesAll(name, functionSource(name), guards);
}

assert(!fs.existsSync(path.join(functionsDir, 'passkit')), 'Legacy supabase/functions/passkit darf nicht reaktiviert werden.');

console.log('Supabase Edge JWT-Policy ist statisch abgesichert.');
