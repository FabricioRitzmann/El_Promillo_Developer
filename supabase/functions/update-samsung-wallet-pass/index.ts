import { publicWalletOperationPayload, publicWalletProviderResult } from '../_shared/publicResponses.ts';
import { samsungWalletProvider } from '../_shared/samsungWalletProvider.ts';
import { corsHeaders, createStructuredError, errorJson, json, walletNotificationService } from '../_shared/walletNotificationService.ts';

type Row = Record<string, any>;

const SAMSUNG_UPDATE_FIELDS_MAX_LENGTH = 500;
const SAMSUNG_REF_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

const samsungUpdateTemplateSelect = [
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
  'businesses(name,logo_url)',
  'reward_text',
  'stamps_required',
  'streak_goal',
  'vip_tier',
  'settings',
  'club_features',
  'club_settings',
  'public_claim_token',
  'is_active',
  'created_at',
  'updated_at'
].join(',');

const samsungUpdateInstanceSelect = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
  'ref_id',
  'customer_code',
  'card_id',
  'card_type',
  'card_sub_type',
  'country_code',
  'add_flow',
  'card_status',
  'samsung_callback_url',
  'samsung_wallet_id',
  'last_event',
  'last_event_at',
  'last_synced_at',
  'metadata',
  'created_at',
  'updated_at',
  `card_templates(${samsungUpdateTemplateSelect})`
].join(',');

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function normalizeAction(value: unknown) {
  const action = stringValue(value || 'update').toLowerCase();

  if (['update', 'delete', 'revoke', 'cancel', 'cancelled', 'canceled'].includes(action)) {
    return action === 'cancel' || action === 'cancelled' || action === 'canceled' ? 'revoke' : action;
  }

  throw createStructuredError(
    400,
    'SAMSUNG_ACTION_INVALID',
    'Samsung-Aktion ist ungültig.',
    'Erlaubt sind update, delete oder revoke.'
  );
}

function validateUpdateFields(value: unknown) {
  const fields = stringValue(value || 'balance,barcode.value');

  if (fields.length > SAMSUNG_UPDATE_FIELDS_MAX_LENGTH || !/^[A-Za-z0-9._,-]+$/.test(fields)) {
    throw createStructuredError(
      400,
      'SAMSUNG_UPDATE_FIELDS_INVALID',
      'Samsung Update-Felder sind ungültig.',
      'fields darf maximal 500 Zeichen enthalten und nur Buchstaben, Zahlen, Punkt, Unterstrich, Bindestrich und Komma nutzen.'
    );
  }

  return fields;
}

function assertSamsungRefId(refId: string) {
  if (!SAMSUNG_REF_ID_PATTERN.test(refId)) {
    throw createStructuredError(
      400,
      'SAMSUNG_REF_ID_INVALID',
      'Samsung Ref-ID ist ungültig.',
      'Samsung Update-/Cancel-Aufrufe brauchen eine gespeicherte refId mit 8 bis 32 URL-sicheren Zeichen.'
    );
  }
}

function publicSamsungInstance(instance: Row = {}) {
  return {
    id: instance.id,
    template_id: instance.template_id,
    ref_id: instance.ref_id,
    customer_code: instance.customer_code,
    card_status: instance.card_status,
    last_event: instance.last_event,
    last_event_at: instance.last_event_at,
    last_synced_at: instance.last_synced_at,
    updated_at: instance.updated_at
  };
}

function eventTypeForAction(action: string) {
  if (action === 'delete') {
    return 'manual_delete_requested';
  }

  if (action === 'revoke') {
    return 'manual_cancel_requested';
  }

  return 'manual_update_requested';
}

function nextStatusForAction(action: string, currentStatus: string) {
  if (action === 'delete') {
    return 'deleted';
  }

  if (action === 'revoke') {
    return 'cancelled';
  }

  return currentStatus || 'active';
}

async function loadSamsungInstance(context: Row, body: Row) {
  const samsungInstanceId = stringValue(body.samsungInstanceId || body.samsung_instance_id || body.id);
  const refId = stringValue(body.refId || body.ref_id);
  const customerCode = stringValue(body.customerCode || body.customer_code);

  if (!samsungInstanceId && !refId && !customerCode) {
    throw createStructuredError(
      400,
      'SAMSUNG_INSTANCE_IDENTIFIER_REQUIRED',
      'Samsung-Karte fehlt.',
      'Sende samsungInstanceId, refId oder customerCode an diese Function.'
    );
  }

  let query = context.supabaseAdmin
    .from('samsung_wallet_instances')
    .select(samsungUpdateInstanceSelect)
    .eq('owner_id', context.ownerId)
    .eq('business_id', context.business.id);

  if (samsungInstanceId) {
    query = query.eq('id', samsungInstanceId);
  } else if (refId) {
    query = query.eq('ref_id', refId);
  } else {
    query = query.eq('customer_code', customerCode);
  }

  const { data: instance, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  if (!instance) {
    throw createStructuredError(
      404,
      'SAMSUNG_INSTANCE_NOT_FOUND',
      'Samsung-Karte nicht gefunden.',
      'Die Samsung-Karte existiert nicht oder gehört nicht zu deinem Account.'
    );
  }

  assertSamsungRefId(instance.ref_id);
  return instance;
}

async function insertSamsungEvent(context: Row, instance: Row, eventType: string, requestPayload: Row, responsePayload: Row) {
  const { error } = await context.supabaseAdmin
    .from('samsung_wallet_events')
    .insert({
      samsung_wallet_instance_id: instance.id,
      owner_id: context.ownerId,
      business_id: instance.business_id,
      template_id: instance.template_id,
      ref_id: instance.ref_id,
      event_type: eventType,
      request_payload: requestPayload,
      response_payload: responsePayload
    });

  if (error) {
    throw createStructuredError(
      500,
      'SAMSUNG_EVENT_SAVE_FAILED',
      'Samsung Wallet Ereignis konnte nicht gespeichert werden.',
      error.message || 'samsung_wallet_events.insert hat einen Fehler zurückgegeben.'
    );
  }
}

async function persistSamsungInstanceState(context: Row, instance: Row, action: string, eventType: string) {
  const now = new Date().toISOString();
  const { data, error } = await context.supabaseAdmin
    .from('samsung_wallet_instances')
    .update({
      card_status: nextStatusForAction(action, instance.card_status),
      last_event: eventType,
      last_event_at: now,
      last_synced_at: now
    })
    .eq('id', instance.id)
    .eq('owner_id', context.ownerId)
    .eq('business_id', context.business.id)
    .eq('ref_id', instance.ref_id)
    .select('id, template_id, ref_id, customer_code, card_status, last_event, last_event_at, last_synced_at, updated_at')
    .maybeSingle();

  if (error || !data) {
    throw createStructuredError(
      500,
      'SAMSUNG_INSTANCE_STATE_SAVE_FAILED',
      'Samsung Wallet Status konnte nicht gespeichert werden.',
      error?.message || 'update_samsung_wallet_pass konnte die erwartete Samsung-Karteninstanz nicht aktualisieren.'
    );
  }

  return data;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur POST ist erlaubt.',
      error_reason: 'Samsung Wallet Updates werden per POST erstellt.'
    }, 405);
  }

  try {
    const context = await walletNotificationService.context(request);
    const body = await request.json().catch(() => ({})) as Row;
    const action = normalizeAction(body.action);
    const fields = validateUpdateFields(body.fields);
    const instance = await loadSamsungInstance(context, body);
    const eventType = eventTypeForAction(action);
    const requestPayload = {
      action,
      ref_id: instance.ref_id,
      fields: action === 'update' ? fields : undefined
    };
    const providerResult = action === 'delete'
      ? await samsungWalletProvider.delete(instance)
      : action === 'revoke'
      ? await samsungWalletProvider.revoke(instance)
      : await samsungWalletProvider.update(instance, fields);
    const publicProviderResult = publicWalletProviderResult(providerResult);
    const eventResponsePayload = publicWalletOperationPayload(providerResult);

    await insertSamsungEvent(context, instance, eventType, requestPayload, eventResponsePayload);

    if (!providerResult.ok) {
      return json({
        ...publicProviderResult,
        action,
        samsungInstance: publicSamsungInstance(instance)
      }, Number(providerResult.status || 502));
    }

    const updatedInstance = await persistSamsungInstanceState(context, instance, action, eventType);

    return json({
      ...publicProviderResult,
      action,
      samsungInstance: publicSamsungInstance(updatedInstance)
    });
  } catch (error) {
    return errorJson(error);
  }
});
