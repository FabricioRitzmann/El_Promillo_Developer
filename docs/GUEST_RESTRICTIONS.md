# Guest Restrictions (Prompt 2)

## Umfang

Promillo speichert Hausverbote (`HOUSE_BAN`) und Casinosperren (`CASINO_BAN`)
als interne, mandantenbezogene Guest-Daten. Sie werden weder in Wallet-Payloads
noch in QR-Codes, Claim-Antworten oder oeffentliche Template-Endpunkte kopiert.

## Daten und Historie

- `guest_restrictions`: aktueller und historischer Restriction-Datensatz
- `guest_restriction_events`: unveraenderliche Ereignisse fuer Erstellung,
  Bearbeitung und Aufhebung
- Hard Delete ist fuer beide Tabellen per Trigger verboten.
- Eine Aufhebung setzt `status = lifted`, `lifted_at`, `lifted_by` und
  `lift_reason`; der urspruengliche Datensatz bleibt erhalten.
- Abgelaufene Zeitraeume bleiben historisch sichtbar, gelten beim Scan aber
  nicht als aktiv.

## Rollen

Die vorhandene Betreiberanmeldung wurde additiv um `business_memberships`
erweitert. Der bestehende Business-Owner ist implizit `admin`.

| Rolle | Anzeigen | Grund | Interne Bemerkung | Erfassen | Bearbeiten/Aufheben |
| --- | --- | --- | --- | --- | --- |
| Admin | ja | ja | ja | ja | ja |
| Manager | ja | ja | ja | ja | ja |
| Security | ja | ja | nein | ja | nein |
| Staff | ja | nein | nein | nein | nein |

## Scanner

`scanner-actions` laedt den Gaststatus serverseitig ueber
`get_guest_restrictions_for_scan(uuid)`. Aktive Restriktionen erscheinen vor
VIP-/Membership-Hinweisen. Vor normalen Kartenaktionen ist eine explizite
Bestaetigung erforderlich; die Warnung informiert, blockiert die Kartenaktion
nach der Bestaetigung aber nicht dauerhaft.

Erstellen, Bearbeiten und Aufheben laufen atomar ueber die service-role-only RPC
`manage_guest_restriction(...)`. Browserrollen besitzen keine direkten
Schreibrechte auf Restriction- oder Audit-Tabellen.

## Migration und Konfiguration

Die Migration ist additiv. Bestehende Karten und Gastprofile bleiben gueltig;
tenantlose Legacy-Karten erhalten keinen Restriction-Kontext und funktionieren
weiter. Es werden keine neuen Environment Variables benoetigt.

Der transaktionale Abnahmetest liegt in
`supabase/guest-restriction-acceptance-tests.sql` und endet mit `ROLLBACK`.
