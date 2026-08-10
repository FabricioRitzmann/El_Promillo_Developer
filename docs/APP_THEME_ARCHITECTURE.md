# Firmenkonto-App-Themes (Prompt 6)

## Trennung vom Wallet-Design

`businesses.app_theme` steuert ausschließlich die interne Promillo-Oberfläche.
Wallet-Felder wie `card_templates.primary_color`, `text_color`, Logos und
Pass-Assets werden weder gelesen noch verändert, wenn ein App-Theme gewählt wird.

## Persistenz und Tenant-Grenze

Supabase ist die maßgebliche Quelle. Zulässig sind sieben feste Theme-IDs; ein
Datenbank-Constraint verhindert unbekannte Werte. RLS erlaubt das Lesen nur im
eigenen Business-Kontext und das Ändern nur durch den freigeschalteten Owner.

Der Browser speichert zusätzlich einen nach Login-ID getrennten Cache. Nach der
Authentifizierung wird zuerst dieser Cache angewendet, danach überschreibt der
aus Supabase geladene Business-Wert den Cache. Damit wird das sichtbare Flashen
des Standard-Themes reduziert, ohne LocalStorage zur Primärpersistenz zu machen.

## Zentrale Tokens

`public/js/theme.js` enthält die freigegebenen Theme-IDs und Vorschaufarben.
`public/styles.css` definiert die eigentlichen Design Tokens. Bestehende
Komponenten verwenden kompatible Alias-Variablen, sodass Dashboard, Header,
Navigation, Buttons, Karten, Tabellen, Modals, Formulare, Statistik und Scanner
gemeinsam umschalten.

Statusfarben (`success`, `warning`, `danger`) bleiben semantisch. Besonders
Restriktionen und Warnhinweise werden nicht auf normale Theme-Akzentfarben
umgedeutet. Das Theme Anthrazit/Gold setzt zusätzlich `color-scheme: dark`, alle
anderen Themes verwenden helle Browser-Controls.
