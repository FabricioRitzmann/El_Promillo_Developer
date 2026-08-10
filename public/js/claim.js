import { apiUrl, edgeFunctionUrl, loadPublicConfig } from './config.js';
import { isPublishedStaticPage } from './path.js';
import { byId, escapeHtml, showMessage, walletPreviewHtml } from './ui.js';
import { featureEnabled } from './templateFeatures.js';
import { detectWalletDevice } from './walletDeviceDetection.js';

const claimMessage = byId('claimMessage');
const walletPrimaryButton = byId('walletPrimaryButton');
const claimButton = byId('claimButton');
const googleWalletButton = byId('googleWalletButton');
const preview = byId('claimPreview');
const resultPanel = byId('claimResult');

let template = null;
let publicConfig = null;
let currentClaimResult = null;
let detectedDeviceWallet = 'choice';
let currentClaimToken = '';
let currentClaimSource = 'direct_qr';

function configureWalletButtons() {
  detectedDeviceWallet = detectWalletDevice().wallet;
  walletPrimaryButton?.setAttribute('data-wallet-provider', detectedDeviceWallet);
}

async function loadTemplate() {
  const params = new URLSearchParams(window.location.search);
  const templateId = params.get('template');
  const claimToken = params.get('token') || params.get('claim_token');
  currentClaimSource = params.get('source') === 'wallet_share' ? 'wallet_share' : 'direct_qr';
  const templateKey = templateId || claimToken;
  currentClaimToken = claimToken || '';

  if (!templateKey) {
    throw new Error('Template fehlt im Link.');
  }

  publicConfig = await loadPublicConfig();

  let response = null;

  if (!isPublishedStaticPage()) {
    response = await fetch(apiUrl(`/api/templates/${encodeURIComponent(templateKey)}`)).catch(() => null);
  }

  if (!response?.ok) {
    const edgeUrl = new URL(edgeFunctionUrl('get-public-template'));
    if (claimToken) {
      edgeUrl.searchParams.set('token', claimToken);
    } else {
      edgeUrl.searchParams.set('template', templateId);
    }
    response = await fetch(edgeUrl, {
      headers: {
        apikey: publicConfig.supabase.anonKey,
        Authorization: `Bearer ${publicConfig.supabase.anonKey}`
      }
    });
  }

  template = await response.json();

  if (!response.ok || !template) {
    throw new Error(template?.error || 'Diese Karte ist nicht verfügbar.');
  }

  preview.innerHTML = walletPreviewHtml(template);
  walletPrimaryButton.disabled = false;
  claimButton.disabled = false;
  googleWalletButton.disabled = false;
  configureWalletButtons();
}

async function downloadPkpassResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok || !contentType.includes('application/vnd.apple.pkpass')) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error_message || details.error || 'Apple-Wallet-Datei konnte nicht erstellt werden.');
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  if (detectedDeviceWallet === 'apple') {
    window.location.href = objectUrl;
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    return;
  }

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'wallet-card.pkpass';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

async function downloadApplePass(result) {
  const supabaseUrl = publicConfig?.supabase?.url?.replace(/\/$/, '');
  const anonKey = publicConfig?.supabase?.anonKey;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Edge Function ist nicht konfiguriert.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/claim-apple-pass`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    },
    body: JSON.stringify({
      templateId: template.id,
      claimToken: currentClaimToken || undefined,
      cardId: result.card?.id,
      walletObjectId: result.card?.wallet_object_id
    })
  });

  await downloadPkpassResponse(response);
}

function setClaimButtonsDisabled(disabled) {
  if (walletPrimaryButton) {
    walletPrimaryButton.disabled = disabled;
  }

  if (claimButton) {
    claimButton.disabled = disabled;
  }

  if (googleWalletButton) {
    googleWalletButton.disabled = disabled;
  }

}

function createBrowserWalletObjectId(walletPlatform) {
  const randomId = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${walletPlatform}_${randomId}`;
}

function claimWalletStorageKey(walletPlatform) {
  return `wallet_cards_claim:${template.id}:${walletPlatform}`;
}

function getClaimWalletObjectId(walletPlatform) {
  const storageKey = claimWalletStorageKey(walletPlatform);

  try {
    const existingValue = window.localStorage.getItem(storageKey);

    if (existingValue) {
      return existingValue;
    }

    const walletObjectId = createBrowserWalletObjectId(walletPlatform);
    window.localStorage.setItem(storageKey, walletObjectId);
    return walletObjectId;
  } catch {
    return createBrowserWalletObjectId(walletPlatform);
  }
}

function rememberClaimWalletObjectId(walletPlatform, walletObjectId) {
  if (!walletObjectId) {
    return;
  }

  try {
    window.localStorage.setItem(claimWalletStorageKey(walletPlatform), walletObjectId);
  } catch {
    // Ohne localStorage funktioniert Claim weiterhin, nur ohne Browser-Reuse.
  }
}

function safeGoogleWalletSaveUrl(saveUrl) {
  const value = String(saveUrl || '').trim();

  try {
    const url = new URL(value);

    if (url.origin === 'https://pay.google.com' && url.pathname.startsWith('/gp/v/save/')) {
      return url.href;
    }
  } catch {
    // Strukturierter Fehler folgt unten.
  }

  throw new Error('Google-Wallet-Link ist ungültig.');
}


async function claimCard(walletPlatform = 'apple') {
  setClaimButtonsDisabled(true);
  showMessage(claimMessage, 'Kundenkarte wird erstellt ...');

  let result;
  const walletObjectId = getClaimWalletObjectId(walletPlatform);

  try {
    result = await claimCardViaEdge(walletPlatform, walletObjectId);
  } catch (error) {
    if (!error.fallbackToLocal) {
      throw error;
    }

    result = await claimCardViaLocalApi(walletPlatform, walletObjectId);
  }

  rememberClaimWalletObjectId(walletPlatform, result.card?.wallet_object_id || walletObjectId);

  const cardCode = result.card?.card_instance_number || result.card?.customer_code || '';

  resultPanel.hidden = false;
  resultPanel.innerHTML = `
    <h2>${result.reused ? 'Karte gefunden' : 'Karte erstellt'}</h2>
    <p class="customer-code">${escapeHtml(cardCode)}</p>
    <p class="muted">Diese Karten-ID ist eindeutig und kann im Scanner verwendet werden.</p>
    ${walletPlatform === 'apple' ? '<button id="downloadApplePassButton" class="primary" type="button">Wallet-Datei laden</button>' : ''}
    ${topupPanelHtml(result)}
  `;
  currentClaimResult = result;

  if (walletPlatform === 'google') {
    try {
      showMessage(claimMessage, 'Google-Wallet-Link wird erstellt ...');
      const walletResult = await createGoogleWalletSaveLink(result);
      const saveUrl = safeGoogleWalletSaveUrl(walletResult.saveUrl);
      rememberClaimWalletObjectId(walletPlatform, walletResult.walletObjectId);
      resultPanel.insertAdjacentHTML('beforeend', `
        <a class="button primary" href="${escapeHtml(saveUrl)}">In Google Wallet speichern</a>
      `);

      if (detectedDeviceWallet === 'google') {
        showMessage(claimMessage, 'Google Wallet wird geöffnet ...', 'success');
        window.location.href = saveUrl;
      } else {
        showMessage(claimMessage, 'Google-Wallet-Link wurde erstellt.', 'success');
      }
    } catch (error) {
      showMessage(
        claimMessage,
        `${error.message} Die Kundenkarte wurde trotzdem in Supabase gespeichert.`,
        'info'
      );
    }

    setClaimButtonsDisabled(false);
    return;
  }

  try {
    await downloadApplePass(result);
    showMessage(claimMessage, 'Wallet-Datei wurde erstellt.', 'success');
  } catch (error) {
    showMessage(claimMessage, `${error.message} Die Kundenkarte wurde trotzdem in Supabase gespeichert.`, 'info');
  } finally {
    setClaimButtonsDisabled(false);
  }
}


async function claimPreferredWallet() {
  detectedDeviceWallet = detectWalletDevice().wallet;
  walletPrimaryButton?.setAttribute('data-wallet-provider', detectedDeviceWallet);

  if (detectedDeviceWallet === 'apple') {
    return claimCard('apple');
  }

  if (detectedDeviceWallet === 'google') {
    return claimCard('google');
  }

  showMessage(claimMessage, 'Bitte wähle Apple oder Google Wallet.', 'info');
  return null;
}

function centsToAmount(cents, fallback = '') {
  const numericCents = Number(cents);

  if (!Number.isFinite(numericCents) || numericCents <= 0) {
    return fallback;
  }

  return (numericCents / 100).toFixed(2);
}

function amountToCents(value) {
  const amount = Number(String(value || '').replace(',', '.'));

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Math.round(amount * 100);
}

function amountInputValue(value, fallback = '') {
  const amount = Number(String(value || '').replace(',', '.'));

  if (!Number.isFinite(amount) || amount <= 0) {
    return fallback;
  }

  return amount.toFixed(2);
}

function topupPanelHtml(result) {
  if (!featureEnabled(template, 'balance')) {
    return '';
  }

  const currency = result.card?.currency || template.settings?.currency || 'CHF';
  const currentBalance = Number(result.card?.balance_cents ?? result.card?.metadata?.balance_cents ?? 0);
  const minAmount = amountInputValue(centsToAmount(template.settings?.minTopupCents, template.settings?.minBalanceAmount), '1.00');
  const maxAmount = amountInputValue(centsToAmount(template.settings?.maxTopupCents, template.settings?.maxBalanceAmount), '');
  const defaultAmount = amountInputValue(minAmount, '10.00');

  return `
    <form id="topupForm" class="topup-form">
      <h3>Guthaben aufladen</h3>
      <p class="muted">Aktuelles Guthaben: ${escapeHtml((currentBalance / 100).toFixed(2))} ${escapeHtml(currency)}</p>
      <label>Betrag
        <input name="amount" type="number" min="${escapeHtml(minAmount)}" ${maxAmount ? `max="${escapeHtml(maxAmount)}"` : ''} step="0.01" value="${escapeHtml(defaultAmount)}">
      </label>
      <button class="secondary wide" type="submit">Aufladung starten</button>
    </form>
  `;
}

async function createTopupPaymentSession(result, amountCents) {
  const supabaseUrl = publicConfig?.supabase?.url?.replace(/\/$/, '');
  const anonKey = publicConfig?.supabase?.anonKey;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Edge Function ist nicht konfiguriert.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/create-topup-payment-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    },
    body: JSON.stringify({
      cardId: result.card?.id,
      walletObjectId: result.card?.metadata?.google_wallet_claim_key
        || result.card?.wallet_object_id
        || result.card?.wallet_serial_number,
      amountCents
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error_message || payload.error || 'Aufladung konnte nicht gestartet werden.');
  }

  return payload;
}

async function handleTopupSubmit(event) {
  event.preventDefault();

  if (!currentClaimResult?.card?.id) {
    showMessage(claimMessage, 'Bitte zuerst die Karte erstellen.', 'error');
    return;
  }

  const formData = new FormData(event.currentTarget);
  const amountCents = amountToCents(formData.get('amount'));

  if (!amountCents) {
    showMessage(claimMessage, 'Bitte einen gültigen Aufladebetrag eingeben.', 'error');
    return;
  }

  showMessage(claimMessage, 'Aufladung wird vorbereitet ...');

  try {
    const topupResult = await createTopupPaymentSession(currentClaimResult, amountCents);
    const session = topupResult.topup_payment_session;

    if (session?.checkout_url) {
      window.location.href = session.checkout_url;
      return;
    }

    showMessage(
      claimMessage,
      topupResult.error_message || 'Payment Provider ist noch nicht verbunden. Die Topup-Session wurde gespeichert.',
      'info'
    );
  } catch (error) {
    showMessage(claimMessage, `${error.message} Die Kundenkarte bleibt gespeichert.`, 'info');
  }
}

async function createGoogleWalletSaveLink(result) {
  const supabaseUrl = publicConfig?.supabase?.url?.replace(/\/$/, '');
  const anonKey = publicConfig?.supabase?.anonKey;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Edge Function ist nicht konfiguriert.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/google-wallet-save-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    },
    body: JSON.stringify({
      templateId: template.id,
      cardId: result.card?.id,
      walletObjectId: result.card?.wallet_object_id
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error_message || payload.error || 'Google-Wallet-Link konnte nicht erstellt werden.');
  }

  return payload;
}


async function claimCardViaEdge(walletPlatform, walletObjectId) {
  const supabaseUrl = publicConfig?.supabase?.url?.replace(/\/$/, '');
  const anonKey = publicConfig?.supabase?.anonKey;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Edge Function ist nicht konfiguriert.');
  }

  let response;

  try {
    response = await fetch(`${supabaseUrl}/functions/v1/claim-card`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      body: JSON.stringify({
        templateId: template.id,
        claimToken: currentClaimToken || undefined,
        walletPlatform,
        walletObjectId,
        claimSource: currentClaimSource
      })
    });
  } catch (error) {
    error.fallbackToLocal = true;
    throw error;
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 501 || (response.status === 404 && !result.error_code)) {
      const error = new Error(result.error || 'Claim Edge Function ist noch nicht bereit.');
      error.fallbackToLocal = true;
      throw error;
    }

    throw new Error(result.error_message || result.error || 'Kundenkarte konnte nicht erstellt werden.');
  }

  return {
    ...result,
    applePassViaEdge: walletPlatform === 'apple'
  };
}

async function claimCardViaLocalApi(walletPlatform, walletObjectId) {
  const response = await fetch(apiUrl('/api/cards/claim'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      templateId: template.id,
      claimToken: currentClaimToken || undefined,
      walletPlatform,
      walletObjectId,
      claimSource: currentClaimSource
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Kundenkarte konnte nicht erstellt werden.');
  }

  return result;
}

walletPrimaryButton?.addEventListener('click', () => {
  claimPreferredWallet().catch((error) => {
    setClaimButtonsDisabled(false);
    showMessage(claimMessage, error.message, 'error');
  });
});

claimButton?.addEventListener('click', () => {
  claimCard('apple').catch((error) => {
    setClaimButtonsDisabled(false);
    showMessage(claimMessage, error.message, 'error');
  });
});

googleWalletButton?.addEventListener('click', () => {
  claimCard('google').catch((error) => {
    setClaimButtonsDisabled(false);
    showMessage(claimMessage, error.message, 'error');
  });
});
resultPanel?.addEventListener('submit', (event) => {
  if (event.target?.id !== 'topupForm') {
    return;
  }

  handleTopupSubmit(event).catch((error) => {
    showMessage(claimMessage, error.message, 'error');
  });
});

resultPanel?.addEventListener('click', (event) => {
  if (event.target?.id !== 'downloadApplePassButton') {
    return;
  }

  if (!currentClaimResult) {
    showMessage(claimMessage, 'Bitte zuerst die Karte erstellen.', 'error');
    return;
  }

  downloadApplePass(currentClaimResult)
    .then(() => showMessage(claimMessage, 'Wallet-Datei wurde erstellt.', 'success'))
    .catch((error) => showMessage(claimMessage, `${error.message} Die Kundenkarte bleibt gespeichert.`, 'info'));
});

loadTemplate().catch((error) => {
  showMessage(claimMessage, error.message, 'error');
});
