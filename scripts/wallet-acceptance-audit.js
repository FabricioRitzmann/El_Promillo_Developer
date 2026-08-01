import { createSupabaseAdmin } from '../server/supabaseAdmin.js';
import { loadConfig } from '../server/config.js';

const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const strict = argSet.has('--strict');
const jsonOutput = argSet.has('--json');

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
  node scripts/wallet-acceptance-audit.js
  node scripts/wallet-acceptance-audit.js --strict
  node scripts/wallet-acceptance-audit.js --business-id <uuid>
  node scripts/wallet-acceptance-audit.js --owner-id <uuid> --json

Options:
  --strict              Exit non-zero when required acceptance evidence is missing.
  --json                Print machine-readable JSON.
  --business-id <uuid>  Scope checks to one business.
  --owner-id <uuid>     Scope checks to one operator/owner.

The audit prints counts and statuses only. It never prints Supabase keys, wallet
tokens, Google Save JWTs, APNS tokens or certificate material.
`);
  process.exit(0);
}

if (argSet.has('--help') || argSet.has('-h')) {
  printUsageAndExit();
}

const scope = {
  businessId: optionValue('--business-id'),
  ownerId: optionValue('--owner-id')
};

const expectedTables = [
  'operator_profiles',
  'businesses',
  'card_templates',
  'customer_cards',
  'card_instances',
  'wallet_notification_campaigns',
  'wallet_notification_recipients',
  'wallet_push_logs',
  'wallet_update_queue',
  'apple_wallet_devices',
  'apple_wallet_registrations',
  'apple_pass_versions',
  'google_wallet_objects',
  'balance_transactions',
  'topup_payment_sessions',
  'card_events'
];

const appleLogActions = [
  'issue_apple_pass',
  'claim_apple_pass',
  'manual_apple_pass_update',
  'manual_apple_push_update',
  'apple_device_registered',
  'apple_changed_serials_listed',
  'apple_pass_downloaded',
  'apple_pass_not_modified'
];

const googleLogActions = [
  'google_wallet_save_link',
  'issue_google_wallet_pass',
  'manual_google_object_update',
  'manual_google_wallet_message',
  'google_text_and_notify',
  'google_object_message_fallback',
  'google_location_object_update',
  'google_nearby_location_update'
];

function add(results, group, status, label, detail = '') {
  results.push({ group, status, label, detail });
}

function summarize(results) {
  return results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    return summary;
  }, { ok: 0, warn: 0, fail: 0 });
}

function scopedQuery(query, { owner = true, business = true } = {}) {
  let scoped = query;

  if (owner && scope.ownerId) {
    scoped = scoped.eq('owner_id', scope.ownerId);
  }

  if (business && scope.businessId) {
    scoped = scoped.eq('business_id', scope.businessId);
  }

  return scoped;
}

async function countRows(supabase, table, options = {}) {
  const select = options.select || 'id';
  // Do not use head:true here: Supabase/PostgREST can mask stale schema cache
  // errors for HEAD count requests. A one-row body keeps the audit honest while
  // still avoiding large result payloads.
  let query = supabase.from(table).select(select, { count: 'exact' }).limit(1);
  query = scopedQuery(query, options.scope);

  if (typeof options.filter === 'function') {
    query = options.filter(query);
  }

  const { count, error } = await query;

  if (error) {
    return { ok: false, count: 0, error };
  }

  return { ok: true, count: count || 0 };
}

async function selectRows(supabase, table, select, options = {}) {
  const pageSize = options.pageSize || 500;
  const maxRows = options.maxRows || 5000;
  const rows = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    query = scopedQuery(query, options.scope);

    if (typeof options.filter === 'function') {
      query = options.filter(query);
    }

    const { data, error } = await query;

    if (error) {
      return { ok: false, rows, error };
    }

    rows.push(...(data || []));

    if (!data || data.length < pageSize) {
      break;
    }
  }

  return { ok: true, rows };
}

function addCountExpectation(results, group, label, countResult, failWhenZero = true) {
  if (!countResult.ok) {
    add(results, group, 'fail', label, countResult.error.message);
    return;
  }

  if (countResult.count > 0) {
    add(results, group, 'ok', label, `${countResult.count} gefunden`);
    return;
  }

  add(
    results,
    group,
    failWhenZero ? 'fail' : 'warn',
    label,
    failWhenZero ? 'kein Nachweis gefunden' : 'kein Nachweis gefunden; optional oder noch nicht getestet'
  );
}

function publicPassLooksReady(passJson) {
  if (!passJson || typeof passJson !== 'object') {
    return false;
  }

  return Boolean(
    passJson.webServiceURL
      && passJson.authenticationToken
      && (Array.isArray(passJson.barcodes) || passJson.barcode)
  );
}

async function checkSchema(results, supabase) {
  for (const table of expectedTables) {
    const check = await countRows(supabase, table, { scope: { owner: false, business: false } });
    add(results, 'schema', check.ok ? 'ok' : 'fail', table, check.ok ? 'Tabelle erreichbar' : check.error.message);
  }
}

async function checkTenantBase(results, supabase) {
  const operatorFilter = (query) => {
    const unlockedQuery = query.eq('unlock', true);

    return scope.ownerId ? unlockedQuery.eq('id', scope.ownerId) : unlockedQuery;
  };

  addCountExpectation(
    results,
    'tenant',
    'freigeschaltete Betreiber',
    await countRows(supabase, 'operator_profiles', {
      scope: { owner: false, business: false },
      filter: operatorFilter
    })
  );
  addCountExpectation(results, 'tenant', 'Businesses', await countRows(supabase, 'businesses'));
  addCountExpectation(results, 'tenant', 'Templates', await countRows(supabase, 'card_templates'));
  addCountExpectation(results, 'tenant', 'Card Instances', await countRows(supabase, 'card_instances'));
}

async function checkApple(results, supabase) {
  addCountExpectation(
    results,
    'apple',
    'Apple Pass-Versionen',
    await countRows(supabase, 'apple_pass_versions')
  );
  addCountExpectation(
    results,
    'apple',
    'Apple Device Registrierungen',
    await countRows(supabase, 'apple_wallet_registrations')
  );
  addCountExpectation(
    results,
    'apple',
    'Apple Update-Versionen',
    await countRows(supabase, 'apple_pass_versions', {
      filter: (query) => query.gt('version', 1)
    })
  );
  addCountExpectation(
    results,
    'apple',
    'Apple Wallet Logs',
    await countRows(supabase, 'wallet_push_logs', {
      filter: (query) => query.eq('wallet_platform', 'apple').in('action', appleLogActions)
    })
  );

  const latestVersions = await selectRows(
    supabase,
    'apple_pass_versions',
    'pass_json,version,last_updated_at',
    { maxRows: 50 }
  );

  if (!latestVersions.ok) {
    add(results, 'apple', 'fail', 'Apple Pass-Payload-Felder', latestVersions.error.message);
    return;
  }

  const readyPasses = latestVersions.rows.filter((row) => publicPassLooksReady(row.pass_json));
  add(
    results,
    'apple',
    readyPasses.length > 0 ? 'ok' : 'fail',
    'Apple Pass-Payload-Felder',
    readyPasses.length > 0
      ? `${readyPasses.length} Pass-Versionen mit webServiceURL, authenticationToken und Barcode`
      : 'keine Pass-Version mit webServiceURL, authenticationToken und Barcode gefunden'
  );
}

async function checkGoogle(results, supabase) {
  addCountExpectation(
    results,
    'google',
    'Google Wallet Objects',
    await countRows(supabase, 'google_wallet_objects')
  );
  addCountExpectation(
    results,
    'google',
    'Google Save-Links',
    await countRows(supabase, 'google_wallet_objects', {
      filter: (query) => query.not('save_url', 'is', null)
    })
  );
  addCountExpectation(
    results,
    'google',
    'Google Wallet Logs',
    await countRows(supabase, 'wallet_push_logs', {
      filter: (query) => query.eq('wallet_platform', 'google').in('action', googleLogActions)
    })
  );
  addCountExpectation(
    results,
    'google',
    'Google TEXT_AND_NOTIFY oder Fallback',
    await countRows(supabase, 'wallet_push_logs', {
      filter: (query) => query
        .eq('wallet_platform', 'google')
        .in('action', ['google_text_and_notify', 'google_object_message_fallback', 'google_location_object_update', 'google_nearby_location_update'])
    })
  );
}

async function checkCampaigns(results, supabase) {
  addCountExpectation(
    results,
    'campaigns',
    'Wallet Kampagnen',
    await countRows(supabase, 'wallet_notification_campaigns')
  );
  addCountExpectation(
    results,
    'campaigns',
    'Wallet Empfänger',
    await countRows(supabase, 'wallet_notification_recipients')
  );
  addCountExpectation(
    results,
    'campaigns',
    'Versandstatus sent/prepared/limited/failed/skipped',
    await countRows(supabase, 'wallet_notification_recipients', {
      filter: (query) => query.in('status', ['sent', 'prepared', 'limited', 'failed', 'skipped'])
    })
  );
}

async function checkQueueAndPayment(results, supabase) {
  addCountExpectation(
    results,
    'queue',
    'Wallet Update Queue Jobs',
    await countRows(supabase, 'wallet_update_queue')
  );
  addCountExpectation(
    results,
    'queue',
    'Verarbeitete Queue Jobs',
    await countRows(supabase, 'wallet_update_queue', {
      filter: (query) => query.in('status', ['sent', 'failed', 'cancelled'])
    }),
    false
  );
  add(
    results,
    'queue',
    'warn',
    'Cron Jobs',
    'cron.job liegt nicht im public REST Schema; prüfe zusätzlich supabase/acceptance-queries.sql im SQL Editor'
  );
  addCountExpectation(
    results,
    'payment',
    'Topup Sessions',
    await countRows(supabase, 'topup_payment_sessions'),
    false
  );
  addCountExpectation(
    results,
    'payment',
    'Balance Transactions',
    await countRows(supabase, 'balance_transactions'),
    false
  );
}

function countContextMismatches(cardMap, rows, expected = {}) {
  let mismatches = 0;
  let missingCards = 0;

  for (const row of rows) {
    const card = cardMap.get(row.card_instance_id);

    if (!card) {
      missingCards += 1;
      continue;
    }

    if (row.owner_id !== card.owner_id || row.business_id !== card.business_id) {
      mismatches += 1;
      continue;
    }

    if (expected.template && row.template_id !== card.template_id) {
      mismatches += 1;
      continue;
    }

    if (expected.platform && row.wallet_platform !== card.wallet_platform) {
      mismatches += 1;
    }
  }

  return { mismatches, missingCards };
}

async function checkBusinessIsolation(results, supabase) {
  const cards = await selectRows(
    supabase,
    'card_instances',
    'id,owner_id,business_id,template_id,wallet_platform',
    { maxRows: 10000 }
  );

  if (!cards.ok) {
    add(results, 'isolation', 'fail', 'Card Context Basis', cards.error.message);
    return;
  }

  const cardMap = new Map(cards.rows.map((card) => [card.id, card]));
  const datasets = [
    ['wallet_notification_recipients', 'owner_id,business_id,card_instance_id,wallet_platform', { platform: true }],
    ['apple_wallet_registrations', 'owner_id,business_id,template_id,card_instance_id', { template: true }],
    ['google_wallet_objects', 'owner_id,business_id,template_id,card_instance_id', { template: true }],
    ['wallet_update_queue', 'owner_id,business_id,card_instance_id,wallet_platform', { platform: true }]
  ];

  let totalMismatches = 0;
  let totalMissingCards = 0;

  for (const [table, select, expected] of datasets) {
    const rows = await selectRows(supabase, table, select, { maxRows: 10000 });

    if (!rows.ok) {
      add(results, 'isolation', 'fail', `${table} Kontext`, rows.error.message);
      return;
    }

    const { mismatches, missingCards } = countContextMismatches(cardMap, rows.rows, expected);
    totalMismatches += mismatches;
    totalMissingCards += missingCards;

    add(
      results,
      'isolation',
      mismatches === 0 && missingCards === 0 ? 'ok' : 'fail',
      `${table} Kontext`,
      `${mismatches} Mismatches, ${missingCards} fehlende Kartenreferenzen`
    );
  }

  add(
    results,
    'isolation',
    totalMismatches === 0 && totalMissingCards === 0 ? 'ok' : 'fail',
    'Business-Isolation Gesamt',
    `${totalMismatches} Mismatches, ${totalMissingCards} fehlende Kartenreferenzen`
  );
}

function printHuman(results) {
  console.log('Wallet External Acceptance Audit');
  console.log('Secrets, Token, Save-JWTs, Zertifikate und Push-Token werden nicht ausgegeben.');

  if (scope.ownerId || scope.businessId) {
    console.log(`Scope: owner=${scope.ownerId || '*'} business=${scope.businessId || '*'}`);
  }

  for (const result of results) {
    const label = result.status.toUpperCase().padEnd(4, ' ');
    const detail = result.detail ? ` - ${result.detail}` : '';
    console.log(`${label} ${result.group}/${result.label}${detail}`);
  }

  const summary = summarize(results);
  console.log(`Summary: ok=${summary.ok} warn=${summary.warn} fail=${summary.fail}`);
}

async function main() {
  const results = [];
  const config = loadConfig();
  const supabase = createSupabaseAdmin(config);

  if (!supabase) {
    add(
      results,
      'config',
      'fail',
      'Supabase Service Role',
      'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen lokal in config.json oder Umgebung gesetzt sein'
    );
  } else {
    await checkSchema(results, supabase);
    await checkTenantBase(results, supabase);
    await checkApple(results, supabase);
    await checkGoogle(results, supabase);
    await checkCampaigns(results, supabase);
    await checkQueueAndPayment(results, supabase);
    await checkBusinessIsolation(results, supabase);
  }

  const summary = summarize(results);

  if (jsonOutput) {
    console.log(JSON.stringify({
      ok: summary.fail === 0,
      scope,
      summary,
      results
    }, null, 2));
  } else {
    printHuman(results);
  }

  if (strict && summary.fail > 0) {
    process.exitCode = 1;
  }
}

await main();
