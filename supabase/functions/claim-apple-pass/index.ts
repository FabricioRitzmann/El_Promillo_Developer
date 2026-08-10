// Supabase Edge Function: signierte Apple-Wallet-Datei für den öffentlichen Claim ausliefern.
//
// Die Claim-Seite erstellt die Karte zuerst über `claim-card`. Danach kann sie
// diese Function mit cardId/templateId aufrufen. Zertifikate und Private Keys
// bleiben ausschliesslich als Supabase Secrets in der Edge Function.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { appleWalletProvider } from '../_shared/appleWalletProvider.ts';
import { enforcePublicClaimRateLimit } from '../_shared/publicRateLimit.ts';
import { publicAppleSigningResult } from '../_shared/publicResponses.ts';

type Row = Record<string, any>;

const claimAppleTemplateSelect = [
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
  'public_claim_token',
  'is_active',
  'created_at',
  'updated_at'
].join(',');

const claimAppleCustomerCardSelect = [
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
  'wallet_platform',
  'wallet_object_id',
  'wallet_serial_number',
  'balance_cents',
  'currency',
  'cloakroom_active',
  'metadata',
  'created_at',
  'updated_at'
].join(',');

const claimAppleCardInstanceSelect = [
  'id',
  'customer_card_id',
  'owner_id',
  'business_id',
  'template_id',
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
  'vip_level',
  'balance_cents',
  'currency',
  'cloakroom_active',
  'created_at',
  'updated_at',
  `card_templates(${claimAppleTemplateSelect})`,
  `customer_cards(${claimAppleCustomerCardSelect})`
].join(',');

const claimApplePassVersionSelect = [
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: Record<string, unknown>, status = 200) {
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

function errorJson(error: any, fallbackCode = 'CLAIM_APPLE_PASS_ERROR') {
  const status = Number(error?.statusCode || error?.status || 500);

  return json({
    error: error?.message || error?.error_message || 'Unbekannter Fehler',
    error_code: error?.error_code || fallbackCode,
    error_message: error?.error_message || error?.message || 'Apple-Wallet-Datei konnte nicht erstellt werden.',
    error_reason: error?.error_reason || 'Bitte prüfe Apple Wallet Secrets, Zertifikate und den Claim-Link.'
  }, status);
}

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function timestampMs(value: unknown) {
  const time = value ? new Date(String(value)).getTime() : 0;

  return Number.isFinite(time) ? time : 0;
}

function newestSourceTimestamp(cardInstance: Row) {
  const template = cardInstance.card_templates || {};
  const business = Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;

  return Math.max(
    timestampMs(cardInstance.updated_at),
    timestampMs(cardInstance.customer_cards?.updated_at),
    timestampMs(template.updated_at),
    timestampMs(business?.updated_at),
    timestampMs(business?.company_logo_updated_at),
    timestampMs(cardInstance.created_at),
    timestampMs(cardInstance.customer_cards?.created_at),
    timestampMs(template.created_at)
  );
}

function passJsonHasAppleWebServiceFields(passJson: Row) {
  return Boolean(
    stringValue(passJson?.authenticationToken)
    && /^https:\/\//i.test(stringValue(passJson?.webServiceURL))
  );
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

function pkpassResponse(signing: Row) {
  return new Response(signing.pkpass, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': signing.contentType || 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${stringValue(signing.fileName) || 'wallet-card.pkpass'}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      Expires: '0'
    }
  });
}

async function findReusableClaimPassVersion(supabaseAdmin: any, cardInstance: Row) {
  const { data, error } = await supabaseAdmin
    .from('apple_pass_versions')
    .select(claimApplePassVersionSelect)
    .eq('owner_id', cardInstance.owner_id)
    .eq('business_id', cardInstance.business_id)
    .eq('template_id', cardInstance.template_id)
    .eq('card_instance_id', cardInstance.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.pass_json || !passJsonHasAppleWebServiceFields(data.pass_json)) {
    return null;
  }

  if (!appleWalletProvider.passVersionHasTemplateAssets(cardInstance.card_templates, data)) {
    return null;
  }

  return timestampMs(data.last_updated_at) >= newestSourceTimestamp(cardInstance)
    ? data
    : null;
}

async function logAppleClaimIssue(supabaseAdmin: any, cardInstance: Row, status: string, passVersion: Row | null, signing: Row, options: Row = {}) {
  const { error: logError } = await supabaseAdmin.from('wallet_push_logs').insert({
    owner_id: cardInstance.owner_id,
    business_id: cardInstance.business_id,
    card_instance_id: cardInstance.id,
    wallet_platform: 'apple',
    action: 'claim_apple_pass',
    status,
    request_payload: {
      card_instance_id: cardInstance.id,
      template_id: cardInstance.template_id,
      serial_number: cardInstance.apple_serial_number || cardInstance.wallet_serial_number || cardInstance.id,
      reused_pass_version: Boolean(options.reusedPassVersion)
    },
    response_payload: {
      pass_version_id: passVersion?.id || null,
      version: passVersion?.version || null,
      reused_pass_version: Boolean(options.reusedPassVersion),
      signing: {
        ok: signing.ok,
        status: signing.status,
        error_code: signing.error_code || null,
        error_message: signing.error_message || null
      }
    },
    error_message: signing.ok ? null : signing.error_message || signing.error_reason || null
  });

  if (logError) {
    throw createStructuredError(
      500,
      'WALLET_PUSH_LOG_INSERT_FAILED',
      'Wallet Audit-Log konnte nicht gespeichert werden.',
      logError.message || 'claim_apple_pass konnte nicht in wallet_push_logs geschrieben werden.'
    );
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur POST ist erlaubt.',
      error_reason: 'Apple-Wallet-Claims müssen per POST angefordert werden.'
    }, 405);
  }

  try {
    const supabaseAdmin = await serviceClient();
    await enforcePublicClaimRateLimit(supabaseAdmin, request, 'claim-apple-pass');

    const body = await request.json().catch(() => ({})) as Row;
    const cardId = stringValue(body.cardId || body.card_id);
    const templateId = stringValue(body.templateId || body.template_id);
    const walletObjectId = stringValue(body.walletObjectId || body.wallet_object_id);

    if (!cardId || !templateId) {
      throw createStructuredError(
        400,
        'CARD_AND_TEMPLATE_REQUIRED',
        'Karten-ID oder Template-ID fehlt.',
        'Die Claim-Seite muss cardId und templateId senden, damit die Apple-Wallet-Datei erstellt werden kann.'
      );
    }

    const { data: cardInstance, error } = await supabaseAdmin
      .from('card_instances')
      .select(claimAppleCardInstanceSelect)
      .eq('id', cardId)
      .eq('template_id', templateId)
      .eq('wallet_platform', 'apple')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!cardInstance || !cardInstance.card_templates || !cardInstance.customer_cards) {
      throw createStructuredError(
        404,
        'APPLE_CLAIM_CARD_NOT_FOUND',
        'Apple-Wallet-Karte nicht gefunden.',
        'Erstelle die Karte zuerst über den Claim-Link oder prüfe die Template-ID.'
      );
    }

    if (cardInstance.card_templates.is_active === false) {
      throw createStructuredError(
        404,
        'TEMPLATE_INACTIVE',
        'Template ist nicht aktiv.',
        'Für inaktive Templates werden keine neuen Apple-Wallet-Dateien ausgegeben.'
      );
    }

    const storedWalletObjectId = stringValue(cardInstance.customer_cards.wallet_object_id || cardInstance.wallet_object_id);

    if (!storedWalletObjectId || !walletObjectId || storedWalletObjectId !== walletObjectId) {
      throw createStructuredError(
        403,
        'APPLE_CLAIM_TOKEN_MISMATCH',
        'Karte passt nicht zu diesem Browser-Claim.',
        'Der gespeicherte Claim-Schlüssel stimmt nicht mit der angefragten Karte ueberein.'
      );
    }

    const appleCardInstance = await appleWalletProvider.ensurePassAuthenticationToken(supabaseAdmin, cardInstance);
    let reusedPassVersion = false;
    let passVersion = await findReusableClaimPassVersion(supabaseAdmin, appleCardInstance);

    if (passVersion) {
      reusedPassVersion = true;
    } else {
      passVersion = await appleWalletProvider.updatePassFields(
        supabaseAdmin,
        appleCardInstance,
        appleCardInstance.card_templates,
        {},
        {
          reason: 'claim_apple_pass',
          enqueue: false
        }
      );
    }

    const signing = await appleWalletProvider.signPass(passVersion.pass_json, passVersion.assets || {});
    const status = signing.ok ? 'sent' : signing.status || 'prepared';

    await logAppleClaimIssue(supabaseAdmin, appleCardInstance, status, passVersion, signing, {
      reusedPassVersion
    });

    if (!reusedPassVersion) {
      const { data: updatedCardInstance, error: cardUpdateError } = await supabaseAdmin
        .from('card_instances')
        .update({
          last_wallet_update_at: new Date().toISOString()
        })
        .eq('id', appleCardInstance.id)
        .eq('customer_card_id', appleCardInstance.customer_card_id)
        .eq('owner_id', appleCardInstance.owner_id)
        .eq('business_id', appleCardInstance.business_id)
        .eq('template_id', appleCardInstance.template_id)
        .eq('wallet_platform', 'apple')
        .select('id')
        .maybeSingle();

      if (cardUpdateError || !updatedCardInstance) {
        throw createStructuredError(
          500,
          'CARD_WALLET_STATE_UPDATE_FAILED',
          'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.',
          cardUpdateError?.message || 'claim_apple_pass konnte last_wallet_update_at nicht für die erwartete Apple-Karteninstanz aktualisieren.'
        );
      }
    }

    if (signing.ok) {
      return pkpassResponse(signing);
    }

    return json({
      ok: false,
      status,
      passVersion: {
        id: passVersion.id,
        version: passVersion.version
      },
      signing: publicAppleSigningResult(signing)
    }, ['APPLE_PASS_SIGNING_CONFIG_MISSING', 'APPLE_PASS_CONFIG_MISSING', 'APPLE_WEB_SERVICE_CONFIG_MISSING'].includes(signing.error_code) ? 501 : 502);
  } catch (error) {
    return errorJson(error);
  }
});
