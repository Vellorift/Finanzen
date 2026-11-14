# Meine Finanzen – Projektbeschreibung für Claude

Persönliche Finanz-App als PWA (installierbare Web-App), läuft in Chrome auf Android und am PC.
Ziel: sehen, wohin das Geld geht, und einen finanziellen Puffer aufbauen („Pay yourself first“ / Notgroschen).

- **App:** https://vellorift.github.io/finanzen/
- **Code:** GitHub-Repository `Vellorift/finanzen` (öffentlich, Branch `main`, GitHub Pages aus `/ (root)`)
- **Abgleich-Daten:** privates Repository `Vellorift/finanzen-daten`, dort nur die verschlüsselte Datei `daten.json`
- **Aktuelle Version:** 1.8.0 (steht in `app.js` als `APP_VERSION` und unten in den Einstellungen)

## Wer ist der Nutzer / wie arbeiten wir

- Der Nutzer hat gute PC-Kenntnisse, ist aber **kein Programmierer** und Anfänger bei Web-Entwicklung. Er möchte den Code grob nachvollziehen können.
- Alles auf **Deutsch**: Oberfläche, Code-Kommentare, Variablennamen, Commit-Nachrichten, Erklärungen.
- Er schreibt meist vom Handy, also **kurze, klare Antworten**, Schritt für Schritt, ohne Fachchinesisch.
- **Arbeitsablauf:** Der Nutzer sagt, was er will. Claude baut es, **testet es selbst** (siehe unten), lädt es per `git push` auf `main` hoch und erklärt in wenigen Sätzen, was neu ist. Der Nutzer lädt nichts mehr selbst hoch.
- Vor größeren Umbauten kurz den Plan zeigen. Kleine Wünsche direkt umsetzen.
- Nach dem Push: GitHub Pages braucht 1–2 Minuten. Am Handy die App **zweimal öffnen**, weil der Service Worker die neue Version erst beim nächsten Start zeigt.

## Technische Vorgaben (nicht ändern ohne Rückfrage)

- **Keine Build-Tools, kein Framework, keine externen Bibliotheken.** Reines HTML/CSS/JavaScript, möglichst wenige Dateien.
- **Kein Server, kein Konto, keine Kosten.** Alle Daten lokal in IndexedDB. Der optionale Abgleich läuft über das private GitHub-Repository (verschlüsselt).
- Mobil-optimiert, **Dark Mode**, Beträge in Euro, deutsches Zahlenformat (`12,50 €`).
- Keine nativen Datums- oder Monatsfelder (`<input type="date">` / `type="month"`), die gefallen dem Nutzer optisch nicht. Stattdessen gibt es eigene Bausteine (siehe unten).

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst + **alle CSS-Stile** (Farben oben in `:root`) |
| `app.js` | Die komplette Logik, in nummerierte Abschnitte gegliedert (siehe unten) |
| `sw.js` | Service Worker: offline nutzbar, Stale-while-revalidate (`fetch(url, {cache:'no-cache'})`) |
| `manifest.json` | Name, Icons, Farben für die Installation |
| `icon-192.png`, `icon-512.png` | App-Symbol (3 steigende Balken, auch als maskable) |
| `CLAUDE.md` | Diese Beschreibung |

### Abschnitte in `app.js`
1. Hilfsfunktionen (Geld in **Cent**, Datum als Text `"2026-11-14"`, `esc()` gegen HTML-Einschleusung)
2. Datenbank (IndexedDB-Helfer, `daten`-Objekt im Speicher, `speichern()` / `loeschen()` / `einstSpeichern()`)
3. Startdaten (Standard-Kategorien, `STANDARD_EINST`)
4. Berechnungen (Monatszahlen, Puffer-Reichweite, kleine Ausgaben, fällige Vorlagen, Rhythmus `vorlageFaellig()`)
4a. Tagauswahl (1. · 8. · 15. · Letzter · Anderer), Rhythmus-Auswahl, Monat/Jahr-Auswahl
4b. Kredite & Verträge (`kreditInfo()`, Restschuld aus Laufzeit per Barwert)
4c. Girokonto (`kontoInfo()`: Stand fortschreiben + Monatsende-Vorschau)
5. Ansichten (`render()`, Übersicht, Buchungen, Einstellungen)
5b. Ausblick (`prognose()`, 12/24/36 Monate)
6. Eingabe-Formular (eigener Kalender, Heute/Gestern-Knöpfe)
7. Backup (JSON-Export, Teilen als `.txt`, weil Android-Chrome `.json` beim Teilen ablehnt, Wiederherstellen)
7b. Abgleich zwischen Geräten (Verschlüsselung, GitHub-API, Zusammenführen)
8. Bedienung (ein zentraler Klick-Empfänger über `data-action` / `data-view`, ein `change`-Empfänger) und `start()`

## Datenmodell (IndexedDB `meine-finanzen`, `DB_VERSION = 3`)

Alle Beträge in **Cent** (Ganzzahlen). Jeder Eintrag hat `id` (UUID) und `geaendert` (ms-Zeitstempel, wird von `speichern()` gesetzt).
Gelöschte Einträge bleiben als Löschmarkierung `{ id, geloescht: true, geaendert }` in der Datenbank (wichtig für den Abgleich). `allesLaden()` filtert sie heraus.

- **buchungen:** `datum`, `betrag`, `art` (`ausgabe` | `einnahme` | `sparen`), `kategorieId`, `notiz`, `vorlageId`, `erstellt`
  - `sparen` = Geld aufs Sparkonto, zählt **nicht** als Ausgabe. Ein Datum in der Zukunft gilt als „geplant“.
- **kategorien:** `name`, `art`, `fix` (Fixkosten ja/nein), `farbe`, `reihenfolge`
- **vorlagen** (regelmäßige Buchungen): `name`, `betrag`, `art`, `kategorieId`, `tag` (1–31, **31 = Monatsletzter**), `intervall` (1/3/6/12), `startMonat` (`"2027-01"`, nur bei Intervall > 1), optional `kreditId`
- **kredite:** `typ` (`kredit` | `vertrag`), `name`, `rate`, `tag`
  - `kredit`: `restschuld` + `stichtag` (wird bis heute fortgeschrieben), `zins` (%, optional, unter „Erweiterte Angaben“), `ursprung` (optional), `geschaetzt` (Restschuld aus Laufzeit berechnet)
  - `vertrag` (z. B. Leasing): `ende` (`"2028-03"` = Monat der letzten Rate)
- **einstellungen:** ein Eintrag `id: 'haupt'`, u. a. `puffer`, `zielName`, `zielBetrag`, `zielGleichPuffer`, `zielStand`, `kleinGrenze`, `letztesBackup`, `kontoStand`, `kontoStichtag`, `kontoZeit`
- **geraet:** nur für dieses Gerät, **wird nie abgeglichen oder gesichert**. Eintrag `id: 'sync'` mit `repo`, `token`, `schluessel` (nicht exportierbarer CryptoKey), `salt`, `zuletzt`

Neue Tabellen nur über eine höhere `DB_VERSION` anlegen. Neue Felder brauchen keine Migration, aber Standardwerte beim Lesen (`|| 1`, `?? null` …).

## Abgleich (Version 1.5+) – vorsichtig ändern!

- Datei `daten.json` im privaten Repository: `{ app:'meine-finanzen-sync', format:1, salt, iv, daten }` (Base64)
- Inhalt: JSON aller Tabellen (inkl. Löschmarkierungen) → gzip → **AES-256-GCM**. Schlüssel per **PBKDF2-SHA-256, 310.000 Runden**, Salt aus der Datei.
- **Diese Parameter nie ändern, ohne eine Migration einzubauen**, sonst kann niemand mehr seine Daten entschlüsseln.
- Zusammenführen: pro `id` gewinnt der höhere `geaendert`-Wert. Upload per GitHub Contents API mit `sha`. Bei 409/422 (anderes Gerät war schneller) neu laden, mischen und nochmal hochladen (max. 4 Versuche).
- Auslöser: App-Start, 3 s nach jeder Änderung (`aenderungMelden()`), wieder online, App wieder sichtbar oder verlassen.
- Einrichten auf einem neuen Gerät ohne Buchungen: lokale Daten werden vorher geleert, damit keine doppelten Standard-Kategorien entstehen. **Immer zuerst das Gerät mit den Daten einrichten.**
- Statuspunkt neben dem Titel: grün = ok, blau = läuft, grau = offline, rot = Fehler.

## Testen (vor jedem Push)

- Lokal mit `python3 -m http.server` ausliefern und mit Playwright + Chrome headless in Handy-Größe (390×844, `locale='de-DE'`) durchklicken. Auf Fehlermeldungen achten (`pageerror`) und Screenshots ansehen.
- Abgleich testen: GitHub-API per `context.route('https://api.github.com/**', …)` nachbauen und zwei getrennte Browser-Kontexte als „Handy“ und „PC“ verwenden. Prüfen: verschlüsselt, falsches Passwort wird erkannt, keine doppelten Kategorien, Löschungen kommen an, gleichzeitige Änderungen gehen nicht verloren.
- Achtung: `[data-view=einstellungen]` gibt es zweimal (Navigation + Statuspunkt). In Tests `nav [data-view=…]` verwenden.

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

## Fahrplan / offene Punkte

- **Angeboten, noch nicht gebaut:** ✎ Bearbeiten-Knopf auch bei Krediten & Verträgen (bisher nur Restschuld änderbar)
- **Version 2:** CSV-Import des Kontoauszugs aus dem Online-Banking (einmalige Spaltenzuordnung, die gespeichert wird; Duplikate erkennen; Kategorien vorschlagen), richtige **Diagramme**, **Monatsvergleich** über mehrere Monate
- **Version 3:** Screenshot-Import. Vorher dem Nutzer die Optionen mit Vor- und Nachteilen zeigen: Tesseract.js (kostenlos, läuft lokal, ungenauer) vs. Claude API (genauer, kostet Gebühren, Daten verlassen das Gerät)
- Bekannte Grenzen: Puffer/Notgroschen wird von Hand eingetragen. Der Girokonto-Stand stimmt nur, wenn alle Ausgaben eingetragen sind (darum regelmäßig mit ✎ abgleichen). „Wiederherstellen“ ersetzt die lokalen Daten.
