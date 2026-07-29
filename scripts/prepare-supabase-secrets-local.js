import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, looksConfigured, resolveProjectPath } from '../server/config.js';

const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const writeFile = argSet.has('--write');
const force = argSet.has('--force');
const jsonOutput = argSet.has('--json');
const localSecretsRelativePath = 'supabase/secrets.local.env';
const outputPath = path.join(process.cwd(), localSecretsRelativePath);

function printUsageAndExit() {
  console.log(`Usage:
  node scripts/prepare-supabase-secrets-local.js
  node scripts/prepare-supabase-secrets-local.js --write
  node scripts/prepare-supabase-secrets-local.js --write --force
  node scripts/prepare-supabase-secrets-local.js --json

Options:
  --write  Create supabase/secrets.local.env from local config/certs.
  --force  Overwrite an existing supabase/secrets.local.env.
  --json   Print a redacted machine-readable summary.

The script never prints secret values. Missing external values are written as
comments, not as assignments, so they cannot be accidentally deployed as
placeholder Supabase Secrets.
`);
  process.exit(0);
}

if (argSet.has('--help') || argSet.has('-h')) {
  printUsageAndExit();
}

function configured(value) {
  const text = String(value || '').trim();

  return looksConfigured(text)
    && text !== '...'
    && !text.startsWith('SET_AS_')
    && !text.includes('NOT_FRONTEND')
    && !text.includes('PASTE_')
    && !text.includes('REPLACE_WITH_');
}

function getPath(object, segments) {
  return segments.reduce((current, segment) => (
    current && typeof current === 'object' ? current[segment] : undefined
  ), object);
}

function firstConfigured(...values) {
  return values.find((value) => configured(value)) || '';
}

function readFileIfConfigured(filePath) {
  if (!configured(filePath)) {
    return '';
  }

  const resolved = resolveProjectPath(filePath);

  if (!fs.existsSync(resolved)) {
    return '';
  }

  return fs.readFileSync(resolved, 'utf8');
}

function findSingleFile(pattern) {
  const match = findSingleFilePath(pattern);

  return match ? fs.readFileSync(match, 'utf8') : '';
}

function findSingleFilePath(pattern) {
  const directory = path.dirname(pattern);
  const basenamePattern = path.basename(pattern)
    .replaceAll('.', '\\.')
    .replaceAll('*', '.*');
  const regex = new RegExp(`^${basenamePattern}$`);
  const resolvedDirectory = resolveProjectPath(directory);

  if (!fs.existsSync(resolvedDirectory)) {
    return '';
  }

  const matches = fs.readdirSync(resolvedDirectory)
    .filter((fileName) => regex.test(fileName))
    .map((fileName) => path.join(resolvedDirectory, fileName));

  return matches.length === 1 ? matches[0] : '';
}

function deriveAppleKeyIdFromAuthKeyPath(filePath) {
  const match = path.basename(filePath || '').match(/^AuthKey_([A-Z0-9]{10})\.p8$/i);

  return match ? match[1].toUpperCase() : '';
}

function readGoogleIssuerIdFile() {
  const candidates = [
    'Google_Wallet_Issuer_ID',
    'Google_Wallet_Issuer_ID.txt',
    'Google_Wallet_Issuer_ID.rtf'
  ];

  for (const candidate of candidates) {
    const resolved = resolveProjectPath(candidate);

    if (!fs.existsSync(resolved)) {
      continue;
    }

    let text = '';

    if (candidate.endsWith('.rtf')) {
      try {
        text = execFileSync('textutil', ['-convert', 'txt', '-stdout', resolved], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        });
      } catch {
        text = fs.readFileSync(resolved, 'utf8');
      }
    } else {
      text = fs.readFileSync(resolved, 'utf8');
    }

    const matches = [...text.matchAll(/\b\d{6,}\b/g)].map((match) => match[0]);
    const unique = [...new Set(matches)];

    if (unique.length === 1) {
      return unique[0];
    }
  }

  return '';
}

function readTextFileMaybeRtf(relativePath) {
  const resolved = resolveProjectPath(relativePath);

  if (!fs.existsSync(resolved)) {
    return '';
  }

  if (relativePath.endsWith('.rtf')) {
    try {
      return execFileSync('textutil', ['-convert', 'txt', '-stdout', resolved], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch {
      return fs.readFileSync(resolved, 'utf8');
    }
  }

  return fs.readFileSync(resolved, 'utf8');
}

function stripRtfControlText(value) {
  return String(value || '')
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\line/g, '\n')
    .replace(/\\'[0-9a-fA-F]{2}/g, '')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\\/g, '\n');
}

function extractEnvAssignments(text) {
  const assignments = new Map();
  const normalized = stripRtfControlText(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n');
  const keyPattern = /([A-Z0-9_]+)=/g;
  const matches = [...normalized.matchAll(keyPattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const key = match[1];
    const valueStart = match.index + match[0].length;
    const valueEnd = index + 1 < matches.length ? matches[index + 1].index : normalized.length;
    const rawValue = normalized.slice(valueStart, valueEnd)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('');
    const cleaned = rawValue
      .replace(/^["']|["']$/g, '')
      .replace(/\s+\([^)]+\)$/g, '')
      .trim();

    if (key && cleaned) {
      assignments.set(key, cleaned);
    }
  }

  return assignments;
}

function readSamsungEnvValues() {
  const candidates = [
    ':Users:fabricio:Desktop:pornwheel:samsung_env_values.txt',
    'samsung_env_values.txt',
    'samsung_env_values.txt.rtf',
    'env Samsung wallet.txt',
    'env Samsung wallet.txt.rtf'
  ];
  const merged = new Map();

  for (const candidate of candidates) {
    const text = readTextFileMaybeRtf(candidate);

    if (!text) {
      continue;
    }

    for (const [key, value] of extractEnvAssignments(text)) {
      if (!merged.has(key)) {
        merged.set(key, value);
      }
    }
  }

  return merged;
}

function normalizeSamsungCardType(value) {
  const text = String(value || '').toLowerCase();

  if (text.includes('generic')) return 'generic';
  if (text.includes('loyalty')) return 'loyalty';
  if (text.includes('coupon')) return 'coupon';
  if (text.includes('gift')) return 'giftcard';
  if (text.includes('ticket')) return 'ticket';

  return '';
}

function publicKeyFingerprintFromPrivateKey(value) {
  try {
    const privateKey = crypto.createPrivateKey(value);
    const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });

    return crypto.createHash('sha256').update(publicKeyDer).digest('hex');
  } catch {
    return '';
  }
}

function publicKeyFingerprintFromCertificate(value) {
  try {
    const certificate = new crypto.X509Certificate(value);
    const publicKeyDer = certificate.publicKey.export({ type: 'spki', format: 'der' });

    return crypto.createHash('sha256').update(publicKeyDer).digest('hex');
  } catch {
    return '';
  }
}

function samsungPrivateKeyMatchesPartnerCertificate(privateKeyPem, partnerCertificatePem) {
  if (!configured(partnerCertificatePem)) {
    return true;
  }

  const privateKeyFingerprint = publicKeyFingerprintFromPrivateKey(privateKeyPem);
  const partnerCertificateFingerprint = publicKeyFingerprintFromCertificate(partnerCertificatePem);

  return Boolean(privateKeyFingerprint && partnerCertificateFingerprint && privateKeyFingerprint === partnerCertificateFingerprint);
}

function deriveFunctionsBaseUrl(supabaseUrl) {
  if (!configured(supabaseUrl)) {
    return '';
  }

  try {
    const parsed = new URL(supabaseUrl);
    return `${parsed.origin}/functions/v1`;
  } catch {
    return '';
  }
}

function randomSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function envValue(value) {
  return `"${String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\n', '\\n')
    .replaceAll('"', '\\"')}"`;
}

function compactJsonIfPossible(value) {
  try {
    return JSON.stringify(JSON.parse(String(value || '')));
  } catch {
    return String(value || '');
  }
}

function singleQuotedEnvValue(value) {
  return `'${String(value)
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll("'", "'\"'\"'")}'`;
}

function entryEnvValue(entry) {
  if (entry.name === 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON') {
    return singleQuotedEnvValue(compactJsonIfPossible(entry.value));
  }

  return envValue(entry.value);
}

function add(entries, name, value, source, options = {}) {
  if (configured(value) || options.allowEmpty) {
    entries.push({ name, value: String(value ?? ''), source, status: 'ready' });
    return;
  }

  entries.push({ name, value: '', source, status: 'missing', hint: options.hint || '' });
}

function buildEntries(config) {
  const entries = [];
  const supabaseUrl = getPath(config, ['supabase', 'url']);
  const functionsBaseUrl = deriveFunctionsBaseUrl(supabaseUrl);
  const appPublicBaseUrl = firstConfigured(
    getPath(config, ['publicUrls', 'appPublicBaseUrl']),
    getPath(config, ['publicUrls', 'webAppDomain']),
    getPath(config, ['app', 'baseUrl'])
  );
  const legacyPasskit = config.passkit || {};
  const appleDirect = config.appleWalletDirect || {};
  const googleWallet = config.googleWallet || {};
  const deliveryRules = config.deliveryRules || {};
  const samsungWallet = readSamsungEnvValues();

  add(entries, 'SUPABASE_URL', supabaseUrl, 'config.supabase.url');
  add(entries, 'SUPABASE_ANON_KEY', getPath(config, ['supabase', 'anonKey']), 'config.supabase.anonKey');
  add(entries, 'SUPABASE_SERVICE_ROLE_KEY', getPath(config, ['supabase', 'serviceRoleKey']), 'config.supabase.serviceRoleKey');
  add(entries, 'APP_PUBLIC_BASE_URL', appPublicBaseUrl, 'config public/app URL');

  const appleTeamId = firstConfigured(appleDirect.teamId, legacyPasskit.teamIdentifier);
  const applePassTypeId = firstConfigured(appleDirect.passTypeId, legacyPasskit.passTypeIdentifier);
  const appleTeamIdSource = configured(appleDirect.teamId) ? 'config.appleWalletDirect.teamId' : 'config.passkit.teamIdentifier';
  const applePassTypeIdSource = configured(appleDirect.passTypeId) ? 'config.appleWalletDirect.passTypeId' : 'config.passkit.passTypeIdentifier';
  const wwdrCert = firstConfigured(appleDirect.wwdrCert, readFileIfConfigured(legacyPasskit.wwdrCertificatePath));
  const passCert = firstConfigured(appleDirect.passCert, readFileIfConfigured(legacyPasskit.signerCertPath));
  const passKey = firstConfigured(appleDirect.passKey, readFileIfConfigured(legacyPasskit.signerKeyPath));
  const apnsAuthKeyPath = findSingleFilePath('certs/*.p8') || findSingleFilePath('*.p8');
  const apnsAuthKey = firstConfigured(appleDirect.apnsAuthKey, apnsAuthKeyPath ? fs.readFileSync(apnsAuthKeyPath, 'utf8') : '');
  const apnsKeyId = firstConfigured(appleDirect.apnsKeyId, deriveAppleKeyIdFromAuthKeyPath(apnsAuthKeyPath));

  add(entries, 'APPLE_TEAM_ID', appleTeamId, appleTeamIdSource);
  add(entries, 'APPLE_PASS_TYPE_ID', applePassTypeId, applePassTypeIdSource);
  add(entries, 'APPLE_WWDR_CERT', wwdrCert, 'certs/AppleWWDRCAG4.pem');
  add(entries, 'APPLE_PASS_CERT', passCert, 'certs/pass-cert.pem');
  add(entries, 'APPLE_PASS_KEY', passKey, 'certs/pass-key.pem');
  add(entries, 'APPLE_PASS_KEY_PASSWORD', firstConfigured(appleDirect.passKeyPassword, legacyPasskit.signerKeyPassphrase), 'local config passphrase');
  add(entries, 'APPLE_WEB_SERVICE_BASE_URL', firstConfigured(
    appleDirect.webServiceBaseUrl,
    functionsBaseUrl ? `${functionsBaseUrl}/apple-wallet-webservice` : ''
  ), 'derived Supabase function URL');
  add(entries, 'APPLE_APNS_KEY_ID', apnsKeyId, configured(appleDirect.apnsKeyId) ? 'config.appleWalletDirect.apnsKeyId' : 'AuthKey_*.p8 filename', {
    hint: 'Apple Developer > Certificates, Identifiers & Profiles > Keys > Wallet/APNs Key ID'
  });
  add(entries, 'APPLE_APNS_TEAM_ID', firstConfigured(appleDirect.apnsTeamId, appleTeamId), 'Apple Team ID');
  add(entries, 'APPLE_APNS_AUTH_KEY', apnsAuthKey, 'certs/*.p8', {
    hint: 'Download the Apple APNs/Auth Key .p8 and place it in certs/'
  });

  add(entries, 'GOOGLE_WALLET_ISSUER_ID', firstConfigured(googleWallet.issuerId, readGoogleIssuerIdFile()), 'Google Wallet Console / Google_Wallet_Issuer_ID file', {
    hint: 'Google Wallet API Console issuer id'
  });
  add(entries, 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', firstConfigured(
    readFileIfConfigured(googleWallet.serviceAccountJson),
    googleWallet.serviceAccountJson,
    findSingleFile('google-service-account*.json')
  ), 'Google service account JSON', {
    hint: 'Place google-service-account*.json in the project root or paste the JSON in Supabase Secrets'
  });
  add(entries, 'GOOGLE_WALLET_CLASS_SUFFIX', firstConfigured(googleWallet.classSuffix, 'wallet_cards_mvp'), 'config/default');
  add(entries, 'GOOGLE_WALLET_ORIGINS', firstConfigured(googleWallet.origins, appPublicBaseUrl), 'config/default');

  const samsungPartnerId = samsungWallet.get('SAMSUNG_WALLET_PARTNER_ID') || '';
  const samsungPrivateKey = readTextFileMaybeRtf('samsung-wallet-keys/samsung_wallet_private.key');
  const samsungPartnerCertificate = firstConfigured(
    readTextFileMaybeRtf('samsung-wallet-keys/X303/el_promillo.crt'),
    readTextFileMaybeRtf('samsung-wallet-keys/samsung_partner_cert.pem'),
    readTextFileMaybeRtf('samsung-wallet-keys/partner_cert.pem')
  );
  const samsungPrivateKeyReady = configured(samsungPrivateKey)
    && samsungPrivateKeyMatchesPartnerCertificate(samsungPrivateKey, samsungPartnerCertificate);
  const samsungPublicKey = firstConfigured(
    readTextFileMaybeRtf('samsung-wallet-keys/samsung_public_cert.pem'),
    readTextFileMaybeRtf('samsung-wallet-keys/samsung_public_key.pem'),
    readTextFileMaybeRtf('samsung-wallet-keys/samsung_wallet_public.pem')
  );

  add(entries, 'SAMSUNG_WALLET_PARTNER_ID', samsungPartnerId, 'Samsung Wallet Partner Portal / local samsung env file');
  add(entries, 'SAMSUNG_WALLET_PARTNER_CODE', firstConfigured(
    samsungWallet.get('SAMSUNG_WALLET_PARTNER_CODE'),
    samsungPartnerId
  ), 'Samsung Wallet Add to Wallet Script Guide');
  add(entries, 'SAMSUNG_WALLET_CARD_ID', samsungWallet.get('SAMSUNG_WALLET_CARD_ID') || '', 'Samsung Wallet Add to Wallet Script Guide');
  add(entries, 'SAMSUNG_WALLET_CARD_TYPE', firstConfigured(
    normalizeSamsungCardType(samsungWallet.get('SAMSUNG_WALLET_CARD_TYPE')),
    'loyalty'
  ), 'Samsung Wallet Card Type');
  add(entries, 'SAMSUNG_WALLET_CARD_SUB_TYPE', firstConfigured(
    samsungWallet.get('SAMSUNG_WALLET_CARD_SUB_TYPE'),
    'others'
  ), 'Samsung Wallet Card Sub Type');
  add(entries, 'SAMSUNG_WALLET_CERTIFICATE_ID', samsungWallet.get('SAMSUNG_WALLET_CERTIFICATE_ID') || '', 'Samsung Wallet Certificate ID');
  add(entries, 'SAMSUNG_WALLET_COUNTRY_CODE', firstConfigured(
    samsungWallet.get('SAMSUNG_WALLET_COUNTRY_CODE'),
    'CH'
  ), 'Samsung Wallet country code');
  add(entries, 'SAMSUNG_WALLET_ENV', firstConfigured(
    samsungWallet.get('SAMSUNG_WALLET_ENV'),
    'sandbox'
  ), 'Samsung Wallet environment');
  add(entries, 'SAMSUNG_WALLET_ADD_FLOW', firstConfigured(
    samsungWallet.get('SAMSUNG_WALLET_ADD_FLOW'),
    'data_fetch'
  ), 'Samsung Wallet Data Fetch Link flow');
  add(entries, 'SAMSUNG_WALLET_PRIVATE_KEY_PEM', samsungPrivateKeyReady ? samsungPrivateKey : '', 'samsung-wallet-keys/samsung_wallet_private.key', {
    hint: configured(samsungPartnerCertificate)
      ? 'Place the private key matching samsung-wallet-keys/X303/el_promillo.crt at samsung-wallet-keys/samsung_wallet_private.key'
      : 'Place the matching Samsung private key at samsung-wallet-keys/samsung_wallet_private.key'
  });
  add(entries, 'SAMSUNG_WALLET_SAMSUNG_PUBLIC_KEY_PEM', samsungPublicKey, 'samsung-wallet-keys/samsung_public_cert.pem', {
    hint: 'Download/extract Samsung public key or certificate from Samsung Wallet Partner Portal'
  });
  add(entries, 'SAMSUNG_WALLET_RD_CLICK_URL', samsungWallet.get('SAMSUNG_WALLET_RD_CLICK_URL') || '', 'Samsung Wallet Add to Wallet Script Guide');
  add(entries, 'SAMSUNG_WALLET_RD_IMPRESSION_URL', samsungWallet.get('SAMSUNG_WALLET_RD_IMPRESSION_URL') || '', 'Samsung Wallet Add to Wallet Script Guide');
  add(entries, 'SAMSUNG_WALLET_PARTNER_SERVER_URL', firstConfigured(
    samsungWallet.get('SAMSUNG_WALLET_PARTNER_SERVER_URL'),
    functionsBaseUrl ? `${functionsBaseUrl}/samsung-wallet-server` : ''
  ), 'Samsung Wallet Partner Server URL');
  add(entries, 'SAMSUNG_WALLET_ALLOW_UNVERIFIED_AUTH', 'false', 'Samsung Wallet production default');

  add(entries, 'PAYMENT_PROVIDER', firstConfigured(getPath(config, ['payment', 'provider']), 'manual'), 'config/default');
  add(entries, 'PAYMENT_CHECKOUT_BASE_URL', getPath(config, ['payment', 'checkoutBaseUrl']) || '', 'config/payment', { allowEmpty: true });
  add(entries, 'PAYMENT_WEBHOOK_SECRET', firstConfigured(getPath(config, ['payment', 'webhookSecret']), randomSecret()), 'generated/local');

  add(entries, 'WALLET_CRON_SECRET', firstConfigured(getPath(config, ['automation', 'walletCronSecret']), randomSecret()), 'generated/local');
  add(entries, 'OPERATOR_VERIFICATION_MAIL_MODE', firstConfigured(
    getPath(config, ['operatorRegistration', 'verificationMailMode']),
    'supabase_auth'
  ), 'config/default');
  add(entries, 'OPERATOR_EMAIL_VERIFICATION_REQUIRED', firstConfigured(
    getPath(config, ['operatorRegistration', 'emailVerificationRequired']),
    'false'
  ), 'config/default');
  add(entries, 'OPERATOR_VERIFICATION_CRON_SECRET', firstConfigured(
    getPath(config, ['operatorRegistration', 'operatorVerificationCronSecret']),
    ''
  ), 'optional; falls leer wird WALLET_CRON_SECRET genutzt', { allowEmpty: true });
  add(entries, 'OPERATOR_VERIFICATION_REDIRECT_PATH', firstConfigured(
    getPath(config, ['operatorRegistration', 'verificationRedirectPath']),
    '/dashboard.html'
  ), 'config/default');
  add(entries, 'OPERATOR_VERIFICATION_MAX_ATTEMPTS', '5', 'config/default');
  add(entries, 'OPERATOR_REGISTER_RATE_LIMIT', '12', 'config/default');
  add(entries, 'OPERATOR_REGISTER_RATE_LIMIT_WINDOW_SECONDS', '3600', 'config/default');
  add(entries, 'MAIL_FROM_EMAIL', firstConfigured(
    getPath(config, ['operatorRegistration', 'verificationSenderEmail']),
    'Fabricio@el-promillo.ch'
  ), 'config/default');
  add(entries, 'MAIL_FROM_NAME', 'El Promillo', 'config/default');
  add(entries, 'RESEND_API_KEY', '', 'optional; nur bei OPERATOR_VERIFICATION_MAIL_MODE=resend', { allowEmpty: true });
  add(entries, 'WALLET_BUSINESS_DAILY_LIMIT', deliveryRules.businessDailyLimit || '500', 'config/default');
  add(entries, 'WALLET_CUSTOMER_DAILY_LIMIT', deliveryRules.customerDailyLimit || '12', 'config/default');
  add(entries, 'WALLET_CARD_DAILY_LIMIT', deliveryRules.cardDailyLimit || '6', 'config/default');
  add(entries, 'WALLET_GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H', deliveryRules.googleTextAndNotifyLimitPerPass24h || '3', 'config/default');
  add(entries, 'WALLET_DUPLICATE_WINDOW_MINUTES', deliveryRules.duplicateWindowMinutes || '10', 'config/default');
  add(entries, 'WALLET_PUBLIC_CLAIM_RATE_LIMIT', deliveryRules.publicClaimRateLimit || '80', 'config/default');
  add(entries, 'WALLET_PUBLIC_CLAIM_RATE_LIMIT_WINDOW_SECONDS', deliveryRules.publicClaimRateLimitWindowSeconds || '900', 'config/default');
  add(entries, 'WALLET_RECIPIENT_PROCESSING_TIMEOUT_MINUTES', deliveryRules.recipientProcessingTimeoutMinutes || '15', 'config/default');
  add(entries, 'WALLET_QUEUE_PROCESSING_TIMEOUT_MINUTES', deliveryRules.queueProcessingTimeoutMinutes || '15', 'config/default');

  return entries;
}

function renderEnvFile(entries) {
  const lines = [
    '# Local Supabase Secrets for direct Apple/Google/Samsung Wallet.',
    '# Generated by scripts/prepare-supabase-secrets-local.js.',
    '# This file is ignored by git. Do not paste it into chat or commit it.',
    '# Apply ready values with: supabase secrets set --env-file supabase/secrets.local.env',
    ''
  ];

  for (const entry of entries) {
    if (entry.status === 'ready') {
      lines.push(`# source: ${entry.source}`);
      lines.push(`${entry.name}=${entryEnvValue(entry)}`);
    } else {
      lines.push(`# MISSING ${entry.name}${entry.hint ? ` - ${entry.hint}` : ''}`);
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function redactedSummary(entries) {
  const ready = entries.filter((entry) => entry.status === 'ready');
  const missing = entries.filter((entry) => entry.status === 'missing');

  return {
    outputPath,
    wroteFile: writeFile,
    ready: ready.length,
    missing: missing.map((entry) => entry.name),
    readyNames: ready.map((entry) => entry.name)
  };
}

const config = loadConfig();
const entries = buildEntries(config);
const summary = redactedSummary(entries);

if (writeFile) {
  if (fs.existsSync(outputPath) && !force) {
    throw new Error('supabase/secrets.local.env existiert bereits. Nutze --force zum Ueberschreiben.');
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderEnvFile(entries), 'utf8');
}

if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('Supabase Secrets Local Preparation');
  console.log(`Datei: ${outputPath}`);
  console.log(`Bereit: ${summary.ready}`);
  console.log(`Fehlend: ${summary.missing.length ? summary.missing.join(', ') : 'keine'}`);
  console.log(writeFile ? 'Status: Datei geschrieben; Secret-Werte wurden nicht ausgegeben.' : 'Status: Dry-run; nutze --write zum Schreiben.');
}
