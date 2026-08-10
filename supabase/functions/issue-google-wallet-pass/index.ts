import { googleWalletProvider } from '../_shared/googleWalletProvider.ts';
import { publicGoogleWalletIssuePayload } from '../_shared/publicResponses.ts';
import { corsHeaders, createStructuredError, errorJson, json, walletNotificationService } from '../_shared/walletNotificationService.ts';

function stringValue(value: unknown) {
  return String(value || '').trim();
}

const IDEMPOTENCY_SCOPE = 'issue-google-wallet-pass';

const issueGoogleTemplateSelect = [
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

const issueGoogleCustomerCardSelect = [
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

const issueGoogleWalletObjectSelect = [
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

const issueGoogleCardInstanceSelect = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
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
  `card_templates(${issueGoogleTemplateSelect})`,
  `customer_cards(${issueGoogleCustomerCardSelect})`,
  `google_wallet_objects(${issueGoogleWalletObjectSelect})`
].join(',');

function issueHttpStatus(issueStatus: string, objectResult: Record<string, any>, saveLink: Record<string, any>) {
  if (issueStatus === 'processing') {
    return 202;
  }

  if (issueStatus === 'sent') {
    return 200;
  }

  const errorCode = stringValue(objectResult.error_code || saveLink.error_code);

  if (
    errorCode === 'GOOGLE_WALLET_CONFIG_MISSING'
    || errorCode === 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INVALID'
    || errorCode === 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INCOMPLETE'
    || errorCode === 'GOOGLE_WALLET_PRIVATE_KEY_FORMAT'
    || errorCode === 'GOOGLE_WALLET_TOKEN_SIGNING_FAILED'
    || errorCode === 'GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED'
  ) {
    return 501;
  }

  return issueStatus === 'partially_failed' ? 207 : 502;
}

function normalizedIssueStatus(objectResult: Record<string, any>, saveLink: Record<string, any>) {
  if (objectResult.ok && saveLink.ok) {
    return 'sent';
  }

  if (objectResult.ok || saveLink.ok) {
    return 'partially_failed';
  }

  const providerStatus = stringValue(objectResult.status || saveLink.status);

  return ['skipped', 'failed', 'prepared'].includes(providerStatus)
    ? providerStatus
    : 'failed';
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

function googleObjectFrom(cardInstance: Record<string, any>) {
  return Array.isArray(cardInstance.google_wallet_objects)
    ? cardInstance.google_wallet_objects[0]
    : cardInstance.google_wallet_objects;
}

function customerCardFrom(cardInstance: Record<string, any>) {
  return Array.isArray(cardInstance.customer_cards)
    ? cardInstance.customer_cards[0]
    : cardInstance.customer_cards;
}

function cachedIssuePayload(existingResult: Record<string, any>, cardInstance: Record<string, any>) {
  const payload = payloadObject(existingResult.response_payload);
  const saveLink = payloadObject(payload.saveLink);
  const googleObject = googleObjectFrom(cardInstance);

  if (googleObject?.save_url && !saveLink.saveUrl) {
    saveLink.saveUrl = googleObject.save_url;
  }

  if (googleObject?.object_id && !saveLink.objectId) {
    saveLink.objectId = googleObject.object_id;
  }

  if (googleObject?.class_id && !saveLink.classId) {
    saveLink.classId = googleObject.class_id;
  }

  if (googleObject?.object_type && !saveLink.objectType) {
    saveLink.objectType = googleObject.object_type;
  }

  if (Object.keys(saveLink).length) {
    payload.saveLink = saveLink;
  }

  return payload;
}

async function findExistingGoogleIssue(context: Record<string, any>, cardInstance: Record<string, any>, idempotencyKey: string) {
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

async function logGoogleIssue(context: Record<string, any>, cardInstance: Record<string, any>, status: string, objectResult: Record<string, any>, saveLink: Record<string, any>, requestPayloadExtra: Record<string, any> = {}, reservation: Record<string, any> | null = null) {
  const requestPayload = {
    card_instance_id: cardInstance.id,
    ...requestPayloadExtra
  };
  const responsePayload = {
    objectResult,
    saveLink: {
      ok: saveLink.ok,
      objectId: saveLink.objectId || null,
      classId: saveLink.classId || null,
      objectType: saveLink.objectType || null,
      save_url_present: Boolean(saveLink.saveUrl),
      save_url_length: stringValue(saveLink.saveUrl).length,
      error_code: saveLink.error_code || null,
      error_message: saveLink.error_message || null
    }
  };
  const errorMessage = objectResult.error_message || objectResult.error_reason || saveLink.error_message || saveLink.error_reason || null;

  if (reservation?.id) {
    await walletNotificationService.finalizeWalletOperationIdempotencyReservation(context, reservation, {
      action: 'issue_google_wallet_pass',
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
    action: 'issue_google_wallet_pass',
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
      logError.message || 'issue_google_wallet_pass konnte nicht in wallet_push_logs geschrieben werden.'
    );
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error_code: 'METHOD_NOT_ALLOWED', error_message: 'Nur POST ist erlaubt.', error_reason: 'Google-Wallet-Passes werden per POST erstellt.' }, 405);
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
      .select(issueGoogleCardInstanceSelect)
      .eq('id', cardInstanceId)
      .eq('owner_id', context.ownerId)
      .eq('business_id', context.business.id)
      .eq('wallet_platform', 'google')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!cardInstance) {
      throw createStructuredError(404, 'GOOGLE_CARD_NOT_FOUND', 'Google-Karte nicht gefunden.', 'Die Karte existiert nicht, gehört nicht zu deinem Account oder ist keine Google-Wallet-Karte.');
    }

    const existingResult = await findExistingGoogleIssue(context, cardInstance, idempotencyKey);

    if (existingResult) {
      const cachedPayload = cachedIssuePayload(existingResult, cardInstance);
      const publicPayload = publicGoogleWalletIssuePayload(
        payloadObject(cachedPayload.objectResult),
        payloadObject(cachedPayload.saveLink)
      );

      return json({
        reused: true,
        idempotencyKey,
        ok: existingResult.status === 'sent',
        status: existingResult.status,
        error_message: existingResult.error_message || null,
        ...publicPayload
      }, issueHttpStatus(
        existingResult.status,
        payloadObject(publicPayload.objectResult),
        payloadObject(publicPayload.saveLink)
      ));
    }

    const idempotencyPayload = idempotencyKey
      ? { idempotency_scope: IDEMPOTENCY_SCOPE, idempotency_key: idempotencyKey }
      : {};
    const reservePayload = {
      card_instance_id: cardInstance.id,
      ...idempotencyPayload
    };
    const reservedIdempotency = await walletNotificationService.reserveWalletOperationIdempotency(context, cardInstance, {
      walletPlatform: 'google',
      action: 'issue_google_wallet_pass',
      idempotencyScope: IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestPayload: reservePayload
    });

    if (reservedIdempotency.existingResult) {
      const cachedPayload = cachedIssuePayload(reservedIdempotency.existingResult, cardInstance);
      const publicPayload = publicGoogleWalletIssuePayload(
        payloadObject(cachedPayload.objectResult),
        payloadObject(cachedPayload.saveLink)
      );

      return json({
        reused: true,
        idempotencyKey,
        ok: reservedIdempotency.existingResult.status === 'sent',
        status: reservedIdempotency.existingResult.status,
        error_message: reservedIdempotency.existingResult.error_message || null,
        ...publicPayload
      }, issueHttpStatus(
        reservedIdempotency.existingResult.status,
        payloadObject(publicPayload.objectResult),
        payloadObject(publicPayload.saveLink)
      ));
    }

    idempotencyReservation = reservedIdempotency.reservedLog;
    const objectResult = await googleWalletProvider.createObject(cardInstance.card_templates, cardInstance);
    const saveLink = await googleWalletProvider.generateSaveLink(cardInstance.card_templates, cardInstance);
    const issueStatus = normalizedIssueStatus(objectResult, saveLink);

    const issuedObjectId = stringValue(objectResult.objectId || saveLink.objectId);
    const issuedClassId = stringValue(objectResult.classId || saveLink.classId);
    const issuedObjectType = stringValue(objectResult.objectType || saveLink.objectType);

    if ((objectResult.ok || saveLink.ok) && issuedObjectId && (!issuedClassId || !issuedObjectType)) {
      throw createStructuredError(
        502,
        'GOOGLE_WALLET_OBJECT_IDENTITY_INCOMPLETE',
        'Google Wallet Object-Zuordnung ist unvollständig.',
        'Provider oder Save-Link hat eine Object ID geliefert, aber Class ID oder Object Type fehlen für die lokale Wallet-Zuordnung.'
      );
    }

    if ((objectResult.ok || saveLink.ok) && issuedObjectId) {
      const { data: updatedGoogleObject, error: googleObjectUpsertError } = await context.supabaseAdmin
        .from('google_wallet_objects')
        .upsert({
          owner_id: context.ownerId,
          card_instance_id: cardInstance.id,
          business_id: cardInstance.business_id,
          template_id: cardInstance.template_id,
          issuer_id: issuedObjectId.split('.')[0],
          class_id: issuedClassId,
          object_id: issuedObjectId,
          object_type: issuedObjectType,
          save_url: saveLink.saveUrl || null
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
          googleObjectUpsertError?.message || 'issue_google_wallet_pass konnte google_wallet_objects nicht für die erwartete Karteninstanz aktualisieren.'
        );
      }

      const customerCard = customerCardFrom(cardInstance);
      const customerCardId = stringValue(cardInstance.customer_card_id || customerCard?.id);

      if (customerCardId) {
        const { data: updatedCustomerCard, error: customerCardUpdateError } = await context.supabaseAdmin
          .from('customer_cards')
          .update({
            wallet_object_id: issuedObjectId,
            wallet_serial_number: issuedObjectId,
            metadata: {
              ...(customerCard?.metadata || {}),
              google_wallet_claim_key: stringValue(customerCard?.metadata?.google_wallet_claim_key || customerCard?.wallet_object_id || issuedObjectId),
              google_wallet_object_id: issuedObjectId
            }
          })
          .eq('id', customerCardId)
          .eq('owner_id', context.ownerId)
          .eq('business_id', context.business.id)
          .eq('template_id', cardInstance.template_id)
          .eq('wallet_platform', 'google')
          .select('id')
          .maybeSingle();

        if (customerCardUpdateError || !updatedCustomerCard) {
          throw createStructuredError(
            500,
            'GOOGLE_CUSTOMER_CARD_UPDATE_FAILED',
            'Google Wallet Daten konnten nicht auf der Kundenkarte gespeichert werden.',
            customerCardUpdateError?.message || 'issue_google_wallet_pass konnte customer_cards nicht für die erwartete Google-Kundenkarte aktualisieren.'
          );
        }
      }

      const { data: updatedCardInstance, error: cardUpdateError } = await context.supabaseAdmin
        .from('card_instances')
        .update({
          google_object_id: issuedObjectId,
          wallet_object_id: issuedObjectId,
          wallet_serial_number: issuedObjectId,
          last_wallet_update_at: new Date().toISOString()
        })
        .eq('id', cardInstance.id)
        .eq('owner_id', context.ownerId)
        .eq('business_id', context.business.id)
        .eq('template_id', cardInstance.template_id)
        .eq('wallet_platform', 'google')
        .select('id')
        .maybeSingle();

      if (cardUpdateError || !updatedCardInstance) {
        throw createStructuredError(
          500,
          'CARD_WALLET_STATE_UPDATE_FAILED',
          'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.',
          cardUpdateError?.message || 'issue_google_wallet_pass konnte Google-Wallet-IDs nicht für die erwartete Karteninstanz speichern.'
        );
      }
    }

    await logGoogleIssue(context, cardInstance, issueStatus, objectResult, saveLink, reservedIdempotency.requestPayload, idempotencyReservation);
    const publicPayload = publicGoogleWalletIssuePayload(objectResult, saveLink);

    return json({
      ok: issueStatus === 'sent',
      ...publicPayload,
      status: issueStatus
    }, issueHttpStatus(issueStatus, objectResult, saveLink));
  } catch (error) {
    await walletNotificationService.failWalletOperationIdempotencyReservation(
      context,
      idempotencyReservation,
      error,
      'ISSUE_GOOGLE_WALLET_PASS_ERROR'
    );

    return errorJson(error, 'ISSUE_GOOGLE_WALLET_PASS_ERROR');
  }
});
