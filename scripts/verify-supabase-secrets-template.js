import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const expectedNames = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APP_PUBLIC_BASE_URL',
  'APPLE_TEAM_ID',
  'APPLE_PASS_TYPE_ID',
  'APPLE_WWDR_CERT',
  'APPLE_PASS_CERT',
  'APPLE_PASS_KEY',
  'APPLE_PASS_KEY_PASSWORD',
  'APPLE_WEB_SERVICE_BASE_URL',
  'APPLE_APNS_KEY_ID',
  'APPLE_APNS_TEAM_ID',
  'APPLE_APNS_AUTH_KEY',
  'GOOGLE_WALLET_ISSUER_ID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON',
  'GOOGLE_WALLET_CLASS_SUFFIX',
  'GOOGLE_WALLET_ORIGINS',
  'SAMSUNG_WALLET_PARTNER_ID',
  'SAMSUNG_WALLET_PARTNER_CODE',
  'SAMSUNG_WALLET_CARD_ID',
  'SAMSUNG_WALLET_CARD_TYPE',
  'SAMSUNG_WALLET_CARD_SUB_TYPE',
  'SAMSUNG_WALLET_CERTIFICATE_ID',
  'SAMSUNG_WALLET_COUNTRY_CODE',
  'SAMSUNG_WALLET_ENV',
  'SAMSUNG_WALLET_ADD_FLOW',
  'SAMSUNG_WALLET_PRIVATE_KEY_PEM',
  'SAMSUNG_WALLET_SAMSUNG_PUBLIC_KEY_PEM',
  'SAMSUNG_WALLET_RD_CLICK_URL',
  'SAMSUNG_WALLET_RD_IMPRESSION_URL',
  'SAMSUNG_WALLET_LOGO_URL',
  'SAMSUNG_WALLET_PARTNER_SERVER_URL',
  'SAMSUNG_WALLET_ALLOW_UNVERIFIED_AUTH',
  'PAYMENT_PROVIDER',
  'PAYMENT_CHECKOUT_BASE_URL',
  'PAYMENT_WEBHOOK_SECRET',
  'WALLET_CRON_SECRET',
  'WALLET_MESSAGE_LINK_SECRET',
  'OPERATOR_VERIFICATION_MAIL_MODE',
  'OPERATOR_VERIFICATION_CRON_SECRET',
  'OPERATOR_VERIFICATION_REDIRECT_PATH',
  'OPERATOR_VERIFICATION_MAX_ATTEMPTS',
  'OPERATOR_REGISTER_RATE_LIMIT',
  'OPERATOR_REGISTER_RATE_LIMIT_WINDOW_SECONDS',
  'MAIL_FROM_EMAIL',
  'MAIL_FROM_NAME',
  'RESEND_API_KEY',
  'WALLET_BUSINESS_DAILY_LIMIT',
  'WALLET_CUSTOMER_DAILY_LIMIT',
  'WALLET_CARD_DAILY_LIMIT',
  'WALLET_GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H',
  'WALLET_DUPLICATE_WINDOW_MINUTES',
  'WALLET_PUBLIC_CLAIM_RATE_LIMIT',
  'WALLET_PUBLIC_CLAIM_RATE_LIMIT_WINDOW_SECONDS',
  'WALLET_RECIPIENT_PROCESSING_TIMEOUT_MINUTES',
  'WALLET_QUEUE_PROCESSING_TIMEOUT_MINUTES'
];

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseEnvTemplate(source) {
  const entries = new Map();

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    assert(match, `Ungültige Zeile in supabase/secrets.example.env:${index + 1}`);

    const [, name, rawValue] = match;
    assert(!entries.has(name), `Doppelter Secret-Name in supabase/secrets.example.env: ${name}`);
    entries.set(name, rawValue);
  }

  return entries;
}

const template = read('supabase/secrets.example.env');
const readme = read('README.md');
const context = read('docs/WALLET_INTEGRATION_CONTEXT.md');
const acceptance = read('docs/WALLET_EXTERNAL_ACCEPTANCE.md');
const gitignore = read('.gitignore');
const packageJson = read('package.json');
const entries = parseEnvTemplate(template);

for (const name of expectedNames) {
  assert(entries.has(name), `supabase/secrets.example.env fehlt ${name}.`);
  assert(readme.includes(name), `README.md muss ${name} nennen.`);
  assert(context.includes(name), `docs/WALLET_INTEGRATION_CONTEXT.md muss ${name} nennen.`);
  assert(acceptance.includes(name), `docs/WALLET_EXTERNAL_ACCEPTANCE.md muss ${name} nennen.`);
}

for (const name of entries.keys()) {
  assert(expectedNames.includes(name), `Unerwarteter Secret-Name in supabase/secrets.example.env: ${name}`);
}

[
  'supabase/secrets.example.env',
  'supabase/secrets.local.env',
  'supabase secrets set --env-file supabase/secrets.local.env'
].forEach((needle) => {
  assert(readme.includes(needle), `README.md muss die Secret-Vorlage dokumentieren: ${needle}`);
  assert(context.includes(needle), `Wallet-Kontext muss die Secret-Vorlage dokumentieren: ${needle}`);
});

[
  'supabase/secrets.local.env',
  'supabase/.env',
  'certs/*.p8',
  'google-service-account*.json'
].forEach((needle) => {
  assert(gitignore.includes(needle), `.gitignore muss ${needle} ausschliessen.`);
});

[
  '-----BEGIN',
  '-----END',
  'BEGIN PRIVATE KEY',
  'BEGIN CERTIFICATE',
  'BEGIN RSA PRIVATE KEY',
  'AuthKey_',
  'eyJhbGci',
  'sk_live_',
  'AKIA'
].forEach((needle) => {
  assert(!template.includes(needle), `supabase/secrets.example.env enthält ein echtes Secret-Muster oder Dateinamen-Muster: ${needle}`);
});

[
  'APPLE_WEB_SERVICE_BASE_URL="https://YOUR_PROJECT_REF.supabase.co/functions/v1/apple-wallet-webservice"',
  'GOOGLE_WALLET_ORIGINS="https://deine-domain.ch"',
  'WALLET_CUSTOMER_DAILY_LIMIT="12"',
  'WALLET_CARD_DAILY_LIMIT="6"',
  'WALLET_GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H="3"'
].forEach((needle) => {
  assert(template.includes(needle), `supabase/secrets.example.env fehlt erwarteten Platzhalter: ${needle}`);
});

assert(
  packageJson.includes('verify-supabase-secrets-template.js'),
  'package.json muss verify-supabase-secrets-template.js in pnpm check ausführen.'
);

console.log('Supabase Secrets Vorlage ist vollständig, redigiert und dokumentiert.');
