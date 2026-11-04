# Thiết kế: Tài khoản, đồng bộ TKB, và Chat (Firebase)

- Ngày: 2026-11-04
- Trạng thái: Chờ duyệt
- Người viết: brainstorming giữa bạn và AI

## 1. Mục tiêu và lý do

App `UniSchedule AI` hiện là một trang tĩnh (HTML/CSS/JS thuần) chỉ lưu dữ liệu
thời khóa biểu trong `localStorage`. Hệ quả: đổi máy/trình duyệt hoặc xóa cache là
mất dữ liệu, và không thể xem chung hay trò chuyện.

Dự án này thêm:

1. **Tài khoản + đăng nhập** (email/mật khẩu, và Google).
2. **Đồng bộ thời khóa biểu theo tài khoản qua nhiều thiết bị**.
3. **Chat giữa người với người**, gồm:
   - **Một phòng chung** cho tất cả người dùng đã đăng nhập.
   - **Chat riêng 1-1**.
   - **Chat nhóm** (tự tạo nhóm nhiều người).

Đích thành công: người dùng đăng nhập ở bất kỳ máy nào cũng thấy đúng TKB của
mình, và nhắn tin được với mọi người.

## 2. Phạm vi

### Goals
- Đăng nhập/đăng ký/đăng xuất; phiên đăng nhập được nhớ giữa các lần mở.
- Dữ liệu TKB gắn với tài khoản, tự đồng bộ khi mở app.
- Chuyển dữ liệu TKB đang có trong `localStorage` lên tài khoản ở lần đăng nhập đầu.
- Phòng chat chung, chat riêng 1-1, tạo nhóm; tin nhắn hiện theo thời gian thực.
- Mất mạng: các thao tác đang làm trong phiên vẫn tiếp tục nhờ cache của Firestore và
  tự đồng bộ lại khi có mạng. **Không** làm PWA/service worker để mở app khi chưa từng tải.

### Non-goals (chưa làm lần này)
- Gửi ảnh/file/tệp trong chat.
- Thông báo đẩy (push), email thông báo.
- Hoạt động như PWA: mở được app khi chưa từng tải hoặc không có mạng (không dùng service worker).
- Trạng thái "đang gõ", "đang online", đã xem tới đâu chính xác theo từng tin (chỉ có số chưa đọc cơ bản).
- Chặn/xóa người khác, quản trị viên, kiểm duyệt nội dung.
- Tìm kiếm tin nhắn, thu hồi tin nhắn, mã hóa đầu-cuối.
- Đổi mật khẩu/quên mật khẩu nâng cao (có thể dùng luồng cơ bản của Firebase).
- Ứng dụng di động riêng (vẫn là web).

### Anti-goals (làm ra cũng coi như thất bại)
- Để lộ TKB của người này cho người khác đọc được.
- Làm app hỏng/không dùng được khi chưa đăng nhập hoặc khi mất mạng.
- Buộc phải cài build tool (npm, bundler) — phải giữ nguyên nền tĩnh.
- Chứa khóa bí mật (secret) trong mã phía trình duyệt.

## 3. Ràng buộc

- Nền tảng hiện tại: file tĩnh, không build, không phụ thuộc thư viện ngoài (trừ khi cần). Giữ nguyên tinh thần này; thêm Firebase SDK qua CDN dạng ES module.
- Ngân sách: dùng **gói miễn phí** của Firebase (Spark). Thiết kế để không vượt hạn mức thông thường của một lớp học.
- Bạn (chủ dự án) phải tự **tạo project Firebase** và dán cấu hình vào app; AI không tạo hộ được vì cần đăng nhập Google.
- Giao diện tiếng Việt, nhất quán với phong cách hiện có.
- Giữ tương thích dữ liệu `localStorage` cũ (khóa `uni_schedule_subjects_v2`).

## 4. Các phương án đã cân nhắc

| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| **Firebase** (Auth + Firestore + Hosting) | Một tài khoản lo hết, realtime có sẵn, miễn phí đủ dùng, không phải chạy server, gắn được vào file tĩnh | Phụ thuộc Google, NoSQL, phải viết security rules | **Được chọn** |
| Supabase (Auth + Postgres + Realtime) | Dữ liệu quan hệ, mã nguồn mở, không khóa vào Google | Vẫn là dịch vụ ngoài, cần SQL + RLS | Loại lần này |
| Server riêng (Node + Socket.IO + DB) | Toàn quyền | Công gấp nhiều lần, phải tự vận hành server, bảo mật, chi phí | Loại |

**Vì sao chọn Firebase:** nhanh, ít việc bảo trì, có sẵn cả Auth, database thời gian
thực, và nơi lưu trữ web — phù hợp với một app tĩnh và một người làm.

## 5. Thiết kế kỹ thuật

### 5.1 Kiến trúc tổng thể
- Frontend: giữ nguyên `index.html`, `style.css`, `script.js`, bổ sung các file JS mới.
- Firebase JS SDK (modular, ESM) nạp qua CDN trong `<script type="module">`.
  Phiên bản chính xác chốt tại thời điểm bắt đầu code (mới nhất ổn định, ví dụ v11/v12).
- Cấu hình Firebase nằm trong `firebase-config.js` (đối tượng config công khai — an toàn
  khi lộ, vì bảo vệ dựa trên Security Rules; đây không phải secret).

### 5.2 Cấu trúc file dự kiến
```
/public/tkb/
  index.html            (sửa: thêm màn đăng nhập, tab Chat, menu người dùng, nạp module)
  style.css             (sửa: style màn đăng nhập, chat)
  script.js             (sửa: bỏ init thẳng; chờ trạng thái đăng nhập; nối hook cloud)
  firebase-config.js    (mới: cấu hình project)
  firebase-init.js      (mới: khởi tạo app, auth, db; export dùng chung)
  auth.js               (mới: đăng nhập/đăng ký/Google/đăng xuất, quản lý phiên)
  cloud-sync.js         (mới: đồng bộ subjects; thay thế hook cloud*)
  chat.js               (mới: phòng chung, 1-1, nhóm, gửi/đọc tin realtime)
  chat.css              (mới, tùy chọn: tách style chat nếu style.css quá dài)
  firestore.rules       (mới: security rules, để bạn dán vào Firebase Console)
  docs/specs/...        (tài liệu này)
```

### 5.3 Xác thực (Authentication)
- Phương thức: **Email + mật khẩu** và **Google**.
- Đăng ký: nhập Họ tên (dùng làm `displayName`), Email, Mật khẩu.
- Phiên được Firebase nhớ tự động; khi mở lại app tự đăng nhập nếu còn phiên.
- Khi **chưa đăng nhập**: hiện màn hình đăng nhập/đăng ký, ẩn toàn bộ nội dung app.
- Khi **đã đăng nhập**: hiện app; header có avatar + tên + nút đăng xuất.
- Sau khi đăng nhập, tạo/cập nhật hồ sơ `users/{uid}` và `directory/{uid}` (xem 5.5).

Màn hình đăng nhập (mô tả):
- Tiêu đề app, hai tab "Đăng nhập" / "Đăng ký".
- Trường: Họ tên (chỉ khi đăng ký), Email, Mật khẩu.
- Nút "Đăng nhập bằng Google".
- Vùng hiển thị lỗi (sai mật khẩu, email trùng, mất mạng…).

### 5.4 Đồng bộ thời khóa biểu
- Khi đăng nhập: 
  1. Bật cache offline của Firestore (ví dụ `persistentLocalCache`).
  2. Nếu tài khoản **chưa có** dữ liệu và cache cục bộ **đang có** dữ liệu **thuộc chính
     tài khoản này** (xem quy tắc sở hữu bên dưới) → hỏi "Tải thời khóa biểu đang có lên
     tài khoản?" rồi tải lên.
  3. Nghe realtime bộ sưu tập môn của tài khoản; cập nhật `subjectsList` và vẽ lại.
- Ba hook sẵn có trong `script.js` được nối vào Firestore:
  - `window.cloudSaveSubject(subject)` → ghi/ghi đè `users/{uid}/subjects/{id}`.
  - `window.cloudDeleteSubject(id)` → xóa `users/{uid}/subjects/{id}`.
  - `window.cloudClearAllSubjects()` → xóa toàn bộ môn của tài khoản.
- `localStorage` vẫn được dùng như **cache đọc nhanh**, nhưng **nguồn sự thật là Firestore**.
- **Quy tắc sở hữu cache cục bộ (tránh lộ dữ liệu trên máy dùng chung):** mỗi bản cache
  gắn với uid đã đăng nhập (`uni_schedule_cache_v1__<uid>`), kèm khóa `UNI_LAST_UID`.
  Khi đăng nhập một tài khoản khác, **không bao giờ** đề nghị tải dữ liệu của tài khoản
  trước lên. Chỉ đề nghị tải lên khi cache chưa có chủ hoặc chủ cache == uid đang đăng
  nhập. `localStorage` cũ (`uni_schedule_subjects_v2`) được coi là "chưa có chủ" và chỉ
  được đề nghị cho lần đăng nhập đầu tiên.
- Xung đột: theo từng môn (mỗi môn là một document), ghi sau thắng ("last write wins").
  Hai thiết bị sửa cùng lúc cùng một môn là tình huống hiếm gặp, chấp nhận được.
- Khi đăng xuất: xóa dữ liệu trong bộ nhớ và ẩn app. Cache cục bộ theo uid được giữ lại
  (để lần sau đăng nhập lại nhanh), nhưng **không** được dùng để đề nghị tải lên cho một
  tài khoản khác.

### 5.5 Mô hình dữ liệu Firestore

```
users/{uid}
  displayName: string
  email: string
  photoURL: string | null
  class: string | null        // tùy chọn, lớp/nhóm hiển thị trong chat
  createdAt: timestamp
  updatedAt: timestamp

directory/{uid}                  // danh bạ công khai cho chat (KHÔNG chứa email)
  displayName: string
  class: string | null
  photoURL: string | null
  updatedAt: timestamp

users/{uid}/subjects/{subjectId}
  tenHocPhan, lop, siSo, soTC, tongSoTiet,
  thu: array<number>, tietHoc, tuNgay, denNgay, buoiHoc,
  phongHoc, donVi, giangVien, hinhThucThi, ghiChu,
  updatedAt: timestamp

rooms/{roomId}
  type: "public" | "direct" | "group"
  name: string | null
  members: array<uid>            // phòng chung: luôn rỗng; quyền dựa vào type == "public"
  ownerId: uid | null            // nhóm: người tạo
  createdAt: timestamp
  updatedAt: timestamp
  lastMessage: {                 // để hiện danh sách phòng
    text: string,
    senderId: uid,
    senderName: string,
    createdAt: timestamp
  } | null

rooms/{roomId}/messages/{messageId}
  senderId: uid
  senderName: string
  text: string
  type: "text"
  createdAt: timestamp
```

Quy ước:
- **Phòng chung** có id cố định `public`, `type = "public"`, `members` để rỗng. Quyền
  đọc/ghi dựa vào `type == "public"` chứ không dựa vào `members`.
- **Chat riêng 1-1**: `type = "direct"`, `members = [uidA, uidB]`, id xác định trước bằng
  `"dm_" + [uidA, uidB].sort().join("_")` để hai người luôn mở đúng một phòng.
- **Chat nhóm**: `type = "group"`, id tự sinh, `ownerId` = người tạo,
  `members` gồm người tạo + các thành viên được chọn.
- Danh sách phòng của người dùng = phòng `public` (lấy theo doc id) + truy vấn
  `where("members", "array-contains", uid)`.
- Tin nhắn truy vấn `orderBy("createdAt", "desc")`, giới hạn (ví dụ 50), realtime.
- "Số chưa đọc" (mức cơ bản): lưu `users/{uid}/reads/{roomId} = { lastReadAt: timestamp }`;
  đếm tin có `createdAt > lastReadAt`. Có thể làm sau, không chặn phần còn lại.
- Nơi tra tên người gửi là `directory/{uid}` (không phải `users/{uid}`), tránh lộ email.

### 5.6 Bảo mật (Security Rules) — phác thảo
Nguyên tắc: chỉ đọc/ghi TKB của chính mình; chat chỉ trong các phòng mình thuộc về.

```
- users/{uid}: read/write nếu auth.uid == uid. (chứa email — không cho người khác đọc)
- directory/{uid}: read nếu đã đăng nhập; write nếu auth.uid == uid.
- users/{uid}/subjects/{id}: read/write chỉ khi auth.uid == uid.
- users/{uid}/reads/{id}: read/write chỉ khi auth.uid == uid.
- rooms/{roomId}:
    read  nếu type == "public", HOẶC đã đăng nhập và uid ∈ members.
    create: type == "public"  → cho phép tạo đúng id "public" (seed phòng chung);
            type == "direct"  → đã đăng nhập, uid ∈ members, members.size == 2;
            type == "group"   → đã đăng nhập, ownerId == uid, uid ∈ members.
    update: type == "public"  → người đã đăng nhập được cập nhật (chỉ lastMessage/updatedAt);
            type == "direct"  → uid ∈ members (chủ yếu đổi lastMessage);
            type == "group"   → uid ∈ members; đổi name/members thì ownerId == uid
                                hoặc đang tự rời (bớt chính mình khỏi members).
    delete: chỉ type == "group" và ownerId == uid. public/direct không xóa.
- rooms/{roomId}/messages/{msgId}:
    read  nếu phòng là public, HOẶC uid ∈ members của phòng cha (dùng get(parent)).
    create nếu (phòng public HOẶC uid ∈ members), senderId == uid, createdAt == request.time.
    update/delete: không cho.
- Bootstrap phòng chung: lần đầu có người đăng nhập, app tạo `rooms/public` nếu chưa có
  (rule cho phép tạo đúng id "public" với type "public").
```
`firestore.rules` được viết đầy đủ trong lúc code và bạn dán vào Firebase Console.

### 5.7 Giao diện Chat
- Thêm **tab "Trò chuyện"** vào thanh tab hiện có (icon mới trong sprite SVG nội bộ).
- Bố cục hai cột (trên desktop), xếp dọc (trên mobile):
  - **Cột trái — danh sách phòng**: mục "Phòng chung" ở trên cùng, rồi danh sách
    chat riêng + nhóm, kèm tin nhắn cuối và (nếu có) số chưa đọc. Nút **"+ Tạo nhóm"**.
  - **Cột phải — khung trò chuyện**: tiêu đề phòng, vùng tin nhắn cuộn được (tên người
    gửi, nội dung, thời gian), ô nhập + nút gửi.
- Bắt đầu chat riêng: nút **"Chat riêng"** mở danh sách người dùng (tên + lớp) để chọn.
  Danh sách lấy từ collection **`directory/{uid}`** chỉ gồm `displayName`, `class`,
  `photoURL` — **không** lộ email. Có ô tìm theo tên; phân trang khi đông người.
- Tạo nhóm: nhập tên nhóm + chọn thành viên từ danh sách người dùng.
- Tin nhắn realtime bằng `onSnapshot`; tự cuộn xuống tin mới nhất.
- Hiển thị tên người gửi lấy từ `directory/{uid}` (lưu kèm `senderName` vào tin nhắn
  để không phải tra cứu lại).

### 5.8 Triển khai (Hosting)
- Dùng **Firebase Hosting** (miễn phí, cùng project). Các bước: bạn tạo project,
  bật Auth (Email/Password + Google), tạo Firestore, dán `firestore.rules`,
  deploy, thêm domain vào danh sách Authorized domains.
- **Bắt buộc chạy qua http(s)**: Firebase Auth và Firestore **không** hoạt động với
  `file://`. Khi phát triển, chạy `firebase serve` (hoặc một static server local) rồi
  thêm `localhost`/`127.0.0.1` vào Authorized domains. Khi chính thức, dùng domain của
  Firebase Hosting.
- Google Sign-In: mặc định dùng **popup**, tự chuyển sang **redirect** khi popup bị chặn
  (một số trình duyệt trong ứng dụng).
- Khóa Gemini cho tính năng OCR: hiện đang để phía client như cũ. Nếu muốn an toàn hơn
  phải chuyển qua Cloud Functions — **ngoài phạm vi** lần này (ghi nhận là rủi ro).

## 6. Ảnh hưởng tới mã hiện có
- `init()` trong `script.js` không còn chạy ngay; thay bằng: chờ Firebase báo trạng thái
  đăng nhập → nếu đã đăng nhập thì chạy `init()` + nối đồng bộ; nếu chưa thì hiện màn đăng nhập.
- `saveToLocalStorage()` giữ nguyên (cache), thêm ghi Firestore qua `cloudSaveSubject`.
- Các hàm `editSubject`, `deleteSubject`, `confirmClearAll`, `saveOcrResultsToSchedule`
  đã có sẵn chỗ gọi hook cloud — chỉ cần hook thật sự tồn tại.
- Thêm nút đăng xuất và thông tin người dùng vào header.

## 7. Kế hoạch triển khai theo giai đoạn (đề xuất)
1. **Nền tảng**: tạo project Firebase, cấu hình, màn đăng nhập/đăng ký, đăng xuất, phiên.
2. **Đồng bộ TKB**: Firestore, security rules, nghe realtime, chuyển dữ liệu từ localStorage.
3. **Chat phòng chung**: mô hình rooms/messages, UI chat, gửi/đọc realtime.
4. **Chat riêng 1-1** và **tạo nhóm**.
5. **Hoàn thiện**: cache offline, số chưa đọc, kiểm thử nhiều thiết bị, hướng dẫn deploy.

Mỗi giai đoạn làm xong kiểm tra chạy được rồi mới sang giai đoạn sau.

## 8. Điều để người xây dựng tự quyết
- Phiên bản chính xác của Firebase JS SDK.
- Cách đặt tên và chia nhỏ file JS; có tách `chat.css` hay không.
- Kích thước lô tải tin nhắn, có phân trang (cuộn lên tải thêm) hay không.
- Chi tiết nhỏ về bố cục, màu sắc, icon mới.
- Cách hiển thị lỗi cụ thể.
- Có dùng `class` của người dùng trong chat hay chỉ tên.

## 9. Rủi ro đã biết
- Khóa Gemini phía client có thể bị lộ — chấp nhận trong phạm vi này.
- Gói miễn phí Firebase có hạn mức; chat đông có thể chạm giới hạn đọc/ghi.
- Dữ liệu chat không mã hóa đầu-cuối; ai vào được phòng thì đọc được.
- Google Sign-In cần cấu hình Authorized domains đúng, nếu không sẽ lỗi khi deploy.

## 10. Các điểm đã chốt sau buổi kiểm tra thiết kế

Một kỹ sư độc lập đã đọc bản thiết kế và nêu các chỗ còn mơ hồ. Dưới đây là cách chốt
(đều là quyết định của người viết — bạn có thể phản hồi khi duyệt):

1. **Cache cục bộ & máy dùng chung** — cache gắn theo uid, không bao giờ đề nghị tải dữ
   liệu của tài khoản khác lên (chi tiết §5.4). Bảo vệ đúng anti-goal "không lộ TKB".
2. **Phòng chung & security rules** — rules đặc cách `type == "public"`; `members` phòng
   chung để rỗng; app tự tạo `rooms/public` lần đầu nếu chưa có (chi tiết §5.6).
3. **Mất mạng** — chỉ đảm bảo trong phiên đang mở; **không** làm PWA/service worker lần này.
4. **Chạy app** — bắt buộc qua http(s), không dùng `file://`; Google Sign-In ưu tiên popup,
   tự chuyển redirect khi bị chặn (chi tiết §5.8).
5. **Danh bạ người dùng** — dùng collection riêng `directory/{uid}` chỉ có tên, lớp, ảnh;
   **không** lộ email; có tìm kiếm + phân trang (chi tiết §5.5, §5.6, §5.7).
6. **Vòng đời nhóm** — người tạo (owner) được đổi tên, thêm/bớt thành viên; thành viên
   được tự rời nhóm. Xóa nhóm xóa document phòng nhưng **không** tự xóa tin nhắn con
   (Firestore không cascade) — chấp nhận dữ liệu mồ côi; việc dọn dẹp triệt để cần Cloud
   Functions → ngoài phạm vi lần này.
