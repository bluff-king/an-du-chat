// Dữ liệu dinh dưỡng — giá trị trên 100 g phần ăn được (sữa: trên 100 ml).
// Nguồn: Bảng thành phần thực phẩm Việt Nam (Viện Dinh dưỡng 2007) và USDA FoodData Central,
// làm tròn. Món ăn ngoài là ước lượng theo khẩu phần điển hình. Giá: nghìn đồng / 100 g, Hà Nội 2026, ước lượng.

// Thứ tự chỉ số trong mảng n:
const NUTRIENTS = [
  { key: 'kcal', name: 'Năng lượng', unit: 'kcal' },
  { key: 'pro',  name: 'Đạm',        unit: 'g' },
  { key: 'fat',  name: 'Chất béo',   unit: 'g' },
  { key: 'sat',  name: 'Mỡ bão hòa', unit: 'g',  limit: true },
  { key: 'sug',  name: 'Đường thêm', unit: 'g',  limit: true },
  { key: 'fib',  name: 'Chất xơ',    unit: 'g' },
  { key: 'k',    name: 'Kali',       unit: 'mg' },
  { key: 'mg',   name: 'Magie',      unit: 'mg' },
  { key: 'zn',   name: 'Kẽm',        unit: 'mg' },
  { key: 'ca',   name: 'Canxi',      unit: 'mg' },
  { key: 'fe',   name: 'Sắt',        unit: 'mg' },
  { key: 'vita', name: 'Vitamin A',  unit: 'µg', eye: true },
  { key: 'vitc', name: 'Vitamin C',  unit: 'mg', eye: true },
  { key: 'o3',   name: 'Omega‑3 (DHA+EPA)', unit: 'mg', eye: true },
];
const NI = Object.fromEntries(NUTRIENTS.map((x, i) => [x.key, i]));

// Mục tiêu mỗi ngày — nam 19–30 tuổi, làm văn phòng (NIH/IOM; giới hạn theo WHO).
const DEFAULT_TARGETS = {
  kcal: 2200, pro: 70, fat: 70, sat: 22, sug: 25, fib: 30,
  k: 3400, mg: 400, zn: 11, ca: 1000, fe: 8, vita: 900, vitc: 90, o3: 250,
};

// Những chất app theo dõi sát và dùng để gợi ý đi chợ.
const FOCUS = ['k', 'mg', 'zn', 'ca', 'fe', 'fib', 'pro', 'vita', 'vitc', 'o3'];

// src: 'mua' = đi chợ/siêu thị, 'que' = mang từ quê, 'sanco' = gạo/dầu/gia vị luôn có sẵn.
// unit/unitG: đơn vị mua và số gam mỗi đơn vị; max: lượng tối đa nên gợi ý thêm mỗi tuần (g).
//        kcal  pro   fat  sat  sug  fib   K    Mg   Zn    Ca   Fe   vitA vitC  o3
const FOODS = {
  com:        { name: 'Cơm trắng', src: 'sanco', price: 0.9,
                n: [130, 2.7, 0.3, 0.1, 0, 0.4, 35, 12, 0.5, 10, 0.2, 0, 0, 0] },
  banhgao:    { name: 'Bánh gạo One One / Ichi', src: 'mua', price: 17, unit: 'gói 150 g', unitG: 150,
                n: [420, 6, 10, 4, 8, 0.8, 80, 25, 1.0, 10, 0.5, 0, 0, 0] },
  trung:      { name: 'Trứng gà', src: 'mua', price: 7, unit: 'quả', unitG: 50, max: 350,
                n: [143, 12.6, 9.5, 3.1, 0, 0, 138, 12, 1.3, 56, 1.75, 160, 0, 40] },
  dauphu:     { name: 'Đậu phụ', src: 'mua', price: 4, unit: 'bìa', unitG: 120, max: 600,
                n: [95, 10.9, 5.4, 0.8, 0, 0.4, 120, 30, 0.8, 100, 1.5, 0, 0, 0] },
  lon_nac:    { name: 'Thịt lợn nạc vai', src: 'que', price: 13,
                n: [180, 19, 11, 4, 0, 0, 300, 20, 3.0, 10, 1.0, 2, 0, 0] },
  lon_bachi:  { name: 'Thịt ba chỉ', src: 'que', price: 12,
                n: [400, 14, 37, 13, 0, 0, 230, 13, 1.6, 5, 0.6, 3, 0, 0] },
  thit_bam:   { name: 'Thịt băm', src: 'mua', price: 12,
                n: [260, 17, 21, 7.5, 0, 0, 290, 19, 2.5, 15, 0.9, 0, 0, 0] },
  ga_dui:     { name: 'Thịt gà (đùi)', src: 'mua', price: 8, unit: 'g', unitG: 1,
                n: [210, 18, 15, 4, 0, 0, 230, 20, 2.0, 11, 1.0, 30, 0, 20] },
  ga_uc:      { name: 'Ức gà', src: 'mua', price: 9, unit: 'g', unitG: 1,
                n: [120, 23, 2.6, 0.6, 0, 0, 330, 28, 0.8, 5, 0.4, 9, 0, 10] },
  gio:        { name: 'Giò lụa', src: 'mua', price: 20, unit: 'g', unitG: 1,
                n: [136, 21.5, 5.5, 2, 0, 0, 190, 15, 1.5, 7, 0.8, 0, 0, 0] },
  xuc_xich:   { name: 'Xúc xích', src: 'mua', price: 15, unit: 'g', unitG: 1,
                n: [300, 12, 26, 9, 2, 0, 200, 15, 1.5, 15, 1.0, 0, 0, 0] },
  bo:         { name: 'Thịt bò nạc', src: 'mua', price: 28, unit: 'g', unitG: 1,
                n: [120, 21, 4, 1.6, 0, 0, 330, 22, 4.5, 10, 2.5, 0, 0, 0] },
  cha_muc:    { name: 'Chả mực', src: 'que', price: 25,
                n: [200, 15, 12, 3, 1, 0, 200, 30, 1.5, 30, 0.6, 10, 0, 150] },
  ca_bien:    { name: 'Cá biển rán (nục, thu…)', src: 'que', price: 12,
                n: [210, 20, 13, 2.5, 0, 0, 350, 30, 0.6, 30, 0.8, 30, 0, 900] },
  mam_tep:    { name: 'Mắm tép chưng thịt', src: 'que', price: 15,
                n: [230, 16, 16, 6, 1, 0, 250, 40, 2.0, 300, 2.0, 20, 0, 100] },
  bun:        { name: 'Bún tươi', src: 'mua', price: 1.5,
                n: [110, 1.7, 0, 0, 0, 0.5, 10, 5, 0.3, 12, 0.2, 0, 0, 0] },
  rau_muong:  { name: 'Rau muống', src: 'mua', price: 2.5, unit: 'bó', unitG: 400, max: 2000,
                n: [23, 3, 0.2, 0, 0, 2.0, 330, 70, 0.2, 90, 1.5, 315, 55, 0] },
  bap_cai:    { name: 'Bắp cải', src: 'mua', price: 1.5, unit: 'cây', unitG: 1000, max: 1500,
                n: [25, 1.3, 0.1, 0, 0, 2.5, 170, 12, 0.2, 40, 0.5, 5, 36, 0] },
  cai_ngot:   { name: 'Cải ngọt / cải chíp', src: 'mua', price: 2.5, unit: 'bó', unitG: 400, max: 2000,
                n: [17, 1.7, 0.2, 0, 0, 1.8, 250, 20, 0.3, 100, 1.0, 220, 45, 0] },
  ca_chua:    { name: 'Cà chua', src: 'mua', price: 3, unit: 'quả', unitG: 100, max: 700,
                n: [18, 0.9, 0.2, 0, 0, 1.2, 237, 11, 0.17, 10, 0.3, 42, 14, 0] },
  hanh_tay:   { name: 'Hành tây', src: 'mua', price: 2, unit: 'củ', unitG: 150, max: 600,
                n: [40, 1.1, 0.1, 0, 0, 1.7, 146, 10, 0.2, 23, 0.2, 0, 7, 0] },
  ca_rot:     { name: 'Cà rốt', src: 'mua', price: 2, unit: 'củ', unitG: 150, max: 750,
                n: [41, 0.9, 0.2, 0, 0, 2.8, 320, 12, 0.24, 33, 0.3, 835, 6, 0] },
  su_hao:     { name: 'Su hào', src: 'mua', price: 2, unit: 'củ', unitG: 300, max: 900,
                n: [27, 1.7, 0.1, 0, 0, 3.6, 350, 19, 0.03, 24, 0.4, 2, 62, 0] },
  sup_lo:     { name: 'Súp lơ xanh', src: 'mua', price: 5, unit: 'cây', unitG: 400, max: 800,
                n: [34, 2.8, 0.4, 0, 0, 2.6, 316, 21, 0.4, 47, 0.7, 31, 89, 0] },
  gia:        { name: 'Giá đỗ', src: 'mua', price: 2, unit: 'g', unitG: 1, max: 600,
                n: [30, 3, 0.2, 0, 0, 1.8, 149, 21, 0.4, 13, 0.9, 1, 13, 0] },
  chuoi:      { name: 'Chuối', src: 'mua', price: 2.5, unit: 'quả', unitG: 90, max: 1260,
                n: [89, 1.1, 0.3, 0.1, 0, 2.6, 358, 27, 0.15, 5, 0.26, 3, 8.7, 0] },
  sung:       { name: 'Quả sung', src: 'mua', price: 3, unit: 'g', unitG: 1,
                n: [74, 0.8, 0.3, 0.1, 0, 2.9, 232, 17, 0.15, 35, 0.4, 7, 2, 0] },
  oi:         { name: 'Ổi', src: 'mua', price: 3, unit: 'quả', unitG: 150, max: 1050,
                n: [68, 2.6, 1, 0.3, 0, 5.4, 417, 22, 0.23, 18, 0.26, 31, 228, 0] },
  cam:        { name: 'Cam', src: 'mua', price: 3.5, unit: 'quả', unitG: 150, max: 1050,
                n: [47, 0.9, 0.1, 0, 0, 2.4, 181, 10, 0.07, 40, 0.1, 11, 53, 0] },
  lac:        { name: 'Lạc rang', src: 'mua', price: 7, unit: 'nắm 30 g', unitG: 30, max: 210,
                n: [585, 24, 50, 7, 0, 8, 650, 175, 3.3, 55, 2.3, 0, 0, 0] },
  sua_socola: { name: 'Sữa Vinamilk socola', src: 'mua', price: 4, unit: 'bịch 200 ml', unitG: 200, max: 1400,
                n: [79, 2.9, 3.0, 2, 5, 0.3, 140, 12, 0.4, 110, 0.1, 40, 0, 0] },
  sua_kd:     { name: 'Sữa tươi không đường', src: 'mua', price: 3.5, unit: 'bịch 200 ml', unitG: 200, max: 1400,
                n: [63, 3.1, 3.5, 2.2, 0, 0, 140, 11, 0.4, 115, 0.05, 45, 0, 0] },
  nam_kim_cham: { name: 'Nấm kim châm', src: 'mua', price: 6, unit: 'gói', unitG: 150, max: 600,
                n: [37, 2.7, 0.3, 0, 0, 2.7, 359, 16, 0.65, 0, 1.15, 0, 0, 0] },
  nam_huong:  { name: 'Nấm hương tươi', src: 'mua', price: 15, unit: 'g', unitG: 1, max: 400,
                n: [34, 2.2, 0.5, 0.1, 0, 2.5, 304, 20, 1.0, 2, 0.4, 0, 0, 0] },
  moc_nhi:    { name: 'Mộc nhĩ (khô)', src: 'mua', price: 20, unit: 'g', unitG: 1,
                n: [284, 9.3, 0.7, 0.1, 0, 70, 754, 83, 1.3, 159, 5.9, 0, 0, 0] },
  vung:       { name: 'Vừng', src: 'que', price: 10, unit: 'thìa', unitG: 10,
                n: [573, 17.7, 50, 7, 0, 11.8, 468, 351, 7.8, 975, 14.6, 0, 0, 0] },
  dau_an:     { name: 'Dầu ăn', src: 'sanco', price: 4.5,
                n: [884, 0, 100, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  toi:        { name: 'Tỏi', src: 'sanco', price: 8,
                n: [149, 6.4, 0.5, 0.1, 0, 2.1, 401, 25, 1.2, 181, 1.7, 0, 31, 0] },
};

// kind: sang | nha | ngoai | vat. ing: [[foodId, gam]] cho món tự nấu; n: tổng dinh dưỡng 1 suất cho món ăn ngoài.
const DISHES = {
  // Bữa sáng
  banh_gao:     { name: 'Bánh gạo (3–4 cái)', kind: 'sang', ing: [['banhgao', 40]] },
  chuoi_1:      { name: 'Chuối (1 quả)', kind: 'sang', ing: [['chuoi', 90]] },
  sua_socola_1: { name: 'Sữa socola (1 bịch)', kind: 'sang', ing: [['sua_socola', 200]] },
  sua_kd_1:     { name: 'Sữa không đường (1 bịch)', kind: 'sang', ing: [['sua_kd', 200]] },
  trung_luoc:   { name: 'Trứng luộc (1 quả)', kind: 'sang', ing: [['trung', 50]] },
  banh_day_gio: { name: 'Bánh dày giò', kind: 'sang', price: 15,
                  n: [260, 9, 6, 2, 0, 0.5, 120, 15, 1.0, 10, 0.6, 0, 0, 0] },

  // Món nhà
  com:          { name: 'Cơm (2 bát)', kind: 'nha', ing: [['com', 300]] },
  com_rang:     { name: 'Cơm rang cà rốt, trứng, hành tây, giò', kind: 'nha',
                  ing: [['com', 300], ['trung', 50], ['ca_rot', 60], ['hanh_tay', 50], ['gio', 50], ['dau_an', 12]] },
  com_rang_xx:  { name: 'Cơm rang xúc xích, trứng, cà rốt', kind: 'nha',
                  ing: [['com', 300], ['trung', 50], ['ca_rot', 60], ['hanh_tay', 50], ['xuc_xich', 50], ['dau_an', 12]] },
  thit_kho:     { name: 'Thịt lợn kho (đồ quê)', kind: 'nha', ing: [['lon_nac', 120], ['dau_an', 3]] },
  thit_luoc:    { name: 'Thịt lợn luộc (đồ quê)', kind: 'nha', ing: [['lon_nac', 120]] },
  ba_chi_rang:  { name: 'Ba chỉ rang (đồ quê)', kind: 'nha', ing: [['lon_bachi', 100]] },
  ca_ran:       { name: 'Cá biển rán (đồ quê)', kind: 'nha', ing: [['ca_bien', 120]] },
  cha_muc:      { name: 'Chả mực (đồ quê)', kind: 'nha', ing: [['cha_muc', 100]] },
  mam_tep:      { name: 'Mắm tép chưng thịt (đồ quê)', kind: 'nha', ing: [['mam_tep', 50]] },
  ga_luoc:      { name: 'Gà luộc', kind: 'nha', ing: [['ga_dui', 150]] },
  ga_xao_hanh:  { name: 'Gà xào hành tây, cà rốt', kind: 'nha',
                  ing: [['ga_uc', 150], ['hanh_tay', 80], ['ca_rot', 50], ['dau_an', 8]] },
  gio_suat:     { name: 'Giò lụa', kind: 'nha', ing: [['gio', 80]] },
  dau_sot_ca:   { name: 'Đậu phụ sốt cà chua', kind: 'nha', ing: [['dauphu', 180], ['ca_chua', 100], ['dau_an', 8]] },
  trung_ran:    { name: 'Trứng rán hành (2 quả)', kind: 'nha', ing: [['trung', 100], ['hanh_tay', 30], ['dau_an', 8]] },
  thit_bam_rim: { name: 'Thịt băm rim', kind: 'nha', ing: [['thit_bam', 100], ['dau_an', 3]] },
  rau_muong_luoc: { name: 'Rau muống luộc', kind: 'nha', ing: [['rau_muong', 200]] },
  rau_muong_xao:  { name: 'Rau muống xào tỏi', kind: 'nha', ing: [['rau_muong', 200], ['toi', 5], ['dau_an', 8]] },
  cai_ngot_xao:   { name: 'Cải ngọt xào tỏi', kind: 'nha', ing: [['cai_ngot', 200], ['toi', 5], ['dau_an', 8]] },
  canh_cai:       { name: 'Canh cải nấu thịt', kind: 'nha', ing: [['cai_ngot', 150], ['lon_nac', 20]] },
  bap_cai_luoc:   { name: 'Bắp cải luộc', kind: 'nha', ing: [['bap_cai', 200]] },
  bap_cai_xao:    { name: 'Bắp cải xào cà chua', kind: 'nha', ing: [['bap_cai', 200], ['ca_chua', 60], ['dau_an', 8]] },
  canh_ca_chua_trung: { name: 'Canh cà chua trứng', kind: 'nha', ing: [['ca_chua', 100], ['trung', 50], ['dau_an', 3]] },
  su_hao_xao:     { name: 'Su hào xào cà rốt', kind: 'nha', ing: [['su_hao', 150], ['ca_rot', 50], ['dau_an', 8]] },
  sup_lo_xao:     { name: 'Súp lơ xanh xào cà rốt', kind: 'nha', ing: [['sup_lo', 150], ['ca_rot', 40], ['dau_an', 8]] },
  gia_xao:        { name: 'Giá xào', kind: 'nha', ing: [['gia', 150], ['dau_an', 8]] },

  // Ăn ngoài (ước lượng 1 suất)
  // Quán quen: mỳ + bò + rau cải + nhiều sung tươi bé (nhỏ hơn quả nhãn, ~15 quả ≈ 100 g).
  mi_xao_bo:    { name: 'Mỳ xào bò rau cải, quả sung', kind: 'ngoai', price: 45,
                  n: [724, 28.8, 25.3, 6.1, 5, 6.9, 932, 87, 5.2, 155, 4.4, 157, 32, 0] },
  bun_ca_ro:    { name: 'Bún/bánh đa cá rô rán', kind: 'ngoai', price: 40,
                  n: [550, 28, 20, 4, 3, 2.5, 600, 60, 2.0, 250, 2.5, 50, 10, 150] },
  pho_bo:       { name: 'Phở bò', kind: 'ngoai', price: 45,
                  n: [450, 25, 10, 4, 3, 1.5, 500, 40, 4.5, 60, 3.0, 20, 10, 0] },
  com_vp:       { name: 'Cơm văn phòng', kind: 'ngoai', price: 40,
                  n: [750, 30, 28, 9, 4, 3, 650, 60, 3.5, 80, 2.5, 150, 25, 50] },

  // Ăn vặt / đồ uống
  lac_nam:      { name: 'Lạc rang (1 nắm)', kind: 'vat', ing: [['lac', 30]] },
  oi_1:         { name: 'Ổi (1 quả)', kind: 'vat', ing: [['oi', 150]] },
  cam_1:        { name: 'Cam (1 quả)', kind: 'vat', ing: [['cam', 150]] },
  chuoi_vat:    { name: 'Chuối (1 quả)', kind: 'vat', ing: [['chuoi', 90]] },
  sua_socola_vat: { name: 'Sữa socola (1 bịch)', kind: 'vat', ing: [['sua_socola', 200]] },
  tra_sua:      { name: 'Trà sữa (1 cốc)', kind: 'vat', price: 35,
                  n: [350, 3, 12, 9, 40, 0, 150, 15, 0.3, 80, 0.3, 0, 0, 0] },
  nuoc_ngot:    { name: 'Nước ngọt (1 lon)', kind: 'vat', price: 10,
                  n: [140, 0, 0, 0, 35, 0, 5, 0, 0, 5, 0, 0, 0, 0] },
};

const SLOTS = [
  { key: 'sang', name: 'Sáng' },
  { key: 'trua', name: 'Trưa' },
  { key: 'toi',  name: 'Tối' },
  { key: 'vat',  name: 'Ăn vặt' },
];

// Thực đơn mẫu. Thứ: 1 = Thứ 2 … 0 = Chủ nhật. Tối nấu dư mang cơm trưa hôm sau.
const SANG = ['banh_gao', 'chuoi_1', 'sua_socola_1'];
const DEFAULT_PLAN = {
  1: { sang: SANG, trua: ['com', 'thit_kho', 'rau_muong_luoc'],
       toi: ['com', 'dau_sot_ca', 'cai_ngot_xao'], vat: ['lac_nam'] },
  2: { sang: SANG, trua: ['com', 'dau_sot_ca', 'cai_ngot_xao'],
       toi: ['com_rang', 'bap_cai_luoc'], vat: ['lac_nam', 'oi_1'] },
  3: { sang: SANG, trua: ['mi_xao_bo'],
       toi: ['com', 'ca_ran', 'rau_muong_xao', 'canh_ca_chua_trung'], vat: ['lac_nam'] },
  4: { sang: SANG, trua: ['com', 'ca_ran', 'rau_muong_xao', 'canh_ca_chua_trung'],
       toi: ['com', 'ga_xao_hanh', 'bap_cai_luoc'], vat: ['lac_nam', 'oi_1'] },
  5: { sang: SANG, trua: ['bun_ca_ro'],
       toi: ['com', 'mam_tep', 'rau_muong_luoc', 'canh_cai'], vat: ['lac_nam'] },
  6: { sang: SANG, trua: ['com', 'mam_tep', 'rau_muong_luoc', 'canh_cai'],
       toi: ['com', 'ga_luoc', 'cai_ngot_xao', 'bap_cai_xao'], vat: ['lac_nam', 'cam_1'] },
  0: { sang: SANG, trua: ['com', 'ga_luoc', 'cai_ngot_xao', 'bap_cai_xao'],
       toi: ['com', 'thit_kho', 'rau_muong_luoc'], vat: ['lac_nam'] },
};

// Mẹo gắn với từng chất khi thiếu mà khó bù bằng đi chợ.
const TIPS = {
  ca:   'Canxi: uống sữa mỗi ngày, ăn đậu phụ, cải ngọt, mắm tép; khi về quê xin thêm vừng.',
  fib:  'Xơ: mỗi bữa chính nên có ít nhất 1 đĩa rau (~200 g), thêm 1 quả ổi/chuối mỗi ngày.',
  k:    'Kali: rau muống, cải ngọt, chuối, ổi, su hào, cà chua.',
  mg:   'Magie: lạc, rau muống, rau xanh đậm, chuối.',
  zn:   'Kẽm: thịt bò (mỳ xào bò, phở bò), thịt lợn nạc, trứng, lạc.',
  fe:   'Sắt: nam giới ăn thịt, trứng thường đủ — không cần cố bổ sung trừ khi bác sĩ dặn.',
  vita: 'Mắt — vitamin A: cà rốt, rau muống, cải ngọt, lòng đỏ trứng.',
  vitc: 'Mắt — vitamin C: ổi (rất nhiều), cam, súp lơ xanh, su hào.',
  o3:   'Mắt — omega‑3: cá biển từ quê (nục, thu) 2 bữa/tuần là đủ.',
  pro:  'Đạm: trứng, đậu phụ, thịt nạc, gà, cá.',
  sat:  'Mỡ bão hòa cao: bớt ba chỉ, da gà, xúc xích, đồ chiên — tốt cho gan và mỡ máu.',
  sug:  'Đường thêm cao: bớt trà sữa/nước ngọt; sữa socola 1 bịch/ngày vẫn ổn.',
};

// Nhóm để gợi ý đổi cùng loại ở trang Đi chợ (vuốt trái một dòng).
const FOOD_GROUPS = {
  'Rau, củ, nấm': ['rau_muong', 'bap_cai', 'cai_ngot', 'ca_chua', 'hanh_tay', 'ca_rot', 'su_hao', 'sup_lo', 'gia', 'nam_kim_cham', 'nam_huong'],
  'Quả': ['chuoi', 'oi', 'cam', 'sung'],
  'Đạm': ['trung', 'dauphu', 'ga_dui', 'ga_uc', 'gio', 'thit_bam', 'xuc_xich', 'bo'],
  'Khác': ['lac', 'sua_socola', 'sua_kd', 'banhgao', 'bun'],
};
