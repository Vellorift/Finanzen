/* Texterkennung (OCR) für den Screenshot-Import.
   Läuft im Hintergrund ("Worker"), damit die App dabei nicht hängt.
   Alles passiert auf dem Gerät – das Bild wird nirgendwohin geschickt.

   Benutzt Tesseract (Open Source, Apache-2.0-Lizenz, siehe LIZENZ-Tesseract.txt):
   - tesseract-core-simd-lstm.js / .wasm = die eigentliche Erkennung
   - deu.traineddata = deutsche Sprachdaten (Variante "fast")
   Die Dateien werden erst beim ersten Import geladen und danach offline gespeichert. */

importScripts('tesseract-core-simd-lstm.js');

let modul = null;   // das geladene Tesseract-Programm
let api = null;     // die Tesseract-Schnittstelle

async function vorbereiten() {
  if (api) return;
  postMessage({ status: 'Texterkennung wird geladen …' });
  modul = await TesseractCore({});
  const antwort = await fetch('deu.traineddata');
  if (!antwort.ok) throw new Error('Sprachdaten konnten nicht geladen werden');
  modul.FS.writeFile('./deu.traineddata', new Uint8Array(await antwort.arrayBuffer()));
  api = new modul.TessBaseAPI();
  // 1 = nur das moderne LSTM-Verfahren (genauer)
  if (api.Init(null, 'deu', 1) !== 0) throw new Error('Texterkennung konnte nicht starten');
  // 4 = "eine Spalte mit Zeilen unterschiedlicher Größe" – passt gut zu Banking-Apps
  api.SetVariable('tessedit_pageseg_mode', '4');
  api.SetVariable('user_defined_dpi', '300');
}

// Nachricht von der App: { id, bild } (bild = PNG als Bytes)
// Antwort: { id, tsv } – TSV = Tabelle mit jedem Wort und seiner Position
onmessage = async (e) => {
  const { id, bild } = e.data;
  try {
    await vorbereiten();
    postMessage({ status: 'Text wird gelesen …' });
    modul.FS.writeFile('/input', bild);
    if (api.SetImageFile(1, 0) === 1) throw new Error('Bild konnte nicht gelesen werden');
    api.Recognize(null);
    const tsv = api.GetTSVText(0);
    postMessage({ id, tsv });
  } catch (err) {
    postMessage({ id, fehler: String(err?.message || err) });
  }
};
