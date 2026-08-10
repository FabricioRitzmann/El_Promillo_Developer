# Zentrale Guest-Profile-Architektur (Prompt 1)

Status: Developer-Implementierung. Diese Aenderung darf vor dem ausdruecklichen
Produktions-Go nicht zum Remote `production`, nach `el-promillo.ch` oder in die
produktive Supabase-Instanz deployed werden.

## Architekturentscheidungen

- `customer_cards.id` bleibt die bestehende, eindeutige individuelle Card-ID.
- Eine Karte und ein Gastprofil bleiben getrennte Entitaeten.
- `customer_cards.guest_profile_id` bildet die Relation Karte -> Gast ab. Mehrere
  Karten desselben Businesses koennen dasselbe Profil verwenden.
- Das vorhandene `card_instances.customer_id` spiegelt bei verknuepften Karten
  die Guest-ID. Dadurch funktionieren bestehende kundenbezogene Wallet-Limits
  ueber mehrere Karten, ohne eine zweite Card-ID einzufuehren.
- Die bestehende Tabelle `scan_events` speichert `guest_profile_id` direkt als
  historischen Bezug. Es gibt keine zweite Scan-Historie.
- `guest_profiles.business_id` ist verpflichtend. Betreiber und Business sind
  nach dem Anlegen unveraenderlich.
- Karten/Legacy-Templates ohne `business_id` funktionieren weiter, erhalten aber
  bewusst kein tenantloses Gastprofil. Sobald die bestehende Produktlogik ihnen
  ein Business zuweist, erzeugt der Datenbank-Trigger das Profil.

## Datenmodell

`guest_profiles` enthaelt:

- `id`, `owner_id`, `business_id`
- `display_name`, `external_customer_id`
- `gender`, `age_group`
- `first_seen_at`, `last_seen_at`
- internes `metadata`
- `created_at`, `updated_at`

Die bisherigen Demografie-Werte (`male`, `female` sowie `18_plus`, `25_plus`,
`30_plus`) bleiben fuer Prompt 1 unveraendert. Die spaetere Altersgruppenmigration
aus Prompt 5 darf erst nach Abschluss der vorangehenden Prompts erfolgen.

## Backfill

Der Backfill ist wiederholbar und loescht keine Daten:

1. Nur Karten mit `business_id` und ohne Guest-Zuordnung werden verarbeitet.
2. Vorhandene `card_instances.customer_id`-Gruppen werden ausschliesslich
   innerhalb derselben Kombination aus Betreiber und Business erhalten.
3. Karten ohne vorhandene `customer_id` erhalten jeweils ein eigenes Profil.
   Personen werden nicht anhand von Demografie, Wallet-ID oder Namen erraten.
4. `customer_cards.guest_profile_id` und `card_instances.customer_id` werden
   synchronisiert.
5. Vorhandene `scan_events` werden anhand ihrer `customer_card_id` verknuepft.

Damit bleiben bestehende Apple-, Google-, PDF- und vorbereitete Samsung-Karten
unveraendert funktionsfaehig.

## Scan-Integration

`public.get_guest_profile_for_scan(customer_card_id)` ist die zentrale
serverseitige Aufloesung. Ausfuehren darf sie nur `service_role`; `anon` und
`authenticated` sind explizit gesperrt.

Die Supabase Function `scanner-actions` und der lokale Express-Fallback verwenden
dieselbe RPC. `inspect` sowie erfolgreiche Aktionen liefern nur das minimierte
Betreiberprofil (`id`, Anzeige-/Demografiedaten, first/last seen, Karten- und
Scananzahl). Internes `metadata`, `owner_id`, `business_id` und externe
Kundenrelationen werden nicht an den Browser gegeben.

Bei einem erfolgreichen Insert in `scan_events`:

- prueft ein Trigger Card-, Template-, Owner- und Business-Zuordnung,
- uebernimmt er die Guest-ID autoritativ aus `customer_cards`,
- blockiert er widerspruechliche Cross-Tenant- oder Cross-Guest-Daten,
- aktualisiert er `first_seen_at`, `last_seen_at` und initiale Demografie im
  Gastprofil innerhalb desselben SQL-Statements.

## RLS und Datenschutz

- RLS ist auf `guest_profiles` aktiviert.
- Freigeschaltete Betreiber sehen nur Profile ihres eigenen Businesses.
- Es gibt keine Browser-Policies fuer Insert, Update oder Delete.
- Tabellenrechte sind fuer `anon` vollstaendig entzogen.
- Authentifizierte Betreiber erhalten nur explizit freigegebene Lesespalten;
  `metadata` und `external_customer_id` bleiben serverseitig.
- Oeffentliche Claim-Antworten, QR-Codes und Wallet-Payloads enthalten keine
  Guest-Profile-Daten.
- Guest-Profile werden nicht physisch geloescht, solange Karten darauf verweisen
  (`on delete restrict`).

## Geaenderte Dateien

- `supabase/schema.sql`
- `supabase/functions/scanner-actions/index.ts`
- `supabase/functions/_shared/publicResponses.ts`
- `server/index.js`
- `package.json`

## Neue Dateien

- `scripts/verify-guest-profile-architecture.js`
- `supabase/guest-profile-acceptance-tests.sql`
- `docs/GUEST_PROFILE_ARCHITECTURE.md`

## Datenbankaenderungen

- neue Tabelle `guest_profiles`
- neue Spalte `customer_cards.guest_profile_id`
- neue Spalte `scan_events.guest_profile_id`
- neue Indizes fuer Tenant-, Karten- und Scan-Abfragen
- neuer sicherer Backfill
- neue Konsistenz- und Scan-Trigger
- neue serverseitige RPC `get_guest_profile_for_scan(uuid)`

## Environment Variables

Keine neuen Environment Variables.

## Neue RLS-Policies

- `unlocked operators can read own guest profiles`

Es existieren absichtlich keine direkten Guest-Write-Policies fuer Browserrollen.

## API-/Function-Endpunkte

Keine neue oeffentliche Route. Der bestehende Endpunkt `scanner-actions` und der
lokale Pfad `/api/scanner/actions` enthalten im sicheren Betreiber-Response neu
`guest_profile`. Intern kommt die service-role-only RPC
`get_guest_profile_for_scan(uuid)` hinzu.

## Tests

Automatisiert/statisch:

- `pnpm run build`
- `pnpm run check`
- `node scripts/verify-guest-profile-architecture.js`
- vorhandene Scanner-, Claim-, Edge-, Secret- und Schema-Verifikationen

Transaktionaler Developer-DB-Test:

- `supabase/guest-profile-acceptance-tests.sql`
- Gast A/Firma A mit zwei Karten
- Gast A/Firma B als strikt getrenntes Profil
- Cross-Tenant-Zuordnung
- neue Apple-/Google-Karteninstanzen
- Scan-Historie und zentrale Scan-Aufloesung
- RLS-Sichtbarkeit und gesperrte Browser-RPC
- automatisches `ROLLBACK`

## Developer-Deployment und Produktions-Gate

1. Code ausschliesslich zu `origin` (`El_Promillo_Developer`) pushen.
2. Weder `git push production` noch einen Render-Produktionsdeploy ausfuehren.
3. Schema und Edge Function nur in einer separaten Developer-Supabase anwenden.
   Die derzeitige GitHub-Pages-Konfiguration zeigt noch auf das produktive
   Supabase-Projekt; dort darf Prompt 1 vor der Freigabe nicht angewendet werden.
4. Developer-Test mit `guest-profile-acceptance-tests.sql` sowie den realen
   Claim-/Scanner-Flows durchfuehren.
5. Erst nach ausdruecklicher Freigabe dieselben geprueften Aenderungen kontrolliert
   in Produktion migrieren und `el-promillo.ch` aktualisieren.

## Verbleibende manuelle Schritte

- Eine separate Developer-Supabase-URL/Anon-Key/Service-Role-Konfiguration ist
  erforderlich, um die Datenbank- und Edge-Aenderungen ohne Produktionskontakt
  end-to-end zu testen.
- Apple-/Google-Wallet-Geraetetests erfolgen nach dem Developer-Schema- und
  Function-Deploy.
- Prompt 2 beginnt erst nach erfolgreicher Prompt-1-Abnahme.
