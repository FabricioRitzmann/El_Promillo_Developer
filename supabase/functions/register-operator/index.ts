// Supabase Edge Function: Betreiber registrieren.
//
// Die Registrierung läuft bewusst serverseitig, damit Supabase nicht sofort
// eine Bestätigungs-Mail versendet. Bis Custom SMTP/Supabase Pro aktiv ist,
// reicht die manuelle Freigabe über `unlock=true`; die Magic-Link-Strecke
// bleibt über OPERATOR_EMAIL_VERIFICATION_REQUIRED vorbereitet.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { enforcePublicClaimRateLimit } from '../_shared/publicRateLimit.ts';

const MIN_PASSWORD_LENGTH = 6;
const MAX_DISPLAY_NAME_LENGTH = 120;

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  '20minutemail.com',
  '33mail.com',
  'anonaddy.com',
  'dispostable.com',
  'example.com',
  'example.net',
  'example.org',
  'fakeinbox.com',
  'guerrillamail.com',
  'mailinator.com',
  'maildrop.cc',
  'moakt.com',
  'sharklasers.com',
  'tempmail.com',
  'tempmail.net',
  'trashmail.com',
  'yopmail.com'
]);

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

function errorJson(error: any) {
  const status = Number(error?.statusCode || error?.status || 500);

  return json({
    error: error?.message || error?.error_message || 'Registrierung fehlgeschlagen.',
    error_code: error?.error_code || 'REGISTER_OPERATOR_ERROR',
    error_message: error?.error_message || error?.message || 'Registrierung fehlgeschlagen.',
    error_reason: error?.error_reason || 'Bitte prüfe die Eingaben und versuche es erneut.'
  }, status);
}

function createStructuredError(statusCode: number, errorCode: string, message: string, reason: string) {
  return {
    statusCode,
    error_code: errorCode,
    error_message: message,
    error_reason: reason
  };
}

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function normalizeOperatorEmail(value: unknown) {
  return stringValue(value).toLowerCase();
}

function validateOperatorEmail(value: unknown) {
  const email = normalizeOperatorEmail(value);
  const parts = email.split('@');
  const domain = parts[1] || '';
  const labels = domain.split('.');
  const tld = labels[labels.length - 1] || '';

  if (!email) {
    throw createStructuredError(
      400,
      'REGISTER_EMAIL_REQUIRED',
      'E-Mail fehlt.',
      'Bitte gib eine echte geschäftliche E-Mail-Adresse ein.'
    );
  }

  if (
    parts.length !== 2
    || email.length > 254
    || /\s/.test(email)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)
    || labels.some((label) => !label || label.startsWith('-') || label.endsWith('-'))
    || tld.length < 2
  ) {
    throw createStructuredError(
      400,
      'REGISTER_EMAIL_INVALID',
      'E-Mail ist ungültig.',
      'Bitte verwende eine echte, erreichbare E-Mail-Adresse.'
    );
  }

  if (
    domain === 'localhost'
    || domain.endsWith('.local')
    || domain.endsWith('.invalid')
    || DISPOSABLE_EMAIL_DOMAINS.has(domain)
  ) {
    throw createStructuredError(
      400,
      'REGISTER_EMAIL_NOT_ALLOWED',
      'Diese E-Mail-Adresse ist nicht erlaubt.',
      'Bitte verwende keine Test-, Wegwerf- oder Platzhalter-Adresse.'
    );
  }

  return email;
}

function validatePassword(value: unknown) {
  const password = String(value || '');

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw createStructuredError(
      400,
      'REGISTER_PASSWORD_TOO_SHORT',
      'Passwort ist zu kurz.',
      `Bitte verwende mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`
    );
  }

  return password;
}

function displayName(value: unknown) {
  return stringValue(value).slice(0, MAX_DISPLAY_NAME_LENGTH);
}

function serviceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw createStructuredError(
      500,
      'SUPABASE_EDGE_CONFIG_MISSING',
      'Supabase Edge Secrets fehlen.',
      'Setze SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY für register-operator.'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function isDuplicateUserError(error: any) {
  const message = String(error?.message || error?.msg || '').toLowerCase();

  return message.includes('already')
    || message.includes('registered')
    || message.includes('duplicate')
    || message.includes('exists');
}

function emailVerificationRequired() {
  return String(Deno.env.get('OPERATOR_EMAIL_VERIFICATION_REQUIRED') || '')
    .trim()
    .toLowerCase() === 'true';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur POST ist erlaubt.',
      error_reason: 'Die Registrierung wird per POST erstellt.'
    }, 405);
  }

  try {
    const supabaseAdmin = serviceClient();
    await enforcePublicClaimRateLimit(supabaseAdmin, request, 'register-operator', {
      limitEnv: 'OPERATOR_REGISTER_RATE_LIMIT',
      windowSecondsEnv: 'OPERATOR_REGISTER_RATE_LIMIT_WINDOW_SECONDS',
      limit: 12,
      windowSeconds: 3600
    });

    const body = await request.json().catch(() => ({}));
    const email = validateOperatorEmail(body.email);
    const password = validatePassword(body.password);
    const name = displayName(body.displayName || body.display_name);
    const requireEmailVerification = emailVerificationRequired();

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: !requireEmailVerification,
      user_metadata: {
        display_name: name
      }
    });

    if (error) {
      if (isDuplicateUserError(error)) {
        return json({
          ok: true,
          status: 'pending',
          message: 'Falls für diese E-Mail noch kein Konto existiert, wurde die Registrierung vorbereitet.'
        });
      }

      throw createStructuredError(
        400,
        'REGISTER_AUTH_CREATE_FAILED',
        'Account konnte nicht erstellt werden.',
        error.message || 'Supabase Auth hat die Registrierung abgelehnt.'
      );
    }

    const userId = data?.user?.id;

    if (!userId) {
      throw createStructuredError(
        500,
        'REGISTER_USER_ID_MISSING',
        'Account wurde nicht vollständig erstellt.',
        'Supabase Auth hat keine User-ID zurückgegeben.'
      );
    }

    const { error: profileError } = await supabaseAdmin
      .from('operator_profiles')
      .upsert({
        id: userId,
        email,
        display_name: name,
        unlock: false,
        verification_email_status: 'not_requested',
        verification_email_attempts: 0
      }, { onConflict: 'id' });

    if (profileError) {
      throw createStructuredError(
        500,
        'REGISTER_PROFILE_SAVE_FAILED',
        'Betreiberprofil konnte nicht gespeichert werden.',
        profileError.message || 'Bitte prüfe die operator_profiles Tabelle.'
      );
    }

    return json({
      ok: true,
      status: 'pending',
      message: requireEmailVerification
        ? 'Account erstellt. Nach der manuellen Freigabe senden wir dir automatisch den Verifizierungslink.'
        : 'Account erstellt. Sobald dein Account manuell freigeschaltet wurde, kannst du dich einloggen.'
    });
  } catch (error) {
    return errorJson(error);
  }
});
