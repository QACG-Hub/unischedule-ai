# Triển khai UniSchedule AI lên Firebase Hosting

Tài liệu này dành cho **chủ dự án**, làm một lần. Xem `docs/firebase-setup.md` để
tạo project Firebase và lấy cấu hình trước.

## 1. Chuẩn bị

```bash
cd /public/tkb
npm install -g firebase-tools
firebase login
```

## 2. Khởi tạo Hosting

```bash
firebase init hosting
```

- **Use an existing project** → chọn project đã tạo.
- **Public directory**: `.` (thư mục hiện tại — app là tĩnh, không cần build).
- **Single-page app rewrite**: **No** (đây là site tĩnh nhiều file, không phải SPA).
- **Set up automatic builds with GitHub**: No (nếu không dùng).
- **Overwrite index.html**: **No** (giữ `index.html` hiện có).

Lệnh này tạo `firebase.json` và `.firebaserc` ở gốc dự án.

## 3. Đưa Security Rules lên

Cách A — dán tay (nhanh):

1. Firebase Console → **Firestore Database → Rules**.
2. Dán toàn bộ nội dung `firestore.rules` trong dự án → **Publish**.

Cách B — dùng CLI (khuyên dùng, lặp lại được):

```bash
firebase deploy --only firestore:rules
```

Kiểm tra: sau khi publish, tạo thử một tài khoản khác và xác nhận không đọc được
`users/{uid}` hay `rooms/{phòng riêng}` của người khác.

## 4. Deploy website

```bash
firebase deploy --only hosting
```

Kết quả in ra URL dạng `https://<project>.web.app`.

## 5. Thêm domain vào Authorized domains

Firebase Console → **Authentication → Settings → Authorized domains** → **Add domain**:

- `<project>.web.app`
- `<project>.firebaseapp.com` (thường đã có)

Thiếu bước này, đăng nhập Google sẽ báo `auth/unauthorized-domain`.

## 6. Kiểm tra sau deploy (smoke)

Mở URL Hosting và lần lượt kiểm:

1. **Đăng nhập/Đăng ký**: tạo tài khoản email; đăng nhập Google.
2. **Đồng bộ TKB**: thêm môn ở máy A → mở cùng tài khoản ở máy/ẩn danh B → thấy dữ liệu.
3. **Chat phòng chung**: gửi ở A → B nhận gần như tức thì; tải lại vẫn còn.
4. **Chat riêng**: A chọn B → gửi; B trả lời; hai bên thấy **cùng một** phòng.
5. **Chat nhóm**: A tạo nhóm với B, C; đổi tên; thêm/bớt thành viên; C "Rời nhóm".
6. **Chưa đọc**: ở B, đóng tab chat rồi để A gửi → B mở lại thấy badge số chưa đọc.
7. **Console trình duyệt**: không có lỗi đỏ.

## 7. Cập nhật sau này

Mỗi khi sửa code:

```bash
firebase deploy --only hosting          # web
firebase deploy --only firestore:rules  # chỉ khi đổi firestore.rules
```

## Xử lý sự cố nhanh

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| `missing-config` trong Console | Chưa dán `firebase-config.js` |
| `file-protocol` | Mở `index.html` trực tiếp; phải chạy qua http(s) |
| `auth/unauthorized-domain` | Chưa thêm domain ở bước 5 |
| `Missing or insufficient permissions` | Chưa publish `firestore.rules` (bước 3) |
| Google popup bị chặn | App tự chuyển sang redirect; cho phép popup nếu muốn nhanh hơn |
