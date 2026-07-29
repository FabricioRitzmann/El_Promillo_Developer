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

assertIncludes('Auth-Formulare', indexHtml, [
  'id="loginForm"',
  'id="registerForm"',
  '<button class="primary" type="submit">Einloggen</button>',
  '<button class="secondary" type="submit">Account erstellen</button>'
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
  'validateOperatorEmail',
  'client.registerOperator'
]);

console.log('Auth Enter-Submit ist fuer Login und Registrierung statisch abgesichert.');
