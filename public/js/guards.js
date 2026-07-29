import { createSupabaseRestClient } from './supabaseClient.js';
import { isRenderPhoneScannerMode } from './appMode.js';
import { pagePath } from './path.js';

const SCANNER_ONLY_ALLOWED_PAGES = new Set(['', 'index.html', 'scanner.html', 'account.html', 'wait.html']);
const operatorProfileSelect = [
  'id',
  'email',
  'display_name',
  'unlock',
  'approved_at',
  'verification_email_requested_at',
  'verification_email_sent_at',
  'verification_email_last_error',
  'verification_email_attempts',
  'verification_email_status',
  'created_at',
  'updated_at'
].join(',');

export function isMobileScannerOnly() {
  return isRenderPhoneScannerMode();
}

export function operatorHomePath() {
  return pagePath(isMobileScannerOnly() ? 'scanner.html' : 'dashboard.html');
}

function currentPageName() {
  return String(window.location.pathname || '')
    .split('/')
    .pop()
    .toLowerCase();
}

function shouldRedirectToScannerOnlyPage(profile) {
  return Boolean(profile?.unlock)
    && isMobileScannerOnly()
    && !SCANNER_ONLY_ALLOWED_PAGES.has(currentPageName());
}

export function isSessionEmailVerified(session) {
  const user = session?.user || {};

  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

export async function getOwnProfile(client, session) {
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  return client.selectRows('operator_profiles', {
    select: operatorProfileSelect,
    filters: [
      { column: 'id', op: 'eq', value: userId }
    ],
    maybeSingle: true
  });
}

export async function requireLogin({ requireUnlock = false } = {}) {
  const client = await createSupabaseRestClient();
  const session = await client.ensureSession();

  if (!session) {
    window.location.replace(pagePath('index.html'));
    return null;
  }

  const profile = await getOwnProfile(client, session);

  if (requireUnlock && (!profile?.unlock || !isSessionEmailVerified(session))) {
    window.location.replace(pagePath('wait.html'));
    return null;
  }

  if (isSessionEmailVerified(session) && shouldRedirectToScannerOnlyPage(profile)) {
    window.location.replace(pagePath('scanner.html'));
    return null;
  }

  return { client, session, profile };
}

export async function redirectAfterLogin(client, session) {
  const profile = await getOwnProfile(client, session);

  if (profile?.unlock && isSessionEmailVerified(session)) {
    window.location.replace(operatorHomePath());
    return;
  }

  window.location.replace(pagePath('wait.html'));
}
