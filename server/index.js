import express from 'express';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getPublicConfig } from './config.js';
import { createSupabaseAdmin, requireSupabaseAdmin } from './supabaseAdmin.js';
import { buildTemplateQrPdf, loadPdfImageFromBuffer } from './pdf.js';
import { SCANNER_ACTIONS, featureEnabled, normalizeTemplateType, validateScannerAction } from '../public/js/templateFeatures.js';
import { resolveCardEmblem, supabaseCardEmblemUrl } from './cardEmblems.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const pdfBrandLogoPath = path.join(publicDir, 'assets', 'el-promillo-title-lockup-new-cutout.png');
const serveStaticFrontend = process.env.SERVE_STATIC_FRONTEND !== 'false';
const config = loadConfig();
const supabaseAdmin = createSupabaseAdmin(config);
const app = express();
const CLAIM_WALLET_OBJECT_ID_MAX_LENGTH = 180;
const CLAIM_WALLET_OBJECT_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const demographicGenders = new Set(['male', 'female']);
const demographicAgeGroups = new Set(['18_plus', '25_plus', '30_plus']);
const walletEmblemColumnNames = new Set(['resolved_emblem_key', 'resolved_emblem_url', 'emblem_updated_at']);
const clubFeatureNames = ['vip', 'balance', 'cloakroom', 'coupon', 'membership'];
const localPublicRateLimitBuckets = new Map();
let pdfBrandLogoPromise = null;
const localTemplatePublicSelect = [
  'id',
  'business_name',
  'card_name',
  'card_type',
  'template_type',
  'description',
  'primary_color',
  'text_color',
  'logo_url',
  'reward_text',
  'stamps_required',
  'streak_goal',
  'vip_tier',
  'settings',
  'club_features',
  'club_settings',
  'public_claim_token',
  'is_active',
  'businesses(name,logo_url)'
].join(',');
const localTemplateInternalSelect = [
  'owner_id',
  'business_id',
  localTemplatePublicSelect
].join(',');
const localOperatorCardSelect = [
  'id',
  'owner_id',
  'business_id',
  'guest_profile_id',
  'template_id',
  'card_instance_number',
  'customer_code',
  'status',
  'stamp_count',
  'streak_count',
  'vip_status',
  'pass_serial_number',
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
  'created_at',
  'updated_at',
  `card_templates(${localTemplateInternalSelect})`
].join(',');

async function loadPdfImageFromFile(filePath) {
  try {
    return loadPdfImageFromBuffer(await fs.readFile(filePath));
  } catch (error) {
    console.warn(`PDF-Bild konnte nicht geladen werden: ${filePath}`, error.message);
    return null;
  }
}

function templateBusinessLogoUrl(template = {}) {
  const business = Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;

  return String(
    business?.logo_url
      || business?.company_logo_url
      || template.business_logo_url
      || template.company_logo_url
      || template.logo_url
      || ''
  ).trim();
}

function templateBusinessName(template = {}) {
  const business = Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;

  return String(
    business?.name
      || business?.company_name
      || template.business_name
      || 'Mein Unternehmen'
  ).trim() || 'Mein Unternehmen';
}

function appAssetPathFromUrl(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue.startsWith('/')) {
    return '';
  }

  const cleanPath = rawValue.replace(/^\/+/, '');

  if (!cleanPath.startsWith('assets/')) {
    return '';
  }

  return path.join(publicDir, cleanPath);
}

async function loadPdfImageFromUrl(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return null;
  }

  const localAssetPath = appAssetPathFromUrl(rawValue);
  if (localAssetPath) {
    return loadPdfImageFromFile(localAssetPath);
  }

  if (rawValue.startsWith('data:image/')) {
    const [, dataPart = ''] = rawValue.split(',', 2);
    const isBase64 = rawValue.slice(0, rawValue.indexOf(',')).includes(';base64');
    const buffer = Buffer.from(isBase64 ? dataPart : decodeURIComponent(dataPart), isBase64 ? 'base64' : 'utf8');
    return loadPdfImageFromBuffer(buffer);
  }

  let url;
  try {
    url = new URL(rawValue);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const contentLength = Number(response.headers.get('content-length') || 0);

    if (!response.ok || contentLength > 4 * 1024 * 1024) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 4 * 1024 * 1024) {
      return null;
    }

    return loadPdfImageFromBuffer(Buffer.from(arrayBuffer));
  } catch (error) {
    console.warn(`PDF-Logo konnte nicht geladen werden: ${url.origin}`, error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function loadPdfBrandLogo() {
  if (!pdfBrandLogoPromise) {
    pdfBrandLogoPromise = loadPdfImageFromFile(pdfBrandLogoPath);
  }

  return pdfBrandLogoPromise;
}

async function loadTemplatePdfAssets(template = {}) {
  const [brandLogo, businessLogo] = await Promise.all([
    loadPdfBrandLogo(),
    loadPdfImageFromUrl(templateBusinessLogoUrl(template))
  ]);

  return {
    brandLogo,
    businessLogo
  };
}

function jsonError(res, error) {
  const statusCode = error.statusCode || 500;
  const payload = {
    error: error.message || 'Unbekannter Fehler'
  };

  if (error.error_code) {
    payload.error_code = error.error_code;
  }

  if (error.error_message) {
    payload.error_message = error.error_message;
  }

  if (error.error_reason) {
    payload.error_reason = error.error_reason;
  }

  res.status(statusCode).json(payload);
}

function generateCustomerCode() {
  return `WC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function generateCardInstanceNumber() {
  return `CI-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function generateSerialNumber() {
  return `serial-${crypto.randomUUID()}`;
}

function generateWalletAuthenticationToken() {
  return crypto.randomBytes(24).toString('hex');
}

function claimToken(value) {
  const token = String(value || '').trim().toLowerCase();

  return /^[a-f0-9]{36}$/.test(token) ? token : '';
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function claimUrlForTemplate(template, baseUrl) {
  const token = claimToken(template?.public_claim_token);
  const path = token
    ? `/claim.html?token=${encodeURIComponent(token)}`
    : `/claim.html?template=${encodeURIComponent(template.id)}`;

  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function selectPublicTemplateByClaimKey(key, selectColumns = localTemplatePublicSelect) {
  const value = String(key || '').trim();
  const token = claimToken(value);
  const query = supabaseAdmin
    .from('card_templates')
    .select(selectColumns)
    .eq('is_active', true);

  return token && !isUuid(value)
    ? await query.eq('public_claim_token', token).single()
    : await query.eq('id', value).single();
}

function createStructuredError(statusCode, errorCode, message, reason) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.error_code = errorCode;
  error.error_message = message;
  error.error_reason = reason;
  return error;
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function firstHeaderValue(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)[0] || '';
}

function localPublicRateLimitSubject(req, routeKey) {
  const forwardedIp = firstHeaderValue(
    req.headers['cf-connecting-ip']
      || req.headers['x-real-ip']
      || req.headers['x-forwarded-for']
      || req.socket?.remoteAddress
      || 'unknown'
  );
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 220);
  const language = String(req.headers['accept-language'] || '').slice(0, 80);

  return crypto
    .createHash('sha256')
    .update([routeKey, forwardedIp, userAgent, language].join('|'))
    .digest('hex');
}

function enforceLocalPublicClaimRateLimit(req, routeKey, options = {}) {
  const deliveryRules = config.deliveryRules || {};
  const limit = positiveInteger(options.limit, positiveInteger(deliveryRules.publicClaimRateLimit, 80));
  const windowSeconds = positiveInteger(options.windowSeconds, positiveInteger(deliveryRules.publicClaimRateLimitWindowSeconds, 900));
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucketKey = `${routeKey}:${localPublicRateLimitSubject(req, routeKey)}`;
  const existing = localPublicRateLimitBuckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    localPublicRateLimitBuckets.set(bucketKey, {
      count: 1,
      resetAt: now + windowMs,
      lastRequestAt: now
    });
    return;
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    throw createStructuredError(
      429,
      'PUBLIC_CLAIM_RATE_LIMITED',
      'Zu viele Anfragen.',
      `Bitte warte ${retryAfterSeconds} Sekunden und versuche es danach erneut.`
    );
  }

  existing.count += 1;
  existing.lastRequestAt = now;

  if (localPublicRateLimitBuckets.size > 1000) {
    for (const [key, bucket] of localPublicRateLimitBuckets.entries()) {
      if (bucket.resetAt <= now) {
        localPublicRateLimitBuckets.delete(key);
      }
    }
  }
}

function validateWalletObjectId(walletObjectId, reason = 'Die öffentliche Claim-Seite muss einen stabilen walletObjectId senden, damit lokale Fallback-Claims idempotent bleiben.') {
  if (!walletObjectId) {
    throw createStructuredError(
      400,
      'CLAIM_WALLET_OBJECT_ID_REQUIRED',
      'Claim-Schlüssel fehlt.',
      reason
    );
  }

  if (walletObjectId.length > CLAIM_WALLET_OBJECT_ID_MAX_LENGTH || !CLAIM_WALLET_OBJECT_ID_PATTERN.test(walletObjectId)) {
    throw createStructuredError(
      400,
      'CLAIM_WALLET_OBJECT_ID_INVALID',
      'Claim-Schlüssel ist ungültig.',
      'walletObjectId darf maximal 180 Zeichen enthalten und nur Buchstaben, Zahlen, Punkt, Unterstrich, Bindestrich oder Doppelpunkt nutzen.'
    );
  }
}

const cloakroomReminderTimeZone = 'Europe/Zurich';

function zonedDateParts(date, timeZone = cloakroomReminderTimeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second)
  };
}

function zonedDateTimeToUtc(year, month, day, hour, minute, second, timeZone = cloakroomReminderTimeZone) {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = new Date(targetAsUtc);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedDateParts(result, timeZone);
    const actualAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = actualAsUtc - targetAsUtc;
    const next = new Date(result.getTime() - delta);

    if (Math.abs(next.getTime() - result.getTime()) < 1000) {
      return next;
    }

    result = next;
  }

  return result;
}

function nextNoonAfter(value) {
  const baseDate = value ? new Date(value) : new Date();

  if (Number.isNaN(baseDate.getTime())) {
    return null;
  }

  const local = zonedDateParts(baseDate);
  let noon = zonedDateTimeToUtc(local.year, local.month, local.day, 12, 0, 0);

  if (noon <= baseDate) {
    noon = zonedDateTimeToUtc(local.year, local.month, local.day + 1, 12, 0, 0);
  }

  return noon.toISOString();
}

function textValue(value) {
  return value == null ? '' : String(value).trim();
}

function metadataFromCard(card) {
  return card?.metadata && typeof card.metadata === 'object' ? card.metadata : {};
}

function zurichDateKey(value) {
  const date = new Date(value);
  const parts = zonedDateParts(date);
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');

  return `${parts.year}-${month}-${day}`;
}

function normalizedLocationNumber(value, decimals = 6) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return null;
  }

  return Number(numberValue.toFixed(decimals));
}

async function maybeScheduleLocalCloakroomNoonReminder(card, template, cardInstance, userId) {
  const metadata = metadataFromCard(card);
  const cloakroomActive = Boolean(card.cloakroom_active ?? metadata.cloakroom_active);

  if (!cloakroomActive || !card.business_id || !cardInstance?.id || !featureEnabled(template, 'cloakroom')) {
    return {
      scheduled: false,
      reason: 'cloakroom_not_active'
    };
  }

  const scheduledAt = textValue(metadata.cloakroom_noon_reminder_at);
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;

  if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
    return {
      scheduled: false,
      reason: 'cloakroom_noon_reminder_at_missing'
    };
  }

  const message = textValue(metadata.cloakroom_noon_message)
    || 'Deine Garderobe ist noch hinterlegt. Bitte prüfe die Abholung.';
  const idempotencyKey = `cloakroom-noon:${card.id}:${zurichDateKey(scheduledDate.toISOString())}`;
  const { data: existingCampaign, error: existingError } = await supabaseAdmin
    .from('wallet_notification_campaigns')
    .select('id,status,scheduled_at')
    .eq('owner_id', card.owner_id)
    .eq('business_id', card.business_id)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  let campaign = existingCampaign;

  if (!campaign) {
    const { data: insertedCampaign, error: insertError } = await supabaseAdmin
      .from('wallet_notification_campaigns')
      .insert({
        owner_id: card.owner_id,
        business_id: card.business_id,
        template_id: card.template_id,
        title: 'Garderoben-Erinnerung',
        message,
        target_type: 'cloakroom_open',
        target_filter: {},
        send_type: 'scheduled',
        scheduled_at: scheduledDate.toISOString(),
        status: 'scheduled',
        idempotency_key: idempotencyKey,
        created_by: userId
      })
      .select('id,status,scheduled_at')
      .single();

    if (insertError) {
      throw insertError;
    }

    campaign = insertedCampaign;
  }

  const { error: recipientError } = await supabaseAdmin
    .from('wallet_notification_recipients')
    .upsert({
      owner_id: card.owner_id,
      business_id: card.business_id,
      campaign_id: campaign.id,
      card_instance_id: cardInstance.id,
      wallet_platform: cardInstance.wallet_platform || card.wallet_platform || 'apple',
      status: 'pending'
    }, {
      onConflict: 'campaign_id,card_instance_id,wallet_platform',
      ignoreDuplicates: true
    });

  if (recipientError) {
    throw recipientError;
  }

  return {
    scheduled: true,
    reused: Boolean(existingCampaign),
    campaign_id: campaign.id,
    scheduled_at: campaign.scheduled_at,
    time_zone: cloakroomReminderTimeZone
  };
}

async function maybeScheduleLocalCloakroomLocationReminder(card, template, cardInstance, userId) {
  const metadata = metadataFromCard(card);
  const cloakroomActive = Boolean(card.cloakroom_active ?? metadata.cloakroom_active);

  if (!cloakroomActive || !card.business_id || !cardInstance?.id || !featureEnabled(template, 'cloakroom')) {
    return {
      scheduled: false,
      reason: 'cloakroom_not_active'
    };
  }

  const lat = normalizedLocationNumber(metadata.cloakroom_location_latitude);
  const lng = normalizedLocationNumber(metadata.cloakroom_location_longitude);
  const radius = Math.round(Number(metadata.cloakroom_location_radius_meters || 0));

  if (lat == null || lng == null || !Number.isInteger(radius) || radius < 50 || radius > 100000) {
    return {
      scheduled: false,
      reason: 'cloakroom_location_missing'
    };
  }

  const message = textValue(metadata.cloakroom_location_message)
    || 'Du bist wieder in der Nähe. Deine Garderobe kann abgeholt werden.';
  const title = textValue(metadata.cloakroom_location_name)
    ? `Garderobe bei ${metadata.cloakroom_location_name}`
    : 'Garderobe in der Nähe';
  const startedAt = textValue(metadata.cloakroom_started_at || card.cloakroom_started_at || new Date().toISOString());
  const startedAtDate = new Date(startedAt);
  const startedAtKey = Number.isNaN(startedAtDate.getTime()) ? 'unknown' : String(startedAtDate.getTime());
  const idempotencyKey = `cloakroom-location:${card.id}:${startedAtKey}`;
  const { data: existingCampaign, error: existingError } = await supabaseAdmin
    .from('wallet_notification_campaigns')
    .select('id,status,location_lat,location_lng,location_radius_m')
    .eq('owner_id', card.owner_id)
    .eq('business_id', card.business_id)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  let campaign = existingCampaign;

  if (!campaign) {
    const { data: insertedCampaign, error: insertError } = await supabaseAdmin
      .from('wallet_notification_campaigns')
      .insert({
        owner_id: card.owner_id,
        business_id: card.business_id,
        template_id: card.template_id,
        title,
        message,
        target_type: 'cloakroom_open',
        target_filter: {},
        send_type: 'location_based',
        scheduled_at: null,
        location_lat: lat,
        location_lng: lng,
        location_radius_m: radius,
        status: 'scheduled',
        idempotency_key: idempotencyKey,
        created_by: userId
      })
      .select('id,status,location_lat,location_lng,location_radius_m')
      .single();

    if (insertError) {
      throw insertError;
    }

    campaign = insertedCampaign;
  }

  const { error: recipientError } = await supabaseAdmin
    .from('wallet_notification_recipients')
    .upsert({
      owner_id: card.owner_id,
      business_id: card.business_id,
      campaign_id: campaign.id,
      card_instance_id: cardInstance.id,
      wallet_platform: cardInstance.wallet_platform || card.wallet_platform || 'apple',
      status: 'pending'
    }, {
      onConflict: 'campaign_id,card_instance_id,wallet_platform',
      ignoreDuplicates: true
    });

  if (recipientError) {
    throw recipientError;
  }

  return {
    scheduled: true,
    reused: Boolean(existingCampaign),
    campaign_id: campaign.id,
    location_lat: campaign.location_lat,
    location_lng: campaign.location_lng,
    location_radius_m: campaign.location_radius_m
  };
}

async function requireAuthenticatedOperator(req) {
  requireSupabaseAdmin(supabaseAdmin);

  const authHeader = req.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    throw createStructuredError(
      401,
      'AUTH_REQUIRED',
      'Bitte erneut einloggen.',
      'Der Scanner-Endpunkt hat keinen gültigen Login-Token erhalten.'
    );
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

  if (userError || !userData?.user) {
    throw createStructuredError(
      401,
      'AUTH_INVALID',
      'Bitte erneut einloggen.',
      'Der Login-Token konnte nicht verifiziert werden.'
    );
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('operator_profiles')
    .select('id, unlock')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile?.unlock) {
    throw createStructuredError(
      403,
      'OPERATOR_LOCKED',
      'Account nicht freigeschaltet.',
      'Scanner-Aktionen sind nur für freigeschaltete Betreiber erlaubt.'
    );
  }

  return userData.user;
}

function activeClubFeaturesSnapshot(template) {
  if (normalizeTemplateType(template) !== 'club_card') {
    return {};
  }

  return {
    vip: featureEnabled(template, 'vip'),
    balance: featureEnabled(template, 'balance'),
    cloakroom: featureEnabled(template, 'cloakroom'),
    coupon: featureEnabled(template, 'redemption'),
    membership: featureEnabled(template, 'membership')
  };
}

function normalizeDemographics(input) {
  const source = input && typeof input === 'object' ? input : {};
  const gender = String(source.gender || source.customer_gender || '').trim();
  const ageGroup = String(source.age_group || source.ageGroup || source.customer_age_group || '').trim();

  if (!gender && !ageGroup) {
    return null;
  }

  if (!demographicGenders.has(gender)) {
    throw createStructuredError(
      400,
      'INVALID_DEMOGRAPHICS_GENDER',
      'Geschlecht ist ungültig.',
      'Erlaubt sind male oder female.'
    );
  }

  if (!demographicAgeGroups.has(ageGroup)) {
    throw createStructuredError(
      400,
      'INVALID_DEMOGRAPHICS_AGE_GROUP',
      'Altersgruppe ist ungültig.',
      'Erlaubt sind 18_plus, 25_plus oder 30_plus.'
    );
  }

  return { gender, age_group: ageGroup };
}

function scanTimeParts(isoTimestamp) {
  const date = new Date(isoTimestamp);
  const weekday = date.getUTCDay();

  return {
    scan_hour: date.getUTCHours(),
    scan_weekday: weekday === 0 ? 7 : weekday
  };
}

function scannerActionLabel(action) {
  const labels = {
    manual_update: 'Manuell gespeichert',
    visit: 'Besuch erfasst',
    'vip-update': 'VIP-Aktion',
    'vip-benefit-redeem': 'VIP-Vorteil eingelöst',
    'balance-redeem': 'Guthaben-Aktion',
    'balance-adjust': 'Guthaben korrigiert',
    'cloakroom-toggle': 'Garderobenaktion',
    redeem: 'Coupon eingelöst',
    'membership-check': 'Mitgliedschaft geprüft',
    'membership-status-update': 'Mitgliedschaft aktualisiert',
    'membership-extend': 'Mitgliedschaft verlängert',
    checkin: 'Event Check-in',
    'event-checkout': 'Event Check-out',
    'event-ticket-use': 'Ticket verwendet'
  };

  return SCANNER_ACTIONS[action]?.label || labels[action] || action;
}

function scannerValidationError(validation, template) {
  if (
    normalizeTemplateType(template) === 'club_card'
    && validation?.error_code === 'FEATURE_NOT_ENABLED'
  ) {
    return createStructuredError(
      403,
      'CLUB_FEATURE_NOT_ENABLED',
      'Diese Funktion ist für diese Clubkarte nicht aktiviert.',
      'Das benötigte Clubkarten-Modul ist deaktiviert.'
    );
  }

  return createStructuredError(
    403,
    validation.error_code,
    validation.error_message,
    validation.error_reason
  );
}

async function loadLocalCardInstanceForScan(card) {
  const { data, error } = await supabaseAdmin
    .from('card_instances')
    .select([
      'id',
      'customer_card_id',
      'owner_id',
      'business_id',
      'template_id',
      'card_instance_number',
      'wallet_platform',
      'demographics_collected',
      'customer_gender',
      'customer_age_group',
      'demographics_collected_at',
      'demographics_collected_by',
      'first_scanned_at',
      'last_scanned_at',
      'scan_count',
      'resolved_emblem_key',
      'resolved_emblem_url',
      'emblem_updated_at',
      'updated_at'
    ].join(','))
    .eq('customer_card_id', card.id)
    .maybeSingle();

  if (error) {
    throw createStructuredError(
      500,
      'SCANNER_CARD_INSTANCE_LOAD_FAILED',
      'Karteninstanz konnte nicht geladen werden.',
      error.message || 'card_instances.select hat einen Fehler zurückgegeben.'
    );
  }

  if (!data) {
    throw createStructuredError(
      409,
      'SCANNER_CARD_INSTANCE_MISSING',
      'Karteninstanz fehlt.',
      'Bitte führe das aktuelle Supabase-Schema aus, damit vorhandene Kundenkarten als card_instances gespiegelt werden.'
    );
  }

  return data;
}

async function getGuestProfileForScan(card) {
  const { data, error } = await supabaseAdmin.rpc('get_guest_profile_for_scan', {
    p_customer_card_id: card.id
  });

  if (error) {
    throw createStructuredError(
      500,
      'SCANNER_GUEST_PROFILE_LOAD_FAILED',
      'Gastprofil konnte nicht geladen werden.',
      error.message || 'get_guest_profile_for_scan hat einen Fehler zurueckgegeben.'
    );
  }

  if (!data) {
    if (!card.business_id) {
      return null;
    }

    throw createStructuredError(
      409,
      'SCANNER_GUEST_PROFILE_MISSING',
      'Gastprofil fehlt.',
      'Bitte fuehre die Guest-Profile-Migration aus, damit die Karte sicher zugeordnet wird.'
    );
  }

  return publicOperatorGuestProfile(data);
}

function isMissingWalletEmblemColumn(error) {
  const message = String(error?.message || error?.details || '');

  return error?.code === '42703'
    && Array.from(walletEmblemColumnNames).some((columnName) => message.includes(columnName));
}

function resolvedEmblemFieldsForInstance(nextInstance = {}, now = new Date().toISOString(), previousInstance = {}) {
  const resolvedEmblemKey = resolveCardEmblem(nextInstance);
  const resolvedEmblemUrl = supabaseCardEmblemUrl(
    {
      ...nextInstance,
      resolved_emblem_url: null
    },
    config.supabase?.url || ''
  );
  const previousEmblemKey = previousInstance?.resolved_emblem_key || resolveCardEmblem({
    demographics_collected: previousInstance?.demographics_collected,
    customer_gender: previousInstance?.customer_gender
  });
  const emblemChanged = previousEmblemKey !== resolvedEmblemKey;

  return {
    previous_emblem_key: previousEmblemKey,
    resolved_emblem_key: resolvedEmblemKey,
    resolved_emblem_url: resolvedEmblemUrl,
    emblem_updated_at: emblemChanged || !previousInstance?.emblem_updated_at
      ? now
      : previousInstance.emblem_updated_at,
    emblem_changed: emblemChanged
  };
}

function demographicsRequiredPayload(card, instance, template, action) {
  return {
    ok: false,
    requires_demographics: true,
    card_instance_id: instance.id,
    customer_card_id: card.id,
    template_type: normalizeTemplateType(template),
    active_club_features: activeClubFeaturesSnapshot(template),
    club_features: activeClubFeaturesSnapshot(template),
    pending_action: action,
    message: 'Bitte zuerst Geschlecht und Altersgruppe erfassen.'
  };
}

function validateManualScannerUpdates(template, updates) {
  const checks = [
    ['stamp_count', 'stamps', 'Diese Karte unterstützt keine Stempel-Funktion.'],
    ['streak_count', 'streak', 'Diese Karte unterstützt keine Streak-Funktion.'],
    ['vip_status', 'vip', 'Diese Karte unterstützt keine VIP-Funktion.'],
    ['balance_cents', 'balance', 'Diese Karte unterstützt keine Guthaben-Funktion.'],
    ['currency', 'balance', 'Diese Karte unterstützt keine Guthaben-Funktion.']
  ];

  for (const [fieldName, featureName, reason] of checks) {
    if (Object.hasOwn(updates, fieldName) && !featureEnabled(template, featureName)) {
      throw createStructuredError(
        403,
        'ACTION_NOT_ALLOWED_FOR_TEMPLATE',
        'Aktion nicht erlaubt für diesen Kartentyp.',
        reason
      );
    }
  }
}

function normalizeScannerUpdates(input = {}) {
  const updates = {};

  if (Object.hasOwn(input, 'status')) {
    const status = String(input.status || 'active');

    if (!['active', 'paused', 'redeemed', 'blocked'].includes(status)) {
      throw createStructuredError(
        400,
        'INVALID_CARD_STATUS',
        'Ungültiger Kartenstatus.',
        'Erlaubt sind active, paused, redeemed und blocked.'
      );
    }

    updates.status = status;
  }

  if (Object.hasOwn(input, 'stamp_count')) {
    updates.stamp_count = Math.max(0, Number(input.stamp_count || 0));
  }

  if (Object.hasOwn(input, 'streak_count')) {
    updates.streak_count = Math.max(0, Number(input.streak_count || 0));
  }

  if (Object.hasOwn(input, 'vip_status')) {
    updates.vip_status = input.vip_status ? String(input.vip_status) : null;
  }

  if (Object.hasOwn(input, 'balance_cents')) {
    const balanceCents = Math.round(Number(input.balance_cents || 0));

    if (!Number.isFinite(balanceCents) || balanceCents < 0) {
      throw createStructuredError(
        400,
        'INVALID_BALANCE',
        'Ungültiges Guthaben.',
        'Das Guthaben muss als positive Zahl in Rappen/Cents gespeichert werden.'
      );
    }

    updates.balance_cents = balanceCents;
  }

  if (Object.hasOwn(input, 'currency')) {
    const currency = String(input.currency || 'CHF').trim().toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
      throw createStructuredError(
        400,
        'INVALID_CURRENCY',
        'Ungültige Währung.',
        'Bitte verwende einen ISO-Code mit drei Buchstaben, z. B. CHF oder EUR.'
      );
    }

    updates.currency = currency;
  }

  return updates;
}

async function syncLocalCardInstance(updatedCard, template, now, scanContext = {}) {
  const walletSerialNumber = updatedCard.wallet_platform === 'google'
    ? updatedCard.wallet_object_id || updatedCard.wallet_serial_number || updatedCard.pass_serial_number
    : updatedCard.pass_serial_number;
  const metadata = updatedCard.metadata && typeof updatedCard.metadata === 'object'
    ? updatedCard.metadata
    : {};
  let instance = scanContext.instance || null;

  if (!instance) {
    instance = await loadLocalCardInstanceForScan(updatedCard);
  }

  const existingInstance = instance;
  const demographics = scanContext.demographics || null;
  const demographicsAlreadyCollected = Boolean(existingInstance?.demographics_collected);
  const demographicsWereCollected = Boolean(!demographicsAlreadyCollected && demographics);
  const firstScannedAt = existingInstance?.first_scanned_at || now;
  const scanCount = Math.max(0, Number(existingInstance?.scan_count || 0)) + 1;
  const customerGender = demographicsAlreadyCollected
    ? existingInstance.customer_gender
    : demographics?.gender || existingInstance?.customer_gender || null;
  const customerAgeGroup = demographicsAlreadyCollected
    ? existingInstance.customer_age_group
    : demographics?.age_group || existingInstance?.customer_age_group || null;
  const resolvedEmblem = resolvedEmblemFieldsForInstance({
    ...existingInstance,
    demographics_collected: demographicsAlreadyCollected || demographicsWereCollected,
    customer_gender: customerGender
  }, now, existingInstance);
  const instancePayload = {
    current_streak: updatedCard.streak_count || 0,
    current_stamps: updatedCard.stamp_count || 0,
    vip_level: updatedCard.vip_status,
    vip_benefits_used: Array.isArray(metadata.vip_benefits_used) ? metadata.vip_benefits_used : [],
    balance_cents: updatedCard.balance_cents ?? updatedCard.metadata?.balance_cents ?? 0,
    currency: updatedCard.currency || template.settings?.currency || 'CHF',
    cloakroom_active: Boolean(updatedCard.cloakroom_active ?? updatedCard.metadata?.cloakroom_active),
    cloakroom_started_at: updatedCard.cloakroom_started_at || updatedCard.metadata?.cloakroom_started_at || null,
    cloakroom_completed_at: updatedCard.cloakroom_completed_at || updatedCard.metadata?.cloakroom_completed_at || null,
    coupon_status: metadata.coupon_status || (featureEnabled(template, 'redemption') && updatedCard.status === 'redeemed' ? 'redeemed' : 'unused'),
    coupon_redeemed_at: metadata.coupon_redeemed_at || null,
    membership_number: metadata.membership_number || null,
    membership_status: metadata.membership_status || 'active',
    membership_started_at: metadata.membership_started_at || null,
    membership_expires_at: metadata.membership_expires_at || null,
    demographics_collected: demographicsAlreadyCollected || demographicsWereCollected,
    customer_gender: customerGender,
    customer_age_group: customerAgeGroup,
    demographics_collected_at: demographicsAlreadyCollected
      ? existingInstance.demographics_collected_at
      : demographicsWereCollected ? now : existingInstance?.demographics_collected_at || null,
    demographics_collected_by: demographicsAlreadyCollected
      ? existingInstance.demographics_collected_by
      : demographicsWereCollected ? scanContext.userId || null : existingInstance?.demographics_collected_by || null,
    first_scanned_at: firstScannedAt,
    last_scanned_at: now,
    scan_count: scanCount,
    wallet_serial_number: walletSerialNumber,
    resolved_emblem_key: resolvedEmblem.resolved_emblem_key,
    resolved_emblem_url: resolvedEmblem.resolved_emblem_url,
    emblem_updated_at: resolvedEmblem.emblem_updated_at
  };
  const cardInstanceId = instance.id || updatedCard.id;

  const updateSelectColumns = [
    'id',
    'card_instance_number',
    'demographics_collected',
    'customer_gender',
    'customer_age_group',
    'demographics_collected_at',
    'demographics_collected_by',
    'resolved_emblem_key',
    'resolved_emblem_url',
    'emblem_updated_at',
    'first_scanned_at',
    'last_scanned_at',
    'scan_count'
  ];
  let { data: updatedInstance, error: updateInstanceError } = await supabaseAdmin
    .from('card_instances')
    .update(instancePayload)
    .eq('id', cardInstanceId)
    .eq('customer_card_id', updatedCard.id)
    .select(updateSelectColumns.join(','))
    .maybeSingle();

  if (isMissingWalletEmblemColumn(updateInstanceError)) {
    const fallbackPayload = { ...instancePayload };

    for (const columnName of walletEmblemColumnNames) {
      delete fallbackPayload[columnName];
    }

    const fallbackResult = await supabaseAdmin
      .from('card_instances')
      .update(fallbackPayload)
      .eq('id', cardInstanceId)
      .eq('customer_card_id', updatedCard.id)
      .select(updateSelectColumns.filter((columnName) => !walletEmblemColumnNames.has(columnName)).join(','))
      .maybeSingle();

    updatedInstance = fallbackResult.data;
    updateInstanceError = fallbackResult.error;
  }

  if (updateInstanceError || !updatedInstance) {
    throw createStructuredError(
      500,
      'SCANNER_CARD_INSTANCE_SYNC_FAILED',
      'Karteninstanz konnte nicht synchronisiert werden.',
      updateInstanceError?.message || 'card_instances.update hat keine passende Karteninstanz aktualisiert.'
    );
  }

  return {
    id: updatedInstance.id,
    card_instance_number: updatedInstance.card_instance_number || instance.card_instance_number || updatedCard.card_instance_number,
    demographics_collected: Boolean(updatedInstance.demographics_collected),
    customer_gender: updatedInstance.customer_gender,
    customer_age_group: updatedInstance.customer_age_group,
    demographics_collected_at: updatedInstance.demographics_collected_at,
    demographics_collected_by: updatedInstance.demographics_collected_by,
    first_scanned_at: updatedInstance.first_scanned_at,
    last_scanned_at: updatedInstance.last_scanned_at,
    scan_count: Number(updatedInstance.scan_count || scanCount),
    resolved_emblem_key: updatedInstance.resolved_emblem_key || resolvedEmblem.resolved_emblem_key,
    resolved_emblem_url: updatedInstance.resolved_emblem_url || resolvedEmblem.resolved_emblem_url,
    emblem_updated_at: updatedInstance.emblem_updated_at || resolvedEmblem.emblem_updated_at,
    previous_emblem_key: resolvedEmblem.previous_emblem_key,
    emblem_changed: resolvedEmblem.emblem_changed,
    is_first_scan: !existingInstance?.first_scanned_at,
    demographics_were_collected: demographicsWereCollected
  };
}

async function recordLocalWalletEmblemUpdate(card, cardInstance, reason = 'scanner_demographics') {
  const walletPlatform = card?.wallet_platform;
  const shouldQueueWalletUpdate = Boolean(
    cardInstance?.emblem_changed
      && card?.business_id
      && cardInstance?.id
      && ['apple', 'google'].includes(walletPlatform)
  );
  let updateQueued = false;
  let updateError = null;

  if (shouldQueueWalletUpdate) {
    const { error } = await supabaseAdmin
      .from('wallet_update_queue')
      .insert({
        owner_id: card.owner_id,
        business_id: card.business_id,
        card_instance_id: cardInstance.id,
        wallet_platform: walletPlatform,
        update_type: 'emblem_update',
        payload: {
          source: 'scanner_demographics',
          reason,
          customer_card_id: card.id,
          card_instance_number: cardInstance.card_instance_number || card.card_instance_number,
          previous_emblem_key: cardInstance.previous_emblem_key,
          resolved_emblem_key: cardInstance.resolved_emblem_key,
          resolved_emblem_url: cardInstance.resolved_emblem_url,
          customer_gender: cardInstance.customer_gender,
          demographics_collected: cardInstance.demographics_collected
        }
      });

    if (error) {
      updateError = error.message || 'wallet_update_queue.insert fehlgeschlagen.';
      console.warn('Wallet-Emblem-Update konnte nicht in die Queue gelegt werden:', updateError);
    } else {
      updateQueued = true;
    }
  }

  if (cardInstance?.emblem_changed || cardInstance?.demographics_were_collected) {
    const { error } = await supabaseAdmin
      .from('wallet_emblem_update_logs')
      .insert({
        owner_id: card.owner_id,
        business_id: card.business_id,
        card_instance_id: cardInstance.id,
        customer_card_id: card.id,
        wallet_platform: walletPlatform || 'unknown',
        previous_emblem_key: cardInstance.previous_emblem_key,
        resolved_emblem_key: cardInstance.resolved_emblem_key,
        resolved_emblem_url: cardInstance.resolved_emblem_url,
        reason,
        update_queued: updateQueued,
        update_error: updateError
      });

    if (error) {
      console.warn('Wallet-Emblem-Log konnte nicht gespeichert werden:', error.message || error);
    }
  }

  return {
    changed: Boolean(cardInstance?.emblem_changed),
    queued: updateQueued,
    error: updateError,
    resolved_emblem_key: cardInstance?.resolved_emblem_key || null,
    resolved_emblem_url: cardInstance?.resolved_emblem_url || null
  };
}

async function insertLocalScannerBalanceTransaction(payload) {
  const { error } = await supabaseAdmin.from('balance_transactions').insert(payload);

  if (error) {
    throw createStructuredError(
      500,
      'SCANNER_BALANCE_TRANSACTION_SAVE_FAILED',
      'Guthaben-Transaktion konnte nicht gespeichert werden.',
      error.message || 'balance_transactions.insert hat einen Fehler zurückgegeben.'
    );
  }
}

async function insertLocalScannerEvent(payload) {
  const { error } = await supabaseAdmin.from('card_events').insert(payload);

  if (error) {
    throw createStructuredError(
      500,
      'SCANNER_CARD_EVENT_SAVE_FAILED',
      'Scanner-Ereignis konnte nicht gespeichert werden.',
      error.message || 'card_events.insert hat einen Fehler zurückgegeben.'
    );
  }
}

async function insertLocalScanEvent(payload) {
  const { data, error } = await supabaseAdmin
    .from('scan_events')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    throw createStructuredError(
      500,
      'SCANNER_SCAN_EVENT_SAVE_FAILED',
      'Scan-Statistik konnte nicht gespeichert werden.',
      error.message || 'scan_events.insert hat einen Fehler zurückgegeben.'
    );
  }

  return data.id;
}

function clubActionForScannerAction(action, beforeCard, afterUpdates) {
  const metadataAfter = afterUpdates.metadata && typeof afterUpdates.metadata === 'object'
    ? afterUpdates.metadata
    : {};

  if (action === 'vip-update') {
    return ['vip', 'update_vip_level'];
  }

  if (action === 'vip-benefit-redeem') {
    return ['vip', 'redeem_vip_benefit'];
  }

  if (action === 'balance-redeem') {
    return ['balance', 'redeem_balance'];
  }

  if (action === 'balance-adjust') {
    return ['balance', 'adjust_balance'];
  }

  if (action === 'cloakroom-toggle') {
    const wasActive = Boolean(beforeCard.cloakroom_active ?? beforeCard.metadata?.cloakroom_active);
    return ['cloakroom', wasActive ? 'cloakroom_pickup' : 'cloakroom_dropoff'];
  }

  if (action === 'redeem') {
    return ['coupon', 'redeem_coupon'];
  }

  if (action === 'membership-check') {
    return ['membership', 'check_membership'];
  }

  if (action === 'membership-status-update') {
    return ['membership', 'update_membership_status'];
  }

  if (action === 'membership-extend') {
    return ['membership', 'extend_membership'];
  }

  if (metadataAfter.last_matrix_action === 'membership-check') {
    return ['membership', 'check_membership'];
  }

  return null;
}

async function insertLocalClubCardAction(payload) {
  const { error } = await supabaseAdmin.from('club_card_actions').insert(payload);

  if (error) {
    throw createStructuredError(
      500,
      'SCANNER_CLUB_ACTION_SAVE_FAILED',
      'Clubkarten-Aktion konnte nicht gespeichert werden.',
      error.message || 'club_card_actions.insert hat einen Fehler zurückgegeben.'
    );
  }
}

function dateOnly(value) {
  const text = String(value || '').trim();

  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function numberOrNull(value) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeStatsFilters(input = {}) {
  return {
    business_id: String(input.business_id || input.businessId || '').trim() || null,
    date_from: dateOnly(input.date_from || input.dateFrom),
    date_to: dateOnly(input.date_to || input.dateTo),
    template_type: String(input.template_type || input.templateType || 'all').trim() || 'all',
    club_feature: String(input.club_feature || input.clubFeature || 'all').trim() || 'all',
    gender: String(input.gender || 'all').trim() || 'all',
    age_group: String(input.age_group || input.ageGroup || 'all').trim() || 'all',
    scan_type: String(input.scan_type || input.scanType || 'all').trim() || 'all',
    action_type: String(input.action_type || input.actionType || 'all').trim() || 'all',
    hour_from: numberOrNull(input.hour_from ?? input.hourFrom),
    hour_to: numberOrNull(input.hour_to ?? input.hourTo)
  };
}

function activeClubFeatureList(features = {}) {
  return clubFeatureNames.filter((featureName) => Boolean(features?.[featureName]));
}

function matchesStatsFilters(row, filters) {
  if (filters.template_type !== 'all' && row.template_type !== filters.template_type) {
    return false;
  }

  if (filters.gender !== 'all' && row.customer_gender !== filters.gender) {
    return false;
  }

  if (filters.age_group !== 'all' && row.customer_age_group !== filters.age_group) {
    return false;
  }

  if (filters.scan_type === 'first_scan' && !row.is_first_scan) {
    return false;
  }

  if (filters.scan_type === 'repeat_scan' && row.is_first_scan) {
    return false;
  }

  if (filters.action_type !== 'all' && row.action_type !== filters.action_type) {
    return false;
  }

  if (filters.club_feature !== 'all') {
    const activeFeatures = activeClubFeatureList(row.active_club_features || {});

    if (row.template_type !== 'club_card') {
      return false;
    }

    if (filters.club_feature === 'multiple') {
      return activeFeatures.length > 1;
    }

    if (!activeFeatures.includes(filters.club_feature)) {
      return false;
    }
  }

  const scanHour = Number(row.scan_hour);

  if (filters.hour_from != null && scanHour < filters.hour_from) {
    return false;
  }

  if (filters.hour_to != null && scanHour >= filters.hour_to) {
    return false;
  }

  return true;
}

function countMap(rows, keyFn) {
  const counts = new Map();

  rows.forEach((row) => {
    const key = keyFn(row);

    if (key == null || key === '') {
      return;
    }

    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return counts;
}

function chartFromCounts(counts, labels = {}) {
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);

  return Array.from(counts.entries()).map(([key, value]) => ({
    key,
    label: labels[key] || String(key),
    value,
    percentage: total ? Math.round((value / total) * 1000) / 10 : 0
  }));
}

function fixedChart(keys, counts, labels = {}) {
  return keys.map((key) => ({
    key,
    label: labels[key] || String(key),
    value: counts.get(key) || 0
  }));
}

function weekdayHourHeatmap(rows, weekdayLabels = {}) {
  const counts = countMap(rows, (row) => `${row.scan_weekday}_${row.scan_hour}`);

  return [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => Array.from({ length: 24 }, (_, hour) => {
    const key = `${weekday}_${hour}`;

    return {
      key,
      weekday,
      weekday_label: weekdayLabels[weekday] || String(weekday),
      hour,
      hour_label: `${hour}:00`,
      label: `${weekdayLabels[weekday] || weekday} ${hour}:00`,
      value: counts.get(key) || 0
    };
  }));
}

function topKey(counts, labels = {}) {
  let top = null;
  let topValue = -1;

  counts.forEach((value, key) => {
    if (value > topValue) {
      top = key;
      topValue = value;
    }
  });

  return top == null ? null : labels[top] || top;
}

function buildBusinessScanStatistics(rows) {
  const genderLabels = { male: 'Männlich', female: 'Weiblich' };
  const ageLabels = { '18_plus': '18+', '25_plus': '25+', '30_plus': '30+' };
  const weekdayLabels = {
    1: 'Montag',
    2: 'Dienstag',
    3: 'Mittwoch',
    4: 'Donnerstag',
    5: 'Freitag',
    6: 'Samstag',
    7: 'Sonntag'
  };
  const hourLabels = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [index, `${index}:00`]));
  const templateLabels = {
    club_card: 'Clubkarte',
    stamp_card: 'Stempelkarte',
    streak_card: 'Streakkarte',
    vip_card: 'VIP-Karte',
    balance_card: 'Guthabenkarte',
    cloakroom_card: 'Garderobenkarte',
    coupon_card: 'Couponkarte',
    membership_card: 'Mitgliedskarte',
    event_card: 'Eventkarte',
    generic_card: 'Generische Karte'
  };
  const clubFeatureLabels = {
    vip: 'VIP',
    balance: 'Guthaben',
    cloakroom: 'Garderobe',
    coupon: 'Coupon',
    membership: 'Mitgliedschaft'
  };
  const totalScans = rows.length;
  const uniqueCardIds = new Set(rows.map((row) => row.card_instance_id || row.customer_card_id).filter(Boolean));
  const genderCounts = countMap(rows, (row) => row.customer_gender);
  const ageCounts = countMap(rows, (row) => row.customer_age_group);
  const hourCounts = countMap(rows, (row) => row.scan_hour);
  const weekdayCounts = countMap(rows, (row) => row.scan_weekday);
  const templateCounts = countMap(rows, (row) => row.template_type);
  const firstScans = rows.filter((row) => row.is_first_scan).length;
  const repeatScans = totalScans - firstScans;
  const clubRows = rows.filter((row) => row.template_type === 'club_card');
  const clubFeatureCounts = new Map();
  const clubCombinationCounts = new Map();

  clubRows.forEach((row) => {
    const features = activeClubFeatureList(row.active_club_features || {});
    features.forEach((featureName) => {
      clubFeatureCounts.set(featureName, (clubFeatureCounts.get(featureName) || 0) + 1);
    });
    const combination = features.length ? features.map((featureName) => clubFeatureLabels[featureName] || featureName).join(' + ') : 'Keine Module';
    clubCombinationCounts.set(combination, (clubCombinationCounts.get(combination) || 0) + 1);
  });

  const overTimeCounts = countMap(rows, (row) => String(row.scanned_at || '').slice(0, 10));
  const genderAgeCounts = countMap(rows, (row) => `${row.customer_gender || 'unknown'}_${row.customer_age_group || 'unknown'}`);
  const lastScanAt = rows[0]?.scanned_at || null;
  const maleCount = genderCounts.get('male') || 0;
  const femaleCount = genderCounts.get('female') || 0;

  return {
    kpis: {
      total_scans: totalScans,
      unique_cards: uniqueCardIds.size,
      first_scans: firstScans,
      repeat_scans: repeatScans,
      male_count: maleCount,
      female_count: femaleCount,
      male_percentage: totalScans ? Math.round((maleCount / totalScans) * 1000) / 10 : 0,
      female_percentage: totalScans ? Math.round((femaleCount / totalScans) * 1000) / 10 : 0,
      top_age_group: topKey(ageCounts, ageLabels),
      top_hour: topKey(hourCounts),
      top_weekday: topKey(weekdayCounts, weekdayLabels),
      top_template_type: topKey(templateCounts, templateLabels),
      top_club_feature: topKey(clubFeatureCounts, clubFeatureLabels),
      average_scans_per_card: uniqueCardIds.size ? Math.round((totalScans / uniqueCardIds.size) * 100) / 100 : 0,
      last_scan_at: lastScanAt,
      club_scans_total: clubRows.length,
      club_vip_scans: clubFeatureCounts.get('vip') || 0,
      club_balance_scans: clubFeatureCounts.get('balance') || 0,
      club_cloakroom_scans: clubFeatureCounts.get('cloakroom') || 0,
      club_coupon_scans: clubFeatureCounts.get('coupon') || 0,
      club_membership_scans: clubFeatureCounts.get('membership') || 0,
      top_club_combination: topKey(clubCombinationCounts)
    },
    charts: {
      gender_distribution: chartFromCounts(genderCounts, genderLabels),
      age_group_distribution: fixedChart(['18_plus', '25_plus', '30_plus'], ageCounts, ageLabels),
      scans_by_hour: fixedChart(Array.from({ length: 24 }, (_, index) => index), hourCounts, hourLabels),
      scans_by_weekday: fixedChart([1, 2, 3, 4, 5, 6, 7], weekdayCounts, weekdayLabels),
      scans_over_time: chartFromCounts(overTimeCounts).sort((a, b) => String(a.key).localeCompare(String(b.key))),
      gender_age_matrix: chartFromCounts(genderAgeCounts, {
        male_18_plus: 'Männlich 18+',
        male_25_plus: 'Männlich 25+',
        male_30_plus: 'Männlich 30+',
        female_18_plus: 'Weiblich 18+',
        female_25_plus: 'Weiblich 25+',
        female_30_plus: 'Weiblich 30+'
      }),
      first_vs_repeat: [
        { key: 'first_scan', label: 'Erstbesuche', value: firstScans },
        { key: 'repeat_scan', label: 'Wiederholungsbesuche', value: repeatScans }
      ],
      template_type_distribution: chartFromCounts(templateCounts, templateLabels),
      club_feature_distribution: chartFromCounts(clubFeatureCounts, clubFeatureLabels),
      club_feature_combinations: chartFromCounts(clubCombinationCounts),
      weekday_hour_heatmap: weekdayHourHeatmap(rows, weekdayLabels)
    },
    last_scans: rows.slice(0, 100).map((row) => ({
      id: row.id,
      scanned_at: row.scanned_at,
      scan_hour: row.scan_hour,
      card_instance_id: row.card_instance_id,
      card_instance_number: row.card_instance_number,
      template_id: row.template_id,
      template_name: row.template_name,
      template_type: row.template_type,
      active_club_features: row.active_club_features || {},
      customer_gender: row.customer_gender,
      customer_age_group: row.customer_age_group,
      is_first_scan: row.is_first_scan,
      action_type: row.action_type,
      action_label: row.action_label,
      scanned_by: row.scanned_by,
      last_scanned_at: row.scanned_at,
      scan_count: row.details?.scan_count || null
    }))
  };
}

async function loadBusinessScanStatistics(user, filters) {
  if (filters.business_id) {
    const { data: business, error: businessError } = await supabaseAdmin
      .from('businesses')
      .select('id')
      .eq('id', filters.business_id)
      .eq('owner_id', user.id)
      .maybeSingle();

    if (businessError || !business) {
      throw createStructuredError(
        403,
        'BUSINESS_FORBIDDEN',
        'Kein Zugriff auf dieses Business.',
        'Statistiken können nur für eigene Businesses geladen werden.'
      );
    }
  }

  let query = supabaseAdmin
    .from('scan_events')
    .select([
      'id',
      'owner_id',
      'business_id',
      'template_id',
      'customer_card_id',
      'card_instance_id',
      'card_instance_number',
      'template_name',
      'scanned_by',
      'scanned_at',
      'scan_hour',
      'scan_weekday',
      'template_type',
      'active_club_features',
      'customer_gender',
      'customer_age_group',
      'is_first_scan',
      'demographics_were_collected',
      'action_type',
      'action_label',
      'details'
    ].join(','))
    .eq('owner_id', user.id)
    .order('scanned_at', { ascending: false })
    .limit(5000);

  if (filters.business_id) {
    query = query.eq('business_id', filters.business_id);
  }

  if (filters.date_from) {
    query = query.gte('scanned_at', `${filters.date_from}T00:00:00.000Z`);
  }

  if (filters.date_to) {
    query = query.lte('scanned_at', `${filters.date_to}T23:59:59.999Z`);
  }

  const { data, error } = await query;

  if (error) {
    throw createStructuredError(
      500,
      'SCAN_STATISTICS_LOAD_FAILED',
      'Besucherstatistik konnte nicht geladen werden.',
      error.message || 'scan_events.select hat einen Fehler zurückgegeben.'
    );
  }

  return buildBusinessScanStatistics((data || []).filter((row) => matchesStatsFilters(row, filters)));
}

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const configuredOrigins = String(config.server.corsOrigin || config.app.baseUrl || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = req.get('origin');
  const allowAnyOrigin = configuredOrigins.includes('*');
  const allowedOrigin = allowAnyOrigin
    ? '*'
    : configuredOrigins.includes(requestOrigin)
      ? requestOrigin
      : configuredOrigins[0] || '*';

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

if (serveStaticFrontend) {
  app.use('/public', (req, res) => {
    const targetPath = req.originalUrl.replace(/^\/public(?=\/|$)/, '') || '/';
    res.redirect(308, targetPath);
  });

  app.use(express.static(publicDir));
}

app.get('/api/config', (req, res) => {
  res.json(getPublicConfig(config));
});

app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'ok',
    service: 'el-promillo',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/statistics/scans', async (req, res) => {
  try {
    const user = await requireAuthenticatedOperator(req);
    const filters = normalizeStatsFilters(req.body || {});
    const statistics = await loadBusinessScanStatistics(user, filters);

    res.json({
      ok: true,
      filters,
      ...statistics
    });
  } catch (error) {
    jsonError(res, error);
  }
});

app.get('/api/qrcode', async (req, res) => {
  try {
    const text = String(req.query.text || '');

    if (!text) {
      res.status(400).send('Missing text');
      return;
    }

    const svg = await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: {
        dark: '#111827',
        light: '#ffffff'
      }
    });

    res.type('image/svg+xml').send(svg);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get('/api/templates/:templateId/qr.pdf', async (req, res) => {
  try {
    requireSupabaseAdmin(supabaseAdmin);

    const { data: template, error } = await selectPublicTemplateByClaimKey(req.params.templateId);

    if (error || !template) {
      res.status(404).json({ error: 'Template nicht gefunden oder inaktiv.' });
      return;
    }

    const baseUrl = config.app.baseUrl || `http://${host}:${port}`;
    const claimUrl = claimUrlForTemplate(template, baseUrl);
    const format = String(req.query.format || 'a4').toLowerCase();
    const normalizedFormat = ['a4', 'a5', 'a6'].includes(format) ? format : 'a4';
    const publicTemplate = publicCardTemplateResponse(template);
    const assets = await loadTemplatePdfAssets(publicTemplate);
    const pdfBuffer = buildTemplateQrPdf({ template: publicTemplate, claimUrl, format: normalizedFormat, assets });
    const safeName = String(template.card_name || 'karte')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'karte';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${safeName}-${normalizedFormat}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdfBuffer);
  } catch (error) {
    jsonError(res, error);
  }
});

app.get('/api/templates/:templateId', async (req, res) => {
  try {
    requireSupabaseAdmin(supabaseAdmin);

    const { data: template, error } = await selectPublicTemplateByClaimKey(req.params.templateId);

    if (error || !template) {
      res.status(404).json({ error: 'Template nicht gefunden oder inaktiv.' });
      return;
    }

    res.json(publicCardTemplateResponse(template));
  } catch (error) {
    jsonError(res, error);
  }
});

function walletClaimResponseHints(walletPlatform) {
  if (walletPlatform === 'google') {
    return {
      passDownloadUrl: null,
      applePassEdgeFunction: null,
      googleWalletMessage: 'Google-Wallet-Karteninstanz wurde gespeichert. Der Save-Link wird über die Edge Function google-wallet-save-link erstellt.'
    };
  }

  return {
    passDownloadUrl: null,
    applePassEdgeFunction: 'claim-apple-pass',
    googleWalletMessage: null,
    appleWalletMessage: 'Apple-Wallet-Dateien werden über die Edge Function claim-apple-pass erstellt; der lokale PassKit-Download ist kein aktiver Claim-Pfad.'
  };
}

function publicClaimCard(card = {}) {
  const metadata = card.metadata && typeof card.metadata === 'object' && !Array.isArray(card.metadata)
    ? card.metadata
    : {};

  return {
    id: card.id,
    template_id: card.template_id,
    card_instance_number: card.card_instance_number,
    customer_code: card.customer_code,
    status: card.status,
    stamp_count: card.stamp_count,
    streak_count: card.streak_count,
    vip_status: card.vip_status,
    wallet_platform: card.wallet_platform,
    wallet_object_id: card.wallet_object_id,
    wallet_serial_number: card.wallet_serial_number,
    balance_cents: card.balance_cents,
    currency: card.currency,
    cloakroom_active: card.cloakroom_active,
    metadata: {
      card_instance_number: metadata.card_instance_number,
      balance_cents: metadata.balance_cents,
      cloakroom_active: metadata.cloakroom_active,
      template_type: metadata.template_type,
      google_wallet_claim_key: metadata.google_wallet_claim_key
    },
    created_at: card.created_at
  };
}

const sensitiveResponseKeys = new Set([
  'owner_id',
  'business_id',
  'pass_authentication_token',
  'authentication_token',
  'authentication_token_hash',
  'service_role_key',
  'private_key',
  'signer_key',
  'signer_key_passphrase',
  'apple_apns_auth_key',
  'google_wallet_service_account_json'
]);
const sensitiveKeyPattern = /(secret|token|password|passphrase|private[_-]?key|service[_-]?role|auth[_-]?key|certificate|cert|p12)/i;

function sanitizeBrowserMetadata(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeBrowserMetadata(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveResponseKeys.has(key) && !sensitiveKeyPattern.test(key))
      .map(([key, entry]) => [key, sanitizeBrowserMetadata(entry)])
  );
}

function publicCardTemplateResponse(template = {}) {
  const businessName = templateBusinessName(template);
  const businessLogoUrl = templateBusinessLogoUrl(template);

  return {
    id: template.id,
    business_name: businessName,
    business_logo_url: businessLogoUrl,
    card_name: template.card_name,
    card_type: template.card_type,
    template_type: template.template_type,
    description: template.description,
    primary_color: template.primary_color,
    text_color: template.text_color,
    logo_url: businessLogoUrl,
    reward_text: template.reward_text,
    stamps_required: template.stamps_required,
    streak_goal: template.streak_goal,
    vip_tier: template.vip_tier,
    settings: sanitizeBrowserMetadata(template.settings || {}),
    club_features: sanitizeBrowserMetadata(template.club_features || {}),
    club_settings: sanitizeBrowserMetadata(template.club_settings || {}),
    is_active: template.is_active
  };
}

function publicOperatorCard(card = {}) {
  return {
    id: card.id,
    template_id: card.template_id,
    card_instance_number: card.card_instance_number,
    customer_code: card.customer_code,
    status: card.status,
    stamp_count: card.stamp_count,
    streak_count: card.streak_count,
    vip_status: card.vip_status,
    pass_serial_number: card.pass_serial_number,
    wallet_platform: card.wallet_platform,
    wallet_object_id: card.wallet_object_id,
    wallet_serial_number: card.wallet_serial_number,
    balance_cents: card.balance_cents,
    currency: card.currency,
    cloakroom_active: card.cloakroom_active,
    cloakroom_started_at: card.cloakroom_started_at,
    cloakroom_completed_at: card.cloakroom_completed_at,
    last_scanned_at: card.last_scanned_at,
    updated_at: card.updated_at,
    created_at: card.created_at,
    metadata: sanitizeBrowserMetadata(card.metadata || {}),
    card_templates: card.card_templates
      ? publicCardTemplateResponse(card.card_templates)
      : null
  };
}

function publicOperatorGuestProfile(profile = {}) {
  if (!profile?.id) {
    return null;
  }

  return {
    id: profile.id,
    display_name: profile.display_name || null,
    gender: profile.gender || null,
    age_group: profile.age_group || null,
    first_seen_at: profile.first_seen_at || null,
    last_seen_at: profile.last_seen_at || null,
    card_count: Math.max(0, Number(profile.card_count || 0)),
    scan_count: Math.max(0, Number(profile.scan_count || 0)),
    created_at: profile.created_at || null,
    updated_at: profile.updated_at || null
  };
}

const claimCustomerCardSelect = 'id, owner_id, business_id, template_id, card_instance_number, customer_code, status, stamp_count, streak_count, vip_status, pass_serial_number, wallet_platform, wallet_object_id, wallet_serial_number, balance_cents, currency, cloakroom_active, metadata, created_at';

function isUniqueViolation(error) {
  return error?.code === '23505';
}

async function findExistingClaimCard(walletPlatform, walletObjectId) {
  const { data: exactExistingCards, error: existingCardError } = await supabaseAdmin
    .from('customer_cards')
    .select(claimCustomerCardSelect)
    .eq('wallet_platform', walletPlatform)
    .eq('wallet_object_id', walletObjectId)
    .limit(2);

  if (existingCardError) {
    throw existingCardError;
  }

  if ((exactExistingCards || []).length > 1) {
    throw createStructuredError(
      409,
      'CLAIM_WALLET_OBJECT_ID_DUPLICATE',
      'Wallet-Claim-Schlüssel ist mehrfach vergeben.',
      'Bitte prüfe die vorhandenen Kundendaten. Derselbe Wallet-Schlüssel darf nur zu einer Kundenkarte gehören.'
    );
  }

  if (exactExistingCards?.[0]) {
    return exactExistingCards[0];
  }

  if (walletPlatform !== 'google') {
    return null;
  }

  const { data: claimKeyMatches, error: claimKeyError } = await supabaseAdmin
    .from('customer_cards')
    .select(claimCustomerCardSelect)
    .eq('wallet_platform', walletPlatform)
    .eq('metadata->>google_wallet_claim_key', walletObjectId)
    .limit(2);

  if (claimKeyError) {
    throw claimKeyError;
  }

  if ((claimKeyMatches || []).length > 1) {
    throw createStructuredError(
      409,
      'CLAIM_WALLET_OBJECT_ID_DUPLICATE',
      'Wallet-Claim-Schlüssel ist mehrfach vergeben.',
      'Bitte prüfe die vorhandenen Kundendaten. Derselbe Google-Claim-Schlüssel darf nur zu einer Kundenkarte gehören.'
    );
  }

  return claimKeyMatches?.[0] || null;
}

async function insertLocalClaimEvent(payload) {
  const { error } = await supabaseAdmin.from('card_events').insert(payload);

  if (error) {
    throw createStructuredError(
      500,
      'CLAIM_CARD_EVENT_SAVE_FAILED',
      'Claim-Ereignis konnte nicht gespeichert werden.',
      error.message || 'card_events.insert hat einen Fehler zurückgegeben.'
    );
  }
}

async function insertLocalClaimCardInstance(payload) {
  let { data, error } = await supabaseAdmin
    .from('card_instances')
    .insert(payload)
    .select('id')
    .maybeSingle();

  if (isMissingWalletEmblemColumn(error)) {
    const fallbackPayload = { ...payload };

    for (const columnName of walletEmblemColumnNames) {
      delete fallbackPayload[columnName];
    }

    const fallbackResult = await supabaseAdmin
      .from('card_instances')
      .insert(fallbackPayload)
      .select('id')
      .maybeSingle();

    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error || !data) {
    throw createStructuredError(
      500,
      'CLAIM_CARD_INSTANCE_SAVE_FAILED',
      'Karteninstanz konnte nicht gespeichert werden.',
      error?.message || 'card_instances.insert hat keine Karteninstanz zurückgegeben.'
    );
  }

  return data;
}

async function reuseExistingClaimCard(existingCard, template, walletPlatform, walletObjectId, source, eventType = 'claim_reused') {
  if (existingCard.template_id !== template.id) {
    throw createStructuredError(
      409,
      'CLAIM_WALLET_OBJECT_ID_CONFLICT',
      'Wallet-Claim-Schlüssel gehört zu einem anderen Template.',
      'Oeffne den originalen Claim-Link dieser Karte oder erstelle für dieses Template eine neue Wallet-Karte.'
    );
  }

  await insertLocalClaimEvent({
    owner_id: existingCard.owner_id,
    business_id: existingCard.business_id,
    template_id: existingCard.template_id,
    customer_card_id: existingCard.id,
    event_type: eventType,
    details: {
      card_instance_number: existingCard.card_instance_number,
      wallet_platform: walletPlatform,
      wallet_object_id: existingCard.wallet_object_id || walletObjectId,
      wallet_claim_key: walletObjectId,
      source
    }
  });

  return existingCard;
}

app.post('/api/cards/claim', async (req, res) => {
  try {
    enforceLocalPublicClaimRateLimit(req, 'api-cards-claim');
    requireSupabaseAdmin(supabaseAdmin);

    const templateId = req.body?.templateId;
    const token = claimToken(req.body?.token || req.body?.claimToken || req.body?.claim_token);

    if (!templateId && !token) {
      res.status(400).json({
        error: 'templateId oder claimToken fehlt.',
        error_code: 'CLAIM_LINK_REQUIRED'
      });
      return;
    }

    const walletPlatform = req.body?.walletPlatform === 'google' ? 'google' : 'apple';
    const walletObjectId = String(req.body?.walletObjectId || req.body?.wallet_object_id || '').trim();
    validateWalletObjectId(walletObjectId);

    const { data: template, error: templateError } = await (token
      ? supabaseAdmin
        .from('card_templates')
        .select(localTemplateInternalSelect)
        .eq('public_claim_token', token)
        .eq('is_active', true)
        .single()
      : supabaseAdmin
        .from('card_templates')
        .select(localTemplateInternalSelect)
        .eq('id', templateId)
        .eq('is_active', true)
        .single()
    );

    if (templateError || !template) {
      res.status(404).json({ error: 'Template nicht gefunden oder inaktiv.' });
      return;
    }

    const existingCard = await findExistingClaimCard(walletPlatform, walletObjectId);

    if (existingCard) {
      const reusedCard = await reuseExistingClaimCard(existingCard, template, walletPlatform, walletObjectId, 'public_claim_page');

      res.json({
        reused: true,
        card: publicClaimCard(reusedCard),
        template: publicCardTemplateResponse(template),
        ...walletClaimResponseHints(walletPlatform)
      });
      return;
    }

    const cardInstanceNumber = generateCardInstanceNumber();
    const passSerialNumber = generateSerialNumber();
    const draftCard = {
      id: crypto.randomUUID(),
      owner_id: template.owner_id,
      business_id: template.business_id,
      template_id: template.id,
      card_instance_number: cardInstanceNumber,
      customer_code: generateCustomerCode(),
      stamp_count: 0,
      streak_count: 0,
      vip_status: featureEnabled(template, 'vip') ? (template.vip_tier || 'Standard') : null,
      pass_serial_number: passSerialNumber,
      wallet_platform: walletPlatform,
      wallet_object_id: walletObjectId,
      wallet_serial_number: walletPlatform === 'apple' ? passSerialNumber : walletObjectId,
      balance_cents: 0,
      currency: template.settings?.currency || 'CHF',
      cloakroom_active: false,
      metadata: {
        card_instance_number: cardInstanceNumber,
        balance_cents: 0,
        cloakroom_active: false,
        claim_source: 'local_claim_api',
        ...(walletPlatform === 'google' ? { google_wallet_claim_key: walletObjectId } : {})
      }
    };

    const cardToInsert = {
      ...draftCard,
      pass_authentication_token: generateWalletAuthenticationToken()
    };

    const { data: card, error: insertError } = await supabaseAdmin
      .from('customer_cards')
      .insert(cardToInsert)
      .select('id, owner_id, business_id, template_id, card_instance_number, customer_code, status, stamp_count, streak_count, vip_status, pass_serial_number, wallet_platform, wallet_object_id, wallet_serial_number, balance_cents, currency, cloakroom_active, metadata, created_at')
      .single();

    if (insertError) {
      if (isUniqueViolation(insertError)) {
        const recoveredCard = await findExistingClaimCard(walletPlatform, walletObjectId);

        if (recoveredCard) {
          const reusedCard = await reuseExistingClaimCard(recoveredCard, template, walletPlatform, walletObjectId, 'public_claim_page', 'claim_reused_after_unique_conflict');

          res.json({
            reused: true,
            recoveredFromUniqueConflict: true,
            card: publicClaimCard(reusedCard),
            template: publicCardTemplateResponse(template),
            ...walletClaimResponseHints(walletPlatform)
          });
          return;
        }
      }

      throw insertError;
    }

    await insertLocalClaimCardInstance({
      id: card.id,
      customer_card_id: card.id,
      owner_id: template.owner_id,
      business_id: template.business_id,
      template_id: template.id,
      card_instance_number: card.card_instance_number,
      wallet_platform: walletPlatform,
      wallet_object_id: walletObjectId,
      wallet_serial_number: walletPlatform === 'apple' ? card.pass_serial_number : walletObjectId || card.pass_serial_number,
      apple_serial_number: walletPlatform === 'apple' ? card.pass_serial_number : null,
      google_object_id: walletPlatform === 'google' ? walletObjectId : null,
      push_enabled: true,
      demographics_collected: false,
      resolved_emblem_key: 'neutral_couple',
      resolved_emblem_url: supabaseCardEmblemUrl({ demographics_collected: false }, config.supabase?.url || ''),
      emblem_updated_at: new Date().toISOString(),
      current_streak: card.streak_count || 0,
      current_stamps: card.stamp_count || 0,
      vip_level: card.vip_status,
      balance_cents: card.balance_cents || 0,
      currency: card.currency || template.settings?.currency || 'CHF',
      cloakroom_active: false
    });

    await insertLocalClaimEvent({
      owner_id: template.owner_id,
      business_id: template.business_id,
      template_id: template.id,
      customer_card_id: card.id,
      event_type: 'claim_created',
      details: {
        customer_code: card.customer_code,
        card_instance_number: card.card_instance_number,
        wallet_platform: walletPlatform,
        wallet_object_id: walletObjectId,
        source: 'public_claim_page'
      }
    });

    res.json({
      card: publicClaimCard(card),
      template: publicCardTemplateResponse(template),
      ...walletClaimResponseHints(walletPlatform)
    });
  } catch (error) {
    jsonError(res, error);
  }
});

app.post('/api/scanner/actions', async (req, res) => {
  try {
    const user = await requireAuthenticatedOperator(req);
    const cardId = String(req.body?.cardId || '').trim();
    const code = String(req.body?.code || req.body?.customer_code || req.body?.cardInstanceNumber || '').trim();
    const action = String(req.body?.action || 'manual_update');

    if (!cardId && !code) {
      throw createStructuredError(
        400,
        'CARD_ID_REQUIRED',
        'Karten-ID fehlt.',
        'Der Scanner konnte keine Kundenkarte für die Aktion bestimmen.'
      );
    }

    let card = null;
    let cardError = null;

    if (cardId) {
      ({ data: card, error: cardError } = await supabaseAdmin
        .from('customer_cards')
        .select(localOperatorCardSelect)
        .eq('id', cardId)
        .maybeSingle());
    } else {
      ({ data: card, error: cardError } = await supabaseAdmin
        .from('customer_cards')
        .select(localOperatorCardSelect)
        .eq('customer_code', code)
        .maybeSingle());

      if (!cardError && !card) {
        ({ data: card, error: cardError } = await supabaseAdmin
          .from('customer_cards')
          .select(localOperatorCardSelect)
          .eq('card_instance_number', code)
          .maybeSingle());
      }
    }

    if (cardError || !card) {
      throw createStructuredError(
        404,
        'CARD_NOT_FOUND',
        'Kundenkarte nicht gefunden.',
        'Die Karte existiert nicht oder wurde entfernt.'
      );
    }

    if (card.owner_id !== user.id) {
      throw createStructuredError(
        403,
        'CARD_FORBIDDEN',
        'Kein Zugriff auf diese Karte.',
        'Die Kundenkarte gehört zu einem anderen Betreiber.'
      );
    }

    const template = card.card_templates;

    if (!template) {
      throw createStructuredError(
        404,
        'TEMPLATE_NOT_FOUND',
        'Template zur Kundenkarte nicht gefunden.',
        'Die Kundenkarte ist keinem gültigen Template zugeordnet.'
      );
    }

    const now = new Date().toISOString();
    const cardInstanceBeforeScan = await loadLocalCardInstanceForScan(card);

    if (action === 'inspect') {
      const guestProfile = await getGuestProfileForScan(card);

      res.json({
        ok: true,
        action: 'inspect',
        card: publicOperatorCard(card),
        guest_profile: guestProfile,
        card_instance: {
          id: cardInstanceBeforeScan.id,
          card_instance_number: cardInstanceBeforeScan.card_instance_number,
          wallet_platform: cardInstanceBeforeScan.wallet_platform,
          demographics_collected: cardInstanceBeforeScan.demographics_collected,
          customer_gender: cardInstanceBeforeScan.customer_gender,
          customer_age_group: cardInstanceBeforeScan.customer_age_group,
          demographics_collected_at: cardInstanceBeforeScan.demographics_collected_at,
          first_scanned_at: cardInstanceBeforeScan.first_scanned_at,
          last_scanned_at: cardInstanceBeforeScan.last_scanned_at,
          scan_count: cardInstanceBeforeScan.scan_count,
          resolved_emblem_key: cardInstanceBeforeScan.resolved_emblem_key,
          resolved_emblem_url: cardInstanceBeforeScan.resolved_emblem_url,
          emblem_updated_at: cardInstanceBeforeScan.emblem_updated_at,
          updated_at: cardInstanceBeforeScan.updated_at
        }
      });
      return;
    }

    let preflightAction = action;

    if (action !== 'manual_update') {
      const validation = validateScannerAction(template, action);

      if (!validation.allowed) {
        throw scannerValidationError(validation, template);
      }

      preflightAction = validation.action;
    }

    const demographics = normalizeDemographics(req.body?.demographics || req.body);

    if (!cardInstanceBeforeScan.demographics_collected && !demographics) {
      res.json(demographicsRequiredPayload(card, cardInstanceBeforeScan, template, preflightAction));
      return;
    }

    let updates = {};
    let normalizedAction = action;

    if (action === 'manual_update') {
      updates = normalizeScannerUpdates(req.body?.updates || {});
      validateManualScannerUpdates(template, updates);
    } else {
      const validation = validateScannerAction(template, action);

      if (!validation.allowed) {
        throw scannerValidationError(validation, template);
      }

      normalizedAction = validation.action;

      if (normalizedAction === 'stamp-plus') {
        updates.stamp_count = Number(card.stamp_count || 0) + 1;
      }

      if (normalizedAction === 'stamp-minus') {
        updates.stamp_count = Math.max(0, Number(card.stamp_count || 0) - 1);
      }

      if (normalizedAction === 'stamp-redeem') {
        const stampCount = Number(card.stamp_count || 0);
        const stampsRequired = Number(template.stamps_required || 10);

        if (stampCount < stampsRequired) {
          throw createStructuredError(
            409,
            'STAMP_CARD_NOT_FULL',
            'Stempelkarte ist noch nicht voll.',
            `Aktueller Stand: ${stampCount}/${stampsRequired} Stempel.`
          );
        }

        updates.status = 'redeemed';
        updates.metadata = {
          ...(card.metadata && typeof card.metadata === 'object' ? card.metadata : {}),
          last_stamp_redeemed_at: now,
          redeemed_stamp_count: stampCount
        };
      }

      if (normalizedAction === 'streak-plus') {
        updates.streak_count = Number(card.streak_count || 0) + 1;
      }

      if (normalizedAction === 'streak-reset') {
        updates.streak_count = 0;
      }

      if (normalizedAction === 'streak-complete') {
        const streakCount = Number(card.streak_count || 0);
        const streakGoal = Number(template.streak_goal || template.settings?.streakGoal || 0);

        if (!streakGoal) {
          throw createStructuredError(
            409,
            'STREAK_GOAL_MISSING',
            'Streak-Ziel fehlt.',
            'Dieses Template hat kein Streak-Ziel definiert.'
          );
        }

        if (streakCount < streakGoal) {
          throw createStructuredError(
            409,
            'STREAK_GOAL_NOT_REACHED',
            'Streak-Ziel noch nicht erreicht.',
            `Aktueller Stand: ${streakCount}/${streakGoal}.`
          );
        }

        updates.status = 'redeemed';
        updates.metadata = {
          ...(card.metadata && typeof card.metadata === 'object' ? card.metadata : {}),
          last_streak_completed_at: now,
          completed_streak_count: streakCount,
          completed_streak_goal: streakGoal
        };
      }

      if (normalizedAction === 'vip-update') {
        updates.vip_status = req.body?.vipStatus ? String(req.body.vipStatus) : null;
      }

      if (normalizedAction === 'vip-benefit-redeem') {
        const metadata = card.metadata && typeof card.metadata === 'object' ? card.metadata : {};
        const usedBenefits = Array.isArray(metadata.vip_benefits_used) ? metadata.vip_benefits_used : [];
        const benefitLabel = req.body?.vipBenefitLabel ? String(req.body.vipBenefitLabel) : null;

        updates.metadata = {
          ...metadata,
          vip_benefits_used: [
            ...usedBenefits,
            {
              label: benefitLabel,
              redeemed_at: now
            }
          ],
          vip_benefit_redeem_count: Number(metadata.vip_benefit_redeem_count || 0) + 1,
          last_vip_benefit_redeemed_at: now,
          last_vip_benefit_label: benefitLabel
        };
      }

      if (normalizedAction === 'cloakroom-toggle') {
        const metadata = card.metadata && typeof card.metadata === 'object' ? card.metadata : {};
        const cloakroomActive = !Boolean(card.cloakroom_active ?? metadata.cloakroom_active);
        const cloakroomStartedAt = cloakroomActive ? now : metadata.cloakroom_started_at || null;
        const cloakroomSettings = template.settings && typeof template.settings === 'object'
          ? template.settings
          : {};

        updates.metadata = {
          ...metadata,
          cloakroom_active: cloakroomActive,
          cloakroom_started_at: cloakroomStartedAt,
          cloakroom_completed_at: cloakroomActive ? metadata.cloakroom_completed_at || null : now,
          cloakroom_noon_reminder_at: cloakroomActive ? nextNoonAfter(cloakroomStartedAt) : null,
          cloakroom_noon_message: cloakroomSettings.cloakroomNoonMessage || '',
          cloakroom_location_message: cloakroomSettings.cloakroomLocationMessage || '',
          cloakroom_location_name: cloakroomSettings.cloakroomLocationName || '',
          cloakroom_location_latitude: cloakroomSettings.cloakroomLocationLatitude ?? null,
          cloakroom_location_longitude: cloakroomSettings.cloakroomLocationLongitude ?? null,
          cloakroom_location_radius_meters: cloakroomSettings.cloakroomLocationRadiusMeters ?? null
        };
        updates.cloakroom_active = cloakroomActive;
        updates.cloakroom_started_at = cloakroomActive ? now : card.cloakroom_started_at || metadata.cloakroom_started_at || null;
        updates.cloakroom_completed_at = cloakroomActive ? card.cloakroom_completed_at || metadata.cloakroom_completed_at || null : now;
      }

      if (normalizedAction === 'redeem') {
        updates.metadata = {
          ...(card.metadata && typeof card.metadata === 'object' ? card.metadata : {}),
          coupon_status: 'redeemed',
          coupon_redeemed_at: now,
          last_coupon_redeemed_at: now
        };
        updates.status = 'redeemed';
      }

      if (normalizedAction === 'balance-redeem') {
        const amountCents = Math.round(Number(req.body?.amountCents || 0));
        const currentBalance = Number(card.balance_cents ?? card.metadata?.balance_cents ?? 0);

        if (!Number.isFinite(amountCents) || amountCents <= 0) {
          throw createStructuredError(
            400,
            'INVALID_REDEEM_AMOUNT',
            'Ungültiger Abbuchungsbetrag.',
            'Bitte gib einen Betrag grösser als 0 in Rappen/Cents ein.'
          );
        }

        if (currentBalance - amountCents < 0) {
          throw createStructuredError(
            409,
            'BALANCE_TOO_LOW',
            'Guthaben reicht nicht aus.',
            `Aktuell verfügbar: ${(currentBalance / 100).toFixed(2)} ${card.currency || template.settings?.currency || 'CHF'}.`
          );
        }

        updates.balance_cents = currentBalance - amountCents;
        updates.currency = card.currency || template.settings?.currency || 'CHF';
        updates.metadata = {
          ...(card.metadata && typeof card.metadata === 'object' ? card.metadata : {}),
          balance_cents: updates.balance_cents,
          last_balance_redeem_at: now,
          last_balance_redeem_cents: amountCents
        };
      }

      if (normalizedAction === 'balance-adjust') {
        const balanceCents = Math.round(Number(req.body?.balanceCents ?? req.body?.newBalanceCents ?? 0));
        const currentBalance = Number(card.balance_cents ?? card.metadata?.balance_cents ?? 0);

        if (!Number.isFinite(balanceCents) || balanceCents < 0) {
          throw createStructuredError(
            400,
            'INVALID_BALANCE_ADJUSTMENT',
            'Ungültige Guthabenkorrektur.',
            'Bitte gib ein Guthaben ab 0 in Rappen/Cents ein.'
          );
        }

        updates.balance_cents = balanceCents;
        updates.currency = card.currency || template.settings?.currency || 'CHF';
        updates.metadata = {
          ...(card.metadata && typeof card.metadata === 'object' ? card.metadata : {}),
          balance_cents: balanceCents,
          last_balance_adjusted_at: now,
          last_balance_adjustment_delta_cents: balanceCents - currentBalance
        };
      }

      if (normalizedAction === 'visit') {
        const metadata = card.metadata && typeof card.metadata === 'object' ? card.metadata : {};

        updates.metadata = {
          ...metadata,
          visit_count: Number(metadata.visit_count || 0) + 1,
          last_visit_at: now
        };
      }

      if (['checkin', 'event-checkout', 'event-ticket-use'].includes(normalizedAction)) {
        const metadata = card.metadata && typeof card.metadata === 'object' ? card.metadata : {};

        updates.metadata = {
          ...metadata,
          last_matrix_action: normalizedAction,
          last_requested_action: action,
          last_matrix_action_at: now,
          event_ticket_status: {
            checkin: 'checked_in',
            'event-checkout': 'checked_out',
            'event-ticket-use': 'used'
          }[normalizedAction],
          event_checked_in_at: normalizedAction === 'checkin' ? now : metadata.event_checked_in_at || null,
          event_checked_out_at: normalizedAction === 'event-checkout' ? now : metadata.event_checked_out_at || null,
          event_ticket_used_at: normalizedAction === 'event-ticket-use' ? now : metadata.event_ticket_used_at || null
        };

        if (normalizedAction === 'event-ticket-use') {
          updates.status = 'redeemed';
        }
      }

      if (normalizedAction === 'membership-check') {
        updates.metadata = {
          ...(card.metadata && typeof card.metadata === 'object' ? card.metadata : {}),
          last_matrix_action: normalizedAction,
          last_requested_action: action,
          last_matrix_action_at: now
        };
      }

      if (normalizedAction === 'membership-status-update') {
        const metadata = card.metadata && typeof card.metadata === 'object' ? card.metadata : {};
        const membershipStatus = String(req.body?.membershipStatus || '').trim();

        if (!membershipStatus) {
          throw createStructuredError(
            400,
            'MEMBERSHIP_STATUS_REQUIRED',
            'Mitgliedsstatus fehlt.',
            'Bitte gib einen neuen Mitgliedsstatus ein.'
          );
        }

        updates.metadata = {
          ...metadata,
          membership_status: membershipStatus,
          membership_started_at: metadata.membership_started_at || now,
          last_membership_status_updated_at: now
        };
      }

      if (normalizedAction === 'membership-extend') {
        const metadata = card.metadata && typeof card.metadata === 'object' ? card.metadata : {};
        const membershipExpiresAt = String(req.body?.membershipExpiresAt || '').trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(membershipExpiresAt)) {
          throw createStructuredError(
            400,
            'MEMBERSHIP_EXPIRY_REQUIRED',
            'Ablaufdatum fehlt oder ist ungültig.',
            'Bitte gib ein Datum im Format YYYY-MM-DD ein.'
          );
        }

        updates.metadata = {
          ...metadata,
          membership_expires_at: membershipExpiresAt,
          membership_status: metadata.membership_status || template.settings?.membershipStatus || 'aktiv',
          membership_started_at: metadata.membership_started_at || now,
          last_membership_extended_at: now
        };
      }
    }

    updates.last_scanned_at = now;

    const { data: updatedRows, error: updateError } = await supabaseAdmin
      .from('customer_cards')
      .update(updates)
      .eq('id', card.id)
      .eq('owner_id', user.id)
      .select(localOperatorCardSelect);

    if (updateError) {
      throw updateError;
    }

    const updatedCard = updatedRows?.[0] || {
      ...card,
      ...updates
    };

    const updatedCardInstance = await syncLocalCardInstance(updatedCard, template, now, {
      instance: cardInstanceBeforeScan,
      demographics,
      userId: user.id
    });
    const emblemUpdate = await recordLocalWalletEmblemUpdate(
      updatedCard,
      updatedCardInstance,
      updatedCardInstance.demographics_were_collected ? 'initial_demographics_scan' : 'scanner_sync'
    );
    const cardInstanceId = updatedCardInstance.id;
    const clubAction = normalizeTemplateType(template) === 'club_card'
      ? clubActionForScannerAction(normalizedAction, card, updates)
      : null;
    const activeClubFeatures = activeClubFeaturesSnapshot(template);
    const timeParts = scanTimeParts(now);
    let cloakroomReminder = null;
    let cloakroomLocationReminder = null;

    if (normalizedAction === 'cloakroom-toggle') {
      try {
        cloakroomReminder = await maybeScheduleLocalCloakroomNoonReminder(
          updatedCard,
          template,
          updatedCardInstance,
          user.id
        );
      } catch (reminderError) {
        cloakroomReminder = {
          scheduled: false,
          error: reminderError?.message || 'Garderoben-Erinnerung konnte nicht geplant werden.'
        };
        console.warn('Garderoben-Erinnerung konnte nicht geplant werden:', reminderError?.message || reminderError);
      }

      try {
        cloakroomLocationReminder = await maybeScheduleLocalCloakroomLocationReminder(
          updatedCard,
          template,
          updatedCardInstance,
          user.id
        );
      } catch (locationReminderError) {
        cloakroomLocationReminder = {
          scheduled: false,
          error: locationReminderError?.message || 'Garderoben-Standorterinnerung konnte nicht geplant werden.'
        };
        console.warn('Garderoben-Standorterinnerung konnte nicht geplant werden:', locationReminderError?.message || locationReminderError);
      }
    }

    const scanEventId = await insertLocalScanEvent({
      owner_id: card.owner_id,
      business_id: card.business_id,
      template_id: card.template_id,
      customer_card_id: card.id,
      card_instance_id: cardInstanceId,
      card_instance_number: updatedCardInstance.card_instance_number || updatedCard.card_instance_number,
      template_name: template.card_name || null,
      scanned_by: user.id,
      scanned_at: now,
      scan_hour: timeParts.scan_hour,
      scan_weekday: timeParts.scan_weekday,
      template_type: normalizeTemplateType(template),
      active_club_features: activeClubFeatures,
      customer_gender: updatedCardInstance.customer_gender,
      customer_age_group: updatedCardInstance.customer_age_group,
      is_first_scan: updatedCardInstance.is_first_scan,
      demographics_were_collected: updatedCardInstance.demographics_were_collected,
      action_type: normalizedAction,
      action_label: scannerActionLabel(normalizedAction),
      details: {
        source: 'scanner_action_api',
        requested_action: action,
        normalized_action: normalizedAction,
        club_action: clubAction,
        resolved_emblem_key: updatedCardInstance.resolved_emblem_key,
        resolved_emblem_url: updatedCardInstance.resolved_emblem_url,
        emblem_update_queued: emblemUpdate.queued,
        cloakroom_reminder: cloakroomReminder,
        cloakroom_location_reminder: cloakroomLocationReminder,
        scan_count: updatedCardInstance.scan_count
      }
    });

    if (clubAction && card.business_id) {
      await insertLocalClubCardAction({
        owner_id: card.owner_id,
        business_id: card.business_id,
        template_id: card.template_id,
        card_instance_id: cardInstanceId,
        scan_event_id: scanEventId,
        feature_type: clubAction[0],
        action_type: clubAction[1],
        customer_gender: updatedCardInstance.customer_gender,
        customer_age_group: updatedCardInstance.customer_age_group,
        scanned_at: now,
        old_value: {
          status: card.status,
          vip_status: card.vip_status,
          balance_cents: card.balance_cents,
          cloakroom_active: card.cloakroom_active,
          metadata: card.metadata
        },
        new_value: updates,
        performed_by: user.id
      });
    }

    if (normalizedAction === 'balance-redeem') {
      const amountCents = Math.round(Number(req.body?.amountCents || 0));

      await insertLocalScannerBalanceTransaction({
        owner_id: card.owner_id,
        business_id: card.business_id,
        card_instance_id: cardInstanceId,
        amount_cents: -amountCents,
        currency: updatedCard.currency || template.settings?.currency || 'CHF',
        type: 'redeem',
        status: 'succeeded',
        created_by: user.id,
        details: {
          source: 'scanner_action_api',
          previous_balance_cents: card.balance_cents ?? card.metadata?.balance_cents ?? 0,
          new_balance_cents: updatedCard.balance_cents ?? updatedCard.metadata?.balance_cents ?? 0
        }
      });
    }

    if (normalizedAction === 'balance-adjust') {
      const previousBalanceCents = Number(card.balance_cents ?? card.metadata?.balance_cents ?? 0);
      const newBalanceCents = Number(updatedCard.balance_cents ?? updatedCard.metadata?.balance_cents ?? 0);

      await insertLocalScannerBalanceTransaction({
        owner_id: card.owner_id,
        business_id: card.business_id,
        card_instance_id: cardInstanceId,
        amount_cents: newBalanceCents - previousBalanceCents,
        currency: updatedCard.currency || template.settings?.currency || 'CHF',
        type: 'manual_adjustment',
        status: 'succeeded',
        created_by: user.id,
        details: {
          source: 'scanner_action_api',
          previous_balance_cents: previousBalanceCents,
          new_balance_cents: newBalanceCents
        }
      });
    }

    await insertLocalScannerEvent({
      owner_id: card.owner_id,
      business_id: card.business_id,
      template_id: card.template_id,
      customer_card_id: card.id,
      event_type: normalizedAction,
      details: {
        source: 'scanner_action_api',
        requested_action: action,
        normalized_action: normalizedAction,
        scan_event_id: scanEventId,
        card_instance_id: cardInstanceId,
        template_type: normalizeTemplateType(template),
        active_club_features: activeClubFeatures,
        customer_gender: updatedCardInstance.customer_gender,
        customer_age_group: updatedCardInstance.customer_age_group,
        is_first_scan: updatedCardInstance.is_first_scan,
        demographics_were_collected: updatedCardInstance.demographics_were_collected,
        resolved_emblem_key: updatedCardInstance.resolved_emblem_key,
        resolved_emblem_url: updatedCardInstance.resolved_emblem_url,
        emblem_update_queued: emblemUpdate.queued,
        cloakroom_reminder: cloakroomReminder,
        cloakroom_location_reminder: cloakroomLocationReminder,
        scan_count: updatedCardInstance.scan_count,
        before: {
          stamp_count: card.stamp_count,
          streak_count: card.streak_count,
          status: card.status,
          vip_status: card.vip_status,
          metadata: card.metadata
        },
        after: updates
      },
      created_by: user.id
    });

    const guestProfile = await getGuestProfileForScan(updatedCard);

    res.json({
      ok: true,
      action: normalizedAction,
      requestedAction: action,
      scan_event_id: scanEventId,
      card_instance: {
        id: updatedCardInstance.id,
        demographics_collected: updatedCardInstance.demographics_collected,
        customer_gender: updatedCardInstance.customer_gender,
        customer_age_group: updatedCardInstance.customer_age_group,
        first_scanned_at: updatedCardInstance.first_scanned_at,
        last_scanned_at: updatedCardInstance.last_scanned_at,
        scan_count: updatedCardInstance.scan_count,
        resolved_emblem_key: updatedCardInstance.resolved_emblem_key,
        resolved_emblem_url: updatedCardInstance.resolved_emblem_url,
        emblem_updated_at: updatedCardInstance.emblem_updated_at
      },
      emblem_update: emblemUpdate,
      cloakroom_reminder: cloakroomReminder,
      cloakroom_location_reminder: cloakroomLocationReminder,
      guest_profile: guestProfile,
      card: publicOperatorCard(updatedCard)
    });
  } catch (error) {
    jsonError(res, error);
  }
});

function legacyWalletRouteDisabled(res) {
  res.status(410).json({
    error_code: 'LEGACY_PASSKIT_ROUTE_DISABLED',
    error_message: 'Der lokale PassKit-Weg ist deaktiviert.',
    error_reason: 'Nutze die direkten Supabase Edge Functions: claim-apple-pass, issue-apple-pass und apple-wallet-webservice. Google Wallet nutzt google-wallet-save-link und die Google-Wallet-Functions.'
  });
}

app.all('/api/passes/:fileName', (req, res) => {
  legacyWalletRouteDisabled(res);
});

app.all('/api/passkit/*', (req, res) => {
  legacyWalletRouteDisabled(res);
});

if (serveStaticFrontend) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  app.use((req, res) => {
    res.status(404).json({
      error_code: 'FRONTEND_NOT_HOSTED_ON_RENDER',
      error_message: 'Render hostet fuer dieses Projekt nur das Backend.',
      error_reason: 'Oeffne das Frontend ueber GitHub Pages und nutze Render nur fuer /api/* und /health.'
    });
  });
}

const port = Number(process.env.PORT || config.server.port || 3000);
const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : config.server.host) || '127.0.0.1';

app.listen(port, host, () => {
  if (!config.hasLocalConfig) {
    console.warn('Hinweis: config.json fehlt. Der Server nutzt config.example.json mit Platzhaltern.');
  }

  console.log(`${config.app.name || 'El_Promillo'} läuft auf ${config.app.baseUrl || `http://${host}:${port}`}`);
});
