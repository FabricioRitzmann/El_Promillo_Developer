import fs from 'node:fs';
import path from 'node:path';
import {
  X509Certificate,
  createPrivateKey,
  createPublicKey
} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, looksConfigured, resolveProjectPath } from '../server/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const jsonOutput = argSet.has('--json');
const strict = argSet.has('--strict');
const localSecretsPath = path.join(rootDir, 'supabase', 'secrets.local.env');

function printUsageAndExit() {
  console.log(`Usage:
  node scripts/wallet-credential-files-check.js
  node scripts/wallet-credential-files-check.js --json
  node scripts/wallet-credential-files-check.js --strict

The check validates local Apple/Google credential file shapes and key matching.
It never prints certificate contents, private keys, APNS tokens, Google
service-account JSON or Supabase secrets.
`);
  process.exit(0);
}

if (argSet.has('--help') || argSet.has('-h')) {
  printUsageAndExit();
}

function add(results, group, status, label, detail) {
  results.push({ group, status, label, detail });
}

function summarize(results) {
  return results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    return summary;
  }, { ok: 0, warn: 0, fail: 0 });
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
    return value.slice(1, -1);
  }

  return value;
}

function loadLocalEnv() {
  const values = {};

  if (!fs.existsSync(localSecretsPath)) {
    return values;
  }

  const lines = fs.readFileSync(localSecretsPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);

    if (match) {
      values[match[1]] = parseEnvValue(match[2]);
    }
  }

  return values;
}

function envOrConfig(env, config, envName, configPath, fallback = '') {
  const envValue = env[envName];
  const configValue = configPath.reduce((current, segment) => (
    current && typeof current === 'object' ? current[segment] : undefined
  ), config);

  return configured(envValue)
    ? envValue
    : configured(configValue)
      ? configValue
      : fallback;
}

function readTextFile(filePath) {
  if (!configured(filePath)) {
    return '';
  }

  const resolved = path.isAbsolute(filePath) ? filePath : resolveProjectPath(filePath);

  if (!fs.existsSync(resolved)) {
    return '';
  }

  return fs.readFileSync(resolved, 'utf8');
}

function checkCertificate(results, label, filePath, options = {}) {
  const resolved = resolveProjectPath(filePath);

  if (!fs.existsSync(resolved)) {
    add(results, 'apple-files', 'fail', label, 'Datei fehlt');
    return null;
  }

  try {
    const cert = new X509Certificate(fs.readFileSync(resolved));
    const validTo = Date.parse(cert.validTo);

    if (Number.isFinite(validTo) && validTo < Date.now()) {
      add(results, 'apple-files', 'fail', label, 'Zertifikat ist abgelaufen');
      return cert;
    }

    if (options.appleName && !`${cert.subject}\n${cert.issuer}`.toLowerCase().includes('apple')) {
      add(results, 'apple-files', 'warn', label, 'Zertifikat ist lesbar, Apple-Bezug im Subject/Issuer aber nicht erkennbar');
      return cert;
    }

    add(results, 'apple-files', 'ok', label, 'PEM-Zertifikat ist lesbar und zeitlich gültig');
    return cert;
  } catch {
    add(results, 'apple-files', 'fail', label, 'Datei ist kein lesbares X509-Zertifikat');
    return null;
  }
}

function keyToPublicDer(keyObject) {
  return createPublicKey(keyObject).export({ type: 'spki', format: 'der' }).toString('base64');
}

function checkPassPrivateKey(results, config, env, passCert) {
  const keyText = envOrConfig(env, config, 'APPLE_PASS_KEY', ['appleWalletDirect', 'passKey'])
    || readTextFile(config.passkit?.signerKeyPath);
  const passphrase = envOrConfig(env, config, 'APPLE_PASS_KEY_PASSWORD', ['appleWalletDirect', 'passKeyPassword'], config.passkit?.signerKeyPassphrase || '');

  if (!configured(keyText)) {
    add(results, 'apple-files', 'fail', 'Apple Pass Private Key', 'Private Key fehlt');
    return null;
  }

  try {
    const privateKey = createPrivateKey({
      key: keyText,
      passphrase: passphrase || undefined
    });

    if (passCert) {
      const certPublic = passCert.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      const keyPublic = keyToPublicDer(privateKey);

      if (certPublic !== keyPublic) {
        add(results, 'apple-files', 'fail', 'Apple Pass Private Key', 'Private Key passt nicht zum Pass-Zertifikat');
        return privateKey;
      }
    }

    add(results, 'apple-files', 'ok', 'Apple Pass Private Key', 'Private Key ist lesbar und passt zum Pass-Zertifikat');
    return privateKey;
  } catch {
    add(results, 'apple-files', 'fail', 'Apple Pass Private Key', 'Private Key ist nicht lesbar oder Passwort passt nicht');
    return null;
  }
}

function findSingleFile(pattern) {
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

function checkApns(results, config, env) {
  const keyId = envOrConfig(env, config, 'APPLE_APNS_KEY_ID', ['appleWalletDirect', 'apnsKeyId']);
  const teamId = envOrConfig(env, config, 'APPLE_APNS_TEAM_ID', ['appleWalletDirect', 'apnsTeamId']);
  const authKeyText = envOrConfig(env, config, 'APPLE_APNS_AUTH_KEY', ['appleWalletDirect', 'apnsAuthKey'])
    || readTextFile(findSingleFile('certs/*.p8'));

  if (!configured(keyId)) {
    add(results, 'apple-apns', 'fail', 'APPLE_APNS_KEY_ID', 'APNs Key ID fehlt');
  } else if (!/^[A-Z0-9]{10}$/.test(String(keyId))) {
    add(results, 'apple-apns', 'warn', 'APPLE_APNS_KEY_ID', 'APNs Key ID hat nicht das erwartete 10-Zeichen-Format');
  } else {
    add(results, 'apple-apns', 'ok', 'APPLE_APNS_KEY_ID', 'APNs Key ID ist gesetzt');
  }

  if (!configured(teamId)) {
    add(results, 'apple-apns', 'fail', 'APPLE_APNS_TEAM_ID', 'APNs Team ID fehlt');
  } else {
    add(results, 'apple-apns', 'ok', 'APPLE_APNS_TEAM_ID', 'APNs Team ID ist gesetzt');
  }

  if (!configured(authKeyText)) {
    add(results, 'apple-apns', 'fail', 'APPLE_APNS_AUTH_KEY', 'APNs Auth Key .p8 fehlt');
    return;
  }

  try {
    createPrivateKey(authKeyText);
    add(results, 'apple-apns', 'ok', 'APPLE_APNS_AUTH_KEY', 'APNs .p8 Private Key ist lesbar');
  } catch {
    add(results, 'apple-apns', 'fail', 'APPLE_APNS_AUTH_KEY', 'APNs .p8 Private Key ist nicht lesbar');
  }
}

function checkGoogle(results, config, env) {
  const issuerId = envOrConfig(env, config, 'GOOGLE_WALLET_ISSUER_ID', ['googleWallet', 'issuerId']);
  const serviceAccountJson = envOrConfig(env, config, 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', ['googleWallet', 'serviceAccountJson'])
    || readTextFile(findSingleFile('google-service-account*.json'));

  if (!configured(issuerId)) {
    add(results, 'google-files', 'fail', 'GOOGLE_WALLET_ISSUER_ID', 'Google Wallet Issuer ID fehlt');
  } else if (!/^[0-9]+$/.test(String(issuerId))) {
    add(results, 'google-files', 'warn', 'GOOGLE_WALLET_ISSUER_ID', 'Issuer ID ist gesetzt, wirkt aber nicht numerisch');
  } else {
    add(results, 'google-files', 'ok', 'GOOGLE_WALLET_ISSUER_ID', 'Issuer ID ist gesetzt');
  }

  if (!configured(serviceAccountJson)) {
    add(results, 'google-files', 'fail', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', 'Service Account JSON fehlt');
    return;
  }

  try {
    const parsed = JSON.parse(serviceAccountJson);
    const requiredFields = ['type', 'client_email', 'private_key', 'private_key_id'];
    const missing = requiredFields.filter((field) => !configured(parsed[field]));

    if (missing.length > 0) {
      add(results, 'google-files', 'fail', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', `JSON-Felder fehlen: ${missing.join(', ')}`);
      return;
    }

    if (parsed.type !== 'service_account') {
      add(results, 'google-files', 'warn', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', 'JSON ist lesbar, type ist aber nicht service_account');
      return;
    }

    createPrivateKey(parsed.private_key);
    add(results, 'google-files', 'ok', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', 'Service Account JSON und Private Key sind lesbar');
  } catch {
    add(results, 'google-files', 'fail', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', 'Service Account JSON oder Private Key ist nicht lesbar');
  }
}

function buildReport() {
  const config = loadConfig();
  const env = loadLocalEnv();
  const results = [];
  const wwdr = checkCertificate(results, 'Apple WWDR Certificate', 'certs/AppleWWDRCAG4.pem', { appleName: true });
  const passCert = checkCertificate(results, 'Apple Pass Certificate', 'certs/pass-cert.pem');
  checkPassPrivateKey(results, config, env, passCert);
  checkApns(results, config, env);
  checkGoogle(results, config, env);

  return {
    strict,
    localSecretsLoaded: fs.existsSync(localSecretsPath),
    summary: summarize(results),
    results,
    secretsPrinted: false,
    certificatesPrinted: false,
    parsedAppleWwdrCertificate: Boolean(wwdr)
  };
}

function printHuman(report) {
  console.log('Wallet Credential Files Check');
  console.log('Secrets, Zertifikate, Private Keys und JSON-Werte werden nicht ausgegeben.');
  console.log(`OK: ${report.summary.ok}  WARN: ${report.summary.warn}  FAIL: ${report.summary.fail}`);

  for (const result of report.results) {
    const marker = result.status === 'ok' ? 'OK' : result.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${marker.padEnd(4)} ${result.label} - ${result.detail}`);
  }
}

const report = buildReport();

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}

if (strict && report.summary.fail > 0) {
  process.exitCode = 1;
}
