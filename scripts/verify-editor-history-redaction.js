import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const editorSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'editor.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'dashboard.js'), 'utf8');
const scannerSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'scanner.js'), 'utf8');
const schemaSource = fs.readFileSync(path.join(rootDir, 'supabase', 'schema.sql'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, needles, label) {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} fehlt: ${needle}`);
  }
}

function assertExcludes(source, needles, label) {
  for (const needle of needles) {
    assert(!source.includes(needle), `${label} darf nicht enthalten: ${needle}`);
  }
}

assertIncludes(editorSource, [
  'walletNotificationCampaignHistorySelect',
  'select: walletNotificationCampaignHistorySelect',
  "select: 'id,status,wallet_platform,error_code,error_message,created_at,sent_at'",
  "select: 'id,status,wallet_platform,action,error_message,created_at'",
  'Fehlerlogs und Audit-Status anzeigen',
  'history-audit-row',
  'recipientIssue(recipient)',
  'logIssue(log)'
], 'Editor-Historie mit minimierten Fehler-/Auditfeldern');

assertExcludes(editorSource, [
  'provider_response',
  'request_payload',
  'response_payload',
  'payloadDetails(',
  'redactedDetailPayload',
  'redactedStringValue',
  'history-json',
  'Providerantwort',
  'Request',
  'Antwort',
  "selectRows('wallet_notification_campaigns', {\n    select: '*'"
], 'Editor-Historie darf keine rohen Provider-/Audit-Payloads in den Browser laden oder rendern');

assertIncludes(schemaSource, [
  'revoke select, insert, update, delete on public.operator_profiles from authenticated',
  'grant select (\n  id,\n  email,\n  display_name,\n  unlock,\n  approved_at,\n  verification_email_requested_at,\n  verification_email_sent_at,\n  verification_email_last_error,\n  verification_email_attempts,\n  verification_email_status,\n  created_at,\n  updated_at\n) on public.operator_profiles to authenticated',
  'revoke select, insert, update, delete on public.businesses from authenticated',
  'grant select (\n  id,\n  owner_id,\n  name,\n  description,\n  address,\n  location_lat,\n  location_lng,\n  phone,\n  website,\n  logo_url,\n  company_logo_path,\n  company_logo_updated_at,\n  app_theme,\n  guest_crm_enabled,\n  crm_active_guest_days,\n  created_at,\n  updated_at\n) on public.businesses to authenticated',
  'grant insert (\n  owner_id,\n  name,\n  description,\n  address,\n  location_lat,\n  location_lng,\n  phone,\n  website,\n  logo_url,\n  company_logo_path,\n  company_logo_updated_at,\n  app_theme,\n  guest_crm_enabled,\n  crm_active_guest_days\n) on public.businesses to authenticated',
  'grant update (\n  name,\n  description,\n  address,\n  location_lat,\n  location_lng,\n  phone,\n  website,\n  logo_url,\n  company_logo_path,\n  company_logo_updated_at,\n  app_theme,\n  guest_crm_enabled,\n  crm_active_guest_days\n) on public.businesses to authenticated',
  'revoke select, insert, update, delete on public.card_templates from authenticated',
  'grant select (\n  id,\n  owner_id,\n  business_id,\n  business_name,\n  card_name,\n  card_type,\n  template_type,\n  description,\n  primary_color,\n  text_color,\n  logo_url,\n  reward_text,\n  stamps_required,\n  streak_goal,\n  vip_tier,\n  settings,\n  club_features,\n  club_settings,\n  public_claim_token,\n  is_active,\n  created_at,\n  updated_at\n) on public.card_templates to authenticated',
  'grant insert (\n  owner_id,\n  business_id,\n  business_name,\n  card_name,\n  card_type,\n  template_type,\n  description,\n  primary_color,\n  text_color,\n  logo_url,\n  reward_text,\n  stamps_required,\n  streak_goal,\n  vip_tier,\n  settings,\n  club_features,\n  club_settings,\n  is_active\n) on public.card_templates to authenticated',
  'grant update (\n  business_id,\n  business_name,\n  card_name,\n  card_type,\n  template_type,\n  description,\n  primary_color,\n  text_color,\n  logo_url,\n  reward_text,\n  stamps_required,\n  streak_goal,\n  vip_tier,\n  settings,\n  club_features,\n  club_settings,\n  is_active\n) on public.card_templates to authenticated',
  'revoke select, insert, update, delete on public.customer_cards from authenticated',
  'grant select (\n  id,\n  owner_id,\n  business_id,\n  template_id,\n  card_instance_number,\n  customer_code,\n  status,\n  stamp_count,\n  streak_count,\n  vip_status,\n  pass_serial_number,\n  wallet_platform,\n  wallet_object_id,\n  wallet_serial_number,\n  balance_cents,\n  currency,\n  cloakroom_active,\n  cloakroom_started_at,\n  cloakroom_completed_at,\n  last_scanned_at,\n  metadata,\n  last_claimed_at,\n  created_at,\n  updated_at\n) on public.customer_cards to authenticated',
  'drop policy if exists "unlocked operators can update own customer cards" on public.customer_cards',
  'Keine direkte Browser-Update-Policy für customer_cards',
  'drop policy if exists "unlocked operators can update own card instances" on public.card_instances',
  'Keine direkte Browser-Update-Policy für card_instances',
  'revoke select, insert, update, delete on public.card_instances from authenticated',
  'id,\n  owner_id,\n  business_id,\n  template_id,\n  customer_card_id,\n  customer_id,\n  card_instance_number,\n  wallet_platform,\n  demographics_collected,\n  customer_gender,\n  customer_age_group,\n  demographics_collected_at,\n  first_scanned_at,\n  scan_count,\n  resolved_emblem_key,\n  resolved_emblem_url,\n  emblem_updated_at,\n  push_enabled,\n  current_streak,\n  current_stamps,\n  vip_level,\n  vip_benefits_used,\n  custom_counter,\n  balance_cents,\n  currency,\n  cloakroom_active,\n  cloakroom_started_at,\n  cloakroom_completed_at,\n  coupon_status,\n  coupon_redeemed_at,\n  membership_number,\n  membership_status,\n  membership_started_at,\n  membership_expires_at,\n  last_scanned_at,\n  last_wallet_update_at,\n  last_notification_at,\n  notification_count_24h,\n  created_at,\n  updated_at',
  'revoke select, insert, update, delete on public.club_card_actions from authenticated',
  'Keine direkte Browser-Insert-Policy für club_card_actions',
  'drop policy if exists "unlocked operators can insert own balance transactions" on public.balance_transactions',
  'Keine direkte Browser-Insert-Policy für balance_transactions',
  'revoke select, insert, update, delete on public.balance_transactions from authenticated',
  'id,\n  owner_id,\n  business_id,\n  card_instance_id,\n  amount_cents,\n  currency,\n  type,\n  payment_provider,\n  status,\n  created_by,\n  created_at',
  'drop policy if exists "unlocked operators can insert own topup sessions" on public.topup_payment_sessions',
  'drop policy if exists "unlocked operators can update own topup sessions" on public.topup_payment_sessions',
  'Keine direkte Browser-Insert-Policy für topup_payment_sessions',
  'Keine direkte Browser-Update-Policy für topup_payment_sessions',
  'revoke select, insert, update, delete on public.topup_payment_sessions from authenticated',
  'id,\n  owner_id,\n  business_id,\n  customer_card_id,\n  card_instance_id,\n  amount_cents,\n  currency,\n  payment_provider,\n  status,\n  expires_at,\n  confirmed_at,\n  created_by,\n  created_at,\n  updated_at',
  'revoke select, insert, update, delete on public.wallet_update_jobs from authenticated',
  'drop policy if exists "unlocked operators can update own wallet update jobs" on public.wallet_update_jobs',
  'Keine direkte Browser-Update-Policy für wallet_update_jobs',
  'id,\n  owner_id,\n  business_id,\n  template_id,\n  customer_card_id,\n  card_instance_id,\n  wallet_platform,\n  wallet_serial_number,\n  wallet_object_id,\n  reason,\n  status,\n  attempts,\n  locked_at,\n  processed_at,\n  created_at,\n  updated_at',
  'revoke select, insert, update, delete on public.wallet_device_registrations from authenticated',
  'drop policy if exists "unlocked operators can insert own wallet device registrations" on public.wallet_device_registrations',
  'drop policy if exists "unlocked operators can update own wallet device registrations" on public.wallet_device_registrations',
  'Keine direkte Browser-Insert-Policy für wallet_device_registrations',
  'Keine direkte Browser-Update-Policy für wallet_device_registrations',
  'id,\n  owner_id,\n  business_id,\n  template_id,\n  customer_card_id,\n  card_instance_id,\n  wallet_platform,\n  pass_type_identifier,\n  serial_number,\n  status,\n  last_seen_at,\n  created_at,\n  updated_at',
  'revoke select on public.apple_wallet_registrations from authenticated',
  'id,\n  owner_id,\n  business_id,\n  template_id,\n  card_instance_id,\n  pass_type_identifier,\n  serial_number,\n  created_at',
  'revoke select on public.apple_pass_versions from authenticated',
  'id,\n  owner_id,\n  business_id,\n  template_id,\n  card_instance_id,\n  serial_number,\n  pass_type_identifier,\n  version,\n  last_updated_at',
  'revoke select on public.google_wallet_objects from authenticated',
  'id,\n  owner_id,\n  business_id,\n  template_id,\n  card_instance_id,\n  issuer_id,\n  class_id,\n  object_id,\n  object_type,\n  created_at,\n  updated_at',
  'drop policy if exists "unlocked operators can update own draft wallet notification campaigns" on public.wallet_notification_campaigns',
  'Keine direkte Browser-Update-Policy für wallet_notification_campaigns',
  'revoke select, insert, update, delete on public.wallet_notification_campaigns from authenticated',
  'id,\n  business_id,\n  template_id,\n  notification_rule_id,\n  title,\n  message,\n  target_type,\n  send_type,\n  scheduled_at,\n  location_lat,\n  location_lng,\n  location_radius_m,\n  status,\n  created_at,\n  sent_at',
  'revoke select on public.wallet_notification_recipients from authenticated',
  'grant select (',
  'id,\n  campaign_id,\n  business_id,\n  card_instance_id,\n  wallet_platform,\n  status,\n  error_code,\n  error_message,\n  created_at,\n  sent_at',
  'revoke select on public.wallet_push_logs from authenticated',
  'id,\n  business_id,\n  card_instance_id,\n  campaign_id,\n  wallet_platform,\n  action,\n  status,\n  error_message,\n  created_at',
  'revoke select on public.wallet_update_queue from authenticated',
  'id,\n  business_id,\n  card_instance_id,\n  campaign_id,\n  wallet_platform,\n  update_type,\n  status,\n  attempt_count,\n  next_attempt_at,\n  processing_started_at,\n  created_at,\n  processed_at',
  'drop policy if exists "unlocked operators can insert own card events" on public.card_events',
  'Keine direkte Browser-Insert-Policy für card_events',
  'revoke select, insert, update, delete on public.card_events from authenticated',
  'id,\n  owner_id,\n  business_id,\n  template_id,\n  customer_card_id,\n  event_type,\n  created_by,\n  created_at'
], 'SQL muss Browserrolle auf sichere History-/Queue-Spalten begrenzen');

assertExcludes(schemaSource, [
  'grant select on public.operator_profiles to authenticated',
  'grant select, insert, update on public.businesses to authenticated',
  'grant select, insert, update, delete on public.card_templates to authenticated',
  'grant select, update on public.customer_cards to authenticated',
  'create policy "unlocked operators can update own customer cards"',
  'create policy "unlocked operators can update own card instances"',
  'grant select, update on public.card_instances to authenticated',
  'create policy "unlocked operators can insert own balance transactions"',
  'grant select, insert on public.balance_transactions to authenticated',
  'create policy "unlocked operators can insert own topup sessions"',
  'create policy "unlocked operators can update own topup sessions"',
  'grant select, insert, update on public.topup_payment_sessions to authenticated',
  'create policy "unlocked operators can update own wallet update jobs"',
  'grant select, update on public.wallet_update_jobs to authenticated',
  'create policy "unlocked operators can insert own wallet device registrations"',
  'create policy "unlocked operators can update own wallet device registrations"',
  'grant select, insert, update on public.wallet_device_registrations to authenticated',
  'grant select on public.apple_wallet_registrations to authenticated',
  'grant select on public.apple_pass_versions to authenticated',
  'grant select on public.google_wallet_objects to authenticated',
  'create policy "unlocked operators can update own draft wallet notification campaigns"',
  'grant select, update on public.wallet_notification_campaigns to authenticated',
  'grant select on public.wallet_notification_recipients to authenticated',
  'grant select on public.wallet_push_logs to authenticated',
  'grant select on public.wallet_update_queue to authenticated',
  'create policy "unlocked operators can insert own card events"',
  'grant select, insert on public.card_events to authenticated'
], 'SQL darf authenticated keine ganzen Wallet-Payload-Tabellen selektieren lassen');

assertIncludes(dashboardSource, [
  'customerCardDashboardSelect',
  'select: customerCardDashboardSelect'
], 'Dashboard muss Kundenkarten mit expliziter sicherer Spaltenliste laden');

assertIncludes(scannerSource, [
  "callScannerRequest({ action: 'inspect', code })",
  "action: 'inspect'"
], 'Scanner muss Karten und Karteninstanzen über die abgesicherte Scanner-API laden');

assertExcludes(dashboardSource, [
  "select: '*,card_templates(*)'",
  'pass_authentication_token'
], 'Dashboard darf keine rohe Kundenkarte inklusive Apple-Auth-Token laden');

assertExcludes(scannerSource, [
  "select: '*,card_templates(*)'",
  'pass_authentication_token',
  "selectRows('card_instances'",
  "selectRows(\"card_instances\""
], 'Scanner darf keine rohe Kundenkarte oder card_instances direkt im Browser laden');

console.log('Editor-Historie und Kundenkartenabfragen laden nur minimierte sichere Felder in den Browser.');
