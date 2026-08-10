import { requireLogin } from './guards.js';
import { edgeFunctionUrl, loadPublicConfig } from './config.js';
import { applyBusinessAppTheme } from './theme.js';
import { byId, escapeHtml, renderBusinessHeader, showMessage } from './ui.js';

const state = { client: null, session: null, business: null, permissions: {}, page: 1, pageSize: 25, total: 0, detail: null, activeTab: 'overview', definitions: [] };
const message = byId('crmMessage');
const filterForm = byId('crmFilterForm');
const guestList = byId('crmGuestList');
const pageStatus = byId('crmPageStatus');
const previousPage = byId('crmPreviousPage');
const nextPage = byId('crmNextPage');
const detailSection = byId('crmDetail');
const detailTitle = byId('crmDetailTitle');
const detailContent = byId('crmDetailContent');
const exportButton = byId('crmExportButton');
const definitionSection = byId('crmFieldDefinitionsSection');
const definitionForm = byId('crmFieldDefinitionForm');
const definitionsList = byId('crmFieldDefinitions');

function formatDate(value, withTime = false) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('de-CH', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}

async function crmRequest(action, payload = {}) {
  const config = await loadPublicConfig();
  const response = await fetch(edgeFunctionUrl('guest-crm'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.supabase.anonKey, Authorization: `Bearer ${state.session.access_token}` },
    body: JSON.stringify({ action, business_id: state.business.id, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error_message || result.error || 'CRM-Anfrage fehlgeschlagen.');
  state.permissions = result.permissions || state.permissions;
  return result.data;
}

function filterPayload() {
  const data = new FormData(filterForm);
  return Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value).trim()]));
}

function renderGuestList(data) {
  state.total = data.total || 0;
  state.page = data.page || state.page;
  const rows = data.rows || [];
  guestList.innerHTML = rows.length ? rows.map((guest) => {
    const primaryCard = guest.cards[0] || {};
    return `<button class="crm-guest-card" type="button" data-guest-id="${escapeHtml(guest.id)}">
      <span><strong>${escapeHtml(guest.name)}</strong><small>${escapeHtml(primaryCard.card_name || primaryCard.template_type || 'Gastprofil')}</small></span>
      <span><small>E-Mail</small>${escapeHtml(guest.email || '–')}</span><span><small>Telefon</small>${escapeHtml(guest.phone || '–')}</span>
      <span><small>VIP</small>${escapeHtml(primaryCard.vip_level || '–')}</span><span><small>Besuche</small>${escapeHtml(String(guest.visits))}</span>
      <span><small>Letzter Besuch</small>${escapeHtml(formatDate(guest.last_visit_at))}</span><span class="crm-profile-state ${guest.profile_complete ? 'is-complete' : ''}">${guest.profile_complete ? 'Vollständig' : 'Unvollständig'}</span>
    </button>`;
  }).join('') : '<div class="empty-state"><h3>Keine Gäste gefunden</h3><p>Filter anpassen oder eine personalisierte Karte registrieren.</p></div>';
  const maxPage = Math.max(1, Math.ceil(state.total / state.pageSize));
  pageStatus.textContent = `Seite ${state.page} von ${maxPage} · ${state.total} Gäste`;
  previousPage.disabled = state.page <= 1;
  nextPage.disabled = state.page >= maxPage;
}

async function loadGuests() {
  const data = await crmRequest('list', { ...filterPayload(), page: state.page, page_size: state.pageSize });
  renderGuestList(data);
}

function renderStats(stats) {
  byId('crmStats').innerHTML = [
    ['Registrierte Gäste', stats.total_guests], ['Neue Gäste (30 Tage)', stats.new_guests_30_days], ['Aktive Gäste', stats.active_guests],
    ['Länger nicht besucht', stats.inactive_guests], ['VIP / Member', stats.vip_guests], ['Ø Besuche', stats.average_visits]
  ].map(([label, value]) => `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? 0))}</strong></article>`).join('');
}

function input(label, name, value = '', type = 'text') {
  return `<label>${escapeHtml(label)}<input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value || '')}"></label>`;
}

function customInput(definition, value) {
  const name = `custom_${definition.id}`;
  if (definition.field_type === 'BOOLEAN') return `<label class="check-row"><input name="${name}" type="checkbox" ${value === true ? 'checked' : ''}><span>${escapeHtml(definition.name)}</span></label>`;
  if (definition.field_type === 'SELECT') return `<label>${escapeHtml(definition.name)}<select name="${name}"><option value="">–</option>${(definition.options || []).map((option) => `<option ${String(value) === String(option) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  if (definition.field_type === 'MULTISELECT') return `<label>${escapeHtml(definition.name)}<select name="${name}" multiple>${(definition.options || []).map((option) => `<option ${(value || []).includes(option) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  if (definition.field_type === 'TEXTAREA') return `<label>${escapeHtml(definition.name)}<textarea name="${name}">${escapeHtml(value || '')}</textarea></label>`;
  const type = { NUMBER: 'number', DATE: 'date', URL: 'url' }[definition.field_type] || 'text';
  return input(definition.name, name, value, type);
}

function renderDetail() {
  const data = state.detail;
  if (!data) return;
  const crm = data.crm || {};
  const values = new Map((data.values || []).map((entry) => [entry.field_definition_id, entry.value]));
  const name = crm.display_name || [crm.first_name, crm.last_name].filter(Boolean).join(' ') || data.profile.display_name || 'Gast';
  detailTitle.textContent = name;
  document.querySelectorAll('[data-crm-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.crmTab === state.activeTab));
  if (state.activeTab === 'overview') {
    const visits = (data.cards || []).reduce((sum, card) => sum + (card.card_instances || []).reduce((inner, item) => inner + Number(item.lifetime_visits || 0), 0), 0);
    detailContent.innerHTML = `${data.profile.metadata?.possible_duplicate ? '<div class="message info">Mögliches Duplikat: E-Mail oder Telefonnummer existiert bereits in diesem Business. Bitte vor einer manuellen Zuordnung prüfen; es wurde nicht automatisch zusammengeführt.</div>' : ''}<div class="crm-detail-grid"><article class="panel"><h3>Person</h3><p class="crm-detail-name">${escapeHtml(name)}</p><p>${escapeHtml(crm.company || '–')} · ${escapeHtml(crm.job_title || '–')}</p><p>Altersgruppe: ${escapeHtml(data.profile.age_group || '–')}</p>${state.permissions.can_anonymize ? '<button class="danger" type="button" data-crm-anonymize>CRM-Daten anonymisieren</button>' : ''}</article><article class="panel"><h3>Aktivität</h3><p><strong>${visits}</strong> Besuche</p><p>Letzter Besuch: ${escapeHtml(formatDate(data.profile.last_seen_at))}</p><p>Mitglied seit: ${escapeHtml(formatDate(data.profile.created_at))}</p></article></div>`;
  } else if (state.activeTab === 'contact') {
    const socialsText = (data.socials || []).map((item) => `${item.platform}|${item.url}`).join('\n');
    detailContent.innerHTML = `<form id="crmGuestEditForm" class="panel crm-guest-edit-form"><div class="crm-form-grid">${input('Vorname', 'first_name', crm.first_name)}${input('Nachname', 'last_name', crm.last_name)}${input('Anzeigename', 'display_name', crm.display_name)}${input('Geburtsdatum', 'birth_date', crm.birth_date, 'date')}${input('E-Mail', 'email', crm.email, 'email')}${input('Telefon', 'phone', crm.phone, 'tel')}${input('Mobiltelefon', 'mobile_phone', crm.mobile_phone, 'tel')}${input('Firma', 'company', crm.company)}${input('Position / Jobtitel', 'job_title', crm.job_title)}${input('Strasse', 'street', crm.street)}${input('Hausnummer', 'house_number', crm.house_number)}${input('Adresszusatz', 'address_addition', crm.address_addition)}${input('Postleitzahl', 'postal_code', crm.postal_code)}${input('Ort', 'city', crm.city)}${input('Kanton / Region', 'region', crm.region)}${input('Land', 'country', crm.country)}</div><label>Social Links (eine Zeile: Plattform|https://…)<textarea name="socials" rows="7">${escapeHtml(socialsText)}</textarea></label>${state.permissions.can_edit ? '<button class="primary" type="submit">Kontaktdaten speichern</button>' : ''}</form>`;
  } else if (state.activeTab === 'visits') {
    detailContent.innerHTML = `<div class="table-panel"><table><thead><tr><th>Datum</th><th>Aktion</th></tr></thead><tbody>${(data.visits || []).map((visit) => `<tr><td>${escapeHtml(formatDate(visit.scanned_at, true))}</td><td>${escapeHtml(visit.action_type || 'Scan')}</td></tr>`).join('') || '<tr><td colspan="2">Keine Besuche</td></tr>'}</tbody></table></div>`;
  } else if (state.activeTab === 'cards') {
    detailContent.innerHTML = `<div class="crm-detail-grid">${(data.cards || []).map((card) => `<article class="panel"><h3>${escapeHtml(card.card_templates?.card_name || 'Karte')}</h3><p>${escapeHtml(card.card_templates?.template_type || '')}</p><p>Karten-ID: ${escapeHtml(card.card_instance_number)}</p><p>VIP: ${escapeHtml(card.vip_status || '–')}</p></article>`).join('') || '<p>Keine Karten</p>'}</div>`;
  } else if (state.activeTab === 'internal') {
    detailContent.innerHTML = `<div class="crm-detail-grid"><article class="panel"><h3>Stammgastinformationen</h3><p>${escapeHtml(data.regular_information?.general_info || 'Keine')}</p></article><article class="panel"><h3>Notizen</h3>${(data.notes || []).map((note) => `<p><strong>${escapeHtml(note.priority)}</strong> ${escapeHtml(note.note_text)}</p>`).join('') || '<p>Keine</p>'}</article><article class="panel"><h3>Sperren / Status</h3>${(data.restrictions || []).map((item) => `<p>${escapeHtml(item.restriction_type)} · ${escapeHtml(item.status)}</p>`).join('') || '<p>Keine</p>'}</article></div>`;
  } else {
    detailContent.innerHTML = `<form id="crmCustomValuesForm" class="panel crm-guest-edit-form"><div class="crm-form-grid">${(data.definitions || []).map((definition) => customInput(definition, values.get(definition.id))).join('') || '<p>Noch keine eigenen Felder.</p>'}</div>${state.permissions.can_edit ? '<button class="primary" type="submit">CRM-Felder speichern</button>' : ''}</form>`;
  }
}

async function openDetail(guestId) {
  state.detail = await crmRequest('detail', { guest_id: guestId });
  state.activeTab = 'overview';
  detailSection.hidden = false;
  renderDetail();
  detailSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function parseSocials(value) {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => { const [platform, ...url] = line.split('|'); return { platform: platform.trim().toLowerCase(), url: url.join('|').trim() }; });
}

async function saveGuestForm(form) {
  const data = new FormData(form);
  const crm = Object.fromEntries([...data.entries()].filter(([key]) => key !== 'socials'));
  state.detail = await crmRequest('update', { guest_id: state.detail.profile.id, crm, socials: parseSocials(data.get('socials')) });
  renderDetail();
  await loadGuests();
  showMessage(message, 'CRM-Profil gespeichert.', 'success');
}

async function saveCustomValues(form) {
  const data = new FormData(form);
  const customValues = {};
  for (const definition of state.detail.definitions || []) {
    const name = `custom_${definition.id}`;
    customValues[definition.id] = definition.field_type === 'BOOLEAN' ? data.get(name) === 'on' : definition.field_type === 'MULTISELECT' ? data.getAll(name) : data.get(name);
  }
  state.detail = await crmRequest('update', { guest_id: state.detail.profile.id, custom_values: customValues });
  renderDetail();
  showMessage(message, 'CRM-Felder gespeichert.', 'success');
}

function renderDefinitions() {
  definitionsList.innerHTML = state.definitions.length ? state.definitions.map((definition) => `<button class="template-row" type="button" data-definition-id="${escapeHtml(definition.id)}"><span><strong>${escapeHtml(definition.name)}</strong><small>${escapeHtml(definition.field_key)} · ${escapeHtml(definition.field_type)}</small></span><span>${definition.public_registration_allowed ? 'Öffentlich freigebbar' : 'Nur intern'}</span></button>`).join('') : '<p class="muted">Noch keine eigenen CRM-Felder.</p>';
}

async function loadDefinitions() {
  if (!state.permissions.can_manage_fields) return;
  state.definitions = await crmRequest('definitions');
  definitionSection.hidden = false;
  renderDefinitions();
}

async function exportCsv() {
  const data = await crmRequest('export', filterPayload());
  const headers = ['Name', 'E-Mail', 'Telefon', 'Firma', 'Kartenart', 'VIP-Level', 'Besuche', 'Letzter Besuch', 'Registriert'];
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [headers.map(quote).join(';'), ...(data.rows || []).map((guest) => [guest.name, guest.email, guest.phone, guest.company, guest.cards.map((card) => card.template_type).join(','), guest.cards.map((card) => card.vip_level).filter(Boolean).join(','), guest.visits, guest.last_visit_at, guest.registration_date].map(quote).join(';'))];
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `promillo-crm-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

async function init() {
  const context = await requireLogin({ requireUnlock: true });
  if (!context) return;
  state.client = context.client; state.session = context.session;
  state.business = await state.client.selectRows('businesses', { select: 'id,owner_id,name,logo_url,app_theme,guest_crm_enabled,crm_active_guest_days', filters: [{ column: 'owner_id', op: 'eq', value: state.session.user.id }], maybeSingle: true });
  if (!state.business) {
    const membership = await state.client.selectRows('business_memberships', { select: 'business_id,role,active', filters: [{ column: 'user_id', op: 'eq', value: state.session.user.id }, { column: 'active', op: 'eq', value: true }], maybeSingle: true });
    if (membership?.business_id) state.business = await state.client.selectRows('businesses', { select: 'id,owner_id,name,logo_url,app_theme,guest_crm_enabled,crm_active_guest_days', filters: [{ column: 'id', op: 'eq', value: membership.business_id }], maybeSingle: true });
  }
  if (!state.business?.guest_crm_enabled) { window.location.replace('dashboard.html'); return; }
  renderBusinessHeader(state.business); applyBusinessAppTheme(state.business, state.session.user.id);
  const stats = await crmRequest('stats');
  renderStats(stats); exportButton.hidden = !state.permissions.can_export;
  await Promise.all([loadGuests(), loadDefinitions()]);
  const requestedGuestId = new URLSearchParams(window.location.search).get('guest');
  if (/^[0-9a-f-]{36}$/i.test(requestedGuestId || '')) await openDetail(requestedGuestId);
}

filterForm?.addEventListener('submit', (event) => { event.preventDefault(); state.page = 1; loadGuests().catch((error) => showMessage(message, error.message, 'error')); });
guestList?.addEventListener('click', (event) => { const button = event.target.closest('[data-guest-id]'); if (button) openDetail(button.dataset.guestId).catch((error) => showMessage(message, error.message, 'error')); });
previousPage?.addEventListener('click', () => { state.page -= 1; loadGuests().catch(() => {}); }); nextPage?.addEventListener('click', () => { state.page += 1; loadGuests().catch(() => {}); });
byId('crmCloseDetail')?.addEventListener('click', () => { detailSection.hidden = true; state.detail = null; });
document.querySelector('.crm-detail-tabs')?.addEventListener('click', (event) => { const button = event.target.closest('[data-crm-tab]'); if (button) { state.activeTab = button.dataset.crmTab; renderDetail(); } });
detailContent?.addEventListener('submit', (event) => { event.preventDefault(); const promise = event.target.id === 'crmGuestEditForm' ? saveGuestForm(event.target) : saveCustomValues(event.target); promise.catch((error) => showMessage(message, error.message, 'error')); });
detailContent?.addEventListener('click', (event) => {
  if (!event.target.closest('[data-crm-anonymize]') || !state.detail) return;
  if (!window.confirm('Kontaktdaten, Social Links und Custom Fields dieses Gastes anonymisieren? Anonyme Besuchsstatistiken bleiben erhalten.')) return;
  crmRequest('anonymize', { guest_id: state.detail.profile.id }).then(async () => { detailSection.hidden = true; state.detail = null; await loadGuests(); showMessage(message, 'CRM-Daten wurden anonymisiert. Besuchsstatistiken bleiben erhalten.', 'success'); }).catch((error) => showMessage(message, error.message, 'error'));
});
exportButton?.addEventListener('click', () => exportCsv().catch((error) => showMessage(message, error.message, 'error')));
definitionForm?.addEventListener('submit', (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(definitionForm)); data.required = definitionForm.required.checked; data.public_registration_allowed = definitionForm.public_registration_allowed.checked; data.options = String(data.options || '').split(',').map((value) => value.trim()).filter(Boolean); crmRequest('save_definition', data).then(() => { definitionForm.reset(); return loadDefinitions(); }).catch((error) => showMessage(message, error.message, 'error')); });
definitionsList?.addEventListener('click', (event) => { const definition = state.definitions.find((item) => item.id === event.target.closest('[data-definition-id]')?.dataset.definitionId); if (!definition) return; for (const [key, value] of Object.entries(definition)) if (definitionForm.elements[key]) definitionForm.elements[key].value = Array.isArray(value) ? value.join(', ') : value ?? ''; definitionForm.required.checked = definition.required; definitionForm.public_registration_allowed.checked = definition.public_registration_allowed; });

init().catch((error) => showMessage(message, error.message, 'error'));
