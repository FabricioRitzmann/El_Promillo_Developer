// Supabase Edge Function: öffentliche Wallet-Karte claimen.
//
// Erstellt aus einem aktiven Template eine individuelle Kundenkarte plus
// card_instance. Die Funktion nutzt die Service Role nur serverseitig in Edge,
// damit die öffentliche Claim-Seite keine Secrets braucht.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { featureEnabled, normalizeTemplateType } from '../_shared/templateFeatures.ts';
import { enforcePublicClaimRateLimit } from '../_shared/publicRateLimit.ts';
import { supabaseCardEmblemUrl } from '../_shared/cardEmblems.ts';

type Row = Record<string, any>;
const walletEmblemColumnNames = new Set(['resolved_emblem_key', 'resolved_emblem_url', 'emblem_updated_at']);

const CLAIM_WALLET_OBJECT_ID_MAX_LENGTH = 180;
const CLAIM_WALLET_OBJECT_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

const claimTemplateSelect = [
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
    error: error?.message || error?.error_message || 'Unbekannter Fehler',
    error_code: error?.error_code || 'CLAIM_CARD_EDGE_ERROR',
    error_message: error?.error_message || error?.message || 'Kundenkarte konnte nicht erstellt werden.',
    error_reason: error?.error_reason || 'Bitte prüfe den Claim-Link und versuche es erneut.'
  }, status);
}

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function claimToken(value: unknown) {
  const token = stringValue(value).toLowerCase();

  return /^[a-f0-9]{36}$/.test(token) ? token : '';
}

function claimSource(value: unknown) {
  return stringValue(value) === 'wallet_share' ? 'wallet_share' : 'direct_qr';
}

function templateBusiness(template: Row) {
  return Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;
}

function generateCustomerCode() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `WC-${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function generateCardInstanceNumber() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `CI-${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function generatePassAuthToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function walletPlatform(value: unknown) {
  return stringValue(value) === 'google' ? 'google' : 'apple';
}

function validateWalletObjectId(walletObjectId: string) {
  if (!walletObjectId) {
    throw createStructuredError(
      400,
      'CLAIM_WALLET_OBJECT_ID_REQUIRED',
      'Claim-Schlüssel fehlt.',
      'Die öffentliche Claim-Seite muss einen stabilen walletObjectId senden, damit die Karte idempotent erstellt und später sicher für Apple oder Google Wallet geladen werden kann.'
    );
  }

  if (walletObjectId.length > CLAIM_WALLET_OBJECT_ID_MAX_LENGTH || !CLAIM_WALLET_OBJECT_ID_PATTERN.test(walletObjectId)) {
    throw createStructuredError(
      400,
      'CLAIM_WALLET_OBJECT_ID_INVALID',
      'Claim-Schlüssel ist ungültig.',
      'walletObjectId darf maximal 180 Zeichen enthalten und nur Buchstaben, Zahlen, Punkt, Unterstrich, Bindestrich oder Doppelpunkt nutzen.'
    );
  }
}

function isUniqueViolation(error: any) {
  return error?.code === '23505';
}

function safeHttpsUrl(value: unknown) {
  const candidate = stringValue(value);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch (_error) {
    return '';
  }
}

function hasCrmRegistrationValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCrmRegistrationValue);
  if (typeof value === 'boolean') return value === true;
  if (value === null || value === undefined) return false;
  if (typeof value === 'object') return Object.values(value as Row).some(hasCrmRegistrationValue);
  return stringValue(value) !== '';
}

function hasCrmRegistrationInput(registration: unknown) {
  if (!registration || typeof registration !== 'object' || Array.isArray(registration)) return false;
  const payload = registration as Row;
  const standard = payload.standard && typeof payload.standard === 'object' ? payload.standard : {};
  const socials = Array.isArray(payload.social_links) ? payload.social_links : [];
  const customValues = payload.custom_values && typeof payload.custom_values === 'object' ? payload.custom_values : {};

  return hasCrmRegistrationValue(standard)
    || socials.some((entry: Row) => hasCrmRegistrationValue(entry?.url))
    || hasCrmRegistrationValue(customValues);
}

function crmRegistrationConfig(template: Row) {
  const business = templateBusiness(template) || {};
  const settings = template.settings && typeof template.settings === 'object' ? template.settings : {};
  const fields = Array.isArray(settings.crmRegistrationFields)
    ? settings.crmRegistrationFields.filter((field: Row) => field && field.enabled === true).slice(0, 50)
    : [];
  return {
    enabled: business.guest_crm_enabled === true && settings.personalizedGuestDataEnabled === true && fields.length > 0,
    fields
  };
}

async function createPersonalizedGuestProfile(supabaseAdmin: any, template: Row, body: Row) {
  const registration = body.crmRegistration || body.crm_registration;
  if (!hasCrmRegistrationInput(registration)) return null;
  const config = crmRegistrationConfig(template);
  if (!config.enabled) {
    throw createStructuredError(403, 'CRM_REGISTRATION_NOT_ALLOWED', 'Personalisierung ist für diese Karte nicht freigegeben.', 'Öffentliche CRM-Daten dürfen nur für ein aktiviertes Template erfasst werden.');
  }
  const standardInput = registration.standard && typeof registration.standard === 'object' ? registration.standard : {};
  const socialInput = Array.isArray(registration.social_links) ? registration.social_links : [];
  const customInput = registration.custom_values && typeof registration.custom_values === 'object' ? registration.custom_values : {};
  const standardAllowed = new Set(['first_name', 'last_name', 'display_name', 'email', 'phone', 'mobile_phone', 'birth_date', 'company', 'job_title', 'street', 'house_number', 'address_addition', 'postal_code', 'city', 'region', 'country']);
  const socialAllowed = new Set(['linkedin', 'instagram', 'facebook', 'tiktok', 'x', 'website']);
  const configuredStandardKeys = new Set(config.fields.map((field: Row) => stringValue(field.key)).filter((key: string) => standardAllowed.has(key)));
  if (config.fields.some((field: Row) => stringValue(field.key) === 'address')) {
    for (const key of ['street', 'house_number', 'address_addition', 'postal_code', 'city', 'region', 'country']) configuredStandardKeys.add(key);
  }
  const configuredSocialKeys = new Set(config.fields.map((field: Row) => stringValue(field.key)).filter((key: string) => socialAllowed.has(key)));
  const crmPayload: Row = {};
  const configuredCustomIds: string[] = [];
  for (const field of config.fields) {
    const key = stringValue(field.key);
    let value: any;
    if (key === 'address') value = stringValue(standardInput.street || standardInput.postal_code || standardInput.city);
    else if (key.startsWith('custom:')) {
      const definitionId = key.slice(7);
      if (/^[0-9a-f-]{36}$/i.test(definitionId)) configuredCustomIds.push(definitionId);
      value = customInput[definitionId];
    } else if (socialAllowed.has(key)) value = socialInput.find((entry: Row) => stringValue(entry.platform).toLowerCase() === key)?.url;
    else value = standardInput[key];
    if (field.required === true && (value === null || value === undefined || stringValue(value) === '' || (Array.isArray(value) && !value.length))) {
      throw createStructuredError(400, 'CRM_REQUIRED_FIELD_MISSING', `${stringValue(field.label || key)} ist ein Pflichtfeld.`, 'Fülle alle im Karteneditor als Pflichtfeld markierten Angaben aus.');
    }
  }
  for (const [key, value] of Object.entries(standardInput)) {
    if (configuredStandardKeys.has(key)) crmPayload[key] = stringValue(value) || null;
  }
  if (crmPayload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(crmPayload.email)) {
    throw createStructuredError(400, 'CRM_EMAIL_INVALID', 'E-Mail-Adresse ist ungültig.', 'Prüfe die Schreibweise der E-Mail-Adresse.');
  }
  if (crmPayload.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(crmPayload.birth_date)) {
    throw createStructuredError(400, 'CRM_BIRTH_DATE_INVALID', 'Geburtsdatum ist ungültig.', 'Verwende ein gültiges Datum.');
  }
  const socials = socialInput.slice(0, 20).map((entry: Row) => ({ platform: stringValue(entry.platform).toLowerCase(), url: safeHttpsUrl(entry.url) })).filter((entry: Row) => configuredSocialKeys.has(entry.platform) && entry.url);
  if (socialInput.some((entry: Row) => stringValue(entry.url) && !safeHttpsUrl(entry.url))) {
    throw createStructuredError(400, 'CRM_SOCIAL_URL_INVALID', 'Social-Link ist ungültig.', 'Social Links müssen vollständige HTTPS-URLs sein.');
  }
  let definitions: Row[] = [];
  if (configuredCustomIds.length) {
    const result = await supabaseAdmin.from('crm_field_definitions').select('id,name,field_type,required,options').eq('business_id', template.business_id).eq('active', true).eq('public_registration_allowed', true).in('id', configuredCustomIds);
    if (result.error) throw result.error;
    definitions = result.data || [];
    if (definitions.length !== new Set(configuredCustomIds).size) {
      throw createStructuredError(403, 'CRM_CUSTOM_FIELD_NOT_ALLOWED', 'Ein CRM-Feld ist nicht öffentlich freigegeben.', 'Aktualisiere die Template-Konfiguration im Karteneditor.');
    }
  }
  for (const definition of definitions) {
    const value = customInput[definition.id];
    if (definition.required && (value === null || value === undefined || stringValue(value) === '' || (Array.isArray(value) && !value.length))) {
      throw createStructuredError(400, 'CRM_CUSTOM_REQUIRED', `${definition.name} ist ein Pflichtfeld.`, 'Fülle das erforderliche CRM-Feld aus.');
    }
    if (definition.field_type === 'URL' && value && !safeHttpsUrl(value)) {
      throw createStructuredError(400, 'CRM_CUSTOM_URL_INVALID', `${definition.name}: URL ist ungültig.`, 'URLs müssen HTTPS verwenden.');
    }
    if (definition.field_type === 'NUMBER' && value !== null && value !== undefined && stringValue(value) !== '' && !Number.isFinite(Number(value))) {
      throw createStructuredError(400, 'CRM_CUSTOM_NUMBER_INVALID', `${definition.name}: Zahl ist ungültig.`, 'Gib einen gültigen Zahlenwert ein.');
    }
    if (definition.field_type === 'DATE' && value && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      throw createStructuredError(400, 'CRM_CUSTOM_DATE_INVALID', `${definition.name}: Datum ist ungültig.`, 'Verwende ein gültiges Datum.');
    }
    if (definition.field_type === 'BOOLEAN' && value !== null && value !== undefined && typeof value !== 'boolean') {
      throw createStructuredError(400, 'CRM_CUSTOM_BOOLEAN_INVALID', `${definition.name}: Wahr/Falsch-Wert ist ungültig.`, 'Verwende einen gültigen Wahr/Falsch-Wert.');
    }
    if (['SELECT', 'MULTISELECT'].includes(definition.field_type)) {
      const allowed = new Set(Array.isArray(definition.options) ? definition.options.map(String) : []);
      const values = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
      if (values.some((entry) => !allowed.has(entry))) throw createStructuredError(400, 'CRM_CUSTOM_OPTION_INVALID', `${definition.name}: Auswahl ist ungültig.`, 'Wähle nur konfigurierte Optionen.');
    }
  }
  const duplicateQuery = crmPayload.email
    ? await supabaseAdmin.from('guest_crm_profiles').select('guest_profile_id').eq('business_id', template.business_id).ilike('email', crmPayload.email).limit(1)
    : crmPayload.phone
      ? await supabaseAdmin.from('guest_crm_profiles').select('guest_profile_id').eq('business_id', template.business_id).eq('phone', crmPayload.phone).limit(1)
      : { data: [] };
  if ('error' in duplicateQuery && duplicateQuery.error) throw duplicateQuery.error;
  const possibleDuplicate = Boolean(duplicateQuery.data?.length);
  const displayName = crmPayload.display_name || [crmPayload.first_name, crmPayload.last_name].filter(Boolean).join(' ') || null;
  const profileResult = await supabaseAdmin.from('guest_profiles').insert({
    owner_id: template.owner_id, business_id: template.business_id, display_name: displayName,
    metadata: { created_from: 'public_crm_registration', possible_duplicate: possibleDuplicate }
  }).select('id').single();
  if (profileResult.error) throw profileResult.error;
  const guestId = profileResult.data.id;
  const crmResult = await supabaseAdmin.from('guest_crm_profiles').insert({
    guest_profile_id: guestId, owner_id: template.owner_id, business_id: template.business_id, ...crmPayload
  });
  if (crmResult.error) throw crmResult.error;
  if (socials.length) {
    const result = await supabaseAdmin.from('guest_social_links').insert(socials.map((entry: Row) => ({ ...entry, guest_profile_id: guestId, owner_id: template.owner_id, business_id: template.business_id })));
    if (result.error) throw result.error;
  }
  if (definitions.length) {
    const result = await supabaseAdmin.from('crm_field_values').insert(definitions.map((definition) => ({ guest_profile_id: guestId, field_definition_id: definition.id, owner_id: template.owner_id, business_id: template.business_id, value: customInput[definition.id] ?? null })));
    if (result.error) throw result.error;
  }
  const auditResult = await supabaseAdmin.from('guest_crm_audit_events').insert({ guest_profile_id: guestId, owner_id: template.owner_id, business_id: template.business_id, event_type: 'CREATED', changed_fields: [...Object.keys(crmPayload), ...(socials.length ? ['socials'] : []), ...(definitions.length ? ['custom_fields'] : [])], source: 'public_registration' });
  if (auditResult.error) throw auditResult.error;
  return { guestId, possibleDuplicate };
}

function publicClaimCard(card: Row) {
  const metadata = card.metadata && typeof card.metadata === 'object' && !Array.isArray(card.metadata)
    ? card.metadata
    : {};

  return {
    id: card.id,
    template_id: card.template_id,
    card_instance_number: card.card_instance_number,
    customer_code: card.customer_code,
    status: card.status,
    stamp_count: card.stamp_count,
    streak_count: card.streak_count,
    vip_status: card.vip_status,
    wallet_platform: card.wallet_platform,
    wallet_object_id: card.wallet_object_id,
    wallet_serial_number: card.wallet_serial_number,
    balance_cents: card.balance_cents,
    currency: card.currency,
    cloakroom_active: card.cloakroom_active,
    metadata: {
      card_instance_number: metadata.card_instance_number,
      balance_cents: metadata.balance_cents,
      cloakroom_active: metadata.cloakroom_active,
      template_type: metadata.template_type,
      google_wallet_claim_key: metadata.google_wallet_claim_key
    },
    created_at: card.created_at
  };
}

async function findExistingWalletCard(supabaseAdmin: any, platform: string, walletObjectId: string) {
  if (!walletObjectId) {
    return null;
  }

  const selectColumns = 'id, owner_id, business_id, template_id, card_instance_number, customer_code, status, stamp_count, streak_count, vip_status, pass_serial_number, wallet_platform, wallet_object_id, wallet_serial_number, balance_cents, currency, cloakroom_active, metadata, created_at';
  const { data, error } = await supabaseAdmin
    .from('customer_cards')
    .select(selectColumns)
    .eq('wallet_platform', platform)
    .eq('wallet_object_id', walletObjectId)
    .limit(2);

  if (error) {
    throw error;
  }

  const exactMatches = data || [];

  if (exactMatches.length > 1) {
    throw createStructuredError(
      409,
      'CLAIM_WALLET_OBJECT_ID_DUPLICATE',
      'Wallet-Claim-Schlüssel ist mehrfach vergeben.',
      'Bitte prüfe die vorhandenen Kundendaten. Derselbe Wallet-Schlüssel darf nur zu einer Kundenkarte gehören.'
    );
  }

  if (exactMatches[0]) {
    return exactMatches[0];
  }

  if (platform !== 'google') {
    return null;
  }

  const { data: claimKeyMatches, error: claimKeyError } = await supabaseAdmin
    .from('customer_cards')
    .select(selectColumns)
    .eq('wallet_platform', platform)
    .eq('metadata->>google_wallet_claim_key', walletObjectId)
    .limit(2);

  if (claimKeyError) {
    throw claimKeyError;
  }

  if ((claimKeyMatches || []).length > 1) {
    throw createStructuredError(
      409,
      'CLAIM_WALLET_OBJECT_ID_DUPLICATE',
      'Wallet-Claim-Schlüssel ist mehrfach vergeben.',
      'Bitte prüfe die vorhandenen Kundendaten. Derselbe Google-Claim-Schlüssel darf nur zu einer Kundenkarte gehören.'
    );
  }

  return claimKeyMatches?.[0] || null;
}

async function insertClaimEvent(supabaseAdmin: any, payload: Row) {
  const { error } = await supabaseAdmin.from('card_events').insert(payload);

  if (error) {
    throw createStructuredError(
      500,
      'CLAIM_CARD_EVENT_SAVE_FAILED',
      'Claim-Ereignis konnte nicht gespeichert werden.',
      error.message || 'card_events.insert hat einen Fehler zurückgegeben.'
    );
  }
}

async function insertClaimCardInstance(supabaseAdmin: any, payload: Row) {
  let { data, error } = await supabaseAdmin
    .from('card_instances')
    .insert(payload)
    .select('id')
    .maybeSingle();

  if (
    error?.code === '42703'
    && Array.from(walletEmblemColumnNames).some((columnName) => String(error?.message || '').includes(columnName))
  ) {
    const fallbackPayload = { ...payload };

    for (const columnName of walletEmblemColumnNames) {
      delete fallbackPayload[columnName];
    }

    const fallbackResult = await supabaseAdmin
      .from('card_instances')
      .insert(fallbackPayload)
      .select('id')
      .maybeSingle();

    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error || !data) {
    throw createStructuredError(
      500,
      'CLAIM_CARD_INSTANCE_SAVE_FAILED',
      'Karteninstanz konnte nicht gespeichert werden.',
      error?.message || 'card_instances.insert hat keine Karteninstanz zurückgegeben.'
    );
  }

  return data;
}

async function reuseExistingClaimCard(supabaseAdmin: any, template: Row, existingCard: Row, platform: string, walletObjectId: string, source: string, eventType = 'claim_reused') {
  if (existingCard.template_id !== template.id) {
    throw createStructuredError(
      409,
      'CLAIM_WALLET_OBJECT_ID_CONFLICT',
      'Wallet-Claim-Schlüssel gehört zu einem anderen Template.',
      'Oeffne den originalen Claim-Link dieser Karte oder erstelle für dieses Template eine neue Wallet-Karte.'
    );
  }

  await insertClaimEvent(supabaseAdmin, {
    owner_id: existingCard.owner_id,
    business_id: existingCard.business_id,
    template_id: existingCard.template_id,
    customer_card_id: existingCard.id,
    event_type: eventType,
    details: {
      card_instance_number: existingCard.card_instance_number,
      wallet_platform: platform,
      wallet_object_id: walletObjectId,
      source,
      template_type: normalizeTemplateType(template)
    }
  });

  return { card: existingCard, reused: true, recoveredFromUniqueConflict: eventType === 'claim_reused_after_unique_conflict' };
}

async function createCardInstance(supabaseAdmin: any, template: Row, body: Row) {
  const platform = walletPlatform(body.walletPlatform || body.wallet_platform);
  const walletObjectId = stringValue(body.walletObjectId || body.wallet_object_id);
  const source = claimSource(body.claimSource || body.claim_source);
  validateWalletObjectId(walletObjectId);

  const existingCard = await findExistingWalletCard(supabaseAdmin, platform, walletObjectId);

  if (existingCard) {
    return await reuseExistingClaimCard(supabaseAdmin, template, existingCard, platform, walletObjectId, source);
  }

  const personalizedGuest = await createPersonalizedGuestProfile(supabaseAdmin, template, body);

  const cardInstanceNumber = generateCardInstanceNumber();
  const customerCode = generateCustomerCode();
  const cardId = crypto.randomUUID();
  const passSerialNumber = `serial-${crypto.randomUUID()}`;
  const walletSerialNumber = platform === 'apple' ? passSerialNumber : walletObjectId;
  const currency = template.settings?.currency || 'CHF';
  const vipStatus = featureEnabled(template, 'vip') ? (template.vip_tier || template.settings?.vipDefaultTier || 'Standard') : null;
  const metadata = {
    card_instance_number: cardInstanceNumber,
    balance_cents: 0,
    cloakroom_active: false,
    claim_source: source,
    template_type: normalizeTemplateType(template),
    ...(platform === 'google' ? { google_wallet_claim_key: walletObjectId } : {})
  };

  const { data: card, error: cardError } = await supabaseAdmin
    .from('customer_cards')
    .insert({
      id: cardId,
      owner_id: template.owner_id,
      business_id: template.business_id,
      template_id: template.id,
      guest_profile_id: personalizedGuest?.guestId || null,
      card_instance_number: cardInstanceNumber,
      customer_code: customerCode,
      stamp_count: 0,
      streak_count: 0,
      vip_status: vipStatus,
      pass_serial_number: passSerialNumber,
      pass_authentication_token: generatePassAuthToken(),
      wallet_platform: platform,
      wallet_object_id: walletObjectId,
      wallet_serial_number: walletSerialNumber,
      balance_cents: 0,
      currency,
      cloakroom_active: false,
      claim_source: source,
      metadata
    })
    .select('id, owner_id, business_id, template_id, card_instance_number, customer_code, status, stamp_count, streak_count, vip_status, pass_serial_number, wallet_platform, wallet_object_id, wallet_serial_number, balance_cents, currency, cloakroom_active, claim_source, metadata, created_at')
    .single();

  if (cardError) {
    if (isUniqueViolation(cardError)) {
      const recoveredCard = await findExistingWalletCard(supabaseAdmin, platform, walletObjectId);

      if (recoveredCard) {
        return await reuseExistingClaimCard(supabaseAdmin, template, recoveredCard, platform, walletObjectId, source, 'claim_reused_after_unique_conflict');
      }
    }

    throw cardError;
  }

  await insertClaimCardInstance(supabaseAdmin, {
    id: card.id,
    customer_card_id: card.id,
    owner_id: template.owner_id,
    business_id: template.business_id,
    template_id: template.id,
    card_instance_number: card.card_instance_number,
    wallet_platform: platform,
    wallet_object_id: walletObjectId,
    wallet_serial_number: walletSerialNumber,
    apple_serial_number: platform === 'apple' ? card.pass_serial_number : null,
    google_object_id: platform === 'google' ? walletObjectId : null,
    push_enabled: true,
    demographics_collected: false,
    resolved_emblem_key: 'neutral_couple',
    resolved_emblem_url: supabaseCardEmblemUrl({ demographics_collected: false }, Deno.env.get('SUPABASE_URL') || ''),
    emblem_updated_at: new Date().toISOString(),
    current_streak: card.streak_count || 0,
    current_stamps: card.stamp_count || 0,
    vip_level: card.vip_status,
    balance_cents: card.balance_cents || 0,
    currency: card.currency || currency,
    cloakroom_active: false
  });

  await insertClaimEvent(supabaseAdmin, {
    owner_id: template.owner_id,
    business_id: template.business_id,
    template_id: template.id,
    customer_card_id: card.id,
    event_type: 'claim_created',
    details: {
      customer_code: card.customer_code,
      card_instance_number: card.card_instance_number,
      wallet_platform: platform,
      wallet_object_id: walletObjectId,
      source,
      personalized_guest: Boolean(personalizedGuest),
      possible_duplicate: Boolean(personalizedGuest?.possibleDuplicate),
      template_type: normalizeTemplateType(template)
    }
  });

  return { card, reused: false };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur POST ist erlaubt.',
      error_reason: 'Karten-Claims müssen als POST gesendet werden.'
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

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    await enforcePublicClaimRateLimit(supabaseAdmin, request, 'claim-card');

    const body = await request.json().catch(() => ({})) as Row;
    const templateId = stringValue(body.templateId || body.template_id);
    const token = claimToken(body.token || body.claimToken || body.claim_token);

    if (!templateId && !token) {
      throw createStructuredError(
        400,
        'CLAIM_LINK_REQUIRED',
        'Template fehlt.',
        'Der Claim-Link enthält weder einen gültigen Claim-Token noch eine Template-ID.'
      );
    }

    const templateQuery = supabaseAdmin
      .from('card_templates')
      .select(claimTemplateSelect)
      .eq('is_active', true);

    const { data: template, error: templateError } = await (token
      ? templateQuery.eq('public_claim_token', token)
      : templateQuery.eq('id', templateId)
    )
      .maybeSingle();

    if (templateError) {
      throw templateError;
    }

    if (!template) {
      throw createStructuredError(
        404,
        'TEMPLATE_NOT_FOUND',
        'Template nicht gefunden oder inaktiv.',
        'Diese Karte ist nicht verfügbar.'
      );
    }

    const { card, reused, recoveredFromUniqueConflict } = await createCardInstance(supabaseAdmin, template, body);
    const business = templateBusiness(template);

    return json({
      ok: true,
      reused,
      recoveredFromUniqueConflict: Boolean(recoveredFromUniqueConflict),
      template_type: normalizeTemplateType(template),
      card: publicClaimCard(card),
      template: {
        id: template.id,
        card_name: template.card_name,
        card_type: template.card_type,
        template_type: template.template_type,
        business_name: business?.name || business?.company_name || template.business_name,
        business_logo_url: business?.logo_url || business?.company_logo_url || template.business_logo_url || template.logo_url || ''
      },
      googleWalletMessage: card.wallet_platform === 'google'
        ? 'Google Wallet ist vorbereitet. Die Karteninstanz wurde gespeichert; die echte Google-Wallet-Objekterzeugung folgt über eine Wallet-Edge-Funktion.'
        : null
    });
  } catch (error) {
    return errorJson(error);
  }
});
