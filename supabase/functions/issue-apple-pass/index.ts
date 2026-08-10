import { appleWalletProvider } from '../_shared/appleWalletProvider.ts';
import { publicApplePassVersion, publicAppleSigningResult, publicWalletOperationPayload } from '../_shared/publicResponses.ts';
import { corsHeaders, createStructuredError, errorJson, json, walletNotificationService } from '../_shared/walletNotificationService.ts';

function stringValue(value: unknown) {
  return String(value || '').trim();
}

const IDEMPOTENCY_SCOPE = 'issue-apple-pass';

const issueApplePassTemplateSelect = [
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

const issueApplePassCustomerCardSelect = [
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

const issueApplePassCardInstanceSelect = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
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
  `card_templates(${issueApplePassTemplateSelect})`,
  `customer_cards(${issueApplePassCustomerCardSelect})`
].join(',');

const issueApplePassVersionSelect = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
  'card_instance_id',
  'serial_number',
  'pass_type_identifier',
  'pass_json',
  'assets',
  'version',
  'last_updated_at'
].join(',');

function pkpassResponse(signing: Record<string, any>) {
  return new Response(signing.pkpass, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': signing.contentType || 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${stringValue(signing.fileName) || 'wallet-card.pkpass'}"`
    }
  });
}

function signingHttpStatus(signing: Record<string, any>) {
  if (signing.ok) {
    return 200;
  }

  return ['APPLE_PASS_SIGNING_CONFIG_MISSING', 'APPLE_PASS_CONFIG_MISSING', 'APPLE_WEB_SERVICE_CONFIG_MISSING'].includes(signing.error_code)
    ? 501
    : 502;
}

function idempotencyKeyFrom(request: Request, body: Record<string, any>) {
  return stringValue(request.headers.get('idempotency-key') || body.idempotencyKey || body.idempotency_key);
}

function validateIdempotencyKey(idempotencyKey: string) {
  if (idempotencyKey && idempotencyKey.length > 200) {
    throw createStructuredError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key ist zu lang.', 'Der Idempotency-Key darf maximal 200 Zeichen enthalten.');
  }
}

function payloadObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function cachedAppleIssueStatusCode(existingResult: Record<string, any>) {
  if (existingResult.status === 'processing') {
    return 202;
  }

  const payload = payloadObject(existingResult.response_payload);
  const signing = payloadObject(payload.signing);

  if (Object.keys(signing).length) {
    return signingHttpStatus(signing);
  }

  return existingResult.status === 'failed' ? 502 : 200;
}

async function findExistingAppleIssue(context: Record<string, any>, cardInstance: Record<string, any>, idempotencyKey: string) {
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

async function passVersionForExistingIssue(context: Record<string, any>, cardInstance: Record<string, any>, existingResult: Record<string, any>) {
  const payload = payloadObject(existingResult.response_payload);
  const passVersionId = stringValue(payload.pass_version_id || payload.passVersionId);

  let query = context.supabaseAdmin
    .from('apple_pass_versions')
    .select(issueApplePassVersionSelect)
    .eq('owner_id', context.ownerId)
    .eq('business_id', cardInstance.business_id)
    .eq('card_instance_id', cardInstance.id);

  if (passVersionId) {
    query = query.eq('id', passVersionId);
  } else {
    query = query
      .order('version', { ascending: false })
      .limit(1);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function responseFromExistingAppleIssue(context: Record<string, any>, cardInstance: Record<string, any>, existingResult: Record<string, any>, idempotencyKey: string) {
  if (existingResult.status === 'processing') {
    return json({
      reused: true,
      idempotencyKey,
      ok: false,
      status: 'processing',
      error_message: existingResult.error_message || null,
      ...publicWalletOperationPayload(existingResult.response_payload)
    }, 202);
  }

  const passVersion = await passVersionForExistingIssue(context, cardInstance, existingResult);

  if (passVersion) {
    const signing = await appleWalletProvider.signPass(passVersion.pass_json, passVersion.assets || {});

    if (signing.ok) {
      return pkpassResponse(signing);
    }

    return json({
      reused: true,
      idempotencyKey,
      ok: false,
      passVersion: publicApplePassVersion(passVersion),
      signing: publicAppleSigningResult(signing),
      status: signing.status || existingResult.status,
      error_message: existingResult.error_message || signing.error_message || null
    }, signingHttpStatus(signing));
  }

  const cachedPayload = publicWalletOperationPayload(existingResult.response_payload);

  return json({
    reused: true,
    idempotencyKey,
    ok: existingResult.status === 'sent',
    status: existingResult.status,
    error_message: existingResult.error_message || null,
    ...cachedPayload
  }, cachedAppleIssueStatusCode(existingResult));
}

async function logAppleIssue(context: Record<string, any>, cardInstance: Record<string, any>, status: string, passVersion: Record<string, any>, signing: Record<string, any>, requestPayloadExtra: Record<string, any> = {}, reservation: Record<string, any> | null = null) {
  const requestPayload = {
    card_instance_id: cardInstance.id,
    serial_number: cardInstance.apple_serial_number || cardInstance.wallet_serial_number || cardInstance.id,
    ...requestPayloadExtra
  };
  const responsePayload = {
    pass_version_id: passVersion.id,
    version: passVersion.version,
    signing: {
      ok: signing.ok,
      status: signing.status,
      error_code: signing.error_code || null,
      error_message: signing.error_message || null
    }
  };
  const errorMessage = signing.ok ? null : signing.error_message || signing.error_reason || null;

  if (reservation?.id) {
    await walletNotificationService.finalizeWalletOperationIdempotencyReservation(context, reservation, {
      action: 'issue_apple_pass',
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
    action: 'issue_apple_pass',
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
      logError.message || 'issue_apple_pass konnte nicht in wallet_push_logs geschrieben werden.'
    );
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error_code: 'METHOD_NOT_ALLOWED', error_message: 'Nur POST ist erlaubt.', error_reason: 'Apple-Passes werden per POST vorbereitet.' }, 405);
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
      .select(issueApplePassCardInstanceSelect)
      .eq('id', cardInstanceId)
      .eq('owner_id', context.ownerId)
      .eq('business_id', context.business.id)
      .eq('wallet_platform', 'apple')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!cardInstance) {
      throw createStructuredError(404, 'APPLE_CARD_NOT_FOUND', 'Apple-Karte nicht gefunden.', 'Die Karte existiert nicht, gehört nicht zu deinem Account oder ist keine Apple-Wallet-Karte.');
    }

    const existingResult = await findExistingAppleIssue(context, cardInstance, idempotencyKey);

    if (existingResult) {
      return await responseFromExistingAppleIssue(context, cardInstance, existingResult, idempotencyKey);
    }

    const idempotencyPayload = idempotencyKey
      ? { idempotency_scope: IDEMPOTENCY_SCOPE, idempotency_key: idempotencyKey }
      : {};
    const reservePayload = {
      card_instance_id: cardInstance.id,
      serial_number: cardInstance.apple_serial_number || cardInstance.wallet_serial_number || cardInstance.id,
      ...idempotencyPayload
    };
    const reservedIdempotency = await walletNotificationService.reserveWalletOperationIdempotency(context, cardInstance, {
      walletPlatform: 'apple',
      action: 'issue_apple_pass',
      idempotencyScope: IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestPayload: reservePayload
    });

    if (reservedIdempotency.existingResult) {
      return await responseFromExistingAppleIssue(context, cardInstance, reservedIdempotency.existingResult, idempotencyKey);
    }

    idempotencyReservation = reservedIdempotency.reservedLog;
    const passVersion = await appleWalletProvider.issuePass(context.supabaseAdmin, cardInstance.card_templates, cardInstance);
    const signing = await appleWalletProvider.signPass(passVersion.pass_json, passVersion.assets || {});
    const status = signing.ok ? 'sent' : signing.status || 'prepared';

    await logAppleIssue(context, cardInstance, status, passVersion, signing, reservedIdempotency.requestPayload, idempotencyReservation);

    const { data: updatedCardInstance, error: cardUpdateError } = await context.supabaseAdmin
      .from('card_instances')
      .update({
        last_wallet_update_at: new Date().toISOString()
      })
      .eq('id', cardInstance.id)
      .eq('owner_id', context.ownerId)
      .eq('business_id', context.business.id)
      .eq('template_id', cardInstance.template_id)
      .eq('wallet_platform', 'apple')
      .select('id')
      .maybeSingle();

    if (cardUpdateError || !updatedCardInstance) {
      throw createStructuredError(
        500,
        'CARD_WALLET_STATE_UPDATE_FAILED',
        'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.',
        cardUpdateError?.message || 'issue_apple_pass konnte last_wallet_update_at nicht für die erwartete Apple-Karteninstanz aktualisieren.'
      );
    }

    if (signing.ok) {
      return pkpassResponse(signing);
    }

    return json({
      ok: false,
      passVersion: publicApplePassVersion(passVersion),
      signing: publicAppleSigningResult(signing),
      status
    }, signingHttpStatus(signing));
  } catch (error) {
    await walletNotificationService.failWalletOperationIdempotencyReservation(
      context,
      idempotencyReservation,
      error,
      'ISSUE_APPLE_PASS_ERROR'
    );

    return errorJson(error, 'ISSUE_APPLE_PASS_ERROR');
  }
});
