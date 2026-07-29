import { isSessionEmailVerified, operatorHomePath, requireLogin } from './guards.js';
import { pagePath } from './path.js';
import { byId, setText, showMessage } from './ui.js';

const waitMessage = byId('waitMessage');
const retryButton = byId('retryUnlock');
const logoutButton = byId('logoutButton');

async function refreshStatus() {
  showMessage(waitMessage, 'Status wird geprüft ...');

  const context = await requireLogin();

  if (!context) {
    return;
  }

  const { client, session, profile } = context;
  setText('operatorEmail', session.user?.email || profile?.email || '');

  if (profile?.unlock && isSessionEmailVerified(session)) {
    window.location.replace(operatorHomePath());
    return;
  }

  if (profile?.unlock) {
    const status = profile.verification_email_status || 'pending';
    const detail = status === 'failed'
      ? 'Die Verifizierungs-Mail konnte noch nicht gesendet werden. Bitte kontaktiere den Support oder versuche es später erneut.'
      : 'Dein Account ist freigeschaltet. Bitte öffne den Magic Link aus deiner E-Mail, um die Adresse zu bestätigen.';

    showMessage(waitMessage, detail, status === 'failed' ? 'error' : 'info');
  } else {
    showMessage(waitMessage, 'Dein Account wurde erstellt und wartet auf Freischaltung. Nach der Freigabe senden wir dir automatisch den Magic Link per E-Mail.', 'info');
  }

  logoutButton?.addEventListener('click', async () => {
    await client.signOut();
    window.location.replace(pagePath('index.html'));
  }, { once: true });
}

retryButton?.addEventListener('click', () => {
  refreshStatus().catch((error) => showMessage(waitMessage, error.message, 'error'));
});

refreshStatus().catch((error) => {
  showMessage(waitMessage, error.message, 'error');
});
