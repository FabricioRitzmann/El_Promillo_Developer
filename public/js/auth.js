import { createSupabaseRestClient } from './supabaseClient.js';
import { redirectAfterLogin } from './guards.js';
import { validateOperatorEmail } from './emailValidation.js';
import { pageUrl } from './path.js';
import { byId, showMessage } from './ui.js';

const loginForm = byId('loginForm');
const registerForm = byId('registerForm');
const forgotPasswordForm = byId('forgotPasswordForm');
const resetPasswordForm = byId('resetPasswordForm');
const authMessage = byId('authMessage');

function isRecoveryMode() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));

  return searchParams.get('recovery') === '1' || hashParams.get('type') === 'recovery';
}

function submitFormOnEnter(form) {
  form?.addEventListener('keydown', (event) => {
    if (
      event.key !== 'Enter'
      || event.defaultPrevented
      || event.isComposing
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
    ) {
      return;
    }

    const target = event.target;

    if (!target || String(target.tagName || '').toUpperCase() !== 'INPUT') {
      return;
    }

    event.preventDefault();

    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }

    form.querySelector('button[type="submit"]')?.click();
  });
}

function setPasswordResetPanelVisible(visible) {
  if (forgotPasswordForm) {
    forgotPasswordForm.hidden = !visible;
  }

  if (registerForm) {
    registerForm.hidden = visible || !resetPasswordForm?.hidden;
  }
}

function validatePasswordPair(password, repeat) {
  if (String(password || '').length < 6) {
    throw new Error('Bitte mindestens 6 Zeichen für das neue Passwort verwenden.');
  }

  if (password !== repeat) {
    throw new Error('Die neuen Passwörter stimmen nicht überein.');
  }
}

function showRecoveryMode() {
  if (!resetPasswordForm) {
    return;
  }

  resetPasswordForm.hidden = false;
  forgotPasswordForm.hidden = true;
  loginForm.hidden = true;
  registerForm.hidden = true;
  showMessage(authMessage, 'Recovery-Link erkannt. Du kannst jetzt ein neues Passwort setzen.', 'info');
}

async function initAuthPage() {
  const client = await createSupabaseRestClient();
  const existingSession = await client.ensureSession();
  const recoveryMode = isRecoveryMode();

  if (existingSession && recoveryMode) {
    showRecoveryMode();
  } else if (existingSession) {
    await redirectAfterLogin(client, existingSession);
    return;
  }

  submitFormOnEnter(loginForm);
  submitFormOnEnter(registerForm);
  submitFormOnEnter(forgotPasswordForm);
  submitFormOnEnter(resetPasswordForm);

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(authMessage, 'Login wird geprüft ...');

    const formData = new FormData(loginForm);

    try {
      const emailCheck = validateOperatorEmail(formData.get('email'));

      if (!emailCheck.ok) {
        throw new Error(emailCheck.message);
      }

      const session = await client.signIn({
        email: emailCheck.email,
        password: formData.get('password')
      });

      await redirectAfterLogin(client, session);
    } catch (error) {
      const message = /email not confirmed/i.test(error.message)
        ? 'Dein Account ist noch nicht vollständig freigeschaltet. Bitte versuche es später erneut oder kontaktiere den Support.'
        : error.message;

      showMessage(authMessage, message, 'error');
    }
  });

  byId('showForgotPasswordButton')?.addEventListener('click', () => {
    setPasswordResetPanelVisible(true);
    showMessage(authMessage, 'Trage deine E-Mail-Adresse ein, dann senden wir dir den Reset-Link.', 'info');
    forgotPasswordForm?.querySelector('input[name="email"]')?.focus();
  });

  byId('cancelForgotPasswordButton')?.addEventListener('click', () => {
    setPasswordResetPanelVisible(false);
    showMessage(authMessage, '');
  });

  forgotPasswordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(authMessage, 'Reset-Link wird angefordert ...');

    const formData = new FormData(forgotPasswordForm);

    try {
      const emailCheck = validateOperatorEmail(formData.get('email'));

      if (!emailCheck.ok) {
        throw new Error(emailCheck.message);
      }

      await client.resetPasswordForEmail(emailCheck.email, pageUrl('index.html?recovery=1'));
      forgotPasswordForm.reset();
      showMessage(authMessage, 'Wenn diese E-Mail registriert ist, wurde ein Reset-Link versendet.', 'success');
    } catch (error) {
      showMessage(authMessage, error.message, 'error');
    }
  });

  resetPasswordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(authMessage, 'Passwort wird gespeichert ...');

    const formData = new FormData(resetPasswordForm);

    try {
      const password = String(formData.get('password') || '');
      const repeat = String(formData.get('password_repeat') || '');
      validatePasswordPair(password, repeat);

      await client.updatePassword(password);
      resetPasswordForm.reset();
      showMessage(authMessage, 'Passwort gespeichert. Du wirst weitergeleitet ...', 'success');
      window.setTimeout(() => {
        redirectAfterLogin(client, client.getStoredSession()).catch((error) => showMessage(authMessage, error.message, 'error'));
      }, 700);
    } catch (error) {
      showMessage(authMessage, error.message, 'error');
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(authMessage, 'Account wird erstellt ...');

    const formData = new FormData(registerForm);

    try {
      const emailCheck = validateOperatorEmail(formData.get('email'));

      if (!emailCheck.ok) {
        throw new Error(emailCheck.message);
      }

      await client.registerOperator({
        email: emailCheck.email,
        password: formData.get('password'),
        displayName: formData.get('display_name')
      });

      showMessage(authMessage, 'Account erstellt. Sobald dein Account manuell freigeschaltet wurde, kannst du dich einloggen.', 'success');
      registerForm.reset();
    } catch (error) {
      showMessage(authMessage, error.message, 'error');
    }
  });
}

initAuthPage().catch((error) => {
  showMessage(authMessage, error.message, 'error');
});
