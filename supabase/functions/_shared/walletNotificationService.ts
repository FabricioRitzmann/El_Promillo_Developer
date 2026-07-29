import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { featureEnabled, normalizeTemplateType } from './templateFeatures.ts';
import { appleWalletProvider } from './appleWalletProvider.ts';
import { googleWalletProvider } from './googleWalletProvider.ts';
import { publicApplePushResult, publicWalletProviderResult } from './publicResponses.ts';
import { walletMessageUrlForCard } from './walletMessageLinks.ts';

type Row = Record<string, any>;
const MANUAL_WALLET_LOG_SELECT = 'id,owner_id,business_id,card_instance_id,wallet_platform,status,action,request_payload,response_payload,error_message,created_at';
const OPERATOR_PROFILE_SELECT = 'id,email,display_name,unlock,created_at,updated_at';
const BUSINESS_SELECT = 'id,owner_id,name,description,address,phone,website,logo_url,company_logo_path,company_logo_updated_at,created_at,updated_at';
const CARD_TEMPLATE_SELECT = [
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
const WALLET_CAMPAIGN_SELECT = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
  'title',
  'message',
  'target_type',
  'target_filter',
  'send_type',
  'scheduled_at',
  'location_lat',
  'location_lng',
  'location_radius_m',
  'status',
  'idempotency_key',
  'created_by',
  'sent_at',
  'created_at',
  'updated_at'
].join(',');
const WALLET_RECIPIENT_SELECT = [
  'id',
  'owner_id',
  'campaign_id',
  'business_id',
  'card_instance_id',
  'wallet_platform',
  'status',
  'provider_response',
  'error_code',
  'error_message',
  'processing_started_at',
  'sent_at',
  'created_at'
].join(',');
const CUSTOMER_CARD_SELECT = [
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
  'pass_serial_number',
  'pass_authentication_token',
  'wallet_platform',
  'wallet_object_id',
  'wallet_serial_number',
  'balance_cents',
  'currency',
  'cloakroom_active',
  'cloakroom_started_at',
  'cloakroom_completed_at',
  'last_scanned_at',
  'metadata',
  'last_claimed_at',
  'created_at',
  'updated_at'
].join(',');
const GOOGLE_WALLET_OBJECT_SELECT = [
  'id',
  'owner_id',
  'card_instance_id',
  'business_id',
  'template_id',
  'issuer_id',
  'class_id',
  'object_id',
  'object_type',
  'save_url',
  'created_at',
  'updated_at'
].join(',');
const CARD_INSTANCE_SELECT = [
  'id',
  'customer_card_id',
  'owner_id',
  'business_id',
  'template_id',
  'customer_id',
  'card_instance_number',
  'wallet_platform',
  'wallet_object_id',
  'wallet_serial_number',
  'current_streak',
  'current_stamps',
  'vip_level',
  'custom_counter',
  'balance_cents',
  'currency',
  'cloakroom_active',
  'cloakroom_started_at',
  'cloakroom_completed_at',
  'last_scanned_at',
  'apple_serial_number',
  'google_object_id',
  'demographics_collected',
  'customer_gender',
  'customer_age_group',
  'resolved_emblem_key',
  'resolved_emblem_url',
  'emblem_updated_at',
  'push_enabled',
  'last_wallet_update_at',
  'last_notification_at',
  'notification_count_24h',
  'created_at',
  'updated_at'
].join(',');
const CARD_INSTANCE_WITH_TEMPLATE_AND_CUSTOMER_SELECT = `${CARD_INSTANCE_SELECT},card_templates(${CARD_TEMPLATE_SELECT}),customer_cards(${CUSTOMER_CARD_SELECT})`;
const CARD_INSTANCE_WITH_WALLET_RELATIONS_SELECT = `${CARD_INSTANCE_WITH_TEMPLATE_AND_CUSTOMER_SELECT},google_wallet_objects(${GOOGLE_WALLET_OBJECT_SELECT})`;
const WALLET_CAMPAIGN_WITH_BUSINESS_SELECT = `${WALLET_CAMPAIGN_SELECT},businesses(${BUSINESS_SELECT})`;
const WALLET_QUEUE_SELECT = [
  'id',
  'owner_id',
  'business_id',
  'card_instance_id',
  'campaign_id',
  'wallet_platform',
  'update_type',
  'payload',
  'status',
  'attempt_count',
  'next_attempt_at',
  'processing_started_at',
  'created_at',
  'processed_at'
].join(',');
const WALLET_QUEUE_WITH_CARD_SELECT = `${WALLET_QUEUE_SELECT},card_instances(${CARD_INSTANCE_WITH_WALLET_RELATIONS_SELECT})`;

const ALLOWED_TARGET_TYPES = [
  'all_active',
  'template',
  'platform_apple',
  'platform_google',
  'stamp_count',
  'streak_count',
  'vip_level',
  'balance_range',
  'cloakroom_open',
  'event',
  'coupon_unredeemed',
  'membership_status'
];
const NOTIFICATION_LIMIT_ACTIONS = [
  'apple_pass_update',
  'manual_apple_push_update',
  'manual_apple_pass_update',
  'google_text_and_notify',
  'google_object_message_fallback',
  'manual_google_object_update',
  'google_location_object_update'
];
const NOTIFICATION_LIMIT_STATUSES = ['sent', 'queued', 'prepared'];
const VISIBLE_NOTIFICATION_ACTIONS = [
  'apple_pass_update',
  'manual_apple_push_update',
  'google_text_and_notify'
];
const VISIBLE_NOTIFICATION_STATUSES = ['sent'];
const MIN_CRON_SECRET_LENGTH = 32;
const CARD_INSTANCE_PAGE_SIZE = 500;
const RECIPIENT_PAGE_SIZE = 500;
const RECIPIENT_SEND_BATCH_SIZE = 100;
const RECIPIENT_UPSERT_BATCH_SIZE = 500;
const SEND_RESULT_DETAIL_LIMIT = 200;
const QUEUE_GOOGLE_PATCH_MAX_JSON_BYTES = 8000;
const FORBIDDEN_QUEUE_GOOGLE_PATCH_KEYS = new Set([
  'id',
  'classid',
  'class_id',
  'objectid',
  'object_id',
  'issuerid',
  'issuer_id',
  'accountid',
  'account_id',
  'kind',
  'barcode'
]);

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
};

export function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

export function createStructuredError(statusCode: number, errorCode: string, message: string, reason: string) {
  return {
    statusCode,
    error_code: errorCode,
    error_message: message,
    error_reason: reason
  };
}

export function errorJson(error: any, fallbackCode = 'WALLET_NOTIFICATION_ERROR') {
  const status = Number(error?.statusCode || error?.status || 500);

  return json({
    error: error?.message || error?.error_message || 'Unbekannter Fehler',
    error_code: error?.error_code || fallbackCode,
    error_message: error?.error_message || error?.message || 'Wallet-Benachrichtigung fehlgeschlagen.',
    error_reason: error?.error_reason || 'Bitte prüfe Anfrage, Wallet-Konfiguration und Supabase-Secrets.'
  }, status);
}

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function configured(value: unknown) {
  const text = stringValue(value);
  return Boolean(text && !text.startsWith('YOUR_') && !text.includes('CHANGE_THIS'));
}

async function sha256Bytes(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function timingSafeSecretMatches(expected: unknown, candidate: unknown) {
  const expectedText = stringValue(expected);
  const candidateText = stringValue(candidate);

  if (!configured(expectedText) || expectedText.length < MIN_CRON_SECRET_LENGTH || !candidateText) {
    return false;
  }

  const [expectedHash, candidateHash] = await Promise.all([
    sha256Bytes(expectedText),
    sha256Bytes(candidateText)
  ]);
  let diff = 0;

  for (let index = 0; index < expectedHash.length; index += 1) {
    diff |= expectedHash[index] ^ candidateHash[index];
  }

  return diff === 0;
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : fallback;
}

function positiveInteger(value: unknown, fallback: number) {
  const numeric = Math.floor(Number(value));

  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function walletLimitConfig() {
  return {
    businessDailyLimit: positiveInteger(Deno.env.get('WALLET_BUSINESS_DAILY_LIMIT'), 500),
    customerDailyLimit: positiveInteger(Deno.env.get('WALLET_CUSTOMER_DAILY_LIMIT'), 12),
    cardDailyLimit: positiveInteger(Deno.env.get('WALLET_CARD_DAILY_LIMIT'), 6),
    googleTextAndNotifyLimitPerPass24h: positiveInteger(
      Deno.env.get('WALLET_GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H')
        || Deno.env.get('GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H'),
      3
    ),
    duplicateWindowMinutes: positiveInteger(Deno.env.get('WALLET_DUPLICATE_WINDOW_MINUTES'), 10)
  };
}

function customerLimitIdentity(cardInstance: Row) {
  const customerId = stringValue(cardInstance.customer_id);
  const customerCardId = stringValue(cardInstance.customer_card_id || cardInstance.customer_cards?.id);

  if (customerId) {
    return {
      type: 'customer_id',
      value: customerId,
      key: `customer:${customerId}`
    };
  }

  if (customerCardId) {
    return {
      type: 'customer_card_id',
      value: customerCardId,
      key: `customer_card:${customerCardId}`
    };
  }

  return {
    type: 'card_instance_id',
    value: stringValue(cardInstance.id),
    key: `card_instance:${stringValue(cardInstance.id)}`
  };
}

async function loadCustomerLimitCardInstanceIds(context: Row, cardInstance: Row) {
  const identity = customerLimitIdentity(cardInstance);

  if (!identity.value || identity.type === 'card_instance_id') {
    return {
      identity,
      cardInstanceIds: stringValue(cardInstance.id) ? [stringValue(cardInstance.id)] : []
    };
  }

  let query = context.supabaseAdmin
    .from('card_instances')
    .select('id')
    .eq('owner_id', cardInstance.owner_id)
    .eq(identity.type, identity.value);

  if (cardInstance.business_id) {
    query = query.eq('business_id', cardInstance.business_id);
  } else {
    query = query.is('business_id', null);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const cardInstanceIds = Array.from(new Set(
    (data || [])
      .map((row: Row) => stringValue(row.id))
      .filter(Boolean)
  ));
  const currentCardInstanceId = stringValue(cardInstance.id);

  if (currentCardInstanceId && !cardInstanceIds.includes(currentCardInstanceId)) {
    cardInstanceIds.push(currentCardInstanceId);
  }

  return {
    identity,
    cardInstanceIds
  };
}

function dateIso(value: unknown) {
  const text = stringValue(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function startOfRollingDay() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function isPlainObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function jsonByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function normalizedPayloadKey(key: string) {
  return key.toLowerCase().replace(/-/g, '_');
}

function targetRequiresFeature(targetType: string) {
  return {
    stamp_count: 'stamps',
    streak_count: 'streak',
    vip_level: 'vip',
    balance_range: 'balance',
    cloakroom_open: 'cloakroom',
    event: 'checkin',
    coupon_unredeemed: 'redemption',
    membership_status: 'membership'
  }[targetType] || null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Row)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value ?? null);
}

function optionalNumberKey(value: unknown) {
  const numeric = Number(value);

  return Number.isFinite(numeric) ? String(numeric) : '';
}

function validateTargetType(targetType: string) {
  if (!ALLOWED_TARGET_TYPES.includes(targetType)) {
    throw createStructuredError(
      400,
      'INVALID_TARGET_TYPE',
      'Zielgruppe ist ungültig.',
      'Erlaubt sind nur die bekannten Wallet-Zielgruppen aus der Template-Feature-Matrix.'
    );
  }
}

function plainObject(value: unknown) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function targetFilterObject(value: unknown) {
  if (value == null || value === '') {
    return {};
  }

  if (!plainObject(value)) {
    throw createStructuredError(
      400,
      'INVALID_TARGET_FILTER',
      'Zielgruppenfilter ist ungültig.',
      'target_filter muss ein JSON-Objekt sein.'
    );
  }

  return value as Row;
}

function hasFilterValue(filter: Row, keys: string[]) {
  return keys.some((key) => filter[key] !== undefined && filter[key] !== null && filter[key] !== '');
}

function optionalFilterNumber(filter: Row, keys: string[], label: string) {
  const key = keys.find((candidate) => filter[candidate] !== undefined && filter[candidate] !== null && filter[candidate] !== '');

  if (!key) {
    return null;
  }

  const value = Number(filter[key]);

  if (!Number.isFinite(value)) {
    throw createStructuredError(
      400,
      'INVALID_TARGET_FILTER_NUMBER',
      'Zielgruppenfilter enthält eine ungültige Zahl.',
      `${label} muss eine gültige Zahl sein.`
    );
  }

  return value;
}

function validateNonNegativeRange(min: number | null, max: number | null, label: string) {
  if (min !== null && min < 0) {
    throw createStructuredError(400, 'INVALID_TARGET_FILTER_RANGE', 'Zielgruppenfilter ist ungültig.', `${label}: Minimum darf nicht negativ sein.`);
  }

  if (max !== null && max < 0) {
    throw createStructuredError(400, 'INVALID_TARGET_FILTER_RANGE', 'Zielgruppenfilter ist ungültig.', `${label}: Maximum darf nicht negativ sein.`);
  }

  if (min !== null && max !== null && min > max) {
    throw createStructuredError(400, 'INVALID_TARGET_FILTER_RANGE', 'Zielgruppenfilter ist ungültig.', `${label}: Minimum darf nicht grösser als Maximum sein.`);
  }
}

function validateOptionalText(filter: Row, keys: string[], maxLength: number, label: string) {
  const key = keys.find((candidate) => filter[candidate] !== undefined && filter[candidate] !== null && filter[candidate] !== '');

  if (!key) {
    return;
  }

  const value = stringValue(filter[key]);

  if (value.length > maxLength) {
    throw createStructuredError(
      400,
      'INVALID_TARGET_FILTER_TEXT',
      'Zielgruppenfilter enthält zu langen Text.',
      `${label} darf maximal ${maxLength} Zeichen enthalten.`
    );
  }
}

function validateOptionalDateRange(filter: Row) {
  const fromKeys = ['activeFrom', 'active_from', 'createdAfter', 'created_after'];
  const toKeys = ['activeUntil', 'active_until', 'createdBefore', 'created_before'];
  const fromProvided = hasFilterValue(filter, fromKeys);
  const toProvided = hasFilterValue(filter, toKeys);
  const from = dateIso(fromKeys.map((key) => filter[key]).find(Boolean));
  const to = dateIso(toKeys.map((key) => filter[key]).find(Boolean));

  if ((fromProvided && !from) || (toProvided && !to)) {
    throw createStructuredError(
      400,
      'INVALID_TARGET_FILTER_DATE',
      'Zielgruppenfilter enthält ein ungültiges Datum.',
      'Datumsfilter müssen als gültiger ISO-Zeitpunkt gesendet werden.'
    );
  }

  if (from && to && from > to) {
    throw createStructuredError(
      400,
      'INVALID_TARGET_FILTER_DATE_RANGE',
      'Zielgruppenfilter enthält eine ungültige Datumsspanne.',
      'Startdatum darf nicht nach dem Enddatum liegen.'
    );
  }
}

function validateTargetFilter(targetType: string, targetFilter: Row) {
  validateTargetType(targetType);

  if (JSON.stringify(targetFilter).length > 2000) {
    throw createStructuredError(
      400,
      'TARGET_FILTER_TOO_LARGE',
      'Zielgruppenfilter ist zu gross.',
      'target_filter darf im MVP maximal 2000 Zeichen als JSON enthalten.'
    );
  }

  const dateFilterKeys = [
    'activeFrom',
    'active_from',
    'activeUntil',
    'active_until',
    'createdAfter',
    'created_after',
    'createdBefore',
    'created_before'
  ];
  const targetSpecificKeys: Record<string, string[]> = {
    stamp_count: ['min', 'max'],
    streak_count: ['min', 'max'],
    vip_level: ['vipLevel', 'vip_level'],
    balance_range: ['minCents', 'min_cents', 'maxCents', 'max_cents'],
    event: ['eventId', 'event_id', 'eventName', 'event_name'],
    membership_status: ['membershipStatus', 'membership_status', 'status']
  };
  const allowedKeys = new Set([
    ...dateFilterKeys,
    ...(targetSpecificKeys[targetType] || [])
  ]);
  const knownFilterKeys = new Set([
    'min',
    'max',
    'minCents',
    'min_cents',
    'maxCents',
    'max_cents',
    'activeFrom',
    'active_from',
    'activeUntil',
    'active_until',
    'createdAfter',
    'created_after',
    'createdBefore',
    'created_before',
    'vipLevel',
    'vip_level',
    'membershipStatus',
    'membership_status',
    'status',
    'eventId',
    'event_id',
    'eventName',
    'event_name'
  ]);
  const unknownKey = Object.keys(targetFilter).find((key) => !knownFilterKeys.has(key));

  if (unknownKey) {
    throw createStructuredError(
      400,
      'INVALID_TARGET_FILTER_FIELD',
      'Zielgruppenfilter enthält ein unbekanntes Feld.',
      `Das Feld ${unknownKey} ist für Wallet-Zielgruppen nicht erlaubt.`
    );
  }

  const forbiddenForTarget = Object.keys(targetFilter).find((key) => !allowedKeys.has(key));

  if (forbiddenForTarget) {
    throw createStructuredError(
      400,
      'TARGET_FILTER_FIELD_NOT_ALLOWED_FOR_TARGET',
      'Zielgruppenfilter passt nicht zur Zielgruppe.',
      `Das Feld ${forbiddenForTarget} ist für die Zielgruppe ${targetType} nicht erlaubt.`
    );
  }

  validateOptionalDateRange(targetFilter);

  if (['stamp_count', 'streak_count'].includes(targetType)) {
    validateNonNegativeRange(
      optionalFilterNumber(targetFilter, ['min'], 'Minimum'),
      optionalFilterNumber(targetFilter, ['max'], 'Maximum'),
      targetType === 'stamp_count' ? 'Stempelstand' : 'Streak'
    );
  }

  if (targetType === 'balance_range') {
    validateNonNegativeRange(
      optionalFilterNumber(targetFilter, ['minCents', 'min_cents'], 'Mindestguthaben'),
      optionalFilterNumber(targetFilter, ['maxCents', 'max_cents'], 'Maximalguthaben'),
      'Guthaben'
    );
  }

  validateOptionalText(targetFilter, ['vipLevel', 'vip_level'], 80, 'VIP-Level');
  validateOptionalText(targetFilter, ['membershipStatus', 'membership_status', 'status'], 80, 'Mitgliedschaftsstatus');
  validateOptionalText(targetFilter, ['eventId', 'event_id'], 120, 'Event-ID');
  validateOptionalText(targetFilter, ['eventName', 'event_name'], 120, 'Eventname');
}

function validateMessage(title: string, message: string) {
  if (!title || title.length > 120) {
    throw createStructuredError(
      400,
      'INVALID_NOTIFICATION_TITLE',
      'Titel ist ungültig.',
      'Der Titel muss 1 bis 120 Zeichen enthalten.'
    );
  }

  if (!message || message.length > 500) {
    throw createStructuredError(
      400,
      'INVALID_NOTIFICATION_MESSAGE',
      'Nachricht ist ungültig.',
      'Die Nachricht muss 1 bis 500 Zeichen enthalten.'
    );
  }
}

function validateCampaignIdempotencyKey(idempotencyKey: string) {
  if (idempotencyKey && idempotencyKey.length > 200) {
    throw createStructuredError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key ist zu lang.',
      'Der Idempotency-Key für Wallet-Kampagnen darf maximal 200 Zeichen enthalten.'
    );
  }
}

function validateSendType(sendType: string, scheduledAt: string | null) {
  if (!['now', 'scheduled', 'location_based'].includes(sendType)) {
    throw createStructuredError(
      400,
      'INVALID_SEND_TYPE',
      'Versandtyp ist ungültig.',
      'Erlaubt sind now, scheduled und location_based.'
    );
  }

  if (sendType === 'scheduled' && !scheduledAt) {
    throw createStructuredError(
      400,
      'SCHEDULED_AT_REQUIRED',
      'Zeitpunkt fehlt.',
      'Geplante Wallet-Benachrichtigungen brauchen scheduled_at.'
    );
  }
}

function validateLocationSendType(sendType: string, locationLat: unknown, locationLng: unknown, locationRadiusM: unknown) {
  if (sendType !== 'location_based') {
    return;
  }

  const lat = Number(locationLat);
  const lng = Number(locationLng);
  const radius = Number(locationRadiusM);

  if (
    !Number.isFinite(lat)
    || lat < -90
    || lat > 90
    || !Number.isFinite(lng)
    || lng < -180
    || lng > 180
    || !Number.isInteger(radius)
    || radius < 50
    || radius > 100000
  ) {
    throw createStructuredError(
      400,
      'LOCATION_TARGET_REQUIRED',
      'Standortdaten fehlen.',
      'Standortbasierte Wallet-Benachrichtigungen brauchen Latitude, Longitude und einen ganzzahligen Radius von 50 bis 100000 Metern.'
    );
  }
}

function validateWalletPlatformForCard(cardInstance: Row, platform: string) {
  const requestedPlatform = stringValue(platform || cardInstance.wallet_platform);
  const storedPlatform = stringValue(cardInstance.wallet_platform);

  if (!['apple', 'google'].includes(requestedPlatform)) {
    throw createStructuredError(
      400,
      'INVALID_WALLET_PLATFORM',
      'Wallet-Plattform ist ungültig.',
      'Erlaubt sind nur apple und google.'
    );
  }

  if (storedPlatform && requestedPlatform !== storedPlatform) {
    throw createStructuredError(
      409,
      'LIMIT_PLATFORM_MISMATCH',
      'Limit-Prüfung passt nicht zur Kartenplattform.',
      'walletPlatform muss zur gespeicherten card_instance.wallet_platform passen.'
    );
  }

  return requestedPlatform;
}

function assertLimitCardBelongsToContext(context: Row, cardInstance: Row) {
  if (context.ownerId && cardInstance.owner_id !== context.ownerId) {
    throw createStructuredError(
      403,
      'LIMIT_CARD_OWNER_MISMATCH',
      'Limit-Prüfung passt nicht zum Betreiber.',
      'Die Karteninstanz gehört nicht zum aktuellen Betreiberkontext.'
    );
  }

  if (!context.system && context.business?.id && cardInstance.business_id !== context.business.id) {
    throw createStructuredError(
      403,
      'LIMIT_CARD_BUSINESS_MISMATCH',
      'Limit-Prüfung passt nicht zum Business.',
      'Die Karteninstanz gehört nicht zum aktuellen Businesskontext.'
    );
  }
}

function validateTargetAgainstTemplate(template: Row | null, targetType: string) {
  validateTargetType(targetType);

  if (targetType === 'template' && !template) {
    throw createStructuredError(
      400,
      'TEMPLATE_REQUIRED_FOR_TARGET',
      'Template fehlt für diese Zielgruppe.',
      'Die Zielgruppe "alle Karten eines Templates" braucht eine gültige template_id.'
    );
  }

  if (template && !featureEnabled(template, 'notifications')) {
    throw createStructuredError(
      403,
      'NOTIFICATIONS_DISABLED_FOR_TEMPLATE',
      'Benachrichtigungen sind für dieses Template nicht aktiv.',
      'Die Template-Feature-Matrix erlaubt hier keine Wallet-Benachrichtigungen.'
    );
  }

  const requiredFeature = targetRequiresFeature(targetType);

  if (!requiredFeature) {
    return;
  }

  if (!template) {
    throw createStructuredError(
      400,
      'TEMPLATE_REQUIRED_FOR_TARGET',
      'Template fehlt für diese Zielgruppe.',
      'Feature-basierte Zielgruppen brauchen ein Template, damit die Matrix serverseitig geprüft werden kann.'
    );
  }

  if (!featureEnabled(template, 'notifications')) {
    throw createStructuredError(
      403,
      'NOTIFICATIONS_DISABLED_FOR_TEMPLATE',
      'Benachrichtigungen sind für dieses Template nicht aktiv.',
      'Die Template-Feature-Matrix erlaubt hier keine Wallet-Benachrichtigungen.'
    );
  }

  if (!featureEnabled(template, requiredFeature as any)) {
    throw createStructuredError(
      403,
      'TARGET_NOT_ALLOWED_FOR_TEMPLATE',
      'Zielgruppe passt nicht zu diesem Kartentyp.',
      `Die Zielgruppe ${targetType} benötigt das Feature ${requiredFeature}.`
    );
  }
}

function cardInsideTargetWindow(instance: Row, targetFilter: Row) {
  const from = dateIso(targetFilter.activeFrom || targetFilter.active_from || targetFilter.createdAfter || targetFilter.created_after);
  const to = dateIso(targetFilter.activeUntil || targetFilter.active_until || targetFilter.createdBefore || targetFilter.created_before);

  if (!from && !to) {
    return true;
  }

  const card = instance.customer_cards || {};
  const createdAt = dateIso(instance.created_at || card.created_at);

  if (!createdAt) {
    return false;
  }

  if (from && createdAt < from) {
    return false;
  }

  if (to && createdAt > to) {
    return false;
  }

  return true;
}

function cardMatchesTarget(instance: Row, targetType: string, targetFilter: Row) {
  const card = instance.customer_cards || {};
  const template = instance.card_templates || {};

  if (!cardInsideTargetWindow(instance, targetFilter)) {
    return false;
  }

  if (targetType === 'all_active') {
    return card.status === 'active';
  }

  if (targetType === 'template') {
    return true;
  }

  if (targetType === 'platform_apple') {
    return instance.wallet_platform === 'apple';
  }

  if (targetType === 'platform_google') {
    return instance.wallet_platform === 'google';
  }

  if (targetType === 'stamp_count') {
    const min = numberValue(targetFilter.min, 0);
    const max = numberValue(targetFilter.max, Number.MAX_SAFE_INTEGER);
    return numberValue(instance.current_stamps ?? card.stamp_count) >= min
      && numberValue(instance.current_stamps ?? card.stamp_count) <= max;
  }

  if (targetType === 'streak_count') {
    const min = numberValue(targetFilter.min, 0);
    const max = numberValue(targetFilter.max, Number.MAX_SAFE_INTEGER);
    return numberValue(instance.current_streak ?? card.streak_count) >= min
      && numberValue(instance.current_streak ?? card.streak_count) <= max;
  }

  if (targetType === 'vip_level') {
    const expectedLevel = stringValue(targetFilter.vipLevel || targetFilter.vip_level).toLowerCase();

    return !expectedLevel
      || stringValue(instance.vip_level || card.vip_status).toLowerCase() === expectedLevel;
  }

  if (targetType === 'balance_range') {
    const min = numberValue(targetFilter.minCents ?? targetFilter.min_cents, 0);
    const max = numberValue(targetFilter.maxCents ?? targetFilter.max_cents, Number.MAX_SAFE_INTEGER);
    return numberValue(instance.balance_cents ?? card.balance_cents) >= min
      && numberValue(instance.balance_cents ?? card.balance_cents) <= max;
  }

  if (targetType === 'cloakroom_open') {
    return Boolean(instance.cloakroom_active ?? card.cloakroom_active);
  }

  if (targetType === 'coupon_unredeemed') {
    return card.status !== 'redeemed';
  }

  if (targetType === 'membership_status') {
    const expectedStatus = stringValue(targetFilter.membershipStatus || targetFilter.membership_status || targetFilter.status);
    return !expectedStatus || stringValue(card.metadata?.membership_status || 'active') === expectedStatus;
  }

  if (targetType === 'event') {
    const expectedEventId = stringValue(targetFilter.eventId || targetFilter.event_id);
    const expectedEventName = stringValue(targetFilter.eventName || targetFilter.event_name);
    const actualEventId = stringValue(card.metadata?.event_id || instance.event_id || template.settings?.eventId);
    const actualEventName = stringValue(card.metadata?.event_name || template.settings?.eventName);

    return (!expectedEventId || actualEventId === expectedEventId)
      && (!expectedEventName || actualEventName.toLowerCase() === expectedEventName.toLowerCase());
  }

  return false;
}

async function serviceClient() {
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

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function authenticatedContext(request: Request) {
  const supabaseAdmin = await serviceClient();
  const token = stringValue(request.headers.get('authorization')).replace(/^Bearer\s+/i, '');

  if (!token) {
    throw createStructuredError(401, 'AUTH_REQUIRED', 'Login fehlt.', 'Diese Aktion braucht einen eingeloggten Betreiber.');
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

  if (userError || !userData?.user) {
    throw createStructuredError(401, 'AUTH_INVALID', 'Login ist ungültig.', 'Bitte melde dich erneut an.');
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('operator_profiles')
    .select(OPERATOR_PROFILE_SELECT)
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (!profile?.unlock) {
    throw createStructuredError(403, 'OPERATOR_LOCKED', 'Betreiber ist nicht freigeschaltet.', 'Wallet-Benachrichtigungen sind erst nach Unlock möglich.');
  }

  const { data: business, error: businessError } = await supabaseAdmin
    .from('businesses')
    .select(BUSINESS_SELECT)
    .eq('owner_id', userData.user.id)
    .maybeSingle();

  if (businessError) {
    throw businessError;
  }

  if (!business) {
    throw createStructuredError(400, 'BUSINESS_REQUIRED', 'Business-Profil fehlt.', 'Lege zuerst dein Geschäftsprofil an.');
  }

  return {
    supabaseAdmin,
    user: userData.user,
    ownerId: userData.user.id,
    business
  };
}

async function automationContext(request: Request) {
  const supabaseAdmin = await serviceClient();
  const cronSecret = stringValue(Deno.env.get('WALLET_CRON_SECRET') || Deno.env.get('CRON_SECRET'));
  const bearerToken = stringValue(request.headers.get('authorization')).replace(/^Bearer\s+/i, '');
  const headerSecret = stringValue(request.headers.get('x-cron-secret'));

  if (
    await timingSafeSecretMatches(cronSecret, bearerToken)
    || await timingSafeSecretMatches(cronSecret, headerSecret)
  ) {
    return {
      supabaseAdmin,
      user: {
        id: 'system-cron'
      },
      ownerId: '',
      business: null,
      system: true
    };
  }

  return authenticatedContext(request);
}

async function loadTemplate(supabaseAdmin: any, ownerId: string, templateId: string) {
  if (!templateId) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from('card_templates')
    .select(CARD_TEMPLATE_SELECT)
    .eq('id', templateId)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw createStructuredError(
      404,
      'TEMPLATE_NOT_FOUND',
      'Template nicht gefunden.',
      'Das Template gehört nicht zu deinem Account oder existiert nicht.'
    );
  }

  return data;
}

async function latestCampaignByIdempotency(supabaseAdmin: any, ownerId: string, businessId: string, idempotencyKey: string) {
  if (!idempotencyKey) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from('wallet_notification_campaigns')
    .select(WALLET_CAMPAIGN_SELECT)
    .eq('owner_id', ownerId)
    .eq('business_id', businessId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function recentDuplicateCampaign(supabaseAdmin: any, ownerId: string, input: Row) {
  const duplicateWindowMinutes = positiveInteger(input.duplicateWindowMinutes, walletLimitConfig().duplicateWindowMinutes);
  const duplicateWindowStart = new Date(Date.now() - duplicateWindowMinutes * 60 * 1000).toISOString();
  const targetFilterKey = stableJson(input.targetFilter || {});
  const scheduledAtKey = dateIso(input.scheduledAt) || '';
  const locationKey = [
    optionalNumberKey(input.locationLat),
    optionalNumberKey(input.locationLng),
    optionalNumberKey(input.locationRadiusM)
  ].join(':');
  let query = supabaseAdmin
    .from('wallet_notification_campaigns')
    .select(WALLET_CAMPAIGN_SELECT)
    .eq('owner_id', ownerId)
    .eq('business_id', input.businessId)
    .eq('title', input.title)
    .eq('message', input.message)
    .eq('target_type', input.targetType)
    .eq('send_type', input.sendType)
    .gte('created_at', duplicateWindowStart)
    .order('created_at', { ascending: false })
    .limit(10);

  query = input.templateId
    ? query.eq('template_id', input.templateId)
    : query.is('template_id', null);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data || []).find((campaign: Row) => (
    stableJson(campaign.target_filter || {}) === targetFilterKey
    && (dateIso(campaign.scheduled_at) || '') === scheduledAtKey
    && [
      optionalNumberKey(campaign.location_lat),
      optionalNumberKey(campaign.location_lng),
      optionalNumberKey(campaign.location_radius_m)
    ].join(':') === locationKey
  )) || null;
}

async function insertLog(supabaseAdmin: any, payload: Row) {
  const { error } = await supabaseAdmin.from('wallet_push_logs').insert(payload);

  if (error) {
    throw createStructuredError(
      500,
      'WALLET_PUSH_LOG_INSERT_FAILED',
      'Wallet Audit-Log konnte nicht gespeichert werden.',
      error.message || 'wallet_push_logs.insert hat einen Fehler zurückgegeben.'
    );
  }
}

function manualWalletDuplicateKey(value: unknown) {
  return stableJson(value);
}

async function recentManualDuplicateWalletLog(context: Row, cardInstance: Row, options: Row) {
  const duplicateKey = stringValue(options.duplicateKey);

  if (!duplicateKey) {
    return null;
  }

  const duplicateWindowMinutes = positiveInteger(options.duplicateWindowMinutes, walletLimitConfig().duplicateWindowMinutes);
  const duplicateWindowStart = new Date(Date.now() - duplicateWindowMinutes * 60 * 1000).toISOString();
  const actions = Array.isArray(options.actions)
    ? options.actions.map((action: unknown) => stringValue(action)).filter(Boolean)
    : [stringValue(options.action)].filter(Boolean);

  let query = context.supabaseAdmin
    .from('wallet_push_logs')
    .select(MANUAL_WALLET_LOG_SELECT)
    .eq('owner_id', context.ownerId)
    .eq('business_id', cardInstance.business_id)
    .eq('card_instance_id', cardInstance.id)
    .eq('wallet_platform', options.walletPlatform)
    .is('campaign_id', null)
    .eq('request_payload->>manual_duplicate_key', duplicateKey)
    .in('status', ['processing', 'queued', 'prepared', 'sent'])
    .gte('created_at', duplicateWindowStart)
    .order('created_at', { ascending: false })
    .limit(1);

  if (actions.length > 1) {
    query = query.in('action', actions);
  } else if (actions.length === 1) {
    query = query.eq('action', actions[0]);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data
    ? {
      ...data,
      duplicate_window_minutes: duplicateWindowMinutes
    }
    : null;
}

async function logManualDuplicateSkipped(context: Row, cardInstance: Row, options: Row) {
  const duplicateLog = options.duplicateLog || {};
  const duplicateKey = stringValue(options.duplicateKey);
  const duplicateWindowMinutes = positiveInteger(options.duplicateWindowMinutes, walletLimitConfig().duplicateWindowMinutes);

  await insertLog(context.supabaseAdmin, {
    owner_id: context.ownerId,
    business_id: cardInstance.business_id,
    card_instance_id: cardInstance.id,
    campaign_id: null,
    wallet_platform: options.walletPlatform,
    action: 'manual_duplicate_skipped',
    status: 'skipped',
    request_payload: {
      ...(options.requestPayload || {}),
      manual_duplicate_key: duplicateKey
    },
    response_payload: {
      duplicate: true,
      duplicate_of_log_id: duplicateLog.id || null,
      duplicate_action: duplicateLog.action || null,
      duplicate_status: duplicateLog.status || null,
      duplicate_window_minutes: duplicateWindowMinutes
    },
    error_message: `Identische manuelle Wallet-Nachricht innerhalb von ${duplicateWindowMinutes} Minuten übersprungen.`
  });
}

function campaignDuplicatePlatforms(targetType: string) {
  if (targetType === 'platform_apple') {
    return ['apple'];
  }

  if (targetType === 'platform_google') {
    return ['google'];
  }

  return ['apple', 'google'];
}

async function logCampaignDuplicateSkipped(context: Row, duplicateCampaign: Row, options: Row) {
  const duplicateWindowMinutes = positiveInteger(options.duplicateWindowMinutes, walletLimitConfig().duplicateWindowMinutes);
  const platforms = campaignDuplicatePlatforms(options.targetType);

  for (const walletPlatform of platforms) {
    await insertLog(context.supabaseAdmin, {
      owner_id: context.ownerId,
      business_id: context.business.id,
      card_instance_id: null,
      campaign_id: duplicateCampaign.id,
      wallet_platform: walletPlatform,
      action: 'campaign_duplicate_skipped',
      status: 'skipped',
      request_payload: {
        title: options.title,
        message: options.message,
        target_type: options.targetType,
        target_filter: options.targetFilter || {},
        send_type: options.sendType,
        scheduled_at: options.scheduledAt || null,
        location_lat: options.locationLat ?? null,
        location_lng: options.locationLng ?? null,
        location_radius_m: options.locationRadiusM ?? null,
        duplicate_scope: 'campaign'
      },
      response_payload: {
        duplicate: true,
        duplicate_campaign_id: duplicateCampaign.id,
        duplicate_campaign_status: duplicateCampaign.status || null,
        duplicate_window_minutes: duplicateWindowMinutes,
        wallet_platform: walletPlatform
      },
      error_message: `Identische Wallet-Kampagne innerhalb von ${duplicateWindowMinutes} Minuten übersprungen.`
    });
  }
}

async function findManualIdempotencyLog(context: Row, cardInstance: Row, options: Row) {
  const idempotencyKey = stringValue(options.idempotencyKey);
  const idempotencyScope = stringValue(options.idempotencyScope);

  if (!idempotencyKey || !idempotencyScope) {
    return null;
  }

  const { data, error } = await context.supabaseAdmin
    .from('wallet_push_logs')
    .select(MANUAL_WALLET_LOG_SELECT)
    .eq('owner_id', context.ownerId)
    .eq('business_id', cardInstance.business_id)
    .eq('card_instance_id', cardInstance.id)
    .eq('wallet_platform', options.walletPlatform)
    .is('campaign_id', null)
    .eq('request_payload->>idempotency_scope', idempotencyScope)
    .eq('request_payload->>idempotency_key', idempotencyKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function reserveManualWalletLog(context: Row, cardInstance: Row, options: Row) {
  const idempotencyKey = stringValue(options.idempotencyKey);
  const idempotencyScope = stringValue(options.idempotencyScope);

  if (!idempotencyKey || !idempotencyScope) {
    return {
      reservedLog: null,
      existingResult: null,
      requestPayload: options.requestPayload || {}
    };
  }

  const requestPayload = {
    ...(options.requestPayload || {}),
    idempotency_scope: idempotencyScope,
    idempotency_key: idempotencyKey
  };
  const existingResult = await findManualIdempotencyLog(context, cardInstance, options);

  if (existingResult) {
    return {
      reservedLog: null,
      existingResult,
      requestPayload
    };
  }

  const { data, error } = await context.supabaseAdmin
    .from('wallet_push_logs')
    .insert({
      owner_id: context.ownerId,
      business_id: cardInstance.business_id,
      card_instance_id: cardInstance.id,
      campaign_id: null,
      wallet_platform: options.walletPlatform,
      action: options.action,
      status: 'processing',
      request_payload: requestPayload,
      response_payload: {
        idempotency_reserved: true
      },
      error_message: null
    })
    .select(MANUAL_WALLET_LOG_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') {
      const recoveredResult = await findManualIdempotencyLog(context, cardInstance, options);

      if (recoveredResult) {
        return {
          reservedLog: null,
          existingResult: {
            ...recoveredResult,
            idempotency_conflict_recovered: true
          },
          requestPayload
        };
      }
    }

    throw error;
  }

  return {
    reservedLog: data,
    existingResult: null,
    requestPayload
  };
}

async function finalizeManualWalletLog(context: Row, reservation: Row | null, payload: Row) {
  if (!reservation?.id) {
    return null;
  }

  const updatePayload = {
    action: payload.action || reservation.action,
    status: payload.status,
    request_payload: payload.requestPayload || reservation.request_payload || {},
    response_payload: payload.responsePayload || {},
    error_message: payload.errorMessage || null
  };
  const { data, error } = await context.supabaseAdmin
    .from('wallet_push_logs')
    .update(updatePayload)
    .eq('id', reservation.id)
    .eq('owner_id', context.ownerId)
    .eq('business_id', reservation.business_id)
    .eq('card_instance_id', reservation.card_instance_id)
    .eq('wallet_platform', reservation.wallet_platform)
    .is('campaign_id', null)
    .eq('status', 'processing')
    .select(MANUAL_WALLET_LOG_SELECT)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw createStructuredError(
      409,
      'IDEMPOTENCY_RESERVATION_CONFLICT',
      'Idempotency-Reservierung konnte nicht abgeschlossen werden.',
      'Der reservierte Wallet-Log wurde bereits verarbeitet oder passt nicht mehr zum Request.'
    );
  }

  return data;
}

async function failManualWalletLogReservation(context: Row | null, reservation: Row | null, error: any, fallbackCode = 'MANUAL_WALLET_OPERATION_ERROR') {
  if (!context || !reservation?.id) {
    return null;
  }

  const failureResponsePayload = (extra: Row = {}) => ({
    error_code: error?.error_code || fallbackCode,
    error_reason: error?.error_reason || null,
    reservation_failed_after_processing: true,
    ...extra
  });
  const failureErrorMessage = error?.error_message || error?.message || 'Manuelle Wallet-Aktion ist nach der Idempotency-Reservierung fehlgeschlagen.';

  try {
    return await finalizeManualWalletLog(context, reservation, {
      action: reservation.action,
      status: 'failed',
      requestPayload: reservation.request_payload || {},
      responsePayload: failureResponsePayload(),
      errorMessage: failureErrorMessage
    });
  } catch (_) {
    try {
      const { data: existingLog, error: existingError } = await context.supabaseAdmin
        .from('wallet_push_logs')
        .select(MANUAL_WALLET_LOG_SELECT)
        .eq('id', reservation.id)
        .eq('owner_id', context.ownerId)
        .eq('business_id', reservation.business_id)
        .eq('card_instance_id', reservation.card_instance_id)
        .eq('wallet_platform', reservation.wallet_platform)
        .is('campaign_id', null)
        .maybeSingle();

      if (existingError || !existingLog) {
        return null;
      }

      const { data, error: updateError } = await context.supabaseAdmin
        .from('wallet_push_logs')
        .update({
          action: existingLog.action || reservation.action,
          status: 'failed',
          request_payload: existingLog.request_payload || reservation.request_payload || {},
          response_payload: failureResponsePayload({
            idempotency_post_finalize_failure: true,
            previous_status: existingLog.status || null,
            previous_action: existingLog.action || null,
            previous_response_present: Boolean(existingLog.response_payload)
          }),
          error_message: failureErrorMessage
        })
        .eq('id', reservation.id)
        .eq('owner_id', context.ownerId)
        .eq('business_id', reservation.business_id)
        .eq('card_instance_id', reservation.card_instance_id)
        .eq('wallet_platform', reservation.wallet_platform)
        .is('campaign_id', null)
        .select(MANUAL_WALLET_LOG_SELECT)
        .maybeSingle();

      return updateError ? null : data;
    } catch (_) {
      return null;
    }
  }
}

async function updateCampaignStatus(supabaseAdmin: any, campaign: Row) {
  const { data: recipients, error } = await supabaseAdmin
    .from('wallet_notification_recipients')
    .select('status')
    .eq('owner_id', campaign.owner_id)
    .eq('business_id', campaign.business_id)
    .eq('campaign_id', campaign.id);

  if (error) {
    throw error;
  }

  const statuses = (recipients || []).map((recipient: Row) => recipient.status);
  const sentCount = statuses.filter((status: string) => status === 'sent').length;
  const preparedCount = statuses.filter((status: string) => status === 'prepared').length;
  const successfulCount = sentCount + preparedCount;
  const activeCount = statuses.filter((status: string) => ['pending', 'processing'].includes(status)).length;
  const unsuccessfulCount = statuses.filter((status: string) => ['failed', 'limited', 'skipped'].includes(status)).length;
  const status = activeCount > 0
    ? 'sending'
    : successfulCount > 0 && unsuccessfulCount === 0
    ? 'sent'
    : successfulCount > 0
      ? 'partially_failed'
      : 'failed';
  const payload: Row = {
    status
  };

  if (status !== 'sending') {
    payload.sent_at = new Date().toISOString();
  }

  const { data: updatedCampaign, error: updateError } = await supabaseAdmin
    .from('wallet_notification_campaigns')
    .update(payload)
    .eq('id', campaign.id)
    .eq('owner_id', campaign.owner_id)
    .eq('business_id', campaign.business_id)
    .select('status')
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  if (!updatedCampaign) {
    throw createStructuredError(
      409,
      'CAMPAIGN_STATUS_UPDATE_CONFLICT',
      'Kampagnenstatus konnte nicht aktualisiert werden.',
      'owner_id, business_id und campaign_id müssen beim Statusupdate zusammenpassen.'
    );
  }

  return status;
}

async function finalizeFailedScheduledCampaign(supabaseAdmin: any, campaign: Row, failure: Row) {
  const nowIso = new Date().toISOString();

  const { error: recipientError } = await supabaseAdmin
    .from('wallet_notification_recipients')
    .update({
      status: 'failed',
      processing_started_at: null,
      provider_response: failure,
      error_code: failure.error_code || 'SCHEDULED_CAMPAIGN_FAILED',
      error_message: failure.error_message || 'Geplante Wallet-Kampagne konnte nicht verarbeitet werden.',
      sent_at: null
    })
    .eq('owner_id', campaign.owner_id)
    .eq('business_id', campaign.business_id)
    .eq('campaign_id', campaign.id)
    .in('status', ['pending', 'processing']);

  if (recipientError) {
    throw recipientError;
  }

  const recipientCount = await countCampaignRecipients(supabaseAdmin, campaign);

  if (recipientCount > 0) {
    return await updateCampaignStatus(supabaseAdmin, campaign);
  }

  const { data, error } = await supabaseAdmin
    .from('wallet_notification_campaigns')
    .update({
      status: 'failed',
      sent_at: nowIso
    })
    .eq('id', campaign.id)
    .eq('owner_id', campaign.owner_id)
    .eq('business_id', campaign.business_id)
    .in('status', ['scheduled', 'sending'])
    .select('status')
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw createStructuredError(
      409,
      'SCHEDULED_CAMPAIGN_FINALIZE_CONFLICT',
      'Geplante Kampagne konnte nicht als fehlgeschlagen finalisiert werden.',
      'owner_id, business_id, campaign_id und ein finalisierbarer Kampagnenstatus müssen beim Fehlerabschluss zusammenpassen.'
    );
  }

  return data.status;
}

async function reloadCampaign(supabaseAdmin: any, ownerId: string, campaignId: string) {
  const { data, error } = await supabaseAdmin
    .from('wallet_notification_campaigns')
    .select(WALLET_CAMPAIGN_SELECT)
    .eq('id', campaignId)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function countCampaignRecipients(supabaseAdmin: any, campaign: Row) {
  const { count, error } = await supabaseAdmin
    .from('wallet_notification_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', campaign.owner_id)
    .eq('business_id', campaign.business_id)
    .eq('campaign_id', campaign.id);

  if (error) {
    throw error;
  }

  return count || 0;
}

async function loadCampaignRecipients(supabaseAdmin: any, campaign: Row) {
  const rows: Row[] = [];
  let page = 0;

  while (true) {
    const from = page * RECIPIENT_PAGE_SIZE;
    const to = from + RECIPIENT_PAGE_SIZE - 1;
    const { data, error } = await supabaseAdmin
      .from('wallet_notification_recipients')
      .select(WALLET_RECIPIENT_SELECT)
      .eq('owner_id', campaign.owner_id)
      .eq('business_id', campaign.business_id)
      .eq('campaign_id', campaign.id)
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    const pageRows = data || [];
    rows.push(...pageRows);

    if (pageRows.length < RECIPIENT_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return rows;
}

async function loadPendingCampaignRecipients(supabaseAdmin: any, campaign: Row) {
  const { data, error } = await supabaseAdmin
    .from('wallet_notification_recipients')
    .select(WALLET_RECIPIENT_SELECT)
    .eq('owner_id', campaign.owner_id)
    .eq('business_id', campaign.business_id)
    .eq('campaign_id', campaign.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(RECIPIENT_SEND_BATCH_SIZE);

  if (error) {
    throw error;
  }

  return data || [];
}

async function loadWalletCardInstances(context: Row, options: Row) {
  const ownerId = stringValue(options.ownerId || context.ownerId);
  const businessId = stringValue(options.businessId || context.business?.id);
  const templateId = stringValue(options.templateId);
  const rows: Row[] = [];
  let page = 0;

  if (!ownerId || !businessId) {
    throw createStructuredError(
      500,
      'WALLET_CARD_CONTEXT_MISSING',
      'Wallet-Karten konnten nicht eindeutig geladen werden.',
      'owner_id und business_id sind für paginierte card_instances-Abfragen erforderlich.'
    );
  }

  while (true) {
    const from = page * CARD_INSTANCE_PAGE_SIZE;
    const to = from + CARD_INSTANCE_PAGE_SIZE - 1;
    let query = context.supabaseAdmin
      .from('card_instances')
      .select(options.includeGoogleObjects
        ? CARD_INSTANCE_WITH_WALLET_RELATIONS_SELECT
        : CARD_INSTANCE_WITH_TEMPLATE_AND_CUSTOMER_SELECT)
      .eq('owner_id', ownerId)
      .eq('business_id', businessId)
      .in('wallet_platform', ['apple', 'google'])
      .order('id', { ascending: true })
      .range(from, to);

    if (options.pushEnabledOnly) {
      query = query.eq('push_enabled', true);
    }

    if (templateId) {
      query = query.eq('template_id', templateId);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const pageRows = data || [];
    rows.push(...pageRows);

    if (pageRows.length < CARD_INSTANCE_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return rows;
}

async function upsertRecipientRows(supabaseAdmin: any, rows: Row[]) {
  for (let index = 0; index < rows.length; index += RECIPIENT_UPSERT_BATCH_SIZE) {
    const batch = rows.slice(index, index + RECIPIENT_UPSERT_BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from('wallet_notification_recipients')
      .upsert(batch, {
        onConflict: 'campaign_id,card_instance_id,wallet_platform',
        ignoreDuplicates: true
      });

    if (error) {
      throw error;
    }
  }
}

function recipientProcessingTimeoutMinutes() {
  const value = Number(Deno.env.get('WALLET_RECIPIENT_PROCESSING_TIMEOUT_MINUTES') || 15);

  return Number.isFinite(value) && value >= 1 ? value : 15;
}

function queueProcessingTimeoutMinutes() {
  const value = Number(Deno.env.get('WALLET_QUEUE_PROCESSING_TIMEOUT_MINUTES') || 15);

  return Number.isFinite(value) && value >= 1 ? value : 15;
}

async function recoverStaleProcessingRecipients(supabaseAdmin: any, campaignId: string) {
  const timeoutMinutes = recipientProcessingTimeoutMinutes();
  const cutoffIso = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('wallet_notification_recipients')
    .update({
      status: 'pending',
      processing_started_at: null,
      error_code: null,
      error_message: null,
      sent_at: null,
      provider_response: {
        status: 'pending',
        recovered_from: 'processing_timeout',
        processing_timeout_minutes: timeoutMinutes,
        recovered_at: new Date().toISOString()
      }
    })
    .eq('campaign_id', campaignId)
    .eq('status', 'processing')
    .or(`processing_started_at.lt.${cutoffIso},processing_started_at.is.null`)
    .select('id');

  if (error) {
    throw error;
  }

  return data?.length || 0;
}

async function recoverStaleQueueJobs(supabaseAdmin: any, ownerId = '') {
  const timeoutMinutes = queueProcessingTimeoutMinutes();
  const cutoffIso = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
  let query = supabaseAdmin
    .from('wallet_update_queue')
    .update({
      status: 'pending',
      processing_started_at: null,
      next_attempt_at: new Date().toISOString()
    })
    .eq('status', 'processing')
    .or(`processing_started_at.lt.${cutoffIso},processing_started_at.is.null`);

  query = applyOwnerFilter(query, ownerId);

  const { data, error } = await query.select('id');

  if (error) {
    throw error;
  }

  return data?.length || 0;
}

function assertRecipientBelongsToCampaign(recipient: Row, campaign: Row) {
  if (
    recipient.owner_id !== campaign.owner_id
    || recipient.business_id !== campaign.business_id
    || recipient.campaign_id !== campaign.id
  ) {
    throw createStructuredError(
      409,
      'RECIPIENT_CAMPAIGN_MISMATCH',
      'Empfänger passt nicht zur Kampagne.',
      'wallet_notification_recipients muss zu owner_id, business_id und campaign_id der Kampagne gehören.'
    );
  }
}

function assertQueueJobMatchesCardInstance(job: Row, cardInstance: Row | null) {
  if (!cardInstance) {
    throw createStructuredError(
      404,
      'QUEUE_JOB_CARD_NOT_FOUND',
      'Karteninstanz zur Queue-Aufgabe wurde nicht gefunden.',
      'wallet_update_queue.card_instance_id muss auf eine vorhandene card_instance zeigen.'
    );
  }

  if (
    cardInstance.id !== job.card_instance_id
    || cardInstance.owner_id !== job.owner_id
    || cardInstance.business_id !== job.business_id
  ) {
    throw createStructuredError(
      409,
      'QUEUE_JOB_CARD_MISMATCH',
      'Queue-Aufgabe passt nicht zur Karteninstanz.',
      'wallet_update_queue muss zu owner_id, business_id und card_instance_id der geladenen card_instance gehören.'
    );
  }

  if (cardInstance.wallet_platform !== job.wallet_platform) {
    throw createStructuredError(
      409,
      'QUEUE_JOB_PLATFORM_MISMATCH',
      'Queue-Aufgabe passt nicht zur Wallet-Plattform.',
      'wallet_update_queue.wallet_platform muss zur gespeicherten card_instance.wallet_platform passen.'
    );
  }
}

function queueJobErrorIsRetryable(error: Row) {
  return ![
    'QUEUE_JOB_CARD_NOT_FOUND',
    'QUEUE_JOB_CARD_MISMATCH',
    'QUEUE_JOB_PLATFORM_MISMATCH',
    'QUEUE_GOOGLE_PATCH_INVALID',
    'QUEUE_GOOGLE_PATCH_TOO_LARGE',
    'QUEUE_GOOGLE_PATCH_FIELD_FORBIDDEN',
    'QUEUE_GOOGLE_OBJECT_ID_MISSING',
    'QUEUE_GOOGLE_OBJECT_TYPE_INVALID'
  ].includes(stringValue(error?.error_code));
}

function queueRetryAt(attemptCount: number) {
  const retryDelayMinutes = Math.min(Math.max(1, Number(attemptCount || 1)) * 15, 60);
  return new Date(Date.now() + retryDelayMinutes * 60 * 1000).toISOString();
}

function publicQueueProviderResult(platform: string, result: Row = {}) {
  const summary = platform === 'apple'
    ? publicApplePushResult(result)
    : publicWalletProviderResult(result);

  return {
    ...summary,
    pass_version_id: result.pass_version_id || null,
    generated_pass_version: Boolean(result.generated_pass_version)
  };
}

function queueDueFilter(nowIso: string) {
  return `next_attempt_at.lte.${nowIso},next_attempt_at.is.null`;
}

function validateQueueGooglePatch(patch: Row) {
  if (!isPlainObject(patch)) {
    throw createStructuredError(
      400,
      'QUEUE_GOOGLE_PATCH_INVALID',
      'Google Queue Patch ist ungültig.',
      'wallet_update_queue.payload.patch muss ein JSON-Objekt sein.'
    );
  }

  if (jsonByteLength(patch) > QUEUE_GOOGLE_PATCH_MAX_JSON_BYTES) {
    throw createStructuredError(
      400,
      'QUEUE_GOOGLE_PATCH_TOO_LARGE',
      'Google Queue Patch ist zu gross.',
      'Queue-Patches dürfen maximal 8000 Bytes JSON enthalten.'
    );
  }

  const forbiddenKeys = Object.keys(patch).filter((key) => {
    const normalized = normalizedPayloadKey(key);
    return FORBIDDEN_QUEUE_GOOGLE_PATCH_KEYS.has(normalized) || FORBIDDEN_QUEUE_GOOGLE_PATCH_KEYS.has(normalized.replace(/_/g, ''));
  });

  if (forbiddenKeys.length) {
    throw createStructuredError(
      400,
      'QUEUE_GOOGLE_PATCH_FIELD_FORBIDDEN',
      'Google Queue Patch enthält geschützte Wallet-Felder.',
      `Diese Felder dürfen nicht über Queue-Payloads geändert werden: ${forbiddenKeys.join(', ')}.`
    );
  }
}

async function claimRecipientForProcessing(supabaseAdmin: any, recipient: Row, campaign: Row) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('wallet_notification_recipients')
    .update({
      status: 'processing',
      processing_started_at: nowIso,
      error_code: null,
      error_message: null,
      sent_at: null,
      provider_response: {
        status: 'processing',
        claimed_at: nowIso
      }
    })
    .eq('id', recipient.id)
    .eq('owner_id', campaign.owner_id)
    .eq('business_id', campaign.business_id)
    .eq('campaign_id', campaign.id)
    .eq('status', 'pending')
    .select(WALLET_RECIPIENT_SELECT)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function claimQueueJobForProcessing(supabaseAdmin: any, job: Row, ownerId: string) {
  const nowIso = new Date().toISOString();
  const nextAttemptCount = Number(job.attempt_count || 0) + 1;
  const { data, error } = await supabaseAdmin
    .from('wallet_update_queue')
    .update({
      status: 'processing',
      attempt_count: nextAttemptCount,
      processing_started_at: nowIso
    })
    .eq('id', job.id)
    .eq('owner_id', ownerId)
    .eq('business_id', job.business_id)
    .eq('status', 'pending')
    .or(queueDueFilter(nowIso))
    .select(WALLET_QUEUE_SELECT)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function finalizeQueueJobProcessing(supabaseAdmin: any, job: Row, ownerId: string, updatePayload: Row) {
  const { data, error } = await supabaseAdmin
    .from('wallet_update_queue')
    .update(updatePayload)
    .eq('id', job.id)
    .eq('owner_id', ownerId)
    .eq('business_id', job.business_id)
    .eq('status', 'processing')
    .select('id,status')
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw createStructuredError(
      409,
      'QUEUE_STATUS_UPDATE_CONFLICT',
      'Wallet-Queue-Status konnte nicht aktualisiert werden.',
      'Der Queue-Job wurde bereits verarbeitet oder passt nicht mehr zu id, owner_id, business_id und status=processing.'
    );
  }

  return data;
}

function contextForCampaign(context: Row, campaign: Row) {
  if (!context.system) {
    return context;
  }

  const business = Array.isArray(campaign.businesses)
    ? campaign.businesses[0]
    : campaign.businesses;

  return {
    ...context,
    ownerId: campaign.owner_id,
    business: business || {
      id: campaign.business_id,
      owner_id: campaign.owner_id
    },
    user: {
      id: campaign.created_by || campaign.owner_id
    },
    system: true
  };
}

function queryDueCampaigns(baseQuery: any, nowIso: string) {
  return baseQuery
    .eq('status', 'scheduled')
    .or(`scheduled_at.lte.${nowIso},and(send_type.eq.location_based,scheduled_at.is.null)`);
}

function campaignIsDueForSending(campaign: Row, nowIso: string) {
  if (campaign.send_type === 'now') {
    return true;
  }

  if (campaign.send_type === 'location_based' && !campaign.scheduled_at) {
    return true;
  }

  const scheduledAt = dateIso(campaign.scheduled_at);
  return Boolean(scheduledAt && scheduledAt <= nowIso);
}

function assertCampaignCanSendNow(campaign: Row, nowIso: string) {
  if (['sent', 'partially_failed', 'failed', 'cancelled'].includes(campaign.status)) {
    throw createStructuredError(
      409,
      'CAMPAIGN_ALREADY_FINALIZED',
      'Kampagne ist bereits abgeschlossen.',
      'Abgeschlossene, fehlgeschlagene oder abgebrochene Kampagnen werden nicht erneut versendet. Erstelle bei Bedarf eine neue Kampagne.'
    );
  }

  if (campaign.send_type !== 'now' && !campaignIsDueForSending(campaign, nowIso)) {
    throw createStructuredError(
      409,
      'CAMPAIGN_NOT_DUE',
      'Kampagne ist noch nicht fällig.',
      'Geplante Wallet-Benachrichtigungen werden erst ab scheduled_at oder als fällige location_based Kampagne verarbeitet.'
    );
  }

  if (campaign.send_type === 'now' && campaign.status === 'scheduled') {
    throw createStructuredError(
      409,
      'CAMPAIGN_STATUS_NOT_SENDABLE',
      'Kampagnenstatus passt nicht zur Versandart.',
      'Eine sofortige Kampagne darf nicht im Status scheduled verarbeitet werden.'
    );
  }
}

function applyOwnerFilter(query: any, ownerId: string) {
  return ownerId ? query.eq('owner_id', ownerId) : query;
}

function limitWarning(code: string, message: string, count: number) {
  return {
    code,
    message,
    count
  };
}

function createSendResultSummary() {
  return {
    total: 0,
    status_counts: {},
    error_counts: {},
    warning_counts: {},
    detail_limit: SEND_RESULT_DETAIL_LIMIT,
    truncated: false
  };
}

function incrementSummaryCounter(summary: Row, group: string, value: unknown) {
  const key = stringValue(value || 'unknown') || 'unknown';
  summary[group][key] = Number(summary[group][key] || 0) + 1;
}

function addSendResult(results: Row[], summary: Row, result: Row) {
  summary.total = Number(summary.total || 0) + 1;
  incrementSummaryCounter(summary, 'status_counts', result.status || 'unknown');

  if (result.error_code) {
    incrementSummaryCounter(summary, 'error_counts', result.error_code);
  }

  if (result.warning_code) {
    incrementSummaryCounter(summary, 'warning_counts', result.warning_code);
  }

  if (results.length < SEND_RESULT_DETAIL_LIMIT) {
    results.push(result);
  } else {
    summary.truncated = true;
  }
}

function compactProviderSendResult(recipient: Row, status: string, providerResult: Row) {
  return {
    recipient_id: recipient.id,
    status,
    provider: providerResult.provider || recipient.wallet_platform,
    action: providerResult.action || null,
    fallback: providerResult.fallback || null,
    error_code: providerResult.error_code || null,
    error_message: providerResult.error_message || providerResult.error_reason || null,
    warning_code: providerResult.warning_code || null,
    warning_message: providerResult.warning_message || null
  };
}

function compactScheduledSendResult(result: Row = {}) {
  return {
    campaign_id: result.campaign_id || null,
    status: result.status || null,
    recovered_processing_count: Number(result.recovered_processing_count || 0),
    processed_recipient_batches: Number(result.processed_recipient_batches || 0),
    result_summary: result.result_summary || createSendResultSummary(),
    results_truncated: Boolean(result.results_truncated),
    reused: Boolean(result.reused),
    message: result.message || null
  };
}

function walletLogAction(recipient: Row, providerResult: Row) {
  if (providerResult.action) {
    return providerResult.action;
  }

  if (recipient.wallet_platform === 'apple') {
    return 'apple_pass_update';
  }

  if (providerResult.fallback === 'google_object_message_fallback') {
    return 'google_object_message_fallback';
  }

  if (providerResult.fallback === 'location_based_object_update_only') {
    return 'google_location_object_update';
  }

  return 'google_text_and_notify';
}

function walletUpdateWasPrepared(status: string, providerResult: Row) {
  return status === 'sent'
    || Boolean(providerResult.pass_version_id)
    || Boolean(providerResult.fallback);
}

function visibleNotificationWasSent(status: string, recipient: Row, providerResult: Row) {
  if (status !== 'sent') {
    return false;
  }

  if (recipient.wallet_platform === 'apple') {
    return Boolean(providerResult.push?.ok);
  }

  if (recipient.wallet_platform === 'google' && providerResult.fallback) {
    return false;
  }

  return true;
}

async function updateCardWalletState(context: Row, cardInstanceId: string, options: Row = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const businessId = stringValue(options.businessId || context.business?.id);
  const updatePayload: Row = {};

  if (options.walletUpdated !== false) {
    updatePayload.last_wallet_update_at = nowIso;
  }

  if (options.visibleNotification) {
    updatePayload.last_notification_at = nowIso;
  }

  if (options.countNotifications) {
    let countQuery = context.supabaseAdmin
      .from('wallet_push_logs')
      .select('id', { count: 'exact', head: true })
      .eq('card_instance_id', cardInstanceId)
      .in('status', VISIBLE_NOTIFICATION_STATUSES)
      .in('action', VISIBLE_NOTIFICATION_ACTIONS)
      .gte('created_at', startOfRollingDay());

    if (context.ownerId) {
      countQuery = countQuery.eq('owner_id', context.ownerId);
    }

    if (businessId) {
      countQuery = countQuery.eq('business_id', businessId);
    }

    const { count, error } = await countQuery;

    if (error) {
      throw error;
    }

    updatePayload.notification_count_24h = count || 0;
  }

  if (!Object.keys(updatePayload).length) {
    return;
  }

  let query = context.supabaseAdmin
    .from('card_instances')
    .update(updatePayload)
    .eq('id', cardInstanceId);

  if (context.ownerId) {
    query = query.eq('owner_id', context.ownerId);
  }

  if (context.business?.id) {
    query = query.eq('business_id', context.business.id);
  }

  if (!context.business?.id && businessId) {
    query = query.eq('business_id', businessId);
  }

  const { data: updatedCardInstance, error } = await query
    .select('id')
    .maybeSingle();

  if (error || !updatedCardInstance) {
    throw createStructuredError(
      500,
      'CARD_WALLET_STATE_UPDATE_FAILED',
      'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.',
      error?.message || 'card_instances konnte nicht mit den aktuellen Wallet-Statusfeldern für die erwartete Karteninstanz aktualisiert werden.'
    );
  }
}

async function touchGoogleWalletObjectMapping(context: Row, cardInstance: Row, objectId: string, objectType: string) {
  const ownerId = context.ownerId || cardInstance.owner_id;
  const businessId = context.business?.id || cardInstance.business_id;

  if (!ownerId || !businessId) {
    throw createStructuredError(
      500,
      'GOOGLE_WALLET_OBJECT_CONTEXT_MISSING',
      'Google Wallet Object-Zuordnung konnte nicht eindeutig zugeordnet werden.',
      'owner_id oder business_id fehlen für das lokale Google Wallet Object Mapping.'
    );
  }

  const { data, error } = await context.supabaseAdmin
    .from('google_wallet_objects')
    .update({
      updated_at: new Date().toISOString()
    })
    .eq('owner_id', ownerId)
    .eq('business_id', businessId)
    .eq('card_instance_id', cardInstance.id)
    .eq('template_id', cardInstance.template_id)
    .eq('object_id', objectId)
    .eq('object_type', objectType)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    throw createStructuredError(
      500,
      'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
      'Google Wallet Object-Zuordnung konnte nicht gespeichert werden.',
      error?.message || 'Google Wallet Object Mapping konnte nach dem Provider-Update nicht für die erwartete Karteninstanz aktualisiert werden.'
    );
  }

  const { data: updatedCardInstance, error: cardError } = await context.supabaseAdmin
    .from('card_instances')
    .update({
      google_object_id: objectId,
      wallet_object_id: objectId,
      wallet_serial_number: objectId
    })
    .eq('id', cardInstance.id)
    .eq('owner_id', ownerId)
    .eq('business_id', businessId)
    .eq('template_id', cardInstance.template_id)
    .eq('wallet_platform', 'google')
    .select('id')
    .maybeSingle();

  if (cardError || !updatedCardInstance) {
    throw createStructuredError(
      500,
      'CARD_WALLET_STATE_UPDATE_FAILED',
      'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.',
      cardError?.message || 'Google Wallet Object ID konnte nach dem Provider-Update nicht für die erwartete Karteninstanz synchronisiert werden.'
    );
  }
}

export const walletNotificationService = {
  async context(request: Request) {
    return authenticatedContext(request);
  },

  async automationContext(request: Request) {
    return automationContext(request);
  },

  async createCampaign(context: Row, input: Row) {
    const title = stringValue(input.title);
    const message = stringValue(input.message);
    const targetType = stringValue(input.targetType || input.target_type || 'all_active');
    const targetFilter = targetFilterObject(input.targetFilter || input.target_filter || {});
    const sendType = stringValue(input.sendType || input.send_type || 'now');
    const templateId = stringValue(input.templateId || input.template_id);
    const scheduledAt = dateIso(input.scheduledAt || input.scheduled_at);
    const idempotencyKey = stringValue(input.idempotencyKey || input.idempotency_key);
    const locationLat = input.locationLat ?? input.location_lat ?? null;
    const locationLng = input.locationLng ?? input.location_lng ?? null;
    const locationRadiusM = input.locationRadiusM ?? input.location_radius_m ?? null;

    validateMessage(title, message);
    validateCampaignIdempotencyKey(idempotencyKey);
    validateSendType(sendType, scheduledAt);
    validateLocationSendType(sendType, locationLat, locationLng, locationRadiusM);

    const existingCampaign = await latestCampaignByIdempotency(context.supabaseAdmin, context.ownerId, context.business.id, idempotencyKey);

    if (existingCampaign) {
      return {
        campaign: existingCampaign,
        reused: true
      };
    }

    const template = await loadTemplate(context.supabaseAdmin, context.ownerId, templateId);
    validateTargetAgainstTemplate(template, targetType);
    validateTargetFilter(targetType, targetFilter);

    const duplicateCampaign = await recentDuplicateCampaign(context.supabaseAdmin, context.ownerId, {
      businessId: context.business.id,
      templateId: template?.id || '',
      title,
      message,
      targetType,
      targetFilter,
      sendType,
      scheduledAt,
      locationLat,
      locationLng,
      locationRadiusM,
      duplicateWindowMinutes: walletLimitConfig().duplicateWindowMinutes
    });

    if (duplicateCampaign) {
      await logCampaignDuplicateSkipped(context, duplicateCampaign, {
        title,
        message,
        targetType,
        targetFilter,
        sendType,
        scheduledAt,
        locationLat,
        locationLng,
        locationRadiusM,
        duplicateWindowMinutes: walletLimitConfig().duplicateWindowMinutes
      });

      return {
        campaign: duplicateCampaign,
        recipients_count: 0,
        duplicate_window_minutes: walletLimitConfig().duplicateWindowMinutes,
        reused: true,
        duplicate: true
      };
    }

    const { data: campaign, error } = await context.supabaseAdmin
      .from('wallet_notification_campaigns')
      .insert({
        owner_id: context.ownerId,
        business_id: context.business.id,
        template_id: template?.id || null,
        title,
        message,
        target_type: targetType,
        target_filter: targetFilter,
        send_type: sendType,
        scheduled_at: scheduledAt,
        location_lat: locationLat,
        location_lng: locationLng,
        location_radius_m: locationRadiusM,
        status: sendType === 'now' ? 'sending' : 'scheduled',
        idempotency_key: idempotencyKey || null,
        created_by: context.user.id
      })
      .select(WALLET_CAMPAIGN_SELECT)
      .single();

    if (error) {
      if (error.code === '23505' && idempotencyKey) {
        const concurrentCampaign = await latestCampaignByIdempotency(
          context.supabaseAdmin,
          context.ownerId,
          context.business.id,
          idempotencyKey
        );

        if (concurrentCampaign) {
          return {
            campaign: concurrentCampaign,
            recipients_count: await countCampaignRecipients(context.supabaseAdmin, concurrentCampaign),
            reused: true,
            idempotency_conflict_recovered: true
          };
        }
      }

      throw error;
    }

    const recipients = await this.resolveRecipients(context, campaign);
    let responseCampaign = campaign;
    let sendResult = null;

    if (sendType === 'now') {
      sendResult = await this.sendNow(context, campaign.id);
      responseCampaign = await reloadCampaign(context.supabaseAdmin, context.ownerId, campaign.id) || {
        ...campaign,
        status: sendResult.status || campaign.status
      };
    }

    return {
      campaign: responseCampaign,
      recipients_count: recipients.length,
      send_result: sendResult,
      reused: false
    };
  },

  async resolveRecipients(context: Row, campaign: Row) {
    const targetFilter = targetFilterObject(campaign.target_filter || {});
    const campaignTemplate = campaign.template_id
      ? await loadTemplate(context.supabaseAdmin, context.ownerId, campaign.template_id)
      : null;

    validateTargetAgainstTemplate(campaignTemplate, campaign.target_type);
    validateTargetFilter(campaign.target_type, targetFilter);

    const instances = await loadWalletCardInstances(context, {
      businessId: campaign.business_id,
      templateId: campaign.template_id,
      pushEnabledOnly: true,
      includeGoogleObjects: true
    });

    const eligible = instances
      .filter((instance: Row) => featureEnabled(instance.card_templates, 'notifications'))
      .filter((instance: Row) => cardMatchesTarget(instance, campaign.target_type, targetFilter));
    const rows = eligible.map((instance: Row) => ({
      owner_id: context.ownerId,
      campaign_id: campaign.id,
      business_id: campaign.business_id,
      card_instance_id: instance.id,
      wallet_platform: instance.wallet_platform,
      status: 'pending'
    }));

    if (!rows.length) {
      const existingRecipients = await loadCampaignRecipients(context.supabaseAdmin, campaign);

      if (existingRecipients.length) {
        return existingRecipients;
      }

      await insertLog(context.supabaseAdmin, {
        owner_id: context.ownerId,
        business_id: campaign.business_id,
        campaign_id: campaign.id,
        wallet_platform: 'system',
        action: 'resolve_recipients',
        status: 'skipped',
        request_payload: {
          target_type: campaign.target_type,
          target_filter: targetFilter
        },
        response_payload: {
          recipients_count: 0
        },
        error_message: 'Keine erreichbaren Wallet-Karten für diese Zielgruppe.'
      });
      return [];
    }

    await upsertRecipientRows(context.supabaseAdmin, rows);

    return await loadCampaignRecipients(context.supabaseAdmin, campaign);
  },

  async checkPlatformLimits(context: Row, cardInstance: Row, platform: string) {
    assertLimitCardBelongsToContext(context, cardInstance);
    const walletPlatform = validateWalletPlatformForCard(cardInstance, platform);
    if (cardInstance.push_enabled === false) {
      return {
        allowed: false,
        status: 'skipped',
        error_code: 'PUSH_DISABLED',
        error_message: 'Wallet-Pushs sind für diese Karteninstanz deaktiviert.',
        error_reason: 'card_instances.push_enabled ist false; die Karte darf nicht für Wallet-Benachrichtigungen verwendet werden.'
      };
    }

    const since = startOfRollingDay();
    const limits = walletLimitConfig();
    const businessDailyLimit = limits.businessDailyLimit;
    const customerDailyLimit = limits.customerDailyLimit;
    const cardDailyLimit = limits.cardDailyLimit;
    const googleNotifyLimit = limits.googleTextAndNotifyLimitPerPass24h;
    const customerLimit = await loadCustomerLimitCardInstanceIds(context, cardInstance);

    const { count: businessCount, error: businessError } = await context.supabaseAdmin
      .from('wallet_push_logs')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', cardInstance.owner_id)
      .eq('business_id', cardInstance.business_id)
      .in('status', NOTIFICATION_LIMIT_STATUSES)
      .in('action', NOTIFICATION_LIMIT_ACTIONS)
      .gte('created_at', since);

    if (businessError) {
      throw businessError;
    }

    const { count: customerCount, error: customerError } = customerLimit.cardInstanceIds.length
      ? await context.supabaseAdmin
        .from('wallet_push_logs')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', cardInstance.owner_id)
        .eq('business_id', cardInstance.business_id)
        .in('card_instance_id', customerLimit.cardInstanceIds)
        .in('status', NOTIFICATION_LIMIT_STATUSES)
        .in('action', NOTIFICATION_LIMIT_ACTIONS)
        .gte('created_at', since)
      : { count: 0, error: null };

    if (customerError) {
      throw customerError;
    }

    const { count: cardCount, error: cardError } = await context.supabaseAdmin
      .from('wallet_push_logs')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', cardInstance.owner_id)
      .eq('business_id', cardInstance.business_id)
      .eq('card_instance_id', cardInstance.id)
      .in('status', NOTIFICATION_LIMIT_STATUSES)
      .in('action', NOTIFICATION_LIMIT_ACTIONS)
      .gte('created_at', since);

    if (cardError) {
      throw cardError;
    }

    const { count: googleCount, error: googleError } = await context.supabaseAdmin
      .from('wallet_push_logs')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', cardInstance.owner_id)
      .eq('business_id', cardInstance.business_id)
      .eq('card_instance_id', cardInstance.id)
      .eq('wallet_platform', 'google')
      .eq('action', 'google_text_and_notify')
      .eq('status', 'sent')
      .gte('created_at', since);

    if (googleError) {
      throw googleError;
    }

    if ((businessCount || 0) >= businessDailyLimit) {
      return {
        allowed: false,
        status: 'limited',
        error_code: 'BUSINESS_DAILY_LIMIT_REACHED',
        error_message: `Tageslimit für dieses Business erreicht (${businessDailyLimit}/24h).`,
        limit: businessDailyLimit,
        current: businessCount || 0,
        limits
      };
    }

    if ((customerCount || 0) >= customerDailyLimit) {
      return {
        allowed: false,
        status: 'limited',
        error_code: 'CUSTOMER_DAILY_LIMIT_REACHED',
        error_message: `Tageslimit für diesen Kunden erreicht (${customerDailyLimit}/24h).`,
        limit: customerDailyLimit,
        current: customerCount || 0,
        customerLimitKey: customerLimit.identity.key,
        limits
      };
    }

    if ((cardCount || 0) >= cardDailyLimit) {
      return {
        allowed: false,
        status: 'limited',
        error_code: 'CARD_DAILY_LIMIT_REACHED',
        error_message: `Tageslimit für diese Karte erreicht (${cardDailyLimit}/24h).`,
        limit: cardDailyLimit,
        current: cardCount || 0,
        limits
      };
    }

    if (walletPlatform === 'google' && (googleCount || 0) >= googleNotifyLimit) {
      return {
        allowed: false,
        status: 'limited',
        error_code: 'GOOGLE_TEXT_AND_NOTIFY_LIMIT_REACHED',
        error_message: `Google erlaubt maximal ${googleNotifyLimit} notification-triggering Messages pro Pass in 24 Stunden.`,
        limit: googleNotifyLimit,
        current: googleCount || 0,
        limits
      };
    }

    return {
      allowed: true,
      businessCount: businessCount || 0,
      customerCount: customerCount || 0,
      cardCount: cardCount || 0,
      googleCount: googleCount || 0,
      businessRemaining: Math.max(0, businessDailyLimit - (businessCount || 0)),
      customerRemaining: Math.max(0, customerDailyLimit - (customerCount || 0)),
      cardRemaining: Math.max(0, cardDailyLimit - (cardCount || 0)),
      googleTextAndNotifyRemaining: Math.max(0, googleNotifyLimit - (googleCount || 0)),
      customerLimitKey: customerLimit.identity.key,
      limits
    };
  },

	  async previewNotificationLimits(context: Row, input: Row) {
	    const limits = walletLimitConfig();
	    const targetType = stringValue(input.targetType || input.target_type || 'template');
    const targetFilter = targetFilterObject(input.targetFilter || input.target_filter || {});
    const templateId = stringValue(input.templateId || input.template_id);
    const sendType = stringValue(input.sendType || input.send_type || 'now');
    const scheduledAt = dateIso(input.scheduledAt || input.scheduled_at);
    const locationLat = input.locationLat ?? input.location_lat ?? null;
    const locationLng = input.locationLng ?? input.location_lng ?? null;
    const locationRadiusM = input.locationRadiusM ?? input.location_radius_m ?? null;
    const template = await loadTemplate(context.supabaseAdmin, context.ownerId, templateId);

    validateSendType(sendType, scheduledAt);
    validateLocationSendType(sendType, locationLat, locationLng, locationRadiusM);
    validateTargetAgainstTemplate(template, targetType);
    validateTargetFilter(targetType, targetFilter);

    const instances = await loadWalletCardInstances(context, {
      businessId: context.business.id,
      templateId
    });

    const matching = instances
      .filter((instance: Row) => featureEnabled(instance.card_templates, 'notifications'))
      .filter((instance: Row) => cardMatchesTarget(instance, targetType, targetFilter));
    const pushDisabledCount = matching.filter((instance: Row) => instance.push_enabled === false).length;
    const reachable = matching
      .filter((instance: Row) => ['apple', 'google'].includes(instance.wallet_platform) && instance.push_enabled !== false);
    const appleCards = reachable.filter((instance: Row) => instance.wallet_platform === 'apple');
    const googleCards = reachable.filter((instance: Row) => instance.wallet_platform === 'google');
    const warnings = [];
    const limitCounts: Row = {};
    let allowedCount = 0;
    let limitedCount = 0;
    let simulatedBusinessRemaining: number | null = null;
    const simulatedCustomerRemainingByKey: Row = {};

    for (const instance of reachable) {
      const limitResult = await this.checkPlatformLimits(context, instance, instance.wallet_platform);
      const businessRemaining = Number(limitResult.businessRemaining);
      const customerRemaining = Number(limitResult.customerRemaining);
      const customerLimitKey = stringValue(limitResult.customerLimitKey || instance.customer_id || instance.customer_card_id || instance.id);

      if (simulatedBusinessRemaining === null && Number.isFinite(businessRemaining)) {
        simulatedBusinessRemaining = Math.max(0, Math.floor(businessRemaining));
      }

      if (Number.isFinite(customerRemaining) && simulatedCustomerRemainingByKey[customerLimitKey] === undefined) {
        simulatedCustomerRemainingByKey[customerLimitKey] = Math.max(0, Math.floor(customerRemaining));
      }

      if (limitResult.allowed) {
        if (simulatedBusinessRemaining !== null && simulatedBusinessRemaining <= 0) {
          limitedCount += 1;
          limitCounts.BUSINESS_DAILY_LIMIT_REACHED = Number(limitCounts.BUSINESS_DAILY_LIMIT_REACHED || 0) + 1;
          continue;
        }

        if (Number.isFinite(customerRemaining) && Number(simulatedCustomerRemainingByKey[customerLimitKey]) <= 0) {
          limitedCount += 1;
          limitCounts.CUSTOMER_DAILY_LIMIT_REACHED = Number(limitCounts.CUSTOMER_DAILY_LIMIT_REACHED || 0) + 1;
          continue;
        }

        if (simulatedBusinessRemaining !== null) {
          simulatedBusinessRemaining -= 1;
        }

        if (Number.isFinite(customerRemaining)) {
          simulatedCustomerRemainingByKey[customerLimitKey] = Number(simulatedCustomerRemainingByKey[customerLimitKey]) - 1;
        }

        allowedCount += 1;
        continue;
      }

      limitedCount += 1;
      const code = limitResult.error_code || 'WALLET_LIMIT_REACHED';
      limitCounts[code] = Number(limitCounts[code] || 0) + 1;
    }

    const appleIds = appleCards.map((instance: Row) => instance.id);
    let appleRegisteredCount = 0;

    if (appleIds.length) {
      const { data: registrations, error: registrationError } = await context.supabaseAdmin
        .from('apple_wallet_registrations')
        .select('card_instance_id')
        .eq('owner_id', context.ownerId)
        .eq('business_id', context.business.id)
        .in('card_instance_id', appleIds);

      if (registrationError) {
        throw registrationError;
      }

      appleRegisteredCount = new Set((registrations || []).map((registration: Row) => registration.card_instance_id)).size;
    }

    const appleUnregisteredCount = Math.max(0, appleCards.length - appleRegisteredCount);

    if (!reachable.length) {
      warnings.push(limitWarning(
        'NO_REACHABLE_WALLET_CARDS',
        'Für diese Auswahl sind keine erreichbaren Apple- oder Google-Wallet-Karten vorhanden.',
        0
      ));
    }

    if (pushDisabledCount > 0) {
      warnings.push(limitWarning(
        'PUSH_DISABLED',
        `${pushDisabledCount} Wallet-Karte(n) haben Push-Benachrichtigungen deaktiviert und werden nicht angeschrieben.`,
        pushDisabledCount
      ));
    }

    if (appleUnregisteredCount > 0) {
      warnings.push(limitWarning(
        'APPLE_NO_REGISTERED_DEVICES',
        `${appleUnregisteredCount} Apple-Wallet-Karte(n) haben noch kein registriertes Gerät. Apple-Pushs werden dort nur als Kartenupdate vorbereitet.`,
        appleUnregisteredCount
      ));
    }

    if (Number(limitCounts.GOOGLE_TEXT_AND_NOTIFY_LIMIT_REACHED || 0) > 0) {
      warnings.push(limitWarning(
        'GOOGLE_TEXT_AND_NOTIFY_LIMIT_REACHED',
        `${limitCounts.GOOGLE_TEXT_AND_NOTIFY_LIMIT_REACHED} Google-Wallet-Karte(n) haben das 24h-Benachrichtigungslimit von ${limits.googleTextAndNotifyLimitPerPass24h} pro Pass erreicht.`,
        Number(limitCounts.GOOGLE_TEXT_AND_NOTIFY_LIMIT_REACHED)
      ));
    }

    if (Number(limitCounts.BUSINESS_DAILY_LIMIT_REACHED || 0) > 0) {
      warnings.push(limitWarning(
        'BUSINESS_DAILY_LIMIT_REACHED',
        `${limitCounts.BUSINESS_DAILY_LIMIT_REACHED} Empfänger würden wegen des Business-Tageslimits übersprungen.`,
        Number(limitCounts.BUSINESS_DAILY_LIMIT_REACHED)
      ));
    }

    if (Number(limitCounts.CUSTOMER_DAILY_LIMIT_REACHED || 0) > 0) {
      warnings.push(limitWarning(
        'CUSTOMER_DAILY_LIMIT_REACHED',
        `${limitCounts.CUSTOMER_DAILY_LIMIT_REACHED} Empfänger würden wegen des Kunden-Tageslimits übersprungen.`,
        Number(limitCounts.CUSTOMER_DAILY_LIMIT_REACHED)
      ));
    }

	    if (Number(limitCounts.CARD_DAILY_LIMIT_REACHED || 0) > 0) {
	      warnings.push(limitWarning(
	        'CARD_DAILY_LIMIT_REACHED',
	        `${limitCounts.CARD_DAILY_LIMIT_REACHED} Karte(n) haben ihr Tageslimit erreicht.`,
	        Number(limitCounts.CARD_DAILY_LIMIT_REACHED)
	      ));
	    }

	    if (sendType === 'location_based') {
	      warnings.push(limitWarning(
	        'LOCATION_BASED_BEST_EFFORT',
	        'Standortbasierte Wallet-Nachrichten sind best-effort: Apple nutzt relevante Orte am Pass, Google wird als Kartenupdate-Fallback verarbeitet.',
	        reachable.length
	      ));

	      if (appleCards.length) {
	        warnings.push(limitWarning(
	          'APPLE_LOCATION_RELEVANCE_DECIDED_BY_IOS',
	          `${appleCards.length} Apple-Wallet-Karte(n) bekommen locations[].relevantText; iOS entscheidet selbst, ob und wann der Hinweis sichtbar wird.`,
	          appleCards.length
	        ));
	      }

	      if (googleCards.length) {
	        warnings.push(limitWarning(
	          'GOOGLE_LOCATION_PUSH_NOT_SUPPORTED',
	          `${googleCards.length} Google-Wallet-Karte(n) erhalten im MVP ein Kartenupdate als Fallback statt eines echten Standort-Pushs.`,
	          googleCards.length
	        ));
	      }
	    }

	    return {
      ok: true,
      target_type: targetType,
      send_type: sendType,
      scheduled_at: scheduledAt,
      location_lat: locationLat,
      location_lng: locationLng,
      location_radius_m: locationRadiusM,
      template_id: templateId || null,
      matching_count: matching.length,
      reachable_count: reachable.length,
      unreachable_count: Math.max(0, matching.length - reachable.length),
      push_disabled_count: pushDisabledCount,
      allowed_count: allowedCount,
      limited_count: limitedCount,
      apple_count: appleCards.length,
      apple_registered_count: appleRegisteredCount,
      apple_unregistered_count: appleUnregisteredCount,
      google_count: googleCards.length,
      limit_counts: limitCounts,
      business_remaining_after_preflight: simulatedBusinessRemaining === null
        ? null
        : Math.max(0, simulatedBusinessRemaining),
      limits,
      warnings
    };
  },

  async sendNow(context: Row, campaignId: string) {
    const { data: campaign, error: campaignError } = await context.supabaseAdmin
      .from('wallet_notification_campaigns')
      .select(WALLET_CAMPAIGN_SELECT)
      .eq('id', campaignId)
      .eq('owner_id', context.ownerId)
      .maybeSingle();

    if (campaignError) {
      throw campaignError;
    }

    if (!campaign) {
      throw createStructuredError(404, 'CAMPAIGN_NOT_FOUND', 'Kampagne nicht gefunden.', 'Die Kampagne gehört nicht zu deinem Account oder existiert nicht.');
    }

    if (!context.system && campaign.business_id !== context.business.id) {
      throw createStructuredError(
        404,
        'CAMPAIGN_NOT_FOUND',
        'Kampagne nicht gefunden.',
        'Die Kampagne gehört nicht zu deinem Business oder existiert nicht.'
      );
    }

    assertCampaignCanSendNow(campaign, new Date().toISOString());
    const targetFilter = targetFilterObject(campaign.target_filter || {});
    validateTargetFilter(campaign.target_type, targetFilter);

    const recoveredProcessingCount = await recoverStaleProcessingRecipients(context.supabaseAdmin, campaign.id);

    let existingRecipientCount = await countCampaignRecipients(context.supabaseAdmin, campaign);

    if (['scheduled', 'location_based'].includes(campaign.send_type) && existingRecipientCount === 0) {
      await this.resolveRecipients(context, campaign);
      existingRecipientCount = await countCampaignRecipients(context.supabaseAdmin, campaign);
    }

    let recipients = await loadPendingCampaignRecipients(context.supabaseAdmin, campaign);

    if (!recipients.length) {
      if (existingRecipientCount > 0) {
        const campaignStatus = await updateCampaignStatus(context.supabaseAdmin, campaign);

        return {
          campaign_id: campaign.id,
          status: campaignStatus,
          results: [],
          result_summary: createSendResultSummary(),
          results_truncated: false,
          reused: true,
          recovered_processing_count: recoveredProcessingCount,
          message: 'Keine offenen Empfänger vorhanden; bereits verarbeitete oder gerade verarbeitete Empfänger wurden nicht erneut auf pending gesetzt.'
        };
      }

      await this.resolveRecipients(context, campaign);
      recipients = await loadPendingCampaignRecipients(context.supabaseAdmin, campaign);
    }

    if (recipients.length) {
      const { data: sendingCampaign, error: sendingError } = await context.supabaseAdmin
        .from('wallet_notification_campaigns')
        .update({ status: 'sending' })
        .eq('id', campaign.id)
        .eq('owner_id', campaign.owner_id)
        .eq('business_id', campaign.business_id)
        .in('status', ['draft', 'scheduled', 'sending'])
        .select('id, status')
        .maybeSingle();

      if (sendingError) {
        throw sendingError;
      }

      if (!sendingCampaign) {
        throw createStructuredError(
          409,
          'CAMPAIGN_SEND_START_CONFLICT',
          'Kampagne konnte nicht in den Versandstatus gesetzt werden.',
          'owner_id, business_id, campaign_id und ein sendbarer Kampagnenstatus müssen beim Start des Versands zusammenpassen.'
        );
      }
    }

    const results = [];
    const resultSummary = createSendResultSummary();
    let processedRecipientBatches = 0;

    while (recipients.length) {
      processedRecipientBatches += 1;

      for (const pendingRecipient of recipients) {
        let recipient = pendingRecipient;

        try {
          assertRecipientBelongsToCampaign(pendingRecipient, campaign);
          const claimedRecipient = await claimRecipientForProcessing(context.supabaseAdmin, pendingRecipient, campaign);

          if (!claimedRecipient) {
            await insertLog(context.supabaseAdmin, {
              owner_id: context.ownerId,
              business_id: pendingRecipient.business_id,
              card_instance_id: pendingRecipient.card_instance_id,
              campaign_id: pendingRecipient.campaign_id,
              wallet_platform: pendingRecipient.wallet_platform,
              action: 'recipient_already_claimed',
              status: 'skipped',
              request_payload: {
                recipient_id: pendingRecipient.id
              },
              response_payload: {
                reason: 'already_claimed'
              },
              error_message: 'Empfänger wurde von einem parallelen Send-Lauf bereits zur Verarbeitung geclaimt.'
            });
            addSendResult(results, resultSummary, {
              recipient_id: pendingRecipient.id,
              status: 'skipped',
              reason: 'already_claimed'
            });
            continue;
          }

          recipient = claimedRecipient;
          const { data: cardInstance, error: instanceError } = await context.supabaseAdmin
            .from('card_instances')
            .select(CARD_INSTANCE_WITH_WALLET_RELATIONS_SELECT)
            .eq('id', recipient.card_instance_id)
            .eq('owner_id', context.ownerId)
            .eq('business_id', campaign.business_id)
            .maybeSingle();

          if (instanceError || !cardInstance) {
            const errorMessage = instanceError?.message || 'Karteninstanz nicht gefunden.';
            await this.logResult(context, recipient, 'failed', { error_message: errorMessage });
            addSendResult(results, resultSummary, {
              recipient_id: recipient.id,
              status: 'failed',
              error_message: errorMessage
            });
            continue;
          }

          if (campaign.template_id && cardInstance.template_id !== campaign.template_id) {
            await this.logResult(context, recipient, 'failed', {
              error_code: 'RECIPIENT_TEMPLATE_MISMATCH',
              error_message: 'Karteninstanz passt nicht zum Kampagnen-Template.',
              error_reason: 'Die Empfängerkarte muss zum template_id der Kampagne gehören.'
            });
            addSendResult(results, resultSummary, {
              recipient_id: recipient.id,
              status: 'failed',
              error_code: 'RECIPIENT_TEMPLATE_MISMATCH',
              error_message: 'Karteninstanz passt nicht zum Kampagnen-Template.'
            });
            continue;
          }

          if (cardInstance.wallet_platform !== recipient.wallet_platform) {
            await this.logResult(context, recipient, 'failed', {
              error_code: 'RECIPIENT_PLATFORM_MISMATCH',
              error_message: 'Wallet-Plattform passt nicht zur Karteninstanz.',
              error_reason: 'Die Empfängerplattform muss zur gespeicherten card_instance.wallet_platform passen.'
            });
            addSendResult(results, resultSummary, {
              recipient_id: recipient.id,
              status: 'failed',
              error_code: 'RECIPIENT_PLATFORM_MISMATCH',
              error_message: 'Wallet-Plattform passt nicht zur Karteninstanz.'
            });
            continue;
          }

          if (!featureEnabled(cardInstance.card_templates, 'notifications')) {
            await this.logResult(context, recipient, 'skipped', {
              error_code: 'RECIPIENT_NOTIFICATIONS_DISABLED',
              error_message: 'Benachrichtigungen sind für dieses Template nicht mehr aktiv.',
              error_reason: 'Die Karteninstanz wird direkt vor dem Provider-Aufruf erneut gegen die Template-Feature-Matrix geprüft.'
            });
            addSendResult(results, resultSummary, {
              recipient_id: recipient.id,
              status: 'skipped',
              error_code: 'RECIPIENT_NOTIFICATIONS_DISABLED',
              error_message: 'Benachrichtigungen sind für dieses Template nicht mehr aktiv.'
            });
            continue;
          }

          if (!cardMatchesTarget(cardInstance, campaign.target_type, targetFilter)) {
            await this.logResult(context, recipient, 'skipped', {
              error_code: 'RECIPIENT_TARGET_MISMATCH',
              error_message: 'Karteninstanz passt nicht mehr zur Kampagnen-Zielgruppe.',
              error_reason: 'Empfänger werden vor dem Provider-Aufruf erneut gegen target_type und target_filter geprüft.'
            });
            addSendResult(results, resultSummary, {
              recipient_id: recipient.id,
              status: 'skipped',
              error_code: 'RECIPIENT_TARGET_MISMATCH',
              error_message: 'Karteninstanz passt nicht mehr zur Kampagnen-Zielgruppe.'
            });
            continue;
          }

          const limits = await this.checkPlatformLimits(context, cardInstance, recipient.wallet_platform);

          if (!limits.allowed) {
            const blockedStatus = limits.status === 'skipped' ? 'skipped' : 'limited';
            await this.logResult(context, recipient, blockedStatus, limits);
            addSendResult(results, resultSummary, {
              recipient_id: recipient.id,
              status: blockedStatus,
              error_code: limits.error_code,
              error_message: limits.error_message || null
            });
            continue;
          }

          const providerResult = recipient.wallet_platform === 'apple'
            ? await this.sendToApplePass(context, campaign, recipient, cardInstance)
            : await this.sendToGoogleWallet(context, campaign, recipient, cardInstance);

          const status = providerResult.ok
            ? 'sent'
            : providerResult.status === 'prepared'
            ? 'prepared'
            : providerResult.status === 'skipped'
              ? 'skipped'
              : 'failed';
          await this.logResult(context, recipient, status, providerResult);
          addSendResult(results, resultSummary, compactProviderSendResult(recipient, status, providerResult));
        } catch (error) {
          const errorMessage = error?.message || error?.error_message || 'Wallet-Empfänger konnte nicht verarbeitet werden.';

          await this.logResult(context, recipient, 'failed', {
            error_code: error?.error_code || 'RECIPIENT_SEND_FAILED',
            error_message: errorMessage,
            error_reason: error?.error_reason || 'Provider-Aufruf oder Kartenupdate ist fehlgeschlagen.'
          });
          addSendResult(results, resultSummary, {
            recipient_id: recipient.id,
            status: 'failed',
            error_code: error?.error_code || 'RECIPIENT_SEND_FAILED',
            error_message: errorMessage
          });
        }
      }

      recipients = await loadPendingCampaignRecipients(context.supabaseAdmin, campaign);
    }

    const campaignStatus = await updateCampaignStatus(context.supabaseAdmin, campaign);

    return {
      campaign_id: campaign.id,
      status: campaignStatus,
      recovered_processing_count: recoveredProcessingCount,
      processed_recipient_batches: processedRecipientBatches,
      result_summary: resultSummary,
      results_truncated: Boolean(resultSummary.truncated),
      results
    };
  },

	  async schedule(context: Row, campaignId: string) {
	    const { data: campaign, error: campaignError } = await context.supabaseAdmin
	      .from('wallet_notification_campaigns')
	      .select(WALLET_CAMPAIGN_SELECT)
	      .eq('id', campaignId)
	      .eq('owner_id', context.ownerId)
	      .maybeSingle();
	
	    if (campaignError) {
	      throw campaignError;
	    }
	
	    if (!campaign) {
	      throw createStructuredError(404, 'CAMPAIGN_NOT_FOUND', 'Kampagne nicht gefunden.', 'Die Kampagne gehört nicht zu deinem Account oder existiert nicht.');
	    }

	    if (!context.system && campaign.business_id !== context.business.id) {
	      throw createStructuredError(
	        404,
	        'CAMPAIGN_NOT_FOUND',
	        'Kampagne nicht gefunden.',
	        'Die Kampagne gehört nicht zu deinem Business oder existiert nicht.'
	      );
	    }

	    if (!['draft', 'scheduled'].includes(campaign.status)) {
	      throw createStructuredError(
	        409,
	        'CAMPAIGN_NOT_SCHEDULABLE',
	        'Kampagne kann nicht geplant werden.',
	        'Nur Kampagnen im Status draft oder scheduled dürfen geplant werden.'
	      );
	    }

	    if (!['scheduled', 'location_based'].includes(campaign.send_type)) {
	      throw createStructuredError(
	        400,
	        'CAMPAIGN_SEND_TYPE_NOT_SCHEDULABLE',
	        'Versandart kann nicht geplant werden.',
	        'Nur scheduled oder location_based Kampagnen können über schedule() geplant werden.'
	      );
	    }

	    validateSendType(campaign.send_type, dateIso(campaign.scheduled_at));
	    validateLocationSendType(campaign.send_type, campaign.location_lat, campaign.location_lng, campaign.location_radius_m);

	    const recipientCount = await countCampaignRecipients(context.supabaseAdmin, campaign);

	    if (recipientCount === 0) {
	      await this.resolveRecipients(context, campaign);
	    }

	    const { data, error } = await context.supabaseAdmin
	      .from('wallet_notification_campaigns')
	      .update({ status: 'scheduled' })
	      .eq('id', campaign.id)
	      .eq('owner_id', context.ownerId)
	      .eq('business_id', campaign.business_id)
	      .in('status', ['draft', 'scheduled'])
	      .select(WALLET_CAMPAIGN_SELECT)
	      .maybeSingle();

	    if (error) {
	      throw error;
	    }

	    if (!data) {
	      throw createStructuredError(
	        409,
	        'CAMPAIGN_SCHEDULE_CONFLICT',
	        'Kampagne konnte nicht geplant werden.',
	        'Der Kampagnenstatus wurde parallel geändert. Lade die Kampagne neu.'
	      );
	    }

	    return data;
	  },

  async sendToApplePass(context: Row, campaign: Row, recipient: Row, cardInstance: Row) {
    const template = cardInstance.card_templates;
    const messageUrl = await walletMessageUrlForCard(cardInstance);
    const passFields: Row = {
      latestMessage: campaign.message,
      message: campaign.message,
      newMessageCount: 1,
      messageUrl
    };

    if (campaign.send_type === 'location_based' && campaign.location_lat != null && campaign.location_lng != null) {
      passFields.locations = [
        {
          latitude: Number(campaign.location_lat),
          longitude: Number(campaign.location_lng),
          relevantText: campaign.message
        }
      ];
    }

    const passVersion = await appleWalletProvider.updatePassFields(context.supabaseAdmin, cardInstance, template, {
      ...passFields
    }, {
      campaignId: campaign.id,
      reason: 'wallet_notification_campaign',
      enqueue: false
    });
    const pushResult = await appleWalletProvider.sendPushUpdate(context.supabaseAdmin, cardInstance);
    const pushPrepared = Boolean(passVersion?.id) && pushResult.status === 'skipped';

    return {
      ok: Boolean(pushResult.ok),
      status: pushResult.ok ? 'sent' : pushPrepared ? 'prepared' : pushResult.status || 'failed',
      pass_version_id: passVersion.id,
      provider: 'apple',
      warning_code: pushPrepared ? pushResult.error_code || 'APPLE_PUSH_NOT_SENT_PASS_PREPARED' : null,
      warning_message: pushPrepared ? pushResult.error_message || pushResult.error_reason || 'Apple-Pass wurde aktualisiert, aber kein sichtbarer APNS-Push gesendet.' : null,
      push: pushResult
    };
  },

  async sendToGoogleWallet(context: Row, campaign: Row, recipient: Row, cardInstance: Row) {
    const template = cardInstance.card_templates;
    const googleObject = Array.isArray(cardInstance.google_wallet_objects)
      ? cardInstance.google_wallet_objects[0]
      : cardInstance.google_wallet_objects;
    const objectType = googleWalletProvider.normalizeObjectType(
      googleObject?.object_type || googleWalletProvider.objectTypeForTemplate(template)
    );
    const objectId = stringValue(googleObject?.object_id || cardInstance.google_object_id || cardInstance.wallet_object_id);

    if (!objectId) {
      return {
        ok: false,
        status: 'skipped',
        provider: 'google',
        error_code: 'GOOGLE_OBJECT_ID_MISSING',
        error_message: 'Google Wallet Object ID fehlt.',
        error_reason: 'Erstelle oder synchronisiere zuerst das Google Wallet Object für diese Karte.'
      };
    }

    if (!objectType) {
      return {
        ok: false,
        status: 'failed',
        provider: 'google',
        error_code: 'GOOGLE_OBJECT_TYPE_INVALID',
        error_message: 'Google Wallet Object Type ist ungültig.',
        error_reason: 'Die gespeicherte Google-Wallet-Zuordnung muss einen unterstützten Object Type verwenden.'
      };
    }

    const messageUrl = await walletMessageUrlForCard(cardInstance);
    const readableMessage = messageUrl
      ? campaign.message + '\n\nNachricht öffnen: ' + messageUrl
      : campaign.message;
    const cardInfoMessageRows = [
      {
        id: `wallet-message-notice-${campaign.id}`,
        header: 'Cardinfo',
        body: 'Neue Nachricht +1'
      },
      ...(messageUrl
        ? [{
          id: `wallet-message-link-${campaign.id}`,
          header: 'Nachricht lesen',
          body: messageUrl
        }]
        : [{
          id: `wallet-message-text-${campaign.id}`,
          header: campaign.title,
          body: campaign.message
        }])
    ];

    if (campaign.send_type === 'location_based') {
      const fallbackResult = await googleWalletProvider.updateObject(
        objectType,
        objectId,
        googleWalletProvider.statusPatch(template, cardInstance, objectType, cardInfoMessageRows)
      );

      if (fallbackResult.ok) {
        await touchGoogleWalletObjectMapping(context, cardInstance, objectId, objectType);
      }

      return {
        ok: fallbackResult.ok,
        status: fallbackResult.ok ? 'sent' : 'failed',
        provider: 'google',
        action: 'google_location_object_update',
        template_type: normalizeTemplateType(template),
        fallback: fallbackResult.ok ? 'location_based_object_update_only' : null,
        warning_code: fallbackResult.ok ? 'GOOGLE_LOCATION_PUSH_NOT_SUPPORTED' : null,
        warning_message: fallbackResult.ok
          ? 'Google Wallet unterstützt für diese MVP-Integration keinen echten Standort-Push; die Karte wurde als Fallback aktualisiert.'
          : null,
        error_code: fallbackResult.ok ? null : 'GOOGLE_LOCATION_FALLBACK_FAILED',
        error_message: fallbackResult.ok ? null : 'Google Wallet Standort-Fallback konnte nicht gespeichert werden.',
        response: fallbackResult.response || fallbackResult
      };
    }

    const result = await googleWalletProvider.sendTextAndNotify(objectType, objectId, campaign.title, readableMessage);

    if (!result.ok) {
      const fallbackResult = await googleWalletProvider.updateObject(
        objectType,
        objectId,
        googleWalletProvider.statusPatch(template, cardInstance, objectType, cardInfoMessageRows)
      ).catch((error: Error) => ({
        ok: false,
        error_message: error.message
      }));

      if (fallbackResult.ok) {
        await touchGoogleWalletObjectMapping(context, cardInstance, objectId, objectType);
      }

      return {
        ok: fallbackResult.ok,
        status: fallbackResult.ok ? 'sent' : 'failed',
        provider: 'google',
        template_type: normalizeTemplateType(template),
        fallback: fallbackResult.ok ? 'google_object_message_fallback' : null,
        warning_code: fallbackResult.ok ? 'GOOGLE_TEXT_AND_NOTIFY_FALLBACK' : null,
        warning_message: fallbackResult.ok
          ? 'Google TEXT_AND_NOTIFY war nicht möglich; die Nachricht wurde als Kartenupdate gespeichert.'
          : null,
        error_code: fallbackResult.ok ? null : 'GOOGLE_TEXT_AND_NOTIFY_FAILED',
        error_message: fallbackResult.ok
          ? result.error_message || result.error_reason || 'Google TEXT_AND_NOTIFY war nicht möglich; Object-Fallback wurde gespeichert.'
          : fallbackResult.error_message || fallbackResult.error_reason || result.error_message || result.error_reason || 'Google Wallet Message konnte nicht gesendet werden.',
        notification: result.response || result,
        fallback_response: fallbackResult.response || fallbackResult
      };
    }

    const cardInfoUpdateResult = await googleWalletProvider.updateObject(
      objectType,
      objectId,
      googleWalletProvider.statusPatch(template, cardInstance, objectType, cardInfoMessageRows)
    ).catch((error: Error) => ({
      ok: false,
      error_message: error.message
    }));

    await touchGoogleWalletObjectMapping(context, cardInstance, objectId, objectType);

    return {
      ok: result.ok,
      status: result.ok ? 'sent' : 'failed',
      provider: 'google',
      template_type: normalizeTemplateType(template),
      cardinfo_update: cardInfoUpdateResult.response || cardInfoUpdateResult,
      response: result.response || result
    };
  },

  async logResult(context: Row, recipient: Row, status: string, providerResult: Row) {
    const action = walletLogAction(recipient, providerResult);
    const nowIso = new Date().toISOString();
    const visibleNotification = visibleNotificationWasSent(status, recipient, providerResult);

    const { data: updatedRecipient, error: recipientUpdateError } = await context.supabaseAdmin
      .from('wallet_notification_recipients')
      .update({
        status,
        processing_started_at: null,
        provider_response: providerResult,
        error_code: providerResult.error_code || null,
        error_message: providerResult.error_message || providerResult.error_reason || null,
        sent_at: status === 'sent' ? nowIso : null
      })
      .eq('id', recipient.id)
      .eq('owner_id', context.ownerId)
      .eq('business_id', recipient.business_id)
      .eq('campaign_id', recipient.campaign_id)
      .eq('card_instance_id', recipient.card_instance_id)
      .eq('wallet_platform', recipient.wallet_platform)
      .in('status', ['pending', 'processing'])
      .select('id')
      .maybeSingle();

    if (recipientUpdateError) {
      throw recipientUpdateError;
    }

    if (!updatedRecipient) {
      await insertLog(context.supabaseAdmin, {
        owner_id: context.ownerId,
        business_id: recipient.business_id,
        card_instance_id: recipient.card_instance_id,
        campaign_id: recipient.campaign_id,
        wallet_platform: recipient.wallet_platform,
        action: 'recipient_status_update_guard_failed',
        status: 'skipped',
        request_payload: {
          recipient_id: recipient.id,
          intended_status: status
        },
        response_payload: providerResult,
        error_message: 'Empfängerstatus wurde nicht aktualisiert, weil owner_id, business_id, campaign_id, card_instance_id, wallet_platform oder Status nicht mehr passen.'
      });
      return;
    }

    await insertLog(context.supabaseAdmin, {
      owner_id: context.ownerId,
      business_id: recipient.business_id,
      card_instance_id: recipient.card_instance_id,
      campaign_id: recipient.campaign_id,
      wallet_platform: recipient.wallet_platform,
      action,
      status,
      request_payload: {
        recipient_id: recipient.id
      },
      response_payload: providerResult,
      error_message: providerResult.error_message || providerResult.error_reason || null
    });

    try {
      await updateCardWalletState(context, recipient.card_instance_id, {
        nowIso,
        walletUpdated: walletUpdateWasPrepared(status, providerResult),
        visibleNotification,
        countNotifications: visibleNotification
      });
    } catch (stateError) {
      try {
        await insertLog(context.supabaseAdmin, {
          owner_id: context.ownerId,
          business_id: recipient.business_id,
          card_instance_id: recipient.card_instance_id,
          campaign_id: recipient.campaign_id,
          wallet_platform: recipient.wallet_platform,
          action: 'card_wallet_state_sync_failed',
          status: 'failed',
          request_payload: {
            recipient_id: recipient.id,
            intended_status: status,
            provider_action: action
          },
          response_payload: {
            error_code: stateError?.error_code || 'CARD_WALLET_STATE_UPDATE_FAILED',
            error_message: stateError?.error_message || stateError?.message || 'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.',
            error_reason: stateError?.error_reason || null
          },
          error_message: stateError?.error_message || stateError?.message || 'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.'
        });
      } catch (_) {
        // Der Providerstatus wurde bereits persistiert. Ein Folgefehler beim Status-Sync
        // darf denselben Empfänger nicht nachträglich als doppelten Versand umdeuten.
      }
    }
  },

  async updateCardWalletState(context: Row, cardInstanceId: string, options: Row = {}) {
    return updateCardWalletState(context, cardInstanceId, options);
  },

  async reserveManualIdempotency(context: Row, cardInstance: Row, options: Row = {}) {
    return reserveManualWalletLog(context, cardInstance, options);
  },

  manualDuplicateKey(value: unknown) {
    return manualWalletDuplicateKey(value);
  },

  async recentManualDuplicate(context: Row, cardInstance: Row, options: Row = {}) {
    return recentManualDuplicateWalletLog(context, cardInstance, options);
  },

  async logManualDuplicateSkipped(context: Row, cardInstance: Row, options: Row = {}) {
    return logManualDuplicateSkipped(context, cardInstance, options);
  },

  async finalizeManualIdempotencyReservation(context: Row, reservation: Row | null, payload: Row = {}) {
    return finalizeManualWalletLog(context, reservation, payload);
  },

  async failManualIdempotencyReservation(context: Row | null, reservation: Row | null, error: any, fallbackCode = 'MANUAL_WALLET_OPERATION_ERROR') {
    return failManualWalletLogReservation(context, reservation, error, fallbackCode);
  },

  async reserveWalletOperationIdempotency(context: Row, cardInstance: Row, options: Row = {}) {
    return reserveManualWalletLog(context, cardInstance, options);
  },

  async finalizeWalletOperationIdempotencyReservation(context: Row, reservation: Row | null, payload: Row = {}) {
    return finalizeManualWalletLog(context, reservation, payload);
  },

  async failWalletOperationIdempotencyReservation(context: Row | null, reservation: Row | null, error: any, fallbackCode = 'WALLET_OPERATION_ERROR') {
    return failManualWalletLogReservation(context, reservation, error, fallbackCode);
  },

  async processScheduledWalletNotifications(context: Row) {
    const nowIso = new Date().toISOString();
    let query = context.supabaseAdmin
      .from('wallet_notification_campaigns')
      .select(WALLET_CAMPAIGN_WITH_BUSINESS_SELECT)
      .order('created_at', { ascending: true })
      .limit(100);

    if (!context.system) {
      query = query
        .eq('business_id', context.business.id)
        .eq('owner_id', context.ownerId);
    }

    const { data: campaigns, error } = await queryDueCampaigns(query, nowIso);

    if (error) {
      throw error;
    }

    const results = [];

    for (const campaign of campaigns || []) {
      try {
        const sendResult = await this.sendNow(contextForCampaign(context, campaign), campaign.id);
        results.push(compactScheduledSendResult(sendResult));
      } catch (error) {
        const errorMessage = error?.message || error?.error_message || 'Geplante Wallet-Kampagne konnte nicht verarbeitet werden.';
        const failurePayload: Row = {
          error_code: error?.error_code || 'SCHEDULED_CAMPAIGN_FAILED',
          error_message: errorMessage,
          error_reason: error?.error_reason || 'Der Scheduled-Processor verarbeitet die übrigen fälligen Kampagnen weiter.'
        };
        let finalStatus = 'failed';

        try {
          finalStatus = await finalizeFailedScheduledCampaign(context.supabaseAdmin, campaign, failurePayload);
        } catch (finalizeError) {
          failurePayload.finalize_error_code = finalizeError?.error_code || 'SCHEDULED_CAMPAIGN_FINALIZE_FAILED';
          failurePayload.finalize_error_message = finalizeError?.message || finalizeError?.error_message || 'Kampagnenstatus konnte nach dem Scheduled-Fehler nicht finalisiert werden.';
        }

        await insertLog(context.supabaseAdmin, {
          owner_id: campaign.owner_id,
          business_id: campaign.business_id,
          campaign_id: campaign.id,
          wallet_platform: 'system',
          action: 'scheduled_campaign_failed',
          status: 'failed',
          request_payload: {
            send_type: campaign.send_type,
            scheduled_at: campaign.scheduled_at,
            target_type: campaign.target_type
          },
          response_payload: {
            ...failurePayload,
            final_status: finalStatus
          },
          error_message: errorMessage
        });

        results.push({
          campaign_id: campaign.id,
          status: finalStatus,
          error_code: failurePayload.error_code,
          error_message: errorMessage
        });
      }
    }

    return results;
  },

  async processWalletUpdateQueue(context: Row) {
    const recoveredProcessingCount = await recoverStaleQueueJobs(
      context.supabaseAdmin,
      context.system ? '' : context.ownerId
    );
    let query = context.supabaseAdmin
      .from('wallet_update_queue')
      .select(WALLET_QUEUE_WITH_CARD_SELECT)
      .eq('status', 'pending')
      .or(queueDueFilter(new Date().toISOString()))
      .limit(50);

    if (!context.system) {
      query = query
        .eq('business_id', context.business.id)
        .eq('owner_id', context.ownerId);
    }

    const { data: jobs, error } = await query;

    if (error) {
      throw error;
    }

    const results = [];

    if (recoveredProcessingCount > 0) {
      results.push({
        status: 'recovered',
        recovered_processing_count: recoveredProcessingCount
      });
    }

    for (const pendingJob of jobs || []) {
      const ownerId = context.system ? pendingJob.owner_id : context.ownerId;
      const job = await claimQueueJobForProcessing(context.supabaseAdmin, pendingJob, ownerId);

      if (!job) {
        results.push({
          job_id: pendingJob.id,
          status: 'skipped',
          reason: 'already_claimed'
        });
        continue;
      }

      const nextAttemptCount = Number(job.attempt_count || 0);
      const cardInstance = Array.isArray(pendingJob.card_instances)
        ? pendingJob.card_instances[0]
        : pendingJob.card_instances;
      let queueWasFinalized = false;
      let finalizedQueueStatus = '';

      try {
        assertQueueJobMatchesCardInstance(job, cardInstance);

        let result;

        if (job.wallet_platform === 'apple') {
          let passVersion = null;

          if (!job.payload?.pass_version_id) {
            const passFields = job.payload?.fields && typeof job.payload.fields === 'object'
              ? job.payload.fields
              : {};
            passVersion = await appleWalletProvider.updatePassFields(
              context.supabaseAdmin,
              cardInstance,
              cardInstance.card_templates,
              passFields,
              {
                campaignId: job.campaign_id,
                reason: job.update_type,
                enqueue: false
              }
            );
          }

          result = await appleWalletProvider.sendPushUpdate(context.supabaseAdmin, cardInstance);

          if (passVersion) {
            result = {
              ...result,
              pass_version_id: passVersion.id,
              generated_pass_version: true
            };
          }
        } else {
          const googleObject = Array.isArray(cardInstance.google_wallet_objects)
            ? cardInstance.google_wallet_objects[0]
            : cardInstance.google_wallet_objects;
          const objectId = stringValue(googleObject?.object_id || cardInstance.google_object_id || cardInstance.wallet_object_id || job.payload?.object_id || job.payload?.objectId);

          if (!objectId) {
            throw createStructuredError(
              400,
              'QUEUE_GOOGLE_OBJECT_ID_MISSING',
              'Google Wallet Object ID fehlt für die Queue-Aufgabe.',
              'Synchronisiere zuerst das Google Wallet Object für diese Karte, bevor Queue-Updates verarbeitet werden.'
            );
          }

          const objectType = googleWalletProvider.normalizeObjectType(
            googleObject?.object_type || googleWalletProvider.objectTypeForTemplate(cardInstance.card_templates)
          );

          if (!objectType) {
            throw createStructuredError(
              400,
              'QUEUE_GOOGLE_OBJECT_TYPE_INVALID',
              'Google Queue Object Type ist ungültig.',
              'Die gespeicherte Google-Wallet-Zuordnung muss einen unterstützten Object Type verwenden.'
            );
          }

          if (job.update_type === 'business_logo_update') {
            result = await googleWalletProvider.createObject(cardInstance.card_templates, cardInstance);
          } else {
            const patch = job.payload?.patch !== undefined
              ? job.payload.patch
              : googleWalletProvider.statusPatch(cardInstance.card_templates, cardInstance, objectType);
            validateQueueGooglePatch(patch);

            result = await googleWalletProvider.updateObject(objectType, objectId, patch);
          }

          if (result.ok) {
            await touchGoogleWalletObjectMapping({
              ...context,
              ownerId,
              business: {
                ...(context.business || {}),
                id: job.business_id
              }
            }, cardInstance, objectId, objectType);
          }
        }
        const sent = Boolean(result.ok);
        const retry = !sent && queueJobErrorIsRetryable(result) && nextAttemptCount < 3;
        const retryAt = retry ? queueRetryAt(nextAttemptCount) : null;
        const queueStatus = sent ? 'sent' : retry ? 'pending' : 'failed';
        const updateWasPrepared = walletUpdateWasPrepared(sent ? 'sent' : 'failed', result);
        const processedAtIso = new Date().toISOString();

        await finalizeQueueJobProcessing(context.supabaseAdmin, job, ownerId, {
          status: queueStatus,
          processing_started_at: null,
          next_attempt_at: retryAt,
          processed_at: retry ? null : processedAtIso
        });
        queueWasFinalized = true;
        finalizedQueueStatus = queueStatus;

        await insertLog(context.supabaseAdmin, {
          owner_id: ownerId,
          business_id: job.business_id,
          card_instance_id: job.card_instance_id,
          campaign_id: job.campaign_id,
          wallet_platform: job.wallet_platform,
          action: `queue_${job.update_type}`,
          status: queueStatus,
          request_payload: job.payload,
          response_payload: retry
            ? {
              ...result,
              retry,
              next_attempt_at: retryAt
            }
            : result,
          error_message: sent ? null : result.error_message || result.error_reason || 'Queue-Aufgabe konnte nicht gesendet werden.'
        });

        if (updateWasPrepared) {
          try {
            await updateCardWalletState({
              ...context,
              ownerId
            }, job.card_instance_id, {
              nowIso: processedAtIso,
              businessId: job.business_id,
              walletUpdated: true,
              visibleNotification: false,
              countNotifications: false
            });
          } catch (stateError) {
            try {
              await insertLog(context.supabaseAdmin, {
                owner_id: ownerId,
                business_id: job.business_id,
                card_instance_id: job.card_instance_id,
                campaign_id: job.campaign_id,
                wallet_platform: job.wallet_platform,
                action: 'queue_card_wallet_state_sync_failed',
                status: 'failed',
                request_payload: {
                  job_id: job.id,
                  queue_status: queueStatus,
                  provider_action: `queue_${job.update_type}`
                },
                response_payload: {
                  error_code: stateError?.error_code || 'CARD_WALLET_STATE_UPDATE_FAILED',
                  error_message: stateError?.error_message || stateError?.message || 'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.',
                  error_reason: stateError?.error_reason || null
                },
                error_message: stateError?.error_message || stateError?.message || 'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.'
              });
            } catch (_) {
              // Der Queue-Job ist bereits finalisiert. Ein Folgefehler beim Status-Sync
              // darf keinen doppelten Provider-Aufruf oder Queue-Retry auslösen.
            }
          }
        }

        results.push({
          job_id: job.id,
          status: queueStatus,
          retry,
          next_attempt_at: retryAt,
          provider_result: publicQueueProviderResult(job.wallet_platform, result)
        });
      } catch (error) {
        const retry = queueJobErrorIsRetryable(error) && nextAttemptCount < 3;
        const retryAt = retry ? queueRetryAt(nextAttemptCount) : null;
        const errorMessage = error?.message || error?.error_message || 'Queue-Aufgabe fehlgeschlagen.';
        const errorCode = error?.error_code || 'QUEUE_JOB_FAILED';

        if (queueWasFinalized) {
          try {
            await insertLog(context.supabaseAdmin, {
              owner_id: ownerId,
              business_id: job.business_id,
              card_instance_id: job.card_instance_id,
              campaign_id: job.campaign_id,
              wallet_platform: job.wallet_platform,
              action: 'queue_post_finalize_error',
              status: 'failed',
              request_payload: {
                job_id: job.id,
                finalized_status: finalizedQueueStatus,
                provider_action: `queue_${job.update_type}`
              },
              response_payload: {
                error_code: errorCode,
                error_message: errorMessage,
                retry_blocked_after_finalize: true
              },
              error_message: errorMessage
            });
          } catch (_) {
            // Wenn sogar der Folge-Audit-Log scheitert, bleibt der Queue-Job trotzdem
            // finalisiert; ein Retry würde sonst denselben Wallet-Provider-Aufruf duplizieren.
          }

          results.push({
            job_id: job.id,
            status: finalizedQueueStatus || 'sent',
            post_finalize_error_code: errorCode,
            post_finalize_error_message: errorMessage
          });
          continue;
        }

        await finalizeQueueJobProcessing(context.supabaseAdmin, job, ownerId, {
          status: retry ? 'pending' : 'failed',
          processing_started_at: null,
          next_attempt_at: retryAt,
          processed_at: retry ? null : new Date().toISOString()
        });

        await insertLog(context.supabaseAdmin, {
          owner_id: ownerId,
          business_id: job.business_id,
          card_instance_id: job.card_instance_id,
          campaign_id: job.campaign_id,
          wallet_platform: job.wallet_platform,
          action: `queue_${job.update_type}`,
          status: retry ? 'pending' : 'failed',
          request_payload: job.payload,
          response_payload: {
            retry,
            error_code: errorCode,
            next_attempt_at: retryAt
          },
          error_message: errorMessage
        });

        results.push({
          job_id: job.id,
          status: retry ? 'pending' : 'failed',
          error_code: errorCode,
          error_message: errorMessage
        });
      }
    }

    return results;
  }
};
