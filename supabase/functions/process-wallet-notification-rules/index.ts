import { corsHeaders, errorJson, json, walletNotificationService } from '../_shared/walletNotificationService.ts';
import { locationWindowEndAt, nextRuleRunAt } from '../_shared/walletNotificationRules.ts';

type Row = Record<string, any>;

function ruleContext(context: Row, rule: Row) {
  const business = Array.isArray(rule.businesses) ? rule.businesses[0] : rule.businesses;

  return {
    ...context,
    ownerId: rule.owner_id,
    business: business || {
      id: rule.business_id,
      owner_id: rule.owner_id,
      location_lat: rule.location_lat,
      location_lng: rule.location_lng
    },
    user: { id: rule.created_by || rule.owner_id },
    system: true
  };
}

function resultSummary(result: Row) {
  return {
    campaign_id: result?.campaign?.id || result?.campaign_id || null,
    status: result?.send_result?.status || result?.status || result?.campaign?.status || 'processed',
    recipients_count: result?.recipients_count ?? result?.results?.length ?? 0
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur POST ist erlaubt.',
      error_reason: 'Der Regelprozessor wird ausschliesslich durch den geschützten Cron-Job aufgerufen.'
    }, 405);
  }

  try {
    const context = await walletNotificationService.automationContext(request);
    const now = new Date();
    const nowIso = now.toISOString();
    const { data: rules, error } = await context.supabaseAdmin
      .from('wallet_notification_rules')
      .select('*,businesses(id,owner_id,name,address,location_lat,location_lng)')
      .eq('status', 'active')
      .or(`next_run_at.lte.${nowIso},and(location_is_active.eq.true,location_active_until_at.lte.${nowIso})`)
      .order('next_run_at', { ascending: true, nullsFirst: false })
      .limit(100);

    if (error) {
      throw error;
    }

    const processed = [];

    for (const rule of rules || []) {
      const scopedContext = ruleContext(context, rule);
      const shouldDeactivate = Boolean(
        rule.location_is_active
        && rule.location_active_until_at
        && new Date(rule.location_active_until_at).getTime() <= now.getTime()
      );

      if (shouldDeactivate) {
        try {
          const deactivation = await walletNotificationService.setLocationRuleActive(scopedContext, rule, false);
          await context.supabaseAdmin
            .from('wallet_notification_rules')
            .update({
              location_is_active: false,
              location_active_until_at: null,
              last_status: deactivation.failed_count ? 'location_partially_deactivated' : 'location_inactive',
              last_result: deactivation,
              processing_started_at: null
            })
            .eq('id', rule.id)
            .eq('owner_id', rule.owner_id)
            .eq('business_id', rule.business_id);
          processed.push({ rule_id: rule.id, action: 'deactivate_location', ...deactivation });
        } catch (deactivationError) {
          await context.supabaseAdmin
            .from('wallet_notification_rules')
            .update({
              last_status: 'location_deactivation_failed',
              last_result: { error_message: deactivationError?.message || 'Standort-Zeitfenster konnte nicht deaktiviert werden.' },
              processing_started_at: null
            })
            .eq('id', rule.id)
            .eq('owner_id', rule.owner_id)
            .eq('business_id', rule.business_id);
          processed.push({ rule_id: rule.id, action: 'deactivate_location', status: 'failed' });
        }
      }

      const isDue = Boolean(rule.next_run_at && new Date(rule.next_run_at).getTime() <= now.getTime());

      if (!isDue) {
        continue;
      }

      const dueAt = new Date(rule.next_run_at);
      const nextRunAt = nextRuleRunAt(rule, dueAt);
      const idempotencyKey = `notification-rule:${rule.id}:${dueAt.toISOString()}`;

      try {
        const campaignResult = await walletNotificationService.createCampaign(scopedContext, {
          notificationRuleId: rule.id,
          templateId: rule.template_id,
          targetType: rule.target_type,
          targetFilter: rule.target_filter,
          title: rule.title,
          message: rule.message,
          sendType: rule.trigger_type === 'location_based' ? 'location_based' : 'now',
          scheduledAt: null,
          locationLat: rule.location_lat,
          locationLng: rule.location_lng,
          locationRadiusM: rule.location_radius_m,
          idempotencyKey
        });
        let sendResult = campaignResult.send_result;

        if (rule.trigger_type === 'location_based' && campaignResult.campaign?.id && !['sent', 'partially_failed', 'failed', 'cancelled'].includes(campaignResult.campaign.status)) {
          sendResult = await walletNotificationService.sendNow(scopedContext, campaignResult.campaign.id);
        }

        const summary = resultSummary({ ...campaignResult, send_result: sendResult });
        const activeUntil = rule.trigger_type === 'location_based' ? locationWindowEndAt(rule, dueAt) : null;
        await context.supabaseAdmin
          .from('wallet_notification_rules')
          .update({
            next_run_at: nextRunAt,
            location_is_active: rule.trigger_type === 'location_based',
            location_active_until_at: activeUntil,
            last_run_at: nowIso,
            last_status: summary.status,
            last_result: summary,
            processing_started_at: null
          })
          .eq('id', rule.id)
          .eq('owner_id', rule.owner_id)
          .eq('business_id', rule.business_id);
        processed.push({ rule_id: rule.id, action: rule.trigger_type, next_run_at: nextRunAt, ...summary });
      } catch (ruleError) {
        const failure = {
          error_code: ruleError?.error_code || 'NOTIFICATION_RULE_PROCESSING_FAILED',
          error_message: ruleError?.error_message || ruleError?.message || 'Push-Regel konnte nicht verarbeitet werden.'
        };
        await context.supabaseAdmin
          .from('wallet_notification_rules')
          .update({
            next_run_at: nextRuleRunAt(rule, now),
            last_run_at: nowIso,
            last_status: 'failed',
            last_result: failure,
            processing_started_at: null
          })
          .eq('id', rule.id)
          .eq('owner_id', rule.owner_id)
          .eq('business_id', rule.business_id);
        processed.push({ rule_id: rule.id, action: rule.trigger_type, status: 'failed', ...failure });
      }
    }

    return json({ processed });
  } catch (error) {
    return errorJson(error, 'PROCESS_WALLET_NOTIFICATION_RULES_ERROR');
  }
});

