# El_Promillo

Ein schlankes, lokal startbares MVP für eine mandantenfähige digitale Wallet-Karten-Plattform. Betreiber von Cafes, Bars, Restaurants oder kleinen Shops können sich registrieren, nach manueller Freischaltung Karten-Templates erstellen, QR-Codes für Claim-Seiten anzeigen und Kundenkarten scannen bzw. bearbeiten.

## Enthaltene Funktionen

- Supabase Auth für Registrierung und Login
- Betreiberprofil mit `unlock = false` als Standard
- Warteseite für nicht freigeschaltete Betreiber
- Dashboard nur für Betreiber mit `unlock = true`
- Mandantenfähige Datenstruktur mit Row Level Security
- Geschäftsprofil pro Betreiber
- Separate Karten-Editor-Seite mit Live-Vorschau für generische Basiskarte, Stempelkarte, Streak-Karte, Eventkarte und Clubkarte
- VIP, Guthaben, Garderobe, Coupon und Mitgliedschaft werden im Editor als optionale Clubkarten-Module aktiviert und nicht mehr als eigene Neuanlage-Typen angeboten
- Zentrale Template-Feature-Matrix für `stamp_card`, `streak_card`, `vip_card`, `balance_card`, `cloakroom_card`, `generic_card`, `event_card`, `coupon_card`, `membership_card` und `club_card`
- Lesbare Matrix-Dokumentation unter [docs/TEMPLATE_FEATURE_MATRIX.md](docs/TEMPLATE_FEATURE_MATRIX.md), automatisch aus dem Code erzeugt
- Aktiver Goal-Kontext für Frontend, Tabellen, Apple/Google-Daten, Public URLs, Design und Versandregeln unter [docs/WALLET_ACTIVE_GOAL_CONTEXT.md](docs/WALLET_ACTIVE_GOAL_CONTEXT.md)
- Ausführlicher Integrationskontext unter [docs/WALLET_INTEGRATION_CONTEXT.md](docs/WALLET_INTEGRATION_CONTEXT.md)
- Render Deployment Guide unter [docs/RENDER_DEPLOYMENT.md](docs/RENDER_DEPLOYMENT.md)
- Render ist das Kunden-Frontend: Mobiltelefone werden dort nach Login automatisch auf Scanner plus reduziertes Konto mit Firmenname und Logout begrenzt, Desktop und Tablets sehen die volle Webapp; GitHub Pages bleibt unverändert
- Externe Apple-/Google-Credential-Anleitung `Wallet External Credentials` unter [docs/WALLET_EXTERNAL_CREDENTIALS.md](docs/WALLET_EXTERNAL_CREDENTIALS.md)
- Abschluss- und Extern-Test-Audit unter [docs/WALLET_GOAL_COMPLETION_AUDIT.md](docs/WALLET_GOAL_COMPLETION_AUDIT.md)
- Umsetzungsplan mit Analyse, Dateirollen, SQL-Migrationsplan, Edge-Function-Plan und Secret-Checkliste unter [docs/WALLET_IMPLEMENTATION_PLAN.md](docs/WALLET_IMPLEMENTATION_PLAN.md)
- Cron-Setup für geplante Kampagnen und Wallet-Update-Queue unter [docs/WALLET_CRON_SETUP.md](docs/WALLET_CRON_SETUP.md), inklusive [supabase/cron.example.sql](supabase/cron.example.sql)
- Produktive Apple-/Google-/Cron-/Payment-Abnahme unter [docs/WALLET_EXTERNAL_ACCEPTANCE.md](docs/WALLET_EXTERNAL_ACCEPTANCE.md)
- Read-only Supabase-Abnahmequeries unter [supabase/acceptance-queries.sql](supabase/acceptance-queries.sql)
- Supabase-Secrets-Vorlage unter [supabase/secrets.example.env](supabase/secrets.example.env) für Apple, Google, Samsung, Public URLs, Cron, Payment und Versandlimits
- Manueller Smoke-Test für lokale oder produktive URLs über `node scripts/wallet-smoke-test.js`
- Matrix wird in Editor, Dashboard, Wallet-Vorschau, direkten Wallet-Benachrichtigungen, Scanner-Aktionen, Server-API und SQL-Validierung verwendet
- Wallet-Vorschau, Claim-Seite, QR-PDF und Wallet-Felder nutzen gemeinsame matrixbasierte Feature-Zeilen, damit unpassende Felder nicht sichtbar werden
- Supabase Edge Functions haben einen gemeinsamen Matrix-Helper unter `supabase/functions/_shared/templateFeatures.ts`
- Mehrere Templates pro Betreiber, jedes Template mit eigenem Claim-Link und QR-Code
- Kartenübersicht als Tabelle; Klick auf eine Karte lädt sie in den Editor
- Dashboard-Bereich für ausgestellte Kundenkarten mit aktuellem Status, Karten-ID, Guthaben und matrixbasiertem Fortschritt
- Supabase Storage Uploads für Karten-Icon, Stempel-Icon und Streak-Icon
- Eventkarten haben matrixgesteuerte Wallet-Bilder mit getrennten Uploads für Apple `background.png` und Google `heroImage`, inklusive Live-Vorschau und Legacy-Fallback für alte Eventbild-Settings
- Push-Vorbereitung und Freifelder sind als matrixgesteuerte Editor-Bereiche abgebildet; Freifelder erscheinen nur bei Templates mit `customFields = true`
- QR-Code pro Template für `/claim.html?token=<public_claim_token>`; alte `/claim.html?template=<template_id>` Links bleiben als Fallback gültig
- PDF-Download pro Template als A4/A5 über `GET /api/templates/:templateId/qr.pdf?format=a4|a5`
- Öffentliche Claim-Seite ohne Kundenaccount
- Claim-Seite mit Hauptbutton `Zu Wallet hinzufügen` plus Apple-Wallet-, Google-Wallet- und Samsung-Wallet-Button für manuelle Auswahl
- Geräte-Erkennung auf der Claim-Seite: iPhone/iPad öffnet über den Hauptbutton Apple Wallet, Samsung Android Samsung Wallet, andere Android-Geräte Google Wallet; alle drei Wallet-Buttons bleiben manuell verfügbar
- Google-Wallet-Button kann über Edge Function einen signierten Save-Link erzeugen, sobald Google-Wallet-Secrets gesetzt sind
- Samsung-Wallet-Button erzeugt über `samsung-wallet-add-link` einen Data-Fetch-Add-Link, ohne Samsung-Keys oder Zertifikate an den Browser auszugeben
- Serverseitiges Anlegen individueller Kundenkarten mit eindeutiger `card_instance_number`
- Die Claim-Seite speichert pro Template und Wallet-Plattform eine stabile Browser-Wallet-ID, damit ein erneuter Claim dieselbe Kundenkarte wiederfindet statt eine zweite Karte zu erzeugen
- Bei Karten mit erlaubter Guthabenfunktion zeigt die Claim-Seite eine Aufladebox und erstellt Topup-Sessions über die Edge Function `create-topup-payment-session`
- Mindest- und Maximalbetrag für Aufladungen werden im Editor lesbar als Betrag gepflegt und zusätzlich als Cent-Werte für Edge Functions gespeichert
- Betreiber sehen im Dashboard pro ausgegebener Kundenkarte, auf welcher Karte wie viel Guthaben und welcher Fortschritt vorhanden ist
- Scanner-/Bearbeitungsseite mit Kamera-Scan per nativer `BarcodeDetector`-API, mobilem `jsQR`-Fallback und manueller Eingabe
- Scanner zeigt nur zur Matrix passende Aktionen und blockiert unpassende Aktionen mit sichtbarer Fehlermeldung
- Scanner-Aktionen laufen im Frontend zuerst über die Supabase Edge Function `scanner-actions`; der lokale Node-Endpunkt ist nur Fallback für lokale Entwicklung
- Beim ersten Scan einer Kundenkarte fragt der Scanner Geschlecht und Altersgruppe für anonymisierte Besucherstatistik ab; danach bleibt diese Erfassung pro Karteninstanz gespeichert
- Karteninstanzen haben ein automatisch aufgelöstes Wallet-Emblem: vor dem Erstscan neutral mit Mann+Frau, nach dem Erstscan männlich oder weiblich passend zur erfassten Demografie
- Standard-Embleme liegen im öffentlichen Supabase Storage Bucket `wallet-emblems` unter `default/neutral-couple.png`, `default/male-gentleman.png` und `default/female-lady.png`
- Scanner, Wallet-Vorschau, Apple-Wallet-Assets und Google-Wallet-Objekte nutzen das aufgelöste Emblem; das zentrale Firmenlogo bleibt weiterhin Business-Logo
- Das Dashboard enthält eine Besucherstatistik mit Filtern nach Zeitraum, Kartentyp, Clubfunktion, Geschlecht, Altersgruppe, Erst-/Wiederholungsscan, Aktion und Uhrzeit
- Die Scanner-Ansicht lädt aktuelle Apple-Wallet-Dateien über `issue-apple-pass` und nutzt keinen lokalen PassKit-Download-Fallback mehr
- Scanner-Aktions-Aliase wie `add_stamp`, `increment_streak` oder `redeem_balance` werden zentral normalisiert und danach matrixbasiert validiert
- Stempelkarten können im Scanner erst als eingelöst markiert werden, wenn der Stempelstand das definierte Ziel erreicht hat
- Streakkarten können im Scanner erst als erfüllt markiert werden, wenn das definierte Streak-Ziel erreicht ist
- VIP-Karten können im Scanner VIP-Vorteile matrixbasiert einlösen und protokollieren
- Mitgliedskarten können im Scanner geprüft, im Status geändert und verlängert werden
- Scanner, Dashboard und Editor bleiben über die normale Webnavigation erreichbar; der Scanner ist eine eigene Arbeitsansicht für Kamera-Scan und manuelle Eingabe
- Optionale Zusatzfeatures zeigen im Editor zuerst nur den Aktivieren-Schalter, Detailfelder erst nach Aktivierung
- Guthaben- und Garderobenstatus sind für passende Kartentypen vorbereitet; Guthaben-Abbuchungen und manuelle Korrekturen werden validiert und protokolliert
- Direkter Apple-Wallet-Edge-Pfad ohne `passkit-generator`: Pass JSON, Manifest, PKCS#7-Signatur und `.pkpass`-ZIP werden serverseitig vorbereitet
- Apple-Wallet-Webservice-Registrierungen werden in Supabase gespeichert, damit aktualisierte Karten erneut als signierte `.pkpass` ausgeliefert werden können
- Apple-Passes erhalten serverseitig immer ein gespeichertes `pass_authentication_token`; alte Apple-Karten werden beim Schema-Lauf und beim nächsten Pass-Issue/-Update automatisch nachgerüstet
- Neuer Editor-Bereich `Wallet Benachrichtigungen` mit Template-Auswahl, matrixbasierten Zielgruppen, Apple-/Google-Vorschau, Reichweitenanzeige und Versandhistorie inklusive Provider-Fehlern und Fallback-Hinweisen
- Standardtitel, Standardnachricht und erlaubte Wallet-Zielgruppen können nicht-sensitiv über `config.example.json -> deliveryRules` vorbereitet werden; das Backend validiert weiterhin autoritativ.
- Dynamische Preflight-Warnungen vor dem Versand: Google-24h-Limits, Business-/Kunden-/Kartenlimits und Apple-Karten ohne registriertes Gerät werden über `check-wallet-notification-limits` angezeigt
- Die Reichweitenanzeige im Editor wird nach der lokalen Vorschau mit dem serverseitigen Preflight abgeglichen: `Erreichbar` entspricht den aktuell erlaubten Empfängern, `Nicht erreichbar` enthält nicht push-fähige oder limitierte Karten.
- Direkte Wallet-Benachrichtigungsarchitektur ohne PassKit im neuen Edge-Pfad: `walletNotificationService`, `appleWalletProvider` und `googleWalletProvider`
- Neue Supabase-Tabellen für Kampagnen, Empfänger, Push-Logs, Update-Queue, Apple-Registrierungen, Apple-Pass-Versionen und Google-Wallet-Objects
- Google Wallet Messages werden serverseitig über Wallet REST API vorbereitet, inklusive `TEXT_AND_NOTIFY`-Limitprüfung
- Google Wallet nutzt direkte Object-Typen: `genericObject`, `loyaltyObject`, `offerObject` und für `event_card` `eventTicketObject`
- Apple- und Google-Wallet-Karten zeigen aktuelle Supabase-Werte wie Stempel, Streak, VIP, Guthaben, Garderobe, Coupon/Mitgliedschaft und Belohnungstext direkt als sichtbare Kartenfelder
- Apple Wallet Updates werden serverseitig als Pass-Version plus APNS Pass Update verarbeitet; echte APNS-Zustellung braucht die Apple APNS Secrets und eine öffentliche HTTPS-Webservice-URL
- Optionales Testdaten-SQL unter `supabase/test-data.sql`

## Projektstruktur

```text
public/
  index.html
  wait.html
  dashboard.html
  editor.html
  claim.html
  scanner.html
  styles.css
  js/
    auth.js
    claim.js
    config.js
    dashboard.js
    editor.js
    guards.js
    scanner.js
    supabaseClient.js
    ui.js
server/
  index.js
  config.js
  pdf.js
  supabaseAdmin.js
supabase/
  schema.sql
  test-data.sql
  functions/
    _shared/
      templateFeatures.ts
      walletNotificationService.ts
      appleWalletProvider.ts
      googleWalletProvider.ts
    claim-card/
      index.ts
    claim-apple-pass/
      index.ts
    scanner-actions/
      index.ts
    create-topup-payment-session/
      index.ts
    confirm-topup-payment/
      index.ts
    redeem-balance/
      index.ts
    generate-card-pdf/
      index.ts
    google-wallet-save-link/
      index.ts
    create-wallet-notification-campaign/
      index.ts
    send-wallet-notification/
      index.ts
    resolve-wallet-notification-recipients/
      index.ts
    check-wallet-notification-limits/
      index.ts
    process-scheduled-wallet-notifications/
      index.ts
    process-wallet-update-queue/
      index.ts
    issue-apple-pass/
      index.ts
    apple-wallet-webservice/
      index.ts
    update-apple-pass/
      index.ts
    send-apple-wallet-update/
      index.ts
    issue-google-wallet-pass/
      index.ts
    update-google-wallet-pass/
      index.ts
    send-google-wallet-message/
      index.ts
config.example.json
package.json
docs/
  WALLET_IMPLEMENTATION_PLAN.md
  WALLET_INTEGRATION_CONTEXT.md
  WALLET_GOAL_COMPLETION_AUDIT.md
  TEMPLATE_FEATURE_MATRIX.md
```

## Lokales Setup

1. Dependencies installieren:

```bash
npm install
```

2. Konfiguration anlegen:

```bash
cp config.example.json config.json
```

3. Werte in `config.json` eintragen:

```json
{
  "app": {
    "baseUrl": "http://localhost:3000",
    "apiBaseUrl": "http://localhost:3000"
  },
  "supabase": {
    "url": "https://YOUR_PROJECT_REF.supabase.co",
    "anonKey": "YOUR_SUPABASE_ANON_KEY",
    "serviceRoleKey": "YOUR_SUPABASE_SERVICE_ROLE_KEY_SERVER_ONLY"
  }
}
```

`config.json` ist in `.gitignore` enthalten und darf nicht committet werden. Der `serviceRoleKey` wird nur vom lokalen Server verwendet.

4. Server starten:

```bash
npm start
```

Falls `npm` bei dir nicht gefunden wird, nutze direkt:

```bash
bash scripts/start-local.sh
```

5. App öffnen:

[http://localhost:3000](http://localhost:3000)

## GitHub Pages Veröffentlichung

Das Repository enthält zusätzlich eine statische GitHub-Pages-Veröffentlichung der App. GitHub Pages kann keinen lokalen Node-/Express-Server ausführen; deshalb leitet die Root-Datei `index.html` auf `public/index.html` weiter und die Frontend-Dateien nutzen relative Pfade statt harter `/...`-Links. Die Seite lädt ihre Browser-Konfiguration aus `public/config.public.json`. Diese Datei enthält nur öffentliche Browserwerte wie Supabase URL und Supabase Anon Key, aber keine Service Role, Zertifikate oder privaten Wallet-Secrets.

Für öffentliche Claim-Vorschauen nutzt GitHub Pages die Supabase Edge Function `get-public-template`. Diese Function muss zusammen mit den anderen Wallet-Functions deployed sein:

```bash
bash scripts/deploy-wallet-functions.sh --only get-public-template
```

Danach liefert GitHub Pages die App statt der README aus. Wenn GitHub Pages auf Branch-Root zeigt, öffnet `index.html` automatisch die statische App unter `public/index.html`.

Optionaler Projektcheck:

```bash
pnpm check
```

Dieser Check prüft neben der JavaScript-Syntax auch, dass die Frontend-Matrix in `public/js/templateFeatures.js` und die Edge-Function-Matrix in `supabase/functions/_shared/templateFeatures.ts` identisch bleiben. Das umfasst Template-Features, Scanner-Aktionen und Scanner-Aktions-Aliase. Zusätzlich prüft er, ob alle Pflichtbereiche aus dem Matrix-Konzept angebunden bleiben: Editor, Template Settings, Wallet-Vorschau, Scanner, Server-API, Supabase SQL, Edge Functions, direkter Wallet-Pfad, PDF-Generator und Public Claim Page. Danach prüft er, ob `supabase/schema.sql` in `template_feature_allowed(...)` alle erlaubten Matrix-Features abdeckt, verbotene Template-Typen nicht versehentlich erlaubt und optionale Features wie generische Guthabenfunktion, VIP-Zusatzfunktion und Scanner-Aliase korrekt funktionieren. Der Editor-Check stellt sicher, dass optionale Features eigene Aktivieren-Schalter und getrennte Detailfelder haben. Der Responsive-Check sichert ausserdem die mobilen Breakpoints, einspaltige Wallet-Benachrichtigungen, kompakte Historienzeilen und lange Warntexte ab. Die generierte Dokumentation [docs/TEMPLATE_FEATURE_MATRIX.md](docs/TEMPLATE_FEATURE_MATRIX.md) wird ebenfalls gegen die echte Matrix geprüft.

Der Wallet-Architekturcheck prüft ausserdem, dass der Integrationskontext, die direkten Apple-/Google-Provider, die Benachrichtigungs-Edge-Functions, die Zielgruppenfilter und die Secret-Platzhalter in `config.example.json` vorhanden bleiben. `scripts/verify-wallet-active-goal-context.js` prüft zusätzlich [docs/WALLET_ACTIVE_GOAL_CONTEXT.md](docs/WALLET_ACTIVE_GOAL_CONTEXT.md), damit Frontend-Stack, Tabellen, Apple/Google-Daten, Public URLs, Designfelder und Versandregeln als aktive Goal-Vorgaben erhalten bleiben. `scripts/verify-wallet-external-credentials.js` prüft [docs/WALLET_EXTERNAL_CREDENTIALS.md](docs/WALLET_EXTERNAL_CREDENTIALS.md), damit Apple APNs, Google Issuer, Google Service Account JSON, Supabase Secret-Commands und offizielle Quellen dokumentiert bleiben. `scripts/verify-deploy-cleanliness.js` blockiert lokale `.DS_Store`-Artefakte in Quell-/Supabase-Verzeichnissen und den alten `supabase/functions/passkit` Ordner. Der separate Architektur-Vertragscheck sichert die im Prompt benannten Methoden wie `walletNotificationService.createCampaign()`, `appleWalletProvider.signPass()` und `googleWalletProvider.sendTextAndNotify()` sowie die Apple-Webservice-Routen statisch ab. `scripts/verify-supabase-schema-sanity.js` prüft `supabase/schema.sql` auf abgeschlossene Statements, doppelte Tabellenspalten und passende `INSERT`-Spaltenlisten. `scripts/verify-edge-typescript-syntax.js` prüft alle Supabase Edge TypeScript-Dateien syntaktisch per lokalem Type-Stripping-Check, wenn die Node-Runtime das unterstützt, sonst per strukturellem Fallback. `scripts/verify-edge-function-imports.js` prüft alle Supabase Edge Function Imports auf lokal auflösbare Shared-Dateien, erlaubte Remote-Imports und fehlende PassKit-Referenzen. `scripts/verify-edge-function-contracts.js` prüft alle Supabase Edge Functions auf CORS/OPTIONS, strukturierte Fehler, Auth-Kontext, Service-Role-Client-Schutz, timing-safe Cron-Secret-Prüfung, atomares Empfänger-Claiming und Idempotency-Reservierung bei manuellen Wallet-Operationen. `scripts/verify-wallet-target-contract.js` vergleicht Wallet-Zielgruppen und erlaubte `target_filter` Felder zwischen `config.example.json`, Editor, Edge Backend und SQL. `scripts/verify-wallet-limit-accounting.js` prüft, dass Tageslimits, sichtbare Push-Zähler und Google-Fallbacks getrennt bleiben. `scripts/verify-editor-campaign-idempotency.js` prüft, dass der Editor für einen Browser-Retry denselben Kampagnen-Idempotency-Key wiederverwendet. `scripts/verify-claim-page-output-safety.js` prüft, dass die öffentliche Claim-Seite Kartenwerte escaped und Google-Save-Links vor dem Rendern validiert. `scripts/verify-claim-token-links.js` prüft, dass neue Dashboard-, Editor-, PDF- und Samsung-Claim-Links `public_claim_token` nutzen, während alte Template-ID-Links nur Fallback bleiben. `scripts/verify-public-edge-response-safety.js` prüft, dass öffentliche Claim-/Topup-Responses, browsernahe Scanner-, Topup-Bestätigungs- und Guthaben-Antworten, Apple-Pass-Versionen sowie Idempotency-Replay-Payloads aus Edge Functions und lokalem Fallback nur minimierte bzw. redigierte Felder statt roher Datenbankzeilen zurückgeben. `scripts/verify-apple-webservice-contract.js` prüft die Apple Wallet Web Service Routen, ApplePass-Auth, `passesUpdatedSince`, `If-Modified-Since`, Registrierungsstatuscodes und Push-Token-Redaction. `scripts/verify-google-wallet-contract.js` prüft Google Wallet API Provider, Service-Account-JSON, Save-Link-Redaction, Object-Type-Mapping, `TEXT_AND_NOTIFY`, Fallbacks, SQL-Isolation und Limits. `scripts/verify-wallet-requirements-coverage.js` gleicht die grossen Prompt-Blöcke gegen Code, SQL, Editor-UI, Secrets, Testdaten und Legacy-PassKit-Archivhinweise ab. `scripts/verify-wallet-goal-audit.js` prüft [docs/WALLET_GOAL_COMPLETION_AUDIT.md](docs/WALLET_GOAL_COMPLETION_AUDIT.md), damit repo-seitige Evidenz und externe Apple-/Google-/Supabase-Abnahmegates sichtbar bleiben. `scripts/verify-wallet-implementation-plan.js` prüft [docs/WALLET_IMPLEMENTATION_PLAN.md](docs/WALLET_IMPLEMENTATION_PLAN.md), damit Analyse, Dateirollen, SQL-Migrationsplan, Edge-Function-Plan und Secret-Checkliste nicht veralten. `scripts/verify-wallet-deploy-checklist.js` prüft die README-/Kontext-Checkliste für Supabase Secrets, Public URLs und Wallet-Edge-Deploy-Befehle. `scripts/verify-wallet-cron-setup.js` prüft [docs/WALLET_CRON_SETUP.md](docs/WALLET_CRON_SETUP.md) und [supabase/cron.example.sql](supabase/cron.example.sql), damit Scheduled Campaigns und Queue-Jobs produktiv per Supabase Cron oder externem Cron vorbereitet bleiben. `scripts/verify-wallet-external-acceptance.js` prüft [docs/WALLET_EXTERNAL_ACCEPTANCE.md](docs/WALLET_EXTERNAL_ACCEPTANCE.md), damit die externe Apple-/Google-/Cron-/Payment-Endabnahme konkret bleibt. `scripts/verify-apple-pass-payload.js` prüft zusätzlich, dass Apple-Pass-Payloads Identität, `authenticationToken`, `webServiceURL`, sichtbare Statusfelder, Barcode und Template-Logo/Icon-Assets enthalten.

`scripts/verify-wallet-smoke-test.js` prüft zusätzlich das manuelle Smoke-Test-Werkzeug `scripts/wallet-smoke-test.js`, ohne im normalen `pnpm check` Netzwerkzugriffe auszuführen.

Wenn du die Matrix änderst, danach ausführen:

```bash
node scripts/generate-template-feature-doc.js
pnpm check
```

## Supabase Setup

1. Neues Supabase-Projekt erstellen.
2. In Supabase den SQL Editor öffnen.
3. Optional das SQL-Editor-Bundle vorbereiten:

```bash
node scripts/prepare-supabase-sql-editor-bundle.js --write
node scripts/prepare-supabase-sql-editor-chunks.js --write --force
node scripts/wallet-sql-editor-apply-report.js
bash scripts/apply-supabase-schema.sh --dry-run
```

Das erzeugt `tmp/supabase-schema-sql-editor-bundle.sql` aus `supabase/schema.sql` und hängt `notify pgrst, 'reload schema';` für den Supabase REST-Schema-Cache an. Falls der SQL Editor mit einer grossen Datei Probleme macht, erzeugen die `SQL-Editor-Chunks` unter `tmp/supabase-schema-sql-editor-chunks/` mehrere kleinere Dateien, die numerisch nacheinander ausgeführt werden können. `Wallet SQL Editor Apply Report` zeigt danach Zielprojekt, Bundle, Chunk-Reihenfolge und aktuell fehlende Remote-Tabellen redigiert an. Bundle, Chunks und Report lesen keine Secrets und werden nicht versioniert.

Alternativ kann `apply-supabase-schema.sh` das Bundle per Supabase CLI ausführen, ohne SQL-Inhalt oder Datenbank-URL auszugeben. Dafür entweder `SUPABASE_DB_URL` setzen oder das Projekt einmal mit `supabase link --project-ref <PROJECT_REF>` linken:

```bash
SUPABASE_DB_URL='postgresql://...' bash scripts/apply-supabase-schema.sh
# oder nach supabase login/link:
bash scripts/apply-supabase-schema.sh
```

4. Den Inhalt von `supabase/schema.sql`, dem generierten Bundle oder den SQL-Editor-Chunks komplett im SQL Editor ausführen, oder alternativ `bash scripts/apply-supabase-schema.sh` mit `SUPABASE_DB_URL` bzw. gelinktem Projekt nutzen.
5. In `config.json` die Supabase URL, den Anon Key und den Service Role Key eintragen.

Die SQL-Datei erstellt:

- `operator_profiles`
- `businesses`
- `card_templates`
- `customer_cards`
- `card_instances`
- `balance_transactions`
- `topup_payment_sessions`
- `wallet_update_jobs`
- `wallet_device_registrations`
- `card_events`
- `scan_events`
- Storage Bucket `wallet-assets`
- Storage Bucket `wallet-emblems`
- Trigger für neue Betreiberprofile
- RLS Policies für Mandantentrennung
- Storage Policies, damit Betreiber nur in den eigenen Ordner hochladen können
- `template_type` auf `card_templates`
- SQL-Funktionen wie `template_feature_allowed(...)`, damit unpassende Kartenwerte auch serverseitig blockiert werden
- SQL-Trigger für `businesses` und `card_templates`, damit Owner-/Business-Zuordnung nicht durch Browser-, Service-Role- oder Edge-Pfade manipuliert werden kann
- SQL-Trigger für `customer_cards`, `card_instances`, `balance_transactions`, `topup_payment_sessions`, `wallet_device_registrations`, `card_events` und `scan_events`, damit Owner-/Business-/Template-Bezüge, Stempel/Streak/VIP/Guthaben/Garderobe, Wallet-Registrierungen, fachliche Events und Besucherstatistik nur konsistent gespeichert werden
- automatische `wallet_update_jobs` bei relevanten Karten-Aenderungen, damit Apple/Google-Wallet-Updates später asynchron verarbeitet werden können
- `wallet_device_registrations` für Apple-Wallet-Geräte, Pass-Type, Seriennummer und Push-Token, inklusive Trigger-Validierung gegen Kundenkarte, Karteninstanz und Pass-Seriennummer
- eindeutige `card_instance_number` pro ausgestellter Karte, nutzbar für Wallet-Anzeige und Scanner
- Guthaben-Transaktionen und Topup-Sessions für `balance_card` und explizit aktivierte Zusatz-Guthaben
- die direkten Wallet-Benachrichtigungstabellen `wallet_notification_campaigns`, `wallet_notification_recipients`, `wallet_push_logs`, `wallet_update_queue`, `apple_wallet_devices`, `apple_wallet_registrations`, `apple_pass_versions` und `google_wallet_objects`

Neue Betreiber werden automatisch mit `unlock = false` angelegt. Die Registrierung läuft über die Edge Function `register-operator`, damit Supabase nicht sofort eine Bestätigungs-Mail sendet. Bis Supabase Pro bzw. Custom SMTP aktiv ist, gilt vorübergehend der Unlock-only-Modus: Dashboard, Editor, Scanner und alle RLS-geschützten Daten sind zugänglich, sobald `unlock = true` gesetzt wurde. Die Magic-Link-Verifizierungsstrecke bleibt vorbereitet und kann später mit `OPERATOR_EMAIL_VERIFICATION_REQUIRED=true`, SMTP/Mailtemplate und dem bestehenden `send-operator-verification-email` Cron wieder aktiviert werden.

Wichtig für Bilder, Karteninstanzen und die Feature-Matrix: Führe `supabase/schema.sql` erneut komplett im SQL Editor aus, damit `template_type`, `card_instance_number`, `card_instances`, `balance_transactions`, `topup_payment_sessions`, `wallet_update_jobs`, `wallet_device_registrations`, die Matrix-Validierung, der Bucket `wallet-assets` und die Storage Policies vorhanden sind. Danach landen Uploads automatisch unter:

```text
wallet-assets/<operator-user-id>/templates/...
```

Wallet-Assets für Logos, Icons und Kartenbilder dürfen als PNG, JPEG oder WebP ausgewählt werden und werden im Editor automatisch zentriert, ohne Beschnitt in den passenden Zielrahmen eingepasst und als PNG unter 2 MB vorbereitet. SVG ist für Wallet-Assets bewusst deaktiviert, weil der Bucket öffentlich lesbar ist und die Dateien direkt in Wallet-Passes, Vorschauen und PDFs verwendet werden. Die finale Grenze wird zusätzlich in den Supabase Storage Policies serverseitig inklusive Grössen-Metadaten geprüft.

Optionale Testdaten:

```bash
# Erst einen Betreiber mit demo@example.com registrieren, dann im SQL Editor ausführen:
supabase/test-data.sql
```

Die Datei schaltet diesen Demo-Betreiber frei und erzeugt Demo-Business, Apple-/Google-Testkarten, Stempel-, VIP-, Guthaben-, Garderoben-, Event-, Coupon- und Clubkarten-Templates sowie drei Beispielkampagnen. Für `club_card` sind sieben Testfälle A-G enthalten: ohne Zusatzfeatures, nur VIP, nur Guthaben, nur Garderobe, nur Coupon, nur Mitgliedschaft und alle Module aktiv. Google Wallet wird dabei mit `genericObject`, `loyaltyObject`, `offerObject` und `eventTicketObject` abgedeckt. Sie legt ausserdem Demo-Apple-Pass-Versionen mit `authenticationToken`, HTTPS-`webServiceURL`, QR-Barcode und sichtbaren Statusfeldern, ein Demo-Apple-Gerät, Apple-Wallet-Registrierungen und vorbereitete Kampagnen-Empfänger an, damit Preflight, Apple-Registrierungsstatus und Versandhistorie direkt sichtbar getestet werden können.

## Betreiber freischalten

Nach der Registrierung bekommt der Betreiber noch keinen Zugriff und keine Bestätigungs-Mail. Die Freischaltung erfolgt im MVP manuell in Supabase.

Im Supabase SQL Editor:

```sql
update public.operator_profiles
set unlock = true
where email = 'betreiber@example.com';
```

Im aktuellen Unlock-only-Modus setzt der Trigger nur `approved_at`; der Betreiber kann sich danach direkt einloggen. Die Felder `verification_email_requested_at`, `verification_email_sent_at`, `verification_email_last_error`, `verification_email_attempts` und `verification_email_status` bleiben für den späteren Magic-Link-Prozess vorbereitet, werden aber vorerst nicht als Zugriffsvoraussetzung verwendet.

Sobald Supabase Pro bzw. Custom SMTP aktiv ist, kann der vorbereitete Prozess wieder aufgenommen werden: `OPERATOR_EMAIL_VERIFICATION_REQUIRED=true` als Supabase Secret setzen, das Auth-Mailtemplate veröffentlichen, `mailer_allow_unverified_email_sign_ins=false` setzen und den Unlock-Trigger wieder so konfigurieren, dass er `verification_email_requested_at` und `verification_email_status='pending'` vormerkt.

Damit die Mail von `Fabricio@el-promillo.ch` kommt, muss in Supabase Auth ein SMTP-Absender für diese Adresse hinterlegt sein:

1. Supabase Dashboard öffnen.
2. Projekt öffnen.
3. `Authentication` -> `Emails` bzw. `SMTP Settings` öffnen.
4. Custom SMTP aktivieren.
5. Absenderadresse auf `Fabricio@el-promillo.ch` setzen.
6. Die Domain bzw. SMTP-Zugangsdaten deines Mailproviders eintragen und speichern.
7. Unter `Authentication` -> `URL Configuration` die öffentliche App-URL, z. B. `https://el-promillo.ch`, als Site URL und Redirect URL erlauben.

Standardmässig nutzt `send-operator-verification-email` `OPERATOR_VERIFICATION_MAIL_MODE=supabase_auth`, also die Supabase Auth Magic-Link-Mail. Optional kann später `OPERATOR_VERIFICATION_MAIL_MODE=resend` mit `RESEND_API_KEY`, `MAIL_FROM_EMAIL=Fabricio@el-promillo.ch` und `MAIL_FROM_NAME=El Promillo` verwendet werden.

Die Magic-Link-Mailvorlage liegt versioniert unter:

```text
supabase/templates/operator-magic-link.html
```

Die Vorlage enthält bewusst einen HTML-Kommentar `SIGNATURE_PLACEHOLDER`. Sobald die finale Outlook-Signatur vorliegt, wird sie dort als HTML eingesetzt und danach erneut in Supabase veröffentlicht.

Für gehostete Supabase-Projekte kann die Auth-Mailvorlage per Management API gesetzt werden. Der Befehl aktualisiert die Magic-Link-Mail, setzt die Site URL auf `https://el-promillo.ch`, ergänzt die Redirect-Allowlist für Produktion, GitHub-Developer-Page und lokale Entwicklung und stellt sicher, dass unbestätigte E-Mails nicht einloggen dürfen:

```bash
SUPABASE_ACCESS_TOKEN=<dein-supabase-token> npm run auth-email:apply
```

Vorher kann die geplante Änderung ohne Supabase-Schreibzugriff geprüft werden:

```bash
npm run auth-email:dry-run
```

Falls Supabase die Mailvorlage wegen Free-Tier/Standard-Mailprovider blockiert, kann wenigstens die Auth-Routing-Konfiguration gesetzt werden. Die Mailvorlage bleibt dann lokal vorbereitet und wird erst nach aktiviertem Custom SMTP oder passendem Supabase-Plan veröffentlicht:

```bash
SUPABASE_ACCESS_TOKEN=<dein-supabase-token> npm run auth-email:apply -- --routing-only
```

Der vorübergehende Unlock-only-Modus erlaubt unbestätigten Auth-Usern den Login, sperrt die App aber weiterhin über `operator_profiles.unlock=false`. Für diesen Zwischenzustand:

```bash
SUPABASE_ACCESS_TOKEN=<dein-supabase-token> npm run auth-email:unlock-only
```

Das Script gibt keine Secret-Werte aus. SMTP-Zugangsdaten werden nicht im Repository gepflegt; sie müssen entweder im Supabase Dashboard unter `Authentication` -> `Emails`/`SMTP Settings` eingetragen werden oder separat über die Supabase Management API gesetzt werden, wenn Host, Benutzer, Passwort, Port und Absendername vollständig vorliegen.

## Passwort vergessen und Passwort ändern

Der Loginbereich enthält eine Passwort-vergessen-Funktion. Sie ruft Supabase Auth Password Recovery auf und sendet eine Reset-Mail an die angegebene Betreiber-E-Mail. Der Redirect zeigt zurück auf:

```text
index.html?recovery=1
```

Nach dem Klick auf den Supabase-Link erkennt die Login-Seite den Recovery-Flow, speichert das neue Passwort über Supabase Auth und leitet danach je nach Freischaltung ins Dashboard, in den Scanner oder auf die Warteseite.

Die Kontoseite enthält zusätzlich `Passwort ändern`. Dort muss der Betreiber zuerst das aktuelle Passwort eingeben; die App prüft es per Supabase-Login und speichert danach das neue Passwort direkt über Supabase Auth.

Wichtig für Free-Tier: Password Recovery ist mit Supabase Auth nutzbar. Wenn das Projekt den Supabase-Default-Mailprovider verwendet, kann die Reset-Mail bei neuen Free-Tier-Projekten aber nicht frei gebrandet werden. Für eigene Betreffzeilen, HTML, Signatur oder Absender wie `Fabricio@el-promillo.ch` ist Custom SMTP oder Supabase Pro nötig.

## Sprache und Login-Sitzung

Login- und Kontoseite enthalten eine moderne Sprachwahl. Deutsch (`DE`) ist immer die Standardsprache; Betreiber können zusätzlich Englisch (`EN`), Französisch (`FR`) und Italienisch (`IT`) wählen. Die Auswahl wird lokal im Browser gespeichert und betrifft nur die angezeigten UI-Texte, nicht Supabase-Daten oder Wallet-Inhalte.

Aus Sicherheitsgründen bleibt ein Login standardmässig nur für die aktuelle Browser-Sitzung aktiv. Erst wenn beim Login `Eingeloggt bleiben` angewählt wird, speichert die App die Supabase-Session dauerhaft im Browser. Beim Logout werden beide Session-Speicher geleert.

## Kein PassKit im aktiven Wallet-Pfad

Der aktuelle Wallet-Benachrichtigungspfad, die öffentliche Claim-Seite und der Scanner verwenden kein PassKit. Apple Wallet wird direkt über Supabase Edge Functions, Apple Pass Web Service, signierte `.pkpass`-Dateien und APNS angebunden. Google Wallet wird direkt über die Google Wallet API angebunden.

Die alten lokalen Node-Routen sind bewusst deaktiviert und antworten mit `410 LEGACY_PASSKIT_ROUTE_DISABLED`:

```text
GET /api/passes/:cardId.pkpass
ANY /api/passkit/*
```

Apple- und Google-Credentials gehören nicht mehr in lokale PassKit-Felder, sondern als Supabase Secrets in die Edge Functions. Historische Notizen zu lokalen Apple-Zertifikaten liegen noch in `docs/PASSKIT_KONFIGURATION.md` und `docs/AKTUELLER_PASSKIT_WEG_CHECKLISTE.md`, sind aber nicht der aktive Implementierungsweg.

## Direkter Apple-Wallet-Edge-Pfad

Apple Wallet Passes benötigen eine signierte `.pkpass`-ZIP-Datei mit Manifest-Hashes und PKCS#7/CMS-Signatur. Der direkte Edge-Pfad ist unter `supabase/functions/_shared/appleWalletProvider.ts` umgesetzt und nutzt serverseitig:

- `jszip` für das `.pkpass`-ZIP
- `node-forge` für die PKCS#7-Signatur
- Supabase Secrets für Zertifikate und Private Keys

Die Edge Function `issue-apple-pass` liefert bei korrekt gesetzten Secrets direkt `application/vnd.apple.pkpass` aus. Die öffentliche Claim-Seite nutzt nach `claim-card` die Function `claim-apple-pass`, um die signierte Apple-Wallet-Datei direkt aus dem Edge-Pfad zu laden. Der Apple Web Service `apple-wallet-webservice` liefert bei `GET /v1/passes/:passTypeIdentifier/:serialNumber` ebenfalls die aktuelle signierte `.pkpass`.

Der lokale Legacy-Fallback ist deaktiviert und liefert nur noch eine strukturierte `410`-Antwort:

```text
GET /api/passes/:cardId.pkpass
ANY /api/passkit/*
```

Apple-Geräteregistrierung, Pass-Downloads und Updates laufen stattdessen über `apple-wallet-webservice`. Für echte iPhone-Registrierungen muss diese Edge-Function-URL öffentlich über HTTPS erreichbar sein. Lokal mit `http://localhost...` kann das iPhone den Webservice nicht erreichen.

Eine `supabase/functions/passkit` Function existiert im aktiven Projekt nicht mehr. Apple-Pass-Dateien, Registrierungen und Updates laufen ausschliesslich über `claim-apple-pass`, `issue-apple-pass` und `apple-wallet-webservice`.

Weitere vorbereitete Edge Functions:

- `claim-card`: erstellt öffentlich aus einem aktiven Template eine individuelle `customer_card` plus `card_instance`; neue QR-Links geben dafür `public_claim_token` als `claimToken` weiter, alte Template-ID-Links bleiben als Fallback gültig. Die Function verlangt ausserdem einen stabilen `walletObjectId` aus dem Browser, damit Claims idempotent bleiben und spätere Apple-/Google-Downloads zur richtigen Karte passen. Das aktive Template wird mit einer expliziten internen Feldliste statt `*` geladen. Der `card_instances`-Insert und die Claim-Events werden geprüft; Fehler liefern `CLAIM_CARD_INSTANCE_SAVE_FAILED` oder `CLAIM_CARD_EVENT_SAVE_FAILED` statt einen unvollständigen Claim als Erfolg zu melden. Die Antwort enthält nur das für die mobile Claim-Seite nötige Kartenminimum, keine internen Betreiber-/Business-IDs und keinen Apple-`pass_authentication_token`. Die Claim-Seite nutzt lokal automatisch `/api/cards/claim` als Fallback, falls die Edge Function noch nicht deployed ist.
- `get-public-template`: liefert für öffentliche GitHub-Pages-/Claim-Seiten nur aktive Template-Vorschau-Daten aus. Neue Links laden per `token=<public_claim_token>`, alte `template=<template_id>` Links bleiben für bestehende QR-Codes gültig. Die Function nutzt die Service Role ausschliesslich serverseitig, rate-limitiert öffentliche Requests und gibt keine Betreiber-/Business-IDs, Claim-Token oder Secrets an den Browser zurück.
- Öffentliche Claim-/Installations-Edge-Pfade (`get-public-template`, `claim-card`, `claim-apple-pass`, `google-wallet-save-link`, `samsung-wallet-add-link`, `create-topup-payment-session`) verbrauchen vor dem Datenzugriff ein serverseitiges Rate Limit über `public_edge_rate_limits` und `consume_public_edge_rate_limit(...)`. Gespeichert wird nur ein Hash aus Route und Client-Fingerprint, keine IP-Adresse im Klartext.
- Der lokale Claim-Fallback `/api/cards/claim` gibt für Apple keine aktive `/api/passes`-Download-URL mehr zurück. Er speichert nur die Karte, verweist auf den direkten Edge-Download über `claim-apple-pass`, nutzt für Google denselben `metadata.google_wallet_claim_key` wie die Edge-Function und prüft ebenfalls `card_instances`- sowie `card_events`-Writes auf `CLAIM_CARD_INSTANCE_SAVE_FAILED` bzw. `CLAIM_CARD_EVENT_SAVE_FAILED`. Für lokale Tests nutzt der Fallback dasselbe nicht-sensitive Claim-Limit aus `config.json -> deliveryRules` als In-Memory-Schutz.
- `claim-apple-pass`: liefert für eine frisch geclaimte Apple-Karte eine signierte `.pkpass` aus dem direkten Apple-Edge-Pfad; die Claim-Seite fällt für Apple-Wallet-Dateien nicht mehr auf den lokalen PassKit-Endpunkt zurück
- `scanner-actions`: matrixbasierte Scanner-Aktionen; prüft den eingeloggten Betreiber, blockiert unpassende Aktionen mit `403`, fragt beim ersten Scan die Demografie für Statistik ab, aktualisiert Kundenkarten/Card-Instances und schreibt `scan_events`, `card_events` sowie Guthaben-Transaktionen. Karten und Templates werden intern mit expliziten Select-Listen geladen, und die Antwortkarte wird nur über `publicOperatorCard(...)` ausgeliefert. Card-Instance-Sync, Guthabenbuchung, Scan-Event und Audit-Event müssen erfolgreich gespeichert werden; sonst liefern Edge Function und lokaler Fallback strukturierte Fehler wie `SCANNER_CARD_INSTANCE_SYNC_FAILED`, `SCANNER_BALANCE_TRANSACTION_SAVE_FAILED`, `SCANNER_SCAN_EVENT_SAVE_FAILED` oder `SCANNER_CARD_EVENT_SAVE_FAILED`. Die Scanner-UI ruft diese Function zuerst auf und fällt nur bei nicht deployter/nicht konfigurierter Function auf den lokalen Node-Endpunkt zurück. Der Apple-Wallet-Dateidownload im Scanner läuft dagegen direkt über `issue-apple-pass`.
- `get-business-scan-statistics`: geschützte Betreiber-Function für die aggregierte Besucherstatistik im Dashboard; liest nur eigene `scan_events`, prüft `unlock` und Business-Zugehörigkeit und liefert KPIs, Diagrammdaten sowie letzte Scans ohne rohe fremde Datensätze
- `create-topup-payment-session`: erstellt eine pending Topup-Session für Karten mit erlaubter Guthabenfunktion
- `confirm-topup-payment`: bestätigt eine Topup-Session über SQL-RPC `confirm_card_topup(...)`, schreibt Guthaben, Transaktion und Event; produktiv per Provider-Webhook mit `PAYMENT_WEBHOOK_SECRET`
- `redeem-balance`: atomare Guthaben-Abbuchung über Edge Function und SQL-RPC `redeem_card_balance(...)`; Kundenkarte und Template werden mit expliziten Select-Listen geladen und die aktualisierte Karte wird nur über `publicOperatorCard(...)` zurückgegeben
- `generate-card-pdf`: erzeugt A4/A5-QR-PDFs als Edge Function mit matrixbasierter Wallet-Vorschau und separatem tokenisiertem Claim-QR; prüft Betreiber-Auth, `unlock` und `owner_id` und lädt Templates mit expliziter Feldliste
- `google-wallet-save-link`: erzeugt aus einer gespeicherten Google-Karteninstanz einen signierten Save-to-Google-Wallet-Link

Diese Functions importieren bereits den gemeinsamen Matrix-Helper und geben strukturierte Fehler zurück, wenn z. B. eine Streak-Aktion für eine Stempelkarte oder eine Guthaben-Aktion für eine reine Basiskarte angefragt wird.

## Direkte Wallet-Benachrichtigungen

Der neue Benachrichtigungspfad verwendet kein PassKit. Er läuft über Supabase Edge Functions und liest Secrets ausschliesslich serverseitig aus Supabase Secrets. Zentraler Einstiegspunkt ist `supabase/functions/_shared/walletNotificationService.ts`.

Der zentrale `walletNotificationService` lädt Betreiberprofile, Businesses, Templates, Kampagnen, Empfänger, Karteninstanzen, Kundenkarten, Google-Object-Zuordnungen und Queue-Jobs mit festen Select-Listen statt rohen `*`-Relationen. Dadurch bleiben Service-Role-Lesezugriffe nachvollziehbar eingegrenzt; `pnpm check` blockiert neue Wildcard-Selects in diesem Pfad.

Die Browser-Secret-Grenze wird in `pnpm check` durch `scripts/verify-browser-secret-boundary.js` geprüft. Dieser Check scannt `public/` und die `/api/config`-Whitelist: Im Browser dürfen Supabase URL, Supabase Anon Key, App-URLs und nicht-sensitive Delivery-Regeln landen, aber keine Service Role Keys, Apple-Zertifikate/APNS-Werte, Google-Wallet-Service-Account-Daten oder PassKit-Felder.

Die Edge-Secret-Grenze wird ebenfalls in `pnpm check` durch `scripts/verify-edge-secret-boundary.js` geprüft. Dieser Check verhindert rohe Config-/Secret-Antworten, Secret-Logs und Wallet-Log-Payloads mit Secret-Objekten; Setup-Fehler dürfen nur Secret-Namen und klare Handlungsanweisungen enthalten, nie echte Werte.

Provider:

```text
supabase/functions/_shared/appleWalletProvider.ts
supabase/functions/_shared/googleWalletProvider.ts
```

Edge Functions:

- `create-wallet-notification-campaign`: erstellt Kampagne, löst Empfänger auf und sendet bei `send_type = now`
- `send-wallet-notification`: sendet eine bestehende Kampagne
- `resolve-wallet-notification-recipients`: berechnet erreichbare Karten anhand Zielgruppe und lädt Kampagnen nur für den eingeloggten Betreiber plus aktuelles Business
- `check-wallet-notification-limits`: prüft Tages-/Google-Limits pro Karte oder als Kampagnen-Preflight für die gewählte Zielgruppe
- `process-scheduled-wallet-notifications`: verarbeitet fällige geplante Kampagnen
- `process-wallet-update-queue`: verarbeitet vorbereitete Wallet-Update-Jobs
- `issue-apple-pass`, `claim-apple-pass`, `update-apple-pass`, `send-apple-wallet-update`, `apple-wallet-webservice`
- `issue-google-wallet-pass`, `update-google-wallet-pass`, `send-google-wallet-message`

Neue Tabellen: `wallet_notification_campaigns`, `wallet_notification_recipients`, `wallet_push_logs`, `wallet_update_queue`, `apple_wallet_devices`, `apple_wallet_registrations`, `apple_pass_versions` und `google_wallet_objects`.

Apple `.pkpass`-CMS-Signatur ohne PassKit ist im Edge-Provider implementiert. Ohne echte Apple-Secrets gibt die Function eine strukturierte Setup-Meldung zurück; mit Secrets liefert sie eine `.pkpass`-Datei aus. Apple-Wallet-Benachrichtigungen laufen danach über Pass-Version, Webservice-Registrierung und APNS-Push-Update. Google-Wallet-Messages nutzen die direkte Wallet REST API und `TEXT_AND_NOTIFY`, sofern die Google-Secrets und API-Freigaben korrekt gesetzt sind.

Der Apple-Provider stellt vor jeder neuen Apple-Pass-Version sicher, dass die verknüpfte `customer_cards`-Zeile ein `pass_authentication_token` besitzt. Fehlt der Token bei alten oder manuell angelegten Karten, wird er serverseitig erzeugt und gespeichert, bevor `pass.json` gebaut wird. Die Nachrüstung ist trotz Service Role an `owner_id`, `business_id` und `template_id` der geladenen Karteninstanz gebunden. Dadurch enthalten neue `.pkpass`-Dateien `authenticationToken` und, bei HTTPS-Konfiguration, `webServiceURL`, damit Apple Wallet Device Registration und spätere Updates funktionieren können.

Apple-Passes im direkten Update-Pfad werden nur signiert, wenn `authenticationToken` und eine öffentliche HTTPS-`webServiceURL` vorhanden sind. Fehlt `APPLE_WEB_SERVICE_BASE_URL` oder ist sie nicht HTTPS, geben `claim-apple-pass`, `issue-apple-pass` und der Apple Wallet Web Service den Setup-Fehler `APPLE_WEB_SERVICE_CONFIG_MISSING` mit HTTP `501` zurück, statt eine nicht aktualisierbare Walletkarte bzw. einen scheinbar erfolgreichen JSON-Download auszuliefern.

Apple-Webservice-Fehlerantworten für Pass-Downloads bleiben minimiert: Wenn die `.pkpass`-Signatur fehlschlägt, gibt der Webservice nur Pass-Version-Metadaten und kompakte Signing-Fehler aus, aber keine rohe `pass_json`, keine Assets und keinen `authenticationToken`.

`issue-apple-pass` arbeitet nur für Apple-Wallet-Karten, erstellt eine Pass-Version, versucht die `.pkpass`-Signatur und loggt `issue_apple_pass` in `wallet_push_logs`. Karteninstanz, Template, Kundenkarte und vorhandene Pass-Versionen werden intern mit expliziten Select-Listen geladen; `pass_json`, Assets und `pass_authentication_token` bleiben nur serverseitig für Signatur und Apple-Webservice-Token nutzbar. Bei fehlender Apple-Signaturkonfiguration antwortet die Function mit HTTP `501`, bei echten Signaturfehlern mit `502`. Ein optionaler `idempotency-key` verhindert doppelte Pass-Versionen bei Browser- oder Netzwerk-Retries. Der Kartenstatus-Write ist trotz Service Role an Betreiber, Business, Template und `wallet_platform = apple` gebunden und gilt nur als erfolgreich, wenn wirklich eine passende Karteninstanz aktualisiert wurde.

`claim-apple-pass` arbeitet für den öffentlichen Claim-Weg: Die Claim-Seite übergibt nach `claim-card` die erzeugte Karten-ID, die Function signiert eine vorhandene aktuelle Apple-Pass-Version erneut oder erstellt bei neueren Karten-/Template-Daten eine frische Version. Jeder Download wird als `claim_apple_pass` in `wallet_push_logs` protokolliert; Secrets bleiben serverseitig. Der Kartenstatus-Write ist trotz Service Role an Karteninstanz, Kundenkarte, Betreiber, Business, Template und Apple-Plattform gebunden.

Apple-Issue- und Claim-Fehlerantworten liefern für Browser nur minimierte Signing-Felder (`ok`, `status`, `error_code`, `error_message`). Rohdaten wie `.pkpass`, Dateiname, Content-Type, Pass JSON, Assets oder interne Signatur-Details bleiben im Download- bzw. Serverpfad.

`send-apple-wallet-update` prüft Tageslimits, kann optional eine sichtbare Pass-Nachricht in einer neuen Pass-Version speichern, sendet danach APNS und loggt `sent`, `prepared`, `skipped`, `limited` oder `failed` als `manual_apple_push_update` in `wallet_push_logs`. Karteninstanz, Template und Kundenkarte werden intern mit expliziten Select-Listen geladen, damit keine kompletten Relationen in den manuellen Sendepfad gezogen werden. `prepared` bedeutet: Die Pass-Version wurde gespeichert, aber APNS war nicht konfiguriert oder noch kein iPhone für diese Karte registriert; das zählt gegen Tageslimits, aber nicht als sichtbare Push-Benachrichtigung. Die Browserantwort enthält nur minimierte Push-Zählwerte und Warncodes; APNS-Response-Text, Device-Identifier und Push-Token-Suffixe bleiben im serverseitigen Audit-Kontext.

Sofort-Kampagnen über `create-wallet-notification-campaign` werden direkt verarbeitet. Die Antwort enthält danach das aktualisierte Kampagnenobjekt und `send_result`, sodass der Editor den finalen Status `sent`, `partially_failed` oder `failed` anzeigen kann. Für grosse Kampagnen liefert `send_result` eine kompakte `result_summary` und nur begrenzte, redigierte Ergebnisdetails; vollständige Providerantworten bleiben in `wallet_notification_recipients` und `wallet_push_logs` für Versandhistorie und Fehleranalyse.

Empfänger-Resolve ist idempotent: Wiederholte Aufrufe erzeugen keine doppelten `wallet_notification_recipients` und setzen bereits verarbeitete Empfänger nicht erneut auf `pending`. Die separate `resolve-wallet-notification-recipients` Antwort liefert nur `recipients_count` und eine `recipient_summary`, nicht die rohen Empfängerzeilen. Empfängerlisten werden intern seitenweise gelesen und grosse Sofortkampagnen werden in Pending-Batches verarbeitet, bis keine offenen Empfänger mehr übrig sind.

Manuelle Apple-/Google-Sends nutzen dieselbe Kartenstatus-Aktualisierung wie Kampagnen: Nach dem Audit-Log werden `last_wallet_update_at`, bei sichtbarer Nachricht `last_notification_at` und `notification_count_24h` aus den letzten 24 Stunden neu berechnet. Reine Google-Fallback-Kartenupdates ohne `TEXT_AND_NOTIFY`, vorbereitete Apple-Pass-Updates ohne APNS-Erfolg (`prepared`) und reine `update-apple-pass`-Passversionen aktualisieren nur `last_wallet_update_at`, nicht den sichtbaren Benachrichtigungszähler. Wenn diese Statusfelder in manuellen Edge-Pfaden nicht gespeichert werden können oder keine passende Karteninstanz getroffen wird, antwortet der Pfad mit `CARD_WALLET_STATE_UPDATE_FAILED` statt den Fehler still zu ignorieren. Bei Kampagnen bleibt der bereits persistierte Provider-/Empfängerstatus stabil; ein nachgelagerter Kartenstatus-Sync-Fehler wird separat als `card_wallet_state_sync_failed` in `wallet_push_logs` auditiert. Die Limitprüfung darf mehr Actions zählen, z. B. queued oder prepared Apple-Pass-Updates als Spam-Schutz, aber `notification_count_24h` wird mandantengefiltert nur aus sichtbaren Actions wie erfolgreiche Apple Push/Pass-Updates und Google `TEXT_AND_NOTIFY` berechnet.

Manuelle Apple-/Google-Sends, manuelle Apple-/Google-Updates sowie `issue-apple-pass` und `issue-google-wallet-pass` akzeptieren optional `idempotency-key` als Header oder Body-Feld. Wiederholte Requests für dieselbe Karte, Plattform und Aktion geben vor der erneuten Limitprüfung bzw. vor einem neuen Provider-Aufruf den bestehenden `wallet_push_logs`-Eintrag zurück, statt erneut einen Wallet-Push, Google-Message-Versuch, Pass-Version-Queue-Job, Google-Object-Patch oder Google-Issue-Aufruf zu starten. Replay-Antworten aus `wallet_push_logs.response_payload` werden für manuelle Apple-/Google-Sends erneut provider-spezifisch minimiert: APNS-Details werden auf Zählwerte/Warncodes reduziert und Google-Providerantworten auf Status-, Action-, Object- und Fehlerfelder. Die vier manuellen Send-/Update-Pfade und die beiden Issue-Pfade reservieren neue Keys zuerst als `processing` in `wallet_push_logs` und aktualisieren danach denselben Log-Eintrag; Reservierung, Finalisierung und Fehlerabschluss sind an Betreiber, Business, Karteninstanz, Wallet-Plattform und `campaign_id is null` gebunden. Parallele Retries mit gleichem Key rufen Apple oder Google dadurch nicht doppelt auf. Zusätzlich deduplizieren direkte manuelle Apple- und Google-Sends identische Nachrichtsinhalte innerhalb von `WALLET_DUPLICATE_WINDOW_MINUTES`: Der zweite Versuch wird als `manual_duplicate_skipped` auditiert und ruft weder APNS noch Google Wallet API erneut auf. Falls nach der Reservierung ein unerwarteter Fehler auftritt, wird die Reservierung als `failed` mit strukturiertem Fehlerpayload abgeschlossen. Wenn ein Provider-/Audit-Schritt bereits finalisiert wurde, aber danach die lokale Karten-/Object-Persistenz scheitert, wird derselbe Log mit `idempotency_post_finalize_failure` auf `failed` gesetzt, damit ein Retry keinen falschen Erfolg aus dem Cache bekommt. Apple-Issue signiert bei späteren Wiederholungen die vorhandene Pass-Version erneut als `.pkpass`. `wallet_push_logs_manual_idempotency_idx` sichert diese Regel serverseitig pro Betreiber, Business, Karteninstanz, Wallet-Plattform, `idempotency_scope` und Key ab.

Kampagnen-Idempotency ist pro Business eindeutig: `wallet_notification_campaigns_owner_idempotency_idx` nutzt `owner_id`, `business_id` und `idempotency_key`. Der Kampagnen-Idempotency-Key ist auf 200 Zeichen begrenzt. Dadurch blockieren Retries dieselbe Kampagne, ohne getrennte Businesses desselben Betreibers miteinander zu koppeln. Falls zwei identische Requests parallel am SQL-Unique-Index kollidieren, lädt `createCampaign` die bereits erzeugte Kampagne erneut und antwortet mit `idempotency_conflict_recovered`, statt einen doppelten Versand oder einen rohen Datenbankfehler zu erzeugen. Inhaltlich identische Kampagnen innerhalb von `WALLET_DUPLICATE_WINDOW_MINUTES` werden zusätzlich als `campaign_duplicate_skipped` in `wallet_push_logs` auditiert; dieser Audit-Log ruft keinen Wallet-Provider auf und verbraucht keine Tageslimits.

Wenn APNS bei einem Apple-Push mit `410` antwortet, versucht der Apple-Provider die veraltete Device-Registration automatisch zu entfernen und markiert das Ergebnis mit `APPLE_APNS_UNREGISTERED`. `stale_registration_removed` ist nur `true`, wenn der Delete erfolgreich war; sonst steht `stale_registration_remove_error` im Provider-Ergebnis. Dadurch versucht die Queue dieselbe nicht mehr gültige Registrierung nicht dauerhaft erneut, solange der Cleanup gespeichert werden konnte.

APNS-Pass-Updates laden Device-Registrierungen nur mit passender Betreiber-, Business-, Template-, Karteninstanz-, Pass-Type- und Serial-Zuordnung. Gesendet wird mit `apns-topic = APPLE_PASS_TYPE_ID`, `apns-push-type = background` und `apns-priority = 5`. Das Payload bleibt `{}`, weil Apple Wallet danach über den Pass Web Service die aktuelle `.pkpass`-Version abholt.

`update-apple-pass` validiert `message` oder `fields`, blockiert Apple-Kernfelder wie `formatVersion`, `passTypeIdentifier`, `serialNumber`, `authenticationToken`, `webServiceURL`, Barcode und NFC, prüft Tageslimits, erstellt danach eine neue Apple-Pass-Version, legt über den Provider einen Queue-Job an und schreibt `manual_apple_pass_update` mit Status `queued` in `wallet_push_logs`. Karteninstanz, Template und Kundenkarte werden intern mit expliziten Select-Listen geladen. `queued` zählt für diesen manuellen Pass-Update-Pfad bereits gegen Business-/Kunden-/Kartenlimits, damit sichtbare Updates nicht unbegrenzt vor der Queue-Verarbeitung gestapelt werden.

Apple Pass-Versionen rendern den aktuellen Kartenstand aus Supabase in sichtbare Felder. Ohne eigene Nachricht wird ein Update deshalb als Status-Refresh behandelt. Neue Apple-Pass-Versionen uebernehmen ausserdem `card_templates.logo_url` bzw. Icon-URLs aus den Template-Settings als `.pkpass`-Assets, sofern sie aus dem eigenen öffentlichen Supabase-Storage-Bucket `wallet-assets` kommen. Fremde oder nicht-HTTPS Asset-URLs werden vom Apple-Edge-Provider nicht serverseitig geladen.

Apple-Pass-Versionen sind gegen parallele Updates gehärtet: Wenn zwei Prozesse gleichzeitig die nächste Version für dieselbe Karte schreiben, versucht der Provider bei einem Unique-Konflikt die nächste freie Versionsnummer erneut.

`update-google-wallet-pass` patcht keine beliebigen Object IDs. Die Function löst `cardInstanceId` oder `objectId` zuerst gegen `card_instances`/`google_wallet_objects` mit `owner_id` auf, verwendet den gespeicherten `object_type`, blockiert Identitäts-/Kontrollfelder wie `id`, `classId`, `object_id`, `issuer_id`, `accountId`, `kind` und Barcode im freien Patch und schreibt ein Audit-Log in `wallet_push_logs`. Karteninstanz, Template, Kundenkarte und Google-Object-Zuordnung werden intern mit expliziten Select-Listen geladen. Vor dem Object-Patch prüft sie Business-/Kunden-/Kartenlimits und `push_enabled`; erfolgreiche `manual_google_object_update`-Updates verbrauchen Tageslimit, zählen aber nicht als sichtbare `notification_count_24h`-Pushs. Nach erfolgreichem Provider-Patch werden `card_instances` und `google_wallet_objects` nur mit passendem Betreiber, Business, Template, Karteninstanz, Plattform bzw. Object-Type aktualisiert und müssen jeweils eine Zeile treffen.

Claim-Schlüssel und Wallet-Identifier sind eindeutig: `customer_cards.wallet_object_id` ist pro Plattform eindeutig, `card_instances.apple_serial_number` und `card_instances.google_object_id` sind ebenfalls eindeutig, sobald sie gesetzt sind. Öffentliche Claim-Schlüssel werden in Edge Function, lokalem Fallback und SQL auf maximal 180 Zeichen sowie Buchstaben/Zahlen plus `.`, `_`, `-`, `:` begrenzt; ungültige Werte liefern `CLAIM_WALLET_OBJECT_ID_INVALID`. Wenn ein öffentlicher Claim-Link versucht, denselben Wallet-Schlüssel für ein anderes Template zu verwenden, antwortet `claim-card` mit `CLAIM_WALLET_OBJECT_ID_CONFLICT`. Parallele Claims mit demselben Wallet-Schlüssel werden nach einem SQL-Unique-Konflikt erneut gegen die vorhandene Karte aufgelöst und als `reused` zurückgegeben, wenn sie zum gleichen Template gehören.

`issue-google-wallet-pass` arbeitet nur für Google-Wallet-Karten, erstellt/synchronisiert Class und Object, speichert `google_wallet_objects` und loggt `issue_google_wallet_pass` in `wallet_push_logs`. Karteninstanz, Template, Kundenkarte und gespeicherte Google-Object-Zuordnung werden intern mit expliziten Select-Listen geladen. Der Google-Object-Upsert fordert `select('id')` zurück und gilt nur als erfolgreich, wenn Supabase die Zuordnungszeile für diese Karteninstanz bestätigt. Der Operator bekommt den signierten Save-Link in der API-Antwort, aber der dauerhafte Audit-Log speichert nur Metadaten wie `save_url_present` und `save_url_length`, nicht den Save-JWT selbst. Browserantworten für Google-Issue, Google-Object-Updates und Google-Messages geben keine rohen Provider-Response-Objekte aus, sondern nur minimierte Status-, Object-, Class-, Fehler- und Warnfelder; der Save-Link bleibt nur im Issue-/Claim-Pfad sichtbar, weil er für die Wallet-Installation gebraucht wird. Fehlende oder ungültige Google-Wallet-Secrets liefern HTTP `501`, Teilfehler `207` und Provider/API-Fehler `502`. Ein optionaler `idempotency-key` verhindert doppelte Google-Provider-Aufrufe bei Browser- oder Netzwerk-Retries; bei einem Retry ergänzt die Antwort `objectId`, `classId`, `objectType` und `saveUrl` aus der gespeicherten `google_wallet_objects`-Zuordnung, falls der redigierte Audit-Log nicht mehr alle Felder enthält. Die öffentlichen Claim-Installationspfade `claim-apple-pass` und `google-wallet-save-link` laden ihre internen Relationen mit expliziten Select-Listen statt rohen `*`-Selects.

Wenn `issue-google-wallet-pass` nur teilweise erfolgreich ist, z. B. Google Object API fehlgeschlagen, aber ein signierter Save-Link erzeugt wurde, speichert die Function trotzdem `object_id`, `class_id`, `object_type` und `save_url` aus dem Save-Link. Eine lokale Google-Zuordnung wird nur persistiert, wenn Object-ID, Class-ID und Object-Type vollständig vorhanden sind; sonst antwortet die Function mit `GOOGLE_WALLET_OBJECT_IDENTITY_INCOMPLETE`. Der Betreiber-Issue-Pfad synchronisiert bei verknüpfter Kundenkarte auch `customer_cards.wallet_object_id` und `wallet_serial_number`, erhält dabei einen vorhandenen `metadata.google_wallet_claim_key` und filtert den Write wie `card_instances` nach Betreiber, Business, Template und Google-Plattform. Beide Writes müssen eine Zeile aktualisieren. Dadurch können spätere Updates und Benachrichtigungen dieselbe Karteninstanz finden, sobald das Google Wallet Object vom Kunden gespeichert wurde.

`issue-apple-pass` arbeitet analog nur für Apple-Wallet-Karten. Mit optionalem `idempotency-key` wird bei einem Retry keine zweite Pass-Version erzeugt; die bereits gespeicherte Version wird serverseitig erneut signiert und wieder als `.pkpass` ausgeliefert.

Google-Queue-Jobs verwenden die gespeicherte `google_wallet_objects.object_id`/`object_type`-Zuordnung als autoritative Wallet-Identität. Unbekannte Object-Typen und Queue-Patches auf Identitätsfelder wie `id`, `classId`, `object_id`, `issuer_id`, `accountId`, `kind` oder Barcode werden serverseitig blockiert.

`google-wallet-save-link` speichert beim öffentlichen Claim-Weg ebenfalls den `google_wallet_objects`-Datensatz inklusive `object_id`, `object_type`, `class_id` und `save_url`. Die Function akzeptiert als Claim-Nachweis den ursprünglichen Browser-Claim-Schlüssel oder die bereits normalisierte Google Object ID, bevor sie mit Service Role einen Save-Link erzeugt. Wenn bereits ein aktueller Save-Link zur Karteninstanz existiert, wird er wiederverwendet statt erneut ein Save-JWT zu signieren. Der Datensatz und das Audit-Log verwenden dabei die echte `card_instances.id`, nicht die `customer_cards.id`; dadurch können spätere Google-Wallet-Benachrichtigungen die Karte auch dann finden, wenn sie direkt über die Claim-Seite gespeichert wurde. Die Service-Role-Writes auf `customer_cards` und `card_instances` sind an Betreiber, Business, Template und Google-Plattform gebunden und müssen jeweils eine Zeile aktualisieren; auch der Google-Object-Upsert muss per `select('id')` eine Zuordnungszeile bestätigen. Persistenzfehler beim Speichern von Kundenkarte, Karteninstanz, Google-Object oder Event werden strukturiert gemeldet. Key-Format- und Save-JWT-Signaturfehler werden als `GOOGLE_WALLET_PRIVATE_KEY_FORMAT` oder `GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED` mit Setup-Hinweis zurückgegeben, ohne Private Key oder Service-Account-JSON zu leaken. Der erfolgreiche Save-Link-Versuch wird in `wallet_push_logs` als `google_wallet_save_link` auditiert; der Log enthält nur Metadaten wie `save_url_present`, nicht den signierten Save-JWT.

Der gemeinsame Google-Provider normalisiert gespeicherte Browser-Claim-IDs wie `google_<uuid>` vor API-Aufrufen zu echten Google Wallet Object IDs mit Issuer-Prefix, z. B. `<issuerId>.google_<uuid>`. Dadurch verwenden Betreiber-Issue, Save-Link, Object-Updates und spätere Benachrichtigungen dieselbe updatefähige Object-ID.

Damit die öffentliche Claim-Seite auch nach dieser Normalisierung idempotent bleibt, speichern `claim-card` und der lokale `/api/cards/claim`-Fallback für Google zusätzlich `metadata.google_wallet_claim_key`. `google-wallet-save-link` bewahrt diesen ursprünglichen Browser-Schlüssel, wenn `wallet_object_id` auf die echte Google Object ID umgestellt wird. Ein späterer Claim mit dem alten Browser-Schlüssel findet dadurch dieselbe Kundenkarte statt eine zweite zu erzeugen.

Google Class-IDs sind templategebunden: `GOOGLE_WALLET_CLASS_SUFFIX`, Template-Typ und Template-ID bilden zusammen den Suffix hinter der Issuer-ID. Der öffentliche Save-Link verwendet dieselbe Regel wie `issue-google-wallet-pass` und reused einen gespeicherten Save-Link nur, wenn `object_id`, `class_id` und `object_type` weiterhin passen.

`google_wallet_objects.card_instance_id` ist eindeutig indiziert. Google-Issue und der öffentliche Google-Save-Link aktualisieren deshalb denselben Datensatz pro Kundenkarte, statt versehentlich mehrere Wallet-Object-Zuordnungen für eine `card_instance` anzulegen.

`coupon_card` wird für Google Wallet als `offerObject` vorbereitet. Provider und öffentlicher Save-Link erzeugen dafür offer-spezifische Class/Object-Payloads mit Coupon-Titel, Anbieter, Details, Einlösebedingungen, optionaler Gültigkeit (`couponValidUntil`) und Scan-Barcode.

`send-google-wallet-message` validiert Titel/Nachricht, prüft Limits, verwendet die gespeicherte `google_wallet_objects.object_id`/`object_type`-Zuordnung vor Legacy-Feldern auf `card_instances`, schreibt alle Versuche in `wallet_push_logs` und speichert bei fehlgeschlagenem `TEXT_AND_NOTIFY` einen `google_object_message_fallback` als Kartenupdate, sofern die Google Wallet API das Object-Update akzeptiert. Karteninstanz, Template, Kundenkarte und Google-Object-Zuordnung werden intern mit expliziten Select-Listen geladen. Erfolgreiche Google-Messages und Fallbacks aktualisieren die lokale `google_wallet_objects.updated_at`-Zuordnung nur mit passendem Betreiber, Business, Template, Karteninstanz, Object ID und Object-Type und synchronisieren danach `card_instances.google_object_id`, `wallet_object_id` und `wallet_serial_number` auf dieselbe echte Google Object ID.

Der Edge-Scanner und der lokale Scanner-Fallback synchronisieren nach jeder Bearbeitung zuerst die passende `card_instances`-Zeile über `customer_card_id` und verwenden diese ID anschliessend für Guthaben-Transaktionen. Beim ersten echten Scan einer Karteninstanz muss der Betreiber Geschlecht und Altersgruppe auswählen; diese Werte werden auf `card_instances` gespeichert und in `scan_events` für anonymisierte Besucherstatistik protokolliert. Dabei bleibt `wallet_serial_number` plattformbewusst: Apple nutzt die Pass-Serial, Google behält die gespeicherte Wallet Object ID. Die Sync-, Guthaben-, `scan_events`- und `card_events`-Writes werden geprüft; ein fehlgeschlagener Persistenzschritt wird als strukturierter Scanner-Fehler gemeldet, statt dem Betreiber eine gespeicherte Bearbeitung vorzutäuschen. Dadurch bleibt der lokale Testpfad kompatibel mit dem Edge-Datenmodell, auch wenn `customer_cards.id` und `card_instances.id` später auseinanderfallen.

Der lokale Node-Fallback nutzt für QR-PDF, Claim und Scanner explizite Template-/Karten-Select-Listen statt `*`. `pass_authentication_token`, rohe Betreiber-/Business-Interna und Wallet-Secrets werden dadurch nicht unnötig in browsernahe lokale Antwortpfade geladen; ausgegeben wird weiterhin über `publicClaimCard(...)` bzw. `publicOperatorCard(...)`.

`card_events` validiert auch neutrale Events wie Claim- oder Wallet-Installationslogs gegen das referenzierte Business, Template und die Kundenkarte. So können Eventzeilen nicht auf fremde Karten oder Templates zeigen, selbst wenn der Eventtyp keine eigene Feature-Matrix-Regel hat. Neue Eventtypen brauchen ein kurzes Lowercase-Format, `details` bleibt ein JSON-Objekt unter 20 KB. Direkte Browser-Inserts sind deaktiviert; Audit-Events werden über Claim-/Scanner-/Wallet-Edge-Functions, RPCs oder Service-Role-Pfade geschrieben.

Der direkte Google-Provider normalisiert REST-API-Fehler zu `GOOGLE_WALLET_API_<STATUS>` mit `error_message`, `error_reason` und der Provider-Antwort im Log. Token-Signing-, OAuth-Request- und Wallet-API-Netzwerkfehler werden ebenfalls strukturiert als `GOOGLE_WALLET_TOKEN_SIGNING_FAILED`, `GOOGLE_WALLET_SAVE_LINK_SIGNING_FAILED`, `GOOGLE_WALLET_TOKEN_REQUEST_FAILED` oder `GOOGLE_WALLET_API_REQUEST_FAILED` zurückgegeben, ohne Access Tokens, Private Keys oder Service-Account-JSON zu leaken. Dadurch zeigt die Versandhistorie keine rohen, schwer lesbaren Google-Fehler mehr an.

Der Kampagnenversand nutzt denselben Google-Fallback: Wenn `TEXT_AND_NOTIFY` für eine Empfängerkarte nicht funktioniert, versucht der Service ein `google_object_message_fallback`-Kartenupdate und zeigt die Warnung anschliessend in der Versandhistorie an. Fallbacks werden nicht als `google_text_and_notify` geloggt, damit das Google-24h-Limit nur echte notification-triggering Messages zählt; sie erhöhen auch nicht `card_instances.notification_count_24h`. Erfolgreiche Google-Kampagnenmessages und Standort-/Text-Fallbacks aktualisieren zusätzlich die exakt passende `google_wallet_objects`-Zuordnung.

Die Versandhistorie im Editor liest pro Kampagne nur minimierte Felder aus `wallet_notification_campaigns`, `wallet_notification_recipients` und `wallet_push_logs`: Kampagnen-Metadaten, Status, Plattform, Action, Fehlercode, Fehlermeldung und Zeitpunkte. Die SQL-Rechte für die Rolle `authenticated` sind zusätzlich auf diese sicheren History-Spalten begrenzt; rohe `target_filter`, `provider_response`, `request_payload`, `response_payload` und Queue-`payload` bleiben serverseitig für Edge Functions, Service Role und gezielte Admin-Debugging-Abfragen. Auch `customer_cards.pass_authentication_token`, direkte Browser-Updates auf `customer_cards`, direkte Browser-Updates auf `wallet_notification_campaigns`, Apple-Registrierungs-Hashes, Device-Push-Token, rohe Apple-Pass-JSON/Assets, Google-`save_url`, Legacy-Job-`details`, direkte `card_instances`-Writes, direkte `wallet_update_jobs`-Updates, direkte `wallet_device_registrations`-Inserts/-Updates, direkte `card_events`-Inserts sowie direkte Browser-Inserts/-Updates für Guthaben- und Topup-Tabellen werden nicht an normale Browser-Clients gegrantet. Dashboard, Editor, Scanner und Reichweitenvorschau laden Profil-, Business-, Template-, Kunden- und Karteninstanzdaten mit expliziten sicheren Select-Listen statt `*`; `scripts/verify-browser-secret-boundary.js` blockiert neue Browser-Wildcard-Selects. Kampagneninhalte, Kartenstatus, Wallet-Identität, Push-Status, Zähler, Device-Registrierungen, Audit-Events, Guthabenbewegungen und Zahlungsbestätigungen werden nur über Edge Functions, SQL-Trigger, RPCs oder Service-Role-Pfade geschrieben. Dadurch sieht der Betreiber Empfängerstatus, Provider-Fehler, Plattform-Fallbacks und Audit-Probleme direkt am Template, ohne rohe Provider-/Audit-Payloads oder Wallet-Secrets in den Browser zu laden. Zentrale Kampagnen-/Queue-Logs und direkte Apple-/Google-Issue-, Claim-, Save-Link-, Send- und Update-Logs prüfen den Supabase-Insert; ein fehlgeschlagener Audit-Log wird als `WALLET_PUSH_LOG_INSERT_FAILED` sichtbar statt still ignoriert.

Auch die Core-Tabellenrechte sind spaltenbasiert: `operator_profiles`, `businesses` und `card_templates` bekommen keine pauschalen Browser-Grants mehr. `unlock` und `owner_id` bleiben dadurch ausserhalb normaler Browser-Updates; Business- und Template-Zuordnungen werden zusätzlich durch RLS und SQL-Trigger validiert.

`wallet_push_logs.wallet_platform` nutzt für echte Wallet-Provider weiterhin `apple` und `google`; rein kampagnenweite Audit-Ereignisse ohne Karteninstanz, z. B. `resolve_recipients` ohne Treffer oder `scheduled_campaign_failed`, werden als `system` protokolliert. Sobald ein Log eine `card_instance_id` hat, erzwingt der SQL-Trigger weiterhin, dass die Plattform exakt zur Karteninstanz passt.

`wallet_push_logs` wird zusätzlich in SQL abgesichert: neue Logs brauchen einen Snake-Case-`action`, einen bekannten strukturierten Status wie `sent`, `failed`, `queued`, `partially_failed` oder `skipped` und JSON-Objekt-Payloads unter 20 KB. Die Constraints sind migrationsfreundlich als `not valid` angelegt, damit alte Log-Historie nicht gescannt wird, neue Datensätze aber sauber bleiben.

Der Editor ruft vor dem Versand `check-wallet-notification-limits` auf und zeigt die autoritativen Preflight-Zahlen an: erreichbare Karten, nicht erreichbare Karten, deaktivierte Push-Karten, limitierte Karten, Apple-Anteil, Google-Anteil und Apple-Karten ohne registriertes Gerät. Einzelkarten-Limitprüfungen laden nur die nötigen Karteninstanzfelder für Betreiber-/Business-Bezug, Plattform, Push-Opt-out und Kundenlimit; Kampagnen-Resolve lädt nur Zielgruppe, Filter, Versandart und Status. Edge-Preflight und Kampagnen-Resolve laden `card_instances` seitenweise, damit Betreiber mit mehr als 1'000 Wallet-Karten nicht durch ein statisches Supabase-Antwortlimit abgeschnitten werden. Die Apple-Registrierungszählung filtert serverseitig nach `owner_id`, `business_id` und `card_instance_id`, damit fremde Device-Registrierungen nicht in die Reichweitenanzeige eines Betreibers einfliessen. Die Warnbox trennt `PUSH_DISABLED`, sonstige technische Nicht-Erreichbarkeit, Plattformlimits und Apple-Registrierungsfallbacks, damit Betreiber vor dem Versand sehen, warum Empfänger nicht direkt benachrichtigt werden. Der Preflight simuliert auch das verbleibende Business- und Kunden-Tageslimit für Bulk-Kampagnen, damit eine Auswahl mit mehr Empfängern als Restkontingent schon vor dem Versand als teilweise limitiert sichtbar wird. Das Kundenlimit gruppiert über `card_instances.customer_id`, wenn vorhanden, sonst über die verknüpfte `customer_card_id`; damit bleibt das MVP ohne Endkunden-Account nutzbar und ist für echte Kundenidentitäten vorbereitet. Der optionale Zeitraum wird als `target_filter.activeFrom`/`activeUntil` übergeben und serverseitig mit demselben Filter geprüft wie die lokale Reichweitenvorschau. Beim Klick auf „Wallet-Benachrichtigung erstellen“ wird derselbe Preflight mit dem aktuellen Formularstand inklusive geplanter Zeit und Standortdaten erneut ausgeführt; echte Null-Reichweite, ungültige `scheduled`/`location_based` Felder und Sofortversand ohne aktuell erlaubte Empfänger werden vor dem Kampagnen-Create blockiert.

Einzelkarten-Limitprüfungen verwenden standardmässig die gespeicherte `card_instances.wallet_platform`. Wenn eine Plattform explizit gesendet wird, muss sie `apple` oder `google` sein und zur Karte passen. Die Limit-Zähler filtern ausserdem nach `owner_id` und `business_id`, damit fremde Audit-Logs nicht in Tageslimits einfliessen. Das Kundenlimit zählt Wallet-Logs aller Karteninstanzen mit derselben `customer_id` oder, falls noch keine Endkundenidentität existiert, derselben `customer_card_id`.

Im Editor kann der Betreiber entweder ein konkretes Template oder `Alle Templates / businessweit` auswählen. Businessweite Kampagnen zeigen nur allgemeine Zielgruppen wie alle aktiven Karten, nur Apple Wallet oder nur Google Wallet; Stempel-, Streak-, VIP-, Guthaben-, Garderoben-, Event-, Coupon- und Mitgliedschaftsfilter bleiben an ein passendes Template gebunden. Event-Zielgruppen können zusätzlich nach Event-ID und/oder Eventname eingegrenzt werden.

Die Template-Feature-Matrix erlaubt Wallet-Benachrichtigungen für alle aktuellen Kartentypen. Ein einzelnes Template kann sie aber über `settings.notificationsEnabled = false` oder `settings.features.notifications = false` deaktivieren; dann blenden Editor, Edge-Preflight, Empfänger-Resolve und SQL-Trigger Kampagnen für dieses Template aus bzw. blockieren sie.
Wählt der Betreiber im Editor ein Template mit deaktivierten Benachrichtigungen, bleibt das Wallet-Benachrichtigungs-Panel sichtbar, aber alle Sendefelder ausser dem Template-Dropdown werden gesperrt und eine klare Hinweismeldung wird angezeigt. Dadurch kann er direkt auf `Alle Templates / businessweit` oder ein anderes Template wechseln, ohne dass die Edge-/SQL-Guards aufgeweicht werden.

`/api/config` gibt für den Editor nur nicht-sensitive Delivery-Rule-Felder aus: Business-, Kunden- und Karten-Tageslimits, Google-`TEXT_AND_NOTIFY`-Limit, Deduplizierungsfenster, `defaultTitle`, `defaultMessage` und `allowedTargets`. Service Role Keys, Apple-Zertifikate/APNS-Werte, Google-Service-Account-Daten und PassKit-Felder bleiben serverseitig.

Google Objects und Save-Links enthalten Statusmodule für Stempel, Streak, VIP, Guthaben, Garderobe, Event/Check-in, Coupon, Mitgliedschaft, Karten-ID und den Belohnungstext, sofern er für die Karte sichtbar ist.

Wiederholtes oder paralleles Senden derselben Kampagne ist gegen versehentliches Doppelsenden gehärtet: bestehende Empfänger bleiben in ihrem Status, werden nicht erneut auf `pending` gesetzt und vor dem Provider-Aufruf atomar von `pending` auf `processing` geclaimt. Wenn ein paralleler Send-Lauf einen Empfänger bereits geclaimt hat, schreibt der übersprungene Lauf einen `recipient_already_claimed` Audit-Log, ohne den laufenden Empfängerstatus zu überschreiben. Wenn eine Edge Function während des Provider-Aufrufs abbricht, werden hängende Empfänger beim nächsten Send-Lauf nach `WALLET_RECIPIENT_PROCESSING_TIMEOUT_MINUTES` Minuten, Default `15`, wieder auf `pending` gesetzt.

`walletNotificationService.schedule()` ist ebenfalls abgesichert: Nur `draft`/`scheduled` Kampagnen mit `scheduled` oder `location_based` Versandart können geplant werden, Business-Isolation und Pflichtfelder werden erneut geprüft, und fehlende Empfänger werden vor dem Planen aufgelöst.

`process-wallet-update-queue` claimt fällige Jobs atomar und prüft danach die Karteninstanz erneut gegen Betreiber, Business und Wallet-Plattform. Pending-Jobs mit `next_attempt_at = null` gelten als sofort fällig, damit alte oder manuell angelegte Jobs nicht hängen bleiben. Retry-fähige Providerfehler werden über `next_attempt_at` mit 15, 30 und maximal 60 Minuten Backoff erneut eingeplant; nicht retry-fähige Strukturfehler, z. B. fehlende Google Object IDs oder ungültige Queue-Patches, werden direkt als `failed` abgeschlossen. Die Function-Antwort enthält pro Job nur eine minimierte `provider_result`-Zusammenfassung; rohe APNS-/Google-Providerantworten bleiben ausschliesslich im serverseitigen Audit-Log.

`send-wallet-notification` kann geplante Kampagnen nicht vorzeitig auslösen. Der zentrale Service blockiert terminale Kampagnen (`sent`, `partially_failed`, `failed`, `cancelled`) und gibt für zu frühe `scheduled`/`location_based` Kampagnen `CAMPAIGN_NOT_DUE` zurück. Fällige geplante und standortbasierte Kampagnen frischen ihre Empfänger direkt vor dem Versand erneut auf, damit neu hinzugekommene passende Karten berücksichtigt werden. Fällige geplante Kampagnen laufen über `process-scheduled-wallet-notifications`.

Der Scheduled-Processor verarbeitet fällige Kampagnen voneinander getrennt: Wenn eine Kampagne unerwartet fehlschlägt, werden offene Empfänger als `failed` abgeschlossen, der Kampagnenstatus wird finalisiert und `scheduled_campaign_failed` wird in `wallet_push_logs` geschrieben. Trifft dieser Fehlerabschluss keine passende geplante oder sendende Kampagnenzeile mehr, meldet der Service `SCHEDULED_CAMPAIGN_FINALIZE_CONFLICT`. Die übrigen fälligen Kampagnen laufen weiter, und derselbe defekte Scheduled-Datensatz wird nicht bei jedem Cron-Lauf erneut verarbeitet. Die Cron-/Edge-Antwort enthält pro Kampagne nur Status, `result_summary`, Batch-/Recovery-Zähler und Truncation-Info; Empfänger-Detailantworten bleiben im direkten Editor-Sofortversand bzw. in den serverseitigen Logs.

Beim Senden prüft der Service die Business-Isolation ein zweites Mal: Empfänger müssen zu `owner_id`, `business_id` und `campaign_id` der Kampagne passen; die nachgeladene `card_instance` muss zum Business, optional zum Kampagnen-Template und zur gespeicherten Wallet-Plattform passen. Vor dem Provider-Aufruf wird jede Karte erneut gegen `notifications`, `target_type` und `target_filter` geprüft; Karten, die seit der Planung nicht mehr passen, werden als `RECIPIENT_NOTIFICATIONS_DISABLED` oder `RECIPIENT_TARGET_MISMATCH` übersprungen. `card_instances.push_enabled = false` ist ein hartes Opt-out: Resolve schliesst diese Karten aus, Preflight zeigt sie als nicht erreichbar, und vorhandene/manipulierte Empfänger werden als `PUSH_DISABLED` mit Status `skipped` geloggt. Manipulierte Recipient- oder Kartenreferenzen werden als fehlgeschlagener Empfänger geloggt und nicht an Apple oder Google gesendet. Direkte Operator-Functions für Issue, Update, Push und Limit-Preflight filtern `card_instances` bzw. `google_wallet_objects` ebenfalls nach `owner_id` und aktueller `business_id`.

Kampagnenstatus und Empfängerzählung werden beim Versand ebenfalls nur mit passendem `owner_id`, `business_id` und `campaign_id` aktualisiert. Der Zwischenstatus `sending` wird nicht mehr allein über die Kampagnen-ID gesetzt; wenn beim Start keine passende sendbare Kampagnenzeile getroffen wird, bricht der Service mit `CAMPAIGN_SEND_START_CONFLICT` ab.

`supabase/schema.sql` prüft Kampagnen-Zielgruppen auch datenbankseitig: Template-Zielgruppen brauchen ein Template, featurebasierte Zielgruppen werden gegen `template_feature_allowed(...)` validiert und Templates ohne `notifications` werden für Kampagnen blockiert. `target_filter` muss auch in SQL ein JSON-Objekt bleiben, ist auf 2000 Zeichen begrenzt und darf nur die zur ausgewählten Zielgruppe passenden Filterfelder enthalten; Datumsfilter sind allgemein erlaubt, Fachfilter wie `min/max`, `vipLevel`, `eventId` oder `membershipStatus` nur bei der jeweiligen Zielgruppe. Nicht-negative Min-/Max-Werte, ISO-Datumsbereiche und Textlängen werden anschliessend validiert. Kampagnen-Identitätsfelder wie `owner_id`, `business_id`, `created_by`, `created_at` und `idempotency_key` werden nach dem Insert nicht mehr verschoben.

Das finale Empfängerstatus-Update ist ebenfalls abgesichert: Es greift nur, wenn `owner_id`, `business_id`, `campaign_id`, `card_instance_id`, `wallet_platform` und ein offener Status (`pending` oder `processing`) noch zusammenpassen. Andernfalls wird ein Audit-Eintrag geschrieben und keine Kartenstatistik erhöht.

`supabase/schema.sql` schützt diese Zuordnungen zusätzlich mit SQL-Triggern. Kampagnen, Empfänger, Audit-Logs, Apple-Pass-Versionen, Apple-Registrierungen, Google-Wallet-Objects und Queue-Jobs werden gegen Business, Template, Karteninstanz und Wallet-Plattform validiert, auch wenn sie serverseitig mit Service Role geschrieben werden. Audit-Logs ohne Karteninstanz bleiben erlaubt, wenn sie nur eine Kampagne betreffen.

Die 10-Minuten-Deduplizierung für neu erstellte Kampagnen vergleicht nicht nur Titel und Nachricht, sondern auch Template, Zieltyp, Zielgruppenfilter, Versandart, geplanten Zeitpunkt und Standortparameter. So wird eine wirklich doppelte Kampagne abgefangen, aber z. B. ein anderer Stempelbereich oder Eventfilter nicht fälschlich blockiert.

Die `wallet_update_queue` nutzt denselben Schutz für vorbereitete Apple-/Google-Updates: Jobs werden vor dem Provider-Aufruf atomar geclaimt, danach gegen die geladene `card_instance` mit `owner_id`, `business_id`, `card_instance_id` und `wallet_platform` abgeglichen, parallele Cron-Aufrufe überspringen bereits geclaimte Jobs und hängende Queue-Jobs werden nach `WALLET_QUEUE_PROCESSING_TIMEOUT_MINUTES`, Default `15`, wieder freigegeben. Abschluss und Retry laufen über `finalizeQueueJobProcessing(...)`; wenn `id`, `owner_id`, `business_id` und `status = processing` nicht mehr zusammenpassen, wird `QUEUE_STATUS_UPDATE_CONFLICT` gemeldet. Jobs mit falscher Karten- oder Plattformzuordnung werden als nicht retrybare Konsistenzfehler beendet. Strukturierte Providerfehler mit `ok: false` werden wie Exceptions bis zu drei Mal retrybar behandelt, sofern sie nicht zu den bekannten nicht-retrybaren Payload-/Konsistenzfehlern gehören. Sobald ein Queue-Job nach dem Provider-Aufruf finalisiert wurde, lösen nachgelagerte Audit-/State-Sync-Fehler keinen zweiten Provider-Aufruf und keinen Queue-Retry mehr aus; sie werden als `queue_post_finalize_error` oder `queue_card_wallet_state_sync_failed` separat auditiert, soweit der Audit-Log noch geschrieben werden kann.

Neue Queue-Jobs werden SQL-seitig auf Snake-Case-`update_type` und JSON-Objekt-Payloads unter 20 KB begrenzt. Apple-Pass-Updates prüfen den Queue-Insert direkt und melden `APPLE_WALLET_QUEUE_INSERT_FAILED`, falls zwar eine Pass-Version erstellt wurde, der Push-Queue-Job aber nicht gespeichert werden konnte.

Auch Abschluss und Retry eines Queue-Jobs sind an `id`, `owner_id`, `business_id` und `status = processing` gebunden. Damit kann ein fremder, verschobener oder bereits verarbeiteter Job nicht nachträglich überschrieben werden.

Scanner- und Kartenstatus-Aenderungen schreiben neben dem alten lokalen `wallet_update_jobs`-Eintrag auch einen direkten `wallet_update_queue`-Job. Der SQL-Trigger synchronisiert `card_instances` innerhalb derselben Datenbankaktion aus `customer_cards`, bevor der Queue-Job angelegt wird; dadurch verarbeitet der Cron keine veralteten Stempel-, Streak-, VIP-, Guthaben- oder Garderobenwerte. Vorhandene Scan-Zeitpunkte bleiben erhalten, wenn ein fachliches Update ohne neuen Scan eintrifft. Bei Apple erzeugt der Processor daraus vor dem APNS-Push eine neue Pass-Version; bei Google wird das gespeicherte Wallet Object mit dem aktuellen Status-Patch aktualisiert, die lokale `google_wallet_objects`-Zuordnung nach erfolgreichem Provider-Patch berührt und die Karteninstanz auf dieselbe echte Google Object ID synchronisiert. Der Queue-Trigger berechnet die Wallet-Serial plattformbewusst: Apple zuerst aus `pass_serial_number`, Google zuerst aus `wallet_object_id`. Guthaben-Topups und Guthaben-Abbuchungen synchronisieren `card_instances` ebenfalls plattformbewusst: Apple nutzt die Pass-Serial, Google behält `wallet_object_id`/`google_object_id` als Wallet Object Bezug. Erfolgreiche oder vorbereitete Queue-Syncs setzen `last_wallet_update_at`, zählen aber nicht als sichtbare Wallet-Nachricht und erhöhen kein Nachrichtenlimit.

Zielgruppenfilter werden serverseitig validiert: unbekannte Felder, zu grosse JSON-Payloads, ungültige Zahlenbereiche und falsche Datumsspannen werden abgelehnt, bevor Empfänger aufgelöst oder Provider aufgerufen werden.

Der Apple Wallet Web Service erwartet bei Registrierungen, Abmeldungen und Pass-Abrufen den Header `Authorization: ApplePass <authenticationToken>`. Diese Endpunkte lösen Seriennummern zuerst über `card_instances.apple_serial_number` und, für alte Pass-Versionen, über `card_instances.id` auf; erst danach folgen die Legacy-Felder auf `customer_cards`. Kundenkarten werden nur mit `wallet_platform = apple` geladen. Der Webservice vergleicht den ApplePass-Token hashbasiert und timing-safe gegen den gespeicherten `customer_cards.pass_authentication_token`, bevor Kontextdaten oder Pass-Versionen ausgeliefert werden. Der Webservice prüft den Kontext zwischen `customer_cards` und `card_instances` auf denselben Betreiber, dasselbe Business und dasselbe Template und validiert Seriennummer sowie Pass Type ID gegen die gespeicherte Apple-Karteninstanz bzw. letzte Pass-Version. Neue Device-Registrierungen antworten mit `201`, erneute Registrierungen desselben Device/Pass-Paares mit `200`. Bevor eine vorhandene Device/Pass/Serial-Registrierung aktualisiert wird, prüft der Provider Betreiber, Business, Template und Karteninstanz; ein Mismatch liefert `APPLE_WALLET_REGISTRATION_CONTEXT_MISMATCH`, statt die Registrierung auf eine andere Karte umzuhängen. Abmeldungen filtern den Delete zusätzlich nach Betreiber, Business, Template und Karteninstanz, bleiben idempotent und melden `removed: true` nur, wenn Supabase wirklich eine passende Registrierung gelöscht hat. Wenn der Device-/Push-Token-Datensatz nicht gespeichert werden kann, liefert der Provider `APPLE_WALLET_DEVICE_SAVE_FAILED`, statt eine Registrierung ohne Push-Ziel vorzutäuschen. Die Liste geänderter Seriennummern (`GET /v1/devices/.../registrations/:passTypeIdentifier`) wird gemäss Apple-Update-Flow über `deviceLibraryIdentifier` und `passTypeIdentifier` aufgelöst, weil dort kein eindeutiger pro-Pass-Token mitgesendet wird; Pass-Versionen werden dabei nur für die registrierten `card_instance_id`/`serial_number`-Paare dieses Devices gelesen, und `lastUpdated` entspricht dem neuesten echten `apple_pass_versions.last_updated_at` der zurückgegebenen Seriennummern. Pass-Downloads lesen die aktuelle Pass-Version nach erfolgreicher ApplePass-Auth zusätzlich mit Betreiber-, Business-, Template- und Karteninstanz-Filtern, beachten `If-Modified-Since` und liefern `304`, wenn Apple bereits die aktuelle Version hat. Webservice und Apple-Provider nutzen dafür explizite Select-Listen statt roher `*`-Relationen; Registrierungsantworten geben keinen `authentication_token_hash` zurück. In `apple_wallet_registrations` wird nur der SHA-256-Hash des Tokens gespeichert; der Klartext bleibt auf der individuellen Kundenkarte, damit Apple den Pass weiterhin abrufen kann.

`apple-wallet-webservice` akzeptiert ausserdem `GET` und `POST` auf `/v1/log`. POST-Diagnosezeilen von Apple werden in den Supabase Function Logs ausgegeben; sie werden nicht ins Frontend gereicht und verbrauchen keine Wallet-Nachrichtenlimits.

Apple-Webservice-Ereignisse werden ebenfalls in `wallet_push_logs` protokolliert: `apple_device_registered`, `apple_device_unregistered`, `apple_changed_serials_listed`, `apple_pass_downloaded`, `apple_pass_not_modified` und `apple_pass_download_failed`. Damit sieht der Betreiber später nicht nur Kampagnen, sondern auch, ob ein iPhone den Pass registriert, geänderte Seriennummern gesehen und aktualisierte Pass-Dateien abgeholt hat.

Supabase Secrets für direkte Wallet-Benachrichtigungen:

```text
APPLE_TEAM_ID
APPLE_PASS_TYPE_ID
APPLE_WWDR_CERT
APPLE_PASS_CERT
APPLE_PASS_KEY
APPLE_PASS_KEY_PASSWORD
APPLE_WEB_SERVICE_BASE_URL
APPLE_APNS_KEY_ID
APPLE_APNS_TEAM_ID
APPLE_APNS_AUTH_KEY
GOOGLE_WALLET_ISSUER_ID
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON
GOOGLE_WALLET_CLASS_SUFFIX
GOOGLE_WALLET_ORIGINS
SAMSUNG_WALLET_PARTNER_ID
SAMSUNG_WALLET_PARTNER_CODE
SAMSUNG_WALLET_CARD_ID
SAMSUNG_WALLET_CARD_TYPE
SAMSUNG_WALLET_CARD_SUB_TYPE
SAMSUNG_WALLET_CERTIFICATE_ID
SAMSUNG_WALLET_COUNTRY_CODE
SAMSUNG_WALLET_ENV
SAMSUNG_WALLET_ADD_FLOW
SAMSUNG_WALLET_PRIVATE_KEY_PEM
SAMSUNG_WALLET_SAMSUNG_PUBLIC_KEY_PEM
SAMSUNG_WALLET_RD_CLICK_URL
SAMSUNG_WALLET_RD_IMPRESSION_URL
SAMSUNG_WALLET_LOGO_URL
SAMSUNG_WALLET_PARTNER_SERVER_URL
SAMSUNG_WALLET_ALLOW_UNVERIFIED_AUTH
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APP_PUBLIC_BASE_URL
PAYMENT_PROVIDER
PAYMENT_CHECKOUT_BASE_URL
PAYMENT_WEBHOOK_SECRET
WALLET_CRON_SECRET
WALLET_BUSINESS_DAILY_LIMIT
WALLET_CUSTOMER_DAILY_LIMIT
WALLET_CARD_DAILY_LIMIT
WALLET_GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H
WALLET_DUPLICATE_WINDOW_MINUTES
WALLET_PUBLIC_CLAIM_RATE_LIMIT
WALLET_PUBLIC_CLAIM_RATE_LIMIT_WINDOW_SECONDS
WALLET_RECIPIENT_PROCESSING_TIMEOUT_MINUTES
WALLET_QUEUE_PROCESSING_TIMEOUT_MINUTES
```

Beispiel für die Apple-Webservice-URL:

```text
APPLE_WEB_SERVICE_BASE_URL=https://<PROJECT_REF>.supabase.co/functions/v1/apple-wallet-webservice
```

Wichtig: Nach dem Function-Namen kein weiteres `/v1` anhängen. Apple Wallet ruft danach selbst Pfade wie `/v1/devices/...` und `/v1/passes/...` auf. Lokal mit `http://localhost:3000` können iPhones den Webservice nicht erreichen; für echte Updates brauchst du HTTPS, z. B. die deployte Supabase Edge Function oder einen Tunnel.

Vorlage für Supabase Secrets:

```bash
node scripts/prepare-supabase-secrets-local.js
node scripts/prepare-supabase-secrets-local.js --write
bash scripts/set-supabase-secrets.sh --dry-run
bash scripts/set-supabase-secrets.sh
```

`prepare-supabase-secrets-local.js` uebernimmt vorhandene lokale Supabase-Werte, Apple-Team-/Pass-Type-Werte aus `config.json`, die PEM-Dateien aus `certs/`, Google-Issuer-/Service-Account-Dateien, Samsung-Portalwerte aus den lokalen Samsung-Env-Dateien, `samsung-wallet-keys/samsung_wallet_private.key` und `samsung-wallet-keys/samsung_public_cert.pem`. Es leitet `APPLE_WEB_SERVICE_BASE_URL` und `SAMSUNG_WALLET_PARTNER_SERVER_URL` aus der Supabase-URL ab und erzeugt sichere lokale Werte für `PAYMENT_WEBHOOK_SECRET` und `WALLET_CRON_SECRET`. Fehlende externe Werte wie `APPLE_APNS_KEY_ID`, `APPLE_APNS_AUTH_KEY`, `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` oder ein Samsung Private Key, der nicht zum Partner-Zertifikat passt, schreibt es nur als Kommentar in die Datei, damit keine Platzhalter versehentlich als echte Supabase Secrets gesetzt werden. Secret-Werte werden dabei nicht in der Konsole ausgegeben.

`set-supabase-secrets.sh` setzt die fertige `supabase/secrets.local.env` redigiert in Supabase. Es nutzt denselben CLI-Fallback wie der Function-Deploy (`supabase`, `pnpm dlx supabase`, `npx --yes supabase` oder `SUPABASE_CLI_BIN`), leitet die Project Ref aus `config.json -> supabase.url` ab und prüft vor echten Writes die Supabase-CLI-Auth. Für echte Writes brauchst du `supabase login` oder `SUPABASE_ACCESS_TOKEN`; `--skip-auth-check` überspringt nur den Preflight.

Manuelle Alternative:

```bash
cp supabase/secrets.example.env supabase/secrets.local.env
# supabase/secrets.local.env ausfüllen
bash scripts/set-supabase-secrets.sh
# Direkte Alternative:
supabase secrets set --env-file supabase/secrets.local.env
```

`supabase/secrets.example.env` ist die vollständige, redigierte Feldliste für Apple Developer Daten, Google Wallet Daten, Samsung Wallet Daten, Public URLs, Cron, Payment und Versandregeln. `supabase/secrets.local.env` ist in `.gitignore` und darf echte Werte enthalten. Für Zertifikate, p8-Keys, Samsung-PEM-Dateien und Google-Service-Account-JSON ist der Einzelbefehl mit `$(cat ...)` oft robuster, wenn du Werte bewusst einzeln setzen willst.

Beispiel für Secrets:

```bash
supabase secrets set SUPABASE_URL="https://<PROJECT_REF>.supabase.co"
supabase secrets set SUPABASE_ANON_KEY="..."
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="..."
supabase secrets set APP_PUBLIC_BASE_URL="https://deine-domain.ch"
supabase secrets set APPLE_TEAM_ID="..."
supabase secrets set APPLE_PASS_TYPE_ID="pass.com.deinefirma.walletcards"
supabase secrets set APPLE_WWDR_CERT="$(cat certs/AppleWWDRCAG4.pem)"
supabase secrets set APPLE_PASS_CERT="$(cat certs/pass-cert.pem)"
supabase secrets set APPLE_PASS_KEY="$(cat certs/pass-key.pem)"
supabase secrets set APPLE_PASS_KEY_PASSWORD="..."
supabase secrets set APPLE_WEB_SERVICE_BASE_URL="https://<PROJECT_REF>.supabase.co/functions/v1/apple-wallet-webservice"
supabase secrets set APPLE_APNS_KEY_ID="..."
supabase secrets set APPLE_APNS_TEAM_ID="..."
supabase secrets set APPLE_APNS_AUTH_KEY="$(cat certs/AuthKey_XXXXXXXXXX.p8)"
supabase secrets set GOOGLE_WALLET_ISSUER_ID="..."
supabase secrets set GOOGLE_WALLET_SERVICE_ACCOUNT_JSON="$(cat google-service-account.json)"
supabase secrets set GOOGLE_WALLET_CLASS_SUFFIX="wallet_cards_mvp"
supabase secrets set GOOGLE_WALLET_ORIGINS="https://deine-domain.ch"
supabase secrets set SAMSUNG_WALLET_PARTNER_ID="..."
supabase secrets set SAMSUNG_WALLET_PARTNER_CODE="..."
supabase secrets set SAMSUNG_WALLET_CARD_ID="..."
supabase secrets set SAMSUNG_WALLET_CARD_TYPE="loyalty"
supabase secrets set SAMSUNG_WALLET_CARD_SUB_TYPE="others"
supabase secrets set SAMSUNG_WALLET_CERTIFICATE_ID="..."
supabase secrets set SAMSUNG_WALLET_COUNTRY_CODE="CH"
supabase secrets set SAMSUNG_WALLET_ENV="sandbox"
supabase secrets set SAMSUNG_WALLET_ADD_FLOW="data_fetch"
# Oder "cdata", wenn der Samsung Partner Portal Script Guide cdata="${CARD DATA as JWT}" zeigt.
supabase secrets set SAMSUNG_WALLET_PRIVATE_KEY_PEM="$(cat samsung-wallet-keys/samsung_wallet_private.key)"
supabase secrets set SAMSUNG_WALLET_SAMSUNG_PUBLIC_KEY_PEM="$(cat samsung-wallet-keys/samsung_public_cert.pem)"
supabase secrets set SAMSUNG_WALLET_RD_CLICK_URL="https://us-rd.mcsvc.samsung.com/statistics/click/addtowlt?..."
supabase secrets set SAMSUNG_WALLET_RD_IMPRESSION_URL="https://us-rd.mcsvc.samsung.com/statistics/impression/addtowlt?..."
supabase secrets set SAMSUNG_WALLET_LOGO_URL="https://deine-domain.ch/assets/logo.png"
supabase secrets set SAMSUNG_WALLET_PARTNER_SERVER_URL="https://<PROJECT_REF>.supabase.co/functions/v1/samsung-wallet-server"
supabase secrets set SAMSUNG_WALLET_ALLOW_UNVERIFIED_AUTH="false"
supabase secrets set PAYMENT_PROVIDER="manual"
supabase secrets set PAYMENT_CHECKOUT_BASE_URL=""
supabase secrets set PAYMENT_WEBHOOK_SECRET="$(openssl rand -hex 32)"
supabase secrets set WALLET_CRON_SECRET="$(openssl rand -hex 32)"
supabase secrets set WALLET_BUSINESS_DAILY_LIMIT="500"
supabase secrets set WALLET_CUSTOMER_DAILY_LIMIT="12"
supabase secrets set WALLET_CARD_DAILY_LIMIT="6"
supabase secrets set WALLET_GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H="3"
supabase secrets set WALLET_DUPLICATE_WINDOW_MINUTES="10"
supabase secrets set WALLET_PUBLIC_CLAIM_RATE_LIMIT="80"
supabase secrets set WALLET_PUBLIC_CLAIM_RATE_LIMIT_WINDOW_SECONDS="900"
supabase secrets set WALLET_RECIPIENT_PROCESSING_TIMEOUT_MINUTES="15"
supabase secrets set WALLET_QUEUE_PROCESSING_TIMEOUT_MINUTES="15"
```

Lokale Readiness-Vorprüfung ohne Secret-Ausgabe:

```bash
node scripts/wallet-go-live-report.js
node scripts/wallet-go-live-report.js --skip-remote
node scripts/wallet-go-live-runbook.js --write --force
node scripts/wallet-sql-editor-apply-report.js
node scripts/wallet-edge-functions-report.js
node scripts/wallet-credential-files-check.js
node scripts/wallet-readiness-report.js
node scripts/wallet-readiness-report.js --strict
```

`Wallet Go-Live Report` fasst lokale Secret-Datei, SQL-Editor-Bundle, Readiness, Remote-Schema-Check, Edge-Function-Preflights und den lokalen Supabase-Deploy-CLI-Status in einer redigierten Ausgabe zusammen. Mit `--skip-remote` läuft er ohne Live-Supabase-Abfrage. `Wallet Go-Live Runbook` erzeugt mit `node scripts/wallet-go-live-runbook.js --write --force` eine aktuelle Markdown-Checkliste unter `tmp/wallet-go-live-runbook.md`, die Secrets, SQL, Edge Functions und finale Abnahmen in der richtigen Reihenfolge bündelt. `Wallet SQL Editor Apply Report` ist der fokussierte Helfer für genau den SQL-Editor-Schritt: `node scripts/wallet-sql-editor-apply-report.js` listet Bundle, numerische Chunk-Reihenfolge, Zielprojekt und fehlende Remote-Schema-Tabellen, ohne Secrets auszugeben.

`Wallet Edge Functions Report` prüft mit `node scripts/wallet-edge-functions-report.js` alle deployten Wallet Edge Functions per CORS/OPTIONS-Preflight gegen `config.example.json -> publicUrls.supabaseFunctionBaseUrl` bzw. `config.json`. Öffentliche Functions müssen `200` oder `204` liefern; geschützte Betreiber-Functions dürfen bei Preflight auch `401` oder `403` liefern. Der Report sendet keine Operator-JWTs, Supabase Keys, Apple-/Google-Secrets oder Wallet-Tokens.

`Wallet Credential Files Check` prüft lokal, ob Apple WWDR, Apple Pass-Zertifikat und Private Key lesbar sind und ob der Private Key zum Pass-Zertifikat passt. Sobald `certs/*.p8` und `google-service-account*.json` vorhanden sind oder die Werte in `supabase/secrets.local.env` stehen, validiert er auch APNs-Key- und Google-Service-Account-Form. Zertifikatsinhalte, Private Keys und JSON-Werte werden nicht ausgegeben.

Der Wallet Readiness Report liest `config.json` und optional gesetzte Umgebungsvariablen, zeigt aber nur Statusmeldungen wie `gesetzt` oder `fehlt`; Secret-Werte, Private Keys und Service-Account-JSON werden nicht ausgegeben. `--strict` beendet den Prozess mit Fehlercode, wenn produktionskritische Werte fehlen oder Platzhalter enthalten sind.

Cron-SQL für geplante Wallet-Benachrichtigungen vorbereiten:

```bash
node scripts/prepare-supabase-cron-sql.js
node scripts/prepare-supabase-cron-sql.js --write --force
bash scripts/apply-supabase-schema.sh --file tmp/supabase-cron.sql --dry-run
bash scripts/apply-supabase-schema.sh --file tmp/supabase-cron.sql
```

`prepare-supabase-cron-sql.js` erzeugt `tmp/supabase-cron.sql` aus `supabase/cron.example.sql`, setzt Project Ref und `WALLET_CRON_SECRET` ein, gibt den Secret-Wert nicht aus und druckt keine SQL-Inhalte. Die Datei liegt unter `tmp/`, weil sie den echten Cron-Secret-Wert enthält und nicht versioniert werden darf.

Smoke-Test für lokale oder produktive URLs ohne Secret-Ausgabe:

```bash
node scripts/wallet-local-smoke-runner.js --strict
node scripts/wallet-smoke-test.js
node scripts/wallet-smoke-test.js --base-url http://localhost:3000 --strict
node scripts/wallet-smoke-test.js --functions --functions-base-url https://<PROJECT_REF>.supabase.co/functions/v1 --strict
node scripts/wallet-smoke-test.js --all-functions --base-url https://deine-domain.ch --functions-base-url https://<PROJECT_REF>.supabase.co/functions/v1 --json
node scripts/wallet-edge-functions-report.js --functions-base-url https://<PROJECT_REF>.supabase.co/functions/v1
```

`wallet-local-smoke-runner.js` nutzt eine bestehende lokale Instanz auf `localhost:3000` oder startet kurz selbst einen lokalen Server auf einem freien Port und beendet ihn danach wieder. Der Smoke-Test prüft Webapp-Seiten wie `/api/config`, Dashboard, Editor, Scanner und Claim-Seite. Mit `--functions` prüft er zusätzlich die öffentlichen Edge-Function-Preflights für Claim, Apple-Webservice, Cron und Topup/Payment. Mit `--all-functions` prüft er auch Operator-Functions per Preflight; `401` oder `403` sind dort erlaubt, weil diese Functions nicht ohne Betreiber-Auth offen sein sollen. Die Scripts geben URLs, Statuscodes und CORS-Status aus, aber keine Secrets.

Nach echten Apple-/Google-/Cron-/Payment-Testaktionen kannst du im Supabase SQL Editor zusätzlich `supabase/acceptance-queries.sql` ausführen. Die Datei ist read-only und sammelt die wichtigsten Nachweise aus `apple_wallet_registrations`, `apple_pass_versions`, `google_wallet_objects`, `wallet_push_logs`, Kampagnen-, Queue-, Cron- und Topup-Tabellen.

Redigierter Acceptance-Audit aus der lokalen Konsole:

```bash
node scripts/prepare-supabase-sql-editor-bundle.js --write
node scripts/wallet-sql-editor-apply-report.js
node scripts/wallet-remote-schema-check.js
node scripts/wallet-remote-schema-check.js --strict
node scripts/wallet-acceptance-audit.js
node scripts/wallet-acceptance-audit.js --strict
node scripts/wallet-acceptance-audit.js --business-id <BUSINESS_UUID> --json
```

`Wallet Remote Supabase Schema Check` ist der schnelle Preflight vor echten Wallet-Tests. Er nutzt `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY`, prüft aber nur, ob alle erforderlichen Tabellen und Spalten im Supabase REST-Schema erreichbar sind. Secrets und Tokens werden nicht ausgegeben.

`Wallet External Acceptance Audit` nutzt `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` aus `config.json` oder der Umgebung, fragt nur Zählwerte und Statusnachweise ab und gibt keine Secrets, Wallet-Tokens, Save-JWTs, Zertifikate oder Push-Token aus. `--strict` ist für die finale Abnahme gedacht und schlägt fehl, solange Apple-/Google-/Kampagnen-/Queue-Nachweise fehlen. `supabase/acceptance-queries.sql` bleibt trotzdem wichtig, weil dort auch `cron.job` direkt im SQL Editor geprüft werden kann.

Wenn der Schema-Check oder Audit `Could not find the table ... in the schema cache` meldet, ist die lokale Projektstruktur vorhanden, aber dein Supabase-Projekt hat die aktuelle `supabase/schema.sql` noch nicht vollständig ausgeführt oder der REST-Schema-Cache ist noch alt. In diesem Fall `supabase/schema.sql` im Supabase SQL Editor erneut komplett ausführen, danach optional im SQL Editor `notify pgrst, 'reload schema';` ausführen und den Check wiederholen.

Falls der SQL-Editor-Schritt fehleranfällig ist, erzeugt `prepare-supabase-sql-editor-bundle.js` ein temporäres Bundle unter `tmp/supabase-schema-sql-editor-bundle.sql`, das Schema und Cache-Reload in einer Datei zusammenhält. `wallet-sql-editor-apply-report.js` zeigt danach, ob du besser dieses Bundle oder die Chunks in `tmp/supabase-schema-sql-editor-chunks/` nutzen solltest.

Direkte Wallet Edge Functions deployen:

Alle Functions mit Dry-Run oder echtem Deploy:

```bash
bash scripts/deploy-wallet-functions.sh --dry-run
bash scripts/deploy-wallet-functions.sh
bash scripts/deploy-wallet-functions.sh --project-ref <PROJECT_REF>
SUPABASE_PROJECT_REF=<PROJECT_REF> bash scripts/deploy-wallet-functions.sh --with-readiness
SUPABASE_CLI_BIN=/pfad/zur/supabase-cli bash scripts/deploy-wallet-functions.sh
bash scripts/deploy-wallet-functions.sh --skip-auth-check
```

Das Script setzt keine Secrets und gibt keine Secret-Werte aus. Wenn du `--project-ref` und `SUPABASE_PROJECT_REF` weglässt, leitet es die Project Ref aus `config.json -> supabase.url` ab, sofern diese URL auf dein echtes Supabase-Projekt zeigt. Wenn kein globaler `supabase` Befehl installiert ist, nutzt es automatisch `pnpm dlx supabase` oder danach `npx --yes supabase`; mit `SUPABASE_CLI_BIN` kannst du einen konkreten CLI-Pfad vorgeben. Vor echten Deploys prüft es per `supabase projects list`, ob die CLI authentifiziert ist; `--skip-auth-check` überspringt nur diesen Preflight, nicht die spätere Supabase-Auth beim Deploy. Es deployt nur die Edge Functions aus `supabase/functions/`, lässt `_shared` bewusst aus und erwartet, dass `supabase/config.toml` vorhanden ist, damit Public-, Apple-Webservice-, Payment-Webhook- und Cron-Pfade ihre `verify_jwt=false` Policy behalten.

Für den echten Deploy brauchst du ausserdem eine Supabase-CLI-Session, z. B. per `supabase login`, oder einen gesetzten `SUPABASE_ACCESS_TOKEN`. Ohne diese externe Anmeldung kann das Script die Deploy-Befehle nur vorbereiten oder im Dry-Run anzeigen.

Einzelbefehle, falls du bewusst manuell deployen willst:

```bash
supabase functions deploy claim-card
supabase functions deploy get-public-template
supabase functions deploy get-wallet-message
supabase functions deploy claim-apple-pass
supabase functions deploy register-operator
supabase functions deploy send-operator-verification-email
supabase functions deploy create-topup-payment-session
supabase functions deploy confirm-topup-payment
supabase functions deploy redeem-balance
supabase functions deploy apple-wallet-webservice
supabase functions deploy issue-apple-pass
supabase functions deploy update-apple-pass
supabase functions deploy send-apple-wallet-update
supabase functions deploy google-wallet-save-link
supabase functions deploy samsung-wallet-add-link
supabase functions deploy samsung-wallet-server
supabase functions deploy update-samsung-wallet-pass
supabase functions deploy issue-google-wallet-pass
supabase functions deploy update-google-wallet-pass
supabase functions deploy send-google-wallet-message
supabase functions deploy generate-card-pdf
supabase functions deploy create-wallet-notification-campaign
supabase functions deploy send-wallet-notification
supabase functions deploy resolve-wallet-notification-recipients
supabase functions deploy check-wallet-notification-limits
supabase functions deploy process-scheduled-wallet-notifications
supabase functions deploy process-wallet-update-queue
supabase functions deploy scanner-actions
supabase functions deploy get-business-scan-statistics
```

Die Datei `supabase/config.toml` ist Teil des Projekts und setzt `verify_jwt = false` nur für Functions, die von Apple Wallet, einer öffentlichen Claim-/Topup-Seite, einem Zahlungsprovider-Webhook oder Cron ohne Supabase-User-JWT aufgerufen werden:

```text
claim-card
get-public-template
get-wallet-message
claim-apple-pass
google-wallet-save-link
register-operator
send-operator-verification-email
samsung-wallet-add-link
samsung-wallet-server
update-samsung-wallet-pass
create-topup-payment-session
confirm-topup-payment
apple-wallet-webservice
process-scheduled-wallet-notifications
process-wallet-update-queue
```

Das ist notwendig, weil Supabase Edge Functions mit aktivem `verify_jwt` Requests ohne gültigen User-JWT bereits vor deinem Code mit `401` blockieren. Diese Functions prüfen stattdessen im eigenen Code den passenden Zugriff: Apple `Authorization: ApplePass <authenticationToken>`, Claim-Schlüssel aus der Karteninstanz, öffentlich rate-limitierte Template-Vorschau, Rate-Limit plus serverseitige User-Erstellung bei `register-operator`, Cron-Secret für die Betreiber-Verifizierung, `PAYMENT_WEBHOOK_SECRET` für Zahlungsbestätigungen oder `WALLET_CRON_SECRET`. Betreiber-Functions wie `create-wallet-notification-campaign`, `send-wallet-notification`, `scanner-actions`, `get-business-scan-statistics`, `issue-apple-pass`, `update-apple-pass`, `send-apple-wallet-update`, `issue-google-wallet-pass`, `update-google-wallet-pass` und `send-google-wallet-message` bleiben mit normaler Supabase-Auth abgesichert. `pnpm check` prüft diese Grenze mit `scripts/verify-supabase-edge-jwt-policy.js`, damit keine Operator-Function versehentlich `verify_jwt = false` bekommt.

Nach dem Deploy muss `config.json -> supabase.url` weiterhin auf dein Supabase-Projekt zeigen. Die Claim-Seite ruft Edge Functions über `https://<PROJECT_REF>.supabase.co/functions/v1/...` auf; für echte Apple-Updates muss `APPLE_WEB_SERVICE_BASE_URL` exakt auf die deployte `apple-wallet-webservice` Function zeigen.

Google-Wallet-Secrets für Supabase Edge Functions:

- `GOOGLE_WALLET_ISSUER_ID`, die Issuer-ID aus der Google Wallet API Console
- `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`, die komplette Service-Account-JSON-Datei als Secret; das ist der bevorzugte Weg
- `GOOGLE_WALLET_CLASS_SUFFIX`, z. B. `wallet_cards_mvp`; ergibt zusammen mit der Issuer-ID die Class-ID
- `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL` und `GOOGLE_WALLET_PRIVATE_KEY` werden nur noch als Legacy-Alternative zur JSON-Datei akzeptiert
- `GOOGLE_WALLET_ORIGINS`, optional, kommagetrennte erlaubte Origins, z. B. `https://deine-domain.ch,http://localhost:3000`; wenn leer, nutzen der direkte Google-Provider und `google-wallet-save-link` serverseitig `APP_PUBLIC_BASE_URL` als Origin-Fallback für Save-to-Google-Wallet-JWTs. Volle URLs mit Pfad werden vor dem Signieren auf ihre Origin normalisiert, z. B. `https://deine-domain.ch/app` wird zu `https://deine-domain.ch`.

Wenn `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` kein gültiges JSON ist oder `client_email`/`private_key` fehlen, geben die Google-Edge-Provider eine strukturierte Setup-Meldung zurück (`GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INVALID` oder `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_INCOMPLETE`) statt einen rohen JSON-Fehler in der UI anzuzeigen.

Ohne diese Google-Wallet-Secrets wird beim Klick trotzdem eine Supabase-Karteninstanz erstellt. Die Edge Function antwortet dann bewusst mit einer Setup-Meldung statt einen unechten Save-Link zu bauen.

Cron für geplante Wallet-Benachrichtigungen und Queue-Jobs:

- `process-scheduled-wallet-notifications` und `process-wallet-update-queue` akzeptieren weiterhin normale Betreiber-Auth für manuelle Tests.
- Für Supabase Cron oder einen externen Cron setzt du `WALLET_CRON_SECRET` als Supabase Secret; der Wert muss mindestens 32 Zeichen lang sein, empfohlen ist `openssl rand -hex 32`.
- Der Cron ruft die Function per `POST` auf und sendet entweder `Authorization: Bearer <WALLET_CRON_SECRET>` oder `x-cron-secret: <WALLET_CRON_SECRET>`.
- Mit Cron-Secret werden alle fälligen Kampagnen/Jobs über alle Businesses verarbeitet; die Verarbeitung setzt intern pro Kampagne/Job wieder `owner_id` und `business_id`.
- Konkrete Supabase-Cron-Vorlage: `supabase/cron.example.sql`; Setup-Anleitung: [docs/WALLET_CRON_SETUP.md](docs/WALLET_CRON_SETUP.md).
- Die gleiche Cron-Vorlage verarbeitet auch freigegebene Betreiber-Verifizierungen über `send-operator-verification-email`. Der Job läuft alle 5 Minuten und nutzt denselben `x-cron-secret`; optional kann `OPERATOR_VERIFICATION_CRON_SECRET` separat gesetzt werden.
- `location_based` wird im MVP best-effort umgesetzt: Apple bekommt `locations[].relevantText`, Google bekommt ein Karten-Object-Update ohne echten Standort-Push. Der Preflight zeigt dafür `LOCATION_BASED_BEST_EFFORT`, Apple-iOS-Relevanzhinweise und Google-Fallback-Hinweise direkt im Editor an. Der Standortradius wird durch Editor, Edge Backend und SQL einheitlich auf ganzzahlige 50 bis 100000 Meter begrenzt.

Operator-Registrierungs- und Magic-Link-Secrets:

- `OPERATOR_VERIFICATION_MAIL_MODE`, Default `supabase_auth`; optional `resend`
- `OPERATOR_EMAIL_VERIFICATION_REQUIRED`, aktuell `false`; später bei Supabase Pro/Custom SMTP auf `true` setzen
- `OPERATOR_VERIFICATION_CRON_SECRET`, optional separates Cron-Secret; wenn leer, nutzt die Function `WALLET_CRON_SECRET`
- `OPERATOR_VERIFICATION_REDIRECT_PATH`, Default `/dashboard.html`
- `OPERATOR_VERIFICATION_MAX_ATTEMPTS`, Default `5`
- `OPERATOR_REGISTER_RATE_LIMIT`, Default `12`
- `OPERATOR_REGISTER_RATE_LIMIT_WINDOW_SECONDS`, Default `3600`
- `MAIL_FROM_EMAIL`, bei Resend-Modus `Fabricio@el-promillo.ch`; bei Supabase-Auth-Modus muss diese Adresse in Supabase SMTP konfiguriert sein
- `MAIL_FROM_NAME`, z. B. `El Promillo`
- `RESEND_API_KEY`, nur nötig bei `OPERATOR_VERIFICATION_MAIL_MODE=resend`

Limit-Secrets für Wallet-Benachrichtigungen:

- `WALLET_BUSINESS_DAILY_LIMIT`, Default `500`
- `WALLET_CUSTOMER_DAILY_LIMIT`, Default `12`
- `WALLET_CARD_DAILY_LIMIT`, Default `6`
- `WALLET_CUSTOMER_DAILY_LIMIT` gruppiert über `card_instances.customer_id`, wenn vorhanden, sonst über die verknüpfte `customer_card_id`.
- `WALLET_GOOGLE_TEXT_AND_NOTIFY_LIMIT_PER_PASS_24H`, Default `3`
- `WALLET_MESSAGE_LINK_SECRET`, optional; wenn leer, wird für signierte Nachrichtenlinks `WALLET_CRON_SECRET` verwendet
- `WALLET_DUPLICATE_WINDOW_MINUTES`, Default `10`, blockiert identische Kampagnen desselben Businesses innerhalb dieses Zeitfensters.
- `WALLET_PUBLIC_CLAIM_RATE_LIMIT`, Default `80`, begrenzt öffentliche Claim-/Wallet-Installationsanfragen pro Route und Client-Fingerprint.
- `WALLET_PUBLIC_CLAIM_RATE_LIMIT_WINDOW_SECONDS`, Default `900`, definiert das Zeitfenster für diese öffentlichen Claim-Limits.
- Business-/Kunden-/Kartenlimits zählen nur echte Wallet-Nachrichtenaktionen, z. B. Apple-Pass-Updates und Google `TEXT_AND_NOTIFY`. Claim-, Issue-, Download- und Queue-Sync-Logs verbrauchen diese Nachrichtenlimits nicht.
- `WALLET_RECIPIENT_PROCESSING_TIMEOUT_MINUTES`, Default `15`
- `WALLET_QUEUE_PROCESSING_TIMEOUT_MINUTES`, Default `15`

Payment-Secrets für Supabase Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYMENT_PROVIDER`, z. B. `stripe`, `payrexx`, `datatrans`, `worldline`, `mollie` oder lokal `manual`
- `PAYMENT_CHECKOUT_BASE_URL`, die serverseitig erzeugte/konfigurierte Checkout-URL-Basis des Providers
- `PAYMENT_WEBHOOK_SECRET`, gemeinsames Secret für `confirm-topup-payment`, mindestens 32 Zeichen lang

Ohne echten Provider erstellt `create-topup-payment-session` trotzdem eine pending Session, verändert aber kein Guthaben. Die Claim-Seite zeigt diese Setup-Meldung verständlich an. Die öffentliche Function verlangt neben der Karten-ID auch den stabilen Claim-/Wallet-Schlüssel (`walletObjectId`) aus dem aktuellen Browser-Claim und lehnt fremde oder fehlende Schlüssel mit `TOPUP_CLAIM_KEY_MISMATCH` ab. Kundenkarte, Template und Session werden intern mit expliziten Select-Listen geladen. Vor dem Session-Insert muss eine echte `card_instances`-Zeile zur Karte mit passender `customer_card_id`, `owner_id`, `business_id` und `template_id` gefunden werden; alte oder defekte Karten ohne Instanz liefern `TOPUP_CARD_INSTANCE_REQUIRED`, statt eine Session ohne Wallet-Bezug zu erzeugen. Wenn Supabase den Insert nicht bestätigt, antwortet die Function mit `TOPUP_SESSION_SAVE_FAILED`. Die öffentliche Antwort enthält nur eine minimierte `topup_payment_session` mit ID, Betrag, Währung, Status, Checkout-URL und Zeitstempel; interne Betreiber-/Business-IDs, Karteninstanz-IDs, Provider-Session-IDs und Metadaten bleiben serverseitig. Mindest- und Maximalbeträge kommen aus den Template-Settings `minTopupCents` und `maxTopupCents`; alte Settings mit `minBalanceAmount` und `maxBalanceAmount` werden weiterhin akzeptiert. Das Guthaben wird erst durch `confirm-topup-payment` und die RPC `confirm_card_topup(...)` erhöht. `confirm-topup-payment` ist für Provider-Webhooks mit Header `x-payment-webhook-secret` oder für einen eingeloggten freigeschalteten Betreiber gedacht; das Webhook-Secret wird hashbasiert timing-safe verglichen. Auch `confirm-topup-payment` nutzt für Session, verknüpfte Karte, Template und aktualisierte Karte explizite Select-Listen und gibt die Karte nur über `publicOperatorCard(...)` zurück. `redeem-balance` nutzt dieselbe Antwortgrenze: Die SQL-RPC `redeem_card_balance(...)` bucht atomar ab, während der Edge-Pfad Kundenkarte und Template ohne Wildcard-Selects lädt und keine internen Owner-/Business-Felder oder Pass-Token an Browser-Clients ausgibt.

Lokal ist PDF bereits als Node-Route umgesetzt; produktiv kann alternativ `generate-card-pdf` als Supabase Edge Function genutzt werden. Die Edge Function ist für eingeloggte und freigeschaltete Betreiber gedacht und filtert Templates serverseitig nach `owner_id`, damit keine fremden QR-PDFs erzeugt werden:

```text
GET /api/templates/:templateId/qr.pdf?format=a4
GET /api/templates/:templateId/qr.pdf?format=a5
```

## Nutzung

1. Betreiber registriert sich unter `/index.html`.
2. Die Registrierung wird serverseitig erstellt, offensichtliche Test-/Wegwerf-Adressen werden blockiert, und `unlock=false` bleibt gesetzt.
3. Admin setzt `unlock = true` in Supabase.
4. Supabase Cron sendet den Magic Link; erst nach Klick auf den Link ist die E-Mail bestätigt.
5. Betreiber legt im Dashboard ein Geschäftsprofil an.
6. Betreiber öffnet über `/editor.html` den separaten Karten-Editor und erstellt beliebig viele Templates.
7. Der Editor zeigt die Karte live an; Icons werden in Supabase Storage hochgeladen.
8. Der Editor blendet Funktionen anhand der zentralen Template-Feature-Matrix ein oder aus.
9. Dashboard zeigt pro Template einen eigenen QR-Code zur Claim-Seite und PDF-Downloads für A4/A5.
10. Bestehende Karten können in der Kartenübersicht angeklickt und auf `/editor.html?template=<template_id>` bearbeitet werden.
11. Im Editor steht bei gespeicherten Templates die Kartenvorschau links und der separate Claim-QR rechts.
12. Kunde scannt QR-Code, öffnet `/claim.html?token=<public_claim_token>` und erhält je nach Gerät den passenden Wallet-Pfad: Apple über `claim-card` plus `claim-apple-pass`, Google über `claim-card` plus `google-wallet-save-link`, Samsung über `samsung-wallet-add-link`; bestehende alte `/claim.html?template=<template_id>` Links bleiben gültig, spätere Samsung Update-/Cancel-Aktionen laufen geschützt über `update-samsung-wallet-pass`.
13. Jede ausgestellte Karte bekommt eine sichtbare, eindeutige Karten-ID (`card_instance_number`).
14. Betreiber scannt die Kundenkarte unter `/scanner.html` oder gibt Kundencode bzw. Karten-ID manuell ein.
15. Betreiber sieht im Scanner nur Aktionen, die zur Matrix des Templates passen.

Beispiele:

- `stamp_card`: Stempel hinzufügen/entfernen
- `streak_card`: Streak erhöhen/zurücksetzen
- `vip_card`: VIP-Status und Besuch erfassen
- `balance_card`: Guthaben anzeigen, manuell korrigieren und abbuchen
- `cloakroom_card`: Garderobenabgabe/-abholung
- `event_card`: Check-in, Check-out und Ticket als verwendet markieren
- `coupon_card`: Einlösen
- `membership_card`: Mitgliedschaft prüfen

Bei Stempel- und Streak-Karten wird der Belohnungstext in der Wallet-Datei erst angezeigt, wenn das Ziel erreicht ist. Die Claim- und Editor-Vorschau zeigen den Belohnungstext als Vorschau des Designs.

Bei Karten mit Garderobenfunktion speichert der Editor keine statischen Abgabe-/Abholungstexte mehr. Stattdessen werden zwei Erinnerungsregeln gespeichert: eine Nachricht für 12:00 Uhr nach der letzten Garderobenabgabe und eine Standortnachricht für den nächsten Besuch in der Nähe der hinterlegten Latitude/Longitude. Beim Apple-Wallet-Pass werden diese Daten als `relevantDate` und `locations[].relevantText` vorbereitet; für automatische Ausführung muss `process-scheduled-wallet-notifications` bzw. `process-wallet-update-queue` per Supabase Cron oder externem Cron regelmässig mit `WALLET_CRON_SECRET` aufgerufen werden.

Hochgeladene Logos werden für die Web-Vorschau immer verwendet. Für die `.pkpass`-Datei lädt das Backend Logo/Icon-URLs nur aus dem eigenen öffentlichen Supabase-Storage-Bucket `wallet-assets`, prüft HTTPS, Content-Type und maximal 2 MB und speichert sie dann als Wallet-Assets in der Pass-Version. Externe Bild-URLs bleiben für Web-/Google-Vorschau möglich, werden aber nicht serverseitig in Apple-Passes gefetcht; wenn kein erlaubtes Asset erreichbar ist, wird ein minimales Platzhalter-Icon verwendet.

## Noch offen für später

- Supabase Cron oder externen Cron im Zielprojekt aktivieren und mit [docs/WALLET_EXTERNAL_ACCEPTANCE.md](docs/WALLET_EXTERNAL_ACCEPTANCE.md) abnehmen
- produktive Google-Wallet-Klassenpflege, Branding-Feinschliff und API-Freigabe im Google-Wallet-Console-Prozess
- produktive Supabase Edge Function Deployments für direkte Apple-/Google-Wallet-Updates
- Payment-Provider-Anbindung für Aufladungen, z. B. Stripe, Payrexx, Datatrans, Worldline oder Mollie
- Mitarbeiterrollen pro Business
- Template-Archivierung in der UI
- Bild-Resize-Pipeline für perfekte Apple-Wallet-Asset-Grössen
- E-Mail-Flows und Admin-Oberfläche für Freischaltungen

## Hinweise zum Testen ohne echte Secrets

Ohne echte Supabase-Werte kann die UI starten, aber keine Daten speichern. Ohne Apple-Zertifikate wird die Kundenkarte in Supabase angelegt, die `.pkpass`-Datei aber mit einem klaren Hinweis abgelehnt. Das ist beabsichtigt, damit das MVP lokal strukturell prüfbar bleibt, ohne Secrets oder Zertifikate zu hardcoden.
