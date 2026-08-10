import { appleWalletProvider } from '../_shared/appleWalletProvider.ts';
import { publicApplePassVersion, publicApplePushOperationPayload, publicApplePushResult } from '../_shared/publicResponses.ts';
import { corsHeaders, createStructuredError, errorJson, json, walletNotificationService } from '../_shared/walletNotificationService.ts';

function stringValue(value: unknown) {
  return String(value || '').trim();
}

const IDEMPOTENCY_SCOPE = 'send-apple-wallet-update';

const sendAppleTemplateSelect = [
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
  'public_claim_token',
  'is_active'
].join(',');

const sendAppleCustomerCardSelect = [
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

const sendAppleCardInstanceSelect = [
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
  `card_templates(${sendAppleTemplateSelect})`,
  `customer_cards(${sendAppleCustomerCardSelect})`
].join(',');

function validateOptionalMessage(message: string) {
  if (message && message.length > 500) {
    throw createStructuredError(400, 'INVALID_APPLE_UPDATE_MESSAGE', 'Nachricht ist zu lang.', 'Die optionale Apple-Wallet-Nachricht darf maximal 500 Zeichen enthalten.');
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

async function findExistingManualAppleUpdate(context: Record<string, any>, cardInstance: Record<string, any>, idempotencyKey: string) {
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

async function logAppleUpdate(context: Record<string, any>, cardInstance: Record<string, any>, status: string, requestPayload: Record<string, any>, responsePayload: Record<string, any>, errorMessage: string | null = null, reservation: Record<string, any> | null = null) {
  if (reservation?.id) {
    await walletNotificationService.finalizeManualIdempotencyReservation(context, reservation, {
      action: 'manual_apple_push_update',
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
    action: 'manual_apple_push_update',
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
      logError.message || 'manual_apple_push_update konnte nicht in wallet_push_logs geschrieben werden.'
    );
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error_code: 'METHOD_NOT_ALLOWED', error_message: 'Nur POST ist erlaubt.', error_reason: 'Apple-Wallet-Updates werden per POST gesendet.' }, 405);
  }

  let context: Record<string, any> | null = null;
  let idempotencyReservation: Record<string, any> | null = null;

  try {
    context = await walletNotificationService.context(request);
    const body = await request.json().catch(() => ({}));
    const cardInstanceId = stringValue(body.cardInstanceId || body.card_instance_id);
    const message = stringValue(body.message);
    const idempotencyKey = idempotencyKeyFrom(request, body);

    if (!cardInstanceId) {
      throw createStructuredError(400, 'CARD_INSTANCE_ID_REQUIRED', 'Karteninstanz-ID fehlt.', 'Sende cardInstanceId an diese Function.');
    }

    validateOptionalMessage(message);
    validateIdempotencyKey(idempotencyKey);

    const { data: cardInstance, error } = await context.supabaseAdmin
      .from('card_instances')
      .select(sendAppleCardInstanceSelect)
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

    const existingResult = await findExistingManualAppleUpdate(context, cardInstance, idempotencyKey);

    if (existingResult) {
      return json({
        reused: true,
        idempotencyKey,
        status: existingResult.status,
        error_message: existingResult.error_message || null,
        ...publicApplePushOperationPayload(existingResult.response_payload)
      }, cachedStatusCode(existingResult.status));
    }

    const manualDuplicateKey = walletNotificationService.manualDuplicateKey({
      scope: IDEMPOTENCY_SCOPE,
      message: message || ''
    });
    let requestPayload = {
      card_instance_id: cardInstance.id,
      serial_number: cardInstance.apple_serial_number || cardInstance.wallet_serial_number || cardInstance.id,
      message: message || null,
      manual_duplicate_key: manualDuplicateKey,
      ...(idempotencyKey ? { idempotency_scope: IDEMPOTENCY_SCOPE, idempotency_key: idempotencyKey } : {})
    };
    const duplicateResult = await walletNotificationService.recentManualDuplicate(context, cardInstance, {
      walletPlatform: 'apple',
      actions: ['manual_apple_push_update'],
      duplicateKey: manualDuplicateKey
    });

    if (duplicateResult) {
      await walletNotificationService.logManualDuplicateSkipped(context, cardInstance, {
        walletPlatform: 'apple',
        duplicateKey: manualDuplicateKey,
        duplicateWindowMinutes: duplicateResult.duplicate_window_minutes,
        duplicateLog: duplicateResult,
        requestPayload
      });

      return json({
        duplicate: true,
        status: 'skipped',
        duplicate_window_minutes: duplicateResult.duplicate_window_minutes,
        duplicate_of_log_id: duplicateResult.id,
        duplicate_action: duplicateResult.action,
        duplicate_status: duplicateResult.status,
        error_message: 'Identisches manuelles Apple-Wallet-Update wurde innerhalb des Deduplizierungsfensters übersprungen.',
        ...publicApplePushOperationPayload(duplicateResult.response_payload)
      }, 409);
    }

    const reservedIdempotency = await walletNotificationService.reserveManualIdempotency(context, cardInstance, {
      walletPlatform: 'apple',
      action: 'manual_apple_push_update',
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
        ...publicApplePushOperationPayload(existingResult.response_payload)
      }, cachedStatusCode(existingResult.status));
    }

    requestPayload = reservedIdempotency.requestPayload;
    idempotencyReservation = reservedIdempotency.reservedLog;
    const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'apple');

    if (!limits.allowed) {
      const blockedStatus = limits.status === 'skipped' ? 'skipped' : 'limited';
      await logAppleUpdate(context, cardInstance, blockedStatus, requestPayload, limits, limits.error_message || limits.error_reason || null, idempotencyReservation);

      return json(limits, blockedStatus === 'skipped' ? 409 : 429);
    }

    const passFields = message
      ? {
        latestMessage: message,
        message,
        newMessageCount: 1
      }
      : {};
    const passVersion = await appleWalletProvider.updatePassFields(context.supabaseAdmin, cardInstance, cardInstance.card_templates, passFields, {
      reason: 'manual_apple_push_update',
      enqueue: false
    });

    const pushResult = await appleWalletProvider.sendPushUpdate(context.supabaseAdmin, cardInstance);
    const pushPrepared = Boolean(passVersion?.id) && pushResult.status === 'skipped';
    const status = pushResult.ok ? 'sent' : pushPrepared ? 'prepared' : pushResult.status === 'skipped' ? 'skipped' : 'failed';
    const responsePayload = {
      pass_version_id: passVersion?.id || null,
      warning_code: pushPrepared ? pushResult.error_code || 'APPLE_PUSH_NOT_SENT_PASS_PREPARED' : null,
      warning_message: pushPrepared ? pushResult.error_message || pushResult.error_reason || 'Apple-Pass wurde aktualisiert, aber kein sichtbarer APNS-Push gesendet.' : null,
      push: pushResult
    };

    await logAppleUpdate(
      context,
      cardInstance,
      status,
      requestPayload,
      responsePayload,
      pushResult.error_message || pushResult.error_reason || null,
      idempotencyReservation
    );

    await walletNotificationService.updateCardWalletState(context, cardInstance.id, {
      walletUpdated: Boolean(passVersion),
      visibleNotification: status === 'sent',
      countNotifications: status === 'sent'
    });

    return json({
      ...publicApplePushResult(pushResult),
      status,
      passVersion: publicApplePassVersion(passVersion)
    }, status === 'failed' ? 502 : 200);
  } catch (error) {
    await walletNotificationService.failManualIdempotencyReservation(
      context,
      idempotencyReservation,
      error,
      'SEND_APPLE_WALLET_UPDATE_ERROR'
    );

    return errorJson(error, 'SEND_APPLE_WALLET_UPDATE_ERROR');
  }
});
