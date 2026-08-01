import { corsHeaders, errorJson, json, walletNotificationService } from '../_shared/walletNotificationService.ts';
import { normalizeNotificationRuleInput, nextRuleRunAt } from '../_shared/walletNotificationRules.ts';

type Row = Record<string, any>;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function notFound() {
  const error: any = new Error('Push-Regel wurde nicht gefunden.');
  error.status = 404;
  error.error_code = 'NOTIFICATION_RULE_NOT_FOUND';
  error.error_message = 'Push-Regel wurde nicht gefunden.';
  error.error_reason = 'Die Regel existiert nicht oder gehört nicht zu diesem Betreiberkonto.';
  throw error;
}

async function loadRule(context: Row, id: string) {
  const { data, error } = await context.supabaseAdmin
    .from('wallet_notification_rules')
    .select('*')
    .eq('id', id)
    .eq('owner_id', context.ownerId)
    .eq('business_id', context.business.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    notFound();
  }

  return data;
}

async function validateTemplate(context: Row, templateId: string | null) {
  if (!templateId) {
    return null;
  }

  const { data, error } = await context.supabaseAdmin
    .from('card_templates')
    .select('id,template_type,settings')
    .eq('id', templateId)
    .eq('owner_id', context.ownerId)
    .eq('business_id', context.business.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    const invalid: any = new Error('Die ausgewählte Karte wurde nicht gefunden.');
    invalid.status = 400;
    invalid.error_code = 'RULE_TEMPLATE_INVALID';
    invalid.error_message = 'Die ausgewählte Karte wurde nicht gefunden.';
    invalid.error_reason = 'Die Karte muss zum aktuell angemeldeten Betreiberkonto gehören.';
    throw invalid;
  }

  return data;
}

function locationContextForRule(input: Row, business: Row, template: Row | null, existing: Row = {}) {
  const hasExplicitPreference = Object.prototype.hasOwnProperty.call(input, 'useEventLocation')
    || Object.prototype.hasOwnProperty.call(input, 'use_event_location');
  const explicitlyRequested = input.useEventLocation === true || input.use_event_location === true;
  const existingUsesCustomEventLocation = template?.template_type === 'event_card'
    && existing.trigger_type === 'location_based'
    && Number.isFinite(Number(existing.location_lat))
    && Number.isFinite(Number(existing.location_lng))
    && (
      Math.abs(Number(existing.location_lat) - Number(business.location_lat)) > 0.000001
      || Math.abs(Number(existing.location_lng) - Number(business.location_lng)) > 0.000001
    );

  if ((hasExplicitPreference && !explicitlyRequested) || (!explicitlyRequested && !existingUsesCustomEventLocation)) {
    return business;
  }

  if (template?.template_type !== 'event_card') {
    const invalid: any = new Error('Ein eigener Standort ist nur bei Eventkarten erlaubt.');
    invalid.status = 400;
    invalid.error_code = 'EVENT_LOCATION_NOT_ALLOWED';
    invalid.error_message = 'Ein eigener Standort ist nur bei Eventkarten erlaubt.';
    invalid.error_reason = 'Alle anderen Karten übernehmen den Standardstandort aus den Firmendaten.';
    throw invalid;
  }

  const settings = template.settings && typeof template.settings === 'object' ? template.settings : {};
  const latitude = Number(input.eventLocationLat ?? input.event_location_lat ?? existing.location_lat ?? settings.eventLocationLatitude);
  const longitude = Number(input.eventLocationLng ?? input.event_location_lng ?? existing.location_lng ?? settings.eventLocationLongitude);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    const invalid: any = new Error('Event-Koordinaten sind ungültig.');
    invalid.status = 400;
    invalid.error_code = 'EVENT_LOCATION_INVALID';
    invalid.error_message = 'Event-Koordinaten sind ungültig.';
    invalid.error_reason = 'Latitude muss zwischen -90 und 90, Longitude zwischen -180 und 180 liegen.';
    throw invalid;
  }

  return { ...business, location_lat: latitude, location_lng: longitude };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur POST ist erlaubt.',
      error_reason: 'Push-Regeln werden über eine authentifizierte POST-Aktion verwaltet.'
    }, 405);
  }

  try {
    const context = await walletNotificationService.context(request);
    const body = await request.json().catch(() => ({}));
    const action = text(body.action || 'create');
    const ruleId = text(body.id || body.ruleId || body.rule_id);

    if (action === 'create') {
      const ruleInput = body.rule || body;
      const templateId = text(ruleInput.templateId || ruleInput.template_id) || null;
      const template = await validateTemplate(context, templateId);
      const normalized = normalizeNotificationRuleInput(ruleInput, locationContextForRule(ruleInput, context.business, template));
      const { data, error } = await context.supabaseAdmin
        .from('wallet_notification_rules')
        .insert({
          ...normalized,
          owner_id: context.ownerId,
          business_id: context.business.id,
          created_by: context.user.id
        })
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      return json({ rule: data });
    }

    if (!ruleId) {
      notFound();
    }

    const existing = await loadRule(context, ruleId);

    if (action === 'archive') {
      if (existing.location_is_active) {
        await walletNotificationService.setLocationRuleActive(context, existing, false);
      }

      const { data, error } = await context.supabaseAdmin
        .from('wallet_notification_rules')
        .update({
          status: 'archived',
          next_run_at: null,
          location_is_active: false,
          location_active_until_at: null,
          processing_started_at: null
        })
        .eq('id', ruleId)
        .eq('owner_id', context.ownerId)
        .eq('business_id', context.business.id)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      return json({ rule: data });
    }

    if (action === 'set_status') {
      const status = text(body.status) === 'active' ? 'active' : 'paused';

      if (status === 'paused' && existing.location_is_active) {
        await walletNotificationService.setLocationRuleActive(context, existing, false);
      }

      const nextRunAt = status === 'active' ? nextRuleRunAt(existing) : null;
      const { data, error } = await context.supabaseAdmin
        .from('wallet_notification_rules')
        .update({
          status,
          next_run_at: nextRunAt,
          location_is_active: status === 'active' ? existing.location_is_active : false,
          location_active_until_at: status === 'active' ? existing.location_active_until_at : null,
          processing_started_at: null
        })
        .eq('id', ruleId)
        .eq('owner_id', context.ownerId)
        .eq('business_id', context.business.id)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      return json({ rule: data });
    }

    if (action === 'duplicate') {
      const template = await validateTemplate(context, existing.template_id);
      const normalized = normalizeNotificationRuleInput({
        ...existing,
        name: `${existing.name} – Kopie`,
        status: 'paused'
      }, locationContextForRule({}, context.business, template, existing));
      const { data, error } = await context.supabaseAdmin
        .from('wallet_notification_rules')
        .insert({
          ...normalized,
          owner_id: context.ownerId,
          business_id: context.business.id,
          created_by: context.user.id,
          next_run_at: null
        })
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      return json({ rule: data });
    }

    if (action === 'update') {
      const ruleInput = body.rule || body;
      const templateId = text(ruleInput.templateId || ruleInput.template_id || existing.template_id) || null;
      const template = await validateTemplate(context, templateId);
      const normalized = normalizeNotificationRuleInput(ruleInput, locationContextForRule(ruleInput, context.business, template, existing), existing);

      if (existing.location_is_active) {
        await walletNotificationService.setLocationRuleActive(context, existing, false);
      }

      const { data, error } = await context.supabaseAdmin
        .from('wallet_notification_rules')
        .update({
          ...normalized,
          location_is_active: false,
          location_active_until_at: null,
          processing_started_at: null
        })
        .eq('id', ruleId)
        .eq('owner_id', context.ownerId)
        .eq('business_id', context.business.id)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      return json({ rule: data });
    }

    return json({
      error_code: 'INVALID_RULE_ACTION',
      error_message: 'Aktion ist ungültig.',
      error_reason: 'Erlaubt sind create, update, duplicate, set_status und archive.'
    }, 400);
  } catch (error) {
    return errorJson(error, 'MANAGE_WALLET_NOTIFICATION_RULE_ERROR');
  }
});
