// Supabase Edge Function: matrixbasierte Scanner-Aktionen.
//
// Diese Funktion ist die produktionsnahe Variante des lokalen
// `/api/scanner/actions`-Endpunkts: Sie prüft den eingeloggten Betreiber,
// validiert die Aktion gegen die zentrale Template-Feature-Matrix und schreibt
// Fortschritt, Status, Guthaben-Transaktionen und Scan-Logs in Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SCANNER_ACTIONS, featureEnabled, normalizeTemplateType, validateScannerAction, type FeatureName } from '../_shared/templateFeatures.ts';
import { publicOperatorCard } from '../_shared/publicResponses.ts';
import { publicOperatorGuestProfile } from '../_shared/publicResponses.ts';
import { resolveCardEmblem, supabaseCardEmblemUrl } from '../_shared/cardEmblems.ts';

type Row = Record<string, any>;
type JsonBody = Record<string, unknown>;
const demographicGenders = new Set(['male', 'female']);
const demographicAgeGroups = new Set(['18_plus', '25_plus', '30_plus']);
const walletEmblemColumnNames = new Set(['resolved_emblem_key', 'resolved_emblem_url', 'emblem_updated_at']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: JsonBody, status = 200) {
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
    error_code: error?.error_code || 'EDGE_FUNCTION_ERROR',
    error_message: error?.error_message || error?.message || 'Scanner-Aktion fehlgeschlagen.',
    error_reason: error?.error_reason || 'Bitte prüfe die Anfrage und versuche es erneut.'
  }, status);
}

function hasOwn(source: Row, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function stringValue(value: unknown) {
  return String(value || '').trim();
}

const scannerActionsTemplateSelect = [
  'id',
  'business_name',
  'card_name',
  'card_type',
  'template_type',
  'description',
  'primary_color',
  'text_color',
  'logo_url',
  'businesses(name,logo_url)',
  'reward_text',
  'stamps_required',
  'streak_goal',
  'vip_tier',
  'settings',
  'club_features',
  'club_settings',
  'is_active'
].join(',');

const scannerActionsCardSelect = [
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
  'updated_at',
  'created_at',
  `card_templates(${scannerActionsTemplateSelect})`
].join(',');

function metadataFrom(card: Row) {
  return card.metadata && typeof card.metadata === 'object' && !Array.isArray(card.metadata)
    ? card.metadata
    : {};
}

const cloakroomReminderTimeZone = 'Europe/Zurich';

function zonedDateParts(date: Date, timeZone = cloakroomReminderTimeZone) {
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

function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone = cloakroomReminderTimeZone) {
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

function nextNoonAfter(value: unknown) {
  const baseDate = value ? new Date(String(value)) : new Date();

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

function validateManualScannerUpdates(template: Row, updates: Row) {
  const checks: Array<[string, FeatureName, string]> = [
    ['stamp_count', 'stamps', 'Diese Karte unterstützt keine Stempel-Funktion.'],
    ['streak_count', 'streak', 'Diese Karte unterstützt keine Streak-Funktion.'],
    ['vip_status', 'vip', 'Diese Karte unterstützt keine VIP-Funktion.'],
    ['balance_cents', 'balance', 'Diese Karte unterstützt keine Guthaben-Funktion.'],
    ['currency', 'balance', 'Diese Karte unterstützt keine Guthaben-Funktion.']
  ];

  for (const [fieldName, featureName, reason] of checks) {
    if (hasOwn(updates, fieldName) && !featureEnabled(template, featureName)) {
      throw createStructuredError(
        403,
        'ACTION_NOT_ALLOWED_FOR_TEMPLATE',
        'Aktion nicht erlaubt für diesen Kartentyp.',
        reason
      );
    }
  }
}

function normalizeScannerUpdates(template: Row, input: Row = {}) {
  const updates: Row = {};

  if (hasOwn(input, 'status')) {
    const status = stringValue(input.status) || 'active';

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

  if (hasOwn(input, 'stamp_count')) {
    updates.stamp_count = Math.max(0, Number(input.stamp_count || 0));
  }

  if (hasOwn(input, 'streak_count')) {
    updates.streak_count = Math.max(0, Number(input.streak_count || 0));
  }

  if (hasOwn(input, 'vip_status')) {
    updates.vip_status = input.vip_status ? String(input.vip_status) : null;
  }

  if (hasOwn(input, 'balance_cents')) {
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

  if (hasOwn(input, 'currency')) {
    const currency = stringValue(input.currency || 'CHF').toUpperCase();

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

  validateManualScannerUpdates(template, updates);
  return updates;
}

async function requireAuthenticatedOperator(supabaseAdmin: any, request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    throw createStructuredError(
      401,
      'AUTH_REQUIRED',
      'Bitte erneut einloggen.',
      'Die Edge Function hat keinen gültigen Login-Token erhalten.'
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

function activeClubFeaturesSnapshot(template: Row) {
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

function normalizeDemographics(input: unknown) {
  const source = input && typeof input === 'object' ? input as Row : {};
  const gender = stringValue(source.gender || source.customer_gender);
  const ageGroup = stringValue(source.age_group || source.ageGroup || source.customer_age_group);

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

function scanTimeParts(isoTimestamp: string) {
  const date = new Date(isoTimestamp);
  const weekday = date.getUTCDay();

  return {
    scan_hour: date.getUTCHours(),
    scan_weekday: weekday === 0 ? 7 : weekday
  };
}

function scannerActionLabel(action: string) {
  const labels: Row = {
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

  return (SCANNER_ACTIONS as Row)[action]?.label || labels[action] || action;
}

function scannerValidationError(validation: Row, template: Row) {
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

function isMissingWalletEmblemColumn(error: any) {
  const message = String(error?.message || error?.details || '');

  return error?.code === '42703'
    && Array.from(walletEmblemColumnNames).some((columnName) => message.includes(columnName));
}

function resolvedEmblemFieldsForInstance(nextInstance: Row = {}, now = new Date().toISOString(), previousInstance: Row = {}) {
  const resolvedEmblemKey = resolveCardEmblem(nextInstance);
  const resolvedEmblemUrl = supabaseCardEmblemUrl(
    {
      ...nextInstance,
      resolved_emblem_url: null
    },
    Deno.env.get('SUPABASE_URL') || ''
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

async function loadCardInstanceForScan(supabaseAdmin: any, card: Row) {
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

async function getGuestProfileForScan(supabaseAdmin: any, card: Row) {
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

function restrictionPermissions(role: string) {
  return {
    can_view: Boolean(role),
    can_view_reason: ['admin', 'manager', 'security'].includes(role),
    can_view_internal_note: ['admin', 'manager'].includes(role),
    can_create: ['admin', 'manager', 'security'].includes(role),
    can_update: ['admin', 'manager'].includes(role),
    can_lift: ['admin', 'manager'].includes(role)
  };
}

function publicOperatorRestrictions(payload: Row | null, role: string) {
  const permissions = restrictionPermissions(role);
  const sanitize = (restriction: Row) => ({
    id: restriction.id,
    restriction_type: restriction.restriction_type,
    status: restriction.status,
    starts_at: restriction.starts_at,
    ends_at: restriction.ends_at,
    reason: permissions.can_view_reason ? restriction.reason || null : null,
    internal_note: permissions.can_view_internal_note ? restriction.internal_note || null : null,
    created_at: restriction.created_at,
    updated_at: restriction.updated_at,
    lifted_at: restriction.lifted_at || null,
    lift_reason: permissions.can_view_reason ? restriction.lift_reason || null : null,
    is_currently_active: Boolean(restriction.is_currently_active)
  });

  return {
    active: Array.isArray(payload?.active) ? payload.active.map(sanitize) : [],
    history: Array.isArray(payload?.history) ? payload.history.map(sanitize) : [],
    permissions
  };
}

async function operatorRoleForCard(supabaseAdmin: any, card: Row, userId: string) {
  if (!card.business_id) {
    return card.owner_id === userId ? 'admin' : '';
  }

  const { data, error } = await supabaseAdmin.rpc('business_role_for_user', {
    p_business_id: card.business_id,
    p_user_id: userId
  });

  if (error) {
    throw createStructuredError(500, 'SCANNER_ROLE_LOAD_FAILED', 'Rolle konnte nicht geladen werden.', error.message);
  }

  return stringValue(data).toLowerCase();
}

async function getGuestRestrictionsForScan(supabaseAdmin: any, card: Row, role: string) {
  if (!card.business_id || !card.guest_profile_id) {
    return publicOperatorRestrictions(null, role);
  }

  const { data, error } = await supabaseAdmin.rpc('get_guest_restrictions_for_scan', {
    p_customer_card_id: card.id
  });

  if (error) {
    throw createStructuredError(500, 'SCANNER_RESTRICTIONS_LOAD_FAILED', 'Gaststatus konnte nicht geladen werden.', error.message);
  }

  return publicOperatorRestrictions(data, role);
}

async function manageGuestRestriction(supabaseAdmin: any, card: Row, userId: string, role: string, body: Row) {
  const action = stringValue(body.action).replace(/^restriction-/, '');
  const { data, error } = await supabaseAdmin.rpc('manage_guest_restriction', {
    p_customer_card_id: card.id,
    p_action: action,
    p_actor_id: userId,
    p_restriction_id: body.restrictionId || body.restriction_id || null,
    p_restriction_type: body.restrictionType || body.restriction_type || null,
    p_starts_at: body.startsAt || body.starts_at || null,
    p_ends_at: body.endsAt || body.ends_at || null,
    p_reason: body.reason || null,
    p_internal_note: body.internalNote || body.internal_note || null,
    p_lift_reason: body.liftReason || body.lift_reason || null
  });

  if (error) {
    const message = stringValue(error.message);
    const forbidden = message.includes('FORBIDDEN');
    throw createStructuredError(
      forbidden ? 403 : 400,
      forbidden ? 'RESTRICTION_WRITE_FORBIDDEN' : 'RESTRICTION_WRITE_FAILED',
      forbidden ? 'Keine Berechtigung für diese Änderung.' : 'Gaststatus konnte nicht gespeichert werden.',
      message
    );
  }

  return publicOperatorRestrictions(data, role);
}

function publicGuestInformation(payload: Row | null, role: string) {
  const canManage = ['admin', 'manager'].includes(role);
  return {
    regular_information: payload?.regular_information || null,
    notes: Array.isArray(payload?.notes) ? payload.notes : [],
    settings: {
      regular_info_auto_show: payload?.settings?.regular_info_auto_show === true,
      notes_auto_show_warning: payload?.settings?.notes_auto_show_warning !== false,
      notes_auto_show_important: payload?.settings?.notes_auto_show_important !== false,
      notes_auto_show_normal: payload?.settings?.notes_auto_show_normal === true
    },
    permissions: {
      can_edit_regular_information: canManage,
      can_create_note: ['admin', 'manager', 'security'].includes(role),
      can_update_note: canManage,
      can_delete_note: canManage
    }
  };
}

async function getGuestInformationForScan(supabaseAdmin: any, card: Row, role: string) {
  if (!card.business_id || !card.guest_profile_id) return publicGuestInformation(null, role);
  const { data, error } = await supabaseAdmin.rpc('get_guest_information_for_scan', {
    p_customer_card_id: card.id
  });
  if (error) throw createStructuredError(500, 'GUEST_INFO_LOAD_FAILED', 'Gastinformationen konnten nicht geladen werden.', error.message);
  return publicGuestInformation(data, role);
}

async function manageGuestInformation(supabaseAdmin: any, card: Row, userId: string, role: string, body: Row) {
  let response;
  if (stringValue(body.action) === 'regular-info-save') {
    response = await supabaseAdmin.rpc('manage_guest_regular_information', {
      p_customer_card_id: card.id,
      p_actor_id: userId,
      p_general_info: body.generalInfo || null,
      p_favorite_drink: body.favoriteDrink || null,
      p_preferred_area: body.preferredArea || null,
      p_further_preferences: body.furtherPreferences || null,
      p_other_internal_info: body.otherInternalInfo || null
    });
  } else {
    response = await supabaseAdmin.rpc('manage_guest_note', {
      p_customer_card_id: card.id,
      p_action: stringValue(body.action).replace(/^guest-note-/, ''),
      p_actor_id: userId,
      p_note_id: body.noteId || null,
      p_note_text: body.noteText || null,
      p_priority: body.priority || 'NORMAL',
      p_delete_reason: body.deleteReason || null
    });
  }
  if (response.error) {
    const message = stringValue(response.error.message);
    const forbidden = message.includes('FORBIDDEN');
    throw createStructuredError(forbidden ? 403 : 400, forbidden ? 'GUEST_INFO_WRITE_FORBIDDEN' : 'GUEST_INFO_WRITE_FAILED', forbidden ? 'Keine Berechtigung für diese Änderung.' : 'Gastinformationen konnten nicht gespeichert werden.', message);
  }
  return publicGuestInformation(response.data, role);
}

function demographicsRequiredPayload(card: Row, instance: Row, template: Row, action: string) {
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

async function loadCard(supabaseAdmin: any, body: Row) {
  const cardId = stringValue(body.cardId || body.card_id || body.customerCardId || body.customer_card_id);
  const code = stringValue(body.customer_code || body.customerCode || body.cardInstanceNumber || body.card_instance_number || body.code);

  if (cardId) {
    const { data, error } = await supabaseAdmin
      .from('customer_cards')
      .select(scannerActionsCardSelect)
      .eq('id', cardId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  if (!code) {
    throw createStructuredError(
      400,
      'CARD_ID_REQUIRED',
      'Karten-ID fehlt.',
      'Die Scanner-Aktion braucht eine Kundenkarten-ID, Karten-ID oder einen Kundencode.'
    );
  }

  const { data: byCustomerCode, error: customerCodeError } = await supabaseAdmin
    .from('customer_cards')
    .select(scannerActionsCardSelect)
    .eq('customer_code', code)
    .maybeSingle();

  if (customerCodeError) {
    throw customerCodeError;
  }

  if (byCustomerCode) {
    return byCustomerCode;
  }

  const { data: byInstanceNumber, error: instanceNumberError } = await supabaseAdmin
    .from('customer_cards')
    .select(scannerActionsCardSelect)
    .eq('card_instance_number', code)
    .maybeSingle();

  if (instanceNumberError) {
    throw instanceNumberError;
  }

  return byInstanceNumber;
}

function applyScannerAction(card: Row, template: Row, body: Row, now: string) {
  const action = stringValue(body.action);
  let normalizedAction = action;
  let updates: Row = {};

  if (action === 'manual_update') {
    updates = normalizeScannerUpdates(template, body.updates as Row || {});
    return { updates, normalizedAction };
  }

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
      ...metadataFrom(card),
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
      ...metadataFrom(card),
      last_streak_completed_at: now,
      completed_streak_count: streakCount,
      completed_streak_goal: streakGoal
    };
  }

  if (normalizedAction === 'vip-update') {
    updates.vip_status = body.vipStatus ? String(body.vipStatus) : null;
  }

  if (normalizedAction === 'vip-benefit-redeem') {
    const metadata = metadataFrom(card);
    const usedBenefits = Array.isArray(metadata.vip_benefits_used) ? metadata.vip_benefits_used : [];
    const benefitLabel = body.vipBenefitLabel ? String(body.vipBenefitLabel) : null;

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
    const metadata = metadataFrom(card);
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
      ...metadataFrom(card),
      coupon_status: 'redeemed',
      coupon_redeemed_at: now,
      last_coupon_redeemed_at: now
    };
    updates.status = 'redeemed';
  }

  if (normalizedAction === 'balance-redeem') {
    const amountCents = Math.round(Number(body.amountCents || 0));
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
      ...metadataFrom(card),
      balance_cents: updates.balance_cents,
      last_balance_redeem_at: now,
      last_balance_redeem_cents: amountCents
    };
  }

  if (normalizedAction === 'balance-adjust') {
    const balanceCents = Math.round(Number(body.balanceCents ?? body.newBalanceCents ?? 0));
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
      ...metadataFrom(card),
      balance_cents: balanceCents,
      last_balance_adjusted_at: now,
      last_balance_adjustment_delta_cents: balanceCents - currentBalance
    };
  }

  if (normalizedAction === 'visit') {
    const metadata = metadataFrom(card);

    updates.metadata = {
      ...metadata,
      visit_count: Number(metadata.visit_count || 0) + 1,
      last_visit_at: now
    };
  }

  if (['checkin', 'event-checkout', 'event-ticket-use'].includes(normalizedAction)) {
    const metadata = metadataFrom(card);

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
      ...metadataFrom(card),
      last_matrix_action: normalizedAction,
      last_requested_action: action,
      last_matrix_action_at: now
    };
  }

  if (normalizedAction === 'membership-status-update') {
    const metadata = metadataFrom(card);
    const membershipStatus = stringValue(body.membershipStatus);

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
    const metadata = metadataFrom(card);
    const membershipExpiresAt = stringValue(body.membershipExpiresAt);

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

  return { updates, normalizedAction };
}

async function syncCardInstance(supabaseAdmin: any, updatedCard: Row, template: Row, now: string, scanContext: Row = {}) {
  const walletSerialNumber = updatedCard.wallet_platform === 'google'
    ? updatedCard.wallet_object_id || updatedCard.wallet_serial_number || updatedCard.pass_serial_number
    : updatedCard.pass_serial_number;
  const metadata = metadataFrom(updatedCard);
  let instance = scanContext.instance || null;

  if (!instance) {
    instance = await loadCardInstanceForScan(supabaseAdmin, updatedCard);
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
    'wallet_platform',
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
  let { data: updatedInstance, error: updateError } = await supabaseAdmin
    .from('card_instances')
    .update(instancePayload)
    .eq('id', cardInstanceId)
    .eq('customer_card_id', updatedCard.id)
    .select(updateSelectColumns.join(','))
    .maybeSingle();

  if (isMissingWalletEmblemColumn(updateError)) {
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
    updateError = fallbackResult.error;
  }

  if (updateError || !updatedInstance) {
    throw createStructuredError(
      500,
      'SCANNER_CARD_INSTANCE_SYNC_FAILED',
      'Karteninstanz konnte nicht synchronisiert werden.',
      updateError?.message || 'card_instances.update hat keine passende Karteninstanz aktualisiert.'
    );
  }

  return {
    id: updatedInstance.id,
    card_instance_number: updatedInstance.card_instance_number || instance.card_instance_number || updatedCard.card_instance_number,
    wallet_platform: updatedInstance.wallet_platform || updatedCard.wallet_platform,
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

async function recordWalletEmblemUpdate(supabaseAdmin: any, card: Row, cardInstance: Row, reason = 'scanner_demographics') {
  const walletPlatform = card?.wallet_platform;
  const shouldQueueWalletUpdate = Boolean(
    cardInstance?.emblem_changed
      && card?.business_id
      && cardInstance?.id
      && ['apple', 'google'].includes(walletPlatform)
  );
  let updateQueued = false;
  let updateError: string | null = null;

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
          source: 'scanner_actions_edge_function',
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

async function insertScannerBalanceTransaction(supabaseAdmin: any, payload: Row) {
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

async function insertScannerEvent(supabaseAdmin: any, payload: Row) {
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

async function insertScanEvent(supabaseAdmin: any, payload: Row) {
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

function clubActionForScannerAction(action: string, beforeCard: Row, afterUpdates: Row): [string, string] | null {
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

  return null;
}

async function insertClubCardAction(supabaseAdmin: any, payload: Row) {
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

function zurichDateKey(value: string) {
  const date = new Date(value);
  const parts = zonedDateParts(date);
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');

  return `${parts.year}-${month}-${day}`;
}

async function maybeScheduleCloakroomNoonReminder(supabaseAdmin: any, card: Row, template: Row, cardInstance: Row, userId: string) {
  const metadata = metadataFrom(card);
  const cloakroomActive = Boolean(card.cloakroom_active ?? metadata.cloakroom_active);

  if (!cloakroomActive || !card.business_id || !cardInstance?.id || !featureEnabled(template, 'cloakroom')) {
    return {
      scheduled: false,
      reason: 'cloakroom_not_active'
    };
  }

  const scheduledAt = stringValue(metadata.cloakroom_noon_reminder_at);
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;

  if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
    return {
      scheduled: false,
      reason: 'cloakroom_noon_reminder_at_missing'
    };
  }

  const message = stringValue(metadata.cloakroom_noon_message)
    || 'Deine Garderobe ist noch hinterlegt. Bitte prüfe die Abholung.';
  const title = 'Garderoben-Erinnerung';
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
        title,
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

function normalizedLocationNumber(value: unknown, decimals = 6) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return null;
  }

  return Number(numberValue.toFixed(decimals));
}

async function maybeScheduleCloakroomLocationReminder(supabaseAdmin: any, card: Row, template: Row, cardInstance: Row, userId: string) {
  const metadata = metadataFrom(card);
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

  const message = stringValue(metadata.cloakroom_location_message)
    || 'Du bist wieder in der Nähe. Deine Garderobe kann abgeholt werden.';
  const title = stringValue(metadata.cloakroom_location_name)
    ? `Garderobe bei ${metadata.cloakroom_location_name}`
    : 'Garderobe in der Nähe';
  const startedAt = stringValue(metadata.cloakroom_started_at || card.cloakroom_started_at || new Date().toISOString());
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur POST ist erlaubt.',
      error_reason: 'Scanner-Aktionen müssen als POST an die Edge Function gesendet werden.'
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
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    const user = await requireAuthenticatedOperator(supabaseAdmin, request);
    const card = await loadCard(supabaseAdmin, body);

    if (!card) {
      throw createStructuredError(
        404,
        'CARD_NOT_FOUND',
        'Kundenkarte nicht gefunden.',
        'Die Karte existiert nicht oder wurde entfernt.'
      );
    }

    const operatorRole = await operatorRoleForCard(supabaseAdmin, card, user.id);

    if (!operatorRole) {
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
    const action = stringValue(body.action);
    const cardInstanceBeforeScan = await loadCardInstanceForScan(supabaseAdmin, card);
    const restrictions = await getGuestRestrictionsForScan(supabaseAdmin, card, operatorRole);
    const guestInformation = await getGuestInformationForScan(supabaseAdmin, card, operatorRole);

    if (action === 'inspect') {
      const guestProfile = await getGuestProfileForScan(supabaseAdmin, card);

      return json({
        ok: true,
        action: 'inspect',
        card: publicOperatorCard(card),
        guest_profile: guestProfile,
        guest_restrictions: restrictions,
        guest_information: guestInformation,
        operator_role: operatorRole,
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
    }

    if (['restriction-create', 'restriction-update', 'restriction-lift'].includes(action)) {
      const updatedRestrictions = await manageGuestRestriction(supabaseAdmin, card, user.id, operatorRole, body);

      return json({
        ok: true,
        action,
        card: publicOperatorCard(card),
        guest_profile: await getGuestProfileForScan(supabaseAdmin, card),
        guest_restrictions: updatedRestrictions,
        guest_information: guestInformation,
        operator_role: operatorRole,
        card_instance: cardInstanceBeforeScan
      });
    }

    if (['regular-info-save', 'guest-note-create', 'guest-note-update', 'guest-note-delete'].includes(action)) {
      const updatedGuestInformation = await manageGuestInformation(supabaseAdmin, card, user.id, operatorRole, body);
      return json({
        ok: true,
        action,
        card: publicOperatorCard(card),
        guest_profile: await getGuestProfileForScan(supabaseAdmin, card),
        guest_restrictions: restrictions,
        guest_information: updatedGuestInformation,
        operator_role: operatorRole,
        card_instance: cardInstanceBeforeScan
      });
    }

    if (restrictions.active.length > 0 && body.restrictionAcknowledged !== true) {
      return json({
        ok: true,
        requires_restriction_acknowledgement: true,
        message: 'Aktive Gastrestriktion muss vor der Scanner-Aktion bestaetigt werden.',
        guest_restrictions: restrictions,
        operator_role: operatorRole
      });
    }

    let preflightAction = action;

    if (action !== 'manual_update') {
      const validation = validateScannerAction(template, action);

      if (!validation.allowed) {
        throw scannerValidationError(validation, template);
      }

      preflightAction = validation.action;
    }

    const demographics = normalizeDemographics(body.demographics || body);

    if (!cardInstanceBeforeScan.demographics_collected && !demographics) {
      return json(demographicsRequiredPayload(card, cardInstanceBeforeScan, template, preflightAction));
    }

    const { updates, normalizedAction } = applyScannerAction(card, template, body, now);
    updates.last_scanned_at = now;

    const { data: updatedCard, error: updateError } = await supabaseAdmin
      .from('customer_cards')
      .update(updates)
      .eq('id', card.id)
      .eq('owner_id', card.owner_id)
      .select(scannerActionsCardSelect)
      .single();

    if (updateError) {
      throw updateError;
    }

    const updatedCardInstance = await syncCardInstance(supabaseAdmin, updatedCard, template, now, {
      instance: cardInstanceBeforeScan,
      demographics,
      userId: user.id
    });
    const emblemUpdate = await recordWalletEmblemUpdate(
      supabaseAdmin,
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
        cloakroomReminder = await maybeScheduleCloakroomNoonReminder(
          supabaseAdmin,
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
        cloakroomLocationReminder = await maybeScheduleCloakroomLocationReminder(
          supabaseAdmin,
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

    const scanEventId = await insertScanEvent(supabaseAdmin, {
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
        source: 'scanner_actions_edge_function',
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
      await insertClubCardAction(supabaseAdmin, {
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
      const amountCents = Math.round(Number(body.amountCents || 0));

      await insertScannerBalanceTransaction(supabaseAdmin, {
        owner_id: card.owner_id,
        business_id: card.business_id,
        card_instance_id: cardInstanceId,
        amount_cents: -amountCents,
        currency: updatedCard.currency || template.settings?.currency || 'CHF',
        type: 'redeem',
        status: 'succeeded',
        created_by: user.id,
        details: {
          source: 'scanner_actions_edge_function',
          previous_balance_cents: card.balance_cents ?? card.metadata?.balance_cents ?? 0,
          new_balance_cents: updatedCard.balance_cents ?? updatedCard.metadata?.balance_cents ?? 0
        }
      });
    }

    if (normalizedAction === 'balance-adjust') {
      const previousBalanceCents = Number(card.balance_cents ?? card.metadata?.balance_cents ?? 0);
      const newBalanceCents = Number(updatedCard.balance_cents ?? updatedCard.metadata?.balance_cents ?? 0);

      await insertScannerBalanceTransaction(supabaseAdmin, {
        owner_id: card.owner_id,
        business_id: card.business_id,
        card_instance_id: cardInstanceId,
        amount_cents: newBalanceCents - previousBalanceCents,
        currency: updatedCard.currency || template.settings?.currency || 'CHF',
        type: 'manual_adjustment',
        status: 'succeeded',
        created_by: user.id,
        details: {
          source: 'scanner_actions_edge_function',
          previous_balance_cents: previousBalanceCents,
          new_balance_cents: newBalanceCents
        }
      });
    }

    await insertScannerEvent(supabaseAdmin, {
      owner_id: card.owner_id,
      business_id: card.business_id,
      template_id: card.template_id,
      customer_card_id: card.id,
      event_type: normalizedAction,
      details: {
        source: 'scanner_actions_edge_function',
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
          balance_cents: card.balance_cents,
          metadata: card.metadata
        },
        after: updates
      },
      created_by: user.id
    });

    const guestProfile = await getGuestProfileForScan(supabaseAdmin, updatedCard);

    return json({
      ok: true,
      action: normalizedAction,
      requestedAction: action,
      template_type: normalizeTemplateType(template),
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
      guest_restrictions: await getGuestRestrictionsForScan(supabaseAdmin, updatedCard, operatorRole),
      guest_information: await getGuestInformationForScan(supabaseAdmin, updatedCard, operatorRole),
      operator_role: operatorRole,
      card: publicOperatorCard(updatedCard)
    });
  } catch (error) {
    return errorJson(error);
  }
});
