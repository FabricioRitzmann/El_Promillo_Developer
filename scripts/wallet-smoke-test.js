import { loadConfig, looksConfigured } from '../server/config.js';

const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const jsonOutput = argSet.has('--json');
const includeFunctions = argSet.has('--functions') || argSet.has('--all-functions');
const includeAllFunctions = argSet.has('--all-functions');
const strict = argSet.has('--strict');

const webChecks = [
  { name: 'config', path: '/api/config', type: 'json' },
  { name: 'index', path: '/', type: 'html' },
  { name: 'dashboard', path: '/dashboard.html', type: 'html' },
  { name: 'editor', path: '/editor.html', type: 'html' },
  { name: 'scanner', path: '/scanner.html', type: 'html' },
  { name: 'claim', path: '/claim.html', type: 'html' }
];

const publicFunctionChecks = [
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
].map((name) => ({
  name,
  path: `/${name}`,
  method: 'OPTIONS',
  okStatuses: [200, 204]
}));

const protectedFunctionChecks = [
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
].map((name) => ({
  name,
  path: `/${name}`,
  method: 'OPTIONS',
  okStatuses: [200, 204, 401, 403]
}));

function optionValue(name) {
  const prefix = `${name}=`;
  const withEquals = rawArgs.find((arg) => arg.startsWith(prefix));

  if (withEquals) {
    return withEquals.slice(prefix.length);
  }

  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] : '';
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

function resolveWebBaseUrl(config) {
  return normalizeBaseUrl(
    optionValue('--base-url')
      || process.env.APP_PUBLIC_BASE_URL
      || config.publicUrls?.webAppDomain
      || config.app?.baseUrl
  );
}

function resolveFunctionBaseUrl(config) {
  return normalizeBaseUrl(
    optionValue('--functions-base-url')
      || process.env.SUPABASE_FUNCTION_BASE_URL
      || process.env.SUPABASE_FUNCTIONS_BASE_URL
      || config.publicUrls?.supabaseFunctionBaseUrl
  );
}

function appendPath(baseUrl, pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${baseUrl}${normalizedPath}`;
}

function add(results, status, group, name, detail = {}) {
  results.push({
    status,
    group,
    name,
    ...detail
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs)
  });
}

async function checkWebTarget(results, baseUrl, check, timeoutMs) {
  const url = appendPath(baseUrl, check.path);

  try {
    const response = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    const statusOk = response.status >= 200 && response.status < 400;
    const typeOk = check.type === 'json'
      ? contentType.includes('application/json')
      : contentType.includes('text/html');
    const bodyOk = body.length > 0;

    if (statusOk && typeOk && bodyOk) {
      add(results, 'ok', 'web', check.name, {
        path: check.path,
        http_status: response.status,
        content_type: contentType,
        bytes: body.length
      });
      return;
    }

    add(results, 'fail', 'web', check.name, {
      path: check.path,
      http_status: response.status,
      content_type: contentType,
      bytes: body.length,
      reason: 'Unerwarteter Status, Content-Type oder leerer Body.'
    });
  } catch (error) {
    add(results, 'fail', 'web', check.name, {
      path: check.path,
      reason: error.message
    });
  }
}

async function checkFunctionTarget(results, baseUrl, check, timeoutMs) {
  const url = appendPath(baseUrl, check.path);

  try {
    const response = await fetchWithTimeout(url, {
      method: check.method,
      headers: {
        Origin: 'https://wallet-smoke.local',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-cron-secret,x-payment-webhook-secret'
      }
    }, timeoutMs);
    const contentType = response.headers.get('content-type') || '';
    const cors = response.headers.get('access-control-allow-origin') || '';
    const statusOk = check.okStatuses.includes(response.status);
    const corsOk = Boolean(cors);

    if (statusOk && corsOk) {
      add(results, 'ok', 'functions', check.name, {
        path: check.path,
        method: check.method,
        http_status: response.status,
        content_type: contentType,
        cors: true
      });
      return;
    }

    add(results, 'fail', 'functions', check.name, {
      path: check.path,
      method: check.method,
      http_status: response.status,
      content_type: contentType,
      cors: corsOk,
      expected_statuses: check.okStatuses,
      reason: 'Unerwarteter Function-Preflight-Status oder fehlende CORS Header.'
    });
  } catch (error) {
    add(results, 'fail', 'functions', check.name, {
      path: check.path,
      method: check.method,
      reason: error.message
    });
  }
}

function printHuman(results, meta) {
  console.log('Wallet Smoke Test');
  console.log(`Web Base URL: ${meta.webBaseUrl || 'fehlt'}`);

  if (meta.functionsBaseUrl) {
    console.log(`Functions Base URL: ${meta.functionsBaseUrl}`);
  } else {
    console.log('Functions Base URL: nicht geprüft');
  }

  console.log('Secrets werden nicht ausgegeben.');

  for (const result of results) {
    const label = result.status.toUpperCase().padEnd(4, ' ');
    const path = result.path ? ` ${result.path}` : '';
    const status = result.http_status ? ` HTTP ${result.http_status}` : '';
    const reason = result.reason ? ` - ${result.reason}` : '';
    console.log(`${label} ${result.group}/${result.name}${path}${status}${reason}`);
  }

  const counts = summarize(results);
  console.log(`Summary: ok=${counts.ok} skip=${counts.skip} fail=${counts.fail}`);
}

function summarize(results) {
  return results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }, { ok: 0, skip: 0, fail: 0 });
}

function printUsageAndExit() {
  console.log(`Usage:
  node scripts/wallet-smoke-test.js
  node scripts/wallet-smoke-test.js --base-url http://localhost:3000
  node scripts/wallet-smoke-test.js --functions --functions-base-url https://<PROJECT_REF>.supabase.co/functions/v1
  node scripts/wallet-smoke-test.js --all-functions --json

Options:
  --base-url <url>             Webapp URL, default from config/env.
  --functions                  Also check public no-JWT Edge Function preflights.
  --all-functions              Also check protected Operator Edge Function preflights.
  --functions-base-url <url>   Supabase Functions base URL ending in /functions/v1.
  --timeout-ms <ms>            Per-request timeout, default 7000.
  --strict                     Exit non-zero on failures.
  --json                       Print JSON output.
`);
  process.exit(0);
}

async function main() {
  if (argSet.has('--help') || argSet.has('-h')) {
    printUsageAndExit();
  }

  const config = loadConfig();
  const timeoutMs = Math.max(1000, Number(optionValue('--timeout-ms') || 7000));
  const webBaseUrl = resolveWebBaseUrl(config);
  const functionsBaseUrl = resolveFunctionBaseUrl(config);
  const results = [];

  if (!configured(webBaseUrl)) {
    add(results, 'fail', 'web', 'base-url', {
      reason: 'Web Base URL fehlt oder ist noch ein Platzhalter.'
    });
  } else {
    for (const check of webChecks) {
      await checkWebTarget(results, webBaseUrl, check, timeoutMs);
    }
  }

  if (!includeFunctions) {
    add(results, 'skip', 'functions', 'edge-functions', {
      reason: 'Nicht angefordert. Mit --functions oder --all-functions prüfen.'
    });
  } else if (!configured(functionsBaseUrl) || !functionsBaseUrl.includes('/functions/v1')) {
    add(results, 'fail', 'functions', 'base-url', {
      reason: 'Functions Base URL fehlt, ist Platzhalter oder endet nicht auf /functions/v1.'
    });
  } else {
    const functionChecks = includeAllFunctions
      ? [...publicFunctionChecks, ...protectedFunctionChecks]
      : publicFunctionChecks;

    for (const check of functionChecks) {
      await checkFunctionTarget(results, functionsBaseUrl, check, timeoutMs);
    }
  }

  const meta = {
    webBaseUrl,
    functionsBaseUrl: includeFunctions ? functionsBaseUrl : '',
    includeFunctions,
    includeAllFunctions,
    timeoutMs
  };

  if (jsonOutput) {
    console.log(JSON.stringify({
      ok: summarize(results).fail === 0,
      meta,
      summary: summarize(results),
      results
    }, null, 2));
  } else {
    printHuman(results, meta);
  }

  if (strict && summarize(results).fail > 0) {
    process.exitCode = 1;
  }
}

await main();
