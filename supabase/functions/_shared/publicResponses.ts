export type Row = Record<string, any>;

const SENSITIVE_RESPONSE_KEYS = new Set([
  'owner_id',
  'business_id',
  'pass_authentication_token',
  'authentication_token',
  'authentication_token_hash',
  'service_role_key',
  'private_key',
  'signer_key',
  'signer_key_passphrase',
  'apple_apns_auth_key',
  'google_wallet_service_account_json'
]);

const SENSITIVE_KEY_PATTERN = /(secret|token|password|passphrase|private[_-]?key|service[_-]?role|auth[_-]?key|certificate|cert|p12)/i;
const REDACTED_VALUE = '[redigiert]';
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{80,}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function isPlainObject(value: unknown): value is Row {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_RESPONSE_KEYS.has(key) && !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, entry]) => [key, sanitizeMetadata(entry)])
  );
}

function isSensitiveOperationKey(key: string) {
  const normalized = key.toLowerCase().replace(/-/g, '_');

  return SENSITIVE_RESPONSE_KEYS.has(normalized)
    || SENSITIVE_KEY_PATTERN.test(normalized)
    || [
      'authorization',
      'assertion',
      'jwt',
      'save_url',
      'saveurl',
      'signed_url',
      'signedurl',
      'pkpass',
      'pass_json',
      'passjson',
      'assets'
    ].includes(normalized);
}

function sanitizeWalletOperationValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeWalletOperationValue(item));
  }

  if (typeof value === 'string') {
    return value
      .replace(/(Authorization:\s*(?:Bearer|ApplePass)\s+)[^\s"']+/gi, `$1${REDACTED_VALUE}`)
      .replace(/https:\/\/pay\.google\.com\/gp\/v\/save\/[A-Za-z0-9._-]+/g, `https://pay.google.com/gp/v/save/${REDACTED_VALUE}`)
      .replace(/([?&](?:access_token|id_token|refresh_token|token|auth(?:entication)?token|signature|sig|key|password|code)=)[^&#\s"']+/gi, `$1${REDACTED_VALUE}`)
      .replace(JWT_PATTERN, REDACTED_VALUE)
      .replace(LONG_TOKEN_PATTERN, REDACTED_VALUE);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [
        key,
        isSensitiveOperationKey(key)
          ? REDACTED_VALUE
          : sanitizeWalletOperationValue(entry)
      ])
  );
}

export function publicWalletOperationPayload(payload: unknown) {
  const sanitized = sanitizeWalletOperationValue(payload);

  return isPlainObject(sanitized) ? sanitized : {};
}

export function publicWalletProviderResult(result: Row = {}) {
  return publicWalletOperationPayload({
    ok: Boolean(result.ok),
    status: result.status || null,
    provider: result.provider || null,
    action: result.action || null,
    fallback: result.fallback || null,
    objectId: result.objectId || result.object_id || null,
    classId: result.classId || result.class_id || null,
    objectType: result.objectType || result.object_type || null,
    error_code: result.error_code || null,
    error_message: result.error_message || null,
    error_reason: result.error_reason || null,
    warning_code: result.warning_code || null,
    warning_message: result.warning_message || null
  });
}

export function publicAppleSigningResult(signing: Row = {}) {
  return {
    ok: Boolean(signing.ok),
    status: signing.status || null,
    error_code: signing.error_code || null,
    error_message: signing.error_message || null
  };
}

export function publicApplePushResult(result: Row = {}) {
  const rows = Array.isArray(result.results) ? result.results : [];
  const failedRows = rows.filter((row: Row) => !row?.ok);
  const warning = failedRows.find((row: Row) => row?.error_code || row?.stale_registration_remove_error) || {};

  return {
    ok: Boolean(result.ok),
    status: result.status || null,
    sent_count: rows.filter((row: Row) => row?.ok).length,
    failed_count: failedRows.length,
    skipped_count: rows.filter((row: Row) => row?.status === 'skipped').length,
    error_code: result.error_code || warning.error_code || null,
    error_message: result.error_message || null,
    warning_code: result.warning_code || warning.error_code || null,
    warning_message: result.warning_message || warning.stale_registration_remove_error || null
  };
}

export function publicApplePushOperationPayload(payload: unknown) {
  const sanitized = publicWalletOperationPayload(payload);
  const original = isPlainObject(payload) ? payload : {};
  const output = isPlainObject(sanitized) ? { ...sanitized } : {};

  if (isPlainObject(original.push)) {
    output.push = publicApplePushResult(original.push);
  }

  return output;
}

export function publicGoogleWalletIssuePayload(objectResult: Row = {}, saveLink: Row = {}) {
  return {
    objectResult: publicWalletProviderResult(objectResult),
    saveLink: {
      ...publicWalletProviderResult(saveLink),
      saveUrl: saveLink.saveUrl || null,
      save_url_present: Boolean(saveLink.saveUrl || saveLink.save_url_present),
      save_url_length: saveLink.saveUrl
        ? String(saveLink.saveUrl).length
        : Number(saveLink.save_url_length || 0)
    }
  };
}

export function publicGoogleMessageOperationPayload(payload: unknown) {
  const original = isPlainObject(payload) ? payload : {};
  const notificationResult = isPlainObject(original.notification)
    ? original.notification
    : isPlainObject(original.notificationResult)
    ? original.notificationResult
    : null;
  const fallbackResult = isPlainObject(original.fallback)
    ? original.fallback
    : isPlainObject(original.fallbackResult)
    ? original.fallbackResult
    : null;
  const hasWrappedProviderPayload = Boolean(notificationResult || fallbackResult);
  const hasRootProviderPayload = !hasWrappedProviderPayload
    && ('response' in original || 'provider' in original || 'action' in original || 'error_reason' in original);

  if (hasRootProviderPayload) {
    return publicWalletProviderResult(original);
  }

  const sanitized = publicWalletOperationPayload(payload);
  const output = isPlainObject(sanitized) ? { ...sanitized } : {};

  if (notificationResult) {
    output.notificationResult = publicWalletProviderResult(notificationResult);
  }

  if (fallbackResult) {
    output.fallbackResult = publicWalletProviderResult(fallbackResult);
  }

  if (isPlainObject(output.notification)) {
    delete output.notification;
  }

  if (isPlainObject(output.fallback)) {
    output.fallback = fallbackResult?.ok ? 'google_object_message_fallback' : null;
  }

  if (isPlainObject(output.fallback_response)) {
    delete output.fallback_response;
  }

  if ('response' in output) {
    delete output.response;
  }

  return output;
}

export function publicCardTemplateResponse(template: Row = {}) {
  const business = Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;
  const businessName = business?.name || business?.company_name || template.business_name;
  const businessLogoUrl = business?.logo_url || business?.company_logo_url || template.business_logo_url || template.company_logo_url || template.logo_url || '';

  return {
    id: template.id,
    business_name: businessName,
    business_logo_url: businessLogoUrl,
    card_name: template.card_name,
    card_type: template.card_type,
    template_type: template.template_type,
    description: template.description,
    primary_color: template.primary_color,
    text_color: template.text_color,
    logo_url: businessLogoUrl,
    reward_text: template.reward_text,
    stamps_required: template.stamps_required,
    streak_goal: template.streak_goal,
    vip_tier: template.vip_tier,
    settings: sanitizeMetadata(template.settings || {}),
    club_features: sanitizeMetadata(template.club_features || {}),
    club_settings: sanitizeMetadata(template.club_settings || {}),
    is_active: template.is_active
  };
}

export function publicApplePassVersion(passVersion: Row = {}) {
  return {
    id: passVersion.id,
    version: passVersion.version,
    serial_number: passVersion.serial_number,
    pass_type_identifier: passVersion.pass_type_identifier,
    last_updated_at: passVersion.last_updated_at,
    created_at: passVersion.created_at
  };
}

export function publicOperatorCard(card: Row = {}) {
  return {
    id: card.id,
    template_id: card.template_id,
    card_instance_number: card.card_instance_number,
    customer_code: card.customer_code,
    status: card.status,
    stamp_count: card.stamp_count,
    streak_count: card.streak_count,
    vip_status: card.vip_status,
    pass_serial_number: card.pass_serial_number,
    wallet_platform: card.wallet_platform,
    wallet_object_id: card.wallet_object_id,
    wallet_serial_number: card.wallet_serial_number,
    balance_cents: card.balance_cents,
    currency: card.currency,
    cloakroom_active: card.cloakroom_active,
    cloakroom_started_at: card.cloakroom_started_at,
    cloakroom_completed_at: card.cloakroom_completed_at,
    last_scanned_at: card.last_scanned_at,
    updated_at: card.updated_at,
    created_at: card.created_at,
    metadata: sanitizeMetadata(card.metadata || {}),
    card_templates: card.card_templates
      ? publicCardTemplateResponse(card.card_templates)
      : null
  };
}

export function publicOperatorGuestProfile(profile: Row = {}) {
  if (!profile?.id) {
    return null;
  }

  return {
    id: profile.id,
    display_name: profile.display_name || null,
    gender: profile.gender || null,
    age_group: profile.age_group || null,
    first_seen_at: profile.first_seen_at || null,
    last_seen_at: profile.last_seen_at || null,
    card_count: Math.max(0, Number(profile.card_count || 0)),
    scan_count: Math.max(0, Number(profile.scan_count || 0)),
    created_at: profile.created_at || null,
    updated_at: profile.updated_at || null
  };
}
