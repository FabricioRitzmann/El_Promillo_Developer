import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { appleWalletProvider } from '../_shared/appleWalletProvider.ts';
import { publicApplePassVersion } from '../_shared/publicResponses.ts';
import { corsHeaders, createStructuredError, errorJson, json } from '../_shared/walletNotificationService.ts';

const appleWebserviceTemplateSelect = [
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

const appleWebserviceCustomerCardSelect = [
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
  'pass_serial_number',
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

const appleWebserviceCardInstanceSelect = [
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
  `card_templates(${appleWebserviceTemplateSelect})`,
  `customer_cards(${appleWebserviceCustomerCardSelect})`
].join(',');

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value: string) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function timingSafeTokenMatches(expected: unknown, candidate: unknown) {
  const expectedText = stringValue(expected);
  const candidateText = stringValue(candidate);

  if (!expectedText || !candidateText) {
    return false;
  }

  const [expectedHash, candidateHash] = await Promise.all([
    sha256(expectedText),
    sha256(candidateText)
  ]);
  let diff = expectedHash.length ^ candidateHash.length;
  const length = Math.max(expectedHash.length, candidateHash.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (expectedHash.charCodeAt(index) || 0) ^ (candidateHash.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function pkpassResponse(signing: Record<string, any>, lastUpdated: string) {
  const lastModified = new Date(lastUpdated).toUTCString();

  return new Response(signing.pkpass, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': signing.contentType || 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${stringValue(signing.fileName) || 'wallet-card.pkpass'}"`,
      'Last-Modified': lastModified,
      'Cache-Control': 'no-cache'
    }
  });
}

function notModifiedResponse(lastUpdated: string) {
  return new Response(null, {
    status: 304,
    headers: {
      ...corsHeaders,
      'Last-Modified': new Date(lastUpdated).toUTCString(),
      'Cache-Control': 'no-cache'
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

function serviceClient() {
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

function applePassToken(request: Request) {
  return stringValue(request.headers.get('authorization')).replace(/^ApplePass\s+/i, '');
}

function configured(value: unknown) {
  const text = stringValue(value);
  return Boolean(text && !text.startsWith('YOUR_') && !text.includes('CHANGE_THIS'));
}

function validDate(value: unknown) {
  const text = stringValue(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);

  return Number.isNaN(date.getTime()) ? null : date;
}

function maxIsoDate(values: unknown[]) {
  const timestamps = values
    .map((value) => validDate(value)?.getTime() || 0)
    .filter(Boolean);

  if (!timestamps.length) {
    return new Date().toISOString();
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function routeParts(request: Request) {
  const url = new URL(request.url);
  const marker = '/apple-wallet-webservice/';
  const route = url.pathname.includes(marker)
    ? url.pathname.slice(url.pathname.indexOf(marker) + marker.length)
    : url.pathname.replace(/^\/+/, '');

  return route.split('/').filter(Boolean);
}

function uuidLike(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stringValue(value));
}

function relatedCardFromInstance(instance: Record<string, any> | null) {
  if (!instance) {
    return null;
  }

  return Array.isArray(instance.customer_cards)
    ? instance.customer_cards[0]
    : instance.customer_cards;
}

async function loadAppleInstanceBySerial(supabaseAdmin: any, serialNumber: string) {
  const { data: appleSerialInstance, error: appleSerialError } = await supabaseAdmin
    .from('card_instances')
    .select(appleWebserviceCardInstanceSelect)
    .eq('apple_serial_number', serialNumber)
    .eq('wallet_platform', 'apple')
    .maybeSingle();

  if (appleSerialError) {
    throw appleSerialError;
  }

  if (appleSerialInstance) {
    return appleSerialInstance;
  }

  if (!uuidLike(serialNumber)) {
    return null;
  }

  const { data: idSerialInstance, error: idSerialError } = await supabaseAdmin
    .from('card_instances')
    .select(appleWebserviceCardInstanceSelect)
    .eq('id', serialNumber)
    .eq('wallet_platform', 'apple')
    .maybeSingle();

  if (idSerialError) {
    throw idSerialError;
  }

  return idSerialInstance;
}

async function loadCardBySerial(supabaseAdmin: any, serialNumber: string, authenticationToken: string) {
  if (!authenticationToken) {
    throw createStructuredError(
      401,
      'APPLE_PASS_AUTH_REQUIRED',
      'Apple-Wallet-Authentifizierung fehlt.',
      'Apple muss Authorization: ApplePass <authenticationToken> senden.'
    );
  }

  let instance = await loadAppleInstanceBySerial(supabaseAdmin, serialNumber);
  let card = relatedCardFromInstance(instance);

  const { data: passSerialCard, error: passSerialError } = await supabaseAdmin
    .from('customer_cards')
    .select(appleWebserviceCustomerCardSelect)
    .eq('pass_serial_number', serialNumber)
    .eq('wallet_platform', 'apple')
    .maybeSingle();

  if (passSerialError) {
    throw passSerialError;
  }

  card = card || passSerialCard;

  if (!card) {
    const { data: walletSerialCard, error: walletSerialError } = await supabaseAdmin
      .from('customer_cards')
      .select(appleWebserviceCustomerCardSelect)
      .eq('wallet_serial_number', serialNumber)
      .eq('wallet_platform', 'apple')
      .maybeSingle();

    if (walletSerialError) {
      throw walletSerialError;
    }

    card = walletSerialCard;
  }

  const tokenMatches = card
    ? await timingSafeTokenMatches(card.pass_authentication_token, authenticationToken)
    : false;

  if (!card || !tokenMatches) {
    throw createStructuredError(
      401,
      'APPLE_PASS_AUTH_INVALID',
      'Apple-Wallet-Authentifizierung ungültig.',
      'Der Authorization Header muss zum authenticationToken der Karte passen.'
    );
  }

  if (!instance) {
    const { data: cardInstance, error: instanceError } = await supabaseAdmin
      .from('card_instances')
      .select(appleWebserviceCardInstanceSelect)
      .eq('customer_card_id', card.id)
      .eq('wallet_platform', 'apple')
      .maybeSingle();

    if (instanceError) {
      throw instanceError;
    }

    instance = cardInstance;
  }

  if (!instance) {
    throw createStructuredError(
      404,
      'APPLE_CARD_INSTANCE_NOT_FOUND',
      'Apple-Karteninstanz nicht gefunden.',
      'Die Seriennummer gehört zu keiner Apple-Wallet-Karteninstanz.'
    );
  }

  if (
    stringValue(instance.owner_id) !== stringValue(card.owner_id)
    || stringValue(instance.business_id) !== stringValue(card.business_id)
    || stringValue(instance.template_id) !== stringValue(card.template_id)
    || stringValue(card.wallet_platform) !== 'apple'
  ) {
    throw createStructuredError(
      409,
      'APPLE_CARD_CONTEXT_MISMATCH',
      'Apple-Karte passt nicht zur Karteninstanz.',
      'customer_cards und card_instances müssen zu demselben Betreiber, Business und Template gehören.'
    );
  }

  return {
    card,
    instance
  };
}

async function assertApplePassIdentity(supabaseAdmin: any, instance: Record<string, any>, passTypeIdentifier: string, serialNumber: string) {
  const card = instance.customer_cards || {};
  const expectedSerials = [
    instance.apple_serial_number,
    instance.wallet_serial_number,
    card.pass_serial_number,
    card.wallet_serial_number,
    instance.id
  ].map(stringValue).filter(Boolean);

  if (!expectedSerials.includes(serialNumber)) {
    throw createStructuredError(
      401,
      'APPLE_PASS_SERIAL_MISMATCH',
      'Apple-Pass-Seriennummer passt nicht zur Karte.',
      'Der Apple Wallet Web Service Pfad muss zur gespeicherten Karteninstanz passen.'
    );
  }

  const { data: latestPassVersion, error } = await supabaseAdmin
    .from('apple_pass_versions')
    .select('pass_type_identifier')
    .eq('card_instance_id', instance.id)
    .eq('serial_number', serialNumber)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const expectedPassTypeIdentifier = stringValue(latestPassVersion?.pass_type_identifier || Deno.env.get('APPLE_PASS_TYPE_ID'));

  if (configured(expectedPassTypeIdentifier) && expectedPassTypeIdentifier !== passTypeIdentifier) {
    throw createStructuredError(
      401,
      'APPLE_PASS_TYPE_MISMATCH',
      'Apple Pass Type ID passt nicht zur Karte.',
      'Der Pass Type Identifier im Web-Service-Pfad muss zur letzten Apple-Pass-Version passen.'
    );
  }
}

async function logAppleWebserviceEvent(
  supabaseAdmin: any,
  card: Record<string, any>,
  instance: Record<string, any>,
  action: string,
  status: string,
  requestPayload: Record<string, unknown>,
  responsePayload: Record<string, unknown> = {},
  errorMessage = ''
) {
  const ownerId = stringValue(instance.owner_id || card.owner_id);
  const businessId = stringValue(instance.business_id || card.business_id);

  if (!ownerId || !businessId) {
    return;
  }

  const { error } = await supabaseAdmin.from('wallet_push_logs').insert({
    owner_id: ownerId,
    business_id: businessId,
    card_instance_id: instance.id,
    wallet_platform: 'apple',
    action,
    status,
    request_payload: requestPayload,
    response_payload: responsePayload,
    error_message: errorMessage || null
  });

  if (error) {
    console.warn('Apple Wallet Webservice Log konnte nicht gespeichert werden:', error.message);
  }
}

async function handleRegister(request: Request, supabaseAdmin: any, parts: string[]) {
  const [, , deviceLibraryIdentifier, , passTypeIdentifier, serialNumber] = parts;
  const body = await request.json().catch(() => ({}));
  const pushToken = stringValue(body.pushToken);
  const authenticationToken = applePassToken(request);

  if (!pushToken) {
    throw createStructuredError(400, 'PUSH_TOKEN_REQUIRED', 'Push Token fehlt.', 'Apple sendet pushToken im JSON Body.');
  }

  const { card, instance } = await loadCardBySerial(supabaseAdmin, serialNumber, authenticationToken);
  await assertApplePassIdentity(supabaseAdmin, instance, passTypeIdentifier, serialNumber);

  const { data: existingRegistration, error: existingRegistrationError } = await supabaseAdmin
    .from('apple_wallet_registrations')
    .select('id')
    .eq('device_library_identifier', deviceLibraryIdentifier)
    .eq('pass_type_identifier', passTypeIdentifier)
    .eq('serial_number', serialNumber)
    .maybeSingle();

  if (existingRegistrationError) {
    throw existingRegistrationError;
  }

  const registration = await appleWalletProvider.registerDevice(supabaseAdmin, {
    ownerId: card.owner_id,
    businessId: card.business_id,
    templateId: card.template_id,
    cardInstanceId: instance.id,
    deviceLibraryIdentifier,
    passTypeIdentifier,
    serialNumber,
    authenticationToken,
    pushToken
  });

  await logAppleWebserviceEvent(
    supabaseAdmin,
    card,
    instance,
    'apple_device_registered',
    'registered',
    {
      device_library_identifier: deviceLibraryIdentifier,
      pass_type_identifier: passTypeIdentifier,
      serial_number: serialNumber
    },
    {
      registration_id: registration.id,
      created: !existingRegistration,
      has_push_token: Boolean(pushToken)
    }
  );

  return json({ registered: true, created: !existingRegistration }, existingRegistration ? 200 : 201);
}

async function handleUnregister(request: Request, supabaseAdmin: any, parts: string[]) {
  const [, , deviceLibraryIdentifier, , passTypeIdentifier, serialNumber] = parts;
  const { card, instance } = await loadCardBySerial(supabaseAdmin, serialNumber, applePassToken(request));
  await assertApplePassIdentity(supabaseAdmin, instance, passTypeIdentifier, serialNumber);
  const unregisterResult = await appleWalletProvider.unregisterDevice(supabaseAdmin, {
    deviceLibraryIdentifier,
    passTypeIdentifier,
    serialNumber,
    ownerId: instance.owner_id,
    businessId: instance.business_id,
    templateId: instance.template_id,
    cardInstanceId: instance.id
  });

  await logAppleWebserviceEvent(
    supabaseAdmin,
    card,
    instance,
    'apple_device_unregistered',
    'unregistered',
    {
      device_library_identifier: deviceLibraryIdentifier,
      pass_type_identifier: passTypeIdentifier,
      serial_number: serialNumber
    },
    {
      removed: Boolean(unregisterResult.removed)
    }
  );

  return json({ registered: false, removed: Boolean(unregisterResult.removed) });
}

async function handleChangedSerials(request: Request, supabaseAdmin: any, parts: string[]) {
  const url = new URL(request.url);
  const [, , deviceLibraryIdentifier, , passTypeIdentifier] = parts;
  const since = stringValue(url.searchParams.get('passesUpdatedSince'));
  const sinceDate = validDate(since);

  // Apple fragt diese Liste nur mit deviceLibraryIdentifier und Pass Type ab;
  // pro-Pass authenticationToken ist hier nicht eindeutig.
  const { data: registrations, error } = await supabaseAdmin
    .from('apple_wallet_registrations')
    .select('serial_number, card_instance_id')
    .eq('device_library_identifier', deviceLibraryIdentifier)
    .eq('pass_type_identifier', passTypeIdentifier);

  if (error) {
    throw error;
  }

  if (!registrations?.length) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const registrationKeys = new Set(
    (registrations || [])
      .map((registration: any) => `${stringValue(registration.card_instance_id)}:${stringValue(registration.serial_number)}`)
      .filter((key: string) => !key.startsWith(':') && !key.endsWith(':'))
  );
  const registeredSerialNumbers = [...new Set((registrations || []).map((registration: any) => registration.serial_number).filter(Boolean))];
  const registeredCardInstanceIds = [...new Set((registrations || []).map((registration: any) => registration.card_instance_id).filter(Boolean))];

  if (!registeredSerialNumbers.length || !registeredCardInstanceIds.length) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let versionQuery = supabaseAdmin
    .from('apple_pass_versions')
    .select('owner_id,business_id,card_instance_id,serial_number,version,last_updated_at')
    .eq('pass_type_identifier', passTypeIdentifier)
    .in('serial_number', registeredSerialNumbers)
    .in('card_instance_id', registeredCardInstanceIds);

  if (sinceDate) {
    versionQuery = versionQuery.gt('last_updated_at', sinceDate.toISOString());
  }

  const { data: changedVersions, error: versionError } = await versionQuery;

  if (versionError) {
    throw versionError;
  }

  const latestChangedVersionBySerial = new Map<string, any>();

  for (const version of changedVersions || []) {
    const serialNumber = stringValue(version.serial_number);
    const registrationKey = `${stringValue(version.card_instance_id)}:${serialNumber}`;

    if (!registrationKeys.has(registrationKey)) {
      continue;
    }

    const current = latestChangedVersionBySerial.get(serialNumber);
    const currentTime = validDate(current?.last_updated_at)?.getTime() || 0;
    const nextTime = validDate(version.last_updated_at)?.getTime() || 0;

    if (serialNumber && (!current || nextTime >= currentTime)) {
      latestChangedVersionBySerial.set(serialNumber, version);
    }
  }

  const changedLatestVersions = [...latestChangedVersionBySerial.values()];
  const serialNumbers = changedLatestVersions.map((version: any) => version.serial_number);

  if (!serialNumbers.length) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const lastUpdated = maxIsoDate(changedLatestVersions.map((version: any) => version.last_updated_at));
  const logRows = changedLatestVersions
    .filter((version: any) => version.owner_id && version.business_id && version.card_instance_id)
    .map((version: any) => ({
      owner_id: version.owner_id,
      business_id: version.business_id,
      card_instance_id: version.card_instance_id,
      wallet_platform: 'apple',
      action: 'apple_changed_serials_listed',
      status: 'sent',
      request_payload: {
        device_library_identifier: deviceLibraryIdentifier,
        pass_type_identifier: passTypeIdentifier,
        passes_updated_since: since || null
      },
      response_payload: {
        serial_number: version.serial_number,
        version: version.version,
        last_updated_at: version.last_updated_at,
        response_last_updated: lastUpdated
      }
    }));

  if (logRows.length) {
    const { error: logError } = await supabaseAdmin
      .from('wallet_push_logs')
      .insert(logRows);

    if (logError) {
      console.warn('Apple Wallet Changed-Serials Audit konnte nicht gespeichert werden:', logError.message);
    }
  }

  return json({
    serialNumbers,
    lastUpdated
  });
}

async function handleGetPass(request: Request, supabaseAdmin: any, parts: string[]) {
  const [, , passTypeIdentifier, serialNumber] = parts;
  const { card, instance } = await loadCardBySerial(supabaseAdmin, serialNumber, applePassToken(request));
  await assertApplePassIdentity(supabaseAdmin, instance, passTypeIdentifier, serialNumber);
  const latestPass = await appleWalletProvider.getUpdatedPass(supabaseAdmin, {
    passTypeIdentifier,
    serialNumber,
    ownerId: instance.owner_id,
    businessId: instance.business_id,
    templateId: instance.template_id,
    cardInstanceId: instance.id
  });

  if (!latestPass) {
    throw createStructuredError(404, 'APPLE_PASS_VERSION_NOT_FOUND', 'Keine Pass-Version gefunden.', 'Erstelle zuerst eine Apple-Pass-Version.');
  }

  const ifModifiedSince = validDate(request.headers.get('if-modified-since'));
  const lastUpdated = validDate(latestPass.last_updated_at);

  if (ifModifiedSince && lastUpdated && lastUpdated.getTime() <= ifModifiedSince.getTime()) {
    await logAppleWebserviceEvent(
      supabaseAdmin,
      card,
      instance,
      'apple_pass_not_modified',
      'not_modified',
      {
        pass_type_identifier: passTypeIdentifier,
        serial_number: serialNumber,
        if_modified_since: request.headers.get('if-modified-since')
      },
      {
        pass_version_id: latestPass.id,
        version: latestPass.version,
        last_updated_at: latestPass.last_updated_at
      }
    );

    return notModifiedResponse(latestPass.last_updated_at);
  }

  const signing = await appleWalletProvider.signPass(latestPass.pass_json, latestPass.assets || {});

  if (signing.ok) {
    await logAppleWebserviceEvent(
      supabaseAdmin,
      card,
      instance,
      'apple_pass_downloaded',
      'sent',
      {
        pass_type_identifier: passTypeIdentifier,
        serial_number: serialNumber
      },
      {
        pass_version_id: latestPass.id,
        version: latestPass.version,
        content_type: signing.contentType
      }
    );

    return pkpassResponse(signing, latestPass.last_updated_at);
  }

  await logAppleWebserviceEvent(
    supabaseAdmin,
    card,
    instance,
    'apple_pass_download_failed',
    signing.status || 'failed',
    {
      pass_type_identifier: passTypeIdentifier,
      serial_number: serialNumber
    },
    {
      pass_version_id: latestPass.id,
      version: latestPass.version,
      error_code: signing.error_code || null
    },
    signing.error_message || signing.error_reason || 'Apple-Pass konnte nicht signiert werden.'
  );

  return json({
    ok: false,
    passVersion: publicApplePassVersion(latestPass),
    signing: {
      ok: signing.ok,
      status: signing.status || 'failed',
      error_code: signing.error_code || null,
      error_message: signing.error_message || null
    },
    status: signing.status || 'failed'
  }, signingHttpStatus(signing));
}

async function handleAppleLog(request: Request) {
  const body = request.method === 'POST'
    ? await request.json().catch(() => ({}))
    : {};
  const logs = Array.isArray(body.logs)
    ? body.logs.map((line: unknown) => stringValue(line)).filter(Boolean).slice(0, 50)
    : [];

  if (logs.length) {
    console.warn('Apple Wallet Webservice Diagnose:', logs.join('\n'));
  }

  return json({
    ok: true,
    received: logs.length
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = serviceClient();
    const parts = routeParts(request);

    if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'devices' && parts[3] === 'registrations' && parts.length === 6) {
      return await handleRegister(request, supabaseAdmin, parts);
    }

    if (request.method === 'DELETE' && parts[0] === 'v1' && parts[1] === 'devices' && parts[3] === 'registrations' && parts.length === 6) {
      return await handleUnregister(request, supabaseAdmin, parts);
    }

    if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'devices' && parts[3] === 'registrations' && parts.length === 5) {
      return await handleChangedSerials(request, supabaseAdmin, parts);
    }

    if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'passes' && parts.length === 4) {
      return await handleGetPass(request, supabaseAdmin, parts);
    }

    if (['GET', 'POST'].includes(request.method) && parts[0] === 'v1' && parts[1] === 'log') {
      return await handleAppleLog(request);
    }

    return json({
      error_code: 'APPLE_ROUTE_NOT_FOUND',
      error_message: 'Apple Wallet Route nicht gefunden.',
      error_reason: 'Prüfe den Apple Wallet Web Service Pfad.'
    }, 404);
  } catch (error) {
    return errorJson(error, 'APPLE_WALLET_WEBSERVICE_ERROR');
  }
});
