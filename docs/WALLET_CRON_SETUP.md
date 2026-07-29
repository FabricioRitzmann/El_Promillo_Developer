# Wallet Cron Setup

Stand: 2026-07-29

Geplante Wallet-Benachrichtigungen, vorbereitete Kartenupdates und Betreiber-Verifizierungs-Mails laufen im MVP nicht automatisch im Browser. Sie werden serverseitig durch drei Supabase Edge Functions verarbeitet:

- `process-scheduled-wallet-notifications`
- `process-wallet-update-queue`
- `send-operator-verification-email`

## Variante A: Supabase Cron

1. Edge Functions deployen:

```bash
supabase functions deploy process-scheduled-wallet-notifications
supabase functions deploy process-wallet-update-queue
supabase functions deploy send-operator-verification-email
```

2. Cron Secret setzen:

```bash
supabase secrets set WALLET_CRON_SECRET="$(openssl rand -hex 32)"
```

3. Cron-SQL aus der Vorlage vorbereiten:

```bash
node scripts/prepare-supabase-cron-sql.js
node scripts/prepare-supabase-cron-sql.js --write --force
```

Das Script liest die Project Ref aus `config.json -> supabase.url`, `SUPABASE_PROJECT_REF` oder `--project-ref <PROJECT_REF>`. Den Wert von `WALLET_CRON_SECRET` liest es aus der Umgebung, aus `supabase/secrets.local.env` oder aus `config.automation.walletCronSecret`. Es schreibt die echte Cron-SQL nach `tmp/supabase-cron.sql`, gibt den Secret-Wert nicht aus und druckt auch keine SQL-Inhalte.

4. Die generierte Cron-SQL anwenden:

```bash
bash scripts/apply-supabase-schema.sh --file tmp/supabase-cron.sql --dry-run
bash scripts/apply-supabase-schema.sh --file tmp/supabase-cron.sql
```

Alternativ kannst du weiterhin in `supabase/cron.example.sql` diese Platzhalter manuell ersetzen:

- `YOUR_PROJECT_REF`
- `YOUR_WALLET_CRON_SECRET`

Danach die bearbeitete SQL-Datei im Supabase SQL Editor ausführen.

Die Vorlage aktiviert `pg_cron` und `pg_net`, entfernt vorhandene gleichnamige Jobs und legt drei Jobs an:

- `wallet-process-scheduled-notifications`: jede Minute
- `wallet-process-update-queue`: alle zwei Minuten
- `operator-send-verification-email`: alle fünf Minuten

Die Requests werden per `POST` an die Edge Functions geschickt und senden `x-cron-secret`. Die Functions akzeptieren alternativ auch `Authorization: Bearer <WALLET_CRON_SECRET>`.

## Variante B: Externer Cron

Ein externer Cron kann dieselben URLs aufrufen:

```bash
curl -X POST \
  -H "x-cron-secret: $WALLET_CRON_SECRET" \
  "https://<PROJECT_REF>.supabase.co/functions/v1/process-scheduled-wallet-notifications"

curl -X POST \
  -H "x-cron-secret: $WALLET_CRON_SECRET" \
  "https://<PROJECT_REF>.supabase.co/functions/v1/process-wallet-update-queue"

curl -X POST \
  -H "x-cron-secret: $WALLET_CRON_SECRET" \
  "https://<PROJECT_REF>.supabase.co/functions/v1/send-operator-verification-email"
```

## Sicherheit

- `WALLET_CRON_SECRET` gehört nur in Supabase Secrets oder in den externen Cron Secret Store.
- Der Wert muss mindestens 32 Zeichen lang sein; empfohlen ist `openssl rand -hex 32`, wie oben gezeigt.
- Der Wert darf nicht in `config.json`, Frontend-Dateien oder Git landen.
- `supabase/config.toml` setzt `verify_jwt = false` nur für die Cron-/Public-Pfade; die Functions prüfen danach selbst `WALLET_CRON_SECRET`.
- Mit gültigem Cron Secret laufen die Jobs über alle Businesses, setzen intern aber pro Kampagne bzw. Queue-Job wieder `owner_id` und `business_id`.

## Kontrolle

Nach dem Ausführen der SQL-Vorlage:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname in (
  'operator-send-verification-email',
  'wallet-process-scheduled-notifications',
  'wallet-process-update-queue'
)
order by jobname;
```

In der App bzw. Datenbank prüfen:

- Fällige Kampagnen wechseln von `scheduled` zu `sent`, `partially_failed` oder `failed`.
- `wallet_notification_recipients` erhalten Providerstatus.
- `wallet_push_logs` enthält Versand-, Fallback- oder Fehlerlogs.
- `wallet_update_queue` Jobs wechseln von `pending` zu `sent` oder `failed`.
- Freigegebene Betreiberprofile wechseln bei erfolgreichem Mailversand von `verification_email_status = 'pending'` zu `sent`.
