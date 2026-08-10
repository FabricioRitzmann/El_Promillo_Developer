# Prompt 8: Optionales Guest CRM / Member CRM

## Aktivierung und Zugriff

Das CRM ist pro Betrieb standardmäßig deaktiviert. In den Kontoeinstellungen kann ein Owner das CRM einschalten und das Zeitfenster für aktive Gäste festlegen. Erst danach erscheinen Navigation, Dashboard-Kennzahlen, Scanner-Verknüpfung und die CRM-Seite.

Alle Rollen dürfen CRM-Profile ihres eigenen Mandanten ansehen. Admins und Manager dürfen Kontaktdaten, Social Links und benutzerdefinierte Felder bearbeiten sowie CSV exportieren. Nur Admins dürfen Profile anonymisieren. Browser-Schreibzugriffe auf die CRM-Tabellen sind durch RLS und entzogenes DML ausgeschlossen; Änderungen laufen ausschließlich über die authentifizierte `guest-crm` Edge Function.

## Datenmodell

- `guest_profiles` bleibt die zentrale Gästeidentität.
- `guest_crm_profiles` enthält optionale Kontakt- und Adressdaten im Eins-zu-eins-Verhältnis.
- `guest_social_links` enthält optionale Social-Media-Links.
- `crm_field_definitions` definiert mandantenspezifische Zusatzfelder.
- `crm_field_values` speichert deren Werte pro Gast.
- `guest_crm_audit_events` protokolliert Änderungen unveränderlich.
- Karten, Besuche, Stammgastinformationen, Notizen und Restriktionen werden nur referenziert und nicht dupliziert.

Mandantenkonsistenz wird zusätzlich zu RLS durch Datenbank-Trigger erzwungen. Bestehende Betriebe, Gäste und Karten bleiben ohne CRM-Datensatz gültig.

## Personalisierte Kartenregistrierung

Im Karteneditor kann die Erfassung je Vorlage aktiviert werden. Nur ausdrücklich ausgewählte Standard- und öffentliche Zusatzfelder werden im öffentlichen Claim-Flow ausgegeben. Pflichtfelder werden sowohl im Browser als auch serverseitig geprüft. E-Mail-Adressen und HTTPS-URLs werden validiert. Ein möglicher Treffer über E-Mail oder Telefonnummer wird ausschließlich innerhalb desselben Mandanten als Duplikat-Hinweis markiert; es erfolgt keine automatische Zusammenführung.

## CRM-Oberfläche

Die responsive CRM-Seite bietet Suche, Statusfilter, serverseitige Seitennavigation, Kennzahlen, Detail-Tabs, Karten- und Besuchshistorie, interne Informationen, Zusatzfelder, CSV-Export und datenschutzfreundliche Anonymisierung. Scanner-Ergebnisse können direkt zum zugehörigen CRM-Profil führen.

## Bewusste Grenzen

- Das CRM versendet keine automatischen Kampagnen oder Nachrichten.
- Duplikate werden nur markiert und nicht automatisch zusammengeführt.
- Die Übersichts-Kennzahlen und der CSV-Export melden, wenn die serverseitige Obergrenze von 5.000 Profilen erreicht wird; die paginierte Profilliste bleibt davon unabhängig nutzbar.
- Die Samsung-Wallet-Unterstützung bleibt unverändert; Prompt 8 erweitert ausschließlich CRM- und Registrierungsdaten.

## Abnahme

Die statische Vertragsprüfung liegt in `scripts/verify-guest-crm.js`. Die SQL-Abnahme in `supabase/tests/prompt-8-guest-crm.sql` prüft unter anderem Standard-aus, RLS, fehlende Browser-Schreibpolicies, Cross-Tenant-Trigger und die Rückwärtskompatibilität bestehender Karten.
