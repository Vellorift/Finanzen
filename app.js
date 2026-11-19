'use strict';
/* =====================================================================
   Meine Finanzen – Version 2
   ---------------------------------------------------------------------
   Aufbau dieser Datei:
     1. Hilfsfunktionen (Geld, Datum, Text, Symbole)
     2. Datenbank (IndexedDB) – speichert alles nur lokal auf dem Handy
     3. Startdaten (Standard-Kategorien, Standard-Einstellungen)
     4. Berechnungen (Monatszahl, Sparquote, Puffer …)
        4a Tagauswahl · 4b Kredite · 4c Girokonto
        4d Wünsche & Traum-Projekte (Ampel, Spartopf, Plan)
        4e Ziele (Karten ganz oben, Tempo, Meilensteine)
        4f Analyse (Spar-Vorschläge), Favoriten, Abos
     5. Ansichten (Übersicht, Buchungen, Wünsche, Einstellungen)
        5b Auswertung (Analyse · Ausblick · Abos)
     6. Eingabe-Formulare (Bottom Sheet: Buchung, Wunsch, Kredit …)
     7. Backup (JSON + CSV-Export)
     7b. Abgleich zwischen Geräten
     7c. App-Sperre (Fingerabdruck) und Start-Bildschirm
     8. Bedienung (Klicks, Eingaben, Wischgesten) und Start der App

   Wichtig: Alle Beträge werden intern in CENT gespeichert (12,50 € = 1250).
   So gibt es keine Rundungsfehler beim Zusammenrechnen.
   ===================================================================== */

const APP_VERSION = '2.0.0';

/* ---------------------------------------------------------------------
   1. Hilfsfunktionen
   --------------------------------------------------------------------- */

// 1250 → "12,50 €"
const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const euro = (cent) => euroFormat.format(cent / 100);

// Wie euro(), aber die Cent kleiner/heller: "1.234<small>,56 €</small>" (für große Zahlen)
function euroHtml(cent) {
  const t = euro(cent);
  const i = t.lastIndexOf(',');
  return i < 0 ? t : `${t.slice(0, i)}<span class="ct">${t.slice(i)}</span>`;
}
// Gerundet ohne Cent: 123456 → "1.235 €" (für Texte wie Wunschpreise)
const euroRund = (cent) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cent / 100);

// Text aus einem Eingabefeld → Cent. "12,50" / "12.50" / "1.234,56" → Zahl, sonst null
function centAusText(text) {
  let t = String(text ?? '').trim().replace(/\s|€/g, '');
  if (t === '') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); // deutsches Format
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // "2.500" = zweitausendfünfhundert
  const zahl = Number(t);
  return Number.isFinite(zahl) ? Math.round(zahl * 100) : null;
}
// 1250 → "12,50" (für Eingabefelder)
const centZuText = (cent) => (cent / 100).toFixed(2).replace('.', ',');

// Datum als Text im Format "2026-11-14" (so wird es gespeichert)
function datumText(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const heute = () => datumText(new Date());

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
  'August', 'September', 'Oktober', 'November', 'Dezember'];
// "2026-11" → "November 2026"
function monatName(m) {
  const [j, mo] = m.split('-').map(Number);
  return `${MONATE[mo - 1]} ${j}`;
}
// Monat um n verschieben: ("2026-11", -1) → "2026-10"
function monatVerschieben(m, n) {
  const [j, mo] = m.split('-').map(Number);
  return datumText(new Date(j, mo - 1 + n, 1)).slice(0, 7);
}
// Tage verschieben: ("2026-11-14", -1) → "2026-11-13"
function tagVerschieben(s, n) {
  const [j, m, t] = s.split('-').map(Number);
  return datumText(new Date(j, m - 1, t + n));
}
// "2026-11-14" → "Sa., 14.11.2026"
const datumLang = (s) => { const [j, m, t] = s.split('-').map(Number);
  return new Date(j, m - 1, t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }); };
// "2026-11" → "Nov 2026"
const monatKurz = (m) => { const [j, mo] = m.split('-').map(Number); return `${MONATE[mo - 1].slice(0, 3)} ${j}`; };
// Monate zwischen zwei Monaten: ("2026-11", "2027-02") → 3
const monatsAbstand = (a, b) => { const [ja, ma] = a.split('-').map(Number); const [jb, mb] = b.split('-').map(Number);
  return (jb - ja) * 12 + (mb - ma); };

// "2026-11-14" → "Sa., 14.11."
function tagAnzeige(s) {
  const [j, m, t] = s.split('-').map(Number);
  return new Date(j, m - 1, t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

// "Heute" / "Gestern" / "Mo., 17.11."
function tagRelativ(s) {
  const h = heute();
  if (s === h) return 'Heute';
  if (s === tagVerschieben(h, -1)) return 'Gestern';
  if (s === tagVerschieben(h, 1)) return 'Morgen';
  return tagAnzeige(s);
}
// Kurzes Vibrieren (z. B. beim Speichern), falls das Handy das kann
const vibrieren = (ms = 15) => { try { navigator.vibrate?.(ms); } catch { /* egal */ } };

// Eigene Symbole (SVG) statt Emojis – sehen auf jedem Handy gleich aus.
// Jede Zeile = Linien/Formen in einem 24×24-Raster.
const SYMBOLE = {
  start: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  liste: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  auswertung: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wunsch: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  zahnrad: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
  schwein: '<path d="M19 9.5c1 .3 2 1.2 2 2.5h-1.5a7 7 0 0 1-2.5 3.6V19h-3v-2h-4v2H7v-3.4A6 6 0 0 1 4 10.5C4 7.5 7 5 11 5c2.5 0 4.6.9 5.9 2.4L19 6.5z"/><circle cx="15.5" cy="10" r=".6"/>',
  ziel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>',
  karte: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  kategorie: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  suche: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  backup: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.3M3 12A9 9 0 0 1 18.5 5.7"/><path d="M21 4v5h-5M3 20v-5h5"/>',
  schloss: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  hoch: '<path d="M7 17L17 7M9 7h8v8"/>',
  runter: '<path d="M7 7l10 10M17 9v8H9"/>',
  idee: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  haken: '<path d="M4 12l5 5L20 6"/>',
  kreuz: '<path d="M6 6l12 12M18 6L6 18"/>',
  stift: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  pfeilhoch: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  pfeilrunter: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  wiederholen: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  blitz: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  kalender: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  muell: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  farbe: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/><path d="M12 21a2 2 0 0 1 0-4 2 2 0 0 0 0-4"/>',
  geschenk: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8S10.5 3 8 4s0 4 4 4zM12 8s1.5-5 4-4 0 4-4 4z"/>',
  uhr: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${SYMBOLE[name] || ''}</svg>`;

// Fortschrittsring (SVG): anteil 0…1
function ringSvg(anteil, groesse = 92, farbe = 'var(--akzent)', text = null, start = null) {
  const r = 40, u = 2 * Math.PI * r;
  const a = Math.max(0, Math.min(1, anteil || 0));
  const s = start === null ? a : start; // für die Animation: erst start, dann anteil
  return `<svg class="ring" width="${groesse}" height="${groesse}" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--karte3)" stroke-width="9"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${farbe}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${u.toFixed(1)}" stroke-dashoffset="${(u * (1 - s)).toFixed(1)}" data-ziel-offset="${(u * (1 - a)).toFixed(1)}"
      transform="rotate(-90 50 50)"/>
    <text x="50" y="50" text-anchor="middle" dominant-baseline="central" fill="var(--text)" font-size="21" font-weight="700">${text ?? Math.floor(a * 100) + '%'}</text>
  </svg>`;
}

// Schutz: Text, den du eingibst, wird nie als HTML ausgeführt
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Eindeutige ID für jeden Eintrag
const neueId = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2));

// Kurze Meldung unten einblenden
// Optional mit Knopf, z. B. toast('Gelöscht', 'Rückgängig', () => …)
let toastTimer, toastAktion = null;
function toast(text, knopfText = null, aktion = null) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(text)}</span>${knopfText ? `<button data-action="toast-knopf">${esc(knopfText)}</button>` : ''}`;
  toastAktion = aktion;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; toastAktion = null; }, knopfText ? 5000 : 2200);
}

/* ---------------------------------------------------------------------
   2. Datenbank (IndexedDB)
   Die Datenbank liegt im Browser auf dem Handy. Es gibt 4 "Tabellen":
     buchungen, kategorien, vorlagen (Fixkosten), einstellungen
   Beim Start wird alles in den Speicher geladen (Objekt "daten"),
   jede Änderung wird sofort zusätzlich in die Datenbank geschrieben.
   --------------------------------------------------------------------- */

const DB_NAME = 'meine-finanzen';
const DB_VERSION = 4; // 2 = Tabelle "kredite", 3 = Tabelle "geraet", 4 = Tabelle "wuensche"
const TABELLEN = ['buchungen', 'kategorien', 'vorlagen', 'einstellungen', 'kredite', 'wuensche'];
// "geraet" = Einstellungen nur für DIESES Gerät (Abgleich-Zugang). Wird nie abgeglichen oder gesichert.
let db;

function dbOeffnen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Wird nur beim allerersten Start (oder bei neuer DB_VERSION) ausgeführt
    req.onupgradeneeded = () => {
      for (const t of [...TABELLEN, 'geraet']) {
        if (!req.result.objectStoreNames.contains(t)) req.result.createObjectStore(t, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Kleine Helfer, damit man nicht jedes Mal die umständliche IndexedDB-Schreibweise braucht
function dbAktion(tabelle, modus, aktion) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(tabelle, modus);
    const req = aktion(tx.objectStore(tabelle));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}
const dbAlle = (t) => dbAktion(t, 'readonly', (s) => s.getAll());
const dbPut = (t, obj) => dbAktion(t, 'readwrite', (s) => s.put(obj));
const dbDelete = (t, id) => dbAktion(t, 'readwrite', (s) => s.delete(id));
const dbLeeren = (t) => dbAktion(t, 'readwrite', (s) => s.clear());

// Alle Daten im Speicher
const daten = { buchungen: [], kategorien: [], vorlagen: [], kredite: [], wuensche: [], einst: {} };

// Gelöschte Einträge bleiben als "Löschmarkierung" in der Datenbank
// (damit beim Abgleich das andere Gerät erfährt, dass sie gelöscht wurden)
const sichtbar = (liste) => liste.filter((x) => !x.geloescht);

async function allesLaden() {
  daten.buchungen = sichtbar(await dbAlle('buchungen'));
  daten.kategorien = sichtbar(await dbAlle('kategorien'));
  daten.vorlagen = sichtbar(await dbAlle('vorlagen'));
  daten.kredite = sichtbar(await dbAlle('kredite'));
  daten.wuensche = sichtbar(await dbAlle('wuensche'));
  const e = await dbAlle('einstellungen');
  daten.einst = { ...STANDARD_EINST, ...(e[0] || {}) };
}

// Speichern/Löschen: Datenbank UND Speicher aktualisieren.
// "geaendert" = Zeitpunkt der letzten Änderung → beim Abgleich gewinnt die neuere Version.
async function speichern(tabelle, obj) {
  obj.geaendert = Date.now();
  await dbPut(tabelle, obj);
  const liste = daten[tabelle];
  const i = liste.findIndex((x) => x.id === obj.id);
  if (i >= 0) liste[i] = obj; else liste.push(obj);
  aenderungMelden();
}
async function loeschen(tabelle, id) {
  await dbPut(tabelle, { id, geloescht: true, geaendert: Date.now() });
  daten[tabelle] = daten[tabelle].filter((x) => x.id !== id);
  aenderungMelden();
}
async function einstSpeichern() {
  daten.einst.geaendert = Date.now();
  await dbPut('einstellungen', daten.einst);
  aenderungMelden();
}

/* ---------------------------------------------------------------------
   3. Startdaten
   art: "ausgabe" | "einnahme" | "sparen" (= Geld aufs Sparkonto, zählt nicht als Ausgabe)
   fix: true = Fixkosten, false = variable Ausgabe
   --------------------------------------------------------------------- */

const STANDARD_KATEGORIEN = [
  // Name,               Art,        fix,   Farbe
  ['Miete',              'ausgabe',  true,  '#ff8a65'],
  ['Auto',               'ausgabe',  true,  '#ffb74d'],
  ['Versicherungen',     'ausgabe',  true,  '#a1887f'],
  ['Handy & Internet',   'ausgabe',  true,  '#90a4ae'],
  ['Abos',               'ausgabe',  true,  '#ba68c8'],
  ['Lebensmittel',       'ausgabe',  false, '#81c784'],
  ['Essen & Trinken',    'ausgabe',  false, '#4db6ac'],
  ['Tanken',             'ausgabe',  false, '#fff176'],
  ['Freizeit',           'ausgabe',  false, '#64b5f6'],
  ['Sonstiges',          'ausgabe',  false, '#9e9e9e'],
  ['Gehalt',             'einnahme', false, '#43d18a'],
  ['Sonstige Einnahmen', 'einnahme', false, '#aed581'],
  ['Notgroschen',        'sparen',   false, '#5aa9ff'],
];

const STANDARD_EINST = {
  id: 'haupt',
  puffer: 0,               // aktueller Stand deines Notgroschens (Cent)
  zielName: 'Notgroschen', // Name des Sparziels
  zielBetrag: 0,           // Zielbetrag (Cent)
  zielGleichPuffer: true,  // Fortschritt = Puffer? Sonst eigener Stand
  zielStand: 0,            // eigener Stand, falls zielGleichPuffer = false
  kleinGrenze: 1000,       // "kleine Ausgaben" = bis 10,00 €
  letztesBackup: null,
  kontoStand: null,        // Girokonto: zuletzt eingetragener echter Stand (Cent)
  kontoStichtag: null,     // an welchem Tag eingetragen ("2026-11-14")
  kontoZeit: 0,            // genauer Zeitpunkt (ms), für Buchungen am selben Tag
  // --- neu in 2.0 ---
  zielTermin: null,        // Wunschtermin fürs Sparziel ("2027-06"), optional
  zielAnzeigen: true,      // Notgroschen/Sparziel als Karte ganz oben zeigen
  kontoUntergrenze: 20000, // Wünsche: Girokonto soll am Monatsende nicht unter 200 € fallen
  stundenlohn: 0,          // Netto-Stundenlohn (Cent) → "entspricht ca. 18 Arbeitsstunden"
  pauseGrenze: 10000,      // Spaß-Käufe ab 100 € erst nach einer Gedanken-Pause grün
  akzent: 'violett',       // Akzentfarbe der App
  amoled: false,           // echtes Schwarz
  startScreen: 'taeglich', // Start-Bildschirm: 'immer' | 'taeglich' | 'aus'
  rueckblickGesehen: null, // Monat, dessen Rückblick weggetippt wurde
  meilensteine: {},        // { zielId: 50 } → höchster schon gefeierter Meilenstein
};

async function startdatenAnlegen() {
  let nr = 0;
  for (const [name, art, fix, farbe] of STANDARD_KATEGORIEN) {
    await speichern('kategorien', { id: neueId(), name, art, fix, farbe, reihenfolge: nr++ });
  }
  await einstSpeichern();
}

/* ---------------------------------------------------------------------
   4. Berechnungen
   --------------------------------------------------------------------- */

const kat = (id) => daten.kategorien.find((k) => k.id === id);
const kategorienVon = (art) => daten.kategorien.filter((k) => k.art === art)
  .sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));
const buchungenImMonat = (m) => daten.buchungen.filter((b) => b.datum.startsWith(m));

// Alle Zahlen für einen Monat
function monatsZahlen(m) {
  const z = { ausgaben: 0, fix: 0, variabel: 0, einnahmen: 0, gespart: 0, proKat: {}, anzahl: 0 };
  for (const b of buchungenImMonat(m)) {
    z.anzahl++;
    if (b.art === 'einnahme') z.einnahmen += b.betrag;
    else if (b.art === 'sparen') z.gespart += b.betrag;
    else {
      z.ausgaben += b.betrag;
      if (kat(b.kategorieId)?.fix) z.fix += b.betrag; else z.variabel += b.betrag;
      z.proKat[b.kategorieId] = (z.proKat[b.kategorieId] || 0) + b.betrag;
    }
  }
  // Sparquote = Anteil der Einnahmen, der NICHT ausgegeben wurde
  z.sparquote = z.einnahmen > 0 ? (z.einnahmen - z.ausgaben) / z.einnahmen : null;
  z.frei = z.einnahmen - z.ausgaben - z.gespart; // noch nicht verplant
  return z;
}

// Durchschnittliche Monatsausgaben für "Puffer reicht für X Monate".
// Nimmt die letzten bis zu 3 abgeschlossenen Monate mit Ausgaben.
// Gibt es noch keine, wird der aktuelle Monat genommen.
function durchschnittAusgaben(bisMonat) {
  const werte = [];
  for (let i = 1; i <= 12 && werte.length < 3; i++) {
    const a = monatsZahlen(monatVerschieben(bisMonat, -i)).ausgaben;
    if (a > 0) werte.push(a);
  }
  if (werte.length === 0) {
    const a = monatsZahlen(bisMonat).ausgaben;
    return { schnitt: a, monate: a > 0 ? 1 : 0, nurAktuell: true };
  }
  return { schnitt: werte.reduce((s, x) => s + x, 0) / werte.length, monate: werte.length, nurAktuell: false };
}

// Kleine Ausgaben (bis zur Grenze), gruppiert nach Notiz bzw. Kategorie
function kleineAusgaben(m) {
  const grenze = daten.einst.kleinGrenze;
  const gruppen = {};
  let summe = 0, anzahl = 0;
  for (const b of buchungenImMonat(m)) {
    if (b.art !== 'ausgabe' || b.betrag > grenze) continue;
    summe += b.betrag; anzahl++;
    const name = (b.notiz || '').trim() || kat(b.kategorieId)?.name || 'Ohne Kategorie';
    const schluessel = name.toLowerCase();
    gruppen[schluessel] ??= { name, anzahl: 0, summe: 0 };
    gruppen[schluessel].anzahl++;
    gruppen[schluessel].summe += b.betrag;
  }
  const mehrfach = Object.values(gruppen).filter((g) => g.anzahl >= 2).sort((a, b) => b.summe - a.summe);
  return { summe, anzahl, mehrfach };
}

// Rhythmus regelmäßiger Buchungen: alle 1, 3, 6 oder 12 Monate
const INTERVALLE = [[1, 'Monatlich'], [3, 'Vierteljährlich'], [6, 'Halbjährlich'], [12, 'Jährlich']];
const intervallName = (iv) => (INTERVALLE.find(([n]) => n === iv) || [0, `alle ${iv} Monate`])[1];

// Ist die Vorlage im Monat m fällig? (monatlich immer, sonst ab startMonat alle X Monate)
function vorlageFaellig(v, m) {
  const iv = v.intervall || 1;
  if (iv === 1) return true;
  const abstand = monatsAbstand(v.startMonat || m, m);
  return abstand >= 0 && abstand % iv === 0;
}
// Nächster Monat (ab heute), in dem die Vorlage fällig ist
function naechsteFaelligkeit(v) {
  const jetzt = heute().slice(0, 7);
  for (let i = 0; i <= 12; i++) { const m = monatVerschieben(jetzt, i); if (vorlageFaellig(v, m)) return m; }
  return null;
}

// Am Wochenende bucht die Bank nicht: Samstag/Sonntag → folgender Montag.
// Würde der Montag schon im nächsten Monat liegen (z. B. Monatsletzter am Samstag),
// wird stattdessen der Freitag davor genommen, damit die Buchung im richtigen Monat bleibt.
function bankTag(datum) {
  const [j, m, t] = datum.split('-').map(Number);
  const wt = new Date(j, m - 1, t).getDay(); // 0 = Sonntag, 6 = Samstag
  if (wt !== 0 && wt !== 6) return datum;
  const montag = tagVerschieben(datum, wt === 6 ? 2 : 1);
  if (montag.slice(0, 7) === datum.slice(0, 7)) return montag;
  return tagVerschieben(datum, wt === 6 ? -1 : -2); // Freitag davor
}
// Datum einer regelmäßigen Zahlung im Monat: Tag 31 → Monatsletzter, Wochenende → Montag
function vorlageDatum(tag, monat) {
  const [j, m] = monat.split('-').map(Number);
  const t = Math.min(tag || 1, new Date(j, m, 0).getDate());
  return bankTag(`${monat}-${String(t).padStart(2, '0')}`);
}

// Betrag einer Vorlage im Monat m: einmalig geänderter Betrag (z. B. Prämie, Sondertilgung) oder der normale
const vorlageBetrag = (v, m) => v.ausnahmen?.[m] ?? v.betrag;

// Regelmäßige Vorlagen (Fixkosten, Gehalt, Sparrate, Versicherung …), die im Monat fällig, aber noch nicht eingetragen sind
const fehlendeVorlagen = (m) => daten.vorlagen.filter((v) => {
  if (!vorlageFaellig(v, m)) return false;
  if (v.kreditId) { // Rate eines Kredits: nach der letzten Rate nicht mehr vorschlagen
    const k = daten.kredite.find((x) => x.id === v.kreditId);
    if (k) { const ende = kreditInfo(k).ende; if (!ende || m > ende) return false; }
  }
  return !daten.buchungen.some((b) => b.vorlageId === v.id && b.datum.startsWith(m));
});

async function vorlagenUebernehmen(m) {
  const liste = fehlendeVorlagen(m);
  for (const v of liste) {
    await speichern('buchungen', {
      id: neueId(), erstellt: Date.now(), datum: vorlageDatum(v.tag, m), betrag: vorlageBetrag(v, m),
      art: v.art || 'ausgabe', kategorieId: v.kategorieId, notiz: v.name, vorlageId: v.id,
      ...(v.wunschId ? { wunschId: v.wunschId } : {}), // Sparrate für einen Wunsch → landet im Spartopf
    });
  }
  toast(`${liste.length} Buchung${liste.length === 1 ? '' : 'en'} eingetragen ✓`);
}

/* ---------------------------------------------------------------------
   4c. Girokonto
   Du trägst ab und zu den echten Stand ein. Danach rechnet die App selbst:
   + Einnahmen, − Ausgaben, − Sparen (geht ja vom Girokonto weg).
   Gezählt werden nur Buchungen NACH dem Eintragen des Kontostands
   (spätere Tage, oder am selben Tag später angelegt).
   --------------------------------------------------------------------- */

function kontoInfo() {
  const e = daten.einst;
  if (e.kontoStand == null) return null;
  const h = heute();
  const zaehlt = (b) => b.datum > e.kontoStichtag || (b.datum === e.kontoStichtag && (b.erstellt || 0) > e.kontoZeit);
  const wirkung = (art, betrag) => (art === 'einnahme' ? betrag : -betrag);

  let stand = e.kontoStand;
  for (const b of daten.buchungen) if (zaehlt(b) && b.datum <= h) stand += wirkung(b.art, b.betrag);

  // Vorschau Monatsende: schon eingetragene Buchungen mit späterem Datum
  // + monatliche Buchungen, die diesen Monat noch kommen
  const monat = h.slice(0, 7);
  let ende = stand;
  for (const b of buchungenImMonat(monat)) if (b.datum > h && zaehlt(b)) ende += wirkung(b.art, b.betrag);
  for (const v of fehlendeVorlagen(monat)) {
    if (vorlageDatum(v.tag, monat) > h) ende += wirkung(v.art || 'ausgabe', vorlageBetrag(v, monat));
  }
  return { stand, ende };
}

/* ---------------------------------------------------------------------
   4a. Tagauswahl für Monatliches (1. · 8. · 15. · Letzter · Anderer)
   Tag 31 bedeutet "Monatsletzter": In kürzeren Monaten wird automatisch
   der letzte Tag genommen (30., 28. oder 29.).
   --------------------------------------------------------------------- */

const STANDARD_TAGE = [[1, '1.'], [8, '8.'], [15, '15.'], [31, 'Letzter']];
const tagText = (t) => (t >= 31 ? 'Monatsletzter' : `am ${t}.`);

function htmlTagWahl(id, tag = 1) {
  const standard = STANDARD_TAGE.some(([t]) => t === tag);
  return `<div class="tagwahl chips" id="${id}" data-tag="${tag}">
    ${STANDARD_TAGE.map(([t, text]) => `<button type="button" class="chip ${t === tag ? 'an' : ''}" data-action="tag-wahl" data-tag="${t}">${text}</button>`).join('')}
    <button type="button" class="chip ${standard ? '' : 'an'}" data-action="tag-wahl" data-tag="anderer">Anderer</button>
    <input type="number" min="1" max="31" class="tag-eingabe" placeholder="Tag" value="${standard ? '' : tag}" ${standard ? 'hidden' : ''}>
  </div>`;
}
function tagLesen(id) {
  const box = document.getElementById(id);
  const feld = box.querySelector('.tag-eingabe');
  const t = feld.hidden ? Number(box.dataset.tag) : Number(feld.value);
  return Math.min(Math.max(Math.round(t) || 1, 1), 31);
}
// Aus einem Datum den passenden Tag machen (letzter Tag des Monats → 31)
function tagAusDatum(datum) {
  const [j, m, t] = datum.split('-').map(Number);
  return t === new Date(j, m, 0).getDate() ? 31 : t;
}

// Rhythmus-Auswahl: Monatlich · Vierteljährlich · Halbjährlich · Jährlich
// mitStart = zusätzlich "Nächste Zahlung im …" anzeigen
function htmlIntervallWahl(id, iv = 1, startMonat = null, mitStart = true) {
  return `<div class="chips ivwahl" id="${id}" data-iv="${iv}" style="margin:6px 0 10px">
    ${INTERVALLE.map(([n, t]) => `<button type="button" class="chip ${n === iv ? 'an' : ''}" data-action="iv-wahl" data-iv="${n}">${t}</button>`).join('')}
  </div>
  ${mitStart ? `<div id="${id}-start" ${iv === 1 ? 'hidden' : ''}><div class="label">Nächste Zahlung im</div>
    ${htmlMonatWahl(`${id}-monat`, startMonat || heute().slice(0, 7))}</div>` : ''}`;
}
function intervallLesen(id) {
  const iv = Number(document.getElementById(id).dataset.iv) || 1;
  const startBox = document.getElementById(`${id}-monat`);
  return { intervall: iv, startMonat: iv > 1 && startBox ? monatLesen(`${id}-monat`) : null };
}

// Monat + Jahr als zwei Auswahllisten (statt des kleinen Browser-Monatsfelds)
function htmlMonatWahl(id, wert) {
  const [j, m] = wert.split('-').map(Number);
  const jetzt = new Date().getFullYear();
  const jahre = [];
  for (let y = Math.min(j, jetzt - 1); y <= Math.max(j, jetzt + 10); y++) jahre.push(y);
  return `<div class="zwei monatwahl" id="${id}">
    <select data-teil="m">${MONATE.map((n, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <select data-teil="j">${jahre.map((y) => `<option ${y === j ? 'selected' : ''}>${y}</option>`).join('')}</select>
  </div>`;
}
function monatLesen(id) {
  const box = document.getElementById(id);
  return `${box.querySelector('[data-teil=j]').value}-${String(box.querySelector('[data-teil=m]').value).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------------
   4b. Kredite & Verträge
   typ "kredit":  Restschuld + Zinssatz bekannt → App rechnet Monat für Monat
                  (Zinsen drauf, Rate runter), bis die Schuld bei 0 ist.
   typ "vertrag": z. B. Leasing – nur Rate + letzter Monat bekannt.
   --------------------------------------------------------------------- */

// Datum der Rate in einem Monat, z. B. Tag 31 im Februar → 28., Wochenende → Montag
const rateDatum = (k, monat) => vorlageDatum(k.tag, monat);

// Rate in einem Monat: normal k.rate, außer die zugehörige Vorlage hat dort
// einen einmaligen Betrag (z. B. Sondertilgung)
function rateImMonat(k, monat) {
  const v = daten.vorlagen.find((x) => x.kreditId === k.id);
  return v?.ausnahmen?.[monat] ?? k.rate;
}

function kreditInfo(k) {
  const heuteT = heute();

  if (k.typ === 'vertrag') {
    let m = heuteT.slice(0, 7);
    if (rateDatum(k, m) <= heuteT) m = monatVerschieben(m, 1); // Rate diesen Monat schon abgebucht
    let raten = 0;
    while (m <= k.ende && raten < 1200) { raten++; m = monatVerschieben(m, 1); }
    return { raten, ende: raten ? k.ende : null, offen: raten * k.rate };
  }

  // Kredit: Restschuld vom Eingabetag (stichtag) bis heute fortschreiben
  const zinsProMonat = (k.zins || 0) / 100 / 12;
  let rest = k.restschuld;
  let m = k.stichtag.slice(0, 7);
  for (let i = 0; i < 1200 && rest > 0; i++) {
    const d = rateDatum(k, m);
    if (d > heuteT) break;
    if (d > k.stichtag) rest = Math.max(0, rest + Math.round(rest * zinsProMonat) - rateImMonat(k, m));
    m = monatVerschieben(m, 1);
  }
  const restschuld = rest;
  if (rest > 0 && Math.round(rest * zinsProMonat) >= k.rate) {
    return { restschuld, endlos: true, ende: '9999-12', raten: Infinity, offen: rest };
  }
  // Ab jetzt in die Zukunft rechnen: wie viele Raten noch, wie viel Zinsen?
  let raten = 0, zinsen = 0, ende = null;
  while (rest > 0 && raten < 1200) {
    const z = Math.round(rest * zinsProMonat);
    zinsen += z;
    rest = rest + z - rateImMonat(k, m);
    raten++; ende = m; m = monatVerschieben(m, 1);
  }
  return { restschuld, raten, ende, zinsen, offen: restschuld + zinsen };
}

// Restschuld aus Rate, Anzahl Raten und Zinssatz (Barwert einer Annuität):
//   Restschuld = Rate × (1 − (1 + i)^−n) / i     mit i = Zinssatz pro Monat
// Ohne Zinsen ist es einfach Rate × Anzahl Raten.
function restschuldAusLaufzeit(rate, raten, zinsProzent) {
  const i = zinsProzent / 100 / 12;
  const wert = i > 0 ? rate * (1 - Math.pow(1 + i, -raten)) / i : rate * raten;
  return Math.floor(wert); // abrunden, damit genau "raten" Raten herauskommen
}

// "noch 17 Raten · letzte im März 2028"
function laufzeitText(i) {
  if (i.endlos) return '<span class="rot">Rate deckt nicht einmal die Zinsen!</span>';
  if (!i.raten) return '<span class="gruen">laut Plan abbezahlt 🎉 – bitte bestätigen</span>';
  const jahre = Math.floor(i.raten / 12), monate = i.raten % 12;
  const dauer = jahre ? `${jahre} J. ${monate} M.` : `${monate} M.`;
  return `noch ${i.raten} Rate${i.raten > 1 ? 'n' : ''} (${dauer}) · letzte im ${monatName(i.ende)}`;
}

// Laut Plan fertig = keine Rate mehr offen (die letzte ist schon abgebucht)
const kreditFertig = (k) => { const i = kreditInfo(k); return !i.endlos && !i.raten; };

// Nachfrage: „Ist alles bezahlt?“ – gelöscht wird erst nach deinem Ja
function kreditFertigHinweise() {
  return daten.kredite.filter(kreditFertig).map((k) => `
    <div class="hinweis fertig">🎉 <b>${esc(k.name)}</b> ist laut Plan abbezahlt.
      <div class="klein grau" style="margin-top:4px">Ist wirklich alles bezahlt? Erst dann wird der Eintrag samt regelmäßiger Rate gelöscht.</div>
      <div class="knopfreihe">
        <button class="knopf haupt" data-action="kredit-fertig-ja" data-id="${k.id}">Ja, alles bezahlt</button>
        <button class="knopf" data-action="kredit-fertig-nein" data-id="${k.id}">Nein, noch offen</button>
      </div>
    </div>`).join('');
}

function backupFaellig() {
  if (daten.buchungen.length === 0) return false;
  if (!daten.einst.letztesBackup) return true;
  const tage = (Date.now() - new Date(daten.einst.letztesBackup).getTime()) / 86400000;
  return tage > 30;
}


/* ---------------------------------------------------------------------
   4d. Wünsche & Traum-Projekte
   Ein Wunsch hat einen Preis. Ein Traum-Projekt (z. B. Japan-Tour) besteht
   aus mehreren Teilen (Rad, Flug, Ausrüstung …), der Preis ist die Summe.
   Spartopf: Startbetrag + alle Spar-Buchungen mit diesem Wunsch (wunschId).
   Beim Kauf wird der Spartopf wieder geleert (Spar-Buchung mit Minus = Entnahme).
   --------------------------------------------------------------------- */

const PRIOS = [['muss', 'Muss sein'], ['schoen', 'Wäre schön'], ['spass', 'Spaß']];
const prioName = (p) => (PRIOS.find(([k]) => k === p) || PRIOS[1])[1];

// Gesamtpreis: Wunsch = Preis, Projekt = Summe aller Teile
const wunschGesamt = (w) => (w.typ === 'projekt'
  ? (w.teile || []).reduce((s, t) => s + (t.preis || 0), 0) : (w.preis || 0));
// Schon gekaufte Teile eines Projekts
const wunschGekauft = (w) => (w.typ === 'projekt'
  ? (w.teile || []).filter((t) => t.gekauft).reduce((s, t) => s + (t.preis || 0), 0) : 0);
// Spartopf = Startbetrag + Einzahlungen − Entnahmen
const wunschGespart = (w) => (w.startGespart || 0) + daten.buchungen
  .filter((b) => b.wunschId === w.id && b.art === 'sparen').reduce((s, b) => s + b.betrag, 0);
// Was noch fehlt
const wunschRest = (w) => Math.max(0, wunschGesamt(w) - wunschGekauft(w) - wunschGespart(w));
// Fortschritt 0…1
function wunschAnteil(w) {
  const g = wunschGesamt(w);
  return g > 0 ? Math.min(1, (wunschGekauft(w) + Math.max(0, wunschGespart(w))) / g) : 0;
}
const offeneWuensche = () => daten.wuensche.filter((w) => w.status !== 'erfuellt')
  .sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));
// Monatliche Sparrate, die als regelmäßige Buchung für diesen Wunsch angelegt ist
const wunschSparrate = (w) => Math.round(daten.vorlagen.filter((v) => v.wunschId === w.id)
  .reduce((s, v) => s + v.betrag / (v.intervall || 1), 0));
const wunschEmoji = (w) => w.emoji || (w.typ === 'projekt' ? '✨' : '🎁');

// "entspricht ca. 18 Arbeitsstunden" (Netto-Stundenlohn steht in den Einstellungen)
function arbeitsstunden(cent) {
  const lohn = daten.einst.stundenlohn;
  if (!lohn || cent <= 0) return null;
  const h = cent / lohn;
  if (h < 1) return `ca. ${Math.max(1, Math.round(h * 60))} Arbeitsminuten`;
  return `ca. ${h.toLocaleString('de-DE', { maximumFractionDigits: h < 10 ? 1 : 0 })} Arbeitsstunden`;
}

// Gedanken-Pause gegen Spontankäufe: Spaß-Käufe über der Grenze erst nach 7 Tagen grün,
// richtig teure (ab 5× Grenze) erst nach 30 Tagen. Gibt die noch offenen Tage zurück.
function pauseTageOffen(w) {
  const grenze = daten.einst.pauseGrenze;
  if (w.prio !== 'spass' || !grenze || wunschGesamt(w) <= grenze) return 0;
  const tage = wunschGesamt(w) > grenze * 5 ? 30 : 7;
  const vergangen = Math.floor((Date.now() - (w.angelegt || Date.now())) / 86400000);
  return Math.max(0, tage - vergangen);
}

// Soll für den Notgroschen: das Sparziel (wenn es der Puffer ist), sonst 3 Monatsausgaben
function notgroschenSoll() {
  const e = daten.einst;
  if (e.zielGleichPuffer && e.zielBetrag > 0) return e.zielBetrag;
  return Math.round(durchschnittAusgaben(heute().slice(0, 7)).schnitt * 3);
}
// Wie viele Monate reicht ein Betrag bei den üblichen Ausgaben? (null = keine Daten)
function pufferMonate(betrag) {
  const d = durchschnittAusgaben(heute().slice(0, 7)).schnitt;
  return d > 0 ? betrag / d : null;
}
const monateText = (x) => x.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const aufrunden = (cent, schritt) => Math.ceil(cent / schritt) * schritt;

/* Plan für alle offenen Wünsche, der Reihe nach (Reihenfolge änderbar):
   Jetzt verfügbar = Girokonto am Monatsende über der Untergrenze
                   + was auf dem Notgroschen über dem Soll liegt.
   Jeden weiteren Monat kommt der Überschuss aus dem Ausblick (prognose) dazu.
   "Wäre schön" und "Spaß" kommen erst dran, wenn der Notgroschen voll ist,
   "Muss sein" darf vorher. Ergebnis: { [wunschId]: { ampel, ab, text, … } } */
function wunschPlan() {
  const e = daten.einst;
  const jetzt = heute().slice(0, 7);
  const konto = kontoInfo();
  const p = prognose(36);
  const soll = notgroschenSoll();
  const luecke = Math.max(0, soll - e.puffer);
  const ueberSoll = Math.max(0, e.puffer - soll);
  const kontoFrei = konto ? Math.max(0, konto.ende - e.kontoUntergrenze) : Math.max(0, p[0].frei);
  const startTopf = kontoFrei + ueberSoll;
  const kumuliert = []; // Überschuss, der bis Monat i insgesamt dazukommt
  let summe = 0;
  for (let i = 0; i < p.length; i++) { if (i > 0) summe += Math.max(0, p[i].frei); kumuliert.push(summe); }
  const freiSchnitt = Math.round(p.slice(1, 13).reduce((s, r) => s + r.frei, 0) / 12);
  const pmJetzt = pufferMonate(e.puffer);

  const plan = {};
  let verbraucht = 0;
  for (const w of offeneWuensche()) {
    const rest = wunschRest(w);
    const rate = wunschSparrate(w);
    const reserve = w.prio === 'muss' ? 0 : luecke;
    const jetztDa = Math.max(0, startTopf - verbraucht - reserve);
    let i = null;
    for (let m = 0; m < p.length; m++) {
      if (startTopf + kumuliert[m] - verbraucht - reserve + rate * m >= rest) { i = m; break; }
    }
    if (i !== null) verbraucht += Math.max(0, rest - rate * i);

    const r = { rest, monat: i, ab: i === null ? null : monatVerschieben(jetzt, i), pause: pauseTageOffen(w) };
    // Was würde ein Sofort-Kauf mit dem Notgroschen machen?
    const fehlt = Math.max(0, rest - jetztDa);
    let sofort = '';
    if (fehlt > 0) {
      if (fehlt > e.puffer + (konto ? Math.max(0, konto.ende) : 0)) sofort = 'Sofort gekauft würde dein Konto ins Minus rutschen.';
      else if (pmJetzt !== null && e.puffer > 0) {
        sofort = `Sofort gekauft reicht dein Puffer nur noch für ${monateText(pufferMonate(Math.max(0, e.puffer - fehlt)))} statt ${monateText(pmJetzt)} Monate.`;
      } else sofort = `Sofort gekauft müsstest du ${euro(fehlt)} aus dem Notgroschen nehmen.`;
    }
    if (rest === 0) { r.ampel = 'gruen'; r.titel = 'Jetzt okay'; r.text = 'Der Spartopf ist voll – du kannst zuschlagen.'; }
    else if (i === 0 && r.pause) {
      r.ampel = 'gelb'; r.titel = `Noch ${r.pause} Tag${r.pause > 1 ? 'e' : ''} überlegen`;
      r.text = 'Das Geld wäre da – aber bei Spaß-Käufen lohnt sich eine kurze Bedenkzeit gegen Spontankäufe.';
    } else if (i === 0) {
      r.ampel = 'gruen'; r.titel = 'Jetzt okay';
      r.text = konto
        ? `Am Monatsende bleiben dir danach noch ca. ${euroRund(Math.max(e.kontoUntergrenze, konto.ende - Math.min(rest, kontoFrei)))} auf dem Konto, dein Notgroschen bleibt unangetastet.`
        : 'Dein Überschuss reicht – der Notgroschen bleibt voll.';
    } else if (i !== null && i <= 12) {
      r.ampel = 'gelb'; r.titel = `Ab ${monatName(r.ab)} sinnvoll`;
      r.text = `In ${i} Monat${i > 1 ? 'en' : ''} ohne Abstriche drin${reserve > 0 ? ' (vorher wird der Notgroschen aufgefüllt)' : ''}. ${sofort}`;
    } else {
      r.ampel = 'rot'; r.titel = 'Gerade nicht';
      r.text = i !== null ? `Frühestens ab ${monatName(r.ab)} drin. ${sofort}`
        : freiSchnitt <= 0 ? `Im Schnitt bleibt dir monatlich nichts übrig. ${sofort}`
        : `Mit deinem jetzigen Überschuss nicht in 3 Jahren drin. ${sofort}`;
    }
    // Ansparen statt sofort: passende Monatsrate vorschlagen
    if (rest > 0) {
      let monate;
      if (w.termin && w.termin > jetzt) monate = monatsAbstand(jetzt, w.termin);
      else monate = Math.min(12, Math.max(3, i ?? 12));
      r.rateVorschlag = aufrunden(rest / monate, 500);
      r.rateZiel = monatVerschieben(jetzt, Math.ceil(rest / r.rateVorschlag));
      if (w.termin && (r.ab === null || r.ab > w.termin)) {
        r.terminHinweis = `Für deinen Wunschtermin (${monatName(w.termin)}) bräuchtest du ca. ${euroRund(r.rateVorschlag)} im Monat.`;
      }
    }
    plan[w.id] = r;
  }
  return plan;
}

/* ---------------------------------------------------------------------
   4e. Ziele (die großen Karten ganz oben in der Übersicht)
   - Traum/Wünsche, die du mit ⭐ als Ziel markiert hast
   - darunter als Basis dein Notgroschen bzw. Sparziel aus den Einstellungen
   Tempo = Ø Einzahlungen pro Monat (letzte 3 Monate mit Buchungen) oder die Sparrate.
   --------------------------------------------------------------------- */

function sparSumme(m, zielId) {
  return buchungenImMonat(m).filter((b) => b.art === 'sparen'
    && (zielId === 'notgroschen' ? !b.wunschId : b.wunschId === zielId)).reduce((s, b) => s + b.betrag, 0);
}
function zielTempo(zielId) {
  const jetzt = heute().slice(0, 7);
  const werte = [];
  for (let i = 1; i <= 12 && werte.length < 3; i++) {
    const m = monatVerschieben(jetzt, -i);
    if (buchungenImMonat(m).length) werte.push(sparSumme(m, zielId));
  }
  const schnitt = werte.length ? werte.reduce((s, x) => s + x, 0) / werte.length : 0;
  const rate = zielId === 'notgroschen'
    ? daten.vorlagen.filter((v) => v.art === 'sparen' && !v.wunschId).reduce((s, v) => s + v.betrag / (v.intervall || 1), 0)
    : wunschSparrate(daten.wuensche.find((w) => w.id === zielId) || {});
  return Math.round(Math.max(schnitt, rate, 0));
}

function alleZiele() {
  const e = daten.einst;
  const jetzt = heute().slice(0, 7);
  const ziele = offeneWuensche().filter((w) => w.istZiel).map((w) => ({
    id: w.id, name: w.name, emoji: wunschEmoji(w), betrag: wunschGesamt(w),
    stand: wunschGekauft(w) + Math.max(0, wunschGespart(w)), termin: w.termin || null,
    tempo: zielTempo(w.id), diesenMonat: sparSumme(jetzt, w.id), wunsch: w,
  }));
  if (e.zielAnzeigen !== false) {
    ziele.push({ id: 'notgroschen', name: e.zielName || 'Notgroschen', emoji: '🛟', betrag: e.zielBetrag,
      stand: e.zielGleichPuffer ? e.puffer : e.zielStand, termin: e.zielTermin || null,
      tempo: zielTempo('notgroschen'), diesenMonat: sparSumme(jetzt, 'notgroschen'), basis: true });
  }
  return ziele;
}
// Das wichtigste Ziel: erster Traum, sonst der Notgroschen (falls noch nicht erreicht)
const hauptZiel = () => alleZiele().find((z) => z.betrag > 0 && z.stand < z.betrag) || null;

// Wann ist das Ziel erreicht? (extra = zusätzliche Sparsumme pro Monat, für Vorschläge)
function zielPrognose(z, extra = 0) {
  if (!(z.betrag > 0)) return { ohneBetrag: true };
  const rest = z.betrag - z.stand;
  if (rest <= 0) return { erreicht: true };
  const tempo = z.tempo + extra;
  if (tempo <= 0) return { ohneTempo: true, rest };
  const n = Math.ceil(rest / tempo);
  if (n > 120) return { zuLang: true, rest }; // über 10 Jahre → kein sinnvolles Datum
  const monat = monatVerschieben(heute().slice(0, 7), n);
  let ampel = null;
  if (z.termin) ampel = monat <= z.termin ? 'gruen' : monat <= monatVerschieben(z.termin, 2) ? 'gelb' : 'rot';
  return { rest, n, monat, ampel };
}

// Meilensteine 25 / 50 / 75 / 100 % feiern (jeder nur einmal)
function meilensteinePruefen() {
  const e = daten.einst;
  const m = { ...(e.meilensteine || {}) };
  let feier = null, geaendert = false;
  for (const z of alleZiele()) {
    if (!(z.betrag > 0)) continue;
    const pct = (z.stand / z.betrag) * 100;
    const stufe = [100, 75, 50, 25].find((s) => pct >= s) || 0;
    if (m[z.id] === undefined) { m[z.id] = stufe; geaendert = true; continue; } // erstes Mal: nur merken
    if (stufe > m[z.id]) { m[z.id] = stufe; geaendert = true; feier ??= { z, stufe }; }
    else if (stufe < m[z.id]) { m[z.id] = stufe; geaendert = true; }
  }
  if (geaendert) { e.meilensteine = m; einstSpeichern(); }
  if (feier) {
    konfetti();
    vibrieren([40, 60, 40]);
    toast(feier.stufe === 100 ? `🎉 ${feier.z.name}: Ziel erreicht!` : `🎉 ${feier.z.name}: ${feier.stufe} % geschafft!`);
  }
}
function konfetti() {
  const farben = ['var(--akzent)', '#3ddc97', '#ffd166', '#ff6fae', '#5aa9ff'];
  for (let i = 0; i < 40; i++) {
    const k = document.createElement('i');
    k.className = 'konfetti';
    k.style.left = `${Math.random() * 100}vw`;
    k.style.background = farben[i % farben.length];
    k.style.animationDelay = `${Math.random() * 0.4}s`;
    k.style.animationDuration = `${1.4 + Math.random()}s`;
    document.body.appendChild(k);
    setTimeout(() => k.remove(), 2800);
  }
}

/* ---------------------------------------------------------------------
   4f. Analyse, Schnell-Favoriten, Abos
   Läuft komplett lokal mit festen Regeln – keine KI, keine Kosten.
   --------------------------------------------------------------------- */

// Wertet die letzten "anzahl" abgeschlossenen Monate aus (nur Monate mit Buchungen)
function analyse(anzahl) {
  const jetzt = heute().slice(0, 7);
  const monate = [];
  for (let i = 1; i <= anzahl; i++) {
    const m = monatVerschieben(jetzt, -i);
    if (buchungenImMonat(m).length) monate.push(m);
  }
  const n = monate.length;
  const zahlen = monate.map(monatsZahlen);
  const summe = (f) => zahlen.reduce((s, z) => s + f(z), 0);
  const proKat = {};
  zahlen.forEach((z, idx) => {
    for (const [id, b] of Object.entries(z.proKat)) {
      proKat[id] ??= { id, summe: 0, je: {} };
      proKat[id].summe += b;
      proKat[id].je[monate[idx]] = b;
    }
  });
  const gesamtAus = summe((z) => z.ausgaben);
  const aktuell = monatsZahlen(jetzt);
  const kats = Object.values(proKat).map((x) => ({
    ...x, kat: kat(x.id) || { name: 'Gelöschte Kategorie', farbe: '#666' },
    schnitt: n ? x.summe / n : 0, anteil: gesamtAus ? x.summe / gesamtAus : 0,
    letzter: x.je[monate[0]] || 0, davor: x.je[monate[1]] || 0, aktuell: aktuell.proKat[x.id] || 0,
  })).sort((a, b) => b.summe - a.summe);
  return {
    jetzt, monate, n, zahlen, kats, aktuell,
    schnittAus: n ? gesamtAus / n : 0, schnittEin: n ? summe((z) => z.einnahmen) / n : 0,
    schnittFix: n ? summe((z) => z.fix) / n : 0, schnittSpar: n ? summe((z) => z.gespart) / n : 0,
  };
}

// Häufige Buchungen der letzten 4 Monate (gleiche Notiz + Kategorie, mind. 2×) → mit einem Tipp buchen
function favoriten() {
  const h = heute();
  const ab = tagVerschieben(h, -120);
  const gruppen = {};
  for (const b of daten.buchungen) {
    if (b.art !== 'ausgabe' || b.vorlageId || b.datum < ab || b.datum > h || kat(b.kategorieId)?.fix) continue;
    const name = (b.notiz || '').trim();
    if (!name) continue;
    const key = `${name.toLowerCase()}|${b.kategorieId}`;
    gruppen[key] ??= { name, kategorieId: b.kategorieId, anzahl: 0, betraege: {} };
    gruppen[key].anzahl++;
    gruppen[key].betraege[b.betrag] = (gruppen[key].betraege[b.betrag] || 0) + 1;
  }
  return Object.values(gruppen).filter((g) => g.anzahl >= 2 && kat(g.kategorieId))
    .map((g) => ({ ...g, betrag: Number(Object.entries(g.betraege).sort((a, b) => b[1] - a[1])[0][0]) }))
    .sort((a, b) => b.anzahl - a.anzahl).slice(0, 6);
}

// Alle regelmäßigen Kosten (Abos, Versicherungen, Raten …) umgerechnet auf Monat und Jahr
function abos() {
  return daten.vorlagen.filter((v) => (v.art || 'ausgabe') === 'ausgabe')
    .map((v) => ({ v, monat: v.betrag / (v.intervall || 1), jahr: (v.betrag * 12) / (v.intervall || 1) }))
    .sort((a, b) => b.jahr - a.jahr);
}
// Seit über einem Jahr nicht angefasst/geprüft?
const aboAlt = (v) => (Date.now() - (v.geprueft || v.geaendert || Date.now())) > 365 * 86400000;

/* ---------------------------------------------------------------------
   5. Ansichten
   Jede Ansicht ist eine Funktion, die HTML-Text zurückgibt.
   render() setzt diesen Text in die Seite ein.
   --------------------------------------------------------------------- */

let ansicht = 'uebersicht';
let aktMonat = heute().slice(0, 7);
let auswertungTab = 'analyse';   // analyse | ausblick | abos
let letzteAnsicht = '';          // für Animationen nur beim Wechsel

// Untere Navigation: 4 Tabs + runder Plus-Knopf in der Mitte
const NAV = [['uebersicht', 'start', 'Übersicht'], ['buchungen', 'liste', 'Buchungen'], null,
  ['auswertung', 'auswertung', 'Auswertung'], ['wuensche', 'wunsch', 'Wünsche']];
function navAufbauen() {
  document.querySelector('nav.unten').innerHTML = NAV.map((x) => (x
    ? `<button data-view="${x[0]}"><span class="pille">${icon(x[1])}</span>${x[2]}</button>`
    : `<button class="fab" data-action="neu" aria-label="Neue Buchung">${icon('plus')}</button>`)).join('');
  document.getElementById('einst-knopf').innerHTML = icon('zahnrad');
}

function render() {
  darstellungAnwenden();
  document.querySelectorAll('nav [data-view]').forEach(
    (b) => b.classList.toggle('aktiv', b.dataset.view === ansicht));
  document.getElementById('einst-knopf').classList.toggle('aktiv', ansicht === 'einstellungen');
  const mitMonat = ansicht === 'uebersicht' || ansicht === 'buchungen';
  document.getElementById('titel-text').textContent = mitMonat ? monatName(aktMonat)
    : { auswertung: 'Auswertung', wuensche: 'Wünsche & Träume', einstellungen: 'Einstellungen' }[ansicht];
  document.querySelectorAll('.pfeil').forEach((p) => (p.style.visibility = mitMonat ? 'visible' : 'hidden'));
  const main = document.getElementById('inhalt');
  main.innerHTML =
    ansicht === 'uebersicht' ? htmlUebersicht()
    : ansicht === 'buchungen' ? htmlBuchungen()
    : ansicht === 'auswertung' ? htmlAuswertung()
    : ansicht === 'wuensche' ? htmlWuensche()
    : htmlEinstellungen();

  // Animationen nur, wenn die Seite oder der Monat gewechselt wurde (nicht bei jeder Kleinigkeit)
  const schluessel = `${ansicht}|${aktMonat}|${auswertungTab}`;
  if (schluessel !== letzteAnsicht) {
    letzteAnsicht = schluessel;
    main.classList.remove('einblenden'); void main.offsetWidth; main.classList.add('einblenden');
    animieren(main);
  }
  if (ansicht === 'uebersicht') { karussellStarten(); meilensteinePruefen(); }
}

// Beträge hochzählen lassen + Ringe füllen
function animieren(box) {
  box.querySelectorAll('.ring circle[data-ziel-offset]').forEach((c) => {
    const ziel = c.dataset.zielOffset;
    c.style.transition = 'none';
    c.setAttribute('stroke-dashoffset', c.getAttribute('stroke-dasharray'));
    void c.getBoundingClientRect();
    c.style.transition = '';
    requestAnimationFrame(() => c.setAttribute('stroke-dashoffset', ziel));
  });
  box.querySelectorAll('[data-zaehlen]').forEach((el) => {
    const ziel = Number(el.dataset.zaehlen);
    const t0 = performance.now();
    const schritt = (t) => {
      const x = Math.min(1, (t - t0) / 650);
      el.innerHTML = euroHtml(Math.round(ziel * (1 - Math.pow(1 - x, 3))));
      if (x < 1) requestAnimationFrame(schritt);
    };
    requestAnimationFrame(schritt);
  });
}

const prozent = (x) => (x * 100).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' %';

let kontoBearbeiten = false;
function htmlKonto() {
  const e = daten.einst;
  const k = kontoInfo();
  if (kontoBearbeiten || !k) {
    return `<section class="karte">
      <div class="label">${icon('bank')} Girokonto – aktueller Stand laut Banking-App (€)</div>
      <input type="text" inputmode="decimal" id="konto-eingabe" style="margin:8px 0" placeholder="z. B. 1.234,56"
        value="${k ? centZuText(k.stand) : ''}">
      <div class="knopfreihe" style="margin-top:0">
        <button class="knopf haupt" data-action="konto-speichern">Speichern</button>
        ${k ? '<button class="knopf" data-action="konto-abbrechen">Abbrechen</button>' : ''}
      </div>
      ${k ? '' : '<div class="klein grau" style="margin-top:8px">Danach rechnet die App mit deinen Buchungen selbst weiter.</div>'}
    </section>`;
  }
  const seit = new Date(e.kontoStichtag).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  return `<section class="karte">
    <div class="zeile"><span class="label">${icon('bank')} Girokonto heute</span>
      <button class="x" data-action="konto-bearbeiten" aria-label="Kontostand abgleichen">${icon('stift')}</button></div>
    <div class="zahl mittel ${k.stand < 0 ? 'rot' : ''}" style="margin-top:-4px">${euroHtml(k.stand)}</div>
    ${k.ende !== k.stand ? `<div>Monatsende voraussichtlich <b class="${k.ende < 0 ? 'rot' : ''}">${euro(k.ende)}</b></div>` : ''}
    <div class="klein grau" style="margin-top:4px">Mit der Bank abgeglichen am ${seit} · seitdem eingetragene Buchungen sind eingerechnet</div>
  </section>`;
}

// --- Ziel-Karten ganz oben (wischen oder automatisch weiterdrehen) ---
function htmlZielKarte(z) {
  const anteil = z.betrag > 0 ? Math.min(1, z.stand / z.betrag) : 0;
  const pr = zielPrognose(z);
  let prognoseText;
  if (pr.ohneBetrag) prognoseText = 'Tippe hier und leg einen Zielbetrag fest';
  else if (pr.erreicht) prognoseText = '<span class="gruen">Ziel erreicht 🎉</span>';
  else if (pr.ohneTempo) prognoseText = `Noch ${euro(pr.rest)} – mit einer Sparrate siehst du, wann du es schaffst`;
  else if (pr.zuLang) prognoseText = `Noch ${euro(pr.rest)} – bei deinem Tempo über 10 Jahre. Eine höhere Sparrate hilft.`;
  else {
    prognoseText = `${pr.ampel ? `<span class="ampel ${pr.ampel}"></span>` : ''}Bei deinem Tempo erreicht im <b>${monatName(pr.monat)}</b>`
      + (pr.ampel ? ` · ${{ gruen: 'im Plan', gelb: 'knapp', rot: 'hinter dem Plan' }[pr.ampel]}` : '');
  }
  let monatText;
  if (z.diesenMonat > 0 && z.diesenMonat >= z.tempo) monatText = `<span class="gruen">+${euro(z.diesenMonat)} diesen Monat 💪</span>`;
  else if (z.tempo > 0) monatText = `${z.diesenMonat > 0 ? `+${euro(z.diesenMonat)} · ` : ''}noch ${euro(z.tempo - z.diesenMonat)} bis zu deinem Monatsziel`;
  else monatText = z.diesenMonat > 0 ? `+${euro(z.diesenMonat)} diesen Monat` : 'Diesen Monat noch nichts dafür gespart';
  if (z.basis && daten.einst.zielGleichPuffer && daten.einst.puffer > 0) {
    const pm = pufferMonate(daten.einst.puffer);
    if (pm !== null) monatText += ` · Puffer reicht für ${monateText(pm)} Monate`;
  }
  const label = z.basis ? 'Basis' : z.wunsch?.typ === 'projekt' ? 'Mein Traum' : 'Mein Ziel';
  return `<section class="karte zielkarte tippbar" data-action="ziel-details" data-id="${z.id}">
    <div class="ziel-kopf">
      ${ringSvg(anteil, 96)}
      <div style="flex:1;min-width:0">
        <div class="label">${label}</div>
        <div class="ziel-name"><span class="ziel-emoji">${esc(z.emoji)}</span> ${esc(z.name)}</div>
        <div style="margin-top:4px"><b>${euroHtml(z.stand)}</b> <span class="klein grau">von ${euro(z.betrag)}</span></div>
      </div>
    </div>
    <div class="klein" style="margin-top:12px">${prognoseText}</div>
    <div class="klein grau" style="margin-top:2px">${monatText}</div>
  </section>`;
}
function htmlZiele() {
  const ziele = alleZiele();
  if (!ziele.length) return '';
  return `<div class="ziele" id="ziele">${ziele.map(htmlZielKarte).join('')}</div>
    ${ziele.length > 1 ? `<div class="punkte">${ziele.map(() => '<i></i>').join('')}</div>` : ''}`;
}
let karussellTimer = null, karussellBeruehrt = 0, karussellIndex = 0;
function karussellStarten() {
  clearInterval(karussellTimer);
  const box = document.getElementById('ziele');
  if (!box) return;
  const n = box.children.length;
  const schritt = () => (n > 1 ? box.children[1].offsetLeft - box.children[0].offsetLeft : box.clientWidth);
  const punkte = () => {
    karussellIndex = Math.min(n - 1, Math.round(box.scrollLeft / schritt()));
    document.querySelectorAll('.punkte i').forEach((p, j) => p.classList.toggle('an', j === karussellIndex));
  };
  if (karussellIndex >= n) karussellIndex = 0;
  box.scrollLeft = karussellIndex * schritt();
  box.addEventListener('scroll', punkte, { passive: true });
  box.addEventListener('touchstart', () => (karussellBeruehrt = Date.now()), { passive: true });
  box.addEventListener('pointerdown', () => (karussellBeruehrt = Date.now()));
  punkte();
  if (n < 2) return;
  karussellTimer = setInterval(() => {
    if (!document.body.contains(box)) { clearInterval(karussellTimer); return; }
    if (document.hidden || sheetOffen || Date.now() - karussellBeruehrt < 10000) return;
    box.scrollTo({ left: ((karussellIndex + 1) % n) * schritt(), behavior: 'smooth' });
  }, 6000);
}

// Monatsrückblick: in den ersten 10 Tagen eines Monats eine Karte zum Vormonat
function htmlRueckblick() {
  const jetzt = heute().slice(0, 7);
  if (aktMonat !== jetzt || Number(heute().slice(8)) > 10) return '';
  const vm = monatVerschieben(jetzt, -1);
  if (daten.einst.rueckblickGesehen === vm) return '';
  const z = monatsZahlen(vm);
  if (!z.anzahl) return '';
  const vv = monatsZahlen(monatVerschieben(vm, -1));
  const top = Object.entries(z.proKat).sort((a, b) => b[1] - a[1])[0];
  const v = vv.ausgaben > 0 ? (z.ausgaben - vv.ausgaben) / vv.ausgaben : null;
  const name = MONATE[Number(vm.slice(5)) - 1];
  return `<section class="karte hero">
    <div class="zeile"><h2 style="margin:0">${icon('kalender')} Dein ${name}</h2>
      <button class="x" data-action="rueckblick-weg" aria-label="Ausblenden">${icon('kreuz')}</button></div>
    <div style="margin-top:8px;font-size:1.05rem">${z.gespart > 0 ? `<b class="blau">${euro(z.gespart)}</b> gespart 💪` : 'Nichts aufs Sparkonto gelegt'}
      ${z.sparquote !== null ? `· Sparquote <b>${prozent(z.sparquote)}</b>` : ''}</div>
    <div class="klein" style="margin-top:4px">Ausgaben ${euro(z.ausgaben)}${v !== null ? ` <span class="${v <= 0 ? 'gruen' : 'rot'}">(${v > 0 ? '+' : ''}${prozent(v)} ggü. Vormonat)</span>` : ''}</div>
    ${top ? `<div class="klein">Größte Kategorie: <b>${esc(kat(top[0])?.name || '?')}</b> (${euro(top[1])})</div>` : ''}
  </section>`;
}

function htmlBudgets(z) {
  const mitBudget = kategorienVon('ausgabe').filter((k) => k.budget > 0);
  if (!mitBudget.length) return '';
  return `<section class="karte"><h2>${icon('ziel')} Budgets</h2>` + mitBudget.map((k) => {
    const aus = z.proKat[k.id] || 0;
    const a = aus / k.budget;
    const stufe = a >= 1 ? 'rot' : a >= 0.8 ? 'gelb' : 'gruen';
    return `<div class="katzeile">
      <div class="zeile"><span><span class="punkt" style="background:${esc(k.farbe)}"></span>${esc(k.name)}</span>
        <span>${euro(aus)} <span class="klein grau">/ ${euro(k.budget)}</span></span></div>
      <div class="leiste"><span style="width:${Math.min(100, a * 100)}%;background:var(--${stufe})"></span></div>
      <div class="klein ${stufe === 'gruen' ? 'grau' : stufe}">${a >= 1 ? `${euro(aus - k.budget)} über dem Budget`
        : a >= 0.8 ? `⚠ ${prozent(a)} verbraucht – noch ${euro(k.budget - aus)}` : `noch ${euro(k.budget - aus)}`}</div>
    </div>`;
  }).join('') + '</section>';
}

function htmlUebersicht() {
  const z = monatsZahlen(aktMonat);
  const e = daten.einst;
  const jetzt = heute().slice(0, 7);
  let h = htmlZiele();

  // Hinweise
  const fehlend = fehlendeVorlagen(aktMonat);
  if (fehlend.length) {
    h += `<button class="hinweis" data-action="vorlagen-uebernehmen">${icon('pin')} ${fehlend.length} regelmäßige Buchung${fehlend.length > 1 ? 'en' : ''} für ${monatName(aktMonat)} eintragen
      <div class="klein grau" style="margin-top:4px">${fehlend.map((v) => esc(v.name)
        + (vorlageBetrag(v, aktMonat) !== v.betrag ? ` (einmalig ${euro(vorlageBetrag(v, aktMonat))})` : '')).join(' · ')}</div></button>`;
  }
  h += kreditFertigHinweise();
  if (backupFaellig()) {
    h += `<button class="hinweis warn" data-action="export">${icon('backup')} Backup ist über 30 Tage alt (oder noch nie gemacht). Jetzt sichern</button>`;
  }
  if (!alleZiele().length) {
    h += `<button class="hinweis" data-view="wuensche">${icon('ziel')} Leg ein Sparziel fest oder markiere einen Wunsch mit ⭐ – dann siehst du hier deinen Fortschritt</button>`;
  }
  h += htmlRueckblick();

  // Hero: was diesen Monat noch frei ist
  h += `<section class="karte hero">
    <div class="label">Noch frei im ${MONATE[Number(aktMonat.slice(5)) - 1]}</div>
    <div class="zahl ${z.frei < 0 ? 'rot' : ''}" data-zaehlen="${z.frei}">${euroHtml(z.frei)}</div>
    <div class="hero-unten klein">
      <span class="grau">Ein <b class="gruen">${euro(z.einnahmen)}</b></span>
      <span class="grau">Aus <b class="rot">${euro(z.ausgaben)}</b></span>
      <span class="grau">Spar <b class="blau">${euro(z.gespart)}</b></span>
    </div>
  </section>`;

  // Schnell buchen (häufige Ausgaben mit einem Tipp)
  const fav = aktMonat === jetzt ? favoriten() : [];
  if (fav.length) {
    h += `<section class="karte"><h2>${icon('blitz')} Schnell buchen</h2>
      <div class="chips" style="margin:0">${fav.map((f) => `<button class="chip schnell" data-action="schnell-buchen"
        data-name="${esc(f.name)}" data-kat="${f.kategorieId}" data-betrag="${f.betrag}">
        <span class="punkt" style="background:${esc(kat(f.kategorieId).farbe)}"></span>${esc(f.name)} · ${euro(f.betrag)}</button>`).join('')}</div>
      <div class="klein grau" style="margin-top:8px">Ein Tipp = heute gebucht</div></section>`;
  }

  if (aktMonat === jetzt) h += htmlKonto();
  h += htmlBudgets(z);

  if (z.anzahl === 0) {
    h += `<div class="leer">Noch keine Buchungen in diesem Monat.<br>Tippe auf <b>+</b>, um etwas einzutragen.</div>`;
  }

  // Meine Monatszahl
  const fixAnteil = z.ausgaben ? (z.fix / z.ausgaben) * 100 : 0;
  h += `<section class="karte">
    <div class="label">Meine Monatszahl (Ausgaben)</div>
    <div class="zahl">${euroHtml(z.ausgaben)}</div>
    <div class="leiste"><span style="width:${fixAnteil}%;background:#ff8a65"></span><span style="width:${100 - fixAnteil}%;background:var(--akzent)"></span></div>
    <div class="zeile klein"><span><span class="punkt" style="background:#ff8a65"></span>Fix ${euro(z.fix)}</span><span><span class="punkt" style="background:var(--akzent)"></span>Variabel ${euro(z.variabel)}</span></div>
  </section>`;

  // Sparquote + Puffer
  const sqFarbe = z.sparquote === null ? '' : z.sparquote >= 0.2 ? 'gruen' : z.sparquote >= 0 ? 'gelb' : 'rot';
  const d = durchschnittAusgaben(aktMonat);
  const pm = e.puffer > 0 && d.schnitt > 0 ? e.puffer / d.schnitt : null;
  h += `<div class="raster">
    <section class="karte"><div class="label">Sparquote</div><div class="wert ${sqFarbe}">${z.sparquote === null ? '–' : prozent(z.sparquote)}</div></section>
    <section class="karte tippbar" data-view="einstellungen"><div class="label">Puffer ${euro(e.puffer)}</div>
      <div class="wert ${pm === null ? '' : pm >= 3 ? 'gruen' : pm >= 1 ? 'gelb' : 'rot'}">${pm === null ? '–' : `${monateText(pm)} Mon.`}</div></section>
  </div>`;

  // Ausgaben nach Kategorien
  const katListe = Object.entries(z.proKat).sort((a, b) => b[1] - a[1]);
  if (katListe.length) {
    const max = katListe[0][1];
    h += `<section class="karte"><h2>${icon('kategorie')} Ausgaben nach Kategorien</h2>` + katListe.map(([id, summe]) => {
      const k = kat(id) || { name: 'Gelöschte Kategorie', farbe: '#666' };
      return `<div class="katzeile">
        <div class="zeile"><span><span class="punkt" style="background:${esc(k.farbe)}"></span>${esc(k.name)}${k.fix ? ' <span class="badge">fix</span>' : ''}</span>
        <span>${euro(summe)} <span class="klein grau">${prozent(summe / z.ausgaben)}</span></span></div>
        <div class="leiste"><span style="width:${(summe / max) * 100}%;background:${esc(k.farbe)}"></span></div>
      </div>`;
    }).join('') + `</section>`;
  }

  // Kredite & Verträge
  if (daten.kredite.length) {
    const infos = daten.kredite.map((k) => ({ k, i: kreditInfo(k) }));
    const raten = infos.filter((x) => x.i.raten > 0).reduce((s, x) => s + x.k.rate, 0);
    const offen = infos.reduce((s, x) => s + (x.i.offen || 0), 0);
    h += `<section class="karte"><h2>${icon('karte')} Kredite & Verträge</h2>
      <div class="zeile"><span>Raten pro Monat</span><b>${euro(raten)}</b></div>
      <div class="zeile"><span>Insgesamt noch zu zahlen</span><b class="rot">${euro(offen)}</b></div>
      ${infos.map(({ k, i }) => {
        const anteil = k.typ === 'kredit' && k.ursprung > 0 ? Math.min(1, Math.max(0, 1 - i.restschuld / k.ursprung)) : null;
        return `<div class="katzeile" style="margin-top:14px">
          <div class="zeile"><b>${esc(k.name)}</b><span>${euro(k.rate)}/Monat</span></div>
          <div class="klein grau">${k.typ === 'kredit'
            ? (k.geschaetzt && !k.zins ? `Noch zu zahlen ${euro(i.restschuld)}` : `Restschuld ${k.geschaetzt ? 'ca. ' : ''}${euro(i.restschuld)}`)
            + `${k.zins ? ` · ${String(k.zins).replace('.', ',')} % Zins` : ''}${i.zinsen ? ` · noch ${euro(i.zinsen)} Zinsen` : ''}`
            : `noch offen ${euro(i.offen)}`}</div>
          ${anteil !== null ? `<div class="leiste"><span style="width:${anteil * 100}%;background:var(--gruen)"></span></div><div class="klein grau">${prozent(anteil)} getilgt</div>` : ''}
          <div class="klein">${laufzeitText(i)}</div>
        </div>`;
      }).join('')}
    </section>`;
  }

  // Kleine Ausgaben, die sich summieren
  const klein = kleineAusgaben(aktMonat);
  if (klein.anzahl > 0) {
    h += `<section class="karte"><h2>${icon('suche')} Kleine Ausgaben (bis ${euro(e.kleinGrenze)})</h2>
      <div class="zeile"><span>${klein.anzahl} kleine Ausgaben</span><b>${euro(klein.summe)}</b></div>
      ${klein.mehrfach.map((g) => `<div class="zeile klein" style="margin-top:6px"><span class="grau">${esc(g.name)} · ${g.anzahl}×</span><span>${euro(g.summe)}</span></div>`).join('')}
      <div class="klein grau" style="margin-top:8px">Hochgerechnet aufs Jahr: ca. ${euro(klein.summe * 12)}</div>
    </section>`;
  }
  return h;
}

/* ---------------------------------------------------------------------
   5a. Ausblick (Prognose) – Teil der Auswertung
   Für jeden kommenden Monat wird zusammengerechnet:
     + eingetragene Buchungen (auch geplante mit Datum in der Zukunft)
     + regelmäßige Buchungen, die fällig, aber noch nicht eingetragen sind
       (Kreditraten nur bis zur letzten Rate)
     + geschätzte variable Ausgaben (Durchschnitt der letzten 3 Monate)
   Daraus: was pro Monat frei bleibt und wie sich das Girokonto entwickelt.
   --------------------------------------------------------------------- */

let ausblickMonate = 12;

// Ø variable Ausgaben (alles, was nicht Fixkosten und nicht aus Vorlagen ist)
function variablerSchnitt() {
  const jetzt = heute().slice(0, 7);
  const werte = [];
  for (let i = 1; i <= 12 && werte.length < 3; i++) {
    const liste = buchungenImMonat(monatVerschieben(jetzt, -i)).filter((b) => b.art === 'ausgabe');
    if (!liste.length) continue;
    werte.push(liste.filter((b) => !b.vorlageId && !kat(b.kategorieId)?.fix).reduce((s, b) => s + b.betrag, 0));
  }
  return { schnitt: werte.length ? Math.round(werte.reduce((s, x) => s + x, 0) / werte.length) : 0, monate: werte.length };
}

function prognose(anzahl) {
  const h = heute();
  const jetzt = h.slice(0, 7);
  const varSchnitt = variablerSchnitt().schnitt;
  const konto = kontoInfo();
  let stand = konto ? konto.stand : null;
  const monate = [];

  for (let i = 0; i < anzahl; i++) {
    const m = monatVerschieben(jetzt, i);
    const r = { monat: m, ein: 0, aus: 0, spar: 0, variabel: 0, ereignisse: [] };
    const plus = (art, betrag) => { if (art === 'einnahme') r.ein += betrag; else if (art === 'sparen') r.spar += betrag; else r.aus += betrag; };
    const vz = (art) => (art === 'einnahme' ? '+' : '−');

    for (const b of buchungenImMonat(m)) {
      plus(b.art, b.betrag);
      if (b.datum > h && !b.vorlageId) r.ereignisse.push(`⏳ ${esc(b.notiz || kat(b.kategorieId)?.name || 'Geplant')} ${vz(b.art)}${euro(b.betrag)}`);
    }
    for (const v of fehlendeVorlagen(m)) {
      const betrag = vorlageBetrag(v, m);
      plus(v.art || 'ausgabe', betrag);
      if ((v.intervall || 1) > 1) r.ereignisse.push(`🔁 ${esc(v.name)} ${vz(v.art)}${euro(betrag)}`);
      else if (betrag !== v.betrag) r.ereignisse.push(`✱ ${esc(v.name)} einmalig ${vz(v.art)}${euro(betrag)}`);
    }
    // variable Ausgaben: im laufenden Monat nur der Rest, der voraussichtlich noch kommt
    if (i === 0) {
      const schon = buchungenImMonat(m).filter((b) => b.art === 'ausgabe' && !b.vorlageId && !kat(b.kategorieId)?.fix && b.datum <= h)
        .reduce((s, b) => s + b.betrag, 0);
      r.variabel = Math.max(0, varSchnitt - schon);
    } else r.variabel = varSchnitt;
    r.aus += r.variabel;
    r.frei = r.ein - r.aus - r.spar;

    if (stand !== null) {
      stand = i === 0 ? konto.ende - r.variabel : stand + r.frei;
      r.konto = stand;
    }
    for (const k of daten.kredite) {
      const ki = kreditInfo(k);
      if (ki.raten && ki.ende === m) r.ereignisse.push(`🎉 ${esc(k.name)}: letzte Rate – danach ${euro(k.rate)} mehr pro Monat`);
    }
    monate.push(r);
  }
  return monate;
}

function htmlAusblick() {
  const p = prognose(ausblickMonate);
  const v = variablerSchnitt();
  const hatKonto = p[0].konto !== undefined;
  const letzter = p[p.length - 1];
  const freiSchnitt = Math.round(p.reduce((s, r) => s + r.frei, 0) / p.length);
  const max = Math.max(1, ...p.map((r) => Math.abs(hatKonto ? r.konto : r.frei)));
  // Rücklage für nicht-monatliche Zahlungen (z. B. Versicherung vierteljährlich)
  const ruecklage = daten.vorlagen.filter((x) => (x.intervall || 1) > 1 && (x.art || 'ausgabe') === 'ausgabe')
    .reduce((s, x) => s + x.betrag / x.intervall, 0);

  let h = `<div class="segment">${[12, 24, 36].map((n) =>
    `<button data-action="ausblick-monate" data-n="${n}" class="${n === ausblickMonate ? 'an' : ''}">${n} Monate</button>`).join('')}</div>`;

  h += `<section class="karte">
    ${hatKonto ? `<div class="label">Girokonto in ${ausblickMonate} Monaten (${monatKurz(letzter.monat)}) voraussichtlich</div>
      <div class="zahl mittel ${letzter.konto < 0 ? 'rot' : ''}">${euro(letzter.konto)}</div>`
      : `<div class="klein grau" style="margin-bottom:8px">Trag in der Übersicht deinen Kontostand ein, dann siehst du hier auch, wie sich dein Konto entwickelt.</div>`}
    <div class="zeile"><span>Ø frei pro Monat</span><b class="${freiSchnitt < 0 ? 'rot' : 'gruen'}">${euro(freiSchnitt)}</b></div>
    <div class="zeile klein grau" style="margin-top:4px"><span>Variable Ausgaben geschätzt</span><span>${v.monate ? `${euro(v.schnitt)}/Monat (Ø ${v.monate} Mon.)` : 'noch keine Daten'}</span></div>
    ${ruecklage ? `<div class="zeile klein grau" style="margin-top:4px"><span>Rücklage für Quartals-/Jahreszahlungen</span><span>${euro(Math.round(ruecklage))}/Monat</span></div>` : ''}
    ${v.monate ? '' : '<div class="klein grau" style="margin-top:6px">Die Schätzung für Essen, Tanken, Freizeit … wird genauer, sobald ein paar Monate eingetragen sind.</div>'}
  </section>`;

  h += `<section class="karte">` + p.map((r) => {
    const wert = hatKonto ? r.konto : r.frei;
    return `<div class="ausblick-monat">
      <div class="zeile"><b>${monatKurz(r.monat)}</b>
        <span class="${r.frei < 0 ? 'rot' : 'gruen'}">${r.frei >= 0 ? '+' : ''}${euro(r.frei)} frei</span></div>
      <div class="leiste" style="height:8px"><span style="width:${(Math.abs(wert) / max) * 100}%;background:${wert < 0 ? 'var(--rot)' : 'var(--blau)'}"></span></div>
      <div class="zeile klein grau"><span>Ein ${euro(r.ein)} · Aus ${euro(r.aus)}${r.spar ? ` · Spar ${euro(r.spar)}` : ''}</span>
        ${hatKonto ? `<span class="${r.konto < 0 ? 'rot' : ''}">Konto ${euro(r.konto)}</span>` : ''}</div>
      ${r.ereignisse.map((e) => `<div class="klein" style="margin-top:3px">${e}</div>`).join('')}
    </div>`;
  }).join('') + `</section>`;

  h += `<div class="klein grau" style="padding:0 4px 8px">💡 Bevorstehende Zahlungen (z. B. TÜV, Urlaub, Geschenke) trägst du einfach mit <b>+</b> und einem Datum in der Zukunft ein.
    Regelmäßige Zahlungen wie Versicherungen legst du unter Einstellungen → Regelmäßige Buchungen an.</div>`;
  return h;
}

// --- Buchungen: Suche & Filter, gruppiert nach Tag, nach links wischen = löschen ---
let suchText = '', suchKat = '';
function htmlBuchungen() {
  const kats = [...kategorienVon('ausgabe'), ...kategorienVon('einnahme'), ...kategorienVon('sparen')];
  return `<div class="suche">
      <input type="search" id="such-feld" placeholder="Suchen: Notiz, Kategorie, Betrag …" value="${esc(suchText)}" autocomplete="off">
      <select id="such-kat" style="width:auto;max-width:42%"><option value="">Alle</option>
        ${kats.map((k) => `<option value="${k.id}" ${k.id === suchKat ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
    </div>
    <div id="buchungsliste" style="display:flex;flex-direction:column;gap:12px">${htmlBuchungsliste()}</div>`;
}
function buchungPasst(b, suche) {
  if (!suche) return true;
  const k = kat(b.kategorieId);
  if ((b.notiz || '').toLowerCase().includes(suche) || (k?.name || '').toLowerCase().includes(suche)) return true;
  // Betrag: "12,50" findet genau den Betrag, ">50" alles über 50 €, "<10" alles unter 10 €
  const vergleich = suche.match(/^([<>])\s*(.+)$/);
  if (vergleich) {
    const c = centAusText(vergleich[2]);
    return c !== null && (vergleich[1] === '>' ? Math.abs(b.betrag) > c : Math.abs(b.betrag) < c);
  }
  return centZuText(Math.abs(b.betrag)).includes(suche.replace('€', '').trim());
}
function htmlBuchungsliste() {
  const suche = suchText.trim().toLowerCase();
  // Mit Suchtext wird in ALLEN Monaten gesucht, sonst nur im gewählten Monat
  let liste = suche ? [...daten.buchungen] : buchungenImMonat(aktMonat);
  if (suchKat) liste = liste.filter((b) => b.kategorieId === suchKat);
  liste = liste.filter((b) => buchungPasst(b, suche)).sort((a, b) => b.datum.localeCompare(a.datum) || (b.erstellt || 0) - (a.erstellt || 0));
  if (!liste.length) {
    return `<div class="leer">${suche || suchKat ? 'Nichts gefunden.' : `Keine Buchungen in ${monatName(aktMonat)}.`}</div>`;
  }
  let ein = 0, aus = 0, spar = 0;
  for (const b of liste) { if (b.art === 'einnahme') ein += b.betrag; else if (b.art === 'sparen') spar += b.betrag; else aus += b.betrag; }
  let h = `<section class="karte zeile klein">
    <span>Ein <b class="gruen">${euro(ein)}</b></span>
    <span>Aus <b class="rot">${euro(aus)}</b></span>
    <span>Spar <b class="blau">${euro(spar)}</b></span></section>
    ${suche ? `<div class="klein grau" style="margin:-4px 4px">${liste.length} Treffer in allen Monaten</div>` : ''}`;
  // nach Tagen gruppieren
  const tage = [];
  for (const b of liste) {
    if (!tage.length || tage[tage.length - 1].datum !== b.datum) tage.push({ datum: b.datum, liste: [] });
    tage[tage.length - 1].liste.push(b);
  }
  h += '<div>';
  for (const t of tage) {
    const summe = t.liste.reduce((s, b) => s + (b.art === 'einnahme' ? b.betrag : -b.betrag), 0);
    const tagName = suche && t.datum.slice(0, 4) !== heute().slice(0, 4) ? datumLang(t.datum) : tagRelativ(t.datum);
    h += `<div class="tag"><span>${tagName}</span><span>${summe > 0 ? '+' : summe < 0 ? '−' : ''}${euro(Math.abs(summe))}</span></div>`;
    for (const b of t.liste) h += htmlBuchungZeile(b);
  }
  return h + '</div>';
}
function htmlBuchungZeile(b) {
  const k = kat(b.kategorieId) || { name: 'Gelöschte Kategorie', farbe: '#666666' };
  const entnahme = b.art === 'sparen' && b.betrag < 0;
  const vorzeichen = b.art === 'einnahme' ? '+' : entnahme ? '← ' : b.art === 'sparen' ? '→ ' : '−';
  const farbe = b.art === 'einnahme' || entnahme ? 'gruen' : b.art === 'sparen' ? 'blau' : '';
  const w = b.wunschId ? daten.wuensche.find((x) => x.id === b.wunschId) : null;
  const buchstabe = esc((k.name.match(/[A-Za-zÄÖÜäöü0-9]/) || ['?'])[0].toUpperCase());
  return `<div class="buchung-wrap"><div class="loesch-hg">${icon('muell')} Löschen</div>
    <button class="buchung" data-action="bearbeiten" data-id="${b.id}">
      <span class="kat-symbol" style="background:${esc(k.farbe)}26;color:${esc(k.farbe)}">${w ? esc(wunschEmoji(w)) : buchstabe}</span>
      <span class="mitte"><div>${esc(k.name)}${b.vorlageId ? ` <span class="grau">${icon('wiederholen')}</span>` : ''}${b.datum > heute() ? ' <span class="badge">geplant</span>' : ''}</div>
        ${b.notiz ? `<div class="notiz">${esc(b.notiz)}</div>` : ''}</span>
      <span class="betrag ${farbe}">${vorzeichen}${euro(Math.abs(b.betrag))}</span>
    </button></div>`;
}

/* ---------------------------------------------------------------------
   5b. Auswertung: Analyse · Ausblick · Abos
   --------------------------------------------------------------------- */

function htmlAuswertung() {
  const tabs = [['analyse', 'Analyse'], ['ausblick', 'Ausblick'], ['abos', 'Abos']];
  return `<div class="segment">${tabs.map(([k, t]) =>
    `<button data-action="auswertung-tab" data-tab="${k}" class="${k === auswertungTab ? 'an' : ''}">${t}</button>`).join('')}</div>`
    + (auswertungTab === 'analyse' ? htmlAnalyse() : auswertungTab === 'ausblick' ? htmlAusblick() : htmlAbos());
}

let analyseMonate = 3;
let wasWaereKat = null, wasWaereBetrag = 0;

function htmlAnalyse() {
  const a = analyse(analyseMonate);
  let h = `<div class="segment">${[3, 6, 12].map((n) =>
    `<button data-action="analyse-monate" data-n="${n}" class="${n === analyseMonate ? 'an' : ''}">${n} Monate</button>`).join('')}</div>`;
  if (a.n < 2) {
    h += `<div class="hinweis warn">${icon('warn')} Noch zu wenig Daten: Für eine gute Analyse braucht es 2–3 abgeschlossene Monate
      mit Buchungen (bisher ${a.n}). Was schon geht, siehst du hier.</div>`;
  }
  if (a.n === 0) return h;

  // Überblick
  const sq = a.schnittEin > 0 ? (a.schnittEin - a.schnittAus) / a.schnittEin : null;
  const fixQuote = a.schnittEin > 0 ? a.schnittFix / a.schnittEin : null;
  h += `<section class="karte"><h2>${icon('auswertung')} Ø pro Monat (${a.n} Monat${a.n > 1 ? 'e' : ''})</h2>
    <div class="raster" style="gap:10px">
      <div><div class="label">Einnahmen</div><div class="wert gruen">${euroHtml(Math.round(a.schnittEin))}</div></div>
      <div><div class="label">Ausgaben</div><div class="wert">${euroHtml(Math.round(a.schnittAus))}</div></div>
      <div><div class="label">Gespart</div><div class="wert blau">${euroHtml(Math.round(a.schnittSpar))}</div></div>
      <div><div class="label">Sparquote</div><div class="wert ${sq === null ? '' : sq >= 0.1 ? 'gruen' : sq >= 0 ? 'gelb' : 'rot'}">${sq === null ? '–' : prozent(sq)}</div></div>
    </div>
    ${fixQuote !== null ? `<div class="klein" style="margin-top:12px"><b>${prozent(fixQuote)}</b> deines Einkommens sind fest verplant (Fixkosten).</div>` : ''}
  </section>`;

  // Wohin geht das Geld?
  if (a.kats.length) {
    const max = a.kats[0].schnitt;
    h += `<section class="karte"><h2>${icon('kategorie')} Wohin geht das Geld?</h2>` + a.kats.map((k) => {
      let trend = '';
      if (a.n >= 2 && k.davor > 0) {
        const t = (k.letzter - k.davor) / k.davor;
        if (Math.abs(t) >= 0.05) trend = `<span class="${t > 0 ? 'rot' : 'gruen'}">${icon(t > 0 ? 'hoch' : 'runter')} ${prozent(Math.abs(t))}</span>`;
      }
      return `<div class="katzeile">
        <div class="zeile"><span><span class="punkt" style="background:${esc(k.kat.farbe)}"></span>${esc(k.kat.name)}${k.kat.fix ? ' <span class="badge">fix</span>' : ''}</span>
          <span>${euro(Math.round(k.schnitt))} <span class="klein grau">Ø · ${prozent(k.anteil)}</span></span></div>
        <div class="leiste" style="height:7px"><span style="width:${(k.schnitt / max) * 100}%;background:${esc(k.kat.farbe)}"></span></div>
        ${trend ? `<div class="klein grau">Letzter Monat ggü. davor: ${trend}</div>` : ''}
      </div>`;
    }).join('') + '</section>';
  }

  // Auffälligkeiten (Warnungen, Hinweise, Lob)
  const punkte = [];
  const tag = Number(heute().slice(8));
  const vormonatName = MONATE[Number(a.monate[0].slice(5)) - 1];
  for (const k of a.kats) {
    if (k.kat.fix || a.n < 2) continue;
    if (k.aktuell > k.schnitt * 1.3 && k.aktuell - k.schnitt > 2000) {
      punkte.push(['warn', `<b>${esc(k.kat.name)}</b> diesen Monat schon ${euro(k.aktuell)} – ${prozent(k.aktuell / k.schnitt - 1)} über deinem Schnitt (${euro(Math.round(k.schnitt))}).`]);
    } else if (tag >= 25 && k.aktuell < k.schnitt * 0.85 && k.schnitt - k.aktuell > 2000) {
      punkte.push(['gut', `Diesen Monat ${euro(Math.round(k.schnitt - k.aktuell))} weniger für <b>${esc(k.kat.name)}</b> als im Schnitt 👍`]);
    } else if (k.letzter < k.schnitt * 0.85 && k.schnitt - k.letzter > 2000) {
      punkte.push(['gut', `Im ${vormonatName} ${euro(Math.round(k.schnitt - k.letzter))} weniger für <b>${esc(k.kat.name)}</b> als im Schnitt 👍`]);
    }
  }
  let kleinAnz = 0, kleinSumme = 0;
  for (const m of a.monate) { const k = kleineAusgaben(m); kleinAnz += k.anzahl; kleinSumme += k.summe; }
  if (kleinAnz / a.n >= 5) {
    punkte.push(['info', `<b>Kleinvieh:</b> Ø ${Math.round(kleinAnz / a.n)}× bis ${euro(daten.einst.kleinGrenze)} = ${euro(Math.round(kleinSumme / a.n))} pro Monat (${euroRund(kleinSumme / a.n * 12)} im Jahr).`]);
  }
  if (fixQuote !== null && fixQuote > 0.6) punkte.push(['warn', `Über 60 % deines Einkommens sind fest verplant – da bleibt wenig Spielraum. Ein Blick auf die Abos lohnt sich.`]);
  const ab = abos();
  if (ab.length) {
    const jahr = ab.reduce((s, x) => s + x.jahr, 0);
    punkte.push(['info', `<b>Regelmäßige Kosten:</b> ${euroRund(jahr)} im Jahr. Größter Posten: ${esc(ab[0].v.name)} (${euroRund(ab[0].jahr)}/Jahr).`]);
    const alt = ab.filter((x) => aboAlt(x.v) && !x.v.kreditId);
    if (alt.length) punkte.push(['warn', `${alt.length} regelmäßige Zahlung${alt.length > 1 ? 'en' : ''} seit über einem Jahr nicht geprüft: ${alt.slice(0, 3).map((x) => esc(x.v.name)).join(', ')} → Tab „Abos“.`]);
  }
  if (sq !== null && a.n >= 2) {
    punkte.push(sq >= 0.1 ? ['gut', `Deine Sparquote liegt bei ${prozent(sq)} – der übliche Richtwert ist 10–20 %. Stark!`]
      : ['info', `Deine Sparquote liegt bei ${prozent(sq)}. Üblicher Richtwert: 10–20 %.`]);
  }
  if (punkte.length) {
    const sym = { warn: `<span class="gelb">${icon('warn')}</span>`, gut: `<span class="gruen">${icon('haken')}</span>`, info: `<span class="akzent">${icon('idee')}</span>` };
    h += `<section class="karte"><h2>${icon('idee')} Auffälligkeiten</h2>
      ${punkte.map(([art, t]) => `<div style="display:flex;gap:10px;margin:10px 0">${sym[art]}<div class="klein">${t}</div></div>`).join('')}</section>`;
  }

  // Vorschläge mit Wirkung aufs Ziel
  const ziel = hauptZiel();
  const kandidaten = a.kats.filter((k) => !k.kat.fix && k.schnitt >= 3000).slice(0, 3);
  if (kandidaten.length) {
    h += `<section class="karte"><h2>${icon('blitz')} Spar-Vorschläge</h2>` + kandidaten.map((k) => {
      const kuerz = Math.max(500, Math.round((k.schnitt * 0.15) / 500) * 500);
      let wirkung = null;
      if (ziel) {
        const alt = zielPrognose(ziel), neu = zielPrognose(ziel, kuerz);
        if (alt.monat && neu.monat) {
          const diff = monatsAbstand(neu.monat, alt.monat);
          if (diff > 0) wirkung = `erreichst du „${esc(ziel.name)}“ <b>${diff} Monat${diff > 1 ? 'e' : ''} früher</b> (${monatKurz(neu.monat)} statt ${monatKurz(alt.monat)})`;
        } else if (neu.monat) wirkung = `erreichst du „${esc(ziel.name)}“ im <b>${monatName(neu.monat)}</b>`;
      }
      wirkung ??= `hast du <b>${euroRund(kuerz * 12)}</b> im Jahr mehr`;
      const budget = aufrunden(k.schnitt - kuerz, 500);
      return `<div class="katzeile">
        <div class="klein">Wenn du <b>${esc(k.kat.name)}</b> um <b>${euro(kuerz)}</b> im Monat senkst (bisher Ø ${euro(Math.round(k.schnitt))}), ${wirkung}.</div>
        ${k.kat.budget === budget ? '<div class="klein gruen" style="margin-top:6px">✓ Als Budget übernommen</div>'
          : `<button class="knopf klein" style="margin-top:8px" data-action="budget-uebernehmen" data-id="${k.id}" data-betrag="${budget}">Als Budget übernehmen (${euro(budget)}/Monat)</button>`}
      </div>`;
    }).join('') + (ziel ? '<div class="klein grau">Gilt, wenn du das Ersparte auch wirklich zurücklegst.</div>' : '') + '</section>';
  }

  // Was wäre, wenn …
  const varKats = a.kats.filter((k) => !k.kat.fix && k.schnitt > 0);
  if (ziel && varKats.length) {
    const wk = varKats.find((k) => k.id === wasWaereKat) || varKats[0];
    wasWaereKat = wk.id;
    const max = aufrunden(wk.schnitt, 500);
    wasWaereBetrag = Math.min(wasWaereBetrag, max);
    h += `<section class="karte"><h2>${icon('ziel')} Was wäre, wenn …</h2>
      <label class="feld"><span>… ich bei dieser Kategorie weniger ausgebe</span>
        <select id="ww-kat">${varKats.map((k) => `<option value="${k.id}" ${k.id === wk.id ? 'selected' : ''}>${esc(k.kat.name)} (Ø ${euro(Math.round(k.schnitt))})</option>`).join('')}</select></label>
      <div class="zeile"><span>Weniger pro Monat</span><b id="ww-betrag">${euro(wasWaereBetrag)}</b></div>
      <input type="range" id="ww-regler" min="0" max="${max}" step="500" value="${wasWaereBetrag}">
      <div id="ww-ergebnis" class="klein" style="margin-top:8px">${wasWaereText(ziel, wasWaereBetrag)}</div>
    </section>`;
  }

  // Sparquote im Verlauf (älteste links)
  const verlauf = a.monate.map((m, i) => ({ m, sq: a.zahlen[i].sparquote })).reverse();
  if (verlauf.length >= 2) {
    const skala = Math.max(0.3, ...verlauf.map((x) => Math.abs(x.sq || 0)));
    h += `<section class="karte"><h2>${icon('auswertung')} Sparquote im Verlauf</h2>
      <div class="balken-reihe">
        <div class="richtwert" style="bottom:${(0.1 / skala) * 100}%;height:${(0.1 / skala) * 100}%"></div>
        ${verlauf.map((x) => {
          const q = x.sq || 0;
          return `<div class="b"><span style="height:${(Math.abs(q) / skala) * 100}%;background:var(--${q >= 0.1 ? 'gruen' : q >= 0 ? 'gelb' : 'rot'})" title="${prozent(q)}"></span></div>`;
        }).join('')}
      </div>
      <div class="balken-unter">${verlauf.map((x) => `<span>${MONATE[Number(x.m.slice(5)) - 1].slice(0, 3)}<br>${x.sq === null ? '–' : prozent(x.sq)}</span>`).join('')}</div>
      <div class="klein grau" style="margin-top:8px">Grün hinterlegt: Richtwert 10–20 %. Kein Muss – nur zur Orientierung.</div>
    </section>`;
  }
  return h;
}

function wasWaereText(ziel, betrag) {
  const alt = zielPrognose(ziel), neu = zielPrognose(ziel, betrag);
  const name = `„${esc(ziel.name)}“`;
  if (alt.erreicht) return `${name} ist schon erreicht 🎉`;
  if (!neu.monat) return `Bei ${name} ist so noch kein Datum absehbar (über 10 Jahre). Schieb den Regler weiter nach rechts.`;
  const jahr = betrag ? ` · ${euroRund(betrag * 12)} mehr im Jahr` : '';
  if (!alt.monat) return `${name} wäre im <b>${monatName(neu.monat)}</b> erreicht${jahr}.`;
  const diff = monatsAbstand(neu.monat, alt.monat);
  return `${name} erreicht im <b>${monatName(neu.monat)}</b>${diff > 0 ? ` statt ${monatName(alt.monat)} – <b class="gruen">${diff} Monat${diff > 1 ? 'e' : ''} früher</b>` : ''}${jahr}.`;
}

function htmlAbos() {
  const liste = abos();
  if (!liste.length) {
    return `<div class="leer">Noch keine regelmäßigen Ausgaben.<br>Leg sie unter Einstellungen → Regelmäßige Buchungen an.</div>`;
  }
  const monat = liste.reduce((s, x) => s + x.monat, 0);
  const jahr = liste.reduce((s, x) => s + x.jahr, 0);
  const ein = analyse(3).schnittEin;
  let h = `<section class="karte hero">
    <div class="label">Regelmäßige Kosten pro Monat</div>
    <div class="zahl">${euroHtml(Math.round(monat))}</div>
    <div class="klein">= <b>${euroRund(jahr)}</b> im Jahr${ein > 0 ? ` · ${prozent(monat / ein)} deines Einkommens` : ''}</div>
  </section><section class="karte"><h2>${icon('wiederholen')} Alle Abos & Verträge</h2>`;
  h += liste.map(({ v, monat: m, jahr: j }) => `<div class="katedit" style="margin-bottom:12px">
      <span class="punkt" style="background:${esc(kat(v.kategorieId)?.farbe || '#666')}"></span>
      <span style="flex:1;min-width:0">${esc(v.name)}${v.kreditId ? ' <span class="badge">Kredit</span>' : ''}<br>
        <span class="klein grau">${euro(v.betrag)} ${intervallName(v.intervall || 1).toLowerCase()}${(v.intervall || 1) > 1 ? ` · ${euro(Math.round(m))}/Monat` : ''}</span>
        ${aboAlt(v) && !v.kreditId ? '<br><span class="klein gelb">Seit über einem Jahr nicht geprüft – noch nötig? Günstiger zu haben?</span>' : ''}</span>
      <span style="text-align:right"><b>${euroRund(j)}</b><br><span class="klein grau">pro Jahr</span></span>
      ${aboAlt(v) && !v.kreditId ? `<button class="x" data-action="abo-geprueft" data-id="${v.id}" aria-label="Geprüft">${icon('haken')}</button>` : ''}
    </div>`).join('');
  return h + `<div class="klein grau">Ändern oder löschen: Einstellungen → Regelmäßige Buchungen.</div></section>`;
}

/* ---------------------------------------------------------------------
   5c. Wünsche & Träume
   --------------------------------------------------------------------- */

function htmlWuensche() {
  const offen = offeneWuensche();
  const plan = wunschPlan();
  const erfuellt = daten.wuensche.filter((w) => w.status === 'erfuellt').sort((a, b) => (b.erfuelltAm || '').localeCompare(a.erfuelltAm || ''));
  let h = `<div class="knopfreihe" style="margin:0">
    <button class="knopf haupt" data-action="wunsch-neu" data-typ="wunsch">${icon('plus')} Wunsch</button>
    <button class="knopf" data-action="wunsch-neu" data-typ="projekt">${icon('plus')} Traum-Projekt</button></div>`;
  if (!offen.length) {
    h += `<div class="leer">Noch keine Wünsche.<br><br><b>Wunsch</b> = eine Sache mit Preis (z. B. Winterreifen).<br>
      <b>Traum-Projekt</b> = etwas Großes aus mehreren Teilen (z. B. Japan-Tour: Rad, Flug, Ausrüstung, Reisekasse).<br><br>
      Die App sagt dir, ob und ab wann der Kauf drin ist.</div>`;
  } else {
    const restSumme = offen.reduce((s, w) => s + wunschRest(w), 0);
    const std = arbeitsstunden(restSumme);
    h += `<section class="karte">
      <div class="zeile"><span class="label">${offen.length} offen · es fehlen noch</span><b>${euroRund(restSumme)}</b></div>
      ${std ? `<div class="klein grau">${icon('uhr')} entspricht ${std}</div>` : ''}
      <div class="klein" style="margin-top:8px">${icon('kalender')} <b>Plan:</b> ${offen.map((w) => {
        const r = plan[w.id];
        return `${esc(wunschEmoji(w))} ${esc(w.name)} <span class="${r.ampel}">${r.monat === 0 && !r.pause ? 'jetzt' : r.ab ? monatKurz(r.ab) : 'offen'}</span>`;
      }).join(' → ')}</div>
      <div class="klein grau" style="margin-top:4px">Reihenfolge mit ↑↓ ändern. Was weiter oben steht, kommt zuerst dran.</div>
    </section>`;
    offen.forEach((w, i) => { h += htmlWunschKarte(w, plan[w.id], i, offen.length); });
  }
  if (erfuellt.length) {
    h += `<details class="karte"><summary class="label tippbar">${icon('haken')} Erfüllt (${erfuellt.length})</summary>
      ${erfuellt.map((w) => `<div class="katedit" style="margin-top:10px">
        <span style="font-size:1.3rem">${esc(wunschEmoji(w))}</span>
        <span style="flex:1">${esc(w.name)}<br><span class="klein grau">${euro(wunschGesamt(w))}${w.erfuelltAm ? ` · ${new Date(w.erfuelltAm).toLocaleDateString('de-DE')}` : ''}</span></span>
        <button class="x" data-action="wunsch-loeschen" data-id="${w.id}" aria-label="Löschen">${icon('kreuz')}</button></div>`).join('')}
    </details>`;
  }
  return h;
}

function htmlWunschKarte(w, r, i, anzahl) {
  const gesamt = wunschGesamt(w);
  const anteil = wunschAnteil(w);
  const std = arbeitsstunden(r.rest);
  return `<section class="karte wunsch" data-action="wunsch-details" data-id="${w.id}">
    <div class="wunsch-kopf">
      <div class="wunsch-emoji">${esc(wunschEmoji(w))}</div>
      <div style="flex:1;min-width:0">
        <div class="zeile"><b>${esc(w.name)}</b><b style="font-variant-numeric:tabular-nums">${euroRund(gesamt)}</b></div>
        <div class="klein grau">${w.typ === 'projekt' ? `Traum-Projekt · ${(w.teile || []).length} Teile · ` : ''}${prioName(w.prio)}${w.termin ? ` · bis ${monatKurz(w.termin)}` : ''}</div>
      </div>
    </div>
    ${anteil > 0 ? `<div class="leiste" style="height:7px;margin-top:10px"><span style="width:${anteil * 100}%;background:var(--akzent)"></span></div>
      <div class="klein grau">${prozent(anteil)} · noch ${euro(r.rest)}</div>` : ''}
    <div class="ampel-box ${r.ampel}"><div class="klein"><span class="ampel ${r.ampel}"></span><b>${r.titel}</b></div>
      <div class="klein" style="margin-top:2px">${r.text}</div></div>
    ${std ? `<div class="klein grau">${icon('uhr')} entspricht ${std}</div>` : ''}
    <div class="knopfreihe" style="margin-top:10px;align-items:center">
      <button class="x ${w.istZiel ? 'an' : ''}" data-action="wunsch-ziel" data-id="${w.id}" aria-label="Als Ziel oben zeigen">${icon('wunsch')}</button>
      <button class="x" data-action="wunsch-hoch" data-id="${w.id}" aria-label="Nach oben" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>${icon('pfeilhoch')}</button>
      <button class="x" data-action="wunsch-runter" data-id="${w.id}" aria-label="Nach unten" ${i === anzahl - 1 ? 'disabled style="opacity:.3"' : ''}>${icon('pfeilrunter')}</button>
      <span style="flex:1"></span>
      ${w.typ === 'projekt' ? '<span class="klein akzent">Details ›</span>'
        : `<button class="knopf klein haupt" data-action="wunsch-gekauft" data-id="${w.id}">${icon('haken')} Gekauft</button>`}
    </div>
  </section>`;
}

const katOptionenFuer = (art, gewaehlt) => kategorienVon(art)
  .map((k) => `<option value="${k.id}" ${k.id === gewaehlt ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
let vorlageInBearbeitung = null; // id der monatlichen Buchung, die gerade bearbeitet wird

// Einmalige Beträge ab dem aktuellen Monat, sortiert: [["2026-12", 150000], …]
const kommendeAusnahmen = (v) => Object.entries(v.ausnahmen || {})
  .filter(([m]) => m >= heute().slice(0, 7)).sort((a, b) => a[0].localeCompare(b[0]));

// Kasten im ✎-Formular: Betrag nur für einen Monat ändern (Prämie, Sondertilgung …)
function htmlEinmalig(v) {
  const kredit = v.kreditId ? daten.kredite.find((k) => k.id === v.kreditId) : null;
  const beispiel = kredit ? 'Rate + Sondertilgung' : v.art === 'einnahme' ? 'Gehalt + Prämie' : 'Nachzahlung';
  return `<div class="einmalig-box">
    <div class="label" style="margin-bottom:6px">Nur einmalig anderer Betrag</div>
    <div class="klein grau" style="margin-bottom:8px">Z. B. ${beispiel}. Gilt nur für den gewählten Monat, danach wieder ${euro(v.betrag)}.
      ${kredit && kredit.typ === 'kredit' ? 'Eine Sondertilgung senkt auch die Restschuld.' : ''}</div>
    ${htmlMonatWahl('v-ein-monat', naechsteFaelligkeit(v) || heute().slice(0, 7))}
    <input type="text" inputmode="decimal" id="v-ein-betrag" style="margin:8px 0" placeholder="Betrag nur in diesem Monat">
    <button class="knopf" data-action="einmalig-speichern">Einmalig übernehmen</button>
    ${kommendeAusnahmen(v).map(([m, b]) => `<div class="zeile klein" style="margin-top:8px">
      <span>✱ ${monatName(m)}: <b>${euro(b)}</b></span>
      <button class="x" data-action="einmalig-loeschen" data-monat="${m}" aria-label="Einmaligen Betrag entfernen">${icon('kreuz')}</button></div>`).join('')}
  </div>`;
}

function htmlEinstellungen() {
  const e = daten.einst;
  const euroFeld = (feld, wert) =>
    `<input type="text" inputmode="decimal" data-einst="${feld}" data-typ="euro" value="${centZuText(wert)}">`;

  const katGruppe = (art, titel) => `<div class="unter">${titel}</div>` + kategorienVon(art).map((k) => `
    <div class="katedit">
      <input type="color" value="${esc(k.farbe)}" data-kat-feld="farbe" data-id="${k.id}">
      <input type="text" value="${esc(k.name)}" data-kat-feld="name" data-id="${k.id}">
      ${art === 'ausgabe' ? `<label><input type="checkbox" data-kat-feld="fix" data-id="${k.id}" ${k.fix ? 'checked' : ''}>fix</label>` : ''}
      <button class="x" data-action="kat-loeschen" data-id="${k.id}" aria-label="Kategorie löschen">${icon('kreuz')}</button>
    </div>`).join('');

  // Formular für monatliche Buchungen: leer (neu) oder mit Werten (bearbeiten)
  const ve = daten.vorlagen.find((v) => v.id === vorlageInBearbeitung) || null;
  const veArt = ve?.art || 'ausgabe';
  const katOptionen = katOptionenFuer(veArt, ve?.kategorieId);
  const artOption = (wert, text) => `<option value="${wert}" ${wert === veArt ? 'selected' : ''}>${text}</option>`;
  const vorzeichen = { ausgabe: '−', einnahme: '+', sparen: '→ ' };
  const vorlagenSortiert = [...daten.vorlagen].sort((a, b) => a.tag - b.tag);

  return `
  <section class="karte"><h2>${icon('schwein')} Puffer & Sparziel</h2>
    <label class="feld"><span>Aktueller Stand Notgroschen-Konto (€)</span>${euroFeld('puffer', e.puffer)}</label>
    <label class="feld"><span>Name des Sparziels</span><input type="text" data-einst="zielName" value="${esc(e.zielName)}"></label>
    <label class="feld"><span>Zielbetrag (€)</span>${euroFeld('zielBetrag', e.zielBetrag)}</label>
    <label class="check"><input type="checkbox" data-einst="zielGleichPuffer" ${e.zielGleichPuffer ? 'checked' : ''}>Fortschritt = Puffer-Stand</label>
    ${e.zielGleichPuffer ? '' : `<label class="feld"><span>Bisher gespart für dieses Ziel (€)</span>${euroFeld('zielStand', e.zielStand)}</label>`}
    <label class="check"><input type="checkbox" id="ziel-mit-termin" ${e.zielTermin ? 'checked' : ''}>Wunschtermin festlegen (für die Ampel „im Plan“)</label>
    ${e.zielTermin ? `<div class="feld" data-ziel-termin>${htmlMonatWahl('ziel-termin', e.zielTermin)}</div>` : ''}
    <label class="check"><input type="checkbox" data-einst="zielAnzeigen" ${e.zielAnzeigen !== false ? 'checked' : ''}>Als Karte ganz oben in der Übersicht zeigen</label>
    <div class="klein grau">Tipp: Ein Notgroschen von 3–6 Monatsausgaben gilt als solide.</div>
  </section>

  <section class="karte"><h2>${icon('farbe')} Darstellung</h2>
    <div class="label">Akzentfarbe</div>
    <div class="farbwahl">${Object.entries(AKZENTE).map(([k, f]) =>
      `<button data-action="akzent-wahl" data-akzent="${k}" class="${k === e.akzent ? 'an' : ''}" style="background:${f}" aria-label="${k}"></button>`).join('')}</div>
    <label class="check"><input type="checkbox" data-einst="amoled" ${e.amoled ? 'checked' : ''}>AMOLED-Schwarz (echtes Schwarz, spart Akku)</label>
    <label class="feld"><span>Start-Bildschirm mit deinem Ziel beim Öffnen</span><select data-einst="startScreen">
      ${[['taeglich', 'Einmal am Tag'], ['immer', 'Bei jedem Öffnen'], ['aus', 'Aus']].map(([k, t]) =>
        `<option value="${k}" ${k === e.startScreen ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
  </section>

  <section class="karte"><h2>${icon('wunsch')} Wünsche</h2>
    <label class="feld"><span>Girokonto soll am Monatsende nicht unter … fallen (€)</span>${euroFeld('kontoUntergrenze', e.kontoUntergrenze)}</label>
    <label class="feld"><span>Dein Netto-Stundenlohn (€) – für „entspricht X Arbeitsstunden“</span>${euroFeld('stundenlohn', e.stundenlohn)}</label>
    <label class="feld"><span>Gedanken-Pause für Spaß-Käufe ab (€) – 7 Tage, ab dem 5-Fachen 30 Tage</span>${euroFeld('pauseGrenze', e.pauseGrenze)}</label>
    <div class="klein grau">Netto-Stundenlohn ≈ Netto im Monat ÷ Arbeitsstunden im Monat (z. B. 2.100 € ÷ 165 h ≈ 12,70 €).</div>
  </section>

  <section class="karte"><h2>${icon('wiederholen')} Regelmäßige Buchungen</h2>
    <div class="klein grau" style="margin-bottom:10px">Für alles, was regelmäßig kommt: Fixkosten, Gehalt, Sparrate –
      auch vierteljährlich oder jährlich (z. B. Versicherungen). In der Übersicht trägst du sie mit einem Tipp ein, sobald sie fällig sind.</div>
    ${vorlagenSortiert.length ? vorlagenSortiert.map((v) => `
      <div class="katedit">
        <span class="punkt" style="background:${esc(kat(v.kategorieId)?.farbe || '#666')}"></span>
        <span style="flex:1">${esc(v.name)}<br><span class="klein grau">${vorzeichen[v.art || 'ausgabe']}${euro(v.betrag)} · ${(v.intervall || 1) > 1 ? `${intervallName(v.intervall).toLowerCase()}, nächste ${monatKurz(naechsteFaelligkeit(v) || heute().slice(0, 7))} · ` : ''}${tagText(v.tag)} · ${esc(kat(v.kategorieId)?.name || '?')}${kommendeAusnahmen(v).map(([m, b]) =>
          `<br><span class="gelb">✱ ${monatKurz(m)} einmalig ${vorzeichen[v.art || 'ausgabe']}${euro(b)}</span>`).join('')}</span></span>
        <button class="x" data-action="vorlage-bearbeiten" data-id="${v.id}" aria-label="Bearbeiten">${icon('stift')}</button>
        <button class="x" data-action="vorlage-loeschen" data-id="${v.id}" aria-label="Vorlage löschen">${icon('kreuz')}</button>
      </div>`).join('') : '<div class="klein grau">Noch keine Vorlagen.</div>'}
    <div id="v-formular" ${ve ? 'class="bearbeiten-box"' : ''}>
    <div class="unter">${ve ? `✎ Bearbeiten: ${esc(ve.name)}` : 'Neu'}</div>
    ${ve ? htmlEinmalig(ve) : ''}
    <label class="feld"><span>Art</span><select id="v-art">
      ${artOption('ausgabe', 'Ausgabe (z. B. Miete, Handy, Spotify)')}
      ${artOption('einnahme', 'Einnahme (z. B. Gehalt)')}
      ${artOption('sparen', 'Sparen (z. B. Sparrate aufs Zweitkonto)')}</select></label>
    <div class="zwei">
      <label class="feld"><span>Name</span><input type="text" id="v-name" value="${esc(ve?.name || '')}"></label>
      <label class="feld"><span>Betrag (€)</span><input type="text" inputmode="decimal" id="v-betrag" value="${ve ? centZuText(ve.betrag) : ''}"></label>
    </div>
    <div class="label">Wie oft?</div>
    ${htmlIntervallWahl('v-iv', ve?.intervall || 1, ve?.startMonat)}
    <div class="label">An welchem Tag?</div>
    ${htmlTagWahl('v-tag', ve?.tag || 1)}
    <label class="feld"><span>Kategorie</span><select id="v-kat">${katOptionen}</select></label>
    ${ve ? `<div class="knopfreihe">
        <button class="knopf haupt" data-action="vorlage-neu">Speichern</button>
        <button class="knopf" data-action="vorlage-abbrechen">Abbrechen</button></div>`
      : '<button class="knopf" data-action="vorlage-neu">Vorlage hinzufügen</button>'}
    </div>
  </section>

  <section class="karte"><h2>${icon('karte')} Kredite & Verträge</h2>
    ${daten.kredite.length ? daten.kredite.map((k) => {
      const i = kreditInfo(k);
      return `<div style="margin-bottom:14px" id="kredit-${k.id}">
        <div class="katedit">
          <span style="flex:1"><b>${esc(k.name)}</b><br><span class="klein grau">${euro(k.rate)} ${tagText(k.tag)} · ${laufzeitText(i)}</span></span>
          <button class="x" data-action="kredit-bearbeiten" data-id="${k.id}" aria-label="Bearbeiten">${icon('stift')}</button>
          <button class="x" data-action="kredit-loeschen" data-id="${k.id}" aria-label="Löschen">${icon('kreuz')}</button>
        </div>
        ${k.typ === 'kredit' ? `<label class="feld"><span>Restschuld heute (zum Korrigieren, z. B. laut Kontoauszug)</span>
          <input type="text" inputmode="decimal" data-kredit-feld="restschuld" data-id="${k.id}" value="${centZuText(i.restschuld)}"></label>`
        : `<div class="feld"><span>Monat der letzten Rate (zum Korrigieren)</span>
          <div data-kredit-ende="${k.id}">${htmlMonatWahl(`kr-ende-${k.id}`, k.ende)}</div></div>`}
        ${!i.endlos && !i.raten ? `<div class="knopfreihe">
          <button class="knopf haupt" data-action="kredit-fertig-ja" data-id="${k.id}">Ja, alles bezahlt</button></div>` : ''}
      </div>`;
    }).join('') : '<div class="klein grau" style="margin-bottom:10px">Noch keine Kredite oder Verträge.</div>'}
    <div class="unter">Neu hinzufügen</div>
    <label class="feld"><span>Art</span><select id="kr-typ">
      <option value="kredit">Kredit / Ratenkauf</option>
      <option value="vertrag">Leasing / Vertrag (ohne Restschuld)</option></select></label>
    <label class="feld"><span>Name (z. B. Autokredit, Handy-Ratenkauf, Leasing)</span><input type="text" id="kr-name"></label>
    <label class="feld"><span>Monatliche Rate (€)</span><input type="text" inputmode="decimal" id="kr-rate"></label>
    <div class="label">Abbuchung am</div>
    ${htmlTagWahl('kr-tag', 1)}
    <div class="nur-kredit">
      <label class="feld"><span>Was weißt du?</span><select id="kr-bekannt">
        <option value="rest">Ich kenne die Restschuld</option>
        <option value="laufzeit">Ich kenne die Restlaufzeit (letzte Rate)</option></select></label>
      <label class="feld nur-rest"><span>Restschuld heute (€)</span><input type="text" inputmode="decimal" id="kr-rest"></label>
    </div>
    <div class="feld zeige-ende" hidden><span>Monat der letzten Rate</span>${htmlMonatWahl('kr-ende', monatVerschieben(heute().slice(0, 7), 12))}</div>
    <details class="erweitert nur-kredit">
      <summary>Erweiterte Angaben (optional)</summary>
      <div class="klein grau" style="margin:8px 0 12px">Brauchst du normalerweise nicht – deine Rate enthält die Zinsen schon.
        Mit dem Zinssatz kann die App zusätzlich ausrechnen, wie viel davon Zinsen sind und wie hoch die echte Restschuld ist (z. B. für eine Sondertilgung).</div>
      <label class="feld"><span>Zinssatz % (im Vertrag „Sollzins“)</span><input type="text" inputmode="decimal" id="kr-zins" placeholder="z. B. 5,9"></label>
      <label class="feld"><span>Ursprünglicher Kreditbetrag (€) – für einen Fortschrittsbalken</span><input type="text" inputmode="decimal" id="kr-ursprung"></label>
    </details>
    <label class="check"><input type="checkbox" id="kr-vorlage" checked>Rate als monatliche Buchung anlegen (Häkchen weg, wenn du sie schon als Vorlage hast)</label>
    <button class="knopf" data-action="kredit-neu">Hinzufügen</button>
  </section>

  <section class="karte"><h2>${icon('ziel')} Budgets pro Monat</h2>
    <div class="klein grau" style="margin-bottom:10px">Leer lassen = kein Budget. Ab 80 % gibt es in der Übersicht eine Warnung.</div>
    ${kategorienVon('ausgabe').map((k) => `<div class="katedit">
      <span class="punkt" style="background:${esc(k.farbe)}"></span><span style="flex:1">${esc(k.name)}</span>
      <input type="text" inputmode="decimal" data-kat-feld="budget" data-id="${k.id}" style="width:110px;flex:none" placeholder="kein"
        value="${k.budget ? centZuText(k.budget) : ''}"></div>`).join('')}
  </section>

  <section class="karte"><h2>${icon('kategorie')} Kategorien</h2>
    ${katGruppe('ausgabe', 'Ausgaben (Häkchen = Fixkosten)')}
    ${katGruppe('einnahme', 'Einnahmen')}
    ${katGruppe('sparen', 'Sparen (Geld aufs Sparkonto)')}
    <div class="unter">Neue Kategorie</div>
    <div class="zwei">
      <input type="text" id="k-name" placeholder="Name">
      <select id="k-art"><option value="ausgabe">Ausgabe</option><option value="einnahme">Einnahme</option><option value="sparen">Sparen</option></select>
    </div>
    <button class="knopf" data-action="kat-neu" style="margin-top:8px">Kategorie hinzufügen</button>
  </section>

  <section class="karte"><h2>${icon('suche')} Kleine Ausgaben</h2>
    <label class="feld"><span>Als „klein“ zählt alles bis (€)</span>${euroFeld('kleinGrenze', e.kleinGrenze)}</label>
  </section>

  ${htmlSync()}

  ${htmlSperreEinst()}

  <section class="karte"><h2>${icon('backup')} Backup</h2>
    <div class="klein grau" style="margin-bottom:10px">Deine Daten liegen nur auf diesem Handy. Mach regelmäßig ein Backup und speichere die Datei z. B. in Google Drive.<br>
    Letztes Backup: <b>${e.letztesBackup ? new Date(e.letztesBackup).toLocaleDateString('de-DE') : 'noch nie'}</b> · ${daten.buchungen.length} Buchungen</div>
    <button class="knopf haupt" data-action="export">Backup herunterladen</button>
    <div class="knopfreihe">
      <button class="knopf" data-action="teilen">Backup teilen …</button>
      <button class="knopf" data-action="import">Wiederherstellen</button>
    </div>
    <div class="knopfreihe"><button class="knopf" data-action="csv">Als CSV exportieren (für Excel)</button></div>
  </section>

  <div class="klein grau" style="text-align:center">Meine Finanzen · Version ${APP_VERSION}</div>`;
}

/* ---------------------------------------------------------------------
   6. Eingabe-Formulare – alle als "Bottom Sheet" (schiebt sich von unten hoch)
   --------------------------------------------------------------------- */

let form = null;        // die Buchung, die gerade bearbeitet wird
let sheetOffen = false;
const sheet = () => document.getElementById('formular');

function sheetOeffnen(html) {
  const s = sheet(), hg = document.getElementById('sheet-hg');
  s.innerHTML = `<div class="griff"></div><div class="sheet-inhalt">${html}</div>`;
  s.scrollTop = 0;
  if (!sheetOffen) {
    sheetOffen = true;
    s.hidden = false; hg.hidden = false;
    void s.offsetWidth; // damit die Animation startet
    s.classList.add('offen'); hg.classList.add('offen');
    history.pushState({ formular: true }, ''); // damit die Zurück-Taste das Sheet schließt
  }
}
const sheetKopf = (titel) => `<div class="sheet-kopf"><h1>${titel}</h1>
  <button class="x" data-action="form-schliessen" aria-label="Schließen">${icon('kreuz')}</button></div>`;

function formSchliessen(durchZurueckTaste) {
  if (!sheetOffen) return;
  sheetOffen = false;
  const s = sheet(), hg = document.getElementById('sheet-hg');
  s.classList.remove('offen'); hg.classList.remove('offen');
  setTimeout(() => { if (!sheetOffen) { s.hidden = true; hg.hidden = true; s.innerHTML = ''; } }, 330);
  form = null; wf = null; wunschOffen = null;
  if (!durchZurueckTaste && history.state?.formular) history.back();
}

function formOeffnen(buchung) {
  const standardDatum = aktMonat === heute().slice(0, 7) ? heute() : `${aktMonat}-01`;
  form = buchung ? { ...buchung }
    : { art: 'ausgabe', betrag: null, kategorieId: null, datum: standardDatum, notiz: '' };
  const fav = form.id ? [] : favoriten();
  sheetOeffnen(`${sheetKopf(form.id ? 'Buchung bearbeiten' : 'Neue Buchung')}
    <div class="segment">
      <button data-action="f-art" data-art="ausgabe">Ausgabe</button>
      <button data-action="f-art" data-art="einnahme">Einnahme</button>
      <button data-action="f-art" data-art="sparen">Sparen</button>
    </div>
    <input id="f-betrag" class="betrag-eingabe" type="text" inputmode="decimal" placeholder="0,00 €"
      value="${form.betrag != null ? centZuText(form.betrag) : ''}" autocomplete="off">
    ${fav.length ? `<div class="chips" style="margin-top:-6px">${fav.map((f) => `<button type="button" class="chip schnell" data-action="f-favorit"
      data-name="${esc(f.name)}" data-kat="${f.kategorieId}" data-betrag="${f.betrag}">${icon('blitz')} ${esc(f.name)} ${euro(f.betrag)}</button>`).join('')}</div>` : ''}
    <div class="label">Kategorie</div>
    <div class="chips" id="f-kats"></div>
    <div class="label">Datum</div>
    <input type="hidden" id="f-datum" value="${form.datum}">
    <div class="chips" id="f-datum-wahl" style="margin-bottom:8px"></div>
    <div id="f-kalender" hidden></div>
    <label class="feld"><span>Notiz (optional)</span><input type="text" id="f-notiz" value="${esc(form.notiz)}" placeholder="z. B. Bäcker, Kino …"></label>
    ${form.id ? '' : `<label class="check"><input type="checkbox" id="f-wiederkehrend">Regelmäßig wiederholen (als Vorlage merken)</label>
      <div id="f-tag-box" hidden style="margin:-6px 0 14px"></div>`}
    <button class="knopf haupt" data-action="form-speichern">Speichern</button>
    ${form.id ? '<div class="knopfreihe"><button class="knopf gefahr" data-action="form-loeschen">Löschen</button></div>' : ''}`);
  formArtSetzen(form.art);
  datumWahlZeigen();
  if (!form.id) setTimeout(() => document.getElementById('f-betrag')?.focus(), 350);
}

// --- Datumsauswahl im Formular: Heute · Gestern · Kalender ---
function datumWahlZeigen() {
  const h = heute(), g = tagVerschieben(h, -1), d = form.datum;
  const anderes = d !== h && d !== g;
  document.getElementById('f-datum-wahl').innerHTML = `
    <button type="button" class="chip ${d === h ? 'an' : ''}" data-action="datum-setzen" data-datum="${h}">Heute</button>
    <button type="button" class="chip ${d === g ? 'an' : ''}" data-action="datum-setzen" data-datum="${g}">Gestern</button>
    <button type="button" class="chip ${anderes ? 'an' : ''}" data-action="kal-auf">📅 ${anderes ? datumLang(d) : 'Anderes Datum'}</button>
    ${d > h ? '<div class="klein blau" style="width:100%">⏳ Datum in der Zukunft – zählt als geplante Zahlung</div>' : ''}`;
}
function datumSetzen(d) {
  form.datum = d;
  document.getElementById('f-datum').value = d;
  document.getElementById('f-kalender').hidden = true;
  datumWahlZeigen();
}
function kalenderZeigen() {
  const [j, m] = form.kalMonat.split('-').map(Number);
  const versatz = (new Date(j, m - 1, 1).getDay() + 6) % 7; // Woche beginnt Montag
  const tage = new Date(j, m, 0).getDate();
  const h = heute();
  let zellen = '<span></span>'.repeat(versatz);
  for (let t = 1; t <= tage; t++) {
    const d = `${form.kalMonat}-${String(t).padStart(2, '0')}`;
    zellen += `<button type="button" class="kal-tag ${d === form.datum ? 'an' : ''} ${d === h ? 'heute' : ''}" data-action="datum-setzen" data-datum="${d}">${t}</button>`;
  }
  const box = document.getElementById('f-kalender');
  box.innerHTML = `<div class="kalender">
    <div class="zeile" style="margin-bottom:8px">
      <button type="button" class="kal-pfeil" data-action="kal-monat" data-n="-1" aria-label="Vorheriger Monat">‹</button>
      <b>${monatName(form.kalMonat)}</b>
      <button type="button" class="kal-pfeil" data-action="kal-monat" data-n="1" aria-label="Nächster Monat">›</button>
    </div>
    <div class="kal-raster">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span class="kal-kopf">${w}</span>`).join('')}${zellen}</div>
  </div>`;
  box.hidden = false;
}

// Ausgabe / Einnahme / Sparen umschalten → passende Kategorien anzeigen
function formArtSetzen(art) {
  if (form.art !== art) form.kategorieId = null;
  form.art = art;
  sheet().querySelectorAll('[data-art]').forEach((b) => b.classList.toggle('an', b.dataset.art === art));
  const kats = kategorienVon(art);
  if (kats.length === 1) form.kategorieId = kats[0].id; // nur eine Kategorie → direkt auswählen
  document.getElementById('f-kats').innerHTML = kats.map((k) =>
    `<button class="chip ${k.id === form.kategorieId ? 'an' : ''}" data-action="f-kat" data-id="${k.id}">
      <span class="punkt" style="background:${esc(k.farbe)}"></span>${esc(k.name)}</button>`).join('');
}


async function formSpeichern() {
  const betrag = centAusText(document.getElementById('f-betrag').value);
  // Minus nur bei "Sparen" (= Geld aus dem Spartopf/Sparkonto zurückholen)
  if (betrag === null || betrag === 0 || (betrag < 0 && form.art !== 'sparen')) return toast('Bitte einen Betrag eingeben');
  if (!form.kategorieId) return toast('Bitte eine Kategorie wählen');
  const datum = document.getElementById('f-datum').value || heute();
  const notiz = document.getElementById('f-notiz').value.trim();

  const b = { id: form.id || neueId(), datum, betrag, art: form.art,
    kategorieId: form.kategorieId, notiz, vorlageId: form.vorlageId || null,
    erstellt: form.erstellt || Date.now(), ...(form.wunschId ? { wunschId: form.wunschId } : {}) };

  // Häkchen "Regelmäßig" → zusätzlich eine Vorlage anlegen
  const wiederkehrend = document.getElementById('f-wiederkehrend');
  if (!form.id && wiederkehrend?.checked) {
    const intervall = intervallLesen('f-iv').intervall;
    const v = { id: neueId(), name: notiz || kat(b.kategorieId).name, betrag, art: form.art,
      kategorieId: b.kategorieId, tag: tagLesen('f-tag'),
      intervall, startMonat: intervall > 1 ? datum.slice(0, 7) : null }; // Rhythmus startet im Monat dieser Buchung
    await speichern('vorlagen', v);
    b.vorlageId = v.id;
  }
  await speichern('buchungen', b);
  formSchliessen();
  aktMonat = datum.slice(0, 7);
  render();
  vibrieren();
  toast('Gespeichert ✓');
}

/* ---------------------------------------------------------------------
   6b. Wunsch / Traum-Projekt: Formular und Details
   --------------------------------------------------------------------- */

let wf = null;          // Zustand des Wunsch-Formulars
let wunschOffen = null; // id des Wunsches, dessen Details offen sind

function standardKaufKategorie() {
  const k = kategorienVon('ausgabe');
  return (k.find((x) => x.name === 'Freizeit') || k.find((x) => x.name === 'Sonstiges') || k[0])?.id;
}
// Kategorie "Spartöpfe" (Art Sparen) suchen oder anlegen
async function spartopfKategorie() {
  let k = daten.kategorien.find((x) => x.art === 'sparen' && x.name === 'Spartöpfe');
  if (!k) {
    k = { id: neueId(), name: 'Spartöpfe', art: 'sparen', fix: false, farbe: '#8f7cff',
      reihenfolge: Math.max(0, ...daten.kategorien.map((x) => x.reihenfolge ?? 0)) + 1 };
    await speichern('kategorien', k);
  }
  return k;
}

function wunschFormOeffnen(w, typ = 'wunsch') {
  wf = w ? { ...w, teile: (w.teile || []).map((t) => ({ ...t })) }
    : { typ, prio: 'schoen', teile: typ === 'projekt' ? [{ id: neueId(), name: '', preis: 0 }] : [], istZiel: typ === 'projekt' };
  sheetOeffnen(`${sheetKopf(wf.id ? 'Bearbeiten' : wf.typ === 'projekt' ? 'Neues Traum-Projekt' : 'Neuer Wunsch')}
    <div class="segment zwei-teile">${[['wunsch', 'Wunsch'], ['projekt', 'Traum-Projekt']].map(([k, t]) =>
      `<button data-action="wf-typ" data-typ="${k}" class="${k === wf.typ ? 'an' : ''}">${t}</button>`).join('')}</div>
    <div style="display:grid;grid-template-columns:72px 1fr;gap:8px;margin-top:14px">
      <label class="feld"><span>Symbol</span><input type="text" id="wf-emoji" value="${esc(wf.emoji || '')}"
        placeholder="${wf.typ === 'projekt' ? '✨' : '🎁'}" style="text-align:center;font-size:1.3rem;padding:8px"></label>
      <label class="feld"><span>Name</span><input type="text" id="wf-name" value="${esc(wf.name || '')}"
        placeholder="${wf.typ === 'projekt' ? 'z. B. Japan-Tour' : 'z. B. Winterreifen'}"></label>
    </div>
    <div id="wf-preis-box" ${wf.typ === 'projekt' ? 'hidden' : ''}>
      <label class="feld"><span>Preis (€)</span><input type="text" inputmode="decimal" id="wf-preis" value="${wf.preis ? centZuText(wf.preis) : ''}"></label></div>
    <div id="wf-teile-box" ${wf.typ === 'projekt' ? '' : 'hidden'}>
      <div class="label">Was brauchst du alles dafür? (z. B. Reiserad, Flug, Ausrüstung, Reisekasse)</div>
      <div id="wf-teile" style="margin-top:6px">${wfTeileHtml()}</div>
      <button class="knopf klein" data-action="wf-teil-neu" style="margin:2px 0 14px">${icon('plus')} Teil hinzufügen</button>
    </div>
    <div class="label">Wie wichtig?</div>
    <div class="chips" id="wf-prio">${PRIOS.map(([k, t]) =>
      `<button type="button" class="chip ${k === wf.prio ? 'an' : ''}" data-action="wf-prio" data-prio="${k}">${t}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="wf-mit-termin" ${wf.termin ? 'checked' : ''}>Wunschtermin (bis wann?)</label>
    <div id="wf-termin-box" ${wf.termin ? '' : 'hidden'} style="margin:-8px 0 12px">${htmlMonatWahl('wf-termin', wf.termin || monatVerschieben(heute().slice(0, 7), 6))}</div>
    <label class="feld"><span>Schon dafür zurückgelegt (€, optional)</span><input type="text" inputmode="decimal" id="wf-start" value="${wf.startGespart ? centZuText(wf.startGespart) : ''}"></label>
    <label class="feld"><span>Kategorie, wenn du es kaufst</span><select id="wf-kat">${katOptionenFuer('ausgabe', wf.kategorieId || standardKaufKategorie())}</select></label>
    <label class="feld"><span>Link (optional)</span><input type="text" inputmode="url" id="wf-link" value="${esc(wf.link || '')}" placeholder="https://…" autocapitalize="off"></label>
    <label class="feld"><span>Notiz (optional)</span><input type="text" id="wf-notiz" value="${esc(wf.notiz || '')}"></label>
    <label class="check"><input type="checkbox" id="wf-ziel" ${wf.istZiel ? 'checked' : ''}>Als Ziel ganz oben in der Übersicht zeigen ⭐</label>
    <button class="knopf haupt" data-action="wf-speichern">Speichern</button>`);
  if (!wf.id) setTimeout(() => document.getElementById('wf-name')?.focus(), 350);
}
function wfTeileHtml() {
  return wf.teile.map((t) => `<div class="katedit wf-teil" data-tid="${t.id}">
    <input type="text" class="wf-teil-name" value="${esc(t.name)}" placeholder="Teil">
    <input type="text" inputmode="decimal" class="wf-teil-preis" value="${t.preis ? centZuText(t.preis) : ''}" placeholder="€" style="width:100px;flex:none">
    ${t.gekauft ? `<span class="gruen" title="gekauft">${icon('haken')}</span>` : ''}
    <button class="x" data-action="wf-teil-weg" data-tid="${t.id}" aria-label="Teil entfernen">${icon('kreuz')}</button></div>`).join('');
}
function wfTeileLesen() {
  document.querySelectorAll('.wf-teil').forEach((row) => {
    const t = wf.teile.find((x) => x.id === row.dataset.tid);
    if (!t) return;
    t.name = row.querySelector('.wf-teil-name').value.trim();
    t.preis = Math.max(0, centAusText(row.querySelector('.wf-teil-preis').value) || 0);
  });
}
async function wunschFormSpeichern() {
  wfTeileLesen();
  const wert = (id) => document.getElementById(id).value.trim();
  const name = wert('wf-name');
  if (!name) return toast('Bitte einen Namen eingeben');
  const link = wert('wf-link');
  const w = {
    id: wf.id || neueId(), typ: wf.typ, name, emoji: wert('wf-emoji'), prio: wf.prio,
    termin: document.getElementById('wf-mit-termin').checked ? monatLesen('wf-termin') : null,
    startGespart: Math.max(0, centAusText(wert('wf-start')) || 0), kategorieId: wert('wf-kat'),
    link: link && !/^https?:\/\//i.test(link) ? `https://${link}` : link, notiz: wert('wf-notiz'),
    istZiel: document.getElementById('wf-ziel').checked,
    angelegt: wf.angelegt || Date.now(), status: wf.status || 'offen',
    reihenfolge: wf.reihenfolge ?? Math.max(0, ...daten.wuensche.map((x) => (x.reihenfolge ?? 0) + 1)),
    preis: null, teile: [],
  };
  if (w.typ === 'wunsch') {
    w.preis = centAusText(wert('wf-preis'));
    if (!w.preis || w.preis <= 0) return toast('Bitte einen Preis eingeben');
  } else {
    w.teile = wf.teile.filter((t) => t.name || t.preis).map((t) => ({ ...t, name: t.name || 'Teil' }));
    if (!w.teile.some((t) => t.preis > 0)) return toast('Bitte mindestens ein Teil mit Preis eintragen');
  }
  await speichern('wuensche', w);
  vibrieren();
  wunschDetailsOeffnen(w.id);
  render();
  toast('Gespeichert ✓');
}

// Verlauf der Einzahlungen + Vorschläge, die das Ziel schneller machen
function htmlZielExtras(z) {
  let h = '';
  const jetzt = heute().slice(0, 7);
  const monate = [5, 4, 3, 2, 1, 0].map((i) => monatVerschieben(jetzt, -i));
  const werte = monate.map((m) => sparSumme(m, z.id));
  if (werte.some((x) => x !== 0)) {
    const max = Math.max(1, ...werte.map(Math.abs));
    h += `<section class="karte" style="margin-top:12px"><h2>${icon('auswertung')} Einzahlungen</h2>
      <div class="balken-reihe" style="height:80px">${werte.map((x) => `<div class="b"><span style="height:${(Math.abs(x) / max) * 100}%;background:var(--${x < 0 ? 'rot' : 'akzent'})"></span></div>`).join('')}</div>
      <div class="balken-unter">${monate.map((m, i) => `<span>${MONATE[Number(m.slice(5)) - 1].slice(0, 3)}<br>${werte[i] ? euroRund(werte[i]) : '–'}</span>`).join('')}</div>
      ${z.tempo ? `<div class="klein grau" style="margin-top:8px">Dein Tempo: ca. ${euro(z.tempo)} pro Monat</div>` : ''}</section>`;
  }
  const pr = zielPrognose(z);
  if (!pr.erreicht && !pr.ohneBetrag) {
    const a = analyse(3);
    const vorschlaege = a.kats.filter((k) => !k.kat.fix && k.schnitt >= 3000).slice(0, 2).map((k) => {
      const kuerz = Math.max(500, Math.round((k.schnitt * 0.15) / 500) * 500);
      const neu = zielPrognose(z, kuerz);
      if (!neu.monat) return '';
      const diff = pr.monat ? monatsAbstand(neu.monat, pr.monat) : 0;
      return `<div class="klein" style="margin:8px 0">${icon('blitz')} ${euro(kuerz)}/Monat weniger für <b>${esc(k.kat.name)}</b> → erreicht im <b>${monatName(neu.monat)}</b>${diff > 0 ? ` <span class="gruen">(${diff} Monat${diff > 1 ? 'e' : ''} früher)</span>` : ''}</div>`;
    }).join('');
    if (vorschlaege) h += `<section class="karte" style="margin-top:12px"><h2>${icon('idee')} So geht's schneller</h2>${vorschlaege}</section>`;
  }
  return h;
}

function wunschDetailsOeffnen(id) {
  const w = daten.wuensche.find((x) => x.id === id);
  if (!w) return;
  wunschOffen = id;
  const offen = w.status !== 'erfuellt';
  const r = offen ? wunschPlan()[id] : null;
  const gesamt = wunschGesamt(w), gespart = wunschGespart(w), gekauft = wunschGekauft(w);
  const rate = wunschSparrate(w);
  const std = arbeitsstunden(gesamt);
  const z = { id, name: w.name, betrag: gesamt, stand: gekauft + Math.max(0, gespart), tempo: zielTempo(id), termin: w.termin };
  const jetzt = heute().slice(0, 7);
  let h = `${sheetKopf(`${esc(wunschEmoji(w))} ${esc(w.name)}`)}
    <div style="display:flex;gap:16px;align-items:center">
      ${ringSvg(wunschAnteil(w), 100)}
      <div style="min-width:0">
        <div class="zahl mittel" style="margin:0">${euroHtml(gesamt)}</div>
        <div class="klein grau">${w.typ === 'projekt' ? 'Traum-Projekt · ' : ''}${prioName(w.prio)}${w.termin ? ` · bis ${monatName(w.termin)}` : ''}</div>
        <div class="klein">Im Spartopf <b class="blau">${euro(gespart)}</b>${gekauft ? ` · bezahlt ${euro(gekauft)}` : ''}</div>
        ${std ? `<div class="klein grau">${icon('uhr')} ${std}</div>` : ''}
      </div>
    </div>`;
  if (r) {
    h += `<div class="ampel-box ${r.ampel}"><div><span class="ampel ${r.ampel}"></span><b>${r.titel}</b></div>
      <div class="klein" style="margin-top:2px">${r.text}</div>${r.terminHinweis ? `<div class="klein" style="margin-top:6px">${r.terminHinweis}</div>` : ''}</div>`;
    // Spartopf
    h += `<section class="karte"><h2>${icon('schwein')} Spartopf</h2>
      <input type="text" inputmode="decimal" id="wd-betrag" placeholder="Betrag (€)">
      <div class="knopfreihe"><button class="knopf haupt" data-action="spartopf-ein">Einzahlen</button>
        <button class="knopf" data-action="spartopf-aus">Entnehmen</button></div>
      <div class="klein grau" style="margin-top:8px">Wird als Spar-Buchung eingetragen – leg das Geld z. B. aufs Sparkonto.</div>`;
    if (r.rest > 0) {
      h += rate
        ? `<div class="trenner"></div><div class="zeile"><span>Monatliche Sparrate</span><b>${euro(rate)}</b></div>
          <div class="klein grau">→ voraussichtlich im ${monatName(monatVerschieben(jetzt, Math.ceil(r.rest / rate)))} voll</div>
          <button class="knopf klein gefahr" data-action="sparrate-weg" style="margin-top:8px">Sparrate beenden</button>`
        : `<div class="trenner"></div><div class="klein"><b>Ansparen statt sofort:</b> Leg ${euro(r.rateVorschlag)} im Monat zurück → im <b>${monatName(r.rateZiel)}</b> erreicht.</div>
          <div style="display:flex;gap:8px;margin-top:8px"><input type="text" inputmode="decimal" id="wd-rate" value="${centZuText(r.rateVorschlag)}" style="width:110px;flex:none">
            <button class="knopf klein haupt" style="flex:1" data-action="sparrate-neu">Als monatliche Sparrate anlegen</button></div>`;
    }
    h += '</section>';
  }
  if (w.typ === 'projekt') {
    h += `<section class="karte" style="margin-top:12px"><h2>${icon('liste')} Teile</h2>${(w.teile || []).map((t) => `
      <div class="teil ${t.gekauft ? 'erledigt' : ''}"><span class="teil-name" style="flex:1">${esc(t.name)}</span><span class="klein">${euro(t.preis)}</span>
        ${t.gekauft ? `<span class="gruen klein">${icon('haken')}</span>`
          : offen ? `<button class="knopf klein" data-action="teil-gekauft" data-tid="${t.id}">Gekauft</button>` : ''}</div>`).join('')}</section>`;
  }
  if (r) h += htmlZielExtras(z);
  if (w.link) h += `<div class="klein" style="margin-top:12px">${icon('pin')} <a href="${esc(w.link)}" target="_blank" rel="noopener">${esc(w.link.replace(/^https?:\/\//, '').slice(0, 50))}</a></div>`;
  if (w.notiz) h += `<div class="klein grau" style="margin-top:8px">${esc(w.notiz)}</div>`;
  h += `<div style="margin-top:16px">
    ${offen ? `<button class="knopf haupt" data-action="wunsch-gekauft" data-id="${id}">${icon('haken')} ${w.typ === 'projekt' ? 'Traum erfüllt 🎉' : 'Gekauft'}</button>` : ''}
    <div class="knopfreihe">
      ${offen ? `<button class="knopf" data-action="wunsch-ziel" data-id="${id}">${w.istZiel ? '⭐ Ziel – entfernen' : '☆ Als Ziel oben zeigen'}</button>` : ''}
      <button class="knopf" data-action="wunsch-bearbeiten" data-id="${id}">${icon('stift')} Bearbeiten</button>
    </div>
    <div class="knopfreihe"><button class="knopf gefahr" data-action="wunsch-loeschen" data-id="${id}">Löschen</button></div>
  </div>`;
  sheetOeffnen(h);
}

// Kauf eintragen: Ausgabe buchen + Spartopf (so weit vorhanden) dafür leeren
async function kaufBuchen(w, preis, notiz) {
  const jetzt = Date.now();
  const topf = wunschGespart(w);
  const katId = w.kategorieId && kat(w.kategorieId) ? w.kategorieId : standardKaufKategorie();
  if (preis > 0) {
    await speichern('buchungen', { id: neueId(), datum: heute(), betrag: preis, art: 'ausgabe', kategorieId: katId,
      notiz, wunschId: w.id, vorlageId: null, erstellt: jetzt });
  }
  const entnahme = Math.min(Math.max(0, topf), preis);
  if (entnahme > 0) {
    await speichern('buchungen', { id: neueId(), datum: heute(), betrag: -entnahme, art: 'sparen',
      kategorieId: (await spartopfKategorie()).id, notiz: `Aus Spartopf: ${w.name}`, wunschId: w.id, vorlageId: null, erstellt: jetzt + 1 });
  }
}
async function wunschErfuellt(w) {
  await speichern('wuensche', { ...w, status: 'erfuellt', erfuelltAm: new Date().toISOString(), istZiel: false });
  for (const v of daten.vorlagen.filter((x) => x.wunschId === w.id)) await loeschen('vorlagen', v.id); // Sparrate endet
  formSchliessen();
  render();
  konfetti(); vibrieren([40, 60, 40]);
  toast(`🎉 ${w.name} – erfüllt!`);
}
async function wunschKaufen(id) {
  const w = daten.wuensche.find((x) => x.id === id);
  if (!w) return;
  if (w.typ === 'projekt') {
    const offen = (w.teile || []).filter((t) => !t.gekauft);
    const summe = offen.reduce((s, t) => s + t.preis, 0);
    if (offen.length && !confirm(`Die ${offen.length} offenen Teile (${euro(summe)}) als gekauft eintragen und „${w.name}“ abschließen?`)) return;
    for (const t of offen) await kaufBuchen(daten.wuensche.find((x) => x.id === id), t.preis, `${w.name}: ${t.name}`);
    const teile = (w.teile || []).map((t) => (t.gekauft ? t : { ...t, gekauft: true, gekauftAm: heute() }));
    return wunschErfuellt({ ...w, teile });
  }
  const topf = Math.max(0, wunschGespart(w));
  if (!confirm(`„${w.name}“ als gekauft eintragen?\n\nEs wird eine Ausgabe über ${euro(w.preis)} gebucht`
    + (topf ? ` und ${euro(Math.min(topf, w.preis))} aus dem Spartopf genommen.` : '.'))) return;
  await kaufBuchen(w, w.preis, w.name);
  await wunschErfuellt(w);
}

/* ---------------------------------------------------------------------
   6c. Kredit / Vertrag bearbeiten (✎)
   --------------------------------------------------------------------- */

function kreditFormOeffnen(id) {
  const k = daten.kredite.find((x) => x.id === id);
  if (!k) return;
  sheetOeffnen(`${sheetKopf(`Bearbeiten: ${esc(k.name)}`)}
    <label class="feld"><span>Name</span><input type="text" id="ke-name" value="${esc(k.name)}"></label>
    <label class="feld"><span>Monatliche Rate (€)</span><input type="text" inputmode="decimal" id="ke-rate" value="${centZuText(k.rate)}"></label>
    <div class="label">Abbuchung am</div>
    ${htmlTagWahl('ke-tag', k.tag || 1)}
    ${k.typ === 'kredit' ? `
      <label class="feld"><span>Zinssatz % (optional)</span><input type="text" inputmode="decimal" id="ke-zins" value="${k.zins ? String(k.zins).replace('.', ',') : ''}"></label>
      <label class="feld"><span>Ursprünglicher Kreditbetrag (€, optional)</span><input type="text" inputmode="decimal" id="ke-ursprung" value="${k.ursprung ? centZuText(k.ursprung) : ''}"></label>
      <div class="klein grau" style="margin-bottom:12px">Die Restschuld korrigierst du direkt in der Liste darunter.</div>`
    : `<div class="label">Monat der letzten Rate</div>${htmlMonatWahl('ke-ende', k.ende)}<div style="height:12px"></div>`}
    <button class="knopf haupt" data-action="kredit-speichern" data-id="${k.id}">Speichern</button>`);
}
async function kreditSpeichern(id) {
  const k = daten.kredite.find((x) => x.id === id);
  if (!k) return;
  const wert = (feld) => document.getElementById(feld).value.trim();
  const name = wert('ke-name');
  const rate = centAusText(wert('ke-rate'));
  const tag = tagLesen('ke-tag');
  if (!name || !rate || rate <= 0) return toast('Bitte Name und Rate eingeben');
  const neu = { ...k, name, rate, tag };
  if (k.typ === 'kredit') {
    neu.zins = Number(wert('ke-zins').replace(',', '.')) || 0;
    neu.ursprung = centAusText(wert('ke-ursprung')) || null;
    // Ab heute mit den neuen Werten weiterrechnen (die bisherige Tilgung bleibt erhalten)
    if (rate !== k.rate || tag !== k.tag || neu.zins !== (k.zins || 0)) {
      neu.restschuld = kreditInfo(k).restschuld;
      neu.stichtag = heute();
    }
  } else {
    neu.ende = monatLesen('ke-ende');
  }
  await speichern('kredite', neu);
  // zugehörige regelmäßige Buchung mit anpassen
  for (const v of daten.vorlagen.filter((x) => x.kreditId === id)) {
    await speichern('vorlagen', { ...v, name, betrag: rate, tag });
  }
  formSchliessen();
  render();
  toast('Gespeichert ✓');
}

// Ziel-Karte angetippt → Details
function zielDetailsOeffnen(id) {
  if (id !== 'notgroschen') return wunschDetailsOeffnen(id);
  const z = alleZiele().find((x) => x.id === 'notgroschen');
  if (!z || !(z.betrag > 0)) { ansicht = 'einstellungen'; render(); window.scrollTo(0, 0); return; }
  const pr = zielPrognose(z);
  const pm = pufferMonate(daten.einst.puffer);
  sheetOeffnen(`${sheetKopf(`${esc(z.emoji)} ${esc(z.name)}`)}
    <div style="display:flex;gap:16px;align-items:center">${ringSvg(Math.min(1, z.stand / z.betrag), 100)}
      <div><div class="zahl mittel" style="margin:0">${euroHtml(z.stand)}</div>
        <div class="klein grau">von ${euro(z.betrag)}${z.termin ? ` · bis ${monatName(z.termin)}` : ''}</div>
        ${pm !== null && daten.einst.zielGleichPuffer ? `<div class="klein">Puffer reicht für <b>${monateText(pm)} Monate</b></div>` : ''}</div></div>
    <div class="ampel-box ${pr.ampel || ''}"><div class="klein">${pr.erreicht ? 'Ziel erreicht 🎉'
      : pr.monat ? `${pr.ampel ? `<span class="ampel ${pr.ampel}"></span>` : ''}Bei deinem Tempo (${euro(z.tempo)}/Monat) erreicht im <b>${monatName(pr.monat)}</b>`
      : pr.zuLang ? `Noch ${euro(pr.rest)} – bei deinem Tempo (${euro(z.tempo)}/Monat) über 10 Jahre.`
      : `Noch ${euro(pr.rest)}. Leg eine Sparrate an (Einstellungen → Regelmäßige Buchungen, Art „Sparen“), dann siehst du, wann du es schaffst.`}</div></div>
    ${htmlZielExtras(z)}
    <div class="klein grau" style="margin-top:10px">Den Stand trägst du in den Einstellungen ein (Notgroschen-Konto).</div>
    <div class="knopfreihe"><button class="knopf" data-action="ziel-einstellungen">Stand & Ziel ändern</button></div>`);
}

/* ---------------------------------------------------------------------
   7. Backup
   --------------------------------------------------------------------- */

function backupJson() {
  const paket = {
    app: 'meine-finanzen', format: 1, appVersion: APP_VERSION,
    exportiertAm: new Date().toISOString(),
    buchungen: daten.buchungen, kategorien: daten.kategorien,
    vorlagen: daten.vorlagen, kredite: daten.kredite, wuensche: daten.wuensche, einstellungen: daten.einst,
  };
  return JSON.stringify(paket, null, 2);
}

async function backupErledigt() {
  daten.einst.letztesBackup = new Date().toISOString();
  await einstSpeichern();
  render();
}

// Datei im Ordner "Downloads" speichern
function herunterladen(inhalt, name, typ) {
  const url = URL.createObjectURL(new File([inhalt], name, { type: typ }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportieren() {
  herunterladen(backupJson(), `finanzen-backup-${heute()}.json`, 'application/json');
  await backupErledigt();
  toast('Backup gespeichert (Ordner „Downloads“)');
}

// CSV für Excel: Semikolon, Komma als Dezimalzeichen, Ausgaben/Sparen mit Minus
function csvExport() {
  const zelle = (t) => (/[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  const art = { ausgabe: 'Ausgabe', einnahme: 'Einnahme', sparen: 'Sparen' };
  const zeilen = ['Datum;Art;Kategorie;Betrag;Notiz'];
  for (const b of [...daten.buchungen].sort((a, c) => a.datum.localeCompare(c.datum))) {
    const [j, m, t] = b.datum.split('-');
    const wert = (b.art === 'einnahme' ? b.betrag : -b.betrag) / 100;
    zeilen.push([`${t}.${m}.${j}`, art[b.art] || b.art, zelle(kat(b.kategorieId)?.name || ''),
      wert.toFixed(2).replace('.', ','), zelle(b.notiz || '')].join(';'));
  }
  // \ufeff am Anfang, damit Excel die Umlaute richtig erkennt
  herunterladen('\ufeff' + zeilen.join('\r\n'), `finanzen-${heute()}.csv`, 'text/csv;charset=utf-8');
  toast(`${daten.buchungen.length} Buchungen als CSV gespeichert (Downloads)`);
}

// Über das Android-Teilen-Menü direkt an Google Drive, Mail usw. schicken
// Android-Chrome erlaubt beim Teilen keine .json-Dateien → als .txt teilen
// (Inhalt ist identisch, "Wiederherstellen" kann beide lesen)
async function teilen() {
  const datei = new File([backupJson()], `finanzen-backup-${heute()}.txt`, { type: 'text/plain' });
  if (!navigator.canShare || !navigator.canShare({ files: [datei] })) {
    return toast('Teilen geht hier nicht – nimm „Backup herunterladen“');
  }
  try {
    await navigator.share({ files: [datei], title: 'Finanzen-Backup' });
    await backupErledigt();
  } catch (err) {
    if (err.name !== 'AbortError') toast(`Teilen fehlgeschlagen (${err.name})`);
  }
}

async function importieren(datei) {
  let p;
  try { p = JSON.parse(await datei.text()); } catch { return toast('Das ist keine gültige Backup-Datei'); }
  if (p.app !== 'meine-finanzen' || !Array.isArray(p.buchungen)) return toast('Diese Datei ist kein Backup dieser App');
  const vom = new Date(p.exportiertAm).toLocaleDateString('de-DE');
  if (!confirm(`Backup vom ${vom} mit ${p.buchungen.length} Buchungen wiederherstellen?\n\nAchtung: Die aktuellen Daten auf diesem Handy werden dabei ersetzt.`)) return;

  // Alles als "gerade geändert" markieren, damit das Backup beim Abgleich gewinnt
  const jetzt = Date.now();
  const mitZeit = (x) => ({ ...x, geaendert: jetzt });
  for (const t of TABELLEN) await dbLeeren(t);
  for (const b of p.buchungen) await dbPut('buchungen', mitZeit(b));
  for (const k of p.kategorien || []) await dbPut('kategorien', mitZeit(k));
  for (const v of p.vorlagen || []) await dbPut('vorlagen', mitZeit(v));
  for (const k of p.kredite || []) await dbPut('kredite', mitZeit(k));
  for (const w of p.wuensche || []) await dbPut('wuensche', mitZeit(w));
  await dbPut('einstellungen', mitZeit({ ...STANDARD_EINST, ...(p.einstellungen || {}), id: 'haupt' }));
  await allesLaden();
  if (daten.kategorien.length === 0) await startdatenAnlegen();
  render();
  aenderungMelden();
  toast('Backup wiederhergestellt ✓');
}

/* ---------------------------------------------------------------------
   7b. Abgleich zwischen Geräten (über ein privates GitHub-Repository)
   Ablauf eines Abgleichs:
     1. verschlüsselte Datei "daten.json" von GitHub laden
     2. mit dem Passwort entschlüsseln
     3. mit den Daten dieses Geräts zusammenführen
        (pro Eintrag gewinnt die neuere Änderung, Löschungen zählen auch)
     4. Ergebnis hier speichern und – falls nötig – verschlüsselt hochladen
   Verschlüsselung: AES-256-GCM, Schlüssel aus dem Passwort per PBKDF2
   (310.000 Runden). Das Passwort selbst wird nirgends gespeichert.
   --------------------------------------------------------------------- */

const SYNC_DATEI = 'daten.json';
let syncZugang = null;   // { repo, token, schluessel, salt, zuletzt } – nur auf diesem Gerät
let syncStatus = 'aus';  // aus | laeuft | ok | offline | fehler
let syncFehlerText = '';
let syncLaeuft = false, syncNochmal = false, syncTimer = null;

// --- Base64-Helfer (für Binärdaten) ---
function zuBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const ausBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// --- Packen (gzip) spart Platz, danach verschlüsseln ---
const packen = async (bytes) => new Uint8Array(await new Response(
  new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const entpacken = async (bytes) => new Uint8Array(await new Response(
  new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());

async function schluesselAbleiten(passwort, salt) {
  const basis = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    basis, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function verschluesseln(objekt, schluessel, salt) {
  const roh = await packen(new TextEncoder().encode(JSON.stringify(objekt)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const geheim = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, schluessel, roh));
  return JSON.stringify({ app: 'meine-finanzen-sync', format: 1, salt: zuBase64(salt), iv: zuBase64(iv), daten: zuBase64(geheim) });
}

async function entschluesseln(dateiText, schluessel) {
  const d = JSON.parse(dateiText);
  let roh;
  try {
    roh = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ausBase64(d.iv) }, schluessel, ausBase64(d.daten));
  } catch { throw new Error('Falsches Passwort'); }
  return JSON.parse(new TextDecoder().decode(await entpacken(new Uint8Array(roh))));
}

// --- GitHub-Zugriff ---
async function gh(zugang, pfad, optionen = {}) {
  return fetch(`https://api.github.com/repos/${zugang.repo}${pfad}`, {
    ...optionen, cache: 'no-store',
    headers: { Authorization: `Bearer ${zugang.token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', ...(optionen.headers || {}) },
  });
}
async function ghFehler(antwort) {
  if (antwort.status === 401) return new Error('Token ungültig oder abgelaufen');
  if (antwort.status === 403) return new Error('Token hat keine Schreib-/Leserechte für dieses Repository');
  return new Error(`GitHub-Fehler ${antwort.status}`);
}
// Gibt { sha, datei } zurück, oder null, wenn es die Datei noch nicht gibt
async function ghLaden(zugang) {
  const a = await gh(zugang, `/contents/${SYNC_DATEI}`);
  if (a.status === 404) {
    const repo = await gh(zugang, '');
    if (repo.status === 404) throw new Error('Repository nicht gefunden – Name und Token prüfen');
    if (!repo.ok) throw await ghFehler(repo);
    return null;
  }
  if (!a.ok) throw await ghFehler(a);
  const j = await a.json();
  if (j.content) return { sha: j.sha, datei: atob(j.content.replace(/\s/g, '')) };
  // große Datei (> 1 MB): Inhalt separat holen
  const roh = await gh(zugang, `/contents/${SYNC_DATEI}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
  if (!roh.ok) throw await ghFehler(roh);
  return { sha: j.sha, datei: await roh.text() };
}
// Gibt false zurück, wenn ein anderes Gerät gleichzeitig hochgeladen hat
async function ghSpeichern(zugang, dateiText, sha) {
  const a = await gh(zugang, `/contents/${SYNC_DATEI}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Abgleich ${new Date().toLocaleString('de-DE')}`,
      content: btoa(dateiText), ...(sha ? { sha } : {}) }),
  });
  if (a.status === 409 || a.status === 422) return false;
  if (!a.ok) throw await ghFehler(a);
  return true;
}

// --- Zusammenführen ---
async function alleRohdaten() {
  const roh = {};
  for (const t of TABELLEN) roh[t] = await dbAlle(t);
  return roh;
}
// Pro Eintrag (gleiche id) gewinnt der mit der neueren Änderungszeit.
// Tabellen, die diese Version noch nicht kennt (von einer neueren App-Version),
// werden unverändert mitgenommen, damit nichts verloren geht.
function zusammenfuehren(a, b) {
  const ergebnis = {};
  for (const quelle of [a, b]) {
    for (const [t, liste] of Object.entries(quelle || {})) if (!TABELLEN.includes(t)) ergebnis[t] = liste;
  }
  for (const t of TABELLEN) {
    const karte = new Map();
    for (const x of [...(a?.[t] || []), ...(b?.[t] || [])]) {
      const vorhanden = karte.get(x.id);
      if (!vorhanden || (x.geaendert || 0) > (vorhanden.geaendert || 0)) karte.set(x.id, x);
    }
    ergebnis[t] = [...karte.values()];
  }
  return ergebnis;
}
// Kurzer "Fingerabdruck", um zu sehen, ob zwei Datenstände gleich sind
const fingerabdruck = (d) => TABELLEN.map((t) => (d?.[t] || [])
  .map((x) => `${x.id}:${x.geaendert || 0}`).sort().join(',')).join('|');

// --- Der eigentliche Abgleich ---
async function syncen() {
  if (!syncZugang) return;
  if (syncLaeuft) { syncNochmal = true; return; }
  if (!navigator.onLine) { syncStatusSetzen('offline'); return; }
  syncLaeuft = true;
  syncStatusSetzen('laeuft');
  try {
    let lokalGeaendert = false;
    for (let versuch = 0; versuch < 4; versuch++) {
      const fern = await ghLaden(syncZugang);
      const fernDaten = fern ? await entschluesseln(fern.datei, syncZugang.schluessel) : null;
      const lokal = await alleRohdaten();
      const gemischt = zusammenfuehren(lokal, fernDaten);

      // 1. Neues vom anderen Gerät hier speichern
      if (fingerabdruck(gemischt) !== fingerabdruck(lokal)) {
        for (const t of TABELLEN) {
          const hier = new Map(lokal[t].map((x) => [x.id, x]));
          for (const x of gemischt[t]) {
            if ((hier.get(x.id)?.geaendert ?? -1) < (x.geaendert || 0) || !hier.has(x.id)) await dbPut(t, x);
          }
        }
        lokalGeaendert = true;
      }
      // 2. Neues von diesem Gerät hochladen
      if (!fernDaten || fingerabdruck(gemischt) !== fingerabdruck(fernDaten)) {
        const text = await verschluesseln(gemischt, syncZugang.schluessel, syncZugang.salt);
        if (!(await ghSpeichern(syncZugang, text, fern?.sha))) continue; // war jemand schneller → nochmal
      }
      break;
    }
    syncZugang.zuletzt = Date.now();
    await dbPut('geraet', { id: 'sync', ...syncZugang });
    if (lokalGeaendert) {
      await allesLaden();
      // nicht neu zeichnen, während du gerade in einem Feld tippst
      if (!document.activeElement?.matches('#inhalt input, #inhalt select')) render();
    }
    syncStatusSetzen('ok');
  } catch (err) {
    syncFehlerText = err.message || String(err);
    syncStatusSetzen(navigator.onLine ? 'fehler' : 'offline');
  } finally {
    syncLaeuft = false;
    if (syncNochmal) { syncNochmal = false; setTimeout(syncen, 500); }
  }
}

// Nach jeder Änderung: 3 Sekunden warten (falls noch mehr kommt), dann abgleichen
function aenderungMelden() {
  if (!syncZugang) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; syncen(); }, 3000);
}

function syncStatusSetzen(status) {
  syncStatus = status;
  const el = document.getElementById('sync-anzeige');
  if (el) {
    el.className = `sync-punkt sync-${status}`;
    el.title = { aus: '', laeuft: 'Abgleich läuft …', ok: 'Abgeglichen', offline: 'Offline – wird später abgeglichen', fehler: `Abgleich-Fehler: ${syncFehlerText}` }[status];
  }
  const info = document.getElementById('sync-info');
  if (info) info.innerHTML = syncInfoText();
}

function syncInfoText() {
  const zeit = syncZugang?.zuletzt ? new Date(syncZugang.zuletzt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie';
  return { laeuft: '⏳ Abgleich läuft …', ok: `✅ Abgeglichen · ${zeit}`, offline: `📴 Offline – wird abgeglichen, sobald du Internet hast (zuletzt ${zeit})`,
    fehler: `<span class="rot">⚠️ ${esc(syncFehlerText)}</span> · zuletzt ${zeit}`, aus: '' }[syncStatus];
}

async function syncEinrichten() {
  const wert = (id) => document.getElementById(id).value.trim();
  const repo = wert('s-repo').replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  const token = wert('s-token');
  const passwort = document.getElementById('s-pw').value;
  const passwort2 = document.getElementById('s-pw2').value;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return toast('Repository bitte als Name/Repo, z. B. Vellorift/finanzen-daten');
  if (!token) return toast('Bitte den Token einfügen');
  if (passwort.length < 8) return toast('Passwort bitte mit mindestens 8 Zeichen');
  if (passwort !== passwort2) return toast('Die Passwörter stimmen nicht überein');

  const knopf = document.querySelector('[data-action="sync-einrichten"]');
  knopf.disabled = true; knopf.textContent = 'Verbinde …';
  try {
    const zugang = { repo, token };
    const fern = await ghLaden(zugang);
    const salt = fern ? ausBase64(JSON.parse(fern.datei).salt) : crypto.getRandomValues(new Uint8Array(16));
    zugang.salt = salt;
    zugang.schluessel = await schluesselAbleiten(passwort, salt);
    if (fern) await entschluesseln(fern.datei, zugang.schluessel); // prüft das Passwort

    // Neues Gerät ohne eigene Buchungen → nur die Daten vom anderen Gerät übernehmen
    // (verhindert doppelte Standard-Kategorien)
    if (fern && daten.buchungen.length === 0) {
      for (const t of TABELLEN) await dbLeeren(t);
    }
    syncZugang = zugang;
    await dbPut('geraet', { id: 'sync', ...zugang });
    await syncen();
    if (syncStatus === 'ok') {
      await allesLaden();
      if (daten.kategorien.length === 0) await startdatenAnlegen();
      toast(fern ? 'Verbunden – Daten übernommen ✓' : 'Verbunden – Daten hochgeladen ✓');
    }
    render();
  } catch (err) {
    toast(err.message);
    knopf.disabled = false; knopf.textContent = 'Abgleich einrichten';
  }
}

async function syncTrennen() {
  if (!confirm('Abgleich auf diesem Gerät beenden?\n\nDeine Daten bleiben auf diesem Gerät und auf GitHub erhalten. Du kannst den Abgleich jederzeit wieder einrichten.')) return;
  await dbDelete('geraet', 'sync');
  syncZugang = null;
  syncStatusSetzen('aus');
  render();
}

function htmlSync() {
  if (!syncZugang) {
    return `<section class="karte"><h2>${icon('sync')} Abgleich zwischen Geräten</h2>
      <div class="klein grau" style="margin-bottom:10px">Gleicht Handy und PC automatisch über dein privates GitHub-Repository ab.
        Die Daten werden vorher mit deinem Passwort verschlüsselt.</div>
      <label class="feld"><span>Repository (Name/Repo)</span><input type="text" id="s-repo" placeholder="Vellorift/finanzen-daten" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label class="feld"><span>Token</span><input type="password" id="s-token" placeholder="github_pat_…" autocomplete="off"></label>
      <label class="feld"><span>Passwort für die Verschlüsselung (auf allen Geräten gleich)</span><input type="password" id="s-pw" autocomplete="new-password"></label>
      <label class="feld"><span>Passwort wiederholen</span><input type="password" id="s-pw2" autocomplete="new-password"></label>
      <div class="klein gelb" style="margin-bottom:12px">⚠️ Merk dir das Passwort gut (z. B. im Passwort-Manager). Ohne es kann niemand die Daten auf GitHub wiederherstellen.</div>
      <button class="knopf haupt" data-action="sync-einrichten">Abgleich einrichten</button>
    </section>`;
  }
  return `<section class="karte"><h2>${icon('sync')} Abgleich zwischen Geräten</h2>
    <div class="klein" style="margin-bottom:4px">Verbunden mit <b>${esc(syncZugang.repo)}</b></div>
    <div class="klein grau" id="sync-info" style="margin-bottom:12px">${syncInfoText()}</div>
    <div class="knopfreihe">
      <button class="knopf" data-action="sync-jetzt">Jetzt abgleichen</button>
      <button class="knopf gefahr" data-action="sync-trennen">Trennen</button>
    </div>
  </section>`;
}

/* ---------------------------------------------------------------------
   7c. Darstellung, App-Sperre (Fingerabdruck) und Start-Bildschirm
   --------------------------------------------------------------------- */

const AKZENTE = { violett: '#8f7cff', mint: '#3ee6b4', blau: '#5aa9ff', orange: '#ff9f5a', pink: '#ff6fae' };
function darstellungAnwenden() {
  const e = daten.einst;
  const f = AKZENTE[e.akzent] || AKZENTE.violett;
  const r = document.documentElement;
  r.style.setProperty('--akzent', f);
  r.style.setProperty('--akzent-weich', `${f}29`); // gleiche Farbe, 16 % deckend
  r.classList.toggle('amoled', !!e.amoled);
  document.querySelector('meta[name=theme-color]').content = e.amoled ? '#000000' : '#0b0d11';
}

/* App-Sperre: nutzt die Bildschirmsperre des Handys (Fingerabdruck, Gesicht, PIN)
   über WebAuthn – ohne Server. Gilt nur für dieses Gerät (Tabelle "geraet").
   Schützt vor neugierigen Blicken, verschlüsselt die Daten auf dem Handy aber nicht. */
let sperre = null;            // { id: 'sperre', credId } oder null
let verstecktSeit = 0;
const sperreMoeglich = () => !!(window.PublicKeyCredential && navigator.credentials?.create);

function htmlSperreEinst() {
  return `<section class="karte"><h2>${icon('schloss')} App-Sperre</h2>
    <div class="klein grau" style="margin-bottom:10px">Beim Öffnen (und nach 1 Minute im Hintergrund) fragt die App nach deinem
      Fingerabdruck bzw. deiner Display-Sperre. Gilt nur für dieses Gerät.</div>
    ${!sperreMoeglich() ? '<div class="klein gelb">Dieser Browser unterstützt das leider nicht.</div>'
      : sperre ? `<div class="klein gruen" style="margin-bottom:8px">${icon('haken')} Aktiv auf diesem Gerät</div>
        <button class="knopf gefahr" data-action="sperre-aus">Sperre ausschalten</button>`
      : '<button class="knopf" data-action="sperre-an">Mit Fingerabdruck sperren</button>'}
  </section>`;
}
async function sperreEinrichten() {
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Meine Finanzen' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'meine-finanzen', displayName: 'Meine Finanzen' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    } });
    sperre = { id: 'sperre', credId: zuBase64(new Uint8Array(cred.rawId)) };
    await dbPut('geraet', sperre);
    render(); vibrieren(); toast('App-Sperre aktiv ✓');
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'Abgebrochen' : `Geht hier nicht (${err.name})`);
  }
}
async function sperreAusschalten() {
  if (!confirm('App-Sperre auf diesem Gerät ausschalten?')) return;
  await dbDelete('geraet', 'sperre');
  sperre = null;
  render(); toast('App-Sperre aus');
}
function sperreZeigen() {
  if (!sperre || document.getElementById('sperre')) return;
  formSchliessen();
  const el = document.createElement('div');
  el.id = 'sperre';
  el.className = 'vollbild';
  el.innerHTML = `<div style="font-size:3rem;color:var(--akzent)">${icon('schloss')}</div>
    <div class="gross">Meine Finanzen</div><div class="grau">Gesperrt</div>
    <button class="knopf haupt" style="max-width:260px;margin-top:10px" data-action="entsperren">Entsperren</button>`;
  document.body.appendChild(el);
  setTimeout(entsperren, 400); // gleich nach dem Fingerabdruck fragen
}
let entsperrenLaeuft = false;
let nachEntsperren = null; // z. B. Formular öffnen, wenn die App über "Neue Ausgabe" gestartet wurde
async function entsperren() {
  if (entsperrenLaeuft || !document.getElementById('sperre')) return;
  entsperrenLaeuft = true;
  try {
    await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: ausBase64(sperre.credId) }],
      userVerification: 'required', timeout: 60000,
    } });
    const el = document.getElementById('sperre');
    el.classList.add('weg');
    setTimeout(() => el.remove(), 450);
    if (nachEntsperren) { nachEntsperren(); nachEntsperren = null; } else startScreenZeigen();
  } catch { /* abgebrochen → Knopf "Entsperren" bleibt */ }
  entsperrenLaeuft = false;
}

// Start-Bildschirm: kurz dein Ziel mit Ring, dann gleitet er in die Übersicht
let startTimer = null;
function startScreenZeigen() {
  const e = daten.einst;
  if (e.startScreen === 'aus' || document.getElementById('startscreen')) return;
  let gezeigt = null;
  try { gezeigt = localStorage.getItem('startScreenTag'); } catch { /* egal */ }
  if (e.startScreen !== 'immer' && gezeigt === heute()) return;
  const z = alleZiele().find((x) => x.betrag > 0);
  if (!z) return;
  try { localStorage.setItem('startScreenTag', heute()); } catch { /* egal */ }
  const el = document.createElement('div');
  el.id = 'startscreen';
  el.className = 'vollbild';
  el.dataset.action = 'start-weg';
  el.innerHTML = `<div style="font-size:2.6rem;line-height:1">${esc(z.emoji)}</div>
    <div class="gross">${esc(z.name)}</div>
    ${ringSvg(Math.min(1, z.stand / z.betrag), 170)}
    <div style="max-width:300px;font-size:1.05rem">${startSatz(z)}</div>
    <div class="klein grau" style="position:absolute;bottom:calc(30px + env(safe-area-inset-bottom))">Tippen zum Überspringen</div>`;
  document.body.appendChild(el);
  animieren(el);
  startTimer = setTimeout(startScreenWeg, 2300);
}
function startScreenWeg() {
  clearTimeout(startTimer);
  const el = document.getElementById('startscreen');
  if (!el) return;
  el.classList.add('weg');
  setTimeout(() => el.remove(), 450);
}
// Wechselnde Sätze, damit es nicht langweilig wird
function startSatz(z) {
  const rest = z.betrag - z.stand;
  if (rest <= 0) return 'Ziel erreicht! 🎉 Zeit für ein neues?';
  const jetzt = heute().slice(0, 7);
  const vorher = sparSumme(monatVerschieben(jetzt, -1), z.id);
  const saetze = [`Noch ${euroRund(rest)} bis ${esc(z.name)}${z.diesenMonat > vorher && vorher >= 0 && z.diesenMonat > 0
    ? ` – ${euroRund(z.diesenMonat - vorher)} mehr als letzten Monat 💪` : ''}`];
  saetze.push(z.diesenMonat > 0 ? `Diesen Monat schon ${euroRund(z.diesenMonat)} zurückgelegt 💪` : 'Diesen Monat noch nichts gespart – heute ist ein guter Tag dafür.');
  saetze.push(`${prozent(z.stand / z.betrag)} geschafft – bleib dran!`);
  const pr = zielPrognose(z);
  if (pr.monat) {
    const [j, m] = pr.monat.split('-').map(Number);
    const tage = Math.max(1, Math.round((new Date(j, m - 1, 1) - new Date()) / 86400000));
    saetze.push(`Bei deinem Tempo in ca. ${tage} Tagen geschafft (${monatName(pr.monat)}).`);
  }
  const pm = pufferMonate(daten.einst.puffer);
  if (pm !== null && daten.einst.puffer > 0) saetze.push(`Dein Puffer reicht für ${monateText(pm)} Monate.`);
  return saetze[Math.floor(Math.random() * saetze.length)];
}

/* ---------------------------------------------------------------------
   8. Bedienung und Start
   Alle Knöpfe haben ein "data-action"-Attribut. Ein einziger
   Klick-Empfänger schaut nach, welche Aktion gemeint ist.
   --------------------------------------------------------------------- */

let wischGerade = 0; // Zeitpunkt der letzten Wischgeste (danach keinen Klick auslösen)
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action], [data-view]');
  if (!el) return;
  if (Date.now() - wischGerade < 350) return;

  if (el.dataset.view) {
    if (el.dataset.view !== ansicht) vorlageInBearbeitung = null;
    ansicht = el.dataset.view;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const id = el.dataset.id;

  switch (el.dataset.action) {
    case 'monat-zurueck': aktMonat = monatVerschieben(aktMonat, -1); render(); break;
    case 'monat-vor':     aktMonat = monatVerschieben(aktMonat, 1);  render(); break;
    case 'neu':           formOeffnen(null); break;
    case 'bearbeiten':    formOeffnen(daten.buchungen.find((b) => b.id === id)); break;

    // Formular
    case 'f-art': formArtSetzen(el.dataset.art); break;
    case 'f-kat':
      form.kategorieId = id;
      document.querySelectorAll('#f-kats .chip').forEach((c) => c.classList.toggle('an', c.dataset.id === id));
      break;
    case 'form-speichern':  await formSpeichern(); break;
    case 'form-schliessen': formSchliessen(); break;
    case 'form-loeschen':
      if (confirm('Diese Buchung wirklich löschen?')) {
        await loeschen('buchungen', form.id);
        formSchliessen(); render(); vibrieren(); toast('Gelöscht');
      }
      break;

    case 'ausblick-monate': ausblickMonate = Number(el.dataset.n); render(); break;

    // Rhythmus-Auswahl
    case 'iv-wahl': {
      const box = el.closest('.ivwahl');
      box.dataset.iv = el.dataset.iv;
      box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('an', c === el));
      const start = document.getElementById(`${box.id}-start`);
      if (start) start.hidden = el.dataset.iv === '1';
      break;
    }

    // Datumsauswahl
    case 'datum-setzen': datumSetzen(el.dataset.datum); break;
    case 'kal-auf': {
      const box = document.getElementById('f-kalender');
      if (box.hidden) { form.kalMonat = form.datum.slice(0, 7); kalenderZeigen(); } else box.hidden = true;
      break;
    }
    case 'kal-monat': form.kalMonat = monatVerschieben(form.kalMonat, Number(el.dataset.n)); kalenderZeigen(); break;

    // Tagauswahl (1. · 8. · 15. · Letzter · Anderer)
    case 'tag-wahl': {
      const box = el.closest('.tagwahl');
      const feld = box.querySelector('.tag-eingabe');
      box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('an', c === el));
      if (el.dataset.tag === 'anderer') { feld.hidden = false; feld.focus(); }
      else { feld.hidden = true; box.dataset.tag = el.dataset.tag; }
      break;
    }

    // Monatliche Vorlagen
    // Girokonto
    case 'konto-bearbeiten':
      kontoBearbeiten = true; render();
      setTimeout(() => document.getElementById('konto-eingabe')?.select(), 50);
      break;
    case 'konto-abbrechen': kontoBearbeiten = false; render(); break;
    case 'konto-speichern': {
      const cent = centAusText(document.getElementById('konto-eingabe').value.replace(/^\+/, ''));
      if (cent === null) return toast('Bitte einen Betrag eingeben (minus ist erlaubt)');
      Object.assign(daten.einst, { kontoStand: cent, kontoStichtag: heute(), kontoZeit: Date.now() });
      await einstSpeichern();
      kontoBearbeiten = false; render(); toast('Kontostand gespeichert ✓');
      break;
    }

    case 'vorlagen-uebernehmen': await vorlagenUebernehmen(aktMonat); render(); break;
    case 'vorlage-neu': {
      const name = document.getElementById('v-name').value.trim();
      const betrag = centAusText(document.getElementById('v-betrag').value);
      const tag = tagLesen('v-tag');
      const art = document.getElementById('v-art').value;
      const kategorieId = document.getElementById('v-kat').value;
      const { intervall, startMonat } = intervallLesen('v-iv');
      if (!name || !betrag || betrag <= 0) return toast('Bitte Name und Betrag eingeben');
      if (!kategorieId) return toast('Bitte eine Kategorie wählen');
      const alt = daten.vorlagen.find((v) => v.id === vorlageInBearbeitung);
      if (alt) {
        // Bearbeiten: vorhandene Vorlage ändern (id und Kredit-Verknüpfung bleiben)
        await speichern('vorlagen', { ...alt, name, betrag, tag, art, kategorieId, intervall, startMonat });
        // Schon eingetragene Buchung im aktuellen Monat gleich mit korrigieren?
        const monat = heute().slice(0, 7);
        const gebucht = daten.buchungen.find((b) => b.vorlageId === alt.id && b.datum.startsWith(monat));
        if (gebucht && confirm(`Für ${monatName(monat)} ist „${alt.name}“ schon eingetragen.\nSoll diese Buchung auch angepasst werden?`)) {
          await speichern('buchungen', { ...gebucht, betrag: alt.ausnahmen?.[monat] ?? betrag, art, kategorieId, notiz: name,
            datum: vorlageDatum(tag, monat) });
        }
        vorlageInBearbeitung = null;
        render(); toast('Änderungen gespeichert ✓');
      } else {
        await speichern('vorlagen', { id: neueId(), name, betrag, tag, art, kategorieId, intervall, startMonat });
        render(); toast('Vorlage gespeichert ✓');
      }
      break;
    }
    case 'vorlage-bearbeiten':
      vorlageInBearbeitung = id;
      render();
      document.getElementById('v-formular').scrollIntoView({ behavior: 'smooth', block: 'center' });
      break;
    case 'vorlage-abbrechen':
      vorlageInBearbeitung = null;
      render();
      break;

    // Einmalig anderer Betrag (nur für einen Monat)
    case 'einmalig-speichern': {
      const v = daten.vorlagen.find((x) => x.id === vorlageInBearbeitung);
      if (!v) break;
      const monat = monatLesen('v-ein-monat');
      const betrag = centAusText(document.getElementById('v-ein-betrag').value);
      if (betrag === null || betrag < 0) return toast('Bitte einen Betrag eingeben');
      if (!vorlageFaellig(v, monat)) return toast(`„${v.name}“ ist in ${monatName(monat)} gar nicht fällig`);
      const ausnahmen = { ...(v.ausnahmen || {}) };
      if (betrag === v.betrag) delete ausnahmen[monat]; else ausnahmen[monat] = betrag;
      await speichern('vorlagen', { ...v, ausnahmen });
      // Schon eingetragen? Dann die Buchung gleich mit ändern
      const gebucht = daten.buchungen.find((b) => b.vorlageId === v.id && b.datum.startsWith(monat));
      if (gebucht) await speichern('buchungen', { ...gebucht, betrag });
      render();
      document.getElementById('v-formular')?.scrollIntoView({ block: 'center' });
      toast(`${monatName(monat)}: ${euro(betrag)} ✓${gebucht ? ' (Buchung angepasst)' : ''}`);
      break;
    }
    case 'einmalig-loeschen': {
      const v = daten.vorlagen.find((x) => x.id === vorlageInBearbeitung);
      if (!v) break;
      const monat = el.dataset.monat;
      const alterBetrag = v.ausnahmen?.[monat];
      const ausnahmen = { ...(v.ausnahmen || {}) };
      delete ausnahmen[monat];
      await speichern('vorlagen', { ...v, ausnahmen });
      // Eingetragene Buchung mit dem einmaligen Betrag wieder auf normal setzen
      const gebucht = daten.buchungen.find((b) => b.vorlageId === v.id && b.datum.startsWith(monat) && b.betrag === alterBetrag);
      if (gebucht) await speichern('buchungen', { ...gebucht, betrag: v.betrag });
      render();
      document.getElementById('v-formular')?.scrollIntoView({ block: 'center' });
      toast(`${monatName(monat)} wieder normal (${euro(v.betrag)})`);
      break;
    }
    // Kredite & Verträge
    case 'kredit-neu': {
      const wert = (id) => document.getElementById(id).value;
      const typ = wert('kr-typ');
      const name = wert('kr-name').trim();
      const rate = centAusText(wert('kr-rate'));
      const tag = tagLesen('kr-tag');
      if (!name || !rate || rate <= 0) return toast('Bitte Name und Rate eingeben');
      const k = { id: neueId(), typ, name, rate, tag };
      if (typ === 'kredit') {
        k.zins = Number((wert('kr-zins') || '0').replace(',', '.')) || 0;
        k.ursprung = centAusText(wert('kr-ursprung')) || null;
        k.stichtag = heute();
        if (wert('kr-bekannt') === 'rest') {
          k.restschuld = centAusText(wert('kr-rest'));
          if (!k.restschuld || k.restschuld <= 0) return toast('Bitte die Restschuld eingeben');
        } else {
          // Restlaufzeit bekannt → Restschuld ausrechnen
          const ende = monatLesen('kr-ende');
          if (!ende) return toast('Bitte den Monat der letzten Rate wählen');
          const raten = kreditInfo({ typ: 'vertrag', tag, ende, rate }).raten;
          if (!raten) return toast('Die letzte Rate liegt in der Vergangenheit');
          k.restschuld = restschuldAusLaufzeit(rate, raten, k.zins);
          k.geschaetzt = true; // aus der Laufzeit berechnet
        }
      } else {
        k.ende = monatLesen('kr-ende');
        if (!k.ende) return toast('Bitte den Monat der letzten Rate wählen');
      }
      await speichern('kredite', k);
      if (document.getElementById('kr-vorlage').checked) {
        // passende Kategorie suchen oder anlegen
        let kategorie = daten.kategorien.find((x) => x.name === 'Kredite & Leasing');
        if (!kategorie) {
          kategorie = { id: neueId(), name: 'Kredite & Leasing', art: 'ausgabe', fix: true, farbe: '#e57373',
            reihenfolge: Math.max(0, ...daten.kategorien.map((x) => x.reihenfolge ?? 0)) + 1 };
          await speichern('kategorien', kategorie);
        }
        await speichern('vorlagen', { id: neueId(), name, betrag: rate, tag, kategorieId: kategorie.id, kreditId: k.id });
      }
      render(); toast('Hinzugefügt ✓');
      break;
    }
    case 'kredit-loeschen':
      if (confirm('Kredit/Vertrag löschen? Die zugehörige monatliche Buchung (Vorlage) wird mitgelöscht, bereits eingetragene Buchungen bleiben.')) {
        await loeschen('kredite', id);
        for (const v of daten.vorlagen.filter((v) => v.kreditId === id)) await loeschen('vorlagen', v.id);
        render();
      }
      break;

    // Kredit laut Plan fertig: erst nach Bestätigung löschen
    case 'kredit-fertig-ja': {
      const k = daten.kredite.find((x) => x.id === id);
      if (!k) break;
      await loeschen('kredite', id);
      for (const v of daten.vorlagen.filter((v) => v.kreditId === id)) await loeschen('vorlagen', v.id);
      render(); toast(`🎉 ${k.name} erledigt und gelöscht`);
      break;
    }
    case 'kredit-fertig-nein': {
      const k = daten.kredite.find((x) => x.id === id);
      ansicht = 'einstellungen'; vorlageInBearbeitung = null; render();
      document.getElementById(`kredit-${id}`)?.scrollIntoView({ block: 'center' });
      toast(k?.typ === 'vertrag' ? 'Trag hier den richtigen Monat der letzten Rate ein' : 'Trag hier die echte Restschuld ein');
      break;
    }

    case 'vorlage-loeschen':
      if (confirm('Vorlage löschen? (Bereits eingetragene Buchungen bleiben erhalten.)')) {
        await loeschen('vorlagen', id);
        if (vorlageInBearbeitung === id) vorlageInBearbeitung = null;
        render();
      }
      break;

    // Kategorien
    case 'kat-neu': {
      const name = document.getElementById('k-name').value.trim();
      const art = document.getElementById('k-art').value;
      if (!name) return toast('Bitte einen Namen eingeben');
      const reihenfolge = Math.max(0, ...daten.kategorien.map((k) => k.reihenfolge ?? 0)) + 1;
      await speichern('kategorien', { id: neueId(), name, art, fix: false, farbe: '#9e9e9e', reihenfolge });
      render(); toast('Kategorie hinzugefügt ✓');
      break;
    }
    case 'kat-loeschen': {
      const benutzt = daten.buchungen.filter((b) => b.kategorieId === id).length
        + daten.vorlagen.filter((v) => v.kategorieId === id).length;
      if (benutzt) return alert(`Diese Kategorie wird noch ${benutzt}× verwendet und kann nicht gelöscht werden.\nDu kannst sie aber umbenennen.`);
      if (confirm(`Kategorie „${kat(id).name}“ löschen?`)) { await loeschen('kategorien', id); render(); }
      break;
    }

    // --- neu in 2.0 ---
    case 'toast-knopf': {
      const f = toastAktion;
      document.getElementById('toast').hidden = true; toastAktion = null;
      if (f) await f();
      break;
    }
    case 'f-favorit': {
      formArtSetzen('ausgabe');
      form.kategorieId = el.dataset.kat;
      document.querySelectorAll('#f-kats .chip').forEach((c) => c.classList.toggle('an', c.dataset.id === el.dataset.kat));
      document.getElementById('f-betrag').value = centZuText(Number(el.dataset.betrag));
      document.getElementById('f-notiz').value = el.dataset.name;
      break;
    }
    case 'schnell-buchen': {
      const b = { id: neueId(), datum: heute(), betrag: Number(el.dataset.betrag), art: 'ausgabe',
        kategorieId: el.dataset.kat, notiz: el.dataset.name, vorlageId: null, erstellt: Date.now() };
      await speichern('buchungen', b);
      vibrieren(); render();
      toast(`${b.notiz} ${euro(b.betrag)} gebucht`, 'Rückgängig', async () => { await loeschen('buchungen', b.id); render(); });
      break;
    }
    case 'rueckblick-weg':
      daten.einst.rueckblickGesehen = monatVerschieben(heute().slice(0, 7), -1);
      await einstSpeichern(); render();
      break;
    case 'auswertung-tab': auswertungTab = el.dataset.tab; render(); break;
    case 'analyse-monate': analyseMonate = Number(el.dataset.n); render(); break;
    case 'budget-uebernehmen': {
      const k = kat(id);
      await speichern('kategorien', { ...k, budget: Number(el.dataset.betrag) });
      render(); toast(`Budget für ${k.name}: ${euro(Number(el.dataset.betrag))} ✓`);
      break;
    }
    case 'abo-geprueft': {
      const v = daten.vorlagen.find((x) => x.id === id);
      await speichern('vorlagen', { ...v, geprueft: Date.now() });
      render(); toast('Als geprüft markiert ✓');
      break;
    }
    case 'akzent-wahl': daten.einst.akzent = el.dataset.akzent; await einstSpeichern(); render(); break;
    case 'csv': csvExport(); break;
    case 'sperre-an': await sperreEinrichten(); break;
    case 'sperre-aus': await sperreAusschalten(); break;
    case 'entsperren': await entsperren(); break;
    case 'start-weg': startScreenWeg(); break;
    case 'ziel-details': zielDetailsOeffnen(id); break;
    case 'ziel-einstellungen': formSchliessen(); ansicht = 'einstellungen'; render(); window.scrollTo(0, 0); break;

    // Kredit bearbeiten
    case 'kredit-bearbeiten': kreditFormOeffnen(id); break;
    case 'kredit-speichern': await kreditSpeichern(id); break;

    // Wünsche
    case 'wunsch-neu': wunschFormOeffnen(null, el.dataset.typ); break;
    case 'wunsch-details': wunschDetailsOeffnen(id); break;
    case 'wunsch-bearbeiten': wunschFormOeffnen(daten.wuensche.find((w) => w.id === id)); break;
    case 'wunsch-gekauft': await wunschKaufen(id); break;
    case 'wunsch-ziel': {
      const w = daten.wuensche.find((x) => x.id === id);
      await speichern('wuensche', { ...w, istZiel: !w.istZiel });
      if (wunschOffen === id) wunschDetailsOeffnen(id);
      render(); toast(w.istZiel ? 'Nicht mehr als Ziel oben' : '⭐ Wird jetzt oben in der Übersicht gezeigt');
      break;
    }
    case 'wunsch-hoch': case 'wunsch-runter': {
      const liste = offeneWuensche();
      const i = liste.findIndex((w) => w.id === id);
      const j = i + (el.dataset.action === 'wunsch-hoch' ? -1 : 1);
      if (i < 0 || j < 0 || j >= liste.length) break;
      [liste[i], liste[j]] = [liste[j], liste[i]];
      for (let n = 0; n < liste.length; n++) {
        if (liste[n].reihenfolge !== n) await speichern('wuensche', { ...liste[n], reihenfolge: n });
      }
      render();
      break;
    }
    case 'wunsch-loeschen': {
      const w = daten.wuensche.find((x) => x.id === id);
      if (!w || !confirm(`„${w.name}“ löschen?${wunschGespart(w) > 0 ? `\n\nIm Spartopf liegen ${euro(wunschGespart(w))} – die Spar-Buchungen bleiben erhalten.` : ''}`)) break;
      await loeschen('wuensche', id);
      for (const v of daten.vorlagen.filter((x) => x.wunschId === id)) await loeschen('vorlagen', v.id);
      formSchliessen(); render(); toast('Gelöscht');
      break;
    }
    case 'spartopf-ein': case 'spartopf-aus': {
      const w = daten.wuensche.find((x) => x.id === wunschOffen);
      const betrag = centAusText(document.getElementById('wd-betrag').value);
      if (!w || !betrag || betrag <= 0) return toast('Bitte einen Betrag eingeben');
      const raus = el.dataset.action === 'spartopf-aus';
      if (raus && betrag > wunschGespart(w)) return toast(`Im Spartopf sind nur ${euro(wunschGespart(w))}`);
      await speichern('buchungen', { id: neueId(), datum: heute(), betrag: raus ? -betrag : betrag, art: 'sparen',
        kategorieId: (await spartopfKategorie()).id, notiz: `${raus ? 'Aus Spartopf' : 'Spartopf'}: ${w.name}`,
        wunschId: w.id, vorlageId: null, erstellt: Date.now() });
      vibrieren();
      wunschDetailsOeffnen(w.id); render();
      toast(raus ? `${euro(betrag)} entnommen` : `${euro(betrag)} eingezahlt 💪`);
      break;
    }
    case 'sparrate-neu': {
      const w = daten.wuensche.find((x) => x.id === wunschOffen);
      const betrag = centAusText(document.getElementById('wd-rate').value);
      if (!w || !betrag || betrag <= 0) return toast('Bitte einen Betrag eingeben');
      const gehalt = daten.vorlagen.find((v) => v.art === 'einnahme');
      await speichern('vorlagen', { id: neueId(), name: `Spartopf: ${w.name}`, betrag, art: 'sparen',
        kategorieId: (await spartopfKategorie()).id, tag: gehalt?.tag || 1, intervall: 1, startMonat: null, wunschId: w.id });
      wunschDetailsOeffnen(w.id); render();
      toast('Sparrate angelegt ✓ – erscheint jeden Monat bei den regelmäßigen Buchungen');
      break;
    }
    case 'sparrate-weg': {
      const w = daten.wuensche.find((x) => x.id === wunschOffen);
      if (!w || !confirm('Monatliche Sparrate für diesen Wunsch beenden? (Das Geld im Spartopf bleibt.)')) break;
      for (const v of daten.vorlagen.filter((x) => x.wunschId === w.id)) await loeschen('vorlagen', v.id);
      wunschDetailsOeffnen(w.id); render();
      break;
    }
    case 'teil-gekauft': {
      const w = daten.wuensche.find((x) => x.id === wunschOffen);
      const t = w?.teile?.find((x) => x.id === el.dataset.tid);
      if (!t || !confirm(`„${t.name}“ für ${euro(t.preis)} als gekauft eintragen?`)) break;
      await kaufBuchen(w, t.preis, `${w.name}: ${t.name}`);
      const teile = w.teile.map((x) => (x.id === t.id ? { ...x, gekauft: true, gekauftAm: heute() } : x));
      if (teile.every((x) => x.gekauft)) { await wunschErfuellt({ ...w, teile }); break; }
      await speichern('wuensche', { ...w, teile });
      vibrieren();
      wunschDetailsOeffnen(w.id); render(); toast(`${t.name} gekauft ✓`);
      break;
    }
    // Wunsch-Formular
    case 'wf-typ': {
      wfTeileLesen();
      wf.typ = el.dataset.typ;
      if (wf.typ === 'projekt' && !wf.teile.length) {
        const preis = centAusText(document.getElementById('wf-preis').value) || 0;
        wf.teile.push({ id: neueId(), name: preis ? (document.getElementById('wf-name').value.trim() || 'Hauptsache') : '', preis });
        document.getElementById('wf-teile').innerHTML = wfTeileHtml();
      }
      el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('an', b === el));
      document.getElementById('wf-preis-box').hidden = wf.typ === 'projekt';
      document.getElementById('wf-teile-box').hidden = wf.typ !== 'projekt';
      break;
    }
    case 'wf-prio':
      wf.prio = el.dataset.prio;
      document.querySelectorAll('#wf-prio .chip').forEach((c) => c.classList.toggle('an', c === el));
      break;
    case 'wf-teil-neu': {
      wfTeileLesen();
      wf.teile.push({ id: neueId(), name: '', preis: 0 });
      document.getElementById('wf-teile').innerHTML = wfTeileHtml();
      [...document.querySelectorAll('.wf-teil-name')].pop()?.focus();
      break;
    }
    case 'wf-teil-weg':
      wfTeileLesen();
      wf.teile = wf.teile.filter((t) => t.id !== el.dataset.tid);
      document.getElementById('wf-teile').innerHTML = wfTeileHtml();
      break;
    case 'wf-speichern': await wunschFormSpeichern(); break;

    // Abgleich
    case 'sync-einrichten': await syncEinrichten(); break;
    case 'sync-jetzt':      await syncen(); break;
    case 'sync-trennen':    await syncTrennen(); break;

    // Backup
    case 'export': await exportieren(); break;
    case 'teilen': await teilen(); break;
    case 'import': document.getElementById('import-datei').click(); break;
  }
});

// Änderungen in Eingabefeldern der Einstellungen (wird beim Verlassen des Feldes ausgelöst)
document.addEventListener('change', async (ev) => {
  const el = ev.target;

  if (el.id === 'import-datei') {
    if (el.files[0]) await importieren(el.files[0]);
    el.value = '';
    return;
  }

  if (el.dataset.einst) {
    const feld = el.dataset.einst;
    if (el.type === 'checkbox') daten.einst[feld] = el.checked;
    else if (el.dataset.typ === 'euro') {
      const cent = centAusText(el.value);
      if (cent === null || cent < 0) { toast('Ungültiger Betrag'); el.value = centZuText(daten.einst[feld]); return; }
      daten.einst[feld] = cent;
      el.value = centZuText(cent);
    } else daten.einst[feld] = el.value.trim();
    await einstSpeichern();
    if (el.type === 'checkbox') render();
    toast('Gespeichert ✓');
    return;
  }

  // Suche/Filter in Buchungen, Was-wäre-wenn, Wunschtermine
  if (el.id === 'such-kat') { suchKat = el.value; document.getElementById('buchungsliste').innerHTML = htmlBuchungsliste(); return; }
  if (el.id === 'ww-kat') { wasWaereKat = el.value; wasWaereBetrag = 0; render(); return; }
  if (el.id === 'wf-mit-termin') { document.getElementById('wf-termin-box').hidden = !el.checked; return; }
  if (el.id === 'ziel-mit-termin') {
    daten.einst.zielTermin = el.checked ? monatVerschieben(heute().slice(0, 7), 12) : null;
    await einstSpeichern(); render(); return;
  }
  if (el.closest('[data-ziel-termin]')) {
    daten.einst.zielTermin = monatLesen('ziel-termin');
    await einstSpeichern(); toast(`Wunschtermin: ${monatName(daten.einst.zielTermin)} ✓`); return;
  }
  // Felder in Formularen werden erst beim Speichern gelesen (Ausnahme: Häkchen „Regelmäßig“)
  if (el.closest('.sheet') && el.id !== 'f-wiederkehrend') return;

  if (el.id === 'v-art') { document.getElementById('v-kat').innerHTML = katOptionenFuer(el.value); return; }

  if (el.id === 'f-wiederkehrend') {
    const box = document.getElementById('f-tag-box');
    box.hidden = !el.checked;
    if (el.checked) {
      const datum = document.getElementById('f-datum').value || heute();
      box.innerHTML = `<div class="label">Wie oft?</div>${htmlIntervallWahl('f-iv', 1, null, false)}
        <div class="label">An welchem Tag?</div>${htmlTagWahl('f-tag', tagAusDatum(datum))}`;
    }
    return;
  }

  if (el.id === 'kr-typ' || el.id === 'kr-bekannt') { // passende Felder ein-/ausblenden
    const kredit = document.getElementById('kr-typ').value === 'kredit';
    const laufzeit = document.getElementById('kr-bekannt').value === 'laufzeit';
    document.querySelectorAll('.nur-kredit').forEach((x) => (x.hidden = !kredit));
    document.querySelectorAll('.nur-rest').forEach((x) => (x.hidden = !kredit || laufzeit));
    document.querySelectorAll('.zeige-ende').forEach((x) => (x.hidden = kredit && !laufzeit));
    return;
  }

  if (el.dataset.kreditFeld === 'restschuld') {
    const k = daten.kredite.find((x) => x.id === el.dataset.id);
    const cent = centAusText(el.value);
    if (cent === null || cent < 0) return toast('Ungültiger Betrag');
    k.restschuld = cent;
    k.geschaetzt = false; // jetzt ein echter Wert
    k.stichtag = heute(); // ab heute neu rechnen
    await speichern('kredite', k);
    render(); toast('Restschuld aktualisiert ✓');
    return;
  }

  // Letzter Monat eines Vertrags (Leasing) korrigieren
  const endeBox = el.closest('[data-kredit-ende]');
  if (endeBox) {
    const k = daten.kredite.find((x) => x.id === endeBox.dataset.kreditEnde);
    k.ende = monatLesen(`kr-ende-${k.id}`);
    await speichern('kredite', k);
    render();
    document.getElementById(`kredit-${k.id}`)?.scrollIntoView({ block: 'center' });
    toast(`Letzte Rate: ${monatName(k.ende)} ✓`);
    return;
  }

  if (el.dataset.katFeld) {
    const k = kat(el.dataset.id);
    const feld = el.dataset.katFeld;
    if (feld === 'fix') k.fix = el.checked;
    else if (feld === 'budget') {
      const c = el.value.trim() ? centAusText(el.value) : 0;
      if (c === null || c < 0) { toast('Ungültiger Betrag'); el.value = k.budget ? centZuText(k.budget) : ''; return; }
      k.budget = c;
      el.value = c ? centZuText(c) : '';
    }
    else if (feld === 'name') { if (!el.value.trim()) { el.value = k.name; return; } k.name = el.value.trim(); }
    else k[feld] = el.value;
    await speichern('kategorien', k);
    toast('Gespeichert ✓');
  }
});

// Zurück-Taste bei offenem Formular → Formular schließen statt App verlassen
window.addEventListener('popstate', () => formSchliessen(true));

// Tippen in Suchfeld / Schieben am Regler → sofort aktualisieren (ohne die ganze Seite neu zu zeichnen)
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'such-feld') {
    suchText = el.value;
    document.getElementById('buchungsliste').innerHTML = htmlBuchungsliste();
  } else if (el.id === 'ww-regler') {
    wasWaereBetrag = Number(el.value);
    document.getElementById('ww-betrag').textContent = euro(wasWaereBetrag);
    const z = hauptZiel();
    if (z) document.getElementById('ww-ergebnis').innerHTML = wasWaereText(z, wasWaereBetrag);
  }
});

/* Wischgesten:
   - Buchung nach links wischen = löschen (mit "Rückgängig")
   - sonst in Übersicht/Buchungen links/rechts wischen = Monat wechseln
   - die Ziel-Karten oben wischen sich selbst (eingebautes Scrollen) */
let wisch = null;
document.addEventListener('touchstart', (ev) => {
  wisch = null;
  if (ev.touches.length !== 1 || sheetOffen || document.querySelector('.vollbild')) return;
  if (ev.target.closest('input, select, textarea, .ziele, .segment')) return;
  const t = ev.touches[0];
  wisch = { x: t.clientX, y: t.clientY, dx: 0, richtung: null, buchung: ev.target.closest('.buchung') };
}, { passive: true });
document.addEventListener('touchmove', (ev) => {
  if (!wisch) return;
  const t = ev.touches[0];
  const dx = t.clientX - wisch.x, dy = t.clientY - wisch.y;
  if (!wisch.richtung && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) wisch.richtung = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
  if (wisch.richtung !== 'h') return;
  wisch.dx = dx;
  if (wisch.buchung && dx < 0) { wisch.buchung.classList.remove('gleitet'); wisch.buchung.style.transform = `translateX(${dx}px)`; }
}, { passive: true });
document.addEventListener('touchend', () => {
  const w = wisch;
  wisch = null;
  if (!w || w.richtung !== 'h') return;
  wischGerade = Date.now();
  if (w.buchung && w.dx < 0) {
    const b = w.buchung;
    b.classList.add('gleitet');
    if (w.dx < -110) { b.style.transform = 'translateX(-110%)'; setTimeout(() => buchungWegwischen(b.dataset.id), 230); }
    else b.style.transform = '';
    return;
  }
  if ((ansicht === 'uebersicht' || ansicht === 'buchungen') && Math.abs(w.dx) > 80) {
    aktMonat = monatVerschieben(aktMonat, w.dx < 0 ? 1 : -1);
    render();
  }
});
async function buchungWegwischen(id) {
  const alt = daten.buchungen.find((b) => b.id === id);
  if (!alt) return;
  await loeschen('buchungen', id);
  vibrieren(); render();
  toast('Buchung gelöscht', 'Rückgängig', async () => { await speichern('buchungen', { ...alt }); render(); toast('Wiederhergestellt ✓'); });
}

async function start() {
  // App-Verknüpfungen (lange aufs App-Symbol drücken): ?aktion=neu / ?ansicht=wuensche
  const param = new URLSearchParams(location.search);
  if (NAV.some((x) => x && x[0] === param.get('ansicht'))) ansicht = param.get('ansicht');
  const sofortNeu = param.get('aktion') === 'neu';
  if (location.search) history.replaceState(null, '', location.pathname);

  navAufbauen();
  let geraet = [];
  try {
    db = await dbOeffnen();
    await allesLaden();
    if (daten.kategorien.length === 0) await startdatenAnlegen(); // allererster Start
    geraet = await dbAlle('geraet');
    sperre = geraet.find((x) => x.id === 'sperre') || null;
    render();
  } catch (err) {
    document.getElementById('inhalt').innerHTML =
      `<div class="leer">Fehler beim Laden der Daten:<br>${esc(err.message)}</div>`;
    return;
  }
  if (sperre) {                          // erst entsperren, danach Start-Bildschirm bzw. Formular
    if (sofortNeu) nachEntsperren = () => formOeffnen(null);
    sperreZeigen();
  }
  else if (sofortNeu) formOeffnen(null);
  else startScreenZeigen();

  // Nach 1 Minute im Hintergrund wieder sperren
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') verstecktSeit = Date.now();
    else if (sperre && verstecktSeit && Date.now() - verstecktSeit > 60000) sperreZeigen();
  });

  // Abgleich: Zugang dieses Geräts laden und gleich einmal abgleichen
  const zugang = geraet.find((x) => x.id === 'sync');
  if (zugang) {
    syncZugang = zugang;
    syncStatusSetzen('ok');
    syncen();
  }
  window.addEventListener('online', syncen);
  window.addEventListener('offline', () => syncZugang && syncStatusSetzen('offline'));
  document.addEventListener('visibilitychange', () => {
    if (!syncZugang) return;
    if (document.visibilityState === 'visible') syncen();                   // App wieder geöffnet
    else if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; syncen(); } // App wird verlassen → Ausstehendes sofort hochladen
  });

  // Offline-Funktion aktivieren
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  // Den Browser bitten, die Daten nicht automatisch zu löschen, wenn der Speicher knapp wird
  if (navigator.storage?.persist) navigator.storage.persist();
}

start();
