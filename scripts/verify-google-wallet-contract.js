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

function bodyBetween(source, startNeedle, endNeedle, label) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);

  assert(start >= 0 && end > start, `${label} konnte nicht sauber eingegrenzt werden.`);

  return source.slice(start, end);
}

const provider = read('supabase/functions/_shared/googleWalletProvider.ts');
const issue = read('supabase/functions/issue-google-wallet-pass/index.ts');
const saveLink = read('supabase/functions/google-wallet-save-link/index.ts');
const update = read('supabase/functions/update-google-wallet-pass/index.ts');
const message = read('supabase/functions/send-google-wallet-message/index.ts');
const service = read('supabase/functions/_shared/walletNotificationService.ts');
const publicResponses = read('supabase/functions/_shared/publicResponses.ts');
const schema = read('supabase/schema.sql');
const contextDoc = read('docs/WALLET_INTEGRATION_CONTEXT.md');
const readme = read('README.md');
const packageJson = read('package.json');

assertIncludes(provider, [
  "const walletApiBase = 'https://walletobjects.googleapis.com/walletobjects/v1'",
  'genericObject',
  'loyaltyObject',
  'offerObject',
  'eventTicketObject',
  "scope: 'https://www.googleapis.com/auth/wallet_object.issuer'",
  "Deno.env.get('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON')",
  "Deno.env.get('GOOGLE_WALLET_ISSUER_ID')",
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INVALID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INCOMPLETE',
  'GOOGLE_WALLET_PRIVATE_KEY_FORMAT',
  'GOOGLE_WALLET_TOKEN_SIGNING_FAILED',
  'GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED',
  'GOOGLE_WALLET_TOKEN_REQUEST_FAILED',
  'GOOGLE_WALLET_API_REQUEST_FAILED',
  'function googleRequestError(method: string, path: string, error: unknown)',
  'BEGIN RSA PRIVATE KEY',
  'GOOGLE_WALLET_API_',
  'providerError.status'
], 'Google Provider Konfiguration und Fehler');

assertIncludes(provider, [
  'function googleWalletOrigins()',
  "Deno.env.get('GOOGLE_WALLET_ORIGINS')",
  "Deno.env.get('APP_PUBLIC_BASE_URL')",
  'new URL(text).origin',
  'origins: config.origins',
  'https://pay.google.com/gp/v/save/'
], 'Google Save-JWT Origins');

assertIncludes(provider, [
  'function objectTypeForTemplate(template: Row)',
  "templateType === 'event_card'",
  "templateType === 'coupon_card'",
  "['stamp_card', 'streak_card', 'vip_card', 'membership_card'].includes(templateType)",
  "return 'genericObject'",
  'eventTicketClasses',
  'eventTicketObjects',
  'offerClasses',
  'loyaltyObjects',
  'genericObjects'
], 'Google Object-Type Mapping');

assertIncludes(provider, [
  'function eventBackgroundImageForTemplate(template: Row)',
  'settings.eventGoogleHeroImageUrl',
  'settings.event_google_hero_image_url',
  'eventObject.heroImage = eventBackgroundImage',
  "appPublicAssetUrl('/assets/el-promillo-google-watermark.png')",
  'payload.heroImage = watermarkImage',
  "'el_promillo_watermark'",
  "return pickPayloadFields(payload, ['logo', 'heroImage', 'imageModulesData', 'linksModuleData'])"
], 'Google Event Ticket Hero Image');

assertIncludes(provider, [
  "objectType === 'loyaltyObject'",
  'programLogo: logo || fallbackLogoImage',
  "redemptionChannel: 'BOTH'",
  'localizedTitle: localized(title',
  'localizedProvider: localized(provider',
  'seat: seat ? localized(seat) : undefined',
  'address: localized(eventVenueAddressForTemplate(template)',
  'const loyaltyObject: Row = {',
  'loyaltyPoints: statusPatch.loyaltyPoints'
], 'Google spezialisierte Payload-Felder');

const providerLoyaltyObject = bodyBetween(
  provider,
  'if (objectType === \'loyaltyObject\') {\n    const loyaltyObject: Row = {',
  'const businessLogo = imageValue',
  'Provider LoyaltyObject Payload'
);
[
  'genericType',
  'cardTitle',
  'header: localized(',
  'subheader: localized(',
  'logo: businessLogo'
].forEach((forbidden) => {
  assert(!providerLoyaltyObject.includes(forbidden), `Provider LoyaltyObject darf kein Generic-Feld enthalten: ${forbidden}`);
});

assertIncludes(provider, [
  'function googleObjectIdFor(config: Row, cardInstance: Row)',
  'stored.startsWith(`${config.issuerId}.`)',
  'safeIdSuffix(stored || fallbackValue)',
  'function classIdForTemplate(config: Row, template: Row)',
  'normalizeTemplateType(template)',
  "template.id || template.card_name || 'wallet_cards'",
  'statusPatchPayload',
  'loyaltyPoints',
  'TEXT_AND_NOTIFY'
], 'Google Object Identität und Statusfelder');

assertIncludes(issue, [
  'publicGoogleWalletIssuePayload',
  'walletNotificationService.context(request)',
  ".eq('owner_id', context.ownerId)",
  ".eq('business_id', context.business.id)",
  ".eq('wallet_platform', 'google')",
  'findExistingGoogleIssue',
  'cachedIssuePayload',
  'reserveWalletOperationIdempotency(context',
  'googleWalletProvider.createObject',
  'googleWalletProvider.generateSaveLink',
  'GOOGLE_WALLET_CONFIG_MISSING',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INVALID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INCOMPLETE',
  'GOOGLE_WALLET_PRIVATE_KEY_FORMAT',
  'GOOGLE_WALLET_TOKEN_SIGNING_FAILED',
  'GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED',
  'normalizedIssueStatus(objectResult, saveLink)',
  'partially_failed',
  'googleObject?.class_id && !saveLink.classId',
  'googleObject?.object_type && !saveLink.objectType',
  'const issuedObjectId = stringValue(objectResult.objectId || saveLink.objectId)',
  'const issuedClassId = stringValue(objectResult.classId || saveLink.classId)',
  'const issuedObjectType = stringValue(objectResult.objectType || saveLink.objectType)',
  '!issuedClassId || !issuedObjectType',
  'GOOGLE_WALLET_OBJECT_IDENTITY_INCOMPLETE',
  'google_wallet_objects',
  "onConflict: 'card_instance_id'",
  'updatedGoogleObject',
  ".select('id')",
  '.maybeSingle()',
  'googleObjectUpsertError || !updatedGoogleObject',
  'customerCardFrom',
  'updatedCustomerCard',
  'GOOGLE_CUSTOMER_CARD_UPDATE_FAILED',
  'google_wallet_claim_key',
  'google_object_id: issuedObjectId',
  'updatedCardInstance',
  ".eq('template_id', cardInstance.template_id)",
  ".eq('wallet_platform', 'google')",
  'issue_google_wallet_pass'
], 'Google Issue Edge Function');

assertIncludes(publicResponses, [
  'publicWalletProviderResult',
  'publicGoogleWalletIssuePayload',
  'saveUrl: saveLink.saveUrl || null'
], 'Google Browser Providerantworten');

const issueLogBody = bodyBetween(issue, 'async function logGoogleIssue', 'Deno.serve', 'Google Issue Log Body');
assert(
  !/saveUrl\s*:/.test(issueLogBody),
  'issue-google-wallet-pass darf den signierten Save-JWT nicht in wallet_push_logs speichern.'
);
assertIncludes(issueLogBody, [
  'save_url_present: Boolean(saveLink.saveUrl)',
  'save_url_length: stringValue(saveLink.saveUrl).length'
], 'Google Issue Log Redaction');

assertIncludes(saveLink, [
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INVALID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INCOMPLETE',
  'GOOGLE_WALLET_PRIVATE_KEY_FORMAT',
  'GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED',
  'BEGIN RSA PRIVATE KEY',
  'googleWalletOrigins',
  'new URL(text).origin',
  'loadGoogleCardInstance',
  ".eq('customer_card_id', card.id)",
  'GOOGLE_CLAIM_TOKEN_MISMATCH',
  'acceptedClaimKeys',
  'findReusableGoogleWalletObject',
  'const jwt = await signJwt',
  'catch (error)',
  'updatedCustomerCard',
  'updatedCardInstance',
  ".eq('owner_id', card.owner_id)",
  ".eq('business_id', card.business_id)",
  ".eq('template_id', card.template_id)",
  ".eq('wallet_platform', 'google')",
  'google_wallet_objects',
  "onConflict: 'card_instance_id'",
  'updatedGoogleObject',
  ".select('id')",
  '.maybeSingle()',
  'googleObjectUpsertError || !updatedGoogleObject',
  'programLogo: logo || fallbackLogoImage',
  "redemptionChannel: 'BOTH'",
  'localizedTitle: localized(title',
  'localizedProvider: localized(provider',
  'seat: seat ? localized(seat) : undefined',
  'address: localized(eventVenueAddressForTemplate(template)',
  'const loyaltyObject: Row = {',
  'google_wallet_save_link'
], 'Google Public Save Link');

const saveLinkLoyaltyObject = bodyBetween(
  saveLink,
  'if (objectType === \'loyaltyObject\') {\n    const primaryStatusRow',
  'const objectPayload: Row = {',
  'Public Save-Link LoyaltyObject Payload'
);
[
  'genericType',
  'cardTitle',
  'header: localized(',
  'subheader: localized(',
  'objectPayload.logo'
].forEach((forbidden) => {
  assert(!saveLinkLoyaltyObject.includes(forbidden), `Public Save-Link LoyaltyObject darf kein Generic-Feld enthalten: ${forbidden}`);
});

const saveLinkLogBody = bodyBetween(saveLink, 'async function logGoogleSaveLink', 'Deno.serve', 'Google Save-Link Log Body');
assert(
  !/saveUrl\s*:/.test(saveLinkLogBody),
  'google-wallet-save-link darf den signierten Save-JWT nicht in wallet_push_logs duplizieren.'
);
assertIncludes(saveLinkLogBody, [
  'save_url_present: Boolean(payload.saveUrl)',
  'save_url_length: stringValue(payload.saveUrl).length',
  'card_instance_id: cardInstance.id'
], 'Google Save-Link Log Redaction');

assertIncludes(update, [
  'publicWalletProviderResult',
  'walletNotificationService.context(request)',
  'loadGoogleCardContext',
  ".eq('owner_id', context.ownerId)",
  ".eq('business_id', context.business.id)",
  'GOOGLE_OBJECT_ID_MISMATCH',
  'GOOGLE_OBJECT_NOT_FOUND',
  'validateGoogleWalletPatch',
  'GOOGLE_PATCH_FIELD_FORBIDDEN',
  'GOOGLE_PATCH_TOO_LARGE',
  'googleWalletProvider.normalizeObjectType',
  'googleWalletProvider.statusPatch',
  'manual_google_object_update',
  'reserveManualIdempotency(context',
  'updatedCardInstance',
  'updatedGoogleObject',
  ".eq('template_id', resolved.cardInstance.template_id)",
  ".eq('wallet_platform', 'google')",
  ".eq('card_instance_id', resolved.cardInstance.id)",
  ".eq('object_type', resolved.objectType)"
], 'Google Object Update Security');
assert(
  !update.includes('...result,'),
  'update-google-wallet-pass darf rohe Google Providerantworten nicht an den Browser spreaden.'
);

assertIncludes(message, [
  'publicWalletProviderResult',
  'validateMessage(title, message)',
  'walletNotificationService.checkPlatformLimits(context, cardInstance, ' + "'google')",
  'googleWalletProvider.sendTextAndNotify',
  'google_text_and_notify',
  'googleWalletProvider.updateObject',
  'google_object_message_fallback',
  'GOOGLE_TEXT_AND_NOTIFY_FALLBACK',
  'touchGoogleWalletObjectMapping',
  'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
  'CARD_WALLET_STATE_UPDATE_FAILED',
  'updatedCardInstance',
  'google_object_id: objectId',
  'wallet_object_id: objectId',
  'wallet_serial_number: objectId',
  'countNotifications: true',
  'countNotifications: false',
  'reserveManualIdempotency(context'
], 'Google Message und Fallback');
assert(
  !message.includes('...notificationResult,'),
  'send-google-wallet-message darf rohe Google Providerantworten nicht an den Browser spreaden.'
);

assertIncludes(service, [
  'sendToGoogleWallet(context',
  'googleObject?.object_id || cardInstance.google_object_id',
  'googleWalletProvider.normalizeObjectType',
  'googleWalletProvider.sendTextAndNotify',
  'google_object_message_fallback',
  'touchGoogleWalletObjectMapping',
  'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
  'CARD_WALLET_STATE_UPDATE_FAILED',
  'google_object_id: objectId',
  'GOOGLE_TEXT_AND_NOTIFY_LIMIT_REACHED',
  'WALLET_GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H',
  'VISIBLE_NOTIFICATION_ACTIONS',
  'notification_count_24h'
], 'Zentraler Service Google Pfad');

assertIncludes(schema, [
  'create table if not exists public.google_wallet_objects',
  'issuer_id text not null',
  'class_id text not null',
  'object_id text not null unique',
  'object_type text not null',
  "check (object_type in ('genericObject', 'loyaltyObject', 'offerObject', 'eventTicketObject'))",
  'google_wallet_objects_card_instance_unique_idx',
  'validate_google_wallet_objects_direct_consistency',
  'GOOGLE_WALLET_OBJECT_FORBIDDEN',
  'GOOGLE_WALLET_OBJECT_PLATFORM_MISMATCH',
  'alter table public.google_wallet_objects enable row level security',
  'unlocked operators can read own google wallet objects'
], 'Google Wallet SQL Vertrag');

assertIncludes(contextDoc, [
  'Google Wallet Daten',
  'GOOGLE_WALLET_ISSUER_ID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON',
  'Generic',
  'Loyalty',
  'Offer',
  'Event Ticket',
  'TEXT_AND_NOTIFY',
  'google_wallet_objects.card_instance_id'
], 'Kontextdoku Google Wallet');

assertIncludes(readme, [
  'Google Wallet API',
  'TEXT_AND_NOTIFY',
  'GOOGLE_WALLET_ISSUER_ID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON',
  'verify-google-wallet-contract.js'
], 'README Google Wallet Contract Check');

assert(
  packageJson.includes('verify-google-wallet-contract.js'),
  'package.json muss verify-google-wallet-contract.js in pnpm check ausführen.'
);

console.log('Google Wallet Contract ist für Provider, Save-Link, Messages, SQL, Redaction und Limits abgesichert.');
