# Thiết kế: Chế độ khách (local) + Đổi mật khẩu bằng mật khẩu cũ

Ngày: 2026-11-04
Trạng thái: chờ duyệt

## 1. Ý định & lý do

Ứng dụng `UniSchedule AI` hiện **bắt buộc đăng nhập**: chưa có tài khoản thì màn
hình app bị ẩn hoàn toàn. Ta muốn hai thứ:

- **A. Chế độ khách**: cho phép dùng thời khóa biểu **không cần tài khoản**, dữ
  liệu chỉ lưu trên máy (`localStorage`). Sau này khách có thể **nâng cấp** thành
  tài khoản thật và **mang dữ liệu local lên mây**.
- **B. Đổi mật khẩu bằng mật khẩu cũ**: trong lúc đang đăng nhập, người dùng nhập
  **mật khẩu cũ** (để xác minh) rồi **mật khẩu mới**. Hiện chỉ có luồng đặt lại
  mật khẩu qua link email, chưa có đổi mật khẩu chủ động.

## 2. Mục tiêu

- Khách mở được app, thêm/sửa/xoá môn, tải lại trang vẫn còn dữ liệu.
- Dữ liệu khách **tách biệt** với dữ liệu các tài khoản thật trên cùng máy.
- Khách **không** đồng bộ đám mây và **không** dùng chat.
- Khách có nút **nâng cấp**: đăng ký tài khoản → dữ liệu local được chuyển lên
  tài khoản mới.
- Người dùng thật đổi được mật khẩu; **mật khẩu cũ sai thì không đổi được**.

## 3. Không làm (non-goals)

- Khách không vào phòng chat, không đồng bộ cloud.
- Không hỗ trợ hàng đợi offline cho tài khoản thật.
- Không đổi luồng khôi phục mật khẩu hiện có (email / mã dự phòng).

## 4. Chống mục tiêu (anti-goals)

- Tài khoản này **không** đọc được dữ liệu local của tài khoản khác trên cùng máy.
- Khách **không** đọc/ghi được dữ liệu trên mây.
- Đổi mật khẩu **không** thành công khi mật khẩu cũ sai.
- Không tự ý ghi đè dữ liệu mây của tài khoản đã có sẵn dữ liệu.

## 5. Ràng buộc

- Nền tĩnh, không framework/bundler; ES module + script classic chạy trên `http(s)`.
- Giữ giao diện tiếng Việt, tái dùng hạ tầng sẵn có:
  `cacheKeyFor`, `shouldOfferUpload`, `legacyCacheAllowed`, `migrateLocalToCloud`,
  `window.startUniSchedule` / `window.stopUniSchedule`, `initChat` / `teardownChat`.
- Bộ test bắt buộc chạy: `node --test tests/*.test.js` (hiện 30/30 pass) — không
  được làm hỏng test cũ.

## 6. Hiện trạng liên quan

- `main.js`: `applyUser(user)` — có user thì `startUniSchedule`, tắt thì hiện
  `authScreen`, gọi `initChat` và `ensureUserProfile`.
- `script.js`: `startUniSchedule(user)` đặt `currentUid`, gọi `init()`; nếu có
  `currentUid` thì `setupCloudSync`. Cache đọc/ghi theo khóa `cacheKeyFor(uid)`;
  có nhánh đọc cache "legacy" (khóa chung) được bảo vệ bởi `UNI_LAST_UID`.
- `cloud-sync.js`: nguồn sự thật là bảng `subjects`; có `migrateLocalToCloud`.
- `auth.js`: `signUpAccount`, `signInAccount`, `updatePassword`, `toAppUser`.
  `user.email` có sẵn từ phiên (email khôi phục).
- `index.html`: header có `userMenu` (avatar, tên, nút `recoveryBtn`, nút
  `logoutBtn`); màn `authScreen`; các tab gồm `btnTabChat` / `chatTab`.

## 7. Các phương án đã cân nhắc

### A. Chế độ khách
- Cách 1: uid cố định `guest`, tái dùng cache local sẵn có; ẩn chat + sync.
- Cách 2: hệ thống lưu trữ riêng hoàn toàn cho khách (bị loại — thừa, vì đã có
  cơ chế cache theo uid).
- Cách 3: như Cách 1 **kèm nâng cấp** khách → tài khoản thật. **Đã chọn.**

### B. Đổi mật khẩu
- Cách 1: thêm mục trong giao diện; xác minh bằng **đăng nhập lại** (email lấy từ
  phiên) rồi `updateUser`. **Đã chọn.**
- Cách 2: thêm action vào Edge Function để xác minh (bị loại — thừa).

## 8. Thiết kế chi tiết — A. Chế độ khách

### 8.1 Danh tính
- Hằng số `GUEST_UID = 'guest'` (uid Supabase thật là UUID nên không đụng).
- Cờ phiên trong `localStorage`: `UNI_GUEST = '1'` khi đang ở chế độ khách.
- `toAppUser` vẫn giữ; thêm khái niệm user khách: đối tượng
  `{ uid: 'guest', id: 'guest', guest: true, displayName: 'Khách', email: null }`.
- Helper thuần: `isGuestUid(uid)` trả `uid === 'guest'` (đặt ở `core.js`, có test).

### 8.2 Vào / ra chế độ khách
- `index.html`: thêm nút **"Dùng tiếp không cần tài khoản"** dưới form đăng nhập,
  id `guestBtn`.
- `main.js`: bấm nút → đặt `UNI_GUEST='1'` → `applyGuest()`:
  - `showAuthScreen(false)`, hiện app.
  - Ẩn tab chat (`btnTabChat` + `chatTab`), không gọi `initChat`.
  - `window.startUniSchedule(guestUser)`.
  - Header: `userName` = "Khách"; ẩn `recoveryBtn`; nút phải đổi nhãn thành
    **"Đăng nhập / Nâng cấp"** thay cho `logoutBtn` (hoặc `logoutBtn` = "Thoát khách"
    + thêm nút `upgradeBtn`). → chốt: thêm nút `upgradeBtn` ("Nâng cấp") và
    `logoutBtn` giữ nghĩa "thoát khách".
- Khi tải lại trang, module `main.js` khởi động: nếu `UNI_GUEST==='1'` và **không**
  có phiên Supabase thật → `applyGuest()`. Nếu có phiên thật → ưu tiên tài khoản
  thật (và xoá cờ khách).
- Thoát khách: xoá `UNI_GUEST`, `stopUniSchedule()`, hiện `authScreen`.

### 8.3 Lưu trữ
- Dùng nguyên `cacheKeyFor('guest')` cho dữ liệu khách.
- Không đặt `UNI_LAST_UID='guest'` (tránh cắt quyền xem cache legacy của tài khoản
  thật khi họ đăng nhập lại). Cache khách vốn đã tách theo khóa riêng nên an toàn.
- `script.js` `startUniSchedule`: nếu user là khách (`isGuestUid`), **bỏ qua**
  `setupCloudSync`.

### 8.4 Nâng cấp khách → tài khoản (chỉ qua ĐĂNG KÝ MỚI)
Quyết định của người dùng: nâng cấp chỉ dùng đường **đăng ký**. Nếu email đã có tài
khoản → báo **"Email này đã được đăng ký."** (ánh xạ sẵn có), **không** tạo tài
khoản, **không** migrate; dữ liệu khách vẫn ở lại máy.

- Trong chế độ khách, bấm **"Nâng cấp"** → hiện `authScreen` ở chế độ **Đăng ký**,
  bật biến trong bộ nhớ `upgradeMode = true` (không lưu localStorage).
- Khi `signUpAccount` thành công (phiên thật đã có), và `upgradeMode` đang bật:
  1. Đọc danh sách local của khách: `localStorage.getItem(cacheKeyFor('guest'))`.
  2. Nếu danh sách không rỗng → `migrateLocalToCloud(user, list)`.
  3. Xoá cờ `UNI_GUEST`; đặt `upgradeMode = false`. **Giữ** cache `guest`.
  4. Gọi **refetch mây tường minh** cho uid mới để giao diện hiện dữ liệu vừa
     migrate (không phụ thuộc thứ tự `onAuthStateChange` hay realtime). Bổ sung cầu
     nối `window.refreshCloudSubjects` trong `cloud-sync.js` (gọi `refetch`).
  5. `applyUser(user)` chạy bình thường (chat + sync bật lại).
- Đăng ký **không** qua nút "Nâng cấp" (`upgradeMode` false, VD đăng ký thường lúc
  đã đang ở màn đăng nhập) → **không** migrate gì.
- An toàn ghi đè: tài khoản vừa tạo có cloud rỗng nên migrate an toàn. Nếu migrate
  lỗi → giữ nguyên cache `guest`, hiện toast cảnh báo (không mất dữ liệu local).

### 8.5 Khi Supabase không sẵn sàng
Quyết định của người dùng: **không** thêm hỗ trợ offline. App vẫn yêu cầu mở được
web và nạp được SDK như hiện nay. Nếu `window.supabaseReady` là false, giữ nguyên
hành vi chặn hiện có (hiện màn đăng nhập + báo lỗi, khoá nút gửi). Nút khách
`guestBtn` chỉ hoạt động khi `supabaseReady` — không cần nhánh đặc biệt.

## 9. Thiết kế chi tiết — B. Đổi mật khẩu

### 9.1 Giao diện
- `index.html`: trong `userMenu` thêm nút `changePasswordBtn` (icon chìa khoá/bánh
  răng) — chỉ hiện với tài khoản thật. Thêm modal `changePasswordModal` gồm:
  - Ô **Mật khẩu cũ** (`cpOld`, type password).
  - Ô **Mật khẩu mới** (`cpNew`, type password, ≥ 6 ký tự).
  - Nút **Đổi mật khẩu** (`cpSubmit`) + nút đóng; dòng báo lỗi `cpMsg`.
- Ở chế độ khách: ẩn `changePasswordBtn` (khách không có mật khẩu).

### 9.2 Luồng (`auth.js`)
- Hàm mới `changePassword(oldPassword, newPassword, email)`:
  1. Nếu thiếu email → ném lỗi known "Không xác định được email tài khoản."
  2. `signInWithPassword({ email, password: oldPassword })` — sai → ném lỗi known
     **"Mật khẩu cũ không đúng."**
  3. `updateUser({ password: newPassword })`.
- `main.js` nối nút: lấy `email` từ user hiện tại (đã có trong phiên), kiểm tra
  `cpNew.length >= 6`, gọi `changePassword`, hiện thông báo thành công và đóng modal.
- Thông điệp lỗi dùng lại `authErrorMessage` (thêm ánh xạ nếu cần).

### 9.3 Lưu ý kỹ thuật
- Đăng nhập lại để xác minh sẽ **làm mới phiên** (cùng user); sau đó `updateUser`
  dùng phiên mới. Không ảnh hưởng dữ liệu.
- Tài khoản tạo bằng email thật (email khôi phục) nên `signInWithPassword` theo
  email luôn khả dụng.

## 10. Kế hoạch kiểm thử

- Test đơn vị mới (Node, không cần mạng):
  - `isGuestUid('guest') === true`, `isGuestUid(uuid) === false`.
  - Logic quyết định migrate khi nâng cấp (hàm thuần, dựa trên danh sách local +
    cloud rỗng/không rỗng).
- Giữ nguyên 30 test cũ (phải vẫn pass).
- Kiểm thử thủ công (người dùng):
  - Vào khách → thêm môn → tải lại → còn dữ liệu.
  - Khách: không thấy tab Trò Chuyện; không đồng bộ.
  - Đăng nhập tài khoản thật trên cùng máy → **không** thấy dữ liệu khách.
  - Khách → Nâng cấp → đăng ký → dữ liệu local xuất hiện trên tài khoản (và đồng
    bộ sang máy/tab khác).
  - Đổi mật khẩu: mk cũ đúng → đổi được, đăng nhập lại bằng mk mới OK; mk cũ sai →
    báo "Mật khẩu cũ không đúng."

## 11. Việc để người xây dựng tự quyết

- Chữ/icon cụ thể của các nút mới.
- Có hiện hay không dòng nhắc "Bạn đang dùng với tư cách khách" (đề xuất: có, nhỏ).
- Thứ tự đặt nút trong `userMenu`.
- Tên cầu nối refetch (`window.refreshCloudSubjects` là đề xuất).

## 12. Quyết định đã chốt qua vòng kiểm tra

- Nâng cấp chỉ qua **đăng ký**; trùng email → báo lỗi, không migrate, dữ liệu khách
  giữ ở máy. (người dùng)
- Không hỗ trợ offline; nút khách chỉ chạy khi Supabase sẵn sàng. (người dùng)
- Migrate chỉ khi `upgradeMode` bật + danh sách khách không rỗng; xác định tường
  minh, không dựa vào realtime. (quyết định kỹ thuật của người xây dựng)
- Migrate lỗi → giữ cache khách + toast, không mất dữ liệu. (quyết định kỹ thuật)
- Đổi mật khẩu xác minh bằng `signInWithPassword` (email lấy từ phiên); việc
  re-auth làm `onAuthStateChange` chạy lại không gây hại (cloud đã có dữ liệu nên
  không hỏi tải lên). (quyết định kỹ thuật)
