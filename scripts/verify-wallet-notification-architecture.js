import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFile(relativePath) {
  assert(fs.existsSync(path.join(rootDir, relativePath)), `Datei fehlt: ${relativePath}`);
}

function assertAll(relativePath, label, needles) {
  const content = read(relativePath);

  for (const needle of needles) {
    assert(content.includes(needle), `${label} fehlt: ${needle}`);
  }
}

function assertNone(relativePath, label, needles) {
  const content = read(relativePath);

  for (const needle of needles) {
    assert(!content.includes(needle), `${label} darf nicht enthalten: ${needle}`);
  }
}

function functionBodyBetween(relativePath, functionName, nextMarker) {
  const content = read(relativePath);
  const start = content.indexOf(`function ${functionName}`);

  assert(start >= 0, `${functionName} wurde in ${relativePath} nicht gefunden.`);

  const end = nextMarker
    ? content.indexOf(nextMarker, start)
    : -1;

  assert(end > start, `${functionName} konnte in ${relativePath} nicht sauber eingegrenzt werden.`);

  return content.slice(start, end);
}

[
  'supabase/functions/_shared/walletNotificationService.ts',
  'supabase/functions/_shared/appleWalletProvider.ts',
  'supabase/functions/_shared/googleWalletProvider.ts',
  'supabase/functions/create-wallet-notification-campaign/index.ts',
  'supabase/functions/send-wallet-notification/index.ts',
  'supabase/functions/resolve-wallet-notification-recipients/index.ts',
  'supabase/functions/check-wallet-notification-limits/index.ts',
  'supabase/functions/process-scheduled-wallet-notifications/index.ts',
  'supabase/functions/process-wallet-update-queue/index.ts',
  'supabase/functions/claim-apple-pass/index.ts',
  'supabase/functions/issue-apple-pass/index.ts',
  'supabase/functions/apple-wallet-webservice/index.ts',
  'supabase/functions/update-apple-pass/index.ts',
  'supabase/functions/send-apple-wallet-update/index.ts',
  'supabase/functions/issue-google-wallet-pass/index.ts',
  'supabase/functions/update-google-wallet-pass/index.ts',
  'supabase/functions/send-google-wallet-message/index.ts'
].forEach(assertFile);

assertFile('supabase/test-data.sql');
assertFile('supabase/config.toml');
assertFile('docs/WALLET_INTEGRATION_CONTEXT.md');
assertFile('scripts/verify-edge-secret-boundary.js');

assert(
  !fs.existsSync(path.join(rootDir, 'server', 'passkit.js')),
  'Die alte lokale server/passkit.js Implementierung darf im direkten Wallet-Pfad nicht mehr vorhanden sein.'
);

assert(
  !fs.existsSync(path.join(rootDir, 'supabase', 'functions', 'passkit')),
  'Der alte supabase/functions/passkit Legacy-Ordner darf im direkten Wallet-Pfad nicht mehr vorhanden sein.'
);

[
  'scripts/prepare-passkit-certs.sh',
  'scripts/verify-passkit-certs.js'
].forEach((relativePath) => assert(
  !fs.existsSync(path.join(rootDir, relativePath)),
  `${relativePath} darf im direkten Wallet-Pfad nicht mehr vorhanden sein.`
));

assertNone('package.json', 'Aktiver Package-Manifest ohne PassKit', [
  'passkit-generator',
  'certs:prepare',
  'certs:verify'
]);

assertAll('package.json', 'Projekt-Check-Script', [
  'verify-deploy-cleanliness.js',
  'verify-browser-secret-boundary.js',
  'verify-edge-secret-boundary.js',
  'verify-supabase-edge-jwt-policy.js',
  'verify-supabase-schema-sanity.js',
  'verify-edge-typescript-syntax.js',
  'verify-edge-function-imports.js',
  'verify-edge-function-contracts.js',
  'verify-wallet-target-contract.js',
  'verify-wallet-limit-accounting.js',
  'verify-editor-campaign-idempotency.js',
  'verify-claim-page-output-safety.js',
  'verify-public-edge-response-safety.js',
  'verify-apple-webservice-contract.js',
  'verify-google-wallet-contract.js',
  'verify-wallet-requirements-coverage.js',
  'verify-wallet-goal-audit.js',
  'verify-wallet-implementation-plan.js',
  'verify-wallet-cron-setup.js',
  'verify-wallet-external-acceptance.js',
  'verify-wallet-readiness-report.js',
  'verify-wallet-deploy-checklist.js'
]);

assertAll('supabase/config.toml', 'Supabase Function JWT-Konfiguration', [
  '[functions.claim-card]',
  '[functions.claim-apple-pass]',
  '[functions.google-wallet-save-link]',
  '[functions.create-topup-payment-session]',
  '[functions.confirm-topup-payment]',
  '[functions.apple-wallet-webservice]',
  '[functions.process-scheduled-wallet-notifications]',
  '[functions.process-wallet-update-queue]',
  'verify_jwt = false'
]);

assertAll('supabase/schema.sql', 'Supabase Wallet-Notification-Schema', [
  'create table if not exists public.wallet_notification_campaigns',
  'create table if not exists public.wallet_notification_recipients',
  'create table if not exists public.wallet_push_logs',
  'create table if not exists public.wallet_update_queue',
  'wallet_update_queue_processing_idx',
  'alter column next_attempt_at drop not null',
  'legacy_wallet_update_job_id',
  'insert into public.wallet_update_queue',
  'update public.card_instances',
  'current_streak = coalesce(card_row.streak_count, 0)',
  'current_stamps = coalesce(card_row.stamp_count, 0)',
  "when c.wallet_platform = 'google' then coalesce(c.wallet_object_id, c.wallet_serial_number, c.pass_serial_number)",
  "else coalesce(c.pass_serial_number, c.wallet_serial_number, c.wallet_object_id)",
  'last_scanned_at = coalesce(card_row.last_scanned_at, ci.last_scanned_at)',
  'create table if not exists public.apple_wallet_devices',
  'create table if not exists public.apple_wallet_registrations',
  'create table if not exists public.apple_pass_versions',
  'create table if not exists public.google_wallet_objects',
  'google_wallet_objects_object_type_check',
  "'eventTicketObject'",
  'customer_cards_wallet_object_unique_idx',
  'customer_cards_wallet_object_id_format_check',
  'card_instances_wallet_object_id_format_check',
  "wallet_object_id ~ '^[A-Za-z0-9._:-]+$'",
  'card_instances_apple_serial_number_unique_idx',
  'card_instances_google_object_id_unique_idx',
  'google_wallet_objects_card_instance_unique_idx',
  'wallet_notification_campaigns_target_type_check',
  'wallet_notification_recipients_status_check',
  "'prepared'",
  'processing_started_at',
  'wallet_notification_recipients_processing_idx',
  'wallet_push_logs_wallet_platform_check',
  "wallet_platform in ('apple', 'google', 'system')",
  'wallet_push_logs_manual_idempotency_idx',
  'on public.wallet_push_logs(owner_id, business_id, card_instance_id, wallet_platform',
  'wallet_push_logs_action_format_check',
  'wallet_push_logs_status_check',
  'wallet_push_logs_payload_shape_check',
  'revoke select on public.wallet_notification_recipients from authenticated',
  'revoke select on public.wallet_push_logs from authenticated',
  'revoke select on public.wallet_update_queue from authenticated',
  'grant select (',
  "action ~ '^[a-z][a-z0-9_]{0,79}$'",
  "'partially_failed'",
  'jsonb_typeof(request_payload)',
  'octet_length(request_payload::text) <= 20000',
  'wallet_update_queue_update_type_format_check',
  'wallet_update_queue_payload_shape_check',
  'card_events_event_type_format_check',
  "event_type ~ '^[a-z][a-z0-9_-]{0,79}$'",
  'card_events_details_shape_check',
  'jsonb_typeof(details)',
  'octet_length(details::text) <= 20000',
  "update_type ~ '^[a-z][a-z0-9_]{0,79}$'",
  'jsonb_typeof(payload)',
  'octet_length(payload::text) <= 20000',
  'drop index if exists public.wallet_notification_campaigns_owner_idempotency_idx',
  'on public.wallet_notification_campaigns(owner_id, business_id, idempotency_key)',
  'alter column pass_authentication_token set default',
  "coalesce(wallet_platform, 'apple') = 'apple'",
  "request_payload->>'idempotency_scope'",
  "request_payload ? 'idempotency_scope'",
  'wallet_notification_campaigns_scheduled_required_check',
  'wallet_notification_campaigns_location_required_check',
  'validate_wallet_campaign_consistency',
  'validate_business_owner_consistency',
  'validate_card_template_business_consistency',
  'BUSINESS_IMMUTABLE_OWNER',
  'TEMPLATE_BUSINESS_NOT_FOUND',
  'TEMPLATE_FORBIDDEN: Karten-Template gehört zu einem anderen Betreiber als das Business.',
  'TEMPLATE_IMMUTABLE_FIELD',
  'CARD_FORBIDDEN: Kundenkarte gehört zu einem anderen Betreiber als das Template.',
  'CARD_FORBIDDEN: Kundenkarte gehört zu einem anderen Business als das Template.',
  'CARD_INSTANCE_FORBIDDEN: Karteninstanz gehört zu einem anderen Betreiber als das Template.',
  'CARD_INSTANCE_FORBIDDEN: Karteninstanz gehört zu einem anderen Business als das Template.',
  'CARD_INSTANCE_CUSTOMER_CARD_NOT_FOUND',
  'CARD_INSTANCE_TEMPLATE_MISMATCH',
  'CAMPAIGN_TEMPLATE_REQUIRED',
  'CAMPAIGN_NOTIFICATIONS_DISABLED',
  'CAMPAIGN_TARGET_FEATURE_FORBIDDEN',
  'CAMPAIGN_TARGET_FILTER_INVALID',
  'CAMPAIGN_TARGET_FILTER_TOO_LARGE',
  'CAMPAIGN_TARGET_FILTER_FIELD_FORBIDDEN',
  'CAMPAIGN_TARGET_FILTER_NUMBER_INVALID',
  'CAMPAIGN_TARGET_FILTER_RANGE_INVALID',
  'CAMPAIGN_TARGET_FILTER_DATE_INVALID',
  'CAMPAIGN_TARGET_FILTER_DATE_RANGE_INVALID',
  'CAMPAIGN_TARGET_FILTER_TEXT_TOO_LONG',
  'CAMPAIGN_IDEMPOTENCY_KEY_TOO_LONG',
  'CAMPAIGN_IMMUTABLE_FIELD',
  'jsonb_object_keys',
  "'membershipStatus'",
  'min_numeric > max_numeric',
  'min_cents_numeric > max_cents_numeric',
  'from_timestamp > to_timestamp',
  'new.created_by is distinct from new.owner_id',
  'new.business_id is distinct from old.business_id',
  'template_feature_allowed',
  "when 'stamp_count' then 'stamps'",
  "when 'coupon_unredeemed' then 'redemption'",
  'validate_wallet_notification_campaigns_consistency',
  'validate_wallet_recipient_consistency',
  'validate_wallet_notification_recipients_consistency',
  'validate_wallet_update_queue_consistency',
  'validate_direct_wallet_object_consistency',
  'validate_wallet_push_log_consistency',
  'validate_wallet_push_logs_consistency',
  'validate_apple_wallet_registrations_direct_consistency',
  'validate_apple_pass_versions_direct_consistency',
  'validate_google_wallet_objects_direct_consistency',
  'validate_card_event_feature_allowed',
  'CARD_EVENT_BUSINESS_NOT_FOUND',
  'CARD_EVENT_FORBIDDEN: Karten-Event gehört zu einem anderen Betreiber als das Business.',
  'CARD_EVENT_CREATED_BY_FORBIDDEN',
  'new.created_by <> auth.uid()',
  'required_feature is null and new.template_id is null and new.customer_card_id is null',
  'CAMPAIGN_FORBIDDEN',
  'RECIPIENT_FORBIDDEN',
  'QUEUE_FORBIDDEN',
  'PUSH_LOG_FORBIDDEN',
  'PUSH_LOG_CARD_PLATFORM_MISMATCH',
  'GOOGLE_WALLET_OBJECT_FORBIDDEN',
  'APPLE_SERIAL_MISMATCH',
  'add column if not exists apple_serial_number',
  'add column if not exists google_object_id',
  'add column if not exists push_enabled',
  'alter table public.wallet_notification_campaigns enable row level security',
  'alter table public.apple_wallet_devices enable row level security',
  'apple_wallet_devices hat bewusst keine authenticated Policies',
  'unlocked operators can read own wallet notification campaigns',
  'drop policy if exists "unlocked operators can update own draft wallet notification campaigns" on public.wallet_notification_campaigns',
  'Keine direkte Browser-Update-Policy für wallet_notification_campaigns',
  'revoke select, insert, update, delete on public.wallet_notification_campaigns from authenticated'
]);

assertNone('supabase/schema.sql', 'Supabase Wallet-Notification-Schema', [
  'create policy "unlocked operators can update own draft wallet notification campaigns"',
  'grant select, update on public.wallet_notification_campaigns to authenticated'
]);

const schemaSql = read('supabase/schema.sql');
const redeemCardBalanceSql = schemaSql.slice(
  schemaSql.indexOf('create or replace function public.redeem_card_balance'),
  schemaSql.indexOf('create or replace function public.confirm_card_topup')
);
const confirmCardTopupSql = schemaSql.slice(
  schemaSql.indexOf('create or replace function public.confirm_card_topup'),
  schemaSql.indexOf('create or replace function public.enqueue_wallet_update_job')
);

assertAll('supabase/schema.sql', 'Balance-RPC Wallet-Instanz-Sync', [
  "when card_row.wallet_platform = 'google' then coalesce(card_row.wallet_object_id, card_row.wallet_serial_number, card_row.pass_serial_number)",
  "when session_row.wallet_platform = 'google' then coalesce(session_row.wallet_object_id, session_row.card_wallet_serial_number, session_row.pass_serial_number)",
  "when card_row.wallet_platform = 'apple' then coalesce(card_row.pass_serial_number, card_row.wallet_serial_number)",
  "when session_row.wallet_platform = 'apple' then coalesce(session_row.pass_serial_number, session_row.card_wallet_serial_number)",
  'wallet_object_id = coalesce(excluded.wallet_object_id, public.card_instances.wallet_object_id)',
  'apple_serial_number = coalesce(excluded.apple_serial_number, public.card_instances.apple_serial_number)',
  'google_object_id = coalesce(excluded.google_object_id, public.card_instances.google_object_id)'
]);
assert(
  redeemCardBalanceSql.includes('google_object_id')
    && redeemCardBalanceSql.includes("when card_row.wallet_platform = 'google' then card_row.wallet_object_id")
    && !redeemCardBalanceSql.includes('card_row.pass_serial_number,\n    card_row.streak_count'),
  'redeem_card_balance muss Google-Wallet-IDs beim card_instances-Upsert erhalten.'
);
assert(
  confirmCardTopupSql.includes('c.wallet_serial_number as card_wallet_serial_number')
    && confirmCardTopupSql.includes('google_object_id')
    && confirmCardTopupSql.includes("when session_row.wallet_platform = 'google' then session_row.wallet_object_id")
    && !confirmCardTopupSql.includes('session_row.pass_serial_number,\n    session_row.streak_count'),
  'confirm_card_topup muss Google-Wallet-IDs beim card_instances-Upsert erhalten.'
);

assertAll('supabase/functions/_shared/walletNotificationService.ts', 'Wallet Notification Service', [
  "'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'",
  'createCampaign(context',
  'resolveRecipients(context',
  'loadCampaignRecipients',
  'sendNow(context',
  'assertCampaignCanSendNow(campaign',
  'CAMPAIGN_ALREADY_FINALIZED',
  'CAMPAIGN_NOT_DUE',
  'CAMPAIGN_STATUS_NOT_SENDABLE',
  'schedule(context',
  'CAMPAIGN_NOT_SCHEDULABLE',
  'CAMPAIGN_SEND_TYPE_NOT_SCHEDULABLE',
  'CAMPAIGN_SCHEDULE_CONFLICT',
  "['draft', 'scheduled'].includes(campaign.status)",
  "['scheduled', 'location_based'].includes(campaign.send_type)",
  'validateLocationSendType(campaign.send_type',
  'recipientCount === 0',
  'reloadCampaign',
  'send_result: sendResult',
  'sendToApplePass(context',
  'sendToGoogleWallet(context',
  'googleObject?.object_id || cardInstance.google_object_id',
  'googleWalletProvider.normalizeObjectType',
  'googleWalletProvider.objectTypeForTemplate(template)',
  'GOOGLE_OBJECT_TYPE_INVALID',
  'logResult(context',
  'recipient_status_update_guard_failed',
  ".eq('card_instance_id', recipient.card_instance_id)",
  ".eq('wallet_platform', recipient.wallet_platform)",
  ".in('status', ['pending', 'processing'])",
  'checkPlatformLimits(context',
  'validateWalletPlatformForCard',
  'INVALID_WALLET_PLATFORM',
  'LIMIT_PLATFORM_MISMATCH',
  'assertLimitCardBelongsToContext',
  'LIMIT_CARD_OWNER_MISMATCH',
  'LIMIT_CARD_BUSINESS_MISMATCH',
  'PUSH_DISABLED',
  'cardInstance.push_enabled === false',
  "status: 'skipped'",
  ".eq('owner_id', cardInstance.owner_id)",
  'previewNotificationLimits(context',
  'authenticatedContext(request)',
  'OPERATOR_LOCKED',
  ".eq('owner_id', userData.user.id)",
  'walletLimitConfig',
  'WALLET_GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H',
  'WALLET_DUPLICATE_WINDOW_MINUTES',
  'googleTextAndNotifyLimitPerPass24h',
  'duplicateWindowMinutes',
  'validateCampaignIdempotencyKey',
  'campaignDuplicatePlatforms',
  'logCampaignDuplicateSkipped',
  'campaign_duplicate_skipped',
  'Identische Wallet-Kampagne',
  "error.code === '23505'",
  'idempotency_conflict_recovered',
  'reserveManualIdempotency(context',
  'finalizeManualIdempotencyReservation(context',
  'failManualIdempotencyReservation(context',
  'reserveWalletOperationIdempotency(context',
  'finalizeWalletOperationIdempotencyReservation(context',
  'failWalletOperationIdempotencyReservation(context',
  'IDEMPOTENCY_RESERVATION_CONFLICT',
  'MANUAL_WALLET_LOG_SELECT',
  'idempotency_reserved',
  'reservation_failed_after_processing',
  'idempotency_post_finalize_failure',
  'manualWalletDuplicateKey',
  'recentManualDuplicateWalletLog',
  'logManualDuplicateSkipped',
  'manual_duplicate_skipped',
  "request_payload->>manual_duplicate_key",
  'Identische manuelle Wallet-Nachricht',
  'previous_status',
  'previous_response_present',
  ".eq('business_id', reservation.business_id)",
  ".eq('card_instance_id', reservation.card_instance_id)",
  ".eq('wallet_platform', reservation.wallet_platform)",
  ".is('campaign_id', null)",
  'CAMPAIGN_SEND_START_CONFLICT',
  'sendingCampaign',
  "select('id, status')",
  'CAMPAIGN_STATUS_UPDATE_CONFLICT',
  'countCampaignRecipients',
  'recoverStaleProcessingRecipients',
  'recoverStaleQueueJobs',
  'SCHEDULED_CAMPAIGN_FINALIZE_CONFLICT',
  'WALLET_RECIPIENT_PROCESSING_TIMEOUT_MINUTES',
  'WALLET_QUEUE_PROCESSING_TIMEOUT_MINUTES',
  'recovered_processing_count',
  'recipient_already_claimed',
  "reason: 'already_claimed'",
  'queueRetryAt(attemptCount',
  'retryDelayMinutes',
  'Math.min(Math.max(1, Number(attemptCount || 1)) * 15, 60)',
  'next_attempt_at: retryAt',
  'claimRecipientForProcessing',
  'assertRecipientBelongsToCampaign',
  'RECIPIENT_CAMPAIGN_MISMATCH',
  'claimQueueJobForProcessing',
  ".eq('business_id', job.business_id)",
  'queueDueFilter(nowIso)',
  'next_attempt_at.is.null',
  'assertQueueJobMatchesCardInstance',
  'QUEUE_JOB_CARD_MISMATCH',
  'QUEUE_JOB_PLATFORM_MISMATCH',
  'QUEUE_GOOGLE_OBJECT_ID_MISSING',
  "const errorCode = error?.error_code || 'QUEUE_JOB_FAILED'",
  'queueWasFinalized',
  'finalizedQueueStatus',
  'queue_post_finalize_error',
  'retry_blocked_after_finalize',
  'queue_card_wallet_state_sync_failed',
  'queueJobErrorIsRetryable(error)',
  'const retry = !sent && queueJobErrorIsRetryable(result) && nextAttemptCount < 3',
  'status: queueStatus',
  'already_claimed',
  'RECIPIENT_TEMPLATE_MISMATCH',
  'RECIPIENT_PLATFORM_MISMATCH',
  'const targetFilter = targetFilterObject(campaign.target_filter || {})',
  "['scheduled', 'location_based'].includes(campaign.send_type)",
  'await this.resolveRecipients(context, campaign);',
  "!featureEnabled(cardInstance.card_templates, 'notifications')",
  'RECIPIENT_NOTIFICATIONS_DISABLED',
  '!cardMatchesTarget(cardInstance, campaign.target_type, targetFilter)',
  'RECIPIENT_TARGET_MISMATCH',
  'generated_pass_version',
  'googleObject?.object_type',
  'RECIPIENT_SEND_FAILED',
  'ignoreDuplicates: true',
  'Keine offenen Empfänger vorhanden',
  'APPLE_NO_REGISTERED_DEVICES',
  'simulatedBusinessRemaining',
  'simulatedCustomerRemainingByKey',
  'business_remaining_after_preflight',
  'Empfänger würden wegen des Business-Tageslimits übersprungen',
  'Empfänger würden wegen des Kunden-Tageslimits übersprungen',
  'automationContext(request',
  'WALLET_CRON_SECRET',
  'MIN_CRON_SECRET_LENGTH',
  'timingSafeSecretMatches',
  'sha256Bytes',
  "crypto.subtle.digest('SHA-256'",
  "request.headers.get('authorization')",
  "request.headers.get('x-cron-secret')",
  'return authenticatedContext(request)',
  'queryDueCampaigns',
  'scheduled_campaign_failed',
  "wallet_platform: 'system'",
  'resolve_recipients',
  'SCHEDULED_CAMPAIGN_FAILED',
  'finalizeFailedScheduledCampaign',
  'SCHEDULED_CAMPAIGN_FINALIZE_FAILED',
  "final_status: finalStatus",
  'Der Scheduled-Processor verarbeitet die übrigen fälligen Kampagnen weiter.',
  'google_nearby_location_configured',
  'GOOGLE_TEXT_AND_NOTIFY_LIMIT_REACHED',
  'GOOGLE_TEXT_AND_NOTIFY_FALLBACK',
  'LOCATION_BASED_BEST_EFFORT',
  'APPLE_LOCATION_RELEVANCE_DECIDED_BY_IOS',
  'GOOGLE_LOCATION_DISPLAY_PLATFORM_CONTROLLED',
  'google_object_message_fallback',
  'googleObject?.object_id',
  'touchGoogleWalletObjectMapping',
  'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
  'walletLogAction',
  'providerResult.action',
  'google_nearby_location_update',
  'NOTIFICATION_LIMIT_ACTIONS',
  'NOTIFICATION_LIMIT_STATUSES',
  'VISIBLE_NOTIFICATION_ACTIONS',
  'VISIBLE_NOTIFICATION_STATUSES',
  "const NOTIFICATION_LIMIT_STATUSES = ['sent', 'queued', 'prepared']",
  ".in('action', NOTIFICATION_LIMIT_ACTIONS)",
  ".in('status', NOTIFICATION_LIMIT_STATUSES)",
  ".in('action', VISIBLE_NOTIFICATION_ACTIONS)",
  ".in('status', VISIBLE_NOTIFICATION_STATUSES)",
  "countQuery = countQuery.eq('owner_id', context.ownerId)",
  "countQuery = countQuery.eq('business_id', businessId)",
  'businessId: job.business_id',
  'updateCardWalletState(context',
  'card_wallet_state_sync_failed',
  'provider_action: action',
  'notification_count_24h',
  'visibleNotificationWasSent',
  'const visibleNotification = visibleNotificationWasSent(status, recipient, providerResult)',
  'return Boolean(providerResult.push?.ok)',
  'countNotifications: visibleNotification',
  "walletUpdateWasPrepared(sent ? 'sent' : 'failed', result)",
  'ALLOWED_TARGET_TYPES',
  'INVALID_TARGET_TYPE',
  'validateTargetFilter',
  'targetFilterObject',
  'stableJson(input.targetFilter || {})',
  ".eq('business_id', businessId)",
  ".eq('business_id', campaign.business_id)",
  ".eq('owner_id', campaign.owner_id)",
  ".in('status', ['draft', 'scheduled', 'sending'])",
  'optionalNumberKey(input.locationRadiusM)',
  'validateSendType(sendType, scheduledAt)',
  'validateLocationSendType(sendType, locationLat, locationLng, locationRadiusM)',
  '!Number.isInteger(radius)',
  'radius > 100000',
  '50 bis 100000 Metern',
  'INVALID_TARGET_FILTER_FIELD',
  'TARGET_FILTER_TOO_LARGE',
  'INVALID_TARGET_FILTER_RANGE',
  'INVALID_TARGET_FILTER_DATE_RANGE',
  'TEMPLATE_NOT_FOUND',
  'validateTargetAgainstTemplate',
  "featureEnabled(instance.card_templates, 'notifications')",
  'const expectedLevel = stringValue(targetFilter.vipLevel || targetFilter.vip_level).toLowerCase()',
  "targetFilter.membershipStatus || targetFilter.membership_status || targetFilter.status",
  'targetFilter,',
  'scheduledAt,',
  'locationRadiusM',
  'template.settings?.eventId',
  ".eq('business_id', campaign.business_id)"
]);

assertAll('public/js/templateFeatures.js', 'Browser Template Notifications Opt-out', [
  "featureName === 'notifications'",
  'resolvedSettings.notificationsEnabled === false',
  'featureObject.notifications === false'
]);

assertAll('supabase/functions/_shared/templateFeatures.ts', 'Edge Template Notifications Opt-out', [
  "featureName === 'notifications'",
  'resolvedSettings.notificationsEnabled === false',
  'featureObject.notifications === false'
]);

const walletService = read('supabase/functions/_shared/walletNotificationService.ts');
const notificationTemplateFilterCount = (walletService.match(/featureEnabled\(instance\.card_templates, 'notifications'\)/g) || []).length;
assert(notificationTemplateFilterCount >= 2, 'Wallet Notification Service muss notification-fähige Templates in Versand und Preflight filtern.');
assert(
  walletService.includes(".eq('push_enabled', true)") && walletService.includes('instance.push_enabled !== false'),
  'Wallet Notification Service muss deaktivierte Push-Karten in Resolve und Preflight ausschliessen.'
);
assert(
  !walletService.includes('.limit(1000)'),
  'Wallet Notification Service darf card_instances für Resolve/Preflight nicht über ein statisches 1000er-Limit abschneiden.'
);
assertAll('supabase/functions/_shared/walletNotificationService.ts', 'Wallet Card Pagination für grosse Betreiber', [
  'const CARD_INSTANCE_PAGE_SIZE = 500',
  'const RECIPIENT_PAGE_SIZE = 500',
  'const RECIPIENT_SEND_BATCH_SIZE = 100',
  'const RECIPIENT_UPSERT_BATCH_SIZE = 500',
  'const SEND_RESULT_DETAIL_LIMIT = 200',
  'async function loadWalletCardInstances',
  ".from('card_instances')",
  ".order('id', { ascending: true })",
  '.range(from, to)',
  'pageRows.length < CARD_INSTANCE_PAGE_SIZE',
  'async function loadPendingCampaignRecipients',
  '.limit(RECIPIENT_SEND_BATCH_SIZE)',
  'while (recipients.length)',
  'createSendResultSummary',
  'compactProviderSendResult',
  'addSendResult(results, resultSummary',
  'result_summary: resultSummary',
  'results_truncated: Boolean(resultSummary.truncated)',
  'processed_recipient_batches: processedRecipientBatches',
  'async function upsertRecipientRows',
  'index += RECIPIENT_UPSERT_BATCH_SIZE',
  'await loadWalletCardInstances(context, {',
  'pushEnabledOnly: true',
  'includeGoogleObjects: true',
  'await upsertRecipientRows(context.supabaseAdmin, rows)'
]);
assert(
  !walletService.includes('results.push({ recipient_id: recipient.id, status, providerResult })'),
  'sendNow darf rohe Provider-Ergebnisse nicht direkt in API-Resultdetails zurückgeben; Details müssen kompakt/redigiert sein.'
);
const preflightStart = walletService.indexOf('async previewNotificationLimits');
const preflightEnd = walletService.indexOf('async sendNow', preflightStart);
assert(preflightStart >= 0 && preflightEnd > preflightStart, 'previewNotificationLimits konnte im Wallet Notification Service nicht eingegrenzt werden.');
const preflightBody = walletService.slice(preflightStart, preflightEnd);
[
  ".from('apple_wallet_registrations')",
  ".select('card_instance_id')",
  ".eq('owner_id', context.ownerId)",
  ".eq('business_id', context.business.id)",
  ".in('card_instance_id', appleIds)"
].forEach((needle) => assert(
  preflightBody.includes(needle),
  `Apple-Preflight-Registrierungszählung muss mandantensicher gefiltert sein: ${needle}`
));
assertAll('supabase/functions/_shared/walletNotificationService.ts', 'Wallet Push Opt-out Preflight', [
  'pushDisabledCount',
  'push_disabled_count: pushDisabledCount',
  "'PUSH_DISABLED'",
  'haben Push-Benachrichtigungen deaktiviert'
]);
assert(
  walletService.includes("const blockedStatus = limits.status === 'skipped' ? 'skipped' : 'limited'"),
  'Wallet Notification Service muss PUSH_DISABLED beim Kampagnenversand als skipped statt limited loggen.'
);
assertAll('supabase/functions/_shared/walletNotificationService.ts', 'Wallet Audit Log Insert Fehler', [
  "const { error } = await supabaseAdmin.from('wallet_push_logs').insert(payload)",
  'WALLET_PUSH_LOG_INSERT_FAILED',
  'Wallet Audit-Log konnte nicht gespeichert werden.'
]);
assertAll('supabase/functions/_shared/walletNotificationService.ts', 'Wallet Kartenstatus Update Fehler', [
  'async function updateCardWalletState',
  'CARD_WALLET_STATE_UPDATE_FAILED',
  'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.'
]);
const createCampaignImmediateSendCount = (walletService.match(/sendResult = await this\.sendNow\(context, campaign\.id\)/g) || []).length;
assert(createCampaignImmediateSendCount === 1, 'Sofort-Kampagnen dürfen createCampaign nur einmal an sendNow übergeben.');
const strictQueueCompletionGuardCount = (walletService.match(/\.eq\('id', job\.id\)\s*\.eq\('owner_id', ownerId\)\s*\.eq\('business_id', job\.business_id\)\s*\.eq\('status', 'processing'\)/g) || []).length;
const finalizeQueueCallCount = (walletService.match(/finalizeQueueJobProcessing\(context\.supabaseAdmin, job, ownerId/g) || []).length;
assert(
  strictQueueCompletionGuardCount >= 1
    && finalizeQueueCallCount >= 2
    && walletService.includes('QUEUE_STATUS_UPDATE_CONFLICT')
    && walletService.includes("Wallet-Queue-Status konnte nicht aktualisiert werden."),
  'Wallet Update Queue muss Abschluss und Retry über finalizeQueueJobProcessing nach id, owner_id, business_id und status=processing absichern.'
);

for (const manualWalletFunction of [
  'supabase/functions/send-apple-wallet-update/index.ts',
  'supabase/functions/send-google-wallet-message/index.ts',
  'supabase/functions/update-apple-pass/index.ts'
]) {
  assertAll(manualWalletFunction, 'Manuelle Wallet Sends respektieren Push Opt-out', [
    "blockedStatus = limits.status === 'skipped' ? 'skipped' : 'limited'",
    "blockedStatus === 'skipped' ? 409 : 429",
    "status === 'skipped'"
  ]);
}

for (const walletLogFunction of [
  'supabase/functions/claim-apple-pass/index.ts',
  'supabase/functions/google-wallet-save-link/index.ts',
  'supabase/functions/issue-apple-pass/index.ts',
  'supabase/functions/issue-google-wallet-pass/index.ts',
  'supabase/functions/send-apple-wallet-update/index.ts',
  'supabase/functions/send-google-wallet-message/index.ts',
  'supabase/functions/update-apple-pass/index.ts',
  'supabase/functions/update-google-wallet-pass/index.ts'
]) {
  assertAll(walletLogFunction, 'Direkte Wallet Audit-Logs prüfen Insert-Fehler', [
    'const { error: logError }',
    'WALLET_PUSH_LOG_INSERT_FAILED',
    'Wallet Audit-Log konnte nicht gespeichert werden.'
  ]);
}

assertAll('supabase/functions/process-scheduled-wallet-notifications/index.ts', 'Scheduled Wallet Notification Processor', [
  'walletNotificationService.automationContext(request)',
  'processScheduledWalletNotifications(context)'
]);

assertAll('supabase/functions/process-wallet-update-queue/index.ts', 'Wallet Update Queue Processor', [
  'walletNotificationService.automationContext(request)',
  'processWalletUpdateQueue(context)'
]);

assertAll('supabase/functions/_shared/walletNotificationService.ts', 'Wallet Queue Google Security', [
  'validateQueueGooglePatch',
  'QUEUE_GOOGLE_PATCH_FIELD_FORBIDDEN',
  'QUEUE_GOOGLE_OBJECT_TYPE_INVALID',
  'const objectId = stringValue(googleObject?.object_id || cardInstance.google_object_id || cardInstance.wallet_object_id || job.payload?.object_id || job.payload?.objectId)',
  'googleWalletProvider.normalizeObjectType',
  'googleWalletProvider.objectTypeForTemplate',
  'touchGoogleWalletObjectMapping({',
  'id: job.business_id',
  'google_object_id: objectId',
  'wallet_object_id: objectId',
  'wallet_serial_number: objectId',
  'Google Wallet Object ID konnte nach dem Provider-Update nicht für die erwartete Karteninstanz synchronisiert werden.'
]);

assertAll('supabase/functions/check-wallet-notification-limits/index.ts', 'Wallet Limit Preflight Processor', [
  'previewNotificationLimits(context, body)',
  ".eq('business_id', context.business.id)",
  'requestedWalletPlatform',
  'cardInstance.wallet_platform',
  'checkPlatformLimits(context, cardInstance, walletPlatform)'
]);

assertAll('supabase/functions/resolve-wallet-notification-recipients/index.ts', 'Wallet Recipient Resolve Security', [
  ".eq('owner_id', context.ownerId)",
  ".eq('business_id', context.business.id)",
  'Die Kampagne gehört nicht zu deinem Business oder existiert nicht',
  'resolveRecipients(context, campaign)',
  'recipientSummary(recipients)',
  'recipient_summary: summary',
  'status_counts',
  'platform_counts'
]);
assert(
  !read('supabase/functions/resolve-wallet-notification-recipients/index.ts').includes('recipients,'),
  'resolve-wallet-notification-recipients darf keine rohen Empfängerzeilen in der Browserantwort zurückgeben.'
);

assertAll('supabase/functions/claim-card/index.ts', 'Claim Card Security', [
  'CLAIM_WALLET_OBJECT_ID_REQUIRED',
  'CLAIM_WALLET_OBJECT_ID_INVALID',
  'CLAIM_WALLET_OBJECT_ID_MAX_LENGTH',
  'CLAIM_WALLET_OBJECT_ID_PATTERN',
  'validateWalletObjectId(walletObjectId)',
  'CLAIM_WALLET_OBJECT_ID_CONFLICT',
  'CLAIM_WALLET_OBJECT_ID_DUPLICATE',
  'CLAIM_CARD_INSTANCE_SAVE_FAILED',
  'CLAIM_CARD_EVENT_SAVE_FAILED',
  'insertClaimCardInstance',
  'insertClaimEvent',
  "select('id')",
  'publicClaimCard(card',
  'card: publicClaimCard(card)',
  'isUniqueViolation(cardError)',
  'claim_reused_after_unique_conflict',
  'recoveredFromUniqueConflict',
  'walletObjectId',
  "metadata->>google_wallet_claim_key",
  'google_wallet_claim_key: walletObjectId',
  "const walletSerialNumber = platform === 'apple' ? passSerialNumber : walletObjectId",
  'wallet_serial_number: walletSerialNumber',
  "wallet_object_id: walletObjectId",
  'claim_card_edge_function'
]);

[
  {
    relativePath: 'supabase/functions/claim-card/index.ts',
    nextMarker: 'async function findExistingWalletCard'
  },
  {
    relativePath: 'server/index.js',
    nextMarker: 'const sensitiveResponseKeys'
  }
].forEach(({ relativePath, nextMarker }) => {
  const body = functionBodyBetween(relativePath, 'publicClaimCard', nextMarker);

  [
    'owner_id',
    'business_id',
    'pass_authentication_token'
  ].forEach((forbiddenField) => {
    assert(
      !body.includes(forbiddenField),
      `${relativePath} publicClaimCard darf ${forbiddenField} nicht an die öffentliche Claim-Seite ausgeben.`
    );
  });
});

assertAll('supabase/functions/_shared/appleWalletProvider.ts', 'Apple Wallet Provider', [
  'jszip',
  'node-forge',
  'issuePass(',
  'signPass(',
  'registerDevice(',
  'unregisterDevice(',
  'getUpdatedPass(',
  'sendPushUpdate(',
  'updatePassFields(',
  'ensurePassAuthenticationToken(',
  'customerCardIdentityQuery',
  ".eq('owner_id', cardInstance.owner_id)",
  ".eq('template_id', cardInstance.template_id)",
  ".eq('business_id', businessId)",
  ".is('business_id', null)",
  'APPLE_CUSTOMER_CARD_MISSING',
  'APPLE_CUSTOMER_CARD_CONTEXT_MISMATCH',
  'randomAppleAuthenticationToken',
  'pass_authentication_token: generatedToken',
  'updated_at: tokenUpdatedAt',
  'configuredHttpsUrl',
  'APPLE_WEB_SERVICE_CONFIG_MISSING',
  'authenticationToken',
  'webServiceURL',
  'skipEnsureAuthToken',
  'APPLE_PASS_VERSION_RETRY_LIMIT',
  'insertApplePassVersionWithRetry',
  "error.code !== '23505'",
  'APPLE_WALLET_QUEUE_INSERT_FAILED',
  'Wallet-Update-Queue konnte nicht gespeichert werden.',
  'queueError',
  'allowFullPassJson',
  'options.allowFullPassJson === true',
  'APPLE_APNS_UNREGISTERED',
  'stale_registration_removed',
  'APPLE_WALLET_DEVICE_SAVE_FAILED',
  'APPLE_WALLET_REGISTRATION_CONTEXT_MISMATCH',
  ".select('owner_id,business_id,template_id,card_instance_id')",
  'registrationContextMismatch',
  'Eine bestehende Registrierung mit gleicher Device/Pass/Serial-Kombination',
  'const unregisterResult = await this.unregisterDevice',
  'ownerId: cardInstance.owner_id',
  'businessId: cardInstance.business_id',
  'templateId: cardInstance.template_id',
  'cardInstanceId: cardInstance.id',
  'staleRegistrationRemoved = Boolean(unregisterResult.removed)',
  'staleRegistrationRemoveError',
  'stale_registration_remove_error',
  ".delete()",
  "query = query.eq('owner_id', params.ownerId)",
  "query = query.eq('business_id', params.businessId)",
  "query = query.eq('template_id', params.templateId)",
  "query = query.eq('card_instance_id', params.cardInstanceId)",
  ".select('id')",
  'return { removed: Boolean(data) }',
  'async getUpdatedPass(supabaseAdmin: any, params: Row)',
  ".from('apple_pass_versions')",
  ".select('device_library_identifier, apple_wallet_devices(push_token)')",
  ".eq('owner_id', cardInstance.owner_id)",
  ".eq('business_id', cardInstance.business_id)",
  ".eq('template_id', cardInstance.template_id)",
  ".eq('card_instance_id', cardInstance.id)",
  "'apns-push-type': 'background'",
  "'apns-priority': '5'",
  'authentication_token_hash',
  'sha256(stringValue(params.authenticationToken))',
  'walletFeatureRows',
  'current_stamps',
  'rewardVisible',
  'auxiliaryFields',
  'application/vnd.apple.pkpass',
  'https://api.push.apple.com/3/device/'
]);

assertAll('supabase/functions/apple-wallet-webservice/index.ts', 'Apple Wallet Webservice', [
  'Authorization: ApplePass <authenticationToken>',
  'loadAppleInstanceBySerial',
  ".eq('apple_serial_number', serialNumber)",
  ".eq('id', serialNumber)",
  ".eq('wallet_platform', 'apple')",
  'APPLE_CARD_CONTEXT_MISMATCH',
  'assertApplePassIdentity',
  'logAppleWebserviceEvent',
  'apple_device_registered',
  'apple_device_unregistered',
  'const unregisterResult = await appleWalletProvider.unregisterDevice',
  'ownerId: instance.owner_id',
  'businessId: instance.business_id',
  'templateId: instance.template_id',
  'cardInstanceId: instance.id',
  'removed: Boolean(unregisterResult.removed)',
  'apple_pass_downloaded',
  'const latestPass = await appleWalletProvider.getUpdatedPass',
  'ownerId: instance.owner_id',
  'businessId: instance.business_id',
  'templateId: instance.template_id',
  'cardInstanceId: instance.id',
  'apple_pass_download_failed',
  'apple_pass_not_modified',
  'apple_changed_serials_listed',
  'registrationKeys',
  'registeredCardInstanceIds',
  ".in('card_instance_id', registeredCardInstanceIds)",
  'if (!registrationKeys.has(registrationKey))',
  'changedLatestVersions',
  'response_last_updated',
  'signingHttpStatus',
  'APPLE_PASS_SIGNING_CONFIG_MISSING',
  'APPLE_WEB_SERVICE_CONFIG_MISSING',
  '? 501',
  ': 502',
  'existingRegistration',
  'existingRegistration ? 200 : 201',
  'passesUpdatedSince',
  'maxIsoDate',
  "request.headers.get('if-modified-since')",
  'notModifiedResponse',
  'status: 304',
  "'Cache-Control': 'no-cache'",
  'handleAppleLog',
  "['GET', 'POST'].includes(request.method)",
  'wallet_push_logs',
  'APPLE_CARD_INSTANCE_NOT_FOUND',
  'APPLE_PASS_SERIAL_MISMATCH',
  'APPLE_PASS_TYPE_MISMATCH',
  'pro-Pass authenticationToken ist hier nicht eindeutig',
  ".eq('wallet_platform', 'apple')",
  'wallet_serial_number'
]);

assertAll('supabase/functions/issue-apple-pass/index.ts', 'Apple Wallet Issue Logging', [
  'logAppleIssue',
  'findExistingAppleIssue',
  'responseFromExistingAppleIssue',
  'passVersionForExistingIssue',
  'idempotencyKeyFrom(request',
  'idempotency_scope: IDEMPOTENCY_SCOPE',
  'request_payload->>idempotency_scope',
  'request_payload->>idempotency_key',
  'issue_apple_pass',
  'appleWalletProvider.issuePass',
  'reserveWalletOperationIdempotency(context',
  'finalizeWalletOperationIdempotencyReservation(context',
  'failWalletOperationIdempotencyReservation(',
  "status === 'processing'",
  'publicAppleSigningResult',
  'signing: publicAppleSigningResult(signing)',
  'signingHttpStatus',
  'APPLE_PASS_SIGNING_CONFIG_MISSING',
  'APPLE_PASS_CONFIG_MISSING',
  '? 501',
  ': 502',
  ".eq('business_id', context.business.id)",
  ".eq('wallet_platform', 'apple')",
  'last_wallet_update_at',
  'wallet_push_logs'
]);

assertAll('supabase/functions/_shared/walletNotificationService.ts', 'Wallet Recipient Resolve Idempotency', [
  'loadCampaignRecipients(supabaseAdmin',
  'ignoreDuplicates: true',
  'return await loadCampaignRecipients(context.supabaseAdmin, campaign)',
  'existingRecipients.length'
]);

assertAll('supabase/functions/claim-apple-pass/index.ts', 'Apple Wallet Claim Download', [
  'claim_apple_pass',
  'application/vnd.apple.pkpass',
  'findReusableClaimPassVersion',
  'newestSourceTimestamp',
  'passJsonHasAppleWebServiceFields',
  'APPLE_WEB_SERVICE_CONFIG_MISSING',
  'appleWalletProvider.ensurePassAuthenticationToken',
  'reused_pass_version',
  'appleWalletProvider.updatePassFields',
  'appleWalletProvider.signPass',
  'publicAppleSigningResult',
  'signing: publicAppleSigningResult(signing)',
  'APPLE_CLAIM_TOKEN_MISMATCH',
  ".eq('customer_card_id', appleCardInstance.customer_card_id)",
  ".eq('owner_id', appleCardInstance.owner_id)",
  ".eq('business_id', appleCardInstance.business_id)",
  ".eq('template_id', appleCardInstance.template_id)",
  ".eq('wallet_platform', 'apple')",
  "select('id')",
  'updatedCardInstance',
  'wallet_push_logs'
]);

assertAll('supabase/functions/_shared/googleWalletProvider.ts', 'Google Wallet Provider', [
  'createClass(',
  'createObject(',
  'generateSaveLink(',
  'updateObject(',
  'addMessage(',
  'sendTextAndNotify(',
  'normalizeObjectType(value',
  'GOOGLE_WALLET_OBJECT_TYPE_INVALID',
  'googleConfigError',
  'googleApiError',
  'GOOGLE_WALLET_TOKEN_SIGNING_FAILED',
  'GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED',
  'GOOGLE_WALLET_TOKEN_REQUEST_FAILED',
  'GOOGLE_WALLET_API_REQUEST_FAILED',
  'function googleRequestError(method: string, path: string, error: unknown)',
  'GOOGLE_WALLET_API_',
  'providerError.status',
  'googleObjectIdFor',
  'stored.startsWith(`${config.issuerId}.`)',
  'safeIdSuffix(stored || fallbackValue)',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INVALID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INCOMPLETE',
  'googleWalletOrigins',
  'normalizedHttpOrigin',
  'new URL(text).origin',
  'GOOGLE_WALLET_ORIGINS',
  'APP_PUBLIC_BASE_URL',
  'origins: config.origins',
  'statusPatch(',
  'current_stamps',
  'rewardVisible',
  'loyaltyPoints',
  'eventTicketObject',
  'eventTicketClasses',
  'eventTicketObjects',
  'TEXT_AND_NOTIFY',
  'walletobjects.googleapis.com/walletobjects/v1'
]);

assertAll('supabase/functions/google-wallet-save-link/index.ts', 'Google Wallet Save Link', [
  'eventTicketObject',
  'eventTicketClasses',
  'eventTicketObjects',
  'objectTypeForTemplate',
  'payloadKeysForObjectType',
  'findReusableGoogleWalletObject',
  'logGoogleSaveLink',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INVALID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INCOMPLETE',
  'GOOGLE_WALLET_PRIVATE_KEY_FORMAT',
  'GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED',
  'catch (error)',
  'googleWalletOrigins',
  'normalizedHttpOrigin',
  'new URL(text).origin',
  'GOOGLE_WALLET_ORIGINS',
  'APP_PUBLIC_BASE_URL',
  'origins: config.origins',
  'newestSourceTimestamp',
  'google_wallet_save_link',
  'reused_save_link',
  'save_url_present',
  'save_url_length',
  'GOOGLE_CLAIM_TOKEN_MISMATCH',
  'walletObjectId',
  'googleWalletClaimKey',
  'acceptedClaimKeys',
  'google_wallet_claim_key: googleWalletClaimKey',
  'google_wallet_objects',
  'wallet_push_logs',
  'google_object_id',
  'save_url',
  "onConflict: 'card_instance_id'",
  'updatedGoogleObject',
  ".select('id')",
  '.maybeSingle()',
  'googleObjectUpsertError || !updatedGoogleObject'
]);

assert(
  !read('supabase/functions/google-wallet-save-link/index.ts').includes('const parsedServiceAccount = serviceAccountJson ? JSON.parse(serviceAccountJson) : {}'),
  'Google Save Link darf Service-Account-JSON nicht ungeschützt parsen.'
);

assertAll('supabase/functions/issue-google-wallet-pass/index.ts', 'Google Wallet Issue Logging', [
  'logGoogleIssue',
  'findExistingGoogleIssue',
  'cachedIssuePayload',
  'googleObject?.class_id && !saveLink.classId',
  'googleObject?.object_type && !saveLink.objectType',
  'idempotencyKeyFrom(request',
  'idempotency_scope: IDEMPOTENCY_SCOPE',
  'request_payload->>idempotency_scope',
  'request_payload->>idempotency_key',
  'issue_google_wallet_pass',
  'reserveWalletOperationIdempotency(context',
  'finalizeWalletOperationIdempotencyReservation(context',
  'failWalletOperationIdempotencyReservation(',
  "issueStatus === 'processing'",
  'issueHttpStatus',
  'GOOGLE_WALLET_CONFIG_MISSING',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INVALID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INCOMPLETE',
  'GOOGLE_WALLET_PRIVATE_KEY_FORMAT',
  'GOOGLE_WALLET_TOKEN_SIGNING_FAILED',
  'GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED',
  'normalizedIssueStatus(objectResult, saveLink)',
  '? 207 : 502',
  ".eq('business_id', context.business.id)",
  ".eq('wallet_platform', 'google')",
  'partially_failed',
  'const issuedObjectId = stringValue(objectResult.objectId || saveLink.objectId)',
  'const issuedClassId = stringValue(objectResult.classId || saveLink.classId)',
  'const issuedObjectType = stringValue(objectResult.objectType || saveLink.objectType)',
  '!issuedClassId || !issuedObjectType',
  'GOOGLE_WALLET_OBJECT_IDENTITY_INCOMPLETE',
  'if ((objectResult.ok || saveLink.ok) && issuedObjectId)',
  'google_wallet_objects',
  "onConflict: 'card_instance_id'",
  'updatedGoogleObject',
  ".select('id')",
  '.maybeSingle()',
  'googleObjectUpsertError || !updatedGoogleObject',
  'customerCardFrom',
  'updatedCustomerCard',
  'GOOGLE_CUSTOMER_CARD_UPDATE_FAILED',
  'google_wallet_claim_key',
  'save_url_present: Boolean(saveLink.saveUrl)',
  'save_url_length: stringValue(saveLink.saveUrl).length',
  'wallet_push_logs'
]);

{
  const googleIssue = read('supabase/functions/issue-google-wallet-pass/index.ts');
  const logStart = googleIssue.indexOf('async function logGoogleIssue');
  const logEnd = googleIssue.indexOf('Deno.serve', logStart);
  const logGoogleIssueBody = googleIssue.slice(logStart, logEnd);

  assert(logStart > -1 && logEnd > logStart, 'Google Wallet Issue Logging muss logGoogleIssue isolierbar enthalten.');
  assert(
    !/saveUrl\s*:/.test(logGoogleIssueBody),
    'Google Wallet Issue Logging darf den signierten Save-Link nicht in wallet_push_logs.response_payload speichern.'
  );
  assert(
    logGoogleIssueBody.includes('save_url_present') && logGoogleIssueBody.includes('save_url_length'),
    'Google Wallet Issue Logging muss nur Save-Link-Metadaten statt des signierten Save-JWT speichern.'
  );
}

assertAll('supabase/functions/update-google-wallet-pass/index.ts', 'Google Wallet Update Security', [
  'loadGoogleCardContext',
  ".eq('owner_id', context.ownerId)",
  ".eq('business_id', context.business.id)",
  'GOOGLE_OBJECT_ID_MISMATCH',
  'GOOGLE_OBJECT_NOT_FOUND',
  'googleObject?.object_id || cardInstance.google_object_id',
  'googleWalletProvider.normalizeObjectType',
  'GOOGLE_OBJECT_TYPE_INVALID',
  'validateGoogleWalletPatch',
  'GOOGLE_PATCH_FIELD_FORBIDDEN',
  'GOOGLE_PATCH_TOO_LARGE',
  'refreshStatus',
  'findExistingManualGoogleObjectUpdate',
  'idempotencyKeyFrom(request',
  'idempotency_scope: IDEMPOTENCY_SCOPE',
  'request_payload->>idempotency_scope',
  'googleWalletProvider.statusPatch',
  'manual_google_object_update',
  "checkPlatformLimits(context, resolved.cardInstance, 'google')",
  "blockedStatus = limits.status === 'skipped' ? 'skipped' : 'limited'",
  "blockedStatus === 'skipped' ? 409 : 429",
  'CARD_WALLET_STATE_UPDATE_FAILED',
  'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
  'updatedCardInstance',
  'updatedGoogleObject',
  ".eq('template_id', resolved.cardInstance.template_id)",
  ".eq('wallet_platform', 'google')",
  ".eq('card_instance_id', resolved.cardInstance.id)",
  ".eq('object_type', resolved.objectType)",
  "select('id')",
  'reserveManualIdempotency(context',
  'finalizeManualIdempotencyReservation(context',
  'failManualIdempotencyReservation(',
  "status === 'processing'",
  'wallet_push_logs'
]);

assertAll('supabase/functions/send-google-wallet-message/index.ts', 'Google Wallet Message Logging', [
  'validateMessage(title, message)',
  'logGoogleMessage',
  'findExistingManualGoogleMessage',
  'idempotencyKeyFrom(request',
  'manualDuplicateKey',
  'recentManualDuplicate(context, cardInstance',
  "actions: ['google_text_and_notify', 'google_object_message_fallback']",
  'logManualDuplicateSkipped(context, cardInstance',
  'Identische manuelle Google-Wallet-Nachricht',
  'idempotency_scope: IDEMPOTENCY_SCOPE',
  'request_payload->>idempotency_scope',
  'request_payload->>idempotency_key',
  ".eq('business_id', context.business.id)",
  'google_text_and_notify',
  'google_object_message_fallback',
  'GOOGLE_TEXT_AND_NOTIFY_FALLBACK',
  'reserveManualIdempotency(context',
  'finalizeManualIdempotencyReservation(context',
  'failManualIdempotencyReservation(',
  "status === 'processing'",
  'googleObject?.object_id || cardInstance.google_object_id',
  'googleWalletProvider.normalizeObjectType',
  'GOOGLE_OBJECT_TYPE_INVALID',
  'googleWalletProvider.statusPatch',
  'touchGoogleWalletObjectMapping',
  'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
  'CARD_WALLET_STATE_UPDATE_FAILED',
  'updatedCardInstance',
  'google_object_id: objectId',
  'wallet_object_id: objectId',
  'wallet_serial_number: objectId',
  ".eq('card_instance_id', cardInstance.id)",
  ".eq('template_id', cardInstance.template_id)",
  ".eq('object_id', objectId)",
  ".eq('object_type', objectType)",
  'updateCardWalletState(context, cardInstance.id',
  'countNotifications: true',
  'countNotifications: false',
  'wallet_push_logs'
]);

assertAll('supabase/functions/send-apple-wallet-update/index.ts', 'Apple Wallet Push Logging', [
  'validateOptionalMessage(message)',
  'logAppleUpdate',
  'manual_apple_push_update',
  'findExistingManualAppleUpdate',
  'idempotencyKeyFrom(request',
  'manualDuplicateKey',
  'recentManualDuplicate(context, cardInstance',
  "actions: ['manual_apple_push_update']",
  'logManualDuplicateSkipped(context, cardInstance',
  'Identisches manuelles Apple-Wallet-Update',
  'reserveManualIdempotency(context',
  'finalizeManualIdempotencyReservation(context',
  'failManualIdempotencyReservation(',
  "status === 'processing'",
  'idempotency_scope: IDEMPOTENCY_SCOPE',
  'request_payload->>idempotency_scope',
  'request_payload->>idempotency_key',
  ".eq('business_id', context.business.id)",
  'checkPlatformLimits(context, cardInstance, ' + "'apple')",
  'pushPrepared',
  "status = pushResult.ok ? 'sent' : pushPrepared ? 'prepared'",
  'APPLE_PUSH_NOT_SENT_PASS_PREPARED',
  'publicApplePushResult',
  '...publicApplePushResult(pushResult)',
  'updatePassFields',
  'const passFields = message',
  'updateCardWalletState(context, cardInstance.id',
  'countNotifications: status === ' + "'sent'",
  'wallet_push_logs'
]);

for (const walletStateFunction of [
  'supabase/functions/claim-apple-pass/index.ts',
  'supabase/functions/issue-apple-pass/index.ts',
  'supabase/functions/issue-google-wallet-pass/index.ts'
]) {
  assertAll(walletStateFunction, 'Direkte Wallet-Issue/Claim Kartenstatus-Updates prüfen Fehler', [
    'CARD_WALLET_STATE_UPDATE_FAILED',
    'Wallet-Status der Karteninstanz konnte nicht gespeichert werden.'
  ]);
}

assertAll('supabase/functions/_shared/walletNotificationService.ts', 'Gemeinsamer Kartenstatus-Write prüft Zeilentreffer', [
  'updatedCardInstance',
  'CARD_WALLET_STATE_UPDATE_FAILED',
  "select('id')",
  'card_instances konnte nicht mit den aktuellen Wallet-Statusfeldern für die erwartete Karteninstanz aktualisiert werden.'
]);

assertAll('supabase/functions/issue-google-wallet-pass/index.ts', 'Google Issue Persistenz prüft Fehler', [
  'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
  'GOOGLE_CUSTOMER_CARD_UPDATE_FAILED',
  'Google Wallet Object-Zuordnung konnte nicht gespeichert werden.',
  'updatedCustomerCard',
  'updatedCardInstance',
  ".eq('template_id', cardInstance.template_id)",
  ".eq('wallet_platform', 'google')"
]);

assertAll('supabase/functions/issue-apple-pass/index.ts', 'Apple Issue Persistenz prüft Zeilentreffer', [
  'updatedCardInstance',
  ".eq('template_id', cardInstance.template_id)",
  ".eq('wallet_platform', 'apple')",
  "select('id')",
  'issue_apple_pass konnte last_wallet_update_at nicht für die erwartete Apple-Karteninstanz aktualisieren.'
]);

assertAll('supabase/functions/google-wallet-save-link/index.ts', 'Google Save-Link Persistenz prüft Fehler', [
  'GOOGLE_CUSTOMER_CARD_UPDATE_FAILED',
  'CARD_WALLET_STATE_UPDATE_FAILED',
  'GOOGLE_WALLET_OBJECT_SAVE_FAILED',
  'GOOGLE_WALLET_EVENT_LOG_FAILED',
  'updatedCustomerCard',
  'updatedCardInstance',
  ".eq('owner_id', card.owner_id)",
  ".eq('business_id', card.business_id)",
  ".eq('template_id', card.template_id)",
  ".eq('wallet_platform', 'google')"
]);

const manualAppleSend = read('supabase/functions/send-apple-wallet-update/index.ts');
const manualGoogleSend = read('supabase/functions/send-google-wallet-message/index.ts');
const manualApplePassUpdate = read('supabase/functions/update-apple-pass/index.ts');
const manualGoogleObjectUpdate = read('supabase/functions/update-google-wallet-pass/index.ts');
const appleIssue = read('supabase/functions/issue-apple-pass/index.ts');
const appleClaim = read('supabase/functions/claim-apple-pass/index.ts');
const googleIssue = read('supabase/functions/issue-google-wallet-pass/index.ts');
const googleSaveLink = read('supabase/functions/google-wallet-save-link/index.ts');

assert(
  manualAppleSend.indexOf('const existingResult = await findExistingManualAppleUpdate') > -1
    && manualAppleSend.indexOf('const existingResult = await findExistingManualAppleUpdate')
      < manualAppleSend.indexOf("const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'apple')"),
  'Apple Manual Send muss Idempotency vor der Limitprüfung prüfen.'
);

assert(
  manualAppleSend.indexOf('reserveManualIdempotency(context') > -1
    && manualAppleSend.indexOf('reserveManualIdempotency(context')
      < manualAppleSend.indexOf("const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'apple')")
    && manualAppleSend.indexOf('reserveManualIdempotency(context')
      < manualAppleSend.indexOf('appleWalletProvider.updatePassFields'),
  'Apple Manual Send muss Idempotency vor Limitprüfung und Provider-Aufruf reservieren.'
);

assert(
  manualAppleSend.indexOf('recentManualDuplicate(context, cardInstance') > -1
    && manualAppleSend.indexOf('recentManualDuplicate(context, cardInstance')
      < manualAppleSend.indexOf('reserveManualIdempotency(context')
    && manualAppleSend.indexOf('recentManualDuplicate(context, cardInstance')
      < manualAppleSend.indexOf("const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'apple')")
    && manualAppleSend.indexOf('recentManualDuplicate(context, cardInstance')
      < manualAppleSend.indexOf('appleWalletProvider.updatePassFields'),
  'Apple Manual Send muss identische Nachrichten vor Reservierung, Limitprüfung und Provider-Aufruf deduplizieren.'
);

assert(
  manualGoogleSend.indexOf('const existingResult = await findExistingManualGoogleMessage') > -1
    && manualGoogleSend.indexOf('const existingResult = await findExistingManualGoogleMessage')
      < manualGoogleSend.indexOf("const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'google')"),
  'Google Manual Send muss Idempotency vor der Limitprüfung prüfen.'
);

assert(
  manualGoogleSend.indexOf('reserveManualIdempotency(context') > -1
    && manualGoogleSend.indexOf('reserveManualIdempotency(context')
      < manualGoogleSend.indexOf("const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'google')")
    && manualGoogleSend.indexOf('reserveManualIdempotency(context')
      < manualGoogleSend.indexOf('googleWalletProvider.sendTextAndNotify'),
  'Google Manual Send muss Idempotency vor Limitprüfung und Provider-Aufruf reservieren.'
);

assert(
  manualGoogleSend.indexOf('recentManualDuplicate(context, cardInstance') > -1
    && manualGoogleSend.indexOf('recentManualDuplicate(context, cardInstance')
      < manualGoogleSend.indexOf('reserveManualIdempotency(context')
    && manualGoogleSend.indexOf('recentManualDuplicate(context, cardInstance')
      < manualGoogleSend.indexOf("const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'google')")
    && manualGoogleSend.indexOf('recentManualDuplicate(context, cardInstance')
      < manualGoogleSend.indexOf('googleWalletProvider.sendTextAndNotify'),
  'Google Manual Send muss identische Nachrichten vor Reservierung, Limitprüfung und Provider-Aufruf deduplizieren.'
);

assert(
  manualApplePassUpdate.indexOf('const existingResult = await findExistingManualApplePassUpdate') > -1
    && manualApplePassUpdate.indexOf('const existingResult = await findExistingManualApplePassUpdate')
      < manualApplePassUpdate.indexOf('const passFields = passFieldsFromBody(body)')
    && manualApplePassUpdate.indexOf('const existingResult = await findExistingManualApplePassUpdate')
      < manualApplePassUpdate.indexOf('appleWalletProvider.updatePassFields'),
  'Apple Pass Update muss Idempotency vor neuer Pass-Version und Queue-Job prüfen.'
);

assert(
  manualApplePassUpdate.indexOf("const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'apple')") > -1
    && manualApplePassUpdate.indexOf("const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'apple')")
      < manualApplePassUpdate.indexOf('appleWalletProvider.updatePassFields'),
  'Apple Pass Update muss Tageslimits vor neuer Pass-Version und Queue-Job prüfen.'
);

assert(
  manualApplePassUpdate.indexOf('reserveManualIdempotency(context') > -1
    && manualApplePassUpdate.indexOf('reserveManualIdempotency(context')
      < manualApplePassUpdate.indexOf("const limits = await walletNotificationService.checkPlatformLimits(context, cardInstance, 'apple')")
    && manualApplePassUpdate.indexOf('reserveManualIdempotency(context')
      < manualApplePassUpdate.indexOf('appleWalletProvider.updatePassFields'),
  'Apple Pass Update muss Idempotency vor Limitprüfung und neuer Pass-Version reservieren.'
);

assert(
  manualGoogleObjectUpdate.indexOf('const existingResult = await findExistingManualGoogleObjectUpdate') > -1
    && manualGoogleObjectUpdate.indexOf('const existingResult = await findExistingManualGoogleObjectUpdate')
      < manualGoogleObjectUpdate.indexOf('googleWalletProvider.updateObject'),
  'Google Object Update muss Idempotency vor dem Provider-Patch prüfen.'
);

assert(
  manualGoogleObjectUpdate.indexOf('reserveManualIdempotency(context') > -1
    && manualGoogleObjectUpdate.indexOf('reserveManualIdempotency(context')
      < manualGoogleObjectUpdate.indexOf('googleWalletProvider.updateObject'),
  'Google Object Update muss Idempotency vor dem Provider-Patch reservieren.'
);

assert(
  appleIssue.indexOf('const existingResult = await findExistingAppleIssue') > -1
    && appleIssue.indexOf('const existingResult = await findExistingAppleIssue')
      < appleIssue.indexOf('appleWalletProvider.issuePass')
    && appleIssue.indexOf('return await responseFromExistingAppleIssue') > -1
    && appleIssue.indexOf('appleWalletProvider.signPass(passVersion.pass_json')
      < appleIssue.indexOf('return pkpassResponse(signing)'),
  'Apple Issue muss Idempotency vor neuer Pass-Version prüfen und bestehende Pass-Versionen als pkpass erneut signieren.'
);

assert(
  appleIssue.indexOf('reserveWalletOperationIdempotency(context') > -1
    && appleIssue.indexOf('reserveWalletOperationIdempotency(context')
      < appleIssue.indexOf('appleWalletProvider.issuePass')
    && appleIssue.indexOf('reserveWalletOperationIdempotency(context')
      < appleIssue.lastIndexOf('appleWalletProvider.signPass(passVersion.pass_json')
    && appleIssue.indexOf('failWalletOperationIdempotencyReservation(') > -1,
  'Apple Issue muss Idempotency vor neuer Pass-Version und Signatur reservieren und Fehlerreservierungen abschliessen.'
);

assert(
  appleClaim.indexOf('let passVersion = await findReusableClaimPassVersion') > -1
    && appleClaim.indexOf('let passVersion = await findReusableClaimPassVersion')
      < appleClaim.indexOf('appleWalletProvider.updatePassFields')
    && appleClaim.indexOf('if (!reusedPassVersion)') > -1,
  'Apple Claim Download muss wiederholte Downloads über vorhandene Pass-Versionen bedienen, bevor eine neue Version geschrieben wird.'
);

assert(
  googleIssue.indexOf('const existingResult = await findExistingGoogleIssue') > -1
    && googleIssue.indexOf('const existingResult = await findExistingGoogleIssue')
      < googleIssue.indexOf('googleWalletProvider.createObject')
    && googleIssue.indexOf('const existingResult = await findExistingGoogleIssue')
      < googleIssue.indexOf('googleWalletProvider.generateSaveLink'),
  'Google Issue muss Idempotency vor Google Class/Object/Save-Link-Provider-Aufrufen prüfen.'
);

assert(
  googleIssue.indexOf('reserveWalletOperationIdempotency(context') > -1
    && googleIssue.indexOf('reserveWalletOperationIdempotency(context')
      < googleIssue.indexOf('googleWalletProvider.createObject')
    && googleIssue.indexOf('reserveWalletOperationIdempotency(context')
      < googleIssue.indexOf('googleWalletProvider.generateSaveLink')
    && googleIssue.indexOf('failWalletOperationIdempotencyReservation(') > -1,
  'Google Issue muss Idempotency vor Google Provider-Aufrufen reservieren und Fehlerreservierungen abschliessen.'
);

assert(
  googleSaveLink.indexOf('const reusableWalletObject = await findReusableGoogleWalletObject') > -1
    && googleSaveLink.indexOf('const reusableWalletObject = await findReusableGoogleWalletObject')
      < googleSaveLink.indexOf('const jwt = await signJwt')
    && googleSaveLink.indexOf('if (!reusedSaveLink)') > -1,
  'Google Save-Link Claim muss vorhandene aktuelle Save-Links vor neuer JWT-Signatur wiederverwenden.'
);

assert(
  googleSaveLink.indexOf('await logGoogleSaveLink') > -1
    && googleSaveLink.indexOf('await logGoogleSaveLink')
      < googleSaveLink.indexOf('ok: true')
    && googleSaveLink.indexOf('save_url_present') > -1,
  'Google Save-Link Claim muss den öffentlichen Save-Link-Versuch in wallet_push_logs auditieren, ohne den Save-JWT im Log-Payload zu duplizieren.'
);

assert(
  googleSaveLink.includes('loadGoogleCardInstance')
    && googleSaveLink.includes("eq('customer_card_id', card.id)")
    && googleSaveLink.includes('card_instance_id: cardInstance.id')
    && googleSaveLink.includes('await logGoogleSaveLink(supabaseAdmin, card, cardInstance')
    && !googleSaveLink.includes(".eq('card_instance_id', card.id)")
    && !googleSaveLink.includes('card_instance_id: card.id'),
  'Google Save-Link Claim muss google_wallet_objects und wallet_push_logs mit card_instances.id statt customer_cards.id verknüpfen.'
);

assertAll('supabase/functions/update-apple-pass/index.ts', 'Apple Wallet Pass Update Logging', [
  'passFieldsFromBody',
  'validateApplePassUpdateFields',
  'APPLE_PASS_UPDATE_FIELDS_REQUIRED',
  'APPLE_PASS_UPDATE_FIELD_FORBIDDEN',
  'APPLE_PASS_UPDATE_FIELDS_TOO_LARGE',
  'manual_apple_pass_update',
  'findExistingManualApplePassUpdate',
  'idempotencyKeyFrom(request',
  'reserveManualIdempotency(context',
  'finalizeManualIdempotencyReservation(context',
  'failManualIdempotencyReservation(',
  "status === 'processing'",
  'idempotency_scope: IDEMPOTENCY_SCOPE',
  'request_payload->>idempotency_scope',
  'checkPlatformLimits(context, cardInstance, ' + "'apple')",
  'logApplePassUpdate',
  "'limited'",
  'status: ' + "'queued'",
  ".eq('business_id', context.business.id)",
  'updateCardWalletState(context, cardInstance.id',
  'countNotifications: false',
  'wallet_push_logs'
]);

assertAll('public/editor.html', 'Editor Wallet-Benachrichtigungen UI', [
  'Wallet Benachrichtigungen',
  'walletNotificationForm',
  'walletNotificationTemplate',
  'walletNotificationTarget',
  'walletNotificationTargetFilters',
  'target_event_id',
  'Optionaler Zeitraum',
  'target_active_from',
  'target_active_until',
  'walletNotificationRuleSummary',
  'walletNotificationLimitWarnings',
  'openPushCenterLink',
  'appleNotificationPreviewTitle',
  'googleNotificationPreviewTitle',
  'walletAppleCount',
  'walletGoogleCount',
  'walletLimitedCount',
  'walletAppleUnregisteredCount',
  'walletNotificationHistory'
]);

assertAll('public/js/editor.js', 'Editor Wallet-Benachrichtigungen Logik', [
  'walletNotificationTargetOptions',
  'walletDeliveryRules',
  'allowedWalletNotificationTargets',
  'updateWalletNotificationRuleSummary',
  'setWalletNotificationFormDisabled',
  'dataset.notificationsDisabled',
  'Benachrichtigungen sind für dieses Template deaktiviert',
  "positiveDeliveryRule('businessDailyLimit', 500)",
  "positiveDeliveryRule('customerDailyLimit', 12)",
  "positiveDeliveryRule('cardDailyLimit', 6)",
  "positiveDeliveryRule('googleTextAndNotifyLimitPerPass24h', 3)",
  "positiveDeliveryRule('duplicateWindowMinutes', 10)",
  'pro Kunde/24h',
  'pro Karte/24h',
  'applyWalletNotificationDefaults',
  'targetFilterFromForm',
  'target_event_id',
  'filter.eventId',
  'filter.activeFrom',
  'filter.activeUntil',
  'activeFrom || filter.active_from',
  'cardMatchesNotificationTarget',
  'create-wallet-notification-campaign',
  'wallet_notification_campaigns',
  'wallet_notification_recipients',
  'wallet_push_logs',
  'refreshWalletReachability',
  'notificationPreflightPayload',
  'campaignChildFilters(campaign)',
  "{ column: 'business_id', op: 'eq', value: state.business.id }",
  'scheduledAt: formData.get',
  'businessLocationPayload(sendType)',
  'locationRadiusM: isLocationBased ? defaultLocationRadiusM : null',
  'renderWalletLimitWarnings',
  'preflight?.unreachable_count',
  'preflight?.push_disabled_count',
  'PUSH_DISABLED',
  'otherUnreachableCount',
  'NICHT_ERREICHBAR',
  "String(warning.code || '') === 'APPLE_NO_REGISTERED_DEVICES'",
  'applyWalletPreflightMetrics',
  "showMessage(walletNotificationMessage, 'Wallet-Limits werden geprüft ...')",
  "callWalletNotificationFunction('check-wallet-notification-limits'",
  "payload.sendType === 'now' && allowedCount <= 0",
  'Keine erreichbaren Wallet-Karten für diese Zielgruppe.',
  'Sofortversand blockiert',
  'setMetricText',
  'loadWalletNotificationHistory',
  'Alle Templates / businessweit',
  "walletNotificationTemplate.value = '';",
  "filters.push({ column: 'business_id', op: 'eq', value: state.business.id })",
  "result.campaign?.status || result.send_result?.status",
  'preflight?.allowed_count ?? preflight?.reachable_count',
  'Number(preflight?.unreachable_count || 0) + Number(preflight?.limited_count || 0)',
  'preflight?.apple_count',
  'preflight?.google_count',
  'preflight?.limited_count',
  'preflight?.apple_unregistered_count',
  'deliveryRules.defaultTitle',
  'deliveryRules.defaultMessage',
  'walletDeliveryRules().allowedTargets',
  "select: 'id,status,wallet_platform,error_code,error_message,created_at,sent_at'",
  "select: 'id,status,wallet_platform,action,error_message,created_at'",
  'recipientIssue',
  'logIssue',
  'historyDetailMarkup',
  'Fehlerlogs und Audit-Status anzeigen',
  'Log-Probleme',
  "featureEnabled(template, 'cloakroom')",
  "if (targetType === 'event')",
  'const expectedEventName = String(targetFilter.eventName || targetFilter.event_name ||',
  'targetFilter.vipLevel || targetFilter.vip_level',
  'targetFilter.minCents ?? targetFilter.min_cents',
  'targetFilter.maxCents ?? targetFilter.max_cents'
]);

assertAll('public/js/claim.js', 'Claim Apple Edge Download', [
  'claim-apple-pass',
  'google-wallet-save-link',
  'downloadApplePass',
  'applePassViaEdge',
  'walletObjectId: result.card?.wallet_object_id',
  'downloadPkpassResponse',
  'Apple-Wallet-Datei konnte nicht erstellt werden'
]);

assert(
  !read('public/js/claim.js').includes('/api/passes/'),
  'Claim-Seite darf für Apple Wallet nicht auf den Legacy-PassKit-/api/passes-Fallback zurückfallen.'
);

assert(
  read('public/js/scanner.js').includes("edgeFunctionUrl('issue-apple-pass')")
    && !read('public/js/scanner.js').includes('/api/passes/'),
  'Scanner-Seite muss aktuelle Apple-Wallet-Dateien über issue-apple-pass statt über den Legacy-PassKit-/api/passes-Endpunkt laden.'
);

assertAll('server/index.js', 'Lokaler Claim-Fallback verweist auf Edge Wallet', [
  'walletClaimResponseHints',
  "passDownloadUrl: null",
  "applePassEdgeFunction: 'claim-apple-pass'",
  'google-wallet-save-link',
  'generateWalletAuthenticationToken',
  'CLAIM_WALLET_OBJECT_ID_REQUIRED',
  'CLAIM_WALLET_OBJECT_ID_INVALID',
  'CLAIM_WALLET_OBJECT_ID_MAX_LENGTH',
  'CLAIM_WALLET_OBJECT_ID_PATTERN',
  'validateWalletObjectId(walletObjectId)',
  'CLAIM_WALLET_OBJECT_ID_CONFLICT',
  'CLAIM_WALLET_OBJECT_ID_DUPLICATE',
  'publicClaimCard(card',
  'card: publicClaimCard(card)',
  'card: publicClaimCard(reusedCard)',
  'findExistingClaimCard(walletPlatform, walletObjectId)',
  'isUniqueViolation(insertError)',
  'claim_reused_after_unique_conflict',
  'recoveredFromUniqueConflict',
  ".eq('wallet_platform', walletPlatform)",
  ".eq('wallet_object_id', walletObjectId)",
  "metadata->>google_wallet_claim_key",
  'google_wallet_claim_key: walletObjectId',
  "wallet_serial_number: walletPlatform === 'apple' ? passSerialNumber : walletObjectId"
]);

assertAll('server/index.js', 'Lokale Legacy-PassKit-Routen sind deaktiviert', [
  'legacyWalletRouteDisabled',
  'LEGACY_PASSKIT_ROUTE_DISABLED',
  'Der lokale PassKit-Weg ist deaktiviert.',
  'claim-apple-pass',
  'issue-apple-pass',
  'apple-wallet-webservice',
  "app.all('/api/passes/:fileName'",
  "app.all('/api/passkit/*'"
]);

assert(
  !read('server/index.js').includes("passDownloadUrl: walletPlatform === 'apple' ?"),
  'Lokale Claim-API darf keinen aktiven /api/passes-Link mehr als passDownloadUrl zurückgeben.'
);

assert(
  read('server/index.js').includes('syncLocalCardInstance')
    && read('server/index.js').includes(".eq('customer_card_id', updatedCard.id)")
    && read('server/index.js').includes('const updatedCardInstance = await syncLocalCardInstance(updatedCard, template, now, {')
    && read('server/index.js').includes('const cardInstanceId = updatedCardInstance.id')
    && read('server/index.js').includes("const walletSerialNumber = updatedCard.wallet_platform === 'google'")
    && read('server/index.js').includes('wallet_serial_number: walletSerialNumber')
    && read('server/index.js').includes('SCANNER_CARD_INSTANCE_SYNC_FAILED')
    && read('server/index.js').includes('SCANNER_BALANCE_TRANSACTION_SAVE_FAILED')
    && read('server/index.js').includes('SCANNER_SCAN_EVENT_SAVE_FAILED')
    && read('server/index.js').includes('SCANNER_CARD_EVENT_SAVE_FAILED')
    && read('server/index.js').includes('insertLocalScannerBalanceTransaction')
    && read('server/index.js').includes('insertLocalScanEvent')
    && read('server/index.js').includes('insertLocalScannerEvent')
    && !read('server/index.js').includes('card_instance_id: card.id')
    && !read('server/index.js').includes(".eq('id', updatedCard.id);"),
  'Lokaler Scanner-Fallback muss card_instances über customer_card_id laden, Persistenzfehler melden und Balance-Logs mit der echten card_instance_id schreiben.'
);

assert(
  read('supabase/functions/scanner-actions/index.ts').includes('syncCardInstance')
    && read('supabase/functions/scanner-actions/index.ts').includes(".eq('customer_card_id', updatedCard.id)")
    && read('supabase/functions/scanner-actions/index.ts').includes('const updatedCardInstance = await syncCardInstance(supabaseAdmin, updatedCard, template, now, {')
    && read('supabase/functions/scanner-actions/index.ts').includes('const cardInstanceId = updatedCardInstance.id')
    && read('supabase/functions/scanner-actions/index.ts').includes("const walletSerialNumber = updatedCard.wallet_platform === 'google'")
    && read('supabase/functions/scanner-actions/index.ts').includes('wallet_serial_number: walletSerialNumber')
    && read('supabase/functions/scanner-actions/index.ts').includes('SCANNER_CARD_INSTANCE_SYNC_FAILED')
    && read('supabase/functions/scanner-actions/index.ts').includes('SCANNER_BALANCE_TRANSACTION_SAVE_FAILED')
    && read('supabase/functions/scanner-actions/index.ts').includes('SCANNER_SCAN_EVENT_SAVE_FAILED')
    && read('supabase/functions/scanner-actions/index.ts').includes('SCANNER_CARD_EVENT_SAVE_FAILED')
    && read('supabase/functions/scanner-actions/index.ts').includes('insertScannerBalanceTransaction')
    && read('supabase/functions/scanner-actions/index.ts').includes('insertScanEvent')
    && read('supabase/functions/scanner-actions/index.ts').includes('insertScannerEvent')
    && !read('supabase/functions/scanner-actions/index.ts').includes('card_instance_id: card.id')
    && !read('supabase/functions/scanner-actions/index.ts').includes(".eq('id', updatedCard.id);"),
  'Edge Scanner muss card_instances über customer_card_id laden, Persistenzfehler melden und Balance-Logs mit der echten card_instance_id schreiben.'
);

assert(
  read('supabase/functions/scanner-actions/index.ts').includes("const walletSerialNumber = updatedCard.wallet_platform === 'google'")
    && read('supabase/functions/scanner-actions/index.ts').includes('wallet_serial_number: walletSerialNumber')
    && read('supabase/functions/scanner-actions/index.ts').includes('const updatedCardInstance = await syncCardInstance(supabaseAdmin, updatedCard, template, now, {')
    && read('supabase/functions/scanner-actions/index.ts').includes('const cardInstanceId = updatedCardInstance.id'),
  'Edge Scanner muss Google-Wallet-Serials beim card_instances Sync erhalten und die echte card_instance_id für Folge-Logs verwenden.'
);

assert(
  !read('server/index.js').includes('buildPkPass')
    && !read('server/index.js').includes('createPassAuthToken')
    && !read('server/index.js').includes("from './passkit.js'"),
  'Lokaler Server darf für den aktiven Wallet-Pfad keine PassKit-Generierung mehr importieren oder aufrufen.'
);

[
  'supabase/functions/_shared/walletNotificationService.ts',
  'supabase/functions/_shared/appleWalletProvider.ts',
  'supabase/functions/_shared/googleWalletProvider.ts',
  'supabase/functions/claim-apple-pass/index.ts',
  'supabase/functions/issue-apple-pass/index.ts',
  'supabase/functions/apple-wallet-webservice/index.ts',
  'supabase/functions/update-apple-pass/index.ts',
  'supabase/functions/send-apple-wallet-update/index.ts',
  'supabase/functions/issue-google-wallet-pass/index.ts',
  'supabase/functions/update-google-wallet-pass/index.ts',
  'supabase/functions/send-google-wallet-message/index.ts',
  'public/js/claim.js',
  'public/js/scanner.js'
].forEach((relativePath) => assertNone(relativePath, 'Direkter Wallet-Pfad ohne PassKit', [
  'passkit-generator',
  'buildPkPass',
  '/api/passkit',
  '/api/passes/'
]));

assertAll('supabase/test-data.sql', 'Wallet Testdaten', [
  'Demo-Business',
  'Demo Stempelkarte',
  'Demo VIP Karte',
  'Demo Guthabenkarte',
  'Demo Garderobenkarte',
  'Demo Eventkarte',
  'Demo Couponkarte',
  'Demo Clubkarte Basis',
  'Demo Clubkarte Alle Features',
  'WC-DEMO-CLUB-BASE',
  'WC-DEMO-CLUB-ALL',
  "'club_card'",
  'club_features',
  'offerObject',
  'eventTicketObject',
  'on conflict (card_instance_id)',
  'apple_wallet_devices',
  'apple_wallet_registrations',
  'apple_pass_versions',
  "encode(digest('demo-apple-auth-token', 'sha256'), 'hex')",
  '"authenticationToken": "demo-apple-auth-token"',
  '"webServiceURL": "https://example.com/functions/v1/apple-wallet-webservice"',
  '"PKBarcodeFormatQR"',
  'on conflict (card_instance_id, version) do update',
  'wallet_notification_recipients',
  'Demo Sofortnachricht',
  'Demo geplante Nachricht',
  'Demo Garderoben-Erinnerung'
]);

const googleProvider = read('supabase/functions/_shared/googleWalletProvider.ts');

[
  googleProvider,
  googleSaveLink
].forEach((content, index) => {
  const label = index === 0 ? 'Google Wallet Provider' : 'Google Wallet Save Link';
  assert(content.includes("event_card"), `${label} muss event_card erkennen.`);
  assert(content.includes("return 'eventTicketObject'"), `${label} muss event_card auf eventTicketObject mappen.`);
  assert(content.includes("eventTicketClasses"), `${label} muss eventTicketClasses für Save-JWTs nutzen.`);
  assert(content.includes("eventTicketObjects"), `${label} muss eventTicketObjects für Save-JWTs nutzen.`);
  assert(content.includes("coupon_card"), `${label} muss coupon_card erkennen.`);
  assert(content.includes("return 'offerObject'"), `${label} muss coupon_card auf offerObject mappen.`);
  assert(content.includes("offerClasses"), `${label} muss offerClasses für Save-JWTs nutzen.`);
  assert(content.includes("offerObjects"), `${label} muss offerObjects für Save-JWTs nutzen.`);
  assert(content.includes("if (objectType === 'offerObject')"), `${label} muss offerObject-spezifische Payloads erzeugen.`);
  assert(content.includes('offerValidTimeInterval'), `${label} muss Coupon-Gültigkeit für offerObject vorbereiten.`);
  assert(content.includes('redemptionTerms') || content.includes('redemption_terms'), `${label} muss Coupon-Bedingungen für offerObject berücksichtigen.`);
  assert(content.includes('classSuffix'), `${label} muss GOOGLE_WALLET_CLASS_SUFFIX für Class-IDs berücksichtigen.`);
  assert(content.includes('normalizeTemplateType(template)'), `${label} muss den Template-Typ in Class-IDs einbeziehen.`);
  assert(!content.includes('const settings = templateSettings(template);\n  const settings = templateSettings(template);'), `${label} enthält doppelte Settings-Deklaration.`);
});

assertAll('supabase/functions/google-wallet-save-link/index.ts', 'Google Save-Link Class-ID Reuse Security', [
  'googleClassId(config, card.card_templates)',
  "eq('class_id', classId)",
  "eq('object_type', objectType)",
  'findReusableGoogleWalletObject(supabaseAdmin, card, cardInstance, objectId, classId, objectType)'
]);

assertAll('docs/WALLET_INTEGRATION_CONTEXT.md', 'Wallet Integrationskontext', [
  'Aktiver Goal-Kontext vom 2026-07-03',
  'am 2026-07-03 erneut bestätigter Nutzerkontext',
  'Kein React',
  'operator_profiles',
  'auth.users',
  'APPLE_TEAM_ID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON',
  'Supabase Function Base URL',
  'lokale `/api/cards/claim`-Fallback',
  'walletPreviewHtml',
  'businessDailyLimit',
  'customerDailyLimit',
  'Kunde/Tag',
  'Edge-Secret-Grenze',
  'scripts/verify-edge-secret-boundary.js',
  'Stempel, Streak, VIP, Guthaben',
  'Event Ticket',
  '`eventTicketObject`',
  'WALLET_CRON_SECRET',
  'location_based'
]);

assertAll('config.example.json', 'Wallet Integrationskonfiguration', [
  '"publicUrls"',
  '"automation"',
  '"walletCronSecret"',
  '"supabaseFunctionBaseUrl"',
  '"walletInstallPage"',
  '"appPublicBaseUrl"',
  '"deliveryRules"',
  '"businessDailyLimit"',
  '"customerDailyLimit"',
  '"cardDailyLimit"',
  '"googleTextAndNotifyLimitPerPass24h"',
  '"duplicateWindowMinutes"',
  '"recipientProcessingTimeoutMinutes"',
  '"queueProcessingTimeoutMinutes"',
  '"defaultTitle"',
  '"defaultMessage"',
  '"desiredPassTypes"',
  '"eventTicket"',
  '"allowedTargets"'
]);

assertAll('server/config.js', 'Public Delivery Rules Config', [
  'businessDailyLimit: positiveInteger(deliveryRules.businessDailyLimit',
  'customerDailyLimit: positiveInteger(deliveryRules.customerDailyLimit',
  'cardDailyLimit: positiveInteger(deliveryRules.cardDailyLimit',
  'googleTextAndNotifyLimitPerPass24h: positiveInteger(deliveryRules.googleTextAndNotifyLimitPerPass24h',
  'duplicateWindowMinutes: positiveInteger(deliveryRules.duplicateWindowMinutes',
  'deliveryRules.defaultTitle',
  'deliveryRules.defaultMessage',
  'Array.isArray(deliveryRules.allowedTargets)'
]);

assertAll('README.md', 'Wallet Deploy-Dokumentation', [
  'supabase secrets set SUPABASE_SERVICE_ROLE_KEY',
  'supabase secrets set APP_PUBLIC_BASE_URL',
  'supabase secrets set APPLE_APNS_KEY_ID',
  'supabase secrets set APPLE_APNS_AUTH_KEY',
  'https://<PROJECT_REF>.supabase.co/functions/v1/apple-wallet-webservice',
  'supabase functions deploy claim-apple-pass',
  'supabase functions deploy apple-wallet-webservice',
  'supabase functions deploy send-google-wallet-message',
  'supabase functions deploy generate-card-pdf',
  'supabase functions deploy process-wallet-update-queue',
  '`verify_jwt = false`',
  'Authorization: ApplePass <authenticationToken>',
  '`WALLET_CRON_SECRET`',
  'WALLET_DUPLICATE_WINDOW_MINUTES',
  '`APPLE_WEB_SERVICE_BASE_URL` exakt auf die deployte `apple-wallet-webservice` Function',
  'scripts/verify-edge-secret-boundary.js',
  'scripts/verify-supabase-edge-jwt-policy.js',
  'scripts/verify-wallet-deploy-checklist.js'
]);

const publicBundle = [
  'public/js/editor.js',
  'public/js/claim.js',
  'public/js/dashboard.js',
  'public/js/scanner.js',
  'public/js/config.js',
  'public/editor.html'
].map(read).join('\n');

[
  'APPLE_PASS_KEY',
  'APPLE_APNS_AUTH_KEY',
  'APPLE_WWDR_CERT',
  'APPLE_PASS_CERT',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON',
  'SUPABASE_SERVICE_ROLE_KEY',
  'WALLET_CRON_SECRET'
].forEach((secretName) => {
  assert(!publicBundle.includes(secretName), `Frontend darf Secret ${secretName} nicht enthalten.`);
});

console.log('Direkte Wallet-Benachrichtigungsarchitektur ist statisch vorhanden.');
