import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { publicCardTemplateResponse } from '../_shared/publicResponses.ts';
import { enforcePublicClaimRateLimit } from '../_shared/publicRateLimit.ts';

type Row = Record<string, any>;

const templateSelect = [
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
  'businesses(name,logo_url,guest_crm_enabled)',
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
      'Content-Type': 'application/json'
    }
  });
}

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function claimToken(value: unknown) {
  const token = stringValue(value).toLowerCase();

  return /^[a-f0-9]{36}$/.test(token) ? token : '';
}

function createStructuredError(statusCode: number, code: string, message: string, reason: string) {
  return {
    statusCode,
    error_code: code,
    error_message: message,
    error_reason: reason
  };
}

function errorJson(error: any) {
  const status = Number(error?.statusCode || error?.status || 500);

  return json({
    error: error?.message || error?.error_message || 'Unbekannter Fehler',
    error_code: error?.error_code || 'GET_PUBLIC_TEMPLATE_ERROR',
    error_message: error?.error_message || error?.message || 'Template konnte nicht geladen werden.',
    error_reason: error?.error_reason || 'Bitte prüfe den Claim-Link und versuche es erneut.'
  }, status);
}

async function requestBody(request: Request) {
  if (request.method !== 'POST') {
    return {};
  }

  return await request.json().catch(() => ({}));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!['GET', 'POST'].includes(request.method)) {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur GET oder POST ist erlaubt.',
      error_reason: 'Die öffentliche Claim-Seite lädt Template-Daten per GET oder POST.'
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
    const templateId = stringValue(body.templateId || body.template_id || url.searchParams.get('templateId') || url.searchParams.get('template'));
    const token = claimToken(body.token || body.claimToken || body.claim_token || url.searchParams.get('token') || url.searchParams.get('claim_token'));

    if (!templateId && !token) {
      throw createStructuredError(
        400,
        'CLAIM_LINK_REQUIRED',
        'Template fehlt.',
        'Der Claim-Link enthält weder einen gültigen Claim-Token noch eine Template-ID.'
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    await enforcePublicClaimRateLimit(supabaseAdmin, request, 'get-public-template');

    const query = supabaseAdmin
      .from('card_templates')
      .select(templateSelect)
      .eq('is_active', true);

    const { data: template, error } = await (token
      ? query.eq('public_claim_token', token)
      : query.eq('id', templateId)
    )
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!template) {
      throw createStructuredError(
        404,
        'TEMPLATE_NOT_FOUND',
        'Template nicht gefunden oder inaktiv.',
        'Diese Karte ist nicht verfügbar.'
      );
    }

    return json(publicCardTemplateResponse(template));
  } catch (error) {
    return errorJson(error);
  }
});
