import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(rootDir, 'public/styles.css'), 'utf8');
const editorHtml = fs.readFileSync(path.join(rootDir, 'public/editor.html'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(content, needle, message) {
  assert(content.includes(needle), `${message}: ${needle}`);
}

function mediaBlock(marker) {
  const start = css.indexOf(marker);

  assert(start >= 0, `Media Query fehlt: ${marker}`);

  const next = css.indexOf('@media', start + marker.length);

  return next >= 0 ? css.slice(start, next) : css.slice(start);
}

assertIncludes(
  editorHtml,
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  'Editor braucht einen mobilen Viewport'
);

[
  '.wallet-notification-grid',
  'grid-template-columns: minmax(0, 1fr) minmax(260px, 0.7fr);',
  'min-width: 0;',
  '#walletNotificationLimitWarnings span',
  'overflow-wrap: anywhere;',
  '.history-meta span',
  '.history-error',
  '.notification-preview-card strong',
  '.notification-preview-card span'
].forEach((needle) => assertIncludes(css, needle, 'Responsive Wallet-Notification-CSS fehlt'));

[
  '--language-switcher-width:',
  '--nav-tab-min-width:',
  'grid-template-columns: 4.7rem minmax(0, 1fr);',
  'width: min(100%, var(--language-switcher-width));',
  'min-width: min(var(--nav-tab-min-width), 34vw);',
  'grid-template-columns: minmax(0, 1fr) auto;',
  'min-height: 6.2rem;',
  'min-width: var(--page-action-min-width);',
  'min-width: 2.4rem;'
].forEach((needle) => assertIncludes(css, needle, 'Sprachwechsel darf Header, Tabs und Titel nicht verschieben'));

const tabletBlock = mediaBlock('@media (max-width: 860px)');

[
  '.wallet-notification-grid',
  '.detail-grid',
  '.split-row',
  '.page-heading',
  'grid-template-columns: 1fr;'
].forEach((needle) => assertIncludes(tabletBlock, needle, 'Tablet/Mobile Layout muss Wallet-Benachrichtigungen einspaltig machen'));

const phoneBlock = mediaBlock('@media (max-width: 560px)');

[
  '.history-audit-row',
  '.wallet-notification-panel',
  '.notification-preview-card',
  'grid-template-columns: 1fr;',
  'padding: 1rem;',
  'padding: 0.85rem;'
].forEach((needle) => assertIncludes(phoneBlock, needle, 'Phone Layout muss lange Wallet-Historien und Vorschauen kompakt halten'));

console.log('Responsive Editor-/Wallet-Layout ist statisch abgesichert.');
