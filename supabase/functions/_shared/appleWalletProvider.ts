// Direct Apple Wallet provider for Supabase Edge Functions.
//
// This file builds Apple Wallet passes directly in Deno/Edge. It prepares
// pass JSON/version records, handles Apple Wallet Web Service registration
// data and sends APNS pass-update notifications from Edge.

import JSZip from 'https://esm.sh/jszip@3.10.1?target=deno';
import forge from 'https://esm.sh/node-forge@1.3.1?target=deno';
import { featureEnabled, normalizeTemplateType, templateSettings } from './templateFeatures.ts';
import { supabaseCardEmblemUrl } from './cardEmblems.ts';
import { publicTemplateCreationUrl, publicTemplateShareLabel } from './publicTemplateLinks.ts';

type Row = Record<string, any>;

const APPLE_PASS_VERSION_RETRY_LIMIT = 3;
const APPLE_ASSET_MAX_BYTES = 2 * 1024 * 1024;
const APPLE_ASSET_ALLOWED_MIME_TYPES = new Set(['image/png']);

const applePassVersionSelect = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
  'card_instance_id',
  'serial_number',
  'pass_type_identifier',
  'pass_json',
  'assets',
  'version',
  'last_updated_at'
].join(',');

const appleWalletRegistrationSelect = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
  'card_instance_id',
  'device_library_identifier',
  'pass_type_identifier',
  'serial_number',
  'created_at'
].join(',');

const fallbackIconPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function htmlEscape(value: unknown) {
  return stringValue(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function configured(value: unknown) {
  const text = stringValue(value);
  return Boolean(text && !text.startsWith('YOUR_') && !text.includes('CHANGE_THIS'));
}

function configuredHttpsUrl(value: unknown) {
  return /^https:\/\//i.test(stringValue(value)) && configured(value);
}

function safeAppleAssetUrl(value: unknown) {
  const text = stringValue(value);

  if (!text) {
    return '';
  }

  let parsedUrl: URL;
  let supabaseUrl: URL;

  try {
    parsedUrl = new URL(text);
    supabaseUrl = new URL(stringValue(Deno.env.get('SUPABASE_URL')).replace(/\/+$/, ''));
  } catch {
    return '';
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.origin !== supabaseUrl.origin) {
    return '';
  }

  return parsedUrl.pathname.startsWith('/storage/v1/object/public/wallet-assets/')
    || parsedUrl.pathname.startsWith('/storage/v1/object/public/business-logos/')
    || parsedUrl.pathname.startsWith('/storage/v1/object/public/wallet-emblems/')
    ? parsedUrl.toString()
    : '';
}

function providerStructuredError(statusCode: number, errorCode: string, message: string, reason: string) {
  const error = new Error(message) as Error & Row;
  error.statusCode = statusCode;
  error.error_code = errorCode;
  error.error_message = message;
  error.error_reason = reason;

  return error;
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value: string) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function sha1Bytes(bytes: Uint8Array) {
  return toHex(await crypto.subtle.digest('SHA-1', bytes));
}

function normalizePem(value: string) {
  return value.replace(/\\n/g, '\n').trim();
}

function base64Url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomAppleAuthenticationToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return `apple-${base64Url(bytes)}`;
}

function customerCardIdentityQuery(query: any, cardInstance: Row, customerCardId: string) {
  let nextQuery = query
    .eq('id', customerCardId)
    .eq('owner_id', cardInstance.owner_id)
    .eq('template_id', cardInstance.template_id);
  const businessId = stringValue(cardInstance.business_id || cardInstance.customer_cards?.business_id);

  nextQuery = businessId
    ? nextQuery.eq('business_id', businessId)
    : nextQuery.is('business_id', null);

  return nextQuery;
}

function decodePrivateKey(pem: string) {
  const normalized = normalizePem(pem)
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function utf8Bytes(value: unknown) {
  return new TextEncoder().encode(String(value));
}

function base64ToBytes(value: string) {
  const binary = atob(value.replace(/^data:[^,]+,/, '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function binaryStringToBytes(value: string) {
  const bytes = new Uint8Array(value.length);

  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }

  return bytes;
}

async function assetBytes(value: unknown) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (value && typeof value === 'object') {
    const row = value as Row;
    return assetBytes(row.bytes || row.base64 || row.dataUri || row.url);
  }

  const text = stringValue(value);

  if (!text) {
    return null;
  }

  if (/^https?:\/\//i.test(text)) {
    const assetUrl = safeAppleAssetUrl(text);

    if (!assetUrl) {
      return null;
    }

    const response = await fetch(assetUrl);

    if (!response.ok) {
      return null;
    }

    const contentLength = Number(response.headers.get('content-length') || '0');
    const contentType = stringValue(response.headers.get('content-type')).split(';')[0].toLowerCase();

    if (contentLength > APPLE_ASSET_MAX_BYTES || !APPLE_ASSET_ALLOWED_MIME_TYPES.has(contentType)) {
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    return bytes.byteLength <= APPLE_ASSET_MAX_BYTES ? bytes : null;
  }

  return base64ToBytes(text);
}

function passSigningConfig() {
  const wwdrCert = stringValue(Deno.env.get('APPLE_WWDR_CERT'));
  const signerCert = stringValue(Deno.env.get('APPLE_PASS_CERT'));
  const signerKey = stringValue(Deno.env.get('APPLE_PASS_KEY'));
  const signerKeyPassword = stringValue(Deno.env.get('APPLE_PASS_KEY_PASSWORD'));

  return {
    configured: configured(wwdrCert) && configured(signerCert) && configured(signerKey),
    wwdrCert,
    signerCert,
    signerKey,
    signerKeyPassword
  };
}

function privateKeyFromPem(keyPem: string, passphrase: string) {
  const normalizedKey = normalizePem(keyPem);
  const decryptedKey = passphrase
    ? forge.pki.decryptRsaPrivateKey(normalizedKey, passphrase)
    : null;

  return decryptedKey || forge.pki.privateKeyFromPem(normalizedKey);
}

function signManifest(manifestJson: string) {
  const config = passSigningConfig();

  if (!config.configured) {
    throw new Error('APPLE_PASS_SIGNING_CONFIG_MISSING');
  }

  const passCert = forge.pki.certificateFromPem(normalizePem(config.signerCert));
  const wwdrCert = forge.pki.certificateFromPem(normalizePem(config.wwdrCert));
  const privateKey = privateKeyFromPem(config.signerKey, config.signerKeyPassword);
  const p7 = forge.pkcs7.createSignedData();

  p7.content = forge.util.createBuffer(manifestJson, 'utf8');
  p7.addCertificate(passCert);
  p7.addCertificate(wwdrCert);
  p7.addSigner({
    key: privateKey,
    certificate: passCert,
    digestAlgorithm: forge.pki.oids.sha1,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data
      },
      {
        type: forge.pki.oids.messageDigest
      },
      {
        type: forge.pki.oids.signingTime,
        value: new Date()
      }
    ]
  });
  p7.sign({ detached: true });

  return binaryStringToBytes(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

async function buildPassPackage(passJson: Row, assets: Row = {}) {
  const files = new Map<string, Uint8Array>();
  const fallbackIcon = base64ToBytes(fallbackIconPngBase64);
  const configuredIcon = await assetBytes(assets.iconPng || assets.icon || assets.iconPngBase64 || assets.logoPng || assets.logo);
  const icon = configuredIcon || fallbackIcon;

  files.set('pass.json', utf8Bytes(JSON.stringify(passJson)));
  files.set('icon.png', icon);
  files.set('icon@2x.png', icon);

  const logo = await assetBytes(assets.logoPng || assets.logo || assets.logoPngBase64);

  if (logo) {
    files.set('logo.png', logo);
    files.set('logo@2x.png', logo);
  }

  const thumbnail = await assetBytes(assets.thumbnailPng || assets.thumbnail || assets.thumbnailPngBase64);

  if (thumbnail) {
    files.set('thumbnail.png', thumbnail);
    files.set('thumbnail@2x.png', thumbnail);
  }

  const strip = await assetBytes(assets.stripPng || assets.strip || assets.stripPngBase64);

  if (strip) {
    files.set('strip.png', strip);
    files.set('strip@2x.png', strip);
  }

  const background = await assetBytes(assets.backgroundPng || assets.background || assets.backgroundPngBase64);

  if (background) {
    files.set('background.png', background);
    files.set('background@2x.png', background);
    files.set('background@3x.png', background);
  }

  const manifest: Row = {};

  for (const [fileName, bytes] of files.entries()) {
    manifest[fileName] = await sha1Bytes(bytes);
  }

  const manifestJson = JSON.stringify(manifest);
  files.set('manifest.json', utf8Bytes(manifestJson));
  files.set('signature', signManifest(manifestJson));

  const zip = new JSZip();

  for (const [fileName, bytes] of files.entries()) {
    zip.file(fileName, bytes);
  }

  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE'
  });
}

async function signAppleJwt(teamId: string, keyId: string, privateKeyPem: string) {
  const header = {
    alg: 'ES256',
    kid: keyId
  };
  const payload = {
    iss: teamId,
    iat: Math.floor(Date.now() / 1000)
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodePrivateKey(privateKeyPem),
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256'
    },
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function appleConfig() {
  return {
    teamId: stringValue(Deno.env.get('APPLE_TEAM_ID')),
    passTypeIdentifier: stringValue(Deno.env.get('APPLE_PASS_TYPE_ID')),
    webServiceBaseUrl: stringValue(Deno.env.get('APPLE_WEB_SERVICE_BASE_URL')),
    apnsKeyId: stringValue(Deno.env.get('APPLE_APNS_KEY_ID')),
    apnsTeamId: stringValue(Deno.env.get('APPLE_APNS_TEAM_ID') || Deno.env.get('APPLE_TEAM_ID')),
    apnsAuthKey: stringValue(Deno.env.get('APPLE_APNS_AUTH_KEY'))
  };
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function numberValue(...values: unknown[]) {
  const numeric = Number(firstDefined(...values));

  return Number.isFinite(numeric) ? numeric : 0;
}

function messageNoticeValue(fields: Row = {}) {
  const rawCount = numberValue(fields.newMessageCount, fields.unreadMessageCount, fields.messageCount, 1);
  const count = Math.min(99, Math.max(1, Math.floor(rawCount)));

  return `Neue Nachricht +${count}`;
}

function metadataFor(cardInstance: Row) {
  const customer = cardInstance.customer_cards || {};
  const customerMetadata = customer.metadata && typeof customer.metadata === 'object'
    ? customer.metadata
    : {};
  const instanceMetadata = cardInstance.metadata && typeof cardInstance.metadata === 'object'
    ? cardInstance.metadata
    : {};

  return {
    ...customerMetadata,
    ...instanceMetadata
  };
}

function statusLabel(value: unknown) {
  const status = stringValue(value || 'active');

  return {
    active: 'Aktiv',
    paused: 'Pausiert',
    redeemed: 'Eingelöst',
    blocked: 'Gesperrt'
  }[status] || status || 'Aktiv';
}

function templateTypeLabel(template: Row) {
  return {
    generic_card: 'Basiskarte',
    stamp_card: 'Stempelkarte',
    streak_card: 'Streakkarte',
    vip_card: 'VIP-Karte',
    balance_card: 'Guthabenkarte',
    cloakroom_card: 'Garderobenkarte',
    event_card: 'Eventkarte',
    coupon_card: 'Couponkarte',
    membership_card: 'Memberkarte'
  }[normalizeTemplateType(template)] || 'Karte';
}

function formatMoney(cents: unknown, currency: unknown) {
  return `${stringValue(currency) || 'CHF'} ${(numberValue(cents) / 100).toFixed(2)}`;
}

function cardCodeFor(cardInstance: Row) {
  return stringValue(
    cardInstance.card_instance_number
      || cardInstance.customer_cards?.card_instance_number
      || cardInstance.customer_cards?.customer_code
      || cardInstance.id
  );
}

function walletFeatureRows(template: Row, cardInstance: Row) {
  const settings = templateSettings(template);
  const customer = cardInstance.customer_cards || {};
  const metadata = metadataFor(cardInstance);
  const rows: Array<{ key: string; label: string; value: string }> = [];
  const stampCount = numberValue(cardInstance.current_stamps, customer.stamp_count, metadata.stamp_count, 0);
  const stampsRequired = Math.max(1, numberValue(template.stamps_required, settings.stampsRequired, settings.stamps_required, 10));
  const streakCount = numberValue(cardInstance.current_streak, customer.streak_count, metadata.streak_count, 0);
  const streakGoal = numberValue(template.streak_goal, settings.streakGoal, settings.streak_goal, 0);
  const vipStatus = stringValue(cardInstance.vip_level || customer.vip_status || metadata.vip_level || template.vip_tier || settings.vipDefaultTier);
  const balanceCents = numberValue(cardInstance.balance_cents, customer.balance_cents, metadata.balance_cents, 0);
  const currency = stringValue(cardInstance.currency || customer.currency || settings.currency || 'CHF');
  const cloakroomActive = Boolean(cardInstance.cloakroom_active ?? customer.cloakroom_active ?? metadata.cloakroom_active);

  if (normalizeTemplateType(template) === 'club_card') {
    if (featureEnabled(template, 'membership')) {
      rows.push({
        key: 'membershipNumber',
        label: stringValue(metadata.membership_number || cardInstance.membership_number) ? 'Mitgliedsnummer' : 'Mitgliedschaft',
        value: stringValue(metadata.membership_number || cardInstance.membership_number || metadata.membership_status || cardInstance.membership_status || settings.membershipStatus) || 'Aktiv'
      });
    }

    if (featureEnabled(template, 'vip')) {
      rows.push({ key: 'vip', label: 'VIP', value: vipStatus || 'Member' });
    }

    if (featureEnabled(template, 'balance')) {
      rows.push({ key: 'balance', label: 'Guthaben', value: formatMoney(balanceCents, currency) });
    }

    if (featureEnabled(template, 'membership')) {
      const membershipExpiresAt = stringValue(metadata.membership_expires_at || cardInstance.membership_expires_at || settings.membershipExpiresAt);
      rows.push({
        key: 'membershipStatus',
        label: 'Mitgliedsstatus',
        value: [
          stringValue(metadata.membership_status || cardInstance.membership_status || settings.membershipStatus) || 'Aktiv',
          membershipExpiresAt ? `bis ${membershipExpiresAt}` : ''
        ].filter(Boolean).join(' ')
      });
    }

    if (featureEnabled(template, 'redemption')) {
      rows.push({
        key: 'redemption',
        label: stringValue(settings.couponTitle) || 'Coupon',
        value: stringValue(cardInstance.coupon_status || metadata.coupon_status || customer.status || cardInstance.status) === 'redeemed' ? 'Eingelöst' : 'Bereit'
      });
    }

    if (featureEnabled(template, 'cloakroom')) {
      rows.push({ key: 'cloakroom', label: 'Garderobe', value: cloakroomActive ? 'Aktiv' : 'Bereit' });
    }

    if (!rows.length) {
      rows.push({ key: 'status', label: 'Status', value: statusLabel(customer.status || cardInstance.status) });
    }

    return rows;
  }

  if (featureEnabled(template, 'stamps')) {
    rows.push({
      key: 'stamps',
      label: 'Stempel',
      value: `${stampCount}/${stampsRequired}`
    });
  }

  if (featureEnabled(template, 'streak')) {
    rows.push({
      key: 'streak',
      label: 'Streak',
      value: streakGoal > 0 ? `${streakCount}/${streakGoal}` : String(streakCount)
    });
  }

  if (featureEnabled(template, 'vip')) {
    rows.push({
      key: 'vip',
      label: 'VIP',
      value: vipStatus || 'Member'
    });
  }

  if (featureEnabled(template, 'balance')) {
    rows.push({
      key: 'balance',
      label: 'Guthaben',
      value: formatMoney(balanceCents, currency)
    });
  }

  if (featureEnabled(template, 'cloakroom')) {
    rows.push({
      key: 'cloakroom',
      label: 'Garderobe',
      value: cloakroomActive ? 'Aktiv' : 'Bereit'
    });
  }

  if (featureEnabled(template, 'checkin')) {
    rows.push({
      key: 'checkin',
      label: stringValue(settings.eventName) || 'Einlass',
      value: stringValue(metadata.event_status) || 'Bereit'
    });
  }

  if (featureEnabled(template, 'redemption')) {
    rows.push({
      key: 'redemption',
      label: stringValue(settings.couponTitle) || 'Coupon',
      value: stringValue(customer.status || cardInstance.status) === 'redeemed' ? 'Eingelöst' : 'Bereit'
    });
  }

  if (featureEnabled(template, 'membership')) {
    rows.push({
      key: 'membership',
      label: 'Mitgliedschaft',
      value: stringValue(metadata.membership_status || settings.membershipStatus) || 'Aktiv'
    });
  }

  if (!rows.length) {
    rows.push({
      key: 'status',
      label: 'Status',
      value: statusLabel(customer.status || cardInstance.status)
    });
  }

  return rows;
}

function rewardTextForTemplate(template: Row) {
  const settings = templateSettings(template);

  return stringValue(template.reward_text || settings.rewardText || settings.reward_text);
}

function rewardVisible(template: Row, cardInstance: Row) {
  const rewardText = rewardTextForTemplate(template);
  const settings = templateSettings(template);
  const customer = cardInstance.customer_cards || {};
  const stampCount = numberValue(cardInstance.current_stamps, customer.stamp_count, 0);
  const stampsRequired = Math.max(1, numberValue(template.stamps_required, settings.stampsRequired, 10));
  const streakCount = numberValue(cardInstance.current_streak, customer.streak_count, 0);
  const streakGoal = numberValue(template.streak_goal, settings.streakGoal, 0);

  return Boolean(rewardText) && (
    featureEnabled(template, 'vip')
    || featureEnabled(template, 'redemption')
    || featureEnabled(template, 'membership')
    || (featureEnabled(template, 'stamps') && stampCount >= stampsRequired)
    || (featureEnabled(template, 'streak') && streakGoal > 0 && streakCount >= streakGoal)
  );
}

function templateBusiness(template: Row) {
  return Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;
}

function businessNameForTemplate(template: Row, fallback = 'Business') {
  const business = templateBusiness(template);
  return stringValue(business?.name || business?.company_name || template.business_name || fallback);
}

function businessLogoUrlForTemplate(template: Row) {
  const business = templateBusiness(template);
  return stringValue(business?.logo_url || business?.company_logo_url || template.business_logo_url || template.company_logo_url || template.logo_url);
}

function assetMatchesTemplateUrl(assetValue: unknown, templateUrl: string) {
  const asset = stringValue(assetValue);

  return Boolean(asset && (!templateUrl || asset === templateUrl || asset.startsWith('data:')));
}

function appleTemplateAssetUrls(template: Row, cardInstance: Row = {}) {
  const settings = templateSettings(template);
  const isEventCard = normalizeTemplateType(template) === 'event_card';
  const logoUrl = safeAppleAssetUrl(
    businessLogoUrlForTemplate(template)
      || template.logoUrl
      || settings.logoUrl
      || settings.logo_url
      || settings.imageUrl
      || settings.image_url
  );
  const iconUrl = safeAppleAssetUrl(
    settings.iconUrl
      || settings.icon_url
      || settings.cardIconUrl
      || settings.card_icon_url
      || logoUrl
  );
  const emblemUrl = safeAppleAssetUrl(
    supabaseCardEmblemUrl(cardInstance, Deno.env.get('SUPABASE_URL') || '')
  );
  const eventBackgroundUrl = isEventCard
    ? safeAppleAssetUrl(
      settings.eventAppleBackgroundImageUrl
        || settings.event_apple_background_image_url
        || settings.eventBackgroundImageUrl
        || settings.event_background_image_url
    )
    : '';

  return {
    logoUrl,
    iconUrl,
    emblemUrl,
    eventBackgroundUrl
  };
}

function appleAssetsForTemplate(template: Row, explicitAssets: Row = {}, cardInstance: Row = {}) {
  const assets = explicitAssets && typeof explicitAssets === 'object' && !Array.isArray(explicitAssets)
    ? explicitAssets
    : {};
  const { logoUrl, iconUrl, emblemUrl, eventBackgroundUrl } = appleTemplateAssetUrls(template, cardInstance);
  const templateAssets: Row = {};

  if (logoUrl) {
    templateAssets.logo = logoUrl;
    templateAssets.logoPng = logoUrl;
  }

  if (iconUrl) {
    templateAssets.icon = iconUrl;
    templateAssets.iconPng = iconUrl;
  }

  if (eventBackgroundUrl) {
    templateAssets.background = eventBackgroundUrl;
    templateAssets.backgroundPng = eventBackgroundUrl;
  } else if (emblemUrl) {
    templateAssets.thumbnail = emblemUrl;
    templateAssets.thumbnailPng = emblemUrl;
    templateAssets.strip = emblemUrl;
    templateAssets.stripPng = emblemUrl;
  }

  return {
    ...templateAssets,
    ...assets
  };
}

function passVersionHasTemplateAssets(template: Row, passVersion: Row | null) {
  const { logoUrl, iconUrl, eventBackgroundUrl } = appleTemplateAssetUrls(template);

  if (!logoUrl && !iconUrl && !eventBackgroundUrl) {
    return true;
  }

  const assets: Row = passVersion?.assets && typeof passVersion.assets === 'object'
    ? passVersion.assets as Row
    : {};

  if (logoUrl && !assetMatchesTemplateUrl(assets.logo || assets.logoPng || assets.logoPngBase64, logoUrl)) {
    return false;
  }

  if (iconUrl && !stringValue(assets.icon || assets.iconPng || assets.iconPngBase64 || assets.logo || assets.logoPng)) {
    return false;
  }

  if (eventBackgroundUrl && !stringValue(assets.background || assets.backgroundPng || assets.backgroundPngBase64)) {
    return false;
  }

  return true;
}

function buildPassJson(template: Row, cardInstance: Row, fields: Row = {}) {
  const config = appleConfig();
  const templateType = normalizeTemplateType(template);
  const businessName = businessNameForTemplate(template);
  const serialNumber = stringValue(cardInstance.apple_serial_number || cardInstance.wallet_serial_number || cardInstance.id);
  const authenticationToken = stringValue(cardInstance.customer_cards?.pass_authentication_token || cardInstance.authentication_token);
  const cardCode = cardCodeFor(cardInstance);
  const latestMessage = stringValue(fields.latestMessage || fields.message || cardInstance.customer_cards?.metadata?.latest_wallet_message);
  const messageUrl = stringValue(fields.messageUrl || cardInstance.customer_cards?.metadata?.latest_wallet_message_url);
  const featureRows = walletFeatureRows(template, cardInstance);
  const headerRow = latestMessage
    ? {
      key: 'latestMessageNotice',
      label: 'Cardinfo',
      value: messageNoticeValue(fields),
      changeMessage: '%@'
    }
    : {
      key: 'currentProgress',
      label: featureRows[0]?.label || 'Status',
      value: featureRows[0]?.value || statusLabel(cardInstance.customer_cards?.status || cardInstance.status),
      changeMessage: '%@'
    };
  const auxiliaryRows = latestMessage ? featureRows : featureRows.slice(1);
  const rewardText = rewardTextForTemplate(template);
  const auxiliaryFields = auxiliaryRows.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.value,
    changeMessage: '%@'
  }));

  const settings = templateSettings(template);
  if (settings.visitCounterEnabled === true && settings.visitCounterWalletVisible === true) {
    auxiliaryFields.unshift({
      key: 'lifetimeVisits',
      label: 'Besuche',
      value: numberValue(cardInstance.lifetime_visits, 0),
      changeMessage: 'Besuche: %@'
    });
  }

  if (rewardVisible(template, cardInstance)) {
    auxiliaryFields.push({
      key: 'reward',
      label: 'Belohnung',
      value: rewardText,
      changeMessage: '%@'
    });
  }

  const generic = {
    headerFields: [headerRow],
    primaryFields: [
      {
        key: 'cardName',
        label: 'Karte',
        value: stringValue(template.card_name || 'Kundenkarte')
      }
    ],
    secondaryFields: [
      {
        key: 'cardId',
        label: 'Karten-ID',
        value: cardCode
      },
      {
        key: 'type',
        label: 'Typ',
        value: templateTypeLabel(template)
      }
    ],
    auxiliaryFields: auxiliaryFields.slice(0, 4),
    backFields: [
      {
        key: 'messageBack',
        label: 'Vollständige Nachricht',
        value: latestMessage,
        changeMessage: '%@'
      },
      {
        key: 'messageUrlBack',
        label: 'Nachricht öffnen',
        value: messageUrl,
        attributedValue: messageUrl ? '<a href="' + htmlEscape(messageUrl) + '">Nachricht öffnen</a>' : ''
      },
      {
        key: 'cardIdBack',
        label: 'Karten-ID',
        value: cardCode
      },
      {
        key: 'updatedAt',
        label: 'Aktualisiert',
        value: new Date().toLocaleString('de-CH')
      },
      {
        key: 'description',
        label: 'Beschreibung',
        value: stringValue(template.description)
      },
      (() => {
        const shareUrl = publicTemplateCreationUrl(template);
        const shareLabel = publicTemplateShareLabel(template);

        return {
          key: 'publicTemplateShare',
          label: shareLabel,
          value: shareUrl,
          attributedValue: shareUrl ? '<a href="' + htmlEscape(shareUrl) + '">' + htmlEscape(shareLabel) + '</a>' : ''
        };
      })()
    ]
      .concat(featureRows.map((row) => ({
        key: `${row.key}Back`,
        label: row.label,
        value: row.value
      })))
      .concat(rewardText ? [{
        key: 'rewardBack',
        label: 'Belohnung',
        value: rewardText
      }] : [])
      .filter((field) => field.value)
  };

  const passJson: Row = {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeIdentifier,
    serialNumber,
    teamIdentifier: config.teamId,
    organizationName: businessName || 'Wallet Cards',
    logoText: businessName,
    description: stringValue(template.description || template.card_name || 'Digitale Walletkarte'),
    backgroundColor: stringValue(template.primary_color || '#fffaf2'),
    foregroundColor: stringValue(template.text_color || '#5b3423'),
    labelColor: stringValue(template.text_color || '#5b3423'),
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: cardCode,
        messageEncoding: 'iso-8859-1',
        altText: cardCode
      }
    ]
  };

  if (templateType === 'event_card') {
    passJson.eventTicket = generic;
  } else {
    passJson.generic = generic;
  }

  if (authenticationToken && configuredHttpsUrl(config.webServiceBaseUrl)) {
    passJson.authenticationToken = authenticationToken;
    passJson.webServiceURL = config.webServiceBaseUrl;
  }

  if (fields.relevantDate) {
    passJson.relevantDate = fields.relevantDate;
  }

  if (Array.isArray(fields.locations) && fields.locations.length) {
    passJson.locations = fields.locations;
  }

  return passJson;
}

async function nextApplePassVersionNumber(supabaseAdmin: any, cardInstanceId: string) {
  const { data: latestVersion, error } = await supabaseAdmin
    .from('apple_pass_versions')
    .select('version')
    .eq('card_instance_id', cardInstanceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Number(latestVersion?.version || 0) + 1;
}

async function insertApplePassVersionWithRetry(supabaseAdmin: any, payload: Row) {
  let lastError = null;

  for (let attempt = 1; attempt <= APPLE_PASS_VERSION_RETRY_LIMIT; attempt += 1) {
    const version = await nextApplePassVersionNumber(supabaseAdmin, payload.card_instance_id);
    const { data, error } = await supabaseAdmin
      .from('apple_pass_versions')
      .insert({
        ...payload,
        version
      })
      .select(applePassVersionSelect)
      .single();

    if (!error) {
      return data;
    }

    lastError = error;

    if (error.code !== '23505' || attempt >= APPLE_PASS_VERSION_RETRY_LIMIT) {
      throw error;
    }
  }

  throw lastError;
}

async function ensurePassAuthenticationToken(supabaseAdmin: any, cardInstance: Row) {
  const existingToken = stringValue(cardInstance.customer_cards?.pass_authentication_token || cardInstance.authentication_token);

  if (existingToken) {
    return cardInstance;
  }

  const customerCardId = stringValue(cardInstance.customer_card_id || cardInstance.customer_cards?.id);

  if (!customerCardId) {
    throw providerStructuredError(
      409,
      'APPLE_CUSTOMER_CARD_MISSING',
      'Apple Wallet Karte hat keine verknüpfte Kundenkarte für authenticationToken.',
      'card_instances.customer_card_id oder customer_cards.id muss gesetzt sein, damit ein pass_authentication_token serverseitig gespeichert werden kann.'
    );
  }

  const generatedToken = randomAppleAuthenticationToken();
  const updateEmptyCardQuery = supabaseAdmin
    .from('customer_cards')
    .update({
      pass_authentication_token: generatedToken
    });
  const { data: updatedCard, error: updateError } = await customerCardIdentityQuery(updateEmptyCardQuery, cardInstance, customerCardId)
    .is('pass_authentication_token', null)
    .select('id,pass_authentication_token,updated_at')
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  let token = stringValue(updatedCard?.pass_authentication_token);
  let tokenUpdatedAt = stringValue(updatedCard?.updated_at);

  if (!token) {
    const selectCurrentCardQuery = supabaseAdmin
      .from('customer_cards')
      .select('id,pass_authentication_token,updated_at');
    const { data: currentCard, error: currentError } = await customerCardIdentityQuery(selectCurrentCardQuery, cardInstance, customerCardId)
      .maybeSingle();

    if (currentError) {
      throw currentError;
    }

    token = stringValue(currentCard?.pass_authentication_token);
    tokenUpdatedAt = stringValue(currentCard?.updated_at);
  }

  if (!token) {
    const updateBlankCardQuery = supabaseAdmin
      .from('customer_cards')
      .update({
        pass_authentication_token: generatedToken
      });
    const { data: emptyTokenCard, error: emptyTokenError } = await customerCardIdentityQuery(updateBlankCardQuery, cardInstance, customerCardId)
      .eq('pass_authentication_token', '')
      .select('id,pass_authentication_token,updated_at')
      .maybeSingle();

    if (emptyTokenError) {
      throw emptyTokenError;
    }

    token = stringValue(emptyTokenCard?.pass_authentication_token);
    tokenUpdatedAt = stringValue(emptyTokenCard?.updated_at);
  }

  if (!token) {
    const reselectCurrentCardQuery = supabaseAdmin
      .from('customer_cards')
      .select('id,pass_authentication_token,updated_at');
    const { data: currentCard, error: currentError } = await customerCardIdentityQuery(reselectCurrentCardQuery, cardInstance, customerCardId)
      .maybeSingle();

    if (currentError) {
      throw currentError;
    }

    token = stringValue(currentCard?.pass_authentication_token);
    tokenUpdatedAt = stringValue(currentCard?.updated_at);
  }

  if (!token) {
    throw providerStructuredError(
      409,
      'APPLE_CUSTOMER_CARD_CONTEXT_MISMATCH',
      'Apple Wallet authenticationToken konnte nicht gespeichert werden.',
      'Die verknüpfte customer_cards-Zeile wurde nicht mit passender owner_id, business_id und template_id gefunden oder konnte nicht aktualisiert werden.'
    );
  }

  return {
    ...cardInstance,
    authentication_token: token,
    customer_cards: {
      ...(cardInstance.customer_cards || {}),
      id: customerCardId,
      pass_authentication_token: token,
      updated_at: tokenUpdatedAt || cardInstance.customer_cards?.updated_at
    }
  };
}

export const appleWalletProvider = {
  async ensurePassAuthenticationToken(supabaseAdmin: any, cardInstance: Row) {
    return ensurePassAuthenticationToken(supabaseAdmin, cardInstance);
  },

  passVersionHasTemplateAssets(template: Row, passVersion: Row | null) {
    return passVersionHasTemplateAssets(template, passVersion);
  },

  async issuePass(supabaseAdmin: any, template: Row, cardInstance: Row) {
    const ensuredCardInstance = await ensurePassAuthenticationToken(supabaseAdmin, cardInstance);
    const passJson = buildPassJson(template, ensuredCardInstance);

    return this.updatePassFields(supabaseAdmin, ensuredCardInstance, template, passJson, {
      reason: 'issue_apple_pass',
      allowFullPassJson: true,
      skipEnsureAuthToken: true
    });
  },

  async signPass(passJson: Row | null = null, assets: Row = {}) {
    const signingConfig = passSigningConfig();

    if (!passJson) {
      return {
        ok: false,
        status: 'prepared',
        error_code: 'APPLE_PASS_JSON_MISSING',
        error_message: 'Apple Pass JSON fehlt.',
        error_reason: 'Erstelle zuerst eine Apple-Pass-Version mit issuePass oder updatePassFields.'
      };
    }

    if (!signingConfig.configured) {
      return {
        ok: false,
        status: 'prepared',
        error_code: 'APPLE_PASS_SIGNING_CONFIG_MISSING',
        error_message: 'Apple-Pass-Signatur ist noch nicht konfiguriert.',
        error_reason: 'Setze APPLE_WWDR_CERT, APPLE_PASS_CERT und APPLE_PASS_KEY als Supabase Edge Secrets. APPLE_PASS_KEY_PASSWORD ist nötig, falls der private Key verschlüsselt ist.'
      };
    }

    if (!configured(passJson.passTypeIdentifier) || !configured(passJson.teamIdentifier) || !configured(passJson.serialNumber)) {
      return {
        ok: false,
        status: 'prepared',
        error_code: 'APPLE_PASS_CONFIG_MISSING',
        error_message: 'Apple-Pass-Konfiguration ist unvollständig.',
        error_reason: 'Setze APPLE_TEAM_ID und APPLE_PASS_TYPE_ID als Supabase Edge Secrets. Jede Karte braucht ausserdem eine serialNumber.'
      };
    }

    if (!configured(passJson.authenticationToken) || !configuredHttpsUrl(passJson.webServiceURL)) {
      return {
        ok: false,
        status: 'prepared',
        error_code: 'APPLE_WEB_SERVICE_CONFIG_MISSING',
        error_message: 'Apple Wallet Web Service ist nicht vollständig konfiguriert.',
        error_reason: 'Apple-Passes für Updates brauchen authenticationToken und eine öffentliche HTTPS-webServiceURL. Setze APPLE_WEB_SERVICE_BASE_URL als HTTPS-URL der apple-wallet-webservice Edge Function.'
      };
    }

    try {
      return {
        ok: true,
        status: 'signed',
        contentType: 'application/vnd.apple.pkpass',
        fileName: `${stringValue(passJson.serialNumber || 'wallet-card')}.pkpass`,
        pkpass: await buildPassPackage(passJson, assets)
      };
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        error_code: 'APPLE_PASS_SIGNING_FAILED',
        error_message: 'Apple-Pass konnte nicht signiert werden.',
        error_reason: error?.message || 'Prüfe Zertifikate, Private Key und Passwort.'
      };
    }
  },

  async registerDevice(supabaseAdmin: any, params: Row) {
    const authenticationTokenHash = await sha256(stringValue(params.authenticationToken));
    const { data: existingRegistration, error: existingRegistrationError } = await supabaseAdmin
      .from('apple_wallet_registrations')
      .select('owner_id,business_id,template_id,card_instance_id')
      .eq('device_library_identifier', params.deviceLibraryIdentifier)
      .eq('pass_type_identifier', params.passTypeIdentifier)
      .eq('serial_number', params.serialNumber)
      .maybeSingle();

    if (existingRegistrationError) {
      throw existingRegistrationError;
    }

    const registrationContextMismatch = existingRegistration && (
      stringValue(existingRegistration.owner_id) !== stringValue(params.ownerId)
      || stringValue(existingRegistration.business_id) !== stringValue(params.businessId)
      || stringValue(existingRegistration.template_id) !== stringValue(params.templateId)
      || stringValue(existingRegistration.card_instance_id) !== stringValue(params.cardInstanceId)
    );

    if (registrationContextMismatch) {
      throw providerStructuredError(
        409,
        'APPLE_WALLET_REGISTRATION_CONTEXT_MISMATCH',
        'Apple Wallet Registrierung passt nicht zur Karteninstanz.',
        'Eine bestehende Registrierung mit gleicher Device/Pass/Serial-Kombination gehört zu einem anderen Betreiber, Business, Template oder einer anderen Karteninstanz.'
      );
    }

    const { error: deviceError } = await supabaseAdmin
      .from('apple_wallet_devices')
      .upsert({
        device_library_identifier: params.deviceLibraryIdentifier,
        push_token: params.pushToken
      }, {
        onConflict: 'device_library_identifier'
      });

    if (deviceError) {
      throw providerStructuredError(
        500,
        'APPLE_WALLET_DEVICE_SAVE_FAILED',
        'Apple Wallet Device konnte nicht gespeichert werden.',
        deviceError.message || 'apple_wallet_devices konnte den Push Token nicht speichern.'
      );
    }

    const { data, error } = await supabaseAdmin
      .from('apple_wallet_registrations')
      .upsert({
        owner_id: params.ownerId,
        business_id: params.businessId,
        template_id: params.templateId,
        card_instance_id: params.cardInstanceId,
        device_library_identifier: params.deviceLibraryIdentifier,
        pass_type_identifier: params.passTypeIdentifier,
        serial_number: params.serialNumber,
        authentication_token_hash: authenticationTokenHash
      }, {
        onConflict: 'device_library_identifier,pass_type_identifier,serial_number'
      })
      .select(appleWalletRegistrationSelect)
      .single();

    if (error) {
      throw error;
    }

    return data;
  },

  async unregisterDevice(supabaseAdmin: any, params: Row) {
    let query = supabaseAdmin
      .from('apple_wallet_registrations')
      .delete()
      .eq('device_library_identifier', params.deviceLibraryIdentifier)
      .eq('pass_type_identifier', params.passTypeIdentifier)
      .eq('serial_number', params.serialNumber);

    if (params.ownerId) {
      query = query.eq('owner_id', params.ownerId);
    }

    if (params.businessId) {
      query = query.eq('business_id', params.businessId);
    }

    if (params.templateId) {
      query = query.eq('template_id', params.templateId);
    }

    if (params.cardInstanceId) {
      query = query.eq('card_instance_id', params.cardInstanceId);
    }

    const { data, error } = await query
      .select('id')
      .maybeSingle();

    if (error) {
      throw error;
    }

    return { removed: Boolean(data) };
  },

  async getUpdatedPass(supabaseAdmin: any, params: Row) {
    let query = supabaseAdmin
      .from('apple_pass_versions')
      .select(applePassVersionSelect)
      .eq('pass_type_identifier', params.passTypeIdentifier)
      .eq('serial_number', params.serialNumber);

    if (params.ownerId) {
      query = query.eq('owner_id', params.ownerId);
    }

    if (params.businessId) {
      query = query.eq('business_id', params.businessId);
    }

    if (params.templateId) {
      query = query.eq('template_id', params.templateId);
    }

    if (params.cardInstanceId) {
      query = query.eq('card_instance_id', params.cardInstanceId);
    }

    const { data, error } = await query
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  },

  async updatePassFields(supabaseAdmin: any, cardInstance: Row, template: Row, passFields: Row, options: Row = {}) {
    const config = appleConfig();
    const ensuredCardInstance = options.skipEnsureAuthToken === true
      ? cardInstance
      : await ensurePassAuthenticationToken(supabaseAdmin, cardInstance);
    const serialNumber = stringValue(ensuredCardInstance.apple_serial_number || ensuredCardInstance.wallet_serial_number || ensuredCardInstance.id);
    const passJson = options.allowFullPassJson === true && passFields.formatVersion
      ? passFields
      : buildPassJson(template, ensuredCardInstance, passFields);
    const assets = appleAssetsForTemplate(template, options.assets || {}, ensuredCardInstance);
    const data = await insertApplePassVersionWithRetry(supabaseAdmin, {
      owner_id: ensuredCardInstance.owner_id,
      business_id: ensuredCardInstance.business_id,
      template_id: ensuredCardInstance.template_id,
      card_instance_id: ensuredCardInstance.id,
      serial_number: serialNumber,
      pass_type_identifier: config.passTypeIdentifier,
      pass_json: passJson,
      assets
    });

    if (options.enqueue !== false) {
      const { error: queueError } = await supabaseAdmin
        .from('wallet_update_queue')
        .insert({
          owner_id: ensuredCardInstance.owner_id,
          business_id: ensuredCardInstance.business_id,
          card_instance_id: ensuredCardInstance.id,
          campaign_id: options.campaignId || null,
          wallet_platform: 'apple',
          update_type: options.reason || 'apple_pass_update',
          payload: {
            serial_number: serialNumber,
            pass_type_identifier: config.passTypeIdentifier,
            pass_version_id: data.id
          }
        });

      if (queueError) {
        throw providerStructuredError(
          500,
          'APPLE_WALLET_QUEUE_INSERT_FAILED',
          'Wallet-Update-Queue konnte nicht gespeichert werden.',
          queueError.message || 'Apple-Pass-Version wurde erstellt, aber der Queue-Job für den Push konnte nicht angelegt werden.'
        );
      }
    }

    return data;
  },

  async sendPushUpdate(supabaseAdmin: any, cardInstance: Row) {
    const config = appleConfig();
    const serialNumber = stringValue(cardInstance.apple_serial_number || cardInstance.wallet_serial_number || cardInstance.id);

    if (!configured(config.apnsKeyId) || !configured(config.apnsTeamId) || !configured(config.apnsAuthKey) || !configured(config.passTypeIdentifier)) {
      return {
        ok: false,
        status: 'skipped',
        error_code: 'APPLE_APNS_CONFIG_MISSING',
        error_message: 'Apple APNS Secrets fehlen.',
        error_reason: 'Setze APPLE_APNS_KEY_ID, APPLE_APNS_TEAM_ID und APPLE_APNS_AUTH_KEY als Supabase Secrets.'
      };
    }

    const { data: registrations, error: registrationError } = await supabaseAdmin
      .from('apple_wallet_registrations')
      .select('device_library_identifier, apple_wallet_devices(push_token)')
      .eq('owner_id', cardInstance.owner_id)
      .eq('business_id', cardInstance.business_id)
      .eq('template_id', cardInstance.template_id)
      .eq('card_instance_id', cardInstance.id)
      .eq('pass_type_identifier', config.passTypeIdentifier)
      .eq('serial_number', serialNumber);

    if (registrationError) {
      throw registrationError;
    }

    if (!registrations?.length) {
      return {
        ok: false,
        status: 'skipped',
        error_code: 'APPLE_NO_REGISTERED_DEVICES',
        error_message: 'Keine registrierten Apple-Wallet-Geräte gefunden.',
        error_reason: 'Apple kann erst Push-Updates erhalten, nachdem ein iPhone den Pass über den Web Service registriert hat.'
      };
    }

    const jwt = await signAppleJwt(config.apnsTeamId, config.apnsKeyId, config.apnsAuthKey);
    const results = [];

    for (const registration of registrations) {
      const pushToken = registration.apple_wallet_devices?.push_token;

      if (!pushToken) {
        results.push({ status: 'skipped', reason: 'missing_push_token' });
        continue;
      }

      const response = await fetch(`https://api.push.apple.com/3/device/${encodeURIComponent(pushToken)}`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${jwt}`,
          'apns-topic': config.passTypeIdentifier,
          'apns-push-type': 'background',
          'apns-priority': '5',
          'content-type': 'application/json'
        },
        body: '{}'
      });
      const responseText = await response.text().catch(() => '');
      let staleRegistrationRemoved = false;
      let staleRegistrationRemoveError = null;

      if (response.status === 410) {
        try {
          const unregisterResult = await this.unregisterDevice(supabaseAdmin, {
            deviceLibraryIdentifier: registration.device_library_identifier,
            passTypeIdentifier: config.passTypeIdentifier,
            serialNumber,
            ownerId: cardInstance.owner_id,
            businessId: cardInstance.business_id,
            templateId: cardInstance.template_id,
            cardInstanceId: cardInstance.id
          });
          staleRegistrationRemoved = Boolean(unregisterResult.removed);
        } catch (error) {
          staleRegistrationRemoveError = error?.message || 'Stale Apple Wallet Registrierung konnte nicht gelöscht werden.';
        }
      }

      results.push({
        device_library_identifier: registration.device_library_identifier,
        push_token_suffix: String(pushToken).slice(-8),
        status: response.status,
        ok: response.ok,
        error_code: response.ok ? null : response.status === 410 ? 'APPLE_APNS_UNREGISTERED' : 'APPLE_APNS_PUSH_FAILED',
        stale_registration_removed: staleRegistrationRemoved,
        stale_registration_remove_error: staleRegistrationRemoveError,
        response: responseText
      });
    }

    return {
      ok: results.some((result) => result.ok),
      status: results.some((result) => result.ok) ? 'sent' : 'failed',
      results
    };
  }
};
