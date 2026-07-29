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

const script = read('scripts/deploy-wallet-functions.sh');
const readme = read('README.md');
const context = read('docs/WALLET_INTEGRATION_CONTEXT.md');
const acceptance = read('docs/WALLET_EXTERNAL_ACCEPTANCE.md');
const plan = read('docs/WALLET_IMPLEMENTATION_PLAN.md');
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
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  '--dry-run',
  '--project-ref',
  '--only',
  '--with-readiness',
  '--skip-auth-check',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_CLI_BIN',
  'SUPABASE_ACCESS_TOKEN',
  'AuthRequired',
  'SUPABASE_CLI_COMMAND',
  'resolve_supabase_cli',
  'check_supabase_auth',
  'projects list',
  'pnpm dlx supabase',
  'npx --yes supabase',
  'derive_project_ref_from_config',
  'config.supabase?.url',
  'looksConfigured',
  'Supabase Project Ref',
  'supabase/config.toml',
  'functions deploy',
  'wallet-readiness-report.js --strict',
  'wallet-smoke-test.js --functions',
  'Secrets are not printed',
  '_shared folder is bundled'
].forEach((needle) => assertIncludes(script, needle, 'Deploy-Script ist unvollständig'));

for (const functionName of requiredFunctions) {
  assertIncludes(script, functionName, 'Deploy-Script muss alle Wallet Functions enthalten');
  assertIncludes(readme, `supabase functions deploy ${functionName}`, 'README muss Einzeldeploy-Befehl behalten');
}

[
  'bash scripts/deploy-wallet-functions.sh --dry-run',
  'bash scripts/deploy-wallet-functions.sh',
  'bash scripts/deploy-wallet-functions.sh --project-ref',
  'bash scripts/deploy-wallet-functions.sh --skip-auth-check',
  'SUPABASE_CLI_BIN=',
  'scripts/deploy-wallet-functions.sh'
].forEach((needle) => {
  assertIncludes(readme, needle, 'README muss Deploy-Script dokumentieren');
  assertIncludes(context, needle, 'Wallet-Kontext muss Deploy-Script dokumentieren');
});

[
  'bash scripts/deploy-wallet-functions.sh',
  'bash scripts/deploy-wallet-functions.sh --project-ref',
  'pnpm dlx supabase',
  'SUPABASE_ACCESS_TOKEN',
  '--skip-auth-check',
  'node scripts/wallet-smoke-test.js --functions'
].forEach((needle) => assertIncludes(acceptance, needle, 'External Acceptance muss Deploy-Script und Nachtest nennen'));

assertIncludes(plan, 'scripts/deploy-wallet-functions.sh', 'Implementation Plan muss Deploy-Script nennen');
assertIncludes(plan, 'SUPABASE_CLI_BIN', 'Implementation Plan muss CLI-Override nennen');
assertIncludes(plan, '--skip-auth-check', 'Implementation Plan muss Auth-Preflight-Skip nennen');
assertIncludes(packageJson, 'verify-wallet-deploy-script.js', 'pnpm check muss Deploy-Script-Vertrag prüfen');

console.log('Wallet Function Deploy-Script ist dokumentiert und statisch abgesichert.');
