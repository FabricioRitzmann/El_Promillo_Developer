import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const themeIds = [
  'promillo-standard', 'blue-white', 'green-white', 'violet-white',
  'navy-lightgray', 'black-white', 'anthracite-gold'
];
const requiredTokens = [
  '--primary', '--primary-foreground', '--secondary', '--background', '--surface',
  '--surface-secondary', '--text', '--text-muted', '--border', '--accent',
  '--success', '--warning', '--danger'
];
const internalScripts = [
  'public/js/account.js', 'public/js/dashboard.js', 'public/js/editor.js',
  'public/js/scanner.js', 'public/js/pushCenter.js'
];

const schema = read('supabase/schema.sql');
const styles = read('public/styles.css');
const themeModule = read('public/js/theme.js');
const accountHtml = read('public/account.html');
const accountJs = read('public/js/account.js');

for (const themeId of themeIds) {
  assert(schema.includes(`'${themeId}'`), `Schema unterstützt Theme ${themeId} nicht.`);
  assert(themeModule.includes(`id: '${themeId}'`), `Zentrales Theme-Modul enthält ${themeId} nicht.`);
  if (themeId !== 'promillo-standard') {
    assert(styles.includes(`[data-app-theme="${themeId}"]`), `CSS-Tokens für ${themeId} fehlen.`);
  }
}

for (const token of requiredTokens) {
  assert(styles.includes(`${token}:`), `Design-Token ${token} fehlt.`);
}

for (const relativePath of internalScripts) {
  const source = read(relativePath);
  assert(source.includes("from './theme.js'"), `${relativePath} lädt das zentrale Theme-System nicht.`);
  assert(source.includes('app_theme'), `${relativePath} lädt die Tenant-Einstellung app_theme nicht.`);
  assert(source.includes('applyBusinessAppTheme'), `${relativePath} wendet das persistierte Tenant-Theme nicht an.`);
}

assert(accountHtml.includes('Farbschema auswählen'), 'Firmenkonto enthält keine Theme-Auswahl.');
assert(accountHtml.includes('Theme speichern'), 'Theme hat keine explizite Speicheraktion.');
assert(accountHtml.includes('Wallet-Karten bleiben unverändert'), 'Trennung von App-Theme und Wallet-Design ist nicht erklärt.');
assert(accountJs.includes("updateRows('businesses', { app_theme: appTheme }"), 'Theme wird nicht auf Business-Ebene gespeichert.');
assert(!accountJs.match(/app_theme[\s\S]{0,160}(primary_color|text_color)/), 'App-Theme darf keine Wallet-Kartenfarben verändern.');
assert(themeModule.includes("cachePrefix = 'el_promillo_app_theme:'"), 'Theme-Cache ist nicht pro Betreiber getrennt.');
assert(styles.includes('grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))'), 'Theme-Vorschauen sind nicht responsiv.');
assert(styles.includes('color: var(--primary-foreground)'), 'Primärbutton verwendet keine kontrastfähige Vordergrundfarbe.');
assert(styles.includes('.danger-soft'), 'Semantische Gefahrenfarbe muss unabhängig vom Theme erhalten bleiben.');

console.log('Sieben tenantpersistente App-Themes, zentrale Tokens, responsive Vorschauen und Wallet-Trennung sind statisch abgesichert.');
