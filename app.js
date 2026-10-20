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
const EQ_TYPES = { lh: ['Langhantel', 2.5], kh: ['Kurzhanteln', 2], kabel: ['Kabelzug', 2.5], maschine: ['Maschine', 5], multi: ['Multipresse', 2.5], kb: ['Kettlebell', 4], koerper: ['Körpergewicht', 0], sonst: ['Sonstiges', 2.5] };
const MUSCLES = ['Brust', 'Rücken', 'Schultern', 'Bizeps', 'Trizeps', 'Oberschenkel vorne', 'Oberschenkel hinten', 'Po', 'Waden', 'Bauch', 'Ganzkörper'];
const EX_SUGGEST = ['Bankdrücken', 'Schrägbankdrücken', 'Kurzhantel-Bankdrücken', 'Brustpresse (Maschine)', 'Butterfly', 'Kabelzug-Crossover', 'Liegestütze',
  'Latzug', 'Klimmzüge', 'Rudern am Kabel (sitzend)', 'Langhantelrudern', 'Kurzhantelrudern einarmig', 'Rudermaschine (Brust gestützt)', 'Face Pulls',
  'Schulterdrücken (Kurzhantel)', 'Schulterpresse (Maschine)', 'Seitheben', 'Seitheben am Kabel', 'Reverse Butterfly',
  'Bizepscurls (Kurzhantel)', 'Hammercurls', 'Bizepscurls am Kabel', 'Trizepsdrücken am Kabel', 'French Press', 'Dips (unterstützt)',
  'Kniebeuge', 'Goblet Squat', 'Beinpresse', 'Beinstrecker', 'Beinbeuger (liegend)', 'Beinbeuger (sitzend)', 'Rumänisches Kreuzheben', 'Hip Thrust',
  'Ausfallschritte', 'Bulgarian Split Squat', 'Abduktoren-Maschine', 'Adduktoren-Maschine', 'Wadenheben stehend', 'Wadenheben sitzend',
  'Crunches am Kabel', 'Plank', 'Beinheben hängend', 'Rückenstrecker'];

const exName = id => S.exercises.get(id)?.name ?? 'Gelöschte Übung';
function incFor(ex) {
  if (ex.inc != null && ex.inc !== '') return +ex.inc;
  const eq = S.equipment.get(ex.equipmentId);
  if (eq) return eq.inc != null ? +eq.inc : (EQ_TYPES[eq.type]?.[1] ?? 2.5);
  return 0;
}
const wSort = (a, b) => b.date.localeCompare(a.date) || (b.finished || '').localeCompare(a.finished || '');
function lastPerf(exId) {
  for (const w of all('workouts').sort(wSort)) {
    const e = w.entries.find(e => e.exerciseId === exId && e.sets.some(s => s.done));
    if (e) return { date: w.date, sets: e.sets.filter(s => s.done) };
  }
  return null;
}
function suggest(ex) {
  const lp = lastPerf(ex.id), inc = incFor(ex);
  if (!lp) return { kg: '', reps: ex.repMax, text: `Erstes Mal: Wähle ein Gewicht, mit dem du ${ex.repMin}–${ex.repMax} saubere Wiederholungen schaffst und noch 2–3 im Tank hast.` };
  const kg = Math.max(...lp.sets.map(s => num(s.kg) ?? 0));
  const top = lp.sets.filter(s => (num(s.kg) ?? 0) === kg);
  const hitAll = top.length >= ex.sets && top.every(s => (num(s.reps) ?? 0) >= ex.repMax);
  const last = `Zuletzt (${dshort(lp.date)}): ${lp.sets.map(s => `${fmt(num(s.kg) ?? 0)}×${s.reps}`).join(', ')}`;
  if (hitAll) {
    if (inc > 0) return { kg: kg + inc, reps: ex.repMin, text: `${last}. Alle Sätze bei ${ex.repMax} Wdh. geschafft: Steigere auf ${fmt(kg + inc)} kg.` };
    return { kg, reps: ex.repMax, text: `${last}. Oberes Ende erreicht: schwierigere Variante oder Zusatzgewicht.` };
  }
  const minReps = Math.min(...top.map(s => num(s.reps) ?? 0));
  return { kg, reps: Math.min(ex.repMax, minReps + 1), text: `${last}. Bleib bei ${fmt(kg)} kg und schaffe pro Satz eine Wiederholung mehr (Ziel ${ex.repMax}).` };
}
const e1rm = (kg, reps) => kg * (1 + reps / 30);
function bestE1rm(exId) {
  let best = null;
  for (const w of all('workouts')) for (const e of w.entries) if (e.exerciseId === exId) for (const s of e.sets) {
    const kg = num(s.kg), r = num(s.reps);
    if (s.done && kg && r && r <= 15) { const v = e1rm(kg, r); if (!best || v > best.v) best = { v, kg, r, date: w.date }; }
  }
  return best;
}
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
const workoutVol = w => w.entries.reduce((a, e) => a + e.sets.filter(s => s.done).reduce((b, s) => b + (num(s.kg) || 0) * (num(s.reps) || 0), 0), 0);
function makeEntry(ex) {
  const sg = suggest(ex);
  return { exerciseId: ex.id, sets: [...Array(+ex.sets || 3)].map(() => ({ kg: sg.kg === '' ? '' : fmt(sg.kg, 2), reps: String(sg.reps), rir: '', done: false })) };
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
      id: 'ex_' + ex.id, g: 'Kraft', name: ex.name, unit: 'kg Max', digits: 0, line: true,
      pts: all('workouts').sort(byDate).map(w => {
        let best = null;
        for (const e of w.entries) if (e.exerciseId === ex.id) for (const s of e.sets) { const kg = num(s.kg), r = num(s.reps); if (s.done && kg && r && r <= 15) best = Math.max(best || 0, e1rm(kg, r)); }
        return best ? { d: w.date, y: best } : null;
      }).filter(Boolean)
    }))
  ];
  for (const m of defs) if (m.avg) m.pts = rolling(m.dots);
  return defs;
}

/* ---------- Ansichten ---------- */
const VIEWS = {};
const TITLES = { tag: 'Tag', training: 'Training', statistik: 'Statistik', fotos: 'Fotos', wissen: 'Wissen', setup: 'Einstellungen', beratung: 'Beratung' };
const TAB_OF = { training: 'tag', beratung: 'wissen' };
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
    ${draft ? `<p><b>${h(draft.name)}</b> läuft${draft.date !== today() ? ` (für ${dlong(draft.date)})` : ''}.</p><a class="btn" href="#training">Training fortsetzen</a>` :
      ts.length ? `<p class="small muted">${isToday ? 'Welches Training machst du heute?' : 'Training für diesen Tag nachtragen:'}</p>
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

/* Laufendes Training */
VIEWS.training = () => {
  const d = kv('draft', null);
  if (!d) return '<div class="card"><p class="empty">Kein laufendes Training.</p><a class="btn" href="#tag">Zum Tag</a></div>';
  const exs = all('exercises').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return `
  <div class="card"><div class="row between"><div><h2>${h(d.name)}</h2><p class="small muted">${dlong(d.date)} · seit ${new Date(d.started).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</p></div><a class="small link" href="#tag">Minimieren</a></div>
  <p class="small muted">Gewicht, Wiederholungen und RIR (wie viele Wdh. noch gegangen wären) eintragen, dann ✓ tippen. Alles wird sofort gespeichert. Weicht das Training heute vom Plan ab, füge unten Übungen hinzu oder entferne sie. Der Plan selbst bleibt unverändert.</p></div>
  ${d.entries.map((e, ei) => {
    const ex = S.exercises.get(e.exerciseId), sg = ex ? suggest(ex) : null;
    return `<div class="card">
      <div class="row between"><h2>${h(exName(e.exerciseId))}</h2><span class="small muted">${ex ? `${ex.repMin}–${ex.repMax} Wdh.` : ''}</span></div>
      ${sg ? `<p class="hint">${h(sg.text)}</p>` : ''}
      <div class="set head"><span>#</span><span>kg</span><span>Wdh.</span><span>RIR</span><span></span></div>
      ${e.sets.map((s, si) => `<div class="set${s.done ? ' done' : ''}"><span class="n">${si + 1}</span>
        <input inputmode="decimal" value="${h(s.kg)}" data-set="${ei}:${si}:kg" aria-label="Gewicht Satz ${si + 1}">
        <input inputmode="numeric" value="${h(s.reps)}" data-set="${ei}:${si}:reps" aria-label="Wiederholungen Satz ${si + 1}">
        <input inputmode="numeric" value="${h(s.rir)}" data-set="${ei}:${si}:rir" placeholder="2" aria-label="RIR Satz ${si + 1}">
        <button class="check${s.done ? ' on' : ''}" data-act="toggleSet" data-e="${ei}" data-s="${si}" aria-label="Satz ${si + 1} fertig" aria-pressed="${!!s.done}"></button></div>`).join('')}
      <div class="row"><button class="ghost" data-act="addSet" data-e="${ei}">+ Satz</button><button class="ghost" data-act="removeSet" data-e="${ei}" ${e.sets.length <= 1 ? 'disabled' : ''}>− Satz</button><span class="grow"></span><button class="ghost bad" data-act="removeEntry" data-e="${ei}">Entfernen</button></div>
    </div>`;
  }).join('')}
  <div class="card">
    <select data-addentry="1" aria-label="Übung zum Training hinzufügen"><option value="">+ Übung hinzufügen</option>${exs.map(x => `<option value="${x.id}">${h(x.name)}</option>`).join('')}</select>
    <button data-act="finishWorkout">Training abschließen</button>
    <button class="danger" data-act="discardWorkout">Training verwerfen</button>
  </div>`;
};

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
const editing = { equipment: null, exercise: null };
SETUP.training = sub => {
  sub = sub || 'plaene';
  const tabs = [['plaene', 'Pläne'], ['uebungen', 'Übungen'], ['geraete', 'Geräte'], ['verlauf', 'Verlauf']];
  return back('#setup', 'Einstellungen') + `<div class="seg">${tabs.map(([k, l]) => `<button class="${sub === k ? 'on' : ''}" data-act="go" data-href="#setup/training/${k}">${l}</button>`).join('')}</div>` + (TRAIN[sub] || TRAIN.plaene)();
};
const TRAIN = {};
TRAIN.geraete = () => {
  const eqs = all('equipment').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const ed = editing.equipment ? S.equipment.get(editing.equipment) : null;
  return `
  <div class="card">
    <h2>${ed ? 'Gerät bearbeiten' : 'Neues Gerät'}</h2>
    <p class="small muted">Den offiziellen Namen musst du nicht kennen. Nimm einen Namen, den ihr benutzt, z. B. „Grüne Beinmaschine" oder „Kabelturm links".</p>
    <form data-form="equipment" class="stack">
      <label class="f">Name<input name="name" required value="${h(ed?.name)}" placeholder="z. B. Kabelturm"></label>
      <div class="grid2">
        <label class="f">Art<select name="type">${Object.entries(EQ_TYPES).map(([k, [l]]) => `<option value="${k}" ${ed?.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">Gewichtssprung (kg)<input name="inc" inputmode="decimal" value="${ed ? fmt(ed.inc, 2) : ''}" placeholder="automatisch"></label>
      </div>
      <p class="small muted"><b>Gewichtssprung:</b> Um wie viel kg kannst du an diesem Gerät mindestens erhöhen? Steckgewichte in 5-kg-Stufen → 5. Kurzhanteln 10, 12, 14 kg → 2. Langhantel mit 1,25-kg-Scheiben auf jeder Seite → 2,5. Die App nutzt den Wert, um dir das nächste Gewicht vorzuschlagen.</p>
      <label class="f">Notiz<input name="note" value="${h(ed?.note)}" placeholder="z. B. Sitz auf Stufe 4"></label>
      <div class="row"><button class="grow">${ed ? 'Änderungen speichern' : 'Gerät anlegen'}</button>${ed ? '<button type="button" class="sec" data-act="cancelEdit" data-kind="equipment">Abbrechen</button>' : ''}</div>
    </form>
  </div>
  <div class="card"><h2>Eure Geräte (${eqs.length})</h2>
    <div class="list">${eqs.map(e => `<div class="item"><div class="grow"><b>${h(e.name)}</b><p class="small muted">${EQ_TYPES[e.type]?.[0] ?? ''} · Sprung ${fmt(e.inc, 2)} kg${e.note ? ' · ' + h(e.note) : ''}</p></div><button class="ghost" data-act="edit" data-kind="equipment" data-id="${e.id}">Bearbeiten</button><button class="icon" data-act="delEquipment" data-id="${e.id}" aria-label="Gerät löschen">×</button></div>`).join('') || '<p class="empty">Noch keine Geräte.</p>'}</div>
  </div>`;
};
TRAIN.uebungen = () => {
  const exs = all('exercises').sort((a, b) => MUSCLES.indexOf(a.muscle) - MUSCLES.indexOf(b.muscle) || a.name.localeCompare(b.name, 'de'));
  const eqs = all('equipment').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const ed = editing.exercise ? S.exercises.get(editing.exercise) : null;
  let lastMuscle = null;
  return `
  <div class="card">
    <h2>${ed ? 'Übung bearbeiten' : 'Neue Übung'}</h2>
    <form data-form="exercise" class="stack">
      <label class="f">Name<input name="name" list="exsuggest" required value="${h(ed?.name)}" placeholder="Tippen für Vorschläge"></label>
      <datalist id="exsuggest">${EX_SUGGEST.map(x => `<option value="${h(x)}">`).join('')}</datalist>
      <div class="grid2">
        <label class="f">Gerät<select name="equipmentId"><option value="">Ohne Gerät</option>${eqs.map(e => `<option value="${e.id}" ${ed?.equipmentId === e.id ? 'selected' : ''}>${h(e.name)}</option>`).join('')}</select></label>
        <label class="f">Hauptmuskel<select name="muscle">${MUSCLES.map(m => `<option ${ed?.muscle === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="f">Wdh. von<input name="repMin" inputmode="numeric" value="${ed?.repMin ?? 8}"></label>
        <label class="f">Wdh. bis<input name="repMax" inputmode="numeric" value="${ed?.repMax ?? 12}"></label>
        <label class="f">Sätze<input name="sets" inputmode="numeric" value="${ed?.sets ?? 3}"></label>
        <label class="f">Gewichtssprung (kg)<input name="inc" inputmode="decimal" value="${ed?.inc ?? ''}" placeholder="vom Gerät"></label>
      </div>
      <div class="row"><button class="grow">${ed ? 'Änderungen speichern' : 'Übung anlegen'}</button>${ed ? '<button type="button" class="sec" data-act="cancelEdit" data-kind="exercise">Abbrechen</button>' : ''}</div>
    </form>
  </div>
  <div class="card"><h2>Übungen (${exs.length})</h2>
    <div class="list">${exs.map(x => {
      const b = bestE1rm(x.id), eq = S.equipment.get(x.equipmentId);
      const head = x.muscle !== lastMuscle ? `<p class="label" style="padding-top:10px">${h(x.muscle)}</p>` : '';
      lastMuscle = x.muscle;
      return `${head}<div class="item"><div class="grow"><b>${h(x.name)}</b><p class="small muted">${eq ? h(eq.name) : 'Ohne Gerät'} · ${x.sets}×${x.repMin}–${x.repMax}${b ? ` · Bestwert ${fmt(b.kg)} kg × ${b.r}` : ''}</p></div><button class="ghost" data-act="edit" data-kind="exercise" data-id="${x.id}">Bearbeiten</button><button class="icon" data-act="delExercise" data-id="${x.id}" aria-label="Übung löschen">×</button></div>`;
    }).join('') || '<p class="empty">Noch keine Übungen.</p>'}</div>
  </div>`;
};
TRAIN.plaene = () => {
  const ts = all('templates').sort((a, b) => a.order - b.order);
  const exs = all('exercises').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return `
  <div class="card"><p class="small muted">Jeder Plan ist eine Vorlage. Eure Oberkörpertage dürfen unterschiedlich sein: Lege dafür zwei Pläne an (A und B). Weicht ein einzelnes Training ab, änderst du es direkt im laufenden Training. Für spontane Einheiten gibt es „Freies Training" in der Tagesansicht.</p></div>
  ${ts.map(t => `<div class="card">
    <div class="row"><input value="${h(t.name)}" data-tname="${t.id}" aria-label="Name des Plans" class="strong"><button class="icon" data-act="delTemplate" data-id="${t.id}" aria-label="Plan löschen">×</button></div>
    <div class="list">${t.items.map((id, i) => `<div class="item"><span class="small muted num">${i + 1}</span><span class="grow">${h(exName(id))}</span><button class="icon" data-act="moveItem" data-id="${t.id}" data-i="${i}" data-dir="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon" data-act="moveItem" data-id="${t.id}" data-i="${i}" data-dir="1" aria-label="Nach unten" ${i === t.items.length - 1 ? 'disabled' : ''}>↓</button><button class="icon" data-act="removeItem" data-id="${t.id}" data-i="${i}" aria-label="Entfernen">×</button></div>`).join('') || '<p class="empty">Noch leer.</p>'}</div>
    ${exs.length ? `<select data-addto="${t.id}" aria-label="Übung hinzufügen"><option value="">+ Übung hinzufügen</option>${exs.filter(x => !t.items.includes(x.id)).map(x => `<option value="${x.id}">${h(x.name)} (${h(x.muscle)})</option>`).join('')}</select>` : '<p class="small muted">Lege zuerst unter „Übungen" welche an.</p>'}
  </div>`).join('')}
  <div class="card"><form data-form="template" class="row"><input name="name" placeholder="Neuer Plan, z. B. Oberkörper C" required><button>Anlegen</button></form></div>`;
};
TRAIN.verlauf = () => {
  const ws = all('workouts').sort(wSort);
  return `<div class="card"><h2>Trainings (${ws.length})</h2>
  <div class="list">${ws.map(w => `<details class="item block"><summary class="row between"><span><b>${h(w.name)}</b> <span class="small muted">${wday(w.date)}, ${dlong(w.date)}</span></span><span class="small muted num">${workoutSets(w)} Sätze · ${fmt(workoutVol(w) / 1000, 1)} t</span></summary>
      <div class="list small">${w.entries.filter(e => e.sets.some(s => s.done)).map(e => `<div class="item"><span class="grow">${h(exName(e.exerciseId))}</span><span class="num muted">${e.sets.filter(s => s.done).map(s => `${fmt(num(s.kg) || 0)}×${s.reps}`).join(' · ')}</span></div>`).join('')}</div>
      <button class="danger" data-act="delWorkout" data-id="${w.id}">Training löschen</button></details>`).join('') || '<p class="empty">Noch kein Training gespeichert.</p>'}</div></div>`;
};
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
ACT.edit = el => { editing[el.dataset.kind] = el.dataset.id; render(); scrollTo({ top: 0, behavior: 'smooth' }); };
ACT.cancelEdit = el => { editing[el.dataset.kind] = null; render(); };
ACT.delEquipment = async el => { const used = all('exercises').filter(x => x.equipmentId === el.dataset.id).length; if (!armed(el, used ? `${used} Üb.?` : '?')) return; await del('equipment', el.dataset.id); render(); };
ACT.delExercise = async el => {
  if (!armed(el, '?')) return;
  await del('exercises', el.dataset.id);
  for (const t of all('templates')) if (t.items.includes(el.dataset.id)) await put('templates', { ...t, items: t.items.filter(i => i !== el.dataset.id) });
  render();
};
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
  if (kv('draft', null)) { location.hash = '#training'; return; }
  const t = S.templates.get(el.dataset.id);
  const entries = t.items.filter(id => S.exercises.has(id)).map(id => makeEntry(S.exercises.get(id)));
  await setKv('draft', { id: uid(), date: cur, templateId: t.id, name: t.name, started: new Date().toISOString(), entries });
  location.hash = '#training';
};
ACT.startFree = async () => {
  if (kv('draft', null)) { location.hash = '#training'; return; }
  await setKv('draft', { id: uid(), date: cur, templateId: null, name: 'Freies Training', started: new Date().toISOString(), entries: [] });
  location.hash = '#training';
};
const draft = () => kv('draft', null);
const saveDraft = d => setKv('draft', d);
ACT.toggleSet = async el => { const d = draft(), s = d.entries[+el.dataset.e].sets[+el.dataset.s]; s.done = !s.done; await saveDraft(d); render(); };
ACT.addSet = async el => { const d = draft(), e = d.entries[+el.dataset.e], l = e.sets[e.sets.length - 1] || { kg: '', reps: '' }; e.sets.push({ kg: l.kg, reps: l.reps, rir: '', done: false }); await saveDraft(d); render(); };
ACT.removeSet = async el => { const d = draft(); d.entries[+el.dataset.e].sets.pop(); await saveDraft(d); render(); };
ACT.removeEntry = async el => { if (!armed(el)) return; const d = draft(); d.entries.splice(+el.dataset.e, 1); await saveDraft(d); render(); };
ACT.finishWorkout = async el => {
  const d = draft(), done = d.entries.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
  if (!done && !armed(el, 'Keine Sätze abgehakt. Trotzdem speichern?')) return;
  await put('workouts', { ...d, finished: new Date().toISOString() });
  await del('kv', 'draft');
  cur = d.date;
  toast(`Gespeichert: ${done} Sätze. Stark!`);
  location.hash = '#tag';
};
ACT.discardWorkout = async el => { if (!armed(el, 'Wirklich verwerfen?')) return; await del('kv', 'draft'); location.hash = '#tag'; };
ACT.backup = el => exportBackup(!!el.dataset.photos);
ACT.restore = async el => {
  if (!pendingImport || !armed(el, 'Wirklich alle Daten ersetzen?')) return;
  for (const s of Object.keys(STORES)) {
    if (!pendingImport.stores[s]) continue; // fehlt im Backup (z. B. Fotos) → unangetastet lassen
    let rows = pendingImport.stores[s];
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
FORM.equipment = async f => {
  const id = editing.equipment || uid(), type = f.type.value, inc = num(f.inc.value);
  await put('equipment', { id, name: f.name.value.trim(), type, inc: inc ?? EQ_TYPES[type][1], note: f.note.value.trim() });
  editing.equipment = null; toast('Gerät gespeichert');
};
FORM.exercise = async f => {
  const id = editing.exercise || uid();
  let repMin = Math.round(num(f.repMin.value) || 8), repMax = Math.round(num(f.repMax.value) || 12);
  if (repMax < repMin) [repMin, repMax] = [repMax, repMin];
  await put('exercises', { id, name: f.name.value.trim(), equipmentId: f.equipmentId.value || null, muscle: f.muscle.value, repMin, repMax, sets: clamp(Math.round(num(f.sets.value) || 3), 1, 10), inc: num(f.inc.value) });
  editing.exercise = null; toast('Übung gespeichert');
};
FORM.template = async f => { const order = Math.max(-1, ...all('templates').map(t => t.order)) + 1; await put('templates', { id: uid(), name: f.name.value.trim(), items: [], order }); };
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
}
window.addEventListener('hashchange', () => { closeViewer(); if (location.hash === '#beratung' && quiz.step >= QUIZ.length && !dietCfg()) quiz = { step: 0, a: {} }; render(); scrollTo(0, 0); });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { if (el.tagName !== 'A') e.preventDefault(); ACT[el.dataset.act](el, e); }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  await FORM[f.dataset.form](f.elements);
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
  else if (el.id === 'photoFile' && el.files.length) { await addPhotos([...el.files]); el.value = ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeViewer(); });
// Bleibt die App über Mitternacht offen, springt die Tagesansicht auf den neuen Tag,
// außer du bearbeitest gerade bewusst einen vergangenen Tag.
let followToday = true;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && followToday && cur !== today()) { cur = today(); if (!document.querySelector('input:focus')) render(); }
});

/* ---------- Start ---------- */
async function seed() {
  if (kv('seeded', false)) return;
  const habits = ['Eiweißziel erreicht', 'Kreatin genommen', 'Mindestens 7 Stunden geschlafen', '2–3 Liter Wasser', 'Bewegung im Alltag (Spaziergang, Treppe)'];
  for (let i = 0; i < habits.length; i++) await put('habits', { id: uid(), name: habits[i], order: i, active: true });
  const ts = ['Oberkörper A', 'Unterkörper', 'Oberkörper B'];
  for (let i = 0; i < ts.length; i++) await put('templates', { id: uid(), name: ts[i], items: [], order: i });
  await setKv('profile', { ...DEFAULT_PROFILE, startDate: today() });
  await setKv('seeded', true);
}
(async () => {
  try {
    db = await openDB();
    await loadAll();
    await seed();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    if (!location.hash || /^#(heute|koerper|essen|mehr)/.test(location.hash)) history.replaceState(null, '', '#tag');
    render();
  } catch (e) {
    $('#view').innerHTML = `<div class="card"><h2>Die Datenbank konnte nicht geöffnet werden</h2><p class="small">${h(e.message)}</p><p class="small muted">Im privaten Modus von Safari funktioniert die App nicht. Bitte normal öffnen.</p></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
