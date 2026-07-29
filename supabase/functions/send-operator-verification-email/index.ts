// Supabase Edge Function: Verifizierungs-Mail nach Betreiber-Freigabe senden.
//
// Wird per Supabase Cron oder manuell mit x-cron-secret aufgerufen. Die Function
// verarbeitet nur Betreiberprofile, bei denen `unlock=true` ist und der SQL-
// Trigger eine ausstehende Verifizierungs-Mail markiert hat.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Row = Record<string, any>;

const MIN_SECRET_LENGTH = 32;
const DEFAULT_BATCH_LIMIT = 20;
const MAX_BATCH_LIMIT = 50;

const profileSelect = [
  'id',
  'email',
  'display_name',
  'unlock',
  'verification_email_attempts',
  'verification_email_status',
  'verification_email_requested_at'
].join(',');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
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

function errorJson(error: any) {
  const status = Number(error?.statusCode || error?.status || 500);

  return json({
    error: error?.message || error?.error_message || 'Verifizierungs-Mail konnte nicht verarbeitet werden.',
    error_code: error?.error_code || 'SEND_OPERATOR_VERIFICATION_EMAIL_ERROR',
    error_message: error?.error_message || error?.message || 'Verifizierungs-Mail konnte nicht verarbeitet werden.',
    error_reason: error?.error_reason || 'Bitte prüfe Supabase Secrets, SMTP/Mail-Setup und Cron-Konfiguration.'
  }, status);
}

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function configuredSecret(value: unknown) {
  const text = stringValue(value);

  return Boolean(text && text.length >= MIN_SECRET_LENGTH && !text.startsWith('YOUR_') && !text.includes('CHANGE_THIS'));
}

async function sha256Bytes(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function timingSafeSecretMatches(expected: unknown, candidate: unknown) {
  const expectedText = stringValue(expected);
  const candidateText = stringValue(candidate);

  if (!configuredSecret(expectedText) || !candidateText) {
    return false;
  }

  const [expectedHash, candidateHash] = await Promise.all([
    sha256Bytes(expectedText),
    sha256Bytes(candidateText)
  ]);
  let diff = 0;

  for (let index = 0; index < expectedHash.length; index += 1) {
    diff |= expectedHash[index] ^ candidateHash[index];
  }

  return diff === 0;
}

function positiveInteger(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}

function supabaseUrl() {
  const value = Deno.env.get('SUPABASE_URL');

  if (!value) {
    throw createStructuredError(
      500,
      'SUPABASE_EDGE_CONFIG_MISSING',
      'Supabase URL fehlt.',
      'Setze SUPABASE_URL als Edge Secret.'
    );
  }

  return value;
}

function serviceClient() {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!serviceRoleKey) {
    throw createStructuredError(
      500,
      'SUPABASE_EDGE_CONFIG_MISSING',
      'Supabase Service Role Key fehlt.',
      'Setze SUPABASE_SERVICE_ROLE_KEY als Edge Secret.'
    );
  }

  return createClient(supabaseUrl(), serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function anonAuthClient() {
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!anonKey) {
    throw createStructuredError(
      500,
      'OPERATOR_VERIFICATION_ANON_KEY_MISSING',
      'Supabase Anon Key fehlt.',
      'Setze SUPABASE_ANON_KEY als Edge Secret, damit Supabase Auth den Magic Link versenden kann.'
    );
  }

  return createClient(supabaseUrl(), anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function assertAutomationSecret(request: Request) {
  const configured = stringValue(
    Deno.env.get('OPERATOR_VERIFICATION_CRON_SECRET')
      || Deno.env.get('WALLET_CRON_SECRET')
      || Deno.env.get('CRON_SECRET')
  );
  const bearerToken = stringValue(request.headers.get('authorization')).replace(/^Bearer\s+/i, '');
  const headerSecret = stringValue(request.headers.get('x-cron-secret'));

  if (
    await timingSafeSecretMatches(configured, bearerToken)
    || await timingSafeSecretMatches(configured, headerSecret)
  ) {
    return;
  }

  throw createStructuredError(
    401,
    'OPERATOR_VERIFICATION_AUTH_REQUIRED',
    'Automation-Secret fehlt oder ist falsch.',
    'Sende x-cron-secret oder Authorization: Bearer mit OPERATOR_VERIFICATION_CRON_SECRET bzw. WALLET_CRON_SECRET.'
  );
}

function appBaseUrl() {
  const baseUrl = stringValue(Deno.env.get('APP_PUBLIC_BASE_URL'));

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw createStructuredError(
      500,
      'OPERATOR_VERIFICATION_APP_URL_MISSING',
      'Öffentliche App-URL fehlt.',
      'Setze APP_PUBLIC_BASE_URL auf die öffentliche Render-Domain, z. B. https://el-promillo.ch.'
    );
  }

  return baseUrl.replace(/\/$/, '');
}

function redirectTo() {
  const path = stringValue(Deno.env.get('OPERATOR_VERIFICATION_REDIRECT_PATH')) || '/dashboard.html';

  return new URL(path, `${appBaseUrl()}/`).toString();
}

function isEmailConfirmed(user: Row = {}) {
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

async function loadPendingProfiles(supabaseAdmin: any, limit: number, maxAttempts: number) {
  const { data, error } = await supabaseAdmin
    .from('operator_profiles')
    .select(profileSelect)
    .eq('unlock', true)
    .is('verification_email_sent_at', null)
    .not('verification_email_requested_at', 'is', null)
    .in('verification_email_status', ['pending', 'failed'])
    .lt('verification_email_attempts', maxAttempts)
    .order('verification_email_requested_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  return data || [];
}

async function markProfile(supabaseAdmin: any, profile: Row, patch: Row) {
  const attempts = Number(profile.verification_email_attempts || 0) + 1;
  const { error } = await supabaseAdmin
    .from('operator_profiles')
    .update({
      verification_email_attempts: attempts,
      ...patch
    })
    .eq('id', profile.id);

  if (error) {
    throw error;
  }
}

function mailMode() {
  return (stringValue(Deno.env.get('OPERATOR_VERIFICATION_MAIL_MODE')) || 'supabase_auth').toLowerCase();
}

async function sendViaSupabaseAuth(email: string, targetRedirectTo: string) {
  const supabaseAuth = anonAuthClient();
  const { error } = await supabaseAuth.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: targetRedirectTo,
      shouldCreateUser: false
    }
  });

  if (error) {
    throw createStructuredError(
      502,
      'OPERATOR_VERIFICATION_SUPABASE_MAGIC_LINK_FAILED',
      'Supabase Magic Link konnte nicht gesendet werden.',
      error.message || 'Bitte prüfe Supabase Auth SMTP und Site URL/Redirect URLs.'
    );
  }

  return {
    provider: 'supabase_auth'
  };
}

async function generateMagicLink(supabaseAdmin: any, email: string, targetRedirectTo: string) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: targetRedirectTo
    }
  });

  if (error) {
    throw createStructuredError(
      502,
      'OPERATOR_VERIFICATION_MAGIC_LINK_FAILED',
      'Supabase Magic Link konnte nicht erstellt werden.',
      error.message || 'Bitte prüfe Supabase Auth und Redirect URLs.'
    );
  }

  const actionLink = data?.properties?.action_link || data?.action_link;

  if (!actionLink) {
    throw createStructuredError(
      502,
      'OPERATOR_VERIFICATION_MAGIC_LINK_MISSING',
      'Supabase hat keinen Magic Link zurückgegeben.',
      'Bitte prüfe die Supabase Auth-Konfiguration.'
    );
  }

  return String(actionLink);
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function verificationEmailHtml(displayName: string, actionLink: string) {
  const safeName = escapeHtml(displayName || 'Hallo');
  const safeLink = escapeHtml(actionLink);

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.55;color:#3d2a1f">
      <h1 style="margin:0 0 12px;font-size:24px">El Promillo Zugang bestätigen</h1>
      <p>${safeName}</p>
      <p>Dein Betreiberkonto wurde freigeschaltet. Bestätige jetzt deine E-Mail-Adresse und melde dich direkt per Magic Link an.</p>
      <p style="margin:24px 0">
        <a href="${safeLink}" style="display:inline-block;background:#8b4f2f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">
          E-Mail bestätigen und einloggen
        </a>
      </p>
      <p>Falls der Button nicht funktioniert, öffne diesen Link:</p>
      <p><a href="${safeLink}">${safeLink}</a></p>
      <p style="color:#7a6a5f;font-size:13px">Wenn du diesen Account nicht erstellt hast, kannst du diese E-Mail ignorieren.</p>
    </div>
  `;
}

async function sendViaResend(supabaseAdmin: any, profile: Row, email: string, targetRedirectTo: string) {
  const apiKey = stringValue(Deno.env.get('RESEND_API_KEY'));
  const fromEmail = stringValue(Deno.env.get('MAIL_FROM_EMAIL')) || 'Fabricio@el-promillo.ch';
  const fromName = stringValue(Deno.env.get('MAIL_FROM_NAME')) || 'El Promillo';

  if (!apiKey) {
    throw createStructuredError(
      500,
      'OPERATOR_VERIFICATION_RESEND_API_KEY_MISSING',
      'Resend API Key fehlt.',
      'Setze RESEND_API_KEY oder nutze OPERATOR_VERIFICATION_MAIL_MODE=supabase_auth mit Supabase SMTP.'
    );
  }

  const actionLink = await generateMagicLink(supabaseAdmin, email, targetRedirectTo);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: 'Dein El Promillo Zugang ist freigeschaltet',
      html: verificationEmailHtml(profile.display_name || '', actionLink)
    })
  });
  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw createStructuredError(
      502,
      'OPERATOR_VERIFICATION_RESEND_FAILED',
      'Verifizierungs-Mail konnte nicht versendet werden.',
      responseBody?.message || responseBody?.error || 'Bitte prüfe RESEND_API_KEY und die verifizierte Absenderdomain.'
    );
  }

  return {
    provider: 'resend'
  };
}

async function sendVerificationEmail(supabaseAdmin: any, profile: Row, email: string, targetRedirectTo: string) {
  if (mailMode() === 'resend') {
    return sendViaResend(supabaseAdmin, profile, email, targetRedirectTo);
  }

  return sendViaSupabaseAuth(email, targetRedirectTo);
}

async function processProfile(supabaseAdmin: any, profile: Row, targetRedirectTo: string) {
  try {
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.id);

    if (userError || !userData?.user) {
      throw createStructuredError(
        404,
        'OPERATOR_VERIFICATION_USER_NOT_FOUND',
        'Supabase Auth User wurde nicht gefunden.',
        userError?.message || 'Das Betreiberprofil verweist auf keinen gültigen Auth User.'
      );
    }

    const user = userData.user;
    const email = stringValue(user.email || profile.email).toLowerCase();

    if (!email) {
      throw createStructuredError(
        400,
        'OPERATOR_VERIFICATION_EMAIL_MISSING',
        'E-Mail fehlt.',
        'Der freigeschaltete Betreiber hat keine E-Mail-Adresse.'
      );
    }

    if (isEmailConfirmed(user)) {
      await markProfile(supabaseAdmin, profile, {
        verification_email_sent_at: new Date().toISOString(),
        verification_email_status: 'sent',
        verification_email_last_error: null
      });

      return {
        id: profile.id,
        status: 'already_verified',
        provider: null
      };
    }

    const result = await sendVerificationEmail(supabaseAdmin, profile, email, targetRedirectTo);

    await markProfile(supabaseAdmin, profile, {
      verification_email_sent_at: new Date().toISOString(),
      verification_email_status: 'sent',
      verification_email_last_error: null
    });

    return {
      id: profile.id,
      status: 'sent',
      provider: result.provider
    };
  } catch (error) {
    await markProfile(supabaseAdmin, profile, {
      verification_email_status: 'failed',
      verification_email_last_error: String(error?.error_reason || error?.message || error).slice(0, 700)
    });

    return {
      id: profile.id,
      status: 'failed',
      error_code: error?.error_code || 'OPERATOR_VERIFICATION_PROFILE_FAILED',
      error_message: error?.error_message || error?.message || 'Verifizierungs-Mail fehlgeschlagen.'
    };
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
      error_reason: 'Supabase Cron ruft diese Edge Function per POST auf.'
    }, 405);
  }

  try {
    await assertAutomationSecret(request);

    const body = await request.json().catch(() => ({}));
    const limit = positiveInteger(body.limit, DEFAULT_BATCH_LIMIT, MAX_BATCH_LIMIT);
    const maxAttempts = positiveInteger(Deno.env.get('OPERATOR_VERIFICATION_MAX_ATTEMPTS'), 5, 20);
    const targetRedirectTo = redirectTo();
    const supabaseAdmin = serviceClient();
    const pendingProfiles = await loadPendingProfiles(supabaseAdmin, limit, maxAttempts);
    const results = [];

    for (const profile of pendingProfiles) {
      results.push(await processProfile(supabaseAdmin, profile, targetRedirectTo));
    }

    return json({
      ok: true,
      processed: results.length,
      sent: results.filter((entry) => entry.status === 'sent').length,
      already_verified: results.filter((entry) => entry.status === 'already_verified').length,
      failed: results.filter((entry) => entry.status === 'failed').length,
      mail_mode: mailMode(),
      redirect_to: targetRedirectTo,
      results
    });
  } catch (error) {
    return errorJson(error);
  }
});
