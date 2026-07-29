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

const report = read('scripts/wallet-edge-functions-report.js');
const smoke = read('scripts/wallet-smoke-test.js');
const deploy = read('scripts/deploy-wallet-functions.sh');
const readme = read('README.md');
const acceptance = read('docs/WALLET_EXTERNAL_ACCEPTANCE.md');
const context = read('docs/WALLET_INTEGRATION_CONTEXT.md');
const packageJson = read('package.json');

const requiredFunctions = [
  'claim-card',
  'get-public-template',
  'get-wallet-message',
  'claim-apple-pass',
  'register-operator',
  'send-operator-verification-email',
  'create-topup-payment-session',
  'confirm-topup-payment',
  'redeem-balance',
  'apple-wallet-webservice',
  'issue-apple-pass',
  'update-apple-pass',
  'send-apple-wallet-update',
  'google-wallet-save-link',
  'issue-google-wallet-pass',
  'update-google-wallet-pass',
  'send-google-wallet-message',
  'generate-card-pdf',
  'create-wallet-notification-campaign',
  'send-wallet-notification',
  'resolve-wallet-notification-recipients',
  'check-wallet-notification-limits',
  'process-scheduled-wallet-notifications',
  'process-wallet-update-queue',
  'scanner-actions',
  'get-business-scan-statistics'
];

[
  'Wallet Edge Functions Report',
  '--json',
  '--strict',
  '--functions-base-url',
  '/functions/v1',
  'config.publicUrls?.supabaseFunctionBaseUrl',
  'config.supabase?.url',
  'OPTIONS',
  'Access-Control-Request-Method',
  'Access-Control-Request-Headers',
  'authorization,content-type,x-cron-secret,x-payment-webhook-secret',
  'publicFunctions',
  'protectedFunctions',
  'secretsPrinted: false',
  'Supabase keys',
  'Apple',
  'APNS',
  'Google service-account JSON',
  'Wallet Save JWTs',
  'process.exitCode = 1'
].forEach((needle) => assertIncludes(report, needle, 'Edge-Functions-Report ist unvollständig'));

for (const functionName of requiredFunctions) {
  assertIncludes(report, `'${functionName}'`, `Edge-Functions-Report muss ${functionName} prüfen`);
  assertIncludes(smoke, `'${functionName}'`, `Smoke-Test muss ${functionName} prüfen`);
  assertIncludes(deploy, functionName, `Deploy-Script muss ${functionName} deployen`);
}

[
  'wallet-edge-functions-report.js',
  'Wallet Edge Functions Report'
].forEach((needle) => {
  assertIncludes(readme, needle, 'README muss Edge-Functions-Report dokumentieren');
  assertIncludes(acceptance, needle, 'External Acceptance muss Edge-Functions-Report dokumentieren');
  assertIncludes(context, needle, 'Wallet-Kontext muss Edge-Functions-Report dokumentieren');
});

assertIncludes(packageJson, 'node --check scripts/wallet-edge-functions-report.js', 'pnpm check muss Edge-Functions-Report-Syntax prüfen');
assertIncludes(packageJson, 'verify-wallet-edge-functions-report.js', 'pnpm check muss Edge-Functions-Report-Vertrag prüfen');

console.log('Wallet Edge Functions Report ist dokumentiert und statisch abgesichert.');
