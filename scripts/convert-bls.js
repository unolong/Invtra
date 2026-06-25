/**
 * Konvertiert BLS_4_0_Daten_2025_DE.xlsx → assets/data/bls.json
 * Ausführen: node scripts/convert-bls.js
 */
const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

const INPUT  = path.join(__dirname, '..', 'BLS_4_0_2025_DE', 'BLS_4_0_Daten_2025_DE.xlsx');
const OUTPUT = path.join(__dirname, '..', 'assets', 'data', 'bls.json');

// Column indices (0-based) in the BLS Excel file
const COL = {
  id:              0,
  name:            1,
  kcal:            6,
  protein:        12,
  fat:            15,
  carbs:          18,
  fiber:          21,
  salt:          120,   // NaCl [g/100g]
  sugar:         219,   // Mono- und Disaccharide gesamt
  saturatedFat:  246,   // Fettsäuren gesättigt gesamt
};

const CATEGORY_MAP = {
  B: 'Brot & Backwaren',
  C: 'Getreide',
  D: 'Feine Backwaren',
  E: 'Teigwaren',
  F: 'Obst',
  G: 'Gemüse',
  H: 'Hülsenfrüchte',
  K: 'Kartoffeln & Stärke',
  M: 'Milch & Käse',
  N: 'Getränke',
  P: 'Alkohol',
  Q: 'Öle & Fette',
  R: 'Gewürze & Salz',
  S: 'Süßigkeiten',
  T: 'Fisch',
  U: 'Schweinefleisch',
  V: 'Wild & Geflügel',
  W: 'Wurst & Aufschnitt',
  X: 'Suppen & Brühen',
  Y: 'Suppen & Brühen',
};

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

console.log('Lese Excel-Datei...');
const wb   = XLSX.readFile(INPUT);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

const items = [];
for (let i = 1; i < rows.length; i++) {
  const r    = rows[i];
  const id   = String(r[COL.id] ?? '').trim();
  const name = String(r[COL.name] ?? '').trim();

  if (!id || !name || id === 'BLS Code') continue;

  const firstLetter = id[0].toUpperCase();
  items.push({
    id,
    name,
    kategorie: CATEGORY_MAP[firstLetter] ?? 'Sonstiges',
    pro100g: {
      kalorien:             num(r[COL.kcal]),
      protein:              num(r[COL.protein]),
      kohlenhydrate:        num(r[COL.carbs]),
      fett:                 num(r[COL.fat]),
      ballaststoffe:        num(r[COL.fiber]),
      zucker:               num(r[COL.sugar]),
      salz:                 num(r[COL.salt]),
      gesaettigteFettsaeuren: num(r[COL.saturatedFat]),
    },
  });
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(items), 'utf8');

console.log(`Fertig: ${items.length} Einträge → ${OUTPUT}`);
console.log(`Dateigröße: ${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KB`);
