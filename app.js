'use strict';
/* =====================================================================
   Meine Finanzen – Version 1
   ---------------------------------------------------------------------
   Aufbau dieser Datei:
     1. Hilfsfunktionen (Geld, Datum, Text)
     (neu in 1.1: Kredite & Verträge → siehe Abschnitt 4b)
     2. Datenbank (IndexedDB) – speichert alles nur lokal auf dem Handy
     3. Startdaten (Standard-Kategorien, Standard-Einstellungen)
     4. Berechnungen (Monatszahl, Sparquote, Puffer …)
     5. Ansichten (Übersicht, Buchungen, Einstellungen)
     6. Eingabe-Formular (neue Buchung / bearbeiten)
     7. Backup (Export / Import als JSON-Datei)
     8. Bedienung (Klicks, Eingaben) und Start der App

   Wichtig: Alle Beträge werden intern in CENT gespeichert (12,50 € = 1250).
   So gibt es keine Rundungsfehler beim Zusammenrechnen.
   ===================================================================== */

const APP_VERSION = '1.4.0';

/* ---------------------------------------------------------------------
   1. Hilfsfunktionen
   --------------------------------------------------------------------- */

// 1250 → "12,50 €"
const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const euro = (cent) => euroFormat.format(cent / 100);

// Text aus einem Eingabefeld → Cent. "12,50" / "12.50" / "1.234,56" → Zahl, sonst null
function centAusText(text) {
  let t = String(text ?? '').trim().replace(/\s|€/g, '');
  if (t === '') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); // deutsches Format
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
// "2026-11-14" → "Sa., 14.11."
function tagAnzeige(s) {
  const [j, m, t] = s.split('-').map(Number);
  return new Date(j, m - 1, t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

// Schutz: Text, den du eingibst, wird nie als HTML ausgeführt
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Eindeutige ID für jeden Eintrag
const neueId = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2));

// Kurze Meldung unten einblenden
let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

/* ---------------------------------------------------------------------
   2. Datenbank (IndexedDB)
   Die Datenbank liegt im Browser auf dem Handy. Es gibt 4 "Tabellen":
     buchungen, kategorien, vorlagen (Fixkosten), einstellungen
   Beim Start wird alles in den Speicher geladen (Objekt "daten"),
   jede Änderung wird sofort zusätzlich in die Datenbank geschrieben.
   --------------------------------------------------------------------- */

const DB_NAME = 'meine-finanzen';
const DB_VERSION = 2; // 2 = neue Tabelle "kredite"
const TABELLEN = ['buchungen', 'kategorien', 'vorlagen', 'einstellungen', 'kredite'];
let db;

function dbOeffnen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Wird nur beim allerersten Start (oder bei neuer DB_VERSION) ausgeführt
    req.onupgradeneeded = () => {
      for (const t of TABELLEN) {
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
const daten = { buchungen: [], kategorien: [], vorlagen: [], kredite: [], einst: {} };

async function allesLaden() {
  daten.buchungen = await dbAlle('buchungen');
  daten.kategorien = await dbAlle('kategorien');
  daten.vorlagen = await dbAlle('vorlagen');
  daten.kredite = await dbAlle('kredite');
  const e = await dbAlle('einstellungen');
  daten.einst = { ...STANDARD_EINST, ...(e[0] || {}) };
}

// Speichern/Löschen: Datenbank UND Speicher aktualisieren
async function speichern(tabelle, obj) {
  await dbPut(tabelle, obj);
  const liste = daten[tabelle];
  const i = liste.findIndex((x) => x.id === obj.id);
  if (i >= 0) liste[i] = obj; else liste.push(obj);
}
async function loeschen(tabelle, id) {
  await dbDelete(tabelle, id);
  daten[tabelle] = daten[tabelle].filter((x) => x.id !== id);
}
const einstSpeichern = () => dbPut('einstellungen', daten.einst);

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

// Monatliche Vorlagen (Fixkosten, Gehalt, Sparrate), die im Monat noch nicht eingetragen sind
const fehlendeVorlagen = (m) => daten.vorlagen.filter((v) => {
  if (v.kreditId) { // Rate eines Kredits: nach der letzten Rate nicht mehr vorschlagen
    const k = daten.kredite.find((x) => x.id === v.kreditId);
    if (k) { const ende = kreditInfo(k).ende; if (!ende || m > ende) return false; }
  }
  return !daten.buchungen.some((b) => b.vorlageId === v.id && b.datum.startsWith(m));
});

async function vorlagenUebernehmen(m) {
  const [j, mo] = m.split('-').map(Number);
  const tageImMonat = new Date(j, mo, 0).getDate();
  const liste = fehlendeVorlagen(m);
  for (const v of liste) {
    const tag = Math.min(v.tag || 1, tageImMonat);
    await speichern('buchungen', {
      id: neueId(), datum: `${m}-${String(tag).padStart(2, '0')}`, betrag: v.betrag,
      art: v.art || 'ausgabe', kategorieId: v.kategorieId, notiz: v.name, vorlageId: v.id,
    });
  }
  toast(`${liste.length} Buchungen eingetragen ✓`);
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

/* ---------------------------------------------------------------------
   4b. Kredite & Verträge
   typ "kredit":  Restschuld + Zinssatz bekannt → App rechnet Monat für Monat
                  (Zinsen drauf, Rate runter), bis die Schuld bei 0 ist.
   typ "vertrag": z. B. Leasing – nur Rate + letzter Monat bekannt.
   --------------------------------------------------------------------- */

// Datum der Rate in einem Monat, z. B. Tag 31 im Februar → 28.
function rateDatum(k, monat) {
  const [j, m] = monat.split('-').map(Number);
  const tage = new Date(j, m, 0).getDate();
  return `${monat}-${String(Math.min(k.tag || 1, tage)).padStart(2, '0')}`;
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
    if (d > k.stichtag) rest = Math.max(0, rest + Math.round(rest * zinsProMonat) - k.rate);
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
    rest = rest + z - k.rate;
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
  if (!i.raten) return '<span class="gruen">abbezahlt 🎉</span>';
  const jahre = Math.floor(i.raten / 12), monate = i.raten % 12;
  const dauer = jahre ? `${jahre} J. ${monate} M.` : `${monate} M.`;
  return `noch ${i.raten} Rate${i.raten > 1 ? 'n' : ''} (${dauer}) · letzte im ${monatName(i.ende)}`;
}

function backupFaellig() {
  if (daten.buchungen.length === 0) return false;
  if (!daten.einst.letztesBackup) return true;
  const tage = (Date.now() - new Date(daten.einst.letztesBackup).getTime()) / 86400000;
  return tage > 30;
}

/* ---------------------------------------------------------------------
   5. Ansichten
   Jede Ansicht ist eine Funktion, die HTML-Text zurückgibt.
   render() setzt diesen Text in die Seite ein.
   --------------------------------------------------------------------- */

let ansicht = 'uebersicht';
let aktMonat = heute().slice(0, 7);

function render() {
  document.querySelectorAll('nav [data-view]').forEach(
    (b) => b.classList.toggle('aktiv', b.dataset.view === ansicht));
  const mitMonat = ansicht !== 'einstellungen';
  document.getElementById('titel').textContent = mitMonat ? monatName(aktMonat) : 'Einstellungen';
  document.querySelectorAll('.pfeil').forEach((p) => (p.style.visibility = mitMonat ? 'visible' : 'hidden'));
  document.getElementById('inhalt').innerHTML =
    ansicht === 'uebersicht' ? htmlUebersicht()
    : ansicht === 'buchungen' ? htmlBuchungen()
    : htmlEinstellungen();
}

const prozent = (x) => (x * 100).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' %';

function htmlUebersicht() {
  const z = monatsZahlen(aktMonat);
  const e = daten.einst;
  let h = '';

  // Hinweise oben
  const fehlend = fehlendeVorlagen(aktMonat);
  if (fehlend.length) {
    h += `<button class="hinweis" data-action="vorlagen-uebernehmen">📌 ${fehlend.length} monatliche Buchung${fehlend.length > 1 ? 'en' : ''} für ${monatName(aktMonat)} eintragen
      <div class="klein grau" style="margin-top:4px">${fehlend.map((v) => esc(v.name)).join(' · ')}</div></button>`;
  }
  if (backupFaellig()) {
    h += `<button class="hinweis warn" data-action="export">💾 Backup ist über 30 Tage alt (oder noch nie gemacht). Jetzt sichern</button>`;
  }

  // Meine Monatszahl
  const fixAnteil = z.ausgaben ? (z.fix / z.ausgaben) * 100 : 0;
  h += `<section class="karte">
    <div class="label">Meine Monatszahl (Ausgaben)</div>
    <div class="zahl">${euro(z.ausgaben)}</div>
    <div class="leiste"><span style="width:${fixAnteil}%;background:#ff8a65"></span><span style="width:${100 - fixAnteil}%;background:var(--blau)"></span></div>
    <div class="zeile klein"><span><span class="punkt" style="background:#ff8a65"></span>Fix ${euro(z.fix)}</span><span><span class="punkt" style="background:var(--blau)"></span>Variabel ${euro(z.variabel)}</span></div>
  </section>`;

  if (z.anzahl === 0) {
    h += `<div class="leer">Noch keine Buchungen in diesem Monat.<br>Tippe auf <b>+</b>, um etwas einzutragen.</div>`;
  }

  // Einnahmen, gespart, frei, Sparquote
  const sqFarbe = z.sparquote === null ? '' : z.sparquote >= 0.2 ? 'gruen' : z.sparquote >= 0 ? 'gelb' : 'rot';
  h += `<div class="raster">
    <section class="karte"><div class="label">Einnahmen</div><div class="wert gruen">${euro(z.einnahmen)}</div></section>
    <section class="karte"><div class="label">Sparquote</div><div class="wert ${sqFarbe}">${z.sparquote === null ? '–' : prozent(z.sparquote)}</div></section>
    <section class="karte"><div class="label">Aufs Sparkonto</div><div class="wert blau">${euro(z.gespart)}</div></section>
    <section class="karte"><div class="label">Noch frei</div><div class="wert ${z.frei < 0 ? 'rot' : ''}">${euro(z.frei)}</div></section>
  </div>`;

  // Puffer
  const d = durchschnittAusgaben(aktMonat);
  let pufferText, pufferFarbe = '';
  if (e.puffer <= 0) {
    pufferText = 'Trag in den Einstellungen ein, wie viel auf deinem Notgroschen-Konto liegt.';
  } else if (d.schnitt <= 0) {
    pufferText = 'Sobald du Ausgaben einträgst, siehst du hier, wie lange der Puffer reicht.';
  } else {
    const monate = e.puffer / d.schnitt;
    pufferFarbe = monate >= 3 ? 'gruen' : monate >= 1 ? 'gelb' : 'rot';
    pufferText = `reicht für <b class="${pufferFarbe}">${monate.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Monate</b> Ausgaben`;
  }
  const basis = d.schnitt > 0
    ? (d.nurAktuell ? `Basis: Ausgaben dieses Monats (${euro(d.schnitt)})` : `Basis: Ø ${euro(d.schnitt)} der letzten ${d.monate} Monat${d.monate > 1 ? 'e' : ''}`)
    : '';
  h += `<section class="karte tippbar" data-view="einstellungen">
    <div class="label">Puffer (Notgroschen)</div>
    <div class="zahl mittel">${euro(e.puffer)}</div>
    <div>${pufferText}</div>
    ${basis ? `<div class="klein grau" style="margin-top:4px">${basis}</div>` : ''}
  </section>`;

  // Sparziel
  if (e.zielBetrag > 0) {
    const stand = e.zielGleichPuffer ? e.puffer : e.zielStand;
    const anteil = Math.min(stand / e.zielBetrag, 1);
    h += `<section class="karte tippbar" data-view="einstellungen">
      <div class="zeile"><span class="label">Sparziel: ${esc(e.zielName)}</span><b>${prozent(anteil)}</b></div>
      <div class="leiste" style="height:14px;border-radius:7px"><span style="width:${anteil * 100}%;background:var(--gruen)"></span></div>
      <div class="zeile klein grau"><span>${euro(stand)}</span><span>Ziel ${euro(e.zielBetrag)}</span></div>
      ${stand < e.zielBetrag ? `<div class="klein" style="margin-top:4px">Noch ${euro(e.zielBetrag - stand)}</div>` : '<div class="klein gruen" style="margin-top:4px">Ziel erreicht 🎉</div>'}
    </section>`;
  } else {
    h += `<button class="hinweis" data-view="einstellungen">🎯 Leg in den Einstellungen ein Sparziel fest</button>`;
  }

  // Ausgaben nach Kategorien
  const katListe = Object.entries(z.proKat).sort((a, b) => b[1] - a[1]);
  if (katListe.length) {
    const max = katListe[0][1];
    h += `<section class="karte"><h2>Ausgaben nach Kategorien</h2>` + katListe.map(([id, summe]) => {
      const k = kat(id) || { name: 'Gelöschte Kategorie', farbe: '#666' };
      return `<div class="katzeile">
        <div class="zeile"><span><span class="punkt" style="background:${esc(k.farbe)}"></span>${esc(k.name)}${k.fix ? ' <span class="klein grau">fix</span>' : ''}</span>
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
    h += `<section class="karte"><h2>Kredite & Verträge</h2>
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
    h += `<section class="karte"><h2>Kleine Ausgaben (bis ${euro(e.kleinGrenze)})</h2>
      <div class="zeile"><span>${klein.anzahl} kleine Ausgaben</span><b>${euro(klein.summe)}</b></div>
      ${klein.mehrfach.map((g) => `<div class="zeile klein" style="margin-top:6px"><span class="grau">${esc(g.name)} · ${g.anzahl}×</span><span>${euro(g.summe)}</span></div>`).join('')}
      <div class="klein grau" style="margin-top:8px">Hochgerechnet aufs Jahr: ca. ${euro(klein.summe * 12)}</div>
    </section>`;
  }
  return h;
}

function htmlBuchungen() {
  const liste = buchungenImMonat(aktMonat).sort((a, b) => b.datum.localeCompare(a.datum));
  if (!liste.length) return `<div class="leer">Keine Buchungen in ${monatName(aktMonat)}.</div>`;
  const z = monatsZahlen(aktMonat);
  let h = `<section class="karte zeile klein">
    <span>Ein <b class="gruen">${euro(z.einnahmen)}</b></span>
    <span>Aus <b class="rot">${euro(z.ausgaben)}</b></span>
    <span>Spar <b class="blau">${euro(z.gespart)}</b></span></section>`;
  let letzterTag = '';
  for (const b of liste) {
    if (b.datum !== letzterTag) { h += `<div class="tag">${tagAnzeige(b.datum)}</div>`; letzterTag = b.datum; }
    const k = kat(b.kategorieId) || { name: 'Gelöschte Kategorie', farbe: '#666' };
    const vorzeichen = b.art === 'einnahme' ? '+' : b.art === 'sparen' ? '→ ' : '−';
    const farbe = b.art === 'einnahme' ? 'gruen' : b.art === 'sparen' ? 'blau' : '';
    h += `<button class="buchung" data-action="bearbeiten" data-id="${b.id}">
      <span class="punkt" style="background:${esc(k.farbe)}"></span>
      <span class="mitte"><div>${esc(k.name)}${b.vorlageId ? ' 📌' : ''}</div>${b.notiz ? `<div class="notiz">${esc(b.notiz)}</div>` : ''}</span>
      <span class="betrag ${farbe}">${vorzeichen}${euro(b.betrag)}</span>
    </button>`;
  }
  return h;
}

const katOptionenFuer = (art) => kategorienVon(art).map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('');

function htmlEinstellungen() {
  const e = daten.einst;
  const euroFeld = (feld, wert) =>
    `<input type="text" inputmode="decimal" data-einst="${feld}" data-typ="euro" value="${centZuText(wert)}">`;

  const katGruppe = (art, titel) => `<div class="unter">${titel}</div>` + kategorienVon(art).map((k) => `
    <div class="katedit">
      <input type="color" value="${esc(k.farbe)}" data-kat-feld="farbe" data-id="${k.id}">
      <input type="text" value="${esc(k.name)}" data-kat-feld="name" data-id="${k.id}">
      ${art === 'ausgabe' ? `<label><input type="checkbox" data-kat-feld="fix" data-id="${k.id}" ${k.fix ? 'checked' : ''}>fix</label>` : ''}
      <button class="x" data-action="kat-loeschen" data-id="${k.id}" aria-label="Kategorie löschen">✕</button>
    </div>`).join('');

  const katOptionen = katOptionenFuer('ausgabe');
  const vorzeichen = { ausgabe: '−', einnahme: '+', sparen: '→ ' };
  const vorlagenSortiert = [...daten.vorlagen].sort((a, b) => a.tag - b.tag);

  return `
  <section class="karte"><h2>💰 Puffer & Sparziel</h2>
    <label class="feld"><span>Aktueller Stand Notgroschen-Konto (€)</span>${euroFeld('puffer', e.puffer)}</label>
    <label class="feld"><span>Name des Sparziels</span><input type="text" data-einst="zielName" value="${esc(e.zielName)}"></label>
    <label class="feld"><span>Zielbetrag (€)</span>${euroFeld('zielBetrag', e.zielBetrag)}</label>
    <label class="check"><input type="checkbox" data-einst="zielGleichPuffer" ${e.zielGleichPuffer ? 'checked' : ''}>Fortschritt = Puffer-Stand</label>
    ${e.zielGleichPuffer ? '' : `<label class="feld"><span>Bisher gespart für dieses Ziel (€)</span>${euroFeld('zielStand', e.zielStand)}</label>`}
    <div class="klein grau">Tipp: Ein Notgroschen von 3–6 Monatsausgaben gilt als solide.</div>
  </section>

  <section class="karte"><h2>📌 Monatliche Buchungen</h2>
    <div class="klein grau" style="margin-bottom:10px">Für alles, was jeden Monat gleich kommt: Fixkosten, Gehalt, Sparrate.
      In der Übersicht trägst du sie dann mit einem Tipp für den Monat ein.</div>
    ${vorlagenSortiert.length ? vorlagenSortiert.map((v) => `
      <div class="katedit">
        <span class="punkt" style="background:${esc(kat(v.kategorieId)?.farbe || '#666')}"></span>
        <span style="flex:1">${esc(v.name)}<br><span class="klein grau">${vorzeichen[v.art || 'ausgabe']}${euro(v.betrag)} · ${tagText(v.tag)} · ${esc(kat(v.kategorieId)?.name || '?')}</span></span>
        <button class="x" data-action="vorlage-loeschen" data-id="${v.id}" aria-label="Vorlage löschen">✕</button>
      </div>`).join('') : '<div class="klein grau">Noch keine Vorlagen.</div>'}
    <div class="unter">Neu</div>
    <label class="feld"><span>Art</span><select id="v-art">
      <option value="ausgabe">Ausgabe (z. B. Miete, Handy, Spotify)</option>
      <option value="einnahme">Einnahme (z. B. Gehalt)</option>
      <option value="sparen">Sparen (z. B. Sparrate aufs Zweitkonto)</option></select></label>
    <div class="zwei">
      <label class="feld"><span>Name</span><input type="text" id="v-name"></label>
      <label class="feld"><span>Betrag (€)</span><input type="text" inputmode="decimal" id="v-betrag"></label>
    </div>
    <div class="label">Wann im Monat?</div>
    ${htmlTagWahl('v-tag', 1)}
    <label class="feld"><span>Kategorie</span><select id="v-kat">${katOptionen}</select></label>
    <button class="knopf" data-action="vorlage-neu">Vorlage hinzufügen</button>
  </section>

  <section class="karte"><h2>🏦 Kredite & Verträge</h2>
    ${daten.kredite.length ? daten.kredite.map((k) => {
      const i = kreditInfo(k);
      return `<div style="margin-bottom:14px">
        <div class="katedit">
          <span style="flex:1"><b>${esc(k.name)}</b><br><span class="klein grau">${euro(k.rate)} am ${k.tag}. · ${laufzeitText(i)}</span></span>
          <button class="x" data-action="kredit-loeschen" data-id="${k.id}" aria-label="Löschen">✕</button>
        </div>
        ${k.typ === 'kredit' ? `<label class="feld"><span>Restschuld heute (zum Korrigieren, z. B. laut Kontoauszug)</span>
          <input type="text" inputmode="decimal" data-kredit-feld="restschuld" data-id="${k.id}" value="${centZuText(i.restschuld)}"></label>` : ''}
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
    <label class="feld zeige-ende" hidden><span>Monat der letzten Rate</span><input type="month" id="kr-ende" style="color-scheme:dark"></label>
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

  <section class="karte"><h2>🏷️ Kategorien</h2>
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

  <section class="karte"><h2>🔎 Kleine Ausgaben</h2>
    <label class="feld"><span>Als „klein“ zählt alles bis (€)</span>${euroFeld('kleinGrenze', e.kleinGrenze)}</label>
  </section>

  <section class="karte"><h2>💾 Backup</h2>
    <div class="klein grau" style="margin-bottom:10px">Deine Daten liegen nur auf diesem Handy. Mach regelmäßig ein Backup und speichere die Datei z. B. in Google Drive.<br>
    Letztes Backup: <b>${e.letztesBackup ? new Date(e.letztesBackup).toLocaleDateString('de-DE') : 'noch nie'}</b> · ${daten.buchungen.length} Buchungen</div>
    <button class="knopf haupt" data-action="export">Backup herunterladen</button>
    <div class="knopfreihe">
      <button class="knopf" data-action="teilen">Backup teilen …</button>
      <button class="knopf" data-action="import">Wiederherstellen</button>
    </div>
  </section>

  <div class="klein grau" style="text-align:center">Meine Finanzen · Version ${APP_VERSION}</div>`;
}

/* ---------------------------------------------------------------------
   6. Eingabe-Formular
   --------------------------------------------------------------------- */

let form = null; // die Buchung, die gerade bearbeitet wird
const sheet = () => document.getElementById('formular');

function formOeffnen(buchung) {
  const standardDatum = aktMonat === heute().slice(0, 7) ? heute() : `${aktMonat}-01`;
  form = buchung ? { ...buchung }
    : { art: 'ausgabe', betrag: null, kategorieId: null, datum: standardDatum, notiz: '' };

  sheet().innerHTML = `<div class="sheet-inhalt">
    <div class="zeile" style="margin-bottom:12px">
      <h1 style="margin:0;font-size:1.2rem">${form.id ? 'Buchung bearbeiten' : 'Neue Buchung'}</h1>
      <button class="x" data-action="form-schliessen" aria-label="Schließen">✕</button>
    </div>
    <div class="segment">
      <button data-action="f-art" data-art="ausgabe">Ausgabe</button>
      <button data-action="f-art" data-art="einnahme">Einnahme</button>
      <button data-action="f-art" data-art="sparen">Sparen</button>
    </div>
    <input id="f-betrag" class="betrag-eingabe" type="text" inputmode="decimal" placeholder="0,00 €"
      value="${form.betrag != null ? centZuText(form.betrag) : ''}" autocomplete="off">
    <div class="label">Kategorie</div>
    <div class="chips" id="f-kats"></div>
    <label class="feld"><span>Datum</span><input type="date" id="f-datum" value="${form.datum}"></label>
    <label class="feld"><span>Notiz (optional)</span><input type="text" id="f-notiz" value="${esc(form.notiz)}" placeholder="z. B. Bäcker, Kino …"></label>
    ${form.id ? '' : `<label class="check"><input type="checkbox" id="f-wiederkehrend">Jeden Monat wiederholen (als Vorlage merken)</label>
      <div id="f-tag-box" hidden style="margin:-6px 0 14px"></div>`}
    <button class="knopf haupt" data-action="form-speichern">Speichern</button>
    ${form.id ? '<div class="knopfreihe"><button class="knopf gefahr" data-action="form-loeschen">Löschen</button></div>' : ''}
  </div>`;
  formArtSetzen(form.art);

  sheet().hidden = false;
  history.pushState({ formular: true }, ''); // damit die Zurück-Taste das Formular schließt
  if (!form.id) setTimeout(() => document.getElementById('f-betrag').focus(), 60);
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

function formSchliessen(durchZurueckTaste) {
  if (sheet().hidden) return;
  sheet().hidden = true;
  form = null;
  if (!durchZurueckTaste && history.state?.formular) history.back();
}

async function formSpeichern() {
  const betrag = centAusText(document.getElementById('f-betrag').value);
  if (betrag === null || betrag <= 0) return toast('Bitte einen Betrag eingeben');
  if (!form.kategorieId) return toast('Bitte eine Kategorie wählen');
  const datum = document.getElementById('f-datum').value || heute();
  const notiz = document.getElementById('f-notiz').value.trim();

  const b = { id: form.id || neueId(), datum, betrag, art: form.art,
    kategorieId: form.kategorieId, notiz, vorlageId: form.vorlageId || null };

  // Häkchen "Jeden Monat" → zusätzlich eine monatliche Vorlage anlegen
  const wiederkehrend = document.getElementById('f-wiederkehrend');
  if (!form.id && wiederkehrend?.checked) {
    const v = { id: neueId(), name: notiz || kat(b.kategorieId).name, betrag, art: form.art,
      kategorieId: b.kategorieId, tag: tagLesen('f-tag') };
    await speichern('vorlagen', v);
    b.vorlageId = v.id;
  }
  await speichern('buchungen', b);
  formSchliessen();
  aktMonat = datum.slice(0, 7);
  render();
  toast('Gespeichert ✓');
}

/* ---------------------------------------------------------------------
   7. Backup
   --------------------------------------------------------------------- */

function backupJson() {
  const paket = {
    app: 'meine-finanzen', format: 1, appVersion: APP_VERSION,
    exportiertAm: new Date().toISOString(),
    buchungen: daten.buchungen, kategorien: daten.kategorien,
    vorlagen: daten.vorlagen, kredite: daten.kredite, einstellungen: daten.einst,
  };
  return JSON.stringify(paket, null, 2);
}

async function backupErledigt() {
  daten.einst.letztesBackup = new Date().toISOString();
  await einstSpeichern();
  render();
}

async function exportieren() {
  const datei = new File([backupJson()], `finanzen-backup-${heute()}.json`, { type: 'application/json' });
  const url = URL.createObjectURL(datei);
  const a = document.createElement('a');
  a.href = url; a.download = datei.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  await backupErledigt();
  toast('Backup gespeichert (Ordner „Downloads“)');
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

  for (const t of TABELLEN) await dbLeeren(t);
  for (const b of p.buchungen) await dbPut('buchungen', b);
  for (const k of p.kategorien || []) await dbPut('kategorien', k);
  for (const v of p.vorlagen || []) await dbPut('vorlagen', v);
  for (const k of p.kredite || []) await dbPut('kredite', k);
  await dbPut('einstellungen', { ...STANDARD_EINST, ...(p.einstellungen || {}), id: 'haupt' });
  await allesLaden();
  if (daten.kategorien.length === 0) await startdatenAnlegen();
  render();
  toast('Backup wiederhergestellt ✓');
}

/* ---------------------------------------------------------------------
   8. Bedienung und Start
   Alle Knöpfe haben ein "data-action"-Attribut. Ein einziger
   Klick-Empfänger schaut nach, welche Aktion gemeint ist.
   --------------------------------------------------------------------- */

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action], [data-view]');
  if (!el) return;

  if (el.dataset.view) {
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
        formSchliessen(); render(); toast('Gelöscht');
      }
      break;

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
    case 'vorlagen-uebernehmen': await vorlagenUebernehmen(aktMonat); render(); break;
    case 'vorlage-neu': {
      const name = document.getElementById('v-name').value.trim();
      const betrag = centAusText(document.getElementById('v-betrag').value);
      const tag = tagLesen('v-tag');
      const art = document.getElementById('v-art').value;
      const kategorieId = document.getElementById('v-kat').value;
      if (!name || !betrag || betrag <= 0) return toast('Bitte Name und Betrag eingeben');
      if (!kategorieId) return toast('Bitte eine Kategorie wählen');
      await speichern('vorlagen', { id: neueId(), name, betrag, tag, art, kategorieId });
      render(); toast('Vorlage gespeichert ✓');
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
          const ende = wert('kr-ende');
          if (!ende) return toast('Bitte den Monat der letzten Rate wählen');
          const raten = kreditInfo({ typ: 'vertrag', tag, ende, rate }).raten;
          if (!raten) return toast('Die letzte Rate liegt in der Vergangenheit');
          k.restschuld = restschuldAusLaufzeit(rate, raten, k.zins);
          k.geschaetzt = true; // aus der Laufzeit berechnet
        }
      } else {
        k.ende = wert('kr-ende');
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

    case 'vorlage-loeschen':
      if (confirm('Vorlage löschen? (Bereits eingetragene Buchungen bleiben erhalten.)')) {
        await loeschen('vorlagen', id); render();
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

  if (el.id === 'v-art') { document.getElementById('v-kat').innerHTML = katOptionenFuer(el.value); return; }

  if (el.id === 'f-wiederkehrend') {
    const box = document.getElementById('f-tag-box');
    box.hidden = !el.checked;
    if (el.checked) {
      const datum = document.getElementById('f-datum').value || heute();
      box.innerHTML = `<div class="label">Wann im Monat?</div>${htmlTagWahl('f-tag', tagAusDatum(datum))}`;
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

  if (el.dataset.katFeld) {
    const k = kat(el.dataset.id);
    const feld = el.dataset.katFeld;
    if (feld === 'fix') k.fix = el.checked;
    else if (feld === 'name') { if (!el.value.trim()) { el.value = k.name; return; } k.name = el.value.trim(); }
    else k[feld] = el.value;
    await speichern('kategorien', k);
    toast('Gespeichert ✓');
  }
});

// Zurück-Taste bei offenem Formular → Formular schließen statt App verlassen
window.addEventListener('popstate', () => formSchliessen(true));

async function start() {
  try {
    db = await dbOeffnen();
    await allesLaden();
    if (daten.kategorien.length === 0) await startdatenAnlegen(); // allererster Start
    render();
  } catch (err) {
    document.getElementById('inhalt').innerHTML =
      `<div class="leer">Fehler beim Laden der Daten:<br>${esc(err.message)}</div>`;
    return;
  }
  // Offline-Funktion aktivieren
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  // Den Browser bitten, die Daten nicht automatisch zu löschen, wenn der Speicher knapp wird
  if (navigator.storage?.persist) navigator.storage.persist();
}

start();
