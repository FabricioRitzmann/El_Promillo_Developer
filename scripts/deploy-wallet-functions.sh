#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FUNCTIONS=(
  claim-card
  guest-crm
  get-public-template
  get-wallet-message
  claim-apple-pass
  register-operator
  send-operator-verification-email
  create-topup-payment-session
  confirm-topup-payment
  redeem-balance
  apple-wallet-webservice
  issue-apple-pass
  update-apple-pass
  send-apple-wallet-update
  google-wallet-save-link
  issue-google-wallet-pass
  update-google-wallet-pass
  send-google-wallet-message
  generate-card-pdf
  create-wallet-notification-campaign
  send-wallet-notification
  resolve-wallet-notification-recipients
  check-wallet-notification-limits
  manage-wallet-notification-rule
  process-wallet-notification-rules
  process-scheduled-wallet-notifications
  process-wallet-update-queue
  scanner-actions
  get-business-scan-statistics
)

DRY_RUN=false
WITH_READINESS=false
SKIP_AUTH_CHECK=false
ONLY=""
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
SUPABASE_CLI_BIN="${SUPABASE_CLI_BIN:-}"
SUPABASE_CLI_SOURCE=""
SUPABASE_CLI_COMMAND=()

usage() {
  cat <<'USAGE'
Deploy all Wallet Edge Functions.

Usage:
  bash scripts/deploy-wallet-functions.sh --dry-run
  bash scripts/deploy-wallet-functions.sh
  bash scripts/deploy-wallet-functions.sh --project-ref <PROJECT_REF>
  SUPABASE_PROJECT_REF=<PROJECT_REF> bash scripts/deploy-wallet-functions.sh
  SUPABASE_CLI_BIN=/path/to/supabase bash scripts/deploy-wallet-functions.sh
  bash scripts/deploy-wallet-functions.sh --only claim-card,claim-apple-pass

Options:
  --dry-run              Print deploy commands without running Supabase CLI.
  --project-ref <ref>    Pass --project-ref to Supabase CLI.
  --only <a,b,c>         Deploy only the comma-separated functions.
  --with-readiness       Run wallet-readiness-report.js --strict before deploy.
  --skip-auth-check      Skip the Supabase CLI auth preflight before deploy.
  -h, --help             Show this help.

Notes:
  - Secrets are not printed or set by this script.
  - If --project-ref and SUPABASE_PROJECT_REF are omitted, the script derives the project ref from config.json -> supabase.url when possible.
  - If no global supabase command exists, the script falls back to pnpm dlx supabase or npx --yes supabase.
  - Set SUPABASE_CLI_BIN to a specific Supabase CLI executable when needed.
  - For real deploys, run supabase login first or set SUPABASE_ACCESS_TOKEN.
  - supabase/config.toml must be present so public/Cron/Apple functions keep the intended verify_jwt policy.
  - The _shared folder is bundled by Supabase CLI and is not deployed as a function.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --project-ref)
      PROJECT_REF="${2:-}"
      if [[ -z "$PROJECT_REF" ]]; then
        echo "Fehler: --project-ref braucht einen Wert." >&2
        exit 1
      fi
      shift 2
      ;;
    --only)
      ONLY="${2:-}"
      if [[ -z "$ONLY" ]]; then
        echo "Fehler: --only braucht eine kommagetrennte Function-Liste." >&2
        exit 1
      fi
      shift 2
      ;;
    --with-readiness)
      WITH_READINESS=true
      shift
      ;;
    --skip-auth-check)
      SKIP_AUTH_CHECK=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unbekannte Option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

command_string() {
  printf '%q ' "$@"
  printf '\n'
}

run_command() {
  if [[ "$DRY_RUN" == true ]]; then
    command_string "$@"
    return 0
  fi

  "$@"
}

resolve_supabase_cli() {
  if [[ -n "$SUPABASE_CLI_BIN" ]]; then
    SUPABASE_CLI_COMMAND=("$SUPABASE_CLI_BIN")
    SUPABASE_CLI_SOURCE="SUPABASE_CLI_BIN"
    return 0
  fi

  if command -v supabase >/dev/null 2>&1; then
    SUPABASE_CLI_COMMAND=(supabase)
    SUPABASE_CLI_SOURCE="global supabase"
    return 0
  fi

  if command -v pnpm >/dev/null 2>&1; then
    SUPABASE_CLI_COMMAND=(pnpm dlx supabase)
    SUPABASE_CLI_SOURCE="pnpm dlx supabase"
    return 0
  fi

  if command -v npx >/dev/null 2>&1; then
    SUPABASE_CLI_COMMAND=(npx --yes supabase)
    SUPABASE_CLI_SOURCE="npx --yes supabase"
    return 0
  fi

  return 1
}

check_supabase_auth() {
  local auth_output=""

  if auth_output="$("${SUPABASE_CLI_COMMAND[@]}" projects list >/dev/null 2>&1)"; then
    return 0
  fi

  echo "Fehler: Supabase CLI ist nicht authentifiziert oder darf keine Projekte lesen." >&2
  echo "Führe zuerst aus: supabase login" >&2
  echo "Oder setze für CI/Terminal: export SUPABASE_ACCESS_TOKEN=<dein-token>" >&2
  echo "Danach erneut starten: bash scripts/deploy-wallet-functions.sh" >&2
  echo "Wenn du bewusst ohne Preflight deployen willst: bash scripts/deploy-wallet-functions.sh --skip-auth-check" >&2
  return 1
}

contains_function() {
  local needle="$1"
  local item
  for item in "${FUNCTIONS[@]}"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

derive_project_ref_from_config() {
  node --input-type=module <<'NODE'
import { loadConfig, looksConfigured } from './server/config.js';

try {
  const config = loadConfig();
  const supabaseUrl = String(config.supabase?.url || '').trim();

  if (!looksConfigured(supabaseUrl)) {
    process.exit(0);
  }

  const host = new URL(supabaseUrl).host;
  const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);

  if (match) {
    console.log(match[1]);
  }
} catch {
  process.exit(0);
}
NODE
}

if [[ ! -f "supabase/config.toml" ]]; then
  echo "Fehler: supabase/config.toml fehlt. Deploy abgebrochen." >&2
  exit 1
fi

if [[ -z "$PROJECT_REF" ]]; then
  PROJECT_REF="$(derive_project_ref_from_config || true)"
fi

SELECTED_FUNCTIONS=("${FUNCTIONS[@]}")

if [[ -n "$ONLY" ]]; then
  IFS=',' read -r -a SELECTED_FUNCTIONS <<< "$ONLY"
  for function_name in "${SELECTED_FUNCTIONS[@]}"; do
    if ! contains_function "$function_name"; then
      echo "Fehler: unbekannte oder nicht deploybare Function: $function_name" >&2
      exit 1
    fi
  done
fi

for function_name in "${SELECTED_FUNCTIONS[@]}"; do
  if [[ ! -f "supabase/functions/$function_name/index.ts" ]]; then
    echo "Fehler: supabase/functions/$function_name/index.ts fehlt." >&2
    exit 1
  fi
done

if ! resolve_supabase_cli; then
  if [[ "$DRY_RUN" == true ]]; then
    SUPABASE_CLI_COMMAND=(supabase)
    SUPABASE_CLI_SOURCE="nicht gefunden; Dry-Run zeigt Standardbefehl"
  else
    echo "Fehler: Supabase CLI nicht gefunden. Installiere/aktiviere Supabase CLI, installiere pnpm/npx, setze SUPABASE_CLI_BIN oder nutze --dry-run." >&2
    exit 1
  fi
fi

if [[ "$DRY_RUN" != true && "$SUPABASE_CLI_SOURCE" == "SUPABASE_CLI_BIN" && ! -x "$SUPABASE_CLI_BIN" ]]; then
  echo "Fehler: SUPABASE_CLI_BIN ist nicht ausführbar: $SUPABASE_CLI_BIN" >&2
  exit 1
fi

if [[ "$WITH_READINESS" == true ]]; then
  run_command node scripts/wallet-readiness-report.js --strict
fi

if [[ "$DRY_RUN" != true && "$SKIP_AUTH_CHECK" != true ]]; then
  echo "Prüfe Supabase CLI Auth..."
  check_supabase_auth
elif [[ "$DRY_RUN" != true && -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Hinweis: SUPABASE_ACCESS_TOKEN ist nicht gesetzt. Die Supabase CLI braucht eine bestehende Login-Session, sonst schlägt der Deploy mit AuthRequired fehl."
fi

echo "Deploye ${#SELECTED_FUNCTIONS[@]} Wallet Edge Functions."
echo "supabase/config.toml wird von der Supabase CLI beim Function-Deploy berücksichtigt."
echo "Supabase CLI: $SUPABASE_CLI_SOURCE"

if [[ -n "$PROJECT_REF" ]]; then
  echo "Supabase Project Ref: $PROJECT_REF"
else
  echo "Supabase Project Ref: nicht gesetzt; Supabase CLI nutzt das lokal gelinkte Projekt, falls vorhanden."
fi

for function_name in "${SELECTED_FUNCTIONS[@]}"; do
  deploy_command=("${SUPABASE_CLI_COMMAND[@]}" functions deploy "$function_name")

  if [[ -n "$PROJECT_REF" ]]; then
    deploy_command+=(--project-ref "$PROJECT_REF")
  fi

  run_command "${deploy_command[@]}"
done

cat <<'NEXT'

Nächste Prüfschritte nach erfolgreichem Deploy:
  node scripts/wallet-readiness-report.js --strict
  node scripts/wallet-smoke-test.js --functions --functions-base-url https://<PROJECT_REF>.supabase.co/functions/v1 --strict
  supabase/acceptance-queries.sql im Supabase SQL Editor nach echten Apple-/Google-/Cron-/Payment-Aktionen ausführen.
NEXT
