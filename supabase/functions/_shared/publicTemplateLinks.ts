import { normalizeTemplateType, templateSettings } from './templateFeatures.ts';

type Row = Record<string, any>;

const PUBLIC_CLAIM_TOKEN_PATTERN = /^[a-f0-9]{36}$/;

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function configured(value: unknown) {
  const text = stringValue(value);

  return Boolean(text && !text.startsWith('YOUR_') && !text.includes('CHANGE_THIS'));
}

function publicBaseUrl() {
  const candidate = stringValue(Deno.env.get('APP_PUBLIC_BASE_URL') || Deno.env.get('APP_BASE_URL'));

  if (!configured(candidate)) {
    return '';
  }

  try {
    const url = new URL(candidate);

    if (url.protocol !== 'https:' || url.username || url.password) {
      return '';
    }

    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_error) {
    return '';
  }
}

export function publicShareLinkEnabled(template: Row = {}) {
  if (template.is_active === false) {
    return false;
  }

  const settings = templateSettings(template);
  const configuredValue = settings.publicShareLinkEnabled ?? settings.public_share_link_enabled;

  if (typeof configuredValue === 'boolean') {
    return configuredValue;
  }

  return normalizeTemplateType(template) === 'club_card';
}

export function publicTemplateShareLabel(template: Row = {}) {
  return normalizeTemplateType(template) === 'club_card' ? 'Clubkarte teilen' : 'Karte weiterempfehlen';
}

export function publicTemplateCreationUrl(template: Row = {}, source = 'wallet_share') {
  if (!publicShareLinkEnabled(template)) {
    return '';
  }

  const baseUrl = publicBaseUrl();
  const token = stringValue(template.public_claim_token);

  if (!baseUrl || !PUBLIC_CLAIM_TOKEN_PATTERN.test(token)) {
    return '';
  }

  const url = new URL('/claim.html', `${baseUrl}/`);
  url.searchParams.set('token', token);

  if (source === 'wallet_share') {
    url.searchParams.set('source', 'wallet_share');
  }

  return url.toString();
}
