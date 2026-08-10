import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(label, source, values) {
  for (const value of values) assert(source.includes(value), `${label} fehlt: ${value}`);
}

const schema = read('supabase/schema.sql');
const editorHtml = read('public/editor.html');
const editor = read('public/js/editor.js');
const claim = read('public/js/claim.js');
const localServer = read('server/index.js');
const edgeClaim = read('supabase/functions/claim-card/index.ts');
const links = read('supabase/functions/_shared/publicTemplateLinks.ts');
const apple = read('supabase/functions/_shared/appleWalletProvider.ts');
const google = read('supabase/functions/_shared/googleWalletProvider.ts');
const googleSave = read('supabase/functions/google-wallet-save-link/index.ts');
const samsung = read('supabase/functions/_shared/samsungWalletProvider.ts');

includesAll('Dauerhafte Herkunft und Referral-Quelle', schema, [
  'template_id uuid not null references public.card_templates(id) on delete cascade',
  "claim_source text not null default 'legacy'",
  "'direct_qr', 'wallet_share'",
  'customer_cards_claim_source_check'
]);

includesAll('Editor-Schalter', `${editorHtml}\n${editor}`, [
  'Öffentlichen Kartenlink anzeigen',
  'public_share_link_enabled',
  'publicShareLinkEnabled',
  "normalizeTemplateType(templateType.value) === 'club_card'"
]);

includesAll('Zentraler sicherer Link', links, [
  'const PUBLIC_CLAIM_TOKEN_PATTERN = /^[a-f0-9]{36}$/',
  "url.protocol !== 'https:'",
  "new URL('/claim.html'",
  "url.searchParams.set('token', token)",
  "url.searchParams.set('source', 'wallet_share')",
  "normalizeTemplateType(template) === 'club_card'"
]);
assert(!links.includes('template.id'), 'Wallet-Share-Link darf niemals auf eine individuelle oder interne Karten-/Template-ID zurückfallen.');
assert(!links.match(/javascript:|data:|file:/i), 'Unsichere URL-Schemata dürfen nicht unterstützt werden.');

includesAll('Apple Wallet', apple, ['publicTemplateCreationUrl(template)', "key: 'publicTemplateShare'", 'attributedValue']);
includesAll('Google Wallet', `${google}\n${googleSave}`, ["id: 'public_template_share'", 'linksModuleData', 'publicTemplateShareLabel(template)']);
includesAll('Samsung Wallet', samsung, ['publicTemplateCreationUrl(template)', 'publicTemplateShareLabel(template)', '...(linkUrl ? {']);

includesAll('Referral-Tracking', `${claim}\n${edgeClaim}\n${localServer}`, [
  "params.get('source') === 'wallet_share' ? 'wallet_share' : 'direct_qr'",
  'claimSource: currentClaimSource',
  "=== 'wallet_share' ? 'wallet_share' : 'direct_qr'",
  'claim_source: source',
  'claim_source: claimSource'
]);

for (const source of [apple, google, googleSave, samsung, links]) {
  assert(!source.includes('customer_card_id='), 'Öffentlicher Wallet-Link darf keine customer_card_id enthalten.');
  assert(!source.includes('card_instance_number='), 'Öffentlicher Wallet-Link darf keine Karteninstanz enthalten.');
  assert(!source.includes('guest_profile_id='), 'Öffentlicher Wallet-Link darf keine Gast-ID enthalten.');
}

console.log('Öffentliche Wallet-Share-Links, Referral-Tracking und Datenschutzgrenzen sind abgesichert.');
