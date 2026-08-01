import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { enforcePublicClaimRateLimit } from '../_shared/publicRateLimit.ts';
import { verifyWalletMessageToken, walletMessageCardId, walletMessageLinkPayload, walletMessageToken } from '../_shared/walletMessageLinks.ts';

type Row = Record<string, any>;

const cardSelect = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
  'customer_card_id',
  'card_instance_number',
  'wallet_platform',
  'current_stamps',
  'current_streak',
  'vip_level',
  'balance_cents',
  'currency',
  'cloakroom_active',
  'updated_at',
  'card_templates(id,business_name,card_name,card_type,template_type,description,businesses(name,logo_url))',
  'customer_cards(id,customer_code,status,stamp_count,streak_count,vip_status,balance_cents,currency,cloakroom_active,metadata,updated_at,created_at)'
].join(',');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function json(body: Row, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function stringValue(value: unknown) {
  return String(value || '').trim();
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
    error_code: error?.error_code || 'GET_WALLET_MESSAGE_ERROR',
    error_message: error?.error_message || error?.message || 'Nachricht konnte nicht geladen werden.',
    error_reason: error?.error_reason || 'Bitte öffne die Nachricht erneut aus deiner Wallet-Karte.'
  }, status);
}

async function requestBody(request: Request) {
  if (request.method !== 'POST') {
    return {};
  }

  return await request.json().catch(() => ({}));
}

function one(rowOrRows: any) {
  return Array.isArray(rowOrRows) ? rowOrRows[0] : rowOrRows;
}

function businessName(template: Row = {}) {
  const business = one(template.businesses) || {};
  return stringValue(business.name || business.company_name || template.business_name || 'Mein Unternehmen');
}

function cardName(template: Row = {}) {
  return stringValue(template.card_name || 'Kundenkarte');
}

function cardType(template: Row = {}) {
  return stringValue(template.template_type || template.card_type || 'generic_card');
}

function fallbackMessage(cardInstance: Row) {
  const customerCard = one(cardInstance.customer_cards) || {};
  const metadata = customerCard.metadata && typeof customerCard.metadata === 'object' ? customerCard.metadata : {};
  const message = stringValue(metadata.latest_wallet_message);

  if (!message) {
    return null;
  }

  return {
    title: stringValue(metadata.latest_wallet_title || 'Wallet Nachricht'),
    message,
    sentAt: stringValue(metadata.latest_wallet_message_at || cardInstance.updated_at || customerCard.updated_at),
    walletPlatform: stringValue(cardInstance.wallet_platform || 'wallet')
  };
}

function publicMessage(row: Row) {
  const campaign = one(row.wallet_notification_campaigns) || {};

  return {
    title: stringValue(campaign.title || 'Wallet Nachricht'),
    message: stringValue(campaign.message),
    sentAt: stringValue(row.sent_at || campaign.sent_at || campaign.created_at),
    walletPlatform: stringValue(row.wallet_platform || 'wallet')
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!['GET', 'POST'].includes(request.method)) {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur GET oder POST ist erlaubt.',
      error_reason: 'Die Nachrichten-Seite lädt Wallet-Nachrichten per GET oder POST.'
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

    const url = new URL(request.url);
    const body = await requestBody(request) as Row;
    const packedLink = walletMessageLinkPayload(body.m || body.messageLink || body.message_link || url.searchParams.get('m'));
    const cardId = packedLink.cardId || walletMessageCardId(body.card || body.cardId || body.card_id || url.searchParams.get('card') || url.searchParams.get('card_id'));
    const token = packedLink.token || walletMessageToken(body.token || url.searchParams.get('token') || url.searchParams.get('amp;token'));

    if (!cardId || !token) {
      throw createStructuredError(
        400,
        'MESSAGE_LINK_INVALID',
        'Nachrichten-Link ist unvollständig.',
        'Der Link muss card und token enthalten. Öffne die Nachricht direkt aus deiner Wallet-Karte.'
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    await enforcePublicClaimRateLimit(supabaseAdmin, request, 'get-wallet-message', { limit: 120, windowSeconds: 900 });

    const { data: cardInstance, error: cardError } = await supabaseAdmin
      .from('card_instances')
      .select(cardSelect)
      .eq('id', cardId)
      .maybeSingle();

    if (cardError) {
      throw cardError;
    }

    if (!cardInstance || !await verifyWalletMessageToken(cardInstance, token)) {
      throw createStructuredError(
        404,
        'MESSAGE_LINK_NOT_FOUND',
        'Nachricht nicht gefunden.',
        'Der Link ist ungültig oder gehört nicht zu dieser Wallet-Karte.'
      );
    }

    const { data: recipientRows, error: recipientError } = await supabaseAdmin
      .from('wallet_notification_recipients')
      .select('id,wallet_platform,status,sent_at,campaign_id,wallet_notification_campaigns(id,title,message,status,sent_at,created_at)')
      .eq('card_instance_id', cardId)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(10);

    if (recipientError) {
      throw recipientError;
    }

    const messages = (recipientRows || [])
      .map(publicMessage)
      .filter((message: Row) => message.message);
    const fallback = fallbackMessage(cardInstance);
    const latestMessage = messages[0] || fallback;
    const template = one(cardInstance.card_templates) || {};
    const customerCard = one(cardInstance.customer_cards) || {};

    return json({
      ok: true,
      card: {
        id: cardInstance.id,
        cardInstanceNumber: stringValue(cardInstance.card_instance_number || customerCard.card_instance_number),
        customerCode: stringValue(customerCard.customer_code),
        status: stringValue(customerCard.status || 'active'),
        walletPlatform: stringValue(cardInstance.wallet_platform || customerCard.wallet_platform),
        businessName: businessName(template),
        cardName: cardName(template),
        cardType: cardType(template)
      },
      latestMessage,
      messages
    });
  } catch (error) {
    return errorJson(error);
  }
});
