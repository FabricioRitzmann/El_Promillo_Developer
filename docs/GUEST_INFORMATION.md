# Interne Stammgastinformationen und Gastnotizen

Prompt 3 trennt zwei interne, mandantenbezogene Systeme:

- `guest_regular_information`: aktueller Stammgast-Steckbrief mit allgemeinen Informationen, Lieblingsgetränk, bevorzugtem Bereich/Tisch, weiteren Präferenzen und anderen internen Angaben.
- `guest_notes`: unveränderliche Chronologie nach Erstellzeit mit den Prioritäten `NORMAL`, `IMPORTANT` und `WARNING`. Bearbeitungen erhalten `created_at`; Löschungen sind Soft Deletes. `guest_note_events` protokolliert Erstellen, Bearbeiten und Löschen.

Die Firmenoption `businesses.guest_scan_settings` steuert die automatische Anzeige. Standardwerte sind: Stammgastinfo aus, Warnungen an, wichtige Notizen an, normale Notizen aus.

## Rollen

- Admin/Manager: Stammgastinformationen bearbeiten, Notizen erstellen, bearbeiten und soft löschen.
- Security: interne Daten lesen und neue Notizen erfassen.
- Staff: interne Daten ausschließlich lesen.

Browserclients besitzen keine direkten Schreibrechte auf diesen Tabellen oder RPCs. Änderungen laufen über `scanner-actions`; die Management-RPCs sind nur für `service_role` ausführbar.

## Hinweisreihenfolge

Der Scanner zeigt Hinweise koordiniert und ohne `alert()`-Stapel:

1. aktive Hausverbote/Casinosperren mit Pflichtbestätigung,
2. Gastnotizen der Priorität `WARNING`, sofern aktiviert,
3. Stammgastinformationen, sofern aktiviert und vorhanden,
4. wichtige und normale Notizen gemäß Firmeneinstellung,
5. bestehende VIP-/Mitgliedschaftsaktionen.

## Prüfung

```bash
pnpm precheck
pnpm build
pnpm dlx supabase db query --linked --file supabase/guest-information-acceptance-tests.sql
```

Der SQL-Abnahmetest läuft in einer Transaktion und endet mit `rollback`.
