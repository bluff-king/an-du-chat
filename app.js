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
    settings: { budget: 450, hidden: [], targets: { ...DEFAULT_TARGETS }, assume: true, recheck: '', exam: '',
                gkey: '', gmodel: 'gemini-3.5-flash', prefs: '', sendExam: false,
                theme: 'auto', accent: 'blue', showNum: false },
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
Object.assign(FOODS, S.foods || {});

// Giao diện: chế độ sáng/tối và màu chủ đạo, áp lên <html> trước khi vẽ.
const ACCENT_SWATCH = { blue: '#7FB2E5', green: '#6FC28F', pink: '#E68AAE', purple: '#9C85DB', orange: '#E9A15F' };
function applyTheme() {
  const r = document.documentElement;
  if (S.settings.theme === 'auto') r.removeAttribute('data-theme'); else r.dataset.theme = S.settings.theme;
  if (S.settings.accent === 'blue') r.removeAttribute('data-accent'); else r.dataset.accent = S.settings.accent;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(r).getPropertyValue('--bg').trim() || '#F6F9FB';
}
applyTheme();
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

const shopOf = ws => ({ subs: {}, skip: [], force: {}, have: [], ...((S.shop && S.shop[ws]) || {}) });
function shopEdit(ws) {
  S.shop = S.shop || {};
  S.shop[ws] = { ...shopOf(ws) };
  return S.shop[ws];
}
// Nguyên liệu sau khi áp các thay đổi ở trang Đi chợ của tuần đó ('' = đã xoá).
const subFood = (f, subs) => (subs && f in subs ? subs[f] : f);

function dishNut(id, subs) {
  const d = dish(id);
  if (!d) return zero();
  if (d.n) return d.n;
  const acc = zero();
  for (const [f0, g] of d.ing) { const f = subFood(f0, subs); if (FOODS[f]) addInto(acc, FOODS[f].n, g / 100); }
  return acc;
}

// Tên món kèm ghi chú nếu nguyên liệu đã bị đổi/xoá trong tuần.
function dishLabel(id, subs) {
  const d = dish(id);
  if (!d || !d.ing || !subs) return dishName(id);
  const notes = d.ing.map(([f]) => f).filter(f => f in subs && FOODS[f])
    .map(f => subs[f] ? `${FOODS[f].name.toLowerCase()} → ${FOODS[subs[f]].name.toLowerCase()}` : `bỏ ${FOODS[f].name.toLowerCase()}`);
  return notes.length ? `${d.name} (${notes.join(', ')})` : d.name;
}

function planFor(date) { return (S.plan[parse(date).getDay()] || {}); }

// Trạng thái 1 bữa: ok | swap | skip (đã xác nhận), assumed (ngày đã qua, chưa điền), plan (chưa tới).
function meal(date, slot) {
  const log = S.logs[date] && S.logs[date][slot];
  const planned = planFor(date)[slot] || [];
  if (log) {
    return { st: log.st, por: log.por || 1, items: log.st === 'skip' ? [] : (log.items || []),
             dishes: log.st === 'skip' ? [] : (log.dishes || planned) };
  }
  const past = date < todayKey();
  return { st: past && S.settings.assume ? 'assumed' : 'plan', por: 1, dishes: planned, items: [] };
}
const extras = date => (S.logs[date] && S.logs[date].extra) || [];

function mealNut(m, subs) {
  const acc = zero();
  for (const id of m.dishes) addInto(acc, dishNut(id, subs), m.por);
  for (const x of m.items || []) addInto(acc, x.n, m.por);
  return acc;
}

// eaten: những gì coi như đã ăn; proj: eaten + phần kế hoạch chưa tới.
function dayTotals(date) {
  const eaten = zero(), proj = zero();
  const subs = shopOf(weekStart(date)).subs;
  for (const { key } of SLOTS) {
    const m = meal(date, key);
    const v = mealNut(m, subs);
    if (m.st !== 'plan' && date <= todayKey()) addInto(eaten, v);
    addInto(proj, v);
  }
  for (const x of extras(date)) {
    if (date <= todayKey()) addInto(eaten, dishNut(x.d), x.q);
    addInto(proj, dishNut(x.d), x.q);
  }
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
// Sắp xếp [id, {name}] theo ABC tiếng Việt.
const byName = (a, b) => a[1].name.localeCompare(b[1].name, 'vi');
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
const planOpen = new Set();
let noteDraft = '';
let whatEatHtml = '';
let weekAiHtml = '';

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
  const pct = Math.round(proj / target * 100);
  const right = S.settings.showNum
    ? `${fmtNum(proj / days, meta.unit)} / ${fmtNum(T()[key], meta.unit)} ${meta.unit}${meta.limit ? ' (tối đa)' : ''} · <b>${pct}%</b>`
    : `<b>${level(key, proj / target)}</b>`;
  return `<div class="bar ${cls}">
    <div class="bar-head"><span>${meta.name}</span><span class="num">${right}</span></div>
    <div class="track"><div class="fill proj" style="width:${Math.min(pp, 1) * 100}%"></div>
      <div class="fill eat" style="width:${Math.min(pe, 1) * 100}%"></div>
      ${meta.limit ? '' : '<div class="mark"></div>'}</div></div>`;
}

// Ước lượng có sai số, nên mặc định chỉ hiện mức; số chi tiết bật trong Cài đặt.
function level(key, r) {
  if (NUTRIENTS[NI[key]].limit) return r > 1 ? 'Quá' : r > 0.8 ? 'Sát ngưỡng' : 'Ổn';
  return r < 0.6 ? 'Thiếu nhiều' : r < 0.9 ? 'Hơi thiếu' : 'Đủ';
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
  return `
    <header class="head">
      <button class="nav" data-act="day" data-n="-1" aria-label="Hôm trước">‹</button>
      <div><h1>${isToday ? 'Hôm nay' : fmtDay(curDay)}</h1><p class="sub">${isToday ? fmtDay(curDay) : '<a data-act="dayToday">về hôm nay</a>'}</p></div>
      <button class="nav" data-act="day" data-n="1" aria-label="Hôm sau">›</button>
    </header>
    <section class="card note-card">
      <h3>Ghi nhanh</h3>
      <p class="muted">Gõ tự do, ngày đã qua hay lịch sắp tới đều được. VD: “thứ 2 trưa mỳ xào bò, rau cải, quả sung; tối cơm gà tự rán” hoặc “thứ 7 tối đi ăn ếch, thịt nướng, chè”.</p>
      <textarea id="note" rows="3" placeholder="Hôm nay ăn gì…">${esc(noteDraft)}</textarea>
      <div class="actions"><button class="btn primary" data-act="aiParse">✨ Phân tích & ghi vào</button></div>
      <div id="noteMsg"></div>
    </section>
    ${cards}
    <section class="card">
      <div class="row"><h3>Còn phải ăn gì?</h3><button class="btn sm primary" data-act="whatEat">Xem</button></div>
      <div id="whatEat">${whatEatHtml}</div>
    </section>
    <section class="card">
      <div class="row"><h3>Ăn thêm ngoài thực đơn</h3><button class="btn sm" data-act="addExtra">+ Thêm</button></div>
      ${ex ? `<ul class="extras">${ex}</ul>` : '<p class="muted">Trà sữa, nước ngọt, hoa quả, sữa thêm… bấm “+ Thêm”.</p>'}
    </section>
    ${myCard()}`;
}

// Thẻ quản lý món & nguyên liệu tự tạo — dùng ở tab Hôm nay và Thực đơn. Mọi bảng chọn món đọc chung S.custom.
let myKind = 'nha';
function myCard() {
  const customs = Object.entries(S.custom).sort(byName).map(([id, d]) => `<li><span>${esc(d.name)}</span>
      <select class="kind-sel" data-kindsel="${id}" aria-label="Loại món">${Object.entries(KIND_NAMES).map(([k, n]) => `<option value="${k}" ${k === d.kind ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="x" data-act="delCustom" data-id="${id}" aria-label="Xoá">×</button></li>`).join('');
  const myFoods = Object.entries(S.foods || {}).sort(byName).map(([id, f]) => `<li><span>${esc(f.name)}</span><small class="muted">nguyên liệu${f.src === 'que' ? ' · quê' : ''}</small>
      <button class="x" data-act="delFood" data-id="${id}" aria-label="Xoá">×</button></li>`).join('');
  return `<section class="card">
      <h3>Món & nguyên liệu của tôi</h3>
      <p class="muted">Tạo ở đây là có ngay trong mọi bảng “Đổi món” và “Thực đơn”.</p>
      <input type="text" id="my_q" placeholder="Tên món mới, VD: trứng vịt lộn, nấm xào tỏi" autocomplete="off">
      <div class="seg small">${Object.entries(KIND_NAMES).map(([k, n]) => `<button class="${k === myKind ? 'on' : ''}" data-act="myKind" data-k="${k}">${n}</button>`).join('')}</div>
      <button class="btn primary wide" data-act="myQuick">＋ Thêm món${S.settings.gkey ? ' (✨ Gemini ước lượng)' : ''}</button>
      <div id="my_msg"></div>
      <div class="actions" style="margin-top:10px"><button class="btn sm" data-act="newCustom">+ Tạo món theo nguyên liệu</button>
        <button class="btn sm" data-act="newFood">+ Nguyên liệu mới</button></div>
      <div id="newFood"></div>
      ${customs || myFoods ? `<ul class="extras">${customs}${myFoods}</ul>` : ''}
    </section>`;
}

// Tạo món chỉ từ tên: Gemini ước lượng 1 suất; không có key thì lấy nguyên liệu trùng tên (nếu có).
async function createQuickDish(name, kind, onStatus) {
  let d;
  if (S.settings.gkey) {
    const r = await estimateDish(kind === 'ngoai' ? name + ' (mua ăn ngoài)' : name, onStatus);
    d = { n: r.n, ...(r.price ? { price: r.price } : {}) };
  } else {
    const f = Object.entries(FOODS).find(([, x]) => bareText(name).includes(bareText(x.name).split(' ')[0]));
    d = f ? { ing: [[f[0], defaultG(f[0])]] } : { n: zero() };
  }
  const id = 'c_' + Date.now().toString(36);
  S.custom[id] = { name, kind, ...d };
  save();
  return id;
}

function slotCard(key, name) {
  const m = meal(curDay, key);
  const label = { ok: '✓ Đã ăn', swap: '🔄 Đã đổi món', skip: '✕ Bỏ bữa',
                  assumed: 'Chưa xác nhận — tạm tính theo thực đơn', plan: 'Theo thực đơn' }[m.st];
  const confirmed = ['ok', 'swap', 'skip'].includes(m.st);
  const subs = shopOf(weekStart(curDay)).subs;
  const names = [...m.dishes.map(id => esc(dishLabel(id, subs))), ...(m.items || []).map(x => '✨ ' + esc(x.name))];
  const list = names.length ? names.map(n => `<li>${n}</li>`).join('') : '<li class="muted">Không ăn</li>';
  const por = m.st !== 'skip' ? `<div class="chips">${PORTIONS.map(([v, n]) =>
      `<button class="chip ${confirmed && m.por === v ? 'on' : ''}" data-act="por" data-slot="${key}" data-v="${v}">${n}</button>`).join('')}</div>` : '';
  return `<section class="card slot st-${m.st}">
    <div class="row"><h3>${name}</h3><span class="tag">${label}</span></div>
    <ul class="dishes">${list}</ul>
    <div class="actions">
      ${m.st === 'ok' ? '' : `<button class="btn primary" data-act="ate" data-slot="${key}">${m.st === 'swap' || m.st === 'skip' ? '✓ Ăn đúng thực đơn' : '✓ Đã ăn'}</button>`}
      ${por}
      <button class="btn" data-act="swap" data-slot="${key}">Đổi món</button>
      ${m.st === 'skip' ? '' : `<button class="btn ghost" data-act="skip" data-slot="${key}">Bỏ</button>`}
      ${confirmed ? `<button class="btn ghost" data-act="undo" data-slot="${key}">Hoàn tác</button>` : ''}
    </div></section>`;
}

function setLog(slot, val) {
  whatEatHtml = ''; weekAiHtml = '';
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
    ${isThis ? `<section class="card accent"><h3>Các ngày còn lại nên ăn gì?</h3>
      <p class="muted">Dựa trên những gì đã ăn và lịch đã ghi trước (VD “thứ 7 tối đi ăn ếch, thịt nướng, chè” ở ô Ghi nhanh).</p>
      ${S.settings.gkey ? `<div id="weekAi">${weekAiHtml || '<button class="btn primary wide" data-act="aiWeek">✨ Gợi ý các ngày còn lại</button>'}</div>`
        : '<p class="muted">Cần Gemini key (Sức khỏe → Cài đặt).</p>'}</section>` : ''}
    ${tips.length ? `<section class="card warn"><h3>Cần chú ý</h3><ul class="tips">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <button class="btn primary" data-act="goShop">Xem gợi ý đi chợ</button></section>`
      : `<section class="card good"><h3>Tuần này đủ chất 👏</h3><p>Các chất chính đều đạt ≥ 90% mục tiêu.</p></section>`}
    <section class="card"><h3>Khoáng chất & xơ</h3>
      <p class="muted">Trung bình mỗi ngày, tính cả phần kế hoạch còn lại của tuần.</p>
      ${bars(w.eaten, w.proj, 7, ['k', 'mg', 'zn', 'ca', 'fe', 'fib', 'pro'])}</section>
    <section class="card"><h3>Cho mắt</h3>${bars(w.eaten, w.proj, 7, ['vita', 'vitc', 'o3'])}</section>
    <section class="card"><h3>Giới hạn (tốt cho gan và mỡ máu)</h3>${bars(w.eaten, w.proj, 7, ['sat', 'sug'])}
      ${S.settings.showNum ? `<p class="muted">Năng lượng TB: ${fmtNum(w.proj[0] / 7)} kcal/ngày (mục tiêu ~${T().kcal}).</p>` : ''}</section>`;
}

// ---------- Đi chợ ----------
function shopping() {
  const thisWs = weekStart(todayKey());
  const ws = shopMode === 'this' ? thisWs : addDays(thisWs, 7);
  const from = shopMode === 'this' ? todayKey() : ws;
  const need = {};             // foodId -> gam theo kế hoạch
  const sh = shopOf(ws);
  let outCost = 0;
  for (let d = from; d <= addDays(ws, 6); d = addDays(d, 1)) {
    for (const { key } of SLOTS) {
      const m = shopMode === 'this' ? meal(d, key) : { dishes: planFor(d)[key] || [], por: 1, st: 'plan' };
      if (m.st !== 'plan') continue;
      for (const id of m.dishes) {
        const ds = dish(id);
        if (!ds) continue;
        if (ds.n || ds.kind === 'ngoai') { outCost += ds.price || 0; continue; }
        for (const [f0, g] of ds.ing) {
          const f = subFood(f0, sh.subs);
          if (FOODS[f] && FOODS[f].src === 'mua' && !sh.have.includes(f)) need[f] = (need[f] || 0) + g * m.por;
        }
      }
    }
  }
  const planRows = Object.entries(need).map(([f, g]) => row(f, g)).sort((a, b) => b.cost - a.cost);
  const planCost = planRows.reduce((s, r) => s + r.cost, 0);

  // Dự kiến cả tuần: tuần này = đã ăn + phần còn lại; tuần sau = chỉ theo kế hoạch.
  let proj;
  if (shopMode === 'this') proj = weekTotals(ws).proj.slice();
  else { proj = zero(); for (let i = 0; i < 7; i++) { const d = addDays(ws, i);
    for (const { key } of SLOTS) for (const id of planFor(d)[key] || []) addInto(proj, dishNut(id, sh.subs)); } }

  // Tham lam: lấy chất đang thiếu nhất, mua món rẻ nhất tính theo chất đó, lặp lại.
  let left = S.settings.budget - planCost;
  const add = {}, why = {}, stuck = new Set();
  // Món người dùng tự chọn thay ở mục "Mua thêm" được mua trước, rồi mới tính phần còn thiếu.
  for (const [id, g] of Object.entries(sh.force)) {
    if (!FOODS[id]) continue;
    add[id] = g; addInto(proj, FOODS[id].n, g / 100); left -= g / 100 * FOODS[id].price;
    why[id] = new Set(['bạn chọn']);
  }
  const goal = k => T()[k] * 7 * 0.95;
  for (let it = 0; it < 30; it++) {
    const lacking = FOCUS.filter(k => k !== 'fe' && !stuck.has(k) && proj[NI[k]] < goal(k))
      .sort((a, b) => proj[NI[a]] / goal(a) - proj[NI[b]] / goal(b));
    if (!lacking.length) break;
    const k = lacking[0];
    const cands = Object.entries(FOODS).filter(([id, f]) => f.src === 'mua' && f.max && f.n[NI[k]] > 0
        && !S.settings.hidden.includes(id) && !sh.skip.includes(id) && !(id in sh.force)
        && (add[id] || 0) < f.max && f.n[NI.sug] === 0)
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
  return { ws, sh, planRows, planCost, extraRows, extraCost, outCost, stillLow, proj };
}

function row(f, g) {
  const food = FOODS[f];
  const u = food.unitG && food.unitG > 1 ? `${Math.ceil(g / food.unitG)} ${food.unit}` : `${Math.round(g / 50) * 50 || Math.round(g)} g`;
  return { f, name: food.name, g, qty: u, cost: g / 100 * food.price };
}

const money = k => `${Math.round(k)}k`;

function viewShop() {
  const r = shopping();
  // Mỗi dòng: vuốt trái (hoặc bấm) để hiện nút Đổi / Xoá.
  const list = (rows, kind) => rows.map(x => `<li class="swipe" data-food="${x.f}" data-kind="${kind}" data-g="${Math.round(x.g)}">
      <div class="swipe-actions"><button class="sw-sub" data-act="shopSub">Đổi</button><button class="sw-del" data-act="shopDel">Xoá</button></div>
      <div class="swipe-main" data-act="swipeToggle"><span>${esc(x.name)}<small>${x.why ? ' — ' + (x.why.includes('bạn chọn') ? 'bạn chọn' : 'bù ' + x.why.join(', ')) : ''}</small></span>
      <span class="q">${x.qty}</span><span class="c">${money(x.cost)}</span></div></li>`).join('');
  const changes = [
    ...Object.entries(r.sh.subs).filter(([f]) => FOODS[f]).map(([f, t]) => t ? `${FOODS[f].name} → ${FOODS[t].name}` : `Bỏ ${FOODS[f].name}`),
    ...r.sh.have.filter(f => FOODS[f]).map(f => `Không mua ${FOODS[f].name} (nhà còn)`),
    ...r.sh.skip.filter(f => FOODS[f]).map(f => `Không mua thêm ${FOODS[f].name}`),
  ];
  return `
    <header class="head plain"><div><h1>Đi chợ</h1><p class="sub">Ngân sách ${money(S.settings.budget)}/tuần (không tính ăn ngoài, đồ quê)</p></div></header>
    <div class="seg">
      <button class="${shopMode === 'this' ? 'on' : ''}" data-act="shopMode" data-v="this">Phần còn lại tuần này</button>
      <button class="${shopMode === 'next' ? 'on' : ''}" data-act="shopMode" data-v="next">Cả tuần sau</button>
    </div>
    <p class="muted">Vuốt trái một dòng (hoặc bấm vào) để đổi sang thứ khác hoặc xoá.</p>
    ${changes.length ? `<section class="card"><div class="row"><h3>Đã thay đổi tuần này</h3><button class="btn sm ghost" data-act="shopReset">Khôi phục</button></div>
      <ul class="tips">${changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul><p class="muted">Món trong thực đơn được tính theo nguyên liệu mới.</p></section>` : ''}
    <section class="card"><div class="row"><h3>Theo thực đơn</h3><b>${money(r.planCost)}</b></div>
      ${r.planRows.length ? `<ul class="shop">${list(r.planRows, 'plan')}</ul>` : '<p class="muted">Không cần mua gì thêm cho thực đơn.</p>'}
      <p class="muted">Đồ quê, gạo, dầu, gia vị không tính vào đây.</p></section>
    <section class="card accent"><div class="row"><h3>Mua thêm để đủ chất</h3><b>${money(r.extraCost)}</b></div>
      ${r.extraRows.length ? `<ul class="shop">${list(r.extraRows, 'extra')}</ul>` : '<p class="muted">Thực đơn đã gần đủ — không cần mua thêm.</p>'}
      ${r.stillLow.length ? `<p class="note">Vẫn còn thiếu: ${r.stillLow.map(k => NUTRIENTS[NI[k]].name).join(', ')}.</p>
        <ul class="tips">${r.stillLow.map(k => `<li>${esc(TIPS[k])}</li>`).join('')}</ul>` : ''}
    </section>
    <section class="card"><div class="row"><span>Tổng đi chợ</span><b>${money(r.planCost + r.extraCost)}</b></div>
      <div class="row"><span>Ăn ngoài (ước tính)</span><b>${money(r.outCost)}</b></div></section>`;
}

// ---------- Thực đơn ----------
const ORDER = [1, 2, 3, 4, 5, 6, 0];
function viewPlan() {
  const ws = weekStart(todayKey());
  const subs = shopOf(ws).subs;
  const days = ORDER.map(wd => {
    const p = S.plan[wd] || {};
    const date = addDays(ws, (wd + 6) % 7);
    const open = planOpen.has(wd);
    // Tuần này đã ghi khác thực đơn mẫu (đổi món, bỏ bữa, ghi nhanh, lịch sắp tới) thì hiện thêm 1 dòng.
    const actual = key => {
      const m = meal(date, key);
      if (!['swap', 'skip'].includes(m.st)) return '';
      const what = m.st === 'skip' ? 'Bỏ bữa'
        : [...m.dishes.map(id => dishLabel(id, subs)), ...(m.items || []).map(x => '✨ ' + x.name)].join(' · ');
      return `<span class="actual">↳ ${fmtShort(date)}${date > todayKey() ? ' (dự kiến)' : ''}: ${esc(what)}</span>`;
    };
    const slots = SLOTS.map(({ key, name }) => `<div class="pslot" data-act="editPlan" data-wd="${wd}" data-slot="${key}">
        <b>${name}</b><span>${(p[key] || []).map(id => esc(dishLabel(id, subs))).join(' · ') || '<i class="muted">trống</i>'}${actual(key)}</span></div>`).join('');
    const changed = SLOTS.some(({ key }) => actual(key));
    return `<section class="card day ${open ? 'open' : ''}">
      <div class="row" data-act="togglePlan" data-wd="${wd}"><h3>${WD[wd]} <small>${fmtShort(date)}</small>${changed ? ' <span class="dot" title="Tuần này đã ghi khác thực đơn"></span>' : ''}</h3><span class="muted">${open ? '▴' : '▾'}</span></div>
      ${open ? slots : `<p class="muted one">${esc(['trua', 'toi'].map(k => (p[k] || []).filter(id => id !== 'com').map(dishName).join(', ')).join(' / '))}</p>`}
    </section>`;
  }).join('');
  return `
    <header class="head plain"><div style="flex:1"><h1>Thực đơn tuần</h1><p class="sub">Bấm vào một bữa để sửa thực đơn mẫu (áp cho mọi tuần). Dòng ↳ là những gì tuần này bạn đã ghi khác đi.</p></div></header>
    ${days}
    ${myCard()}
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
    <section class="card"><h3>Giao diện</h3>
      <div class="seg">${[['auto', 'Tự động'], ['light', 'Sáng'], ['dark', 'Tối']].map(([v, n]) =>
        `<button class="${st.theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${n}</button>`).join('')}</div>
      <p class="muted">Màu chủ đạo</p>
      <div class="swatches">${Object.entries(ACCENT_SWATCH).map(([k, col]) =>
        `<button class="swatch ${st.accent === k ? 'on' : ''}" style="background:${col}" data-act="accent" data-v="${k}" aria-label="Màu ${k}"></button>`).join('')}</div>
    </section>
    <section class="card"><h3>Cài đặt</h3>
      <label>Ngân sách đi chợ (nghìn đồng/tuần)<input type="number" inputmode="numeric" id="s_budget" value="${st.budget}"></label>
      <details ${st.gkey ? '' : 'open'}><summary>Gemini (AI) ${st.gkey ? '✓ đã có key' : '— chưa có key'}</summary>
        <label>API key<input type="password" id="s_gkey" autocomplete="off" placeholder="${st.gkey ? '•••••••• (để trống = giữ key cũ)' : 'dán key từ aistudio.google.com'}"></label>
        <label>Model<select id="s_gmodel">${GEMINI_FALLBACKS.map(m => `<option ${m === st.gmodel ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="full">Sở thích, điều kiện (gửi kèm cho AI)<textarea id="s_prefs" rows="3" placeholder="VD: ghét rau nhớt; có bếp; mang cơm trưa…">${esc(st.prefs || '')}</textarea></label>
        <label class="check"><input type="checkbox" id="s_sendExam" ${st.sendExam ? 'checked' : ''}> Gửi kèm ghi chú khám cho AI</label>
        <p class="muted">Key chỉ lưu trên máy này, không có trong file sao lưu. Gói free của Google có thể dùng nội dung gửi lên để cải thiện sản phẩm.</p>
        ${st.gkey ? '<button class="btn ghost danger sm" data-act="delKey">Xoá key</button>' : ''}
      </details>
      <label class="check"><input type="checkbox" id="s_showNum" ${st.showNum ? 'checked' : ''}> Hiện số liệu chi tiết (mg, g, %)</label>
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
  $('#sheet').innerHTML = `<div class="sheet-body">
    <div class="row"><h3>${esc(p.title)}</h3><button class="x" data-act="pickClose" aria-label="Đóng">×</button></div>
    <div class="picked">${p.sel.length ? p.sel.map((id, i) => `<button class="chip on" data-act="pickRm" data-i="${i}">${esc(dishName(id))} ×</button>`).join('') : '<span class="muted">Chưa chọn món nào</span>'}</div>
    <input type="search" id="pk_q" placeholder="🔍 Gõ để tìm, hoặc thêm món mới (VD: nấm xào tỏi)" value="${esc(p.q)}" autocomplete="off">
    <div class="seg small" id="pk_kinds" ${p.q ? 'hidden' : ''}>${p.kinds.map(k => `<button class="${k === p.kind ? 'on' : ''}" data-act="pickKind" data-k="${k}">${KIND_NAMES[k]}</button>`).join('')}</div>
    <div id="pk_list"></div>
    <button class="btn primary wide" data-act="pickSave">Lưu</button></div>`;
  drawPickList();
  $('#sheet').classList.add('show');
}

// Gõ chữ thì tìm trên mọi nhóm; không thấy thì cho thêm món mới đúng như đã gõ.
function drawPickList() {
  const p = picker;
  const q = bareText(p.q);
  const all = Object.entries({ ...DISHES, ...S.custom }).sort(byName);
  const items = q ? all.filter(([, d]) => bareText(d.name).includes(q)) : all.filter(([, d]) => d.kind === p.kind);
  $('#pk_kinds').hidden = !!q;
  $('#pk_list').innerHTML = `<div class="pick-list">${items.map(([id, d]) => `<button class="pick" data-act="pickAdd" data-id="${id}">${S.custom[id] ? '★ ' : ''}${esc(d.name)}${d.price ? `<small>~${d.price}k</small>` : q ? `<small>${KIND_NAMES[d.kind]}</small>` : ''}</button>`).join('')}</div>
    ${q ? `<p class="muted">Không thấy? Thêm món mới — chọn loại:</p>
      <div class="seg small">${Object.entries(KIND_NAMES).map(([k, n]) => `<button class="${k === (p.qKind || p.kind) ? 'on' : ''}" data-act="qKind" data-k="${k}">${n}</button>`).join('')}</div>
      <button class="btn wide" data-act="quickDish">＋ Thêm “${esc(p.q.trim())}”${S.settings.gkey ? ' (✨ Gemini ước lượng)' : ''}</button><div id="pk_msg"></div>`
        : ''}`;
}
const bareText = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
function closeSheet() { $('#sheet').classList.remove('show'); $('#sheet').innerHTML = ''; picker = null; }

// ---------- Chọn thực phẩm thay thế (trang Đi chợ) ----------
let foodPick = null;
function openFoodPicker(from, kind, g) {
  foodPick = { from, kind, g };
  const group = Object.entries(FOOD_GROUPS).find(([, ids]) => ids.includes(from));
  const order = group ? [group, ...Object.entries(FOOD_GROUPS).filter(x => x !== group)] : Object.entries(FOOD_GROUPS);
  const opt = id => {
    const f = FOODS[id];
    return `<button class="pick" data-act="pickFood" data-id="${id}">${esc(f.name)}<small>~${money(g / 100 * f.price)}</small></button>`;
  };
  $('#sheet').innerHTML = `<div class="sheet-body">
    <div class="row"><h3>Đổi ${esc(FOODS[from].name)} thành…</h3><button class="x" data-act="pickClose" aria-label="Đóng">×</button></div>
    ${order.map(([name, ids]) => {
      const list = ids.filter(id => id !== from && FOODS[id] && !S.settings.hidden.includes(id))
        .sort((a, b) => FOODS[a].name.localeCompare(FOODS[b].name, 'vi'));
      return list.length ? `<p class="muted">${name}</p><div class="pick-list">${list.map(opt).join('')}</div>` : '';
    }).join('')}
    <button class="btn ghost wide danger" data-act="shopDel" data-food="${from}">${kind === 'plan' ? 'Không mua (nhà còn)' : 'Bỏ, không mua thêm'}</button></div>`;
  $('#sheet').classList.add('show');
}

// ---------- Tạo món ----------
// 1 phần vừa khi để trống ô gam: 1 quả/bìa/củ…, rau cả bó thì 150 g, còn lại 100 g.
const defaultG = f => { const u = FOODS[f].unitG || 0; return u > 1 && u < 300 ? u : u >= 300 ? 150 : 100; };
const foodOpts = () => '<option value="">— chọn nguyên liệu —</option>' +
  Object.entries(FOODS).sort((a, b) => a[1].name.localeCompare(b[1].name, 'vi'))
    .map(([id, f]) => `<option value="${id}">${esc(f.name)}${f.src === 'que' ? ' (quê)' : ''}</option>`).join('');
const ingRow = () => `<div class="ing"><select>${foodOpts()}</select><input type="number" inputmode="numeric" placeholder="gam (trống = 1 phần)"></div>`;

function openCustom() {
  picker = null;
  $('#sheet').innerHTML = `<div class="sheet-body">
    <div class="row"><h3>Tạo món</h3><button class="x" data-act="pickClose" aria-label="Đóng">×</button></div>
    <label>Tên món<input type="text" id="c_name" placeholder="VD: Súp gà nấm"></label>
    <div class="form"><label>Loại<select id="c_kind">${['nha', 'ngoai', 'sang', 'vat'].map(k => `<option value="${k}">${KIND_NAMES[k]}</option>`).join('')}</select></label>
      <label>Giá 1 suất (k, nếu mua)<input type="number" inputmode="numeric" id="c_price" placeholder="VD: 30"></label></div>
    <p class="muted">Nguyên liệu cho 1 suất. Để trống gam = 1 phần vừa (1 quả trứng, 1 củ cà rốt, 100 g thịt…).</p>
    <div id="c_ings">${ingRow()}${ingRow()}${ingRow()}</div>
    <div class="actions"><button class="btn sm" data-act="addIng">+ Dòng</button>
      <button class="btn sm" data-act="newFood">+ Nguyên liệu mới</button></div>
    <div id="newFood"></div>
    <p class="muted">Thêm luôn vào thực đơn (không bắt buộc):</p>
    <div class="form"><label>Ngày<select id="c_wd"><option value="">—</option>${ORDER.map(wd => `<option value="${wd}">${WD[wd]}</option>`).join('')}</select></label>
      <label>Bữa<select id="c_slot">${SLOTS.map(x => `<option value="${x.key}">${x.name}</option>`).join('')}</select></label></div>
    <button class="btn primary wide" data-act="saveCustom">Lưu món</button></div>`;
  $('#sheet').classList.add('show');
}

// ---------- Sự kiện ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act], .tabbar button');
  if (!el) { if (e.target.id === 'sheet') closeSheet(); return; }
  if (el.dataset.tab) { tab = el.dataset.tab; render(); return; }
  const a = el.dataset.act, slot = el.dataset.slot;
  if (a === 'swipeToggle' && el.closest('.swipe').dataset.swiped) return;
  switch (a) {
    case 'day': curDay = addDays(curDay, +el.dataset.n); whatEatHtml = ''; render(); break;
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
    case 'aiParse': {
      const text = $('#note').value.trim();
      noteDraft = text;
      if (!text) { toast('Gõ gì đó vào ô Ghi nhanh trước'); break; }
      el.disabled = true; el.textContent = 'Đang phân tích…';
      parseNote(text, msg => { $('#noteMsg').innerHTML = `<p class="muted">${esc(msg)}</p>`; }).then(r => {
        noteDraft = ''; whatEatHtml = ''; weekAiHtml = ''; render();
        $('#noteMsg').innerHTML = `<p class="ok-msg">Đã ghi ${r.count} món (✨):</p><ul class="tips">${r.where.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
          <p class="muted">Sai thì bấm “Ăn đúng thực đơn” hoặc “Hoàn tác” ở bữa đó. — ${esc(r.model)}</p>${r.note ? `<p class="muted">${esc(r.note)}</p>` : ''}`;
      }).catch(err => { el.disabled = false; el.textContent = '✨ Phân tích & ghi vào'; $('#noteMsg').innerHTML = `<p class="note">${esc(err.message)}</p>`; });
      break;
    }
    case 'whatEat': {
      const gaps = remainingToday();
      const fixes = quickFixes(gaps);
      whatEatHtml = gaps.length
        ? `<p class="muted">Tính cả các bữa còn lại theo thực đơn hôm nay:</p><ul class="tips">${fixes.map(x => {
            const n = NUTRIENTS[NI[x.k]];
            return S.settings.showNum
              ? `<li><b>${n.name}</b> còn thiếu ${fmtNum(x.need, n.unit)} ${n.unit} → ${esc(x.food)} ${x.grams} g (+${fmtNum(x.gain, n.unit)})</li>`
              : `<li><b>${n.name}</b> ${x.ratio < 0.6 ? 'thiếu nhiều' : 'hơi thiếu'} → ${esc(x.food)} (${x.portion})</li>`; }).join('')}</ul>`
        : '<p class="ok-msg">Hôm nay đã đủ các chất chính 👍</p>';
      if (S.settings.gkey) whatEatHtml += '<button class="btn wide" data-act="askAI">✨ Hỏi Gemini gợi ý món cụ thể</button><div id="aiAns"></div>';
      $('#whatEat').innerHTML = whatEatHtml;
      break;
    }
    case 'askAI':
      el.disabled = true; el.textContent = 'Gemini đang nghĩ…';
      askWhatToEat(msg => { el.textContent = msg; }).then(r => { el.remove(); $('#aiAns').innerHTML = mdLite(r.text) + `<p class="muted">— ${esc(r.model)}</p>`; whatEatHtml = $('#whatEat').innerHTML; })
        .catch(err => { el.disabled = false; el.textContent = '✨ Hỏi Gemini gợi ý món cụ thể'; $('#aiAns').innerHTML = `<p class="note">${esc(err.message)}</p>`; });
      break;
    case 'theme': S.settings.theme = el.dataset.v; save(); applyTheme(); render(); break;
    case 'accent': S.settings.accent = el.dataset.v; save(); applyTheme(); render(); break;
    case 'aiWeek':
      el.disabled = true; el.textContent = 'Gemini đang xem cả tuần…';
      askWeekPlan(msg => { el.textContent = msg; }).then(r => {
        weekAiHtml = mdLite(r.text) + `<p class="muted">— ${esc(r.model)}</p><button class="btn sm" data-act="aiWeekAgain">Hỏi lại</button>`;
        $('#weekAi').innerHTML = weekAiHtml;
      }).catch(err => { el.disabled = false; el.textContent = '✨ Gợi ý các ngày còn lại'; $('#weekAi').insertAdjacentHTML('beforeend', `<p class="note">${esc(err.message)}</p>`); });
      break;
    case 'aiWeekAgain': weekAiHtml = ''; render(); break;
    case 'swipeToggle': {
      const li = el.closest('.swipe');
      document.querySelectorAll('.swipe.open').forEach(x => { if (x !== li) x.classList.remove('open'); });
      li.classList.toggle('open');
      break;
    }
    case 'shopDel': {
      const li = el.closest('.swipe');
      const f = li ? li.dataset.food : foodPick.from, kind = li ? li.dataset.kind : foodPick.kind;
      if (!li) closeSheet();
      const sh = shopEdit(shopping().ws);
      // Xoá ở danh sách theo thực đơn = không cần mua (nhà còn), vẫn ăn như thường.
      if (kind === 'plan') { if (!sh.have.includes(f)) sh.have.push(f); }
      else { delete sh.force[f]; if (!sh.skip.includes(f)) sh.skip.push(f); }
      save(); render(); toast(kind === 'plan' ? `Không mua ${FOODS[f].name} (vẫn tính vào bữa ăn)` : `Đã bỏ ${FOODS[f].name}`);
      break;
    }
    case 'shopSub': {
      const li = el.closest('.swipe');
      openFoodPicker(li.dataset.food, li.dataset.kind, +li.dataset.g);
      break;
    }
    case 'pickFood': {
      const { from, kind, g } = foodPick; const to = el.dataset.id;
      const sh = shopEdit(shopping().ws);
      if (kind === 'plan') sh.subs[from] = to;
      else { delete sh.force[from]; if (!sh.skip.includes(from)) sh.skip.push(from); sh.force[to] = Math.min(Math.max(g, FOODS[to].unitG > 1 ? FOODS[to].unitG : 0), FOODS[to].max || g); }
      closeSheet(); save(); render(); toast(`${FOODS[from].name} → ${FOODS[to].name}`);
      break;
    }
    case 'shopReset': if (S.shop) delete S.shop[shopping().ws]; save(); render(); break;
    case 'delKey': if (confirm('Xoá Gemini API key khỏi máy?')) { S.settings.gkey = ''; save(); render(); } break;
    case 'shopMode': shopMode = el.dataset.v; render(); break;
    case 'togglePlan': { const wd = +el.dataset.wd; planOpen.has(wd) ? planOpen.delete(wd) : planOpen.add(wd); render(); break; }
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
    case 'addIng': $('#c_ings').insertAdjacentHTML('beforeend', ingRow()); break;
    case 'saveCustom': {
      const name = $('#c_name').value.trim();
      const ing = [...document.querySelectorAll('#c_ings .ing')]
        .map(r => [r.querySelector('select').value, +r.querySelector('input').value])
        .filter(([f]) => f && FOODS[f]).map(([f, g]) => [f, g > 0 ? g : defaultG(f)]);
      if (!name) { toast('Chưa có tên món'); $('#c_name').focus(); break; }
      if (!ing.length) { toast('Chọn ít nhất 1 nguyên liệu'); break; }
      const id = 'c_' + Date.now().toString(36);
      const price = +$('#c_price').value;
      S.custom[id] = { name, kind: $('#c_kind').value, ing, ...(price > 0 ? { price } : {}) };
      const wd = $('#c_wd').value, sl = $('#c_slot').value;
      if (wd !== '') { const w = +wd; S.plan[w] = { ...(S.plan[w] || {}), [sl]: [...((S.plan[w] || {})[sl] || []), id] }; }
      save(); closeSheet(); render(); toast(wd !== '' ? `Đã tạo món và thêm vào ${WD[+wd]}` : 'Đã tạo món — chọn nó ở mục Món nhà khi sửa thực đơn');
      break;
    }
    case 'newFood':
      $('#newFood').innerHTML = `<div class="card inset">
        <label>Tên nguyên liệu<input type="text" id="nf_name" placeholder="VD: chả cá Hạ Long, nấm đùi gà"></label>
        <label>Nguồn<select id="nf_src"><option value="mua">Mua</option><option value="que">Đồ quê mang lên</option></select></label>
        <button class="btn primary wide" data-act="nfSave">✨ Gemini ước lượng & thêm</button><div id="nf_msg"></div></div>`;
      $('#nf_name').focus();
      break;
    case 'nfSave': {
      const name = $('#nf_name').value.trim();
      if (!name) { toast('Gõ tên nguyên liệu'); break; }
      el.disabled = true;
      estimateFood(name, msg => { el.textContent = msg; }).then(f => {
        const id = 'f_' + Date.now().toString(36);
        const food = { ...f, name, src: $('#nf_src').value };
        S.foods = { ...(S.foods || {}), [id]: food };
        FOODS[id] = food; save();
        if (!$('#c_ings')) { render(); toast(`Đã thêm nguyên liệu “${name}”`); return; }
        // Gắn vào ô trống đầu tiên (hoặc dòng mới), giữ nguyên những gì đã nhập.
        document.querySelectorAll('#c_ings select').forEach(sel => sel.insertAdjacentHTML('beforeend', `<option value="${id}">${esc(name)}</option>`));
        let sel = [...document.querySelectorAll('#c_ings select')].find(x => !x.value);
        if (!sel) { $('#c_ings').insertAdjacentHTML('beforeend', ingRow()); sel = [...document.querySelectorAll('#c_ings select')].pop(); }
        sel.value = id;
        $('#newFood').innerHTML = `<p class="ok-msg">Đã thêm “${esc(name)}” (${f.note ? esc(f.note) : 'ước lượng'}).</p>`;
      }).catch(err => { el.disabled = false; el.textContent = '✨ Gemini ước lượng & thêm'; $('#nf_msg').innerHTML = `<p class="note">${esc(err.message)}</p>`; });
      break;
    }
    case 'delFood': {
      const id = el.dataset.id;
      const used = Object.values(S.custom).some(d => (d.ing || []).some(([f]) => f === id));
      if (used) { toast('Nguyên liệu đang dùng trong món của bạn — xoá món trước'); break; }
      if (confirm('Xoá nguyên liệu này?')) { delete S.foods[id]; delete FOODS[id]; save(); render(); }
      break;
    }
    case 'delCustom': if (confirm('Xoá món này?')) { delete S.custom[el.dataset.id]; save(); render(); } break;
    case 'pickClose': closeSheet(); break;
    case 'pickKind': picker.kind = el.dataset.k; drawPicker(); break;
    case 'pickAdd': picker.sel.push(el.dataset.id); picker.q = ''; drawPicker(); break;
    case 'qKind': picker.qKind = el.dataset.k; drawPickList(); break;
    case 'quickDish': {
      const name = picker.q.trim(), kind = picker.qKind || picker.kind;
      el.disabled = true;
      createQuickDish(name, kind, msg => { el.textContent = msg; }).then(id => {
        picker.sel.push(id); picker.q = ''; drawPicker(); toast(`Đã thêm “${name}” — lần sau gõ là thấy`);
      }).catch(err => { el.disabled = false; el.textContent = `＋ Thêm “${name}”`; $('#pk_msg').innerHTML = `<p class="note">${esc(err.message)}</p>`; });
      break;
    }
    case 'myKind': myKind = el.dataset.k; document.querySelectorAll('[data-act=myKind]').forEach(b => b.classList.toggle('on', b === el)); break;
    case 'myQuick': {
      const name = $('#my_q').value.trim();
      if (!name) { toast('Gõ tên món trước'); $('#my_q').focus(); break; }
      el.disabled = true;
      createQuickDish(name, myKind, msg => { el.textContent = msg; }).then(() => {
        render(); toast(`Đã thêm “${name}” (${KIND_NAMES[myKind]})`);
      }).catch(err => { el.disabled = false; el.textContent = '＋ Thêm món'; $('#my_msg').innerHTML = `<p class="note">${esc(err.message)}</p>`; });
      break;
    }
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
      st.showNum = $('#s_showNum').checked;
      st.recheck = $('#s_recheck').value;
      st.exam = $('#s_exam').value;
      if ($('#s_gkey').value.trim()) st.gkey = $('#s_gkey').value.trim();
      st.gmodel = $('#s_gmodel').value;
      st.prefs = $('#s_prefs').value;
      st.sendExam = $('#s_sendExam').checked;
      st.hidden = [...document.querySelectorAll('[data-hide]')].filter(c => c.checked).map(c => c.dataset.hide);
      document.querySelectorAll('[data-target]').forEach(i => { if (+i.value > 0) st.targets[i.dataset.target] = +i.value; });
      save(); render(); toast('Đã lưu cài đặt');
      break;
    }
    case 'export': {
      const blob = new Blob([JSON.stringify({ ...S, settings: { ...S.settings, gkey: '' } }, null, 1)], { type: 'application/json' });
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

let swipe = null;
const SWIPE_W = 140;
document.addEventListener('touchstart', e => {
  const li = e.target.closest('.swipe');
  if (!li) return;
  const t = e.touches[0];
  swipe = { li, x: t.clientX, y: t.clientY, base: li.classList.contains('open') ? -SWIPE_W : 0, dx: 0, lock: null };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!swipe) return;
  const t = e.touches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  if (swipe.lock === null && Math.abs(dx) + Math.abs(dy) > 8) swipe.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  if (swipe.lock !== 'x') return;
  swipe.dx = dx;
  const main = swipe.li.querySelector('.swipe-main');
  main.style.transition = 'none';
  main.style.transform = `translateX(${Math.max(-SWIPE_W, Math.min(0, swipe.base + dx))}px)`;
}, { passive: true });
document.addEventListener('touchend', () => {
  if (!swipe) return;
  const { li, base, dx, lock } = swipe;
  swipe = null;
  if (lock !== 'x') return;
  const main = li.querySelector('.swipe-main');
  main.style.transition = ''; main.style.transform = '';
  document.querySelectorAll('.swipe.open').forEach(x => { if (x !== li) x.classList.remove('open'); });
  li.classList.toggle('open', base + dx < -SWIPE_W / 2);
  // Chặn cú "click" sinh ra sau khi vuốt, để không bật/tắt lại.
  li.dataset.swiped = '1'; setTimeout(() => delete li.dataset.swiped, 400);
});

document.addEventListener('input', e => {
  if (e.target.id === 'note') noteDraft = e.target.value;
  if (e.target.id === 'pk_q' && picker) { picker.q = e.target.value; drawPickList(); }
});

document.addEventListener('change', e => {
  const ks = e.target.dataset && e.target.dataset.kindsel;
  if (ks && S.custom[ks]) { S.custom[ks].kind = e.target.value; save(); toast(`Đã chuyển sang ${KIND_NAMES[e.target.value]}`); return; }
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!s.plan || !s.logs) throw new Error();
      if (!confirm('Nhập bản sao lưu sẽ thay thế dữ liệu hiện tại. Tiếp tục?')) return;
      const key = S.settings.gkey; localStorage.setItem(KEY, JSON.stringify(s)); S = load(); S.settings.gkey = key; Object.assign(FOODS, S.foods || {}); save(); applyTheme(); render(); toast('Đã nhập bản sao lưu');
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
