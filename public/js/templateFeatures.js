export const OPTIONAL_FEATURE = 'optional';

export const TEMPLATE_TYPES = [
  'stamp_card',
  'streak_card',
  'vip_card',
  'balance_card',
  'cloakroom_card',
  'generic_card',
  'event_card',
  'coupon_card',
  'membership_card',
  'club_card'
];

export const LEGACY_TEMPLATE_TYPE_MAP = {
  stamp: 'stamp_card',
  streak: 'streak_card',
  vip: 'vip_card',
  generic: 'generic_card'
};

export const TEMPLATE_TYPE_LABELS = {
  stamp_card: 'Stempelkarte',
  streak_card: 'Streak-Karte',
  vip_card: 'VIP-/Memberkarte',
  balance_card: 'Aufladbare Guthabenkarte',
  cloakroom_card: 'Garderobenkarte',
  generic_card: 'Generische Basiskarte',
  event_card: 'Eventkarte',
  coupon_card: 'Couponkarte',
  membership_card: 'Mitgliedskarte',
  club_card: 'Clubkarte'
};

export const FEATURE_LABELS = {
  stamps: 'Stempel',
  streak: 'Streak',
  vip: 'VIP',
  balance: 'Guthaben',
  cloakroom: 'Garderobe',
  visit: 'Besuch',
  checkin: 'Check-in',
  redemption: 'Einlösung',
  coupon: 'Coupon',
  membership: 'Mitgliedschaft',
  qrPdf: 'QR/PDF',
  notifications: 'Push',
  customFields: 'Freifelder',
  eventBackgroundImage: 'Eventbild'
};

export const OPERATIONAL_FEATURES = [
  'stamps',
  'streak',
  'vip',
  'balance',
  'cloakroom',
  'visit',
  'checkin',
  'redemption',
  'membership'
];

export const TEMPLATE_FEATURES = Object.freeze({
  stamp_card: {
    stamps: true,
    streak: false,
    vip: false,
    balance: false,
    cloakroom: OPTIONAL_FEATURE,
    qrPdf: true,
    notifications: true,
    customFields: false,
    visit: false,
    checkin: false,
    redemption: false,
    membership: false,
    eventBackgroundImage: false
  },
  streak_card: {
    stamps: false,
    streak: true,
    vip: false,
    balance: false,
    cloakroom: OPTIONAL_FEATURE,
    qrPdf: true,
    notifications: true,
    customFields: false,
    visit: false,
    checkin: false,
    redemption: false,
    membership: false,
    eventBackgroundImage: false
  },
  vip_card: {
    stamps: false,
    streak: false,
    vip: true,
    balance: OPTIONAL_FEATURE,
    cloakroom: OPTIONAL_FEATURE,
    qrPdf: true,
    notifications: true,
    customFields: true,
    visit: true,
    checkin: false,
    redemption: false,
    membership: false,
    eventBackgroundImage: false
  },
  balance_card: {
    stamps: false,
    streak: false,
    vip: false,
    balance: true,
    cloakroom: OPTIONAL_FEATURE,
    qrPdf: true,
    notifications: true,
    customFields: false,
    visit: false,
    checkin: false,
    redemption: false,
    membership: false,
    eventBackgroundImage: false
  },
  cloakroom_card: {
    stamps: false,
    streak: false,
    vip: false,
    balance: false,
    cloakroom: true,
    qrPdf: true,
    notifications: true,
    customFields: false,
    visit: false,
    checkin: false,
    redemption: false,
    membership: false,
    eventBackgroundImage: false
  },
  generic_card: {
    stamps: false,
    streak: false,
    vip: false,
    balance: OPTIONAL_FEATURE,
    cloakroom: OPTIONAL_FEATURE,
    qrPdf: true,
    notifications: true,
    customFields: true,
    visit: true,
    checkin: false,
    redemption: false,
    membership: false,
    eventBackgroundImage: false
  },
  event_card: {
    stamps: false,
    streak: false,
    vip: false,
    balance: false,
    cloakroom: OPTIONAL_FEATURE,
    qrPdf: true,
    notifications: true,
    customFields: true,
    visit: false,
    checkin: true,
    redemption: false,
    membership: false,
    eventBackgroundImage: true
  },
  coupon_card: {
    stamps: false,
    streak: false,
    vip: false,
    balance: false,
    cloakroom: OPTIONAL_FEATURE,
    qrPdf: true,
    notifications: true,
    customFields: false,
    visit: false,
    checkin: false,
    redemption: true,
    membership: false,
    eventBackgroundImage: false
  },
  membership_card: {
    stamps: false,
    streak: false,
    vip: OPTIONAL_FEATURE,
    balance: false,
    cloakroom: OPTIONAL_FEATURE,
    qrPdf: true,
    notifications: true,
    customFields: true,
    visit: false,
    checkin: false,
    redemption: false,
    membership: true,
    eventBackgroundImage: false
  },
  club_card: {
    stamps: false,
    streak: false,
    vip: OPTIONAL_FEATURE,
    balance: OPTIONAL_FEATURE,
    cloakroom: OPTIONAL_FEATURE,
    qrPdf: true,
    notifications: true,
    customFields: true,
    visit: true,
    checkin: false,
    redemption: OPTIONAL_FEATURE,
    membership: OPTIONAL_FEATURE,
    eventBackgroundImage: false
  }
});

export const CLUB_FEATURE_DEFAULTS = Object.freeze({
  vip: false,
  balance: false,
  cloakroom: false,
  coupon: false,
  membership: false
});

export const CLUB_FEATURE_BY_MATRIX_FEATURE = Object.freeze({
  vip: 'vip',
  balance: 'balance',
  cloakroom: 'cloakroom',
  redemption: 'coupon',
  membership: 'membership'
});

export const SCANNER_ACTIONS = Object.freeze({
  'stamp-plus': {
    feature: 'stamps',
    label: 'Stempel hinzufügen',
    blockedReason: 'Diese Karte unterstützt keine Stempel-Funktion.'
  },
  'stamp-minus': {
    feature: 'stamps',
    label: 'Stempel entfernen',
    blockedReason: 'Diese Karte unterstützt keine Stempel-Funktion.'
  },
  'stamp-redeem': {
    feature: 'stamps',
    label: 'Volle Stempelkarte einlösen',
    blockedReason: 'Diese Karte unterstützt keine Stempel-Funktion.'
  },
  'streak-plus': {
    feature: 'streak',
    label: 'Streak erhöhen',
    blockedReason: 'Diese Karte unterstützt keine Streak-Funktion.'
  },
  'streak-reset': {
    feature: 'streak',
    label: 'Streak zurücksetzen',
    blockedReason: 'Diese Karte unterstützt keine Streak-Funktion.'
  },
  'streak-complete': {
    feature: 'streak',
    label: 'Streak-Ziel erfüllen',
    blockedReason: 'Diese Karte unterstützt keine Streak-Funktion.'
  },
  'vip-update': {
    feature: 'vip',
    label: 'VIP-Status aendern',
    blockedReason: 'Diese Karte unterstützt keine VIP-Funktion.'
  },
  'vip-benefit-redeem': {
    feature: 'vip',
    label: 'VIP-Vorteil einlösen',
    blockedReason: 'Diese Karte unterstützt keine VIP-Funktion.'
  },
  'balance-redeem': {
    feature: 'balance',
    label: 'Guthaben abbuchen',
    blockedReason: 'Diese Karte unterstützt keine Guthaben-Funktion.'
  },
  'balance-adjust': {
    feature: 'balance',
    label: 'Guthaben korrigieren',
    blockedReason: 'Diese Karte unterstützt keine Guthaben-Funktion.'
  },
  'cloakroom-toggle': {
    feature: 'cloakroom',
    label: 'Garderobe umschalten',
    blockedReason: 'Diese Karte unterstützt keine Garderoben-Funktion.'
  },
  visit: {
    feature: 'visit',
    label: 'Besuch erfassen',
    blockedReason: 'Diese Karte unterstützt keine Besuchs-Funktion.'
  },
  checkin: {
    feature: 'checkin',
    label: 'Check-in',
    blockedReason: 'Diese Karte unterstützt keine Check-in-Funktion.'
  },
  'event-checkout': {
    feature: 'checkin',
    label: 'Check-out',
    blockedReason: 'Diese Karte unterstützt keine Check-in-Funktion.'
  },
  'event-ticket-use': {
    feature: 'checkin',
    label: 'Ticket als verwendet markieren',
    blockedReason: 'Diese Karte unterstützt keine Check-in-Funktion.'
  },
  redeem: {
    feature: 'redemption',
    label: 'Einlösen',
    blockedReason: 'Diese Karte unterstützt keine Einlöse-Funktion.'
  },
  'membership-check': {
    feature: 'membership',
    label: 'Mitgliedschaft prüfen',
    blockedReason: 'Diese Karte unterstützt keine Mitgliedschafts-Funktion.'
  },
  'membership-status-update': {
    feature: 'membership',
    label: 'Mitgliedsstatus aendern',
    blockedReason: 'Diese Karte unterstützt keine Mitgliedschafts-Funktion.'
  },
  'membership-extend': {
    feature: 'membership',
    label: 'Mitgliedschaft verlängern',
    blockedReason: 'Diese Karte unterstützt keine Mitgliedschafts-Funktion.'
  }
});

export const SCANNER_ACTION_ALIASES = Object.freeze({
  add_stamp: 'stamp-plus',
  increment_stamp: 'stamp-plus',
  remove_stamp: 'stamp-minus',
  decrement_stamp: 'stamp-minus',
  redeem_stamp: 'stamp-redeem',
  redeem_stamp_card: 'stamp-redeem',
  mark_stamp_card_redeemed: 'stamp-redeem',
  increment_streak: 'streak-plus',
  reset_streak: 'streak-reset',
  complete_streak: 'streak-complete',
  fulfill_streak_goal: 'streak-complete',
  mark_streak_goal_complete: 'streak-complete',
  update_vip: 'vip-update',
  change_vip_level: 'vip-update',
  redeem_vip_benefit: 'vip-benefit-redeem',
  redeem_benefit: 'vip-benefit-redeem',
  use_vip_benefit: 'vip-benefit-redeem',
  redeem_balance: 'balance-redeem',
  adjust_balance: 'balance-adjust',
  correct_balance: 'balance-adjust',
  manual_adjust_balance: 'balance-adjust',
  redeem_coupon: 'redeem',
  mark_coupon_used: 'redeem',
  check_in: 'checkin',
  event_checkin: 'checkin',
  check_out: 'event-checkout',
  event_checkout: 'event-checkout',
  ticket_used: 'event-ticket-use',
  use_ticket: 'event-ticket-use',
  mark_ticket_used: 'event-ticket-use',
  mark_event_ticket_used: 'event-ticket-use',
  membership_check: 'membership-check',
  check_membership: 'membership-check',
  update_membership_status: 'membership-status-update',
  change_membership_status: 'membership-status-update',
  extend_membership: 'membership-extend',
  renew_membership: 'membership-extend',
  record_visit: 'visit',
  cloakroom_dropoff: 'cloakroom-toggle',
  cloakroom_pickup: 'cloakroom-toggle'
});

export function normalizeTemplateType(templateOrType) {
  const rawType = typeof templateOrType === 'string'
    ? templateOrType
    : templateOrType?.template_type || templateOrType?.card_type;
  const type = String(rawType || 'generic_card');

  if (TEMPLATE_FEATURES[type]) {
    return type;
  }

  return LEGACY_TEMPLATE_TYPE_MAP[type] || 'generic_card';
}

export function legacyCardTypeForTemplateType(templateOrType) {
  const templateType = normalizeTemplateType(templateOrType);

  return {
    stamp_card: 'stamp',
    streak_card: 'streak',
    vip_card: 'vip'
  }[templateType] || 'generic';
}

export function templateTypeLabel(templateOrType) {
  return TEMPLATE_TYPE_LABELS[normalizeTemplateType(templateOrType)] || 'Karte';
}

export function getTemplateFeatures(templateOrType) {
  return TEMPLATE_FEATURES[normalizeTemplateType(templateOrType)] || TEMPLATE_FEATURES.generic_card;
}

export function templateSettings(template) {
  return template?.settings && typeof template.settings === 'object'
    ? template.settings
    : {};
}

export function publicShareLinkEnabled(template) {
  if (template?.is_active === false) {
    return false;
  }

  const settings = templateSettings(template);
  const configuredValue = settings.publicShareLinkEnabled ?? settings.public_share_link_enabled;

  return typeof configuredValue === 'boolean'
    ? configuredValue
    : normalizeTemplateType(template) === 'club_card';
}

export function clubFeatures(template) {
  const settings = templateSettings(template);
  const source = template?.club_features && typeof template.club_features === 'object'
    ? template.club_features
    : settings.club_features && typeof settings.club_features === 'object'
      ? settings.club_features
      : settings.clubFeatures && typeof settings.clubFeatures === 'object'
        ? settings.clubFeatures
        : {};

  return Object.fromEntries(
    Object.entries(CLUB_FEATURE_DEFAULTS)
      .map(([featureName, defaultValue]) => [featureName, Boolean(source[featureName] ?? defaultValue)])
  );
}

export function featureValue(templateOrType, featureName) {
  return getTemplateFeatures(templateOrType)[featureName] || false;
}

export function featureEnabled(templateOrType, featureName, settings = null) {
  const value = featureValue(templateOrType, featureName);
  const resolvedSettings = settings || (typeof templateOrType === 'object' ? templateSettings(templateOrType) : {});
  const featureObject = resolvedSettings.features && typeof resolvedSettings.features === 'object'
    ? resolvedSettings.features
    : {};
  const templateType = normalizeTemplateType(templateOrType);

  if (featureName === 'notifications' && (
    resolvedSettings.notificationsEnabled === false
      || featureObject.notifications === false
  )) {
    return false;
  }

  if (value === true) {
    return true;
  }

  if (value !== OPTIONAL_FEATURE) {
    return false;
  }

  if (templateType === 'club_card') {
    const clubFeatureName = CLUB_FEATURE_BY_MATRIX_FEATURE[featureName];

    if (clubFeatureName) {
      return clubFeatures({
        ...(typeof templateOrType === 'object' ? templateOrType : {}),
        settings: resolvedSettings
      })[clubFeatureName] === true;
    }
  }

  const enabledFeatures = Array.isArray(resolvedSettings.enabledFeatures)
    ? resolvedSettings.enabledFeatures
    : [];

  return Boolean(
    resolvedSettings.features?.[featureName]
      || resolvedSettings[`${featureName}Enabled`]
      || enabledFeatures.includes(featureName)
  );
}

export function featureLabel(featureName) {
  return FEATURE_LABELS[featureName] || featureName;
}

export function clubFeatureError(featureName) {
  const clubFeatureName = CLUB_FEATURE_BY_MATRIX_FEATURE[featureName] || featureName;

  return {
    error_code: 'FEATURE_NOT_ENABLED',
    error_message: 'Diese Funktion ist für diese Clubkarte nicht aktiviert.',
    error_reason: `Das Feature ${clubFeatureName} ist in club_features deaktiviert.`
  };
}

export function assertClubFeatureEnabled(template, featureName) {
  if (normalizeTemplateType(template) !== 'club_card') {
    return;
  }

  if (!CLUB_FEATURE_BY_MATRIX_FEATURE[featureName]) {
    return;
  }

  if (!featureEnabled(template, featureName)) {
    throw clubFeatureError(featureName);
  }
}

export function activeFeatureLabels(template, {
  includeBaseFallback = true
} = {}) {
  const labels = OPERATIONAL_FEATURES
    .filter((featureName) => featureEnabled(template, featureName))
    .map(featureLabel);

  if (!labels.length && includeBaseFallback) {
    labels.push('Basiskarte');
  }

  return labels;
}

export function templateFeatureSummary(template) {
  const settings = templateSettings(template);
  const summaries = [];

  if (normalizeTemplateType(template) === 'club_card') {
    const clubLabels = [
      ['vip', 'VIP'],
      ['balance', `Guthaben ${settings.currency || 'CHF'}`],
      ['cloakroom', 'Garderobe'],
      ['redemption', settings.couponTitle || 'Coupon'],
      ['membership', settings.membershipStatus || 'Mitgliedschaft']
    ]
      .filter(([featureName]) => featureEnabled(template, featureName))
      .map(([, label]) => label);

    return clubLabels.length ? `Clubkarte: ${clubLabels.join(', ')}` : 'Clubkarte ohne Zusatzfunktionen';
  }

  if (featureEnabled(template, 'stamps')) {
    summaries.push(`${template.stamps_required || 10} Stempel`);
  }

  if (featureEnabled(template, 'streak')) {
    summaries.push(`${template.streak_goal || settings.streakGoal || '-'} Streak-Ziel`);
  }

  if (featureEnabled(template, 'vip')) {
    summaries.push(template.vip_tier || 'VIP');
  }

  if (featureEnabled(template, 'balance')) {
    summaries.push(`Guthaben ${settings.currency || 'CHF'}`);
  }

  if (featureEnabled(template, 'cloakroom')) {
    summaries.push('Garderobe');
  }

  if (featureEnabled(template, 'visit')) {
    summaries.push('Besuch');
  }

  if (featureEnabled(template, 'checkin')) {
    summaries.push(settings.eventName || 'Check-in');
  }

  if (featureEnabled(template, 'redemption')) {
    summaries.push(settings.couponTitle || 'Einlösung');
  }

  if (featureEnabled(template, 'membership')) {
    summaries.push(settings.membershipStatus || 'Mitgliedschaft');
  }

  return summaries.length ? summaries.join(', ') : 'Basiskarte';
}

export function scannerAccessHighlights(template, card = {}) {
  const settings = templateSettings(template);
  const metadata = card?.metadata && typeof card.metadata === 'object' ? card.metadata : {};
  const highlights = [];

  if (featureEnabled(template, 'vip')) {
    const vipValue = card?.vip_status || card?.vip_level || template?.vip_tier || 'VIP';
    const vipDetails = [metadata.vip_benefits || metadata.vip_note || settings.vipNote]
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    highlights.push({ feature: 'vip', label: 'VIP-Status', value: String(vipValue), details: vipDetails, iconText: 'VIP' });
  }

  if (featureEnabled(template, 'membership')) {
    const membershipStatus = metadata.membership_status || card?.membership_status || settings.membershipStatus || 'Aktiv';
    const membershipNumber = metadata.membership_number || card?.membership_number || '';
    const membershipExpiresAt = metadata.membership_expires_at || card?.membership_expires_at || settings.membershipExpiresAt || '';
    const membershipBenefits = metadata.membership_benefits || settings.membershipBenefits || '';
    const membershipDetails = [
      membershipNumber ? `Mitgliedsnummer: ${membershipNumber}` : '',
      membershipExpiresAt ? `Gültig bis: ${membershipExpiresAt}` : '',
      ...String(membershipBenefits || '').split(/\r?\n|,/)
    ].map((value) => String(value || '').trim()).filter(Boolean);

    highlights.push({ feature: 'membership', label: 'Mitgliedschaft', value: String(membershipStatus), details: membershipDetails, iconText: 'M' });
  }

  return highlights;
}

export function cardFeatureRows(template, card = null) {
  const settings = templateSettings(template);
  const rows = [];
  const stampCount = Number(card?.stamp_count || card?.current_stamps || 0);
  const stampsRequired = Number(template?.stamps_required || 10);
  const streakCount = Number(card?.streak_count || card?.current_streak || 0);
  const streakGoal = Number(template?.streak_goal || settings.streakGoal || 0);
  const balanceCents = Number(card?.balance_cents ?? card?.metadata?.balance_cents ?? 0);
  const currency = card?.currency || settings.currency || 'CHF';
  const cloakroomActive = Boolean(card?.cloakroom_active ?? card?.metadata?.cloakroom_active);

  if (normalizeTemplateType(template) === 'club_card') {
    if (featureEnabled(template, 'membership')) {
      rows.push({
        feature: 'membership',
        label: card?.metadata?.membership_number || card?.membership_number ? 'Mitgliedsnummer' : featureLabel('membership'),
        value: card?.metadata?.membership_number
          || card?.membership_number
          || card?.metadata?.membership_status
          || card?.membership_status
          || settings.membershipStatus
          || 'Aktiv',
        iconText: 'M'
      });
    }

    if (featureEnabled(template, 'vip')) {
      rows.push({
        feature: 'vip',
        label: featureLabel('vip'),
        value: card?.vip_status || card?.vip_level || template?.vip_tier || settings.membershipStatus || 'Member',
        iconText: 'VIP'
      });
    }

    if (featureEnabled(template, 'balance')) {
      rows.push({
        feature: 'balance',
        label: featureLabel('balance'),
        value: `${(balanceCents / 100).toFixed(2)} ${currency}`,
        iconText: currency
      });
    }

    if (featureEnabled(template, 'membership')) {
      const membershipExpiresAt = card?.metadata?.membership_expires_at || card?.membership_expires_at || settings.membershipExpiresAt || '';

      rows.push({
        feature: 'membership_expiry',
        label: 'Mitgliedsstatus',
        value: [
          card?.metadata?.membership_status || card?.membership_status || settings.membershipStatus || 'Aktiv',
          membershipExpiresAt ? `bis ${membershipExpiresAt}` : ''
        ].filter(Boolean).join(' '),
        iconText: 'M'
      });
    }

    if (featureEnabled(template, 'redemption')) {
      rows.push({
        feature: 'redemption',
        label: settings.couponTitle || 'Coupon',
        value: card?.coupon_status
          || card?.metadata?.coupon_status
          || (card?.status === 'redeemed' ? 'Eingelöst' : settings.discountValue || 'Offen'),
        iconText: '%'
      });
    }

    if (featureEnabled(template, 'cloakroom')) {
      rows.push({
        feature: 'cloakroom',
        label: featureLabel('cloakroom'),
        value: cloakroomActive ? 'Aktiv' : 'Bereit',
        iconText: 'G'
      });
    }

    if (featureEnabled(template, 'customFields') && settings.customFieldsText) {
      rows.push({
        feature: 'customFields',
        label: featureLabel('customFields'),
        value: String(settings.customFieldsText).split('\n').map((line) => line.trim()).filter(Boolean)[0] || 'Info',
        iconText: 'I'
      });
    }

    return rows;
  }

  if (featureEnabled(template, 'stamps')) {
    rows.push({
      feature: 'stamps',
      label: featureLabel('stamps'),
      value: `${stampCount}/${stampsRequired}`,
      iconText: 'ST'
    });
  }

  if (featureEnabled(template, 'streak')) {
    rows.push({
      feature: 'streak',
      label: featureLabel('streak'),
      value: streakGoal ? `${streakCount}/${streakGoal}` : String(streakCount),
      iconText: 'SR'
    });
  }

  if (featureEnabled(template, 'vip')) {
    rows.push({
      feature: 'vip',
      label: featureLabel('vip'),
      value: card?.vip_status || card?.vip_level || template?.vip_tier || settings.membershipStatus || 'Member',
      iconText: 'VIP'
    });
  }

  if (featureEnabled(template, 'balance')) {
    rows.push({
      feature: 'balance',
      label: featureLabel('balance'),
      value: `${(balanceCents / 100).toFixed(2)} ${currency}`,
      iconText: currency
    });
  }

  if (featureEnabled(template, 'cloakroom')) {
    rows.push({
      feature: 'cloakroom',
      label: featureLabel('cloakroom'),
      value: cloakroomActive ? 'Aktiv' : 'Bereit',
      iconText: 'G'
    });
  }

  if (featureEnabled(template, 'visit')) {
    rows.push({
      feature: 'visit',
      label: featureLabel('visit'),
      value: String(Number(card?.metadata?.visit_count || 0)),
      iconText: 'B'
    });
  }

  if (featureEnabled(template, 'checkin')) {
    rows.push({
      feature: 'checkin',
      label: settings.eventName || featureLabel('checkin'),
      value: [settings.eventDate, settings.eventStartTime].filter(Boolean).join(' ') || 'Offen',
      iconText: 'IN'
    });
  }

  if (featureEnabled(template, 'redemption')) {
    rows.push({
      feature: 'redemption',
      label: settings.couponTitle || featureLabel('redemption'),
      value: card?.status === 'redeemed' ? 'Eingelöst' : settings.discountValue || 'Offen',
      iconText: '%'
    });
  }

  if (featureEnabled(template, 'membership')) {
    rows.push({
      feature: 'membership',
      label: featureLabel('membership'),
      value: card?.metadata?.membership_status || settings.membershipStatus || 'Aktiv',
      iconText: 'M'
    });
  }

  if (featureEnabled(template, 'customFields') && settings.customFieldsText) {
    rows.push({
      feature: 'customFields',
      label: featureLabel('customFields'),
      value: String(settings.customFieldsText).split('\n').map((line) => line.trim()).filter(Boolean)[0] || 'Info',
      iconText: 'I'
    });
  }

  return rows;
}

export function allowedScannerActions(template) {
  return Object.entries(SCANNER_ACTIONS)
    .filter(([, config]) => featureEnabled(template, config.feature))
    .map(([action, config]) => ({ action, ...config }));
}

export function normalizeScannerAction(action) {
  const rawAction = String(action || '');
  return SCANNER_ACTION_ALIASES[rawAction] || rawAction;
}

export function validateScannerAction(template, action) {
  const normalizedAction = normalizeScannerAction(action);
  const config = SCANNER_ACTIONS[normalizedAction];

  if (!config) {
    return {
      allowed: false,
      error_code: 'UNKNOWN_ACTION',
      error_message: 'Unbekannte Scanner-Aktion.',
      error_reason: 'Diese Aktion ist in der Feature-Matrix nicht definiert.'
    };
  }

  if (featureEnabled(template, config.feature)) {
    return {
      allowed: true,
      action: normalizedAction,
      requested_action: String(action || ''),
      feature: config.feature
    };
  }

  if (normalizeTemplateType(template) === 'club_card' && CLUB_FEATURE_BY_MATRIX_FEATURE[config.feature]) {
    return {
      allowed: false,
      ...clubFeatureError(config.feature)
    };
  }

  return {
    allowed: false,
    error_code: 'ACTION_NOT_ALLOWED_FOR_TEMPLATE',
    error_message: 'Aktion nicht erlaubt für diesen Kartentyp.',
    error_reason: config.blockedReason
  };
}
