const encoder = new TextEncoder();
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stringValue(value) {
  return String(value || '').trim();
}

function configured(value) {
  const text = stringValue(value);
  return Boolean(text && !text.startsWith('YOUR_') && !text.includes('CHANGE_THIS'));
}

function base64Url(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';

  for (const byte of array) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function walletMessageSecret() {
  return stringValue(
    Deno.env.get('WALLET_MESSAGE_LINK_SECRET')
      || Deno.env.get('WALLET_CRON_SECRET')
      || Deno.env.get('APPLE_PASS_AUTHENTICATION_TOKEN_SECRET')
  );
}

function appPublicBaseUrl() {
  const baseUrl = stringValue(
    Deno.env.get('APP_PUBLIC_BASE_URL')
      || Deno.env.get('APP_BASE_URL')
      || Deno.env.get('PUBLIC_APP_BASE_URL')
  ).replace(/\/+$/, '');

  if (!configured(baseUrl) || !/^https?:\/\//i.test(baseUrl)) {
    return '';
  }

  return baseUrl;
}

function tokenSubject(cardInstance) {
  return [
    stringValue(cardInstance.id),
    stringValue(cardInstance.customer_card_id || cardInstance.customer_cards?.id),
    stringValue(cardInstance.owner_id),
    stringValue(cardInstance.business_id),
    stringValue(cardInstance.template_id)
  ].join('|');
}

async function hmacSha256Base64Url(secret, subject) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(subject));

  return base64Url(signature);
}

function constantTimeEquals(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

export function walletMessageCardId(value) {
  const cardId = stringValue(value);
  return UUID_PATTERN.test(cardId) ? cardId : '';
}

export function walletMessageToken(value) {
  const token = stringValue(value);
  return TOKEN_PATTERN.test(token) ? token : '';
}

export function walletMessageLinkPayload(value) {
  const payload = stringValue(value);
  const [cardId, token] = payload.split('.');

  return {
    cardId: walletMessageCardId(cardId),
    token: walletMessageToken(token)
  };
}

export function walletMessageLinksConfigured() {
  return configured(walletMessageSecret()) && Boolean(appPublicBaseUrl());
}

export async function walletMessageTokenForCard(cardInstance) {
  const secret = walletMessageSecret();
  const subject = tokenSubject(cardInstance);

  if (!configured(secret) || !stringValue(cardInstance.id) || !subject.includes('|')) {
    return '';
  }

  return await hmacSha256Base64Url(secret, subject);
}

export async function walletMessageUrlForCard(cardInstance) {
  const baseUrl = appPublicBaseUrl();
  const cardId = walletMessageCardId(cardInstance.id);
  const token = await walletMessageTokenForCard(cardInstance);

  if (!baseUrl || !cardId || !token) {
    return '';
  }

  return baseUrl + '/message.html?m=' + encodeURIComponent(cardId + '.' + token);
}

export async function verifyWalletMessageToken(cardInstance, token) {
  const providedToken = walletMessageToken(token);
  const expectedToken = await walletMessageTokenForCard(cardInstance);

  return Boolean(providedToken && expectedToken && constantTimeEquals(providedToken, expectedToken));
}
