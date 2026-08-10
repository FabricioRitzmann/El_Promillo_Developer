import { appleWalletProvider } from '../_shared/appleWalletProvider.ts';
import { publicApplePassVersion, publicWalletOperationPayload } from '../_shared/publicResponses.ts';
import { corsHeaders, createStructuredError, errorJson, json, walletNotificationService } from '../_shared/walletNotificationService.ts';

function stringValue(value: unknown) {
  return String(value || '').trim();
}

const IDEMPOTENCY_SCOPE = 'update-apple-pass';
const APPLE_PASS_UPDATE_FIELDS_MAX_JSON_BYTES = 5000;
const FORBIDDEN_APPLE_PASS_UPDATE_FIELD_KEYS = new Set([
  'formatversion',
  'passtypeidentifier',
  'serialnumber',
  'teamidentifier',
  'authenticationtoken',
  'webserviceurl',
  'barcode',
  'barcodes',
  'nfc'
]);

const updateAppleTemplateSelect = [
  'id',
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
  'is_active'
].join(',');

const updateAppleCustomerCardSelect = [
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
  'pass_authentication_token',
  'balance_cents',
  'currency',
  'cloakroom_active',
  'cloakroom_started_at',
  'cloakroom_completed_at',
  'metadata',
  'updated_at'
].join(',');

const updateAppleCardInstanceSelect = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
  'customer_id',
  'customer_card_id',
  'card_instance_number',
  'wallet_platform',
  'wallet_object_id',
  'wallet_serial_number',
  'apple_serial_number',
  'demographics_collected',
  'customer_gender',
  'customer_age_group',
  'resolved_emblem_key',
  'resolved_emblem_url',
  'emblem_updated_at',
  'current_streak',
  'current_stamps',
  'lifetime_visits',
  'vip_level',
  'balance_cents',
  'currency',
  'cloakroom_active',
  'cloakroom_started_at',
  'cloakroom_completed_at',
  'push_enabled',
  'last_wallet_update_at',
  'last_notification_at',
  'notification_count_24h',
  `card_templates(${updateAppleTemplateSelect})`,
  `customer_cards(${updateAppleCustomerCardSelect})`
].join(',');

function idempotencyKeyFrom(request: Request, body: Record<string, any>) {
  return stringValue(request.headers.get('idempotency-key') || body.idempotencyKey || body.idempotency_key);
}

function validateIdempotencyKey(idempotencyKey: string) {
  if (idempotencyKey && idempotencyKey.length > 200) {
    throw createStructuredError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key ist zu lang.', 'Der Idempotency-Key darf maximal 200 Zeichen enthalten.');
  }
}

function cachedStatusCode(status: string) {
  if (status === 'processing') {
    return 202;
  }

  if (status === 'limited') {
    return 429;
  }

  if (status === 'skipped') {
    return 409;
  }

  return status === 'failed' ? 502 : 200;
}

function payloadObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function isPlainObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizedKey(key: string) {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function jsonByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function validateApplePassUpdateFields(fields: Record<string, any>) {
  if (jsonByteLength(fields) > APPLE_PASS_UPDATE_FIELDS_MAX_JSON_BYTES) {
    throw createStructuredError(
      400,
      'APPLE_PASS_UPDATE_FIELDS_TOO_LARGE',
      'Apple-Pass-Felder sind zu gross.',
      'Sende für manuelle Updates nur kurze sichtbare Felder oder eine Nachricht. Maximal erlaubt sind 5000 Bytes JSON.'
    );
  }

  const forbiddenKeys = Object.keys(fields).filter((key) => FORBIDDEN_APPLE_PASS_UPDATE_FIELD_KEYS.has(normalizedKey(key)));

  if (forbiddenKeys.length) {
    throw createStructuredError(
      400,
      'APPLE_PASS_UPDATE_FIELD_FORBIDDEN',
      'Apple-Pass-Kernfelder dürfen nicht manuell geändert werden.',
      `Diese Felder werden serverseitig aus Secrets und Karteninstanz gesetzt: ${forbiddenKeys.join(', ')}.`
    );
  }
}

async function findExistingManualApplePassUpdate(context: Record<string, any>, cardInstance: Record<string, any>, idempotencyKey: string) {
  if (!idempotencyKey) {
    return null;
  }

  const { data, error } = await context.supabaseAdmin
    .from('wallet_push_logs')
    .select('id,status,response_payload,error_message,created_at')
    .eq('owner_id', context.ownerId)
    .eq('business_id', cardInstance.business_id)
    .eq('card_instance_id', cardInstance.id)
    .eq('wallet_platform', 'apple')
    .is('campaign_id', null)
    .eq('request_payload->>idempotency_scope', IDEMPOTENCY_SCOPE)
    .eq('request_payload->>idempotency_key', idempotencyKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function logApplePassUpdate(context: Record<string, any>, cardInstance: Record<string, any>, status: string, requestPayload: Record<string, any>, responsePayload: Record<string, any>, errorMessage: string | null = null, reservation: Record<string, any> | null = null) {
  if (reservation?.id) {
    await walletNotificationService.finalizeManualIdempotencyReservation(context, reservation, {
      action: 'manual_apple_pass_update',
      status,
      requestPayload,
      responsePayload,
      errorMessage
    });
    return;
  }

  const { error: logError } = await context.supabaseAdmin.from('wallet_push_logs').insert({
    owner_id: context.ownerId,
    business_id: cardInstance.business_id,
    card_instance_id: cardInstance.id,
    wallet_platform: 'apple',
    action: 'manual_apple_pass_update',
    status,
    request_payload: requestPayload,
    response_payload: responsePayload,
    error_message: errorMessage
  });

  if (logError) {
    throw createStructuredError(
      500,
      'WALLET_PUSH_LOG_INSERT_FAILED',
      'Wallet Audit-Log konnte nicht gespeichert werden.',
      logError.message || 'manual_apple_pass_update konnte nicht in wallet_push_logs geschrieben werden.'
    );
  }
}

function passFieldsFromBody(body: Record<string, any>) {
  const message = stringValue(body.message);
  if (body.fields !== undefined && !isPlainObject(body.fields)) {
    throw createStructuredError(
      400,
      'INVALID_APPLE_PASS_UPDATE_FIELDS',
      'Apple-Pass-Felder sind ungültig.',
      'fields muss ein JSON-Objekt sein.'
    );
  }

  const fields = body.fields ? body.fields : {};
  validateApplePassUpdateFields(fields);

  const passFields: Record<string, any> = {
    ...fields
  };

  if (message) {
    passFields.latestMessage = message;
    passFields.message = message;
    passFields.newMessageCount = 1;
  }

  if (!Object.keys(passFields).length) {
    throw createStructuredError(
      400,
      'APPLE_PASS_UPDATE_FIELDS_REQUIRED',
      'Apple-Pass-Felder fehlen.',
      'Sende message oder fields, damit eine sichtbare Pass-Version erstellt werden kann.'
    );
  }

  if (stringValue(passFields.message || passFields.latestMessage).length > 500) {
    throw createStructuredError(
      400,
      'INVALID_APPLE_PASS_UPDATE_MESSAGE',
      'Nachricht ist zu lang.',
      'Apple-Pass-Nachrichten dürfen maximal 500 Zeichen enthalten.'
    );
  }

  return passFields;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error_code: 'METHOD_NOT_ALLOWED', error_message: 'Nur POST ist erlaubt.', error_reason: 'Apple-Pass-Updates werden per POST erstellt.' }, 405);
  }

  let context: Record<string, any> | null = null;
  let idempotencyReservation: Record<string, any> | null = null;

  try {
    context = await walletNotificationService.context(request);
    const body = await request.json().catch(() => ({}));
    const cardInstanceId = stringValue(body.cardInstanceId || body.card_instance_id);
    const idempotencyKey = idempotencyKeyFrom(request, body);

    if (!cardInstanceId) {
      throw createStructuredError(400, 'CARD_INSTANCE_ID_REQUIRED', 'Karteninstanz-ID fehlt.', 'Sende cardInstanceId an diese Function.');
    }

    validateIdempotencyKey(idempotencyKey);

    const { data: cardInstance, error } = await context.supabaseAdmin
      .from('card_instances')
      .select(updateAppleCardInstanceSelect)
      .eq('id', cardInstanceId)
      .eq('owner_id', context.ownerId)
      .eq('business_id', context.business.id)
      .eq('wallet_platform', 'apple')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!cardInstance) {
      throw createStructuredError(404, 'APPLE_CARD_NOT_FOUND', 'Apple-Karte nicht gefunden.', 'Die Karte existiert nicht oder gehört nicht zu deinem Account.');
    }

    const existingResult = await findExistingManualApplePassUpdate(context, cardInstance, idempotencyKey);

    if (existingResult) {
      return json({
        reused: true,
        idempotencyKey,
        status: existingResult.status,
        error_message: existingResult.error_message || null,
        ...publicWalletOperationPayload(existingResult.response_payload)
      }, cachedStatusCode(existingResult.status));
    }

    const passFields = passFieldsFromBody(body);
    let requestPayload = {
      card_instance_id: cardInstance.id,
      fields: passFields,
      ...(idempotencyKey ? { idempotency_scope: IDEMPOTENCY_SCOPE, idempotency_key: idempotencyKey } : {})
    };
    const reservedIdempotency = await walletNotificationService.reserveManualIdempotency(context, cardInstance, {
      walletPlatform: 'apple',
      action: 'manual_apple_pass_update',
      idempotencyScope: IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestPayload
    });

    if (reservedIdempotency.existingResult) {
      const existingResult = reservedIdempotency.existingResult;

      return json({
        reused: true,
        idempotencyKey,
        status: existingResult.status,
        error_message: existingResult.error_message || null,
        ...publicWalletOperationPayload(existingResult.response_payload)
      }, cachedStatusCode(existingResult.status));
    }

    requestPayload = reservedIdempotency.requestPayload;
    idempotencyReservation = reservedIdempotency.reservedLog;
    const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'apple');

    if (!limits.allowed) {
      const blockedStatus = limits.status === 'skipped' ? 'skipped' : 'limited';
      await logApplePassUpdate(context, cardInstance, blockedStatus, requestPayload, limits, limits.error_message || limits.error_reason || null, idempotencyReservation);

      return json(limits, blockedStatus === 'skipped' ? 409 : 429);
    }

    const passVersion = await appleWalletProvider.updatePassFields(context.supabaseAdmin, cardInstance, cardInstance.card_templates, passFields, {
      reason: 'manual_apple_pass_update'
    });

    await logApplePassUpdate(
      context,
      cardInstance,
      'queued',
      requestPayload,
      {
        pass_version_id: passVersion.id,
        version: passVersion.version,
        queued_for_push: true
      },
      null,
      idempotencyReservation
    );

    await walletNotificationService.updateCardWalletState(context, cardInstance.id, {
      walletUpdated: true,
      visibleNotification: false,
      countNotifications: false
    });

    return json({
      ok: true,
      status: 'queued',
      passVersion: publicApplePassVersion(passVersion)
    });
  } catch (error) {
    await walletNotificationService.failManualIdempotencyReservation(
      context,
      idempotencyReservation,
      error,
      'UPDATE_APPLE_PASS_ERROR'
    );

    return errorJson(error, 'UPDATE_APPLE_PASS_ERROR');
  }
});
