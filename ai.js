'use strict';
// Gemini qua REST, gọi thẳng từ điện thoại. Key chỉ nằm trong localStorage của máy này,
// không có trong code (repo public) và không đi vào file sao lưu.

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Gói free hay báo 503 với model mới nhất; quá tải thì lùi dần xuống model nhẹ hơn (như Bù Hè).
const GEMINI_FALLBACKS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const GEMINI_TIMEOUT = 20000;
const FALLBACK_STATUS = [429, 500, 502, 503, 504];

async function gemini(system, user, json, onStatus) {
  const key = S.settings.gkey;
  if (!key) throw new Error('Chưa có Gemini API key — dán vào mục Sức khỏe → Cài đặt.');
  const model = S.settings.gmodel || GEMINI_FALLBACKS[0];
  const i = GEMINI_FALLBACKS.indexOf(model);
  const chain = [model, ...(i >= 0 ? GEMINI_FALLBACKS.slice(i + 1) : GEMINI_FALLBACKS)];
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 12000, ...(json ? { responseMimeType: 'application/json' } : {}) },
  });
  let res, used;
  for (const [idx, m] of chain.entries()) {
    used = m;
    const last = idx === chain.length - 1;
    if (onStatus) onStatus(idx ? `Model trước quá tải, đang thử ${m}…` : `Đang hỏi ${m}…`);
    // Model mới hay treo im lặng thay vì báo 503 (đo 2026-10-13: >2 phút), nên tự cắt sau 20 giây.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), GEMINI_TIMEOUT);
    try {
      res = await fetch(`${GEMINI_API}/${m}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body, signal: ctl.signal });
    } catch (e) {
      if (e.name === 'AbortError' && !last) continue;
      throw new Error(e.name === 'AbortError' ? 'Gemini đang quá tải (cả 3 model không trả lời). Thử lại sau vài phút.'
                                              : 'Không kết nối được Gemini — kiểm tra mạng.');
    } finally { clearTimeout(timer); }
    if (res.ok) break;
    // Quá tải / lỗi máy chủ / hết lượt của riêng model này → lùi xuống model nhẹ hơn.
    if (!FALLBACK_STATUS.includes(res.status) || last) throw new Error(await explain(res, m));
  }
  const data = await res.json();
  const cand = (data.candidates || [{}])[0];
  const text = ((cand.content || {}).parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  if (!text.trim()) throw new Error(`Gemini trả về rỗng (${cand.finishReason || '?'}). Thử lại.`);
  return { text, model: used };
}

async function explain(res, model) {
  let msg = '';
  try { msg = ((await res.json()).error || {}).message || ''; } catch (e) { /* bỏ qua */ }
  if (res.status === 400 && /API key/i.test(msg)) return 'Key Gemini bị từ chối — kiểm tra lại (copy thiếu ký tự?).';
  if (res.status === 403) return 'Gemini từ chối quyền (403) — key có thể đã bị thu hồi.';
  if (res.status === 404) return `Không có model '${model}' — đổi model trong Cài đặt.`;
  if (res.status === 429) return 'Hết lượt gọi gói free Gemini (429). Đợi một lúc rồi thử lại.';
  if (res.status >= 500) return 'Google đang quá tải, thử lại sau vài phút.';
  return `Gemini lỗi ${res.status}: ${msg.slice(0, 160)}`;
}

// Bảng tham chiếu gửi kèm để Gemini ước lượng nhất quán với dữ liệu của app.
function foodTable() {
  return Object.values(FOODS).map(f => `${f.name}: ${NUTRIENTS.map((n, i) => `${n.key}=${f.n[i]}`).join(' ')}`).join('\n');
}

// ---------- Ghi tự do → các món theo ngày/bữa ----------
async function parseNote(text, onStatus) {
  const ws = weekStart(curDay);
  const days = [...Array(7)].map((_, i) => `${WD[parse(addDays(ws, i)).getDay()]} = ${addDays(ws, i)}`).join(', ');
  const system = `Bạn là chuyên gia dinh dưỡng Việt Nam. Người dùng ghi nhật ký ăn uống tự do bằng tiếng Việt.
Tách thành từng món, ước lượng khẩu phần thực tế của nam thanh niên Việt Nam, và tính dinh dưỡng của CẢ khẩu phần đó.
Bảng tham chiếu (trên 100 g) — ưu tiên dùng số này khi nguyên liệu có trong bảng:
${foodTable()}
Khóa dinh dưỡng: kcal, pro (g đạm), fat (g), sat (g mỡ bão hòa), sug (g đường THÊM, không tính đường tự nhiên của rau quả/sữa không đường), fib (g xơ), k, mg, zn, ca, fe (mg), vita (µg RAE), vitc (mg), o3 (mg DHA+EPA).
Món rán/chiên: cộng dầu ăn hút vào. "Cơm" không nói lượng = 2 bát (~300 g cơm chín). Quả sung: tính theo sung ta/sung muối tùy ngữ cảnh.
Tuần này: ${days}. Hôm nay là ${curDay}. Nếu không nói ngày thì là ${curDay}.
bua: sang | trua | toi | vat (ăn vặt/đồ uống). Không nói bữa thì đoán theo món; một ngày có 2 món chính khác nhau (vd mỳ và cơm) mà không nói bữa thì chia cho trưa và tối.
BỮA SÁNG: chỉ tạo item bua=sang khi người dùng CÓ NHẮC tới bữa sáng (khi đó ghi đúng những gì họ nói, không thêm món); không nhắc thì không tạo, không đoán. Bánh gạo One One/Ichi: 1 cái ≈ 10 g (3–4 cái ≈ 40 g).
Trả về JSON: {"items":[{"ngay":"YYYY-MM-DD","bua":"trua","ten":"Gà rán (150 g)","n":{"kcal":0,"pro":0,...đủ 14 khóa}}],"ghi_chu":"1 câu nếu có gì không chắc"}`;
  const { text: out, model } = await gemini(system, text, true, onStatus);
  let data;
  try { data = JSON.parse(out); } catch (e) { throw new Error('Gemini trả JSON hỏng, thử lại.'); }
  if (Array.isArray(data)) data = { items: data };   // model lite đôi khi trả mảng trần
  // Người dùng không nhắc bữa sáng mà Gemini vẫn tự thêm thì bỏ — bữa sáng giữ theo thực đơn.
  const saidBreakfast = /s[aá]ng|bữa đầu|điểm tâm/i.test(text);
  const items = (data.items || []).filter(x => x && x.ten && x.n && (saidBreakfast || normSlot(x.bua) !== 'sang'));
  if (!items.length) throw new Error('Không tách được món nào — viết rõ hơn chút?');
  const touched = new Set(), where = [];
  for (const x of items) {
    const date = normDate(x.ngay, ws);
    const slot = normSlot(x.bua);
    const n = NUTRIENTS.map(k => Math.max(0, +x.n[k.key] || 0));
    S.logs[date] = S.logs[date] || {};
    const id = date + slot;
    // Lần đầu chạm vào bữa này trong lượt phân tích: thay hẳn thực đơn của bữa đó.
    if (!touched.has(id)) { S.logs[date][slot] = { st: 'swap', por: 1, dishes: [], items: [] }; touched.add(id); }
    S.logs[date][slot].items.push({ name: x.ten, n });
    where.push(`${fmtDay(date)} – ${SLOTS.find(s => s.key === slot).name}: ${x.ten}`);
  }
  save();
  return { count: items.length, meals: touched.size, note: data.ghi_chu || '', model, where };
}

// ---------- Còn phải ăn gì ----------
// Bản không cần mạng: chất nào hôm nay còn thiếu so với mục tiêu, và món có sẵn bù nhanh nhất.
function remainingToday() {
  const t = dayTotals(curDay).proj;
  const w = weekTotals(weekStart(curDay)).proj;
  // Omega‑3 và vitamin A cơ thể tích được: chỉ nhắc khi cả tuần còn thiếu.
  const keys = FOCUS.filter(k => k !== 'fe' && !(['o3', 'vita'].includes(k) && w[NI[k]] >= T()[k] * 7 * 0.9));
  return keys.map(k => ({ k, need: T()[k] - t[NI[k]], ratio: t[NI[k]] / T()[k] }))
    .filter(x => x.ratio < 0.9).sort((a, b) => a.ratio - b.ratio);
}

function quickFixes(gaps) {
  const out = [];
  for (const g of gaps.slice(0, 4)) {
    const best = Object.entries(FOODS)
      .filter(([id, f]) => f.src !== 'sanco' && !S.settings.hidden.includes(id) && f.n[NI[g.k]] > 0 && f.n[NI.sug] === 0)
      .map(([id, f]) => {
        // 1 phần ăn hợp lý: theo đơn vị (quả, bìa, nắm, thìa), rau cả bó thì 200 g, còn lại 100 g.
        const u = f.unitG || 0;
        const g1 = u > 1 && u < 300 ? u : u >= 300 ? 200 : 100;
        return { id, f, g: g1, gain: f.n[NI[g.k]] * g1 / 100 };
      })
      .sort((a, b) => b.gain - a.gain)[0];
    if (best) out.push({ ...g, food: best.f.name + (best.f.src === 'que' ? ' (đồ quê)' : ''), grams: best.g, gain: best.gain,
                         portion: portionLabel(best.f) });
  }
  return out;
}

async function askWhatToEat(onStatus) {
  const t = dayTotals(curDay);
  const w = weekTotals(weekStart(curDay));
  const fmt = (v, days) => FOCUS.concat(['sat', 'sug', 'kcal']).map(k => {
    const n = NUTRIENTS[NI[k]]; return `${n.name}: ${Math.round(v[NI[k]])}/${Math.round(T()[k] * days)} ${n.unit}`; }).join('; ');
  const eaten = SLOTS.map(({ key, name }) => {
    const m = meal(curDay, key);
    return `${name} (${m.st === 'plan' ? 'dự kiến' : 'đã ăn'}): ${[...m.dishes.map(dishName), ...(m.items || []).map(x => x.name)].join(', ') || 'không'}`;
  }).join('\n');
  const system = `Bạn là chuyên gia dinh dưỡng, nói tiếng Việt ngắn gọn, thực tế, giọng thân thiện.
Gợi ý người dùng NÊN ĂN THÊM GÌ (cho phần còn lại của hôm nay và mai) để bù chất đang thiếu, đồng thời không vượt mỡ bão hòa và đường thêm.
Chỉ gợi ý món dễ mua ở Hà Nội (chợ, WinMart), rẻ, nấu nhanh. Ghi lượng cụ thể (g, quả, bó) và giá ước tính.
Tối đa 6 gạch đầu dòng, mỗi dòng nói rõ bù chất gì. Không chẩn đoán bệnh.
${S.settings.prefs ? 'Sở thích & điều kiện của người dùng: ' + S.settings.prefs : ''}
${S.settings.exam && S.settings.sendExam ? 'Ghi chú khám sức khỏe: ' + S.settings.exam : ''}`;
  const user = `Ngày ${curDay}.
Các bữa hôm nay:
${eaten}
Thêm: ${extras(curDay).map(x => dishName(x.d)).join(', ') || 'không'}
Tổng hôm nay (gồm phần dự kiến): ${fmt(t.proj, 1)}
Cả tuần (gồm dự kiến): ${fmt(w.proj, 7)}`;
  return gemini(system, user, false, onStatus);
}

// Markdown tối giản cho câu trả lời: gạch đầu dòng + in đậm.
function mdLite(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .split('\n').map(l => /^\s*[-*•]\s+/.test(l) ? `<li>${l.replace(/^\s*[-*•]\s+/, '')}</li>` : (l.trim() ? `<p>${l}</p>` : ''))
    .join('').replace(/(<li>.*?<\/li>)+/g, m => `<ul class="tips">${m}</ul>`);
}

// Phần ăn nói bằng lời: 1 quả / 1 bịch / 1 đĩa… thay vì gam.
function portionLabel(f) {
  const u = f.unitG || 0;
  if (u > 1 && u < 300) return '1 ' + f.unit.replace(/\s+\d.*$/, '');
  if (u >= 300) return '1 đĩa';
  return '1 phần';
}

// Gợi ý cho các ngày còn lại của tuần, dựa trên đã ăn + lịch đã ghi trước + thực đơn.
async function askWeekPlan(onStatus) {
  const ws = weekStart(todayKey());
  const today = todayKey();
  const lines = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const tag = d < today ? 'đã qua' : d === today ? 'hôm nay' : 'sắp tới';
    const meals = SLOTS.map(({ key, name }) => {
      const m = meal(d, key);
      const what = [...m.dishes.map(dishName), ...(m.items || []).map(x => x.name)].join(', ') || 'bỏ';
      const how = m.st === 'plan' ? 'theo thực đơn' : m.st === 'assumed' ? 'chưa xác nhận' : d > today ? 'LỊCH ĐÃ GHI' : 'đã ăn';
      return `${name} [${how}]: ${what}`;
    }).join('; ');
    const ex = extras(d).map(x => dishName(x.d)).join(', ');
    lines.push(`${fmtDay(d)} (${tag}) — ${meals}${ex ? '; thêm: ' + ex : ''}`);
  }
  const w = weekTotals(ws).proj;
  const status = FOCUS.filter(k => k !== 'fe').concat(['sat', 'sug'])
    .map(k => `${NUTRIENTS[NI[k]].name}: ${level(k, w[NI[k]] / (T()[k] * 7))}`).join('; ');
  const system = `Bạn là chuyên gia dinh dưỡng, nói tiếng Việt ngắn gọn, thân thiện, thực tế.
Người dùng không muốn con số mg/gam. Hãy gợi ý NÊN ĂN MÓN GÌ cho các ngày còn lại trong tuần (từ hôm nay tới Chủ nhật),
dựa trên những gì đã ăn và các bữa đã lên lịch (LỊCH ĐÃ GHI, vd đi ăn ngoài, liên hoan).
- Nếu có bữa nặng (đồ nướng, chiên, chè, rượu bia) thì nói rõ hôm đó và hôm trước/sau nên ăn nhẹ hơn, nhiều rau hơn, bớt món gì.
- Bù các chất đang thiếu bằng món cụ thể, quen thuộc, rẻ, dễ mua ở Hà Nội; phần ăn nói bằng lời (1 đĩa rau, 1 quả ổi, 1 bịch sữa).
- Bữa sáng cố định, không cần đổi. Giữ phần lớn thực đơn, chỉ đề xuất thêm/đổi 1–2 thứ mỗi ngày.
- Định dạng: mỗi ngày 1 gạch đầu dòng bắt đầu bằng **Thứ …:**, cuối cùng 1 dòng "Tuần này nhớ:" tổng kết. Không chẩn đoán bệnh.
${S.settings.prefs ? 'Sở thích & điều kiện: ' + S.settings.prefs : ''}
${S.settings.exam && S.settings.sendExam ? 'Ghi chú khám sức khỏe: ' + S.settings.exam : ''}`;
  const user = `Hôm nay: ${fmtDay(today)}.
Cả tuần:
${lines.join('\n')}

Ước tính cả tuần (gồm phần dự kiến): ${status}`;
  return gemini(system, user, false, onStatus);
}

// Model lite đôi khi trả "tối", "Tối", "thứ 7"… thay vì đúng khóa — chuẩn hóa lại.
const bare = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
function normSlot(b) {
  const t = bare(b);
  if (/^sang/.test(t)) return 'sang';
  if (/^trua/.test(t)) return 'trua';
  if (/^toi|chieu|dem/.test(t)) return 'toi';
  return 'vat';
}
function normDate(d, ws) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const t = bare(d);
  if (/chu nhat|cn/.test(t)) return addDays(ws, 6);
  const m = t.match(/thu\s*(\d)/);
  if (m && +m[1] >= 2 && +m[1] <= 7) return addDays(ws, +m[1] - 2);
  return curDay;
}

// Nguyên liệu chưa có trong bảng: Gemini ước lượng dinh dưỡng /100 g và giá ở Hà Nội.
async function estimateFood(name, onStatus) {
  const system = `Bạn là chuyên gia dinh dưỡng Việt Nam. Ước lượng thành phần dinh dưỡng TRÊN 100 g phần ăn được (dạng thường dùng khi nấu; đồ khô thì tính dạng khô)
theo Bảng thành phần thực phẩm Việt Nam / USDA. Ước lượng giá bán lẻ ở Hà Nội năm 2026 (nghìn đồng / 100 g).
Khóa n: kcal, pro, fat, sat (g), sug (g đường THÊM), fib (g), k, mg, zn, ca, fe (mg), vita (µg RAE), vitc (mg), o3 (mg DHA+EPA).
Trả JSON: {"n":{...đủ 14 khóa},"price":0,"unit":"gói/quả/bó/g","unitG":0,"note":"1 câu ngắn nếu không chắc"}. unitG = số gam của 1 đơn vị mua (dùng 1 nếu bán theo cân).`;
  const { text } = await gemini(system, name, true, onStatus);
  let d;
  try { d = JSON.parse(text); } catch (e) { throw new Error('Gemini trả JSON hỏng, thử lại.'); }
  if (Array.isArray(d)) d = d[0] || {};
  if (!d.n) throw new Error('Không ước lượng được — thử tên cụ thể hơn.');
  // Bán theo cân ("g", "kg") thì tính theo gam, tránh hiện "2 g" khi unitG = 100.
  const byWeight = /^(k?g|gam|gram|kg)$/i.test(String(d.unit || '').trim());
  const unitG = byWeight ? 1 : Math.max(1, Math.round(+d.unitG || 1));
  return {
    n: NUTRIENTS.map(k => Math.max(0, +d.n[k.key] || 0)),
    price: Math.max(0, +d.price || 0),
    unit: unitG > 1 ? String(d.unit || 'phần') : 'g', unitG,
    note: d.note || '',
  };
}
