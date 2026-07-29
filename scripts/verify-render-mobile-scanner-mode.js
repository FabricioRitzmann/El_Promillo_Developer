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

function assertIncludes(relativePath, needles) {
  const source = read(relativePath);

  for (const needle of needles) {
    assert(source.includes(needle), `${relativePath} muss enthalten: ${needle}`);
  }
}

function assertNotIncludes(relativePath, needles) {
  const source = read(relativePath);

  for (const needle of needles) {
    assert(!source.includes(needle), `${relativePath} darf nicht enthalten: ${needle}`);
  }
}

assertIncludes('public/js/appMode.js', [
  'CUSTOMER_RENDER_HOSTS',
  "'el-promillo.ch'",
  "'www.el-promillo.ch'",
  "'el-promillo-j1n0.onrender.com'",
  "host.endsWith('.onrender.com')",
  'isGitHubDeveloperFrontend',
  "host.endsWith('github.io')",
  "pathname.includes('/El_Promillo/')",
  'isHandheldPhone',
  'isTabletLikeDevice',
  'isRenderPhoneScannerMode',
  'scanner-only-mode'
]);

assertIncludes('public/js/guards.js', [
  "import { isRenderPhoneScannerMode } from './appMode.js';",
  'SCANNER_ONLY_ALLOWED_PAGES',
  "'scanner.html'",
  "'account.html'",
  "pagePath(isMobileScannerOnly() ? 'scanner.html' : 'dashboard.html')",
  'shouldRedirectToScannerOnlyPage',
  'window.location.replace(pagePath(\'scanner.html\'))'
]);

assertIncludes('public/account.html', [
  'mobile-account-summary',
  'mobileAccountCompanyName',
  'mobileLogoutButton'
]);

assertIncludes('public/js/account.js', [
  'mobileAccountCompanyName',
  'renderMobileAccountSummary',
  'mobileLogoutButton'
]);

assertIncludes('public/scanner.html', [
  'scannerOnlyLogoutButton',
  'scanner-only-logout',
  'desktop-only-link'
]);

assertIncludes('public/js/scanner.js', [
  "import { pagePath } from './path.js';",
  'scannerOnlyLogoutButton',
  'state.client.signOut()',
  "window.location.replace(pagePath('index.html'))"
]);

assertIncludes('public/styles.css', [
  '.scanner-only-logout',
  '.desktop-only-link',
  'display: inline-flex;',
  '.scanner-only-mode .scanner-only-logout',
  '.scanner-only-mode .app-tabbar a[href^="dashboard.html"]',
  '.scanner-only-mode .app-tab-account',
  '.scanner-only-mode .mobile-account-summary',
  '.scanner-only-mode .account-grid',
  '.scanner-only-mode .account-form',
  '.desktop-only-link'
]);

assertNotIncludes('public/styles.css', [
  '@media (max-width: 767px) {\n  .desktop-only-link {\n    display: none;\n  }\n}'
]);

assertIncludes('package.json', [
  'node --check public/js/appMode.js',
  'node --check scripts/verify-render-mobile-scanner-mode.js',
  'node scripts/verify-render-mobile-scanner-mode.js'
]);

console.log('Render Mobile Scanner Mode Contract: OK');
