import { loadConfig, looksConfigured } from '../server/config.js';

const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const jsonOutput = argSet.has('--json');
const strict = argSet.has('--strict');

const publicFunctions = [
  'claim-card',
  'get-public-template',
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

const protectedFunctions = [
  'redeem-balance',
  'issue-apple-pass',
  'update-apple-pass',
  'send-apple-wallet-update',
  'issue-google-wallet-pass',
  'update-google-wallet-pass',
  'send-google-wallet-message',
  'generate-card-pdf',
  'create-wallet-notification-campaign',
  'send-wallet-notification',
  'resolve-wallet-notification-recipients',
  'check-wallet-notification-limits',
  'scanner-actions',
  'get-business-scan-statistics'
];

function optionValue(name) {
  const prefix = `${name}=`;
  const withEquals = rawArgs.find((arg) => arg.startsWith(prefix));

  if (withEquals) {
    return withEquals.slice(prefix.length);
  }

  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] : '';
}

function printUsageAndExit() {
  console.log(`Usage:
  node scripts/wallet-edge-functions-report.js
  node scripts/wallet-edge-functions-report.js --json
  node scripts/wallet-edge-functions-report.js --strict
  node scripts/wallet-edge-functions-report.js --functions-base-url https://<PROJECT_REF>.supabase.co/functions/v1

Options:
  --functions-base-url <url>  Supabase Functions base URL ending in /functions/v1.
  --timeout-ms <ms>           Per-request timeout, default 7000.
  --strict                    Exit non-zero when any Function preflight fails.
  --json                      Print machine-readable JSON.

This report checks deployed Supabase Edge Functions with CORS OPTIONS
preflights only. It never sends Supabase keys, operator JWTs, Apple
certificates, APNS tokens, Google service-account JSON or Wallet Save JWTs.
`);
  process.exit(0);
}

if (argSet.has('--help') || argSet.has('-h')) {
  printUsageAndExit();
}

function configured(value) {
  const text = String(value || '').trim();

  return Boolean(text)
    && looksConfigured(text)
    && !text.startsWith('SET_AS_')
    && !text.includes('PLACEHOLDER')
    && !text.includes('YOUR_');
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');

  if (!text) {
    return '';
  }

  try {
    return new URL(text).toString().replace(/\/+$/, '');
  } catch {
    return text;
  }
}

function resolveFunctionsBaseUrl(config) {
  const explicitValue = optionValue('--functions-base-url')
    || process.env.SUPABASE_FUNCTION_BASE_URL
    || process.env.SUPABASE_FUNCTIONS_BASE_URL;

  if (explicitValue) {
    return normalizeBaseUrl(explicitValue);
  }

  const configuredBaseUrl = normalizeBaseUrl(config.publicUrls?.supabaseFunctionBaseUrl);

  if (configured(configuredBaseUrl)) {
    return configuredBaseUrl;
  }

  const supabaseUrl = normalizeBaseUrl(config.supabase?.url);

  if (!configured(supabaseUrl)) {
    return configuredBaseUrl;
  }

  try {
    const url = new URL(supabaseUrl);
    return `${url.origin}/functions/v1`;
  } catch {
    return configuredBaseUrl;
  }
}

function appendFunctionPath(baseUrl, functionName) {
  return `${baseUrl}/${functionName}`;
}

function summarize(results) {
  return results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    return summary;
  }, { ok: 0, warn: 0, fail: 0 });
}

async function preflight(functionName, group, baseUrl, timeoutMs) {
  const url = appendFunctionPath(baseUrl, functionName);

  try {
    const response = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://wallet-edge-report.local',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-cron-secret,x-payment-webhook-secret'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const cors = response.headers.get('access-control-allow-origin') || '';
    const allowedStatuses = group === 'public'
      ? [200, 204]
      : [200, 204, 401, 403];
    const statusOk = allowedStatuses.includes(response.status);
    const corsOk = Boolean(cors);

    if (statusOk && corsOk) {
      return {
        group,
        function: functionName,
        status: 'ok',
        http_status: response.status,
        cors: true
      };
    }

    return {
      group,
      function: functionName,
      status: 'fail',
      http_status: response.status,
      cors: corsOk,
      expected_statuses: allowedStatuses,
      reason: 'Unerwarteter Preflight-Status oder fehlender CORS Header.'
    };
  } catch (error) {
    return {
      group,
      function: functionName,
      status: 'fail',
      reason: error?.message || 'Function-Preflight konnte nicht ausgeführt werden.'
    };
  }
}

async function buildReport() {
  const config = loadConfig();
  const timeoutMs = Math.max(1000, Number(optionValue('--timeout-ms') || 7000));
  const functionsBaseUrl = resolveFunctionsBaseUrl(config);
  const results = [];

  if (!configured(functionsBaseUrl) || !functionsBaseUrl.includes('/functions/v1')) {
    return {
      strict,
      secretsPrinted: false,
      functionsBaseUrl: functionsBaseUrl || '',
      summary: { ok: 0, warn: 0, fail: 1 },
      results: [{
        group: 'config',
        function: 'functions-base-url',
        status: 'fail',
        reason: 'Functions Base URL fehlt, ist Platzhalter oder endet nicht auf /functions/v1.'
      }]
    };
  }

  for (const functionName of publicFunctions) {
    results.push(await preflight(functionName, 'public', functionsBaseUrl, timeoutMs));
  }

  for (const functionName of protectedFunctions) {
    results.push(await preflight(functionName, 'protected', functionsBaseUrl, timeoutMs));
  }

  return {
    strict,
    secretsPrinted: false,
    functionsBaseUrl,
    timeoutMs,
    expected: {
      public: publicFunctions,
      protected: protectedFunctions,
      total: publicFunctions.length + protectedFunctions.length
    },
    summary: summarize(results),
    results
  };
}

function printHuman(report) {
  console.log('Wallet Edge Functions Report');
  console.log('Secrets, Zertifikate, Tokens und Save-JWTs werden nicht ausgegeben.');
  console.log(`Functions Base URL: ${report.functionsBaseUrl || 'fehlt'}`);

  for (const result of report.results) {
    const label = result.status.toUpperCase().padEnd(4, ' ');
    const status = result.http_status ? ` HTTP ${result.http_status}` : '';
    const cors = result.cors === undefined ? '' : ` CORS ${result.cors ? 'ok' : 'fehlt'}`;
    const reason = result.reason ? ` - ${result.reason}` : '';
    console.log(`${label} ${result.group}/${result.function}${status}${cors}${reason}`);
  }

  console.log(`Summary: ok=${report.summary.ok} warn=${report.summary.warn} fail=${report.summary.fail}`);
}

const report = await buildReport();

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}

if (strict && (report.summary.fail || 0) > 0) {
  process.exitCode = 1;
}
