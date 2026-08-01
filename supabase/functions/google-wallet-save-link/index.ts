// Supabase Edge Function: Google-Wallet-Save-Link erzeugen.
//
// Die öffentliche Claim-Seite legt zuerst per claim-card eine Karteninstanz an.
// Diese Funktion liest danach die gespeicherte Karte serverseitig und signiert,
// falls Google-Secrets gesetzt sind, einen Save-to-Google-Wallet-JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { featureEnabled, normalizeTemplateType, templateSettings } from '../_shared/templateFeatures.ts';
import { enforcePublicClaimRateLimit } from '../_shared/publicRateLimit.ts';
import { supabaseCardEmblemUrl } from '../_shared/cardEmblems.ts';

type Row = Record<string, any>;

const googleTemplateSelect = [
  'id',
  'owner_id',
  'business_id',
  'business_name',
  'card_name',
  'card_type',
  'template_type',
  'description',
  'primary_color',
  'text_color',
  'logo_url',
  'businesses(name,logo_url,updated_at,company_logo_updated_at)',
  'reward_text',
  'stamps_required',
  'streak_goal',
  'vip_tier',
  'settings',
  'club_features',
  'club_settings',
  'is_active',
  'created_at',
  'updated_at'
].join(',');

const googleCustomerCardSelect = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
  'card_instance_number',
  'customer_code',
  'status',
  'stamp_count',
  'streak_count',
  'vip_status',
  'wallet_platform',
  'wallet_object_id',
  'wallet_serial_number',
  'balance_cents',
  'currency',
  'cloakroom_active',
  'metadata',
  'created_at',
  'updated_at'
].join(',');

const googleClaimCardSelect = [
  googleCustomerCardSelect,
  `card_templates(${googleTemplateSelect})`
].join(',');

const googleCardInstanceSelect = [
  'id',
  'customer_card_id',
  'owner_id',
  'business_id',
  'template_id',
  'card_instance_number',
  'wallet_platform',
  'wallet_object_id',
  'wallet_serial_number',
  'google_object_id',
  'demographics_collected',
  'customer_gender',
  'resolved_emblem_key',
  'resolved_emblem_url',
  'emblem_updated_at',
  'created_at',
  'updated_at'
].join(',');

const googleWalletObjectSelect = [
  'id',
  'save_url',
  'created_at',
  'updated_at'
].join(',');

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

function createStructuredError(statusCode: number, errorCode: string, message: string, reason: string) {
  return {
    statusCode,
    error_code: errorCode,
    error_message: message,
    error_reason: reason
  };
}

function errorJson(error: any) {
  const status = Number(error?.statusCode || error?.status || 500);

  return json({
    error: error?.message || error?.error_message || 'Unbekannter Fehler',
    error_code: error?.error_code || 'GOOGLE_WALLET_SAVE_LINK_ERROR',
    error_message: error?.error_message || error?.message || 'Google-Wallet-Link konnte nicht erstellt werden.',
    error_reason: error?.error_reason || 'Bitte prüfe die Google-Wallet-Konfiguration.'
  }, status);
}

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

function timestampMs(value: unknown) {
  const time = value ? new Date(String(value)).getTime() : 0;

  return Number.isFinite(time) ? time : 0;
}

function newestSourceTimestamp(card: Row, cardInstance: Row | null = null) {
  const template = card.card_templates || {};
  const business = Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;

  return Math.max(
    timestampMs(card.updated_at),
    timestampMs(cardInstance?.updated_at),
    timestampMs(template.updated_at),
    timestampMs(business?.updated_at),
    timestampMs(business?.company_logo_updated_at),
    timestampMs(card.created_at),
    timestampMs(cardInstance?.created_at),
    timestampMs(template.created_at)
  );
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

function localized(value: unknown, fallback = '') {
  return {
    defaultValue: {
      language: 'de',
      value: stringValue(value) || fallback
    }
  };
}

function cleanHexColor(value: unknown) {
  const color = stringValue(value) || '#fffaf2';
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#fffaf2';
}

function safeObjectSuffix(value: unknown) {
  return stringValue(value)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+|_+$/g, '')
    || crypto.randomUUID();
}

function googleObjectId(issuerId: string, storedValue: unknown, fallbackValue: unknown) {
  const stored = stringValue(storedValue);

  if (stored.startsWith(`${issuerId}.`)) {
    return stored;
  }

  return `${issuerId}.${safeObjectSuffix(stored || fallbackValue)}`;
}

function googleClassId(config: ReturnType<typeof googleWalletConfig>, template: Row) {
  const suffix = [
    config.classSuffix,
    normalizeTemplateType(template),
    template.id || template.card_name || 'wallet_cards'
  ].map(safeObjectSuffix).filter(Boolean).join('_');

  return `${config.issuerId}.${suffix}`;
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

function formatMoney(cents: unknown, currency: unknown) {
  const amount = Number(cents || 0) / 100;
  return `${amount.toFixed(2)} ${stringValue(currency) || 'CHF'}`;
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

function rewardTextForTemplate(template: Row) {
  const settings = templateSettings(template);

  return stringValue(template.reward_text || settings.rewardText || settings.reward_text);
}

function rewardVisible(template: Row, card: Row) {
  const settings = templateSettings(template);
  const rewardText = rewardTextForTemplate(template);
  const stampCount = Number(card.stamp_count || 0);
  const stampsRequired = Math.max(1, Number(template.stamps_required || settings.stampsRequired || 10));
  const streakCount = Number(card.streak_count || 0);
  const streakGoal = Number(template.streak_goal || settings.streakGoal || 0);

  return Boolean(rewardText) && (
    featureEnabled(template, 'vip')
    || featureEnabled(template, 'redemption')
    || featureEnabled(template, 'membership')
    || (featureEnabled(template, 'stamps') && stampCount >= stampsRequired)
    || (featureEnabled(template, 'streak') && streakGoal > 0 && streakCount >= streakGoal)
  );
}

function cardFeatureRows(template: Row, card: Row) {
  const settings = templateSettings(template);
  const rows: Array<{ id: string; header: string; body: string }> = [];

  if (normalizeTemplateType(template) === 'club_card') {
    if (featureEnabled(template, 'membership')) {
      rows.push({
        id: 'membershipNumber',
        header: stringValue(card.metadata?.membership_number) ? 'Mitgliedsnummer' : 'Mitgliedschaft',
        body: stringValue(card.metadata?.membership_number || card.metadata?.membership_status || settings.membershipStatus) || 'Aktiv'
      });
    }

    if (featureEnabled(template, 'vip')) {
      rows.push({
        id: 'vip',
        header: 'VIP',
        body: stringValue(card.vip_status || template.vip_tier || settings.vipDefaultTier) || 'Standard'
      });
    }

    if (featureEnabled(template, 'balance')) {
      rows.push({
        id: 'balance',
        header: 'Guthaben',
        body: formatMoney(card.balance_cents, card.currency || settings.currency)
      });
    }

    if (featureEnabled(template, 'membership')) {
      rows.push({
        id: 'membershipStatus',
        header: 'Mitgliedsstatus',
        body: [
          stringValue(card.metadata?.membership_status || settings.membershipStatus) || 'Aktiv',
          card.metadata?.membership_expires_at || settings.membershipExpiresAt ? `bis ${card.metadata?.membership_expires_at || settings.membershipExpiresAt}` : ''
        ].filter(Boolean).join(' ')
      });
    }

    if (featureEnabled(template, 'redemption')) {
      rows.push({
        id: 'redemption',
        header: stringValue(settings.couponTitle) || 'Coupon',
        body: stringValue(card.metadata?.coupon_status || card.status) === 'redeemed' ? 'Eingelöst' : 'Bereit'
      });
    }

    if (featureEnabled(template, 'cloakroom')) {
      rows.push({
        id: 'cloakroom',
        header: 'Garderobe',
        body: card.cloakroom_active ? 'Aktiv' : 'Inaktiv'
      });
    }

    if (!rows.length) {
      rows.push({
        id: 'status',
        header: 'Status',
        body: statusLabel(card.status)
      });
    }

    return rows;
  }

  if (featureEnabled(template, 'stamps')) {
    rows.push({
      id: 'stamps',
      header: 'Stempel',
      body: `${Number(card.stamp_count || 0)} / ${Number(template.stamps_required || 10)}`
    });
  }

  if (featureEnabled(template, 'streak')) {
    rows.push({
      id: 'streak',
      header: 'Streak',
      body: `${Number(card.streak_count || 0)} / ${Number(template.streak_goal || settings.streakGoal || 0)}`
    });
  }

  if (featureEnabled(template, 'vip')) {
    rows.push({
      id: 'vip',
      header: 'VIP',
      body: stringValue(card.vip_status || template.vip_tier || settings.vipDefaultTier) || 'Standard'
    });
  }

  if (featureEnabled(template, 'balance')) {
    rows.push({
      id: 'balance',
      header: 'Guthaben',
      body: formatMoney(card.balance_cents, card.currency || settings.currency)
    });
  }

  if (featureEnabled(template, 'cloakroom')) {
    rows.push({
      id: 'cloakroom',
      header: 'Garderobe',
      body: card.cloakroom_active ? 'Aktiv' : 'Inaktiv'
    });
  }

  if (featureEnabled(template, 'checkin')) {
    rows.push({
      id: 'checkin',
      header: 'Einlass',
      body: stringValue(card.metadata?.event_status) || 'Bereit'
    });
  }

  if (featureEnabled(template, 'redemption')) {
    rows.push({
      id: 'redemption',
      header: 'Coupon',
      body: card.status === 'redeemed' ? 'Eingelöst' : 'Bereit'
    });
  }

  if (featureEnabled(template, 'membership')) {
    rows.push({
      id: 'membership',
      header: 'Mitgliedschaft',
      body: stringValue(card.metadata?.membership_status) || 'Aktiv'
    });
  }

  if (!rows.length) {
    rows.push({
      id: 'status',
      header: 'Status',
      body: stringValue(card.status) || 'Aktiv'
    });
  }

  if (rewardVisible(template, card)) {
    rows.push({
      id: 'reward',
      header: 'Belohnung',
      body: rewardTextForTemplate(template)
    });
  }

  rows.push({
    id: 'card-id',
    header: 'Karten-ID',
    body: stringValue(card.card_instance_number || card.customer_code)
  });

  return rows;
}

function decodePrivateKey(pem: string) {
  const normalized = pem.replace(/\\n/g, '\n').trim();

  if (normalized.includes('BEGIN RSA PRIVATE KEY')) {
    throw createStructuredError(
      500,
      'GOOGLE_WALLET_PRIVATE_KEY_FORMAT',
      'Google Private Key hat das falsche Format.',
      'Nutze den PKCS8 Private Key aus der Google-Service-Account-JSON-Datei.'
    );
  }

  const base64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
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

async function signJwt(payload: Record<string, unknown>, privateKeyPem: string) {
  try {
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };
    const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
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
  } catch (error) {
    if ((error as Row)?.error_code) {
      throw error;
    }

    throw createStructuredError(
      501,
      'GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED',
      'Google Wallet Save-Link konnte nicht signiert werden.',
      'Prüfe GOOGLE_WALLET_SERVICE_ACCOUNT_JSON: private_key muss der PKCS8-Key aus der JSON-Datei mit korrekten Zeilenumbrüchen sein.'
    );
  }
}

function googleWalletConfig() {
  const issuerId = stringValue(Deno.env.get('GOOGLE_WALLET_ISSUER_ID'));
  const classSuffix = stringValue(Deno.env.get('GOOGLE_WALLET_CLASS_SUFFIX') || 'wallet_cards_mvp');
  const serviceAccountJson = stringValue(Deno.env.get('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON'));
  let parsedServiceAccount: Row = {};

  if (serviceAccountJson) {
    try {
      parsedServiceAccount = parseServiceAccountJson(serviceAccountJson);
    } catch (_error) {
      throw createStructuredError(
        501,
        'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INVALID',
        'Google Wallet Service Account JSON ist ungültig.',
        'Kopiere die komplette Service-Account-JSON-Datei unverändert in GOOGLE_WALLET_SERVICE_ACCOUNT_JSON.'
      );
    }
  }

  const serviceAccountEmail = Deno.env.get('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL') || parsedServiceAccount.client_email;
  const privateKey = Deno.env.get('GOOGLE_WALLET_PRIVATE_KEY') || parsedServiceAccount.private_key;
  const origins = googleWalletOrigins();

  if (!configured(serviceAccountEmail) || !configured(privateKey)) {
    throw createStructuredError(
      501,
      'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INCOMPLETE',
      'Google Wallet Service Account JSON ist unvollständig.',
      'Setze GOOGLE_WALLET_SERVICE_ACCOUNT_JSON mit client_email und private_key oder die Legacy-Secrets GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL und GOOGLE_WALLET_PRIVATE_KEY.'
    );
  }

  if (!configured(issuerId) || !configured(classSuffix)) {
    throw createStructuredError(
      501,
      'GOOGLE_WALLET_CONFIG_MISSING',
      'Google Wallet ist noch nicht konfiguriert.',
      'Setze GOOGLE_WALLET_ISSUER_ID und optional GOOGLE_WALLET_CLASS_SUFFIX als Supabase Edge Secrets.'
    );
  }

  return {
    issuerId,
    classSuffix,
    serviceAccountEmail: stringValue(serviceAccountEmail),
    privateKey: stringValue(privateKey),
    origins
  };
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
  const settings = templateSettings(template);
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
  const settings = templateSettings(template);

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

function cardEmblemImageForObject(card: Row) {
  return imageValue(
    supabaseCardEmblemUrl(card, Deno.env.get('SUPABASE_URL') || ''),
    'Karten-Emblem'
  );
}

function googleWalletWatermarkImage() {
  return imageValue(appPublicAssetUrl('/assets/el-promillo-google-watermark.png'), 'El Promillo');
}

function applyObjectEmblemImages(payload: Row, card: Row) {
  const watermarkImage = googleWalletWatermarkImage() || cardEmblemImageForObject(card);

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

function buildClassPayload(template: Row, classId: string, objectType: string) {
  const settings = templateSettings(template);
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
      hexBackgroundColor: cleanHexColor(template.primary_color)
    };
  }

  if (objectType === 'eventTicketObject') {
    const eventDateTime = dateTimeValue(settings);
    const eventClass: Row = {
      id: classId,
      issuerName,
      reviewStatus: 'UNDER_REVIEW',
      eventId: safeObjectSuffix(settings.eventId || template.id || template.card_name || classId).slice(0, 64),
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
      hexBackgroundColor: cleanHexColor(template.primary_color)
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

function buildObjectPayload(template: Row, card: Row, objectId: string, classId: string, objectType: string) {
  const cardCode = stringValue(card.card_instance_number || card.customer_code);
  const rows = cardFeatureRows(template, card);
  const settings = templateSettings(template);
  const metadata = card.metadata && typeof card.metadata === 'object' ? card.metadata : {};

  if (objectType === 'eventTicketObject') {
    const businessName = businessNameForTemplate(template);
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
      hexBackgroundColor: cleanHexColor(template.primary_color),
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
      textModulesData: [
        { id: 'business_name', header: 'Firma', body: businessName },
        ...rows
      ].map((row) => ({
        id: row.id,
        header: row.header,
        body: row.body
      }))
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

    return applyObjectEmblemImages(eventObject, card);
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
      textModulesData: rows.map((row) => ({
        id: row.id,
        header: row.header,
        body: row.body
      }))
    };
    const validTimeInterval = offerValidTimeInterval(settings, metadata);

    if (validTimeInterval) {
      offerObject.validTimeInterval = validTimeInterval;
    }

    return applyObjectEmblemImages(offerObject, card);
  }

  if (objectType === 'loyaltyObject') {
    const primaryStatusRow = rows[0] || {
      id: 'status',
      header: 'Status',
      body: 'Aktiv'
    };
    const loyaltyObject: Row = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      accountId: cardCode,
      accountName: stringValue(card.metadata?.customer_name || card.customer_code || cardCode),
      loyaltyPoints: {
        label: primaryStatusRow.header,
        balance: {
          string: primaryStatusRow.body
        }
      },
      barcode: {
        type: 'QR_CODE',
        value: cardCode,
        alternateText: cardCode
      },
      textModulesData: rows.map((row) => ({
        id: row.id,
        header: row.header,
        body: row.body
      }))
    };

    return applyObjectEmblemImages(loyaltyObject, card);
  }

  const objectPayload: Row = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    genericType: 'GENERIC_TYPE_UNSPECIFIED',
    hexBackgroundColor: cleanHexColor(template.primary_color),
    cardTitle: localized(template.card_name, 'Kundenkarte'),
    header: localized(businessNameForTemplate(template, template.card_name || 'Karte'), 'Karte'),
    subheader: localized(template.description || normalizeTemplateType(template), 'Digitale Karte'),
    barcode: {
      type: 'QR_CODE',
      value: cardCode,
      alternateText: cardCode
    },
    textModulesData: rows.map((row) => ({
      id: row.id,
      header: row.header,
      body: row.body
    }))
  };

  const logo = imageValue(businessLogoUrlForTemplate(template), 'Logo');

  if (logo) {
    objectPayload.logo = logo;
  }

  return applyObjectEmblemImages(objectPayload, card);
}

function buildGoogleWalletPayload(config: ReturnType<typeof googleWalletConfig>, template: Row, card: Row, objectId: string, classId = googleClassId(config, template)) {
  const objectType = objectTypeForTemplate(template);
  const payloadKeys = payloadKeysForObjectType(objectType);
  const classPayload = buildClassPayload(template, classId, objectType);
  const objectPayload = buildObjectPayload(template, card, objectId, classId, objectType);

  return {
    iss: config.serviceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    origins: config.origins,
    payload: {
      [payloadKeys.classes]: [classPayload],
      [payloadKeys.objects]: [objectPayload]
    }
  };
}

async function loadGoogleCardInstance(supabaseAdmin: any, card: Row) {
  const { data, error } = await supabaseAdmin
    .from('card_instances')
    .select(googleCardInstanceSelect)
    .eq('customer_card_id', card.id)
    .eq('owner_id', card.owner_id)
    .eq('business_id', card.business_id)
    .eq('template_id', card.template_id)
    .eq('wallet_platform', 'google')
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw createStructuredError(
      404,
      'GOOGLE_CARD_INSTANCE_NOT_FOUND',
      'Google-Karteninstanz nicht gefunden.',
      'Die Claim-Funktion muss neben der Kundenkarte auch eine passende card_instance für Google Wallet angelegt haben.'
    );
  }

  return data;
}

async function findReusableGoogleWalletObject(supabaseAdmin: any, card: Row, cardInstance: Row, objectId: string, classId: string, objectType: string) {
  const { data, error } = await supabaseAdmin
    .from('google_wallet_objects')
    .select(googleWalletObjectSelect)
    .eq('owner_id', card.owner_id)
    .eq('business_id', card.business_id)
    .eq('template_id', card.template_id)
    .eq('card_instance_id', cardInstance.id)
    .eq('object_id', objectId)
    .eq('class_id', classId)
    .eq('object_type', objectType)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.save_url) {
    return null;
  }

  // Save-JWTs enthalten die komplette Google-Wallet-Payload. Nach Payload-
  // Korrekturen muessen alte Links frisch signiert werden, auch wenn die
  // Karteninstanz selbst unveraendert ist.
  return null;
}

async function logGoogleSaveLink(supabaseAdmin: any, card: Row, cardInstance: Row, status: string, payload: Row, errorMessage: string | null = null) {
  const { error: logError } = await supabaseAdmin.from('wallet_push_logs').insert({
    owner_id: card.owner_id,
    business_id: card.business_id,
    card_instance_id: cardInstance.id,
    wallet_platform: 'google',
    action: 'google_wallet_save_link',
    status,
    request_payload: {
      customer_card_id: card.id,
      card_instance_id: cardInstance.id,
      template_id: card.template_id,
      wallet_object_id: payload.objectId,
      object_type: payload.objectType,
      reused_save_link: Boolean(payload.reusedSaveLink)
    },
    response_payload: {
      object_id: payload.objectId,
      class_id: payload.classId,
      object_type: payload.objectType,
      save_url_present: Boolean(payload.saveUrl),
      save_url_length: stringValue(payload.saveUrl).length,
      reused_save_link: Boolean(payload.reusedSaveLink)
    },
    error_message: errorMessage
  });

  if (logError) {
    throw createStructuredError(
      500,
      'WALLET_PUSH_LOG_INSERT_FAILED',
      'Wallet Audit-Log konnte nicht gespeichert werden.',
      logError.message || 'google_wallet_save_link konnte nicht in wallet_push_logs geschrieben werden.'
    );
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur POST ist erlaubt.',
      error_reason: 'Google-Wallet-Save-Links müssen als POST angefordert werden.'
    }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw createStructuredError(
        500,
        'SUPABASE_EDGE_CONFIG_MISSING',
        'Supabase Edge Secrets fehlen.',
        'Setze SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY für diese Edge Function.'
      );
    }

    const body = await request.json().catch(() => ({})) as Row;
    const cardId = stringValue(body.cardId || body.card_id);
    const templateId = stringValue(body.templateId || body.template_id);
    const walletObjectId = stringValue(body.walletObjectId || body.wallet_object_id);

    if (!cardId || !templateId) {
      throw createStructuredError(
        400,
        'CARD_AND_TEMPLATE_REQUIRED',
        'Karten-ID oder Template-ID fehlt.',
        'Die Claim-Seite muss cardId und templateId an die Google-Wallet-Function senden.'
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    await enforcePublicClaimRateLimit(supabaseAdmin, request, 'google-wallet-save-link');

    const { data: card, error: cardError } = await supabaseAdmin
      .from('customer_cards')
      .select(googleClaimCardSelect)
      .eq('id', cardId)
      .eq('template_id', templateId)
      .eq('wallet_platform', 'google')
      .maybeSingle();

    if (cardError) {
      throw cardError;
    }

    if (!card || !card.card_templates) {
      throw createStructuredError(
        404,
        'GOOGLE_WALLET_CARD_NOT_FOUND',
        'Google-Wallet-Karte nicht gefunden.',
        'Erstelle die Karteninstanz zuerst über die Claim-Funktion.'
      );
    }

    if (!stringValue(card.business_id)) {
      throw createStructuredError(
        409,
        'GOOGLE_WALLET_BUSINESS_REQUIRED',
        'Diese Karte ist keinem Business zugeordnet.',
        'Öffne die Karte im Editor und speichere sie erneut oder verknüpfe alte Templates/Kundenkarten mit deinem Business.'
      );
    }

    const storedWalletObjectId = stringValue(card.wallet_object_id || card.wallet_serial_number);
    const googleWalletClaimKey = stringValue(card.metadata?.google_wallet_claim_key || storedWalletObjectId);
    const acceptedClaimKeys = new Set([storedWalletObjectId, googleWalletClaimKey].filter(Boolean));

    if (!walletObjectId || acceptedClaimKeys.size === 0 || !acceptedClaimKeys.has(walletObjectId)) {
      throw createStructuredError(
        403,
        'GOOGLE_CLAIM_TOKEN_MISMATCH',
        'Karte passt nicht zu diesem Browser-Claim.',
        'Der gespeicherte Claim-Schlüssel stimmt nicht mit der angefragten Google-Wallet-Karte ueberein.'
      );
    }

    const cardInstance = await loadGoogleCardInstance(supabaseAdmin, card);
    const config = googleWalletConfig();
    const objectId = googleObjectId(
      config.issuerId,
      cardInstance.google_object_id || cardInstance.wallet_object_id || card.wallet_object_id,
      cardInstance.card_instance_number || card.card_instance_number || card.customer_code || card.id
    );
    const objectType = objectTypeForTemplate(card.card_templates);
    const classId = googleClassId(config, card.card_templates);
    const reusableWalletObject = await findReusableGoogleWalletObject(supabaseAdmin, card, cardInstance, objectId, classId, objectType);
    const reusedSaveLink = Boolean(reusableWalletObject);
    let saveUrl = stringValue(reusableWalletObject?.save_url);

    if (!saveUrl) {
      const payload = buildGoogleWalletPayload(config, card.card_templates, card, objectId, classId);
      const jwt = await signJwt(payload, config.privateKey);
      saveUrl = `https://pay.google.com/gp/v/save/${jwt}`;
    }

    if (card.wallet_object_id !== objectId || card.wallet_serial_number !== objectId) {
      const { data: updatedCustomerCard, error: cardUpdateError } = await supabaseAdmin
        .from('customer_cards')
        .update({
          wallet_object_id: objectId,
          wallet_serial_number: objectId,
          metadata: {
            ...(card.metadata || {}),
            google_wallet_claim_key: googleWalletClaimKey,
            google_wallet_object_id: objectId
          }
        })
        .eq('id', card.id)
        .eq('owner_id', card.owner_id)
        .eq('business_id', card.business_id)
        .eq('template_id', card.template_id)
        .eq('wallet_platform', 'google')
        .select('id')
        .maybeSingle();

      if (cardUpdateError || !updatedCustomerCard) {
        throw createStructuredError(
          500,
          'GOOGLE_CUSTOMER_CARD_UPDATE_FAILED',
          'Google Wallet Daten konnten nicht auf der Kundenkarte gespeichert werden.',
          cardUpdateError?.message || 'google-wallet-save-link konnte customer_cards nicht für die erwartete Google-Kundenkarte aktualisieren.'
        );
      }
    }

    const { data: updatedCardInstance, error: cardInstanceUpdateError } = await supabaseAdmin
      .from('card_instances')
      .update({
        wallet_object_id: objectId,
        wallet_serial_number: objectId,
        google_object_id: objectId
      })
      .eq('id', cardInstance.id)
      .eq('customer_card_id', card.id)
      .eq('owner_id', card.owner_id)
      .eq('business_id', card.business_id)
      .eq('template_id', card.template_id)
      .eq('wallet_platform', 'google')
      .select('id')
      .maybeSingle();

    if (cardInstanceUpdateError || !updatedCardInstance) {
      throw createStructuredError(
        500,
        'CARD_WALLET_STATE_UPDATE_FAILED',
        'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.',
        cardInstanceUpdateError?.message || 'google-wallet-save-link konnte die Google-Wallet-IDs nicht für die erwartete Karteninstanz speichern.'
      );
    }

    if (!reusedSaveLink) {
      const { data: updatedGoogleObject, error: googleObjectUpsertError } = await supabaseAdmin
        .from('google_wallet_objects')
        .upsert({
          owner_id: card.owner_id,
          card_instance_id: cardInstance.id,
          business_id: card.business_id,
          template_id: card.template_id,
          issuer_id: config.issuerId,
          class_id: classId,
          object_id: objectId,
          object_type: objectType,
          save_url: saveUrl,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'card_instance_id'
        })
        .select('id')
        .maybeSingle();

      if (googleObjectUpsertError || !updatedGoogleObject) {
        throw createStructuredError(
          500,
          'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
          'Google Wallet Object-Zuordnung konnte nicht gespeichert werden.',
          googleObjectUpsertError?.message || 'google-wallet-save-link konnte google_wallet_objects nicht für die erwartete Karteninstanz aktualisieren.'
        );
      }
    }

    const { error: eventInsertError } = await supabaseAdmin.from('card_events').insert({
      owner_id: card.owner_id,
      business_id: card.business_id,
      template_id: card.template_id,
      customer_card_id: card.id,
      event_type: 'google_wallet_save_link_created',
      details: {
        source: 'google_wallet_save_link_edge_function',
        wallet_platform: 'google',
        wallet_object_id: objectId,
        customer_card_id: card.id,
        card_instance_id: cardInstance.id,
        google_wallet_object_recorded: true,
        reused_save_link: reusedSaveLink,
        object_type: objectType,
        template_type: normalizeTemplateType(card.card_templates)
      }
    });

    if (eventInsertError) {
      throw createStructuredError(
        500,
        'GOOGLE_WALLET_EVENT_LOG_FAILED',
        'Google Wallet Ereignis konnte nicht gespeichert werden.',
        eventInsertError.message || 'google-wallet-save-link konnte card_events nicht schreiben.'
      );
    }

    await logGoogleSaveLink(supabaseAdmin, card, cardInstance, 'sent', {
      objectId,
      classId,
      objectType,
      saveUrl,
      reusedSaveLink
    });

    return json({
      ok: true,
      saveUrl,
      walletObjectId: objectId,
      reused: reusedSaveLink,
      objectType,
      card: {
        id: card.id,
        card_instance_number: card.card_instance_number,
        customer_code: card.customer_code,
        wallet_platform: 'google',
        wallet_object_id: objectId
      }
    });
  } catch (error) {
    return errorJson(error);
  }
});
