# Hướng dẫn cài Supabase cho UniSchedule AI

Toàn bộ miễn phí, **không cần thẻ**. Làm tuần tự theo các bước dưới.

## 1. Tạo project Supabase

1. Vào https://supabase.com → **Start your project** → đăng nhập.
2. **New project**: đặt tên (VD `unischedule`), chọn **Region** gần Việt Nam (Singapore), đặt **Database Password** (lưu lại).
3. Bấm **Create new project**, đợi ~2 phút.

## 2. Lấy URL + khóa công khai → dán vào web

1. Trong project: **Project Settings** (bánh răng) → **API** (hoặc **Data API**).
2. Copy **Project URL** và khóa **anon / publishable**.
3. Mở file `supabase-config.js` ở thư mục web, dán:

```js
window.SUPABASE_CONFIG = {
    url: 'https://<project-id>.supabase.co',
    anonKey: '<anon-publishable-key>'
};
```

> Khóa này là **công khai** (không phải secret). Bảo vệ dữ liệu do Row Level Security lo (đã cài ở bước 4).

## 3. Cấu hình xác thực

1. **Authentication** → **Sign In / Providers** → **Email**: bật Email, **tắt "Confirm email"** (để đăng ký xong vào ngay).
2. **Authentication** → **URL Configuration**:
   - **Site URL**: URL nơi bạn deploy web (VD `https://unischedule.pages.dev`) hoặc `http://localhost:3000` khi chạy thử.
   - **Redirect URLs**: thêm cùng URL đó (để link khôi phục mật khẩu quay lại đúng trang).

## 4. Tạo bảng + bảo mật

1. **SQL Editor** → **New query**.
2. Mở file `supabase/schema.sql`, copy toàn bộ, dán vào rồi **Run**.
3. Kết quả mong đợi: `Success. No rows returned`.

## 5. Deploy hàm xử lý tài khoản (`account`)

1. **Edge Functions** → **Create a new function** (hoặc **Deploy a new function** → **Via Editor**).
2. Đặt tên chính xác: `account`.
3. Xóa nội dung mẫu, dán toàn bộ file `supabase/functions/account/index.ts`.
4. Bấm **Deploy**. Đợi tới khi trạng thái "Deployed".
5. Không cần thêm secret — Supabase tự cấp biến môi trường.
6. Nếu hàm lỡ được đặt **tên khác** `account` (VD `swift-api`), sửa `accountFunction` trong `supabase-config.js` cho khớp tên thật. Nếu đổi tên được trên Dashboard thì để nguyên `accountFunction: 'account'`.

## 6. (Tùy chọn) SMTP riêng cho email khôi phục

Email mặc định của Supabase giới hạn **2 mail/giờ**. Nếu dùng thật:

1. Tạo tài khoản free tại https://resend.com, lấy SMTP/API key.
2. **Authentication** → **SMTP Settings** → điền thông tin Resend.
3. **Authentication** → **Rate Limits**: tăng số email/giờ nếu cần.

## 7. Chạy web

- Web tĩnh phải chạy qua `http(s)`, **không** mở trực tiếp bằng `file://`.
- Chạy thử nhanh: `npx serve` (hoặc bất kỳ server tĩnh nào) trong thư mục web rồi mở địa chỉ nó in ra.
- Khi deploy: xem `docs/deploy.md` (hướng dẫn Cloudflare Pages / GitHub Pages).
- Nhắc lại: phải điền `supabase-config.js` (URL + anon key) trước khi deploy, và đặt **Site URL** trong Supabase khớp địa chỉ deploy.

## 8. Checklist kiểm thử (làm sau khi deploy)

- [ ] Đăng ký tài khoản mới → hiện **mã dự phòng 12 ký tự** (copy được) → vào app.
- [ ] Đăng xuất → đăng nhập lại bằng **tên tài khoản** + mật khẩu.
- [ ] Đăng nhập sai mật khẩu → báo "Sai tên tài khoản hoặc mật khẩu."; sai tên tài khoản → cùng thông báo (không lộ tài khoản).
- [ ] Đăng ký trùng tên tài khoản → báo "Tên tài khoản đã tồn tại."
- [ ] Quên mật khẩu → gửi link → mở link, đặt mật khẩu mới → đăng nhập được.
- [ ] Quên mật khẩu → dùng **mã dự phòng đúng** → đặt lại được.
- [ ] Quên mật khẩu → dùng **mã sai** → báo lỗi và mật khẩu cũ vẫn dùng được.
- [ ] Thêm môn ở tab/thiết bị A → tab/thiết bị B tự cập nhật.
- [ ] Chat phòng chung; chat riêng 1-1; tạo nhóm, thêm/xoá thành viên, đổi tên (chỉ chủ nhóm).
- [ ] Badge số chưa đọc tăng khi có tin mới ở phòng khác; mở phòng → badge mất.
- [ ] Mở web bằng `file://` → hiện lỗi và nút đăng nhập bị khoá.
- [ ] Không đăng nhập: bấm "Dùng tiếp không cần tài khoản" → dùng được, không có tab Trò Chuyện, tải lại vẫn còn dữ liệu.
- [ ] Khách bấm "Nâng cấp" → đăng ký → dữ liệu local chuyển lên tài khoản.
- [ ] Đổi mật khẩu: mk cũ sai → báo lỗi; mk cũ đúng → đổi được.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| "Chưa cấu hình Supabase" | Chưa dán `url`/`anonKey` vào `supabase-config.js` |
| Đăng nhập báo lỗi máy chủ | Hàm `account` chưa deploy, hoặc sai tên hàm |
| Không thấy môn đồng bộ | Chưa chạy `schema.sql` (thiếu bảng/realtime), hoặc sai Site URL |
| Không nhận email khôi phục | Quá 2 mail/giờ (mặc định) → chờ, hoặc gắn SMTP riêng |
