'use strict';
/* Essen: Tagebuch, Suche (Grundliste, eigene Produkte, Open Food Facts), Barcode-Scan, Gerichte, Statistik.
   Online wird nur der Suchbegriff bzw. die Barcode-Nummer an Open Food Facts geschickt. */
const MEALS = [['f', 'Frühstück'], ['m', 'Mittag'], ['a', 'Abend'], ['s', 'Snacks']];
const MEAL_NAME = Object.fromEntries(MEALS);
const OFF_WORLD = 'https://world.openfoodfacts.org';
const OFF_FIELDS = 'code,product_name,product_name_de,brands,nutriments,serving_size,serving_quantity,quantity';
const BASE_BY_ID = new Map(BASE_FOODS.map(f => [f.id, f]));
const norm = s => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
const tempFoods = new Map(); // Online-Treffer, noch nicht gespeichert
const getFood = id => S.foods.get(id) || BASE_BY_ID.get(id) || tempFoods.get(id) || null;
const fs = { q: '', meal: 'm', online: [], loading: false, err: '', seq: 0, dishFor: null, own: null };
let qTimer, amt = null, scanReader = null, scanDone = false;

function offToFood(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184;
  const name = (p.product_name_de || p.product_name || '').trim();
  if (kcal == null || !name) return null;
  const portions = [];
  if (+p.serving_quantity > 0) portions.push({ l: `1 Portion${p.serving_size ? ' (' + p.serving_size + ')' : ''}`, g: +p.serving_quantity });
  const qm = String(p.quantity || '').match(/([\d.,]+)\s*(g|ml|kg|l)\b/i);
  if (qm) { let g = num(qm[1]); if (/^(kg|l)$/i.test(qm[2])) g *= 1000; if (g > 0 && g <= 5000) portions.push({ l: 'Ganze Packung', g }); }
  return {
    id: 'off:' + p.code, code: String(p.code), name, brand: String(p.brands || '').split(',')[0].trim(), src: 'off',
    kcal: Math.round(+kcal), p: +(+n.proteins_100g || 0).toFixed(1), f: +(+n.fat_100g || 0).toFixed(1), c: +(+n.carbohydrates_100g || 0).toFixed(1),
    unit: qm && /ml|^l$/i.test(qm[2]) ? 'ml' : 'g', portions
  };
}
async function offByCode(code) {
  const r = await fetch(`${OFF_WORLD}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (!r.ok) return null;
  const j = await r.json();
  return j.status === 1 && j.product ? offToFood({ ...j.product, code }) : null;
}
const searchCache = new Map(); // gleiche Suche nicht erneut senden (Open Food Facts begrenzt Suchanfragen)
async function offSearch(q, retry = true) { // nur in Deutschland verkaufte Produkte, beliebteste zuerst
  const key = norm(q); if (searchCache.has(key)) return searchCache.get(key);
  const url = `${OFF_WORLD}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}&tagtype_0=countries&tag_contains_0=contains&tag_0=germany&sort_by=unique_scans_n`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const res = (j.products || []).map(offToFood).filter(Boolean);
    searchCache.set(key, res);
    return res;
  } catch (e) { // Open Food Facts begrenzt Suchanfragen pro Minute: einmal kurz warten und erneut versuchen
    if (!retry) throw e;
    await new Promise(r => setTimeout(r, 2000));
    return offSearch(q, false);
  }
}
function localSearch(q) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const pool = [...all('foods'), ...BASE_FOODS.filter(b => !S.foods.has(b.id))];
  return pool.map(f => {
    const n = norm(f.name + ' ' + (f.brand || ''));
    if (!words.every(w => n.includes(w))) return null;
    const score = (n.startsWith(words[0]) ? 0 : 1) + (f.src === 'own' ? -0.5 : 0) - Math.min(f.used || 0, 20) / 40;
    return { f, score };
  }).filter(Boolean).sort((a, b) => a.score - b.score || a.f.name.length - b.f.name.length).slice(0, 30).map(x => x.f);
}
const per100 = f => `${fmt(f.kcal, 0)} kcal · ${fmt(f.p, 1)} E · ${fmt(f.f, 1)} F · ${fmt(f.c, 1)} KH`;
const srcLabel = f => ({ base: 'Grundliste', own: 'Eigenes Produkt', off: 'Open Food Facts' })[f.src] || '';
function foodRow(f) {
  return `<button class="fooditem" data-act="pickFood" data-id="${h(f.id)}"><span class="grow left"><b>${h(f.name)}</b><span class="small muted block">${f.brand ? h(f.brand) + ' · ' : ''}${fmt(f.kcal, 0)} kcal / 100 ${f.unit || 'g'}${f.fav ? ' · ★' : ''}</span></span><span class="muted">+</span></button>`;
}

/* ---------- Ansichten ---------- */
TITLES.essen = 'Essen';
VIEWS.essen = (sub, arg) => {
  if (sub === 'add') { fs.meal = MEAL_NAME[arg] ? arg : fs.meal; return ESSEN.add(); }
  const tabs = [['', 'Tagebuch'], ['statistik', 'Statistik'], ['eigene', 'Eigene & Gerichte']];
  const k = sub || '';
  return `<div class="seg">${tabs.map(([t, l]) => `<button class="${k === t ? 'on' : ''}" data-act="go" data-href="#essen${t ? '/' + t : ''}">${l}</button>`).join('')}</div>` + (ESSEN[k || 'tagebuch'] || ESSEN.tagebuch)();
};
const ESSEN = {};
ESSEN.tagebuch = () => {
  const d = cur, isToday = d === today(), t = targets(), items = foodIndex().get(d) || [], tot = dayNut(d) || { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  const dp = dietPlan(), left = t.kcal - (tot.kcal || 0), yItems = foodIndex().get(addDays(d, -1)) || [];
  const manual = tot.src === 'manual';
  return `
  <div class="daynav">
    <button class="icon" data-act="day" data-n="-1" aria-label="Vorheriger Tag">‹</button>
    <label class="dlabel"><span>${isToday ? 'Heute' : wday(d)}, ${dlong(d)}</span><input type="date" id="curDate" value="${d}" max="${today()}" aria-label="Tag wählen"></label>
    <button class="icon" data-act="day" data-n="1" aria-label="Nächster Tag" ${isToday ? 'disabled' : ''}>›</button>
  </div>
  <div class="card">
    <div class="row between"><span class="label">Kalorien</span>${dp ? `<a class="chip c-acc" href="#wissen/plan">${h(dp.name)}</a>` : ''}</div>
    <div class="row between"><div class="big">${fmt(tot.kcal || 0, 0)} <span class="small muted">/ ${fmt(t.kcal, 0)} kcal</span></div><span class="chip ${left >= 0 ? 'c-go' : 'c-warn'}">${left >= 0 ? `noch ${fmt(left, 0)}` : `${fmt(-left, 0)} drüber`}</span></div>
    ${bar(tot.kcal || 0, t.kcal)}
    <div class="grid3">
      <div><p class="small muted">Eiweiß</p><p class="num"><b>${fmt(tot.protein || 0, 0)}</b> / ${t.pMin} g</p>${bar(tot.protein || 0, t.pMin)}</div>
      <div><p class="small muted">Fett</p><p class="num"><b>${fmt(tot.fat || 0, 0)}</b> / ${t.fat[1]} g</p>${bar(tot.fat || 0, t.fat[1], t.fat[0])}</div>
      <div><p class="small muted">KH</p><p class="num"><b>${fmt(tot.carbs || 0, 0)}</b> / ${t.carb[1]} g</p>${bar(tot.carbs || 0, t.carb[1], t.carb[0])}</div>
    </div>
    ${manual ? '<p class="small muted">Für diesen Tag sind nur manuelle Summen eingetragen. Sobald du hier Lebensmittel erfasst, zählen diese.</p>' : ''}
  </div>
  ${MEALS.map(([m, label]) => {
    const list = items.filter(x => x.meal === m), s = list.reduce((a, x) => a + x.kcal, 0), ylist = yItems.filter(x => x.meal === m);
    return `<div class="card meal">
      <div class="row between"><h2>${label}</h2><span class="small muted num">${list.length ? fmt(s, 0) + ' kcal' : ''}</span></div>
      ${list.length ? `<div class="list">${list.map(x => `<button class="item fooditem plain" data-act="editEntry" data-id="${x.id}"><span class="grow left"><b>${h(x.name)}</b><span class="small muted block">${fmt(x.g, 0)} ${x.unit || 'g'}${x.brand ? ' · ' + h(x.brand) : ''}</span></span><span class="num small right">${fmt(x.kcal, 0)} kcal<br><span class="muted">${fmt(x.p, 0)} g E</span></span></button>`).join('')}</div>` : ''}
      <div class="row wrap">
        <a class="btn grow" href="#essen/add/${m}">+ Hinzufügen</a>
        ${!list.length && ylist.length ? `<button class="sec" data-act="copyMeal" data-m="${m}">Wie gestern (${fmt(ylist.reduce((a, x) => a + x.kcal, 0), 0)} kcal)</button>` : ''}
        ${list.length > 1 ? `<button class="sec" data-act="dishForm" data-m="${m}">Als Gericht speichern</button>` : ''}
      </div>
      ${fs.dishFor === m ? `<form data-form="dish" class="row"><input type="hidden" name="meal" value="${m}"><input name="name" required placeholder="Name, z. B. Mein Chili" aria-label="Name des Gerichts"><button>Speichern</button></form>` : ''}
    </div>`;
  }).join('')}`;
};
ESSEN.add = () => {
  const m = fs.meal;
  return `<div class="row between"><a class="back" href="#essen">‹ Tagebuch</a><span class="small muted">${dlong(cur)}</span></div>
  <div class="seg">${MEALS.map(([k, l]) => `<button class="${k === m ? 'on' : ''}" data-act="go" data-href="#essen/add/${k}">${l}</button>`).join('')}</div>
  <div class="searchbar"><input id="foodQ" type="search" value="${h(fs.q)}" placeholder="Lebensmittel oder Marke suchen" autocomplete="off" aria-label="Lebensmittel suchen"></div>
  <div class="row"><button class="grow" data-act="scan">Barcode scannen</button><a class="btn sec grow" href="#essen/eigene" data-act="ownNew">+ Eigenes Produkt</a></div>
  <div id="foodRes">${resultsHTML()}</div>`;
};
function resultsHTML() {
  if (!fs.q.trim()) {
    const recent = all('foods').filter(f => f.lastUsed).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 15);
    const favs = all('foods').filter(f => f.fav).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const dishes = kv('dishes', []);
    return `${favs.length ? `<div class="card"><h3>Favoriten</h3><div class="list">${favs.map(foodRow).join('')}</div></div>` : ''}
      ${dishes.length ? `<div class="card"><h3>Gerichte</h3><div class="list">${dishes.map(g => `<button class="fooditem" data-act="addDish" data-id="${g.id}"><span class="grow left"><b>${h(g.name)}</b><span class="small muted block">${g.items.length} Zutaten · ${fmt(g.items.reduce((a, x) => a + x.kcal, 0), 0)} kcal</span></span><span class="muted">+</span></button>`).join('')}</div></div>` : ''}
      <div class="card"><h3>Zuletzt verwendet</h3>${recent.length ? `<div class="list">${recent.map(foodRow).join('')}</div>` : '<p class="small muted">Noch nichts erfasst. Suche oben oder scanne einen Barcode.</p>'}</div>`;
  }
  const loc = localSearch(fs.q), seen = new Set(loc.map(f => f.code).filter(Boolean));
  const onl = fs.online.filter(f => !seen.has(f.code) && !S.foods.has(f.id));
  return `<div class="card"><h3>In der App</h3>${loc.length ? `<div class="list">${loc.map(foodRow).join('')}</div>` : '<p class="small muted">Kein Treffer in Grundliste und eigenen Produkten.</p>'}</div>
    <div class="card"><h3>Online (Open Food Facts)</h3>
      ${fs.loading ? '<p class="small muted">Suche läuft…</p>' : fs.err ? `<p class="small bad">${h(fs.err)}</p>${navigator.onLine ? '<button class="ghost sm" data-act="retryOnline">Erneut online suchen</button>' : ''}` : onl.length ? `<div class="list">${onl.map(foodRow).join('')}</div>` : fs.q.trim().length < 3 ? '<p class="small muted">Ab 3 Buchstaben wird auch online gesucht.</p>' : '<p class="small muted">Keine Online-Treffer.</p>'}
    </div>`;
}
function updateResults() { const el = $('#foodRes'); if (el) el.innerHTML = resultsHTML(); }
function scheduleOnline() {
  clearTimeout(qTimer);
  const q = fs.q.trim();
  fs.online = []; fs.err = ''; fs.loading = false;
  if (q.length < 3) return updateResults();
  if (!navigator.onLine) { fs.err = 'Du bist offline. Gefunden wird nur, was in der App gespeichert ist.'; return updateResults(); }
  fs.loading = true; updateResults();
  const seq = ++fs.seq;
  qTimer = setTimeout(async () => {
    try { const res = await offSearch(q); if (seq !== fs.seq) return; res.forEach(f => tempFoods.set(f.id, f)); fs.online = res; }
    catch (e) { if (seq !== fs.seq) return; fs.err = 'Open Food Facts ist gerade ausgelastet (die Suche ist auf wenige Anfragen pro Minute begrenzt). Versuche es in einer Minute erneut. Barcode-Scan und die Grundliste funktionieren weiterhin.'; }
    fs.loading = false; updateResults();
  }, 900);
}

ESSEN.eigene = () => {
  const own = all('foods').filter(f => f.src === 'own').sort((a, b) => a.name.localeCompare(b.name, 'de')), o = fs.own || {};
  const dishes = kv('dishes', []);
  return `<div class="card"><h2>${o.id ? 'Produkt bearbeiten' : 'Eigenes Produkt anlegen'}</h2>
    <p class="small muted">Werte von der Verpackung, pro 100 g bzw. 100 ml.</p>
    <form data-form="ownFood" class="stack"><input type="hidden" name="id" value="${h(o.id || '')}">
      <label class="f">Name<input name="name" required value="${h(o.name)}" placeholder="z. B. Proteinbrot vom Bäcker"></label>
      <div class="grid2">
        <label class="f">Marke (optional)<input name="brand" value="${h(o.brand)}"></label>
        <label class="f">Barcode (optional)<input name="code" inputmode="numeric" value="${h(o.code)}"></label>
        <label class="f">Kalorien (kcal)<input name="kcal" inputmode="decimal" required value="${o.kcal ?? ''}"></label>
        <label class="f">Eiweiß (g)<input name="p" inputmode="decimal" value="${o.p ?? ''}"></label>
        <label class="f">Fett (g)<input name="f" inputmode="decimal" value="${o.f ?? ''}"></label>
        <label class="f">Kohlenhydrate (g)<input name="c" inputmode="decimal" value="${o.c ?? ''}"></label>
        <label class="f">Einheit<select name="unit"><option value="g" ${o.unit !== 'ml' ? 'selected' : ''}>Gramm</option><option value="ml" ${o.unit === 'ml' ? 'selected' : ''}>Milliliter</option></select></label>
        <label class="f">Portion (optional)<input name="pl" value="${h(o.portions?.[0]?.l || '')}" placeholder="z. B. 1 Scheibe"></label>
        <label class="f">Portion in g/ml<input name="pg" inputmode="decimal" value="${o.portions?.[0]?.g ?? ''}"></label>
      </div>
      <div class="row"><button class="grow">${o.id ? 'Speichern' : 'Anlegen'}</button>${o.id || o.code ? '<button type="button" class="sec" data-act="ownCancel">Abbrechen</button>' : ''}</div>
    </form></div>
  <div class="card"><h2>Eigene Produkte (${own.length})</h2>${own.length ? `<div class="list">${own.map(f => `<div class="item"><div class="grow"><b>${h(f.name)}</b><p class="small muted">${per100(f)}</p></div><button class="ghost" data-act="ownEdit" data-id="${h(f.id)}">Bearbeiten</button><button class="icon" data-act="ownDel" data-id="${h(f.id)}" aria-label="Löschen">×</button></div>`).join('')}</div>` : '<p class="empty">Noch keine.</p>'}</div>
  <div class="card"><h2>Gerichte (${dishes.length})</h2><p class="small muted">Im Tagebuch bei einer Mahlzeit „Als Gericht speichern" tippen. Danach fügst du das ganze Gericht mit einem Tipp hinzu.</p>
    ${dishes.length ? `<div class="list">${dishes.map(g => `<div class="item"><div class="grow"><b>${h(g.name)}</b><p class="small muted">${g.items.map(x => `${h(x.name)} ${fmt(x.g, 0)} ${x.unit || 'g'}`).join(', ')}</p></div><span class="num small">${fmt(g.items.reduce((a, x) => a + x.kcal, 0), 0)} kcal</span><button class="icon" data-act="dishDel" data-id="${g.id}" aria-label="Gericht löschen">×</button></div>`).join('')}</div>` : ''}</div>
  <div class="card"><p class="small muted">Produktdaten von Open Food Facts stehen unter der Open Database License (ODbL). Werte können Fehler enthalten. Im Zweifel gilt die Verpackung.</p></div>`;
};

ESSEN.statistik = () => {
  const range = kv('food.range', 30), t = targets(), d0 = addDays(today(), -(range - 1));
  const days = [...Array(range)].map((_, i) => addDays(d0, i)), rows = days.map(d => ({ d, n: dayNut(d) })).filter(x => x.n && x.n.kcal);
  const avg = k => rows.length ? rows.reduce((a, x) => a + (x.n[k] || 0), 0) / rows.length : null;
  const inKcal = rows.filter(x => x.n.kcal <= t.kcal * 1.05 && x.n.kcal >= t.kcal * 0.8).length, protOk = rows.filter(x => x.n.protein >= t.pMin).length;
  const carbMax = dietPlan()?.macro?.carbMax, carbOk = carbMax ? rows.filter(x => x.n.carbs != null && x.n.carbs <= carbMax).length : null;
  const ap = avg('protein'), af = avg('fat'), ac = avg('carbs'), mk = (ap || 0) * 4 + (af || 0) * 9 + (ac || 0) * 4;
  const logs = all('foodlog').filter(x => x.date >= d0);
  const top = {}; for (const x of logs) { const k = x.foodId || x.name; (top[k] ||= { name: x.name, kcal: 0, p: 0, n: 0 }); top[k].kcal += x.kcal; top[k].p += x.p; top[k].n++; }
  const topK = Object.values(top).sort((a, b) => b.kcal - a.kcal).slice(0, 8), topP = Object.values(top).sort((a, b) => b.p - a.p).slice(0, 5);
  const mealK = MEALS.map(([m, l]) => [l, logs.filter(x => x.meal === m).reduce((a, x) => a + x.kcal, 0)]), mealSum = mealK.reduce((a, x) => a + x[1], 0);
  const kPts = rows.map(x => ({ d: x.d, y: x.n.kcal })), pPts = rows.map(x => ({ d: x.d, y: x.n.protein || 0 }));
  return `<div class="seg">${[[7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage']].map(([v, l]) => `<button class="${range === v ? 'on' : ''}" data-act="kv" data-k="food.range" data-v="${v}" data-num="1">${l}</button>`).join('')}</div>
  <div class="tiles">
    <div class="tile"><span>Ø Kalorien</span><b>${avg('kcal') != null ? fmt(avg('kcal'), 0) : '–'}</b><small>Ziel ${fmt(t.kcal, 0)}</small></div>
    <div class="tile"><span>Ø Eiweiß</span><b>${ap != null ? fmt(ap, 0) + ' g' : '–'}</b><small>Ziel ${t.pMin} g</small></div>
    <div class="tile"><span>Erfasst</span><b>${rows.length}/${range}</b><small>Tage</small></div>
    <div class="tile"><span>Ø Fett</span><b>${af != null ? fmt(af, 0) + ' g' : '–'}</b><small>${t.fat[0]}–${t.fat[1]} g</small></div>
    <div class="tile"><span>Ø KH</span><b>${ac != null ? fmt(ac, 0) + ' g' : '–'}</b><small>${t.carb[0]}–${t.carb[1]} g</small></div>
    <div class="tile"><span>Eiweißziel</span><b>${rows.length ? `${protOk}/${rows.length}` : '–'}</b><small>Tage erreicht</small></div>
  </div>
  <div class="card"><h2>Kalorien pro Tag</h2>${chart([{ pts: kPts, cls: 'dots' }, { pts: rolling(kPts), cls: 'trend' }], { goal: t.kcal, label: 'Kalorien', h: 150, minPad: 50, empty: 'Ab zwei erfassten Tagen erscheint hier der Verlauf.' })}
    <p class="small muted">Punkte: Tage. Linie: 7-Tage-Schnitt. Gestrichelt: dein Ziel. Im Zielbereich (80–105 %) an ${inKcal} von ${rows.length} Tagen.</p></div>
  <div class="card"><h2>Eiweiß pro Tag</h2>${chart([{ pts: pPts, cls: 'dots' }, { pts: rolling(pPts), cls: 'trend' }], { goal: t.pMin, label: 'Eiweiß', h: 130, minPad: 10, empty: 'Ab zwei erfassten Tagen erscheint hier der Verlauf.' })}</div>
  ${mk ? `<div class="card"><h2>Makro-Verteilung</h2><div class="stack3"><i style="width:${(ap * 4 / mk * 100).toFixed(1)}%" class="mp"></i><i style="width:${(af * 9 / mk * 100).toFixed(1)}%" class="mf"></i><i style="width:${(ac * 4 / mk * 100).toFixed(1)}%" class="mc"></i></div>
    <div class="legend row wrap"><span><i class="mp"></i>Eiweiß ${fmt(ap * 4 / mk * 100, 0)} %</span><span><i class="mf"></i>Fett ${fmt(af * 9 / mk * 100, 0)} %</span><span><i class="mc"></i>Kohlenhydrate ${fmt(ac * 4 / mk * 100, 0)} %</span></div>
    ${carbMax ? `<p class="small muted">Kohlenhydrate unter ${carbMax} g an ${carbOk} von ${rows.length} Tagen.</p>` : ''}</div>` : ''}
  ${mealSum ? `<div class="card"><h2>Kalorien nach Mahlzeit</h2>${mealK.map(([l, k]) => `<div class="hrow"><span>${l}</span><b class="num">${fmt(k / mealSum * 100, 0)} %</b>${bar(k, mealSum)}</div>`).join('')}</div>` : ''}
  ${topK.length ? `<div class="card"><h2>Größte Kalorienquellen</h2><div class="list">${topK.map(x => `<div class="item"><span class="grow">${h(x.name)} <span class="small muted">${x.n}×</span></span><b class="num">${fmt(x.kcal, 0)} kcal</b></div>`).join('')}</div></div>
  <div class="card"><h2>Beste Eiweißquellen</h2><div class="list">${topP.map(x => `<div class="item"><span class="grow">${h(x.name)}</span><b class="num">${fmt(x.p, 0)} g</b></div>`).join('')}</div></div>` : ''}`;
};

/* ---------- Mengen-Fenster ---------- */
function openAmount(food, entry) {
  closeAmount();
  const g0 = entry ? entry.g : (food.portions?.[0]?.g || 100);
  amt = { food, entry, meal: entry ? entry.meal : fs.meal, g: g0 };
  const sh = document.createElement('div'); sh.className = 'sheetwrap'; sh.id = 'amtSheet';
  sh.innerHTML = amountHTML();
  document.body.appendChild(sh);
  setTimeout(() => $('#amtG')?.select(), 50);
}
function amountHTML() {
  const f = amt.food, u = f.unit || 'g', fav = S.foods.get(f.id)?.fav;
  const chips = [{ l: `100 ${u}`, g: 100 }, ...(f.portions || [])];
  return `<div class="sheet" role="dialog" aria-label="Menge wählen">
    <div class="row between"><div class="grow"><h2>${h(f.name)}</h2><p class="small muted">${f.brand ? h(f.brand) + ' · ' : ''}${srcLabel(f)}</p></div>${f.src !== 'temp' ? `<button class="icon fav${fav ? ' on' : ''}" data-act="amtFav" aria-label="Favorit">${fav ? '★' : '☆'}</button>` : ''}</div>
    <p class="small muted">Pro 100 ${u}: ${per100(f)}</p>
    <div class="chips">${chips.map(c => `<button class="mchip" data-act="amtChip" data-g="${c.g}">${h(c.l)}${c.l.includes(String(c.g)) ? '' : ` · ${fmt(c.g, 0)} ${u}`}</button>`).join('')}</div>
    <div class="stepper"><button data-act="amtStep" data-d="-1" aria-label="weniger">−</button><label><input id="amtG" inputmode="decimal" value="${fmt(amt.g, 1)}" aria-label="Menge"><span>${u}</span></label><button data-act="amtStep" data-d="1" aria-label="mehr">+</button></div>
    <div class="seg">${MEALS.map(([k, l]) => `<button class="${amt.meal === k ? 'on' : ''}" data-act="amtMeal" data-m="${k}">${l}</button>`).join('')}</div>
    <p class="amttot num" id="amtTot">${amtTotals()}</p>
    <button class="bigbtn" data-act="amtSave">${amt.entry ? 'Speichern' : 'Hinzufügen'}</button>
    <div class="row">${amt.entry ? '<button class="danger grow" data-act="amtDel">Löschen</button>' : ''}<button class="sec grow" data-act="amtClose">Abbrechen</button></div>
  </div>`;
}
function amtTotals() {
  const f = amt.food, k = (amt.g || 0) / 100;
  return `<b>${fmt(f.kcal * k, 0)} kcal</b> · ${fmt(f.p * k, 1)} g Eiweiß · ${fmt(f.f * k, 1)} g Fett · ${fmt(f.c * k, 1)} g KH`;
}
function closeAmount() { $('#amtSheet')?.remove(); amt = null; }
function rerenderAmount() { const el = $('#amtSheet'); if (el && amt) el.innerHTML = amountHTML(); }
async function cacheFood(f, patch = {}) { // verwendete Lebensmittel lokal behalten (Zuletzt, Favoriten, offline)
  const old = S.foods.get(f.id) || {};
  const { src } = f;
  await put('foods', { ...f, ...old, ...patch, id: f.id, src: src === 'temp' ? 'off' : (old.src || src) });
}

ACT.retryOnline = () => scheduleOnline();
ACT.pickFood = el => { const f = getFood(el.dataset.id); if (f) openAmount(f); };
ACT.amtChip = el => { amt.g = +el.dataset.g; const i = $('#amtG'); if (i) i.value = fmt(amt.g, 1); $('#amtTot').innerHTML = amtTotals(); };
ACT.amtStep = el => { const st = amt.g >= 100 ? 10 : 5; amt.g = Math.max(0, Math.round((amt.g + +el.dataset.d * st) / st) * st); $('#amtG').value = fmt(amt.g, 1); $('#amtTot').innerHTML = amtTotals(); };
ACT.amtMeal = el => { amt.meal = el.dataset.m; rerenderAmount(); };
ACT.amtClose = () => closeAmount();
ACT.amtFav = async () => { const f = amt.food, now = !S.foods.get(f.id)?.fav; await cacheFood(f, { fav: now }); toast(now ? 'Als Favorit gespeichert' : 'Favorit entfernt'); rerenderAmount(); };
ACT.amtSave = async () => {
  const f = amt.food, g = amt.g; if (!(g > 0)) return toast('Bitte eine Menge eingeben.');
  const k = g / 100, old = amt.entry;
  const rec = { id: old?.id || uid(), date: old?.date || cur, meal: amt.meal, foodId: f.id, name: f.name, brand: f.brand || '', unit: f.unit || 'g', g,
    kcal: Math.round(f.kcal * k), p: +(f.p * k).toFixed(1), f: +(f.f * k).toFixed(1), c: +(f.c * k).toFixed(1), created: old?.created || Date.now() };
  await put('foodlog', rec);
  if (!old) await cacheFood(f, { used: (S.foods.get(f.id)?.used || 0) + 1, lastUsed: Date.now() });
  const meal = amt.meal; closeAmount();
  toast(old ? 'Gespeichert' : `${f.name} zu ${MEAL_NAME[meal]} hinzugefügt`);
  if (location.hash.startsWith('#essen/add')) { fs.q = ''; fs.online = []; render(); $('#foodQ')?.focus(); } else render();
};
ACT.amtDel = async el => { if (!armed(el, 'Wirklich löschen?')) return; await del('foodlog', amt.entry.id); closeAmount(); render(); };
ACT.editEntry = el => {
  const x = S.foodlog.get(el.dataset.id); if (!x) return;
  const f = getFood(x.foodId) || { id: x.foodId || 'x:' + x.id, name: x.name, brand: x.brand, unit: x.unit, src: 'own', kcal: x.kcal / x.g * 100, p: x.p / x.g * 100, f: x.f / x.g * 100, c: x.c / x.g * 100, portions: [] };
  openAmount(f, x);
};
ACT.copyMeal = async el => {
  const m = el.dataset.m, src = (foodIndex().get(addDays(cur, -1)) || []).filter(x => x.meal === m);
  for (const x of src) await put('foodlog', { ...x, id: uid(), date: cur, created: Date.now() });
  toast(`${src.length} Einträge übernommen`); render();
};
ACT.dishForm = el => { fs.dishFor = fs.dishFor === el.dataset.m ? null : el.dataset.m; render(); };
FORM.dish = async f => {
  const items = (foodIndex().get(cur) || []).filter(x => x.meal === f.meal.value).map(({ foodId, name, brand, unit, g, kcal, p, f: fat, c }) => ({ foodId, name, brand, unit, g, kcal, p, f: fat, c }));
  await setKv('dishes', [...kv('dishes', []), { id: uid(), name: f.name.value.trim(), items }]);
  fs.dishFor = null; toast('Gericht gespeichert');
};
ACT.addDish = async el => {
  const g = kv('dishes', []).find(x => x.id === el.dataset.id); if (!g) return;
  for (const it of g.items) await put('foodlog', { ...it, id: uid(), date: cur, meal: fs.meal, created: Date.now() });
  toast(`${g.name} zu ${MEAL_NAME[fs.meal]} hinzugefügt`); location.hash = '#essen';
};
ACT.dishDel = async el => { if (!armed(el, '?')) return; await setKv('dishes', kv('dishes', []).filter(x => x.id !== el.dataset.id)); render(); };
ACT.ownNew = () => { fs.own = { returnTo: '#essen/add/' + fs.meal }; };
ACT.ownEdit = el => { fs.own = { ...S.foods.get(el.dataset.id) }; render(); scrollTo({ top: 0, behavior: 'smooth' }); };
ACT.ownCancel = () => { fs.own = null; render(); };
ACT.ownDel = async el => { if (!armed(el, '?')) return; await del('foods', el.dataset.id); render(); };
FORM.ownFood = async f => {
  const kcal = num(f.kcal.value); if (kcal == null) return toast('Bitte die Kalorien eintragen.');
  const pg = num(f.pg.value), code = f.code.value.replace(/\D/g, '');
  const food = { ...(S.foods.get(f.id.value) || {}), id: f.id.value || 'own:' + uid(), src: 'own', name: f.name.value.trim(), brand: f.brand.value.trim(), code,
    kcal: Math.round(kcal), p: num(f.p.value) || 0, f: num(f.f.value) || 0, c: num(f.c.value) || 0, unit: f.unit.value,
    portions: pg ? [{ l: f.pl.value.trim() || '1 Portion', g: pg }] : [] };
  await put('foods', food);
  const back = fs.own?.returnTo; fs.own = null;
  toast('Produkt gespeichert');
  if (back) { location.hash = back; setTimeout(() => openAmount(food), 50); }
};

/* ---------- Barcode ---------- */
function loadScript(src) {
  return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Scanner konnte nicht geladen werden')); document.head.appendChild(s); });
}
ACT.scan = async () => {
  closeScanner(); scanDone = false;
  const ov = document.createElement('div'); ov.className = 'scanner'; ov.id = 'scanner';
  ov.innerHTML = `<div class="vbar"><span>Barcode scannen</span><button class="icon" data-act="closeScan" aria-label="Schließen">×</button></div>
    <div class="scanbox"><video id="scanVideo" playsinline muted autoplay></video><div class="scanline"></div></div>
    <p class="small">Strichcode in den Rahmen halten. Klappt es nicht, Nummer eintippen:</p>
    <form data-form="manualCode" class="row"><input name="code" inputmode="numeric" placeholder="z. B. 4000417025005" aria-label="Barcode-Nummer"><button>Suchen</button></form>`;
  document.body.appendChild(ov);
  applyScanOrientation();
  window.addEventListener('resize', onScanTurn); window.addEventListener('orientationchange', onScanTurn);
  try { await screen.orientation?.lock?.('portrait'); } catch (e) { } // klappt auf Android, iOS ignoriert es
  try {
    await loadScript('lib/zxing.min.js');
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E]);
    scanReader = new ZXing.BrowserMultiFormatReader(hints, 250);
    await scanReader.decodeFromConstraints({ video: { facingMode: 'environment' } }, 'scanVideo', res => {
      if (res && !scanDone) { scanDone = true; navigator.vibrate?.(80); const code = res.getText(); closeScanner(); handleCode(code); }
    });
  } catch (e) {
    const msg = /Permission|NotAllowed/i.test(e.name + e.message) ? 'Kamera-Zugriff wurde nicht erlaubt. In den iPhone-Einstellungen unter Safari → Kamera erlauben.' : 'Kamera nicht verfügbar. Gib die Nummer unten ein.';
    const p = ov.querySelector('p'); if (p) p.textContent = msg;
  }
};
/* iOS dreht Web-Apps beim Neigen mit und erlaubt keine Hochformat-Sperre. Bei Querformat dreht die App
   den Scanner deshalb zurück (fest wie im Hochformat) und das Kamerabild wieder aufrecht. */
function scanAngle() {
  let a = window.__testAngle ?? screen.orientation?.angle ?? window.orientation ?? 0;
  a = ((+a % 360) + 360) % 360; if (a > 180) a -= 360;
  return a; // 0, 90, -90 oder 180
}
function applyScanOrientation() {
  const ov = $('#scanner'); if (!ov) return;
  const a = scanAngle(), W = innerWidth, H = innerHeight, v = $('#scanVideo');
  if (Math.abs(a) !== 90 || W <= H) { ov.style.cssText = ''; if (v) v.style.cssText = ''; return; }
  ov.style.cssText = `inset:auto;width:${H}px;height:${W}px;left:${(W - H) / 2}px;top:${(H - W) / 2}px;transform:rotate(${-a}deg)`;
  requestAnimationFrame(() => {
    const box = ov.querySelector('.scanbox'); if (!box || !v) return;
    const bw = box.clientWidth, bh = box.clientHeight;
    v.style.cssText = `position:absolute;width:${bh}px;height:${bw}px;left:${(bw - bh) / 2}px;top:${(bh - bw) / 2}px;transform:rotate(${a}deg)`;
  });
}
const onScanTurn = () => setTimeout(applyScanOrientation, 60);
function closeScanner() {
  try { scanReader?.reset(); } catch (e) { } scanReader = null; $('#scanner')?.remove();
  window.removeEventListener('resize', onScanTurn); window.removeEventListener('orientationchange', onScanTurn);
  try { screen.orientation?.unlock?.(); } catch (e) { }
}
ACT.closeScan = () => closeScanner();
FORM.manualCode = async f => { const code = f.code.value.replace(/\D/g, ''); if (code.length < 8) return toast('Bitte die ganze Nummer eingeben.'); scanDone = true; closeScanner(); await handleCode(code); };
async function handleCode(code) {
  const known = all('foods').find(x => x.code === code);
  if (known) return openAmount(known);
  if (!navigator.onLine) return ownFromCode(code, 'Du bist offline. Lege das Produkt mit den Werten von der Verpackung an.');
  toast('Suche Produkt…');
  try {
    const f = await offByCode(code);
    if (f) { tempFoods.set(f.id, f); return openAmount(f); }
    ownFromCode(code, 'Produkt nicht gefunden. Lege es mit den Werten von der Verpackung an. Danach findet die App es beim nächsten Scan sofort.');
  } catch (e) { ownFromCode(code, 'Abfrage fehlgeschlagen. Lege das Produkt mit den Werten von der Verpackung an.'); }
}
function ownFromCode(code, msg) {
  fs.own = { code, returnTo: '#essen/add/' + fs.meal };
  location.hash = '#essen/eigene'; toast(msg);
}

/* ---------- Events ---------- */
document.addEventListener('input', e => {
  if (e.target.id === 'foodQ') { fs.q = e.target.value; scheduleOnline(); }
  else if (e.target.id === 'amtG' && amt) { amt.g = num(e.target.value) || 0; const t = $('#amtTot'); if (t) t.innerHTML = amtTotals(); }
});
window.addEventListener('hashchange', () => { closeAmount(); closeScanner(); if (!location.hash.startsWith('#essen/add')) { fs.q = ''; fs.online = []; } });
