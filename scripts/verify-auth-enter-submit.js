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
const dashboardHtml = read('public/dashboard.html');
const scannerHtml = read('public/scanner.html');
const editorHtml = read('public/editor.html');
const authJs = read('public/js/auth.js');
const dashboardJs = read('public/js/dashboard.js');
const scannerJs = read('public/js/scanner.js');
const editorJs = read('public/js/editor.js');
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

assertIncludes('Dashboard Sprache', dashboardHtml, [
  'data-i18n="dashboard.heading"',
  'data-i18n="dashboard.statsTitle"',
  'data-i18n="nav.scanner"'
]);

assertIncludes('Scanner Sprache', scannerHtml, [
  'data-i18n="scanner.heading"',
  'data-i18n="scanner.loadCard"',
  'data-i18n="dashboard.privacyNote"'
]);

assertIncludes('Editor Sprache', editorHtml, [
  'data-i18n="editor.newTitle"',
  'data-i18n="editor.saveTemplate"',
  'data-i18n="editor.walletNotifications"'
]);

[
  ['Dashboard JS Sprache', dashboardJs],
  ['Scanner JS Sprache', scannerJs],
  ['Editor JS Sprache', editorJs]
].forEach(([label, source]) => assertIncludes(label, source, [
  "import { setupLanguageSelectors",
  'setupLanguageSelectors(document);'
]));

assertIncludes('Auth Session-Speicher', supabaseClientJs, [
  'const persistentSessionFlagKey',
  'window.sessionStorage.getItem(sessionStorageKey)',
  'isRememberedSession()',
  'window.localStorage.setItem(persistentSessionFlagKey, \'true\')',
  'window.sessionStorage.setItem(sessionStorageKey, serializedSession)',
  'window.localStorage.removeItem(persistentSessionFlagKey)'
]);

console.log('Auth Enter-Submit, Sprachwahl und Remember-me-Session sind statisch abgesichert.');
