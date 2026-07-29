import { createSupabaseRestClient } from './supabaseClient.js';
import { redirectAfterLogin } from './guards.js';
import { validateOperatorEmail } from './emailValidation.js';
import { setupLanguageSelectors, t } from './i18n.js';
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
    throw new Error(t('auth.passwordMin'));
  }

  if (password !== repeat) {
    throw new Error(t('auth.passwordMismatch'));
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
  showMessage(authMessage, t('auth.recoveryDetected'), 'info');
}

async function initAuthPage() {
  setupLanguageSelectors(document);

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
    showMessage(authMessage, t('auth.loginChecking'));

    const formData = new FormData(loginForm);

    try {
      const emailCheck = validateOperatorEmail(formData.get('email'));

      if (!emailCheck.ok) {
        throw new Error(emailCheck.message);
      }

      const session = await client.signIn({
        email: emailCheck.email,
        password: formData.get('password'),
        remember: Boolean(formData.get('remember_me'))
      });

      await redirectAfterLogin(client, session);
    } catch (error) {
      const message = /email not confirmed/i.test(error.message)
        ? t('auth.emailNotConfirmed')
        : error.message;

      showMessage(authMessage, message, 'error');
    }
  });

  byId('showForgotPasswordButton')?.addEventListener('click', () => {
    setPasswordResetPanelVisible(true);
    showMessage(authMessage, t('auth.forgotIntro'), 'info');
    forgotPasswordForm?.querySelector('input[name="email"]')?.focus();
  });

  byId('cancelForgotPasswordButton')?.addEventListener('click', () => {
    setPasswordResetPanelVisible(false);
    showMessage(authMessage, '');
  });

  forgotPasswordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(authMessage, t('auth.resetRequesting'));

    const formData = new FormData(forgotPasswordForm);

    try {
      const emailCheck = validateOperatorEmail(formData.get('email'));

      if (!emailCheck.ok) {
        throw new Error(emailCheck.message);
      }

      await client.resetPasswordForEmail(emailCheck.email, pageUrl('index.html?recovery=1'));
      forgotPasswordForm.reset();
      showMessage(authMessage, t('auth.resetSent'), 'success');
    } catch (error) {
      showMessage(authMessage, error.message, 'error');
    }
  });

  resetPasswordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(authMessage, t('auth.passwordSaving'));

    const formData = new FormData(resetPasswordForm);

    try {
      const password = String(formData.get('password') || '');
      const repeat = String(formData.get('password_repeat') || '');
      validatePasswordPair(password, repeat);

      await client.updatePassword(password);
      resetPasswordForm.reset();
      showMessage(authMessage, t('auth.passwordSavedRedirect'), 'success');
      window.setTimeout(() => {
        redirectAfterLogin(client, client.getStoredSession()).catch((error) => showMessage(authMessage, error.message, 'error'));
      }, 700);
    } catch (error) {
      showMessage(authMessage, error.message, 'error');
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(authMessage, t('auth.accountCreating'));

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

      showMessage(authMessage, t('auth.accountCreated'), 'success');
      registerForm.reset();
    } catch (error) {
      showMessage(authMessage, error.message, 'error');
    }
  });
}

initAuthPage().catch((error) => {
  showMessage(authMessage, error.message, 'error');
});
