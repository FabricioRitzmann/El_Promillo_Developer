const storage = new Map();
globalThis.document = {
  documentElement: {
    dataset: {},
    style: { colorScheme: '' }
  }
};
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value))
};

const {
  APP_THEMES,
  DEFAULT_APP_THEME,
  applyAppTheme,
  applyBusinessAppTheme,
  applyCachedAppTheme,
  normalizeAppTheme
} = await import('../public/js/theme.js');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(APP_THEMES.length === 7, 'Genau sieben freigegebene Themes werden erwartet.');
assert(normalizeAppTheme('unbekannt') === DEFAULT_APP_THEME, 'Unbekannte Themes müssen sicher auf Standard fallen.');

applyBusinessAppTheme({ app_theme: 'blue-white', owner_id: 'tenant-a' });
applyBusinessAppTheme({ app_theme: 'green-white', owner_id: 'tenant-b' });

assert(applyCachedAppTheme('tenant-a') === 'blue-white', 'Reload für Tenant A verliert sein Theme.');
assert(document.documentElement.dataset.appTheme === 'blue-white', 'Tenant A wird nicht auf das HTML-Dokument angewendet.');
assert(applyCachedAppTheme('tenant-b') === 'green-white', 'Tenant B erhält nicht sein eigenes Theme.');
assert(applyCachedAppTheme('tenant-c') === DEFAULT_APP_THEME, 'Neuer Tenant darf kein fremdes Browser-Theme erben.');

applyAppTheme('anthracite-gold');
assert(document.documentElement.style.colorScheme === 'dark', 'Anthrazit/Gold muss Dark-Controls aktivieren.');
applyAppTheme('black-white');
assert(document.documentElement.style.colorScheme === 'light', 'Helle Themes müssen Light-Controls aktivieren.');

console.log('Theme-Cache: Reload, Logout/Login-Simulation und Tenant A/B Isolation OK.');
