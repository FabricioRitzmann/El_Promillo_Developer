import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/scanner.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/js/scanner.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

for (const mode of ['entry', 'cloakroom', 'cashier', 'admin']) {
  assert(html.includes(`value="${mode}"`), `Scanner-Arbeitsmodus fehlt: ${mode}`);
}
for (const contract of ['scannerOperationStorageKey', 'operationGroupsForAction', 'data-priority-actions', 'data-secondary-actions', 'syncScannerOperationMode', 'restrictionStatusHtml()']) {
  assert(js.includes(contract), `Scanner-Modusvertrag fehlt: ${contract}`);
}
assert(js.includes('${restrictionStatusHtml()}\n    <section class="scanner-priority-panel">'), 'Restriktionsstatus muss vor den kompakten Aktionen sichtbar bleiben.');
assert(css.includes('.scanner-operation-options') && css.includes('.scanner-priority-panel') && css.includes('@media (max-width: 760px)'), 'Responsive Scanner-Modusdarstellung fehlt.');

console.log('Scanner-Arbeitsmodi, kontextbezogene Schnellaktionen und progressive Details sind statisch abgesichert.');
