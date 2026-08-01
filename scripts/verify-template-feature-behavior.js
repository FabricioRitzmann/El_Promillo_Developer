import {
  activeFeatureLabels,
  cardFeatureRows,
  featureEnabled,
  normalizeScannerAction,
  scannerAccessHighlights,
  validateScannerAction
} from '../public/js/templateFeatures.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertAllowed(template, action, expectedAction = action) {
  const result = validateScannerAction(template, action);

  assert(result.allowed, `${action} sollte erlaubt sein.`);
  assert(result.action === expectedAction, `${action} sollte als ${expectedAction} normalisiert werden, erhielt ${result.action}.`);
}

function assertBlocked(template, action, expectedCode = 'ACTION_NOT_ALLOWED_FOR_TEMPLATE') {
  const result = validateScannerAction(template, action);

  assert(!result.allowed, `${action} sollte blockiert werden.`);
  assert(result.error_code === expectedCode, `${action} sollte ${expectedCode} liefern, erhielt ${result.error_code}.`);
}

const stampTemplate = { template_type: 'stamp_card', settings: {} };
const streakTemplate = { template_type: 'streak_card', settings: {} };
const balanceTemplate = { template_type: 'balance_card', settings: {} };
const genericTemplate = { template_type: 'generic_card', settings: {} };
const genericBalanceTemplate = {
  template_type: 'generic_card',
  settings: {
    enabledFeatures: ['balance']
  }
};
const genericCloakroomTemplate = {
  template_type: 'generic_card',
  settings: {
    features: {
      cloakroom: true
    }
  }
};
const vipTemplate = { template_type: 'vip_card', settings: {} };
const vipBalanceTemplate = {
  template_type: 'vip_card',
  settings: {
    balanceEnabled: true
  }
};
const membershipTemplate = { template_type: 'membership_card', settings: {} };
const membershipVipTemplate = {
  template_type: 'membership_card',
  settings: {
    enabledFeatures: ['vip']
  }
};
const eventTemplate = {
  template_type: 'event_card',
  settings: {
    eventName: 'Launch',
    eventDate: '2026-07-01'
  }
};
const couponTemplate = {
  template_type: 'coupon_card',
  settings: {
    couponTitle: 'Sommer-Rabatt',
    discountValue: '20%'
  }
};
const genericCustomFieldsTemplate = {
  template_type: 'generic_card',
  settings: {
    customFieldsText: 'Lieblingsplatz: Fenster'
  }
};
const stampCustomFieldsTemplate = {
  template_type: 'stamp_card',
  settings: {
    customFieldsText: 'Darf nicht sichtbar sein'
  }
};
const notificationsDisabledTemplate = {
  template_type: 'stamp_card',
  settings: {
    notificationsEnabled: false
  }
};
const notificationsDisabledViaFeaturesTemplate = {
  template_type: 'generic_card',
  settings: {
    features: {
      notifications: false
    }
  }
};
const clubEmptyTemplate = {
  template_type: 'club_card',
  club_features: {
    vip: false,
    balance: false,
    cloakroom: false,
    coupon: false,
    membership: false
  },
  settings: {}
};
const clubVipTemplate = {
  template_type: 'club_card',
  club_features: {
    vip: true,
    balance: false,
    cloakroom: false,
    coupon: false,
    membership: false
  },
  settings: {}
};
const clubAllTemplate = {
  template_type: 'club_card',
  vip_tier: 'Gold',
  club_features: {
    vip: true,
    balance: true,
    cloakroom: true,
    coupon: true,
    membership: true
  },
  settings: {
    currency: 'CHF',
    couponTitle: 'Welcome Coupon',
    membershipStatus: 'aktiv',
    membershipExpiresAt: '2026-12-31'
  }
};

assert(featureEnabled(stampTemplate, 'stamps'), 'Stempelkarte muss Stempel erlauben.');
assert(!featureEnabled(stampTemplate, 'streak'), 'Stempelkarte darf Streak nicht erlauben.');
assert(!featureEnabled(stampTemplate, 'cloakroom'), 'Optionale Garderobe darf ohne Aktivierung nicht aktiv sein.');
assert(featureEnabled({ template_type: 'stamp_card', settings: { enabledFeatures: ['cloakroom'] } }, 'cloakroom'), 'Optionale Garderobe muss per enabledFeatures aktivierbar sein.');

assert(!featureEnabled(genericTemplate, 'balance'), 'Generische Karte darf Balance ohne Aktivierung nicht erlauben.');
assert(featureEnabled(genericBalanceTemplate, 'balance'), 'Generische Karte muss Balance als Zusatzfeature erlauben.');
assert(featureEnabled(genericCloakroomTemplate, 'cloakroom'), 'Generische Karte muss Garderobe per settings.features erlauben.');
assert(featureEnabled(vipBalanceTemplate, 'balance'), 'VIP-Karte muss Balance per balanceEnabled erlauben.');
assert(!featureEnabled(membershipTemplate, 'vip'), 'Mitgliedskarte darf VIP ohne Aktivierung nicht erlauben.');
assert(featureEnabled(membershipVipTemplate, 'vip'), 'Mitgliedskarte muss VIP optional erlauben.');
assert(featureEnabled(stampTemplate, 'notifications'), 'Benachrichtigungen müssen ohne explizites Opt-out aktiv bleiben.');
assert(!featureEnabled(notificationsDisabledTemplate, 'notifications'), 'notificationsEnabled=false muss Wallet-Benachrichtigungen deaktivieren.');
assert(!featureEnabled(notificationsDisabledViaFeaturesTemplate, 'notifications'), 'settings.features.notifications=false muss Wallet-Benachrichtigungen deaktivieren.');
assert(!featureEnabled(clubEmptyTemplate, 'vip'), 'Clubkarte darf VIP standardmässig nicht aktivieren.');
assert(!featureEnabled(clubEmptyTemplate, 'balance'), 'Clubkarte darf Guthaben standardmässig nicht aktivieren.');
assert(!featureEnabled(clubEmptyTemplate, 'cloakroom'), 'Clubkarte darf Garderobe standardmässig nicht aktivieren.');
assert(!featureEnabled(clubEmptyTemplate, 'redemption'), 'Clubkarte darf Coupon standardmässig nicht aktivieren.');
assert(!featureEnabled(clubEmptyTemplate, 'membership'), 'Clubkarte darf Mitgliedschaft standardmässig nicht aktivieren.');
assert(featureEnabled(clubEmptyTemplate, 'visit'), 'Clubkarte ohne Zusatzfeatures muss Besuch erfassen erlauben.');
assert(featureEnabled(clubVipTemplate, 'vip'), 'Clubkarte muss VIP über club_features.vip aktivieren.');
assert(!featureEnabled(clubVipTemplate, 'balance'), 'Clubkarte mit VIP darf Guthaben nicht automatisch aktivieren.');

assert(normalizeScannerAction('add_stamp') === 'stamp-plus', 'add_stamp muss zu stamp-plus normalisiert werden.');
assert(normalizeScannerAction('increment_streak') === 'streak-plus', 'increment_streak muss zu streak-plus normalisiert werden.');
assert(normalizeScannerAction('redeem_balance') === 'balance-redeem', 'redeem_balance muss zu balance-redeem normalisiert werden.');
assert(normalizeScannerAction('mark_stamp_card_redeemed') === 'stamp-redeem', 'mark_stamp_card_redeemed muss zu stamp-redeem normalisiert werden.');
assert(normalizeScannerAction('fulfill_streak_goal') === 'streak-complete', 'fulfill_streak_goal muss zu streak-complete normalisiert werden.');
assert(normalizeScannerAction('redeem_vip_benefit') === 'vip-benefit-redeem', 'redeem_vip_benefit muss zu vip-benefit-redeem normalisiert werden.');
assert(normalizeScannerAction('update_membership_status') === 'membership-status-update', 'update_membership_status muss zu membership-status-update normalisiert werden.');
assert(normalizeScannerAction('renew_membership') === 'membership-extend', 'renew_membership muss zu membership-extend normalisiert werden.');
assert(normalizeScannerAction('manual_adjust_balance') === 'balance-adjust', 'manual_adjust_balance muss zu balance-adjust normalisiert werden.');
assert(normalizeScannerAction('event_checkout') === 'event-checkout', 'event_checkout muss zu event-checkout normalisiert werden.');
assert(normalizeScannerAction('mark_event_ticket_used') === 'event-ticket-use', 'mark_event_ticket_used muss zu event-ticket-use normalisiert werden.');

assertAllowed(stampTemplate, 'add_stamp', 'stamp-plus');
assertAllowed(stampTemplate, 'mark_stamp_card_redeemed', 'stamp-redeem');
assertBlocked(stampTemplate, 'increment_streak');
assertBlocked(stampTemplate, 'fulfill_streak_goal');
assertAllowed(streakTemplate, 'increment_streak', 'streak-plus');
assertAllowed(streakTemplate, 'fulfill_streak_goal', 'streak-complete');
assertBlocked(balanceTemplate, 'add_stamp');
assertBlocked(balanceTemplate, 'mark_stamp_card_redeemed');
assertAllowed(balanceTemplate, 'redeem_balance', 'balance-redeem');
assertAllowed(balanceTemplate, 'manual_adjust_balance', 'balance-adjust');
assertBlocked(genericTemplate, 'redeem_balance');
assertBlocked(genericTemplate, 'manual_adjust_balance');
assertAllowed(genericBalanceTemplate, 'redeem_balance', 'balance-redeem');
assertAllowed(genericBalanceTemplate, 'manual_adjust_balance', 'balance-adjust');
assertBlocked(clubEmptyTemplate, 'redeem_balance', 'FEATURE_NOT_ENABLED');
assertBlocked(clubEmptyTemplate, 'redeem_coupon', 'FEATURE_NOT_ENABLED');
assertAllowed(clubVipTemplate, 'redeem_vip_benefit', 'vip-benefit-redeem');
assertAllowed(vipTemplate, 'record_visit', 'visit');
assertAllowed(vipTemplate, 'redeem_vip_benefit', 'vip-benefit-redeem');
assertBlocked(stampTemplate, 'redeem_vip_benefit');
assertAllowed(membershipTemplate, 'membership_check', 'membership-check');
assertAllowed(membershipTemplate, 'update_membership_status', 'membership-status-update');
assertAllowed(membershipTemplate, 'renew_membership', 'membership-extend');
assertBlocked(stampTemplate, 'renew_membership');
assertAllowed(eventTemplate, 'check_in', 'checkin');
assertAllowed(eventTemplate, 'event_checkout', 'event-checkout');
assertAllowed(eventTemplate, 'mark_event_ticket_used', 'event-ticket-use');
assertBlocked(stampTemplate, 'event_checkout');
assertBlocked(genericTemplate, 'mark_event_ticket_used');

assert(
  activeFeatureLabels(genericTemplate).join(', ') === 'Besuch',
  'Generische Basiskarte muss als aktive operative Funktion Besuch ausweisen.'
);
assert(
  activeFeatureLabels(genericBalanceTemplate).includes('Guthaben'),
  'Generische Karte mit Zusatz-Balance muss Guthaben in aktiven Features zeigen.'
);
assert(
  cardFeatureRows(eventTemplate).some((row) => row.feature === 'checkin' && row.label === 'Launch'),
  'Eventkarte muss Check-in als sichtbare Feature-Zeile aus der Matrix liefern.'
);
assert(
  cardFeatureRows(couponTemplate).some((row) => row.feature === 'redemption' && row.value === '20%'),
  'Couponkarte muss Einlösung als sichtbare Feature-Zeile aus der Matrix liefern.'
);
assert(
  cardFeatureRows(membershipTemplate).some((row) => row.feature === 'membership'),
  'Mitgliedskarte muss Mitgliedschaft als sichtbare Feature-Zeile aus der Matrix liefern.'
);
assert(
  cardFeatureRows(genericBalanceTemplate).some((row) => row.feature === 'balance'),
  'Generische Karte mit Zusatz-Balance muss Guthaben in der Wallet-Anzeige zeigen.'
);
assert(
  cardFeatureRows(genericCustomFieldsTemplate).some((row) => row.feature === 'customFields'),
  'Generische Karte muss erlaubte Freifelder in der Wallet-Anzeige zeigen können.'
);
assert(
  !cardFeatureRows(stampCustomFieldsTemplate).some((row) => row.feature === 'customFields'),
  'Stempelkarte darf Freifelder nicht in der Wallet-Anzeige zeigen.'
);
assert(
  cardFeatureRows(clubEmptyTemplate).length === 0,
  'Clubkarte ohne Zusatzfeatures darf keine Club-Felder in der Wallet-Anzeige zeigen.'
);
assert(
  cardFeatureRows(clubAllTemplate, {
    card_instance_number: 'CI-CLUB',
    vip_status: 'Gold',
    balance_cents: 5000,
    currency: 'CHF',
    cloakroom_active: true,
    metadata: {
      membership_number: 'M-100',
      membership_status: 'aktiv',
      membership_expires_at: '2026-12-31',
      coupon_status: 'unused'
    }
  }).map((row) => row.feature).join(',') === 'membership,vip,balance,membership_expiry,redemption,cloakroom',
  'Clubkarte mit allen Features muss Wallet-Felder nach der Club-Priorität sortieren.'
);

const accessHighlights = scannerAccessHighlights(clubAllTemplate, {
  vip_status: 'Platin',
  metadata: { membership_number: 'M-100', membership_status: 'aktiv', membership_expires_at: '2026-12-31', membership_benefits: 'Freier Eintritt, Welcome Drink' }
});
assert(accessHighlights.map((highlight) => `${highlight.feature}:${highlight.value}`).join(',') === 'vip:Platin,membership:aktiv', 'Scanner-Eintrittshinweis muss VIP-Stufe und Mitgliedsstatus hervorheben.');
assert(accessHighlights[1].details.includes('Mitgliedsnummer: M-100') && accessHighlights[1].details.includes('Freier Eintritt') && accessHighlights[1].details.includes('Welcome Drink'), 'Scanner-Eintrittshinweis muss Mitgliedsnummer und Vorteile anzeigen.');

console.log('Template-Feature-Verhalten für optionale Features und Scanner-Aliase ist korrekt.');
