'use strict';
/* Wandel – Transformations-Tracker. Alle Daten liegen lokal in IndexedDB auf dem Gerät.
   Datenbank-Regel: Stores werden nur hinzugefügt, nie gelöscht. Neue Schema-Versionen bekommen
   einen eigenen Block in onupgradeneeded (if (old < N) {...}), damit bestehende Daten erhalten bleiben. */

const DB_NAME = 'wandel';
const DB_VER = 1;
const STORES = {
  kv: 'key', weights: 'date', measures: 'date', nutrition: 'date', habitLog: 'date',
  habits: 'id', equipment: 'id', exercises: 'id', templates: 'id', workouts: 'id'
};
const S = {};
let db;

/* ---------- Datenbank ---------- */
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = t => new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const d = r.result;
      // Version 1: Grundstruktur. Fehlende Stores anlegen, vorhandene nie anfassen.
      for (const [s, k] of Object.entries(STORES)) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: k });
      // Spätere Versionen: if (e.oldVersion < 2) { ... Daten migrieren, nichts löschen ... }
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
const dshort = s => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.` : '';
const dlong = s => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '';
const num = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const fmt = (n, d = 1) => n == null || !isFinite(n) ? '–' : (+n).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtF = (n, d = 1) => n == null || !isFinite(n) ? '–' : (+n).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round10 = n => Math.round(n / 10) * 10;
const byDate = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- Profil & Berechnungen ---------- */
const DEFAULT_PROFILE = { height: 180, age: 30, sex: 'm', start: 121, goal: 85, startDate: null };
const prof = () => ({ ...DEFAULT_PROFILE, ...kv('profile', {}) });

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
function trendAt(date) {
  const s = trendSeries().filter(p => p.date <= date);
  return s.length ? s[s.length - 1].trend : null;
}
function weeklyRate() {
  const ws = all('weights').sort(byDate);
  if (ws.length < 4) return null;
  const last = ws[ws.length - 1].date;
  const pts = ws.filter(w => dayDiff(w.date, last) <= 21);
  if (pts.length < 4 || dayDiff(pts[0].date, last) < 7) return null;
  const xs = pts.map(p => dayDiff(pts[0].date, p.date)), ys = pts.map(p => p.kg);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  const kgWeek = sxy / sxx * 7;
  const firstDate = ws[0].date;
  return { kgWeek, pct: kgWeek / currentWeight() * 100, early: dayDiff(firstDate, last) < 14 };
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
function mifflin(w) { const p = prof(); return 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'w' ? -161 : 5); }
function phaseKcal(w) { return w > 110 ? 2200 : w > 100 ? 2100 : w > 92 ? 2050 : 2000; }
function adaptiveTdee() {
  const end = today(), start = addDays(end, -28);
  const nut = all('nutrition').filter(n => n.date > start && n.date <= end && n.kcal);
  const ws = all('weights').filter(p => p.date > start && p.date <= end).sort(byDate);
  if (nut.length < 14 || ws.length < 6) return null;
  if (dayDiff(ws[0].date, ws[ws.length - 1].date) < 14) return null;
  const avg = nut.reduce((a, n) => a + n.kcal, 0) / nut.length;
  // Steigung der Gewichtsmessungen (lineare Regression) = Veränderung pro Tag
  const xs = ws.map(p => dayDiff(ws[0].date, p.date)), ys = ws.map(p => p.kg);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  const perDay = sxy / sxx;
  return { tdee: avg - perDay * 7700, days: nut.length, avg };
}
function targets() {
  const p = prof(), w = currentWeight(), ad = adaptiveTdee();
  const pMin = Math.round(p.goal * 1.9 / 5) * 5, pMax = Math.round(p.goal * 2.1 / 5) * 5;
  if (w <= p.goal) {
    const k = ad ? ad.tdee : mifflin(w) * 1.45;
    return { kcal: round10(k), src: 'Ziel erreicht: Erhaltung', pMin, pMax, ad };
  }
  // Zieltempo: Mitte des hautschonenden Korridors, nach unten hin langsamer
  const pct = w > 100 ? 0.007 : w > 92 ? 0.006 : 0.005;
  const deficit = w * pct * 7700 / 7;
  const floor = p.sex === 'w' ? 1500 : 1800;
  if (ad) return { kcal: round10(clamp(ad.tdee - deficit, Math.max(floor, phaseKcal(w) - 300), 3500)), src: `Aus deinen Daten (${ad.days} Tage)`, pMin, pMax, ad, deficit };
  return { kcal: phaseKcal(w), src: 'Startwert laut Phasenplan', pMin, pMax, ad: null };
}
function navyBF(m, sex, height) {
  if (!m || !m.waist || !m.neck) return null;
  if (sex === 'w') { if (!m.hip) return null; return 495 / (1.29579 - 0.35004 * Math.log10(m.waist + m.hip - m.neck) + 0.22100 * Math.log10(height)) - 450; }
  if (m.waist - m.neck <= 0) return null;
  return 495 / (1.0324 - 0.19077 * Math.log10(m.waist - m.neck) + 0.15456 * Math.log10(height)) - 450;
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
function lastPerf(exId, excludeId) {
  const ws = all('workouts').filter(w => w.id !== excludeId).sort((a, b) => b.date.localeCompare(a.date) || (b.finished || '').localeCompare(a.finished || ''));
  for (const w of ws) {
    const e = w.entries.find(e => e.exerciseId === exId && e.sets.some(s => s.done));
    if (e) return { date: w.date, sets: e.sets.filter(s => s.done) };
  }
  return null;
}
function suggest(ex) {
  const lp = lastPerf(ex.id);
  const inc = incFor(ex);
  if (!lp) return { kg: '', reps: ex.repMax, text: `Erstes Mal: Wähle ein Gewicht, mit dem du ${ex.repMin}–${ex.repMax} saubere Wiederholungen schaffst und noch 2–3 im Tank hast.` };
  const kgs = lp.sets.map(s => num(s.kg) ?? 0);
  const kg = Math.max(...kgs);
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
  const last = all('workouts').filter(w => w.templateId).sort((a, b) => b.date.localeCompare(a.date) || (b.finished || '').localeCompare(a.finished || ''))[0];
  if (!last) return ts[0];
  const i = ts.findIndex(t => t.id === last.templateId);
  return ts[(i + 1) % ts.length];
}
function weekStart(d) { const day = (new Date(dayNum(d) * 864e5).getUTCDay() + 6) % 7; return addDays(d, -day); }

/* ---------- Diagramm ---------- */
function chart(series, opts = {}) {
  const pts = series.flatMap(s => s.pts);
  if (pts.length < 2) return '<p class="empty">Ab zwei Einträgen erscheint hier der Verlauf.</p>';
  const W = 340, H = opts.h || 170, pl = 34, pr = 10, pt = 10, pb = 22;
  const dates = pts.map(p => p.d).sort();
  const d0 = dates[0], d1 = dates[dates.length - 1], span = Math.max(1, dayDiff(d0, d1));
  const ys = pts.map(p => p.y).concat(opts.extraY || []);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = Math.max(0.5, (y1 - y0) * 0.12); y0 -= pad; y1 += pad;
  const X = d => pl + (W - pl - pr) * dayDiff(d0, d) / span;
  const Y = y => pt + (H - pt - pb) * (1 - (y - y0) / (y1 - y0));
  const raw = (y1 - y0) / 3, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  let grid = '';
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) {
    grid += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end">${fmt(v)}</text>`;
  }
  grid += `<text x="${pl}" y="${H - 6}">${dshort(d0)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">${dshort(d1)}</text>`;
  let marks = '';
  if (opts.goal != null && opts.goal > y0 && opts.goal < y1) marks += `<line class="goal" x1="${pl}" x2="${W - pr}" y1="${Y(opts.goal)}" y2="${Y(opts.goal)}"/>`;
  for (const s of series) {
    if (s.cls === 'dots') marks += s.pts.map(p => `<circle class="dot" cx="${X(p.d).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6"/>`).join('');
    else if (s.pts.length) {
      marks += `<polyline class="${s.cls}" points="${s.pts.map(p => `${X(p.d).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}"/>`;
      const e = s.pts[s.pts.length - 1];
      marks += `<circle class="end" cx="${X(e.d).toFixed(1)}" cy="${Y(e.y).toFixed(1)}" r="4"/>`;
    }
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(opts.label || 'Verlauf')}">${grid}${marks}</svg>`;
}

/* ---------- Ansichten ---------- */
const TITLES = { heute: 'Heute', koerper: 'Körper', training: 'Training', essen: 'Ernährung', mehr: 'Mehr' };
const VIEWS = {};

function bar(v, max) { const p = max ? clamp(v / max * 100, 0, 100) : 0; return `<div class="bar${v > max ? ' over' : ''}"><i style="width:${p}%"></i></div>`; }

VIEWS.heute = () => {
  const d = today(), p = prof(), t = targets();
  const w = S.weights.get(d), n = S.nutrition.get(d) || {}, log = S.habitLog.get(d)?.done || {};
  const r = weeklyRate(), st = rateStatus(r), cw = currentWeight();
  const habits = all('habits').filter(x => x.active !== false).sort((a, b) => a.order - b.order);
  const draft = kv('draft', null), nt = nextTemplate();
  const wk = weekStart(d), weekCount = all('workouts').filter(x => x.date >= wk).length;
  const lb = kv('lastBackup', null), needBackup = !lb || dayDiff(lb, d) >= 7;
  const hasData = S.weights.size + S.workouts.size + S.nutrition.size > 0;
  const lost = p.start - cw;
  return `
  ${needBackup && hasData ? `<div class="card" style="background:var(--warn-soft)"><div class="row between"><div class="grow"><h2>Backup fällig</h2><p class="small muted">${lb ? `Letzte Sicherung am ${dlong(lb)}.` : 'Du hast noch keine Sicherung gemacht.'} Dauert 10 Sekunden.</p></div><button data-act="backup">Sichern</button></div></div>` : ''}
  <div class="card">
    <div class="row between"><span class="label">Gewicht</span><span class="chip ${st.cls}">${st.text}</span></div>
    <div class="row between wrap">
      <div><div class="big">${fmtF(cw)} <span class="small muted">kg Trend</span></div>
      <p class="small muted">${lost > 0.05 ? `${fmt(lost)} kg seit Start` : 'Startpunkt'} · Ziel ${fmt(p.goal)} kg${r ? ` · ${fmt(r.kgWeek, 2)} kg/Woche` : ''}</p></div>
    </div>
    ${w ? `<p class="small">Heute gewogen: <b class="num">${fmtF(w.kg)} kg</b></p>` :
      `<form data-form="quickWeight" class="row"><input name="kg" inputmode="decimal" placeholder="Heutiges Gewicht in kg" aria-label="Heutiges Gewicht"><button>Speichern</button></form>`}
    <p class="small muted">${h(st.tip)}</p>
  </div>
  <div class="card">
    <div class="row between"><span class="label">Ernährung heute</span><a class="small" href="#essen" style="color:var(--accent)">Details</a></div>
    <div class="grid2">
      <div><p class="small muted">Kalorien</p><p class="num"><b>${fmt(n.kcal || 0, 0)}</b> / ${fmt(t.kcal, 0)}</p>${bar(n.kcal || 0, t.kcal)}</div>
      <div><p class="small muted">Eiweiß</p><p class="num"><b>${fmt(n.protein || 0, 0)}</b> / ${t.pMin}–${t.pMax} g</p>${bar(n.protein || 0, t.pMin)}</div>
    </div>
    <form data-form="nutrition" class="row">
      <input type="hidden" name="date" value="${d}">
      <input name="kcal" inputmode="numeric" placeholder="kcal" value="${n.kcal ?? ''}" aria-label="Kalorien gesamt">
      <input name="protein" inputmode="numeric" placeholder="Eiweiß g" value="${n.protein ?? ''}" aria-label="Eiweiß gesamt">
      <button>OK</button>
    </form>
    <p class="small muted">Tagessummen aus deiner Tracking-App eintragen. Überschreibt den Tageswert.</p>
  </div>
  <div class="card">
    <div class="row between"><span class="label">Gewohnheiten</span><span class="small muted num">${habits.filter(x => log[x.id]).length}/${habits.length}</span></div>
    <div class="list">${habits.map(x => `<div class="item"><button class="check${log[x.id] ? ' on' : ''}" data-act="habit" data-id="${x.id}" aria-label="${h(x.name)} abhaken" aria-pressed="${!!log[x.id]}"></button><span class="grow">${h(x.name)}</span></div>`).join('') || '<p class="empty">Lege unter Mehr → Gewohnheiten welche an.</p>'}</div>
  </div>
  <div class="card">
    <div class="row between"><span class="label">Training</span><span class="small muted num">${weekCount}/3 diese Woche</span></div>
    ${draft ? `<p><b>${h(draft.name)}</b> läuft seit ${new Date(draft.started).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.</p><a class="btn" href="#training/aktiv">Training fortsetzen</a>` :
      nt ? `<p>Als Nächstes: <b>${h(nt.name)}</b> <span class="small muted">(${nt.items.length} Übungen)</span></p><button data-act="startWorkout" data-id="${nt.id}">Training starten</button>` :
      `<p class="muted">Lege zuerst Geräte, Übungen und Pläne an.</p><a class="btn sec" href="#training/geraete">Zu den Geräten</a>`}
  </div>`;
};

VIEWS.koerper = sub => {
  const p = prof(), ts = trendSeries(), range = kv('ui.range', 90);
  const last = ts.length ? ts[ts.length - 1].date : today();
  const shown = range ? ts.filter(x => dayDiff(x.date, last) <= range) : ts;
  const r = weeklyRate(), st = rateStatus(r), cw = currentWeight();
  const ms = all('measures').sort(byDate);
  const first = ms[0], latest = ms[ms.length - 1];
  const fields = [['waist', 'Bauch (Nabelhöhe)'], ['hip', 'Hüfte'], ['chest', 'Brust'], ['arm', 'Oberarm (angespannt)'], ['thigh', 'Oberschenkel'], ['neck', 'Hals']];
  const bfMs = ms.filter(m => navyBF(m, p.sex, p.height) != null);
  const comp = m => { const bf = navyBF(m, p.sex, p.height), w = trendAt(m.date) ?? cw; return { bf, w, fat: w * bf / 100, lean: w * (1 - bf / 100), date: m.date }; };
  const c0 = bfMs.length ? comp(bfMs[0]) : null, c1 = bfMs.length ? comp(bfMs[bfMs.length - 1]) : null;
  const scaleFat = ts.filter(x => x.fat).slice(-1)[0];
  return `
  <div class="card">
    <div class="row between"><span class="label">Gewichtsverlauf</span><span class="chip ${st.cls}">${st.text}</span></div>
    <div class="seg">${[[30, '30 Tage'], [90, '90 Tage'], [0, 'Alles']].map(([v, l]) => `<button class="${range === v ? 'on' : ''}" data-act="range" data-v="${v}">${l}</button>`).join('')}</div>
    ${chart([{ pts: shown.map(x => ({ d: x.date, y: x.kg })), cls: 'dots' }, { pts: shown.map(x => ({ d: x.date, y: x.trend })), cls: 'trend' }], { label: 'Gewicht und Trend', goal: p.goal })}
    <p class="small muted">Punkte: tägliche Messung. Linie: geglätteter Trend, der Wasserschwankungen herausfiltert. Achte nur auf die Linie.</p>
    <div class="grid2">
      <div><p class="small muted">Start</p><p class="num"><b>${fmtF(p.start)} kg</b></p></div>
      <div><p class="small muted">Trend jetzt</p><p class="num"><b>${fmtF(cw)} kg</b></p></div>
      <div><p class="small muted">Tempo</p><p class="num"><b>${r ? `${fmt(r.kgWeek, 2)} kg` : '–'}</b> ${r ? `<span class="small muted">(${fmt(r.pct, 2)} %/Wo)</span>` : ''}</p></div>
      <div><p class="small muted">Bis zum Ziel</p><p class="num"><b>${fmt(Math.max(0, cw - p.goal))} kg</b></p></div>
    </div>
  </div>
  <div class="card">
    <h2>Gewicht eintragen</h2>
    <form data-form="weight" class="list" style="gap:10px">
      <div class="grid2">
        <label class="f">Datum<input type="date" name="date" value="${today()}" max="${today()}"></label>
        <label class="f">Gewicht (kg)<input name="kg" inputmode="decimal" placeholder="z. B. 120,4" required></label>
      </div>
      <label class="f">Körperfett laut Smartwaage (%, optional)<input name="fat" inputmode="decimal" placeholder="z. B. 38,5"></label>
      <button>Speichern</button>
    </form>
    <details><summary class="small" style="color:var(--accent)">Letzte Einträge</summary>
      <div class="list">${ts.slice(-30).reverse().map(x => `<div class="item"><span class="grow num">${dlong(x.date)}</span><span class="num"><b>${fmtF(x.kg)}</b> kg${x.fat ? ` · ${fmtF(x.fat)} %` : ''}</span><button class="icon" data-act="delWeight" data-id="${x.date}" aria-label="Eintrag löschen">×</button></div>`).join('') || '<p class="empty">Noch keine Einträge.</p>'}</div>
    </details>
  </div>
  <div class="card">
    <h2>Fett und Muskeln</h2>
    ${c1 ? `
      <p class="small muted">Geschätzt über Bauch- und Halsumfang (US-Navy-Formel, ±3–4 %). Wichtig ist die Richtung, nicht der genaue Wert.</p>
      <div class="grid2">
        <div><p class="small muted">Körperfett</p><p class="num"><b>${fmtF(c1.bf)} %</b>${c0 !== c1 && bfMs.length > 1 ? ` <span class="small muted">(Start ${fmtF(c0.bf)} %)</span>` : ''}</p></div>
        <div><p class="small muted">Fettmasse</p><p class="num"><b>${fmtF(c1.fat)} kg</b>${bfMs.length > 1 ? ` <span class="small ${c1.fat <= c0.fat ? 'muted' : ''}">(${c1.fat - c0.fat <= 0 ? '' : '+'}${fmtF(c1.fat - c0.fat)})</span>` : ''}</p></div>
        <div><p class="small muted">Fettfreie Masse</p><p class="num"><b>${fmtF(c1.lean)} kg</b>${bfMs.length > 1 ? ` <span class="small muted">(${c1.lean - c0.lean >= 0 ? '+' : ''}${fmtF(c1.lean - c0.lean)})</span>` : ''}</p></div>
        <div><p class="small muted">Stand</p><p class="num"><b>${dlong(c1.date)}</b></p></div>
      </div>` : '<p class="small muted">Trage Bauch- und Halsumfang ein, dann schätzt die App, wie viel von deinem Gewicht Fett ist und wie sich die fettfreie Masse (vor allem Muskeln) entwickelt.</p>'}
    ${scaleFat ? `<p class="small muted">Smartwaage zuletzt: ${fmtF(scaleFat.fat)} % (${dlong(scaleFat.date)}). Waagen schwanken stark mit dem Wasserhaushalt.</p>` : ''}
  </div>
  <div class="card">
    <h2>Umfänge</h2>
    <p class="small muted">Alle 2 Wochen, morgens, entspannt, Maßband waagerecht. Gerade beim Muskelaufbau zeigen Umfänge mehr als die Waage.</p>
    ${ms.length ? `<div class="scroll"><table class="t"><thead><tr><th>cm</th><th>Start</th><th>Aktuell</th><th>Δ</th></tr></thead><tbody>
      ${fields.map(([k, l]) => first?.[k] || latest?.[k] ? `<tr><td>${l}</td><td>${fmt(first[k])}</td><td>${fmt(latest[k])}</td><td>${first[k] && latest[k] && ms.length > 1 ? (latest[k] - first[k] > 0 ? '+' : '') + fmt(latest[k] - first[k]) : '–'}</td></tr>` : '').join('')}
      </tbody></table></div>` : ''}
    <form data-form="measure" class="list" style="gap:10px">
      <label class="f">Datum<input type="date" name="date" value="${today()}" max="${today()}"></label>
      <div class="grid2">${fields.map(([k, l]) => `<label class="f">${l}<input name="${k}" inputmode="decimal" placeholder="cm"></label>`).join('')}</div>
      <button>Umfänge speichern</button>
    </form>
    ${ms.length ? `<details><summary class="small" style="color:var(--accent)">Alle Messungen</summary><div class="list">${ms.slice().reverse().map(m => `<div class="item"><span class="grow small">${dlong(m.date)}: ${fields.filter(([k]) => m[k]).map(([k, l]) => `${l.split(' ')[0]} ${fmt(m[k])}`).join(' · ')}</span><button class="icon" data-act="delMeasure" data-id="${m.date}" aria-label="Messung löschen">×</button></div>`).join('')}</div></details>` : ''}
  </div>`;
};

VIEWS.essen = () => {
  const t = targets(), p = prof(), cw = currentWeight();
  const d = today(), n = S.nutrition.get(d) || {};
  const recent = all('nutrition').sort(byDate).reverse().slice(0, 14);
  const last7 = all('nutrition').filter(x => dayDiff(x.date, d) < 7 && dayDiff(x.date, d) >= 0);
  const avgK = last7.length ? last7.reduce((a, x) => a + (x.kcal || 0), 0) / last7.length : null;
  const avgP = last7.length ? last7.reduce((a, x) => a + (x.protein || 0), 0) / last7.length : null;
  return `
  <div class="card">
    <span class="label">Dein Tagesziel</span>
    <div class="grid2">
      <div><div class="big">${fmt(t.kcal, 0)}</div><p class="small muted">kcal</p></div>
      <div><div class="big">${t.pMin}–${t.pMax}</div><p class="small muted">g Eiweiß</p></div>
    </div>
    <p class="small muted">${h(t.src)}. ${t.ad ? `Dein gemessener Verbrauch liegt bei etwa ${fmt(round10(t.ad.tdee), 0)} kcal. Abzüglich ${fmt(round10(t.deficit || 0), 0)} kcal Defizit für das Zieltempo.` : 'Nach 14 Tagen mit Kalorien- und Gewichtseinträgen berechnet die App deinen echten Verbrauch und passt das Ziel automatisch an.'}</p>
    <p class="small muted">Eiweiß: 1,9–2,1 g pro kg Zielgewicht (${fmt(p.goal)} kg). Fett mindestens ${Math.round(p.goal * 0.7)} g, der Rest Kohlenhydrate.</p>
  </div>
  <div class="card">
    <h2>Tag eintragen</h2>
    <form data-form="nutrition" class="list" style="gap:10px">
      <label class="f">Datum<input type="date" name="date" value="${d}" max="${d}"></label>
      <div class="grid2">
        <label class="f">Kalorien gesamt<input name="kcal" inputmode="numeric" value="${n.kcal ?? ''}" placeholder="kcal"></label>
        <label class="f">Eiweiß gesamt (g)<input name="protein" inputmode="numeric" value="${n.protein ?? ''}" placeholder="g"></label>
      </div>
      <button>Speichern</button>
    </form>
  </div>
  <div class="card">
    <div class="row between"><h2>Letzte 14 Tage</h2>${avgK != null ? `<span class="small muted num">Ø 7 T: ${fmt(avgK, 0)} kcal · ${fmt(avgP, 0)} g</span>` : ''}</div>
    ${recent.length ? `<div class="list">${recent.map(x => `<div class="item"><span class="grow num">${dlong(x.date)}</span><span class="num small"><b>${fmt(x.kcal, 0)}</b> kcal · <b class="${(x.protein || 0) >= t.pMin ? '' : 'muted'}">${fmt(x.protein, 0)}</b> g</span><button class="icon" data-act="delNutrition" data-id="${x.date}" aria-label="Eintrag löschen">×</button></div>`).join('')}</div>` : '<p class="empty">Noch keine Einträge.</p>'}
  </div>
  <div class="card">
    <h2>Phasenplan</h2>
    <div class="scroll"><table class="t"><thead><tr><th>Gewicht</th><th>kcal Start</th><th>Tempo</th></tr></thead><tbody>
      ${[['über 110 kg', 2200, '0,7–1,0 kg/Wo', cw > 110], ['100–110 kg', 2100, '0,6–0,9 kg/Wo', cw > 100 && cw <= 110], ['92–100 kg', 2050, '0,5–0,8 kg/Wo', cw > 92 && cw <= 100], [`${fmt(p.goal)}–92 kg`, 2000, '0,4–0,6 kg/Wo', cw <= 92 && cw > p.goal]]
        .map(([a, k, r, on]) => `<tr${on ? ' style="font-weight:700"' : ''}><td>${a}${on ? ' ◀' : ''}</td><td>${fmt(k, 0)}</td><td>${r}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">Startwerte, bis die App genug eigene Daten hat. Alle 10–12 Wochen eine Woche auf Erhaltungskalorien (Diätpause).</p>
  </div>
  <div class="card">
    <h2>Grundregeln</h2>
    <ul class="small" style="margin:0;padding-left:1.1em;display:flex;flex-direction:column;gap:6px">
      <li>4 Mahlzeiten mit je 35–50 g Eiweiß.</li>
      <li>Jede Mahlzeit: Eiweiß + Gemüse oder Obst. Ballaststoffe 30–40 g pro Tag.</li>
      <li>Öl, Nüsse und Soßen immer abwiegen. Hier versteckt sich das meiste.</li>
      <li>Keine Kalorien trinken: Wasser, Kaffee, Tee, Zero-Getränke.</li>
      <li>Kohlenhydrate gern vor dem Training (Reis, Kartoffeln, Hafer, Obst).</li>
      <li>80 % unverarbeitet, 20 % bewusst eingeplanter Genuss.</li>
    </ul>
  </div>`;
};

/* Training */
VIEWS.training = sub => {
  sub = sub || 'start';
  const tabs = [['start', 'Start'], ['plaene', 'Pläne'], ['uebungen', 'Übungen'], ['geraete', 'Geräte'], ['verlauf', 'Verlauf']];
  const seg = sub === 'aktiv' ? '' : `<div class="seg">${tabs.map(([k, l]) => `<button class="${sub === k ? 'on' : ''}" data-act="go" data-href="#training/${k}">${l}</button>`).join('')}</div>`;
  return seg + (TRAIN[sub] || TRAIN.start)();
};
const TRAIN = {};
TRAIN.start = () => {
  const draft = kv('draft', null), ts = all('templates').sort((a, b) => a.order - b.order), nt = nextTemplate();
  const wk = weekStart(today()), week = all('workouts').filter(x => x.date >= wk);
  return `
  ${draft ? `<div class="card" style="background:var(--accent-soft)"><h2>${h(draft.name)} läuft</h2><a class="btn" href="#training/aktiv">Fortsetzen</a></div>` : ''}
  <div class="card">
    <div class="row between"><h2>Diese Woche</h2><span class="chip ${week.length >= 3 ? 'c-go' : 'c-acc'}">${week.length}/3</span></div>
    ${ts.length ? `<div class="list">${ts.map(t => `<div class="item"><div class="grow"><b>${h(t.name)}</b>${nt?.id === t.id ? ' <span class="chip c-acc">als Nächstes</span>' : ''}<p class="small muted">${t.items.length ? t.items.map(exName).map(h).join(', ') : 'Noch keine Übungen'}</p></div><button ${draft || !t.items.length ? 'disabled' : ''} data-act="startWorkout" data-id="${t.id}">Start</button></div>`).join('')}</div>` : '<p class="empty">Noch keine Pläne.</p>'}
  </div>
  <div class="card">
    <h2>Einrichtung in drei Schritten</h2>
    <div class="list">
      <a class="item" href="#training/geraete" style="color:inherit;text-decoration:none"><span class="chip ${S.equipment.size ? 'c-go' : 'c-acc'}">1</span><span class="grow">Geräte anlegen <span class="muted small">(${S.equipment.size})</span></span>›</a>
      <a class="item" href="#training/uebungen" style="color:inherit;text-decoration:none"><span class="chip ${S.exercises.size ? 'c-go' : 'c-acc'}">2</span><span class="grow">Übungen anlegen <span class="muted small">(${S.exercises.size})</span></span>›</a>
      <a class="item" href="#training/plaene" style="color:inherit;text-decoration:none"><span class="chip ${ts.some(t => t.items.length) ? 'c-go' : 'c-acc'}">3</span><span class="grow">Übungen den Plänen zuordnen</span>›</a>
    </div>
  </div>
  <details class="card"><summary>So trainierst du für schnellen Muskelaufbau</summary>
    <ul class="small" style="margin:0;padding-left:1.1em;display:flex;flex-direction:column;gap:6px">
      <li><b>Nah ans Versagen:</b> Beende jeden Satz, wenn noch 1–3 saubere Wiederholungen gingen (RIR = Wiederholungen in Reserve).</li>
      <li><b>Wiederholungen:</b> Grundübungen 6–12, Isolationsübungen 10–20. Leicht oder schwer baut ähnlich viel Muskel auf, wenn die Sätze hart sind.</li>
      <li><b>Steigerung:</b> Erst Wiederholungen bis zum oberen Ende steigern, dann Gewicht erhöhen. Die App schlägt dir das jedes Mal vor.</li>
      <li><b>Menge:</b> Start mit etwa 10 harten Sätzen pro Muskel und Woche, später 12–20.</li>
      <li><b>Beine nur 1× pro Woche:</b> Dann am Beintag 10–12 Sätze für Beine und Po einplanen. Ein bis zwei Beinübungen an Oberkörpertagen helfen zusätzlich.</li>
      <li><b>Technik vor Gewicht:</b> Kontrolliert ablassen (2–3 Sekunden), volle Bewegung.</li>
      <li><b>Alle 6–8 Wochen</b> eine leichtere Woche mit halber Satzzahl.</li>
    </ul>
  </details>`;
};
TRAIN.geraete = () => {
  const eqs = all('equipment').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const ed = editing.equipment ? S.equipment.get(editing.equipment) : null;
  return `
  <div class="card">
    <h2>${ed ? 'Gerät bearbeiten' : 'Neues Gerät'}</h2>
    <p class="small muted">Du musst den offiziellen Namen nicht kennen. Nimm einen Namen, den ihr im Homegym benutzt, z. B. „Grüne Beinmaschine" oder „Kabelturm links".</p>
    <form data-form="equipment" class="list" style="gap:10px">
      <label class="f">Name<input name="name" required value="${h(ed?.name)}" placeholder="z. B. Kabelturm"></label>
      <div class="grid2">
        <label class="f">Art<select name="type">${Object.entries(EQ_TYPES).map(([k, [l]]) => `<option value="${k}" ${ed?.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">Kleinste Steigerung (kg)<input name="inc" inputmode="decimal" value="${ed ? fmt(ed.inc, 2) : ''}" placeholder="automatisch"></label>
      </div>
      <label class="f">Notiz<input name="note" value="${h(ed?.note)}" placeholder="z. B. Sitz auf Stufe 4"></label>
      <div class="row"><button class="grow">${ed ? 'Änderungen speichern' : 'Gerät anlegen'}</button>${ed ? '<button type="button" class="sec" data-act="cancelEdit" data-kind="equipment">Abbrechen</button>' : ''}</div>
    </form>
  </div>
  <div class="card">
    <h2>Eure Geräte (${eqs.length})</h2>
    <div class="list">${eqs.map(e => `<div class="item"><div class="grow"><b>${h(e.name)}</b><p class="small muted">${EQ_TYPES[e.type]?.[0] ?? ''} · Steigerung ${fmt(e.inc, 2)} kg${e.note ? ' · ' + h(e.note) : ''}</p></div><button class="ghost" data-act="edit" data-kind="equipment" data-id="${e.id}">Bearbeiten</button><button class="icon" data-act="delEquipment" data-id="${e.id}" aria-label="Gerät löschen">×</button></div>`).join('') || '<p class="empty">Noch keine Geräte.</p>'}</div>
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
    <form data-form="exercise" class="list" style="gap:10px">
      <label class="f">Name<input name="name" list="exsuggest" required value="${h(ed?.name)}" placeholder="Tippen für Vorschläge"></label>
      <datalist id="exsuggest">${EX_SUGGEST.map(x => `<option value="${h(x)}">`).join('')}</datalist>
      <div class="grid2">
        <label class="f">Gerät<select name="equipmentId"><option value="">Ohne Gerät</option>${eqs.map(e => `<option value="${e.id}" ${ed?.equipmentId === e.id ? 'selected' : ''}>${h(e.name)}</option>`).join('')}</select></label>
        <label class="f">Hauptmuskel<select name="muscle">${MUSCLES.map(m => `<option ${ed?.muscle === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="f">Wdh. von<input name="repMin" inputmode="numeric" value="${ed?.repMin ?? 8}"></label>
        <label class="f">Wdh. bis<input name="repMax" inputmode="numeric" value="${ed?.repMax ?? 12}"></label>
        <label class="f">Sätze<input name="sets" inputmode="numeric" value="${ed?.sets ?? 3}"></label>
        <label class="f">Steigerung (kg)<input name="inc" inputmode="decimal" value="${ed?.inc ?? ''}" placeholder="vom Gerät"></label>
      </div>
      <div class="row"><button class="grow">${ed ? 'Änderungen speichern' : 'Übung anlegen'}</button>${ed ? '<button type="button" class="sec" data-act="cancelEdit" data-kind="exercise">Abbrechen</button>' : ''}</div>
    </form>
  </div>
  <div class="card">
    <h2>Übungen (${exs.length})</h2>
    <div class="list">${exs.map(x => {
      const b = bestE1rm(x.id), eq = S.equipment.get(x.equipmentId);
      const head = x.muscle !== lastMuscle ? `<p class="label" style="padding-top:10px">${h(x.muscle)}</p>` : '';
      lastMuscle = x.muscle;
      return `${head}<div class="item"><div class="grow"><b>${h(x.name)}</b><p class="small muted">${eq ? h(eq.name) : 'Ohne Gerät'} · ${x.sets}×${x.repMin}–${x.repMax}${b ? ` · Bestwert ${fmt(b.kg)} kg × ${b.r} (≈ ${fmt(b.v, 0)} kg Max)` : ''}</p></div><button class="ghost" data-act="edit" data-kind="exercise" data-id="${x.id}">Bearbeiten</button><button class="icon" data-act="delExercise" data-id="${x.id}" aria-label="Übung löschen">×</button></div>`;
    }).join('') || '<p class="empty">Noch keine Übungen.</p>'}</div>
  </div>`;
};
TRAIN.plaene = () => {
  const ts = all('templates').sort((a, b) => a.order - b.order);
  const exs = all('exercises').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return `
  ${ts.map(t => `<div class="card">
    <div class="row"><input value="${h(t.name)}" data-tname="${t.id}" aria-label="Name des Plans" style="font-weight:700"><button class="icon" data-act="delTemplate" data-id="${t.id}" aria-label="Plan löschen">×</button></div>
    <div class="list">${t.items.map((id, i) => `<div class="item"><span class="small muted num">${i + 1}</span><span class="grow">${h(exName(id))}</span><button class="icon" data-act="moveItem" data-id="${t.id}" data-i="${i}" data-dir="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon" data-act="moveItem" data-id="${t.id}" data-i="${i}" data-dir="1" aria-label="Nach unten" ${i === t.items.length - 1 ? 'disabled' : ''}>↓</button><button class="icon" data-act="removeItem" data-id="${t.id}" data-i="${i}" aria-label="Entfernen">×</button></div>`).join('') || '<p class="empty">Noch leer.</p>'}</div>
    ${exs.length ? `<select data-addto="${t.id}" aria-label="Übung hinzufügen"><option value="">+ Übung hinzufügen</option>${exs.filter(x => !t.items.includes(x.id)).map(x => `<option value="${x.id}">${h(x.name)} (${h(x.muscle)})</option>`).join('')}</select>` : '<p class="small muted">Lege zuerst Übungen an.</p>'}
  </div>`).join('')}
  <div class="card"><form data-form="template" class="row"><input name="name" placeholder="Neuer Plan, z. B. Oberkörper C" required><button>Anlegen</button></form></div>`;
};
TRAIN.verlauf = () => {
  const ws = all('workouts').sort((a, b) => b.date.localeCompare(a.date) || (b.finished || '').localeCompare(a.finished || ''));
  return `<div class="card"><h2>Trainings (${ws.length})</h2>
  <div class="list">${ws.map(w => {
    const sets = w.entries.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
    const vol = w.entries.reduce((a, e) => a + e.sets.filter(s => s.done).reduce((b, s) => b + (num(s.kg) || 0) * (num(s.reps) || 0), 0), 0);
    return `<details class="item" style="display:block"><summary class="row between"><span><b>${h(w.name)}</b> <span class="small muted">${dlong(w.date)}</span></span><span class="small muted num">${sets} Sätze · ${fmt(vol / 1000, 1)} t</span></summary>
      <div class="list small" style="padding-top:6px">${w.entries.filter(e => e.sets.some(s => s.done)).map(e => `<div class="item"><span class="grow">${h(exName(e.exerciseId))}</span><span class="num muted">${e.sets.filter(s => s.done).map(s => `${fmt(num(s.kg) || 0)}×${s.reps}`).join(' · ')}</span></div>`).join('')}</div>
      <button class="danger" data-act="delWorkout" data-id="${w.id}" style="margin-top:8px">Training löschen</button></details>`;
  }).join('') || '<p class="empty">Noch kein Training gespeichert.</p>'}</div></div>`;
};
TRAIN.aktiv = () => {
  const d = kv('draft', null);
  if (!d) return '<div class="card"><p class="empty">Kein laufendes Training.</p><a class="btn" href="#training">Zur Übersicht</a></div>';
  const exs = all('exercises').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return `
  <div class="card"><div class="row between"><div><h2>${h(d.name)}</h2><p class="small muted">${dlong(d.date)} · seit ${new Date(d.started).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</p></div><a class="small" href="#training" style="color:var(--accent)">Minimieren</a></div>
  <p class="small muted">Trage Gewicht, Wiederholungen und RIR ein (wie viele Wdh. noch gegangen wären). Tippe ✓, wenn der Satz fertig ist. Alles wird sofort gespeichert.</p></div>
  ${d.entries.map((e, ei) => {
    const ex = S.exercises.get(e.exerciseId);
    const sg = ex ? suggest(ex) : null;
    return `<div class="card">
      <div class="row between"><h2>${h(exName(e.exerciseId))}</h2><span class="small muted">${ex ? `${ex.repMin}–${ex.repMax} Wdh.` : ''}</span></div>
      ${sg ? `<p class="hint">${h(sg.text)}</p>` : ''}
      <div class="set head"><span>#</span><span>kg</span><span>Wdh.</span><span>RIR</span><span></span></div>
      ${e.sets.map((s, si) => `<div class="set${s.done ? ' done' : ''}"><span class="n">${si + 1}</span>
        <input inputmode="decimal" value="${h(s.kg)}" data-set="${ei}:${si}:kg" aria-label="Gewicht Satz ${si + 1}">
        <input inputmode="numeric" value="${h(s.reps)}" data-set="${ei}:${si}:reps" aria-label="Wiederholungen Satz ${si + 1}">
        <input inputmode="numeric" value="${h(s.rir)}" data-set="${ei}:${si}:rir" placeholder="2" aria-label="RIR Satz ${si + 1}">
        <button class="check${s.done ? ' on' : ''}" data-act="toggleSet" data-e="${ei}" data-s="${si}" aria-label="Satz ${si + 1} fertig" aria-pressed="${!!s.done}"></button></div>`).join('')}
      <div class="row"><button class="ghost" data-act="addSet" data-e="${ei}">+ Satz</button><button class="ghost" data-act="removeSet" data-e="${ei}" ${e.sets.length <= 1 ? 'disabled' : ''}>− Satz</button><span class="grow"></span><button class="ghost" data-act="removeEntry" data-e="${ei}" style="color:var(--bad)">Übung entfernen</button></div>
    </div>`;
  }).join('')}
  <div class="card">
    <select data-addentry="1" aria-label="Übung zum Training hinzufügen"><option value="">+ Übung hinzufügen</option>${exs.map(x => `<option value="${x.id}">${h(x.name)}</option>`).join('')}</select>
    <button data-act="finishWorkout">Training abschließen</button>
    <button class="danger" data-act="discardWorkout">Training verwerfen</button>
  </div>`;
};

/* Mehr */
const SUPPS = [
  { s: 's5', name: 'Kreatin-Monohydrat', what: 'Mehr Kraft und Wiederholungen, mehr Muskelaufbau. Eines der am besten erforschten Supplements überhaupt.', dose: '3–5 g täglich, Zeitpunkt egal, auch an trainingsfreien Tagen. Keine Ladephase nötig. Nur Monohydrat (am besten „Creapure"), andere Formen sind teurer und nicht besser.' },
  { s: 's5', name: 'Proteinpulver (Whey oder Mehrkomponenten)', what: 'Kein Wirkstoff, sondern bequemes Eiweiß. Hilft, 160–180 g pro Tag zu erreichen.', dose: '1–2 Portionen (25–40 g Eiweiß), wenn du das Ziel mit Essen nicht schaffst. Vegan: Erbse-Reis-Mischung.' },
  { s: 's3', name: 'Vitamin D3', what: 'Muskelfunktion, Knochen, Immunsystem. Bei Übergewicht und im Winter sehr häufig ein Mangel.', dose: 'Erst Blutwert (25-OH-D) messen lassen. Bei Mangel meist 1.000–4.000 IE täglich zu einer fetthaltigen Mahlzeit, nach Arztempfehlung.' },
  { s: 's3', name: 'Omega-3 (EPA/DHA)', what: 'Senkt Triglyzeride, unterstützt Herz und Gefäße. Für Muskelaufbau nur schwache Daten.', dose: '1–2 g EPA+DHA täglich, wenn du weniger als 2× pro Woche fetten Fisch isst. Algenöl ist die vegane Variante.' },
  { s: 's3', name: 'Koffein', what: 'Mehr Leistung und Konzentration im Training. Gut belegt.', dose: '3 mg pro kg (etwa 1–2 Tassen Kaffee) 30–60 Minuten vor dem Training. Nicht nach 14 Uhr, sonst leidet der Schlaf.' },
  { s: 's2', name: 'Magnesium, Eisen, Zink, B12, Jod', what: 'Nur sinnvoll bei nachgewiesenem Mangel oder veganer Ernährung (dann B12 immer).', dose: 'Blutbild machen lassen. Eisen nie ohne Messung einnehmen.' },
  { s: 's0', name: 'Fatburner, L-Carnitin, CLA, Grüntee-Extrakt, Garcinia, Himbeerketone', what: 'Kein relevanter Effekt auf den Fettabbau nachgewiesen. Teils Leberschäden (Grüntee-Extrakt in hohen Dosen).', dose: 'Geld sparen.' },
  { s: 's0', name: 'BCAAs, EAAs, Glutamin', what: 'Bei 160 g Eiweiß pro Tag ohne Zusatznutzen. Das Eiweiß in deinem Essen enthält diese Aminosäuren schon.', dose: 'Geld sparen.' },
  { s: 's0', name: 'Testo-Booster, Tribulus, „Anabol"-Pflanzenextrakte', what: 'Kein Effekt auf Testosteron oder Muskeln bei gesunden Männern. Teils mit verbotenen Stoffen verunreinigt.', dose: 'Finger weg.' },
  { s: 's0', name: 'Detox, Entwässerungstabletten, Kollagen gegen lose Haut', what: 'Detox ist Marketing. Für Kollagen gibt es schwache Hinweise auf Hautelastizität, aber nichts zu loser Haut nach Gewichtsverlust.', dose: 'Kein Nutzen für dein Ziel.' }
];
const SUPP_LABEL = { s5: ['c-go', 'Starke Evidenz'], s3: ['c-acc', 'Gute Evidenz, situativ'], s2: ['c-warn', 'Nur bei Mangel'], s0: ['c-bad', 'Nutzlos'] };

VIEWS.mehr = sub => (MORE[sub] || MORE.index)();
const MORE = {};
MORE.index = () => `
  <div class="card"><div class="list">
    ${[['gewohnheiten', 'Gewohnheiten', 'Was du täglich abhakst'], ['supplements', 'Supplements', 'Was wirkt, was Müll ist'], ['profil', 'Profil und Ziele', 'Größe, Alter, Start- und Zielgewicht'], ['daten', 'Datensicherung', 'Backup erstellen und wiederherstellen']]
      .map(([k, t, s]) => `<a class="item" href="#mehr/${k}" style="color:inherit;text-decoration:none"><div class="grow"><b>${t}</b><p class="small muted">${s}</p></div>›</a>`).join('')}
  </div></div>
  <div class="card"><h2>Wissen</h2><p class="small muted">Den vollständigen Ernährungs-Atlas mit allen Ernährungsformen findest du hier:</p><a class="btn sec" href="https://claude.ai/artifact/CTjbaxtYdYJ2QxqYrfMzh6" target="_blank" rel="noopener">Ernährungs-Atlas öffnen</a></div>`;
MORE.gewohnheiten = () => {
  const hs = all('habits').sort((a, b) => a.order - b.order);
  const d = today(), days = [...Array(14)].map((_, i) => addDays(d, -13 + i));
  return `
  <a class="small" href="#mehr" style="color:var(--accent)">‹ Mehr</a>
  <div class="card"><h2>Deine Gewohnheiten</h2>
    <div class="list">${hs.map((x, i) => {
      const streak = (() => { let n = 0; for (let k = 0; k < 365; k++) { const dd = addDays(d, -k); if (S.habitLog.get(dd)?.done?.[x.id]) n++; else if (k > 0) break; } return n; })();
      return `<div class="item"><div class="grow"><input value="${h(x.name)}" data-hname="${x.id}" aria-label="Name der Gewohnheit">
        <div class="row" style="gap:3px;padding-top:6px">${days.map(dd => `<span title="${dlong(dd)}" style="width:14px;height:14px;border-radius:4px;background:${S.habitLog.get(dd)?.done?.[x.id] ? 'var(--accent)' : 'var(--field)'}"></span>`).join('')}<span class="small muted" style="padding-left:6px">${streak} T</span></div></div>
        <button class="icon" data-act="moveHabit" data-i="${i}" data-dir="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon" data-act="delHabit" data-id="${x.id}" aria-label="Gewohnheit löschen">×</button></div>`;
    }).join('') || '<p class="empty">Keine Gewohnheiten.</p>'}</div>
    <form data-form="habit" class="row"><input name="name" placeholder="Neue Gewohnheit" required><button>Hinzufügen</button></form>
  </div>`;
};
MORE.supplements = () => `
  <a class="small" href="#mehr" style="color:var(--accent)">‹ Mehr</a>
  <div class="card"><h2>Supplements nach Studienlage</h2><p class="small muted">Bewertet nach kontrollierten Studien und Metaanalysen, nicht nach Herstellerangaben. Vor der Einnahme Blutwerte beim Hausarzt prüfen lassen.</p></div>
  ${SUPPS.map(x => `<div class="card"><div class="ev ${x.s}"><div class="row between wrap"><h3>${h(x.name)}</h3><span class="chip ${SUPP_LABEL[x.s][0]}">${SUPP_LABEL[x.s][1]}</span></div><p class="small">${h(x.what)}</p><p class="small muted"><b>Einnahme:</b> ${h(x.dose)}</p></div></div>`).join('')}
  <div class="card"><p class="small muted">Tipp: Lege „Kreatin genommen" als Gewohnheit an, dann hakst du es täglich ab.</p></div>`;
MORE.profil = () => {
  const p = prof();
  return `
  <a class="small" href="#mehr" style="color:var(--accent)">‹ Mehr</a>
  <div class="card"><h2>Profil und Ziele</h2>
  <form data-form="profile" class="list" style="gap:10px">
    <div class="grid2">
      <label class="f">Größe (cm)<input name="height" inputmode="numeric" value="${p.height}"></label>
      <label class="f">Alter<input name="age" inputmode="numeric" value="${p.age}"></label>
      <label class="f">Geschlecht<select name="sex"><option value="m" ${p.sex === 'm' ? 'selected' : ''}>männlich</option><option value="w" ${p.sex === 'w' ? 'selected' : ''}>weiblich</option></select></label>
      <label class="f">Startdatum<input type="date" name="startDate" value="${p.startDate || today()}"></label>
      <label class="f">Startgewicht (kg)<input name="start" inputmode="decimal" value="${fmt(p.start)}"></label>
      <label class="f">Zielgewicht (kg)<input name="goal" inputmode="decimal" value="${fmt(p.goal)}"></label>
    </div>
    <button>Speichern</button>
  </form>
  <p class="small muted">Das Zielgewicht bestimmt dein Eiweißziel. Mit mehr Muskelmasse kann ein etwas höheres Ziel (88–92 kg) besser aussehen. Du kannst es jederzeit ändern.</p></div>`;
};
MORE.daten = () => {
  const lb = kv('lastBackup', null), counts = Object.keys(STORES).filter(s => s !== 'kv').map(s => S[s].size).reduce((a, b) => a + b, 0);
  return `
  <a class="small" href="#mehr" style="color:var(--accent)">‹ Mehr</a>
  <div class="card"><h2>Wo deine Daten liegen</h2>
    <p class="small">Alle Daten liegen ausschließlich auf diesem Gerät in der Datenbank der App. Es gibt keinen Server und keine Cloud. Updates der App ändern nur den Programmcode, die Datenbank bleibt erhalten.</p>
    <p class="small"><b>Dauerhafter Speicher:</b> <span id="persist">wird geprüft…</span></p>
    <p class="small muted">${counts} Einträge gespeichert.${lb ? ` Letztes Backup: ${dlong(lb)}.` : ' Noch kein Backup.'}</p>
  </div>
  <div class="card"><h2>Backup erstellen</h2>
    <p class="small muted">Erstellt eine Datei mit allen Daten. Auf dem iPhone „In Dateien sichern" wählen, am besten in einen festen Ordner. Ab und zu auf den PC kopieren.</p>
    <button data-act="backup">Backup erstellen</button>
  </div>
  <div class="card"><h2>Backup wiederherstellen</h2>
    <p class="small muted">Ersetzt alle aktuellen Daten durch den Inhalt der Datei.</p>
    <label class="btn sec" for="importFile">Datei auswählen</label>
    <input type="file" id="importFile" accept="application/json,.json" hidden>
    <div id="importInfo"></div>
  </div>
  <div class="card"><h2>Wichtig</h2><p class="small">Wenn du die App vom Home-Bildschirm löschst, löscht iOS auch ihre Daten. Dagegen hilft nur das Backup. Mach es einmal pro Woche, die App erinnert dich daran.</p></div>`;
};

/* ---------- Aktionen ---------- */
const editing = { equipment: null, exercise: null };
let pendingImport = null;
const ACT = {};
const FORM = {};

function armed(el, label = 'Sicher?') {
  if (el.dataset.armed) return true;
  el.dataset.armed = '1'; const old = el.textContent; el.textContent = label;
  setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = old; } }, 3000);
  return false;
}

ACT.go = el => { location.hash = el.dataset.href; };
ACT.range = async el => { await setKv('ui.range', +el.dataset.v); render(); };
ACT.habit = async el => {
  const d = today(), log = S.habitLog.get(d) || { date: d, done: {} };
  log.done = { ...log.done, [el.dataset.id]: !log.done[el.dataset.id] };
  await put('habitLog', log); render();
};
ACT.delWeight = async el => { if (!armed(el, '?')) return; await del('weights', el.dataset.id); render(); };
ACT.delMeasure = async el => { if (!armed(el, '?')) return; await del('measures', el.dataset.id); render(); };
ACT.delNutrition = async el => { if (!armed(el, '?')) return; await del('nutrition', el.dataset.id); render(); };
ACT.edit = el => { editing[el.dataset.kind] = el.dataset.id; render(); scrollTo({ top: 0, behavior: 'smooth' }); };
ACT.cancelEdit = el => { editing[el.dataset.kind] = null; render(); };
ACT.delEquipment = async el => {
  const used = all('exercises').filter(x => x.equipmentId === el.dataset.id).length;
  if (!armed(el, used ? `${used} Üb.?` : '?')) return;
  await del('equipment', el.dataset.id); render();
};
ACT.delExercise = async el => {
  if (!armed(el, '?')) return;
  await del('exercises', el.dataset.id);
  for (const t of all('templates')) if (t.items.includes(el.dataset.id)) await put('templates', { ...t, items: t.items.filter(i => i !== el.dataset.id) });
  render();
};
ACT.delTemplate = async el => { if (!armed(el, '?')) return; await del('templates', el.dataset.id); render(); };
ACT.moveItem = async el => {
  const t = S.templates.get(el.dataset.id), i = +el.dataset.i, j = i + +el.dataset.dir, items = [...t.items];
  [items[i], items[j]] = [items[j], items[i]]; await put('templates', { ...t, items }); render();
};
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
  if (kv('draft', null)) { location.hash = '#training/aktiv'; return; }
  const t = S.templates.get(el.dataset.id);
  const entries = t.items.filter(id => S.exercises.has(id)).map(id => {
    const ex = S.exercises.get(id), sg = suggest(ex);
    return { exerciseId: id, sets: [...Array(+ex.sets || 3)].map(() => ({ kg: sg.kg === '' ? '' : fmt(sg.kg, 2), reps: String(sg.reps), rir: '', done: false })) };
  });
  await setKv('draft', { id: uid(), date: today(), templateId: t.id, name: t.name, started: new Date().toISOString(), entries });
  location.hash = '#training/aktiv';
};
const draft = () => kv('draft', null);
const saveDraft = d => setKv('draft', d);
ACT.toggleSet = async el => { const d = draft(), s = d.entries[+el.dataset.e].sets[+el.dataset.s]; s.done = !s.done; await saveDraft(d); render(); };
ACT.addSet = async el => { const d = draft(), e = d.entries[+el.dataset.e], l = e.sets[e.sets.length - 1] || { kg: '', reps: '' }; e.sets.push({ kg: l.kg, reps: l.reps, rir: '', done: false }); await saveDraft(d); render(); };
ACT.removeSet = async el => { const d = draft(), e = d.entries[+el.dataset.e]; e.sets.pop(); await saveDraft(d); render(); };
ACT.removeEntry = async el => { if (!armed(el)) return; const d = draft(); d.entries.splice(+el.dataset.e, 1); await saveDraft(d); render(); };
ACT.finishWorkout = async el => {
  const d = draft(), done = d.entries.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
  if (!done && !armed(el, 'Keine Sätze abgehakt. Trotzdem speichern?')) return;
  await put('workouts', { ...d, finished: new Date().toISOString() });
  await del('kv', 'draft');
  toast(`Gespeichert: ${done} Sätze. Stark!`);
  location.hash = '#training/verlauf';
};
ACT.discardWorkout = async el => { if (!armed(el, 'Wirklich verwerfen?')) return; await del('kv', 'draft'); location.hash = '#training'; };
ACT.backup = () => exportBackup();
ACT.restore = async el => {
  if (!pendingImport || !armed(el, 'Wirklich alle Daten ersetzen?')) return;
  for (const s of Object.keys(STORES)) {
    const t = db.transaction(s, 'readwrite'), st = t.objectStore(s);
    st.clear(); for (const row of pendingImport.stores[s] || []) st.put(row);
    await txDone(t);
  }
  pendingImport = null; await loadAll(); toast('Backup wiederhergestellt'); location.hash = '#heute';
};

FORM.quickWeight = async f => {
  const kg = num(f.kg.value); if (!kg || kg < 30 || kg > 300) return toast('Bitte ein Gewicht in kg eingeben.');
  const d = today(); await put('weights', { ...(S.weights.get(d) || {}), date: d, kg }); toast('Gewicht gespeichert');
};
FORM.weight = async f => {
  const kg = num(f.kg.value), fat = num(f.fat.value), d = f.date.value || today();
  if (!kg || kg < 30 || kg > 300) return toast('Bitte ein Gewicht in kg eingeben.');
  await put('weights', { date: d, kg, ...(fat ? { fat } : {}) }); toast('Gewicht gespeichert');
};
FORM.measure = async f => {
  const d = f.date.value || today(), m = { ...(S.measures.get(d) || {}), date: d };
  let any = false;
  for (const k of ['waist', 'hip', 'chest', 'arm', 'thigh', 'neck']) { const v = num(f[k].value); if (v) { m[k] = v; any = true; } }
  if (!any) return toast('Mindestens einen Umfang eintragen.');
  await put('measures', m); toast('Umfänge gespeichert');
};
FORM.nutrition = async f => {
  const d = f.date.value || today(), kcal = num(f.kcal.value), protein = num(f.protein.value);
  if (kcal == null && protein == null) return toast('Kalorien oder Eiweiß eintragen.');
  await put('nutrition', { ...(S.nutrition.get(d) || {}), date: d, kcal: kcal ?? S.nutrition.get(d)?.kcal ?? null, protein: protein ?? S.nutrition.get(d)?.protein ?? null });
  toast('Gespeichert');
};
FORM.equipment = async f => {
  const id = editing.equipment || uid(), type = f.type.value;
  const inc = num(f.inc.value);
  await put('equipment', { id, name: f.name.value.trim(), type, inc: inc ?? EQ_TYPES[type][1], note: f.note.value.trim() });
  editing.equipment = null; toast('Gerät gespeichert');
};
FORM.exercise = async f => {
  const id = editing.exercise || uid();
  let repMin = Math.round(num(f.repMin.value) || 8), repMax = Math.round(num(f.repMax.value) || 12);
  if (repMax < repMin) [repMin, repMax] = [repMax, repMin];
  const inc = num(f.inc.value);
  await put('exercises', { id, name: f.name.value.trim(), equipmentId: f.equipmentId.value || null, muscle: f.muscle.value, repMin, repMax, sets: clamp(Math.round(num(f.sets.value) || 3), 1, 10), inc: inc ?? null });
  editing.exercise = null; toast('Übung gespeichert');
};
FORM.template = async f => {
  const order = Math.max(-1, ...all('templates').map(t => t.order)) + 1;
  await put('templates', { id: uid(), name: f.name.value.trim(), items: [], order });
};
FORM.habit = async f => {
  const order = Math.max(-1, ...all('habits').map(t => t.order)) + 1;
  await put('habits', { id: uid(), name: f.name.value.trim(), order, active: true });
};
FORM.profile = async f => {
  const p = prof();
  await setKv('profile', {
    height: num(f.height.value) || p.height, age: num(f.age.value) || p.age, sex: f.sex.value,
    start: num(f.start.value) || p.start, goal: num(f.goal.value) || p.goal, startDate: f.startDate.value || p.startDate
  });
  toast('Profil gespeichert');
};

/* ---------- Backup ---------- */
async function exportBackup() {
  const data = { app: 'wandel', dbVersion: DB_VER, exported: new Date().toISOString(), stores: {} };
  for (const s of Object.keys(STORES)) data.stores[s] = all(s);
  const name = `wandel-backup-${today()}.json`;
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
    const n = Object.values(data.stores).reduce((a, r) => a + r.length, 0);
    box.innerHTML = `<p class="small">Backup vom ${dlong(data.exported.slice(0, 10))} mit ${n} Einträgen (${data.stores.weights?.length || 0} Gewichte, ${data.stores.workouts?.length || 0} Trainings).</p><button class="danger" data-act="restore">Wiederherstellen</button>`;
  } catch (e) { pendingImport = null; box.innerHTML = `<p class="small" style="color:var(--bad)">${h(e.message.startsWith('Unexpected') ? 'Die Datei ist beschädigt oder kein gültiges Backup.' : e.message)}</p>`; }
}

/* ---------- Router & Events ---------- */
function render() {
  const [tab, sub] = (location.hash.slice(1) || 'heute').split('/');
  const t = VIEWS[tab] ? tab : 'heute';
  $('#title').textContent = TITLES[t];
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === t));
  $('#view').innerHTML = VIEWS[t](sub);
  if (t === 'mehr' && sub === 'daten') {
    const el = $('#persist');
    (navigator.storage?.persisted ? navigator.storage.persisted() : Promise.resolve(null)).then(p => {
      el.textContent = p === true ? 'aktiv. iOS löscht die Daten nicht von sich aus.' : p === false ? 'nicht bestätigt. Die App als Home-Bildschirm-App nutzen und regelmäßig sichern.' : 'nicht prüfbar.';
    });
  }
}
window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el, e); }
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
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.tname) { const t = S.templates.get(el.dataset.tname); if (el.value.trim()) await put('templates', { ...t, name: el.value.trim() }); }
  else if (el.dataset.hname) { const x = S.habits.get(el.dataset.hname); if (el.value.trim()) await put('habits', { ...x, name: el.value.trim() }); }
  else if (el.dataset.addto && el.value) { const t = S.templates.get(el.dataset.addto); await put('templates', { ...t, items: [...t.items, el.value] }); render(); }
  else if (el.dataset.addentry && el.value) {
    const d = draft(), ex = S.exercises.get(el.value), sg = suggest(ex);
    d.entries.push({ exerciseId: ex.id, sets: [...Array(+ex.sets || 3)].map(() => ({ kg: sg.kg === '' ? '' : fmt(sg.kg, 2), reps: String(sg.reps), rir: '', done: false })) });
    await saveDraft(d); render();
  }
  else if (el.id === 'importFile' && el.files[0]) readImport(el.files[0]);
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
    render();
  } catch (e) {
    $('#view').innerHTML = `<div class="card"><h2>Die Datenbank konnte nicht geöffnet werden</h2><p class="small">${h(e.message)}</p><p class="small muted">In Safari im privaten Modus funktioniert die App nicht. Bitte normal öffnen.</p></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
