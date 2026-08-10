// Samsung Wallet provider helpers for Supabase Edge Functions.
//
// The MVP supports both Samsung Add-to-Wallet modes used by the Partner Portal:
// Data Fetch Link (pdata) and Data Transmit Link (cdata).

import forge from 'https://esm.sh/node-forge@1.3.1?target=deno';
import { normalizeTemplateType } from './templateFeatures.ts';
import { publicTemplateCreationUrl, publicTemplateShareLabel } from './publicTemplateLinks.ts';

type Row = Record<string, any>;

const SAMSUNG_PUBLIC_API_BASE = 'https://tsapi-card.walletsvc.samsung.com';
const SAMSUNG_AUTH_TOKEN_MAX_AGE_MS = 5 * 60 * 1000;
const SAMSUNG_FALLBACK_LOGO_PATH = '/assets/el-promillo-mini-wallet-emblem-transparent.png';

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function configured(value: unknown) {
  const text = stringValue(value);

  return Boolean(text && !text.startsWith('YOUR_') && !text.includes('CHANGE_THIS'));
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

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function base64UrlToJson(value: string) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function binaryStringToBytes(value: string) {
  const bytes = new Uint8Array(value.length);

  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }

  return bytes;
}

function bytesToBinaryString(value: Uint8Array) {
  let binary = '';

  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return binary;
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  return bytes;
}

function safeHttpsUrl(value: unknown) {
  const text = stringValue(value);

  if (!configured(text) || !/^https:\/\//i.test(text)) {
    return '';
  }

  try {
    return new URL(text).toString();
  } catch (_error) {
    return '';
  }
}

function appPublicBaseUrl() {
  return safeHttpsUrl(Deno.env.get('APP_PUBLIC_BASE_URL') || Deno.env.get('APP_BASE_URL')).replace(/\/+$/, '');
}

function publicAssetUrl(path: string) {
  const baseUrl = appPublicBaseUrl();

  return baseUrl ? `${baseUrl}/${path.replace(/^\/+/, '')}` : '';
}

function samsungCompatibleImageUrl(value: unknown) {
  const url = safeHttpsUrl(value);

  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url);

    return /\.(png|jpe?g|webp)$/i.test(parsed.pathname) ? url : '';
  } catch (_error) {
    return '';
  }
}

function firstBusiness(template: Row = {}) {
  return Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;
}

function textLimit(value: unknown, maxLength: number, fallback = '') {
  const text = stringValue(value || fallback);

  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function numericValue(value: unknown, fallback = 0) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function hexColor(value: unknown, fallback: string) {
  const text = stringValue(value);

  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function samsungFontColor(value: unknown) {
  const color = hexColor(value, '#5b3423').slice(1);
  const red = parseInt(color.slice(0, 2), 16);
  const green = parseInt(color.slice(2, 4), 16);
  const blue = parseInt(color.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  return luminance > 0.55 ? 'dark' : 'light';
}

function hasSamsungDeviceHint(userAgent = '') {
  const text = stringValue(userAgent).toLowerCase();

  return ['samsung', 'sm-', 'samsungbrowser', 'galaxy'].some((hint) => text.includes(hint));
}

function stateForInstance(instance: Row = {}) {
  const status = stringValue(instance.status || instance.card_status).toLowerCase();

  if (status === 'redeemed') {
    return 'REDEEMED';
  }

  if (status === 'blocked') {
    return 'SUSPENDED';
  }

  if (status === 'paused') {
    return 'HELD';
  }

  if (status === 'cancelled' || status === 'canceled') {
    return 'CANCELED';
  }

  if (status === 'deleted') {
    return 'DELETED';
  }

  if (status === 'pending') {
    return 'PENDING';
  }

  return 'ACTIVE';
}

function templateProgressText(template: Row = {}, instance: Row = {}) {
  const templateType = normalizeTemplateType(template);
  const stampsRequired = Math.max(1, numericValue(template.stamps_required, 10));
  const stampCount = Math.max(0, numericValue(instance.current_stamps ?? instance.stamp_count, 0));
  const streakGoal = Math.max(1, numericValue(template.streak_goal, numericValue(template.settings?.streakGoal, 0) || 1));
  const streakCount = Math.max(0, numericValue(instance.current_streak ?? instance.streak_count, 0));
  const balanceCents = Math.max(0, numericValue(instance.balance_cents, 0));
  const currency = stringValue(instance.currency || template.settings?.currency || 'CHF');

  if (template.settings?.visitCounterEnabled === true && template.settings?.visitCounterWalletVisible === true) {
    return `${Math.max(0, numericValue(instance.lifetime_visits, 0))} Besuche`;
  }

  if (templateType === 'stamp_card') {
    return `${stampCount}/${stampsRequired} Stempel`;
  }

  if (templateType === 'streak_card') {
    return `${streakCount}/${streakGoal} Streak`;
  }

  if (templateType === 'balance_card') {
    return `${currency} ${(balanceCents / 100).toFixed(2)}`;
  }

  if (templateType === 'vip_card' || stringValue(instance.vip_level || instance.vip_status)) {
    return textLimit(instance.vip_level || instance.vip_status || template.vip_tier || 'VIP', 32);
  }

  return textLimit(template.reward_text || template.description || 'Kundenkarte aktiv', 32);
}

function rewardOrDescription(template: Row = {}, instance: Row = {}) {
  const progress = templateProgressText(template, instance);
  const reward = stringValue(template.reward_text || template.settings?.rewardText);

  return reward ? `${progress} - ${reward}` : progress;
}

function logoImageUrl(template: Row = {}) {
  const business = firstBusiness(template) || {};
  const override = samsungCompatibleImageUrl(Deno.env.get('SAMSUNG_WALLET_LOGO_URL'));
  const candidate = samsungCompatibleImageUrl(
    business.logo_url
      || template.business_logo_url
      || template.company_logo_url
      || template.logo_url
  );

  return override || candidate || publicAssetUrl(SAMSUNG_FALLBACK_LOGO_PATH);
}

function samsungCardType(value: unknown) {
  const text = stringValue(value).toLowerCase();

  if (['generic', 'loyalty', 'coupon', 'giftcard', 'ticket'].includes(text)) {
    return text;
  }

  return 'loyalty';
}

function samsungCardSubType(value: unknown) {
  const text = stringValue(value).toLowerCase();

  return text || 'others';
}

function samsungAddFlow(value: unknown) {
  const text = stringValue(value || 'data_fetch').toLowerCase().replace(/[-\s]+/g, '_');

  if (['cdata', 'card_data', 'data_transmit', 'data_transmit_link', 'typical'].includes(text)) {
    return 'cdata';
  }

  return 'data_fetch';
}

function isProductionSamsungEnv(value: unknown) {
  return ['production', 'prod', 'live'].includes(stringValue(value).toLowerCase());
}

function providerStructuredError(statusCode: number, errorCode: string, message: string, reason: string) {
  return {
    ok: false,
    status: statusCode,
    error_code: errorCode,
    error_message: message,
    error_reason: reason
  };
}

function configError(config: Row) {
  const missing = config.missing || [];

  return providerStructuredError(
    501,
    'SAMSUNG_WALLET_CONFIG_MISSING',
    'Samsung Wallet ist noch nicht vollständig konfiguriert.',
    `Fehlende Supabase Secrets: ${missing.join(', ')}.`
  );
}

function samsungConfig() {
  const partnerId = stringValue(Deno.env.get('SAMSUNG_WALLET_PARTNER_ID'));
  const partnerCode = stringValue(Deno.env.get('SAMSUNG_WALLET_PARTNER_CODE')) || partnerId;
  const cardId = stringValue(Deno.env.get('SAMSUNG_WALLET_CARD_ID'));
  const certificateId = stringValue(Deno.env.get('SAMSUNG_WALLET_CERTIFICATE_ID'));
  const rawCardType = stringValue(Deno.env.get('SAMSUNG_WALLET_CARD_TYPE') || 'loyalty');
  const rawCardSubType = stringValue(Deno.env.get('SAMSUNG_WALLET_CARD_SUB_TYPE') || 'others');
  const walletEnv = stringValue(Deno.env.get('SAMSUNG_WALLET_ENV') || 'sandbox').toLowerCase();
  const countryCode = stringValue(Deno.env.get('SAMSUNG_WALLET_COUNTRY_CODE') || 'CH').toUpperCase();
  const rawAddFlow = stringValue(Deno.env.get('SAMSUNG_WALLET_ADD_FLOW') || 'data_fetch');
  const addFlow = samsungAddFlow(rawAddFlow);
  const privateKeyPem = stringValue(Deno.env.get('SAMSUNG_WALLET_PRIVATE_KEY_PEM') || Deno.env.get('SAMSUNG_WALLET_PRIVATE_KEY'));
  const samsungPublicKeyPem = stringValue(Deno.env.get('SAMSUNG_WALLET_SAMSUNG_PUBLIC_KEY_PEM') || Deno.env.get('SAMSUNG_WALLET_SAMSUNG_CERT_PEM'));
  const allowUnverifiedAuthRequested = stringValue(Deno.env.get('SAMSUNG_WALLET_ALLOW_UNVERIFIED_AUTH')).toLowerCase() === 'true';
  const productionEnv = isProductionSamsungEnv(walletEnv);
  const allowUnverifiedAuth = allowUnverifiedAuthRequested && !productionEnv;
  const partnerServerUrl = safeHttpsUrl(Deno.env.get('SAMSUNG_WALLET_PARTNER_SERVER_URL'));
  const rdClickUrl = safeHttpsUrl(Deno.env.get('SAMSUNG_WALLET_RD_CLICK_URL'));
  const rdImpressionUrl = safeHttpsUrl(Deno.env.get('SAMSUNG_WALLET_RD_IMPRESSION_URL'));
  const missing = [
    ['SAMSUNG_WALLET_PARTNER_ID', partnerId],
    ['SAMSUNG_WALLET_CARD_ID', cardId],
    ['SAMSUNG_WALLET_CERTIFICATE_ID', certificateId],
    ['SAMSUNG_WALLET_RD_CLICK_URL', rdClickUrl],
    ['SAMSUNG_WALLET_RD_IMPRESSION_URL', rdImpressionUrl],
    ['APP_PUBLIC_BASE_URL', appPublicBaseUrl()]
  ].filter(([, value]) => !configured(value)).map(([name]) => name);

  if (configured(rawAddFlow) && !['data_fetch', 'data-fetch', 'cdata', 'card_data', 'data_transmit', 'data-transmit', 'data_transmit_link', 'data-transmit-link', 'typical'].includes(rawAddFlow.toLowerCase())) {
    missing.push('SAMSUNG_WALLET_ADD_FLOW=data_fetch|cdata');
  }

  if (addFlow === 'cdata') {
    if (!configured(privateKeyPem)) {
      missing.push('SAMSUNG_WALLET_PRIVATE_KEY_PEM');
    }

    if (!configured(samsungPublicKeyPem)) {
      missing.push('SAMSUNG_WALLET_SAMSUNG_PUBLIC_KEY_PEM');
    }
  }

  return {
    configured: missing.length === 0,
    missing,
    partnerId,
    partnerCode,
    cardId,
    certificateId,
    cardType: samsungCardType(rawCardType),
    cardSubType: samsungCardSubType(rawCardSubType),
    walletEnv,
    productionEnv,
    countryCode,
    addFlow,
    privateKeyPem,
    samsungPublicKeyPem,
    allowUnverifiedAuthRequested,
    allowUnverifiedAuth,
    partnerServerUrl,
    rdClickUrl,
    rdImpressionUrl,
    publicApiBase: stringValue(Deno.env.get('SAMSUNG_WALLET_API_BASE_URL')) || SAMSUNG_PUBLIC_API_BASE
  };
}

function randomSamsungRefId() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);

  return `sw_${base64Url(bytes)}`;
}

function normalizeRefId(value: unknown) {
  const text = stringValue(value);

  return /^[A-Za-z0-9_-]{8,32}$/.test(text) ? text : '';
}

function buildSamsungLoyaltyAttributes(template: Row = {}, instance: Row = {}) {
  const business = firstBusiness(template) || {};
  const providerName = textLimit(business.name || template.business_name || 'El Promillo', 32, 'El Promillo');
  const title = textLimit(template.card_name || template.name || 'Kundenkarte', 32, 'Kundenkarte');
  const imageUrl = logoImageUrl(template);
  const linkUrl = publicTemplateCreationUrl(template);

  if (!imageUrl) {
    return providerStructuredError(
      501,
      'SAMSUNG_WALLET_PUBLIC_ASSET_URL_MISSING',
      'Samsung Wallet braucht öffentliche HTTPS-URLs.',
      'Setze APP_PUBLIC_BASE_URL auf deine HTTPS-Domain, damit Logo/App-Link-Assets für Samsung erreichbar sind.'
    );
  }

  return {
    title,
    subtitle1: textLimit(rewardOrDescription(template, instance), 32),
    providerName,
    noticeDesc: textLimit(template.description || template.reward_text || '', 5000),
    logoImage: imageUrl,
    'logoImage.darkUrl': imageUrl,
    'logoImage.lightUrl': imageUrl,
    ...(linkUrl ? {
      appLinkLogo: imageUrl,
      appLinkName: textLimit(publicTemplateShareLabel(template), 32, 'Karte teilen'),
      appLinkData: linkUrl
    } : {}),
    bgColor: hexColor(template.primary_color, '#fffaf2'),
    fontColor: samsungFontColor(template.text_color),
    'barcode.value': stringValue(instance.customer_code || instance.card_instance_number || instance.ref_id),
    'barcode.serialType': 'QRCODE',
    'barcode.ptFormat': 'QRCODESERIAL',
    'barcode.ptSubFormat': 'QR_CODE',
    amount: templateProgressText(template, instance),
    balance: rewardOrDescription(template, instance),
    level: textLimit(instance.vip_level || instance.vip_status || template.vip_tier || '', 16),
    merchantName: providerName
  };
}

function buildSamsungGenericAttributes(template: Row = {}, instance: Row = {}) {
  const business = firstBusiness(template) || {};
  const providerName = textLimit(business.name || template.business_name || 'El Promillo', 32, 'El Promillo');
  const title = textLimit(template.card_name || template.name || 'Kundenkarte', 32, 'Kundenkarte');
  const imageUrl = logoImageUrl(template);
  const startDate = Date.parse(stringValue(template.settings?.eventDate || template.created_at)) || Date.now();

  if (!imageUrl) {
    return providerStructuredError(
      501,
      'SAMSUNG_WALLET_PUBLIC_ASSET_URL_MISSING',
      'Samsung Wallet braucht eine öffentliche HTTPS-Bild-URL.',
      'Setze APP_PUBLIC_BASE_URL oder ein öffentliches Business-Logo.'
    );
  }

  return {
    title,
    providerName,
    mainImg: imageUrl,
    startDate,
    bgColor: hexColor(template.primary_color, '#fffaf2'),
    fontColor: samsungFontColor(template.text_color),
    'barcode.value': stringValue(instance.customer_code || instance.card_instance_number || instance.ref_id),
    'barcode.serialType': 'QRCODE',
    'barcode.ptFormat': 'QRCODESERIAL',
    'barcode.ptSubFormat': 'QR_CODE',
    noticeDesc: textLimit(template.description || rewardOrDescription(template, instance), 5000)
  };
}

function buildCardDataPayload(template: Row = {}, instance: Row = {}, options: Row = {}) {
  const config = samsungConfig();

  if (!config.configured) {
    return configError(config);
  }

  const refId = normalizeRefId(instance.ref_id || options.refId);
  const createdAt = Date.parse(stringValue(instance.created_at)) || Date.now();
  const updatedAt = Date.parse(stringValue(instance.updated_at || instance.last_synced_at)) || Date.now();
  const attributes = config.cardType === 'generic'
    ? buildSamsungGenericAttributes(template, instance)
    : buildSamsungLoyaltyAttributes(template, instance);

  if (attributes?.ok === false) {
    return attributes;
  }

  return {
    ok: true,
    card: {
      type: config.cardType,
      subType: config.cardSubType,
      data: [
        {
          refId,
          createdAt,
          updatedAt,
          state: stateForInstance(instance),
          language: stringValue(options.language || template.settings?.language || 'de'),
          attributes
        }
      ]
    }
  };
}

function cardDataTokenPayload(template: Row = {}, instance: Row = {}) {
  const payload = buildCardDataPayload(template, instance, {
    includeState: false
  });

  if (!payload.ok) {
    return payload;
  }

  const card = JSON.parse(JSON.stringify(payload.card));

  for (const item of card.data || []) {
    delete item.state;
  }

  return {
    ok: true,
    card
  };
}

function encryptCardDataJwe(payloadText: string, samsungPublicKeyPem: string) {
  const cek = randomBytes(16);
  const iv = randomBytes(12);
  const publicKey = publicKeyFromPem(samsungPublicKeyPem);
  let encryptedKeyBinary = '';

  try {
    encryptedKeyBinary = publicKey.encrypt(bytesToBinaryString(cek), 'RSAES-PKCS1-V1_5');
  } catch (_error) {
    encryptedKeyBinary = publicKey.encrypt(bytesToBinaryString(cek));
  }

  const cipher = forge.cipher.createCipher('AES-GCM', bytesToBinaryString(cek));
  cipher.start({
    iv: bytesToBinaryString(iv),
    tagLength: 128
  });
  cipher.update(forge.util.createBuffer(payloadText, 'utf8'));

  if (!cipher.finish()) {
    throw new Error('AES-GCM encryption failed.');
  }

  return [
    base64Url(binaryStringToBytes(encryptedKeyBinary)),
    base64Url(iv),
    base64Url(binaryStringToBytes(cipher.output.getBytes())),
    base64Url(binaryStringToBytes(cipher.mode.tag.getBytes()))
  ].join('.');
}

function signRs256CompactPayload(payloadText: string, privateKeyPem: string, header: Row = {}) {
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(payloadText)}`;
  const privateKey = forge.pki.privateKeyFromPem(normalizePem(privateKeyPem));
  const md = forge.md.sha256.create();
  md.update(signingInput, 'utf8');
  const signature = privateKey.sign(md);

  return `${signingInput}.${base64Url(binaryStringToBytes(signature))}`;
}

function generateCdataToken(template: Row = {}, instance: Row = {}) {
  const config = samsungConfig();
  const payload = cardDataTokenPayload(template, instance);

  if (!payload.ok) {
    return payload;
  }

  try {
    const jwe = encryptCardDataJwe(JSON.stringify({
      card: payload.card
    }), config.samsungPublicKeyPem);

    return {
      ok: true,
      token: signRs256CompactPayload(jwe, config.privateKeyPem, {
        alg: 'RS256',
        cty: 'CARD',
        ver: '3',
        certificateId: config.certificateId,
        partnerId: config.partnerId,
        utc: Date.now()
      })
    };
  } catch (error) {
    return providerStructuredError(
      501,
      'SAMSUNG_CDATA_TOKEN_FAILED',
      'Samsung cdata Token konnte nicht erzeugt werden.',
      error instanceof Error ? error.message : 'Prüfe Samsung Private Key und Samsung Public Key.'
    );
  }
}

function generateAddLink(template: Row = {}, instance: Row = {}) {
  const config = samsungConfig();
  const refId = normalizeRefId(instance.ref_id || instance.refId);

  if (!config.configured) {
    return configError(config);
  }

  if (!refId) {
    return providerStructuredError(
      400,
      'SAMSUNG_REF_ID_INVALID',
      'Samsung Ref-ID ist ungültig.',
      'Data-Fetch-Links brauchen einen nicht erratbaren refId mit maximal 32 Zeichen.'
    );
  }

  if (config.addFlow === 'cdata') {
    const cdata = generateCdataToken(template, instance);

    if (!cdata.ok) {
      return cdata;
    }

    return {
      ok: true,
      provider: 'samsung',
      action: 'generateAddLink',
      addFlow: 'cdata',
      refId,
      cardId: config.cardId,
      certificateId: config.certificateId,
      partnerCode: config.partnerCode,
      rdClickUrl: config.rdClickUrl,
      rdImpressionUrl: config.rdImpressionUrl,
      addUrl: `https://a.swallet.link/atw/v3/${encodeURIComponent(config.cardId)}#Clip?cdata=${encodeURIComponent(cdata.token)}`
    };
  }

  return {
    ok: true,
    provider: 'samsung',
    action: 'generateAddLink',
    addFlow: 'data_fetch',
    refId,
    cardId: config.cardId,
    certificateId: config.certificateId,
    partnerCode: config.partnerCode,
    rdClickUrl: config.rdClickUrl,
    rdImpressionUrl: config.rdImpressionUrl,
    addUrl: `https://a.swallet.link/atw/v3/${encodeURIComponent(config.certificateId)}/${encodeURIComponent(config.cardId)}#Clip?pdata=${encodeURIComponent(refId)}`
  };
}

function decodeAuthorizationHeader(request: Request) {
  const header = stringValue(request.headers.get('authorization'));
  const token = header.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');

  if (!header || parts.length !== 3) {
    return providerStructuredError(
      401,
      'SAMSUNG_AUTHORIZATION_REQUIRED',
      'Samsung Authorization fehlt oder ist ungültig.',
      'Samsung muss den Partner-Server mit Authorization: Bearer <JWS> aufrufen.'
    );
  }

  try {
    return {
      ok: true,
      token,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: base64UrlToBytes(parts[2]),
      header: base64UrlToJson(parts[0]),
      payload: base64UrlToJson(parts[1])
    };
  } catch (_error) {
    return providerStructuredError(
      401,
      'SAMSUNG_AUTHORIZATION_PARSE_FAILED',
      'Samsung Authorization konnte nicht gelesen werden.',
      'Der Bearer-Token muss ein gültiges JWS sein.'
    );
  }
}

function publicKeyFromPem(value: string) {
  const pem = normalizePem(value);

  if (pem.includes('BEGIN CERTIFICATE')) {
    return forge.pki.certificateFromPem(pem).publicKey;
  }

  return forge.pki.publicKeyFromPem(pem);
}

function verifyRs256Jws(signingInput: string, signature: Uint8Array, publicKeyPem: string) {
  const publicKey = publicKeyFromPem(publicKeyPem);
  const md = forge.md.sha256.create();
  md.update(signingInput, 'utf8');

  let binarySignature = '';

  for (const byte of signature) {
    binarySignature += String.fromCharCode(byte);
  }

  return publicKey.verify(md.digest().bytes(), binarySignature);
}

function verifyPartnerServerAuthorization(request: Request, expected: Row) {
  const config = samsungConfig();
  const decoded = decodeAuthorizationHeader(request);

  if (!decoded.ok) {
    if (config.productionEnv && config.allowUnverifiedAuthRequested && decoded.error_code === 'SAMSUNG_AUTHORIZATION_REQUIRED') {
      return providerStructuredError(
        403,
        'SAMSUNG_AUTHORIZATION_UNVERIFIED_PRODUCTION_DISABLED',
        'Samsung Sandbox-Auth ist in Produktion deaktiviert.',
        'Setze SAMSUNG_WALLET_ALLOW_UNVERIFIED_AUTH=false oder SAMSUNG_WALLET_ENV=sandbox. Produktion muss Authorization: Bearer <JWS> senden.'
      );
    }

    if (config.allowUnverifiedAuth && decoded.error_code === 'SAMSUNG_AUTHORIZATION_REQUIRED') {
      return {
        ok: true,
        status: 'unverified_missing_authorization',
        warning_code: 'SAMSUNG_AUTHORIZATION_UNVERIFIED_MISSING',
        warning_message: 'SAMSUNG_WALLET_ALLOW_UNVERIFIED_AUTH ist aktiv. Fehlender Samsung Bearer wird nur im Sandbox-Debugging akzeptiert.'
      };
    }

    return decoded;
  }

  const header = decoded.header || {};
  const payload = decoded.payload || {};
  const api = payload.API || payload.api || {};
  const expectedPath = stringValue(expected.path);
  const expectedMethod = stringValue(expected.method || request.method).toUpperCase();
  const refId = stringValue(expected.refId);
  const tokenUtc = Number(header.utc || payload.utc || 0);

  if (stringValue(header.cty).toUpperCase() !== 'AUTH' || stringValue(header.alg) !== 'RS256') {
    return providerStructuredError(401, 'SAMSUNG_AUTHORIZATION_HEADER_INVALID', 'Samsung Authorization-Header ist ungültig.', 'Erwartet wird cty=AUTH und alg=RS256.');
  }

  if (configured(config.partnerId) && stringValue(header.partnerId) && stringValue(header.partnerId) !== config.partnerId) {
    return providerStructuredError(401, 'SAMSUNG_AUTHORIZATION_PARTNER_MISMATCH', 'Samsung Partner ID passt nicht.', 'Der Authorization-Token gehört nicht zu diesem Partner.');
  }

  if (configured(config.certificateId) && stringValue(header.certificateId) && stringValue(header.certificateId) !== config.certificateId) {
    return providerStructuredError(401, 'SAMSUNG_AUTHORIZATION_CERTIFICATE_MISMATCH', 'Samsung Certificate ID passt nicht.', 'Der Authorization-Token gehört nicht zu diesem Zertifikat.');
  }

  if (stringValue(api.method).toUpperCase() !== expectedMethod || stringValue(api.path) !== expectedPath) {
    return providerStructuredError(401, 'SAMSUNG_AUTHORIZATION_API_MISMATCH', 'Samsung API-Signatur passt nicht zur Route.', 'Methode oder Pfad im Authorization-Token stimmen nicht mit der Anfrage überein.');
  }

  if (refId && stringValue(payload.refId) && stringValue(payload.refId) !== refId) {
    return providerStructuredError(401, 'SAMSUNG_AUTHORIZATION_REF_MISMATCH', 'Samsung Ref-ID passt nicht.', 'Der Authorization-Token gehört nicht zu dieser Kundenkarte.');
  }

  if (!Number.isFinite(tokenUtc) || Math.abs(Date.now() - tokenUtc) > SAMSUNG_AUTH_TOKEN_MAX_AGE_MS) {
    return providerStructuredError(401, 'SAMSUNG_AUTHORIZATION_EXPIRED', 'Samsung Authorization ist abgelaufen.', 'Der Authorization-Token muss frisch von Samsung erzeugt werden.');
  }

  if (!configured(config.samsungPublicKeyPem)) {
    if (config.productionEnv && config.allowUnverifiedAuthRequested) {
      return providerStructuredError(
        503,
        'SAMSUNG_AUTHORIZATION_PUBLIC_KEY_REQUIRED_IN_PRODUCTION',
        'Samsung Public Key ist in Produktion erforderlich.',
        'Setze SAMSUNG_WALLET_SAMSUNG_PUBLIC_KEY_PEM. Unverifizierte Samsung Authorization ist in Produktion deaktiviert.'
      );
    }

    if (config.allowUnverifiedAuth) {
      return {
        ok: true,
        status: 'verified_structurally_only',
        warning_code: 'SAMSUNG_AUTHORIZATION_SIGNATURE_NOT_VERIFIED',
        warning_message: 'SAMSUNG_WALLET_ALLOW_UNVERIFIED_AUTH ist aktiv. Nur für Sandbox-Debugging verwenden.'
      };
    }

    return providerStructuredError(
      503,
      'SAMSUNG_AUTHORIZATION_PUBLIC_KEY_MISSING',
      'Samsung Public Key fehlt.',
      'Trage das Samsung-Zertifikat/Public-Key aus der Partner-Konsole als SAMSUNG_WALLET_SAMSUNG_PUBLIC_KEY_PEM ein.'
    );
  }

  try {
    if (!verifyRs256Jws(decoded.signingInput, decoded.signature, config.samsungPublicKeyPem)) {
      return providerStructuredError(401, 'SAMSUNG_AUTHORIZATION_SIGNATURE_INVALID', 'Samsung Authorization-Signatur ist ungültig.', 'Prüfe das Samsung Public-Key Secret.');
    }
  } catch (error) {
    return providerStructuredError(
      503,
      'SAMSUNG_AUTHORIZATION_VERIFY_FAILED',
      'Samsung Authorization konnte nicht geprüft werden.',
      error instanceof Error ? error.message : 'Prüfe SAMSUNG_WALLET_SAMSUNG_PUBLIC_KEY_PEM.'
    );
  }

  return {
    ok: true,
    status: 'verified'
  };
}

function signRs256Jwt(payload: Row, privateKeyPem: string, header: Row = {}) {
  const jwtHeader = {
    cty: 'AUTH',
    ver: 3,
    certificateId: samsungConfig().certificateId,
    partnerId: samsungConfig().partnerId,
    utc: Date.now(),
    alg: 'RS256',
    ...header
  };
  const signingInput = `${base64Url(JSON.stringify(jwtHeader))}.${base64Url(JSON.stringify(payload))}`;
  const privateKey = forge.pki.privateKeyFromPem(normalizePem(privateKeyPem));
  const md = forge.md.sha256.create();
  md.update(signingInput, 'utf8');
  const signature = privateKey.sign(md);

  return `${signingInput}.${base64Url(binaryStringToBytes(signature))}`;
}

function signAuthorizationToken(method: string, path: string, refId = '') {
  const config = samsungConfig();

  if (!configured(config.privateKeyPem)) {
    return providerStructuredError(
      501,
      'SAMSUNG_WALLET_PRIVATE_KEY_MISSING',
      'Samsung Private Key fehlt.',
      'Setze SAMSUNG_WALLET_PRIVATE_KEY_PEM mit dem privaten Schlüssel aus samsung-wallet-keys/samsung_wallet_private.key.'
    );
  }

  try {
    return {
      ok: true,
      authorization: `Bearer ${signRs256Jwt({
        API: {
          method: method.toUpperCase(),
          path
        },
        ...(refId ? { refId } : {})
      }, config.privateKeyPem)}`
    };
  } catch (error) {
    return providerStructuredError(
      501,
      'SAMSUNG_WALLET_AUTH_SIGNING_FAILED',
      'Samsung Authorization konnte nicht signiert werden.',
      error instanceof Error ? error.message : 'Prüfe Format und Inhalt von SAMSUNG_WALLET_PRIVATE_KEY_PEM.'
    );
  }
}

async function samsungServerApi(path: string, payload: Row, refId = '') {
  const config = samsungConfig();
  const authorization = signAuthorizationToken('POST', path, refId);

  if (!authorization.ok) {
    return authorization;
  }

  let response: Response;
  let result: Row = {};

  try {
    response = await fetch(`${config.publicApiBase.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: {
        Authorization: authorization.authorization,
        'Content-Type': 'application/json',
        'x-smcs-partner-id': config.partnerId,
        'x-request-id': crypto.randomUUID().replace(/-/g, '').slice(0, 32)
      },
      body: JSON.stringify(payload)
    });
    result = await response.json().catch(() => ({}));
  } catch (error) {
    return providerStructuredError(
      502,
      'SAMSUNG_WALLET_API_REQUEST_FAILED',
      'Samsung Wallet API konnte nicht erreicht werden.',
      error instanceof Error ? error.message : 'Netzwerkfehler beim Samsung Server API Aufruf.'
    );
  }

  return {
    ok: response.ok || response.status === 204,
    status: response.status,
    response: result
  };
}

function updatePayload(refId: string, state = 'UPDATED', fields = 'balance,barcode.value') {
  const config = samsungConfig();

  return {
    card: {
      type: config.cardType,
      data: [
        {
          refId,
          state,
          ...(fields && state === 'UPDATED' ? { fields } : {})
        }
      ]
    }
  };
}

export const samsungWalletProvider = {
  config() {
    return samsungConfig();
  },

  randomRefId() {
    return randomSamsungRefId();
  },

  create(template: Row, instance: Row) {
    return this.generateAddLink(template, instance);
  },

  async update(instance: Row, fields = 'balance,barcode.value') {
    const config = samsungConfig();
    const refId = normalizeRefId(instance.ref_id || instance.refId);
    const path = `/${encodeURIComponent(config.countryCode)}/wltex/cards/${encodeURIComponent(config.cardId)}/updates`;

    return samsungServerApi(path, updatePayload(refId, 'UPDATED', fields), refId);
  },

  async delete(instance: Row) {
    const config = samsungConfig();
    const refId = normalizeRefId(instance.ref_id || instance.refId);
    const path = `/${encodeURIComponent(config.countryCode)}/wltex/cards/${encodeURIComponent(config.cardId)}/updates`;

    return samsungServerApi(path, updatePayload(refId, 'DELETED', ''), refId);
  },

  async revoke(instance: Row) {
    const config = samsungConfig();
    const refId = normalizeRefId(instance.ref_id || instance.refId);
    const path = `/${encodeURIComponent(config.countryCode)}/wltex/cards/${encodeURIComponent(config.cardId)}/cancels`;

    return samsungServerApi(path, updatePayload(refId, 'CANCELED', ''), refId);
  },

  generateAddLink(template: Row, instance: Row) {
    return generateAddLink(template, instance);
  },

  generateQRCode(template: Row, instance: Row) {
    const link = generateAddLink(template, instance);

    return link.ok
      ? {
        ...link,
        qrData: link.addUrl
      }
      : link;
  },

  detectSupport(userAgent = '') {
    const text = stringValue(userAgent).toLowerCase();
    const isAndroid = text.includes('android');

    return {
      provider: 'samsung',
      supported: isAndroid && hasSamsungDeviceHint(text),
      reason: isAndroid && hasSamsungDeviceHint(text) ? 'samsung_android' : isAndroid ? 'manual_choice_required' : 'not_android'
    };
  },

  serialize(value: Row = {}) {
    return JSON.stringify(value);
  },

  deserialize(value: string) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return {};
    }
  },

  mapping(template: Row, instance: Row, options: Row = {}) {
    return buildCardDataPayload(template, instance, options);
  },

  cardDataForInstance(template: Row, instance: Row, options: Row = {}) {
    return buildCardDataPayload(template, instance, options);
  },

  verifyPartnerServerAuthorization(request: Request, expected: Row) {
    return verifyPartnerServerAuthorization(request, expected);
  },

  signAuthorizationToken(method: string, path: string, refId = '') {
    return signAuthorizationToken(method, path, refId);
  }
};
