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

const state = {
  client: null,
  session: null,
  profile: null,
  business: null,
  logoVariantsSupported: true
};

const businessAccountLegacySelect = [
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

const businessAccountSelect = [
  businessAccountLegacySelect,
  'company_logo_original_url',
  'company_logo_original_path',
  'company_logo_processed_url',
  'company_logo_processed_path',
  'company_logo_background_mode'
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
const companyLogoBackgroundMode = byId('companyLogoBackgroundMode');
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
  const backgroundMode = state.business?.company_logo_background_mode === 'original' ? 'original' : 'removed';
  businessForm.querySelectorAll('input[name="company_logo_background_mode"]').forEach((input) => {
    input.checked = input.value === backgroundMode;
  });
  renderCompanyLogoPreview();
  renderBusinessHeader(state.business || {});
  renderMobileAccountSummary();
}

async function loadBusiness() {
  const options = {
    filters: [{ column: 'owner_id', op: 'eq', value: state.session.user.id }],
    maybeSingle: true
  };

  try {
    state.business = await state.client.selectRows('businesses', { ...options, select: businessAccountSelect });
  } catch (_error) {
    state.logoVariantsSupported = false;
    state.business = await state.client.selectRows('businesses', { ...options, select: businessAccountLegacySelect });
  }

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
    company_logo_path: String(formData.get('company_logo_path') || state.business?.company_logo_path || '').trim() || null
  };

  if (state.logoVariantsSupported) {
    payload.company_logo_background_mode = logoBackgroundMode();
  }

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
    ], { select: state.logoVariantsSupported ? businessAccountSelect : businessAccountLegacySelect })
    : await state.client.insertRows('businesses', {
      ...payload,
      owner_id: state.session.user.id
    }, { select: state.logoVariantsSupported ? businessAccountSelect : businessAccountLegacySelect });

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

function logoBackgroundMode() {
  return businessForm?.querySelector('input[name="company_logo_background_mode"]:checked')?.value === 'original'
    ? 'original'
    : 'removed';
}

function logoVariantForMode(business, mode) {
  if (mode === 'original') {
    return {
      url: String(business?.company_logo_original_url || '').trim(),
      path: String(business?.company_logo_original_path || '').trim() || null
    };
  }

  return {
    url: String(business?.company_logo_processed_url || business?.logo_url || '').trim(),
    path: String(business?.company_logo_processed_path || business?.company_logo_path || '').trim() || null
  };
}

function setLogoProcessingState(processing) {
  uploadCompanyLogoButton && (uploadCompanyLogoButton.disabled = processing);
  removeCompanyLogoButton && (removeCompanyLogoButton.disabled = processing);
  companyLogoBackgroundMode?.querySelectorAll('input').forEach((input) => {
    input.disabled = processing;
  });
}

async function logoFileToAppleSafePng(file, removeBackground) {
  return imageFileToPngUnderLimit(file, {
    maxBytes: maxLogoFileBytes,
    maxSourceBytes: maxLogoSourceFileBytes,
    filename: 'company-logo.png',
    targetWidth: 1024,
    targetHeight: 1024,
    backgroundColor: 'transparent',
    removeBackground,
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
  // Die Auswahl vor persistBusiness() festhalten: Ein Legacy-Schema ohne die
  // Variantenspalten lädt das Formular sonst neu und setzt den Radio-Wert zurück.
  const requestedMode = logoBackgroundMode();
  setLogoProcessingState(true);
  uploadCompanyLogoButton && (uploadCompanyLogoButton.textContent = t('account.logoPreparingButton'));

  try {
    showMessage(accountMessage, t('account.logoPreparing'));
    const originalLogoFile = await logoFileToAppleSafePng(file, false);
    let processedLogoFile = null;
    let processingError = null;

    try {
      processedLogoFile = await logoFileToAppleSafePng(file, true);
    } catch (error) {
      processingError = error;
    }

    showMessage(accountMessage, t('account.logoUploading'));
    uploadCompanyLogoButton && (uploadCompanyLogoButton.textContent = t('account.logoUploadingButton'));

    const business = await persistBusiness();
    const previousPaths = [...new Set([
      business.company_logo_path,
      business.company_logo_original_path,
      business.company_logo_processed_path
    ].filter(Boolean))];
    const uploadId = `${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2)}`;
    const originalPath = `${business.id}/${uploadId}-original.png`;
    const processedPath = `${business.id}/${uploadId}-removed.png`;
    const uploadedPaths = [];
    const originalUpload = await state.client.uploadStorageObject(businessLogoBucket, originalPath, originalLogoFile);
    uploadedPaths.push(originalPath);
    let processedUpload = null;

    if (processedLogoFile) {
      try {
        processedUpload = await state.client.uploadStorageObject(businessLogoBucket, processedPath, processedLogoFile);
        uploadedPaths.push(processedPath);
      } catch (error) {
        processingError = error;
      }
    }

    const activeMode = requestedMode === 'removed' && processedUpload ? 'removed' : 'original';
    const activeUpload = activeMode === 'removed' ? processedUpload : originalUpload;
    const activePath = activeMode === 'removed' ? processedPath : originalPath;
    const updatePayload = {
      logo_url: activeUpload.publicUrl,
      company_logo_path: activePath,
      company_logo_updated_at: new Date().toISOString()
    };

    if (state.logoVariantsSupported) {
      Object.assign(updatePayload, {
        company_logo_original_url: originalUpload.publicUrl,
        company_logo_original_path: originalPath,
        company_logo_processed_url: processedUpload?.publicUrl || null,
        company_logo_processed_path: processedUpload ? processedPath : null,
        company_logo_background_mode: activeMode
      });
    }

    try {
      state.business = (await state.client.updateRows('businesses', updatePayload, [
        { column: 'id', op: 'eq', value: business.id },
        { column: 'owner_id', op: 'eq', value: state.session.user.id }
      ], { select: state.logoVariantsSupported ? businessAccountSelect : businessAccountLegacySelect }))[0];
    } catch (error) {
      state.client.deleteStorageObjects(businessLogoBucket, uploadedPaths).catch(() => {});
      throw error;
    }

    const currentPaths = new Set([
      state.business.company_logo_path,
      state.business.company_logo_original_path,
      state.business.company_logo_processed_path
    ].filter(Boolean));
    const obsoletePaths = previousPaths.filter((path) => !currentPaths.has(path));

    if (obsoletePaths.length) {
      state.client.deleteStorageObjects(businessLogoBucket, obsoletePaths).catch(() => {});
    }

    fillBusinessForm();
    if (!state.logoVariantsSupported) {
      const activeModeInput = businessForm.querySelector(`input[name="company_logo_background_mode"][value="${activeMode}"]`);
      activeModeInput && (activeModeInput.checked = true);
    }
    showMessage(
      accountMessage,
      processingError ? `${t('account.logoProcessedFailed')} ${processingError.message}` : t('account.logoSaved'),
      processingError ? 'info' : 'success'
    );
  } finally {
    if (companyLogoUpload) {
      companyLogoUpload.value = '';
    }

    setLogoProcessingState(false);
    uploadCompanyLogoButton && (uploadCompanyLogoButton.textContent = t('account.logoUpload'));
  }
}

async function changeLogoBackgroundMode() {
  if (!state.business?.id || !businessLogoUrl(state.business || {})) {
    return;
  }

  if (!state.logoVariantsSupported) {
    showMessage(accountMessage, t('account.logoMigrationRequired'), 'error');
    return;
  }

  const mode = logoBackgroundMode();
  const variant = logoVariantForMode(state.business, mode);

  if (!variant.url) {
    const previousMode = state.business.company_logo_background_mode === 'original' ? 'original' : 'removed';
    const previousInput = businessForm.querySelector(`input[name="company_logo_background_mode"][value="${previousMode}"]`);
    previousInput && (previousInput.checked = true);
    showMessage(accountMessage, t('account.logoVariantMissing'), 'info');
    return;
  }

  state.business = (await state.client.updateRows('businesses', {
    company_logo_background_mode: mode,
    logo_url: variant.url,
    company_logo_path: variant.path,
    company_logo_updated_at: new Date().toISOString()
  }, [
    { column: 'id', op: 'eq', value: state.business.id },
    { column: 'owner_id', op: 'eq', value: state.session.user.id }
  ], { select: businessAccountSelect }))[0];

  fillBusinessForm();
  showMessage(accountMessage, t('account.logoModeSaved'), 'success');
}

async function removeCompanyLogo() {
  if (!state.business?.id) {
    showMessage(accountMessage, t('account.logoNoBusiness'), 'info');
    return;
  }

  showMessage(accountMessage, t('account.logoRemoving'));
  const previousPaths = [...new Set([
    state.business.company_logo_path,
    state.business.company_logo_original_path,
    state.business.company_logo_processed_path
  ].filter(Boolean))];

  const removePayload = {
    logo_url: '',
    company_logo_path: null,
    company_logo_updated_at: new Date().toISOString()
  };

  if (state.logoVariantsSupported) {
    Object.assign(removePayload, {
      company_logo_original_url: null,
      company_logo_original_path: null,
      company_logo_processed_url: null,
      company_logo_processed_path: null,
      company_logo_background_mode: 'removed'
    });
  }

  state.business = (await state.client.updateRows('businesses', removePayload, [
    { column: 'id', op: 'eq', value: state.business.id },
    { column: 'owner_id', op: 'eq', value: state.session.user.id }
  ], { select: state.logoVariantsSupported ? businessAccountSelect : businessAccountLegacySelect }))[0];

  fillBusinessForm();

  if (previousPaths.length) {
    state.client.deleteStorageObjects(businessLogoBucket, previousPaths).catch(() => {});
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

  uploadCompanyLogoButton?.addEventListener('click', () => {
    companyLogoUpload?.click();
  });

  companyLogoUpload?.addEventListener('change', (event) => {
    uploadCompanyLogo(event.target.files?.[0]).catch((error) => showMessage(accountMessage, error.message, 'error'));
  });

  companyLogoBackgroundMode?.addEventListener('change', () => {
    changeLogoBackgroundMode().catch((error) => showMessage(accountMessage, error.message, 'error'));
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
