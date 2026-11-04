# Thiết kế: UniSchedule AI trên Supabase (đăng nhập + đồng bộ TKB + chat + khôi phục mật khẩu)

Ngày: 2026-11-04
Trạng thái: **chờ bạn duyệt** (bản 2 — đã thêm khôi phục mật khẩu)
Thay thế cho: `2026-11-04-firebase-auth-sync-chat-design.md` (bản Firebase, không dùng được vì Firestore buộc gói Blaze có thẻ).

## 0. Tóm tắt cho người dùng

- Vẫn là web tĩnh, giữ nguyên giao diện.
- Đăng nhập bằng **tên tài khoản + mật khẩu**. Lúc đăng ký nhập thêm **1 email thật**
  (chỉ để khôi phục mật khẩu, không hiện cho ai khác).
- Quên mật khẩu có **2 cách**: (1) nhận link qua email, (2) dùng **mã dự phòng** app
  đưa 1 lần lúc đăng ký.
- Toàn bộ miễn phí, **không cần thẻ**. Không dùng SMS/điện thoại (phải trả tiền).

## 1. Mục tiêu

- Thay backend Firebase bằng **Supabase** (miễn phí, không cần thẻ).
- Giữ nguyên tính năng đã làm: đăng nhập, đồng bộ thời khóa biểu nhiều thiết bị, chat
  phòng chung + riêng 1-1 + nhóm, số chưa đọc.
- Giữ nguyên giao diện (`index.html`, `style.css`) và logic thuần (`core.js`).
- Vẫn là web tĩnh, không framework/bundler.

## 2. Không mục tiêu / chống mục tiêu

- Không đổi giao diện hay luồng sử dụng (chỉ thêm màn "quên mật khẩu" và "đặt lại mật khẩu").
- Không thêm tính năng ngoài đăng nhập / đồng bộ / chat / khôi phục mật khẩu.
- Không dựng server riêng (Supabase lo backend).
- **Không** dùng SMS/điện thoại (nhà cung cấp SMS đều phải nạp thẻ).
- Chống mục tiêu: không để tài khoản này đọc được dữ liệu/chat/email của tài khoản khác.

## 3. Đăng nhập: tên tài khoản + mật khẩu

### Đăng ký

Người dùng nhập: **tên tài khoản**, **mật khẩu**, và **email khôi phục** (bắt buộc).

- Supabase Auth cần email, nên dùng **email khôi phục thật làm email của tài khoản**.
  Cách này giúp tính năng "quên mật khẩu qua email" của Supabase chạy sẵn, miễn phí.
- Tắt **Confirm email** trong Supabase → đăng ký xong vào ngay (không phải xác nhận email).
- `tên tài khoản` lưu trong bảng `profiles` để hiển thị trong app/chat (KHÔNG lưu email vào
  bảng công khai).
- Ràng buộc tên tài khoản: 3–20 ký tự, gồm `a-z 0-9 . _ -`; lưu chữ thường để không trùng.

### Đăng nhập

Người dùng nhập **tên tài khoản** (hoặc email) + **mật khẩu**:

- Nếu chuỗi có `@` → coi là email, đăng nhập thẳng bằng `signInWithPassword` (dự phòng).
- Nếu không có `@` → gọi Edge Function `account` (action `signin`): server tra email theo
  tên tài khoản rồi tạo phiên và trả về. **Email không bị lộ ra ngoài**, và sai tài khoản
  hay sai mật khẩu đều báo lỗi giống nhau (chống dò tài khoản).

## 4. Khôi phục mật khẩu (email + mã dự phòng)

### 4a. Qua email

- Màn "Quên mật khẩu": người dùng nhập **tên tài khoản** → app gọi Edge Function
  `account` (action `reset-email`) → server tra email rồi gọi Supabase gửi **link đặt lại
  mật khẩu** tới email đó.
- Bấm link → mở app ở màn "Đặt mật khẩu mới" → `updateUser({ password })`.
- Luôn báo "đã gửi" kể cả tên tài khoản không tồn tại (chống dò tài khoản).
- **Lưu ý giới hạn:** email mặc định của Supabase chỉ **2 mail/giờ** → đủ để thử, nhưng khi
  dùng thật nên gắn SMTP riêng (ví dụ Resend bản free, không cần thẻ). Ghi trong hướng dẫn.

### 4b. Qua mã dự phòng

- Lúc đăng ký xong, app tạo **mã dự phòng 12 ký tự** và hiện **một lần duy nhất**
  (kèm nút Sao chép / Tải). Người dùng tự giữ mã này.
- Mã được lưu ở dạng **băm (bcrypt)** trong bảng riêng `recovery_codes`; không ai đọc được
  (kể cả chủ tài khoản đọc lại cũng không thấy mã gốc).
- Màn "Quên mật khẩu → Dùng mã dự phòng": nhập **tên tài khoản + mã + mật khẩu mới** →
  app gọi Edge Function `account` (action `recover`): server kiểm tra mã rồi đặt lại mật
  khẩu qua quyền admin. Sai mã → báo lỗi.
- Trong phần Cài đặt, người dùng có thể **tạo mã dự phòng mới** (mã cũ bị thay thế).

### 4c. Không hỗ trợ

- SMS/điện thoại: cần Twilio/Vonage, phải nạp thẻ → không dùng.
- Quên cả email lẫn mã dự phòng: phải nhờ người quản trị đổi trong Supabase (chấp nhận).

## 5. Dữ liệu (Postgres)

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `profiles` | `id` (= auth user id), `username` (unique), `created_at` | tên hiển thị; KHÔNG chứa email |
| `recovery_codes` | `user_id` PK, `code_hash`, `created_at` | mã dự phòng đã băm; riêng tư |
| `subjects` | `id` text, `owner` uuid, `payload` jsonb, `updated_at` | PK `(owner, id)`; `payload` là môn học như cũ |
| `rooms` | `id` text PK, `type` (public/direct/group), `name`, `owner` uuid null, `last_message_text`, `last_message_sender`, `last_message_at`, `updated_at` | `id` cố định `public`; `dm_<a>_<b>` cho chat riêng; uuid cho nhóm |
| `room_members` | `room_id`, `user_id`, PK `(room_id, user_id)` | phòng chung không có dòng nào (đặc cách theo `type`) |
| `messages` | `id` uuid, `room_id`, `sender` uuid, `sender_name`, `body`, `created_at` | `body` là nội dung tin |
| `reads` | `room_id`, `user_id`, `last_read_at`, PK `(room_id, user_id)` | mốc đã đọc để tính số chưa đọc |

Ghi chú: **email khôi phục** chỉ nằm trong bảng hệ thống `auth.users` (Supabase quản lý),
không xuất hiện trong bảng công khai nào.

Điểm tương ứng với bản Firebase:

- `users/{uid}/subjects` → bảng `subjects`.
- `directory/{uid}` → bảng `profiles` (không có email).
- `rooms/{id}` → bảng `rooms` + `room_members`.
- `rooms/{id}/messages` → bảng `messages`.
- `users/{uid}/reads/{roomId}` → bảng `reads`.

## 6. Bảo mật (Row Level Security)

Bật RLS trên tất cả bảng. Policy chính:

- `profiles`: đọc cho mọi người đã đăng nhập; chỉ sửa dòng của chính mình.
- `recovery_codes`: **không** policy cho người dùng; chỉ Edge Function (quyền service role)
  đọc/ghi. Người dùng không đọc được hash của chính mình.
- `subjects`: chỉ `owner = auth.uid()` được đọc/ghi/xoá.
- `rooms`: đọc nếu `type = 'public'` hoặc mình có trong `room_members`.
  - tạo `public` đúng id `public`; tạo `direct` nếu mình là thành viên và đúng 2 người;
    tạo `group` nếu `owner = auth.uid()` và mình là thành viên.
  - sửa: phòng chung ai cũng được (chỉ tin nhắn cuối); phòng riêng chỉ thành viên;
    phòng nhóm chỉ thành viên, và **chỉ chủ nhóm** đổi `name`/thành viên — còn lại tự rời.
  - xoá: chỉ chủ nhóm.
- `room_members`: đọc nếu mình là thành viên phòng đó; chèn/xoá theo quy tắc thành viên
  (chủ nhóm quản lý, hoặc tự bỏ chính mình).
- `messages`: đọc nếu phòng public hoặc mình là thành viên; chèn nếu mình là thành viên
  (hoặc phòng public) và `sender = auth.uid()`.
- `reads`: chỉ đọc/ghi dòng của chính mình.

Mã dự phòng được băm tự động khi ghi (trigger dùng `pgcrypto`/`crypt`), nên client không bao
giờ gửi hash — chỉ gửi mã gốc một lần lúc tạo.

## 7. Realtime

Dùng Supabase Realtime (`postgres_changes`):

- `subjects` lọc `owner = me` → thay `onSnapshot` danh sách môn.
- `messages` lọc `room_id = <phòng đang mở>` → thay listener tin nhắn.
- `rooms` + `room_members` → cập nhật danh sách phòng (được thêm vào nhóm mới, tin nhắn cuối).
- `reads` của me → tính lại số chưa đọc.

**Mất mạng:** Supabase không có hàng đợi ghi offline. Khi mất mạng, thao tác gửi/lưu sẽ báo
lỗi và hiện toast; người dùng bấm lại khi có mạng. (Khác Firestore tự xếp hàng.)

## 8. Edge Function `account`

Một hàm server nhỏ (TypeScript/Deno, chạy trên Supabase, miễn phí) xử lý 3 việc cần quyền
đặc biệt:

| action | vào | ra | việc làm |
|---|---|---|---|
| `signin` | `{ username, password }` | `{ access_token, refresh_token }` | tra email theo username, `signInWithPassword`, trả phiên |
| `reset-email` | `{ username }` | `{ ok: true }` | tra email, gọi `resetPasswordForEmail` |
| `recover` | `{ username, code, new_password }` | `{ ok }` | kiểm tra `code` (bcrypt), `admin.updateUserById` đặt mật khẩu mới |

- Dùng biến môi trường Supabase tự cấp (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ANON_KEY`) → **không cần bạn dán khóa bí mật nào**.
- Gọi hàm bằng khóa công khai (`anon`/publishable) để qua cổng bảo vệ JWT của Supabase.
- Triển khai: mở dashboard → Edge Functions → tạo hàm tên `account` → dán code mình soạn →
  Deploy. Mình sẽ ghi hướng dẫn từng bước kèm ảnh/chữ.

## 9. Cấu trúc file

Giữ: `index.html`, `style.css`, `core.js`, phần lớn bố cục DOM trong `main.js`/`chat.js`.

Thay/viết lại:

- `supabase-config.js` (mới) — `window.SUPABASE_CONFIG = { url, anonKey }` (công khai, RLS bảo vệ).
- `supabase-init.js` (mới, thay `firebase-init.js`) — tạo client, guard `file://`/thiếu cấu hình.
- `auth.js` — `signInWithPassword`/`signUp`/`signOut`/`onAuthStateChange`, gọi Edge Function khi
  đăng nhập bằng tên tài khoản, luồng quên/đặt lại mật khẩu.
- `cloud-sync.js` — đọc/ghi bảng `subjects` + realtime.
- `chat.js` — bảng `rooms`/`room_members`/`messages`/`reads` + realtime.
- `main.js` — nối `supabase-init` + `auth` + `cloud-sync` + `chat`.
- `supabase/schema.sql` (mới) — tạo bảng + RLS + trigger băm mã + bật realtime.
- `supabase/functions/account/index.ts` (mới) — code Edge Function.
- `docs/supabase-setup.md`, `docs/deploy.md` (cập nhật) — tạo project + dán SQL + deploy hàm + deploy web.
- Bỏ: `firebase-config.js`, `firebase-init.js`, `firestore.rules`, `firebase.json`, `.firebaserc`.

`core.js`: giữ nguyên các hàm cũ, **thêm** hàm thuần mới để test:

- `isValidUsername(username)` → boolean
- `isValidRecoveryCode(code)` → boolean
- `normalizeUsername(username)` → chữ thường, cắt khoảng trắng

## 10. Việc còn để người xây quyết

- **Hosting web tĩnh:** ghi trong `docs/deploy.md`. Đề xuất mặc định **Cloudflare Pages**
  hoặc **GitHub Pages** (free, không cần thẻ); chốt sau khi bạn muốn deploy.
- **Tạo project Supabase + deploy hàm `account`:** bạn tự làm theo `docs/supabase-setup.md`
  (free, không cần thẻ). Mình hướng dẫn từng bước.

## 11. Kiểm thử

- Hàm thuần mới (`isValidUsername`, `isValidRecoveryCode`, `normalizeUsername`) + toàn bộ hàm
  `core.js` cũ: `node --test`.
- Các bước cần trình duyệt/Supabase thật (đăng nhập, khôi phục email, khôi phục mã, đồng bộ,
  chat, RLS) ghi trong `docs/supabase-setup.md` và chuyển bạn kiểm — giống cách đã làm với Firebase.

## 12. Các cách đã cân nhắc

1. **Firebase Blaze** (giữ code) — bị loại vì buộc thẻ.
2. **Supabase** — chọn. Miễn phí, không thẻ, có Auth + Postgres + Realtime + Edge Functions.
3. **Appwrite Cloud** — cũng free/không thẻ nhưng xa thiết kế hiện tại hơn, không có lợi thế rõ.
4. **Khôi phục qua SMS/điện thoại** — bị loại vì Twilio/Vonage phải nạp thẻ.
5. **Đặt lại mật khẩu bằng cách ghi thẳng `auth.users` từ SQL** — bị loại vì dễ vỡ khi
   Supabase đổi cách băm mật khẩu; dùng Edge Function + admin API an toàn hơn.
6. **Đăng nhập bằng tên tài khoản qua RPC trả email** — bị loại vì làm lộ email người dùng;
   dùng Edge Function để email không bao giờ ra tới trình duyệt.
