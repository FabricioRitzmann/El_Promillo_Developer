import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, looksConfigured, resolveProjectPath } from '../server/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const jsonOutput = args.has('--json');
const localSecretsDisplayPath = 'supabase/secrets.local.env';
const localSecretsPath = path.join(rootDir, localSecretsDisplayPath);

const requiredEdgeFunctions = [
  'claim-card',
  'get-wallet-message',
  'claim-apple-pass',
  'register-operator',
  'send-operator-verification-email',
  'create-topup-payment-session',
  'confirm-topup-payment',
  'redeem-balance',
  'apple-wallet-webservice',
  'issue-apple-pass',
  'update-apple-pass',
  'send-apple-wallet-update',
  'google-wallet-save-link',
  'issue-google-wallet-pass',
  'update-google-wallet-pass',
  'send-google-wallet-message',
  'generate-card-pdf',
  'create-wallet-notification-campaign',
  'send-wallet-notification',
  'resolve-wallet-notification-recipients',
  'check-wallet-notification-limits',
  'process-scheduled-wallet-notifications',
  'process-wallet-update-queue',
  'scanner-actions',
  'get-business-scan-statistics'
];

const requiredNoJwtFunctions = [
  'claim-card',
  'get-wallet-message',
  'claim-apple-pass',
  'google-wallet-save-link',
  'register-operator',
  'send-operator-verification-email',
  'create-topup-payment-session',
  'confirm-topup-payment',
  'apple-wallet-webservice',
  'process-scheduled-wallet-notifications',
  'process-wallet-update-queue'
];

const secretChecks = [
  ['SUPABASE_URL', ['supabase', 'url']],
  ['SUPABASE_ANON_KEY', ['supabase', 'anonKey']],
  ['SUPABASE_SERVICE_ROLE_KEY', ['supabase', 'serviceRoleKey']],
  ['APP_PUBLIC_BASE_URL', ['publicUrls', 'appPublicBaseUrl']],
  ['WALLET_CRON_SECRET', ['automation', 'walletCronSecret'], { minLength: 32 }],
  ['PAYMENT_WEBHOOK_SECRET', ['payment', 'webhookSecret'], { minLength: 32 }],
  ['APPLE_TEAM_ID', ['appleWalletDirect', 'teamId']],
  ['APPLE_PASS_TYPE_ID', ['appleWalletDirect', 'passTypeId']],
  ['APPLE_WWDR_CERT', ['appleWalletDirect', 'wwdrCert']],
  ['APPLE_PASS_CERT', ['appleWalletDirect', 'passCert']],
  ['APPLE_PASS_KEY', ['appleWalletDirect', 'passKey']],
  ['APPLE_PASS_KEY_PASSWORD', ['appleWalletDirect', 'passKeyPassword']],
  ['APPLE_WEB_SERVICE_BASE_URL', ['appleWalletDirect', 'webServiceBaseUrl'], { mustBeHttps: true, mustInclude: '/apple-wallet-webservice', mustNotEndWith: '/v1' }],
  ['APPLE_APNS_KEY_ID', ['appleWalletDirect', 'apnsKeyId']],
  ['APPLE_APNS_TEAM_ID', ['appleWalletDirect', 'apnsTeamId']],
  ['APPLE_APNS_AUTH_KEY', ['appleWalletDirect', 'apnsAuthKey']],
  ['GOOGLE_WALLET_ISSUER_ID', ['googleWallet', 'issuerId']],
  ['GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', ['googleWallet', 'serviceAccountJson'], { jsonFields: ['client_email', 'private_key'] }],
  ['GOOGLE_WALLET_CLASS_SUFFIX', ['googleWallet', 'classSuffix'], { optional: true }],
  ['GOOGLE_WALLET_ORIGINS', ['googleWallet', 'origins'], { optional: true }],
  ['PAYMENT_PROVIDER', ['payment', 'provider'], { optional: true }],
  ['PAYMENT_CHECKOUT_BASE_URL', ['payment', 'checkoutBaseUrl'], { optional: true }]
];

const limitChecks = [
  ['WALLET_BUSINESS_DAILY_LIMIT', ['deliveryRules', 'businessDailyLimit']],
  ['WALLET_CUSTOMER_DAILY_LIMIT', ['deliveryRules', 'customerDailyLimit']],
  ['WALLET_CARD_DAILY_LIMIT', ['deliveryRules', 'cardDailyLimit']],
  ['WALLET_GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H', ['deliveryRules', 'googleTextAndNotifyLimitPerPass24h']],
  ['WALLET_DUPLICATE_WINDOW_MINUTES', ['deliveryRules', 'duplicateWindowMinutes']],
  ['WALLET_PUBLIC_CLAIM_RATE_LIMIT', ['deliveryRules', 'publicClaimRateLimit']],
  ['WALLET_PUBLIC_CLAIM_RATE_LIMIT_WINDOW_SECONDS', ['deliveryRules', 'publicClaimRateLimitWindowSeconds']]
];

function getPath(object, segments) {
  return segments.reduce((current, segment) => (
    current && typeof current === 'object' ? current[segment] : undefined
  ), object);
}

function parseEnvValue(rawValue) {
  const value = String(rawValue || '').trim();

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1)
        .replaceAll('\\n', '\n')
        .replaceAll('\\"', '"')
        .replaceAll('\\\\', '\\');
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("'\"'\"'", "'");
  }

  return value;
}

function cleanedSecretJson(value) {
  return String(value || '')
    .trim()
    .replaceAll('\\r\\n', '\n')
    .replaceAll('\\n', '\n')
    .replaceAll('\\"', '"');
}

function parseSecretJson(value) {
  const text = String(value || '').trim();
  const first = text[0];
  const last = text[text.length - 1];
  const unwrapped = ((first === '"' && last === '"') || (first === "'" && last === "'"))
    ? text.slice(1, -1)
    : text;
  const candidates = [text, cleanedSecretJson(text), unwrapped, cleanedSecretJson(unwrapped)];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate);

      if (typeof parsed === 'string' && parsed !== candidate) {
        return parseSecretJson(parsed);
      }

      return parsed;
    } catch {
      // Naechste Escape-Variante pruefen.
    }
  }

  throw new Error('Invalid JSON secret.');
}

function loadLocalSecretsEnv() {
  if (!fs.existsSync(localSecretsPath)) {
    return false;
  }

  const lines = fs.readFileSync(localSecretsPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    const [, name, rawValue] = match;

    if (process.env[name] === undefined) {
      process.env[name] = parseEnvValue(rawValue);
    }
  }

  return true;
}

function configured(value) {
  const text = String(value || '').trim();

  return looksConfigured(text)
    && text !== '...'
    && !text.startsWith('SET_AS_')
    && !text.includes('NOT_FRONTEND');
}

function envOrConfig(config, envName, configPath) {
  const envValue = process.env[envName];
  const configValue = getPath(config, configPath);
  const chosen = configured(envValue) ? envValue : configValue;
  const source = configured(envValue) ? 'env' : 'config';

  return { value: chosen, source };
}

function deriveFunctionsBaseUrl(supabaseUrl) {
  if (!configured(supabaseUrl)) {
    return '';
  }

  try {
    return `${new URL(String(supabaseUrl)).origin}/functions/v1`;
  } catch {
    return '';
  }
}

function add(results, group, status, label, detail) {
  results.push({ group, status, label, detail });
}

function checkSecret(results, config, [envName, configPath, options = {}]) {
  const { value, source } = envOrConfig(config, envName, configPath);
  const label = `${envName} (${configPath.join('.')})`;

  if (!configured(value)) {
    const paymentProvider = envOrConfig(config, 'PAYMENT_PROVIDER', ['payment', 'provider']).value;

    if (envName === 'PAYMENT_CHECKOUT_BASE_URL' && String(paymentProvider || '').toLowerCase() === 'manual') {
      add(results, 'secrets', 'ok', label, 'bei PAYMENT_PROVIDER=manual nicht erforderlich');
      return;
    }

    add(results, 'secrets', options.optional ? 'warn' : 'fail', label, `nicht gesetzt oder Platzhalter (${source})`);
    return;
  }

  const text = String(value);

  if (options.minLength && text.length < options.minLength) {
    add(results, 'secrets', 'fail', label, `zu kurz, mindestens ${options.minLength} Zeichen`);
    return;
  }

  if (options.mustBeHttps && !text.startsWith('https://')) {
    add(results, 'secrets', 'fail', label, 'muss für produktive Wallets mit https:// beginnen');
    return;
  }

  if (options.mustInclude && !text.includes(options.mustInclude)) {
    add(results, 'secrets', 'fail', label, `muss ${options.mustInclude} enthalten`);
    return;
  }

  if (options.mustNotEndWith && text.endsWith(options.mustNotEndWith)) {
    add(results, 'secrets', 'fail', label, `darf nicht mit ${options.mustNotEndWith} enden`);
    return;
  }

  if (options.jsonFields) {
    try {
      const parsed = parseSecretJson(text);
      const missing = options.jsonFields.filter((field) => !configured(parsed[field]));

      if (missing.length > 0) {
        add(results, 'secrets', 'fail', label, `JSON fehlt: ${missing.join(', ')}`);
        return;
      }
    } catch {
      add(results, 'secrets', 'fail', label, 'ist kein gültiges JSON');
      return;
    }
  }

  add(results, 'secrets', 'ok', label, `gesetzt (${source}, Wert redigiert)`);
}

function checkLimit(results, config, [envName, configPath]) {
  const { value, source } = envOrConfig(config, envName, configPath);
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    add(results, 'limits', 'fail', envName, `muss positive Zahl sein (${source})`);
    return;
  }

  add(results, 'limits', 'ok', envName, `positive Zahl (${source})`);
}

function checkUrl(results, label, value, options = {}) {
  if (!configured(value)) {
    add(results, 'urls', 'fail', label, 'nicht gesetzt oder Platzhalter');
    return;
  }

  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    add(results, 'urls', 'fail', label, 'keine gültige URL');
    return;
  }

  if (options.mustBeHttps && parsed.protocol !== 'https:') {
    add(results, 'urls', 'fail', label, 'muss für Produktion https sein');
    return;
  }

  if (options.mustInclude && !String(value).includes(options.mustInclude)) {
    add(results, 'urls', 'fail', label, `muss ${options.mustInclude} enthalten`);
    return;
  }

  add(results, 'urls', 'ok', label, 'gültig');
}

function checkFiles(results) {
  const gitignore = fs.existsSync(path.join(rootDir, '.gitignore'))
    ? fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8')
    : '';

  add(
    results,
    'files',
    fs.existsSync(path.join(rootDir, 'config.json')) ? 'ok' : 'warn',
    'config.json',
    fs.existsSync(path.join(rootDir, 'config.json')) ? 'lokale Config vorhanden' : 'fehlt; für lokale Supabase-Tests aus config.example.json anlegen'
  );
  add(
    results,
    'files',
    gitignore.includes('config.json') ? 'ok' : 'fail',
    '.gitignore',
    'config.json muss ignoriert sein'
  );

  for (const functionName of requiredEdgeFunctions) {
    const functionPath = path.join(rootDir, 'supabase', 'functions', functionName, 'index.ts');
    add(
      results,
      'edge-functions',
      fs.existsSync(functionPath) ? 'ok' : 'fail',
      functionName,
      'Edge Function Datei'
    );
  }

  const configToml = fs.existsSync(path.join(rootDir, 'supabase', 'config.toml'))
    ? fs.readFileSync(path.join(rootDir, 'supabase', 'config.toml'), 'utf8')
    : '';

  for (const functionName of requiredNoJwtFunctions) {
    const pattern = new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt\\s*=\\s*false`);
    add(
      results,
      'edge-functions',
      pattern.test(configToml) ? 'ok' : 'fail',
      `${functionName} verify_jwt=false`,
      'Public/Webhook/Cron Function JWT-Gate'
    );
  }
}

function checkAssetFiles(results, config) {
  const certPaths = [
    ['certs/AppleWWDRCAG4.pem', 'Apple WWDR PEM lokal'],
    ['certs/pass-cert.pem', 'Apple Pass Certificate PEM lokal'],
    ['certs/pass-key.pem', 'Apple Pass Private Key PEM lokal']
  ];

  for (const [relativePath, label] of certPaths) {
    add(
      results,
      'local-assets',
      fs.existsSync(resolveProjectPath(relativePath)) ? 'ok' : 'warn',
      label,
      'nur für lokales Vorbereiten; produktiv als Supabase Secret setzen'
    );
  }

  const desiredTypes = getPath(config, ['googleWallet', 'desiredPassTypes']);
  const requiredTypes = ['generic', 'loyalty', 'offer', 'eventTicket'];
  const missing = requiredTypes.filter((type) => !Array.isArray(desiredTypes) || !desiredTypes.includes(type));

  add(
    results,
    'local-assets',
    missing.length === 0 ? 'ok' : 'fail',
    'googleWallet.desiredPassTypes',
    missing.length === 0 ? 'Generic/Loyalty/Offer/Event Ticket vorbereitet' : `fehlt: ${missing.join(', ')}`
  );
}

function buildReport() {
  const localSecretsLoaded = loadLocalSecretsEnv();
  const config = loadConfig();
  const results = [];

  checkFiles(results);
  checkAssetFiles(results, config);

  checkUrl(results, 'app.baseUrl', getPath(config, ['app', 'baseUrl']));
  const supabaseConfig = envOrConfig(config, 'SUPABASE_URL', ['supabase', 'url']);
  const supabaseFunctionBaseUrl = configured(getPath(config, ['publicUrls', 'supabaseFunctionBaseUrl']))
    ? getPath(config, ['publicUrls', 'supabaseFunctionBaseUrl'])
    : deriveFunctionsBaseUrl(supabaseConfig.value);

  checkUrl(results, 'publicUrls.supabaseFunctionBaseUrl', supabaseFunctionBaseUrl, {
    mustBeHttps: true,
    mustInclude: '/functions/v1'
  });
  checkUrl(results, 'publicUrls.walletInstallPage', getPath(config, ['publicUrls', 'walletInstallPage']));

  for (const check of secretChecks) {
    checkSecret(results, config, check);
  }

  for (const check of limitChecks) {
    checkLimit(results, config, check);
  }

  return {
    strict,
    hasLocalConfig: config.hasLocalConfig,
    localSecretsLoaded,
    summary: {
      ok: results.filter((result) => result.status === 'ok').length,
      warn: results.filter((result) => result.status === 'warn').length,
      fail: results.filter((result) => result.status === 'fail').length
    },
    results
  };
}

function printReport(report) {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Wallet Readiness Report');
  console.log(`OK: ${report.summary.ok}  WARN: ${report.summary.warn}  FAIL: ${report.summary.fail}`);
  console.log('Secrets werden nur als Status gezeigt; Werte werden nicht ausgegeben.');
  console.log(`Lokale Secret-Datei: ${report.localSecretsLoaded ? 'geladen' : 'nicht gefunden'}`);

  const groups = [...new Set(report.results.map((result) => result.group))];

  for (const group of groups) {
    console.log(`\n[${group}]`);

    for (const result of report.results.filter((item) => item.group === group)) {
      const marker = result.status === 'ok' ? 'OK' : result.status === 'warn' ? 'WARN' : 'FAIL';
      console.log(`${marker.padEnd(4)} ${result.label} - ${result.detail}`);
    }
  }
}

const report = buildReport();
printReport(report);

if (strict && report.summary.fail > 0) {
  process.exitCode = 1;
}
