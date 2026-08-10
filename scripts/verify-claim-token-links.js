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

function assertIncludesAll(label, source, needles) {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} fehlt: ${needle}`);
  }
}

const schema = read('supabase/schema.sql');
const dashboard = read('public/js/dashboard.js');
const editor = read('public/js/editor.js');
const claim = read('public/js/claim.js');
const server = read('server/index.js');
const publicTemplate = read('supabase/functions/get-public-template/index.ts');
const claimCard = read('supabase/functions/claim-card/index.ts');
const samsungAddLink = read('supabase/functions/samsung-wallet-add-link/index.ts');
const pdf = read('supabase/functions/generate-card-pdf/index.ts');
const samsungProvider = read('supabase/functions/_shared/samsungWalletProvider.ts');
const publicResponses = read('supabase/functions/_shared/publicResponses.ts');

assertIncludesAll('Schema Claim Token', schema, [
  'public_claim_token text not null default encode(gen_random_bytes(18), \'hex\')',
  'add column if not exists public_claim_token text',
  'card_templates_public_claim_token_format_check',
  'card_templates_public_claim_token_idx'
]);

assertIncludesAll('Dashboard Token QR', dashboard, [
  'public_claim_token',
  'function templateClaimUrl(template)',
  '/claim.html?token=',
  '/claim.html?template=',
  'const claimUrl = templateClaimUrl(template)'
]);

assertIncludesAll('Editor Token QR', editor, [
  'public_claim_token',
  'function templateClaimUrl()',
  '/claim.html?token=',
  '/claim.html?template=',
  'const claimUrl = templateClaimUrl()'
]);

assertIncludesAll('Claim Page Token Load', claim, [
  'params.get(\'token\') || params.get(\'claim_token\')',
  'currentClaimToken = claimToken || \'\'',
  'edgeUrl.searchParams.set(\'token\', claimToken)',
  'claimToken: currentClaimToken || undefined'
]);

assertIncludesAll('Local Server Token Resolution', server, [
  'function claimUrlForTemplate(template, baseUrl)',
  'function selectPublicTemplateByClaimKey',
  ".eq('public_claim_token', token)",
  'CLAIM_LINK_REQUIRED'
]);

assertIncludesAll('Edge Token Resolution', `${publicTemplate}\n${claimCard}\n${samsungAddLink}`, [
  'function claimToken(value: unknown)',
  ".eq('public_claim_token', token)",
  'CLAIM_LINK_REQUIRED'
]);

assertIncludesAll('PDF Token Link', pdf, [
  'public_claim_token',
  '/claim.html?token=',
  '/claim.html?template='
]);

assertIncludesAll('Samsung zentraler Token-Link', samsungProvider, [
  'publicTemplateCreationUrl(template)',
  'publicTemplateShareLabel(template)'
]);

assert(
  !publicResponses.match(/public_claim_token\s*:/),
  'publicCardTemplateResponse darf public_claim_token nicht an öffentliche Browser-Responses ausgeben.'
);

console.log('Tokenisierte Claim-Links sind für Dashboard, Editor, PDF, Claim-Seite, lokale API und Samsung abgesichert.');
