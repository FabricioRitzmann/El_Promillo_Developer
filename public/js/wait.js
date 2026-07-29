import { operatorHomePath, requireLogin } from './guards.js';
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

  if (profile?.unlock) {
    window.location.replace(operatorHomePath());
    return;
  }

  showMessage(waitMessage, 'Dein Account wurde erstellt und wartet auf Freischaltung.', 'info');

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
