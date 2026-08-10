import { requireLogin } from './guards.js';
import { localeForCurrentLanguage, setupLanguageSelectors, t } from './i18n.js';
import { pagePath } from './path.js';
import {
  businessDisplayName,
  businessInitials,
  businessLogoUrl,
  byId,
  escapeHtml,
  renderBusinessHeader,
  showMessage
} from './ui.js';
import { imageFileToPngUnderLimit } from './imageUploadOptimizer.js';
import { APP_THEMES, applyAppTheme, applyBusinessAppTheme, applyCachedAppTheme, normalizeAppTheme } from './theme.js';

const state = {
  client: null,
  session: null,
  profile: null,
  business: null,
  previewTheme: null
};

const businessAccountSelect = [
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
  'app_theme',
  'guest_crm_enabled',
  'crm_active_guest_days',
  'guest_scan_settings',
  'created_at',
  'updated_at'
].join(',');

const accountMessage = byId('accountMessage');
const loginDataList = byId('loginDataList');
const businessForm = byId('accountBusinessForm');
const passwordChangeForm = byId('passwordChangeForm');
const mobileAccountCompanyName = byId('mobileAccountCompanyName');
const companyLogoPreview = byId('companyLogoPreview');
const companyLogoUpload = byId('companyLogoUpload');
const uploadCompanyLogoButton = byId('uploadCompanyLogoButton');
const removeCompanyLogoButton = byId('removeCompanyLogoButton');
const appThemeOptions = byId('appThemeOptions');
const appThemeStatus = byId('appThemeStatus');
const saveAppThemeButton = byId('saveAppThemeButton');
const accountCrmNav = byId('accountCrmNav');
const businessLogoBucket = 'business-logos';
const maxLogoFileBytes = 2 * 1024 * 1024;
const maxLogoSourceFileBytes = 25 * 1024 * 1024;

function formatDate(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat(localeForCurrentLanguage(), {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function detailRow(label, value) {
  return `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value || '-')}</dd>
    </div>
  `;
}

function renderLoginData() {
  if (!loginDataList) {
    return;
  }

  const user = state.session?.user || {};
  const displayName = state.profile?.display_name || user.user_metadata?.display_name || '';

  loginDataList.innerHTML = [
    detailRow(t('account.loginEmail'), user.email || state.profile?.email),
    detailRow(t('account.displayName'), displayName),
    detailRow(t('account.accountId'), user.id || state.profile?.id),
    detailRow(t('account.unlock'), state.profile?.unlock ? t('account.unlocked') : t('account.waitingUnlock')),
    detailRow(t('account.accountCreated'), formatDate(state.profile?.created_at || user.created_at)),
    detailRow(t('account.lastLogin'), formatDate(user.last_sign_in_at)),
    detailRow(t('account.profileUpdated'), formatDate(state.profile?.updated_at || user.updated_at))
  ].join('');
}

function renderMobileAccountSummary() {
  if (!mobileAccountCompanyName) {
    return;
  }

  mobileAccountCompanyName.textContent = businessDisplayName(state.business || {});
}

function numberOrNull(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return null;
  }

  const numberValue = Number(text);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function fillBusinessForm() {
  if (!businessForm) {
    return;
  }

  businessForm.name.value = state.business?.name || '';
  businessForm.description.value = state.business?.description || '';
  businessForm.address.value = state.business?.address || '';
  businessForm.location_lat.value = state.business?.location_lat ?? '';
  businessForm.location_lng.value = state.business?.location_lng ?? '';
  businessForm.phone.value = state.business?.phone || '';
  businessForm.website.value = state.business?.website || '';
  businessForm.logo_url.value = state.business?.logo_url || '';
  businessForm.company_logo_path.value = state.business?.company_logo_path || '';
  const scanSettings = state.business?.guest_scan_settings || {};
  businessForm.regular_info_auto_show.checked = scanSettings.regular_info_auto_show === true;
  businessForm.notes_auto_show_warning.checked = scanSettings.notes_auto_show_warning !== false;
  businessForm.notes_auto_show_important.checked = scanSettings.notes_auto_show_important !== false;
  businessForm.notes_auto_show_normal.checked = scanSettings.notes_auto_show_normal === true;
  businessForm.guest_crm_enabled.checked = state.business?.guest_crm_enabled === true;
  businessForm.crm_active_guest_days.value = state.business?.crm_active_guest_days || 30;
  if (accountCrmNav) accountCrmNav.hidden = state.business?.guest_crm_enabled !== true;
  state.previewTheme = applyBusinessAppTheme(state.business, state.session?.user?.id);
  renderThemeOptions();
  renderCompanyLogoPreview();
  renderBusinessHeader(state.business || {});
  renderMobileAccountSummary();
}

function renderThemeOptions() {
  if (!appThemeOptions) return;

  const selectedTheme = normalizeAppTheme(state.previewTheme || state.business?.app_theme);
  appThemeOptions.innerHTML = APP_THEMES.map((theme) => `
    <label class="theme-option">
      <input type="radio" name="app_theme" value="${escapeHtml(theme.id)}" ${theme.id === selectedTheme ? 'checked' : ''}>
      <span class="theme-preview" style="--theme-primary:${escapeHtml(theme.colors[0])};--theme-background:${escapeHtml(theme.colors[1])};--theme-secondary:${escapeHtml(theme.colors[2])}"><span></span></span>
      <strong>${escapeHtml(theme.label)}</strong>
    </label>
  `).join('');
}

function previewAppTheme(theme) {
  state.previewTheme = applyAppTheme(theme);
  if (appThemeStatus) appThemeStatus.textContent = 'Vorschau aktiv – noch nicht gespeichert.';
}

async function saveAppTheme() {
  const appTheme = normalizeAppTheme(state.previewTheme || state.business?.app_theme);
  saveAppThemeButton && (saveAppThemeButton.disabled = true);
  if (appThemeStatus) appThemeStatus.textContent = 'Theme wird gespeichert …';

  try {
    if (!state.business?.id) {
      await persistBusiness({ app_theme: appTheme });
    } else {
      state.business = (await state.client.updateRows('businesses', { app_theme: appTheme }, [
        { column: 'id', op: 'eq', value: state.business.id },
        { column: 'owner_id', op: 'eq', value: state.session.user.id }
      ], { select: businessAccountSelect }))[0];
      state.previewTheme = applyBusinessAppTheme(state.business, state.session.user.id);
      renderThemeOptions();
    }

    if (appThemeStatus) appThemeStatus.textContent = 'Theme gespeichert.';
  } finally {
    saveAppThemeButton && (saveAppThemeButton.disabled = false);
  }
}

async function loadBusiness() {
  state.business = await state.client.selectRows('businesses', {
    select: businessAccountSelect,
    filters: [{ column: 'owner_id', op: 'eq', value: state.session.user.id }],
    maybeSingle: true
  });

  fillBusinessForm();
}

function businessPayloadFromForm() {
  const formData = new FormData(businessForm);

  const payload = {
    name: String(formData.get('name') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    address: String(formData.get('address') || '').trim(),
    location_lat: numberOrNull(formData.get('location_lat')),
    location_lng: numberOrNull(formData.get('location_lng')),
    phone: String(formData.get('phone') || '').trim(),
    website: String(formData.get('website') || '').trim(),
    logo_url: String(formData.get('logo_url') || state.business?.logo_url || '').trim(),
    company_logo_path: String(formData.get('company_logo_path') || state.business?.company_logo_path || '').trim() || null,
    guest_crm_enabled: formData.get('guest_crm_enabled') === 'on',
    crm_active_guest_days: Math.min(3650, Math.max(1, Number(formData.get('crm_active_guest_days') || 30))),
    guest_scan_settings: {
      regular_info_auto_show: formData.get('regular_info_auto_show') === 'on',
      notes_auto_show_warning: formData.get('notes_auto_show_warning') === 'on',
      notes_auto_show_important: formData.get('notes_auto_show_important') === 'on',
      notes_auto_show_normal: formData.get('notes_auto_show_normal') === 'on'
    }
  };

  return payload;
}

function validateBusinessPayload(payload) {
  if (!payload.name) {
    throw new Error(t('account.businessNameRequired'));
  }

  if (payload.location_lat != null && (payload.location_lat < -90 || payload.location_lat > 90)) {
    throw new Error(t('account.latitudeInvalid'));
  }

  if (payload.location_lng != null && (payload.location_lng < -180 || payload.location_lng > 180)) {
    throw new Error(t('account.longitudeInvalid'));
  }
}

function validatePasswordChangePayload({ currentPassword, newPassword, repeatPassword }) {
  if (!currentPassword) {
    throw new Error(t('account.currentPasswordRequired'));
  }

  if (String(newPassword || '').length < 6) {
    throw new Error(t('auth.passwordMin'));
  }

  if (newPassword !== repeatPassword) {
    throw new Error(t('auth.passwordMismatch'));
  }

  if (currentPassword === newPassword) {
    throw new Error(t('account.passwordSame'));
  }
}

async function persistBusiness(extraPayload = {}) {
  const payload = {
    ...businessPayloadFromForm(),
    ...extraPayload
  };

  validateBusinessPayload(payload);

  const rows = state.business?.id
    ? await state.client.updateRows('businesses', payload, [
      { column: 'id', op: 'eq', value: state.business.id },
      { column: 'owner_id', op: 'eq', value: state.session.user.id }
    ], { select: businessAccountSelect })
    : await state.client.insertRows('businesses', {
      ...payload,
      owner_id: state.session.user.id
    }, { select: businessAccountSelect });

  state.business = rows[0];
  fillBusinessForm();
  return state.business;
}

async function saveBusiness(event) {
  event.preventDefault();
  showMessage(accountMessage, t('account.saving'));

  await persistBusiness();
  showMessage(accountMessage, t('account.saved'), 'success');
}

async function changePassword(event) {
  event.preventDefault();
  showMessage(accountMessage, t('account.passwordChecking'));

  const formData = new FormData(passwordChangeForm);
  const payload = {
    currentPassword: String(formData.get('current_password') || ''),
    newPassword: String(formData.get('new_password') || ''),
    repeatPassword: String(formData.get('new_password_repeat') || '')
  };

  validatePasswordChangePayload(payload);

  const email = state.session?.user?.email || state.profile?.email;

  if (!email) {
    throw new Error(t('account.emailMissing'));
  }

  try {
    const refreshedSession = await state.client.signIn({
      email,
      password: payload.currentPassword,
      remember: state.client.isRememberedSession()
    });

    state.session = refreshedSession;
  } catch {
    throw new Error(t('account.currentPasswordWrong'));
  }

  showMessage(accountMessage, t('account.newPasswordSaving'));
  await state.client.updatePassword(payload.newPassword);
  state.session = await state.client.ensureSession();
  passwordChangeForm.reset();
  renderLoginData();
  showMessage(accountMessage, t('account.passwordChanged'), 'success');
}

function renderCompanyLogoPreview() {
  if (!companyLogoPreview || !businessForm) {
    return;
  }

  const name = businessDisplayName({
    ...state.business,
    name: businessForm.name.value || state.business?.name
  });
  const logoUrl = businessLogoUrl(state.business || {});

  companyLogoPreview.textContent = '';
  companyLogoPreview.classList.toggle('has-image', Boolean(logoUrl));

  if (logoUrl) {
    const image = document.createElement('img');
    image.crossOrigin = 'anonymous';
    image.src = logoUrl;
    image.alt = name;
    image.addEventListener('error', () => {
      companyLogoPreview.classList.remove('has-image');
      companyLogoPreview.textContent = businessInitials(name);
    }, { once: true });
    companyLogoPreview.append(image);
    return;
  }

  companyLogoPreview.textContent = businessInitials(name);
}

function setLogoProcessingState(processing) {
  uploadCompanyLogoButton && (uploadCompanyLogoButton.disabled = processing);
  removeCompanyLogoButton && (removeCompanyLogoButton.disabled = processing);
}

async function logoFileToAppleSafePng(file) {
  return imageFileToPngUnderLimit(file, {
    maxBytes: maxLogoFileBytes,
    maxSourceBytes: maxLogoSourceFileBytes,
    filename: 'company-logo.png',
    targetWidth: 1024,
    targetHeight: 1024,
    backgroundColor: 'transparent',
    removeBackground: true,
    maxSideCandidates: [1400, 1200, 1000, 900, 800, 700, 600, 500, 420, 360, 300, 240],
    emptyMessage: t('account.logoEmpty'),
    typeMessage: t('account.logoType'),
    sourceTooLargeMessage: t('account.logoSourceTooLarge'),
    readErrorMessage: t('account.logoReadError'),
    prepareErrorMessage: t('account.logoPrepareError'),
    outputTooLargeMessage: t('account.logoOutputTooLarge')
  });
}

async function uploadCompanyLogo(file) {
  setLogoProcessingState(true);
  uploadCompanyLogoButton && (uploadCompanyLogoButton.textContent = t('account.logoPreparingButton'));

  try {
    showMessage(accountMessage, t('account.logoPreparing'));
    const pngLogoFile = await logoFileToAppleSafePng(file);

    showMessage(accountMessage, t('account.logoUploading'));
    uploadCompanyLogoButton && (uploadCompanyLogoButton.textContent = t('account.logoUploadingButton'));

    const business = await persistBusiness();
    const previousPath = business.company_logo_path;
    const objectPath = `${business.id}/${Date.now()}-logo.png`;
    const uploadResult = await state.client.uploadStorageObject(businessLogoBucket, objectPath, pngLogoFile);

    try {
      state.business = (await state.client.updateRows('businesses', {
        logo_url: uploadResult.publicUrl,
        company_logo_path: objectPath,
        company_logo_updated_at: new Date().toISOString()
      }, [
        { column: 'id', op: 'eq', value: business.id },
        { column: 'owner_id', op: 'eq', value: state.session.user.id }
      ], { select: businessAccountSelect }))[0];
    } catch (error) {
      state.client.deleteStorageObjects(businessLogoBucket, [objectPath]).catch(() => {});
      throw error;
    }

    if (previousPath && previousPath !== objectPath) {
      state.client.deleteStorageObjects(businessLogoBucket, [previousPath]).catch(() => {});
    }

    fillBusinessForm();
    showMessage(accountMessage, t('account.logoSaved'), 'success');
  } finally {
    if (companyLogoUpload) {
      companyLogoUpload.value = '';
    }

    setLogoProcessingState(false);
    uploadCompanyLogoButton && (uploadCompanyLogoButton.textContent = t('account.logoUpload'));
  }
}

async function removeCompanyLogo() {
  if (!state.business?.id) {
    showMessage(accountMessage, t('account.logoNoBusiness'), 'info');
    return;
  }

  showMessage(accountMessage, t('account.logoRemoving'));
  const previousPath = state.business.company_logo_path;

  state.business = (await state.client.updateRows('businesses', {
    logo_url: '',
    company_logo_path: null,
    company_logo_updated_at: new Date().toISOString()
  }, [
    { column: 'id', op: 'eq', value: state.business.id },
    { column: 'owner_id', op: 'eq', value: state.session.user.id }
  ], { select: businessAccountSelect }))[0];

  fillBusinessForm();

  if (previousPath) {
    state.client.deleteStorageObjects(businessLogoBucket, [previousPath]).catch(() => {});
  }

  showMessage(accountMessage, t('account.logoRemoved'), 'success');
}

async function initAccount() {
  setupLanguageSelectors(document);

  const context = await requireLogin({ requireUnlock: true });

  if (!context) {
    return;
  }

  state.client = context.client;
  state.session = context.session;
  state.profile = context.profile;
  applyCachedAppTheme(state.session.user.id);

  renderLoginData();
  await loadBusiness();

  window.addEventListener('el-promillo-language-change', () => {
    renderLoginData();
    renderMobileAccountSummary();
  });

  businessForm?.addEventListener('submit', (event) => {
    saveBusiness(event).catch((error) => showMessage(accountMessage, error.message, 'error'));
  });

  passwordChangeForm?.addEventListener('submit', (event) => {
    changePassword(event).catch((error) => showMessage(accountMessage, error.message, 'error'));
  });

  businessForm?.addEventListener('input', () => {
    renderCompanyLogoPreview();
    renderBusinessHeader({
      ...state.business,
      name: businessForm.name.value
    });
  });

  appThemeOptions?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="app_theme"]');
    if (input) previewAppTheme(input.value);
  });

  saveAppThemeButton?.addEventListener('click', () => {
    saveAppTheme().catch((error) => {
      if (appThemeStatus) appThemeStatus.textContent = error.message;
    });
  });

  uploadCompanyLogoButton?.addEventListener('click', () => {
    companyLogoUpload?.click();
  });

  companyLogoUpload?.addEventListener('change', (event) => {
    uploadCompanyLogo(event.target.files?.[0]).catch((error) => showMessage(accountMessage, error.message, 'error'));
  });

  removeCompanyLogoButton?.addEventListener('click', () => {
    removeCompanyLogo().catch((error) => showMessage(accountMessage, error.message, 'error'));
  });

  async function logout() {
    await state.client.signOut();
    window.location.replace(pagePath('index.html'));
  }

  byId('logoutButton')?.addEventListener('click', logout);
  byId('mobileLogoutButton')?.addEventListener('click', logout);
}

initAccount().catch((error) => {
  showMessage(accountMessage, error.message, 'error');
});
