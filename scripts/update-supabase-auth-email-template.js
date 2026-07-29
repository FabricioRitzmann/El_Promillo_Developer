#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const defaultProjectRefPath = path.join(rootDir, 'supabase/.temp/project-ref');
const defaultTemplatePath = path.join(rootDir, 'supabase/templates/operator-magic-link.html');

const args = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  SUPABASE_ACCESS_TOKEN=<token> node scripts/update-supabase-auth-email-template.js
  node scripts/update-supabase-auth-email-template.js --dry-run

Options:
  --dry-run                 Show the planned Auth config patch without calling Supabase.
  --project-ref <ref>       Supabase project ref. Defaults to SUPABASE_PROJECT_REF or supabase/.temp/project-ref.
  --template <path>         HTML template path. Default: supabase/templates/operator-magic-link.html.
  --subject <text>          Magic Link subject.
  --site-url <url>          Auth Site URL. Default: AUTH_SITE_URL, APP_PUBLIC_BASE_URL, then https://el-promillo.ch.
  --redirect-url <url>      Add an allowed redirect URL. Can be repeated.
  --no-merge-redirects      Replace redirect allow list instead of merging existing values.
  --routing-only            Only update Site URL, redirects and verification login rules.
  --unlock-only             Temporary mode: unlock=true is enough; unverified email sign-ins are allowed.
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    projectRef: process.env.SUPABASE_PROJECT_REF || '',
    templatePath: defaultTemplatePath,
    subject: 'Dein El Promillo Zugang ist freigeschaltet',
    siteUrl: process.env.AUTH_SITE_URL || process.env.APP_PUBLIC_BASE_URL || 'https://el-promillo.ch',
    redirects: [],
    mergeRedirects: true,
    routingOnly: false,
    unlockOnly: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--project-ref') {
      options.projectRef = String(argv[++index] || '').trim();
    } else if (arg === '--template') {
      options.templatePath = path.resolve(rootDir, String(argv[++index] || ''));
    } else if (arg === '--subject') {
      options.subject = String(argv[++index] || '').trim();
    } else if (arg === '--site-url') {
      options.siteUrl = String(argv[++index] || '').trim();
    } else if (arg === '--redirect-url') {
      const value = String(argv[++index] || '').trim();
      if (value) {
        options.redirects.push(value);
      }
    } else if (arg === '--no-merge-redirects') {
      options.mergeRedirects = false;
    } else if (arg === '--routing-only') {
      options.routingOnly = true;
    } else if (arg === '--unlock-only') {
      options.routingOnly = true;
      options.unlockOnly = true;
    } else if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unbekannte Option: ${arg}`);
    }
  }

  return options;
}

async function readProjectRef(fallback) {
  if (fallback) {
    return fallback;
  }

  try {
    return (await readFile(defaultProjectRefPath, 'utf8')).trim();
  } catch {
    return '';
  }
}

function normalizeSiteUrl(value) {
  const siteUrl = String(value || '').trim().replace(/\/+$/, '');

  if (!/^https?:\/\//i.test(siteUrl)) {
    throw new Error('site-url muss mit http:// oder https:// beginnen.');
  }

  return siteUrl;
}

function defaultRedirectsFor(siteUrl) {
  const origin = normalizeSiteUrl(siteUrl);
  const redirects = [
    `${origin}/dashboard.html`,
    `${origin}/**`,
    'https://www.el-promillo.ch/dashboard.html',
    'https://www.el-promillo.ch/**',
    'https://fabricioritzmann.github.io/El_Promillo/dashboard.html',
    'https://fabricioritzmann.github.io/El_Promillo/**',
    'https://fabricioritzmann.github.io/El_Promillo_Developer/dashboard.html',
    'https://fabricioritzmann.github.io/El_Promillo_Developer/**',
    'http://localhost:3000/dashboard.html',
    'http://localhost:3000/**',
    'http://127.0.0.1:3000/dashboard.html',
    'http://127.0.0.1:3000/**'
  ];

  return redirects;
}

function parseAllowList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function managementAuthUrl(projectRef) {
  return `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`;
}

async function fetchAuthConfig(projectRef, accessToken) {
  const response = await fetch(managementAuthUrl(projectRef), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase Auth Config konnte nicht gelesen werden (${response.status}). ${body}`);
  }

  return response.json();
}

async function patchAuthConfig(projectRef, accessToken, patch) {
  const response = await fetch(managementAuthUrl(projectRef), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(patch)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase Auth Config konnte nicht aktualisiert werden (${response.status}). ${body}`);
  }

  return response.json().catch(() => ({}));
}

function redactPatch(patch) {
  return {
    site_url: patch.site_url,
    uri_allow_list_count: parseAllowList(patch.uri_allow_list).length,
    mailer_subjects_magic_link: patch.mailer_subjects_magic_link || '(nicht geaendert)',
    mailer_templates_magic_link_content_length: patch.mailer_templates_magic_link_content
      ? patch.mailer_templates_magic_link_content.length
      : 0,
    mailer_autoconfirm: patch.mailer_autoconfirm,
    mailer_allow_unverified_email_sign_ins: patch.mailer_allow_unverified_email_sign_ins
  };
}

async function main() {
  const options = parseArgs(args);
  const projectRef = await readProjectRef(options.projectRef);
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN || '';
  const siteUrl = normalizeSiteUrl(options.siteUrl);
  const templateContent = await readFile(options.templatePath, 'utf8');
  const requestedRedirects = unique([
    ...defaultRedirectsFor(siteUrl),
    ...options.redirects
  ]);

  if (!projectRef) {
    throw new Error('Supabase Project Ref fehlt. Nutze --project-ref oder SUPABASE_PROJECT_REF.');
  }

  if (!options.subject) {
    throw new Error('Magic-Link-Betreff fehlt.');
  }

  let mergedRedirects = requestedRedirects;

  if (!options.dryRun && options.mergeRedirects) {
    if (!accessToken) {
      throw new Error('SUPABASE_ACCESS_TOKEN fehlt.');
    }

    const current = await fetchAuthConfig(projectRef, accessToken);
    mergedRedirects = unique([
      ...parseAllowList(current.uri_allow_list),
      ...requestedRedirects
    ]);
  }

  const patch = {
    site_url: siteUrl,
    uri_allow_list: mergedRedirects.join(','),
    mailer_autoconfirm: false,
    mailer_allow_unverified_email_sign_ins: options.unlockOnly
  };

  if (!options.routingOnly) {
    patch.mailer_subjects_magic_link = options.subject;
    patch.mailer_templates_magic_link_content = templateContent;
  }

  console.log('Supabase Auth Template Patch vorbereitet:');
  console.log(JSON.stringify(redactPatch(patch), null, 2));

  if (options.dryRun) {
    console.log('Dry-Run: Es wurde nichts an Supabase gesendet.');
    return;
  }

  if (!accessToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN fehlt.');
  }

  await patchAuthConfig(projectRef, accessToken, patch);
  if (options.unlockOnly) {
    console.log('Supabase Auth Unlock-only-Zwischenmodus wurde aktualisiert.');
  } else if (options.routingOnly) {
    console.log('Supabase Auth Routing- und Verifizierungsregeln wurden aktualisiert.');
  } else {
    console.log('Supabase Auth Magic-Link-Template und Redirect-Einstellungen wurden aktualisiert.');
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
