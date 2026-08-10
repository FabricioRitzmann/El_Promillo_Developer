# Prompt 7: Öffentliche Kartenlinks in Wallets

Jede ausgegebene Karte behält ihr Ursprungstemplate dauerhaft über `customer_cards.template_id`. Der teilbare Wallet-Link wird ausschliesslich aus `card_templates.public_claim_token` erzeugt und führt auf dieselbe öffentliche Claim-Seite wie der QR-Code. Er enthält keine Karteninstanz, Gast-ID oder personenbezogenen Daten.

`source=wallet_share` unterscheidet weitergeleitete Wallet-Links von direkten QR-Aufrufen. Beim Claim wird nur `direct_qr` oder `wallet_share` in `customer_cards.claim_source` und den internen Metadaten gespeichert. Unbekannte Werte fallen sicher auf `direct_qr` zurück.

Clubkarten zeigen den Link standardmässig; andere Kartentypen standardmässig nicht. Der Editor-Schalter überschreibt diese Vorgabe pro Template. Deaktivierte Templates erzeugen keinen Link, und gelöschte Templates löschen ihre Karten über die bestehende Fremdschlüsselbeziehung.

Apple erhält ein antippbares Rückseitenfeld und Google ein `linksModuleData`-Modul. Bestehende Apple-Pässe erhalten das Feld bei der nächsten Aktualisierung; bestehende Google-Objekte werden beim nächsten Create-/Update-Lauf gepatcht. Samsung wird mit denselben sicheren Daten vorbereitet. Die tatsächliche Darstellung bleibt vom Samsung-Partner-Portal, der Freigabe und der Provider-Konfiguration abhängig und kann ohne freigeschaltete Samsung-Credentials nicht end-to-end bestätigt werden.
