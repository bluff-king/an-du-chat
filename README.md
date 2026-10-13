# Ăn Đủ Chất

Web app (PWA) theo dõi khẩu phần ăn hằng tuần trên điện thoại: kali, magie, kẽm, canxi, sắt, xơ, đạm,
chất tốt cho mắt (vitamin A, C, omega‑3) và giới hạn mỡ bão hòa, đường thêm.

- Thực đơn tuần cố định → mỗi bữa bấm *Đã ăn / Đổi món / Bỏ* → bảng tổng kết tuần → gợi ý đi chợ theo ngân sách.
- Không cần máy chủ: HTML/JS tĩnh, chạy offline, dữ liệu chỉ lưu trên máy (localStorage). Có xuất/nhập JSON để sao lưu.

## Cài lên iPhone
Mở link GitHub Pages bằng **Safari** → nút Chia sẻ → **Thêm vào Màn hình chính**.

## Sửa dữ liệu
- `data.js`: thực phẩm (giá trị /100 g), món ăn, thực đơn mẫu, mục tiêu.
- Sau khi sửa code: tăng `VERSION` trong `sw.js` để điện thoại tải bản mới.

Số liệu dinh dưỡng làm tròn từ Bảng thành phần thực phẩm Việt Nam (2007) và USDA; món ăn ngoài là ước lượng.
App hỗ trợ ăn uống, không thay lời khuyên của bác sĩ.
