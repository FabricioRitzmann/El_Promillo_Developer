import { requireLogin } from './guards.js';
import { appUrl, apiUrl } from './config.js';
import { pagePath } from './path.js';
import { imageFileToPngUnderLimit } from './imageUploadOptimizer.js';
import { sampleImageColorFromPointer } from './logoColorPicker.js';
import { byId, escapeHtml, renderBusinessHeader, showMessage, walletPreviewHtml } from './ui.js';
import {
  CLUB_FEATURE_DEFAULTS,
  OPTIONAL_FEATURE,
  clubFeatures,
  featureEnabled,
  featureLabel,
  featureValue,
  getTemplateFeatures,
  legacyCardTypeForTemplateType,
  normalizeTemplateType,
  templateFeatureSummary,
  templateSettings
} from './templateFeatures.js';

const state = {
  client: null,
  session: null,
  profile: null,
  business: null,
  templateId: new URLSearchParams(window.location.search).get('template'),
  template: null,
  notificationTemplates: [],
  optionalFeatureSelections: {},
  walletNotificationIdempotency: null,
  editorLogoColorPicking: false
};

const businessEditorLegacySelect = [
  'id',
  'owner_id',
  'name',
  'description',
  'address',
  'location_lat',
  'location_lng',
  'phone',
  'website',
  'logo_url',
  'company_logo_path',
  'company_logo_updated_at',
  'created_at',
  'updated_at'
].join(',');

const businessEditorSelect = [
  businessEditorLegacySelect,
  'company_logo_original_url',
  'company_logo_processed_url',
  'company_logo_background_mode'
].join(',');

const templateEditorSelect = [
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

const editorMessage = byId('editorMessage');
const templateForm = byId('templateForm');
const templateType = byId('templateType');
const editorPreview = byId('editorPreview');
const editorPageTitle = byId('editorPageTitle');
const editorModeTitle = byId('editorModeTitle');
const editorModeText = byId('editorModeText');
const templateSubmitButton = byId('templateSubmitButton');
const stampIconUpload = byId('stampIconUpload');
const streakIconUpload = byId('streakIconUpload');
const eventAppleBackgroundUpload = byId('eventAppleBackgroundUpload');
const eventGoogleHeroImageUpload = byId('eventGoogleHeroImageUpload');
const editorQrPanel = byId('editorQrPanel');
const editorQrHint = byId('editorQrHint');
const editorQrImage = byId('editorQrImage');
const editorClaimUrl = byId('editorClaimUrl');
const editorPdfA4 = byId('editorPdfA4');
const editorPdfA5 = byId('editorPdfA5');
const editorFeatureSummary = byId('editorFeatureSummary');
const optionalFeaturePanel = byId('optionalFeaturePanel');
const optionalFeatureToggles = byId('optionalFeatureToggles');
const clubFeatureSpaceWarning = byId('clubFeatureSpaceWarning');
const editorLogoColorPickerButton = byId('editorLogoColorPickerButton');
const editorLogoColorPickerPanel = byId('editorLogoColorPickerPanel');
const editorLogoColorPickerImage = byId('editorLogoColorPickerImage');
const walletNotificationsPanel = byId('walletNotificationsPanel');
const walletNotificationForm = byId('walletNotificationForm');
const walletNotificationMessage = byId('walletNotificationMessage');
const walletNotificationTemplate = byId('walletNotificationTemplate');
const walletNotificationTarget = byId('walletNotificationTarget');
const walletNotificationTargetFilters = byId('walletNotificationTargetFilters');
const walletNotificationTemplateLabel = byId('walletNotificationTemplateLabel');
const walletNotificationSendType = byId('walletNotificationSendType');
const walletNotificationScheduledAtField = byId('walletNotificationScheduledAtField');
const walletNotificationLocationFields = byId('walletNotificationLocationFields');
const walletNotificationRuleSummary = byId('walletNotificationRuleSummary');
const walletNotificationLimitWarnings = byId('walletNotificationLimitWarnings');
const appleNotificationPreviewTitle = byId('appleNotificationPreviewTitle');
const appleNotificationPreviewText = byId('appleNotificationPreviewText');
const googleNotificationPreviewTitle = byId('googleNotificationPreviewTitle');
const googleNotificationPreviewText = byId('googleNotificationPreviewText');
const walletReachableCount = byId('walletReachableCount');
const walletUnreachableCount = byId('walletUnreachableCount');
const walletAppleCount = byId('walletAppleCount');
const walletGoogleCount = byId('walletGoogleCount');
const walletLimitedCount = byId('walletLimitedCount');
const walletAppleUnregisteredCount = byId('walletAppleUnregisteredCount');
const walletNotificationHistory = byId('walletNotificationHistory');
const assetBucket = 'wallet-assets';
const maxAssetFileBytes = 2 * 1024 * 1024;
const maxAssetSourceFileBytes = 25 * 1024 * 1024;
const assetUploadFrames = {
  'event-apple-background': { width: 1000, height: 1500, backgroundColor: '#fffaf2' },
  'event-google-hero': { width: 1200, height: 400, backgroundColor: '#fffaf2' },
  'stamp-icon': { width: 512, height: 512, backgroundColor: 'transparent' },
  'streak-icon': { width: 512, height: 512, backgroundColor: 'transparent' }
};

function templateClaimUrl() {
  const claimToken = String(state.template?.public_claim_token || '').trim();

  return claimToken
    ? appUrl(`/claim.html?token=${encodeURIComponent(claimToken)}`)
    : appUrl(`/claim.html?template=${encodeURIComponent(state.templateId)}`);
}
const retiredEditorTemplateTypes = new Set([
  'vip_card',
  'balance_card',
  'cloakroom_card',
  'coupon_card',
  'membership_card'
]);
const clubFeatureMatrixMapping = {
  vip: 'vip',
  balance: 'balance',
  cloakroom: 'cloakroom',
  coupon: 'redemption',
  membership: 'membership'
};
const optionalFeatureInputNames = {
  vip: 'vip_enabled',
  balance: 'balance_enabled',
  cloakroom: 'cloakroom_enabled',
  redemption: 'redemption_enabled',
  membership: 'membership_enabled'
};
const visibleOptionalFeatureInputNamePrefix = 'editor_optional_feature_';
const managedOptionalFeatureNames = Object.keys(optionalFeatureInputNames);
const lockedEditorTemplateTypes = new Set(['event_card']);
const lockedEditorFeatures = new Set(['balance']);
const defaultWalletBackgroundColor = '#fffaf2';
const defaultWalletTextColor = '#5b3423';
const walletNotificationCampaignHistorySelect = [
  'id',
  'business_id',
  'template_id',
  'title',
  'message',
  'target_type',
  'send_type',
  'scheduled_at',
  'location_lat',
  'location_lng',
  'location_radius_m',
  'status',
  'created_at',
  'sent_at'
].join(',');
let reachabilityRefreshTimer = null;

function setTemplateField(name, value) {
  const field = templateForm?.querySelector(`[name="${name}"]`);

  if (field) {
    if (field.type === 'checkbox') {
      field.checked = Boolean(value);
      return;
    }

    field.value = value ?? '';
  }
}

function setOptionalFeatureSelection(featureName, checked) {
  const preservedLockedSelection = lockedEditorFeatures.has(featureName)
    ? Boolean(state.templateId && state.template && featureEnabled(state.template, featureName))
    : Boolean(checked);
  state.optionalFeatureSelections[featureName] = preservedLockedSelection;
  const fieldName = optionalFeatureInputNames[featureName] || `${featureName}_enabled`;

  templateForm?.querySelectorAll(`[name="${fieldName}"], [data-editor-optional-feature="${featureName}"]`).forEach((field) => {
    if (field.type === 'checkbox') {
      field.checked = preservedLockedSelection;
    }
  });
}

function readOptionalFeatureSelection(formData, featureName) {
  if (lockedEditorFeatures.has(featureName)) {
    return Boolean(state.templateId && state.template && featureEnabled(state.template, featureName));
  }

  if (Object.prototype.hasOwnProperty.call(state.optionalFeatureSelections, featureName)) {
    return Boolean(state.optionalFeatureSelections[featureName]);
  }

  const fieldName = optionalFeatureInputNames[featureName] || `${featureName}_enabled`;

  return formData.get(`${visibleOptionalFeatureInputNamePrefix}${featureName}`) === 'on'
    || formData.get(fieldName) === 'on';
}

function syncOptionalFeatureSelectionsFromTemplate(template) {
  state.optionalFeatureSelections = Object.fromEntries(
    managedOptionalFeatureNames.map((featureName) => [
      featureName,
      featureEnabled(template, featureName)
    ])
  );
}

function isRetiredEditorTemplateType(templateOrType) {
  return retiredEditorTemplateTypes.has(normalizeTemplateType(templateOrType));
}

function clubFeaturesFromRetiredTemplate(template) {
  return Object.fromEntries(
    Object.entries(clubFeatureMatrixMapping)
      .map(([clubFeatureName, matrixFeatureName]) => [
        clubFeatureName,
        featureEnabled(template, matrixFeatureName)
      ])
  );
}

function editableTemplateForEditor(template) {
  const templateType = normalizeTemplateType(template);

  if (!isRetiredEditorTemplateType(templateType)) {
    return template;
  }

  const settings = templateSettings(template);
  const mappedClubFeatures = {
    ...CLUB_FEATURE_DEFAULTS,
    ...clubFeaturesFromRetiredTemplate(template)
  };

  return {
    ...template,
    template_type: 'club_card',
    card_type: 'generic',
    club_features: mappedClubFeatures,
    club_settings: {
      ...(template.club_settings || {}),
      migratedFromTemplateType: templateType
    },
    settings: {
      ...settings,
      club_features: mappedClubFeatures,
      migratedFromTemplateType: templateType
    }
  };
}

function amountToCents(value) {
  const amount = Number(String(value || '').replace(',', '.'));

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Math.round(amount * 100);
}

function optionalAmountToCents(value) {
  const rawValue = String(value ?? '').trim();

  if (!rawValue) {
    return null;
  }

  const amount = Number(rawValue.replace(',', '.'));

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return Math.round(amount * 100);
}

function centsToAmount(cents, fallback = '') {
  const numericCents = Number(cents);

  if (!Number.isFinite(numericCents) || numericCents <= 0) {
    return fallback;
  }

  return (numericCents / 100).toFixed(2);
}

function numberOrNull(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return null;
  }

  const numberValue = Number(normalizedValue.replace(',', '.'));

  return Number.isFinite(numberValue) ? numberValue : null;
}

function templateSupportsReward(templateOrType) {
  return featureValue(templateOrType, 'stamps') === true
    || featureValue(templateOrType, 'streak') === true;
}

function updateEditorModeUi() {
  const isEditing = Boolean(state.templateId);
  const title = isEditing ? 'Karte bearbeiten' : 'Neue Karte erstellen';

  if (editorPageTitle) {
    editorPageTitle.textContent = title;
  }

  if (editorModeTitle) {
    editorModeTitle.textContent = title;
  }

  if (editorModeText) {
    editorModeText.textContent = isEditing
      ? 'Aenderungen werden am bestehenden Template gespeichert. Der QR-Code bleibt gleich.'
      : 'Erstelle hier ein neues Karten-Template. Danach erscheint es in der Dashboard-Übersicht.';
  }

  if (templateSubmitButton) {
    templateSubmitButton.textContent = isEditing ? 'Aenderungen speichern' : 'Template speichern';
  }
}

function syncDefaultsFromBusiness() {
  if (!templateForm) {
    return;
  }

  if (!templateForm.business_name.value && state.business?.name) {
    templateForm.business_name.value = state.business.name;
  }

}

function toggleEditorLogoColorPicker() {
  const logoUrl = String(state.business?.logo_url || '').trim();

  if (!logoUrl || !editorLogoColorPickerPanel || !editorLogoColorPickerImage) {
    showMessage(editorMessage, 'Bitte zuerst im Konto ein Firmenlogo hochladen.', 'info');
    return;
  }

  const willOpen = editorLogoColorPickerPanel.hidden;
  editorLogoColorPickerPanel.hidden = !willOpen;
  state.editorLogoColorPicking = willOpen;
  editorLogoColorPickerPanel.classList.toggle('is-color-picking', willOpen);
  editorLogoColorPickerButton?.setAttribute('aria-pressed', willOpen ? 'true' : 'false');

  if (willOpen) {
    editorLogoColorPickerImage.crossOrigin = 'anonymous';
    editorLogoColorPickerImage.src = logoUrl;
  }
}

function pickEditorLogoColor(event) {
  if (!state.editorLogoColorPicking || !editorLogoColorPickerImage?.complete || !editorLogoColorPickerImage.naturalWidth) {
    return;
  }

  const result = sampleImageColorFromPointer(editorLogoColorPickerImage, event, {
    errorMessage: 'Die Farbpipette ist in diesem Browser nicht verfügbar.',
    corsMessage: 'Die Logo-Farbe kann wegen der Bildfreigabe nicht gelesen werden.'
  });

  if (result.outsideImage) {
    showMessage(editorMessage, 'Bitte direkt auf den sichtbaren Bildbereich tippen.', 'info');
    return;
  }

  if (!result.color) {
    showMessage(editorMessage, 'An dieser Stelle ist das Logo transparent. Es wurde keine Farbe übernommen.', 'info');
    return;
  }

  setTemplateField('primary_color', result.color.hex);
  state.editorLogoColorPicking = false;
  editorLogoColorPickerPanel.classList.remove('is-color-picking');
  editorLogoColorPickerPanel.hidden = true;
  editorLogoColorPickerButton?.setAttribute('aria-pressed', 'false');
  updateConditionalTemplateFields();
  showMessage(editorMessage, `Hauptfarbe ${result.color.hex} aus dem Firmenlogo übernommen.`, 'success');
}

function loadTemplateIntoForm(template) {
  const settings = templateSettings(template);
  const templateType = normalizeTemplateType(template);
  const activeClubFeatures = clubFeatures(template);

  syncOptionalFeatureSelectionsFromTemplate(template);

  setTemplateField('business_name', template.business_name || '');
  setTemplateField('card_name', template.card_name || '');
  setTemplateField('template_type', templateType);
  setTemplateField('description', template.description || '');
  setTemplateField('primary_color', template.primary_color || defaultWalletBackgroundColor);
  setTemplateField('text_color', template.text_color || defaultWalletTextColor);
  setTemplateField('reward_text', template.reward_text || '');
  setTemplateField('notifications_enabled', settings.notificationsEnabled !== false);
  setTemplateField('notification_message', settings.notificationMessage || '');
  setTemplateField('custom_fields_text', settings.customFieldsText || '');
  setTemplateField('stamps_required', template.stamps_required || 10);
  setTemplateField('streak_goal', template.streak_goal || settings.streakGoal || '');
  setTemplateField('streak_note', settings.streakNote || '');
  setTemplateField('vip_tier', template.vip_tier || '');
  setTemplateField('vip_level_names', settings.vipLevelNames || '');
  setTemplateField('vip_note', settings.vipNote || '');
  setTemplateField('stamp_icon_url', settings.stampIconUrl || '');
  setTemplateField('streak_icon_url', settings.streakIconUrl || '');
  setTemplateField('vip_enabled', templateType === 'club_card' ? activeClubFeatures.vip : settings.enabledFeatures?.includes('vip') || settings.vipEnabled || false);
  setTemplateField('balance_enabled', templateType === 'club_card' ? activeClubFeatures.balance : settings.enabledFeatures?.includes('balance') || settings.balanceEnabled || false);
  setTemplateField('cloakroom_enabled', templateType === 'club_card' ? activeClubFeatures.cloakroom : settings.enabledFeatures?.includes('cloakroom') || settings.cloakroomEnabled || false);
  setTemplateField('redemption_enabled', templateType === 'club_card' ? activeClubFeatures.coupon : settings.enabledFeatures?.includes('redemption') || settings.redemptionEnabled || false);
  setTemplateField('membership_enabled', templateType === 'club_card' ? activeClubFeatures.membership : settings.enabledFeatures?.includes('membership') || settings.membershipEnabled || false);
  setTemplateField('currency', settings.currency || 'CHF');
  setTemplateField('min_balance_amount', centsToAmount(settings.minTopupCents, settings.minBalanceAmount || ''));
  setTemplateField('max_balance_amount', centsToAmount(settings.maxTopupCents, settings.maxBalanceAmount || ''));
  setTemplateField('payment_note', settings.paymentNote || '');
  setTemplateField('cloakroom_noon_message', settings.cloakroomNoonMessage || '');
  setTemplateField('cloakroom_location_message', settings.cloakroomLocationMessage || '');
  setTemplateField('cloakroom_location_name', settings.cloakroomLocationName || '');
  setTemplateField('cloakroom_location_latitude', settings.cloakroomLocationLatitude ?? '');
  setTemplateField('cloakroom_location_longitude', settings.cloakroomLocationLongitude ?? '');
  setTemplateField('cloakroom_location_radius_meters', settings.cloakroomLocationRadiusMeters ?? '');
  setTemplateField('event_name', settings.eventName || '');
  setTemplateField('event_date', settings.eventDate || '');
  setTemplateField('event_start_time', settings.eventStartTime || '');
  setTemplateField('event_end_time', settings.eventEndTime || '');
  setTemplateField('event_location', settings.eventLocation || '');
  setTemplateField('event_apple_background_image_url', settings.eventAppleBackgroundImageUrl || settings.eventBackgroundImageUrl || '');
  setTemplateField('event_google_hero_image_url', settings.eventGoogleHeroImageUrl || settings.eventBackgroundImageUrl || '');
  setTemplateField('coupon_title', settings.couponTitle || '');
  setTemplateField('discount_value', settings.discountValue || '');
  setTemplateField('coupon_valid_until', settings.couponValidUntil || '');
  setTemplateField('redemption_terms', settings.redemptionTerms || '');
  setTemplateField('membership_status', settings.membershipStatus || '');
  setTemplateField('membership_expires_at', settings.membershipExpiresAt || '');
  setTemplateField('membership_benefits', settings.membershipBenefits || '');
}

function templateSettingsFromForm(formData, templateType) {
  const streakGoal = Number(formData.get('streak_goal') || 0);
  const minTopupCents = amountToCents(formData.get('min_balance_amount'));
  const maxTopupCents = amountToCents(formData.get('max_balance_amount'));
  const locationRadiusMeters = Math.max(0, Math.round(Number(formData.get('cloakroom_location_radius_meters') || 0))) || null;
  const enabledFeatures = Object.entries(getTemplateFeatures(templateType))
    .filter(([, value]) => value === OPTIONAL_FEATURE)
    .map(([featureName]) => featureName)
    .filter((featureName) => readOptionalFeatureSelection(formData, featureName));
  const clubFeatureState = {
    ...CLUB_FEATURE_DEFAULTS,
    vip: readOptionalFeatureSelection(formData, 'vip'),
    balance: readOptionalFeatureSelection(formData, 'balance'),
    cloakroom: readOptionalFeatureSelection(formData, 'cloakroom'),
    coupon: readOptionalFeatureSelection(formData, 'redemption'),
    membership: readOptionalFeatureSelection(formData, 'membership')
  };

  return {
    enabledFeatures,
    club_features: templateType === 'club_card' ? clubFeatureState : { ...CLUB_FEATURE_DEFAULTS },
    notificationsEnabled: formData.get('notifications_enabled') === 'on',
    notificationMessage: String(formData.get('notification_message') || '').trim(),
    customFieldsText: String(formData.get('custom_fields_text') || '').trim(),
    stampIconUrl: String(formData.get('stamp_icon_url') || '').trim(),
    streakIconUrl: String(formData.get('streak_icon_url') || '').trim(),
    streakGoal: streakGoal > 0 ? streakGoal : null,
    streakNote: formData.get('streak_note') || '',
    vipLevelNames: String(formData.get('vip_level_names') || '').trim(),
    vipNote: formData.get('vip_note') || '',
    currency: (String(formData.get('currency') || 'CHF').trim() || 'CHF').toUpperCase(),
    minBalanceAmount: String(formData.get('min_balance_amount') || '').trim(),
    maxBalanceAmount: String(formData.get('max_balance_amount') || '').trim(),
    minTopupCents,
    maxTopupCents,
    paymentNote: String(formData.get('payment_note') || '').trim(),
    cloakroomNoonMessage: String(formData.get('cloakroom_noon_message') || '').trim(),
    cloakroomLocationMessage: String(formData.get('cloakroom_location_message') || '').trim(),
    cloakroomLocationName: String(formData.get('cloakroom_location_name') || '').trim(),
    cloakroomLocationLatitude: numberOrNull(formData.get('cloakroom_location_latitude')),
    cloakroomLocationLongitude: numberOrNull(formData.get('cloakroom_location_longitude')),
    cloakroomLocationRadiusMeters: locationRadiusMeters,
    eventName: String(formData.get('event_name') || '').trim(),
    eventDate: String(formData.get('event_date') || '').trim(),
    eventStartTime: String(formData.get('event_start_time') || '').trim(),
    eventEndTime: String(formData.get('event_end_time') || '').trim(),
    eventLocation: String(formData.get('event_location') || '').trim(),
    eventAppleBackgroundImageUrl: templateType === 'event_card'
      ? String(formData.get('event_apple_background_image_url') || '').trim()
      : '',
    eventGoogleHeroImageUrl: templateType === 'event_card'
      ? String(formData.get('event_google_hero_image_url') || '').trim()
      : '',
    couponTitle: String(formData.get('coupon_title') || '').trim(),
    discountValue: String(formData.get('discount_value') || '').trim(),
    couponValidUntil: String(formData.get('coupon_valid_until') || '').trim(),
    redemptionTerms: String(formData.get('redemption_terms') || '').trim(),
    membershipStatus: String(formData.get('membership_status') || '').trim(),
    membershipExpiresAt: String(formData.get('membership_expires_at') || '').trim(),
    membershipBenefits: String(formData.get('membership_benefits') || '').trim()
  };
}

function templateDraftFromForm() {
  const formData = new FormData(templateForm);
  const templateType = normalizeTemplateType(String(formData.get('template_type') || 'generic_card'));
  const stampsRequired = Number(formData.get('stamps_required') || 10);
  const streakGoal = Number(formData.get('streak_goal') || 0);
  const settings = templateSettingsFromForm(formData, templateType);
  const clubFeatureState = templateType === 'club_card'
    ? settings.club_features
    : { ...CLUB_FEATURE_DEFAULTS };
  const rewardText = templateSupportsReward(templateType)
    ? String(formData.get('reward_text') || '').trim()
    : '';

  return {
    template_type: templateType,
    business_name: String(formData.get('business_name') || state.business?.name || 'Business').trim(),
    card_name: String(formData.get('card_name') || 'Neue Karte').trim(),
    card_type: legacyCardTypeForTemplateType(templateType),
    description: String(formData.get('description') || '').trim(),
    primary_color: formData.get('primary_color') || defaultWalletBackgroundColor,
    text_color: formData.get('text_color') || defaultWalletTextColor,
    logo_url: String(state.business?.logo_url || '').trim(),
    reward_text: rewardText,
    stamps_required: Math.max(1, stampsRequired || 10),
    streak_goal: streakGoal > 0 ? streakGoal : null,
    vip_tier: String(formData.get('vip_tier') || '').trim() || null,
    settings,
    club_features: clubFeatureState,
    club_settings: templateType === 'club_card' ? {
      enabledModules: Object.entries(clubFeatureState)
        .filter(([, enabled]) => enabled)
        .map(([featureName]) => featureName)
    } : {},
    is_active: true
  };
}

function renderEditorPreview() {
  if (!editorPreview || !templateForm) {
    return;
  }

  const draft = templateDraftFromForm();
  editorPreview.innerHTML = walletPreviewHtml({
    ...draft,
    business_name: state.business?.name || draft.business_name,
    business_logo_url: state.business?.logo_url || ''
  });
  renderEditorQrPanel();
}

function renderEditorQrPanel() {
  if (!editorQrPanel || !editorQrHint) {
    return;
  }

  if (!state.templateId) {
    editorQrPanel.hidden = true;
    editorQrHint.hidden = false;
    return;
  }

  const claimUrl = templateClaimUrl();
  const qrUrl = apiUrl(`/api/qrcode?text=${encodeURIComponent(claimUrl)}`);
  const pdfA4Url = apiUrl(`/api/templates/${encodeURIComponent(state.templateId)}/qr.pdf?format=a4`);
  const pdfA5Url = apiUrl(`/api/templates/${encodeURIComponent(state.templateId)}/qr.pdf?format=a5`);

  editorQrPanel.hidden = false;
  editorQrHint.hidden = true;

  if (editorQrImage) {
    editorQrImage.src = qrUrl;
  }

  if (editorClaimUrl) {
    editorClaimUrl.value = claimUrl;
  }

  if (editorPdfA4) {
    editorPdfA4.href = pdfA4Url;
  }

  if (editorPdfA5) {
    editorPdfA5.href = pdfA5Url;
  }

  if (editorFeatureSummary) {
    editorFeatureSummary.textContent = templateFeatureSummary(templateDraftFromForm());
  }
}

function walletNotificationTargetOptions(template) {
  const hasTemplate = Boolean(template?.id);
  const options = [
    ['all_active', hasTemplate ? 'Alle aktiven Karten dieses Templates' : 'Alle aktiven Karten'],
    ['platform_apple', hasTemplate ? 'Nur Apple Wallet dieses Templates' : 'Nur Apple Wallet'],
    ['platform_google', hasTemplate ? 'Nur Google Wallet dieses Templates' : 'Nur Google Wallet']
  ];

  if (!hasTemplate) {
    const allowedTargets = allowedWalletNotificationTargets();

    return allowedTargets.length
      ? options.filter(([value]) => allowedTargets.includes(value))
      : options;
  }

  options.splice(1, 0, ['template', 'Alle Karten dieses Templates']);

  if (featureEnabled(template, 'stamps')) {
    options.push(['stamp_count', 'Stempelkarten nach Stempelstand']);
  }

  if (featureEnabled(template, 'streak')) {
    options.push(['streak_count', 'Streakkarten nach Streak']);
  }

  if (featureEnabled(template, 'vip')) {
    options.push(['vip_level', 'VIP-Level']);
  }

  if (featureEnabled(template, 'balance')) {
    options.push(['balance_range', 'Guthabenbereich']);
  }

  if (featureEnabled(template, 'cloakroom')) {
    options.push(['cloakroom_open', 'Offene Garderobenabgaben']);
  }

  if (featureEnabled(template, 'checkin')) {
    options.push(['event', 'Eventkarten dieses Events']);
  }

  if (featureEnabled(template, 'redemption')) {
    options.push(['coupon_unredeemed', 'Nicht eingelöste Coupons']);
  }

  if (featureEnabled(template, 'membership')) {
    options.push(['membership_status', 'Mitgliedschaftsstatus']);
  }

  const allowedTargets = allowedWalletNotificationTargets();

  return allowedTargets.length
    ? options.filter(([value]) => allowedTargets.includes(value))
    : options;
}

function walletDeliveryRules() {
  return state.client?.config?.deliveryRules || {};
}

function allowedWalletNotificationTargets() {
  const configuredTargets = walletDeliveryRules().allowedTargets;

  return Array.isArray(configuredTargets)
    ? configuredTargets.map((target) => String(target).trim()).filter(Boolean)
    : [];
}

function positiveDeliveryRule(name, fallback) {
  const numeric = Number(walletDeliveryRules()[name]);

  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function updateWalletNotificationRuleSummary() {
  if (!walletNotificationRuleSummary) {
    return;
  }

  const businessLimit = positiveDeliveryRule('businessDailyLimit', 500);
  const customerLimit = positiveDeliveryRule('customerDailyLimit', 12);
  const cardLimit = positiveDeliveryRule('cardDailyLimit', 6);
  const googleLimit = positiveDeliveryRule('googleTextAndNotifyLimitPerPass24h', 3);
  const duplicateWindow = positiveDeliveryRule('duplicateWindowMinutes', 10);

  walletNotificationRuleSummary.textContent = `Limits: ${businessLimit} Nachrichten pro Business/24h, ${customerLimit} pro Kunde/24h, ${cardLimit} pro Karte/24h, Google TEXT_AND_NOTIFY ${googleLimit} pro Pass/24h. Identische Kampagnen werden ${duplicateWindow} Minuten dedupliziert. Apple zeigt Pushs nur als Pass-Update an, wenn das iPhone den Pass registriert hat.`;
}

function notificationField(name) {
  return walletNotificationForm?.elements?.namedItem(name) || null;
}

function businessLocationValue(name) {
  const value = state.business?.[name];

  return value == null || value === '' ? null : Number(value);
}

function formatLocationNumber(value) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return '';
  }

  return String(Math.round(numberValue * 1000000) / 1000000);
}

function applyBusinessLocationDefaults({ overwrite = false } = {}) {
  const latField = notificationField('location_lat');
  const lngField = notificationField('location_lng');
  const radiusField = notificationField('location_radius_m');
  const businessLat = businessLocationValue('location_lat');
  const businessLng = businessLocationValue('location_lng');

  if (latField && Number.isFinite(businessLat) && (overwrite || !String(latField.value || '').trim())) {
    latField.value = formatLocationNumber(businessLat);
  }

  if (lngField && Number.isFinite(businessLng) && (overwrite || !String(lngField.value || '').trim())) {
    lngField.value = formatLocationNumber(businessLng);
  }

  if (radiusField && !String(radiusField.value || '').trim()) {
    radiusField.value = '150';
  }
}

function setWalletNotificationFormDisabled(disabled) {
  if (!walletNotificationForm) {
    return;
  }

  walletNotificationForm.dataset.notificationsDisabled = disabled ? 'true' : 'false';
  walletNotificationForm.classList.toggle('is-disabled', disabled);

  walletNotificationForm.querySelectorAll('input, textarea, select, button').forEach((field) => {
    if (field === walletNotificationTemplate) {
      field.disabled = false;
      return;
    }

    field.disabled = disabled;
  });
}

function clearWalletNotificationMetrics() {
  [
    walletReachableCount,
    walletUnreachableCount,
    walletAppleCount,
    walletGoogleCount,
    walletLimitedCount,
    walletAppleUnregisteredCount
  ].forEach((element) => setMetricText(element, '-'));

  if (walletNotificationLimitWarnings) {
    walletNotificationLimitWarnings.hidden = true;
    walletNotificationLimitWarnings.innerHTML = '';
  }
}

function applyWalletNotificationDefaults() {
  const deliveryRules = walletDeliveryRules();
  const titleField = notificationField('title');
  const messageField = notificationField('message');
  const sendTypeField = notificationField('send_type');
  const defaultTitle = String(deliveryRules.defaultTitle || '').trim();
  const selectedTemplate = selectedNotificationTemplate();
  const sendType = String(sendTypeField?.value || notificationField('send_type')?.value || 'now');
  const targetType = String(notificationField('target_type')?.value || 'template');
  const templateDefaultMessage = walletNotificationTemplateDefaultMessage(selectedTemplate, sendType, targetType);
  const defaultMessage = templateDefaultMessage || String(deliveryRules.defaultMessage || '').trim();

  if (titleField) {
    titleField.placeholder = defaultTitle || 'Kurzer Wallet-Hinweis';

    if (!String(titleField.value || '').trim() && defaultTitle) {
      titleField.value = defaultTitle;
    }
  }

  if (messageField) {
    messageField.placeholder = defaultMessage || 'Text für Apple Wallet und Google Wallet';
    setAutofilledWalletNotificationMessage(messageField, defaultMessage);
  }

  if (sendTypeField?.value === 'location_based') {
    applyBusinessLocationDefaults();
  }

  updateWalletNotificationRuleSummary();
}

function selectedNotificationTemplateId() {
  if (walletNotificationTemplate) {
    return walletNotificationTemplate.value || '';
  }

  return state.templateId || '';
}

function selectedNotificationTemplate() {
  const selectedId = selectedNotificationTemplateId();

  if (!selectedId) {
    return null;
  }

  if (state.template?.id === selectedId) {
    return state.template;
  }

  return state.notificationTemplates.find((template) => template.id === selectedId) || state.template || null;
}

function walletNotificationTemplateDefaultMessage(template, sendType = '', targetType = '') {
  const settings = templateSettings(template || {});
  const textCandidates = [];

  if (sendType === 'location_based') {
    textCandidates.push(settings.cloakroomLocationMessage);
  }

  if (sendType === 'scheduled' && targetType === 'cloakroom_open') {
    textCandidates.push(settings.cloakroomNoonMessage);
  }

  textCandidates.push(
    settings.notificationMessage,
    settings.cloakroomNoonMessage,
    settings.cloakroomLocationMessage
  );

  return textCandidates
    .map((value) => String(value || '').trim())
    .find(Boolean) || '';
}

function setAutofilledWalletNotificationMessage(messageField, nextMessage) {
  if (!messageField || !nextMessage) {
    return;
  }

  const currentValue = String(messageField.value || '').trim();
  const previousAutofill = String(messageField.dataset.autofilledMessage || '').trim();

  if (!currentValue || (previousAutofill && currentValue === previousAutofill)) {
    messageField.value = nextMessage;
    messageField.dataset.autofilledMessage = nextMessage;
  }
}

function walletNotificationMessageFromForm(formData) {
  return String(formData.get('message') || '').trim();
}

async function callWalletNotificationFunction(functionName, payload) {
  const session = await state.client.ensureSession();

  if (!session) {
    throw new Error('Bitte erneut einloggen.');
  }

  const response = await fetch(`${state.client.supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: state.client.anonKey,
      Authorization: `Bearer ${session.access_token}`,
      'idempotency-key': payload.idempotencyKey || ''
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error_message || data.error || 'Wallet-Benachrichtigung fehlgeschlagen.');
  }

  return data;
}

function numberFilterValue(formData, name) {
  const rawValue = String(formData.get(name) ?? '').trim();

  if (!rawValue) {
    return null;
  }

  const numericValue = Number(rawValue);

  return Number.isFinite(numericValue) ? numericValue : null;
}

function dateFilterIso(formData, name, endOfDay = false) {
  const rawValue = String(formData.get(name) ?? '').trim();

  if (!rawValue) {
    return null;
  }

  const date = new Date(`${rawValue}T${endOfDay ? '23:59:59' : '00:00:00'}`);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function targetFilterFromForm(formData, targetType) {
  const filter = {};
  const min = numberFilterValue(formData, 'target_min');
  const max = numberFilterValue(formData, 'target_max');
  const minCents = optionalAmountToCents(formData.get('target_min_amount'));
  const maxCents = optionalAmountToCents(formData.get('target_max_amount'));
  const activeFrom = dateFilterIso(formData, 'target_active_from');
  const activeUntil = dateFilterIso(formData, 'target_active_until', true);
  const vipLevel = String(formData.get('target_vip_level') || '').trim();
  const membershipStatus = String(formData.get('target_membership_status') || '').trim();
  const eventId = String(formData.get('target_event_id') || '').trim();
  const eventName = String(formData.get('target_event_name') || '').trim();

  if (['stamp_count', 'streak_count'].includes(targetType)) {
    if (min !== null) {
      filter.min = min;
    }

    if (max !== null) {
      filter.max = max;
    }
  }

  if (targetType === 'vip_level' && vipLevel) {
    filter.vipLevel = vipLevel;
  }

  if (targetType === 'balance_range') {
    if (minCents !== null) {
      filter.minCents = minCents;
    }

    if (maxCents !== null) {
      filter.maxCents = maxCents;
    }
  }

  if (targetType === 'membership_status' && membershipStatus) {
    filter.membershipStatus = membershipStatus;
  }

  if (targetType === 'event') {
    if (eventId) {
      filter.eventId = eventId;
    }

    if (eventName) {
      filter.eventName = eventName;
    }
  }

  if (activeFrom) {
    filter.activeFrom = activeFrom;
  }

  if (activeUntil) {
    filter.activeUntil = activeUntil;
  }

  return filter;
}

function updateWalletNotificationTargetFilters() {
  if (!walletNotificationTargetFilters || !walletNotificationTarget) {
    return;
  }

  const targetType = walletNotificationTarget.value || 'template';
  let visibleFilterCount = 0;

  walletNotificationTargetFilters.querySelectorAll('[data-target-filter]').forEach((element) => {
    const allowedTargets = String(element.dataset.targetFilter || '').split(/\s+/).filter(Boolean);
    const visible = allowedTargets.includes(targetType);

    element.hidden = !visible;
    visibleFilterCount += visible ? 1 : 0;
  });

  walletNotificationTargetFilters.hidden = false;
  walletNotificationTargetFilters.dataset.activeFilterCount = String(visibleFilterCount);
}

function walletNotificationIdempotencyRandom() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stableWalletNotificationValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableWalletNotificationValue(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableWalletNotificationValue(entryValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value ?? null);
}

function walletNotificationPayloadFingerprint(payload) {
  const { idempotencyKey: _idempotencyKey, ...payloadWithoutKey } = payload;

  return stableWalletNotificationValue(payloadWithoutKey);
}

function idempotencyKeyForWalletNotification(payload) {
  const fingerprint = walletNotificationPayloadFingerprint(payload);

  if (state.walletNotificationIdempotency?.fingerprint === fingerprint) {
    return state.walletNotificationIdempotency.key;
  }

  const key = `wallet-campaign-${walletNotificationIdempotencyRandom()}`;
  state.walletNotificationIdempotency = {
    fingerprint,
    key
  };

  return key;
}

function resetWalletNotificationIdempotency() {
  state.walletNotificationIdempotency = null;
}

function notificationFormPayload() {
  const formData = new FormData(walletNotificationForm);
  const sendType = String(formData.get('send_type') || 'now');
  const locationRadius = Math.round(Number(formData.get('location_radius_m') || 0));
  const targetType = String(formData.get('target_type') || 'template');

  const payload = {
    templateId: selectedNotificationTemplateId(),
    targetType,
    targetFilter: targetFilterFromForm(formData, targetType),
    title: String(formData.get('title') || '').trim(),
    message: walletNotificationMessageFromForm(formData),
    sendType,
    scheduledAt: formData.get('scheduled_at') ? new Date(String(formData.get('scheduled_at'))).toISOString() : null,
    locationLat: formData.get('location_lat') ? Number(formData.get('location_lat')) : null,
    locationLng: formData.get('location_lng') ? Number(formData.get('location_lng')) : null,
    locationRadiusM: Number.isFinite(locationRadius) && locationRadius > 0 ? locationRadius : null
  };

  payload.idempotencyKey = idempotencyKeyForWalletNotification(payload);

  return payload;
}

function notificationPreflightPayload(formData, targetType, targetFilter) {
  const sendType = String(formData.get('send_type') || 'now');
  const locationRadius = Math.round(Number(formData.get('location_radius_m') || 0));

  return {
    templateId: selectedNotificationTemplateId(),
    targetType,
    targetFilter,
    sendType,
    scheduledAt: formData.get('scheduled_at') ? new Date(String(formData.get('scheduled_at'))).toISOString() : null,
    locationLat: formData.get('location_lat') ? Number(formData.get('location_lat')) : null,
    locationLng: formData.get('location_lng') ? Number(formData.get('location_lng')) : null,
    locationRadiusM: Number.isFinite(locationRadius) && locationRadius > 0 ? locationRadius : null
  };
}

function renderWalletLimitWarnings(preflight) {
  if (!walletNotificationLimitWarnings) {
    return;
  }

  const warnings = Array.isArray(preflight?.warnings) ? preflight.warnings : [];
  const unreachableCount = Number(preflight?.unreachable_count || 0);
  const pushDisabledCount = Number(preflight?.push_disabled_count || 0);
  const limitedCount = Number(preflight?.limited_count || 0);
  const appleUnregisteredCount = Number(preflight?.apple_unregistered_count || 0);

  if (!warnings.length && !unreachableCount && !pushDisabledCount && !limitedCount && !appleUnregisteredCount) {
    walletNotificationLimitWarnings.hidden = true;
    walletNotificationLimitWarnings.innerHTML = '';
    return;
  }

  const lines = warnings.map((warning) => (
    `<span><strong>${escapeHtml(warning.code || 'HINWEIS')}</strong>: ${escapeHtml(warning.message || 'Bitte prüfe diese Zielgruppe.')}</span>`
  ));

  if (limitedCount && !warnings.some((warning) => String(warning.code || '').includes('LIMIT'))) {
    lines.unshift(`<span><strong>LIMIT-PRÜFUNG</strong>: ${limitedCount} Karte(n) würden aktuell übersprungen oder limitiert.</span>`);
  }

  if (pushDisabledCount && !warnings.some((warning) => String(warning.code || '') === 'PUSH_DISABLED')) {
    lines.unshift(`<span><strong>PUSH_DISABLED</strong>: ${pushDisabledCount} Wallet-Karte(n) haben Push-Benachrichtigungen deaktiviert und werden nicht angeschrieben.</span>`);
  }

  const otherUnreachableCount = Math.max(0, unreachableCount - pushDisabledCount);

  if (otherUnreachableCount) {
    lines.unshift(`<span><strong>NICHT_ERREICHBAR</strong>: ${otherUnreachableCount} passende Karte(n) sind technisch nicht sendbar, z. B. wegen fehlender Wallet-Plattform.</span>`);
  }

  if (appleUnregisteredCount && !warnings.some((warning) => String(warning.code || '') === 'APPLE_NO_REGISTERED_DEVICES')) {
    lines.push(`<span><strong>APPLE_NO_REGISTERED_DEVICES</strong>: ${appleUnregisteredCount} Apple-Wallet-Karte(n) haben noch kein registriertes Gerät. Apple-Pushs werden dort als Kartenupdate vorbereitet.</span>`);
  }

  walletNotificationLimitWarnings.innerHTML = lines.join('');
  walletNotificationLimitWarnings.hidden = false;
}

function setMetricText(element, value) {
  if (element) {
    element.textContent = value == null ? '-' : String(value);
  }
}

function applyWalletPreflightMetrics(preflight, fallbackReachable = 0) {
  const allowedCount = Number(preflight?.allowed_count ?? preflight?.reachable_count ?? fallbackReachable);
  const unavailableCount = Number(preflight?.unreachable_count || 0) + Number(preflight?.limited_count || 0);

  setMetricText(walletReachableCount, allowedCount);
  setMetricText(walletUnreachableCount, Math.max(0, unavailableCount));
  setMetricText(walletAppleCount, Number(preflight?.apple_count || 0));
  setMetricText(walletGoogleCount, Number(preflight?.google_count || 0));
  setMetricText(walletLimitedCount, Number(preflight?.limited_count || 0));
  setMetricText(walletAppleUnregisteredCount, Number(preflight?.apple_unregistered_count || 0));
  renderWalletLimitWarnings(preflight);
}

function updateWalletNotificationPreview() {
  if (!walletNotificationForm) {
    return;
  }

  const formData = new FormData(walletNotificationForm);
  const title = String(formData.get('title') || 'Titel').trim() || 'Titel';
  const message = walletNotificationMessageFromForm(formData) || 'Nachricht';
  const sendType = String(formData.get('send_type') || 'now');

  updateWalletNotificationTargetFilters();

  if (sendType === 'location_based') {
    applyBusinessLocationDefaults();
  }

  if (appleNotificationPreviewTitle) {
    appleNotificationPreviewTitle.textContent = title;
  }

  if (appleNotificationPreviewText) {
    appleNotificationPreviewText.textContent = message;
  }

  if (googleNotificationPreviewTitle) {
    googleNotificationPreviewTitle.textContent = title;
  }

  if (googleNotificationPreviewText) {
    googleNotificationPreviewText.textContent = message;
  }

  if (walletNotificationScheduledAtField) {
    walletNotificationScheduledAtField.hidden = sendType !== 'scheduled';
  }

  if (walletNotificationLocationFields) {
    walletNotificationLocationFields.hidden = sendType !== 'location_based';
  }
}

function cardTimestampInFilter(card, filter) {
  const activeFrom = filter.activeFrom || filter.active_from || filter.createdAfter || filter.created_after;
  const activeUntil = filter.activeUntil || filter.active_until || filter.createdBefore || filter.created_before;

  if (!activeFrom && !activeUntil) {
    return true;
  }

  const createdAt = new Date(card.created_at || card.customer_cards?.created_at || 0).getTime();

  if (!createdAt) {
    return false;
  }

  if (activeFrom && createdAt < new Date(activeFrom).getTime()) {
    return false;
  }

  if (activeUntil && createdAt > new Date(activeUntil).getTime()) {
    return false;
  }

  return true;
}

function cardMatchesNotificationTarget(card, targetType, targetFilter) {
  const customerCard = card.customer_cards || {};

  if (!cardTimestampInFilter(card, targetFilter)) {
    return false;
  }

  if (targetType === 'all_active') {
    return customerCard.status === 'active';
  }

  if (targetType === 'platform_apple') {
    return card.wallet_platform === 'apple';
  }

  if (targetType === 'platform_google') {
    return card.wallet_platform === 'google';
  }

  if (targetType === 'stamp_count') {
    const value = Number(card.current_stamps ?? customerCard.stamp_count ?? 0);
    const min = Number(targetFilter.min ?? 0);
    const max = Number(targetFilter.max ?? Number.MAX_SAFE_INTEGER);

    return value >= min && value <= max;
  }

  if (targetType === 'streak_count') {
    const value = Number(card.current_streak ?? customerCard.streak_count ?? 0);
    const min = Number(targetFilter.min ?? 0);
    const max = Number(targetFilter.max ?? Number.MAX_SAFE_INTEGER);

    return value >= min && value <= max;
  }

  if (targetType === 'vip_level') {
    const expected = String(targetFilter.vipLevel || targetFilter.vip_level || '').trim().toLowerCase();

    return !expected || String(card.vip_level || customerCard.vip_status || '').trim().toLowerCase() === expected;
  }

  if (targetType === 'balance_range') {
    const value = Number(card.balance_cents ?? customerCard.balance_cents ?? 0);
    const min = Number(targetFilter.minCents ?? targetFilter.min_cents ?? 0);
    const max = Number(targetFilter.maxCents ?? targetFilter.max_cents ?? Number.MAX_SAFE_INTEGER);

    return value >= min && value <= max;
  }

  if (targetType === 'cloakroom_open') {
    return Boolean(card.cloakroom_active ?? customerCard.cloakroom_active);
  }

  if (targetType === 'coupon_unredeemed') {
    return customerCard.status !== 'redeemed';
  }

  if (targetType === 'membership_status') {
    const expected = String(targetFilter.membershipStatus || targetFilter.membership_status || '').trim();

    return !expected || String(customerCard.metadata?.membership_status || 'active') === expected;
  }

  if (targetType === 'event') {
    const expectedEventId = String(targetFilter.eventId || targetFilter.event_id || '').trim();
    const expectedEventName = String(targetFilter.eventName || targetFilter.event_name || '').trim().toLowerCase();
    const template = selectedNotificationTemplate();
    const actualEventId = String(customerCard.metadata?.event_id || template?.settings?.eventId || '').trim();
    const actualEventName = String(customerCard.metadata?.event_name || template?.settings?.eventName || '').trim().toLowerCase();

    return (!expectedEventId || actualEventId === expectedEventId)
      && (!expectedEventName || actualEventName === expectedEventName);
  }

  return true;
}

async function refreshWalletReachability() {
  const templateId = selectedNotificationTemplateId();

  if (!walletReachableCount || !walletUnreachableCount) {
    return;
  }

  const filters = [];

  if (state.business?.id) {
    filters.push({ column: 'business_id', op: 'eq', value: state.business.id });
  }

  if (templateId) {
    filters.push({ column: 'template_id', op: 'eq', value: templateId });
  }

  const cards = await state.client.selectRows('card_instances', {
    select: 'id,wallet_platform,push_enabled,template_id,current_stamps,current_streak,vip_level,balance_cents,cloakroom_active,created_at,customer_cards(status,stamp_count,streak_count,vip_status,balance_cents,cloakroom_active,metadata,created_at)',
    filters,
    limit: 1000
  }).catch(() => []);
  const formData = walletNotificationForm ? new FormData(walletNotificationForm) : new FormData();
  const targetType = String(formData.get('target_type') || 'template');
  const targetFilter = targetFilterFromForm(formData, targetType);
  const matchedCards = cards.filter((card) => cardMatchesNotificationTarget(card, targetType, targetFilter));
  const reachableCards = matchedCards.filter((card) => ['apple', 'google'].includes(card.wallet_platform) && card.push_enabled !== false);
  const reachable = reachableCards.length;

  setMetricText(walletReachableCount, reachable);
  setMetricText(walletUnreachableCount, Math.max(0, matchedCards.length - reachable));
  setMetricText(walletAppleCount, reachableCards.filter((card) => card.wallet_platform === 'apple').length);
  setMetricText(walletGoogleCount, reachableCards.filter((card) => card.wallet_platform === 'google').length);
  setMetricText(walletLimitedCount, '-');
  setMetricText(walletAppleUnregisteredCount, '-');

  try {
    const preflight = await callWalletNotificationFunction(
      'check-wallet-notification-limits',
      notificationPreflightPayload(formData, targetType, targetFilter)
    );
    applyWalletPreflightMetrics(preflight, reachable);
  } catch (_error) {
    if (walletNotificationLimitWarnings) {
      walletNotificationLimitWarnings.textContent = 'Limit-Prüfung ist gerade nicht verfügbar. Vor dem Versand prüft die Edge Function trotzdem erneut.';
      walletNotificationLimitWarnings.hidden = false;
    }
  }
}

function scheduleWalletReachabilityRefresh() {
  if (reachabilityRefreshTimer) {
    clearTimeout(reachabilityRefreshTimer);
  }

  reachabilityRefreshTimer = setTimeout(() => {
    refreshWalletReachability().catch(() => {});
  }, 250);
}

async function loadWalletNotificationHistory() {
  const templateId = selectedNotificationTemplateId();

  if (!walletNotificationHistory) {
    return;
  }

  const filters = [];

  if (state.business?.id) {
    filters.push({ column: 'business_id', op: 'eq', value: state.business.id });
  }

  if (templateId) {
    filters.push({ column: 'template_id', op: 'eq', value: templateId });
  }

  const campaigns = await state.client.selectRows('wallet_notification_campaigns', {
    select: walletNotificationCampaignHistorySelect,
    filters,
    order: 'created_at.desc',
    limit: 8
  }).catch(() => []);

  if (!campaigns.length) {
    walletNotificationHistory.innerHTML = `<p class="muted">Noch keine Wallet-Benachrichtigungen für ${templateId ? 'dieses Template' : 'dieses Business'}.</p>`;
    return;
  }

  function campaignChildFilters(campaign) {
    return [
      { column: 'campaign_id', op: 'eq', value: campaign.id },
      ...(state.business?.id ? [{ column: 'business_id', op: 'eq', value: state.business.id }] : [])
    ];
  }

  const recipientGroups = await Promise.all(campaigns.map((campaign) => (
    state.client.selectRows('wallet_notification_recipients', {
      select: 'id,status,wallet_platform,error_code,error_message,created_at,sent_at',
      filters: campaignChildFilters(campaign),
      order: 'created_at.desc',
      limit: 200
    }).catch(() => [])
  )));
  const pushLogGroups = await Promise.all(campaigns.map((campaign) => (
    state.client.selectRows('wallet_push_logs', {
      select: 'id,status,wallet_platform,action,error_message,created_at',
      filters: campaignChildFilters(campaign),
      order: 'created_at.desc',
      limit: 200
    }).catch(() => [])
  )));

  function historyDate(value) {
    if (!value) {
      return '-';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '-';
    }

    return date.toLocaleString('de-CH');
  }

  function recipientIssue(recipient) {
    const isWarning = recipient.status === 'limited'
      || recipient.status === 'prepared'
      || (recipient.status === 'skipped' && recipient.wallet_platform === 'apple');
    const code = recipient.error_code
      || (recipient.status === 'limited' ? 'LIMIT_ERREICHT' : '')
      || (recipient.status === 'prepared' ? 'VORBEREITET' : '')
      || (recipient.status === 'skipped' ? 'UEBERSPRUNGEN' : '')
      || (recipient.status === 'failed' ? 'FEHLER' : '');
    const message = recipient.error_message
      || (recipient.status === 'skipped' && recipient.wallet_platform === 'apple'
        ? 'Apple Wallet hat kein registriertes Gerät für diese Karte.'
        : '');

    if (!code && !message) {
      return null;
    }

    return {
      type: isWarning ? 'warning' : 'error',
      code: code || (isWarning ? 'HINWEIS' : 'FEHLER'),
      message: message || 'Keine Detailmeldung',
      source: 'Empfänger',
      status: recipient.status,
      platform: recipient.wallet_platform,
      createdAt: recipient.created_at,
      sentAt: recipient.sent_at
    };
  }

  function logIssue(log) {
    const isProblemStatus = ['failed', 'limited', 'skipped'].includes(log.status);

    if (!isProblemStatus) {
      return null;
    }

    const code = log.action
      || 'WALLET_LOG';
    const message = log.error_message
      || `${log.action || 'Wallet-Log'} wurde mit Status ${log.status || 'unbekannt'} protokolliert.`;

    return {
      type: log.status === 'failed' ? 'error' : 'warning',
      code,
      message,
      source: log.action || 'Wallet-Log',
      status: log.status,
      platform: log.wallet_platform,
      createdAt: log.created_at
    };
  }

  function historyDetailMarkup(recipients, logs) {
    const recipientDetails = recipients
      .map((recipient) => ({ recipient, issue: recipientIssue(recipient) }))
      .filter((entry) => entry.issue);
    const logDetails = logs
      .map((log) => ({ log, issue: logIssue(log) }))
      .filter((entry) => entry.issue);
    const auditLogs = logs.slice(0, 8);
    const detailCount = recipientDetails.length + logDetails.length;

    if (!detailCount && !auditLogs.length) {
      return '';
    }

    return `
      <details class="history-detail">
        <summary>Fehlerlogs und Audit-Status anzeigen (${detailCount || auditLogs.length})</summary>
        ${detailCount ? `
          <div class="history-detail-list">
            ${recipientDetails.map(({ issue }) => `
              <article class="history-detail-entry history-detail-${escapeHtml(issue.type)}">
                <div class="history-detail-heading">
                  <strong>${escapeHtml(issue.code)}</strong>
                  <span>${escapeHtml(issue.source)} · ${escapeHtml(issue.platform || '-')} · ${escapeHtml(issue.status || '-')} · ${escapeHtml(historyDate(issue.sentAt || issue.createdAt))}</span>
                </div>
                <p>${escapeHtml(issue.message)}</p>
              </article>
            `).join('')}
            ${logDetails.map(({ issue }) => `
              <article class="history-detail-entry history-detail-${escapeHtml(issue.type)}">
                <div class="history-detail-heading">
                  <strong>${escapeHtml(issue.code)}</strong>
                  <span>${escapeHtml(issue.source)} · ${escapeHtml(issue.platform || '-')} · ${escapeHtml(issue.status || '-')} · ${escapeHtml(historyDate(issue.createdAt))}</span>
                </div>
                <p>${escapeHtml(issue.message)}</p>
              </article>
            `).join('')}
          </div>
        ` : ''}
        ${auditLogs.length ? `
          <div class="history-audit-list">
            <strong>Letzte Audit-Logs</strong>
            ${auditLogs.map((log) => `
              <div class="history-audit-row">
                <span>${escapeHtml(log.action || 'wallet_log')}</span>
                <span>${escapeHtml(log.wallet_platform || '-')}</span>
                <span>${escapeHtml(log.status || '-')}</span>
                <span>${escapeHtml(historyDate(log.created_at))}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </details>
    `;
  }

  walletNotificationHistory.innerHTML = campaigns.map((campaign, index) => {
    const recipients = recipientGroups[index] || [];
    const logs = pushLogGroups[index] || [];
    const sent = recipients.filter((recipient) => recipient.status === 'sent').length;
    const prepared = recipients.filter((recipient) => recipient.status === 'prepared').length;
    const failed = recipients.filter((recipient) => ['failed', 'limited'].includes(recipient.status)).length;
    const skipped = recipients.filter((recipient) => recipient.status === 'skipped').length;
    const processing = recipients.filter((recipient) => recipient.status === 'processing').length;
    const apple = recipients.filter((recipient) => recipient.wallet_platform === 'apple').length;
    const google = recipients.filter((recipient) => recipient.wallet_platform === 'google').length;
    const logProblems = logs.filter((log) => ['failed', 'limited', 'skipped'].includes(log.status)).length;
    const issues = [
      ...recipients.map(recipientIssue),
      ...logs.map(logIssue)
    ].filter(Boolean);
    const warnings = issues.filter((issue) => issue.type === 'warning').length;
    const visibleIssues = issues
      .slice(0, 4);

    return `
    <div class="history-item">
      <strong>${escapeHtml(campaign.title)}</strong>
      <span>${escapeHtml(campaign.message)}</span>
      <span class="muted">${escapeHtml(campaign.status)} · ${escapeHtml(campaign.send_type)} · ${escapeHtml(new Date(campaign.created_at).toLocaleString('de-CH'))}</span>
      <div class="history-meta">
        <span>${sent} gesendet</span>
        ${prepared ? `<span>${prepared} vorbereitet</span>` : ''}
        <span>${failed} fehlgeschlagen/limitiert</span>
        <span>${skipped} übersprungen</span>
        ${processing ? `<span>${processing} in Verarbeitung</span>` : ''}
        <span>${apple} Apple</span>
        <span>${google} Google</span>
        <span>${logs.length} Logs</span>
        ${logProblems ? `<span>${logProblems} Log-Probleme</span>` : ''}
        ${warnings ? `<span>${warnings} Hinweise</span>` : ''}
      </div>
      ${visibleIssues.length ? `
        <div class="history-errors">
          ${visibleIssues.map((issue) => `
            <span class="history-error history-error-${escapeHtml(issue.type)}">${escapeHtml(issue.code)}: ${escapeHtml(issue.message)}</span>
          `).join('')}
          ${issues.length > visibleIssues.length ? `<span class="history-error history-error-warning">${issues.length - visibleIssues.length} weitere Details in den Fehlerlogs.</span>` : ''}
        </div>
      ` : ''}
      ${historyDetailMarkup(recipients, logs)}
    </div>
  `;
  }).join('');
}

async function renderWalletNotificationsPanel() {
  if (!walletNotificationsPanel || !walletNotificationTarget || !walletNotificationTemplate) {
    return;
  }

  if (!state.notificationTemplates.length && state.template) {
    state.notificationTemplates = [state.template];
  }

  if (!state.notificationTemplates.length) {
    walletNotificationsPanel.hidden = true;
    return;
  }

  walletNotificationsPanel.hidden = false;

  const hadTemplateOptions = walletNotificationTemplate.options.length > 0;
  const previousTemplateId = hadTemplateOptions ? walletNotificationTemplate.value : state.templateId || '';
  walletNotificationTemplate.innerHTML = [
    '<option value="">Alle Templates / businessweit</option>',
    ...state.notificationTemplates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.card_name || template.business_name || template.id)}</option>`)
  ].join('');

  if (previousTemplateId && state.notificationTemplates.some((template) => template.id === previousTemplateId)) {
    walletNotificationTemplate.value = previousTemplateId;
  } else {
    walletNotificationTemplate.value = '';
  }

  const selectedTemplate = selectedNotificationTemplate();
  const draft = selectedTemplate?.id === state.templateId ? templateDraftFromForm() : selectedTemplate;

  if (draft && !featureEnabled(draft, 'notifications')) {
    setWalletNotificationFormDisabled(true);
    clearWalletNotificationMetrics();

    if (walletNotificationTemplateLabel) {
      walletNotificationTemplateLabel.textContent = draft.card_name || 'Benachrichtigungen deaktiviert';
    }

    walletNotificationTarget.innerHTML = '<option value="template">Benachrichtigungen deaktiviert</option>';
    if (walletNotificationTargetFilters) {
      walletNotificationTargetFilters.hidden = true;
      walletNotificationTargetFilters.dataset.activeFilterCount = '0';
    }
    showMessage(
      walletNotificationMessage,
      'Wallet-Benachrichtigungen sind für dieses Template deaktiviert. Wähle im Template-Dropdown ein anderes Template oder businessweit.',
      'info'
    );
    await loadWalletNotificationHistory();
    return;
  }

  setWalletNotificationFormDisabled(false);
  showMessage(walletNotificationMessage, '');

  if (walletNotificationTemplateLabel) {
    walletNotificationTemplateLabel.textContent = draft?.card_name || 'Businessweit';
  }

  const previousTarget = walletNotificationTarget.value;
  walletNotificationTarget.innerHTML = walletNotificationTargetOptions(draft)
    .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join('');

  if ([...walletNotificationTarget.options].some((option) => option.value === previousTarget)) {
    walletNotificationTarget.value = previousTarget;
  }

  applyWalletNotificationDefaults();
  updateWalletNotificationPreview();
  await Promise.all([
    refreshWalletReachability(),
    loadWalletNotificationHistory()
  ]);
}

async function submitWalletNotification(event) {
  event.preventDefault();

  if (walletNotificationForm?.dataset.notificationsDisabled === 'true') {
    showMessage(walletNotificationMessage, 'Wallet-Benachrichtigungen sind für dieses Template deaktiviert.', 'error');
    return;
  }

  if (notificationField('send_type')?.value === 'location_based') {
    applyBusinessLocationDefaults();
  }

  const payload = notificationFormPayload();

  if (payload.targetType === 'template' && !payload.templateId) {
    showMessage(walletNotificationMessage, 'Wähle für diese Zielgruppe zuerst ein Template.', 'error');
    return;
  }

  if (!payload.message) {
    showMessage(walletNotificationMessage, 'Gib zuerst die Nachricht ein, die der Kunde in der Wallet sehen soll.', 'error');
    notificationField('message')?.focus();
    return;
  }

  showMessage(walletNotificationMessage, 'Wallet-Limits werden geprüft ...');
  const preflightPayload = notificationPreflightPayload(new FormData(walletNotificationForm), payload.targetType, payload.targetFilter);
  const preflight = await callWalletNotificationFunction('check-wallet-notification-limits', preflightPayload);
  applyWalletPreflightMetrics(preflight, Number(preflight.reachable_count || 0));

  const reachableCount = Number(preflight.reachable_count || 0);
  const allowedCount = Number(preflight.allowed_count || 0);

  if (reachableCount <= 0) {
    showMessage(walletNotificationMessage, 'Keine erreichbaren Wallet-Karten für diese Zielgruppe.', 'error');
    return;
  }

  if (payload.sendType === 'now' && allowedCount <= 0) {
    showMessage(walletNotificationMessage, 'Sofortversand blockiert: alle passenden Karten sind aktuell limitiert.', 'error');
    return;
  }

  showMessage(walletNotificationMessage, 'Wallet-Benachrichtigung wird vorbereitet ...');
  const result = await callWalletNotificationFunction('create-wallet-notification-campaign', payload);

  showMessage(
    walletNotificationMessage,
    `Kampagne gespeichert. Empfänger: ${result.recipients_count ?? 0}. Status: ${result.campaign?.status || result.send_result?.status || 'erstellt'}.`,
    'success'
  );
  resetWalletNotificationIdempotency();
  walletNotificationForm.reset();
  applyWalletNotificationDefaults();
  updateWalletNotificationPreview();
  await Promise.all([
    refreshWalletReachability(),
    loadWalletNotificationHistory()
  ]);
}

function renderOptionalFeatureToggles(draft) {
  if (!optionalFeaturePanel || !optionalFeatureToggles) {
    return;
  }

  const isClubCard = normalizeTemplateType(draft) === 'club_card';
  const optionalFeatures = Object.entries(getTemplateFeatures(draft))
    .filter(([featureName, value]) => (isClubCard || featureName !== 'cloakroom') && value === OPTIONAL_FEATURE)
    .map(([featureName]) => featureName);
  const activeOptionalCount = optionalFeatures.filter((featureName) => featureEnabled(draft, featureName)).length;
  const title = optionalFeaturePanel.querySelector('.optional-feature-title');

  optionalFeaturePanel.hidden = optionalFeatures.length === 0;
  if (title) {
    title.textContent = isClubCard ? 'Clubkarten-Funktionen' : 'Optionale Zusatzfunktionen';
  }
  if (clubFeatureSpaceWarning) {
    clubFeatureSpaceWarning.hidden = !isClubCard || activeOptionalCount < 4;
  }
  optionalFeatureToggles.innerHTML = optionalFeatures.map((featureName) => {
    const checked = featureEnabled(draft, featureName);
    const isLocked = lockedEditorFeatures.has(featureName);
    const label = isClubCard ? {
      vip: 'VIP-Funktion aktivieren',
      balance: 'Guthaben-Funktion (in Vorbereitung)',
      cloakroom: 'Garderoben-Funktion aktivieren',
      redemption: 'Coupon-Funktion aktivieren',
      membership: 'Mitgliedschafts-Funktion aktivieren'
    }[featureName] || `${featureLabel(featureName)} aktivieren` : `${featureLabel(featureName)} aktivieren`;

    return `
    <label class="check-row optional-feature-toggle ${isLocked ? 'is-locked' : ''}">
      <input
        type="checkbox"
        role="switch"
        name="${visibleOptionalFeatureInputNamePrefix}${featureName}"
        data-editor-optional-feature="${featureName}"
        aria-expanded="${checked ? 'true' : 'false'}"
        ${isLocked ? 'disabled aria-disabled="true"' : ''}
        ${checked ? 'checked' : ''}
      >
      <span>${label}</span>
      ${isLocked ? '<small class="feature-lock-label">Noch nicht verfügbar</small>' : ''}
    </label>
  `;
  }).join('');
}

function updateConditionalTemplateFields() {
  const draft = templateDraftFromForm();

  renderOptionalFeatureToggles(draft);

  document.querySelectorAll('[data-feature-group]').forEach((element) => {
    const featureName = element.dataset.featureGroup;
    const value = featureValue(draft, featureName);
    const isAvailable = value === true || value === OPTIONAL_FEATURE;
    const isOptional = value === OPTIONAL_FEATURE;
    const isEnabled = isOptional ? featureEnabled(draft, featureName) : isAvailable;
    const isCloakroomAlwaysVisible = featureName === 'cloakroom' && normalizeTemplateType(draft) !== 'club_card';

    element.hidden = isCloakroomAlwaysVisible ? !isAvailable : isOptional ? !isEnabled : !isAvailable;

    element.querySelectorAll(`[data-optional-toggle="${featureName}"]`).forEach((toggleElement) => {
      toggleElement.hidden = true;
      toggleElement.querySelectorAll('input, select, textarea, button').forEach((field) => {
        field.disabled = true;
      });
    });

    element.querySelectorAll(`[data-feature-setting="${featureName}"]`).forEach((settingElement) => {
      settingElement.hidden = isCloakroomAlwaysVisible ? !isAvailable : !isEnabled;
    });
  });

  document.querySelectorAll('[data-reward-field]').forEach((element) => {
    element.hidden = !templateSupportsReward(draft);
  });

  renderEditorPreview();
  renderWalletNotificationsPanel().catch(() => {});
}

function handleOptionalFeatureToggle(event) {
  const target = event.target;
  const featureName = target?.dataset?.editorOptionalFeature;

  if (!featureName || target.type !== 'checkbox') {
    return;
  }

  if (lockedEditorFeatures.has(featureName)) {
    setOptionalFeatureSelection(featureName, false);
    showMessage(editorMessage, 'Die Guthaben-Funktion ist sichtbar, aber noch nicht freigegeben.', 'info');
    event.stopPropagation();
    return;
  }

  setOptionalFeatureSelection(featureName, target.checked);
  target.setAttribute('aria-expanded', target.checked ? 'true' : 'false');
  event.stopPropagation();
  updateConditionalTemplateFields();
}

async function uploadTemplateAsset(file, kind) {
  if (!file) {
    return null;
  }

  const uploadFrame = assetUploadFrames[kind] || { width: 1024, height: 1024, backgroundColor: 'transparent' };
  const pngAssetFile = await imageFileToPngUnderLimit(file, {
    maxBytes: maxAssetFileBytes,
    maxSourceBytes: maxAssetSourceFileBytes,
    filename: `${kind}.png`,
    targetWidth: uploadFrame.width,
    targetHeight: uploadFrame.height,
    backgroundColor: uploadFrame.backgroundColor,
    emptyMessage: 'Bitte eine Bilddatei auswählen.',
    typeMessage: 'Bitte ein PNG-, JPEG- oder WebP-Bild auswählen. SVG und andere Dateitypen sind für Wallet-Assets deaktiviert.',
    sourceTooLargeMessage: 'Die Originaldatei ist sehr gross. Bitte maximal 25 MB auswählen.',
    readErrorMessage: 'Bild konnte nicht gelesen werden.',
    prepareErrorMessage: 'Bild konnte nicht vorbereitet werden.',
    outputTooLargeMessage: 'Bild konnte nicht klein genug vorbereitet werden. Bitte ein weniger detailreiches Bild verwenden.'
  });
  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const objectPath = `${state.session.user.id}/templates/${kind}-${randomPart}.png`;

  return state.client.uploadStorageObject(assetBucket, objectPath, pngAssetFile);
}

async function handleAssetUpload(event, targetFieldName, kind) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  showMessage(editorMessage, 'Bild wird vorbereitet und hochgeladen ...');

  try {
    const result = await uploadTemplateAsset(file, kind);
    setTemplateField(targetFieldName, result.publicUrl);
    renderEditorPreview();
    showMessage(editorMessage, 'Bild hochgeladen und in den Editor übernommen.', 'success');
  } finally {
    event.target.value = '';
  }
}

async function loadBusiness() {
  const options = {
    filters: [{ column: 'owner_id', op: 'eq', value: state.session.user.id }],
    maybeSingle: true
  };

  try {
    state.business = await state.client.selectRows('businesses', { ...options, select: businessEditorSelect });
  } catch (_error) {
    state.business = await state.client.selectRows('businesses', { ...options, select: businessEditorLegacySelect });
  }

  renderBusinessHeader(state.business || {});
}

async function loadTemplate() {
  if (!state.templateId) {
    return;
  }

  const loadedTemplate = await state.client.selectRows('card_templates', {
    select: templateEditorSelect,
    filters: [
      { column: 'id', op: 'eq', value: state.templateId },
      { column: 'owner_id', op: 'eq', value: state.session.user.id }
    ],
    maybeSingle: true
  });

  if (!loadedTemplate) {
    throw new Error('Diese Karte wurde nicht gefunden oder gehört nicht zu deinem Account.');
  }

  state.template = editableTemplateForEditor(loadedTemplate);
  loadTemplateIntoForm(state.template);
}

async function loadNotificationTemplates() {
  state.notificationTemplates = await state.client.selectRows('card_templates', {
    select: templateEditorSelect,
    filters: [
      { column: 'owner_id', op: 'eq', value: state.session.user.id },
      { column: 'is_active', op: 'eq', value: true }
    ],
    order: 'card_name.asc',
    limit: 200
  }).catch(() => []);

  if (state.template && !state.notificationTemplates.some((template) => template.id === state.template.id)) {
    state.notificationTemplates.unshift(state.template);
  }
}

async function saveTemplate(event) {
  event.preventDefault();
  showMessage(editorMessage, state.templateId ? 'Karte wird aktualisiert ...' : 'Template wird gespeichert ...');

  const draft = templateDraftFromForm();

  if (
    lockedEditorTemplateTypes.has(draft.template_type)
    && normalizeTemplateType(state.template || '') !== draft.template_type
  ) {
    showMessage(editorMessage, 'Die Eventkarte ist sichtbar, aber noch nicht freigegeben.', 'error');
    return;
  }

  if (!draft.business_name || !draft.card_name) {
    showMessage(editorMessage, 'Geschäftsname und Kartenname sind Pflichtfelder.', 'error');
    return;
  }

  if (!state.business?.id) {
    showMessage(editorMessage, 'Bitte zuerst auf der Konto-Seite deine Firmendaten speichern, damit diese Karte einem Business zugeordnet werden kann.', 'error');
    return;
  }

  const payload = {
    ...draft,
    business_id: state.business.id,
    is_active: true
  };

  if (state.templateId) {
    const rows = await state.client.updateRows('card_templates', payload, [
      { column: 'id', op: 'eq', value: state.templateId },
      { column: 'owner_id', op: 'eq', value: state.session.user.id }
    ]);

    state.template = rows[0] || { ...state.template, ...payload };
    state.notificationTemplates = state.notificationTemplates.map((template) => (
      template.id === state.template.id ? state.template : template
    ));
    loadTemplateIntoForm(state.template);
    updateConditionalTemplateFields();
    renderWalletNotificationsPanel().catch(() => {});
    showMessage(editorMessage, 'Karte aktualisiert. Der QR-Code bleibt gleich.', 'success');
    return;
  }

  const rows = await state.client.insertRows('card_templates', {
    ...payload,
    owner_id: state.session.user.id
  });
  const createdTemplate = rows[0];

  if (createdTemplate?.id) {
    state.templateId = createdTemplate.id;
    state.template = createdTemplate;
    state.notificationTemplates = [
      createdTemplate,
      ...state.notificationTemplates.filter((template) => template.id !== createdTemplate.id)
    ];
    window.history.replaceState({}, '', pagePath(`editor.html?template=${encodeURIComponent(createdTemplate.id)}`));
    updateEditorModeUi();
    loadTemplateIntoForm(createdTemplate);
    updateConditionalTemplateFields();
    renderWalletNotificationsPanel().catch(() => {});
  }

  showMessage(editorMessage, 'Template erstellt. Es erscheint jetzt in der Dashboard-Übersicht.', 'success');
}

async function initEditor() {
  const context = await requireLogin({ requireUnlock: true });

  if (!context) {
    return;
  }

  state.client = context.client;
  state.session = context.session;
  state.profile = context.profile;

  templateForm?.addEventListener('submit', (event) => {
    saveTemplate(event).catch((error) => showMessage(editorMessage, error.message, 'error'));
  });
  templateForm?.addEventListener('input', updateConditionalTemplateFields);
  templateForm?.addEventListener('change', updateConditionalTemplateFields);

  templateType?.addEventListener('change', updateConditionalTemplateFields);

  editorLogoColorPickerButton?.addEventListener('click', toggleEditorLogoColorPicker);
  editorLogoColorPickerImage?.addEventListener('pointerdown', (event) => {
    try {
      pickEditorLogoColor(event);
    } catch (error) {
      showMessage(editorMessage, error.message, 'error');
    }
  });

  stampIconUpload?.addEventListener('change', (event) => {
    handleAssetUpload(event, 'stamp_icon_url', 'stamp-icon').catch((error) => showMessage(editorMessage, error.message, 'error'));
  });

  streakIconUpload?.addEventListener('change', (event) => {
    handleAssetUpload(event, 'streak_icon_url', 'streak-icon').catch((error) => showMessage(editorMessage, error.message, 'error'));
  });

  eventAppleBackgroundUpload?.addEventListener('change', (event) => {
    handleAssetUpload(event, 'event_apple_background_image_url', 'event-apple-background').catch((error) => showMessage(editorMessage, error.message, 'error'));
  });

  eventGoogleHeroImageUpload?.addEventListener('change', (event) => {
    handleAssetUpload(event, 'event_google_hero_image_url', 'event-google-hero').catch((error) => showMessage(editorMessage, error.message, 'error'));
  });

  optionalFeaturePanel?.addEventListener('input', handleOptionalFeatureToggle);
  optionalFeaturePanel?.addEventListener('change', handleOptionalFeatureToggle);

  walletNotificationForm?.addEventListener('submit', (event) => {
    submitWalletNotification(event).catch((error) => showMessage(walletNotificationMessage, error.message, 'error'));
  });
  walletNotificationForm?.addEventListener('input', updateWalletNotificationPreview);
  walletNotificationForm?.addEventListener('change', () => {
    updateWalletNotificationPreview();
    scheduleWalletReachabilityRefresh();
  });
  walletNotificationTarget?.addEventListener('change', () => {
    updateWalletNotificationPreview();
    scheduleWalletReachabilityRefresh();
  });
  walletNotificationTemplate?.addEventListener('change', () => {
    renderWalletNotificationsPanel().catch((error) => showMessage(walletNotificationMessage, error.message, 'error'));
  });

  updateEditorModeUi();
  await loadBusiness();
  syncDefaultsFromBusiness();
  await loadTemplate();
  await loadNotificationTemplates();
  updateEditorModeUi();
  updateConditionalTemplateFields();
  renderEditorPreview();
  await renderWalletNotificationsPanel();
}

initEditor().catch((error) => {
  showMessage(editorMessage, error.message, 'error');
});
