import { requireLogin } from './guards.js';
import { pagePath } from './path.js';
import { byId, escapeHtml, renderBusinessHeader, showMessage } from './ui.js';

const state = {
  client: null,
  session: null,
  business: null,
  templates: [],
  rules: [],
  campaigns: [],
  filter: 'all'
};

const ruleSelect = [
  'id', 'business_id', 'template_id', 'name', 'title', 'message', 'target_type', 'target_filter',
  'trigger_type', 'recurrence', 'weekdays', 'month_day', 'time_of_day', 'time_zone', 'starts_on',
  'ends_on', 'active_from_time', 'active_until_time', 'location_lat', 'location_lng', 'location_radius_m',
  'status', 'next_run_at', 'location_active_until_at', 'location_is_active', 'last_run_at', 'last_status',
  'last_result', 'created_at', 'updated_at'
].join(',');
const campaignSelect = [
  'id', 'business_id', 'template_id', 'notification_rule_id', 'title', 'message', 'send_type',
  'scheduled_at', 'status', 'created_at', 'sent_at'
].join(',');
const weekdayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const pushCenterMessage = byId('pushCenterMessage');
const newRuleButton = byId('newNotificationRuleButton');
const editor = byId('notificationRuleEditor');
const editorTitle = byId('notificationRuleEditorTitle');
const closeEditorButton = byId('closeNotificationRuleEditor');
const cancelEditorButton = byId('cancelNotificationRuleButton');
const form = byId('notificationRuleForm');
const templateSelect = byId('notificationRuleTemplate');
const triggerTypeSelect = byId('notificationRuleTriggerType');
const recurrenceSelect = byId('notificationRuleRecurrence');
const recurringFields = byId('recurringRuleFields');
const recurringWeekdayFields = byId('recurringWeekdayFields');
const monthlyDayField = byId('monthlyDayField');
const locationFields = byId('locationRuleFields');
const eventRuleLocationFields = byId('eventRuleLocationFields');
const eventRuleCoordinates = byId('eventRuleCoordinates');
const businessLocation = byId('notificationRuleBusinessLocation');
const ruleSummary = byId('notificationRuleSummary');
const ruleList = byId('notificationRuleList');
const campaignHistory = byId('pushCampaignHistory');

function field(name) {
  return form?.elements?.namedItem(name) || null;
}

function localDateInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) {
    return '–';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '–'
    : date.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDate(value) {
  if (!value) {
    return 'unbegrenzt';
  }

  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('de-CH');
}

function templateName(templateId) {
  return state.templates.find((template) => template.id === templateId)?.card_name || 'Businessweit';
}

function selectedTemplate() {
  return state.templates.find((template) => template.id === templateSelect.value) || null;
}

function selectedTemplateSettings() {
  const settings = selectedTemplate()?.settings;
  return settings && typeof settings === 'object' ? settings : {};
}

function weekdaysText(days = []) {
  const normalized = Array.isArray(days) ? days.map(Number).filter((day) => day >= 1 && day <= 7) : [];

  if (normalized.length === 7) {
    return 'täglich';
  }

  return normalized.map((day) => weekdayLabels[day - 1]).join(', ') || 'keine Wochentage';
}

function recurrenceText(rule) {
  if (rule.trigger_type === 'location_based') {
    return `${weekdaysText(rule.weekdays)} · ${String(rule.active_from_time || '').slice(0, 5)}–${String(rule.active_until_time || '').slice(0, 5)}`;
  }

  if (rule.recurrence === 'daily') {
    return `Täglich um ${String(rule.time_of_day || '').slice(0, 5)}`;
  }

  if (rule.recurrence === 'monthly') {
    return `Monatlich am ${rule.month_day}. um ${String(rule.time_of_day || '').slice(0, 5)}`;
  }

  const prefix = rule.recurrence === 'biweekly' ? 'Alle zwei Wochen' : 'Wöchentlich';
  return `${prefix} · ${weekdaysText(rule.weekdays)} · ${String(rule.time_of_day || '').slice(0, 5)}`;
}

function triggerLabel(rule) {
  return rule.trigger_type === 'location_based' ? 'Standort' : 'Wiederkehrend';
}

function statusLabel(status) {
  return ({ active: 'Aktiv', paused: 'Pausiert', archived: 'Archiviert' })[status] || status || 'Unbekannt';
}

async function callRuleFunction(payload) {
  const session = await state.client.ensureSession();

  if (!session) {
    throw new Error('Bitte erneut einloggen.');
  }

  const response = await fetch(`${state.client.supabaseUrl}/functions/v1/manage-wallet-notification-rule`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: state.client.anonKey,
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error_message || data.error_reason || 'Push-Regel konnte nicht gespeichert werden.');
  }

  return data;
}

function selectedWeekdays(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => Number(input.value));
}

function setSelectedWeekdays(name, days = []) {
  const selected = new Set((Array.isArray(days) ? days : []).map(Number));
  form.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = selected.has(Number(input.value));
  });
}

function updateRuleFormVisibility() {
  const locationBased = triggerTypeSelect.value === 'location_based';
  const recurrence = recurrenceSelect.value;
  recurringFields.hidden = locationBased;
  locationFields.hidden = !locationBased;
  recurringWeekdayFields.hidden = locationBased || !['weekly', 'biweekly'].includes(recurrence);
  monthlyDayField.hidden = locationBased || recurrence !== 'monthly';
  const isEventTemplate = selectedTemplate()?.template_type === 'event_card';
  eventRuleLocationFields.hidden = !locationBased || !isEventTemplate;
  eventRuleCoordinates.hidden = !locationBased || !isEventTemplate || !field('use_event_location').checked;

  if (locationBased && isEventTemplate && field('use_event_location').checked) {
    const settings = selectedTemplateSettings();

    if (!field('event_location_lat').value && settings.eventLocationLatitude != null) {
      field('event_location_lat').value = settings.eventLocationLatitude;
    }

    if (!field('event_location_lng').value && settings.eventLocationLongitude != null) {
      field('event_location_lng').value = settings.eventLocationLongitude;
    }
  }
  updateRuleSummary();
}

function updateRuleSummary() {
  if (!ruleSummary) {
    return;
  }

  const locationBased = triggerTypeSelect.value === 'location_based';
  const days = selectedWeekdays(locationBased ? 'location_weekdays' : 'recurring_weekdays');
  const recurrence = recurrenceSelect.value;
  let schedule;

  if (locationBased) {
    const locationLabel = field('use_event_location').checked && selectedTemplate()?.template_type === 'event_card'
      ? 'am eigenen Eventstandort'
      : 'am Firmenstandort';
    schedule = `${weekdaysText(days)} zwischen ${field('active_from_time').value || '–'} und ${field('active_until_time').value || '–'} ${locationLabel}`;
  } else if (recurrence === 'daily') {
    schedule = `Täglich um ${field('time_of_day').value || '–'}`;
  } else if (recurrence === 'monthly') {
    schedule = `Monatlich am ${field('month_day').value || '–'}. um ${field('time_of_day').value || '–'}`;
  } else {
    schedule = `${recurrence === 'biweekly' ? 'Alle zwei Wochen' : 'Wöchentlich'} ${weekdaysText(days)} um ${field('time_of_day').value || '–'}`;
  }

  ruleSummary.innerHTML = `
    <span class="eyebrow">Zusammenfassung</span>
    <strong>${escapeHtml(schedule)}</strong>
    <span>Ab ${escapeHtml(formatDate(field('starts_on').value))}${field('ends_on').value ? ` bis ${escapeHtml(formatDate(field('ends_on').value))}` : ', bis manuell beendet'}.</span>
  `;
}

function openEditor(rule = null) {
  form.reset();
  field('starts_on').value = localDateInputValue();
  field('time_of_day').value = '17:00';
  field('active_from_time').value = '17:00';
  field('active_until_time').value = '02:00';
  field('time_zone').value = 'Europe/Zurich';
  field('active').checked = true;
  setSelectedWeekdays('recurring_weekdays', [5]);
  setSelectedWeekdays('location_weekdays', [5, 6]);

  if (rule) {
    editorTitle.textContent = 'Push-Regel bearbeiten';
    field('rule_id').value = rule.id;
    field('name').value = rule.name || '';
    field('template_id').value = rule.template_id || '';
    field('target_type').value = rule.target_type || 'template';
    field('title').value = rule.title || '';
    field('message').value = rule.message || '';
    field('trigger_type').value = rule.trigger_type || 'recurring';
    field('recurrence').value = rule.recurrence === 'location_window' ? 'weekly' : rule.recurrence || 'weekly';
    field('time_of_day').value = String(rule.time_of_day || '17:00').slice(0, 5);
    field('month_day').value = rule.month_day || 1;
    field('active_from_time').value = String(rule.active_from_time || '17:00').slice(0, 5);
    field('active_until_time').value = String(rule.active_until_time || '02:00').slice(0, 5);
    field('starts_on').value = rule.starts_on || localDateInputValue();
    field('ends_on').value = rule.ends_on || '';
    field('time_zone').value = rule.time_zone || 'Europe/Zurich';
    field('active').checked = rule.status === 'active';
    const usesEventLocation = selectedTemplate()?.template_type === 'event_card'
      && Number.isFinite(Number(rule.location_lat))
      && Number.isFinite(Number(rule.location_lng))
      && (
        Math.abs(Number(rule.location_lat) - Number(state.business?.location_lat)) > 0.000001
        || Math.abs(Number(rule.location_lng) - Number(state.business?.location_lng)) > 0.000001
      );
    field('use_event_location').checked = usesEventLocation;
    field('event_location_lat').value = usesEventLocation ? rule.location_lat : '';
    field('event_location_lng').value = usesEventLocation ? rule.location_lng : '';
    setSelectedWeekdays('recurring_weekdays', rule.weekdays);
    setSelectedWeekdays('location_weekdays', rule.weekdays);
  } else {
    editorTitle.textContent = 'Neue Push-Regel';
    const preselectedTemplate = new URLSearchParams(window.location.search).get('template');

    if (preselectedTemplate && state.templates.some((template) => template.id === preselectedTemplate)) {
      field('template_id').value = preselectedTemplate;
      field('target_type').value = 'template';
    }
  }

  editor.hidden = false;
  updateRuleFormVisibility();
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  editor.hidden = true;
  showMessage(pushCenterMessage, '');
}

function rulePayload() {
  const triggerType = triggerTypeSelect.value;
  const weekdays = selectedWeekdays(triggerType === 'location_based' ? 'location_weekdays' : 'recurring_weekdays');
  const targetType = field('target_type').value;
  const templateId = field('template_id').value;

  if (targetType === 'template' && !templateId) {
    throw new Error('Wähle für diese Zielgruppe zuerst eine Karte.');
  }

  if (triggerType === 'location_based' && !weekdays.length) {
    throw new Error('Wähle mindestens einen aktiven Wochentag für die Standortregel.');
  }

  if (triggerType === 'recurring' && ['weekly', 'biweekly'].includes(recurrenceSelect.value) && !weekdays.length) {
    throw new Error('Wähle mindestens einen Versandtag.');
  }

  const useEventLocation = field('use_event_location').checked && selectedTemplate()?.template_type === 'event_card';
  const eventLocationLat = Number(field('event_location_lat').value);
  const eventLocationLng = Number(field('event_location_lng').value);

  if (triggerType === 'location_based' && useEventLocation && (
    !Number.isFinite(eventLocationLat)
    || eventLocationLat < -90
    || eventLocationLat > 90
    || !Number.isFinite(eventLocationLng)
    || eventLocationLng < -180
    || eventLocationLng > 180
  )) {
    throw new Error('Hinterlege gültige Koordinaten für den Eventstandort.');
  }

  return {
    templateId: templateId || null,
    name: field('name').value.trim(),
    targetType,
    targetFilter: {},
    title: field('title').value.trim(),
    message: field('message').value.trim(),
    triggerType,
    recurrence: recurrenceSelect.value,
    weekdays,
    monthDay: Number(field('month_day').value || 1),
    timeOfDay: field('time_of_day').value,
    activeFromTime: field('active_from_time').value,
    activeUntilTime: field('active_until_time').value,
    startsOn: field('starts_on').value,
    endsOn: field('ends_on').value || null,
    timeZone: field('time_zone').value,
    status: field('active').checked ? 'active' : 'paused',
    locationRadiusM: 150,
    useEventLocation,
    eventLocationLat: useEventLocation ? eventLocationLat : null,
    eventLocationLng: useEventLocation ? eventLocationLng : null
  };
}

function renderMetrics() {
  const now = Date.now();
  const inSevenDays = now + (7 * 86400000);
  const thirtyDaysAgo = now - (30 * 86400000);
  byId('activeRuleCount').textContent = String(state.rules.filter((rule) => rule.status === 'active').length);
  byId('pausedRuleCount').textContent = String(state.rules.filter((rule) => rule.status === 'paused').length);
  byId('upcomingRuleCount').textContent = String(state.rules.filter((rule) => {
    const next = new Date(rule.next_run_at || 0).getTime();
    return rule.status === 'active' && next >= now && next <= inSevenDays;
  }).length);
  byId('recentCampaignCount').textContent = String(state.campaigns.filter((campaign) => new Date(campaign.created_at).getTime() >= thirtyDaysAgo).length);
}

function filteredRules() {
  if (state.filter === 'all') {
    return state.rules;
  }

  if (state.filter === 'paused') {
    return state.rules.filter((rule) => rule.status === 'paused');
  }

  return state.rules.filter((rule) => rule.trigger_type === state.filter);
}

function renderRules() {
  const rules = filteredRules();

  if (!rules.length) {
    ruleList.innerHTML = `
      <div class="panel empty-state">
        <h3>Noch keine passenden Automatisierungen</h3>
        <p class="muted">Erstelle eine wiederkehrende Nachricht oder eine zeitlich gesteuerte Standortregel.</p>
        <button class="primary" type="button" data-rule-action="new">Neue Automatisierung</button>
      </div>
    `;
    return;
  }

  ruleList.innerHTML = rules.map((rule) => `
    <article class="panel notification-rule-card ${rule.status === 'paused' ? 'is-paused' : ''}">
      <div class="notification-rule-card-main">
        <div class="notification-rule-card-heading">
          <div>
            <span class="pill">${escapeHtml(triggerLabel(rule))}</span>
            <span class="pill status-${escapeHtml(rule.status)}">${escapeHtml(statusLabel(rule.status))}</span>
            ${rule.location_is_active ? '<span class="pill status-active">Standortfenster aktiv</span>' : ''}
            <h3>${escapeHtml(rule.name)}</h3>
            <p>${escapeHtml(rule.title)}</p>
          </div>
          <label class="rule-status-toggle">
            <input type="checkbox" data-rule-action="toggle" data-rule-id="${escapeHtml(rule.id)}" ${rule.status === 'active' ? 'checked' : ''}>
            <span>${rule.status === 'active' ? 'Aktiv' : 'Pausiert'}</span>
          </label>
        </div>
        <div class="notification-rule-details">
          <span><strong>Karte</strong>${escapeHtml(templateName(rule.template_id))}</span>
          <span><strong>Zeitplan</strong>${escapeHtml(recurrenceText(rule))}</span>
          <span><strong>Nächste Ausführung</strong>${escapeHtml(formatDateTime(rule.next_run_at))}</span>
          <span><strong>Letztes Ergebnis</strong>${escapeHtml(rule.last_status || 'Noch nicht ausgeführt')}</span>
        </div>
      </div>
      <div class="notification-rule-actions">
        <button class="secondary" type="button" data-rule-action="edit" data-rule-id="${escapeHtml(rule.id)}">Bearbeiten</button>
        <button class="secondary" type="button" data-rule-action="duplicate" data-rule-id="${escapeHtml(rule.id)}">Duplizieren</button>
        <button class="ghost danger" type="button" data-rule-action="archive" data-rule-id="${escapeHtml(rule.id)}">Löschen</button>
      </div>
    </article>
  `).join('');
}

function renderHistory() {
  if (!state.campaigns.length) {
    campaignHistory.innerHTML = '<p class="muted">Noch keine Wallet-Nachrichten vorhanden.</p>';
    return;
  }

  campaignHistory.innerHTML = state.campaigns.slice(0, 30).map((campaign) => {
    const rule = state.rules.find((entry) => entry.id === campaign.notification_rule_id);
    return `
      <article class="history-item push-history-item">
        <div>
          <span class="pill">${escapeHtml(campaign.send_type === 'location_based' ? 'Standort' : campaign.send_type === 'scheduled' ? 'Geplant' : 'Sofort')}</span>
          <strong>${escapeHtml(rule?.name || campaign.title || 'Wallet-Nachricht')}</strong>
          <p>${escapeHtml(campaign.message || '')}</p>
        </div>
        <div class="push-history-meta">
          <span class="pill status-${escapeHtml(campaign.status)}">${escapeHtml(campaign.status || 'unbekannt')}</span>
          <time>${escapeHtml(formatDateTime(campaign.sent_at || campaign.scheduled_at || campaign.created_at))}</time>
        </div>
      </article>
    `;
  }).join('');
}

async function loadData() {
  const businessRows = await state.client.selectRows('businesses', {
    select: 'id,owner_id,name,address,location_lat,location_lng,logo_url,company_logo_updated_at,updated_at',
    filters: [{ column: 'owner_id', op: 'eq', value: state.session.user.id }],
    limit: 1
  });
  state.business = businessRows[0] || null;

  if (!state.business) {
    throw new Error('Firmendaten wurden nicht gefunden.');
  }

  renderBusinessHeader(state.business);
  businessLocation.textContent = state.business.address || state.business.name || 'Firmenstandort';

  const [templates, rules, campaigns] = await Promise.all([
    state.client.selectRows('card_templates', {
      select: 'id,card_name,template_type,is_active,settings',
      filters: [
        { column: 'owner_id', op: 'eq', value: state.session.user.id },
        { column: 'business_id', op: 'eq', value: state.business.id }
      ],
      order: 'created_at.desc'
    }),
    state.client.selectRows('wallet_notification_rules', {
      select: ruleSelect,
      filters: [
        { column: 'business_id', op: 'eq', value: state.business.id },
        { column: 'status', op: 'neq', value: 'archived' }
      ],
      order: 'updated_at.desc',
      limit: 200
    }),
    state.client.selectRows('wallet_notification_campaigns', {
      select: campaignSelect,
      filters: [{ column: 'business_id', op: 'eq', value: state.business.id }],
      order: 'created_at.desc',
      limit: 200
    })
  ]);

  state.templates = templates || [];
  state.rules = rules || [];
  state.campaigns = campaigns || [];
  templateSelect.innerHTML = [
    '<option value="">Businessweit</option>',
    ...state.templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.card_name || 'Unbenannte Karte')}</option>`)
  ].join('');
  renderMetrics();
  renderRules();
  renderHistory();
}

async function refreshData(message = '') {
  await loadData();

  if (message) {
    showMessage(pushCenterMessage, message, 'success');
  }
}

async function submitRule(event) {
  event.preventDefault();

  try {
    const payload = rulePayload();
    const ruleId = field('rule_id').value;
    showMessage(pushCenterMessage, 'Push-Regel wird gespeichert ...');
    await callRuleFunction({
      action: ruleId ? 'update' : 'create',
      id: ruleId || undefined,
      rule: payload
    });
    closeEditor();
    await refreshData(ruleId ? 'Push-Regel wurde aktualisiert.' : 'Push-Regel wurde erstellt.');
  } catch (error) {
    showMessage(pushCenterMessage, error.message || 'Push-Regel konnte nicht gespeichert werden.', 'error');
  }
}

async function handleRuleAction(event) {
  const target = event.target.closest('[data-rule-action]');

  if (!target) {
    return;
  }

  const action = target.dataset.ruleAction;
  const ruleId = target.dataset.ruleId;
  const rule = state.rules.find((entry) => entry.id === ruleId);

  if (action === 'toggle' && event.type !== 'change') {
    return;
  }

  if (action !== 'toggle' && event.type === 'change') {
    return;
  }

  if (action === 'new') {
    openEditor();
    return;
  }

  if (!rule) {
    return;
  }

  if (action === 'edit') {
    openEditor(rule);
    return;
  }

  if (action === 'archive' && !window.confirm(`Automatisierung „${rule.name}“ wirklich löschen? Der Versandverlauf bleibt erhalten.`)) {
    return;
  }

  try {
    showMessage(pushCenterMessage, 'Änderung wird gespeichert ...');

    if (action === 'toggle') {
      await callRuleFunction({ action: 'set_status', id: rule.id, status: target.checked ? 'active' : 'paused' });
      await refreshData(target.checked ? 'Automatisierung wurde aktiviert.' : 'Automatisierung wurde pausiert.');
      return;
    }

    if (action === 'duplicate') {
      await callRuleFunction({ action: 'duplicate', id: rule.id });
      await refreshData('Automatisierung wurde als pausierte Kopie angelegt.');
      return;
    }

    if (action === 'archive') {
      await callRuleFunction({ action: 'archive', id: rule.id });
      await refreshData('Automatisierung wurde gelöscht.');
    }
  } catch (error) {
    showMessage(pushCenterMessage, error.message || 'Aktion fehlgeschlagen.', 'error');
    await loadData().catch(() => {});
  }
}

function bindEvents() {
  newRuleButton.addEventListener('click', () => openEditor());
  closeEditorButton.addEventListener('click', closeEditor);
  cancelEditorButton.addEventListener('click', closeEditor);
  form.addEventListener('submit', submitRule);
  form.addEventListener('input', updateRuleSummary);
  triggerTypeSelect.addEventListener('change', updateRuleFormVisibility);
  recurrenceSelect.addEventListener('change', updateRuleFormVisibility);
  templateSelect.addEventListener('change', updateRuleFormVisibility);
  field('use_event_location').addEventListener('change', updateRuleFormVisibility);
  ruleList.addEventListener('click', handleRuleAction);
  ruleList.addEventListener('change', handleRuleAction);
  document.querySelectorAll('[data-rule-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.filter = button.dataset.ruleFilter || 'all';
      document.querySelectorAll('[data-rule-filter]').forEach((entry) => entry.classList.toggle('is-active', entry === button));
      renderRules();
    });
  });
}

async function init() {
  const auth = await requireLogin({ requireUnlock: true });

  if (!auth) {
    return;
  }

  state.client = auth.client;
  state.session = auth.session;
  bindEvents();

  try {
    await loadData();
    const params = new URLSearchParams(window.location.search);

    if (params.get('new') === '1') {
      openEditor();
    }
  } catch (error) {
    showMessage(pushCenterMessage, error.message || 'Push Center konnte nicht geladen werden.', 'error');
  }
}

init().catch(() => {
  window.location.replace(pagePath('dashboard.html'));
});
