import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Row = Record<string, any>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const editableRoles = new Set(['admin', 'manager']);
const definitionRoles = new Set(['admin', 'manager']);
const exportRoles = new Set(['admin', 'manager']);
const fieldTypes = new Set(['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTISELECT', 'URL']);
const socialPlatforms = new Set(['linkedin', 'instagram', 'facebook', 'tiktok', 'x', 'website', 'other']);
const crmFields = [
  'first_name', 'last_name', 'display_name', 'birth_date', 'company', 'job_title', 'email', 'phone', 'mobile_phone',
  'street', 'house_number', 'address_addition', 'postal_code', 'city', 'region', 'country'
];

function json(body: Row, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function uuid(value: unknown) {
  const normalized = text(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized) ? normalized : '';
}

function createStructuredError(statusCode: number, code: string, message: string) {
  const error: any = new Error(message);
  error.statusCode = statusCode;
  error.error_code = code;
  return error;
}

function fail(statusCode: number, code: string, message: string) {
  throw createStructuredError(statusCode, code, message);
}

function errorJson(error: any) {
  return json({
    error: error?.message || 'CRM-Anfrage fehlgeschlagen.',
    error_code: error?.error_code || 'GUEST_CRM_ERROR',
    error_message: error?.message || 'CRM-Anfrage fehlgeschlagen.',
    error_reason: error?.error_reason || 'Bitte prüfe Berechtigung, Eingaben und Tenant-Zuordnung.'
  }, Number(error?.statusCode || 500));
}

function safeUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.toString();
  } catch (_error) {
    return '';
  }
}

function permissions(role: string) {
  return {
    can_view: Boolean(role),
    can_edit: editableRoles.has(role),
    can_export: exportRoles.has(role),
    can_manage_fields: definitionRoles.has(role),
    can_anonymize: role === 'admin'
  };
}

async function operatorContext(admin: any, request: Request, requestedBusinessId: string) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) fail(401, 'CRM_AUTH_REQUIRED', 'Anmeldung erforderlich.');

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const userId = authData?.user?.id;
  if (authError || !userId) fail(401, 'CRM_SESSION_INVALID', 'Sitzung ist ungültig oder abgelaufen.');

  let businessQuery = admin.from('businesses').select('id,owner_id,name,guest_crm_enabled,crm_active_guest_days');
  if (requestedBusinessId) businessQuery = businessQuery.eq('id', requestedBusinessId);
  const { data: ownedBusinesses, error: ownedError } = await businessQuery.eq('owner_id', userId).limit(1);
  if (ownedError) throw ownedError;

  let business = ownedBusinesses?.[0] || null;
  let role = business ? 'admin' : '';

  if (!business) {
    let membershipQuery = admin.from('business_memberships').select('role,businesses(id,owner_id,name,guest_crm_enabled,crm_active_guest_days)').eq('user_id', userId).eq('active', true);
    if (requestedBusinessId) membershipQuery = membershipQuery.eq('business_id', requestedBusinessId);
    const { data: memberships, error: membershipError } = await membershipQuery.limit(1);
    if (membershipError) throw membershipError;
    const membership = memberships?.[0];
    business = Array.isArray(membership?.businesses) ? membership.businesses[0] : membership?.businesses;
    role = membership?.role || '';
  }

  if (!business || !role) fail(403, 'CRM_TENANT_FORBIDDEN', 'Kein Zugriff auf dieses Business.');
  if (!business.guest_crm_enabled) fail(403, 'CRM_DISABLED', 'Guest CRM ist für diese Firma deaktiviert.');

  return { userId, business, role, permissions: permissions(role) };
}

async function matchingGuestIds(admin: any, businessId: string, body: Row) {
  let candidateIds: Set<string> | null = null;
  const intersect = (values: string[]) => {
    const next = new Set(values.filter(Boolean));
    candidateIds = candidateIds === null ? next : new Set([...candidateIds].filter((value) => next.has(value)));
  };
  const query = text(body.query).replace(/[,%()]/g, ' ').slice(0, 120);

  if (query) {
    const pattern = `*${query}*`;
    const [profileResult, crmResult, cardResult] = await Promise.all([
      admin.from('guest_profiles').select('id').eq('business_id', businessId).ilike('display_name', pattern).limit(500),
      admin.from('guest_crm_profiles').select('guest_profile_id').eq('business_id', businessId)
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},display_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},mobile_phone.ilike.${pattern}`).limit(500),
      admin.from('customer_cards').select('guest_profile_id').eq('business_id', businessId)
        .or(`card_instance_number.ilike.${pattern},customer_code.ilike.${pattern}`).limit(500)
    ]);
    for (const result of [profileResult, crmResult, cardResult]) if (result.error) throw result.error;
    intersect([
      ...(profileResult.data || []).map((row: Row) => row.id),
      ...(crmResult.data || []).map((row: Row) => row.guest_profile_id),
      ...(cardResult.data || []).map((row: Row) => row.guest_profile_id)
    ]);
  }

  const templateType = text(body.template_type);
  const vipLevel = text(body.vip_level);
  if (templateType || vipLevel) {
    let cards = admin.from('customer_cards').select('guest_profile_id,vip_status,card_templates!inner(template_type)').eq('business_id', businessId);
    if (templateType) cards = cards.eq('card_templates.template_type', templateType);
    if (vipLevel) cards = cards.ilike('vip_status', vipLevel);
    const result = await cards.limit(5000);
    if (result.error) throw result.error;
    intersect((result.data || []).map((row: Row) => row.guest_profile_id));
  }

  const profileState = text(body.profile_state);
  if (profileState) {
    const [profiles, crmProfiles] = await Promise.all([
      admin.from('guest_profiles').select('id').eq('business_id', businessId).limit(10000),
      admin.from('guest_crm_profiles').select('guest_profile_id,first_name,last_name,email,phone,mobile_phone').eq('business_id', businessId).limit(10000)
    ]);
    if (profiles.error) throw profiles.error;
    if (crmProfiles.error) throw crmProfiles.error;
    const crmByGuest = new Map((crmProfiles.data || []).map((row: Row) => [row.guest_profile_id, row]));
    const matches = (profiles.data || []).map((row: Row) => row.id).filter((id: string) => {
      const crm = crmByGuest.get(id) || {};
      const complete = Boolean(crm.first_name && crm.last_name && (crm.email || crm.phone || crm.mobile_phone));
      if (profileState === 'complete') return complete;
      if (profileState === 'incomplete') return !complete;
      if (profileState === 'email') return Boolean(crm.email);
      if (profileState === 'phone') return Boolean(crm.phone || crm.mobile_phone);
      return true;
    });
    intersect(matches);
  }

  const visitBucket = text(body.visit_bucket);
  if (visitBucket) {
    const cards = await admin.from('customer_cards').select('id,guest_profile_id').eq('business_id', businessId).limit(10000);
    if (cards.error) throw cards.error;
    const cardGuest = new Map((cards.data || []).map((row: Row) => [row.id, row.guest_profile_id]));
    const instances = await admin.from('card_instances').select('customer_card_id,lifetime_visits').eq('business_id', businessId).limit(10000);
    if (instances.error) throw instances.error;
    const totals = new Map<string, number>();
    for (const instance of instances.data || []) {
      const guestId = cardGuest.get(instance.customer_card_id);
      if (guestId) totals.set(guestId, (totals.get(guestId) || 0) + Number(instance.lifetime_visits || 0));
    }
    const match = (count: number) => ({
      zero: count === 0, one_to_five: count >= 1 && count <= 5, six_to_ten: count >= 6 && count <= 10,
      ten_plus: count >= 10, twenty_five_plus: count >= 25, fifty_plus: count >= 50, hundred_plus: count >= 100
    }[visitBucket] ?? true);
    intersect((cards.data || []).map((row: Row) => row.guest_profile_id).filter((id: string) => match(totals.get(id) || 0)));
  }

  return candidateIds;
}

async function listGuests(admin: any, context: Row, body: Row, exportMode = false) {
  const pageSize = exportMode ? 5000 : Math.min(100, Math.max(10, Number(body.page_size || 25)));
  const page = exportMode ? 1 : Math.max(1, Number(body.page || 1));
  const candidateIds = await matchingGuestIds(admin, context.business.id, body);
  if (candidateIds && candidateIds.size === 0) return { rows: [], total: 0, page, page_size: pageSize };

  let query = admin.from('guest_profiles').select('id,display_name,gender,age_group,first_seen_at,last_seen_at,created_at,updated_at', { count: 'exact' })
    .eq('business_id', context.business.id);
  if (candidateIds) query = query.in('id', [...candidateIds]);
  if (text(body.age_group)) query = query.eq('age_group', text(body.age_group));
  if (text(body.registration_from)) query = query.gte('created_at', `${text(body.registration_from)}T00:00:00Z`);
  if (text(body.registration_to)) query = query.lte('created_at', `${text(body.registration_to)}T23:59:59Z`);
  const lastSeen = text(body.last_seen);
  const now = Date.now();
  const isoDaysAgo = (days: number) => new Date(now - days * 86400000).toISOString();
  if (lastSeen === 'today') query = query.gte('last_seen_at', isoDaysAgo(1));
  if (lastSeen === '7') query = query.gte('last_seen_at', isoDaysAgo(7));
  if (lastSeen === '30') query = query.gte('last_seen_at', isoDaysAgo(30));
  if (lastSeen === '90') query = query.gte('last_seen_at', isoDaysAgo(90));
  if (lastSeen === 'inactive') query = query.lt('last_seen_at', isoDaysAgo(context.business.crm_active_guest_days || 30));

  const from = (page - 1) * pageSize;
  const result = await query.order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (result.error) throw result.error;
  const profiles = result.data || [];
  const ids = profiles.map((row: Row) => row.id);
  if (!ids.length) return { rows: [], total: result.count || 0, page, page_size: pageSize };

  const [crmResult, cardsResult, socialResult] = await Promise.all([
    admin.from('guest_crm_profiles').select('*').eq('business_id', context.business.id).in('guest_profile_id', ids),
    admin.from('customer_cards').select('id,guest_profile_id,card_instance_number,customer_code,vip_status,created_at,card_templates(card_name,template_type),card_instances(lifetime_visits,last_visit_at)').eq('business_id', context.business.id).in('guest_profile_id', ids),
    admin.from('guest_social_links').select('guest_profile_id').eq('business_id', context.business.id).in('guest_profile_id', ids)
  ]);
  for (const result of [crmResult, cardsResult, socialResult]) if (result.error) throw result.error;
  const crmByGuest = new Map((crmResult.data || []).map((row: Row) => [row.guest_profile_id, row]));
  const cardsByGuest = new Map<string, Row[]>();
  for (const card of cardsResult.data || []) cardsByGuest.set(card.guest_profile_id, [...(cardsByGuest.get(card.guest_profile_id) || []), card]);
  const socialGuests = new Set((socialResult.data || []).map((row: Row) => row.guest_profile_id));

  let rows = profiles.map((profile: Row) => {
    const crm = crmByGuest.get(profile.id) || {};
    const cards = cardsByGuest.get(profile.id) || [];
    const visits = cards.reduce((sum, card) => sum + (card.card_instances || []).reduce((inner: number, instance: Row) => inner + Number(instance.lifetime_visits || 0), 0), 0);
    const lastVisit = cards.flatMap((card) => card.card_instances || []).map((instance) => instance.last_visit_at).filter(Boolean).sort().at(-1) || profile.last_seen_at;
    const completeness = Boolean(crm.first_name && crm.last_name && (crm.email || crm.phone || crm.mobile_phone));
    return {
      id: profile.id,
      name: crm.display_name || [crm.first_name, crm.last_name].filter(Boolean).join(' ') || profile.display_name || 'Unvollständiges Profil',
      first_name: crm.first_name || '', last_name: crm.last_name || '', email: crm.email || '', phone: crm.phone || crm.mobile_phone || '',
      company: crm.company || '', age_group: profile.age_group || '', registration_date: profile.created_at, last_visit_at: lastVisit || null,
      visits, profile_complete: completeness, has_social_links: socialGuests.has(profile.id),
      cards: cards.map((card) => ({
        id: card.id, card_instance_number: card.card_instance_number, customer_code: card.customer_code,
        card_name: card.card_templates?.card_name || '', template_type: card.card_templates?.template_type || '', vip_level: card.vip_status || ''
      }))
    };
  });
  if (body.profile_state === 'complete') rows = rows.filter((row) => row.profile_complete);
  if (body.profile_state === 'incomplete') rows = rows.filter((row) => !row.profile_complete);
  if (body.profile_state === 'email') rows = rows.filter((row) => row.email);
  if (body.profile_state === 'phone') rows = rows.filter((row) => row.phone);
  return { rows, total: result.count || rows.length, page, page_size: pageSize };
}

async function guestDetail(admin: any, context: Row, guestId: string) {
  const profile = await admin.from('guest_profiles').select('id,display_name,gender,age_group,first_seen_at,last_seen_at,metadata,created_at,updated_at').eq('business_id', context.business.id).eq('id', guestId).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) fail(404, 'CRM_GUEST_NOT_FOUND', 'Gast wurde nicht gefunden.');
  const [crm, socials, definitions, values, cards, visits, regular, notes, restrictions, audit] = await Promise.all([
    admin.from('guest_crm_profiles').select('*').eq('business_id', context.business.id).eq('guest_profile_id', guestId).maybeSingle(),
    admin.from('guest_social_links').select('id,platform,label,url,created_at,updated_at').eq('business_id', context.business.id).eq('guest_profile_id', guestId).order('platform'),
    admin.from('crm_field_definitions').select('id,name,field_key,field_type,required,active,options,display_order').eq('business_id', context.business.id).eq('active', true).order('display_order'),
    admin.from('crm_field_values').select('field_definition_id,value,updated_at').eq('business_id', context.business.id).eq('guest_profile_id', guestId),
    admin.from('customer_cards').select('id,card_instance_number,customer_code,status,vip_status,created_at,card_templates(card_name,template_type),card_instances(lifetime_visits,last_visit_at)').eq('business_id', context.business.id).eq('guest_profile_id', guestId),
    admin.from('scan_events').select('id,action_type,scanned_at').eq('business_id', context.business.id).eq('guest_profile_id', guestId).order('scanned_at', { ascending: false }).limit(50),
    admin.from('guest_regular_information').select('general_info,favorite_drink,preferred_area,further_preferences,other_internal_info,updated_at').eq('business_id', context.business.id).eq('guest_profile_id', guestId).maybeSingle(),
    admin.from('guest_notes').select('id,note_text,priority,created_at,updated_at').eq('business_id', context.business.id).eq('guest_profile_id', guestId).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
    admin.from('guest_restrictions').select('id,restriction_type,status,starts_at,ends_at,created_at,lifted_at').eq('business_id', context.business.id).eq('guest_profile_id', guestId).order('created_at', { ascending: false }).limit(50),
    admin.from('guest_crm_audit_events').select('id,event_type,changed_fields,source,occurred_at').eq('business_id', context.business.id).eq('guest_profile_id', guestId).order('occurred_at', { ascending: false }).limit(50)
  ]);
  for (const result of [crm, socials, definitions, values, cards, visits, regular, notes, restrictions, audit]) if (result.error) throw result.error;
  const canSeeSensitiveInternal = ['admin', 'manager', 'security'].includes(context.role);
  return {
    profile: profile.data, crm: crm.data || {}, socials: socials.data || [], definitions: definitions.data || [], values: values.data || [], cards: cards.data || [], visits: visits.data || [],
    regular_information: canSeeSensitiveInternal ? regular.data : null,
    notes: canSeeSensitiveInternal ? notes.data || [] : [], restrictions: canSeeSensitiveInternal ? restrictions.data || [] : [],
    audit: ['admin', 'manager'].includes(context.role) ? audit.data || [] : [], permissions: context.permissions
  };
}

function validatedCrmPayload(input: Row) {
  const output: Row = {};
  for (const key of crmFields) {
    if (!(key in input)) continue;
    const value = text(input[key]);
    output[key] = value || null;
  }
  if (output.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(output.email)) fail(400, 'CRM_EMAIL_INVALID', 'E-Mail-Adresse ist ungültig.');
  if (output.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(output.birth_date)) fail(400, 'CRM_BIRTH_DATE_INVALID', 'Geburtsdatum ist ungültig.');
  return output;
}

async function updateGuest(admin: any, context: Row, body: Row) {
  if (!context.permissions.can_edit) fail(403, 'CRM_EDIT_FORBIDDEN', 'Keine Berechtigung zum Bearbeiten.');
  const guestId = uuid(body.guest_id);
  if (!guestId) fail(400, 'CRM_GUEST_ID_INVALID', 'Gast-ID ist ungültig.');
  const guest = await admin.from('guest_profiles').select('id,owner_id,business_id').eq('id', guestId).eq('business_id', context.business.id).maybeSingle();
  if (guest.error) throw guest.error;
  if (!guest.data) fail(404, 'CRM_GUEST_NOT_FOUND', 'Gast wurde nicht gefunden.');
  const crm = validatedCrmPayload(body.crm || {});
  const changedFields = Object.keys(crm);
  if (changedFields.length) {
    const existingCrm = await admin.from('guest_crm_profiles').select('created_by').eq('business_id', context.business.id).eq('guest_profile_id', guestId).maybeSingle();
    if (existingCrm.error) throw existingCrm.error;
    const result = await admin.from('guest_crm_profiles').upsert({
      guest_profile_id: guestId, owner_id: guest.data.owner_id, business_id: context.business.id,
      ...crm, updated_by: context.userId, created_by: existingCrm.data?.created_by || context.userId
    }, { onConflict: 'guest_profile_id' });
    if (result.error) throw result.error;
    const displayName = crm.display_name || [crm.first_name, crm.last_name].filter(Boolean).join(' ');
    if (displayName) await admin.from('guest_profiles').update({ display_name: displayName }).eq('id', guestId).eq('business_id', context.business.id);
  }
  if (Array.isArray(body.socials)) {
    const socials = body.socials.slice(0, 30).map((entry: Row) => ({ platform: text(entry.platform).toLowerCase(), label: text(entry.label) || null, url: safeUrl(entry.url) })).filter((entry: Row) => socialPlatforms.has(entry.platform) && entry.url);
    if (body.socials.some((entry: Row) => text(entry.url) && !safeUrl(entry.url))) fail(400, 'CRM_SOCIAL_URL_INVALID', 'Social-Link muss eine gültige HTTPS-URL sein.');
    const remove = await admin.from('guest_social_links').delete().eq('business_id', context.business.id).eq('guest_profile_id', guestId);
    if (remove.error) throw remove.error;
    if (socials.length) {
      const insert = await admin.from('guest_social_links').insert(socials.map((entry: Row) => ({ ...entry, guest_profile_id: guestId, owner_id: guest.data.owner_id, business_id: context.business.id, created_by: context.userId, updated_by: context.userId })));
      if (insert.error) throw insert.error;
    }
    changedFields.push('socials');
  }
  if (body.custom_values && typeof body.custom_values === 'object') {
    const ids = Object.keys(body.custom_values).map(uuid).filter(Boolean);
    const definitions = await admin.from('crm_field_definitions').select('*').eq('business_id', context.business.id).in('id', ids);
    if (definitions.error) throw definitions.error;
    for (const definition of definitions.data || []) {
      const value = body.custom_values[definition.id];
      if (definition.field_type === 'URL' && value && !safeUrl(value)) fail(400, 'CRM_CUSTOM_URL_INVALID', `${definition.name}: URL ist ungültig.`);
      if (definition.required && (value === null || value === '' || (Array.isArray(value) && !value.length))) fail(400, 'CRM_CUSTOM_REQUIRED', `${definition.name} ist ein Pflichtfeld.`);
      if (definition.field_type === 'NUMBER' && value !== '' && !Number.isFinite(Number(value))) fail(400, 'CRM_CUSTOM_NUMBER_INVALID', `${definition.name}: Zahl ist ungültig.`);
      if (definition.field_type === 'DATE' && value && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) fail(400, 'CRM_CUSTOM_DATE_INVALID', `${definition.name}: Datum ist ungültig.`);
      if (definition.field_type === 'BOOLEAN' && typeof value !== 'boolean') fail(400, 'CRM_CUSTOM_BOOLEAN_INVALID', `${definition.name}: Wahr/Falsch-Wert ist ungültig.`);
      if (['SELECT', 'MULTISELECT'].includes(definition.field_type)) {
        const allowed = new Set((definition.options || []).map(String));
        const selected = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
        if (selected.some((entry) => !allowed.has(entry))) fail(400, 'CRM_CUSTOM_OPTION_INVALID', `${definition.name}: Auswahl ist ungültig.`);
      }
      const upsert = await admin.from('crm_field_values').upsert({ guest_profile_id: guestId, field_definition_id: definition.id, owner_id: guest.data.owner_id, business_id: context.business.id, value, created_by: context.userId, updated_by: context.userId }, { onConflict: 'guest_profile_id,field_definition_id' });
      if (upsert.error) throw upsert.error;
    }
    if (ids.length) changedFields.push('custom_fields');
  }
  const auditResult = await admin.from('guest_crm_audit_events').insert({ guest_profile_id: guestId, owner_id: guest.data.owner_id, business_id: context.business.id, event_type: 'UPDATED', changed_fields: changedFields, performed_by: context.userId, source: 'operator' });
  if (auditResult.error) throw auditResult.error;
  return await guestDetail(admin, context, guestId);
}

async function saveDefinition(admin: any, context: Row, body: Row) {
  if (!context.permissions.can_manage_fields) fail(403, 'CRM_FIELDS_FORBIDDEN', 'Keine Berechtigung für CRM-Felder.');
  const fieldType = text(body.field_type).toUpperCase();
  const fieldKey = text(body.field_key).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!fieldTypes.has(fieldType) || !/^[a-z][a-z0-9_]{1,63}$/.test(fieldKey)) fail(400, 'CRM_FIELD_INVALID', 'Feldtyp oder Schlüssel ist ungültig.');
  const payload = {
    owner_id: context.business.owner_id, business_id: context.business.id, name: text(body.name), field_key: fieldKey, field_type: fieldType,
    required: Boolean(body.required), active: body.active !== false, public_registration_allowed: Boolean(body.public_registration_allowed),
    options: Array.isArray(body.options) ? body.options.map(text).filter(Boolean).slice(0, 100) : [], display_order: Number(body.display_order || 0), updated_by: context.userId
  };
  if (!payload.name) fail(400, 'CRM_FIELD_NAME_REQUIRED', 'Feldname fehlt.');
  const id = uuid(body.id);
  const result = id
    ? await admin.from('crm_field_definitions').update(payload).eq('id', id).eq('business_id', context.business.id).select('*').single()
    : await admin.from('crm_field_definitions').insert({ ...payload, created_by: context.userId }).select('*').single();
  if (result.error) throw result.error;
  return result.data;
}

async function anonymizeGuest(admin: any, context: Row, body: Row) {
  if (!context.permissions.can_anonymize) fail(403, 'CRM_ANONYMIZE_FORBIDDEN', 'Nur Admins dürfen CRM-Daten anonymisieren.');
  const guestId = uuid(body.guest_id);
  const guest = await admin.from('guest_profiles').select('id,owner_id').eq('business_id', context.business.id).eq('id', guestId).maybeSingle();
  if (guest.error) throw guest.error;
  if (!guest.data) fail(404, 'CRM_GUEST_NOT_FOUND', 'Gast wurde nicht gefunden.');
  const removals = await Promise.all([
    admin.from('guest_social_links').delete().eq('business_id', context.business.id).eq('guest_profile_id', guestId),
    admin.from('crm_field_values').delete().eq('business_id', context.business.id).eq('guest_profile_id', guestId)
  ]);
  for (const removal of removals) if (removal.error) throw removal.error;
  const anonymized = Object.fromEntries(crmFields.map((key) => [key, null]));
  const profileUpdate = await admin.from('guest_crm_profiles').upsert({ guest_profile_id: guestId, owner_id: guest.data.owner_id, business_id: context.business.id, ...anonymized, anonymized_at: new Date().toISOString(), updated_by: context.userId }, { onConflict: 'guest_profile_id' });
  if (profileUpdate.error) throw profileUpdate.error;
  await admin.from('guest_profiles').update({ display_name: 'Anonymisierter Gast' }).eq('id', guestId).eq('business_id', context.business.id);
  const auditResult = await admin.from('guest_crm_audit_events').insert({ guest_profile_id: guestId, owner_id: guest.data.owner_id, business_id: context.business.id, event_type: 'ANONYMIZED', changed_fields: [...crmFields, 'socials', 'custom_fields'], performed_by: context.userId, source: 'operator' });
  if (auditResult.error) throw auditResult.error;
  return { ok: true };
}

async function crmStatistics(admin: any, context: Row) {
  const overview = await listGuests(admin, context, {}, true);
  const rows = overview.rows || [];
  const activeThreshold = Date.now() - Number(context.business.crm_active_guest_days || 30) * 86400000;
  const newThreshold = Date.now() - 30 * 86400000;
  const cardTypes: Row = {};
  const ageGroups: Row = {};
  let vipGuests = 0;
  for (const row of rows) {
    if (row.age_group) ageGroups[row.age_group] = (ageGroups[row.age_group] || 0) + 1;
    if (row.cards.some((card: Row) => card.vip_level || ['vip_card', 'club_card', 'membership_card'].includes(card.template_type))) vipGuests += 1;
    for (const card of row.cards) cardTypes[card.template_type || 'unknown'] = (cardTypes[card.template_type || 'unknown'] || 0) + 1;
  }
  return {
    total_guests: overview.total,
    new_guests_30_days: rows.filter((row: Row) => new Date(row.registration_date).getTime() >= newThreshold).length,
    active_guests: rows.filter((row: Row) => row.last_visit_at && new Date(row.last_visit_at).getTime() >= activeThreshold).length,
    inactive_guests: rows.filter((row: Row) => !row.last_visit_at || new Date(row.last_visit_at).getTime() < activeThreshold).length,
    vip_guests: vipGuests,
    average_visits: rows.length ? Number((rows.reduce((sum: number, row: Row) => sum + row.visits, 0) / rows.length).toFixed(1)) : 0,
    card_types: cardTypes,
    age_groups: ageGroups,
    capped: overview.total > rows.length
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error_code: 'METHOD_NOT_ALLOWED', error_message: 'Nur POST ist erlaubt.' }, 405);
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) fail(500, 'SUPABASE_EDGE_CONFIG_MISSING', 'Supabase-Konfiguration fehlt.');
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await request.json().catch(() => ({})) as Row;
    const context = await operatorContext(admin, request, uuid(body.business_id));
    const action = text(body.action || 'list');
    let data: any;
    if (action === 'list') data = await listGuests(admin, context, body);
    else if (action === 'stats') data = await crmStatistics(admin, context);
    else if (action === 'detail') data = await guestDetail(admin, context, uuid(body.guest_id));
    else if (action === 'update') data = await updateGuest(admin, context, body);
    else if (action === 'definitions') {
      const result = await admin.from('crm_field_definitions').select('*').eq('business_id', context.business.id).order('display_order').order('name');
      if (result.error) throw result.error;
      data = result.data || [];
    } else if (action === 'save_definition') data = await saveDefinition(admin, context, body);
    else if (action === 'anonymize') data = await anonymizeGuest(admin, context, body);
    else if (action === 'export') {
      if (!context.permissions.can_export) fail(403, 'CRM_EXPORT_FORBIDDEN', 'Keine Export-Berechtigung.');
      data = await listGuests(admin, context, body, true);
    } else fail(400, 'CRM_ACTION_INVALID', 'Unbekannte CRM-Aktion.');
    return json({ ok: true, business: { id: context.business.id, name: context.business.name, active_guest_days: context.business.crm_active_guest_days }, role: context.role, permissions: context.permissions, data });
  } catch (error) {
    return errorJson(error);
  }
});
