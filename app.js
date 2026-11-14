'use strict';
/* =====================================================================
   Meine Finanzen – Version 1
   ---------------------------------------------------------------------
   Aufbau dieser Datei:
     1. Hilfsfunktionen (Geld, Datum, Text)
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

const APP_VERSION = '1.0.0';

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
const DB_VERSION = 1;
const TABELLEN = ['buchungen', 'kategorien', 'vorlagen', 'einstellungen'];
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
const daten = { buchungen: [], kategorien: [], vorlagen: [], einst: {} };

async function allesLaden() {
  daten.buchungen = await dbAlle('buchungen');
  daten.kategorien = await dbAlle('kategorien');
  daten.vorlagen = await dbAlle('vorlagen');
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

// Fixkosten-Vorlagen, die im Monat noch nicht eingetragen sind
const fehlendeVorlagen = (m) => daten.vorlagen.filter(
  (v) => !daten.buchungen.some((b) => b.vorlageId === v.id && b.datum.startsWith(m)));

async function vorlagenUebernehmen(m) {
  const [j, mo] = m.split('-').map(Number);
  const tageImMonat = new Date(j, mo, 0).getDate();
  const liste = fehlendeVorlagen(m);
  for (const v of liste) {
    const tag = Math.min(v.tag || 1, tageImMonat);
    await speichern('buchungen', {
      id: neueId(), datum: `${m}-${String(tag).padStart(2, '0')}`, betrag: v.betrag,
      art: 'ausgabe', kategorieId: v.kategorieId, notiz: v.name, vorlageId: v.id,
    });
  }
  toast(`${liste.length} Fixkosten eingetragen ✓`);
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
    const summe = fehlend.reduce((s, v) => s + v.betrag, 0);
    h += `<button class="hinweis" data-action="vorlagen-uebernehmen">📌 ${fehlend.length} Fixkosten für ${monatName(aktMonat)} eintragen (${euro(summe)})</button>`;
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

  const katOptionen = kategorienVon('ausgabe').map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('');

  return `
  <section class="karte"><h2>💰 Puffer & Sparziel</h2>
    <label class="feld"><span>Aktueller Stand Notgroschen-Konto (€)</span>${euroFeld('puffer', e.puffer)}</label>
    <label class="feld"><span>Name des Sparziels</span><input type="text" data-einst="zielName" value="${esc(e.zielName)}"></label>
    <label class="feld"><span>Zielbetrag (€)</span>${euroFeld('zielBetrag', e.zielBetrag)}</label>
    <label class="check"><input type="checkbox" data-einst="zielGleichPuffer" ${e.zielGleichPuffer ? 'checked' : ''}>Fortschritt = Puffer-Stand</label>
    ${e.zielGleichPuffer ? '' : `<label class="feld"><span>Bisher gespart für dieses Ziel (€)</span>${euroFeld('zielStand', e.zielStand)}</label>`}
    <div class="klein grau">Tipp: Ein Notgroschen von 3–6 Monatsausgaben gilt als solide.</div>
  </section>

  <section class="karte"><h2>📌 Fixkosten-Vorlagen</h2>
    <div class="klein grau" style="margin-bottom:10px">Vorlagen trägst du jeden Monat mit einem Tipp in der Übersicht ein.</div>
    ${daten.vorlagen.length ? daten.vorlagen.map((v) => `
      <div class="katedit">
        <span class="punkt" style="background:${esc(kat(v.kategorieId)?.farbe || '#666')}"></span>
        <span style="flex:1">${esc(v.name)}<br><span class="klein grau">${euro(v.betrag)} · am ${v.tag}. · ${esc(kat(v.kategorieId)?.name || '?')}</span></span>
        <button class="x" data-action="vorlage-loeschen" data-id="${v.id}" aria-label="Vorlage löschen">✕</button>
      </div>`).join('') : '<div class="klein grau">Noch keine Vorlagen.</div>'}
    <div class="unter">Neue Vorlage</div>
    <label class="feld"><span>Name (z. B. Miete, Leasing, Spotify)</span><input type="text" id="v-name"></label>
    <div class="zwei">
      <label class="feld"><span>Betrag (€)</span><input type="text" inputmode="decimal" id="v-betrag"></label>
      <label class="feld"><span>Tag im Monat</span><input type="number" min="1" max="31" id="v-tag" value="1"></label>
    </div>
    <label class="feld"><span>Kategorie</span><select id="v-kat">${katOptionen}</select></label>
    <button class="knopf" data-action="vorlage-neu">Vorlage hinzufügen</button>
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
    ${form.id ? '' : `<label class="check" id="f-wiederkehrend-zeile"><input type="checkbox" id="f-wiederkehrend">Jeden Monat (als Fixkosten-Vorlage merken)</label>`}
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
  const w = document.getElementById('f-wiederkehrend-zeile');
  if (w) w.hidden = art !== 'ausgabe';
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

  // Häkchen "Jeden Monat" → zusätzlich eine Fixkosten-Vorlage anlegen
  const wiederkehrend = document.getElementById('f-wiederkehrend');
  if (!form.id && form.art === 'ausgabe' && wiederkehrend?.checked) {
    const v = { id: neueId(), name: notiz || kat(b.kategorieId).name, betrag,
      kategorieId: b.kategorieId, tag: Number(datum.slice(8, 10)) };
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

function backupDatei() {
  const paket = {
    app: 'meine-finanzen', format: 1, appVersion: APP_VERSION,
    exportiertAm: new Date().toISOString(),
    buchungen: daten.buchungen, kategorien: daten.kategorien,
    vorlagen: daten.vorlagen, einstellungen: daten.einst,
  };
  const json = JSON.stringify(paket, null, 2);
  return new File([json], `finanzen-backup-${heute()}.json`, { type: 'application/json' });
}

async function backupErledigt() {
  daten.einst.letztesBackup = new Date().toISOString();
  await einstSpeichern();
  render();
}

async function exportieren() {
  const datei = backupDatei();
  const url = URL.createObjectURL(datei);
  const a = document.createElement('a');
  a.href = url; a.download = datei.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  await backupErledigt();
  toast('Backup gespeichert (Ordner „Downloads“)');
}

// Über das Android-Teilen-Menü direkt an Google Drive, Mail usw. schicken
async function teilen() {
  const datei = backupDatei();
  if (!navigator.canShare || !navigator.canShare({ files: [datei] })) {
    return toast('Teilen geht hier nicht – nimm „Backup herunterladen“');
  }
  try {
    await navigator.share({ files: [datei], title: 'Finanzen-Backup' });
    await backupErledigt();
  } catch (err) {
    if (err.name !== 'AbortError') toast('Teilen fehlgeschlagen');
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

    // Fixkosten
    case 'vorlagen-uebernehmen': await vorlagenUebernehmen(aktMonat); render(); break;
    case 'vorlage-neu': {
      const name = document.getElementById('v-name').value.trim();
      const betrag = centAusText(document.getElementById('v-betrag').value);
      const tag = Math.min(Math.max(Number(document.getElementById('v-tag').value) || 1, 1), 31);
      const kategorieId = document.getElementById('v-kat').value;
      if (!name || !betrag || betrag <= 0) return toast('Bitte Name und Betrag eingeben');
      await speichern('vorlagen', { id: neueId(), name, betrag, tag, kategorieId });
      render(); toast('Vorlage gespeichert ✓');
      break;
    }
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
