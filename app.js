'use strict';

// ---------- Lưu trữ ----------
const KEY = 'anduchat.v1';
const PORTIONS = [[0.7, 'Ít'], [1, 'Vừa'], [1.3, 'Nhiều']];
const KIND_NAMES = { ngoai: 'Ăn ngoài', nha: 'Món nhà', sang: 'Bữa sáng', vat: 'Ăn vặt / uống' };

function freshState() {
  return {
    v: 1,
    plan: JSON.parse(JSON.stringify(DEFAULT_PLAN)),
    logs: {},
    health: [],
    custom: {},
    settings: { budget: 450, hidden: [], targets: { ...DEFAULT_TARGETS }, assume: true, recheck: '', exam: '' },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const base = freshState();
      return { ...base, ...s, settings: { ...base.settings, ...s.settings,
        targets: { ...DEFAULT_TARGETS, ...(s.settings && s.settings.targets) } } };
    }
  } catch (e) { /* bỏ qua, dùng trạng thái mới */ }
  return freshState();
}

let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Không lưu được — bộ nhớ trình duyệt bị chặn?'); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- Ngày tháng ----------
const pad = n => String(n).padStart(2, '0');
const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return dk(d); };
const todayKey = () => dk(new Date());
const weekStart = s => { const d = parse(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return dk(d); };
const WD = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const fmtDay = s => { const d = parse(s); return `${WD[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}`; };
const fmtShort = s => { const d = parse(s); return `${d.getDate()}/${d.getMonth() + 1}`; };

// ---------- Dinh dưỡng ----------
const zero = () => NUTRIENTS.map(() => 0);
const addInto = (acc, v, k = 1) => { for (let i = 0; i < acc.length; i++) acc[i] += (v[i] || 0) * k; return acc; };
const dish = id => S.custom[id] || DISHES[id];
const dishName = id => (dish(id) ? dish(id).name : '(món đã xoá)');

function dishNut(id) {
  const d = dish(id);
  if (!d) return zero();
  if (d.n) return d.n;
  const acc = zero();
  for (const [f, g] of d.ing) if (FOODS[f]) addInto(acc, FOODS[f].n, g / 100);
  return acc;
}

function planFor(date) { return (S.plan[parse(date).getDay()] || {}); }

// Trạng thái 1 bữa: ok | swap | skip (đã xác nhận), assumed (ngày đã qua, chưa điền), plan (chưa tới).
function meal(date, slot) {
  const log = S.logs[date] && S.logs[date][slot];
  const planned = planFor(date)[slot] || [];
  if (log) {
    return { st: log.st, por: log.por || 1,
             dishes: log.st === 'skip' ? [] : (log.dishes || planned) };
  }
  const past = date < todayKey();
  return { st: past && S.settings.assume ? 'assumed' : 'plan', por: 1, dishes: planned };
}
const extras = date => (S.logs[date] && S.logs[date].extra) || [];

function mealNut(m) {
  const acc = zero();
  for (const id of m.dishes) addInto(acc, dishNut(id), m.por);
  return acc;
}

// eaten: những gì coi như đã ăn; proj: eaten + phần kế hoạch chưa tới.
function dayTotals(date) {
  const eaten = zero(), proj = zero();
  for (const { key } of SLOTS) {
    const m = meal(date, key);
    const v = mealNut(m);
    if (m.st !== 'plan') addInto(eaten, v);
    addInto(proj, v);
  }
  for (const x of extras(date)) { addInto(eaten, dishNut(x.d), x.q); addInto(proj, dishNut(x.d), x.q); }
  return { eaten, proj };
}

function weekTotals(ws) {
  const eaten = zero(), proj = zero();
  let daysEaten = 0, pending = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const t = dayTotals(d);
    addInto(eaten, t.eaten); addInto(proj, t.proj);
    if (d <= todayKey()) daysEaten++;
    for (const { key } of SLOTS) if (meal(d, key).st === 'assumed') pending++;
  }
  return { eaten, proj, daysEaten, pending };
}

const T = () => S.settings.targets;
const fmtNum = (v, unit) => (unit === 'g' && v < 100 ? v.toFixed(1).replace('.0', '') : Math.round(v).toLocaleString('vi-VN'));

// ---------- Tiện ích giao diện ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200);
}

let tab = 'today';
let curDay = todayKey();
let curWeek = weekStart(todayKey());
let shopMode = 'this';
let planOpen = null;

function render() {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const main = $('#main');
  main.innerHTML = ({ today: viewToday, week: viewWeek, shop: viewShop, plan: viewPlan, health: viewHealth })[tab]();
  main.scrollTop = 0;
}

// Thanh tiến độ: phần đặc = đã ăn, phần nhạt = dự kiến.
function bar(key, eaten, proj, days) {
  const meta = NUTRIENTS[NI[key]];
  const target = T()[key] * days;
  const pe = Math.min(eaten / target, 1.5), pp = Math.min(proj / target, 1.5);
  let cls = 'ok';
  if (meta.limit) cls = pp > 1 ? 'bad' : 'ok';
  else cls = pp >= 0.9 ? 'ok' : pp >= 0.6 ? 'mid' : 'bad';
  const pct = Math.round((meta.limit ? proj : proj) / target * 100);
  return `<div class="bar ${cls}">
    <div class="bar-head"><span>${meta.name}</span>
      <span class="num">${fmtNum(proj / days, meta.unit)} / ${fmtNum(T()[key], meta.unit)} ${meta.unit}${meta.limit ? ' (tối đa)' : ''} · <b>${pct}%</b></span></div>
    <div class="track"><div class="fill proj" style="width:${Math.min(pp, 1) * 100}%"></div>
      <div class="fill eat" style="width:${Math.min(pe, 1) * 100}%"></div>
      ${meta.limit ? '' : '<div class="mark"></div>'}</div></div>`;
}

function bars(eaten, proj, days, keys) {
  return keys.map(k => bar(k, eaten[NI[k]], proj[NI[k]], days)).join('');
}

// ---------- Hôm nay ----------
function viewToday() {
  const isToday = curDay === todayKey();
  const cards = SLOTS.map(({ key, name }) => slotCard(key, name)).join('');
  const ex = extras(curDay).map((x, i) => `<li>${esc(dishName(x.d))}${x.q !== 1 ? ' ×' + x.q : ''}
      <button class="x" data-act="rmExtra" data-i="${i}" aria-label="Xoá">×</button></li>`).join('');
  const t = dayTotals(curDay);
  return `
    <header class="head">
      <button class="nav" data-act="day" data-n="-1" aria-label="Hôm trước">‹</button>
      <div><h1>${isToday ? 'Hôm nay' : fmtDay(curDay)}</h1><p class="sub">${isToday ? fmtDay(curDay) : '<a data-act="dayToday">về hôm nay</a>'}</p></div>
      <button class="nav" data-act="day" data-n="1" aria-label="Hôm sau">›</button>
    </header>
    ${cards}
    <section class="card">
      <div class="row"><h3>Ăn thêm ngoài thực đơn</h3><button class="btn sm" data-act="addExtra">+ Thêm</button></div>
      ${ex ? `<ul class="extras">${ex}</ul>` : '<p class="muted">Trà sữa, nước ngọt, hoa quả, sữa thêm… bấm “+ Thêm”.</p>'}
    </section>
    <section class="card">
      <h3>Trong ngày</h3>
      <p class="muted">Đậm = đã ăn · nhạt = còn theo kế hoạch. Vạch dọc = mục tiêu.</p>
      ${bars(t.eaten, t.proj, 1, ['k', 'mg', 'zn', 'ca', 'fib', 'pro', 'vita', 'vitc', 'sat', 'sug'])}
    </section>`;
}

function slotCard(key, name) {
  const m = meal(curDay, key);
  const label = { ok: '✓ Đã ăn', swap: '🔄 Đã đổi món', skip: '✕ Bỏ bữa',
                  assumed: 'Chưa xác nhận — tạm tính theo thực đơn', plan: 'Theo thực đơn' }[m.st];
  const confirmed = ['ok', 'swap', 'skip'].includes(m.st);
  const list = m.dishes.length ? m.dishes.map(id => `<li>${esc(dishName(id))}</li>`).join('')
                               : '<li class="muted">Không ăn</li>';
  const por = m.st !== 'skip' ? `<div class="chips">${PORTIONS.map(([v, n]) =>
      `<button class="chip ${confirmed && m.por === v ? 'on' : ''}" data-act="por" data-slot="${key}" data-v="${v}">${n}</button>`).join('')}</div>` : '';
  return `<section class="card slot st-${m.st}">
    <div class="row"><h3>${name}</h3><span class="tag">${label}</span></div>
    <ul class="dishes">${list}</ul>
    <div class="actions">
      ${confirmed ? '' : `<button class="btn primary" data-act="ate" data-slot="${key}">✓ Đã ăn</button>`}
      ${por}
      <button class="btn" data-act="swap" data-slot="${key}">Đổi món</button>
      ${m.st === 'skip' ? '' : `<button class="btn ghost" data-act="skip" data-slot="${key}">Bỏ</button>`}
      ${confirmed ? `<button class="btn ghost" data-act="undo" data-slot="${key}">Hoàn tác</button>` : ''}
    </div></section>`;
}

function setLog(slot, val) {
  S.logs[curDay] = S.logs[curDay] || {};
  if (val === null) delete S.logs[curDay][slot]; else S.logs[curDay][slot] = val;
  save(); render();
}

// ---------- Tuần ----------
function viewWeek() {
  const w = weekTotals(curWeek);
  const isThis = curWeek === weekStart(todayKey());
  const deficits = FOCUS.filter(k => k !== 'fe')
    .map(k => [k, w.proj[NI[k]] / (T()[k] * 7)]).filter(([, r]) => r < 0.9).sort((a, b) => a[1] - b[1]);
  const over = ['sat', 'sug'].filter(k => w.proj[NI[k]] > T()[k] * 7);
  const tips = [...deficits.slice(0, 3).map(([k]) => TIPS[k]), ...over.map(k => TIPS[k])];
  return `
    <header class="head">
      <button class="nav" data-act="week" data-n="-1" aria-label="Tuần trước">‹</button>
      <div><h1>Tuần ${fmtShort(curWeek)} – ${fmtShort(addDays(curWeek, 6))}</h1>
        <p class="sub">${isThis ? 'Tuần này' : `<a data-act="weekNow">về tuần này</a>`}${w.pending ? ` · ${w.pending} bữa chưa xác nhận` : ''}</p></div>
      <button class="nav" data-act="week" data-n="1" aria-label="Tuần sau">›</button>
    </header>
    ${tips.length ? `<section class="card warn"><h3>Cần chú ý</h3><ul class="tips">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <button class="btn primary" data-act="goShop">Xem gợi ý đi chợ</button></section>`
      : `<section class="card good"><h3>Tuần này đủ chất 👏</h3><p>Các chất chính đều đạt ≥ 90% mục tiêu.</p></section>`}
    <section class="card"><h3>Khoáng chất & xơ</h3>
      <p class="muted">Trung bình mỗi ngày, tính cả phần kế hoạch còn lại của tuần.</p>
      ${bars(w.eaten, w.proj, 7, ['k', 'mg', 'zn', 'ca', 'fe', 'fib', 'pro'])}</section>
    <section class="card"><h3>Cho mắt</h3>${bars(w.eaten, w.proj, 7, ['vita', 'vitc', 'o3'])}</section>
    <section class="card"><h3>Giới hạn (tốt cho gan và mỡ máu)</h3>${bars(w.eaten, w.proj, 7, ['sat', 'sug'])}
      <p class="muted">Năng lượng TB: ${fmtNum(w.proj[0] / 7)} kcal/ngày (mục tiêu ~${T().kcal}).</p></section>`;
}

// ---------- Đi chợ ----------
function shopping() {
  const thisWs = weekStart(todayKey());
  const ws = shopMode === 'this' ? thisWs : addDays(thisWs, 7);
  const from = shopMode === 'this' ? todayKey() : ws;
  const need = {};             // foodId -> gam theo kế hoạch
  let outCost = 0;
  for (let d = from; d <= addDays(ws, 6); d = addDays(d, 1)) {
    for (const { key } of SLOTS) {
      const m = shopMode === 'this' ? meal(d, key) : { dishes: planFor(d)[key] || [], por: 1, st: 'plan' };
      if (m.st !== 'plan') continue;
      for (const id of m.dishes) {
        const ds = dish(id);
        if (!ds) continue;
        if (ds.n) { outCost += ds.price || 0; continue; }
        for (const [f, g] of ds.ing) if (FOODS[f] && FOODS[f].src === 'mua') need[f] = (need[f] || 0) + g * m.por;
      }
    }
  }
  const planRows = Object.entries(need).map(([f, g]) => row(f, g)).sort((a, b) => b.cost - a.cost);
  const planCost = planRows.reduce((s, r) => s + r.cost, 0);

  // Dự kiến cả tuần: tuần này = đã ăn + phần còn lại; tuần sau = chỉ theo kế hoạch.
  let proj;
  if (shopMode === 'this') proj = weekTotals(ws).proj.slice();
  else { proj = zero(); for (let i = 0; i < 7; i++) { const d = addDays(ws, i);
    for (const { key } of SLOTS) for (const id of planFor(d)[key] || []) addInto(proj, dishNut(id)); } }

  // Tham lam: lấy chất đang thiếu nhất, mua món rẻ nhất tính theo chất đó, lặp lại.
  let left = S.settings.budget - planCost;
  const add = {}, why = {}, stuck = new Set();
  const goal = k => T()[k] * 7 * 0.95;
  for (let it = 0; it < 30; it++) {
    const lacking = FOCUS.filter(k => k !== 'fe' && !stuck.has(k) && proj[NI[k]] < goal(k))
      .sort((a, b) => proj[NI[a]] / goal(a) - proj[NI[b]] / goal(b));
    if (!lacking.length) break;
    const k = lacking[0];
    const cands = Object.entries(FOODS).filter(([id, f]) => f.src === 'mua' && f.max && f.n[NI[k]] > 0
        && !S.settings.hidden.includes(id) && (add[id] || 0) < f.max && f.n[NI.sug] === 0)
      .map(([id, f]) => [id, f.n[NI[k]] / f.price / (f.n[NI.sat] > 5 ? 3 : 1)])
      .sort((a, b) => b[1] - a[1]);
    if (!cands.length || left <= 0) { stuck.add(k); continue; }
    const [id] = cands[0];
    const f = FOODS[id];
    let g = (goal(k) - proj[NI[k]]) / (f.n[NI[k]] / 100);
    g = Math.min(g, f.max - (add[id] || 0), left / f.price * 100);
    const u = f.unitG || 100;
    g = Math.max(u, Math.ceil(g / u) * u);
    if (g / 100 * f.price > left + 5) { stuck.add(k); continue; }
    add[id] = (add[id] || 0) + g;
    addInto(proj, f.n, g / 100);
    left -= g / 100 * f.price;
    (why[id] = why[id] || new Set()).add(NUTRIENTS[NI[k]].name);
  }
  const extraRows = Object.entries(add).map(([f, g]) => ({ ...row(f, g), why: [...why[f]] }));
  const extraCost = extraRows.reduce((s, r) => s + r.cost, 0);
  const stillLow = FOCUS.filter(k => k !== 'fe' && proj[NI[k]] < T()[k] * 7 * 0.8);
  return { planRows, planCost, extraRows, extraCost, outCost, stillLow, proj };
}

function row(f, g) {
  const food = FOODS[f];
  const u = food.unitG && food.unitG > 1 ? `${Math.ceil(g / food.unitG)} ${food.unit}` : `${Math.round(g / 50) * 50 || Math.round(g)} g`;
  return { f, name: food.name, g, qty: u, cost: g / 100 * food.price };
}

const money = k => `${Math.round(k)}k`;

function viewShop() {
  const r = shopping();
  const list = rows => rows.map(x => `<li><span>${esc(x.name)}<small>${x.why ? ' — bù ' + x.why.join(', ') : ''}</small></span>
      <span class="q">${x.qty}</span><span class="c">${money(x.cost)}</span></li>`).join('');
  return `
    <header class="head plain"><div><h1>Đi chợ</h1><p class="sub">Ngân sách ${money(S.settings.budget)}/tuần (không tính ăn ngoài, đồ quê)</p></div></header>
    <div class="seg">
      <button class="${shopMode === 'this' ? 'on' : ''}" data-act="shopMode" data-v="this">Phần còn lại tuần này</button>
      <button class="${shopMode === 'next' ? 'on' : ''}" data-act="shopMode" data-v="next">Cả tuần sau</button>
    </div>
    <section class="card"><div class="row"><h3>Theo thực đơn</h3><b>${money(r.planCost)}</b></div>
      ${r.planRows.length ? `<ul class="shop">${list(r.planRows)}</ul>` : '<p class="muted">Không cần mua gì thêm cho thực đơn.</p>'}
      <p class="muted">Đồ quê, gạo, dầu, gia vị không tính vào đây.</p></section>
    <section class="card accent"><div class="row"><h3>Mua thêm để đủ chất</h3><b>${money(r.extraCost)}</b></div>
      ${r.extraRows.length ? `<ul class="shop">${list(r.extraRows)}</ul>` : '<p class="muted">Thực đơn đã gần đủ — không cần mua thêm.</p>'}
      ${r.stillLow.length ? `<p class="note">Vẫn còn thiếu: ${r.stillLow.map(k => NUTRIENTS[NI[k]].name).join(', ')}.</p>
        <ul class="tips">${r.stillLow.map(k => `<li>${esc(TIPS[k])}</li>`).join('')}</ul>` : ''}
    </section>
    <section class="card"><div class="row"><span>Tổng đi chợ</span><b>${money(r.planCost + r.extraCost)}</b></div>
      <div class="row"><span>Ăn ngoài (ước tính)</span><b>${money(r.outCost)}</b></div></section>`;
}

// ---------- Thực đơn ----------
const ORDER = [1, 2, 3, 4, 5, 6, 0];
function viewPlan() {
  const days = ORDER.map(wd => {
    const p = S.plan[wd] || {};
    const open = planOpen === wd;
    const slots = SLOTS.map(({ key, name }) => `<div class="pslot" data-act="editPlan" data-wd="${wd}" data-slot="${key}">
        <b>${name}</b><span>${(p[key] || []).map(id => esc(dishName(id))).join(' · ') || '<i class="muted">trống</i>'}</span></div>`).join('');
    return `<section class="card day ${open ? 'open' : ''}">
      <div class="row" data-act="togglePlan" data-wd="${wd}"><h3>${WD[wd]}</h3><span class="muted">${open ? '▴' : '▾'}</span></div>
      ${open ? slots : `<p class="muted one">${esc(['trua', 'toi'].map(k => (p[k] || []).filter(id => id !== 'com').map(dishName).join(', ')).join(' / '))}</p>`}
    </section>`;
  }).join('');
  const customs = Object.entries(S.custom).map(([id, d]) => `<li>${esc(d.name)} <small class="muted">${KIND_NAMES[d.kind]}</small>
      <button class="x" data-act="delCustom" data-id="${id}" aria-label="Xoá">×</button></li>`).join('');
  return `
    <header class="head plain"><div><h1>Thực đơn tuần</h1><p class="sub">Bấm vào một ngày để sửa. Tối nấu dư mang cơm trưa hôm sau.</p></div></header>
    ${days}
    <section class="card"><div class="row"><h3>Món của tôi</h3><button class="btn sm" data-act="newCustom">+ Tạo món</button></div>
      ${customs ? `<ul class="extras">${customs}</ul>` : '<p class="muted">Tự tạo món từ nguyên liệu (ví dụ món quê mới).</p>'}</section>
    <button class="btn ghost wide" data-act="resetPlan">Khôi phục thực đơn mẫu</button>`;
}

// ---------- Sức khỏe & cài đặt ----------
function viewHealth() {
  const ws = weekStart(todayKey());
  const cur = S.health.find(h => h.wk === ws) || {};
  const hist = [...S.health].sort((a, b) => a.wk < b.wk ? 1 : -1);
  const st = S.settings;
  return `
    <header class="head plain"><div><h1>Sức khỏe</h1><p class="sub">Ghi mỗi tuần một lần, sáng sớm trước khi ăn.</p></div></header>
    <section class="card"><h3>Tuần ${fmtShort(ws)}</h3>
      <div class="form">
        <label>Cân nặng (kg)<input type="number" inputmode="decimal" step="0.1" id="h_kg" value="${cur.kg || ''}"></label>
        <label>Vòng bụng (cm)<input type="number" inputmode="decimal" step="0.5" id="h_eo" value="${cur.eo || ''}"></label>
        <label>Mệt mỏi (1 khỏe – 5 rất mệt)<input type="number" inputmode="numeric" min="1" max="5" id="h_met" value="${cur.met || ''}"></label>
        <label>Số lần đồ ngọt (trà sữa, nước ngọt)<input type="number" inputmode="numeric" min="0" id="h_ngot" value="${cur.ngot ?? ''}"></label>
        <label class="full">Ghi chú<input type="text" id="h_note" value="${esc(cur.note || '')}"></label>
      </div>
      <button class="btn primary wide" data-act="saveHealth">Lưu tuần này</button>
      <p class="muted">Vòng bụng đo ngang rốn. Với sức khỏe gan và mỡ máu, vòng bụng giảm quan trọng hơn cân nặng.</p></section>
    ${hist.length >= 2 ? `<section class="card"><h3>Xu hướng</h3>${chart(hist.slice().reverse())}</section>` : ''}
    ${hist.length ? `<section class="card"><h3>Lịch sử</h3><table class="hist"><tr><th>Tuần</th><th>kg</th><th>Eo</th><th>Mệt</th><th>Ngọt</th></tr>
      ${hist.map(h => `<tr><td>${fmtShort(h.wk)}</td><td>${h.kg || '–'}</td><td>${h.eo || '–'}</td><td>${h.met || '–'}</td><td>${h.ngot ?? '–'}</td></tr>`).join('')}</table></section>` : ''}
    <section class="card"><h3>Kết quả khám gần nhất</h3>
      <p class="muted">Chỉ lưu trên điện thoại này. Ghi các chỉ số cần theo dõi để lần sau so sánh.</p>
      <label class="full">Ghi chú khám<textarea id="s_exam" rows="4" placeholder="VD: 10/09: cholesterol …, siêu âm gan …">${esc(st.exam || '')}</textarea></label>
      <label class="full">Hẹn khám lại<input type="date" id="s_recheck" value="${st.recheck || ''}"></label>
      ${st.recheck ? `<p class="note">Còn ${Math.max(0, Math.round((parse(st.recheck) - parse(todayKey())) / 864e5))} ngày.</p>` : ''}
      <p class="muted">App chỉ hỗ trợ ăn uống, không thay lời khuyên của bác sĩ.</p></section>
    <section class="card"><h3>Cài đặt</h3>
      <label>Ngân sách đi chợ (nghìn đồng/tuần)<input type="number" inputmode="numeric" id="s_budget" value="${st.budget}"></label>
      <label class="check"><input type="checkbox" id="s_assume" ${st.assume ? 'checked' : ''}> Bữa đã qua mà chưa điền thì coi như ăn đúng thực đơn</label>
      <details><summary>Thực phẩm không muốn được gợi ý</summary><div class="hidden-list">
        ${Object.entries(FOODS).filter(([, f]) => f.src === 'mua').map(([id, f]) =>
          `<label class="check"><input type="checkbox" data-hide="${id}" ${st.hidden.includes(id) ? 'checked' : ''}> ${esc(f.name)}</label>`).join('')}</div></details>
      <details><summary>Mục tiêu mỗi ngày</summary><div class="form">
        ${NUTRIENTS.map(n => `<label>${n.name} (${n.unit})<input type="number" inputmode="decimal" data-target="${n.key}" value="${st.targets[n.key]}"></label>`).join('')}</div></details>
      <button class="btn primary wide" data-act="saveSettings">Lưu cài đặt</button></section>
    <section class="card"><h3>Sao lưu</h3>
      <p class="muted">Dữ liệu chỉ nằm trên điện thoại này. Mỗi tuần nên xuất 1 bản và lưu vào Tệp/iCloud.</p>
      <div class="actions"><button class="btn" data-act="export">Xuất bản sao lưu</button>
        <label class="btn">Nhập bản sao lưu<input type="file" accept="application/json,.json" id="importFile" hidden></label></div>
      <button class="btn ghost wide danger" data-act="wipe">Xoá toàn bộ dữ liệu</button></section>`;
}

function chart(hist) {
  const W = 320, H = 120, P = 24;
  const line = (key, cls) => {
    const pts = hist.map((h, i) => [i, +h[key]]).filter(([, v]) => v > 0);
    if (pts.length < 2) return '';
    const vs = pts.map(p => p[1]); const lo = Math.min(...vs) - 1, hi = Math.max(...vs) + 1;
    const xy = pts.map(([i, v]) => [P + i * (W - 2 * P) / Math.max(1, hist.length - 1), H - P - (v - lo) / (hi - lo) * (H - 2 * P)]);
    return `<polyline class="${cls}" points="${xy.map(p => p.join(',')).join(' ')}"/>` +
      xy.map(([x, y], j) => `<circle class="${cls}" cx="${x}" cy="${y}" r="3"/><text x="${x}" y="${y - 7}" class="lbl">${pts[j][1]}</text>`).join('');
  };
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Cân nặng và vòng bụng theo tuần">${line('kg', 'l1')}${line('eo', 'l2')}</svg>
    <p class="legend"><span class="k1"></span>Cân nặng <span class="k2"></span>Vòng bụng</p>`;
}

// ---------- Bảng chọn món ----------
let picker = null;
function openPicker({ title, selected = [], kinds = ['nha', 'ngoai', 'sang', 'vat'], onSave }) {
  picker = { title, sel: [...selected], kind: kinds[0], kinds, onSave, q: '' };
  drawPicker();
}
function drawPicker() {
  const p = picker;
  const all = { ...DISHES, ...S.custom };
  const items = Object.entries(all).filter(([, d]) => d.kind === p.kind && (!p.q || d.name.toLowerCase().includes(p.q)));
  $('#sheet').innerHTML = `<div class="sheet-body">
    <div class="row"><h3>${esc(p.title)}</h3><button class="x" data-act="pickClose" aria-label="Đóng">×</button></div>
    <div class="picked">${p.sel.length ? p.sel.map((id, i) => `<button class="chip on" data-act="pickRm" data-i="${i}">${esc(dishName(id))} ×</button>`).join('') : '<span class="muted">Chưa chọn món nào</span>'}</div>
    <div class="seg small">${p.kinds.map(k => `<button class="${k === p.kind ? 'on' : ''}" data-act="pickKind" data-k="${k}">${KIND_NAMES[k]}</button>`).join('')}</div>
    <div class="pick-list">${items.map(([id, d]) => `<button class="pick" data-act="pickAdd" data-id="${id}">${esc(d.name)}${d.price ? `<small>~${d.price}k</small>` : ''}</button>`).join('')}</div>
    <button class="btn primary wide" data-act="pickSave">Lưu</button></div>`;
  $('#sheet').classList.add('show');
}
function closeSheet() { $('#sheet').classList.remove('show'); $('#sheet').innerHTML = ''; picker = null; }

// ---------- Tạo món ----------
function openCustom() {
  picker = null;
  const opts = Object.entries(FOODS).map(([id, f]) => `<option value="${id}">${esc(f.name)}</option>`).join('');
  const ingRow = () => `<div class="ing"><select>${opts}</select><input type="number" inputmode="numeric" placeholder="gam"></div>`;
  $('#sheet').innerHTML = `<div class="sheet-body">
    <div class="row"><h3>Tạo món</h3><button class="x" data-act="pickClose" aria-label="Đóng">×</button></div>
    <label>Tên món<input type="text" id="c_name" placeholder="VD: Cá thu kho"></label>
    <label>Loại<select id="c_kind">${['nha', 'sang', 'vat'].map(k => `<option value="${k}">${KIND_NAMES[k]}</option>`).join('')}</select></label>
    <p class="muted">Nguyên liệu cho 1 suất:</p>
    <div id="c_ings">${ingRow()}${ingRow()}</div>
    <button class="btn sm" data-act="addIng">+ Nguyên liệu</button>
    <button class="btn primary wide" data-act="saveCustom">Lưu món</button></div>`;
  $('#sheet').dataset.ingrow = ingRow();
  $('#sheet').classList.add('show');
}

// ---------- Sự kiện ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act], .tabbar button');
  if (!el) { if (e.target.id === 'sheet') closeSheet(); return; }
  if (el.dataset.tab) { tab = el.dataset.tab; planOpen = null; render(); return; }
  const a = el.dataset.act, slot = el.dataset.slot;
  switch (a) {
    case 'day': curDay = addDays(curDay, +el.dataset.n); render(); break;
    case 'dayToday': curDay = todayKey(); render(); break;
    case 'week': curWeek = addDays(curWeek, 7 * el.dataset.n); render(); break;
    case 'weekNow': curWeek = weekStart(todayKey()); render(); break;
    case 'goShop': tab = 'shop'; render(); break;
    case 'ate': setLog(slot, { st: 'ok', por: 1 }); break;
    case 'skip': setLog(slot, { st: 'skip' }); break;
    case 'undo': setLog(slot, null); break;
    case 'por': {
      const m = meal(curDay, slot);
      const st = ['ok', 'swap'].includes(m.st) ? m.st : 'ok';
      setLog(slot, { st, por: +el.dataset.v, ...(st === 'swap' ? { dishes: m.dishes } : {}) });
      break;
    }
    case 'swap': {
      const m = meal(curDay, slot);
      openPicker({ title: `Đổi món — ${SLOTS.find(s => s.key === slot).name}`, selected: m.dishes,
        kinds: slot === 'sang' ? ['sang', 'ngoai', 'nha', 'vat'] : slot === 'vat' ? ['vat', 'sang', 'nha', 'ngoai'] : ['ngoai', 'nha', 'sang', 'vat'],
        onSave: sel => setLog(slot, { st: 'swap', por: m.por || 1, dishes: sel }) });
      break;
    }
    case 'addExtra':
      openPicker({ title: 'Ăn thêm', kinds: ['vat', 'sang', 'nha', 'ngoai'], onSave: sel => {
        S.logs[curDay] = S.logs[curDay] || {};
        S.logs[curDay].extra = [...extras(curDay), ...sel.map(d => ({ d, q: 1 }))];
        save(); render();
      } });
      break;
    case 'rmExtra': S.logs[curDay].extra.splice(+el.dataset.i, 1); save(); render(); break;
    case 'shopMode': shopMode = el.dataset.v; render(); break;
    case 'togglePlan': planOpen = planOpen === +el.dataset.wd ? null : +el.dataset.wd; render(); break;
    case 'editPlan': {
      const wd = +el.dataset.wd;
      openPicker({ title: `${WD[wd]} — ${SLOTS.find(s => s.key === slot).name}`, selected: (S.plan[wd] || {})[slot] || [],
        kinds: slot === 'sang' ? ['sang', 'nha', 'ngoai', 'vat'] : slot === 'vat' ? ['vat', 'sang'] : ['nha', 'ngoai', 'sang', 'vat'],
        onSave: sel => { S.plan[wd] = { ...(S.plan[wd] || {}), [slot]: sel }; save(); render(); } });
      break;
    }
    case 'resetPlan':
      if (confirm('Khôi phục thực đơn mẫu? Thực đơn bạn đã sửa sẽ mất.')) { S.plan = JSON.parse(JSON.stringify(DEFAULT_PLAN)); save(); render(); }
      break;
    case 'newCustom': openCustom(); break;
    case 'addIng': $('#c_ings').insertAdjacentHTML('beforeend', $('#sheet').dataset.ingrow); break;
    case 'saveCustom': {
      const name = $('#c_name').value.trim();
      const ing = [...document.querySelectorAll('#c_ings .ing')].map(r => [r.querySelector('select').value, +r.querySelector('input').value]).filter(([, g]) => g > 0);
      if (!name || !ing.length) { toast('Cần tên món và ít nhất 1 nguyên liệu'); break; }
      S.custom['c_' + Date.now().toString(36)] = { name, kind: $('#c_kind').value, ing };
      save(); closeSheet(); render(); toast('Đã tạo món');
      break;
    }
    case 'delCustom': if (confirm('Xoá món này?')) { delete S.custom[el.dataset.id]; save(); render(); } break;
    case 'pickClose': closeSheet(); break;
    case 'pickKind': picker.kind = el.dataset.k; drawPicker(); break;
    case 'pickAdd': picker.sel.push(el.dataset.id); drawPicker(); break;
    case 'pickRm': picker.sel.splice(+el.dataset.i, 1); drawPicker(); break;
    case 'pickSave': { const p = picker; closeSheet(); p.onSave(p.sel); break; }
    case 'saveHealth': {
      const ws = weekStart(todayKey());
      const v = id => $(id).value.trim();
      const rec = { wk: ws, kg: v('#h_kg'), eo: v('#h_eo'), met: v('#h_met'), ngot: v('#h_ngot'), note: v('#h_note') };
      S.health = [...S.health.filter(h => h.wk !== ws), rec];
      save(); render(); toast('Đã lưu tuần này');
      break;
    }
    case 'saveSettings': {
      const st = S.settings;
      st.budget = +$('#s_budget').value || st.budget;
      st.assume = $('#s_assume').checked;
      st.recheck = $('#s_recheck').value;
      st.exam = $('#s_exam').value;
      st.hidden = [...document.querySelectorAll('[data-hide]')].filter(c => c.checked).map(c => c.dataset.hide);
      document.querySelectorAll('[data-target]').forEach(i => { if (+i.value > 0) st.targets[i.dataset.target] = +i.value; });
      save(); render(); toast('Đã lưu cài đặt');
      break;
    }
    case 'export': {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `an-du-chat-${todayKey()}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      break;
    }
    case 'wipe':
      if (confirm('Xoá toàn bộ nhật ký, sức khỏe, cài đặt? Không hoàn tác được.')) { S = freshState(); save(); render(); }
      break;
  }
});

document.addEventListener('change', e => {
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!s.plan || !s.logs) throw new Error();
      if (!confirm('Nhập bản sao lưu sẽ thay thế dữ liệu hiện tại. Tiếp tục?')) return;
      localStorage.setItem(KEY, JSON.stringify(s)); S = load(); render(); toast('Đã nhập bản sao lưu');
    } catch { toast('File không hợp lệ'); }
  };
  r.readAsText(e.target.files[0]);
});

// Ngày mới khi mở lại app lúc khác ngày.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tab === 'today' && !$('#sheet').classList.contains('show')) render();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
