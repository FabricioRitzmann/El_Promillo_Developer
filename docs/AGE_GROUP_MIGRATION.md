# Eindeutige Altersgruppen (Prompt 5)

Neue Erstscans speichern ausschließlich nicht überlappende interne Kategorien:

- `18_24`, `25_29`, `30_39`, `40_49`, `50_59`, `60_69`, `70_plus`

Die Scanner-Oberfläche darf dafür kompakte Beschriftungen wie `18+` anzeigen.
Maßgeblich bleibt jedoch der eindeutige gespeicherte Wert.

## Verlustfreie Bestandsmigration

Die bisherigen Werte `18_plus`, `25_plus` und `30_plus` enthalten keine obere
Grenze. Aus ihnen lässt sich kein exaktes Alter und damit keine neue Kategorie
zuverlässig ableiten. Sie werden deshalb nicht umgeschrieben, sondern weiterhin
akzeptiert und in Filtern und Statistiken ausdrücklich als `Legacy 18+`,
`Legacy 25+` und `Legacy 30+` ausgewiesen.

Neue Erfassungen akzeptieren diese Legacy-Werte nicht mehr. Bestehende Karten
behalten ihre bereits einmal erhobene Demografie; der Erstscan-Dialog erscheint
für sie weiterhin nicht erneut.

## Statistikvertrag

Dashboard, API und lokaler Fallback verwenden dieselbe Reihenfolge: zuerst die
sieben eindeutigen Gruppen, danach die drei Legacy-Gruppen. Alle Diagramme,
Tabellen, Datumsfilter und Geschlecht-Alter-Matrizen zählen nach dem gespeicherten
Wert. Dadurch entspricht die Summe der Altersgruppen stets der Anzahl der Scans
mit einer Altersangabe, ohne historische Werte doppelt zu zählen.
