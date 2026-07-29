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

const prep = read('scripts/prepare-supabase-secrets-local.js');
const readme = read('README.md');
const acceptance = read('docs/WALLET_EXTERNAL_ACCEPTANCE.md');
const context = read('docs/WALLET_INTEGRATION_CONTEXT.md');
const packageJson = read('package.json');
const gitignore = read('.gitignore');

[
  'Supabase Secrets Local Preparation',
  '--write',
  '--force',
  '--json',
  'supabase/secrets.local.env',
  'Missing external values are written as',
  'APPLE_TEAM_ID',
  'APPLE_PASS_TYPE_ID',
  'APPLE_WWDR_CERT',
  'APPLE_PASS_CERT',
  'APPLE_PASS_KEY',
  'APPLE_PASS_KEY_PASSWORD',
  'APPLE_WEB_SERVICE_BASE_URL',
  'APPLE_APNS_KEY_ID',
  'APPLE_APNS_AUTH_KEY',
  'GOOGLE_WALLET_ISSUER_ID',
  'Google_Wallet_Issuer_ID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON',
  'readSamsungEnvValues',
  'normalizeSamsungCardType',
  'samsungPrivateKeyMatchesPartnerCertificate',
  'publicKeyFingerprintFromPrivateKey',
  'publicKeyFingerprintFromCertificate',
  'samsung_env_values',
  'env Samsung wallet.txt',
  'samsung-wallet-keys/samsung_wallet_private.key',
  'samsung-wallet-keys/X303/el_promillo.crt',
  'samsung-wallet-keys/samsung_public_cert.pem',
  'SAMSUNG_WALLET_PARTNER_ID',
  'SAMSUNG_WALLET_PARTNER_CODE',
  'SAMSUNG_WALLET_CARD_ID',
  'SAMSUNG_WALLET_CERTIFICATE_ID',
  'SAMSUNG_WALLET_PRIVATE_KEY_PEM',
  'SAMSUNG_WALLET_SAMSUNG_PUBLIC_KEY_PEM',
  'SAMSUNG_WALLET_RD_CLICK_URL',
  'SAMSUNG_WALLET_RD_IMPRESSION_URL',
  'SAMSUNG_WALLET_PARTNER_SERVER_URL',
  'PAYMENT_WEBHOOK_SECRET',
  'WALLET_CRON_SECRET',
  'OPERATOR_VERIFICATION_MAIL_MODE',
  'OPERATOR_EMAIL_VERIFICATION_REQUIRED',
  'OPERATOR_VERIFICATION_CRON_SECRET',
  'OPERATOR_VERIFICATION_REDIRECT_PATH',
  'OPERATOR_VERIFICATION_MAX_ATTEMPTS',
  'OPERATOR_REGISTER_RATE_LIMIT',
  'OPERATOR_REGISTER_RATE_LIMIT_WINDOW_SECONDS',
  'MAIL_FROM_EMAIL',
  'MAIL_FROM_NAME',
  'RESEND_API_KEY',
  'randomSecret',
  'certs/*.p8',
  'google-service-account*.json',
  'Secret-Werte wurden nicht ausgegeben',
  'MISSING'
].forEach((needle) => assertIncludes(prep, needle, 'Secret-Prep-Script ist unvollständig'));

assertIncludes(gitignore, 'supabase/secrets.local.env', '.gitignore muss supabase/secrets.local.env ignorieren');

[
  'prepare-supabase-secrets-local.js',
  'supabase/secrets.local.env',
  'bash scripts/set-supabase-secrets.sh'
].forEach((needle) => {
  assertIncludes(readme, needle, 'README muss Secret-Prep dokumentieren');
  assertIncludes(acceptance, needle, 'External Acceptance muss Secret-Prep dokumentieren');
  assertIncludes(context, needle, 'Wallet-Kontext muss Secret-Prep dokumentieren');
});

assertIncludes(packageJson, 'node --check scripts/prepare-supabase-secrets-local.js', 'pnpm check muss Secret-Prep-Syntax prüfen');
assertIncludes(packageJson, 'verify-prepare-supabase-secrets-local.js', 'pnpm check muss Secret-Prep-Vertrag prüfen');

console.log('Supabase Secret-Prep-Script ist dokumentiert und statisch abgesichert.');
