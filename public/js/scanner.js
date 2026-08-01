import { requireLogin } from './guards.js';
import { apiUrl } from './config.js';
import { setupLanguageSelectors, t } from './i18n.js';
import { pagePath } from './path.js';
import { byId, cardTypeLabel, escapeHtml, normalizeCode, renderBusinessHeader, showMessage, walletPreviewHtml } from './ui.js';
import { cardEmblemMeta } from './cardEmblems.js';
import { activeFeatureLabels, featureEnabled, normalizeScannerAction, normalizeTemplateType, scannerAccessHighlights, validateScannerAction } from './templateFeatures.js';

const state = {
  client: null,
  session: null,
  currentCard: null,
  currentCardInstance: null,
  originalCard: null,
  stream: null,
  detector: null,
  scanTimer: null,
  scanAnimationFrame: null,
  scanInProgress: false,
  scannerMode: '',
  scanCanvas: null,
  scanCanvasContext: null,
  business: null,
  pendingDemographicsAction: null,
  pendingDemographicsPayload: null
};

const JSQR_CDN_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';

const businessScannerSelect = [
  'id',
  'owner_id',
  'name',
  'logo_url',
  'company_logo_path',
  'company_logo_updated_at'
].join(',');

const templateScannerSelect = [
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
  'is_active',
  'created_at',
  'updated_at'
].join(',');

const customerCardScannerSelect = [
  'id',
  'owner_id',
  'business_id',
  'template_id',
  'card_instance_number',
  'customer_code',
  'status',
  'stamp_count',
  'streak_count',
  'vip_status',
  'pass_serial_number',
  'wallet_platform',
  'wallet_object_id',
  'wallet_serial_number',
  'balance_cents',
  'currency',
  'cloakroom_active',
  'cloakroom_started_at',
  'cloakroom_completed_at',
  'last_scanned_at',
  'metadata',
  'created_at',
  'updated_at',
  'card_templates(id,business_name,card_name,card_type,template_type,description,primary_color,text_color,logo_url,reward_text,stamps_required,streak_goal,vip_tier,settings,club_features,club_settings,is_active)'
].join(',');

const cardInstanceScannerBaseSelect = [
  'id',
  'customer_card_id',
  'card_instance_number',
  'wallet_platform',
  'demographics_collected',
  'customer_gender',
  'customer_age_group',
  'demographics_collected_at',
  'first_scanned_at',
  'last_scanned_at',
  'scan_count',
  'updated_at'
].join(',');

const cardInstanceScannerSelect = [
  cardInstanceScannerBaseSelect,
  'resolved_emblem_key',
  'resolved_emblem_url',
  'emblem_updated_at'
].join(',');

const scannerMessage = byId('scannerMessage');
const manualForm = byId('manualScanForm');
const video = byId('scannerVideo');
const cardPanel = byId('cardPanel');
const scannerOnlyLogoutButton = byId('scannerOnlyLogoutButton');
const accessStatusModal = byId('accessStatusModal');
const accessStatusItems = byId('accessStatusItems');
const accessStatusClose = byId('accessStatusClose');
const demographicsModal = byId('demographicsModal');
const demographicsForm = byId('demographicsForm');
const demographicsTemplateType = byId('demographicsTemplateType');
const demographicsClubInfo = byId('demographicsClubInfo');
const demographicsClubBadges = byId('demographicsClubBadges');
const demographicsMessage = byId('demographicsMessage');
const clubFeatureBadgeLabels = {
  vip: 'VIP',
  balance: 'Guthaben',
  cloakroom: 'Garderobe',
  coupon: 'Coupon',
  membership: 'Mitgliedschaft'
};

let scannerResetTimer = null;
let jsQrLoaderPromise = null;

async function loadBusinessHeader() {
  state.business = await state.client.selectRows('businesses', {
    select: businessScannerSelect,
    filters: [
      { column: 'owner_id', op: 'eq', value: state.session.user.id }
    ],
    maybeSingle: true
  });

  renderBusinessHeader(state.business || {});
}

function stopCamera() {
  if (state.scanTimer) {
    clearInterval(state.scanTimer);
    state.scanTimer = null;
  }

  if (state.scanAnimationFrame) {
    cancelAnimationFrame(state.scanAnimationFrame);
    state.scanAnimationFrame = null;
  }

  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.detector = null;
  state.scannerMode = '';
  state.scanInProgress = false;

  if (video) {
    video.pause();
    video.srcObject = null;
  }
}

function renderCard() {
  if (!state.currentCard) {
    cardPanel.hidden = true;
    return;
  }

  const card = state.currentCard;
  const cardInstance = state.currentCardInstance || {};
  const template = card.card_templates || {};
  const businessName = String(state.business?.name || template.business_name || 'Business').trim();
  const businessLogo = String(state.business?.logo_url || template.business_logo_url || template.logo_url || '').trim();
  const previewTemplate = {
    ...template,
    business_name: businessName,
    business_logo_url: businessLogo,
    logo_url: businessLogo
  };
  const walletPlatform = card.wallet_platform || card.metadata?.wallet_platform || '';
  const cardInstanceNumber = card.card_instance_number || card.metadata?.card_instance_number || card.customer_code;
  const previewCard = {
    ...card,
    ...cardInstance,
    stamp_count: card.stamp_count,
    streak_count: card.streak_count,
    vip_status: card.vip_status,
    status: card.status,
    card_instance_number: cardInstance.card_instance_number || cardInstanceNumber
  };
  const emblem = cardEmblemMeta(previewCard);
  const balanceCents = Number(card.balance_cents ?? card.metadata?.balance_cents ?? 0);
  const currency = card.currency || template.settings?.currency || 'CHF';
  const cloakroomActive = Boolean(card.cloakroom_active ?? card.metadata?.cloakroom_active);
  const appleWalletButton = walletPlatform === 'apple'
    ? '<button type="button" class="secondary" data-action="download-apple-pass">Aktuelle Wallet-Datei laden</button>'
    : '';
  const detailItems = [
    `<div><dt>Karten-ID</dt><dd>${escapeHtml(cardInstanceNumber)}</dd></div>`,
    `<div><dt>Kundencode</dt><dd>${escapeHtml(card.customer_code)}</dd></div>`,
    `<div><dt>Status</dt><dd>${escapeHtml(card.status)}</dd></div>`,
    `<div><dt>Wallet</dt><dd>${escapeHtml(walletPlatform || 'unknown')}</dd></div>`,
    `<div><dt>Emblem</dt><dd>${escapeHtml(emblem.label)}</dd></div>`,
    `<div><dt>Aktive Funktionen</dt><dd>${escapeHtml(activeFeatureLabels(previewTemplate).join(', '))}</dd></div>`
  ];

  if (cardInstance.scan_count != null) {
    detailItems.push(`<div><dt>Scan-Anzahl</dt><dd>${Number(cardInstance.scan_count || 0)}</dd></div>`);
  }

  if (cardInstance.first_scanned_at) {
    detailItems.push(`<div><dt>Erster Scan</dt><dd>${escapeHtml(new Date(cardInstance.first_scanned_at).toLocaleString())}</dd></div>`);
  }
  const editFields = [
    `
      <label>Status
        <select id="cardStatus">
          ${['active', 'paused', 'redeemed', 'blocked'].map((status) => `
            <option value="${status}" ${status === card.status ? 'selected' : ''}>${status}</option>
          `).join('')}
        </select>
      </label>
    `
  ];
  const quickActions = [];
  const clubModuleFeatures = ['vip', 'balance', 'cloakroom', 'redemption', 'membership'];
  const clubModuleCount = normalizeTemplateType(template) === 'club_card'
    ? clubModuleFeatures.filter((featureName) => featureEnabled(template, featureName)).length
    : null;

  if (featureEnabled(template, 'stamps')) {
    const stampCount = Number(card.stamp_count || 0);
    const stampsRequired = Number(template.stamps_required || 10);

    detailItems.push(`<div><dt>Stempel</dt><dd>${stampCount} / ${stampsRequired}</dd></div>`);
    editFields.unshift(`
      <label>Stempel
        <input id="stampCount" type="number" min="0" value="${stampCount}">
      </label>
    `);
    quickActions.push('<button type="button" class="secondary" data-action="stamp-plus">Stempel +</button>');
    quickActions.push('<button type="button" class="secondary" data-action="stamp-minus">Stempel -</button>');

    if (stampCount >= stampsRequired && card.status !== 'redeemed') {
      quickActions.push('<button type="button" class="secondary" data-action="stamp-redeem">Volle Karte einlösen</button>');
    }
  }

  if (featureEnabled(template, 'streak')) {
    const streakCount = Number(card.streak_count || 0);
    const streakGoal = Number(template.streak_goal || template.settings?.streakGoal || 0);

    detailItems.push(`<div><dt>Streak</dt><dd>${streakGoal ? `${streakCount} / ${streakGoal}` : streakCount}</dd></div>`);
    editFields.unshift(`
      <label>Streak
        <input id="streakCount" type="number" min="0" value="${streakCount}">
      </label>
    `);
    quickActions.push('<button type="button" class="secondary" data-action="streak-plus">Streak +</button>');
    quickActions.push('<button type="button" class="secondary" data-action="streak-reset">Streak reset</button>');

    if (streakGoal > 0 && streakCount >= streakGoal && card.status !== 'redeemed') {
      quickActions.push('<button type="button" class="secondary" data-action="streak-complete">Streak-Ziel erfüllen</button>');
    }
  }

  if (featureEnabled(template, 'vip')) {
    detailItems.push(`<div><dt>VIP</dt><dd>${escapeHtml(card.vip_status || template.vip_tier || 'Standard')}</dd></div>`);
    editFields.push(`
      <label>VIP-Status
        <input id="vipStatus" value="${escapeHtml(card.vip_status || '')}">
      </label>
      <label>VIP-Vorteil / Notiz
        <input id="vipBenefitLabel" value="${escapeHtml(template.settings?.vipNote || '')}">
      </label>
    `);
    quickActions.push('<button type="button" class="secondary" data-action="vip-update">VIP aktualisieren</button>');
    quickActions.push('<button type="button" class="secondary" data-action="vip-benefit-redeem">Vorteil einlösen</button>');
  }

  if (featureEnabled(template, 'balance')) {
    detailItems.push(`<div><dt>Guthaben</dt><dd>${escapeHtml(`${(balanceCents / 100).toFixed(2)} ${currency}`)}</dd></div>`);
    editFields.push(`
      <label>Guthaben in Rappen/Cents
        <input id="balanceCents" type="number" min="0" value="${balanceCents}">
      </label>
      <label>Abbuchung in Rappen/Cents
        <input id="balanceRedeemCents" type="number" min="1" value="100">
      </label>
    `);
    quickActions.push('<button type="button" class="secondary" data-action="balance-redeem">Guthaben abbuchen</button>');
    quickActions.push('<button type="button" class="secondary" data-action="balance-adjust">Guthaben korrigieren</button>');
  }

  if (featureEnabled(template, 'cloakroom')) {
    detailItems.push(`<div><dt>Garderobe</dt><dd>${cloakroomActive ? 'Aktiv' : 'Inaktiv'}</dd></div>`);
    quickActions.push(`<button type="button" class="secondary" data-action="cloakroom-toggle">${cloakroomActive ? 'Garderobenabholung' : 'Garderobenabgabe'}</button>`);
  }

  if (featureEnabled(template, 'visit')) {
    const visitCount = Number(card.metadata?.visit_count || 0);
    detailItems.push(`<div><dt>Besuche</dt><dd>${visitCount}</dd></div>`);
    quickActions.push('<button type="button" class="secondary" data-action="visit">Besuch erfassen</button>');
  }

  if (featureEnabled(template, 'checkin')) {
    const eventTicketStatus = card.metadata?.event_ticket_status || 'offen';
    detailItems.push(`<div><dt>Ticketstatus</dt><dd>${escapeHtml(eventTicketStatus)}</dd></div>`);
    quickActions.push('<button type="button" class="secondary" data-action="checkin">Check-in</button>');
    quickActions.push('<button type="button" class="secondary" data-action="event-checkout">Check-out</button>');
    quickActions.push('<button type="button" class="secondary" data-action="event-ticket-use">Ticket verwendet</button>');
  }

  if (featureEnabled(template, 'redemption')) {
    const couponStatus = card.metadata?.coupon_status || (card.status === 'redeemed' ? 'redeemed' : 'unused');

    detailItems.push(`<div><dt>Coupon</dt><dd>${escapeHtml(couponStatus)}</dd></div>`);
    quickActions.push('<button type="button" class="secondary" data-action="redeem">Coupon einlösen</button>');
  }

  if (featureEnabled(template, 'membership')) {
    const membershipStatus = card.metadata?.membership_status || template.settings?.membershipStatus || 'aktiv';
    const membershipExpiresAt = card.metadata?.membership_expires_at || template.settings?.membershipExpiresAt || '';

    detailItems.push(`<div><dt>Mitgliedschaft</dt><dd>${escapeHtml(membershipStatus)}</dd></div>`);

    if (membershipExpiresAt) {
      detailItems.push(`<div><dt>Ablaufdatum</dt><dd>${escapeHtml(membershipExpiresAt)}</dd></div>`);
    }

    editFields.push(`
      <label>Mitgliedsstatus
        <input id="membershipStatus" value="${escapeHtml(membershipStatus)}">
      </label>
      <label>Verlängern bis
        <input id="membershipExpiresAt" type="date" value="${escapeHtml(membershipExpiresAt)}">
      </label>
    `);
    quickActions.push('<button type="button" class="secondary" data-action="membership-check">Mitgliedschaft prüfen</button>');
    quickActions.push('<button type="button" class="secondary" data-action="membership-status-update">Status aendern</button>');
    quickActions.push('<button type="button" class="secondary" data-action="membership-extend">Verlängern</button>');
  }

  if (normalizeTemplateType(template) === 'club_card' && clubModuleCount === 0) {
    detailItems.push('<div><dt>Hinweis</dt><dd>Für diese Clubkarte sind noch keine Zusatzfunktionen aktiviert.</dd></div>');
  }

  cardPanel.hidden = false;
  cardPanel.innerHTML = `
    ${walletPreviewHtml(previewTemplate, previewCard)}
    <div class="panel-heading">
      <div>
        <p class="eyebrow">${escapeHtml(businessName)}</p>
        <h2>${escapeHtml(template.card_name || 'Kundenkarte')}</h2>
      </div>
      <span class="pill">${escapeHtml(cardTypeLabel(previewTemplate))}</span>
    </div>
    <dl class="detail-grid">
      ${detailItems.join('')}
    </dl>
    <div class="edit-grid">
      ${editFields.join('')}
    </div>
    <div class="button-row wrap">
      ${quickActions.join('')}
      <button type="button" class="primary" data-action="save">Speichern</button>
      ${appleWalletButton}
    </div>
  `;
}

function showAccessStatusModal(card = state.currentCard) {
  const template = card?.card_templates || {};
  const highlights = scannerAccessHighlights(template, card);

  if (!accessStatusModal || !accessStatusItems || !highlights.length) {
    return false;
  }

  accessStatusItems.innerHTML = highlights.map((highlight) => `
    <article class="access-status-card access-status-card-${escapeHtml(highlight.feature)}">
      <span class="access-status-icon" aria-hidden="true">${escapeHtml(highlight.iconText)}</span>
      <div>
        <p>${escapeHtml(highlight.label)}</p>
        <strong>${escapeHtml(highlight.value)}</strong>
        ${highlight.details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}
      </div>
    </article>
  `).join('');
  accessStatusModal.hidden = false;

  if (navigator.vibrate) {
    navigator.vibrate([120, 50, 120]);
  }

  return true;
}

function hideAccessStatusModal() {
  if (accessStatusModal) {
    accessStatusModal.hidden = true;
  }
}

function edgeFunctionUrl(functionName) {
  return `${state.client.supabaseUrl}/functions/v1/${functionName}`;
}

function appleIssueIdempotencyKey(cardInstance) {
  const marker = String(cardInstance.updated_at || state.currentCard?.updated_at || 'current')
    .replace(/[^a-zA-Z0-9.-]/g, '')
    .slice(0, 80);

  return `scanner-issue-${cardInstance.id}-${marker}`;
}

async function findAppleCardInstanceForCurrentCard() {
  const card = state.currentCard;

  if (!card) {
    throw new Error('Bitte zuerst eine Kundenkarte laden.');
  }

  const cardInstances = await state.client.selectRows('card_instances', {
    select: 'id,card_instance_number,wallet_platform,updated_at',
    filters: [
      { column: 'customer_card_id', op: 'eq', value: card.id },
      { column: 'wallet_platform', op: 'eq', value: 'apple' }
    ],
    limit: 1
  });
  const cardInstance = Array.isArray(cardInstances) ? cardInstances[0] : cardInstances;

  if (cardInstance?.id) {
    return cardInstance;
  }

  if ((card.wallet_platform || card.metadata?.wallet_platform) === 'apple') {
    return {
      id: card.id,
      card_instance_number: card.card_instance_number || card.metadata?.card_instance_number,
      wallet_platform: 'apple',
      updated_at: card.updated_at
    };
  }

  throw new Error('Zu dieser Kundenkarte ist keine Apple-Wallet-Instanz gespeichert.');
}

async function downloadPkpassResponse(response, fileName) {
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok || !contentType.includes('application/vnd.apple.pkpass')) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error_message || details.error || 'Apple-Wallet-Datei konnte nicht erstellt werden.');
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

async function downloadCurrentApplePass() {
  const session = await state.client.ensureSession();

  if (!session) {
    throw new Error('Bitte erneut einloggen.');
  }

  const cardInstance = await findAppleCardInstanceForCurrentCard();
  const idempotencyKey = appleIssueIdempotencyKey(cardInstance);
  const response = await fetch(edgeFunctionUrl('issue-apple-pass'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: state.client.anonKey,
      Authorization: `Bearer ${session.access_token}`,
      'idempotency-key': idempotencyKey
    },
    body: JSON.stringify({
      cardInstanceId: cardInstance.id,
      idempotencyKey
    })
  });

  await downloadPkpassResponse(
    response,
    `${cardInstance.card_instance_number || state.currentCard.customer_code || 'wallet-card'}.pkpass`
  );
}

async function fetchTemplate(templateId) {
  return state.client.selectRows('card_templates', {
    select: templateScannerSelect,
    filters: [
      { column: 'id', op: 'eq', value: templateId }
    ],
    maybeSingle: true
  });
}

async function loadCardInstanceForCard(card) {
  const filters = [
    { column: 'customer_card_id', op: 'eq', value: card.id }
  ];

  try {
    return await state.client.selectRows('card_instances', {
      select: cardInstanceScannerSelect,
      filters,
      maybeSingle: true
    });
  } catch (error) {
    const message = String(error?.message || '');

    if (!message.includes('resolved_emblem') && !message.includes('emblem_updated_at')) {
      throw error;
    }
  }

  return state.client.selectRows('card_instances', {
    select: cardInstanceScannerBaseSelect,
    filters,
    maybeSingle: true
  }).catch(() => null);
}

async function loadCardByCode(rawCode) {
  const code = normalizeCode(rawCode);

  if (!code) {
    showMessage(scannerMessage, t('scanner.enterCode'), 'error');
    return;
  }

  showMessage(scannerMessage, t('scanner.loadingCard'));

  let card = await state.client.selectRows('customer_cards', {
    select: customerCardScannerSelect,
    filters: [
      { column: 'customer_code', op: 'eq', value: code }
    ],
    maybeSingle: true
  });

  if (!card) {
    card = await state.client.selectRows('customer_cards', {
      select: customerCardScannerSelect,
      filters: [
        { column: 'card_instance_number', op: 'eq', value: code }
      ],
      maybeSingle: true
    }).catch(() => null);
  }

  if (!card) {
    showMessage(scannerMessage, t('scanner.noCard'), 'error');
    return;
  }

  if (!card.card_templates) {
    card.card_templates = await fetchTemplate(card.template_id);
  }

  state.currentCard = card;
  state.currentCardInstance = await loadCardInstanceForCard(card);
  state.originalCard = structuredClone(card);
  renderCard();
  showAccessStatusModal(card);
  showMessage(scannerMessage, t('scanner.cardLoaded'), 'success');
}

function readEditedCard() {
  const template = state.currentCard?.card_templates || {};
  const updates = {
    status: byId('cardStatus')?.value || 'active'
  };

  if (featureEnabled(template, 'stamps')) {
    updates.stamp_count = Math.max(0, Number(byId('stampCount')?.value || 0));
  }

  if (featureEnabled(template, 'streak')) {
    updates.streak_count = Math.max(0, Number(byId('streakCount')?.value || 0));
  }

  if (featureEnabled(template, 'vip')) {
    updates.vip_status = byId('vipStatus')?.value || null;
  }

  if (featureEnabled(template, 'balance')) {
    updates.balance_cents = Math.max(0, Number(byId('balanceCents')?.value || 0));
  }

  return updates;
}

async function saveCard() {
  const updates = readEditedCard();
  await runScannerAction('manual_update', { updates });
}

async function callScannerActionApi(action, payload = {}) {
  const session = await state.client.ensureSession();

  if (!session) {
    throw {
      error_code: 'AUTH_REQUIRED',
      error_message: 'Bitte erneut einloggen.',
      error_reason: 'Die lokale Session ist abgelaufen.'
    };
  }

  const requestBody = {
    cardId: state.currentCard.id,
    action,
    ...payload
  };

  try {
    return await callScannerActionEdge(requestBody, session);
  } catch (error) {
    if (!error.fallbackToLocal) {
      throw error;
    }

    return callScannerActionLocal(requestBody, session);
  }
}

function shouldFallbackToLocalScanner(response, result) {
  return Boolean(
    response.status === 501
      || (response.status === 404 && !result.error_code)
      || result.error_code === 'SUPABASE_EDGE_CONFIG_MISSING'
  );
}

async function callScannerActionEdge(requestBody, session) {
  let response;

  try {
    response = await fetch(`${state.client.supabaseUrl}/functions/v1/scanner-actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: state.client.anonKey,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    error.fallbackToLocal = true;
    throw error;
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (shouldFallbackToLocalScanner(response, result)) {
      const error = new Error(result.error_message || result.error || 'Scanner Edge Function ist nicht erreichbar.');
      error.fallbackToLocal = true;
      throw error;
    }

    throw result;
  }

  return {
    ...result,
    source: 'edge'
  };
}

async function callScannerActionLocal(requestBody, session) {
  const response = await fetch(apiUrl('/api/scanner/actions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify(requestBody)
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw result;
  }

  return {
    ...result,
    source: 'local'
  };
}

function clubFeatureBadges(features = {}) {
  return Object.entries(clubFeatureBadgeLabels)
    .filter(([featureName]) => Boolean(features?.[featureName]))
    .map(([, label]) => `<span class="badge">${escapeHtml(label)}</span>`)
    .join('');
}

function showDemographicsModal(result, action, payload) {
  stopCamera();
  state.pendingDemographicsAction = action;
  state.pendingDemographicsPayload = { ...payload };

  if (demographicsForm) {
    demographicsForm.reset();
  }

  if (demographicsTemplateType) {
    demographicsTemplateType.textContent = result.template_type === 'club_card'
      ? 'Clubkarte Erstscan'
      : 'Erstscan';
  }

  const activeClubFeatures = result.active_club_features || result.club_features || {};

  if (demographicsClubInfo && demographicsClubBadges) {
    const badges = clubFeatureBadges(activeClubFeatures);
    demographicsClubInfo.hidden = result.template_type !== 'club_card';
    demographicsClubBadges.innerHTML = badges || '<span class="badge">Keine Zusatzmodule</span>';
  }

  if (demographicsMessage) {
    demographicsMessage.hidden = true;
    demographicsMessage.textContent = '';
  }

  if (demographicsModal) {
    demographicsModal.hidden = false;
  }

  showMessage(scannerMessage, result.message || 'Bitte zuerst Geschlecht und Altersgruppe erfassen.', 'info');
}

function hideDemographicsModal() {
  if (demographicsModal) {
    demographicsModal.hidden = true;
  }
}

function applyScannerActionResult(result) {
  state.currentCard = result.card;
  state.currentCardInstance = result.card_instance || null;
  state.originalCard = structuredClone(state.currentCard);
  renderCard();
}

async function continuePendingDemographics(event) {
  event.preventDefault();

  if (!state.pendingDemographicsAction) {
    hideDemographicsModal();
    return;
  }

  const formData = new FormData(demographicsForm);
  const demographics = {
    gender: String(formData.get('gender') || ''),
    age_group: String(formData.get('age_group') || '')
  };

  if (!demographics.gender || !demographics.age_group) {
    showMessage(demographicsMessage, 'Bitte Geschlecht und Altersgruppe auswählen.', 'error');
    return;
  }

  showMessage(demographicsMessage, 'Erstscan wird gespeichert ...');

  const action = state.pendingDemographicsAction;
  const payload = {
    ...state.pendingDemographicsPayload,
    demographics
  };
  const result = await callScannerActionApi(action, payload);

  if (result.requires_demographics) {
    showMessage(demographicsMessage, result.message || 'Demografie-Daten fehlen noch.', 'error');
    return;
  }

  state.pendingDemographicsAction = null;
  state.pendingDemographicsPayload = null;
  hideDemographicsModal();
  applyScannerActionResult(result);
  showMessage(
    scannerMessage,
    result.emblem_update?.queued
      ? 'Erstscan gespeichert. Wallet-Update für das neue Emblem wurde vorgemerkt.'
      : 'Erstscan gespeichert und Aktion ausgeführt.',
    'success'
  );
}

async function runScannerAction(action, payload = {}) {
  const template = state.currentCard?.card_templates || {};
  const validation = validateScannerAction(template, action);
  const actionToSend = action === 'manual_update' ? action : validation.action;

  if (action !== 'manual_update' && !validation.allowed) {
    showBlockedScannerAction(validation);
    return;
  }

  showMessage(scannerMessage, 'Scanner-Aktion wird gespeichert ...');
  const result = await callScannerActionApi(actionToSend, payload);

  if (result.requires_demographics) {
    showDemographicsModal(result, actionToSend, payload);
    return;
  }

  applyScannerActionResult(result);
  showMessage(
    scannerMessage,
    result.emblem_update?.queued
      ? 'Scanner-Aktion gespeichert. Wallet-Update für das neue Emblem wurde vorgemerkt.'
      : 'Scanner-Aktion gespeichert. Die Wallet-Datei enthält beim erneuten Laden den aktuellen Supabase-Stand.',
    'success'
  );
}

function showBlockedScannerAction(validation) {
  if (scannerResetTimer) {
    clearTimeout(scannerResetTimer);
  }

  showMessage(scannerMessage, `${validation.error_message} ${validation.error_reason}`, 'error');
  scannerMessage.classList.add('scanner-blocked');

  if (navigator.vibrate) {
    navigator.vibrate([80, 40, 80]);
  }

  scannerResetTimer = setTimeout(() => {
    scannerMessage.classList.remove('scanner-blocked');
  }, 3500);
}

function showScannerActionError(error) {
  showBlockedScannerAction({
    error_message: error.error_message || error.error || 'Scanner-Aktion fehlgeschlagen.',
    error_reason: error.error_reason || 'Bitte prüfe den Kartentyp und versuche es erneut.'
  });
}

function loadJsQrDecoder() {
  if (window.jsQR) {
    return Promise.resolve(window.jsQR);
  }

  if (jsQrLoaderPromise) {
    return jsQrLoaderPromise;
  }

  jsQrLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = JSQR_CDN_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if (window.jsQR) {
        resolve(window.jsQR);
        return;
      }

      reject(new Error('QR-Decoder konnte nicht geladen werden.'));
    };
    script.onerror = () => reject(new Error('QR-Decoder konnte nicht geladen werden. Bitte Internetverbindung prüfen oder den Kundencode manuell eingeben.'));
    document.head.append(script);
  });

  return jsQrLoaderPromise;
}

function cameraErrorMessage(error) {
  const name = String(error?.name || '');

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Kamera-Zugriff wurde verweigert. Bitte erlaube Kamera-Zugriff im Browser und starte den Scan erneut.';
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Keine Kamera gefunden. Bitte Kundencode manuell eingeben.';
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Kamera ist gerade nicht verfügbar. Bitte andere Kamera-Apps schliessen und erneut versuchen.';
  }

  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
    return 'Kamera-Scan benötigt HTTPS. Bitte die Render-Seite über https öffnen.';
  }

  return error?.message || 'Kamera konnte nicht gestartet werden. Bitte Kundencode manuell eingeben.';
}

function decodeFrameWithJsQr() {
  if (!window.jsQR || !video?.videoWidth || !video?.videoHeight) {
    return '';
  }

  if (!state.scanCanvas) {
    state.scanCanvas = document.createElement('canvas');
    state.scanCanvasContext = state.scanCanvas.getContext('2d', { willReadFrequently: true });
  }

  const canvas = state.scanCanvas;
  const context = state.scanCanvasContext;

  if (!context) {
    return '';
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth'
  });

  return code?.data || '';
}

async function scanFrame() {
  if (!video || video.readyState < 2 || state.scanInProgress) {
    return;
  }

  state.scanInProgress = true;

  try {
    let rawValue = '';

    if (state.detector) {
      const codes = await state.detector.detect(video).catch(() => []);
      rawValue = codes[0]?.rawValue || '';
    } else if (state.scannerMode === 'jsqr') {
      rawValue = decodeFrameWithJsQr();
    }

    if (!rawValue) {
      return;
    }

    stopCamera();
    await loadCardByCode(rawValue);
  } finally {
    state.scanInProgress = false;
  }
}

function scheduleJsQrScanLoop() {
  state.scanAnimationFrame = requestAnimationFrame(async () => {
    await scanFrame().catch((error) => showMessage(scannerMessage, error.message, 'error'));

    if (state.stream && state.scannerMode === 'jsqr') {
      scheduleJsQrScanLoop();
    }
  });
}

async function startCamera() {
  stopCamera();

  if (!navigator.mediaDevices?.getUserMedia) {
    showMessage(scannerMessage, t('scanner.cameraUnavailable', 'Kamera-Zugriff ist in diesem Browser nicht verfügbar. Bitte Kundencode manuell eingeben.'), 'error');
    return;
  }

  showMessage(scannerMessage, t('scanner.cameraStarting', 'Kamera wird gestartet ...'));

  let detector = null;

  if ('BarcodeDetector' in window) {
    try {
      detector = new BarcodeDetector({ formats: ['qr_code'] });
    } catch {
      detector = null;
    }
  }

  if (!detector) {
    await loadJsQrDecoder();
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
  } catch (error) {
    showMessage(scannerMessage, cameraErrorMessage(error), 'error');
    return;
  }

  video.srcObject = state.stream;

  try {
    await video.play();
  } catch (error) {
    stopCamera();
    showMessage(scannerMessage, cameraErrorMessage(error), 'error');
    return;
  }

  state.detector = detector;
  state.scannerMode = detector ? 'barcode-detector' : 'jsqr';

  if (state.detector) {
    state.scanTimer = setInterval(() => {
      scanFrame().catch((error) => showMessage(scannerMessage, error.message, 'error'));
    }, 500);
  } else {
    scheduleJsQrScanLoop();
  }

  showMessage(
    scannerMessage,
    state.scannerMode === 'jsqr'
      ? t('scanner.activeJsqr', 'Scanner aktiv. Mobile QR-Erkennung ist eingeschaltet.')
      : t('scanner.active', 'Scanner aktiv.'),
    'success'
  );
}

async function initScanner() {
  setupLanguageSelectors(document);

  const context = await requireLogin({ requireUnlock: true });

  if (!context) {
    return;
  }

  state.client = context.client;
  state.session = context.session;
  await loadBusinessHeader();

  byId('startScanner')?.addEventListener('click', () => {
    startCamera().catch((error) => showMessage(scannerMessage, error.message, 'error'));
  });

  byId('stopScanner')?.addEventListener('click', stopCamera);

  accessStatusClose?.addEventListener('click', hideAccessStatusModal);

  scannerOnlyLogoutButton?.addEventListener('click', async () => {
    await state.client.signOut();
    window.location.replace(pagePath('index.html'));
  });

  manualForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(manualForm);
    loadCardByCode(formData.get('customer_code')).catch((error) => showMessage(scannerMessage, error.message, 'error'));
  });

  demographicsForm?.addEventListener('submit', (event) => {
    continuePendingDemographics(event).catch((error) => {
      showMessage(demographicsMessage, error.error_message || error.message || 'Erstscan konnte nicht gespeichert werden.', 'error');
    });
  });

  cardPanel?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');

    if (!button) {
      return;
    }

    if (button.dataset.action === 'save') {
      saveCard().catch(showScannerActionError);
      return;
    }

    if (button.dataset.action === 'download-apple-pass') {
      showMessage(scannerMessage, 'Apple-Wallet-Datei wird über Supabase Edge erstellt ...');
      downloadCurrentApplePass()
        .then(() => showMessage(scannerMessage, 'Aktuelle Wallet-Datei wurde erstellt.', 'success'))
        .catch((error) => showMessage(scannerMessage, error.message, 'error'));
      return;
    }

    const payload = {};

    const normalizedAction = normalizeScannerAction(button.dataset.action);

    if (normalizedAction === 'vip-update') {
      payload.vipStatus = byId('vipStatus')?.value || null;
    }

    if (normalizedAction === 'vip-benefit-redeem') {
      payload.vipBenefitLabel = byId('vipBenefitLabel')?.value || null;
    }

    if (normalizedAction === 'balance-redeem') {
      payload.amountCents = Math.max(0, Number(byId('balanceRedeemCents')?.value || 0));
    }

    if (normalizedAction === 'balance-adjust') {
      payload.balanceCents = Math.max(0, Number(byId('balanceCents')?.value || 0));
    }

    if (normalizedAction === 'membership-status-update') {
      payload.membershipStatus = byId('membershipStatus')?.value || null;
    }

    if (normalizedAction === 'membership-extend') {
      payload.membershipExpiresAt = byId('membershipExpiresAt')?.value || null;
    }

    runScannerAction(button.dataset.action, payload).catch(showScannerActionError);
  });

  const initialCode = new URLSearchParams(window.location.search).get('code');

  if (initialCode) {
    loadCardByCode(initialCode).catch((error) => showMessage(scannerMessage, error.message, 'error'));
  }
}

window.addEventListener('beforeunload', stopCamera);

initScanner().catch((error) => {
  showMessage(scannerMessage, error.message, 'error');
});
