import { createSupabaseRestClient } from './supabaseClient.js';
import { redirectAfterLogin } from './guards.js';
import { validateOperatorEmail } from './emailValidation.js';
import { byId, showMessage } from './ui.js';

const loginForm = byId('loginForm');
const registerForm = byId('registerForm');
const authMessage = byId('authMessage');

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

async function initAuthPage() {
  const client = await createSupabaseRestClient();
  const existingSession = await client.ensureSession();

  if (existingSession) {
    await redirectAfterLogin(client, existingSession);
    return;
  }

  submitFormOnEnter(loginForm);
  submitFormOnEnter(registerForm);

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
