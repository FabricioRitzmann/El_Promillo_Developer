// Direct Google Wallet provider for Supabase Edge Functions.
//
// Uses Google Wallet REST endpoints directly. For Generic passes, notification-
// triggering messages are sent through genericObject.addMessage with
// messageType TEXT_AND_NOTIFY, respecting service-level limits in the shared
// walletNotificationService.

import { featureEnabled, normalizeTemplateType, templateSettings } from './templateFeatures.ts';
import { supabaseCardEmblemUrl } from './cardEmblems.ts';

type Row = Record<string, any>;

const walletApiBase = 'https://walletobjects.googleapis.com/walletobjects/v1';
const walletPayloadKeys: Record<string, { classes: string; objects: string }> = {
  genericObject: {
    classes: 'genericClasses',
    objects: 'genericObjects'
  },
  loyaltyObject: {
    classes: 'loyaltyClasses',
    objects: 'loyaltyObjects'
  },
  offerObject: {
    classes: 'offerClasses',
    objects: 'offerObjects'
  },
  eventTicketObject: {
    classes: 'eventTicketClasses',
    objects: 'eventTicketObjects'
  }
};
const supportedObjectTypes = new Set(Object.keys(walletPayloadKeys));

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function cleanedSecretJson(value: string) {
  const text = stringValue(value);

  if (!text) {
    return '';
  }

  return text
    .replaceAll('\\r\\n', '\n')
    .replaceAll('\\n', '\n')
    .replaceAll('\\"', '"');
}

function unwrappedSecretJson(value: string) {
  const text = stringValue(value);
  const first = text[0];
  const last = text[text.length - 1];

  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1);
  }

  return text;
}

function parseServiceAccountJson(value: string) {
  const text = stringValue(value);

  if (!text) {
    return {};
  }

  const candidates = [
    text,
    cleanedSecretJson(text),
    unwrappedSecretJson(text),
    cleanedSecretJson(unwrappedSecretJson(text))
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate);

      if (typeof parsed === 'string' && parsed !== candidate) {
        return parseServiceAccountJson(parsed);
      }

      return parsed;
    } catch (_error) {
      // Naechster Kandidat versucht eine andere Escape-Variante.
    }
  }

  throw new Error('Invalid Google service account JSON secret.');
}

function configured(value: unknown) {
  const text = stringValue(value);
  return Boolean(text && !text.startsWith('YOUR_') && !text.includes('CHANGE_THIS'));
}

function normalizedHttpOrigin(value: unknown) {
  const text = stringValue(value);

  if (!configured(text) || !/^https?:\/\//i.test(text)) {
    return '';
  }

  try {
    return new URL(text).origin;
  } catch (_error) {
    return '';
  }
}

function googleWalletOrigins() {
  const origins = [
    ...stringValue(Deno.env.get('GOOGLE_WALLET_ORIGINS'))
      .split(',')
      .map((origin) => origin.trim()),
    stringValue(Deno.env.get('APP_PUBLIC_BASE_URL')),
    stringValue(Deno.env.get('APP_BASE_URL'))
  ].map(normalizedHttpOrigin).filter(Boolean);

  return [...new Set(origins)];
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

function decodePrivateKey(pem: string) {
  const normalizedPem = normalizePem(pem);

  if (normalizedPem.includes('BEGIN RSA PRIVATE KEY')) {
    throw {
      ok: false,
      status: 501,
      error_code: 'GOOGLE_WALLET_PRIVATE_KEY_FORMAT',
      error_message: 'Google Private Key hat das falsche Format.',
      error_reason: 'Nutze den PKCS8 Private Key aus der Google-Service-Account-JSON-Datei.'
    };
  }

  const normalized = normalizedPem
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

async function signRs256(payload: Row, privateKeyPem: string, header: Row = {}) {
  const jwtHeader = {
    alg: 'RS256',
    typ: 'JWT',
    ...header
  };
  const signingInput = `${base64Url(JSON.stringify(jwtHeader))}.${base64Url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodePrivateKey(privateKeyPem),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function googleConfig() {
  const rawJson = stringValue(Deno.env.get('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON'));
  const issuerId = stringValue(Deno.env.get('GOOGLE_WALLET_ISSUER_ID'));
  const classSuffix = stringValue(Deno.env.get('GOOGLE_WALLET_CLASS_SUFFIX') || 'wallet_cards_mvp');
  const origins = googleWalletOrigins();

  if (!configured(rawJson) || !configured(issuerId)) {
    return {
      configured: false,
      issuerId,
      classSuffix,
      origins,
      clientEmail: '',
      privateKey: ''
    };
  }

  let parsed: Row;

  try {
    parsed = parseServiceAccountJson(rawJson);
  } catch (_error) {
    return {
      configured: false,
      issuerId,
      classSuffix,
      origins,
      clientEmail: '',
      privateKey: '',
      error_code: 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INVALID',
      error_message: 'Google Wallet Service Account JSON ist ungültig.',
      error_reason: 'Kopiere die komplette Service-Account-JSON-Datei unverändert in GOOGLE_WALLET_SERVICE_ACCOUNT_JSON.'
    };
  }

  const clientEmail = stringValue(parsed.client_email);
  const privateKey = stringValue(parsed.private_key);

  if (!configured(clientEmail) || !configured(privateKey)) {
    return {
      configured: false,
      issuerId,
      classSuffix,
      origins,
      clientEmail,
      privateKey,
      error_code: 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INCOMPLETE',
      error_message: 'Google Wallet Service Account JSON ist unvollständig.',
      error_reason: 'Die JSON-Datei muss mindestens client_email und private_key enthalten.'
    };
  }

  return {
    configured: true,
    issuerId,
    classSuffix,
    origins,
    clientEmail,
    privateKey
  };
}

function googleConfigError(config: Row) {
  return {
    ok: false,
    error_code: config.error_code || 'GOOGLE_WALLET_CONFIG_MISSING',
    error_message: config.error_message || 'Google Wallet Service Account fehlt.',
    error_reason: config.error_reason || 'Setze GOOGLE_WALLET_ISSUER_ID und GOOGLE_WALLET_SERVICE_ACCOUNT_JSON als Supabase Secrets.'
  };
}

function googleApiError(method: string, path: string, status: number, response: Row) {
  const providerError = response?.error || {};
  const providerStatus = stringValue(providerError.status);
  const providerMessage = stringValue(providerError.message || response?.error_description || response?.error);
  const statusCode = Number(providerError.code || status);

  return {
    ok: false,
    status,
    error_code: providerStatus ? `GOOGLE_WALLET_API_${providerStatus}` : 'GOOGLE_WALLET_API_ERROR',
    error_message: providerMessage || `Google Wallet API Anfrage fehlgeschlagen (${status}).`,
    error_reason: `${method} ${path} wurde von Google Wallet mit HTTP ${statusCode || status} abgelehnt.`,
    response
  };
}

function googleRequestError(method: string, path: string, error: unknown) {
  const message = error instanceof Error ? error.message : stringValue(error);

  return {
    ok: false,
    status: 502,
    error_code: 'GOOGLE_WALLET_API_REQUEST_FAILED',
    error_message: 'Google Wallet API Anfrage konnte nicht ausgeführt werden.',
    error_reason: `${method} ${path} konnte Google Wallet nicht erreichen: ${message || 'Netzwerk- oder Laufzeitfehler.'}`
  };
}

async function googleAccessToken() {
  const config = googleConfig();

  if (!config.configured || !configured(config.clientEmail) || !configured(config.privateKey)) {
    return googleConfigError(config);
  }

  const now = Math.floor(Date.now() / 1000);
  let assertion;

  try {
    assertion = await signRs256({
      iss: config.clientEmail,
      scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    }, config.privateKey);
  } catch (error) {
    if ((error as Row)?.error_code) {
      return error as Row;
    }

    return {
      ok: false,
      status: 501,
      error_code: 'GOOGLE_WALLET_TOKEN_SIGNING_FAILED',
      error_message: 'Google OAuth Assertion konnte nicht signiert werden.',
      error_reason: error instanceof Error ? error.message : 'Prüfe Service-Account-Private-Key und Supabase Secret Format.'
    };
  }

  let response;

  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      })
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error_code: 'GOOGLE_WALLET_TOKEN_REQUEST_FAILED',
      error_message: 'Google OAuth Token konnte nicht angefragt werden.',
      error_reason: error instanceof Error ? error.message : 'OAuth-Token-Endpunkt konnte nicht erreicht werden.'
    };
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      error_code: 'GOOGLE_WALLET_TOKEN_FAILED',
      error_message: 'Google OAuth Token konnte nicht erstellt werden.',
      error_reason: result.error_description || result.error || 'Prüfe den Service Account und die Wallet API Freigabe.',
      response: result
    };
  }

  return {
    ok: true,
    accessToken: result.access_token as string
  };
}

async function googleApi(method: string, path: string, body: Row | null = null) {
  const token = await googleAccessToken();

  if (!token.ok) {
    return token;
  }

  let response;

  try {
    response = await fetch(`${walletApiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        'content-type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    return googleRequestError(method, path, error);
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    return googleApiError(method, path, response.status, result);
  }

  return {
    ok: response.ok,
    status: response.status,
    response: result
  };
}

function objectTypeForTemplate(template: Row) {
  const templateType = normalizeTemplateType(template);

  if (templateType === 'event_card') {
    return 'eventTicketObject';
  }

  if (templateType === 'coupon_card') {
    return 'offerObject';
  }

  if (['stamp_card', 'streak_card', 'vip_card', 'membership_card'].includes(templateType)) {
    return 'loyaltyObject';
  }

  return 'genericObject';
}

function classTypeForObjectType(objectType: string) {
  return objectType.replace('Object', 'Class');
}

function payloadKeysForObjectType(objectType: string) {
  if (walletPayloadKeys[objectType]) {
    return walletPayloadKeys[objectType];
  }

  const classType = classTypeForObjectType(objectType);

  return {
    objects: `${objectType}s`,
    classes: classType.replace(/Class$/, 'Classes')
  };
}

function normalizeObjectType(value: unknown) {
  const objectType = stringValue(value);

  return supportedObjectTypes.has(objectType) ? objectType : '';
}

function invalidObjectTypeResult(objectType: unknown) {
  return {
    ok: false,
    status: 'failed',
    error_code: 'GOOGLE_WALLET_OBJECT_TYPE_INVALID',
    error_message: 'Google Wallet Object Type ist ungültig.',
    error_reason: `${stringValue(objectType) || 'leer'} wird nicht unterstützt. Erlaubt sind genericObject, loyaltyObject, offerObject und eventTicketObject.`
  };
}

function safeIdSuffix(value: unknown) {
  return stringValue(value)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+|_+$/g, '')
    || crypto.randomUUID();
}

function googleObjectIdFor(config: Row, cardInstance: Row) {
  const stored = stringValue(cardInstance.google_object_id || cardInstance.wallet_object_id);

  if (stored.startsWith(`${config.issuerId}.`)) {
    return stored;
  }

  const fallbackValue = cardInstance.card_instance_number
    || cardInstance.customer_cards?.card_instance_number
    || cardInstance.customer_cards?.customer_code
    || cardInstance.id;

  return `${config.issuerId}.${safeIdSuffix(stored || fallbackValue)}`;
}

function classIdForTemplate(config: Row, template: Row) {
  const suffix = [
    config.classSuffix || 'wallet_cards_mvp',
    normalizeTemplateType(template),
    template.id || template.card_name || 'wallet_cards'
  ].map(safeIdSuffix).filter(Boolean).join('_');

  return `${config.issuerId}.${suffix}`;
}

function localized(value: unknown, fallback = '') {
  return {
    defaultValue: {
      language: 'de',
      value: stringValue(value) || fallback
    }
  };
}

function settingsForTemplate(template: Row) {
  return template.settings && typeof template.settings === 'object' && !Array.isArray(template.settings)
    ? template.settings
    : {};
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function numberValue(...values: unknown[]) {
  const numeric = Number(firstDefined(...values));

  return Number.isFinite(numeric) ? numeric : 0;
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

function cardFeatureRows(template: Row, cardInstance: Row) {
  const settings = templateSettings(template);
  const customer = cardInstance.customer_cards || {};
  const metadata = metadataFor(cardInstance);
  const rows: Array<{ id: string; header: string; body: string }> = [];
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
        id: 'membershipNumber',
        header: stringValue(metadata.membership_number || cardInstance.membership_number) ? 'Mitgliedsnummer' : 'Mitgliedschaft',
        body: stringValue(metadata.membership_number || cardInstance.membership_number || metadata.membership_status || cardInstance.membership_status || settings.membershipStatus) || 'Aktiv'
      });
    }

    if (featureEnabled(template, 'vip')) {
      rows.push({ id: 'vip', header: 'VIP', body: vipStatus || 'Member' });
    }

    if (featureEnabled(template, 'balance')) {
      rows.push({ id: 'balance', header: 'Guthaben', body: formatMoney(balanceCents, currency) });
    }

    if (featureEnabled(template, 'membership')) {
      const membershipExpiresAt = stringValue(metadata.membership_expires_at || cardInstance.membership_expires_at || settings.membershipExpiresAt);
      rows.push({
        id: 'membershipStatus',
        header: 'Mitgliedsstatus',
        body: [
          stringValue(metadata.membership_status || cardInstance.membership_status || settings.membershipStatus) || 'Aktiv',
          membershipExpiresAt ? `bis ${membershipExpiresAt}` : ''
        ].filter(Boolean).join(' ')
      });
    }

    if (featureEnabled(template, 'redemption')) {
      rows.push({
        id: 'redemption',
        header: stringValue(settings.couponTitle) || 'Coupon',
        body: stringValue(cardInstance.coupon_status || metadata.coupon_status || customer.status || cardInstance.status) === 'redeemed' ? 'Eingelöst' : 'Bereit'
      });
    }

    if (featureEnabled(template, 'cloakroom')) {
      rows.push({ id: 'cloakroom', header: 'Garderobe', body: cloakroomActive ? 'Aktiv' : 'Bereit' });
    }

    if (!rows.length) {
      rows.push({ id: 'status', header: 'Status', body: statusLabel(customer.status || cardInstance.status) });
    }

    return rows;
  }

  if (featureEnabled(template, 'stamps')) {
    rows.push({
      id: 'stamps',
      header: 'Stempel',
      body: `${stampCount} / ${stampsRequired}`
    });
  }

  if (featureEnabled(template, 'streak')) {
    rows.push({
      id: 'streak',
      header: 'Streak',
      body: streakGoal > 0 ? `${streakCount} / ${streakGoal}` : String(streakCount)
    });
  }

  if (featureEnabled(template, 'vip')) {
    rows.push({
      id: 'vip',
      header: 'VIP',
      body: vipStatus || 'Member'
    });
  }

  if (featureEnabled(template, 'balance')) {
    rows.push({
      id: 'balance',
      header: 'Guthaben',
      body: formatMoney(balanceCents, currency)
    });
  }

  if (featureEnabled(template, 'cloakroom')) {
    rows.push({
      id: 'cloakroom',
      header: 'Garderobe',
      body: cloakroomActive ? 'Aktiv' : 'Bereit'
    });
  }

  if (featureEnabled(template, 'checkin')) {
    rows.push({
      id: 'checkin',
      header: stringValue(settings.eventName) || 'Einlass',
      body: stringValue(metadata.event_status) || 'Bereit'
    });
  }

  if (featureEnabled(template, 'redemption')) {
    rows.push({
      id: 'redemption',
      header: stringValue(settings.couponTitle) || 'Coupon',
      body: stringValue(customer.status || cardInstance.status) === 'redeemed' ? 'Eingelöst' : 'Bereit'
    });
  }

  if (featureEnabled(template, 'membership')) {
    rows.push({
      id: 'membership',
      header: 'Mitgliedschaft',
      body: stringValue(metadata.membership_status || settings.membershipStatus) || 'Aktiv'
    });
  }

  if (!rows.length) {
    rows.push({
      id: 'status',
      header: 'Status',
      body: statusLabel(customer.status || cardInstance.status)
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

function statusModules(template: Row, cardInstance: Row, extraRows: Array<{ id: string; header: string; body: string }> = []) {
  const rewardText = rewardTextForTemplate(template);
  const rows = [
    ...extraRows,
    ...cardFeatureRows(template, cardInstance),
    {
      id: 'card-id',
      header: 'Karten-ID',
      body: cardCodeFor(cardInstance)
    }
  ];

  if (rewardVisible(template, cardInstance)) {
    rows.push({
      id: 'reward',
      header: 'Belohnung',
      body: rewardText
    });
  }

  return rows
    .filter((row) => row.body)
    .map((row) => ({
      id: row.id,
      header: row.header,
      body: row.body
    }));
}

function statusPatchPayload(template: Row, cardInstance: Row, objectType = objectTypeForTemplate(template), extraRows: Array<{ id: string; header: string; body: string }> = []) {
  const modules = statusModules(template, cardInstance, extraRows);
  const patch: Row = {
    textModulesData: modules
  };
  const primaryStatusRow = cardFeatureRows(template, cardInstance)[0];

  if (objectType === 'loyaltyObject' && primaryStatusRow) {
    patch.accountId = cardCodeFor(cardInstance);
    patch.accountName = stringValue(cardInstance.customer_cards?.metadata?.customer_name || cardInstance.customer_cards?.customer_code || cardCodeFor(cardInstance));
    patch.loyaltyPoints = {
      label: primaryStatusRow.header,
      balance: {
        string: primaryStatusRow.body
      }
    };
  }

  return patch;
}

function dateTimeValue(settings: Row) {
  const eventDate = stringValue(settings.eventDate || settings.event_date);
  const startTime = stringValue(settings.eventStartTime || settings.event_start_time || '00:00');
  const endTime = stringValue(settings.eventEndTime || settings.event_end_time);

  if (!eventDate) {
    return null;
  }

  const dateTime: Row = {
    start: `${eventDate}T${startTime.length === 5 ? `${startTime}:00` : startTime}`
  };

  if (endTime) {
    dateTime.end = `${eventDate}T${endTime.length === 5 ? `${endTime}:00` : endTime}`;
  }

  return dateTime;
}

function offerValidTimeInterval(settings: Row, metadata: Row = {}) {
  const validUntil = stringValue(
    metadata.coupon_valid_until
      || metadata.couponValidUntil
      || settings.couponValidUntil
      || settings.coupon_valid_until
  );

  if (!validUntil) {
    return null;
  }

  return {
    end: {
      date: validUntil.includes('T') ? validUntil : `${validUntil}T23:59:59Z`
    }
  };
}

function imageValue(url: unknown, label = 'Logo') {
  const uri = stringValue(url);

  if (!uri.startsWith('https://')) {
    return null;
  }

  return {
    sourceUri: { uri },
    contentDescription: localized(label)
  };
}

function appPublicAssetUrl(pathname: string) {
  const baseUrl = stringValue(Deno.env.get('APP_PUBLIC_BASE_URL') || Deno.env.get('APP_BASE_URL') || 'https://el-promillo.ch');

  try {
    return new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch (_error) {
    return `https://el-promillo.ch${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  }
}

function fallbackLogoImage(label = 'Logo') {
  return imageValue(appPublicAssetUrl('/assets/el-promillo-header-logo-couple-cutout.png'), label);
}

function templateBusiness(template: Row) {
  return Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;
}

function businessNameForTemplate(template: Row, fallback = 'Wallet Cards') {
  const business = templateBusiness(template);
  return stringValue(business?.name || template.business_name || fallback);
}

function businessLogoUrlForTemplate(template: Row) {
  const business = templateBusiness(template);
  return stringValue(business?.logo_url || template.business_logo_url || template.company_logo_url || template.logo_url);
}

function eventVenueAddressForTemplate(template: Row) {
  const settings = settingsForTemplate(template);
  const business = templateBusiness(template);

  return stringValue(
    settings.eventAddress
      || settings.event_address
      || business?.address
      || template.business_address
      || settings.eventLocation
      || settings.event_location
      || businessNameForTemplate(template, 'Eventlocation')
  );
}

function eventBackgroundImageForTemplate(template: Row) {
  const settings = settingsForTemplate(template);

  if (normalizeTemplateType(template) !== 'event_card') {
    return null;
  }

  return imageValue(
    settings.eventGoogleHeroImageUrl
      || settings.event_google_hero_image_url
      || settings.eventBackgroundImageUrl
      || settings.event_background_image_url,
    'Eventbild'
  );
}

function cardEmblemImageForObject(cardInstance: Row) {
  return imageValue(
    supabaseCardEmblemUrl(cardInstance, Deno.env.get('SUPABASE_URL') || ''),
    'Karten-Emblem'
  );
}

function googleWalletWatermarkImage() {
  return imageValue(appPublicAssetUrl('/assets/el-promillo-google-watermark.png'), 'El Promillo');
}

function applyObjectEmblemImages(payload: Row, cardInstance: Row) {
  const watermarkImage = googleWalletWatermarkImage() || cardEmblemImageForObject(cardInstance);

  if (!watermarkImage) {
    return payload;
  }

  if (!payload.heroImage) {
    payload.heroImage = watermarkImage;
  }

  payload.imageModulesData = [
    {
      id: 'el_promillo_watermark',
      mainImage: watermarkImage
    }
  ];

  return payload;
}

function buildClassPayload(template: Row, objectType: string, classId: string) {
  const settings = settingsForTemplate(template);
  const issuerName = businessNameForTemplate(template);
  const logo = imageValue(businessLogoUrlForTemplate(template), 'Logo');

  if (objectType === 'loyaltyObject') {
    return {
      id: classId,
      issuerName,
      reviewStatus: 'UNDER_REVIEW',
      programName: stringValue(template.card_name || businessNameForTemplate(template, 'Kundenkarte')) || 'Kundenkarte',
      programLogo: logo || fallbackLogoImage('Programm-Logo'),
      accountNameLabel: 'Kunde',
      accountIdLabel: 'Karten-ID',
      rewardsTierLabel: 'Status',
      hexBackgroundColor: stringValue(template.primary_color || '#fffaf2')
    };
  }

  if (objectType === 'eventTicketObject') {
    const eventDateTime = dateTimeValue(settings);
    const eventClass: Row = {
      id: classId,
      issuerName,
      reviewStatus: 'UNDER_REVIEW',
      eventId: safeIdSuffix(settings.eventId || template.id || template.card_name || classId).slice(0, 64),
      eventName: localized(settings.eventName || template.card_name, 'Event'),
      venue: {
        name: localized(settings.eventLocation || businessNameForTemplate(template, template.card_name || 'Eventlocation'), 'Eventlocation'),
        address: localized(eventVenueAddressForTemplate(template), 'Eventlocation')
      }
    };

    if (eventDateTime) {
      eventClass.dateTime = eventDateTime;
    }

    if (logo) {
      eventClass.logo = logo;
    }

    return eventClass;
  }

  if (objectType === 'offerObject') {
    const title = stringValue(settings.couponTitle || template.card_name || template.description || 'Angebot');
    const provider = businessNameForTemplate(template, issuerName);
    const offerClass: Row = {
      id: classId,
      issuerName,
      reviewStatus: 'UNDER_REVIEW',
      title,
      localizedTitle: localized(title, 'Angebot'),
      redemptionChannel: 'BOTH',
      provider,
      localizedProvider: localized(provider, issuerName),
      hexBackgroundColor: stringValue(template.primary_color || '#fffaf2')
    };
    const details = stringValue(template.description || settings.discountValue || settings.discount_value);
    const finePrint = stringValue(settings.redemptionTerms || settings.redemption_terms);

    if (details) {
      offerClass.details = details;
      offerClass.localizedDetails = localized(details);
    }

    if (finePrint) {
      offerClass.finePrint = finePrint;
      offerClass.localizedFinePrint = localized(finePrint);
    }

    if (logo) {
      offerClass.titleImage = logo;
      offerClass.logo = logo;
    }

    return offerClass;
  }

  const classPayload: Row = {
    id: classId,
    issuerName,
    reviewStatus: 'UNDER_REVIEW'
  };

  if (logo) {
    classPayload.logo = logo;
  }

  return classPayload;
}

function buildObjectPayload(config: Row, template: Row, cardInstance: Row, objectId: string, classId: string, objectType = 'genericObject') {
  const cardCode = cardCodeFor(cardInstance);
  const settings = settingsForTemplate(template);
  const metadata = metadataFor(cardInstance);
  const eventBusinessName = objectType === 'eventTicketObject' ? businessNameForTemplate(template) : '';
  const statusPatch = statusPatchPayload(
    template,
    cardInstance,
    objectType,
    eventBusinessName ? [{ id: 'business_name', header: 'Firma', body: eventBusinessName }] : []
  );

  if (objectType === 'eventTicketObject') {
    const eventBackgroundImage = eventBackgroundImageForTemplate(template);
    const ticketNumber = stringValue(metadata.ticket_number || cardCode);
    const ticketType = stringValue(metadata.ticket_type || settings.ticketType || template.card_name || 'Standard');
    const holderName = stringValue(metadata.ticket_holder_name || metadata.customer_name);
    const seat = stringValue(metadata.seat || settings.seat);
    const row = stringValue(metadata.row || settings.row);
    const section = stringValue(metadata.section || settings.section);
    const gate = stringValue(metadata.gate || settings.gate);
    const eventObject: Row = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      hexBackgroundColor: stringValue(template.primary_color || '#fffaf2'),
      ticketNumber,
      ticketType: localized(ticketType, 'Standard'),
      reservationInfo: {
        confirmationCode: ticketNumber
      },
      barcode: {
        type: 'QR_CODE',
        value: cardCode,
        alternateText: cardCode
      },
      textModulesData: statusPatch.textModulesData
    };

    if (eventBackgroundImage) {
      eventObject.heroImage = eventBackgroundImage;
    }

    if (holderName) {
      eventObject.ticketHolderName = holderName;
    }

    if (seat || row || section || gate) {
      eventObject.seatInfo = {
        seat: seat ? localized(seat) : undefined,
        row: row ? localized(row) : undefined,
        section: section ? localized(section) : undefined,
        gate: gate ? localized(gate) : undefined
      };
    }

    return applyObjectEmblemImages(eventObject, cardInstance);
  }

  if (objectType === 'offerObject') {
    const offerObject: Row = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      barcode: {
        type: 'QR_CODE',
        value: cardCode,
        alternateText: cardCode
      },
      textModulesData: statusPatch.textModulesData
    };
    const validTimeInterval = offerValidTimeInterval(settings, metadata);

    if (validTimeInterval) {
      offerObject.validTimeInterval = validTimeInterval;
    }

    return applyObjectEmblemImages(offerObject, cardInstance);
  }

  if (objectType === 'loyaltyObject') {
    const loyaltyObject: Row = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      accountId: statusPatch.accountId,
      accountName: statusPatch.accountName,
      loyaltyPoints: statusPatch.loyaltyPoints,
      barcode: {
        type: 'QR_CODE',
        value: cardCode,
        alternateText: cardCode
      },
      textModulesData: statusPatch.textModulesData
    };

    return applyObjectEmblemImages(loyaltyObject, cardInstance);
  }

  const businessLogo = imageValue(businessLogoUrlForTemplate(template), 'Logo');
  const objectPayload: Row = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    hexBackgroundColor: stringValue(template.primary_color || '#fffaf2'),
    cardTitle: localized(template.card_name, 'Kundenkarte'),
    header: localized(businessNameForTemplate(template, template.card_name || 'Karte'), 'Karte'),
    subheader: localized(template.description || template.template_type, 'Digitale Karte'),
    barcode: {
      type: 'QR_CODE',
      value: cardCode,
      alternateText: cardCode
    },
    textModulesData: statusPatch.textModulesData
  };

  if (businessLogo) {
    objectPayload.logo = businessLogo;
  }

  return applyObjectEmblemImages(objectPayload, cardInstance);
}

function pickPayloadFields(payload: Row, fieldNames: string[]) {
  const patch: Row = {};

  for (const fieldName of fieldNames) {
    if (payload[fieldName] !== undefined && payload[fieldName] !== null) {
      patch[fieldName] = payload[fieldName];
    }
  }

  return patch;
}

function hasPatchFields(patch: Row) {
  return Object.keys(patch).length > 0;
}

function classLogoPatchPayload(payload: Row) {
  return pickPayloadFields(payload, ['logo', 'programLogo', 'titleImage']);
}

function objectLogoPatchPayload(payload: Row) {
  return pickPayloadFields(payload, ['logo', 'heroImage', 'imageModulesData']);
}

export const googleWalletProvider = {
  objectTypeForTemplate(template: Row) {
    return objectTypeForTemplate(template);
  },

  normalizeObjectType(value: unknown) {
    return normalizeObjectType(value);
  },

  async createClass(template: Row, objectType = 'genericObject') {
    const config = googleConfig();
    const normalizedObjectType = normalizeObjectType(objectType);

    if (!normalizedObjectType) {
      return invalidObjectTypeResult(objectType);
    }

    if (!config.configured) {
      return {
        status: 'skipped',
        ...googleConfigError(config)
      };
    }

    const classType = classTypeForObjectType(normalizedObjectType);
    const classId = classIdForTemplate(config, template);
    const payload = buildClassPayload(template, normalizedObjectType, classId);
    const result = await googleApi('POST', `/${classType}`, payload);

    if (!result.ok && result.status === 409) {
      const logoPatch = classLogoPatchPayload(payload);

      if (hasPatchFields(logoPatch)) {
        const patchResult = await googleApi('PATCH', `/${classType}/${encodeURIComponent(classId)}`, logoPatch);

        if (patchResult.ok) {
          return {
            ok: true,
            status: 'updated',
            classId,
            response: result.response
          };
        }

        return {
          ok: true,
          status: 'exists',
          classId,
          response: result.response,
          warning_code: patchResult.error_code || 'GOOGLE_CLASS_LOGO_PATCH_FAILED',
          warning_message: patchResult.error_message || patchResult.error_reason || 'Google Wallet Class existiert, das Firmenlogo konnte aber nicht gepatcht werden.'
        };
      }

      return {
        ok: true,
        status: 'exists',
        classId,
        response: result.response
      };
    }

    return {
      ...result,
      classId
    };
  },

  async createObject(template: Row, cardInstance: Row) {
    const config = googleConfig();
    const objectType = objectTypeForTemplate(template);
    const classResult = await this.createClass(template, objectType);

    if (!classResult.ok) {
      return classResult;
    }

    const objectId = googleObjectIdFor(config, cardInstance);
    const payload = buildObjectPayload(config, template, cardInstance, objectId, classResult.classId, objectType);
    const result = await googleApi('POST', `/${objectType}`, payload);

    if (!result.ok && result.status === 409) {
      const logoPatch = objectLogoPatchPayload(payload);

      if (hasPatchFields(logoPatch)) {
        const patchResult = await googleApi('PATCH', `/${objectType}/${encodeURIComponent(objectId)}`, logoPatch);

        if (patchResult.ok) {
          return {
            ok: true,
            status: 'updated',
            objectType,
            objectId,
            classId: classResult.classId,
            response: result.response
          };
        }

        return {
          ok: true,
          status: 'exists',
          objectType,
          objectId,
          classId: classResult.classId,
          response: result.response,
          warning_code: patchResult.error_code || 'GOOGLE_OBJECT_LOGO_PATCH_FAILED',
          warning_message: patchResult.error_message || patchResult.error_reason || 'Google Wallet Object existiert, das Firmenlogo konnte aber nicht gepatcht werden.'
        };
      }

      return {
        ok: true,
        status: 'exists',
        objectType,
        objectId,
        classId: classResult.classId,
        response: result.response
      };
    }

    return {
      ...result,
      objectType,
      objectId,
      classId: classResult.classId
    };
  },

  async generateSaveLink(template: Row, cardInstance: Row) {
    const config = googleConfig();

    if (!config.configured) {
      return googleConfigError(config);
    }

    const objectType = objectTypeForTemplate(template);
    const classId = classIdForTemplate(config, template);
    const objectId = googleObjectIdFor(config, cardInstance);
    const classPayload = buildClassPayload(template, objectType, classId);
    const objectPayload = buildObjectPayload(config, template, cardInstance, objectId, classId, objectType);
    const payloadKeys = payloadKeysForObjectType(objectType);
    let jwt;

    try {
      jwt = await signRs256({
        iss: config.clientEmail,
        aud: 'google',
        typ: 'savetowallet',
        origins: config.origins,
        payload: {
          [payloadKeys.classes]: [classPayload],
          [payloadKeys.objects]: [objectPayload]
        }
      }, config.privateKey);
    } catch (error) {
      if ((error as Row)?.error_code) {
        return error as Row;
      }

      return {
        ok: false,
        status: 501,
        error_code: 'GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED',
        error_message: 'Google Wallet Save-Link konnte nicht signiert werden.',
        error_reason: error instanceof Error ? error.message : 'Prüfe Service-Account-Private-Key und Supabase Secret Format.'
      };
    }

    return {
      ok: true,
      saveUrl: `https://pay.google.com/gp/v/save/${jwt}`,
      objectId,
      classId,
      objectType
    };
  },

  async updateObject(objectType: string, objectId: string, patch: Row) {
    const normalizedObjectType = normalizeObjectType(objectType);

    if (!normalizedObjectType) {
      return invalidObjectTypeResult(objectType);
    }

    return googleApi('PATCH', `/${normalizedObjectType}/${encodeURIComponent(objectId)}`, patch);
  },

  statusPatch(template: Row, cardInstance: Row, objectType = objectTypeForTemplate(template), extraRows: Array<{ id: string; header: string; body: string }> = []) {
    return statusPatchPayload(template, cardInstance, objectType, extraRows);
  },

  async addMessage(objectType: string, objectId: string, title: string, message: string, messageType = 'TEXT') {
    const normalizedObjectType = normalizeObjectType(objectType);

    if (!normalizedObjectType) {
      return invalidObjectTypeResult(objectType);
    }

    return googleApi('POST', `/${normalizedObjectType}/${encodeURIComponent(objectId)}/addMessage`, {
      message: {
        header: title,
        body: message,
        messageType
      }
    });
  },

  async sendTextAndNotify(objectType: string, objectId: string, title: string, message: string) {
    return this.addMessage(objectType, objectId, title, message, 'TEXT_AND_NOTIFY');
  }
};
