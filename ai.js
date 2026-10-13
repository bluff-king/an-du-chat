'use strict';
// Gemini qua REST, gọi thẳng từ điện thoại. Key chỉ nằm trong localStorage của máy này,
// không có trong code (repo public) và không đi vào file sao lưu.

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Gói free hay báo 503 với model mới nhất; quá tải thì lùi dần xuống model nhẹ hơn (như Bù Hè).
const GEMINI_FALLBACKS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

async function gemini(system, user, json) {
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
  for (const m of chain) {
    used = m;
    try {
      res = await fetch(`${GEMINI_API}/${m}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body });
    } catch (e) { throw new Error('Không kết nối được Gemini — kiểm tra mạng.'); }
    if (res.ok) break;
    if (![500, 503].includes(res.status) || m === chain[chain.length - 1]) throw new Error(await explain(res, m));
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
async function parseNote(text) {
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
Trả về JSON: {"items":[{"ngay":"YYYY-MM-DD","bua":"trua","ten":"Gà rán (150 g)","n":{"kcal":0,"pro":0,...đủ 14 khóa}}],"ghi_chu":"1 câu nếu có gì không chắc"}`;
  const { text: out, model } = await gemini(system, text, true);
  let data;
  try { data = JSON.parse(out); } catch (e) { throw new Error('Gemini trả JSON hỏng, thử lại.'); }
  if (Array.isArray(data)) data = { items: data };   // model lite đôi khi trả mảng trần
  const items = (data.items || []).filter(x => x && x.ten && x.n);
  if (!items.length) throw new Error('Không tách được món nào — viết rõ hơn chút?');
  const touched = new Set();
  for (const x of items) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(x.ngay) ? x.ngay : curDay;
    const slot = SLOTS.some(s => s.key === x.bua) ? x.bua : 'vat';
    const n = NUTRIENTS.map(k => Math.max(0, +x.n[k.key] || 0));
    S.logs[date] = S.logs[date] || {};
    const id = date + slot;
    // Lần đầu chạm vào bữa này trong lượt phân tích: thay hẳn thực đơn của bữa đó.
    if (!touched.has(id)) { S.logs[date][slot] = { st: 'swap', por: 1, dishes: [], items: [] }; touched.add(id); }
    S.logs[date][slot].items.push({ name: x.ten, n });
  }
  save();
  return { count: items.length, meals: touched.size, note: data.ghi_chu || '', model };
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
        // 1 phần ăn hợp lý: theo đơn vị mua nếu là quả/bìa/nắm, rau cả bó thì 200 g, còn lại 100 g.
        const u = f.unitG || 0;
        const g1 = u >= 30 && u < 300 ? u : u >= 300 ? 200 : 100;
        return { id, f, g: g1, gain: f.n[NI[g.k]] * g1 / 100 };
      })
      .sort((a, b) => b.gain - a.gain)[0];
    if (best) out.push({ ...g, food: best.f.name + (best.f.src === 'que' ? ' (đồ quê)' : ''), grams: best.g, gain: best.gain });
  }
  return out;
}

async function askWhatToEat() {
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
  return gemini(system, user, false);
}

// Markdown tối giản cho câu trả lời: gạch đầu dòng + in đậm.
function mdLite(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .split('\n').map(l => /^\s*[-*•]\s+/.test(l) ? `<li>${l.replace(/^\s*[-*•]\s+/, '')}</li>` : (l.trim() ? `<p>${l}</p>` : ''))
    .join('').replace(/(<li>.*?<\/li>)+/g, m => `<ul class="tips">${m}</ul>`);
}
