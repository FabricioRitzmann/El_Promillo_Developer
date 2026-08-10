# Besuchszähler und Meilensteine

Der optionale Besuchszähler wird pro Template in `settings` konfiguriert:

- `visitCounterEnabled`
- `visitCounterWalletVisible`
- `visitMilestonesEnabled`
- `visitMilestones` (sortierte, eindeutige positive Ganzzahlen)

Ein bloßes Kartenladen erhöht nur den bestehenden technischen `scan_count`. Ein fachlicher Besuch entsteht ausschließlich durch die erfolgreiche Scanner-Aktion „Eintritt registrieren“ und wird als `ENTRY_SCAN` in `card_visit_events` gespeichert.

`register_card_entry_visit` sperrt die Karteninstanz serverseitig, prüft Tenant und Rolle und erzwingt einen eindeutigen Idempotency-Key. Doppelklicks, HTTP-Retries und zwei zeitgleiche Scanner können denselben fachlichen Eintritt deshalb nicht mehrfach zählen. Die RPC ist ausschließlich für `service_role` freigegeben.

`card_instances` hält die schnellen Anzeigewerte `lifetime_visits`, `visits_today`, `visits_today_date` und `last_visit_at`. Zürich ist die verbindliche Tageszeitzone.

Erreichte Schwellen werden einmalig in `card_visit_milestones` gespeichert. Der Scanner zeigt sie im bestehenden zentralen Hinweis-Modal; die RLS-lesbare Tabelle dient zugleich als Quelle für Dashboard- und interne Benachrichtigungen.

Wenn die Wallet-Anzeige aktiv ist, wird ein `visit_counter_update` in die bestehende `wallet_update_queue` gelegt. Apple und Google verwenden den Wert in ihren bestehenden Pass-/Object-Updates. Samsung ist im Provider-Payload vorbereitet; automatische Live-Updates bleiben bis zur Aktivierung des derzeit pausierten Samsung-Providers eingeschränkt.

## Abnahme

```bash
pnpm precheck
pnpm build
pnpm dlx supabase db query --linked --file supabase/visit-counter-acceptance-tests.sql
```

Der SQL-Test deckt AUS/AN, ersten, 10., 100. und 101. Besuch, Retry/Doppelscan, Karten- und Mandantenisolation sowie die Wallet-Queue ab und endet mit `rollback`.
