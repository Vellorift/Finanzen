# Meine Finanzen – Projektbeschreibung für Claude

Persönliche Finanz-App als PWA (installierbare Web-App), läuft in Chrome auf Android und am PC.
Ziel: sehen, wohin das Geld geht, und einen finanziellen Puffer aufbauen („Pay yourself first“ / Notgroschen).

- **App:** https://vellorift.github.io/finanzen/
- **Code:** GitHub-Repository `Vellorift/finanzen` (öffentlich, Branch `main`, GitHub Pages aus `/ (root)`)
- **Abgleich-Daten:** privates Repository `Vellorift/finanzen-daten`, dort nur die verschlüsselte Datei `daten.json`
- **Aktuelle Version:** 2.1.0 (steht in `app.js` als `APP_VERSION` und unten in den Einstellungen)

## Wer ist der Nutzer / wie arbeiten wir

- Der Nutzer hat gute PC-Kenntnisse, ist aber **kein Programmierer** und Anfänger bei Web-Entwicklung. Er möchte den Code grob nachvollziehen können.
- Alles auf **Deutsch**: Oberfläche, Code-Kommentare, Variablennamen, Commit-Nachrichten, Erklärungen.
- Er schreibt meist vom Handy, also **kurze, klare Antworten**, Schritt für Schritt, ohne Fachchinesisch.
- **Arbeitsablauf:** Der Nutzer sagt, was er will. Claude baut es, **testet es selbst** (siehe unten), lädt es per `git push` auf `main` hoch und erklärt in wenigen Sätzen, was neu ist. Der Nutzer lädt nichts mehr selbst hoch.
- Vor größeren Umbauten kurz den Plan zeigen. Kleine Wünsche direkt umsetzen.
- Nach dem Push: GitHub Pages braucht 1–2 Minuten. Am Handy die App **zweimal öffnen**, weil der Service Worker die neue Version erst beim nächsten Start zeigt.

## Technische Vorgaben (nicht ändern ohne Rückfrage)

- **Keine Build-Tools, kein Framework, keine externen Bibliotheken.** Reines HTML/CSS/JavaScript, möglichst wenige Dateien.
  - **Einzige Ausnahme (vom Nutzer erlaubt, 19.11.2026):** Tesseract (Texterkennung) im Ordner `ocr/` für den Screenshot-Import. Liegt im eigenen Repo (kein CDN), wird erst bei Bedarf geladen. Der Import muss **komplett in der App und kostenlos** bleiben → keine Claude API o. Ä.
- **Kein Server, kein Konto, keine Kosten.** Alle Daten lokal in IndexedDB. Der optionale Abgleich läuft über das private GitHub-Repository (verschlüsselt).
- Mobil-optimiert, **Dark Mode**, Beträge in Euro, deutsches Zahlenformat (`12,50 €`).
- Keine nativen Datums- oder Monatsfelder (`<input type="date">` / `type="month"`), die gefallen dem Nutzer optisch nicht. Stattdessen gibt es eigene Bausteine (siehe unten).

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst + **alle CSS-Stile** (Farben oben in `:root`) |
| `app.js` | Die komplette Logik, in nummerierte Abschnitte gegliedert (siehe unten) |
| `sw.js` | Service Worker: offline nutzbar, Stale-while-revalidate (`fetch(url, {cache:'no-cache'})`) |
| `manifest.json` | Name, Icons, Farben, App-Verknüpfungen (lange aufs Symbol drücken: Neue Ausgabe · Übersicht · Wünsche), `share_target` („Teilen → Finanzen“) |
| `ocr/ocr-worker.js` | Texterkennung im Hintergrund (Worker): lädt Tesseract, liefert TSV (Wörter mit Position) |
| `ocr/tesseract-core-simd-lstm.js/.wasm` | Tesseract-Kern v7 (aus GitHub `naptha/tesseract.js-core`), Apache-2.0 (`ocr/LIZENZ-Tesseract.txt`) |
| `ocr/deu.traineddata` | Deutsche Sprachdaten (`tesseract-ocr/tessdata_fast`), ca. 1,5 MB |
| `icon-192.png`, `icon-512.png` | App-Symbol (3 steigende Balken, auch als maskable) |
| `CLAUDE.md` | Diese Beschreibung |

### Abschnitte in `app.js`
1. Hilfsfunktionen (Geld in **Cent**, Datum als Text `"2026-11-14"`, `esc()` gegen HTML-Einschleusung, `euroHtml()` = Cent klein, `SYMBOLE`/`icon()` = eigene SVG-Symbole, `ringSvg()` = Fortschrittsring, `toast(text, knopf, aktion)` mit „Rückgängig“)
2. Datenbank (IndexedDB-Helfer, `daten`-Objekt im Speicher, `speichern()` / `loeschen()` / `einstSpeichern()`)
3. Startdaten (Standard-Kategorien, `STANDARD_EINST`)
4. Berechnungen (Monatszahlen, Puffer-Reichweite, kleine Ausgaben, fällige Vorlagen, Rhythmus `vorlageFaellig()`, `bankTag()`/`vorlageDatum()`: Wochenende → Montag, `vorlageBetrag()`: einmalige Beträge)
4a. Tagauswahl (1. · 8. · 15. · Letzter · Anderer), Rhythmus-Auswahl, Monat/Jahr-Auswahl
4b. Kredite & Verträge (`kreditInfo()`, Restschuld aus Laufzeit per Barwert)
4c. Girokonto (`kontoInfo()`: Stand fortschreiben + Monatsende-Vorschau)
4d. Wünsche & Traum-Projekte (`wunschGesamt/Gespart/Rest()`, `wunschPlan()` = Ampel + „ab wann“ für alle Wünsche der Reihe nach, Gedanken-Pause, Arbeitsstunden)
4e. Ziele für die Karten oben (`alleZiele()`, `zielTempo()`, `zielPrognose()`, Meilensteine + Konfetti)
4f. Analyse (`analyse(n)`), Schnell-Favoriten (`favoriten()`), Abos (`abos()`)
5. Ansichten (`render()`, Navigation `NAV`, Übersicht mit Ziel-Karussell + Hero-Karte, Buchungen mit Suche, Wünsche, Einstellungen)
5a. Ausblick (`prognose()`, 12/24/36 Monate) · 5b. Auswertung = Analyse · Ausblick · Abos · 5c. Wünsche
6. Formulare als **Bottom Sheet** (`sheetOeffnen()` / `formSchliessen()`): Buchung (eigener Kalender), 6b Wunsch/Projekt + Details (Spartopf, Sparrate, Teile, Gekauft), 6c Kredit bearbeiten, Ziel-Details
7. Backup (JSON-Export, Teilen als `.txt`, weil Android-Chrome `.json` beim Teilen ablehnt, Wiederherstellen, **CSV-Export** für Excel)
7b. Abgleich zwischen Geräten (Verschlüsselung, GitHub-API, Zusammenführen)
7c. Darstellung (`AKZENTE`, AMOLED), App-Sperre per WebAuthn, Start-Bildschirm
7d. Screenshot-Import: `bildAufbereiten()` (dunkles Design umkehren, Kontrast `(v-30)*255/170`) → `ocrLesen()` (Worker) → `tsvZeilen()` → `importParsen()` (Raiffeisen: Umsatzliste mit Tagesüberschrift = Kontostand, nicht buchen; Umsatzdetails; eingefügter Text) → `impBezeichnung()` (PayPal „PP.xxxx.PP/. Händler“, Klarna „Purchase at Händler“) → `impKategorie()` (gemerkt → frühere Buchung mit gleicher Notiz → Stichworte → Sonstiges) → Vorschau `importVorschau()` (Duplikate: gleiche Art + Betrag, ±3 Tage; „Datum prüfen“, wenn die Tagesreihenfolge nicht passt) → `importSpeichern()`. Teilen: Service Worker nimmt POST `./teilen` an, legt Bilder in Cache `finanzen-geteilt`, öffnet `./?geteilt=1` → `geteiltLaden()`
8. Bedienung (ein zentraler Klick-Empfänger über `data-action` / `data-view`, `change`- und `input`-Empfänger, Wischgesten) und `start()`

### Bedienung (seit 2.0)
- Navigation unten: Übersicht · Buchungen · **(+)** · Auswertung · Wünsche. Einstellungen = ⚙ oben rechts.
- Übersicht: ganz oben die Ziel-Karten (Wünsche mit ⭐ + Notgroschen als Basis), wischbar, drehen alle 6 s weiter. Antippen → Details.
- Wischen: Buchung nach links = löschen (mit Rückgängig), sonst links/rechts = Monat wechseln.

## Datenmodell (IndexedDB `meine-finanzen`, `DB_VERSION = 4`)

Alle Beträge in **Cent** (Ganzzahlen). Jeder Eintrag hat `id` (UUID) und `geaendert` (ms-Zeitstempel, wird von `speichern()` gesetzt).
Gelöschte Einträge bleiben als Löschmarkierung `{ id, geloescht: true, geaendert }` in der Datenbank (wichtig für den Abgleich). `allesLaden()` filtert sie heraus.

- **buchungen:** `datum`, `betrag`, `art` (`ausgabe` | `einnahme` | `sparen`), `kategorieId`, `notiz`, `vorlageId`, `erstellt`, optional `wunschId`
  - `sparen` = Geld aufs Sparkonto, zählt **nicht** als Ausgabe. Ein Datum in der Zukunft gilt als „geplant“.
  - `sparen` mit **negativem** Betrag = Entnahme aus dem Spartopf (z. B. beim Kauf eines Wunsches), erhöht den Girokonto-Stand.
- **kategorien:** `name`, `art`, `fix` (Fixkosten ja/nein), `farbe`, `reihenfolge`, optional `budget` (Cent pro Monat). Die Spar-Kategorie „Spartöpfe“ wird bei Bedarf automatisch angelegt.
- **vorlagen** (regelmäßige Buchungen): `name`, `betrag`, `art`, `kategorieId`, `tag` (1–31, **31 = Monatsletzter**), `intervall` (1/3/6/12), `startMonat` (`"2027-01"`, nur bei Intervall > 1), optional `kreditId`, optional `ausnahmen` (`{ "2026-12": 350000 }` = einmalig anderer Betrag in diesem Monat, z. B. Prämie oder Sondertilgung; bei Krediten senkt er die Restschuld über `rateImMonat()`), optional `wunschId` (Sparrate für einen Wunsch), optional `geprueft` (ms, Abo geprüft)
- **kredite:** `typ` (`kredit` | `vertrag`), `name`, `rate`, `tag`
  - `kredit`: `restschuld` + `stichtag` (wird bis heute fortgeschrieben), `zins` (%, optional, unter „Erweiterte Angaben“), `ursprung` (optional), `geschaetzt` (Restschuld aus Laufzeit berechnet)
  - `vertrag` (z. B. Leasing): `ende` (`"2028-03"` = Monat der letzten Rate)
- **wuensche** (neu in 2.0): `typ` (`wunsch` | `projekt`), `name`, `emoji`, `preis` (nur Wunsch), `teile` (nur Projekt: `[{ id, name, preis, gekauft, gekauftAm }]`), `prio` (`muss` | `schoen` | `spass`), `termin` (`"2027-05"` oder null), `startGespart`, `kategorieId` (für die Kauf-Buchung), `link`, `notiz`, `istZiel` (⭐ = Karte oben), `reihenfolge`, `angelegt` (ms), `status` (`offen` | `erfuellt`), `erfuelltAm`
  - Spartopf = `startGespart` + alle `sparen`-Buchungen mit dieser `wunschId` (wird berechnet, nicht gespeichert)
- **einstellungen:** ein Eintrag `id: 'haupt'`, u. a. `puffer`, `zielName`, `zielBetrag`, `zielGleichPuffer`, `zielStand`, `kleinGrenze`, `letztesBackup`, `kontoStand`, `kontoStichtag`, `kontoZeit`; seit 2.0: `zielTermin`, `zielAnzeigen`, `kontoUntergrenze` (Wünsche-Ampel), `stundenlohn`, `pauseGrenze`, `akzent`, `amoled`, `startScreen` (`immer`|`taeglich`|`aus`), `rueckblickGesehen`, `meilensteine`; seit 2.1: `importKategorien` (`{ "riot games": kategorieId }`, Screenshot-Import merkt sich die Kategorie)
- **geraet:** nur für dieses Gerät, **wird nie abgeglichen oder gesichert**. Eintrag `id: 'sync'` mit `repo`, `token`, `schluessel` (nicht exportierbarer CryptoKey), `salt`, `zuletzt`; Eintrag `id: 'sperre'` mit `credId` (App-Sperre per Fingerabdruck)
- **localStorage** `startScreenTag`: an welchem Tag der Start-Bildschirm zuletzt kam (pro Gerät)

Neue Tabellen nur über eine höhere `DB_VERSION` anlegen. Neue Felder brauchen keine Migration, aber Standardwerte beim Lesen (`|| 1`, `?? null` …).

## Abgleich (Version 1.5+) – vorsichtig ändern!

- Datei `daten.json` im privaten Repository: `{ app:'meine-finanzen-sync', format:1, salt, iv, daten }` (Base64)
- Inhalt: JSON aller Tabellen (inkl. Löschmarkierungen) → gzip → **AES-256-GCM**. Schlüssel per **PBKDF2-SHA-256, 310.000 Runden**, Salt aus der Datei.
- **Diese Parameter nie ändern, ohne eine Migration einzubauen**, sonst kann niemand mehr seine Daten entschlüsseln.
- Zusammenführen: pro `id` gewinnt der höhere `geaendert`-Wert. Tabellen, die eine App-Version nicht kennt, werden seit 2.0 unverändert mitgenommen. Upload per GitHub Contents API mit `sha`. Bei 409/422 (anderes Gerät war schneller) neu laden, mischen und nochmal hochladen (max. 4 Versuche).
- Auslöser: App-Start, 3 s nach jeder Änderung (`aenderungMelden()`), wieder online, App wieder sichtbar oder verlassen.
- Einrichten auf einem neuen Gerät ohne Buchungen: lokale Daten werden vorher geleert, damit keine doppelten Standard-Kategorien entstehen. **Immer zuerst das Gerät mit den Daten einrichten.**
- Statuspunkt neben dem Titel: grün = ok, blau = läuft, grau = offline, rot = Fehler.

## Testen (vor jedem Push)

- Lokal mit `python3 -m http.server` ausliefern und mit Playwright + Chrome headless in Handy-Größe (390×844, `locale='de-DE'`) durchklicken. Auf Fehlermeldungen achten (`pageerror`) und Screenshots ansehen.
- Abgleich testen: GitHub-API per `context.route('https://api.github.com/**', …)` nachbauen und zwei getrennte Browser-Kontexte als „Handy“ und „PC“ verwenden. Prüfen: verschlüsselt, falsches Passwort wird erkannt, keine doppelten Kategorien, Löschungen kommen an, gleichzeitige Änderungen gehen nicht verloren.
- Achtung: `[data-view=einstellungen]` gibt es mehrfach (⚙ oben = `#einst-knopf`, Statuspunkt). In Tests `nav [data-view=…]` bzw. `#einst-knopf` verwenden.
- Start-Bildschirm überdeckt beim ersten Öffnen des Tages alles → in Tests `#startscreen` wegtippen. Wischgesten per CDP `Input.dispatchTouchEvent`, App-Sperre per CDP `WebAuthn.addVirtualAuthenticator` testen.
- Screenshot-Import testen: Datei-Auswahl per `page.expect_file_chooser()` (der Knopf erzeugt ein `<input type=file>`), Bilder des Nutzers (Raiffeisen, dunkles Design). Teilen nachspielen: `fetch('teilen', {method:'POST', body: FormData mit 'bilder'})` bei aktivem Service Worker, dann `./?geteilt=1` öffnen.
- Update von einer älteren Version testen: alte Dateien ausliefern, Daten anlegen, dann neue Dateien in denselben Ordner kopieren (gleicher Port = gleiche Datenbank).

## Commits

- Direkt auf `main` pushen (GitHub Pages veröffentlicht automatisch).
- Autor: `Vellorift <Vellorift@users.noreply.github.com>`, Nachricht auf Deutsch, z. B. „Version 1.9: …“.
- Bei jeder Änderung `APP_VERSION` in `app.js` erhöhen.

## Versionsverlauf

- **1.0** Manuelle Eingabe, Kategorien, Monatsübersicht (Monatszahl, fix/variabel, Sparquote, Puffer „reicht für X Monate“, Sparziel, kleine Ausgaben), Fixkosten-Vorlagen, JSON-Backup, PWA/offline
- **1.1** Kredite & Verträge (Restschuld, Restlaufzeit, Zinsen), Backup teilen als `.txt`
- **1.2** Kredit wahlweise mit Restschuld **oder** Restlaufzeit anlegen
- **1.3** Zinssatz unter „Erweiterte Angaben“, ohne Zins Anzeige „Noch zu zahlen“
- **1.4** Tagauswahl 1./8./15./Letzter/Anderer, Vorlagen auch für Einnahmen (Gehalt) und Sparen
- **1.5** Verschlüsselter Abgleich zwischen Geräten über das private GitHub-Repository
- **1.6** Regelmäßige Buchungen bearbeiten (✎), passt auf Wunsch die Buchung des laufenden Monats mit an
- **1.7** Girokonto-Stand (fortgeschrieben ab dem letzten Abgleich mit der Bank) + Monatsende-Vorschau
- **1.8** Eigener Kalender, Monat/Jahr-Auswahl, Rhythmus vierteljährlich/halbjährlich/jährlich, Tab „📈 Ausblick“ (Prognose 12/24/36 Monate, Kontostand-Verlauf, Kreditende, geplante Zahlungen, Rücklage für Quartalszahlungen)
- **1.9** Einmalig anderer Betrag pro Monat bei regelmäßigen Buchungen (✎ → „Nur einmalig anderer Betrag“, z. B. Prämie, Sondertilgung senkt die Restschuld). Fällt eine regelmäßige Zahlung aufs Wochenende → folgender Montag (läge der im nächsten Monat → Freitag davor). Kredit/Vertrag laut Plan fertig → Nachfrage „Ist alles bezahlt?“, gelöscht wird erst nach „Ja“; bei „Nein“ Restschuld bzw. letzten Monat korrigieren (Vertragsende jetzt in den Einstellungen änderbar)
- **2.0** Großes Update (Ideen A, C, E, F, G): neues Design (tiefes Schwarz, Akzentfarbe wählbar, AMOLED, SVG-Symbole, schwebende Navigation mit (+) in der Mitte, Eingabe als Bottom Sheet, Cent klein, Animationen, Vibration, Buchungen nach Tag gruppiert, Wischgesten). Ziel-Karten ganz oben (Ring, Prognose, Ampel, Meilensteine) + Start-Bildschirm. Wünsche & Traum-Projekte mit mehreren Teilen (Ampel „Jetzt okay / Ab Monat / Gerade nicht“, Spartopf, Sparrate, Gedanken-Pause, Arbeitsstunden, Gekauft, Reihenfolge). Auswertung: Analyse mit Spar-Vorschlägen und Was-wäre-wenn-Regler, Ausblick, Abo-Übersicht. Budgets pro Kategorie, Suche & Filter, Schnell-Buchen, Monatsrückblick, App-Sperre per Fingerabdruck, CSV-Export, ✎ Kredite bearbeiten, App-Verknüpfungen

- **2.1** Screenshot-Import (Idee B): Screenshot der Banking-App (Raiffeisen: Umsatzliste oder Umsatzdetails) → Texterkennung mit Tesseract direkt auf dem Gerät → Vorschau mit Haken, Datum/Betrag/Notiz/Kategorie änderbar → übernehmen (mit Rückgängig). Erkennt Duplikate, merkt sich Kategorien, PayPal-/Klarna-Händler aus dem Verwendungszweck. Auch über „Teilen → Finanzen“ (Share Target) und als eingefügter Text. Knöpfe: Buchungen → „Screenshot importieren“ und im Formular „Neue Buchung“

## Fahrplan / offene Punkte

- **Noch offen aus der Ideenliste:** aus A: Wischgeste zum Schließen des Bottom Sheets. Screenshot-Import: easybank-App erlaubt keine Screenshots → dort CSV-Import (Version 2) oder Online-Banking am PC
- **Version 2:** CSV-Import des Kontoauszugs aus dem Online-Banking (einmalige Spaltenzuordnung, die gespeichert wird; Duplikate erkennen; Kategorien vorschlagen), richtige **Diagramme**, **Monatsvergleich** über mehrere Monate
- Bekannte Grenzen: Puffer/Notgroschen wird von Hand eingetragen. Der Girokonto-Stand stimmt nur, wenn alle Ausgaben eingetragen sind (darum regelmäßig mit ✎ abgleichen). „Wiederherstellen“ ersetzt die lokalen Daten.
