import { requireLogin } from './guards.js';
import { appUrl, apiUrl } from './config.js';
import { setupLanguageSelectors, t } from './i18n.js';
import { pagePath } from './path.js';
import { businessLogoUrl, byId, cardTypeLabel, escapeHtml, renderBusinessHeader, showMessage } from './ui.js';
import { cardFeatureRows, featureEnabled, templateFeatureSummary } from './templateFeatures.js';

const state = {
  client: null,
  session: null,
  profile: null,
  business: null,
  templates: [],
  customerCards: [],
  customerCardsExpanded: false,
  customerCardFilters: {
    search: '',
    template: 'all',
    type: 'all',
    status: 'all',
    wallet: 'all',
    sort: 'created_desc'
  },
  statisticsLoaded: false,
  currentStatistics: null,
  chartViews: {}
};

const businessDashboardSelect = [
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

const templateDashboardSelect = [
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

const customerCardDashboardSelect = [
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

const dashboardMessage = byId('dashboardMessage');
const templateList = byId('templateList');
const customerCardList = byId('customerCardList');
const statsFilterForm = byId('statsFilterForm');
const statsPeriod = byId('statsPeriod');
const statsTemplateType = byId('statsTemplateType');
const statsHourRange = byId('statsHourRange');
const statsClubFeatureField = byId('statsClubFeatureField');
const refreshStatsButton = byId('refreshStatsButton');
const statsMessage = byId('statsMessage');
const statsKpiGrid = byId('statsKpiGrid');
const statsCharts = byId('statsCharts');
const lastScansTable = byId('lastScansTable');
const dashboardTabs = Array.from(document.querySelectorAll('[data-dashboard-tab]'));
const dashboardPagePanels = Array.from(document.querySelectorAll('[data-dashboard-page]'));
const statsClubFeatureLabels = {
  vip: 'VIP',
  balance: 'Guthaben',
  cloakroom: 'Garderobe',
  coupon: 'Coupon',
  membership: 'Mitgliedschaft'
};
const statsGenderLabels = {
  male: 'Männlich',
  female: 'Weiblich'
};
const statsAgeLabels = {
  '18_plus': '18+',
  '25_plus': '25+',
  '30_plus': '30+'
};
const CHART_VIEW_LABELS = {
  bar: 'Balken',
  horizontal_bar: 'Horizontale Balken',
  pie: 'Kuchen',
  donut: 'Donut',
  line: 'Linie',
  stacked_bar: 'Gestapelte Balken',
  grouped_bar: 'Gruppierte Balken',
  heatmap: 'Heatmap',
  table: 'Tabelle'
};

function templateClaimUrl(template) {
  const claimToken = String(template?.public_claim_token || '').trim();

  return claimToken
    ? appUrl(`/claim.html?token=${encodeURIComponent(claimToken)}`)
    : appUrl(`/claim.html?template=${encodeURIComponent(template.id)}`);
}
const CHART_VIEW_OPTIONS = {
  gender_distribution: {
    default: 'donut',
    allowed: ['bar', 'pie', 'donut', 'table']
  },
  age_group_distribution: {
    default: 'bar',
    allowed: ['bar', 'pie', 'donut', 'table']
  },
  scans_by_hour: {
    default: 'bar',
    allowed: ['bar', 'line', 'heatmap', 'table']
  },
  scans_by_weekday: {
    default: 'bar',
    allowed: ['bar', 'line', 'table']
  },
  scans_over_time: {
    default: 'line',
    allowed: ['line', 'bar', 'table']
  },
  gender_age_matrix: {
    default: 'grouped_bar',
    allowed: ['grouped_bar', 'stacked_bar', 'table']
  },
  first_vs_repeat: {
    default: 'donut',
    allowed: ['donut', 'pie', 'bar', 'table']
  },
  template_type_distribution: {
    default: 'bar',
    allowed: ['bar', 'horizontal_bar', 'pie', 'donut', 'table']
  },
  club_feature_distribution: {
    default: 'bar',
    allowed: ['bar', 'horizontal_bar', 'pie', 'donut', 'table']
  },
  club_feature_combinations: {
    default: 'horizontal_bar',
    allowed: ['horizontal_bar', 'bar', 'table']
  },
  weekday_hour_heatmap: {
    default: 'heatmap',
    allowed: ['heatmap', 'bar', 'table']
  },
  last_scans: {
    default: 'table',
    allowed: ['table']
  }
};
const CHART_DEFINITIONS = [
  ['gender_distribution', 'Geschlechterverteilung'],
  ['age_group_distribution', 'Altersgruppen'],
  ['scans_by_hour', 'Scans nach Uhrzeit'],
  ['scans_by_weekday', 'Scans nach Wochentag'],
  ['scans_over_time', 'Scans im Zeitverlauf'],
  ['gender_age_matrix', 'Geschlecht + Altersgruppe'],
  ['first_vs_repeat', 'Erstbesuche vs. Wiederholungen'],
  ['template_type_distribution', 'Kartentyp-Verteilung'],
  ['club_feature_distribution', 'Clubkarten-Modul-Nutzung'],
  ['club_feature_combinations', 'Clubkarten-Kombinationen'],
  ['weekday_hour_heatmap', 'Besucher-Heatmap']
];
const CHART_EMPTY_TEXT = 'Für den gewählten Zeitraum sind noch keine Scans vorhanden.';
const AGE_GROUP_ORDER = ['18_plus', '25_plus', '30_plus'];
const GENDER_ORDER = ['male', 'female'];
const CHART_COLORS = ['#8b4f2f', '#d6b889', '#b97845', '#6f3c23', '#e7d3af', '#8a6148', '#c9955f', '#ab8f78'];

function setDashboardTabState(activeTab) {
  dashboardTabs.forEach((tab) => {
    const isActive = tab.dataset.dashboardTab === activeTab;
    tab.classList.toggle('is-active', isActive);

    if (isActive) {
      tab.setAttribute('aria-current', 'page');
    } else {
      tab.removeAttribute('aria-current');
    }
  });

  dashboardPagePanels.forEach((panel) => {
    panel.hidden = panel.dataset.dashboardPage !== activeTab;
  });
}

function dashboardTabFromHash() {
  return window.location.hash === '#visitorStatistics' ? 'statistics' : 'dashboard';
}

async function showDashboardTab(activeTab, { updateUrl = false } = {}) {
  const normalizedTab = activeTab === 'statistics' ? 'statistics' : 'dashboard';
  const nextHash = normalizedTab === 'statistics' ? '#visitorStatistics' : '#dashboardOverview';

  setDashboardTabState(normalizedTab);

  if (updateUrl && window.location.hash !== nextHash) {
    window.history.pushState({}, '', `${window.location.pathname}${nextHash}`);
  }

  window.scrollTo({ top: 0, behavior: 'auto' });

  if (normalizedTab === 'statistics' && !state.statisticsLoaded) {
    await loadVisitorStatistics();
  }
}

function initDashboardTabs() {
  if (!dashboardTabs.length) {
    return;
  }

  dashboardTabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      showDashboardTab(tab.dataset.dashboardTab || 'dashboard', { updateUrl: true })
        .catch((error) => showMessage(statsMessage || dashboardMessage, error.error_message || error.message, 'error'));
    });
  });

  window.addEventListener('hashchange', () => {
    showDashboardTab(dashboardTabFromHash())
      .catch((error) => showMessage(statsMessage || dashboardMessage, error.error_message || error.message, 'error'));
  });
  window.addEventListener('popstate', () => {
    showDashboardTab(dashboardTabFromHash())
      .catch((error) => showMessage(statsMessage || dashboardMessage, error.error_message || error.message, 'error'));
  });

  setDashboardTabState(dashboardTabFromHash());
}

async function loadBusiness() {
  state.business = await state.client.selectRows('businesses', {
    select: businessDashboardSelect,
    filters: [
      { column: 'owner_id', op: 'eq', value: state.session.user.id }
    ],
    maybeSingle: true
  });

  renderBusinessHeader(state.business || {});
}

async function loadTemplates() {
  state.templates = await state.client.selectRows('card_templates', {
    select: templateDashboardSelect,
    filters: [
      { column: 'owner_id', op: 'eq', value: state.session.user.id }
    ],
    order: 'created_at.desc'
  });

  renderTemplates();
}

async function loadCustomerCards() {
  state.customerCards = await state.client.selectRows('customer_cards', {
    select: customerCardDashboardSelect,
    filters: [
      { column: 'owner_id', op: 'eq', value: state.session.user.id }
    ],
    order: 'created_at.desc',
    limit: 100
  });

  renderCustomerCards();
}

function renderTemplates() {
  if (!templateList) {
    return;
  }

  if (!state.templates.length) {
    templateList.innerHTML = `<div class="empty-state">${escapeHtml(t('dashboard.noTemplates'))}</div>`;
    return;
  }

  const businessName = String(state.business?.name || '').trim();
  const logoUrl = businessLogoUrl(state.business || {});

  const rows = state.templates.map((template) => {
    const claimUrl = templateClaimUrl(template);
    const editorUrl = pagePath(`editor.html?template=${encodeURIComponent(template.id)}`);
    const qrUrl = apiUrl(`/api/qrcode?text=${encodeURIComponent(claimUrl)}`);
    const pdfA4Url = apiUrl(`/api/templates/${encodeURIComponent(template.id)}/qr.pdf?format=a4`);
    const pdfA5Url = apiUrl(`/api/templates/${encodeURIComponent(template.id)}/qr.pdf?format=a5`);

    return `
      <tr class="cards-table-row" data-editor-url="${escapeHtml(editorUrl)}">
        <td>
          <div class="card-title-cell">
            ${logoUrl ? `<img class="card-table-icon" src="${escapeHtml(logoUrl)}" alt="">` : '<span class="card-table-icon card-table-icon-empty"></span>'}
            <div>
              <strong>${escapeHtml(template.card_name)}</strong>
              <span>${escapeHtml(businessName || template.business_name || t('dashboard.withoutBusiness'))}</span>
            </div>
          </div>
        </td>
        <td><span class="pill">${escapeHtml(cardTypeLabel(template))}</span></td>
        <td>${escapeHtml(templateFeatureSummary(template))}</td>
        <td>${escapeHtml(template.reward_text || '-')}</td>
        <td>${template.is_active ? t('dashboard.active') : t('dashboard.inactive')}</td>
        <td>
          <img class="table-qr" src="${qrUrl}" alt="QR-Code für ${escapeHtml(template.card_name)}">
        </td>
        <td class="actions-cell">
          <select
            class="action-select"
            data-template-action
            data-editor-url="${escapeHtml(editorUrl)}"
            data-claim-url="${escapeHtml(claimUrl)}"
            data-qr-url="${escapeHtml(qrUrl)}"
            data-qr-filename="qr-${escapeHtml(template.card_name)}.svg"
            data-pdf-a4-url="${escapeHtml(pdfA4Url)}"
            data-pdf-a5-url="${escapeHtml(pdfA5Url)}"
            aria-label="${escapeHtml(t('dashboard.actions'))} ${escapeHtml(template.card_name)}"
          >
            <option value="">${escapeHtml(t('dashboard.actions'))}</option>
            <option value="edit">${escapeHtml(t('dashboard.edit'))}</option>
            <option value="copy-link">${escapeHtml(t('dashboard.copyClaimLink'))}</option>
            <option value="qr-download">${escapeHtml(t('dashboard.downloadQr'))}</option>
            <option value="pdf-a4">${escapeHtml(t('dashboard.openPdfA4'))}</option>
            <option value="pdf-a5">${escapeHtml(t('dashboard.openPdfA5'))}</option>
          </select>
        </td>
      </tr>
    `;
  }).join('');

  templateList.innerHTML = `
    <div class="table-panel">
      <table class="cards-table">
        <thead>
          <tr>
            <th>${escapeHtml(t('dashboard.card'))}</th>
            <th>${escapeHtml(t('dashboard.type'))}</th>
            <th>${escapeHtml(t('dashboard.function'))}</th>
            <th>${escapeHtml(t('dashboard.reward'))}</th>
            <th>${escapeHtml(t('dashboard.status'))}</th>
            <th>QR</th>
            <th>${escapeHtml(t('dashboard.actions'))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function formatBalance(card, template) {
  if (!featureEnabled(template, 'balance')) {
    return '-';
  }

  const cents = Number(card.balance_cents ?? card.metadata?.balance_cents ?? 0);
  const currency = card.currency || template.settings?.currency || 'CHF';

  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function customerCardIdentity(card) {
  return card.card_instance_number || card.metadata?.card_instance_number || card.customer_code || '-';
}

function normalizedText(value) {
  return String(value || '').trim().toLowerCase();
}

function dateTimeValue(value) {
  const time = new Date(value || 0).getTime();

  return Number.isFinite(time) ? time : 0;
}

function formatDashboardDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat(document.documentElement.lang || 'de-CH', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function customerCardStatusLabel(status) {
  const value = normalizedText(status || 'active');

  if (value === 'active' || value === 'issued') {
    return t('dashboard.active');
  }

  if (value === 'inactive') {
    return t('dashboard.inactive');
  }

  return status || t('dashboard.active');
}

function walletPlatformLabel(platform) {
  const value = normalizedText(platform);

  if (value === 'apple') {
    return 'Apple Wallet';
  }

  if (value === 'google') {
    return 'Google Wallet';
  }

  if (value === 'samsung') {
    return 'Samsung Wallet';
  }

  if (!value) {
    return t('dashboard.walletUnknown');
  }

  return platform;
}

function filterOptions(cards, valueFor, labelFor) {
  const options = new Map();

  cards.forEach((card) => {
    const value = String(valueFor(card) || '').trim();

    if (!value) {
      return;
    }

    options.set(value, labelFor(card, value));
  });

  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, document.documentElement.lang || 'de-CH'));
}

function renderFilterOptions(options, selectedValue, allLabel) {
  return [
    `<option value="all">${escapeHtml(allLabel)}</option>`,
    ...options.map((option) => `
      <option value="${escapeHtml(option.value)}"${option.value === selectedValue ? ' selected' : ''}>${escapeHtml(option.label)}</option>
    `)
  ].join('');
}

function customerCardMatchesFilters(card) {
  const filters = state.customerCardFilters;
  const template = card.card_templates || {};
  const cardNumber = customerCardIdentity(card);
  const templateType = String(template.template_type || template.card_type || '').trim();
  const status = String(card.status || 'active').trim();
  const wallet = String(card.wallet_platform || '').trim();
  const walletFilterValue = wallet || '_none';
  const featureSummary = cardFeatureRows(template, card)
    .map((row) => `${row.label}: ${row.value}`)
    .join(' ');
  const searchText = normalizedText([
    cardNumber,
    card.customer_code,
    template.card_name,
    cardTypeLabel(template),
    status,
    walletPlatformLabel(wallet),
    featureSummary
  ].join(' '));
  const search = normalizedText(filters.search);

  return (!search || searchText.includes(search))
    && (filters.template === 'all' || String(template.id || '') === filters.template)
    && (filters.type === 'all' || templateType === filters.type)
    && (filters.status === 'all' || status === filters.status)
    && (filters.wallet === 'all' || walletFilterValue === filters.wallet);
}

function sortCustomerCards(cards) {
  const sorted = [...cards];
  const sort = state.customerCardFilters.sort;

  sorted.sort((a, b) => {
    const templateA = a.card_templates || {};
    const templateB = b.card_templates || {};

    if (sort === 'created_asc') {
      return dateTimeValue(a.created_at) - dateTimeValue(b.created_at);
    }

    if (sort === 'last_scan_desc') {
      return dateTimeValue(b.last_scanned_at) - dateTimeValue(a.last_scanned_at)
        || dateTimeValue(b.created_at) - dateTimeValue(a.created_at);
    }

    if (sort === 'template_asc') {
      return String(templateA.card_name || '').localeCompare(String(templateB.card_name || ''), document.documentElement.lang || 'de-CH')
        || String(customerCardIdentity(a)).localeCompare(String(customerCardIdentity(b)), document.documentElement.lang || 'de-CH');
    }

    if (sort === 'code_asc') {
      return String(customerCardIdentity(a)).localeCompare(String(customerCardIdentity(b)), document.documentElement.lang || 'de-CH');
    }

    return dateTimeValue(b.created_at) - dateTimeValue(a.created_at);
  });

  return sorted;
}

function customerCardFilterFocusState(field) {
  return {
    name: field.name,
    selectionStart: field.selectionStart,
    selectionEnd: field.selectionEnd
  };
}

function restoreCustomerCardFilterFocus(focusState) {
  if (!focusState?.name || !customerCardList) {
    return;
  }

  const field = customerCardList.querySelector(`[data-customer-card-filter][name="${focusState.name}"]`);

  if (!field) {
    return;
  }

  field.focus({ preventScroll: true });

  if (
    typeof field.setSelectionRange === 'function'
    && Number.isInteger(focusState.selectionStart)
    && Number.isInteger(focusState.selectionEnd)
  ) {
    field.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
  }
}

function updateCustomerCardFilter(field) {
  if (!field?.name || !(field.name in state.customerCardFilters)) {
    return;
  }

  const focusState = customerCardFilterFocusState(field);
  state.customerCardFilters[field.name] = field.value;
  renderCustomerCards({ focusState });
}

function resetCustomerCardFilters() {
  state.customerCardFilters = {
    search: '',
    template: 'all',
    type: 'all',
    status: 'all',
    wallet: 'all',
    sort: 'created_desc'
  };
  renderCustomerCards();
}

function renderCustomerCards({ focusState = null } = {}) {
  if (!customerCardList) {
    return;
  }

  const existingDisclosure = customerCardList.querySelector('[data-customer-card-disclosure]');

  if (existingDisclosure) {
    state.customerCardsExpanded = existingDisclosure.open;
  }

  if (!state.customerCards.length) {
    customerCardList.innerHTML = `<div class="empty-state">${escapeHtml(t('dashboard.noCustomers'))}</div>`;
    return;
  }

  const logoUrl = businessLogoUrl(state.business || {});
  const filters = state.customerCardFilters;
  const templateOptions = filterOptions(
    state.customerCards,
    (card) => card.card_templates?.id,
    (card) => card.card_templates?.card_name || t('dashboard.templateMissing')
  );
  const typeOptions = filterOptions(
    state.customerCards,
    (card) => card.card_templates?.template_type || card.card_templates?.card_type,
    (card) => cardTypeLabel(card.card_templates || {})
  );
  const statusOptions = filterOptions(
    state.customerCards,
    (card) => card.status || 'active',
    (card, value) => customerCardStatusLabel(value)
  );
  const walletOptions = filterOptions(
    state.customerCards,
    (card) => card.wallet_platform || '_none',
    (card, value) => value === '_none' ? t('dashboard.walletUnknown') : walletPlatformLabel(value)
  );
  const filteredCards = sortCustomerCards(state.customerCards.filter(customerCardMatchesFilters));
  const resultSummary = `${filteredCards.length} ${t('dashboard.of')} ${state.customerCards.length}`;
  const rows = filteredCards.map((card) => {
    const template = card.card_templates || {};
    const cardNumber = customerCardIdentity(card);
    const featureSummary = cardFeatureRows(template, card)
      .map((row) => `${row.label}: ${row.value}`)
      .join(' · ');
    const scannerUrl = pagePath(`scanner.html?code=${encodeURIComponent(cardNumber)}`);
    const status = card.status || 'active';
    const wallet = card.wallet_platform || '';

    return `
      <tr class="cards-table-row" data-scanner-url="${escapeHtml(scannerUrl)}">
        <td>
          <div class="card-title-cell">
            ${logoUrl ? `<img class="card-table-icon" src="${escapeHtml(logoUrl)}" alt="">` : '<span class="card-table-icon card-table-icon-empty"></span>'}
            <div>
              <strong>${escapeHtml(cardNumber)}</strong>
              <span>${escapeHtml(card.customer_code || '-')}</span>
            </div>
          </div>
        </td>
        <td>
          <strong>${escapeHtml(template.card_name || t('dashboard.templateMissing'))}</strong>
          <span class="table-subtext">${escapeHtml(cardTypeLabel(template))}</span>
        </td>
        <td><span class="pill">${escapeHtml(customerCardStatusLabel(status))}</span></td>
        <td>${escapeHtml(walletPlatformLabel(wallet))}</td>
        <td>
          <strong>${escapeHtml(formatBalance(card, template))}</strong>
          <span class="table-subtext">${escapeHtml(featureSummary || '-')}</span>
        </td>
        <td>
          <strong>${escapeHtml(formatDashboardDateTime(card.created_at))}</strong>
          <span class="table-subtext">${escapeHtml(t('dashboard.lastScan'))}: ${escapeHtml(card.last_scanned_at ? formatDashboardDateTime(card.last_scanned_at) : t('dashboard.neverScanned'))}</span>
        </td>
        <td class="actions-cell">
          <select
            class="action-select"
            data-card-action
            data-scanner-url="${escapeHtml(scannerUrl)}"
            data-card-code="${escapeHtml(cardNumber)}"
            aria-label="${escapeHtml(t('dashboard.actions'))} ${escapeHtml(cardNumber)}"
          >
            <option value="">${escapeHtml(t('dashboard.actions'))}</option>
            <option value="scanner">${escapeHtml(t('dashboard.openInScanner'))}</option>
            <option value="copy-code">${escapeHtml(t('dashboard.copyCode'))}</option>
          </select>
        </td>
      </tr>
    `;
  }).join('');

  customerCardList.innerHTML = `
    <details class="customer-card-disclosure" data-customer-card-disclosure${state.customerCardsExpanded ? ' open' : ''}>
      <summary class="customer-card-summary">
        <span>
          <strong>${escapeHtml(t('dashboard.issuedCards'))}</strong>
          <span>${escapeHtml(t('dashboard.customerCardsCollapsedHint'))}</span>
        </span>
        <span class="customer-card-summary-meta">${escapeHtml(resultSummary)}</span>
      </summary>
      <div class="customer-card-dropdown">
        <form class="customer-card-filter-panel" data-customer-card-filters>
          <label>
            ${escapeHtml(t('dashboard.customerCardSearch'))}
            <input
              type="search"
              name="search"
              value="${escapeHtml(filters.search)}"
              placeholder="${escapeHtml(t('dashboard.customerCardSearchPlaceholder'))}"
              autocomplete="off"
              data-customer-card-filter
            >
          </label>
          <label>
            ${escapeHtml(t('dashboard.template'))}
            <select name="template" data-customer-card-filter>
              ${renderFilterOptions(templateOptions, filters.template, t('dashboard.allTemplates'))}
            </select>
          </label>
          <label>
            ${escapeHtml(t('dashboard.type'))}
            <select name="type" data-customer-card-filter>
              ${renderFilterOptions(typeOptions, filters.type, t('dashboard.allTypes'))}
            </select>
          </label>
          <label>
            ${escapeHtml(t('dashboard.status'))}
            <select name="status" data-customer-card-filter>
              ${renderFilterOptions(statusOptions, filters.status, t('dashboard.allStatuses'))}
            </select>
          </label>
          <label>
            ${escapeHtml(t('dashboard.walletPlatform'))}
            <select name="wallet" data-customer-card-filter>
              ${renderFilterOptions(walletOptions, filters.wallet, t('dashboard.allWallets'))}
            </select>
          </label>
          <label>
            ${escapeHtml(t('dashboard.sortBy'))}
            <select name="sort" data-customer-card-filter>
              <option value="created_desc"${filters.sort === 'created_desc' ? ' selected' : ''}>${escapeHtml(t('dashboard.sortNewest'))}</option>
              <option value="created_asc"${filters.sort === 'created_asc' ? ' selected' : ''}>${escapeHtml(t('dashboard.sortOldest'))}</option>
              <option value="last_scan_desc"${filters.sort === 'last_scan_desc' ? ' selected' : ''}>${escapeHtml(t('dashboard.sortLastScan'))}</option>
              <option value="template_asc"${filters.sort === 'template_asc' ? ' selected' : ''}>${escapeHtml(t('dashboard.sortTemplate'))}</option>
              <option value="code_asc"${filters.sort === 'code_asc' ? ' selected' : ''}>${escapeHtml(t('dashboard.sortCode'))}</option>
            </select>
          </label>
          <button class="button secondary" type="button" data-reset-customer-card-filters>${escapeHtml(t('dashboard.resetFilters'))}</button>
        </form>
        <div class="customer-card-result-bar">
          <strong>${escapeHtml(resultSummary)}</strong>
          <span>${escapeHtml(t('dashboard.customerCardsResultHint'))}</span>
        </div>
        ${filteredCards.length ? `
          <div class="table-panel">
            <table class="cards-table customer-cards-table">
              <thead>
                <tr>
                  <th>${escapeHtml(t('dashboard.cardId'))}</th>
                  <th>${escapeHtml(t('dashboard.template'))}</th>
                  <th>${escapeHtml(t('dashboard.status'))}</th>
                  <th>${escapeHtml(t('dashboard.walletPlatform'))}</th>
                  <th>${escapeHtml(t('dashboard.currentState'))}</th>
                  <th>${escapeHtml(t('dashboard.issuedOn'))}</th>
                  <th>${escapeHtml(t('dashboard.actions'))}</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state">${escapeHtml(t('dashboard.noFilteredCustomers'))}</div>`}
      </div>
    </details>
  `;

  restoreCustomerCardFilterFocus(focusState);
}

function downloadFile(url, filename) {
  const link = document.createElement('a');
  link.href = url;

  if (filename) {
    link.download = filename;
  }

  document.body.append(link);
  link.click();
  link.remove();
}

async function handleTemplateAction(select) {
  const action = select.value;
  select.value = '';

  if (!action) {
    return;
  }

  if (action === 'edit') {
    window.location.href = select.dataset.editorUrl;
    return;
  }

  if (action === 'copy-link') {
    await navigator.clipboard.writeText(select.dataset.claimUrl);
    showMessage(dashboardMessage, t('dashboard.claimCopied'), 'success');
    return;
  }

  if (action === 'qr-download') {
    downloadFile(select.dataset.qrUrl, select.dataset.qrFilename);
    return;
  }

  if (action === 'pdf-a4') {
    window.location.href = select.dataset.pdfA4Url;
    return;
  }

  if (action === 'pdf-a5') {
    window.location.href = select.dataset.pdfA5Url;
  }
}

async function handleCardAction(select) {
  const action = select.value;
  select.value = '';

  if (!action) {
    return;
  }

  if (action === 'scanner') {
    window.location.href = select.dataset.scannerUrl;
    return;
  }

  if (action === 'copy-code') {
    await navigator.clipboard.writeText(select.dataset.cardCode);
    showMessage(dashboardMessage, t('dashboard.codeCopied'), 'success');
  }
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function dateRangeForPeriod(period) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);

  if (period === 'today') {
    return [start, end];
  }

  if (period === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
    return [start, end];
  }

  if (period === 'last_30_days') {
    start.setDate(start.getDate() - 29);
    return [start, end];
  }

  if (period === 'this_month') {
    return [new Date(today.getFullYear(), today.getMonth(), 1), end];
  }

  if (period === 'last_month') {
    return [
      new Date(today.getFullYear(), today.getMonth() - 1, 1),
      new Date(today.getFullYear(), today.getMonth(), 0)
    ];
  }

  start.setDate(start.getDate() - 6);
  return [start, end];
}

function updateStatsFilterVisibility() {
  const period = statsPeriod?.value || 'last_7_days';
  const hourRange = statsHourRange?.value || 'all';
  const templateType = statsTemplateType?.value || 'all';

  document.querySelectorAll('[data-stats-custom-date]').forEach((element) => {
    element.hidden = period !== 'custom';
  });

  document.querySelectorAll('[data-stats-custom-hour]').forEach((element) => {
    element.hidden = hourRange !== 'custom';
  });

  if (statsClubFeatureField) {
    statsClubFeatureField.hidden = !['all', 'club_card'].includes(templateType);
    if (statsClubFeatureField.hidden) {
      statsClubFeatureField.querySelector('select').value = 'all';
    }
  }
}

function statsPayloadFromForm() {
  const formData = new FormData(statsFilterForm);
  const period = String(formData.get('period') || 'last_7_days');
  let dateFrom = String(formData.get('date_from') || '');
  let dateTo = String(formData.get('date_to') || '');

  if (period !== 'custom') {
    const [start, end] = dateRangeForPeriod(period);
    dateFrom = formatLocalDate(start);
    dateTo = formatLocalDate(end);
  }

  const hourRange = String(formData.get('hour_range') || 'all');
  let hourFrom = null;
  let hourTo = null;

  if (hourRange !== 'all') {
    if (hourRange === 'custom') {
      hourFrom = Number(formData.get('hour_from'));
      hourTo = Number(formData.get('hour_to'));
    } else {
      const [from, to] = hourRange.split('-').map(Number);
      hourFrom = from;
      hourTo = to;
    }
  }

  return {
    business_id: state.business?.id || null,
    date_from: dateFrom || null,
    date_to: dateTo || null,
    template_type: String(formData.get('template_type') || 'all'),
    club_feature: String(formData.get('club_feature') || 'all'),
    gender: String(formData.get('gender') || 'all'),
    age_group: String(formData.get('age_group') || 'all'),
    scan_type: String(formData.get('scan_type') || 'all'),
    action_type: String(formData.get('action_type') || 'all'),
    hour_from: Number.isFinite(hourFrom) ? hourFrom : null,
    hour_to: Number.isFinite(hourTo) ? hourTo : null
  };
}

async function callStatisticsEdge(payload, session) {
  let response;

  try {
    response = await fetch(`${state.client.supabaseUrl}/functions/v1/get-business-scan-statistics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: state.client.anonKey,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    error.fallbackToLocal = true;
    throw error;
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 404 || result.error_code === 'SUPABASE_EDGE_CONFIG_MISSING') {
      const error = new Error(result.error_message || result.error || 'Statistik Edge Function ist nicht erreichbar.');
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

async function callStatisticsLocal(payload, session) {
  const response = await fetch(apiUrl('/api/statistics/scans'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify(payload)
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

async function callStatisticsApi(payload) {
  const session = await state.client.ensureSession();

  if (!session) {
    throw new Error('Bitte erneut einloggen.');
  }

  try {
    return await callStatisticsEdge(payload, session);
  } catch (error) {
    if (!error.fallbackToLocal) {
      throw error;
    }

    return callStatisticsLocal(payload, session);
  }
}

function kpiCard(label, value) {
  return `
    <div class="kpi-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? '-')}</strong>
    </div>
  `;
}

function renderStatsKpis(kpis = {}) {
  if (!statsKpiGrid) {
    return;
  }

  statsKpiGrid.innerHTML = [
    ['Gesamt Scans', kpis.total_scans],
    ['Eindeutige Karten', kpis.unique_cards],
    ['Erstbesuche', kpis.first_scans],
    ['Wiederholungen', kpis.repeat_scans],
    ['Männlich', `${kpis.male_count || 0} (${kpis.male_percentage || 0}%)`],
    ['Weiblich', `${kpis.female_count || 0} (${kpis.female_percentage || 0}%)`],
    ['Top-Altersgruppe', kpis.top_age_group],
    ['Top-Uhrzeit', kpis.top_hour != null ? `${kpis.top_hour}:00` : '-'],
    ['Top-Wochentag', kpis.top_weekday],
    ['Top Kartentyp', kpis.top_template_type],
    ['Top Club-Modul', kpis.top_club_feature],
    ['Scans/Karte', kpis.average_scans_per_card],
    ['Clubkarten-Scans', kpis.club_scans_total],
    ['Club VIP', kpis.club_vip_scans],
    ['Club Garderobe', kpis.club_cloakroom_scans],
    ['Top Club-Kombination', kpis.top_club_combination]
  ].map(([label, value]) => kpiCard(label, value)).join('');
}

function normalizeChartItems(items = [], { includeZero = true } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      ...item,
      key: item.key ?? item.label,
      label: item.label ?? item.key ?? '-',
      value: Number(item.value || 0),
      percentage: item.percentage
    }))
    .filter((item) => includeZero || item.value > 0);
}

function chartHasData(items = []) {
  return normalizeChartItems(items).some((item) => item.value > 0);
}

function chartTotal(items = []) {
  return normalizeChartItems(items).reduce((sum, item) => sum + item.value, 0);
}

function chartPreferenceKey(chartKey) {
  const userId = state.session?.user?.id || 'anonymous';
  const businessId = state.business?.id || 'no-business';

  return `visitor_stats_chart_view_${userId}_${businessId}_${chartKey}`;
}

function allowedChartViews(chartKey) {
  return CHART_VIEW_OPTIONS[chartKey]?.allowed || ['bar'];
}

function defaultChartView(chartKey) {
  return CHART_VIEW_OPTIONS[chartKey]?.default || allowedChartViews(chartKey)[0] || 'bar';
}

function readStoredChartView(chartKey) {
  try {
    return window.localStorage.getItem(chartPreferenceKey(chartKey));
  } catch {
    return null;
  }
}

function writeStoredChartView(chartKey, viewType) {
  try {
    window.localStorage.setItem(chartPreferenceKey(chartKey), viewType);
  } catch {
    // Local Storage ist Komfort, nicht kritisch für die Statistik.
  }
}

function currentChartView(chartKey) {
  const allowed = allowedChartViews(chartKey);
  const configuredView = state.chartViews[chartKey] || readStoredChartView(chartKey);

  if (allowed.includes(configuredView)) {
    state.chartViews[chartKey] = configuredView;
    return configuredView;
  }

  const fallback = defaultChartView(chartKey);
  state.chartViews[chartKey] = fallback;
  writeStoredChartView(chartKey, fallback);
  return fallback;
}

function ChartViewSwitcher(chartKey, currentView) {
  const allowed = allowedChartViews(chartKey);

  return `
    <label class="chart-view-switcher">Ansicht
      <select data-chart-view-select="${escapeHtml(chartKey)}" ${allowed.length === 1 ? 'disabled' : ''}>
        ${allowed.map((viewType) => `
          <option value="${escapeHtml(viewType)}" ${viewType === currentView ? 'selected' : ''}>
            ${escapeHtml(CHART_VIEW_LABELS[viewType] || viewType)}
          </option>
        `).join('')}
      </select>
    </label>
  `;
}

function renderChartEmptyState(message = CHART_EMPTY_TEXT) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderBarChart(items = [], { horizontal = false } = {}) {
  const cleanItems = normalizeChartItems(items).filter((item) => item.value > 0);
  const max = Math.max(1, ...cleanItems.map((item) => item.value));

  if (!cleanItems.length) {
    return renderChartEmptyState();
  }

  return `
    <div class="bar-list ${horizontal ? 'bar-list-horizontal' : ''}">
      ${cleanItems.map((item) => {
        const width = Math.max(2, Math.round((item.value / max) * 100));

        return `
          <div class="bar-row">
            <span>${escapeHtml(item.label)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderPieChart(items = [], { donut = false } = {}) {
  const cleanItems = normalizeChartItems(items, { includeZero: false });
  const total = chartTotal(cleanItems);

  if (!cleanItems.length || total <= 0) {
    return renderChartEmptyState();
  }

  let current = 0;
  const segments = cleanItems.map((item, index) => {
    const start = current;
    const size = (item.value / total) * 100;
    const end = current + size;
    current = end;
    return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${end}%`;
  }).join(', ');

  return `
    <div class="pie-layout">
      <div class="pie-chart ${donut ? 'is-donut' : ''}" style="background: conic-gradient(${segments})">
        ${donut ? `<span>${escapeHtml(total)}</span>` : ''}
      </div>
      <div class="chart-legend">
        ${cleanItems.map((item, index) => {
          const percentage = total ? Math.round((item.value / total) * 1000) / 10 : 0;

          return `
            <div class="legend-row">
              <span class="legend-color" style="background:${CHART_COLORS[index % CHART_COLORS.length]}"></span>
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)} (${escapeHtml(percentage)}%)</strong>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderLineChart(items = []) {
  const cleanItems = normalizeChartItems(items);
  const positiveItems = cleanItems.filter((item) => item.value > 0);

  if (!positiveItems.length) {
    return renderChartEmptyState();
  }

  const chartItems = cleanItems.length === 1 ? [cleanItems[0], cleanItems[0]] : cleanItems;
  const max = Math.max(1, ...chartItems.map((item) => item.value));
  const points = chartItems.map((item, index) => {
    const x = 12 + (index / Math.max(1, chartItems.length - 1)) * 296;
    const y = 140 - (item.value / max) * 116;
    return `${Math.round(x)},${Math.round(y)}`;
  }).join(' ');

  return `
    <div class="line-chart-shell">
      <svg class="line-chart" viewBox="0 0 320 160" role="img" aria-label="Liniendiagramm">
        <line x1="12" y1="140" x2="308" y2="140" class="chart-axis"></line>
        <polyline points="${escapeHtml(points)}" class="line-chart-line"></polyline>
        ${chartItems.map((item, index) => {
          const x = 12 + (index / Math.max(1, chartItems.length - 1)) * 296;
          const y = 140 - (item.value / max) * 116;
          return `<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="3" class="line-chart-point"><title>${escapeHtml(item.label)}: ${escapeHtml(item.value)}</title></circle>`;
        }).join('')}
      </svg>
      <div class="line-chart-labels">
        <span>${escapeHtml(cleanItems[0]?.label || '')}</span>
        <span>${escapeHtml(cleanItems[cleanItems.length - 1]?.label || '')}</span>
      </div>
    </div>
  `;
}

function matrixValue(items, gender, ageGroup) {
  const key = `${gender}_${ageGroup}`;
  return normalizeChartItems(items).find((item) => item.key === key)?.value || 0;
}

function renderGroupedBarChart(items = []) {
  const max = Math.max(1, ...GENDER_ORDER.flatMap((gender) => AGE_GROUP_ORDER.map((ageGroup) => matrixValue(items, gender, ageGroup))));

  if (!chartHasData(items)) {
    return renderChartEmptyState();
  }

  return `
    <div class="matrix-chart grouped-chart">
      ${AGE_GROUP_ORDER.map((ageGroup) => `
        <div class="matrix-row">
          <span>${escapeHtml(statsAgeLabels[ageGroup] || ageGroup)}</span>
          <div class="grouped-bars">
            ${GENDER_ORDER.map((gender, index) => {
              const value = matrixValue(items, gender, ageGroup);
              const height = Math.max(4, Math.round((value / max) * 100));
              return `
                <div class="grouped-bar">
                  <div class="vertical-bar" style="height:${height}%; background:${CHART_COLORS[index]}"></div>
                  <small>${escapeHtml(statsGenderLabels[gender] || gender)} ${escapeHtml(value)}</small>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderStackedBarChart(items = []) {
  const ageTotals = AGE_GROUP_ORDER.map((ageGroup) => ({
    ageGroup,
    total: GENDER_ORDER.reduce((sum, gender) => sum + matrixValue(items, gender, ageGroup), 0)
  }));
  const max = Math.max(1, ...ageTotals.map((row) => row.total));

  if (!chartHasData(items)) {
    return renderChartEmptyState();
  }

  return `
    <div class="stacked-chart">
      ${ageTotals.map(({ ageGroup, total }) => `
        <div class="stacked-row">
          <span>${escapeHtml(statsAgeLabels[ageGroup] || ageGroup)}</span>
          <div class="stacked-track" style="width:${Math.max(8, Math.round((total / max) * 100))}%">
            ${GENDER_ORDER.map((gender, index) => {
              const value = matrixValue(items, gender, ageGroup);
              const width = total ? Math.round((value / total) * 100) : 0;
              return `<span style="width:${width}%; background:${CHART_COLORS[index]}"><small>${escapeHtml(value)}</small></span>`;
            }).join('')}
          </div>
          <strong>${escapeHtml(total)}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function renderHeatmapChart(items = []) {
  const cleanItems = normalizeChartItems(items);
  const max = Math.max(1, ...cleanItems.map((item) => item.value));

  if (!chartHasData(cleanItems)) {
    return renderChartEmptyState();
  }

  const valueFor = (weekday, hour) => cleanItems.find((item) => Number(item.weekday) === weekday && Number(item.hour) === hour)?.value || 0;

  return `
    <div class="heatmap-scroll">
      <div class="heatmap-grid" style="--heatmap-hours: 24">
        <span class="heatmap-corner"></span>
        ${Array.from({ length: 24 }, (_, hour) => `<span class="heatmap-hour">${hour}</span>`).join('')}
        ${[1, 2, 3, 4, 5, 6, 7].map((weekday) => `
          <span class="heatmap-weekday">${escapeHtml({ 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa', 7: 'So' }[weekday])}</span>
          ${Array.from({ length: 24 }, (_, hour) => {
            const value = valueFor(weekday, hour);
            const intensity = value ? 0.15 + (value / max) * 0.85 : 0;
            return `<span class="heatmap-cell" style="--heat:${intensity}" title="${weekday}. Tag, ${hour}:00: ${value} Scans">${escapeHtml(value || '')}</span>`;
          }).join('')}
        `).join('')}
      </div>
    </div>
  `;
}

function renderStatsTable(chartKey, items = []) {
  const cleanItems = normalizeChartItems(items);

  if (!chartHasData(cleanItems)) {
    return renderChartEmptyState();
  }

  if (chartKey === 'weekday_hour_heatmap' || cleanItems.some((item) => item.weekday != null && item.hour != null)) {
    return renderSimpleTable(['Wochentag', 'Stunde', 'Scans'], cleanItems.map((item) => [
      item.weekday_label || item.label || item.weekday,
      item.hour_label || `${item.hour}:00`,
      item.value
    ]));
  }

  if (chartKey === 'gender_age_matrix') {
    return renderSimpleTable(['Geschlecht', 'Altersgruppe', 'Anzahl'], GENDER_ORDER.flatMap((gender) => AGE_GROUP_ORDER.map((ageGroup) => [
      statsGenderLabels[gender] || gender,
      statsAgeLabels[ageGroup] || ageGroup,
      matrixValue(items, gender, ageGroup)
    ])));
  }

  return renderSimpleTable(['Kategorie', 'Wert', 'Anteil'], cleanItems.map((item) => [
    item.label,
    item.value,
    item.percentage != null ? `${item.percentage}%` : '-'
  ]));
}

function chartExportRows(chartKey) {
  const statistics = state.currentStatistics || {};
  const charts = statistics.charts || {};

  if (chartKey === 'last_scans') {
    return (statistics.last_scans || []).map((row) => ({
      Zeitpunkt: row.scanned_at ? new Date(row.scanned_at).toLocaleString() : '-',
      KartenID: row.card_instance_number || row.card_instance_id || '-',
      Template: row.template_name || row.template_type || '-',
      Geschlecht: statsGenderLabels[row.customer_gender] || '-',
      Alter: statsAgeLabels[row.customer_age_group] || '-',
      Erstscan: row.is_first_scan ? 'Ja' : 'Nein',
      Aktion: row.action_label || row.action_type || '-',
      Scans: row.scan_count ?? '-'
    }));
  }

  const items = chartKey === 'scans_by_hour' && currentChartView(chartKey) === 'heatmap'
    ? charts.weekday_hour_heatmap || []
    : charts[chartKey] || [];

  return normalizeChartItems(items).map((item) => ({
    Kategorie: item.label || item.key || `${item.weekday_label || item.weekday} ${item.hour_label || item.hour}`,
    Wert: item.value,
    Anteil: item.percentage != null ? `${item.percentage}%` : ''
  }));
}

function rowsToTsv(rows) {
  if (!rows.length) {
    return '';
  }

  const headers = Object.keys(rows[0]);

  return [
    headers.join('\t'),
    ...rows.map((row) => headers.map((header) => String(row[header] ?? '').replaceAll('\t', ' ')).join('\t'))
  ].join('\n');
}

async function copyChartValues(chartKey) {
  const rows = chartExportRows(chartKey);
  const text = rowsToTsv(rows);

  if (!text) {
    showMessage(statsMessage, 'Keine Werte zum Kopieren vorhanden.', 'error');
    return;
  }

  await navigator.clipboard.writeText(text);
  showMessage(statsMessage, 'Werte kopiert. CSV/PDF-Export ist damit vorbereitet.', 'success');
}

function renderSimpleTable(headers, rows) {
  const filteredRows = rows.filter((row) => row.some((cell) => Number(cell) > 0 || (typeof cell === 'string' && cell !== '-' && cell !== '')));

  if (!filteredRows.length) {
    return renderChartEmptyState();
  }

  return `
    <div class="stats-table-wrap">
      <table class="cards-table stats-table">
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${filteredRows.map((row) => `
            <tr>${row.map((cell) => `<td>${escapeHtml(cell ?? '-')}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function StatisticsChart(chartKey, viewType, items, charts = {}) {
  const chartItems = viewType === 'heatmap' && chartKey === 'scans_by_hour'
    ? charts.weekday_hour_heatmap || []
    : items || [];

  switch (viewType) {
    case 'bar':
      return renderBarChart(chartItems);
    case 'horizontal_bar':
      return renderBarChart(chartItems, { horizontal: true });
    case 'pie':
      return renderPieChart(chartItems);
    case 'donut':
      return renderPieChart(chartItems, { donut: true });
    case 'line':
      return renderLineChart(chartItems);
    case 'stacked_bar':
      return renderStackedBarChart(chartItems);
    case 'grouped_bar':
      return renderGroupedBarChart(chartItems);
    case 'heatmap':
      return renderHeatmapChart(chartItems);
    case 'table':
      return renderStatsTable(chartKey, chartItems);
    default:
      return StatisticsChart(chartKey, defaultChartView(chartKey), chartItems, charts);
  }
}

function chartCard(chartKey, title, items, charts = {}) {
  const currentView = currentChartView(chartKey);
  const isWide = ['scans_over_time', 'gender_age_matrix', 'weekday_hour_heatmap'].includes(chartKey);

  return `
    <div class="chart-card ${isWide ? 'chart-card-wide' : ''}" data-chart-key="${escapeHtml(chartKey)}">
      <div class="chart-card-header">
        <h3>${escapeHtml(title)}</h3>
        ${ChartViewSwitcher(chartKey, currentView)}
      </div>
      ${StatisticsChart(chartKey, currentView, items, charts)}
      ${currentView === 'table' ? `<button class="text-button chart-copy-button" type="button" data-copy-chart-values="${escapeHtml(chartKey)}">Werte kopieren</button>` : ''}
    </div>
  `;
}

function renderStatsCharts(charts = {}) {
  if (!statsCharts) {
    return;
  }

  statsCharts.innerHTML = CHART_DEFINITIONS
    .map(([chartKey, title]) => chartCard(chartKey, title, charts[chartKey], charts))
    .join('');
}

function clubBadges(features = {}) {
  return Object.entries(statsClubFeatureLabels)
    .filter(([featureName]) => Boolean(features?.[featureName]))
    .map(([, label]) => `<span class="badge">${escapeHtml(label)}</span>`)
    .join('') || '-';
}

function renderLastScansTable(rows = []) {
  if (!rows.length) {
    return renderChartEmptyState();
  }

  return `
    <table class="cards-table">
      <thead>
        <tr>
          <th>Zeitpunkt</th>
          <th>Karten-ID</th>
          <th>Template</th>
          <th>Club-Features</th>
          <th>Geschlecht</th>
          <th>Alter</th>
          <th>Erstscan</th>
          <th>Aktion</th>
          <th>Scan-Anzahl</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.scanned_at ? new Date(row.scanned_at).toLocaleString() : '-')}</td>
            <td>${escapeHtml(row.card_instance_number || row.card_instance_id || '-')}</td>
            <td>${escapeHtml(row.template_name || row.template_type || '-')}</td>
            <td><div class="badge-row">${clubBadges(row.active_club_features)}</div></td>
            <td>${escapeHtml(statsGenderLabels[row.customer_gender] || '-')}</td>
            <td>${escapeHtml(statsAgeLabels[row.customer_age_group] || '-')}</td>
            <td>${row.is_first_scan ? 'Ja' : 'Nein'}</td>
            <td>${escapeHtml(row.action_label || row.action_type || '-')}</td>
            <td>${escapeHtml(row.scan_count ?? '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderLastScans(rows = []) {
  if (!lastScansTable) {
    return;
  }

  const chartKey = 'last_scans';
  const currentView = currentChartView(chartKey);

  lastScansTable.innerHTML = `
    <div class="chart-card chart-card-wide" data-chart-key="${escapeHtml(chartKey)}">
      <div class="chart-card-header">
        <h3>Letzte Scans</h3>
        ${ChartViewSwitcher(chartKey, currentView)}
      </div>
      <div class="stats-table-wrap">${renderLastScansTable(rows)}</div>
      <button class="text-button chart-copy-button" type="button" data-copy-chart-values="${escapeHtml(chartKey)}">Werte kopieren</button>
    </div>
  `;
}

function renderVisitorStatistics(statistics = {}) {
  state.currentStatistics = statistics;
  renderStatsKpis(statistics.kpis || {});
  renderStatsCharts(statistics.charts || {});
  renderLastScans(statistics.last_scans || []);
}

function handleStatsChartViewChange(event) {
  const select = event.target.closest('[data-chart-view-select]');

  if (!select) {
    return;
  }

  const chartKey = select.dataset.chartViewSelect;
  const nextView = select.value;

  if (!allowedChartViews(chartKey).includes(nextView)) {
    state.chartViews[chartKey] = defaultChartView(chartKey);
    writeStoredChartView(chartKey, state.chartViews[chartKey]);
    showMessage(statsMessage, 'Diese Ansicht ist für diese Daten nicht verfügbar.', 'error');
  } else {
    state.chartViews[chartKey] = nextView;
    writeStoredChartView(chartKey, nextView);
  }

  renderVisitorStatistics(state.currentStatistics || {});
}

function handleStatsChartCopyClick(event) {
  const button = event.target.closest('[data-copy-chart-values]');

  if (!button) {
    return;
  }

  copyChartValues(button.dataset.copyChartValues)
    .catch((error) => showMessage(statsMessage, error.message || 'Werte konnten nicht kopiert werden.', 'error'));
}

async function loadVisitorStatistics() {
  if (!statsFilterForm) {
    return;
  }

  updateStatsFilterVisibility();
  showMessage(statsMessage, 'Besucherstatistik wird geladen ...');
  const statistics = await callStatisticsApi(statsPayloadFromForm());

  renderVisitorStatistics(statistics);
  state.statisticsLoaded = true;
  showMessage(statsMessage, `Besucherstatistik geladen (${statistics.source === 'local' ? 'lokaler Fallback' : 'Edge Function'}).`, 'success');
}

async function initDashboard() {
  setupLanguageSelectors(document);

  const context = await requireLogin({ requireUnlock: true });

  if (!context) {
    return;
  }

  state.client = context.client;
  state.session = context.session;
  state.profile = context.profile;

  initDashboardTabs();

  statsFilterForm?.addEventListener('change', () => {
    updateStatsFilterVisibility();
    loadVisitorStatistics().catch((error) => showMessage(statsMessage, error.error_message || error.message, 'error'));
  });

  statsFilterForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    loadVisitorStatistics().catch((error) => showMessage(statsMessage, error.error_message || error.message, 'error'));
  });

  refreshStatsButton?.addEventListener('click', () => {
    loadVisitorStatistics().catch((error) => showMessage(statsMessage, error.error_message || error.message, 'error'));
  });

  statsCharts?.addEventListener('change', handleStatsChartViewChange);
  lastScansTable?.addEventListener('change', handleStatsChartViewChange);
  statsCharts?.addEventListener('click', handleStatsChartCopyClick);
  lastScansTable?.addEventListener('click', handleStatsChartCopyClick);

  templateList?.addEventListener('change', (event) => {
    const actionSelect = event.target.closest('[data-template-action]');

    if (!actionSelect) {
      return;
    }

    handleTemplateAction(actionSelect).catch((error) => {
      showMessage(dashboardMessage, error.message || t('dashboard.actionFailed'), 'error');
    });
  });

  templateList?.addEventListener('click', async (event) => {
    const copyButton = event.target.closest('[data-copy-url]');

    if (copyButton) {
      await navigator.clipboard.writeText(copyButton.dataset.copyUrl);
      showMessage(dashboardMessage, t('dashboard.claimCopied'), 'success');
      return;
    }

    if (event.target.closest('a, button, select, [data-template-action]')) {
      return;
    }

    const row = event.target.closest('[data-editor-url]');

    if (row?.dataset.editorUrl) {
      window.location.href = row.dataset.editorUrl;
    }
  });

  customerCardList?.addEventListener('change', (event) => {
    const filterField = event.target.closest('[data-customer-card-filter]');

    if (filterField) {
      updateCustomerCardFilter(filterField);
      return;
    }

    const actionSelect = event.target.closest('[data-card-action]');

    if (!actionSelect) {
      return;
    }

    handleCardAction(actionSelect).catch((error) => {
      showMessage(dashboardMessage, error.message || t('dashboard.actionFailed'), 'error');
    });
  });

  customerCardList?.addEventListener('submit', (event) => {
    if (event.target.matches('[data-customer-card-filters]')) {
      event.preventDefault();
    }
  });

  customerCardList?.addEventListener('input', (event) => {
    const filterField = event.target.closest('[data-customer-card-filter]');

    if (!filterField) {
      return;
    }

    updateCustomerCardFilter(filterField);
  });

  customerCardList?.addEventListener('toggle', (event) => {
    if (event.target.matches('[data-customer-card-disclosure]')) {
      state.customerCardsExpanded = event.target.open;
    }
  }, true);

  customerCardList?.addEventListener('click', async (event) => {
    const resetButton = event.target.closest('[data-reset-customer-card-filters]');

    if (resetButton) {
      resetCustomerCardFilters();
      return;
    }

    const copyButton = event.target.closest('[data-copy-code]');

    if (copyButton) {
      await navigator.clipboard.writeText(copyButton.dataset.copyCode);
      showMessage(dashboardMessage, t('dashboard.codeCopied'), 'success');
      return;
    }

    if (event.target.closest('a, button, select, [data-card-action]')) {
      return;
    }

    const row = event.target.closest('[data-scanner-url]');

    if (row?.dataset.scannerUrl) {
      window.location.href = row.dataset.scannerUrl;
    }
  });

  await loadBusiness();
  await loadTemplates();
  await loadCustomerCards();
  await showDashboardTab(dashboardTabFromHash());

  window.addEventListener('el-promillo-language-change', () => {
    renderTemplates();
    renderCustomerCards();

    if (state.currentStatistics) {
      renderVisitorStatistics(state.currentStatistics);
    }
  });
}

initDashboard().catch((error) => {
  showMessage(dashboardMessage, error.message, 'error');
});
