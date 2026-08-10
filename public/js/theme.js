export const DEFAULT_APP_THEME = 'promillo-standard';

export const APP_THEMES = Object.freeze([
  { id: 'promillo-standard', label: 'Promillo Standard', colors: ['#8b4f2f', '#fffdf9', '#d6b889'] },
  { id: 'blue-white', label: 'Blau / Weiß', colors: ['#1456a0', '#ffffff', '#d9e9fb'] },
  { id: 'green-white', label: 'Grün / Weiß', colors: ['#247047', '#ffffff', '#dcefe4'] },
  { id: 'violet-white', label: 'Violett / Weiß', colors: ['#6f42a5', '#ffffff', '#eadff5'] },
  { id: 'navy-lightgray', label: 'Dunkelblau / Hellgrau', colors: ['#17365f', '#eef2f6', '#d7e0e9'] },
  { id: 'black-white', label: 'Schwarz / Weiß', colors: ['#161616', '#ffffff', '#e7e7e7'] },
  { id: 'anthracite-gold', label: 'Anthrazit / Gold', colors: ['#d2ad5b', '#25282b', '#3b3f43'] }
]);

const themeIds = new Set(APP_THEMES.map((theme) => theme.id));
const cachePrefix = 'el_promillo_app_theme:';

export function normalizeAppTheme(theme) {
  const value = String(theme || '').trim();
  return themeIds.has(value) ? value : DEFAULT_APP_THEME;
}

export function applyAppTheme(theme) {
  const normalized = normalizeAppTheme(theme);
  document.documentElement.dataset.appTheme = normalized;
  document.documentElement.style.colorScheme = normalized === 'anthracite-gold' ? 'dark' : 'light';
  return normalized;
}

export function applyCachedAppTheme(ownerId) {
  const id = String(ownerId || '').trim();
  if (!id) return applyAppTheme(DEFAULT_APP_THEME);

  try {
    return applyAppTheme(localStorage.getItem(`${cachePrefix}${id}`) || DEFAULT_APP_THEME);
  } catch {
    return applyAppTheme(DEFAULT_APP_THEME);
  }
}

export function applyBusinessAppTheme(business, ownerId = business?.owner_id) {
  const normalized = applyAppTheme(business?.app_theme);
  const id = String(ownerId || '').trim();

  if (id) {
    try {
      localStorage.setItem(`${cachePrefix}${id}`, normalized);
    } catch {
      // Persistenz liegt in Supabase; ein nicht verfügbarer Browser-Cache ist unkritisch.
    }
  }

  return normalized;
}
