import { googleWalletProvider } from '../_shared/googleWalletProvider.ts';
import { publicWalletOperationPayload, publicWalletProviderResult } from '../_shared/publicResponses.ts';
import { corsHeaders, createStructuredError, errorJson, json, walletNotificationService } from '../_shared/walletNotificationService.ts';

function stringValue(value: unknown) {
  return String(value || '').trim();
}

const IDEMPOTENCY_SCOPE = 'update-google-wallet-pass';
const GOOGLE_WALLET_PATCH_MAX_JSON_BYTES = 8000;
const FORBIDDEN_GOOGLE_WALLET_PATCH_KEYS = new Set([
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

const updateGoogleTemplateSelect = [
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

const updateGoogleCustomerCardSelect = [
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
  'wallet_object_id',
  'wallet_serial_number',
  'balance_cents',
  'currency',
  'cloakroom_active',
  'cloakroom_started_at',
  'cloakroom_completed_at',
  'metadata',
  'updated_at'
].join(',');

const updateGoogleWalletObjectSelect = [
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

const updateGoogleCardInstanceSelect = [
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
  'google_object_id',
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
  `card_templates(${updateGoogleTemplateSelect})`,
  `customer_cards(${updateGoogleCustomerCardSelect})`,
  `google_wallet_objects(${updateGoogleWalletObjectSelect})`
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

function normalizedPatchKey(key: string) {
  return key.toLowerCase().replace(/-/g, '_');
}

function jsonByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function validateGoogleWalletPatch(patch: Record<string, any>) {
  if (jsonByteLength(patch) > GOOGLE_WALLET_PATCH_MAX_JSON_BYTES) {
    throw createStructuredError(
      400,
      'GOOGLE_PATCH_TOO_LARGE',
      'Google Patch ist zu gross.',
      'Sende für manuelle Google-Wallet-Updates nur gezielte sichtbare Statusfelder. Maximal erlaubt sind 8000 Bytes JSON.'
    );
  }

  const forbiddenKeys = Object.keys(patch).filter((key) => {
    const normalized = normalizedPatchKey(key);
    return FORBIDDEN_GOOGLE_WALLET_PATCH_KEYS.has(normalized) || FORBIDDEN_GOOGLE_WALLET_PATCH_KEYS.has(normalized.replace(/_/g, ''));
  });

  if (forbiddenKeys.length) {
    throw createStructuredError(
      400,
      'GOOGLE_PATCH_FIELD_FORBIDDEN',
      'Google-Wallet-Kernfelder dürfen nicht manuell geändert werden.',
      `Diese Felder werden serverseitig aus der gespeicherten Karteninstanz gesetzt: ${forbiddenKeys.join(', ')}.`
    );
  }
}

async function findExistingManualGoogleObjectUpdate(context: Record<string, any>, cardInstance: Record<string, any>, idempotencyKey: string) {
  if (!idempotencyKey) {
    return null;
  }

  const { data, error } = await context.supabaseAdmin
    .from('wallet_push_logs')
    .select('id,status,response_payload,error_message,created_at')
    .eq('owner_id', context.ownerId)
    .eq('business_id', cardInstance.business_id)
    .eq('card_instance_id', cardInstance.id)
    .eq('wallet_platform', 'google')
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

async function logGoogleObjectUpdate(context: Record<string, any>, cardInstance: Record<string, any>, reservation: Record<string, any> | null, payload: Record<string, any>) {
  if (reservation?.id) {
    await walletNotificationService.finalizeManualIdempotencyReservation(context, reservation, {
      action: 'manual_google_object_update',
      status: payload.status,
      requestPayload: payload.requestPayload,
      responsePayload: payload.responsePayload,
      errorMessage: payload.errorMessage
    });
    return;
  }

  const { error: logError } = await context.supabaseAdmin.from('wallet_push_logs').insert({
    owner_id: context.ownerId,
    business_id: cardInstance.business_id,
    card_instance_id: cardInstance.id,
    wallet_platform: 'google',
    action: 'manual_google_object_update',
    status: payload.status,
    request_payload: payload.requestPayload,
    response_payload: payload.responsePayload,
    error_message: payload.errorMessage
  });

  if (logError) {
    throw createStructuredError(
      500,
      'WALLET_PUSH_LOG_INSERT_FAILED',
      'Wallet Audit-Log konnte nicht gespeichert werden.',
      logError.message || 'manual_google_object_update konnte nicht in wallet_push_logs geschrieben werden.'
    );
  }
}

async function loadGoogleCardContext(context: Record<string, any>, cardInstanceId: string, objectId: string) {
  if (cardInstanceId) {
    const { data: cardInstance, error } = await context.supabaseAdmin
      .from('card_instances')
      .select(updateGoogleCardInstanceSelect)
      .eq('id', cardInstanceId)
      .eq('owner_id', context.ownerId)
      .eq('business_id', context.business.id)
      .eq('wallet_platform', 'google')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!cardInstance) {
      throw createStructuredError(404, 'GOOGLE_CARD_NOT_FOUND', 'Google-Karte nicht gefunden.', 'Die Karte existiert nicht oder gehört nicht zu deinem Account.');
    }

    const googleObject = Array.isArray(cardInstance.google_wallet_objects)
      ? cardInstance.google_wallet_objects[0]
      : cardInstance.google_wallet_objects;
    const storedObjectId = stringValue(googleObject?.object_id || cardInstance.google_object_id || cardInstance.wallet_object_id);

    if (objectId && storedObjectId && objectId !== storedObjectId) {
      throw createStructuredError(
        403,
        'GOOGLE_OBJECT_ID_MISMATCH',
        'Google Object ID passt nicht zur Karte.',
        'Die angefragte Object ID gehört nicht zur ausgewählten Karteninstanz.'
      );
    }

    if (!storedObjectId && !objectId) {
      throw createStructuredError(
        400,
        'GOOGLE_OBJECT_ID_MISSING',
        'Google Object ID fehlt.',
        'Synchronisiere zuerst das Google Wallet Object für diese Karte.'
      );
    }

    return {
      cardInstance,
      googleObject,
      objectId: storedObjectId || objectId,
      objectType: googleWalletProvider.normalizeObjectType(
        googleObject?.object_type || googleWalletProvider.objectTypeForTemplate(cardInstance.card_templates)
      )
    };
  }

  if (!objectId) {
    throw createStructuredError(
      400,
      'GOOGLE_CARD_OR_OBJECT_REQUIRED',
      'Google-Karte fehlt.',
      'Sende cardInstanceId oder eine Object ID, die in google_wallet_objects deinem Account zugeordnet ist.'
    );
  }

  const { data: googleObject, error: objectError } = await context.supabaseAdmin
    .from('google_wallet_objects')
    .select(updateGoogleWalletObjectSelect)
    .eq('object_id', objectId)
    .eq('owner_id', context.ownerId)
    .eq('business_id', context.business.id)
    .maybeSingle();

  if (objectError) {
    throw objectError;
  }

  if (!googleObject) {
    throw createStructuredError(
      404,
      'GOOGLE_OBJECT_NOT_FOUND',
      'Google Wallet Object nicht gefunden.',
      'Die Object ID existiert nicht in deinem Account und wird deshalb nicht serverseitig gepatcht.'
    );
  }

  const { data: cardInstance, error: cardError } = await context.supabaseAdmin
    .from('card_instances')
    .select(updateGoogleCardInstanceSelect)
    .eq('id', googleObject.card_instance_id)
    .eq('owner_id', context.ownerId)
    .eq('business_id', context.business.id)
    .eq('wallet_platform', 'google')
    .maybeSingle();

  if (cardError) {
    throw cardError;
  }

  if (!cardInstance) {
    throw createStructuredError(404, 'GOOGLE_CARD_NOT_FOUND', 'Google-Karte nicht gefunden.', 'Die Object ID ist keiner gültigen Karteninstanz deines Accounts zugeordnet.');
  }

  return {
    cardInstance,
    googleObject,
    objectId: googleObject.object_id,
    objectType: googleWalletProvider.normalizeObjectType(googleObject.object_type)
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error_code: 'METHOD_NOT_ALLOWED', error_message: 'Nur POST ist erlaubt.', error_reason: 'Google-Wallet-Objects werden per POST aktualisiert.' }, 405);
  }

  let context: Record<string, any> | null = null;
  let idempotencyReservation: Record<string, any> | null = null;

  try {
    context = await walletNotificationService.context(request);
    const body = await request.json().catch(() => ({}));
    const cardInstanceId = stringValue(body.cardInstanceId || body.card_instance_id);
    const objectId = stringValue(body.objectId || body.object_id);
    const idempotencyKey = idempotencyKeyFrom(request, body);
    const wantsStatusRefresh = Boolean(body.refreshStatus || body.refresh_status);

    if (body.patch !== undefined && !isPlainObject(body.patch)) {
      throw createStructuredError(400, 'INVALID_GOOGLE_PATCH', 'Google Patch ist ungültig.', 'patch muss ein JSON-Objekt sein.');
    }

    const patch = body.patch ? body.patch : {};
    validateGoogleWalletPatch(patch);

    validateIdempotencyKey(idempotencyKey);

    const resolved = await loadGoogleCardContext(context, cardInstanceId, objectId);
    const existingResult = await findExistingManualGoogleObjectUpdate(context, resolved.cardInstance, idempotencyKey);

    if (existingResult) {
      return json({
        reused: true,
        idempotencyKey,
        status: existingResult.status,
        error_message: existingResult.error_message || null,
        ...publicWalletOperationPayload(existingResult.response_payload)
      }, cachedStatusCode(existingResult.status));
    }

    if (!Object.keys(patch).length && !wantsStatusRefresh) {
      throw createStructuredError(400, 'GOOGLE_PATCH_REQUIRED', 'Google Patch fehlt.', 'Sende ein patch-Objekt mit den zu aktualisierenden Google-Wallet-Feldern.');
    }

    if (!resolved.objectType) {
      throw createStructuredError(
        400,
        'GOOGLE_OBJECT_TYPE_INVALID',
        'Google Wallet Object Type ist ungültig.',
        'Die gespeicherte Google-Wallet-Zuordnung muss einen unterstützten Object Type verwenden.'
      );
    }

    const updatePatch = Object.keys(patch).length
      ? patch
      : googleWalletProvider.statusPatch(resolved.cardInstance.card_templates, resolved.cardInstance, resolved.objectType);
    let requestPayload = {
      object_id: resolved.objectId,
      object_type: resolved.objectType,
      patch: updatePatch,
      refresh_status: wantsStatusRefresh,
      ...(idempotencyKey ? { idempotency_scope: IDEMPOTENCY_SCOPE, idempotency_key: idempotencyKey } : {})
    };
    const reservedIdempotency = await walletNotificationService.reserveManualIdempotency(context, resolved.cardInstance, {
      walletPlatform: 'google',
      action: 'manual_google_object_update',
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
    const limits = await walletNotificationService.checkPlatformLimits(context, resolved.cardInstance, 'google');

    if (!limits.allowed) {
      const blockedStatus = limits.status === 'skipped' ? 'skipped' : 'limited';
      await logGoogleObjectUpdate(context, resolved.cardInstance, idempotencyReservation, {
        status: blockedStatus,
        requestPayload,
        responsePayload: limits,
        errorMessage: limits.error_message || limits.error_reason || null
      });

      return json(limits, blockedStatus === 'skipped' ? 409 : 429);
    }

    const result = await googleWalletProvider.updateObject(resolved.objectType, resolved.objectId, updatePatch);
    const status = result.ok ? 'sent' : 'failed';

    await logGoogleObjectUpdate(context, resolved.cardInstance, idempotencyReservation, {
      status,
      requestPayload,
      responsePayload: result,
      errorMessage: result.ok ? null : result.error_message || result.error_reason || 'Google Wallet Object konnte nicht aktualisiert werden.'
    });

    if (result.ok) {
      const { data: updatedCardInstance, error: cardUpdateError } = await context.supabaseAdmin
        .from('card_instances')
        .update({
          last_wallet_update_at: new Date().toISOString()
        })
        .eq('id', resolved.cardInstance.id)
        .eq('owner_id', context.ownerId)
        .eq('business_id', context.business.id)
        .eq('template_id', resolved.cardInstance.template_id)
        .eq('wallet_platform', 'google')
        .select('id')
        .maybeSingle();

      if (cardUpdateError || !updatedCardInstance) {
        throw createStructuredError(
          500,
          'CARD_WALLET_STATE_UPDATE_FAILED',
          'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.',
          cardUpdateError?.message || 'update_google_wallet_pass konnte last_wallet_update_at nicht für die erwartete Google-Karteninstanz aktualisieren.'
        );
      }

      const { data: updatedGoogleObject, error: googleObjectUpdateError } = await context.supabaseAdmin
        .from('google_wallet_objects')
        .update({
          updated_at: new Date().toISOString()
        })
        .eq('object_id', resolved.objectId)
        .eq('owner_id', context.ownerId)
        .eq('business_id', context.business.id)
        .eq('card_instance_id', resolved.cardInstance.id)
        .eq('template_id', resolved.cardInstance.template_id)
        .eq('object_type', resolved.objectType)
        .select('id')
        .maybeSingle();

      if (googleObjectUpdateError || !updatedGoogleObject) {
        throw createStructuredError(
          500,
          'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
          'Google Wallet Object-Zuordnung konnte nicht gespeichert werden.',
          googleObjectUpdateError?.message || 'update_google_wallet_pass konnte google_wallet_objects.updated_at nicht für das erwartete Google Wallet Object aktualisieren.'
        );
      }
    }

    return json({
      ...publicWalletProviderResult(result),
      objectId: resolved.objectId,
      objectType: resolved.objectType,
      cardInstanceId: resolved.cardInstance.id
    });
  } catch (error) {
    await walletNotificationService.failManualIdempotencyReservation(
      context,
      idempotencyReservation,
      error,
      'UPDATE_GOOGLE_WALLET_PASS_ERROR'
    );

    return errorJson(error, 'UPDATE_GOOGLE_WALLET_PASS_ERROR');
  }
});
