import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(label, source, needles) {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} fehlt: ${needle}`);
  }
}

const indexHtml = read('public/index.html');
const authJs = read('public/js/auth.js');
const supabaseClientJs = read('public/js/supabaseClient.js');
const i18nJs = read('public/js/i18n.js');

assertIncludes('Auth-Formulare', indexHtml, [
  'id="loginForm"',
  'id="registerForm"',
  'name="remember_me"',
  'data-language-select',
  'data-i18n="auth.loginButton"',
  'data-i18n="auth.registerButton"'
]);

assertIncludes('Auth Enter-Submit', authJs, [
  'function submitFormOnEnter(form)',
  "event.key !== 'Enter'",
  'event.isComposing',
  "String(target.tagName || '').toUpperCase() !== 'INPUT'",
  'event.preventDefault();',
  "typeof form.requestSubmit === 'function'",
  'form.requestSubmit();',
  "form.querySelector('button[type=\"submit\"]')?.click();",
  'submitFormOnEnter(loginForm);',
  'submitFormOnEnter(registerForm);'
]);

assertIncludes('Auth Submit-Handler', authJs, [
  "loginForm?.addEventListener('submit'",
  "registerForm?.addEventListener('submit'",
  'event.preventDefault();',
  'client.signIn',
  'remember: Boolean(formData.get(\'remember_me\'))',
  'validateOperatorEmail',
  'client.registerOperator'
]);

assertIncludes('Auth Sprache', i18nJs, [
  "const defaultLanguage = 'de';",
  "{ code: 'de', short: 'DE', label: 'Deutsch' }",
  "{ code: 'en', short: 'EN', label: 'English' }",
  "{ code: 'fr', short: 'FR', label: 'Français' }",
  "{ code: 'it', short: 'IT', label: 'Italiano' }",
  'export function setupLanguageSelectors'
]);

assertIncludes('Auth Session-Speicher', supabaseClientJs, [
  'const persistentSessionFlagKey',
  'window.sessionStorage.getItem(sessionStorageKey)',
  'isRememberedSession()',
  'window.localStorage.setItem(persistentSessionFlagKey, \'true\')',
  'window.sessionStorage.setItem(sessionStorageKey, serializedSession)',
  'window.localStorage.removeItem(persistentSessionFlagKey)'
]);

console.log('Auth Enter-Submit, Sprachwahl und Remember-me-Session sind statisch abgesichert.');
