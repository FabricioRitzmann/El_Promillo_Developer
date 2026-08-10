import { googleWalletProvider } from '../_shared/googleWalletProvider.ts';
import { publicGoogleMessageOperationPayload, publicWalletProviderResult } from '../_shared/publicResponses.ts';
import { corsHeaders, createStructuredError, errorJson, json, walletNotificationService } from '../_shared/walletNotificationService.ts';

function stringValue(value: unknown) {
  return String(value || '').trim();
}

const IDEMPOTENCY_SCOPE = 'send-google-wallet-message';

const sendGoogleTemplateSelect = [
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
  'public_claim_token',
  'is_active'
].join(',');

const sendGoogleCustomerCardSelect = [
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

const sendGoogleWalletObjectSelect = [
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

const sendGoogleCardInstanceSelect = [
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
  `card_templates(${sendGoogleTemplateSelect})`,
  `customer_cards(${sendGoogleCustomerCardSelect})`,
  `google_wallet_objects(${sendGoogleWalletObjectSelect})`
].join(',');

function validateMessage(title: string, message: string) {
  if (!title || title.length > 120) {
    throw createStructuredError(400, 'INVALID_GOOGLE_MESSAGE_TITLE', 'Titel ist ungültig.', 'Der Titel muss 1 bis 120 Zeichen enthalten.');
  }

  if (!message || message.length > 500) {
    throw createStructuredError(400, 'INVALID_GOOGLE_MESSAGE_BODY', 'Nachricht ist ungültig.', 'Die Nachricht muss 1 bis 500 Zeichen enthalten.');
  }
}

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

async function findExistingManualGoogleMessage(context: Record<string, any>, cardInstance: Record<string, any>, idempotencyKey: string) {
  if (!idempotencyKey) {
    return null;
  }

  const { data, error } = await context.supabaseAdmin
    .from('wallet_push_logs')
    .select('id,status,action,response_payload,error_message,created_at')
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

async function logGoogleMessage(context: Record<string, any>, cardInstance: Record<string, any>, action: string, status: string, requestPayload: Record<string, any>, responsePayload: Record<string, any>, errorMessage: string | null = null, reservation: Record<string, any> | null = null) {
  if (reservation?.id) {
    await walletNotificationService.finalizeManualIdempotencyReservation(context, reservation, {
      action,
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
    wallet_platform: 'google',
    action,
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
      logError.message || `${action} konnte nicht in wallet_push_logs geschrieben werden.`
    );
  }
}

async function touchGoogleWalletObjectMapping(context: Record<string, any>, cardInstance: Record<string, any>, objectId: string, objectType: string) {
  const { data: updatedGoogleObject, error } = await context.supabaseAdmin
    .from('google_wallet_objects')
    .update({
      updated_at: new Date().toISOString()
    })
    .eq('owner_id', context.ownerId)
    .eq('business_id', context.business.id)
    .eq('card_instance_id', cardInstance.id)
    .eq('template_id', cardInstance.template_id)
    .eq('object_id', objectId)
    .eq('object_type', objectType)
    .select('id')
    .maybeSingle();

  if (error || !updatedGoogleObject) {
    throw createStructuredError(
      500,
      'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
      'Google Wallet Object-Zuordnung konnte nicht gespeichert werden.',
      error?.message || 'send_google_wallet_message konnte google_wallet_objects.updated_at nicht für das erwartete Google Wallet Object aktualisieren.'
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
    .eq('owner_id', context.ownerId)
    .eq('business_id', context.business.id)
    .eq('template_id', cardInstance.template_id)
    .eq('wallet_platform', 'google')
    .select('id')
    .maybeSingle();

  if (cardError || !updatedCardInstance) {
    throw createStructuredError(
      500,
      'CARD_WALLET_STATE_UPDATE_FAILED',
      'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.',
      cardError?.message || 'send_google_wallet_message konnte Google Wallet Object ID nicht für die erwartete Karteninstanz synchronisieren.'
    );
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error_code: 'METHOD_NOT_ALLOWED', error_message: 'Nur POST ist erlaubt.', error_reason: 'Google-Wallet-Messages werden per POST gesendet.' }, 405);
  }

  let context: Record<string, any> | null = null;
  let idempotencyReservation: Record<string, any> | null = null;

  try {
    context = await walletNotificationService.context(request);
    const body = await request.json().catch(() => ({}));
    const cardInstanceId = stringValue(body.cardInstanceId || body.card_instance_id);
    const title = stringValue(body.title);
    const message = stringValue(body.message);
    const idempotencyKey = idempotencyKeyFrom(request, body);

    if (!cardInstanceId) {
      throw createStructuredError(400, 'CARD_INSTANCE_ID_REQUIRED', 'Karteninstanz-ID fehlt.', 'Sende cardInstanceId an diese Function.');
    }

    validateMessage(title, message);
    validateIdempotencyKey(idempotencyKey);

    const { data: cardInstance, error } = await context.supabaseAdmin
      .from('card_instances')
      .select(sendGoogleCardInstanceSelect)
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

    const existingResult = await findExistingManualGoogleMessage(context, cardInstance, idempotencyKey);

    if (existingResult) {
      return json({
        reused: true,
        idempotencyKey,
        status: existingResult.status,
        action: existingResult.action,
        error_message: existingResult.error_message || null,
        ...publicGoogleMessageOperationPayload(existingResult.response_payload)
      }, cachedStatusCode(existingResult.status));
    }

    const manualDuplicateKey = walletNotificationService.manualDuplicateKey({
      scope: IDEMPOTENCY_SCOPE,
      title,
      message
    });
    let baseRequestPayload = {
      card_instance_id: cardInstance.id,
      title,
      message,
      manual_duplicate_key: manualDuplicateKey,
      ...(idempotencyKey ? { idempotency_scope: IDEMPOTENCY_SCOPE, idempotency_key: idempotencyKey } : {})
    };
    const duplicateResult = await walletNotificationService.recentManualDuplicate(context, cardInstance, {
      walletPlatform: 'google',
      actions: ['google_text_and_notify', 'google_object_message_fallback'],
      duplicateKey: manualDuplicateKey
    });

    if (duplicateResult) {
      await walletNotificationService.logManualDuplicateSkipped(context, cardInstance, {
        walletPlatform: 'google',
        duplicateKey: manualDuplicateKey,
        duplicateWindowMinutes: duplicateResult.duplicate_window_minutes,
        duplicateLog: duplicateResult,
        requestPayload: baseRequestPayload
      });

      return json({
        duplicate: true,
        status: 'skipped',
        duplicate_window_minutes: duplicateResult.duplicate_window_minutes,
        duplicate_of_log_id: duplicateResult.id,
        duplicate_action: duplicateResult.action,
        duplicate_status: duplicateResult.status,
        error_message: 'Identische manuelle Google-Wallet-Nachricht wurde innerhalb des Deduplizierungsfensters übersprungen.',
        ...publicGoogleMessageOperationPayload(duplicateResult.response_payload)
      }, 409);
    }

    const reservedIdempotency = await walletNotificationService.reserveManualIdempotency(context, cardInstance, {
      walletPlatform: 'google',
      action: 'google_text_and_notify',
      idempotencyScope: IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestPayload: baseRequestPayload
    });

    if (reservedIdempotency.existingResult) {
      const existingResult = reservedIdempotency.existingResult;

      return json({
        reused: true,
        idempotencyKey,
        status: existingResult.status,
        action: existingResult.action,
        error_message: existingResult.error_message || null,
        ...publicGoogleMessageOperationPayload(existingResult.response_payload)
      }, cachedStatusCode(existingResult.status));
    }

    baseRequestPayload = reservedIdempotency.requestPayload;
    idempotencyReservation = reservedIdempotency.reservedLog;
    const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'google');

    if (!limits.allowed) {
      const blockedStatus = limits.status === 'skipped' ? 'skipped' : 'limited';
      await logGoogleMessage(context, cardInstance, 'google_text_and_notify', blockedStatus, baseRequestPayload, limits, limits.error_message || limits.error_reason || null, idempotencyReservation);

      return json(limits, blockedStatus === 'skipped' ? 409 : 429);
    }

    const googleObject = Array.isArray(cardInstance.google_wallet_objects)
      ? cardInstance.google_wallet_objects[0]
      : cardInstance.google_wallet_objects;
    const objectId = stringValue(googleObject?.object_id || cardInstance.google_object_id || cardInstance.wallet_object_id);

    if (!objectId) {
      throw createStructuredError(400, 'GOOGLE_OBJECT_ID_MISSING', 'Google Object ID fehlt.', 'Synchronisiere zuerst das Google Wallet Object.');
    }

    const objectType = googleWalletProvider.normalizeObjectType(
      googleObject?.object_type || googleWalletProvider.objectTypeForTemplate(cardInstance.card_templates)
    );

    if (!objectType) {
      throw createStructuredError(
        400,
        'GOOGLE_OBJECT_TYPE_INVALID',
        'Google Wallet Object Type ist ungültig.',
        'Die gespeicherte Google-Wallet-Zuordnung muss einen unterstützten Object Type verwenden.'
      );
    }

    const requestPayload = {
      ...baseRequestPayload,
      object_id: objectId,
      object_type: objectType
    };
    const notificationResult = await googleWalletProvider.sendTextAndNotify(objectType, objectId, title, message);

    if (notificationResult.ok) {
      await logGoogleMessage(context, cardInstance, 'google_text_and_notify', 'sent', requestPayload, notificationResult, null, idempotencyReservation);
      await touchGoogleWalletObjectMapping(context, cardInstance, objectId, objectType);
      await walletNotificationService.updateCardWalletState(context, cardInstance.id, {
        visibleNotification: true,
        countNotifications: true
      });

      return json({
        ...publicWalletProviderResult(notificationResult),
        status: 'sent',
        objectId,
        objectType
      });
    }

    const fallbackResult = await googleWalletProvider.updateObject(
      objectType,
      objectId,
      googleWalletProvider.statusPatch(cardInstance.card_templates, cardInstance, objectType, [
        {
          id: `manual-message-${crypto.randomUUID()}`,
          header: title,
          body: message
        }
      ])
    );
    const fallbackStatus = fallbackResult.ok ? 'sent' : 'failed';
    const responsePayload = {
      notification: notificationResult,
      fallback: fallbackResult
    };

    await logGoogleMessage(
      context,
      cardInstance,
      fallbackResult.ok ? 'google_object_message_fallback' : 'google_text_and_notify',
      fallbackStatus,
      requestPayload,
      responsePayload,
      fallbackResult.ok
        ? notificationResult.error_message || notificationResult.error_reason || 'Google TEXT_AND_NOTIFY war nicht möglich; Object-Fallback wurde gespeichert.'
        : fallbackResult.error_message || fallbackResult.error_reason || notificationResult.error_message || notificationResult.error_reason || 'Google Message konnte nicht gesendet werden.',
      idempotencyReservation
    );

    if (fallbackResult.ok) {
      await touchGoogleWalletObjectMapping(context, cardInstance, objectId, objectType);
      await walletNotificationService.updateCardWalletState(context, cardInstance.id, {
        visibleNotification: false,
        countNotifications: false
      });
    }

    return json({
      ok: fallbackResult.ok,
      status: fallbackStatus,
      objectId,
      objectType,
      fallback: fallbackResult.ok ? 'google_object_message_fallback' : null,
      warning_code: fallbackResult.ok ? 'GOOGLE_TEXT_AND_NOTIFY_FALLBACK' : null,
      warning_message: fallbackResult.ok ? 'Google TEXT_AND_NOTIFY war nicht möglich; die Nachricht wurde als Kartenupdate gespeichert.' : null,
      notificationResult: publicWalletProviderResult(notificationResult),
      fallbackResult: publicWalletProviderResult(fallbackResult)
    }, fallbackResult.ok ? 200 : 502);
  } catch (error) {
    await walletNotificationService.failManualIdempotencyReservation(
      context,
      idempotencyReservation,
      error,
      'SEND_GOOGLE_WALLET_MESSAGE_ERROR'
    );

    return errorJson(error, 'SEND_GOOGLE_WALLET_MESSAGE_ERROR');
  }
});
