# Hướng dẫn thiết lập Firebase cho UniSchedule AI

Làm một lần. Sau đó app chạy được với tài khoản, đồng bộ TKB và chat.

## 0. Yêu cầu

- Một tài khoản Google.
- Node.js (để chạy `firebase` CLI và server tĩnh khi thử). Không bắt buộc cho việc deploy nếu dùng Console.

## 1. Tạo project Firebase

1. Vào <https://console.firebase.google.com/> → **Add project**.
2. Đặt tên (ví dụ `unischedule-ai`) → có thể tắt Google Analytics cho gọn → **Create project**.

## 2. Thêm Web App và lấy cấu hình

1. Trong project → biểu tượng **Web** (`</>`) → đặt nickname → **Register app**.
2. Copy đoạn `firebaseConfig` hiện ra.
3. Mở `firebase-config.js` trong project và dán các giá trị vào:

```js
window.FIREBASE_CONFIG = {
    apiKey: "…",
    authDomain: "…firebaseapp.com",
    projectId: "…",
    storageBucket: "….appspot.com",
    messagingSenderId: "…",
    appId: "…"
};
```

Lưu ý: giá trị này **không phải bí mật**; bảo vệ dữ liệu nằm ở Security Rules (bước 5).

## 3. Bật Authentication

1. **Build → Authentication → Get started**.
2. Tab **Sign-in method**:
   - Bật **Email/Password**.
   - Bật **Google** (chọn support email).
3. Tab **Settings → Authorized domains**: thêm domain bạn sẽ chạy app
   (`localhost` đã có sẵn; thêm domain Firebase Hosting ở bước 7).

## 4. Tạo Firestore

1. **Build → Firestore Database → Create database**.
2. Chọn **Production mode** → chọn khu vực gần nhất → **Enable**.

## 5. Dán Security Rules

1. **Firestore Database → Rules**.
2. Dán toàn bộ nội dung file `firestore.rules` trong project.
3. **Publish**.

## 6. Chạy thử ở máy

Firebase **không** hoạt động khi mở trực tiếp `index.html` (`file://`). Phải chạy qua http:

```bash
cd /public/tkb
npx --yes serve -l 5000 .
```

Mở <http://localhost:5000>. Kiểm tra Console trình duyệt:
- Nếu thấy `[UniSchedule] Firebase đã sẵn sàng (SDK 13.2.0).` → tốt.
- Nếu thấy `missing-config` → chưa dán cấu hình ở bước 2.
- Nếu thấy `file-protocol` → đang mở sai cách, hãy dùng server tĩnh.

## 7. Deploy lên Firebase Hosting (tùy chọn)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting     # chọn project đã tạo; public = "." (thư mục hiện tại)
firebase deploy           # hoặc: firebase deploy --only hosting
```

Sau khi deploy, thêm domain `…web.app` (và `…firebaseapp.com`) vào
**Authentication → Settings → Authorized domains**.

Triển khai rules bằng CLI (thay vì dán tay):

```bash
firebase deploy --only firestore:rules
```

## Nâng cấp phiên bản SDK

Phiên bản SDK nằm ở `SDK_VERSION` trong `firebase-init.js` (hiện tại `13.2.0`).
Khi cần nâng, tra bản mới nhất tại <https://registry.npmjs.org/firebase/latest>
rồi đổi số trong file đó.
