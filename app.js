'use strict';
/* Wandel – Transformations-Tracker. Alle Daten liegen lokal in IndexedDB auf dem Gerät.
   Datenbank-Regel: Stores werden nur hinzugefügt, nie gelöscht. Jede neue Schema-Version bekommt
   einen eigenen Block in onupgradeneeded, damit bestehende Daten erhalten bleiben. */

const DB_NAME = 'wandel';
const DB_VER = 2;
const STORES = {
  kv: 'key', weights: 'date', measures: 'date', nutrition: 'date', habitLog: 'date',
  habits: 'id', equipment: 'id', exercises: 'id', templates: 'id', workouts: 'id',
  photos: 'id' // ab Version 2
};
const S = {};
let db;

/* ---------- Datenbank ---------- */
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = t => new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      // Version 1 + 2: fehlende Stores anlegen, vorhandene nie anfassen.
      for (const [s, k] of Object.entries(STORES)) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: k });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => toast('Bitte andere offene Fenster der App schließen.');
  });
}
async function loadAll() {
  for (const s of Object.keys(STORES)) {
    const rows = await reqP(db.transaction(s).objectStore(s).getAll());
    S[s] = new Map(rows.map(o => [o[STORES[s]], o]));
  }
}
async function put(s, obj) {
  S[s].set(obj[STORES[s]], obj);
  const t = db.transaction(s, 'readwrite'); t.objectStore(s).put(obj);
  try { await txDone(t); } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message); throw e; }
}
async function del(s, key) {
  S[s].delete(key);
  const t = db.transaction(s, 'readwrite'); t.objectStore(s).delete(key);
  await txDone(t);
}
const all = s => [...S[s].values()];
const kv = (k, def) => S.kv.has(k) ? S.kv.get(k).value : def;
const setKv = (k, value) => put('kv', { key: k, value });

/* ---------- Helfer ---------- */
const $ = sel => document.querySelector(sel);
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 10); };
const today = () => iso(new Date());
const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
const dayDiff = (a, b) => dayNum(b) - dayNum(a);
const addDays = (s, n) => new Date((dayNum(s) + n) * 864e5).toISOString().slice(0, 10);
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const wday = s => WD[new Date(dayNum(s) * 864e5).getUTCDay()];
const dshort = s => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.` : '';
const dlong = s => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '';
const MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const dmonth = s => `${MONTHS[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
const num = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const fmt = (n, d = 1) => n == null || !isFinite(n) ? '–' : (+n).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtF = (n, d = 1) => n == null || !isFinite(n) ? '–' : (+n).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round10 = n => Math.round(n / 10) * 10;
const round5 = n => Math.round(n / 5) * 5;
const byDate = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
const sign = n => n > 0 ? '+' : '';
function slope(pts) { // pts: [{x,y}] → Steigung
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let sxy = 0, sxx = 0;
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; }
  return sxx ? sxy / sxx : 0;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- Profil, Ernährung & Berechnungen ---------- */
const DEFAULT_PROFILE = { height: 180, age: 30, sex: 'm', start: 121, goal: 85, startDate: null };
const prof = () => ({ ...DEFAULT_PROFILE, ...kv('profile', {}) });
const dietCfg = () => kv('diet', null);
const dietPlan = () => DIET_PLANS.find(d => d.id === dietCfg()?.id) || null;
let cur = today(); // gewählter Tag in der Tagesansicht

function trendSeries() {
  const ws = all('weights').sort(byDate);
  let t = null, prev = null;
  return ws.map(w => {
    if (t == null) t = w.kg;
    else { const d = Math.max(1, dayDiff(prev, w.date)); t = t + (1 - Math.pow(0.9, d)) * (w.kg - t); }
    prev = w.date;
    return { date: w.date, kg: w.kg, fat: w.fat, trend: t };
  });
}
function currentWeight() { const s = trendSeries(); return s.length ? s[s.length - 1].trend : prof().start; }
function trendAt(date) { const s = trendSeries().filter(p => p.date <= date); return s.length ? s[s.length - 1].trend : null; }
function weeklyRate() {
  const ws = all('weights').sort(byDate);
  if (ws.length < 4) return null;
  const last = ws[ws.length - 1].date;
  const pts = ws.filter(w => dayDiff(w.date, last) <= 21);
  if (pts.length < 4 || dayDiff(pts[0].date, last) < 7) return null;
  const kgWeek = slope(pts.map(p => ({ x: dayDiff(pts[0].date, p.date), y: p.kg }))) * 7;
  return { kgWeek, pct: kgWeek / currentWeight() * 100, early: dayDiff(ws[0].date, last) < 14 };
}
function rateStatus(r) {
  if (!r) return { cls: 'c-acc', text: 'Noch zu wenig Daten', tip: 'Wiege dich möglichst täglich morgens nach der Toilette. Ab etwa einer Woche zeigt die App dein Tempo.' };
  const loss = -r.pct;
  if (r.early && loss > 1) return { cls: 'c-acc', text: 'Startphase', tip: 'In den ersten zwei Wochen verlierst du viel Wasser und Glykogen. Das schnelle Tempo ist normal.' };
  if (loss > 1.5) return { cls: 'c-bad', text: 'Deutlich zu schnell', tip: 'Iss etwa 250–300 kcal mehr pro Tag. Zu schnelles Abnehmen kostet Muskeln und belastet die Haut.' };
  if (loss > 1.0) return { cls: 'c-warn', text: 'Etwas zu schnell', tip: 'Iss etwa 150–200 kcal mehr pro Tag, um im hautschonenden Korridor von 0,5–1 % zu bleiben.' };
  if (loss >= 0.5) return { cls: 'c-go', text: 'Im Korridor', tip: 'Perfektes Tempo: 0,5–1 % deines Gewichts pro Woche. Genau so weitermachen.' };
  if (loss >= 0.25) return { cls: 'c-acc', text: 'Gemächlich', tip: 'Etwas langsamer als geplant. Völlig in Ordnung, wenn du dich gut fühlst. Sonst 100–150 kcal weniger.' };
  if (loss > -0.1) return { cls: 'c-warn', text: 'Stillstand', tip: 'Prüfe zuerst das Tracking (Öl, Soßen, Getränke). Hält das zwei Wochen an: 100–150 kcal weniger.' };
  return { cls: 'c-warn', text: 'Gewicht steigt', tip: 'Kurzfristig oft Wasser (Salz, Training, Stress). Hält es länger als 10 Tage an, Kalorien prüfen.' };
}
const bmi = w => w / (prof().height / 100) ** 2;
const bmiClass = b => b < 18.5 ? 'Untergewicht' : b < 25 ? 'Normalgewicht' : b < 30 ? 'Übergewicht' : b < 35 ? 'Adipositas Grad 1' : b < 40 ? 'Adipositas Grad 2' : 'Adipositas Grad 3';
function mifflin(w) { const p = prof(); return 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'w' ? -161 : 5); }
function phaseKcal(w) { return w > 110 ? 2200 : w > 100 ? 2100 : w > 92 ? 2050 : 2000; }
const planPct = w => w > 100 ? 0.007 : w > 92 ? 0.006 : 0.005;
function adaptiveTdee() {
  const end = today(), start = addDays(end, -28);
  const nut = all('nutrition').filter(n => n.date > start && n.date <= end && n.kcal);
  const ws = all('weights').filter(p => p.date > start && p.date <= end).sort(byDate);
  if (nut.length < 14 || ws.length < 6 || dayDiff(ws[0].date, ws[ws.length - 1].date) < 14) return null;
  const avg = nut.reduce((a, n) => a + n.kcal, 0) / nut.length;
  const perDay = slope(ws.map(p => ({ x: dayDiff(ws[0].date, p.date), y: p.kg })));
  return { tdee: avg - perDay * 7700, days: nut.length, avg };
}
function targets() {
  const p = prof(), w = currentWeight(), ad = adaptiveTdee(), man = kv('targets.manual', {});
  let pMin = round5(p.goal * 1.9), pMax = round5(p.goal * 2.1);
  let kcal, src, deficit;
  if (w <= p.goal) { kcal = round10(ad ? ad.tdee : mifflin(w) * 1.45); src = 'Ziel erreicht: Erhaltung'; }
  else {
    deficit = w * planPct(w) * 7700 / 7;
    const floor = p.sex === 'w' ? 1500 : 1800;
    if (ad) { kcal = round10(clamp(ad.tdee - deficit, Math.max(floor, phaseKcal(w) - 300), 3500)); src = `Aus deinen Daten (${ad.days} Tage)`; }
    else { kcal = phaseKcal(w); src = 'Startwert laut Phasenplan'; }
  }
  if (man.kcal) { kcal = man.kcal; src = 'Von dir festgelegt'; }
  if (man.protein) { pMin = man.protein; pMax = man.protein + 20; }
  return { kcal, src, pMin, pMax, ad, deficit, ...macros(kcal, pMin) };
}
function macros(kcal, prot) {
  const m = dietPlan()?.macro || { fatPct: [25, 35] }, p = prof();
  const rest = kcal - prot * 4;
  let fat, carb;
  if (m.carbMax != null) {
    carb = [m.carbMin, m.carbMax];
    fat = [Math.max(0, Math.round((rest - m.carbMax * 4) / 9)), Math.round((rest - m.carbMin * 4) / 9)];
  } else {
    fat = [kcal * m.fatPct[0] / 900, kcal * m.fatPct[1] / 900];
    const minF = p.goal * (m.fatMinPerKg || 0.7);
    fat = [Math.round(Math.max(fat[0], minF)), Math.round(Math.max(fat[1], minF))];
    carb = [Math.max(0, Math.round((rest - fat[1] * 9) / 4)), Math.max(0, Math.round((rest - fat[0] * 9) / 4))];
  }
  return { fat, carb };
}
function navyBF(m) {
  const { sex, height } = prof();
  if (!m || !m.waist || !m.neck) return null;
  if (sex === 'w') { if (!m.hip) return null; return 495 / (1.29579 - 0.35004 * Math.log10(m.waist + m.hip - m.neck) + 0.22100 * Math.log10(height)) - 450; }
  if (m.waist - m.neck <= 0) return null;
  return 495 / (1.0324 - 0.19077 * Math.log10(m.waist - m.neck) + 0.15456 * Math.log10(height)) - 450;
}
function bodyFatSeries() { // Maßband bevorzugt, sonst Waage
  const nav = all('measures').sort(byDate).map(m => ({ d: m.date, y: navyBF(m) })).filter(p => p.y != null);
  return nav.length ? nav : all('weights').filter(w => w.fat).sort(byDate).map(w => ({ d: w.date, y: w.fat }));
}
function projection(mode) {
  const p = prof(), r = weeklyRate();
  let w = currentWeight();
  const lastW = trendSeries().slice(-1)[0];
  let d = lastW ? lastW.date : today();
  if (w <= p.goal) return { pts: [], reached: true };
  let pct;
  if (mode === 'ist') { if (!r || -r.pct < 0.05) return { pts: [], noRate: true }; pct = () => clamp(-r.pct, 0.1, 1.5) / 100; }
  else pct = planPct;
  const pts = [{ d, y: w }];
  for (let i = 0; i < 520 && w > p.goal; i++) { w = Math.max(p.goal, w * (1 - pct(w))); d = addDays(d, 7); pts.push({ d, y: w }); }
  return { pts };
}
function milestones(pts) {
  if (pts.length < 2) return [];
  const p = prof(), start = pts[0].y, out = [];
  const marks = [];
  for (let m = Math.floor((start - 0.01) / 5) * 5; m > p.goal; m -= 5) marks.push(m);
  marks.push(p.goal);
  for (const m of marks) {
    for (let i = 1; i < pts.length; i++) if (pts[i].y <= m + 1e-6) {
      const a = pts[i - 1], b = pts[i], f = (a.y - m) / (a.y - b.y || 1);
      out.push({ kg: m, d: addDays(a.d, Math.round(7 * f)) }); break;
    }
  }
  return out;
}

/* ---------- Training-Logik ---------- */
/* Eine Übung ist zugleich das Gerät: Name, Foto, Einstellung, Gewichtsart. */
const EQ_TYPES = { lh: ['Langhantel', 2.5], kh: ['Kurzhanteln', 2], kabel: ['Kabelzug', 2.5], maschine: ['Maschine', 5], multi: ['Multipresse', 2.5], kb: ['Kettlebell', 4], koerper: ['Körpergewicht', 0], sonst: ['Sonstiges', 2.5] }; // nur für alte Daten
const UNITS = { kg: ['Gewicht in kg', 2.5], stufe: ['Stufe am Gerät', 1], none: ['Ohne Gewicht', 0] };
const MUSCLES = ['Brust', 'Rücken', 'Schultern', 'Bizeps', 'Trizeps', 'Oberschenkel vorne', 'Oberschenkel hinten', 'Po', 'Waden', 'Bauch', 'Ganzkörper'];
const EX_SUGGEST = ['Bankdrücken', 'Schrägbankdrücken', 'Kurzhantel-Bankdrücken', 'Brustpresse', 'Butterfly', 'Kabelzug-Crossover', 'Liegestütze',
  'Latziehen', 'Latpumpe', 'Klimmzüge', 'Rudern', 'Rudern am Kabel', 'Langhantelrudern', 'Kurzhantelrudern einarmig', 'Face Pulls',
  'Schulterdrücken', 'Schulterpresse', 'Seitheben', 'Seitheben am Kabel', 'Reverse Butterfly',
  'Bizepscurls', 'Hammercurls', 'Bizepscurls am Kabel', 'Trizeps am Kabelzug', 'French Press', 'Dips',
  'Kniebeuge', 'Goblet Squat', 'Beinpresse', 'Beinstrecker', 'Beinbeuger liegend', 'Beinbeuger sitzend', 'Rumänisches Kreuzheben', 'Hip Thrust',
  'Ausfallschritte', 'Abduktoren', 'Adduktoren', 'Wadenheben', 'Crunches am Kabel', 'Plank', 'Rückenstrecker'];
const WARM_SUGGEST = ['Fahrrad-Ergometer', 'Rudergerät', 'Crosstrainer', 'Armkreisen', 'Schulterkreisen', 'Band Pull-Aparts', 'Hampelmänner', 'Hüftkreisen', 'Leichter Satz der ersten Übung', 'Mobilisation Brustwirbelsäule'];

const exName = id => S.exercises.get(id)?.name ?? 'Gelöschte Übung';
const exUnit = ex => ex?.unit || 'kg';
function incFor(ex) {
  if (ex.step != null && ex.step !== '') return +ex.step;
  if (ex.inc != null && ex.inc !== '') return +ex.inc; // alte Daten
  const eq = S.equipment.get(ex.equipmentId);
  if (eq) return eq.inc != null ? +eq.inc : (EQ_TYPES[eq.type]?.[1] ?? 2.5);
  return UNITS[exUnit(ex)][1];
}
function fmtLoad(v, ex) {
  const u = exUnit(ex), n = num(v);
  if (u === 'none') return 'ohne Gewicht';
  if (n == null) return '–';
  return u === 'stufe' ? `Stufe ${fmt(n, 1)}` : `${fmt(n, 2)} kg`;
}
const unitShort = ex => ({ kg: 'kg', stufe: 'Stufe', none: '' })[exUnit(ex)];
function fmtSet(s, ex) {
  const u = exUnit(ex);
  if (u === 'none') return `${s.reps}`;
  return `${u === 'stufe' ? 'St.' : ''}${fmt(num(s.kg) ?? 0, 2)}×${s.reps}`;
}
const wSort = (a, b) => b.date.localeCompare(a.date) || (b.finished || '').localeCompare(a.finished || '');
function exHistory(exId, excludeId) { // älteste zuerst
  return all('workouts').filter(w => w.id !== excludeId).sort((a, b) => wSort(b, a)).map(w => {
    const sets = w.entries.filter(e => e.exerciseId === exId).flatMap(e => e.sets.filter(s => s.done));
    return sets.length ? { date: w.date, sets, wid: w.id } : null;
  }).filter(Boolean);
}
function lastPerf(exId, excludeId) { const hst = exHistory(exId, excludeId); return hst[hst.length - 1] || null; }
function topLoad(ex, sets) { // Kennzahl einer Einheit: höchstes Gewicht bzw. meiste Wdh. ohne Gewicht
  if (!sets.length) return null;
  return exUnit(ex) === 'none' ? Math.max(...sets.map(s => num(s.reps) || 0)) : Math.max(...sets.map(s => num(s.kg) || 0));
}
function repsAtTop(ex, sets) { const t = topLoad(ex, sets); if (exUnit(ex) === 'none') return t; return Math.max(...sets.filter(s => (num(s.kg) || 0) === t).map(s => num(s.reps) || 0)); }
function suggest(ex, excludeId) {
  const lp = lastPerf(ex.id, excludeId), inc = incFor(ex), u = exUnit(ex);
  if (!lp) return { kg: '', reps: ex.repMax, first: true, text: u === 'none' ? 'Erstes Mal: so viele saubere Wiederholungen, dass noch 2–3 gehen würden.' : `Erstes Mal: ${u === 'stufe' ? 'Stufe' : 'Gewicht'} wählen, mit der du ${ex.repMin}–${ex.repMax} saubere Wiederholungen schaffst und noch 2–3 gehen würden.` };
  const last = `Letztes Mal (${dshort(lp.date)}): ${lp.sets.map(s => fmtSet(s, ex)).join(' · ')}`;
  if (u === 'none') {
    const best = Math.max(...lp.sets.map(s => num(s.reps) || 0));
    return { kg: '', reps: best + 1, last, text: best >= ex.repMax ? `Über ${ex.repMax} Wdh.: Nimm leichte Hanteln dazu (Gewichtsart auf kg stellen). Das baut schneller Muskeln auf.` : 'Ziel: pro Satz eine Wiederholung mehr.' };
  }
  const kg = topLoad(ex, lp.sets);
  const top = lp.sets.filter(s => (num(s.kg) ?? 0) === kg);
  const minReps = Math.min(...top.map(s => num(s.reps) ?? 0));
  if (top.length >= Math.min(ex.sets, lp.sets.length) && minReps >= ex.repMax) {
    const jump = inc > 0 ? (minReps >= ex.repMax + 4 ? inc * 2 : inc) : 0;
    if (!jump) return { kg, reps: ex.repMax, last, text: 'Oberes Ende erreicht: schwierigere Variante wählen.' };
    return { kg: kg + jump, reps: ex.repMin, last, up: true, text: `Alle Sätze bei ${ex.repMax}+ Wdh.: steigere auf ${fmtLoad(kg + jump, ex)}${jump > inc ? ' (doppelter Sprung, du warst weit über der Spanne)' : ''}.` };
  }
  if (Math.max(...top.map(s => num(s.reps) ?? 0)) < ex.repMin) return { kg, reps: ex.repMin, last, text: `Unter ${ex.repMin} Wdh.: Bleib bei ${fmtLoad(kg, ex)}. Schaffst du wieder keine ${ex.repMin}, geh einen Schritt leichter.` };
  return { kg, reps: Math.min(ex.repMax, minReps + 1), last, text: `Bleib bei ${fmtLoad(kg, ex)} und schaffe pro Satz eine Wiederholung mehr (Ziel ${ex.repMax}).` };
}
const e1rm = (kg, reps) => kg * (1 + reps / 30);
function nextTemplate() {
  const ts = all('templates').sort((a, b) => a.order - b.order);
  if (!ts.length) return null;
  const last = all('workouts').filter(w => w.templateId).sort(wSort)[0];
  if (!last) return ts[0];
  const i = ts.findIndex(t => t.id === last.templateId);
  return ts[(i + 1) % ts.length];
}
const weekStart = d => addDays(d, -((new Date(dayNum(d) * 864e5).getUTCDay() + 6) % 7));
const workoutSets = w => w.entries.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
const workoutVol = w => w.entries.reduce((a, e) => { const ex = S.exercises.get(e.exerciseId); if (exUnit(ex) !== 'kg') return a; return a + e.sets.filter(s => s.done).reduce((b, s) => b + (num(s.kg) || 0) * (num(s.reps) || 0), 0); }, 0);
function makeEntry(ex) { // vorausgefüllt wie beim letzten Mal; ohne Verlauf mit dem Startvorschlag
  const lp = lastPerf(ex.id);
  if (lp) { // übersprungene Sätze vom letzten Mal mit den letzten Werten auf die geplante Satzzahl auffüllen
    const sets = lp.sets.map(s => ({ kg: s.kg ?? '', reps: String(s.reps ?? ''), rir: '', done: false }));
    while (sets.length < (+ex.sets || 3)) sets.push({ ...sets[sets.length - 1] });
    return { exerciseId: ex.id, sets };
  }
  const sg = suggest(ex);
  return { exerciseId: ex.id, sets: [...Array(+ex.sets || 3)].map(() => ({ kg: sg.kg === '' ? '' : String(sg.kg), reps: String(sg.reps), rir: '', done: false })) };
}
const exPhotoURLs = new Map();
function exPhoto(ex) {
  if (!ex?.photo) return null;
  const key = ex.id + ':' + (ex.photoAt || '');
  if (!exPhotoURLs.has(key)) exPhotoURLs.set(key, URL.createObjectURL(ex.photo));
  return exPhotoURLs.get(key);
}
async function migrateV3() { // Geräte in Übungen überführen, Pläne um Aufwärmphase erweitern
  if (kv('migr.v3', false)) return;
  for (const ex of all('exercises')) {
    if (ex.unit) continue;
    const eq = S.equipment.get(ex.equipmentId);
    await put('exercises', { ...ex, unit: eq?.type === 'koerper' ? 'none' : 'kg', step: incFor(ex), note: [eq?.name, eq?.note, ex.note].filter(Boolean).join(' · '), rest: ex.rest || 90 });
  }
  for (const t of all('templates')) if (!t.warmup) await put('templates', { ...t, warmup: [] });
  await setKv('migr.v3', true);
}

/* ---------- Tagesziele & Gewohnheiten ---------- */
const activeHabits = () => all('habits').filter(x => x.active !== false).sort((a, b) => a.order - b.order);
function dayGoals(d, t = targets()) {
  const n = S.nutrition.get(d), log = S.habitLog.get(d)?.done || {}, hs = activeHabits();
  const g = [];
  if (n?.protein != null) g.push(n.protein >= t.pMin);
  if (n?.kcal != null) g.push(n.kcal <= t.kcal * 1.05);
  if (hs.length && S.habitLog.has(d)) g.push(hs.every(x => log[x.id]));
  if (S.weights.has(d)) g.push(true);
  return g.length ? g.filter(Boolean).length / g.length * 100 : null;
}
function habitRate(d) {
  const hs = activeHabits(); if (!hs.length || !S.habitLog.has(d)) return null;
  const log = S.habitLog.get(d).done || {};
  return hs.filter(x => log[x.id]).length / hs.length * 100;
}

/* ---------- Diagramme ---------- */
function rolling(pts, days = 7) {
  return pts.map((p, i) => {
    const win = pts.filter((q, j) => j <= i && dayDiff(q.d, p.d) < days);
    return { d: p.d, y: win.reduce((a, q) => a + q.y, 0) / win.length };
  });
}
function chart(series, opts = {}) {
  const pts = series.flatMap(s => s.pts);
  if (pts.length < 2) return `<p class="empty small">${opts.empty || 'Ab zwei Einträgen erscheint hier der Verlauf.'}</p>`;
  const W = 340, H = opts.h || 160, pl = 36, pr = 10, pt = 10, pb = 22;
  const dates = pts.map(p => p.d).sort();
  const d0 = opts.d0 && opts.d0 < dates[0] ? opts.d0 : dates[0], d1 = dates[dates.length - 1], span = Math.max(1, dayDiff(d0, d1));
  const ys = pts.map(p => p.y).concat(opts.goal != null ? [opts.goal] : []);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = Math.max(opts.minPad ?? 0.5, (y1 - y0) * 0.12); y0 -= pad; y1 += pad;
  if (opts.zero && y0 < 0) y0 = 0;
  const X = d => pl + (W - pl - pr) * dayDiff(d0, d) / span;
  const Y = y => pt + (H - pt - pb) * (1 - (y - y0) / (y1 - y0));
  const raw = (y1 - y0) / 3, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  let g = '';
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${pl - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fmt(v, step < 1 ? 1 : 0)}</text>`;
  g += `<text x="${pl}" y="${H - 6}">${dshort(d0)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">${dshort(d1)}</text>`;
  if (opts.goal != null) g += `<line class="goal" x1="${pl}" x2="${W - pr}" y1="${Y(opts.goal).toFixed(1)}" y2="${Y(opts.goal).toFixed(1)}"/>`;
  for (const s of series) {
    if (!s.pts.length) continue;
    if (s.cls === 'dots') g += s.pts.map(p => `<circle class="dot" cx="${X(p.d).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.4"/>`).join('');
    else {
      g += `<polyline class="${s.cls}" points="${s.pts.map(p => `${X(p.d).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}"/>`;
      if (s.cls === 'trend' || s.cls === 'line') { const e = s.pts[s.pts.length - 1]; g += `<circle class="end" cx="${X(e.d).toFixed(1)}" cy="${Y(e.y).toFixed(1)}" r="3.6"/>`; }
      if (s.cls === 'line' && s.pts.length < 25) g += s.pts.map(p => `<circle class="end sm" cx="${X(p.d).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.2"/>`).join('');
    }
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(opts.label || 'Verlauf')}">${g}</svg>`;
}
function overlayChart(list) {
  const pts = list.flatMap(s => s.pts);
  if (pts.length < 2) return '<p class="empty small">Zu wenig Daten im gewählten Zeitraum.</p>';
  const W = 340, H = 200, pl = 10, pr = 10, pt = 10, pb = 22;
  const dates = pts.map(p => p.d).sort(), d0 = dates[0], d1 = dates[dates.length - 1], span = Math.max(1, dayDiff(d0, d1));
  const X = d => pl + (W - pl - pr) * dayDiff(d0, d) / span;
  let g = [0.25, 0.5, 0.75].map(f => `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${pt + (H - pt - pb) * f}" y2="${pt + (H - pt - pb) * f}"/>`).join('');
  g += `<text x="${pl}" y="${H - 6}">${dshort(d0)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">${dshort(d1)}</text>`;
  list.forEach((s, i) => {
    if (s.pts.length < 2) return;
    const ys = s.pts.map(p => p.y), lo = Math.min(...ys), hi = Math.max(...ys), rng = hi - lo || 1;
    const Y = y => pt + (H - pt - pb) * (1 - (hi === lo ? 0.5 : (y - lo) / rng) * 0.9 - 0.05);
    g += `<polyline class="ov s${i % 6}" points="${s.pts.map(p => `${X(p.d).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Überlagerter Vergleich">${g}</svg>`;
}
function bar(v, max, min) {
  const p = max ? clamp(v / max * 100, 0, 100) : 0;
  return `<div class="bar${v > max ? ' over' : ''}"><i style="width:${p}%"></i>${min ? `<b style="left:${clamp(min / max * 100, 0, 100)}%"></b>` : ''}</div>`;
}

/* ---------- Metriken für die Statistik ---------- */
const MFIELDS = [['waist', 'Bauch'], ['hip', 'Hüfte'], ['chest', 'Brust'], ['arm', 'Oberarm'], ['thigh', 'Oberschenkel'], ['neck', 'Hals']];
function metricDefs() {
  const ts = trendSeries(), ms = all('measures').sort(byDate), t = targets();
  const nut = all('nutrition').sort(byDate);
  const days = [...new Set([...S.habitLog.keys(), ...S.nutrition.keys(), ...S.weights.keys()])].sort();
  const bf = bodyFatSeries();
  const comp = which => bf.map(p => { const w = trendAt(p.d) ?? currentWeight(); return { d: p.d, y: which === 'fat' ? w * p.y / 100 : w * (1 - p.y / 100) }; });
  const weeks = (() => {
    const wk = all('workouts'); if (!wk.length) return [];
    const out = []; let w = weekStart(wk.map(x => x.date).sort()[0]);
    while (w <= today()) { const e = addDays(w, 7); out.push({ d: w, y: wk.filter(x => x.date >= w && x.date < e).length }); w = e; }
    return out;
  })();
  const defs = [
    { id: 'weight', g: 'Körper', name: 'Gewicht', unit: 'kg', pts: ts.map(x => ({ d: x.date, y: x.trend })), dots: ts.map(x => ({ d: x.date, y: x.kg })), goal: prof().goal, digits: 1 },
    { id: 'bmi', g: 'Körper', name: 'BMI', unit: '', pts: ts.map(x => ({ d: x.date, y: bmi(x.trend) })), digits: 1 },
    { id: 'bf', g: 'Körper', name: 'Körperfett', unit: '%', pts: bf, digits: 1 },
    { id: 'fatMass', g: 'Körper', name: 'Fettmasse', unit: 'kg', pts: comp('fat'), digits: 1 },
    { id: 'leanMass', g: 'Körper', name: 'Fettfreie Masse', unit: 'kg', pts: comp('lean'), digits: 1 },
    ...MFIELDS.map(([k, l]) => ({ id: 'm_' + k, g: 'Umfänge', name: l, unit: 'cm', pts: ms.filter(m => m[k]).map(m => ({ d: m.date, y: m[k] })), digits: 1 })),
    { id: 'kcal', g: 'Ernährung', name: 'Kalorien', unit: 'kcal', dots: nut.filter(n => n.kcal).map(n => ({ d: n.date, y: n.kcal })), avg: true, goal: t.kcal, digits: 0 },
    { id: 'protein', g: 'Ernährung', name: 'Eiweiß', unit: 'g', dots: nut.filter(n => n.protein).map(n => ({ d: n.date, y: n.protein })), avg: true, goal: t.pMin, digits: 0 },
    { id: 'fat', g: 'Ernährung', name: 'Fett', unit: 'g', dots: nut.filter(n => n.fat).map(n => ({ d: n.date, y: n.fat })), avg: true, digits: 0 },
    { id: 'habits', g: 'Ziele', name: 'Gewohnheiten erfüllt', unit: '%', dots: days.map(d => ({ d, y: habitRate(d) })).filter(p => p.y != null), avg: true, digits: 0, zero: true },
    { id: 'goals', g: 'Ziele', name: 'Tagesziele erfüllt', unit: '%', dots: days.map(d => ({ d, y: dayGoals(d, t) })).filter(p => p.y != null), avg: true, digits: 0, zero: true },
    { id: 'trainWeek', g: 'Training', name: 'Trainings pro Woche', unit: '', pts: weeks, goal: 3, digits: 0, line: true, zero: true },
    { id: 'volume', g: 'Training', name: 'Trainingsvolumen', unit: 't', pts: all('workouts').sort(byDate).map(w => ({ d: w.date, y: workoutVol(w) / 1000 })), digits: 1, line: true, zero: true },
    ...all('exercises').sort((a, b) => a.name.localeCompare(b.name, 'de')).map(ex => ({
      id: 'ex_' + ex.id, g: 'Kraft', name: ex.name, unit: unitShort(ex) || 'Wdh.', digits: 1, line: true,
      pts: exHistory(ex.id).map(x => ({ d: x.date, y: topLoad(ex, x.sets) }))
    }))
  ];
  for (const m of defs) if (m.avg) m.pts = rolling(m.dots);
  return defs;
}

/* ---------- Ansichten ---------- */
const VIEWS = {};
const TITLES = { tag: 'Tag', training: 'Training', uebung: 'Übung', statistik: 'Statistik', fotos: 'Fotos', wissen: 'Wissen', setup: 'Einstellungen', beratung: 'Beratung' };
const TAB_OF = { training: 'tag', beratung: 'wissen', uebung: 'setup' };
const back = (href, label) => `<a class="back" href="${href}">‹ ${label}</a>`;
const lis = a => `<ul class="ul">${a.map(x => `<li>${h(x)}</li>`).join('')}</ul>`;

/* Tag */
VIEWS.tag = () => {
  const d = cur, isToday = d === today(), p = prof(), t = targets();
  const w = S.weights.get(d), n = S.nutrition.get(d) || {}, log = S.habitLog.get(d)?.done || {};
  const r = weeklyRate(), st = rateStatus(r), cw = currentWeight();
  const habits = activeHabits(), dp = dietPlan(), dc = dietCfg();
  const draft = kv('draft', null), nt = nextTemplate(), ts = all('templates').sort((a, b) => a.order - b.order);
  const wk = weekStart(d), weekCount = all('workouts').filter(x => x.date >= wk && x.date < addDays(wk, 7)).length;
  const dayWorkouts = all('workouts').filter(x => x.date === d);
  const lb = kv('lastBackup', null), hasData = S.weights.size + S.workouts.size + S.nutrition.size > 0;
  const needBackup = isToday && hasData && (!lb || dayDiff(lb, d) >= 7);
  const proj = projection('plan'), ms1 = milestones(proj.pts)[0];
  const meals = dc?.meals || 3, perMeal = round5(t.pMin / meals);
  const lastMeasure = all('measures').sort(byDate).slice(-1)[0];
  const measureDue = !lastMeasure || dayDiff(lastMeasure.date, today()) >= 14;
  const tips = dp?.tips || [];
  const tip = tips.length ? tips[dayNum(d) % tips.length] : null;
  return `
  <div class="daynav">
    <button class="icon" data-act="day" data-n="-1" aria-label="Vorheriger Tag">‹</button>
    <label class="dlabel"><span>${isToday ? 'Heute' : wday(d)}, ${dlong(d)}</span><input type="date" id="curDate" value="${d}" max="${today()}" aria-label="Tag wählen"></label>
    <button class="icon" data-act="day" data-n="1" aria-label="Nächster Tag" ${isToday ? 'disabled' : ''}>›</button>
  </div>
  ${!isToday ? `<div class="hint row between"><span>Du bearbeitest einen vergangenen Tag.</span><button class="ghost" data-act="dayToday">Zu heute</button></div>` : ''}
  ${!dc ? `<div class="card hero"><span class="label">Erster Schritt</span><h2>Finde deine Ernährungsform</h2><p class="small">8 kurze Fragen, danach bekommst du eine Empfehlung mit vollständigem Plan: Lebensmittel, Mahlzeiten, Supplements und Umgang mit Cheat Days.</p><a class="btn" href="#beratung">Beratung starten</a></div>` : ''}
  ${needBackup ? `<div class="card warnbox"><div class="row between"><div class="grow"><h2>Backup fällig</h2><p class="small muted">${lb ? `Letzte Sicherung am ${dlong(lb)}.` : 'Noch keine Sicherung.'} Dauert 10 Sekunden.</p></div><button data-act="backup">Sichern</button></div></div>` : ''}

  <div class="card">
    <div class="row between"><span class="label">Gewicht</span><span class="chip ${st.cls}">${st.text}</span></div>
    <div><div class="big">${fmtF(cw)} <span class="small muted">kg Trend</span></div>
    <p class="small muted">${p.start - cw > 0.05 ? `${fmt(p.start - cw)} kg seit Start · ` : ''}Ziel ${fmt(p.goal)} kg${r ? ` · ${fmt(r.kgWeek, 2)} kg/Woche` : ''}</p></div>
    <form data-form="weight" class="row">
      <input name="kg" inputmode="decimal" placeholder="Gewicht ${isToday ? 'heute' : 'an diesem Tag'} (kg)" value="${w ? fmt(w.kg, 2) : ''}" aria-label="Gewicht">
      <button>${w ? 'Ändern' : 'Speichern'}</button>
    </form>
    <p class="small muted">${h(st.tip)}${ms1 ? ` Nach Plan erreichst du <b>${fmt(ms1.kg)} kg</b> etwa am ${dlong(ms1.d)}.` : ''}</p>
  </div>

  <div class="card">
    <div class="row between"><span class="label">Ernährung</span>${dp ? `<a class="chip c-acc" href="#wissen/plan">${h(dp.name)}</a>` : ''}</div>
    <div class="grid2">
      <div><p class="small muted">Kalorien</p><p class="num"><b>${fmt(n.kcal || 0, 0)}</b> / ${fmt(t.kcal, 0)}</p>${bar(n.kcal || 0, t.kcal)}</div>
      <div><p class="small muted">Eiweiß</p><p class="num"><b>${fmt(n.protein || 0, 0)}</b> / ${t.pMin} g</p>${bar(n.protein || 0, t.pMin)}</div>
      <div><p class="small muted">Fett</p><p class="num"><b>${fmt(n.fat || 0, 0)}</b> / ${t.fat[0]}–${t.fat[1]} g</p>${bar(n.fat || 0, t.fat[1], t.fat[0])}</div>
      <div><p class="small muted">Kohlenhydrate</p><p class="num"><b>${fmt(n.carbs || 0, 0)}</b> / ${t.carb[0]}–${t.carb[1]} g</p>${bar(n.carbs || 0, t.carb[1], t.carb[0])}</div>
    </div>
    <form data-form="nutrition" class="nutform">
      <input name="kcal" inputmode="numeric" placeholder="kcal" value="${n.kcal ?? ''}" aria-label="Kalorien">
      <input name="protein" inputmode="numeric" placeholder="Eiweiß" value="${n.protein ?? ''}" aria-label="Eiweiß in Gramm">
      <input name="fat" inputmode="numeric" placeholder="Fett" value="${n.fat ?? ''}" aria-label="Fett in Gramm">
      <input name="carbs" inputmode="numeric" placeholder="KH" value="${n.carbs ?? ''}" aria-label="Kohlenhydrate in Gramm">
      <button>OK</button>
    </form>
    <p class="small muted">Tagessummen aus deiner Tracking-App. Pflicht sind Kalorien und Eiweiß, Fett und Kohlenhydrate sind optional. Plan: ${meals} Mahlzeiten mit je etwa ${perMeal} g Eiweiß${dc?.addons?.tre ? ', im Essensfenster' : ''}.</p>
  </div>

  <div class="card">
    <div class="row between"><span class="label">Training</span><span class="small muted num">${weekCount}/3 in dieser Woche</span></div>
    ${dayWorkouts.map(x => `<div class="donebox"><b>✓ ${h(x.name)}</b> <span class="small muted">${workoutSets(x)} Sätze · ${fmt(workoutVol(x) / 1000, 1)} t</span></div>`).join('')}
    ${draft ? `<p><b>${h(draft.name)}</b> läuft${draft.date !== today() ? ` (für ${dlong(draft.date)})` : ''}.</p><a class="btn" href="#training">Training fortsetzen</a>
      <div class="row"><button class="sec grow" data-act="finishWorkout">Beenden und speichern</button><button class="danger grow" data-act="discardWorkout">Löschen</button></div>` :
      ts.length ? `<p class="small muted">${isToday ? 'Training auswählen und starten:' : 'Training für diesen Tag nachtragen:'}</p>
        <div class="tplist">${ts.map(x => `<button class="${nt?.id === x.id ? '' : 'sec'}" data-act="startWorkout" data-id="${x.id}" ${x.items.length ? '' : 'disabled'}>${h(x.name)}${nt?.id === x.id ? '<small>Vorschlag</small>' : ''}${!x.items.length ? '<small>noch leer</small>' : ''}</button>`).join('')}
        <button class="sec" data-act="startFree">Freies Training<small>ohne Plan</small></button></div>` :
      `<p class="muted small">Lege zuerst Geräte, Übungen und Pläne an.</p><a class="btn sec" href="#setup/training">Training einrichten</a>`}
  </div>

  <div class="card">
    <div class="row between"><span class="label">Gewohnheiten</span><span class="small muted num">${habits.filter(x => log[x.id]).length}/${habits.length}</span></div>
    <div class="list">${habits.map(x => `<div class="item"><button class="check${log[x.id] ? ' on' : ''}" data-act="habit" data-id="${x.id}" aria-label="${h(x.name)} abhaken" aria-pressed="${!!log[x.id]}"></button><span class="grow">${h(x.name)}</span></div>`).join('') || '<p class="empty">Lege unter Einstellungen → Gewohnheiten welche an.</p>'}</div>
  </div>

  <details class="card" ${measureDue && isToday ? 'open' : ''}>
    <summary class="row between"><span class="label">Messen</span><span class="chip ${measureDue ? 'c-warn' : 'c-go'}">${measureDue ? 'fällig' : `zuletzt ${dshort(lastMeasure.date)}`}</span></summary>
    <p class="small muted">Alle 2 Wochen, morgens, entspannt, Maßband waagerecht. Bauch auf Nabelhöhe, Oberarm angespannt. Bauch und Hals ergeben zusammen die Körperfett-Schätzung.</p>
    <form data-form="measure" class="stack">
      <div class="grid2">${MFIELDS.map(([k, l]) => `<label class="f">${l} (cm)<input name="${k}" inputmode="decimal" value="${S.measures.get(d)?.[k] ? fmt(S.measures.get(d)[k], 1) : ''}"></label>`).join('')}
      <label class="f">Körperfett Waage (%)<input name="fat" inputmode="decimal" value="${w?.fat ? fmt(w.fat, 1) : ''}" placeholder="optional"></label></div>
      <button>Messung speichern</button>
    </form>
  </details>

  ${tip ? `<div class="card tipcard"><span class="label">Tipp</span><p class="small">${h(tip)}</p></div>` : ''}`;
};

/* Laufendes Training: geführter Modus, eine Übung pro Bildschirm */
const draft = () => kv('draft', null);
const saveDraft = d => setKv('draft', d);
const mmss = s => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
const isOpen = s => !s.done && !s.skipped; // Satz noch offen
const isFinished = s => s.done || s.skipped;
const curIdx = d => (Number.isInteger(d.idx) && d.idx >= 0 && d.idx < d.entries.length) ? d.idx : -1; // aufgeklappte Übung, -1 = keine
const DEF_REPS = { kg: [8, 12], stufe: [10, 15], none: [12, 20] };
const fmtTop = (ex, v) => v == null ? '–' : exUnit(ex) === 'none' ? `${fmt(v, 0)} Wdh.` : fmtLoad(v, ex);

VIEWS.training = sub => {
  if (sub === 'fertig') return trainingSummary();
  const d = draft();
  if (!d) return '<div class="card"><p class="empty">Kein laufendes Training.</p><a class="btn" href="#tag">Zum Tag</a></div>';
  const tot = d.entries.reduce((a, e) => a + e.sets.length, 0), dn = d.entries.reduce((a, e) => a + e.sets.filter(isFinished).length, 0);
  const head = `<div class="thead"><div class="row between"><div class="grow"><b>${h(d.name)}</b><p class="small muted"><span id="elapsed">${mmss((Date.now() - new Date(d.started)) / 1000)}</span> · ${dn}/${tot} Sätze${d.date !== today() ? ` · für ${dlong(d.date)}` : ''}</p></div>
    ${sub === 'liste' ? '<a class="btn sec sm" href="#training">Zurück</a>' : '<a class="btn sec sm" href="#training/liste">Bearbeiten</a>'}</div>${bar(dn, tot || 1)}</div>`;
  const rest = d.restUntil && d.restUntil > Date.now() ? `<div class="restbar" id="restBar"><span>Pause</span><b id="restTime">${mmss((d.restUntil - Date.now()) / 1000)}</b><button class="sec sm" data-act="restAdd">+30 s</button><button class="sm" data-act="restSkip">Weiter</button></div>` : '';
  return head + (sub === 'liste' ? trainingList(d) : focusView(d)) + rest + '<input type="file" id="exPhotoIn" accept="image/*" hidden>';
};
function stepper(f, v, unit) {
  return `<div class="stepper"><button data-act="step" data-f="${f}" data-d="-1" aria-label="${unit} weniger">−</button>
    <label><input inputmode="decimal" data-cur="${f}" value="${v === '' || v == null ? '' : h(fmt(num(v), 2))}" placeholder="–" aria-label="${unit}"><span>${unit}</span></label>
    <button data-act="step" data-f="${f}" data-d="1" aria-label="${unit} mehr">+</button></div>`;
}
function focusView(d) { // alle Übungen untereinander, eine davon aufgeklappt
  const oi = curIdx(d), wt = (d.warmup || []).reduce((a, w) => a + w.done.length, 0), wd = (d.warmup || []).reduce((a, w) => a + w.done.filter(Boolean).length, 0);
  const warm = wt ? `<div class="card wcard"><div class="row between"><span class="label">Aufwärmen</span><span class="chip ${wd === wt ? 'c-go' : 'c-acc'}">${wd}/${wt}</span></div>
    ${d.warmup.map((w, wi) => `<div class="witem"><div class="grow"><b>${h(w.name)}</b>${w.detail ? ` <span class="small muted">${h(w.detail)}</span>` : ''}</div>
      <div class="row">${w.done.map((x, si) => `<button class="check big${x ? ' on' : ''}" data-act="warmSet" data-w="${wi}" data-s="${si}" aria-label="${h(w.name)} Satz ${si + 1}" aria-pressed="${x}"></button>`).join('')}</div></div>`).join('')}</div>` : '';
  const allDone = d.entries.length && d.entries.every(e => e.sets.every(isFinished));
  return `${warm}
  ${d.entries.length ? '' : '<div class="card"><p>Noch keine Übung in diesem Training.</p><a class="btn" href="#training/liste">Übung hinzufügen</a></div>'}
  ${d.entries.map((e, i) => i === oi ? openCard(d, e, i) : closedCard(e, i)).join('')}
  ${d.entries.length ? `<div class="row wrap"><a class="btn sec grow" href="#training/liste">+ Übung</a><button class="${allDone ? '' : 'sec '}grow" data-act="finishWorkout">Training abschließen</button></div>` : ''}
  <button class="danger" data-act="discardWorkout">Training löschen</button>`;
}
function closedCard(e, i) {
  const ex = S.exercises.get(e.exerciseId), ph = exPhoto(ex), n = e.sets.filter(isFinished).length, done = n === e.sets.length;
  const vals = (e.sets.some(s => s.done) ? e.sets.filter(s => s.done) : e.sets.filter(isOpen)).map(s => fmtSet(s, ex)).join(' · ');
  return `<button class="card excard${done ? ' isdone' : ''}" id="ex-${i}" data-act="openEx" data-i="${i}">
    ${ph ? `<img class="mini" src="${ph}" alt="">` : `<span class="mini ph">${done ? '✓' : i + 1}</span>`}
    <span class="grow left"><b>${h(exName(e.exerciseId))}</b><span class="small muted block">${n ? '' : 'Plan: '}${vals}</span></span>
    <span class="chip ${done ? 'c-go' : n ? 'c-warn' : 'c-acc'}">${done ? '✓' : `${n}/${e.sets.length}`}</span></button>`;
}
function openCard(d, e, i) {
  const ex = S.exercises.get(e.exerciseId) || { id: '', name: 'Gelöschte Übung', unit: 'kg', repMin: 8, repMax: 12, sets: 3 };
  const sg = ex.id ? suggest(ex, d.id) : null, ci = e.sets.findIndex(isOpen), cs = e.sets[ci], u = exUnit(ex), ph = exPhoto(ex);
  return `<div class="card focus" id="ex-${i}">
    <button class="exhead plain left" data-act="openEx" data-i="${i}" aria-label="${h(ex.name)} zuklappen">${ph ? `<span class="exphoto"><img src="${ph}" alt=""></span>` : ''}
      <span class="grow"><span class="exname block">${h(ex.name)}</span><span class="small muted block">${ex.repMin}–${ex.repMax} Wdh. · Pause ${ex.rest || 90} s${ex.note ? ' · ' + h(ex.note) : ''}</span></span><span class="muted">▴</span></button>
    ${!ph && ex.id ? `<label class="small link" for="exPhotoIn" data-exid="${ex.id}">+ Foto vom Gerät</label>` : ''}
    ${ph ? `<button class="ghost sm left" data-act="zoomEx" data-id="${ex.id}">Foto groß anzeigen</button>` : ''}
    ${sg?.last ? `<p class="small muted">${h(sg.last)}</p>` : ''}
    ${sg ? `<div class="hint${sg.up ? ' up' : ''}"><p>${h(sg.text)}</p>${cs && sg.kg !== '' && !sg.first && (num(cs.kg) !== num(sg.kg) || num(cs.reps) !== num(sg.reps)) ? '<button class="ghost sm" data-act="applySuggest">Vorschlag übernehmen</button>' : ''}</div>` : ''}
    <div class="sets">${e.sets.map((s, si) => si === ci ? '' : s.skipped
      ? `<button class="setrow skipped" data-act="reopenSet" data-s="${si}" aria-label="Satz ${si + 1} doch machen"><span>Satz ${si + 1}</span><span>übersprungen</span><span>↺</span></button>`
      : s.done
      ? `<button class="setrow done" data-act="reopenSet" data-s="${si}" aria-label="Satz ${si + 1} wieder öffnen"><span>Satz ${si + 1}</span><span class="num">${u === 'none' ? '' : fmtLoad(s.kg, ex) + ' × '}${s.reps} Wdh.</span><span>✓</span></button>`
      : `<div class="setrow"><span>Satz ${si + 1}</span><span class="num muted">${u === 'none' ? '' : fmtLoad(s.kg, ex) + ' × '}${s.reps || '–'} Wdh.</span><span></span></div>`).join('')}</div>
    ${cs ? `<div class="cur"><span class="label">Satz ${ci + 1} von ${e.sets.length}</span>
      ${u !== 'none' ? stepper('kg', cs.kg, u === 'stufe' ? 'Stufe' : 'kg') : ''}
      ${stepper('reps', cs.reps, 'Wdh.')}
      <div class="effort" role="group" aria-label="Wie schwer war der Satz? (optional)">${[['3', 'Locker'], ['2', 'Gut'], ['0', 'Am Limit']].map(([v, l]) => `<button class="${cs.rir === v ? 'on' : ''}" data-act="rir" data-v="${v}">${l}</button>`).join('')}</div>
      <button class="bigbtn" data-act="doneSet">Satz geschafft ✓</button>
      <button class="ghost sm" data-act="skipSet">Satz überspringen</button></div>` : '<p class="small muted">Alle Sätze erledigt. Tippe einen Satz an, um ihn zu korrigieren.</p>'}
    <div class="row between"><button class="ghost" data-act="addSet">+ Satz</button><button class="ghost" data-act="removeSet" ${e.sets.length <= 1 ? 'disabled' : ''}>− Satz</button><button class="ghost" data-act="openEx" data-i="${i}">Zuklappen</button></div>
  </div>`;
}
function trainingList(d) {
  const exs = all('exercises').filter(x => !d.entries.some(e => e.exerciseId === x.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const wd = (d.warmup || []).reduce((a, w) => a + w.done.filter(Boolean).length, 0), wt = (d.warmup || []).reduce((a, w) => a + w.done.length, 0);
  return `<div class="card"><div class="list">
    ${wt ? `<button class="item navitem plain" data-act="goWarm"><span class="chip ${wd === wt ? 'c-go' : 'c-acc'}">${wd}/${wt}</span><span class="grow">Aufwärmen</span>›</button>` : ''}
    ${d.entries.map((e, i) => { const n = e.sets.filter(isFinished).length; return `<div class="item"><span class="chip ${n === e.sets.length ? 'c-go' : n ? 'c-warn' : 'c-acc'}">${n}/${e.sets.length}</span>
      <button class="grow plain left" data-act="jumpTo" data-i="${i}">${h(exName(e.exerciseId))}</button>
      <button class="icon" data-act="moveEntry" data-i="${i}" data-dir="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="icon" data-act="removeEntry" data-i="${i}" aria-label="Übung entfernen">×</button></div>`; }).join('')}
  </div></div>
  <div class="card"><h2>Übung hinzufügen</h2>
    ${exs.length ? `<select data-addentry="1" aria-label="Vorhandene Übung hinzufügen"><option value="">Vorhandene Übung wählen</option>${exs.map(x => `<option value="${x.id}">${h(x.name)}</option>`).join('')}</select>` : ''}
    <p class="small muted">Oder neues Gerät direkt anlegen:</p>
    ${quickExForm('draft', !!d.templateId)}
  </div>
  <div class="card"><button data-act="finishWorkout">Training abschließen</button><button class="danger" data-act="discardWorkout">Training verwerfen</button></div>`;
}
function quickExForm(target, offerPlan) {
  return `<form data-form="quickEx" class="stack"><input type="hidden" name="target" value="${target}">
    <input name="name" list="exsuggest" required placeholder="Name, z. B. Latziehen" aria-label="Name der Übung">
    <datalist id="exsuggest">${EX_SUGGEST.map(x => `<option value="${h(x)}">`).join('')}</datalist>
    <div class="grid2"><select name="unit" aria-label="Gewichtsart">${Object.entries(UNITS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <label class="photoin"><input type="file" name="photo" accept="image/*" hidden><span>+ Foto</span></label></div>
    ${offerPlan ? '<label class="row small"><input type="checkbox" name="toPlan" checked style="width:auto"> Auch im Plan speichern</label>' : ''}
    <button>Anlegen und hinzufügen</button></form>`;
}
function trainingSummary() {
  const w = S.workouts.get(kv('lastSummary', null));
  if (!w) return '<div class="card"><p class="empty">Keine Zusammenfassung vorhanden.</p><a class="btn" href="#tag">Zum Tag</a></div>';
  const mins = w.finished && w.started ? Math.round((new Date(w.finished) - new Date(w.started)) / 60000) : null;
  const rows = w.entries.filter(e => e.sets.some(s => s.done)).map(e => {
    const ex = S.exercises.get(e.exerciseId) || { name: 'Gelöschte Übung', unit: 'kg' }, sets = e.sets.filter(s => s.done);
    const prev = ex.id ? exHistory(ex.id, w.id).filter(x => x.date <= w.date) : [];
    const now = topLoad(ex, sets), last = prev.length ? topLoad(ex, prev[prev.length - 1].sets) : null;
    const best = prev.length ? Math.max(...prev.map(x => topLoad(ex, x.sets))) : null;
    const pr = prev.length && (now > best || (now === best && repsAtTop(ex, sets) > Math.max(...prev.filter(x => topLoad(ex, x.sets) === best).map(x => repsAtTop(ex, x.sets)))));
    return { ex, sets, now, last, pr, first: !prev.length, next: ex.id ? suggest(ex) : null };
  });
  const prs = rows.filter(r => r.pr);
  return `<div class="card hero"><span class="label">Training gespeichert</span><h2>${h(w.name)}</h2>
    <div class="grid2"><div><p class="small muted">Dauer</p><b class="num">${mins != null ? mins + ' min' : '–'}</b></div><div><p class="small muted">Sätze</p><b class="num">${workoutSets(w)}</b></div>
    <div><p class="small muted">Bewegtes Gewicht</p><b class="num">${fmt(workoutVol(w) / 1000, 1)} t</b></div><div><p class="small muted">Neue Bestwerte</p><b class="num">${prs.length}</b></div></div></div>
  ${prs.length ? `<div class="card"><h2>Neue Bestwerte</h2>${prs.map(r => `<p><b>${h(r.ex.name)}</b>: ${exUnit(r.ex) === 'none' ? fmtTop(r.ex, r.now) : `${fmtTop(r.ex, r.now)} × ${repsAtTop(r.ex, r.sets)}`}</p>`).join('')}</div>` : ''}
  <div class="card"><h2>Im Vergleich zum letzten Mal</h2><div class="list">${rows.map(r => {
    const dlt = r.last != null ? r.now - r.last : null;
    return `<div class="item"><div class="grow"><b>${h(r.ex.name)}</b><p class="small muted">${r.sets.map(s => fmtSet(s, r.ex)).join(' · ')}</p></div>
      <span class="chip ${r.first ? 'c-acc' : dlt > 0 ? 'c-go' : dlt < 0 ? 'c-warn' : 'c-acc'}">${r.first ? 'erstes Mal' : dlt > 0 ? '+' + fmt(dlt, 2) : dlt < 0 ? fmt(dlt, 2) : 'gleich'}</span></div>`;
  }).join('')}</div></div>
  <div class="card"><h2>Nächstes Mal</h2>${rows.filter(r => r.next).map(r => `<p class="small"><b>${h(r.ex.name)}:</b> ${h(r.next.text)}</p>`).join('')}</div>
  <a class="btn" href="#tag">Fertig</a>`;
}

/* Feier nach dem Training: Haken, Konfetti, Motivationsspruch */
let celebrateNext = false;
const CHEERS = ['Ein Training näher an deinem Ziel.', 'Disziplin schlägt Motivation. Heute hast du geliefert.', 'Deine Muskeln wachsen jetzt. Iss dein Eiweiß und schlaf gut.',
  'Du hast dir selbst ein Versprechen gehalten.', 'Stärker als letzte Woche. Genau so geht Veränderung.', 'Jeder Satz zählt. Heute waren es richtig viele.'];
function celebrate() {
  const w = S.workouts.get(kv('lastSummary', null));
  const prs = w ? w.entries.filter(e => {
    const ex = S.exercises.get(e.exerciseId), sets = e.sets.filter(s => s.done); if (!ex || !sets.length) return false;
    const prev = exHistory(ex.id, w.id).filter(x => x.date <= w.date); if (!prev.length) return false;
    return topLoad(ex, sets) > Math.max(...prev.map(x => topLoad(ex, x.sets)));
  }).length : 0;
  const ov = document.createElement('div');
  ov.className = 'celebrate'; ov.setAttribute('role', 'status');
  ov.innerHTML = `<canvas></canvas><div class="cbox"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>
    <h2>Training geschafft!</h2>${prs ? `<p class="prs">${prs} neue${prs > 1 ? '' : 'r'} Bestwert${prs > 1 ? 'e' : ''}</p>` : ''}<p>${CHEERS[Math.floor(Math.random() * CHEERS.length)]}</p><span class="small">Tippen zum Weiter</span></div>`;
  document.body.appendChild(ov);
  const close = () => { ov.classList.add('out'); setTimeout(() => ov.remove(), 350); };
  ov.addEventListener('click', close); setTimeout(close, 3800);
  // kleiner Erfolgston
  try { if (audioCtx) [523, 659, 784, 1047].forEach((f, i) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t0 = audioCtx.currentTime + i * 0.12; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25); o.start(t0); o.stop(t0 + 0.27); }); } catch (e) { }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = ov.querySelector('canvas'), ctx = c.getContext('2d'), dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const cols = ['#5DC3A5', '#F0915A', '#86A4F0', '#E28BC0', '#C4D35E', '#FFD166'];
  const parts = [...Array(140)].map(() => ({ x: innerWidth / 2, y: innerHeight * 0.42, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 15 - 4, r: Math.random() * 6 + 4, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, c: cols[Math.floor(Math.random() * cols.length)] }));
  const t0 = performance.now();
  (function frame(t) {
    if (!ov.isConnected || t - t0 > 3500) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    requestAnimationFrame(frame);
  })(t0);
}

/* Ton, Timer und Bildschirmsperre fürs Training */
let audioCtx, wakeLock = null;
function unlockAudio() { try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { } }
function beep() {
  try {
    if (audioCtx) [0, 0.3, 0.6].forEach(t => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t0 = audioCtx.currentTime + t;
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      o.start(t0); o.stop(t0 + 0.22);
    });
    navigator.vibrate?.([200, 100, 200]);
  } catch (e) { }
}
async function syncWakeLock() {
  const want = location.hash.startsWith('#training') && !!draft() && !document.hidden;
  try {
    if (want && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { }
}
setInterval(() => {
  const d = S.kv ? draft() : null; if (!d) return;
  const el = $('#elapsed'); if (el) el.textContent = mmss((Date.now() - new Date(d.started)) / 1000);
  if (d.restUntil) {
    const left = (d.restUntil - Date.now()) / 1000;
    if (left <= 0) { d.restUntil = null; saveDraft(d); beep(); toast('Pause vorbei: nächster Satz'); if (location.hash.startsWith('#training')) render(); }
    else { const rt = $('#restTime'); if (rt) rt.textContent = mmss(left); }
  }
}, 1000);

/* Statistik */
VIEWS.statistik = () => {
  const p = prof(), cw = currentWeight(), b = bmi(cw), bf = bodyFatSeries().slice(-1)[0];
  const t = targets(), d = today();
  const range = kv('stats.range', 90), mode = kv('stats.mode', 'grid'), pmode = kv('stats.proj', 'plan');
  const sel = kv('stats.metrics', ['weight', 'bf', 'm_waist', 'protein']);
  const defs = metricDefs(), chosen = sel.map(id => defs.find(m => m.id === id)).filter(Boolean);
  const from = range ? addDays(d, -range) : null;
  const inR = pts => from ? pts.filter(x => x.d >= from) : pts;
  const last30 = [...Array(30)].map((_, i) => addDays(d, -i));
  const habitDays = last30.filter(x => S.habitLog.has(x));
  const hr = habitDays.length ? habitDays.reduce((a, x) => a + (habitRate(x) || 0), 0) / habitDays.length : null;
  const nut30 = last30.map(x => S.nutrition.get(x)).filter(Boolean);
  const protOk = nut30.filter(n => n.protein >= t.pMin).length, kcalOk = nut30.filter(n => n.kcal && n.kcal <= t.kcal * 1.05).length;
  const weeksAll = (() => { const wk = all('workouts'); if (!wk.length) return { ok: 0, n: 0 }; let w = weekStart(wk.map(x => x.date).sort()[0]), ok = 0, n = 0; while (w <= weekStart(d)) { const c = wk.filter(x => x.date >= w && x.date < addDays(w, 7)).length; if (w < weekStart(d)) { n++; if (c >= 3) ok++; } w = addDays(w, 7); } return { ok, n }; })();
  const proj = projection(pmode), mss = milestones(proj.pts);
  const hist = trendSeries().filter(x => dayDiff(x.date, d) <= 60).map(x => ({ d: x.date, y: x.trend }));
  const groups = [...new Set(defs.map(m => m.g))];
  const habits = activeHabits();
  return `
  <div class="tiles">
    <div class="tile"><span>Gewicht (Trend)</span><b>${fmtF(cw)} kg</b><small>${sign(cw - p.start)}${fmt(cw - p.start)} kg seit Start</small></div>
    <div class="tile"><span>BMI</span><b>${fmtF(b)}</b><small>${bmiClass(b)}</small></div>
    <div class="tile"><span>Körperfett</span><b>${bf ? fmtF(bf.y) + ' %' : '–'}</b><small>${bf ? `Stand ${dshort(bf.d)}` : 'Bauch + Hals messen'}</small></div>
    <div class="tile"><span>Bis zum Ziel</span><b>${fmt(Math.max(0, cw - p.goal))} kg</b><small>${mss.length ? `ca. ${dmonth(mss[mss.length - 1].d)}` : '–'}</small></div>
    <div class="tile"><span>Gewohnheiten</span><b>${hr != null ? fmt(hr, 0) + ' %' : '–'}</b><small>letzte 30 Tage</small></div>
    <div class="tile"><span>Trainings</span><b>${S.workouts.size}</b><small>${weeksAll.n ? `${weeksAll.ok}/${weeksAll.n} Wochen mit 3×` : 'gesamt'}</small></div>
  </div>

  <div class="card">
    <div class="row between"><h2>Prognose</h2></div>
    <div class="seg">${[['plan', 'Nach Plan'], ['ist', 'Aktuelles Tempo']].map(([k, l]) => `<button class="${pmode === k ? 'on' : ''}" data-act="kv" data-k="stats.proj" data-v="${k}">${l}</button>`).join('')}</div>
    ${proj.reached ? '<p>Du hast dein Zielgewicht erreicht.</p>' : proj.noRate ? '<p class="small muted">Für eine Prognose nach aktuellem Tempo brauchst du mindestens eine Woche mit Gewichtsabnahme. „Nach Plan" funktioniert sofort.</p>' : `
      ${chart([{ pts: hist, cls: 'trend' }, { pts: proj.pts, cls: 'proj' }], { goal: p.goal, label: 'Prognose', h: 170 })}
      <div class="scroll"><table class="t"><thead><tr><th>Gewicht</th><th>Etwa am</th><th>In</th><th>BMI</th></tr></thead><tbody>
      ${mss.map(m => `<tr><td><b>${fmt(m.kg)} kg</b></td><td>${dlong(m.d)}</td><td>${Math.max(1, Math.round(dayDiff(d, m.d) / 7))} Wo.</td><td>${fmtF(bmi(m.kg))}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted">${pmode === 'plan' ? 'Annahme: du bleibst im hautschonenden Korridor (0,7 % pro Woche über 100 kg, 0,6 % bis 92 kg, danach 0,5 %).' : `Annahme: dein aktuelles Tempo von ${fmt(-weeklyRate().pct, 2)} % pro Woche bleibt gleich.`} Diätpausen verschieben die Daten um die Pausenwochen.</p>`}
  </div>

  <div class="card">
    <h2>Vergleichen</h2>
    <div class="seg">${[[30, '30 T'], [90, '90 T'], [180, '6 M'], [0, 'Alles']].map(([v, l]) => `<button class="${range === v ? 'on' : ''}" data-act="kv" data-k="stats.range" data-v="${v}" data-num="1">${l}</button>`).join('')}</div>
    <div class="seg">${[['grid', 'Nebeneinander'], ['overlay', 'In einem Diagramm']].map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-act="kv" data-k="stats.mode" data-v="${k}">${l}</button>`).join('')}</div>
    <details ${chosen.length ? '' : 'open'}><summary class="small link">Metriken wählen (${chosen.length})</summary>
      ${groups.map(g => `<p class="label" style="margin-top:10px">${g}</p><div class="chips">${defs.filter(m => m.g === g).map(m => `<button class="mchip${sel.includes(m.id) ? ' on' : ''}" data-act="metric" data-id="${m.id}">${h(m.name)}</button>`).join('')}</div>`).join('')}
    </details>
  </div>
  ${mode === 'overlay' && chosen.length ? `<div class="card">${overlayChart(chosen.map(m => ({ pts: inR(m.pts) })))}
    <div class="legend">${chosen.map((m, i) => { const ys = inR(m.pts).map(x => x.y); return `<span><i class="s${i % 6}"></i>${h(m.name)} <small class="muted">${ys.length ? `${fmt(Math.min(...ys), m.digits)}–${fmt(Math.max(...ys), m.digits)} ${m.unit}` : 'keine Daten'}</small></span>`; }).join('')}</div>
    <p class="small muted">Jede Linie ist auf ihren eigenen Wertebereich skaliert. So siehst du, ob sich Werte gemeinsam bewegen, zum Beispiel Bauchumfang und Eiweiß.</p></div>` : ''}
  ${mode === 'grid' ? `<div class="mgrid">${chosen.map(m => {
    const pts = inR(m.pts), dots = m.dots ? inR(m.dots) : null, last = pts[pts.length - 1], first = pts[0];
    const delta = last && first && pts.length > 1 ? last.y - first.y : null;
    return `<div class="card mcard"><div class="row between"><h3>${h(m.name)}</h3><button class="icon" data-act="metric" data-id="${m.id}" aria-label="${h(m.name)} ausblenden">×</button></div>
      <p><b class="num">${last ? fmt(last.y, m.digits) : '–'}</b> <span class="small muted">${m.unit}${delta != null ? ` · ${sign(delta)}${fmt(delta, m.digits)} im Zeitraum` : ''}</span></p>
      ${chart([...(dots ? [{ pts: dots, cls: 'dots' }] : []), { pts, cls: m.line ? 'line' : 'trend' }], { goal: m.goal, label: m.name, h: 130, minPad: m.digits ? 0.5 : 1, zero: m.zero, empty: 'Noch zu wenig Daten im Zeitraum.' })}</div>`;
  }).join('')}</div>` : ''}

  ${strengthCard()}
  <div class="card">
    <h2>Ziele in den letzten 30 Tagen</h2>
    <div class="list">
      <div class="item"><span class="grow">Eiweißziel erreicht</span><b class="num">${protOk}/${nut30.length} Tage</b></div>
      <div class="item"><span class="grow">Kalorienziel eingehalten</span><b class="num">${kcalOk}/${nut30.length} Tage</b></div>
      <div class="item"><span class="grow">Gewogen</span><b class="num">${last30.filter(x => S.weights.has(x)).length}/30 Tage</b></div>
      <div class="item"><span class="grow">Wochen mit 3 Trainings</span><b class="num">${weeksAll.ok}/${weeksAll.n}</b></div>
    </div>
  </div>
  <div class="card">
    <h2>Gewohnheiten im Detail</h2>
    <p class="small muted">Anteil der Tage, an denen du abgehakt hast (letzte 30 Tage mit Einträgen).</p>
    ${habits.map(x => { const ok = habitDays.filter(dd => S.habitLog.get(dd)?.done?.[x.id]).length, pc = habitDays.length ? ok / habitDays.length * 100 : 0; return `<div class="hrow"><span>${h(x.name)}</span><b class="num">${fmt(pc, 0)} %</b>${bar(pc, 100)}</div>`; }).join('') || '<p class="empty">Keine Gewohnheiten.</p>'}
  </div>`;
};

/* Fotos */
const POSES = ['Vorne', 'Seite', 'Hinten', 'Sonstiges'];
let compare = { a: null, b: null };
const photoURLs = new Map();
function photoURL(p) { if (!photoURLs.has(p.id)) photoURLs.set(p.id, URL.createObjectURL(p.blob)); return photoURLs.get(p.id); }
VIEWS.fotos = () => {
  const ps = all('photos').sort((a, b) => b.date.localeCompare(a.date) || POSES.indexOf(a.pose) - POSES.indexOf(b.pose));
  const byDay = {};
  for (const p of ps) (byDay[p.date] ||= []).push(p);
  const A = S.photos.get(compare.a), B = S.photos.get(compare.b);
  return `
  <div class="card">
    <h2>Neue Fotos</h2>
    <p class="small muted">Gleiches Licht, gleicher Ort, gleiche Uhrzeit (morgens), gleiche Kleidung. Am besten alle 2–4 Wochen vorne, seitlich und hinten.</p>
    <div class="grid2">
      <label class="f">Datum<input type="date" id="photoDate" value="${today()}" max="${today()}"></label>
      <label class="f">Ansicht<select id="photoPose">${POSES.map(x => `<option>${x}</option>`).join('')}</select></label>
    </div>
    <label class="btn" for="photoFile">Foto aufnehmen oder auswählen</label>
    <input type="file" id="photoFile" accept="image/*" multiple hidden>
    <p class="small muted">Fotos bleiben nur auf diesem Gerät. Für das Backup unter Einstellungen → Datensicherung „mit Fotos" wählen.</p>
  </div>
  ${ps.length >= 2 ? `<div class="card">
    <h2>Vorher und nachher</h2>
    <div class="grid2">${['a', 'b'].map(k => `<label class="f">${k === 'a' ? 'Vorher' : 'Nachher'}<select data-compare="${k}"><option value="">wählen</option>${ps.map(p => `<option value="${p.id}" ${compare[k] === p.id ? 'selected' : ''}>${dlong(p.date)} · ${p.pose}</option>`).join('')}</select></label>`).join('')}</div>
    ${A && B ? `<div class="cmp">${[A, B].map(p => { const w = trendAt(p.date); return `<figure><img src="${photoURL(p)}" alt="${p.pose} am ${dlong(p.date)}"><figcaption>${dlong(p.date)}${w ? ` · ${fmtF(w)} kg` : ''}</figcaption></figure>`; }).join('')}</div>
      <p class="small muted">${(() => { const wa = trendAt(A.date), wb = trendAt(B.date), days = Math.abs(dayDiff(A.date, B.date)); return `${days} Tage dazwischen${wa && wb ? ` · ${sign(wb - wa)}${fmt(wb - wa)} kg` : ''}`; })()}</p>` : '<p class="small muted">Wähle zwei Fotos, um sie nebeneinander zu sehen.</p>'}
  </div>` : ''}
  ${Object.entries(byDay).map(([dd, list]) => `<div class="card"><div class="row between"><h3>${dlong(dd)}</h3><span class="small muted">${trendAt(dd) ? fmtF(trendAt(dd)) + ' kg' : ''}</span></div>
    <div class="pgrid">${list.map(p => `<button class="thumb" data-act="openPhoto" data-id="${p.id}" aria-label="${p.pose} am ${dlong(dd)} öffnen"><img src="${p.thumb}" alt=""><span>${p.pose}</span></button>`).join('')}</div></div>`).join('') || '<div class="card"><p class="empty">Noch keine Fotos. Das erste Foto ist dein wichtigstes, auch wenn es sich unangenehm anfühlt. In ein paar Monaten wirst du froh darüber sein.</p></div>'}`;
};
function openViewer(id) {
  const p = S.photos.get(id); if (!p) return;
  const v = document.createElement('div');
  v.className = 'viewer'; v.id = 'viewer';
  v.innerHTML = `<div class="vbar"><span>${dlong(p.date)} · ${p.pose}</span><button class="icon" data-act="closePhoto" aria-label="Schließen">×</button></div>
    <img src="${photoURL(p)}" alt="${p.pose} am ${dlong(p.date)}">
    <div class="vbar"><button class="sec" data-act="sharePhoto" data-id="${p.id}">Speichern / Teilen</button><button class="sec" data-act="setCompare" data-k="a" data-id="${p.id}">Als Vorher</button><button class="sec" data-act="setCompare" data-k="b" data-id="${p.id}">Als Nachher</button><button class="danger" data-act="delPhoto" data-id="${p.id}">Löschen</button></div>`;
  document.body.appendChild(v);
}
const closeViewer = () => $('#viewer')?.remove();
function openImage(src, title) {
  closeViewer();
  const v = document.createElement('div'); v.className = 'viewer'; v.id = 'viewer';
  v.innerHTML = `<div class="vbar"><span>${h(title)}</span><button class="icon" data-act="closePhoto" aria-label="Schließen">×</button></div><img src="${src}" alt="${h(title)}"><div></div>`;
  document.body.appendChild(v);
}
function loadImage(file) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Bild konnte nicht gelesen werden')); img.src = URL.createObjectURL(file); });
}
function resize(img, max, type, q) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return type === 'url' ? c.toDataURL('image/jpeg', q) : new Promise(r => c.toBlob(r, 'image/jpeg', q));
}
async function addPhotos(files) {
  const date = $('#photoDate')?.value || today(), pose = $('#photoPose')?.value || 'Vorne';
  let n = 0;
  for (const f of files) {
    try {
      const img = await loadImage(f);
      const blob = await resize(img, 1600, 'blob', 0.85), thumb = resize(img, 320, 'url', 0.7);
      URL.revokeObjectURL(img.src);
      await put('photos', { id: uid(), date, pose, blob, thumb, created: new Date().toISOString() }); n++;
    } catch (e) { toast(e.message); }
  }
  if (n) toast(`${n} Foto${n > 1 ? 's' : ''} gespeichert`);
  render();
}

/* Wissen */
VIEWS.wissen = (sub, arg) => (KNOW[sub] || KNOW.index)(arg);
const KNOW = {};
KNOW.index = () => {
  const dp = dietPlan();
  const items = [
    ['plan', 'Dein Ernährungsplan', dp ? dp.name : 'Noch nicht gewählt: Beratung starten'],
    ['mahlzeiten', 'Wie viele Mahlzeiten?', 'Warum 1 Mahlzeit am Tag den Muskelaufbau bremst'],
    ['cheat', 'Cheat Day und Konsequenzen', 'Was ein Cheat Day wirklich anrichtet, mit Rechner'],
    ['formen', 'Alle Ernährungsformen', 'Vergleich, Lebensmittel, Vor- und Nachteile'],
    ['supplements', 'Supplements', 'Was wirkt, was Müll ist'],
    ['training', 'Richtig trainieren', 'Intensität, Steigerung, Beintag'],
    ['haut', 'Abnehmen und Haut', 'Was gegen lose Haut hilft']
  ];
  return `<div class="card"><div class="list">${items.map(([k, t, s]) => `<a class="item navitem" href="#wissen/${k}"><div class="grow"><b>${t}</b><p class="small muted">${h(s)}</p></div>›</a>`).join('')}</div></div>`;
};
function dietDetail(dp, mine) {
  const dc = dietCfg(), t = targets();
  return `
  <div class="card hero"><span class="label">${mine ? 'Dein Plan' : 'Ernährungsform'}</span><h2>${h(dp.name)}</h2><p class="small">${h(dp.principle)}</p>
    ${mine ? `<div class="grid2"><div><p class="small muted">Kalorien</p><b class="num">${fmt(t.kcal, 0)} kcal</b></div><div><p class="small muted">Eiweiß</p><b class="num">${t.pMin}–${t.pMax} g</b></div><div><p class="small muted">Fett</p><b class="num">${t.fat[0]}–${t.fat[1]} g</b></div><div><p class="small muted">Kohlenhydrate</p><b class="num">${t.carb[0]}–${t.carb[1]} g</b></div></div>` : `<p class="small muted">${h(dp.who)}</p>`}
  </div>
  ${mine && dc?.addons && Object.entries(dc.addons).some(([, v]) => v) ? `<div class="card"><h2>Deine Bausteine</h2>${Object.entries(dc.addons).filter(([, v]) => v).map(([k]) => `<div class="ev s3"><h3>${ADDONS[k].name}</h3><p class="small">${ADDONS[k].text}</p></div>`).join('')}</div>` : ''}
  <div class="card"><h2>Die Regeln</h2>${lis(dp.rules)}</div>
  <div class="card"><h2>Das darfst du essen</h2>${Object.entries(dp.eat).map(([cat, list]) => `<details class="cat"><summary><span class="dot go"></span>${h(cat)} <span class="small muted">(${list.length})</span></summary>${lis(list)}</details>`).join('')}</div>
  <div class="card"><h2><span class="dot mid"></span>Begrenzen</h2><p class="small muted">Erlaubt, aber in kleinen, abgewogenen Mengen und eingeplant.</p>${lis(dp.limit)}</div>
  <div class="card"><h2><span class="dot stop"></span>Meiden</h2><p class="small muted">Passt nicht zu deinem Ziel. Ausnahmen höchstens in der geplanten Genussmahlzeit.</p>${lis(dp.avoid)}</div>
  <div class="card"><h2>Beispieltag</h2><div class="list">${dp.sample.map(([m, txt]) => `<div class="item"><span class="label" style="min-width:90px">${h(m)}</span><span class="small grow">${h(txt)}</span></div>`).join('')}</div></div>
  <div class="card"><h2>Supplements dazu</h2>${lis(DIET_SUPPS[dp.id] || [])}<a class="small link" href="#wissen/supplements">Alle Supplements mit Begründung ›</a></div>
  <div class="card"><h2>Tipps</h2>${lis(dp.tips)}</div>
  ${mine ? `<div class="card"><h2>Mahlzeiten und Cheat Day</h2><p class="small">Plan: ${dc?.meals || 3} Mahlzeiten mit je ${round5(t.pMin / (dc?.meals || 3))} g Eiweiß.</p><a class="small link" href="#wissen/mahlzeiten">Warum diese Anzahl ›</a><a class="small link" href="#wissen/cheat">Cheat Day und Konsequenzen ›</a></div>
  <div class="card"><a class="btn sec" href="#setup/ernaehrung">Plan ändern oder Beratung wiederholen</a></div>` : ''}`;
}
KNOW.plan = () => {
  const dp = dietPlan();
  if (!dp) return `${back('#wissen', 'Wissen')}<div class="card hero"><h2>Noch kein Plan gewählt</h2><p class="small">In 8 Fragen zu deiner passenden Ernährungsform, mit vollständigem Plan.</p><a class="btn" href="#beratung">Beratung starten</a></div>`;
  return back('#wissen', 'Wissen') + dietDetail(dp, true);
};
KNOW.formen = () => `${back('#wissen', 'Wissen')}
  <div class="card"><h2>Alle Ernährungsformen</h2><p class="small muted">Die Forschung zeigt: Bei gleichen Kalorien verlieren Menschen mit allen Formen ähnlich viel Fett. Entscheidend sind Eiweiß und das, was du dauerhaft durchhältst.</p>
  <div class="list">${DIET_PLANS.map(d => `<a class="item navitem" href="#wissen/form/${d.id}"><div class="grow"><b>${h(d.name)}</b>${dietCfg()?.id === d.id ? ' <span class="chip c-go">deine Wahl</span>' : ''}<p class="small muted">${h(d.short)}</p></div>›</a>`).join('')}</div></div>
  <div class="card"><h2>Zusätzliche Bausteine</h2>${Object.values(ADDONS).map(a => `<div class="ev s3"><h3>${a.name}</h3><p class="small">${a.text}</p></div>`).join('')}</div>
  <div class="card"><p class="small muted">Ausführlicher Vergleich mit Studien (auch Paleo, Formula-Diät, Carnivore usw.) im Ernährungs-Atlas.</p><a class="btn sec" href="https://claude.ai/artifact/CTjbaxtYdYJ2QxqYrfMzh6" target="_blank" rel="noopener">Ernährungs-Atlas öffnen</a></div>`;
KNOW.form = id => { const dp = DIET_PLANS.find(d => d.id === id); return back('#wissen/formen', 'Ernährungsformen') + (dp ? dietDetail(dp, false) + `<div class="card"><button data-act="chooseDiet" data-id="${dp.id}">Diese Ernährungsform wählen</button></div>` : ''); };
KNOW.mahlzeiten = () => {
  const dc = dietCfg(), t = targets(), m = dc?.meals || 3;
  return `${back('#wissen', 'Wissen')}<div class="card"><h2>${MEALS_ADVICE.title}</h2>${lis(MEALS_ADVICE.points)}</div>
  <div class="card"><h2>Dein Mahlzeitenplan</h2>
    <label class="f">Mahlzeiten pro Tag<select data-meals="1">${[2, 3, 4, 5].map(x => `<option ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <p class="small">Damit je Mahlzeit etwa <b>${round5(t.pMin / m)} g Eiweiß</b> und ${round10(t.kcal / m)} kcal.</p>
    <p class="small muted">Aktuell isst du 1–2× am Tag. Steigere dich schrittweise: erst 2 Mahlzeiten plus Eiweißsnack, nach 2–3 Wochen 3 Mahlzeiten.</p></div>`;
};
KNOW.cheat = () => {
  const t = targets(), tdee = round10(t.ad ? t.ad.tdee : t.kcal + (t.deficit || 700));
  return `${back('#wissen', 'Wissen')}<div class="card"><h2>Cheat Day: was wirklich passiert</h2>${lis(CHEAT.points)}</div>
  <div class="card hero"><h2>Empfehlung</h2><p class="small">${h(CHEAT.rec)}</p></div>
  <div class="card"><h2>Rechner: Was kostet mich ein Cheat Day?</h2>
    <label class="f">Was isst du an dem Tag ungefähr? (kcal)<input id="cheatK" inputmode="numeric" value="4500" data-cheat="1"></label>
    <div id="cheatOut"></div>
    <p class="small muted">Gerechnet mit deinem Verbrauch von etwa ${fmt(tdee, 0)} kcal und deinem täglichen Defizit von etwa ${fmt(Math.max(1, tdee - t.kcal), 0)} kcal.</p></div>`;
};
function cheatCalc() {
  const el = $('#cheatOut'); if (!el) return;
  const t = targets(), tdee = t.ad ? t.ad.tdee : t.kcal + (t.deficit || 700), def = Math.max(1, tdee - t.kcal);
  const k = num($('#cheatK').value) || 0, surplus = k - tdee;
  el.innerHTML = surplus <= 0 ? '<p class="small">Damit bleibst du unter deinem Verbrauch. Kein Fettzuwachs.</p>' : `
    <div class="grid2"><div><p class="small muted">Überschuss</p><b class="num">${fmt(round10(surplus), 0)} kcal</b></div><div><p class="small muted">Echtes Fett</p><b class="num">≈ ${fmt(surplus / 7700 * 1000, 0)} g</b></div>
    <div><p class="small muted">Defizit-Tage gelöscht</p><b class="num">${fmt((k - t.kcal) / def, 1)} Tage</b></div><div><p class="small muted">Waage morgen</p><b class="num">+1 bis 3 kg</b></div></div>
    <p class="small">Die Waage zeigt morgen deutlich mehr, das ist überwiegend Wasser und verschwindet in 2–4 Tagen. Echter Schaden: Deine Woche verliert etwa ${fmt((k - t.kcal) / def, 1)} Tage Fortschritt.</p>`;
}
KNOW.supplements = () => `${back('#wissen', 'Wissen')}
  <div class="card"><h2>Supplements nach Studienlage</h2><p class="small muted">Bewertet nach kontrollierten Studien und Metaanalysen, nicht nach Herstellerangaben. Vor der Einnahme Blutwerte beim Hausarzt prüfen lassen.</p></div>
  ${SUPPS.map(x => `<div class="card"><div class="ev ${x.s}"><div class="row between wrap"><h3>${h(x.name)}</h3><span class="chip ${SUPP_LABEL[x.s][0]}">${SUPP_LABEL[x.s][1]}</span></div><p class="small">${h(x.what)}</p><p class="small muted"><b>Einnahme:</b> ${h(x.dose)}</p></div></div>`).join('')}`;
KNOW.training = () => `${back('#wissen', 'Wissen')}<div class="card"><h2>Richtig trainieren</h2>${KNOW_TRAINING.map(([t, x]) => `<div class="ev s3"><h3>${t}</h3><p class="small">${h(x)}</p></div>`).join('')}</div>`;
KNOW.haut = () => `${back('#wissen', 'Wissen')}<div class="card"><h2>Abnehmen und Haut</h2>${KNOW_SKIN.map(([t, x]) => `<div class="ev s3"><h3>${t}</h3><p class="small">${h(x)}</p></div>`).join('')}</div>`;

/* Beratung */
let quiz = { step: 0, a: {} };
function scoreDiets(a) {
  const s = { flex: 6, med: 5, lc: 3, lf: 3, veg: 0, keto: -2 }, why = { flex: [], med: [], lc: [], lf: [], veg: [], keto: [] };
  const add = (k, n, r) => { s[k] += n; if (r && n > 0) why[k].push(r); };
  if (a.meat === 'veg') { add('veg', 12, 'Du isst lieber vegetarisch.'); s.med -= 2; s.keto -= 4; s.flex -= 2; }
  if (a.meat === 'some') { add('med', 3, 'Fisch und Geflügel sind die Basis der Mittelmeerkost.'); add('veg', 2); }
  if (a.struggle === 'sweets') { add('lc', 3, 'Weniger Kohlenhydrate dämpfen bei vielen den Heißhunger auf Süßes.'); add('keto', 1); }
  if (a.struggle === 'volume') { add('lf', 3, 'Fettarm erlaubt die größten Portionen pro Kalorie.'); add('med', 1, 'Viel Gemüse und Hülsenfrüchte machen satt.'); s.keto -= 1; }
  if (a.struggle === 'time') { add('flex', 2, 'Keine Verbote, einfache Gerichte, wenig Planung.'); s.med -= 1; }
  if (a.struggle === 'evening') { add('flex', 1, 'Du kannst abends eine große Mahlzeit fest einplanen.'); }
  if (a.taste === 'carbs') { add('lf', 3, 'Brot, Reis und Kartoffeln bleiben fester Bestandteil.'); s.lc -= 3; s.keto -= 6; }
  if (a.taste === 'fat') { add('lc', 3, 'Fleisch, Eier und Käse bleiben fester Bestandteil.'); add('keto', 2); s.lf -= 3; }
  if (a.taste === 'both') { add('flex', 2, 'Du magst Abwechslung, hier ist nichts verboten.'); add('med', 2); }
  const hl = a.health || [];
  if (hl.includes('bp')) add('med', 2, 'Gut bei Bluthochdruck, zusammen mit dem Salzarm-Baustein.');
  if (hl.includes('sugar')) { add('lc', 3, 'Weniger Kohlenhydrate verbessern den Blutzucker.'); add('med', 1); }
  if (hl.includes('lipids')) { add('med', 3, 'Senkt Blutfette und schützt das Herz am besten belegt.'); s.keto -= 3; add('lf', 1); }
  if (a.cook === 'little') { add('flex', 2, 'Funktioniert auch mit schnellen Gerichten.'); add('lf', 1); s.med -= 1; }
  if (a.cook === 'love') add('med', 3, 'Abwechslungsreiche Küche mit viel Gemüse und Fisch.');
  if (a.rules === 'strict') { add('lc', 2, 'Klare Grenze bei Kohlenhydraten, wenig Nachdenken.'); add('keto', 2); s.flex -= 2; }
  if (a.rules === 'flex') { add('flex', 3, 'Nichts ist verboten, du entscheidest selbst.'); s.keto -= 3; }
  why.flex.push('Beste Studienlage für Fettabbau bei gleichzeitigem Muskelaufbau.');
  why.keto.push('Für Muskelaufbau und intensives Training eher ungünstig.');
  return DIET_PLANS.map(d => ({ d, s: s[d.id], why: why[d.id] })).sort((x, y) => y.s - x.s);
}
VIEWS.beratung = () => {
  const q = QUIZ[quiz.step];
  if (q) {
    const v = quiz.a[q.id];
    return `<div class="card"><div class="row between"><span class="label">Frage ${quiz.step + 1} von ${QUIZ.length}</span>${quiz.step ? '<button class="ghost" data-act="quizBack">Zurück</button>' : '<a class="small link" href="#wissen">Abbrechen</a>'}</div>
      <div class="bar"><i style="width:${(quiz.step) / QUIZ.length * 100}%"></i></div>
      <h2 class="qh">${h(q.q)}</h2>
      <div class="opts">${q.a.map(([k, l]) => `<button class="opt${(q.multi ? (v || []).includes(k) : v === k) ? ' on' : ''}" data-act="quizAnswer" data-k="${k}">${h(l)}</button>`).join('')}</div>
      ${q.multi ? '<button data-act="quizNext">Weiter</button>' : ''}</div>`;
  }
  const res = scoreDiets(quiz.a), top = res[0];
  const tre = quiz.a.morning === 'no', dash = (quiz.a.health || []).includes('bp');
  const curMeals = +quiz.a.meals || 1, mealsRec = curMeals <= 2 ? 3 : curMeals;
  return `<div class="card hero"><span class="label">Deine Empfehlung</span><h2>${h(top.d.name)}</h2><p class="small">${h(top.d.short)}</p>${lis(top.why.slice(0, 4))}
    <button data-act="chooseDiet" data-id="${top.d.id}" data-tre="${tre ? 1 : 0}" data-dash="${dash ? 1 : 0}" data-meals="${mealsRec}">Diesen Plan übernehmen</button></div>
  ${tre || dash ? `<div class="card"><h2>Empfohlene Bausteine</h2>${tre ? `<div class="ev s3"><h3>${ADDONS.tre.name}</h3><p class="small">Du hast morgens keinen Hunger. ${ADDONS.tre.text}</p></div>` : ''}${dash ? `<div class="ev s3"><h3>${ADDONS.dash.name}</h3><p class="small">${ADDONS.dash.text}</p></div>` : ''}<p class="small muted">Werden mit dem Plan übernommen und sind jederzeit abschaltbar.</p></div>` : ''}
  <div class="card"><h2>Mahlzeiten</h2><p class="small">Du isst aktuell ${curMeals === 1 ? 'einmal' : curMeals + '-mal'} am Tag. Für den Muskelaufbau empfehle ich dir <b>${mealsRec} Mahlzeiten</b>, schrittweise eingeführt.</p><a class="small link" href="#wissen/mahlzeiten">Warum? ›</a></div>
  <div class="card"><h2>Alternativen</h2><div class="list">${res.slice(1, 4).map(r => `<div class="item"><div class="grow"><b>${h(r.d.name)}</b><p class="small muted">${h(r.why[0] || r.d.short)}</p></div><button class="sec" data-act="chooseDiet" data-id="${r.d.id}" data-tre="${tre ? 1 : 0}" data-dash="${dash ? 1 : 0}" data-meals="${mealsRec}">Wählen</button></div>`).join('')}</div>
  <a class="small link" href="#wissen/formen">Alle Formen ansehen ›</a></div>
  <div class="card"><button class="sec" data-act="quizRestart">Beratung neu starten</button></div>`;
};

/* Einstellungen */
VIEWS.setup = (sub, arg) => (SETUP[sub] || SETUP.index)(arg);
const SETUP = {};
SETUP.index = () => `<div class="card"><div class="list">
  ${[['training', 'Training', 'Geräte, Übungen, Pläne, Verlauf'], ['ernaehrung', 'Ernährung und Ziele', 'Ernährungsform, Bausteine, Mahlzeiten, Kalorien- und Eiweißziel'], ['gewohnheiten', 'Gewohnheiten', 'Anlegen, umbenennen, sortieren'], ['profil', 'Profil', 'Größe, Alter, Start- und Zielgewicht'], ['daten', 'Datensicherung', 'Backup erstellen und wiederherstellen']]
    .map(([k, t, s]) => `<a class="item navitem" href="#setup/${k}"><div class="grow"><b>${t}</b><p class="small muted">${s}</p></div>›</a>`).join('')}
  </div></div>`;
SETUP.training = sub => {
  sub = sub === 'geraete' ? 'uebungen' : sub || 'plaene';
  const tabs = [['plaene', 'Pläne'], ['uebungen', 'Übungen & Geräte'], ['verlauf', 'Verlauf']];
  return back('#setup', 'Einstellungen') + `<div class="seg">${tabs.map(([k, l]) => `<button class="${sub === k ? 'on' : ''}" data-act="go" data-href="#setup/training/${k}">${l}</button>`).join('')}</div>` + (TRAIN[sub] || TRAIN.plaene)();
};
const TRAIN = {};
/* Dein letztes Training vor der App, zum einmaligen Übernehmen */
const LAST_TRAINING = [
  ['Schrägbankdrücken', 'Brust', 'kg', 2.5, 6, 10, [[50, 6], [50, 6], [50, 5]]],
  ['Latziehen', 'Rücken', 'kg', 2.5, 8, 12, [[50, 16], [50, 16], [50, 16]]],
  ['Rudern', 'Rücken', 'kg', 2.5, 8, 12, [[40, 16], [40, 16], [40, 16]]],
  ['Butterfly', 'Brust', 'kg', 2.5, 10, 15, [[25, 13], [25, 13], [25, 13]]],
  ['Latpumpe', 'Rücken', 'stufe', 1, 10, 15, [[3, 13], [3, 13], [3, 13]]],
  ['Seitheben', 'Schultern', 'none', 0, 12, 20, [[0, 40], [0, 40], [0, 40]]],
  ['Bizepscurls', 'Bizeps', 'kg', 2, 10, 15, [[5, 12], [5, 12], [5, 12]]],
  ['Trizeps am Kabelzug', 'Trizeps', 'stufe', 1, 10, 15, [[4, 18], [4, 18], [4, 18]]]
];
function exerciseForm(ed) {
  const u = ed?.unit || 'kg', [r0, r1] = DEF_REPS[u];
  return `<form data-form="exercise" class="stack"><input type="hidden" name="id" value="${ed?.id || ''}">
    <label class="f">Name<input name="name" list="exsuggest" required value="${h(ed?.name)}" placeholder="Name, den ihr benutzt, z. B. Latziehen"></label>
    <datalist id="exsuggest">${EX_SUGGEST.map(x => `<option value="${h(x)}">`).join('')}</datalist>
    <label class="photoin"><input type="file" name="photo" accept="image/*" hidden><span>${ed?.photo ? 'Gerätefoto ersetzen' : '+ Foto vom Gerät'}</span></label>
    <div class="grid2">
      <label class="f">Gewichtsart<select name="unit">${Object.entries(UNITS).map(([k, [l]]) => `<option value="${k}" ${u === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Muskel<select name="muscle">${MUSCLES.map(m => `<option ${ed?.muscle === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="f">Wdh. von<input name="repMin" inputmode="numeric" value="${ed?.repMin ?? r0}"></label>
      <label class="f">Wdh. bis<input name="repMax" inputmode="numeric" value="${ed?.repMax ?? r1}"></label>
      <label class="f">Sätze<input name="sets" inputmode="numeric" value="${ed?.sets ?? 3}"></label>
      <label class="f">Pause (Sekunden)<input name="rest" inputmode="numeric" value="${ed?.rest ?? 90}"></label>
    </div>
    <label class="f">Gewichtssprung<input name="step" inputmode="decimal" value="${ed?.step != null ? fmt(ed.step, 2) : ''}" placeholder="automatisch (kg 2,5 · Stufe 1)"></label>
    <p class="small muted">Gewichtssprung: um wie viel du mindestens erhöhen kannst. Steckgewichte in 5-kg-Schritten → 5, Kurzhanteln 10/12/14 → 2, Stufen → 1.</p>
    <label class="f">Einstellung am Gerät / Notiz<input name="note" value="${h(ed?.note)}" placeholder="z. B. Sitz Stufe 4, Polster oben"></label>
    <button>${ed ? 'Änderungen speichern' : 'Übung anlegen'}</button></form>`;
}
TRAIN.plaene = () => {
  const ts = all('templates').sort((a, b) => a.order - b.order);
  const exs = all('exercises').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const imp = !kv('import.last1', false) ? `<div class="card hero"><h2>Dein letztes Training übernehmen</h2>
    <p class="small">${LAST_TRAINING.map(x => x[0]).join(', ')}. Legt die Übungen samt Gewichtsart an, fügt sie einem Plan hinzu und speichert das Training mit deinen Werten. Danach schlägt dir die App beim nächsten Mal direkt die Steigerung vor.</p>
    <form data-form="importLast" class="stack"><div class="grid2">
      <label class="f">Datum des Trainings<input type="date" name="date" value="${addDays(today(), -1)}" max="${today()}"></label>
      <label class="f">In welchen Plan?<select name="plan">${ts.map(t => `<option value="${t.id}" ${/oberk.*a/i.test(t.name) ? 'selected' : ''}>${h(t.name)}</option>`).join('')}<option value="new">Neuer Plan „Oberkörper"</option></select></label></div>
      <div class="row"><button class="grow">Übernehmen</button><button type="button" class="sec" data-act="kv" data-k="import.last1" data-v="1">Nicht nötig</button></div></form></div>` : '';
  return `${imp}
  <div class="card"><p class="small muted">Jeder Plan hat zwei Phasen: <b>Aufwärmen</b> (zum Abhaken) und <b>Training</b> (Übungen mit Gewicht). Neue Geräte legst du direkt hier im Plan an: Name, Foto, fertig. Details wie Wiederholungen und Pause kannst du später auf der Übungsseite ändern.</p></div>
  ${ts.map(t => `<div class="card plan">
    <div class="row"><input value="${h(t.name)}" data-tname="${t.id}" aria-label="Name des Plans" class="strong"><button class="icon" data-act="delTemplate" data-id="${t.id}" aria-label="Plan löschen">×</button></div>
    <p class="label">1 · Aufwärmen</p>
    <div class="list">${(t.warmup || []).map((w, i) => `<div class="item"><span class="grow"><b>${h(w.name)}</b> <span class="small muted">${w.sets}×${w.detail ? ' ' + h(w.detail) : ''}</span></span>
      <button class="icon" data-act="moveWarm" data-id="${t.id}" data-i="${i}" data-dir="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon" data-act="delWarm" data-id="${t.id}" data-i="${i}" aria-label="Entfernen">×</button></div>`).join('') || '<p class="small muted">Noch kein Aufwärmen.</p>'}</div>
    <form data-form="warmup" class="warmform"><input type="hidden" name="plan" value="${t.id}">
      <input name="name" list="warmsuggest" required placeholder="z. B. Ergometer" aria-label="Aufwärmübung">
      <input name="sets" inputmode="numeric" value="1" aria-label="Sätze">
      <input name="detail" placeholder="5 min / 15 Wdh." aria-label="Dauer oder Wiederholungen">
      <button>+</button></form>
    <datalist id="warmsuggest">${WARM_SUGGEST.map(x => `<option value="${h(x)}">`).join('')}</datalist>
    <p class="label">2 · Training</p>
    <div class="list">${t.items.map((id, i) => { const ex = S.exercises.get(id), ph = exPhoto(ex); return `<div class="item">${ph ? `<img class="mini" src="${ph}" alt="">` : `<span class="mini ph">${i + 1}</span>`}
      <a class="grow navitem" href="#uebung/${id}"><b>${h(exName(id))}</b><p class="small muted">${ex ? `${ex.sets}×${ex.repMin}–${ex.repMax} · ${UNITS[exUnit(ex)][0]}` : ''}</p></a>
      <button class="icon" data-act="moveItem" data-id="${t.id}" data-i="${i}" data-dir="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="icon" data-act="removeItem" data-id="${t.id}" data-i="${i}" aria-label="Aus Plan entfernen">×</button></div>`; }).join('') || '<p class="small muted">Noch keine Übungen.</p>'}</div>
    ${exs.filter(x => !t.items.includes(x.id)).length ? `<select data-addto="${t.id}" aria-label="Vorhandene Übung hinzufügen"><option value="">+ Vorhandene Übung hinzufügen</option>${exs.filter(x => !t.items.includes(x.id)).map(x => `<option value="${x.id}">${h(x.name)}</option>`).join('')}</select>` : ''}
    <details><summary class="small link">+ Neues Gerät / neue Übung anlegen</summary>${quickExForm('plan:' + t.id, false)}</details>
  </div>`).join('')}
  <div class="card"><form data-form="template" class="row"><input name="name" placeholder="Neuer Plan, z. B. Oberkörper B" required><button>Anlegen</button></form></div>`;
};
TRAIN.uebungen = () => {
  const exs = all('exercises').sort((a, b) => MUSCLES.indexOf(a.muscle) - MUSCLES.indexOf(b.muscle) || a.name.localeCompare(b.name, 'de'));
  let lastMuscle = null;
  return `<div class="card"><h2>Neue Übung</h2><p class="small muted">Gerät und Übung sind eins: Gib ihr einen Namen, den ihr benutzt, und fotografiere das Gerät, damit du es wiedererkennst.</p>${exerciseForm(null)}</div>
  <div class="card"><h2>Deine Übungen (${exs.length})</h2><div class="list">${exs.map(x => {
    const hst = exHistory(x.id), ph = exPhoto(x), head = x.muscle !== lastMuscle ? `<p class="label" style="padding-top:10px">${h(x.muscle || 'Ohne Muskel')}</p>` : '';
    lastMuscle = x.muscle;
    return `${head}<a class="item navitem" href="#uebung/${x.id}">${ph ? `<img class="mini" src="${ph}" alt="">` : '<span class="mini ph">?</span>'}<div class="grow"><b>${h(x.name)}</b><p class="small muted">${UNITS[exUnit(x)][0]} · ${x.sets}×${x.repMin}–${x.repMax}${hst.length ? ` · zuletzt ${fmtTop(x, topLoad(x, hst[hst.length - 1].sets))}` : ''}</p></div>›</a>`;
  }).join('') || '<p class="empty">Noch keine Übungen.</p>'}</div></div>`;
};
TRAIN.verlauf = () => {
  const ws = all('workouts').sort(wSort);
  return `<div class="card"><h2>Trainings (${ws.length})</h2>
  <div class="list">${ws.map(w => `<details class="item block"><summary class="row between"><span><b>${h(w.name)}</b> <span class="small muted">${wday(w.date)}, ${dlong(w.date)}</span></span><span class="small muted num">${workoutSets(w)} Sätze</span></summary>
      <div class="list small">${w.entries.filter(e => e.sets.some(s => s.done)).map(e => { const ex = S.exercises.get(e.exerciseId); return `<div class="item"><span class="grow">${h(exName(e.exerciseId))}</span><span class="num muted">${e.sets.filter(s => s.done).map(s => fmtSet(s, ex)).join(' · ')}</span></div>`; }).join('')}</div>
      <label class="f">Datum ändern<input type="date" data-wdate="${w.id}" value="${w.date}" max="${today()}"></label>
      <button class="danger" data-act="delWorkout" data-id="${w.id}">Training löschen</button></details>`).join('') || '<p class="empty">Noch kein Training gespeichert.</p>'}</div></div>`;
};
/* Übungsseite: Foto, Fortschritt, Verlauf, Einstellungen */
VIEWS.uebung = id => {
  const ex = S.exercises.get(id);
  if (!ex) return `${back('#setup/training/uebungen', 'Übungen')}<div class="card"><p class="empty">Übung nicht gefunden.</p></div>`;
  const hst = exHistory(id), ph = exPhoto(ex), u = exUnit(ex);
  const tops = hst.map(x => ({ d: x.date, y: topLoad(ex, x.sets) }));
  const first = tops[0], last = tops[tops.length - 1], best = tops.length ? Math.max(...tops.map(p => p.y)) : null;
  const sg = suggest(ex);
  return `${back('#setup/training/uebungen', 'Übungen')}
  <div class="card">
    ${ph ? `<button class="exbig" data-act="zoomEx" data-id="${ex.id}"><img src="${ph}" alt="Gerät ${h(ex.name)}"></button>` : ''}
    <h2>${h(ex.name)}</h2><p class="small muted">${h(ex.muscle || '')} · ${UNITS[u][0]} · ${ex.sets}×${ex.repMin}–${ex.repMax} · Pause ${ex.rest || 90} s${ex.note ? ' · ' + h(ex.note) : ''}</p>
    <label class="btn sec" for="exPhotoIn" data-exid="${ex.id}">${ph ? 'Foto ersetzen' : '+ Foto vom Gerät'}</label><input type="file" id="exPhotoIn" accept="image/*" hidden>
  </div>
  <div class="card"><h2>Fortschritt</h2>
    ${tops.length ? `<div class="grid2"><div><p class="small muted">Erstes Training</p><b class="num">${fmtTop(ex, first.y)}</b></div><div><p class="small muted">Zuletzt</p><b class="num">${fmtTop(ex, last.y)}</b></div>
      <div><p class="small muted">Bestwert</p><b class="num">${fmtTop(ex, best)}</b></div><div><p class="small muted">Steigerung</p><b class="num">${sign(last.y - first.y)}${fmt(last.y - first.y, 2)} ${unitShort(ex) || 'Wdh.'}</b></div></div>
      ${chart([{ pts: tops, cls: 'line' }], { label: 'Höchstes Gewicht pro Training', h: 150, empty: 'Ab zwei Trainings siehst du hier die Kurve.' })}` : '<p class="empty">Noch nicht trainiert.</p>'}
    <p class="hint">${h(sg.text)}</p>
  </div>
  ${hst.length ? `<div class="card"><h2>Verlauf</h2><div class="list">${hst.slice().reverse().map(x => `<div class="item"><span class="small muted num" style="min-width:74px">${dlong(x.date)}</span><span class="grow num small">${x.sets.map(s => fmtSet(s, ex)).join(' · ')}</span></div>`).join('')}</div></div>` : ''}
  <details class="card"><summary><b>Einstellungen bearbeiten</b></summary>${exerciseForm(ex)}</details>
  <div class="card"><button class="danger" data-act="delExercise" data-id="${ex.id}">Übung löschen</button><p class="small muted">Gespeicherte Trainings bleiben erhalten.</p></div>`;
};
function strengthCard() {
  const rows = all('exercises').map(ex => ({ ex, hst: exHistory(ex.id) })).filter(x => x.hst.length).sort((a, b) => a.ex.name.localeCompare(b.ex.name, 'de'));
  if (!rows.length) return '<div class="card"><h2>Kraft je Übung</h2><p class="empty">Nach dem ersten Training siehst du hier für jede Übung, wie sich dein Gewicht steigert.</p></div>';
  return `<div class="card"><h2>Kraft je Übung</h2><p class="small muted">Höchstes Gewicht pro Training, ohne Gewicht die meisten Wiederholungen. Antippen für alle Details.</p>
    <div class="kgrid">${rows.map(({ ex, hst }) => {
      const f = topLoad(ex, hst[0].sets), l = topLoad(ex, hst[hst.length - 1].sets), dl = l - f;
      return `<a class="kraft" href="#uebung/${ex.id}"><div class="row between"><b>${h(ex.name)}</b><span class="chip ${dl > 0 ? 'c-go' : 'c-acc'}">${dl === 0 ? 'gleich' : `${dl > 0 ? '+' : ''}${fmt(dl, 2)} ${unitShort(ex) || 'Wdh.'}`}</span></div>
        <p class="small muted">${fmtTop(ex, f)} → ${fmtTop(ex, l)} · ${hst.length} Training${hst.length > 1 ? 's' : ''}</p>
        ${hst.length > 1 ? chart([{ pts: hst.map(x => ({ d: x.date, y: topLoad(ex, x.sets) })), cls: 'line' }], { h: 90, label: ex.name, minPad: 1 }) : ''}</a>`;
    }).join('')}</div></div>`;
}
SETUP.ernaehrung = () => {
  const dc = dietCfg(), dp = dietPlan(), t = targets(), man = kv('targets.manual', {});
  return `${back('#setup', 'Einstellungen')}
  <div class="card"><h2>Ernährungsform</h2>
    <p>${dp ? `<b>${h(dp.name)}</b> <span class="small muted">seit ${dlong(dc.date)}</span>` : '<span class="muted">Noch nicht gewählt.</span>'}</p>
    <label class="f">Wechseln zu<select data-dietsel="1"><option value="">wählen</option>${DIET_PLANS.map(d => `<option value="${d.id}" ${dc?.id === d.id ? 'selected' : ''}>${h(d.name)}</option>`).join('')}</select></label>
    <div class="row wrap"><a class="btn sec" href="#beratung" data-act="quizRestart">Beratung wiederholen</a>${dp ? '<a class="btn sec" href="#wissen/plan">Plan ansehen</a>' : ''}</div>
  </div>
  ${dc ? `<div class="card"><h2>Bausteine</h2>${Object.entries(ADDONS).map(([k, a]) => `<div class="item row"><button class="check${dc.addons?.[k] ? ' on' : ''}" data-act="addon" data-k="${k}" aria-pressed="${!!dc.addons?.[k]}" aria-label="${a.name}"></button><div class="grow"><b>${a.name}</b><p class="small muted">${a.text}</p></div></div>`).join('')}</div>
  <div class="card"><h2>Mahlzeiten pro Tag</h2><select data-meals="1">${[2, 3, 4, 5].map(x => `<option ${x === (dc.meals || 3) ? 'selected' : ''}>${x}</option>`).join('')}</select><p class="small muted">Je Mahlzeit etwa ${round5(t.pMin / (dc.meals || 3))} g Eiweiß.</p></div>` : ''}
  <div class="card"><h2>Tagesziele</h2>
    <p class="small muted">Leer lassen = automatisch berechnet (empfohlen). Aktuell: ${fmt(t.kcal, 0)} kcal, ${t.pMin} g Eiweiß. ${h(t.src)}.</p>
    <form data-form="targets" class="stack"><div class="grid2">
      <label class="f">Kalorien fest<input name="kcal" inputmode="numeric" value="${man.kcal ?? ''}" placeholder="automatisch"></label>
      <label class="f">Eiweiß fest (g)<input name="protein" inputmode="numeric" value="${man.protein ?? ''}" placeholder="automatisch"></label>
    </div><button>Ziele speichern</button></form>
    <p class="small muted">Zielgewicht und Startdaten änderst du unter <a class="link" href="#setup/profil">Profil</a>.</p></div>`;
};
SETUP.gewohnheiten = () => {
  const hs = all('habits').sort((a, b) => a.order - b.order), d = today(), days = [...Array(14)].map((_, i) => addDays(d, -13 + i));
  return `${back('#setup', 'Einstellungen')}
  <div class="card"><h2>Deine Gewohnheiten</h2><p class="small muted">Name antippen zum Umbenennen. Abhaken, auch nachträglich, in der Tagesansicht über die Pfeile neben dem Datum.</p>
    <div class="list">${hs.map((x, i) => `<div class="item"><div class="grow"><input value="${h(x.name)}" data-hname="${x.id}" aria-label="Name der Gewohnheit">
        <div class="row" style="gap:3px;padding-top:6px">${days.map(dd => `<span class="hd${S.habitLog.get(dd)?.done?.[x.id] ? ' on' : ''}" title="${dlong(dd)}"></span>`).join('')}</div></div>
        <button class="icon" data-act="moveHabit" data-i="${i}" data-dir="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon" data-act="delHabit" data-id="${x.id}" aria-label="Gewohnheit löschen">×</button></div>`).join('') || '<p class="empty">Keine Gewohnheiten.</p>'}</div>
    <form data-form="habit" class="row"><input name="name" placeholder="Neue Gewohnheit" required><button>Hinzufügen</button></form>
  </div>`;
};
SETUP.profil = () => {
  const p = prof();
  return `${back('#setup', 'Einstellungen')}
  <div class="card"><h2>Profil und Ziele</h2>
  <form data-form="profile" class="stack"><div class="grid2">
    <label class="f">Größe (cm)<input name="height" inputmode="numeric" value="${p.height}"></label>
    <label class="f">Alter<input name="age" inputmode="numeric" value="${p.age}"></label>
    <label class="f">Geschlecht<select name="sex"><option value="m" ${p.sex === 'm' ? 'selected' : ''}>männlich</option><option value="w" ${p.sex === 'w' ? 'selected' : ''}>weiblich</option></select></label>
    <label class="f">Startdatum<input type="date" name="startDate" value="${p.startDate || today()}"></label>
    <label class="f">Startgewicht (kg)<input name="start" inputmode="decimal" value="${fmt(p.start)}"></label>
    <label class="f">Zielgewicht (kg)<input name="goal" inputmode="decimal" value="${fmt(p.goal)}"></label>
  </div><button>Speichern</button></form>
  <p class="small muted">Das Zielgewicht bestimmt dein Eiweißziel. Mit mehr Muskelmasse kann ein etwas höheres Ziel (88–92 kg) besser aussehen.</p></div>`;
};
let pendingImport = null;
SETUP.daten = () => {
  const lb = kv('lastBackup', null), n = Object.keys(STORES).filter(s => s !== 'kv').reduce((a, s) => a + S[s].size, 0);
  return `${back('#setup', 'Einstellungen')}
  <div class="card"><h2>Wo deine Daten liegen</h2>
    <p class="small">Alle Daten liegen ausschließlich auf diesem Gerät. Kein Server, keine Cloud. Updates der App ändern nur den Programmcode, die Datenbank bleibt erhalten.</p>
    <p class="small"><b>Dauerhafter Speicher:</b> <span id="persist">wird geprüft…</span></p>
    <p class="small muted">${n} Einträge, davon ${S.photos.size} Fotos.${lb ? ` Letztes Backup: ${dlong(lb)}.` : ' Noch kein Backup.'}</p></div>
  <div class="card"><h2>Backup erstellen</h2>
    <p class="small muted">Auf dem iPhone „In Dateien sichern" wählen, am besten in einen festen Ordner. Ab und zu auf den PC kopieren.</p>
    <button data-act="backup">Backup ohne Fotos (klein)</button>
    ${S.photos.size ? '<button class="sec" data-act="backup" data-photos="1">Backup mit Fotos (groß)</button>' : ''}</div>
  <div class="card"><h2>Backup wiederherstellen</h2>
    <p class="small muted">Ersetzt die aktuellen Daten durch den Inhalt der Datei. Ein Backup ohne Fotos lässt vorhandene Fotos unangetastet.</p>
    <label class="btn sec" for="importFile">Datei auswählen</label><input type="file" id="importFile" accept="application/json,.json" hidden>
    <div id="importInfo"></div></div>
  <div class="card warnbox"><h2>Wichtig</h2><p class="small">Wenn du die App vom Home-Bildschirm löschst, löscht iOS auch ihre Daten. Dagegen hilft nur das Backup.</p></div>`;
};

/* ---------- Aktionen ---------- */
const ACT = {}, FORM = {};
function armed(el, label = 'Sicher?') {
  if (el.dataset.armed) return true;
  el.dataset.armed = '1'; const old = el.textContent; el.textContent = label;
  setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = old; } }, 3000);
  return false;
}
ACT.go = el => { location.hash = el.dataset.href; };
ACT.kv = async el => { await setKv(el.dataset.k, el.dataset.num ? +el.dataset.v : el.dataset.v); render(); };
ACT.day = el => { const n = addDays(cur, +el.dataset.n); if (n <= today()) { cur = n; followToday = n === today(); render(); } };
ACT.dayToday = () => { cur = today(); followToday = true; render(); };
ACT.metric = async el => {
  const sel = kv('stats.metrics', ['weight', 'bf', 'm_waist', 'protein']);
  const id = el.dataset.id, next = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
  await setKv('stats.metrics', next); render();
};
ACT.habit = async el => {
  const log = S.habitLog.get(cur) || { date: cur, done: {} };
  log.done = { ...log.done, [el.dataset.id]: !log.done[el.dataset.id] };
  await put('habitLog', log); render();
};
ACT.delExercise = async el => {
  if (!armed(el, 'Wirklich löschen?')) return;
  await del('exercises', el.dataset.id);
  for (const t of all('templates')) if (t.items.includes(el.dataset.id)) await put('templates', { ...t, items: t.items.filter(i => i !== el.dataset.id) });
  location.hash = '#setup/training/uebungen';
};
ACT.moveWarm = async el => { const t = S.templates.get(el.dataset.id), i = +el.dataset.i, j = i + +el.dataset.dir, w = [...t.warmup]; [w[i], w[j]] = [w[j], w[i]]; await put('templates', { ...t, warmup: w }); render(); };
ACT.delWarm = async el => { const t = S.templates.get(el.dataset.id); await put('templates', { ...t, warmup: t.warmup.filter((_, i) => i !== +el.dataset.i) }); render(); };
ACT.zoomEx = el => { const ex = S.exercises.get(el.dataset.id); if (ex?.photo) openImage(exPhoto(ex), ex.name); };
ACT.delTemplate = async el => { if (!armed(el, '?')) return; await del('templates', el.dataset.id); render(); };
ACT.moveItem = async el => { const t = S.templates.get(el.dataset.id), i = +el.dataset.i, j = i + +el.dataset.dir, items = [...t.items]; [items[i], items[j]] = [items[j], items[i]]; await put('templates', { ...t, items }); render(); };
ACT.removeItem = async el => { const t = S.templates.get(el.dataset.id); await put('templates', { ...t, items: t.items.filter((_, i) => i !== +el.dataset.i) }); render(); };
ACT.delWorkout = async el => { if (!armed(el, 'Wirklich löschen?')) return; await del('workouts', el.dataset.id); render(); };
ACT.delHabit = async el => { if (!armed(el, '?')) return; await del('habits', el.dataset.id); render(); };
ACT.moveHabit = async el => {
  const hs = all('habits').sort((a, b) => a.order - b.order), i = +el.dataset.i, j = i + +el.dataset.dir;
  [hs[i], hs[j]] = [hs[j], hs[i]];
  for (let k = 0; k < hs.length; k++) await put('habits', { ...hs[k], order: k });
  render();
};
ACT.startWorkout = async el => {
  if (draft()) { location.hash = '#training'; return; }
  unlockAudio();
  const t = S.templates.get(el.dataset.id);
  const entries = t.items.filter(id => S.exercises.has(id)).map(id => makeEntry(S.exercises.get(id)));
  const warmup = (t.warmup || []).map(w => ({ name: w.name, detail: w.detail, done: Array(Math.max(1, +w.sets || 1)).fill(false) }));
  await setKv('draft', { id: uid(), date: cur, templateId: t.id, name: t.name, started: new Date().toISOString(), warmup, phase: warmup.length ? 'warm' : 'main', idx: 0, entries });
  location.hash = '#training';
};
ACT.startFree = async () => {
  if (draft()) { location.hash = '#training'; return; }
  unlockAudio();
  await setKv('draft', { id: uid(), date: cur, templateId: null, name: 'Freies Training', started: new Date().toISOString(), warmup: [], phase: 'main', idx: 0, entries: [] });
  location.hash = '#training/liste';
};
function curEntry(d) { return d.entries[curIdx(d)] || null; }
async function setCur(f, value) { // Wert für den aktuellen und alle folgenden offenen Sätze übernehmen
  const d = draft(), e = curEntry(d); if (!e) return;
  const ci = e.sets.findIndex(isOpen); if (ci < 0) return;
  for (let k = ci; k < e.sets.length; k++) if (isOpen(e.sets[k])) e.sets[k][f] = value;
  await saveDraft(d);
}
ACT.step = async el => {
  const d = draft(), e = curEntry(d), ex = S.exercises.get(e.exerciseId) || {}, cs = e.sets.find(isOpen); if (!cs) return;
  const f = el.dataset.f, st = f === 'kg' ? (incFor(ex) || 1) : 1;
  const v = Math.max(0, Math.round(((num(cs[f]) || 0) + +el.dataset.d * st) * 100) / 100);
  await setCur(f, String(v)); render();
};
ACT.rir = async el => { const d = draft(), cs = curEntry(d)?.sets.find(isOpen); if (!cs) return; cs.rir = cs.rir === el.dataset.v ? '' : el.dataset.v; await saveDraft(d); render(); };
ACT.doneSet = async () => {
  unlockAudio();
  const d = draft(), i = curIdx(d), e = d.entries[i]; if (!e) return; const ci = e.sets.findIndex(isOpen); if (ci < 0) return;
  const ex = S.exercises.get(e.exerciseId);
  if (exUnit(ex) !== 'none' && num(e.sets[ci].kg) == null) return toast(exUnit(ex) === 'stufe' ? 'Bitte die Stufe eintragen.' : 'Bitte das Gewicht eintragen.');
  if (!num(e.sets[ci].reps)) return toast('Bitte die Wiederholungen eintragen.');
  e.sets[ci].done = true;
  const finished = e.sets.every(isFinished);
  if (finished) d.idx = -1; // fertige Übung zuklappen, die nächste wählst du selbst
  d.restUntil = d.entries.some(x => x.sets.some(isOpen)) ? Date.now() + (ex?.rest || 90) * 1000 : null;
  await saveDraft(d); render();
  if (finished) toast(`${exName(e.exerciseId)} fertig ✓`);
};
ACT.skipSet = async () => {
  const d = draft(), e = curEntry(d); if (!e) return;
  const ci = e.sets.findIndex(isOpen); if (ci < 0) return;
  e.sets[ci].skipped = true;
  const finished = e.sets.every(isFinished);
  if (finished) d.idx = -1;
  await saveDraft(d); render();
  toast(finished ? `${exName(e.exerciseId)} abgeschlossen` : 'Satz übersprungen');
};
ACT.applySuggest = async () => {
  const d = draft(), e = curEntry(d); if (!e) return; const ex = S.exercises.get(e.exerciseId); if (!ex) return;
  const sg = suggest(ex, d.id);
  for (const st of e.sets) if (isOpen(st)) { if (sg.kg !== '') st.kg = String(sg.kg); st.reps = String(sg.reps); }
  await saveDraft(d); render(); toast('Vorschlag übernommen');
};
ACT.reopenSet = async el => { const d = draft(); if (!curEntry(d)) return; const st = curEntry(d).sets[+el.dataset.s]; st.done = false; st.skipped = false; await saveDraft(d); render(); };
ACT.addSet = async () => { const d = draft(), e = curEntry(d); if (!e) return; const l = e.sets[e.sets.length - 1] || { kg: '', reps: '' }; e.sets.push({ kg: l.kg, reps: l.reps, rir: '', done: false }); await saveDraft(d); render(); };
ACT.removeSet = async el => { // letzten Satz entfernen; ein bereits erledigter Satz braucht eine Bestätigung
  const d = draft(), e = curEntry(d); if (!e || e.sets.length <= 1) return;
  if (e.sets[e.sets.length - 1].done && !armed(el, 'Erledigten Satz löschen?')) return;
  e.sets.pop(); await saveDraft(d); render();
};
ACT.openEx = async el => {
  const d = draft(), i = +el.dataset.i; d.idx = curIdx(d) === i ? -1 : i; await saveDraft(d); render();
  if (d.idx >= 0) document.getElementById('ex-' + i)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
};
ACT.exNav = async el => { const d = draft(); d.idx = clamp(curIdx(d) + +el.dataset.d, 0, d.entries.length - 1); await saveDraft(d); render(); scrollTo(0, 0); };
ACT.jumpTo = async el => { const d = draft(); d.idx = +el.dataset.i; d.phase = 'main'; await saveDraft(d); location.hash = '#training'; };
ACT.goWarm = async () => { const d = draft(); d.phase = 'warm'; await saveDraft(d); location.hash = '#training'; };
ACT.warmSet = async el => { const d = draft(), w = d.warmup[+el.dataset.w]; w.done[+el.dataset.s] = !w.done[+el.dataset.s]; await saveDraft(d); render(); };
ACT.warmDone = async () => { const d = draft(); d.phase = 'main'; await saveDraft(d); render(); scrollTo(0, 0); };
ACT.moveEntry = async el => { const d = draft(), i = +el.dataset.i, j = i + +el.dataset.dir; [d.entries[i], d.entries[j]] = [d.entries[j], d.entries[i]]; await saveDraft(d); render(); };
ACT.removeEntry = async el => { if (!armed(el, '?')) return; const d = draft(); d.entries.splice(+el.dataset.i, 1); d.idx = clamp(d.idx || 0, 0, Math.max(0, d.entries.length - 1)); await saveDraft(d); render(); };
ACT.restAdd = async () => { const d = draft(); d.restUntil = Math.max(d.restUntil || 0, Date.now()) + 30000; await saveDraft(d); render(); };
ACT.restSkip = async () => { const d = draft(); d.restUntil = null; await saveDraft(d); render(); };
ACT.finishWorkout = async el => {
  const d = draft(), done = d.entries.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
  if (!done && !armed(el, 'Keine Sätze abgehakt. Trotzdem speichern?')) return;
  const { restUntil, idx, phase, ...rec } = d;
  await put('workouts', { ...rec, finished: new Date().toISOString() });
  await del('kv', 'draft');
  await setKv('lastSummary', d.id);
  cur = d.date;
  celebrateNext = !!done;
  location.hash = '#training/fertig';
};
ACT.discardWorkout = async el => { if (!armed(el, 'Wirklich verwerfen?')) return; await del('kv', 'draft'); location.hash = '#tag'; };
ACT.backup = el => exportBackup(!!el.dataset.photos);
ACT.restore = async el => {
  if (!pendingImport || !armed(el, 'Wirklich alle Daten ersetzen?')) return;
  for (const s of Object.keys(STORES)) {
    if (!pendingImport.stores[s]) continue; // fehlt im Backup (z. B. Fotos) → unangetastet lassen
    let rows = pendingImport.stores[s];
    if (s === 'exercises') rows = await Promise.all(rows.map(async r => r.photoData ? { ...r, photo: await (await fetch(r.photoData)).blob(), photoData: undefined } : r));
    if (s === 'photos') rows = await Promise.all(rows.map(async r => ({ ...r, blob: r.dataUrl ? await (await fetch(r.dataUrl)).blob() : r.blob, dataUrl: undefined })));
    const t = db.transaction(s, 'readwrite'), st = t.objectStore(s);
    st.clear(); for (const row of rows) st.put(row);
    await txDone(t);
  }
  pendingImport = null; photoURLs.clear(); await loadAll(); toast('Backup wiederhergestellt'); location.hash = '#tag';
};
ACT.openPhoto = el => openViewer(el.dataset.id);
ACT.closePhoto = closeViewer;
ACT.setCompare = el => { compare[el.dataset.k] = el.dataset.id; closeViewer(); render(); toast(el.dataset.k === 'a' ? 'Als Vorher gewählt' : 'Als Nachher gewählt'); };
ACT.delPhoto = async el => {
  if (!armed(el, 'Wirklich löschen?')) return;
  const id = el.dataset.id; await del('photos', id);
  if (photoURLs.has(id)) { URL.revokeObjectURL(photoURLs.get(id)); photoURLs.delete(id); }
  for (const k of ['a', 'b']) if (compare[k] === id) compare[k] = null;
  closeViewer(); render();
};
ACT.sharePhoto = async el => {
  const p = S.photos.get(el.dataset.id), name = `wandel-${p.date}-${p.pose.toLowerCase()}.jpg`;
  const file = new File([p.blob], name, { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch (e) { } return; }
  const a = document.createElement('a'); a.href = photoURL(p); a.download = name; document.body.appendChild(a); a.click(); a.remove();
};
ACT.quizAnswer = el => {
  const q = QUIZ[quiz.step], k = el.dataset.k;
  if (q.multi) {
    let v = quiz.a[q.id] || [];
    if (k === 'none') v = v.includes('none') ? [] : ['none'];
    else v = v.includes(k) ? v.filter(x => x !== k) : [...v.filter(x => x !== 'none'), k];
    quiz.a[q.id] = v; render();
  } else { quiz.a[q.id] = k; quiz.step++; render(); scrollTo(0, 0); }
};
ACT.quizNext = () => { quiz.step++; render(); scrollTo(0, 0); };
ACT.quizBack = () => { quiz.step = Math.max(0, quiz.step - 1); render(); };
ACT.quizRestart = () => { quiz = { step: 0, a: {} }; location.hash = '#beratung'; render(); };
ACT.chooseDiet = async el => {
  const old = dietCfg() || {};
  const fromQuiz = el.dataset.tre != null;
  await setKv('diet', {
    id: el.dataset.id, date: today(),
    addons: fromQuiz ? { tre: el.dataset.tre === '1', dash: el.dataset.dash === '1' } : (old.addons || { tre: false, dash: false }),
    meals: fromQuiz ? +el.dataset.meals : (old.meals || 3),
    answers: fromQuiz ? quiz.a : (old.answers || null)
  });
  toast('Ernährungsplan gespeichert');
  location.hash = '#wissen/plan';
};
ACT.addon = async el => { const dc = dietCfg(); dc.addons = { ...dc.addons, [el.dataset.k]: !dc.addons?.[el.dataset.k] }; await setKv('diet', dc); render(); };

FORM.weight = async f => {
  const kg = num(f.kg.value); if (!kg || kg < 30 || kg > 300) return toast('Bitte ein Gewicht in kg eingeben.');
  await put('weights', { ...(S.weights.get(cur) || {}), date: cur, kg }); toast('Gewicht gespeichert');
};
FORM.measure = async f => {
  const m = { ...(S.measures.get(cur) || {}), date: cur };
  let any = false;
  for (const [k] of MFIELDS) { const v = num(f[k].value); if (v) { m[k] = v; any = true; } }
  const fat = num(f.fat.value);
  if (fat) {
    const w = S.weights.get(cur);
    if (w) { await put('weights', { ...w, fat }); any = true; } else toast('Für den Körperfettwert der Waage zuerst das Gewicht des Tages eintragen.');
  }
  if (Object.keys(m).length > 1) await put('measures', m);
  if (any) toast('Messung gespeichert');
};
FORM.nutrition = async f => {
  const o = S.nutrition.get(cur) || {}, v = k => { const n = num(f[k].value); return n == null ? (f[k].value === '' ? null : o[k] ?? null) : n; };
  const rec = { date: cur, kcal: v('kcal'), protein: v('protein'), fat: v('fat'), carbs: v('carbs') };
  if ([rec.kcal, rec.protein, rec.fat, rec.carbs].every(x => x == null)) { if (S.nutrition.has(cur)) await del('nutrition', cur); return toast('Eintrag geleert'); }
  await put('nutrition', rec); toast('Gespeichert');
};
async function photoBlob(file) { const img = await loadImage(file); const blob = await resize(img, 1000, 'blob', 0.82); URL.revokeObjectURL(img.src); return blob; }
async function saveExercise(base, f) {
  const unit = f.unit?.value || base.unit || 'kg', [r0, r1] = DEF_REPS[unit];
  let repMin = Math.round(num(f.repMin?.value) || base.repMin || r0), repMax = Math.round(num(f.repMax?.value) || base.repMax || r1);
  if (repMax < repMin) [repMin, repMax] = [repMax, repMin];
  const ex = {
    ...base, name: f.name.value.trim(), unit, muscle: f.muscle?.value || base.muscle || '',
    repMin, repMax, sets: clamp(Math.round(num(f.sets?.value) || base.sets || 3), 1, 10), rest: clamp(Math.round(num(f.rest?.value) || base.rest || 90), 15, 600),
    step: f.step ? num(f.step.value) : base.step ?? null, note: f.note ? f.note.value.trim() : base.note || ''
  };
  if (f.step && num(f.step.value) == null) ex.step = UNITS[unit][1];
  const file = f.photo?.files?.[0];
  if (file) { try { ex.photo = await photoBlob(file); ex.photoAt = Date.now(); } catch (e) { toast(e.message); } }
  await put('exercises', ex);
  return ex;
}
FORM.exercise = async f => {
  const old = S.exercises.get(f.id.value);
  const ex = await saveExercise(old || { id: uid() }, f);
  toast(old ? 'Gespeichert' : `${ex.name} angelegt`);
};
FORM.quickEx = async f => {
  const name = f.name.value.trim(); if (!name) return;
  const exist = all('exercises').find(x => x.name.toLowerCase() === name.toLowerCase());
  const ex = exist || await saveExercise({ id: uid() }, f);
  const target = f.target.value;
  if (target === 'draft') {
    const d = draft(); d.entries.push(makeEntry(ex)); d.idx = d.entries.length - 1; d.phase = 'main'; await saveDraft(d);
    if (f.toPlan?.checked && d.templateId) { const t = S.templates.get(d.templateId); if (t && !t.items.includes(ex.id)) await put('templates', { ...t, items: [...t.items, ex.id] }); }
    location.hash = '#training';
  } else if (target.startsWith('plan:')) {
    const t = S.templates.get(target.slice(5)); if (t && !t.items.includes(ex.id)) await put('templates', { ...t, items: [...t.items, ex.id] });
  }
  toast(exist ? `${ex.name} hinzugefügt` : `${ex.name} angelegt`);
};
FORM.warmup = async f => {
  const t = S.templates.get(f.plan.value), name = f.name.value.trim(); if (!t || !name) return;
  await put('templates', { ...t, warmup: [...(t.warmup || []), { name, sets: clamp(Math.round(num(f.sets.value) || 1), 1, 10), detail: f.detail.value.trim() }] });
};
async function importLastTraining(date, planId) {
  let t = S.templates.get(planId) || all('templates').find(x => /oberk.*a$/i.test(x.name.trim()));
  if (!t) t = { id: uid(), name: 'Oberkörper A', items: [], warmup: [], order: Math.min(0, ...all('templates').map(x => x.order)) - 1 };
  const entries = [], items = [...t.items];
  for (const [name, muscle, unit, step, repMin, repMax, sets] of LAST_TRAINING) {
    let ex = all('exercises').find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!ex) { ex = { id: uid(), name, muscle, unit, step, repMin, repMax, sets: 3, rest: unit === 'kg' && repMin <= 8 ? 120 : 90, note: '' }; await put('exercises', ex); }
    if (!items.includes(ex.id)) items.push(ex.id);
    entries.push({ exerciseId: ex.id, sets: sets.map(([kg, reps]) => ({ kg: unit === 'none' ? '' : String(kg), reps: String(reps), rir: '', done: true })) });
  }
  await put('templates', { ...t, items, warmup: t.warmup || [] });
  await put('workouts', { id: uid(), date, templateId: t.id, name: t.name, started: date + 'T18:00:00', finished: date + 'T19:00:00', warmup: [], entries });
  await setKv('import.last1', true);
}
FORM.importLast = async f => { await importLastTraining(f.date.value || addDays(today(), -1), f.plan.value); toast('Letztes Training übernommen'); };
FORM.template = async f => { const order = Math.max(-1, ...all('templates').map(t => t.order)) + 1; await put('templates', { id: uid(), name: f.name.value.trim(), items: [], warmup: [], order }); };
FORM.habit = async f => { const order = Math.max(-1, ...all('habits').map(t => t.order)) + 1; await put('habits', { id: uid(), name: f.name.value.trim(), order, active: true }); };
FORM.profile = async f => {
  const p = prof();
  await setKv('profile', { height: num(f.height.value) || p.height, age: num(f.age.value) || p.age, sex: f.sex.value, start: num(f.start.value) || p.start, goal: num(f.goal.value) || p.goal, startDate: f.startDate.value || p.startDate });
  toast('Profil gespeichert');
};
FORM.targets = async f => {
  const k = num(f.kcal.value), pr = num(f.protein.value);
  await setKv('targets.manual', { kcal: k && k >= 1200 && k <= 5000 ? Math.round(k) : null, protein: pr && pr >= 50 && pr <= 300 ? Math.round(pr) : null });
  toast('Ziele gespeichert');
};

/* ---------- Backup ---------- */
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function exportBackup(withPhotos) {
  const data = { app: 'wandel', dbVersion: DB_VER, exported: new Date().toISOString(), stores: {} };
  for (const s of Object.keys(STORES)) if (s !== 'photos') data.stores[s] = all(s);
  data.stores.exercises = await Promise.all(all('exercises').map(async e => { if (!(e.photo instanceof Blob)) return e; const { photo, ...rest } = e; return { ...rest, photoData: await blobToDataURL(photo) }; }));
  if (withPhotos) {
    toast('Fotos werden verpackt…');
    data.stores.photos = await Promise.all(all('photos').map(async p => { const { blob, ...rest } = p; return { ...rest, dataUrl: await blobToDataURL(blob) }; }));
  }
  const name = `wandel-backup-${today()}${withPhotos ? '-mit-fotos' : ''}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  const mark = async () => { await setKv('lastBackup', today()); render(); };
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); await mark(); toast('Backup erstellt'); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  await mark(); toast('Backup heruntergeladen');
}
async function readImport(file) {
  const box = $('#importInfo');
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'wandel' || !data.stores) throw new Error('Das ist keine Backup-Datei dieser App.');
    if (data.dbVersion > DB_VER) throw new Error('Das Backup stammt aus einer neueren App-Version. Bitte zuerst die App aktualisieren.');
    pendingImport = data;
    const st = data.stores;
    box.innerHTML = `<p class="small">Backup vom ${dlong(data.exported.slice(0, 10))}: ${st.weights?.length || 0} Gewichte, ${st.workouts?.length || 0} Trainings, ${st.photos ? st.photos.length + ' Fotos' : 'ohne Fotos'}.</p><button class="danger" data-act="restore">Wiederherstellen</button>`;
  } catch (e) { pendingImport = null; box.innerHTML = `<p class="small bad">${h(e instanceof SyntaxError ? 'Die Datei ist beschädigt oder kein gültiges Backup.' : e.message)}</p>`; }
}

/* ---------- Router & Events ---------- */
function render() {
  const [tab0, sub, arg] = (location.hash.slice(1) || 'tag').split('/');
  const tab = VIEWS[tab0] ? tab0 : 'tag';
  $('#title').textContent = TITLES[tab];
  const nav = TAB_OF[tab] || tab;
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === nav));
  $('#view').innerHTML = VIEWS[tab](sub, arg);
  if (tab === 'setup' && sub === 'daten') {
    const el = $('#persist');
    (navigator.storage?.persisted ? navigator.storage.persisted() : Promise.resolve(null)).then(p => {
      el.textContent = p === true ? 'aktiv. iOS löscht die Daten nicht von sich aus.' : p === false ? 'nicht bestätigt. App über den Home-Bildschirm nutzen und regelmäßig sichern.' : 'nicht prüfbar.';
    });
  }
  if (tab === 'wissen' && sub === 'cheat') cheatCalc();
  if (tab === 'training' && sub === 'fertig' && celebrateNext) { celebrateNext = false; celebrate(); }
  syncWakeLock();
}
window.addEventListener('hashchange', () => { closeViewer(); if (location.hash === '#beratung' && quiz.step >= QUIZ.length && !dietCfg()) quiz = { step: 0, a: {} }; render(); scrollTo(0, 0); });
let pendingExPhoto = null;
document.addEventListener('click', e => {
  const px = e.target.closest('[data-exid]'); if (px) pendingExPhoto = px.dataset.exid;
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { if (el.tagName !== 'A') e.preventDefault(); ACT[el.dataset.act](el, e); }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  await FORM[f.dataset.form](f.elements, f);
  render();
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.set) { const d = draft(), [ei, si, k] = el.dataset.set.split(':'); d.entries[ei].sets[si][k] = el.value; saveDraft(d); }
  if (el.dataset.cheat) cheatCalc();
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'curDate' && el.value) { cur = el.value > today() ? today() : el.value; followToday = cur === today(); render(); }
  else if (el.dataset.tname) { const t = S.templates.get(el.dataset.tname); if (el.value.trim()) await put('templates', { ...t, name: el.value.trim() }); }
  else if (el.dataset.hname) { const x = S.habits.get(el.dataset.hname); if (el.value.trim()) await put('habits', { ...x, name: el.value.trim() }); }
  else if (el.dataset.addto && el.value) { const t = S.templates.get(el.dataset.addto); await put('templates', { ...t, items: [...t.items, el.value] }); render(); }
  else if (el.dataset.addentry && el.value) { const d = draft(); d.entries.push(makeEntry(S.exercises.get(el.value))); await saveDraft(d); render(); }
  else if (el.dataset.compare) { compare[el.dataset.compare] = el.value || null; render(); }
  else if (el.dataset.meals) { const dc = dietCfg() || { id: null, date: today(), addons: {} }; dc.meals = +el.value; await setKv('diet', dc); render(); }
  else if (el.dataset.dietsel && el.value) { await ACT.chooseDiet({ dataset: { id: el.value } }); }
  else if (el.id === 'importFile' && el.files[0]) readImport(el.files[0]);
  else if (el.id === 'exPhotoIn' && el.files[0] && pendingExPhoto) {
    const ex = S.exercises.get(pendingExPhoto);
    if (ex) { try { await put('exercises', { ...ex, photo: await photoBlob(el.files[0]), photoAt: Date.now() }); toast('Gerätefoto gespeichert'); } catch (err) { toast(err.message); } }
    el.value = ''; render();
  }
  else if (el.name === 'photo' && el.closest('.photoin')) { el.closest('.photoin').querySelector('span').textContent = el.files[0] ? 'Foto ausgewählt ✓' : '+ Foto'; }
  else if (el.dataset.wdate && el.value) { const w = S.workouts.get(el.dataset.wdate); await put('workouts', { ...w, date: el.value }); toast('Datum geändert'); render(); }
  else if (el.dataset.cur) { const v = num(el.value); await setCur(el.dataset.cur, v == null ? '' : String(v)); }
  else if (el.id === 'photoFile' && el.files.length) { await addPhotos([...el.files]); el.value = ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeViewer(); });
// Bleibt die App über Mitternacht offen, springt die Tagesansicht auf den neuen Tag,
// außer du bearbeitest gerade bewusst einen vergangenen Tag.
let followToday = true;
document.addEventListener('visibilitychange', () => {
  syncWakeLock();
  if (!document.hidden && followToday && cur !== today()) { cur = today(); if (!document.querySelector('input:focus')) render(); }
});

/* ---------- Start ---------- */
async function seed() {
  if (kv('seeded', false)) return;
  const habits = ['Eiweißziel erreicht', 'Kreatin genommen', 'Mindestens 7 Stunden geschlafen', '2–3 Liter Wasser', 'Bewegung im Alltag (Spaziergang, Treppe)'];
  for (let i = 0; i < habits.length; i++) await put('habits', { id: uid(), name: habits[i], order: i, active: true });
  const ts = ['Oberkörper A', 'Unterkörper', 'Oberkörper B'];
  for (let i = 0; i < ts.length; i++) await put('templates', { id: uid(), name: ts[i], items: [], warmup: [], order: i });
  await setKv('profile', { ...DEFAULT_PROFILE, startDate: today() });
  await setKv('seeded', true);
}
(async () => {
  try {
    db = await openDB();
    await loadAll();
    await seed();
    await migrateV3();
    if (!kv('import.last1', false)) { await importLastTraining('2026-10-21', null); toast('Oberkörper A mit deinem letzten Training angelegt'); }
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    if (!location.hash || /^#(heute|koerper|essen|mehr)/.test(location.hash)) history.replaceState(null, '', '#tag');
    render();
  } catch (e) {
    $('#view').innerHTML = `<div class="card"><h2>Die Datenbank konnte nicht geöffnet werden</h2><p class="small">${h(e.message)}</p><p class="small muted">Im privaten Modus von Safari funktioniert die App nicht. Bitte normal öffnen.</p></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
