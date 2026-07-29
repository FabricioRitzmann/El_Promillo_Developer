import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, needle, message) {
  assert(source.includes(needle), `${message}: ${needle}`);
}

const cronSql = read('supabase/cron.example.sql');
const cronDoc = read('docs/WALLET_CRON_SETUP.md');
const cronHelper = read('scripts/prepare-supabase-cron-sql.js');
const readme = read('README.md');
const context = read('docs/WALLET_INTEGRATION_CONTEXT.md');
const packageJson = read('package.json');

[
  'create extension if not exists pg_cron',
  'create extension if not exists pg_net',
  'YOUR_PROJECT_REF',
  'YOUR_WALLET_CRON_SECRET',
  'process-scheduled-wallet-notifications',
  'process-wallet-update-queue',
  'send-operator-verification-email',
  'x-cron-secret',
  'wallet-process-scheduled-notifications',
  'wallet-process-update-queue',
  'operator-send-verification-email',
  'cron.schedule',
  'net.http_post',
  'cron.unschedule'
].forEach((needle) => assertIncludes(cronSql, needle, 'Cron SQL Vorlage ist unvollständig'));

[
  '# Wallet Cron Setup',
  'Supabase Cron',
  'Externer Cron',
  'WALLET_CRON_SECRET',
  'process-scheduled-wallet-notifications',
  'process-wallet-update-queue',
  'send-operator-verification-email',
  'supabase/cron.example.sql',
  'x-cron-secret',
  'Authorization: Bearer <WALLET_CRON_SECRET>',
  'wallet_update_queue',
  'wallet_push_logs'
].forEach((needle) => assertIncludes(cronDoc, needle, 'Cron Setup Doku ist unvollständig'));

[
  'prepare-supabase-cron-sql.js',
  'tmp/supabase-cron.sql',
  'WALLET_CRON_SECRET',
  'supabase/secrets.local.env',
  'secretsPrinted: false'
].forEach((needle) => assertIncludes(cronHelper, needle, 'Cron Helper ist unvollständig'));

assertIncludes(readme, 'docs/WALLET_CRON_SETUP.md', 'README muss auf die Cron-Doku verweisen');
assertIncludes(readme, 'supabase/cron.example.sql', 'README muss die Cron-SQL-Vorlage nennen');
assertIncludes(readme, 'prepare-supabase-cron-sql.js', 'README muss den Cron-SQL-Helper nennen');
assertIncludes(context, 'docs/WALLET_CRON_SETUP.md', 'Wallet-Kontext muss auf die Cron-Doku verweisen');
assertIncludes(context, 'prepare-supabase-cron-sql.js', 'Wallet-Kontext muss den Cron-SQL-Helper nennen');
assertIncludes(packageJson, 'verify-wallet-cron-setup.js', 'pnpm check muss die Cron-Vorbereitung prüfen');

console.log('Wallet Cron Setup ist mit SQL-Vorlage, Doku und Checks vorbereitet.');
