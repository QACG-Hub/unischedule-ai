# UniSchedule AI — Supabase Auth + Sync + Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay backend Firebase bằng Supabase cho đăng nhập tên tài khoản + mật khẩu, khôi phục mật khẩu (email + mã dự phòng), đồng bộ TKB nhiều thiết bị, và chat (chung / riêng 1-1 / nhóm) — vẫn là web tĩnh, giao diện giữ nguyên.

**Architecture:** Web tĩnh (không bundler) nạp `@supabase/supabase-js` từ CDN qua ESM. Supabase lo Auth (email/password, email = email khôi phục thật), Postgres + RLS cho dữ liệu, Realtime `postgres_changes` cho cập nhật trực tiếp, và một Edge Function `account` (Deno) cho các việc cần quyền admin: đăng nhập bằng tên tài khoản, gửi link khôi phục, đặt lại mật khẩu bằng mã dự phòng. `script.js` (classic) vẫn điều khiển UI và gọi các cầu nối `window.*` do các module ES đặt.

**Tech Stack:** HTML/CSS/JS thuần (ES modules), Supabase (Auth, Postgres, Realtime, Edge Functions/Deno), Node `node --test` cho hàm thuần.

**Spec:** `docs/superpowers/specs/2026-11-04-supabase-auth-sync-chat-design.md`

## Global Constraints

- Giữ web tĩnh; KHÔNG framework, KHÔNG bundler. Chỉ nạp thư viện qua CDN ESM/`<script>`.
- Phải chạy qua `http(s)`; mở bằng `file://` thì hiện lỗi và khoá nút đăng nhập.
- Miễn phí, KHÔNG cần thẻ; KHÔNG dùng SMS/điện thoại.
- Giao diện tiếng Việt. Giữ `index.html` khung/`style.css`; `core.js` chỉ được **thêm** hàm, không đổi chữ ký hàm cũ.
- Tên tài khoản: 3–20 ký tự, chỉ `a-z 0-9 . _ -`, lưu chữ thường.
- Mã dự phòng: đúng 12 ký tự `A-Z0-9` (không phân biệt hoa/thường khi nhập).
- Đăng ký bắt buộc có **email khôi phục thật**; tắt "Confirm email" trong Supabase.
- Email KHÔNG bao giờ lộ ra trình duyệt cho người khác: đăng nhập/khôi phục bằng tên tài khoản đi qua Edge Function.
- `package.json` giữ `"type": "module"`. Lệnh test: `node --test tests/*.test.js`.
- Node không có DOM/Supabase: mọi hàm thuần phải import được trong Node mà không gọi mạng.

## Review Focus

Các lớp input/tình huống spec ngụ ý nhưng test khó phủ — mỗi dòng có test/kiểm tra ở task tương ứng:

1. **Cầu nối `window.*` chưa được gán** (lỗi đang có ở bản Firebase) khiến đồng bộ TKB không chạy → ở Task 6 phải gán đủ `window.initSync`, `window.teardownSync`, `window.cloudSubjectsEmpty`, `window.migrateLocalToCloud`, và có bước kiểm tra `typeof window.initSync === 'function'`.
2. **Edge Function lỗi/mất mạng khi đăng nhập** → phải hiện thông báo lỗi rõ ràng, không treo nút (Task 5 + Task 8, mục kiểm thử thủ công).
3. **Đăng ký trùng tên tài khoản** → báo "đã tồn tại", không để tài khoản kẹt (Task 3 RPC `is_username_available` + Task 5 + Task 8).
4. **Khôi phục sai mã** → báo lỗi và **mật khẩu không đổi** (Task 4 + Task 5).
5. **`file://` hoặc thiếu cấu hình** → hiện lỗi và khoá nút (Task 2 + Task 8).

---

### Task 1: Hàm thuần cho đăng ký/đăng nhập trong `core.js`

**Files:**
- Modify: `core.js` (thêm hàm ở cuối, giữ nguyên phần cũ)
- Test: `tests/core.test.js` (thêm test)

**Interfaces:**
- Consumes: không.
- Produces:
  - `normalizeUsername(username: any) -> string`
  - `isValidUsername(username: any) -> boolean`
  - `isValidRecoveryCode(code: any) -> boolean`
  - `looksLikeEmail(value: any) -> boolean`
  - `validateSignup(input: {username: any, email: any, password: any}) -> string[]`

- [ ] **Step 1: Viết test thất bại** — thêm vào `tests/core.test.js`:

```js
import {
  normalizeUsername, isValidUsername, isValidRecoveryCode,
  looksLikeEmail, validateSignup
} from '../core.js';

test('normalizeUsername trim + thường hóa', () => {
  assert.equal(normalizeUsername('  AnB  '), 'anb');
  assert.equal(normalizeUsername(null), '');
});

test('isValidUsername 3..20, chỉ a-z0-9._-', () => {
  assert.equal(isValidUsername('an_b-99'), true);
  assert.equal(isValidUsername('ab'), false);
  assert.equal(isValidUsername('a'.repeat(21)), false);
  assert.equal(isValidUsername('An B'), false);
  assert.equal(isValidUsername('ăn'), false);
});

test('isValidRecoveryCode 12 ký tự A-Z0-9, không phân biệt hoa thường', () => {
  assert.equal(isValidRecoveryCode('ABCD2345WXYZ'), true);
  assert.equal(isValidRecoveryCode('abcd2345wxyz'), true);
  assert.equal(isValidRecoveryCode('ABC'), false);
  assert.equal(isValidRecoveryCode('ABCD-234-WXYZ'), false);
});

test('looksLikeEmail nhận diện theo dấu @', () => {
  assert.equal(looksLikeEmail('an@uni.app'), true);
  assert.equal(looksLikeEmail('anb'), false);
});

test('validateSignup trả mảng tên trường lỗi', () => {
  assert.deepEqual(validateSignup({ username: 'anb', email: 'a@b.com', password: '123456' }), []);
  assert.deepEqual(
    validateSignup({ username: 'a', email: 'x', password: '1' }).sort(),
    ['email', 'password', 'username']
  );
});
```

- [ ] **Step 2: Chạy test cho chắc là FAIL**

Run: `node --test tests/core.test.js`
Expected: FAIL — `normalizeUsername is not a function` (hoặc import lỗi).

- [ ] **Step 3: Cài đặt trong `core.js`**

Quy tắc: `normalizeUsername` = `String(v==null?'':v).trim().toLowerCase()`; `isValidUsername` = độ dài chuẩn hoá 3..20 và `/^[a-z0-9._-]+$/`; `isValidRecoveryCode` = `/^[A-Z0-9]{12}$/.test(String(v).trim().toUpperCase())`; `looksLikeEmail` = `String(v||'').indexOf('@') !== -1`; `validateSignup` trả `['username','email','password']` theo lỗi (email dùng lại regex trong `validateRegistration`).

- [ ] **Step 4: Chạy test cho PASS**

Run: `node --test tests/*.test.js`
Expected: PASS toàn bộ (16 test cũ + 5 test mới).

- [ ] **Step 5: Commit**

```bash
git add core.js tests/core.test.js
git commit -m "feat(core): add username/signup/recovery helpers"
```

---

### Task 2: Khởi tạo Supabase client + guard (`supabase-config.js`, `supabase-init.js`)

**Files:**
- Create: `supabase-config.js`
- Create: `supabase-init.js`
- Test: `tests/supabase-init.test.js`

**Interfaces:**
- Consumes: không.
- Produces:
  - `supabase-init.js` export `const SDK_CDN = 'https://esm.sh/@supabase/supabase-js@2'`
  - `supabase-init.js` export `function isConfigReady(cfg: any) -> boolean`
  - `supabase-init.js` export `let client` = `SupabaseClient | null`
  - `supabase-init.js` đặt `window.supabaseReady` (boolean) và `window.supabaseError` (`'file-protocol' | 'missing-config' | null`)
  - `supabase-config.js` (classic) đặt `window.SUPABASE_CONFIG = { url: '', anonKey: '' }` (để trống, người dùng điền sau)

- [ ] **Step 1: Viết test thất bại** — tạo `tests/supabase-init.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConfigReady } from '../supabase-init.js';

test('isConfigReady: cần url + anonKey thật', () => {
  assert.equal(isConfigReady({ url: 'https://x.supabase.co', anonKey: 'sb_publishable_abc' }), true);
  assert.equal(isConfigReady({ url: '', anonKey: 'k' }), false);
  assert.equal(isConfigReady({ url: 'u', anonKey: '' }), false);
  assert.equal(isConfigReady({ url: 'DÁN_URL', anonKey: 'k' }), false);
  assert.equal(isConfigReady(null), false);
});

test('guard: thiếu cấu hình → supabaseReady=false, supabaseError=missing-config', () => {
  assert.equal(globalThis.supabaseReady, false);
  assert.equal(globalThis.supabaseError, 'missing-config');
});
```

- [ ] **Step 2: Chạy test cho chắc là FAIL**

Run: `node --test tests/supabase-init.test.js`
Expected: FAIL — không tìm thấy module `../supabase-init.js`.

- [ ] **Step 3: Tạo `supabase-config.js`**

Classic script (không `type=module`) đặt placeholder công khai:

```js
window.SUPABASE_CONFIG = { url: '', anonKey: '' };
```

- [ ] **Step 4: Tạo `supabase-init.js`**

Mẫu giống `firebase-init.js`: đọc `globalThis.window || globalThis`. Nếu `location.protocol === 'file:'` → `supabaseError='file-protocol'`, `supabaseReady=false`. Ngược lại nếu `!isConfigReady(config)` → `'missing-config'`. Ngược lại `const mod = await import(SDK_CDN); client = mod.createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); supabaseReady = true`. `isConfigReady` trả false nếu thiếu `url`/`anonKey`, hoặc bắt đầu bằng `'DÁN'`/`'DAN_'`. KHÔNG import SDK ở top-level (Node không được gọi mạng).

- [ ] **Step 5: Chạy test cho PASS**

Run: `node --test tests/supabase-init.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase-config.js supabase-init.js tests/supabase-init.test.js
git commit -m "feat: add Supabase client bootstrap and guard"
```

---

### Task 3: `supabase/schema.sql` (bảng + RLS + realtime)

**Files:**
- Create: `supabase/schema.sql`

**Interfaces:**
- Consumes: không (dán vào Supabase SQL Editor).
- Produces (schema dùng bởi Task 4/6/7):
  - Bảng: `profiles(id uuid pk, username text unique not null, created_at timestamptz default now())`
  - Bảng: `recovery_codes(user_id uuid pk references auth.users, code_hash text not null, created_at timestamptz default now())`
  - Bảng: `subjects(owner uuid, id text, payload jsonb, updated_at timestamptz default now(), primary key(owner,id))`
  - Bảng: `rooms(id text pk, type text, name text, owner uuid null, last_message_text text, last_message_sender uuid, last_message_at timestamptz, updated_at timestamptz default now())`
  - Bảng: `room_members(room_id text references rooms, user_id uuid, primary key(room_id,user_id))`
  - Bảng: `messages(id uuid default gen_random_uuid() pk, room_id text references rooms, sender uuid, sender_name text, body text, created_at timestamptz default now())`
  - Bảng: `reads(room_id text, user_id uuid, last_read_at timestamptz, primary key(room_id,user_id))`
  - Hàm: `public.is_room_member(p_room_id text, p_uid uuid) returns boolean`
  - Hàm: `public.is_username_available(p_username text) returns boolean` (execute cho `anon`, `authenticated`) — tra `profiles` theo username đã chuẩn hoá.
  - Hàm: `public.set_my_recovery_code(p_code text) returns void` security definer (execute `authenticated`) — upsert `recovery_codes` cho `auth.uid()` với `code_hash = crypt(p_code, gen_salt('bf'))`.
  - Hàm: `public.verify_recovery_code(p_user_id uuid, p_code text) returns boolean` security definer (execute `service_role` ONLY) — so `crypt(p_code, code_hash) = code_hash`.
  - Extension `pgcrypto`.
  - RLS bật cho mọi bảng; policy theo spec §6; `recovery_codes` không có policy cho user.
  - `alter publication supabase_realtime add table rooms, room_members, messages, reads, subjects;`

- [ ] **Step 1: Viết `supabase/schema.sql`** theo đúng danh sách trên. RLS phải khớp spec: `profiles` đọc cho `authenticated`, sửa dòng của mình; `subjects` chỉ `owner = auth.uid()`; `rooms`/`messages`/`room_members` theo `is_room_member` + `type='public'`; `reads` của mình; `recovery_codes` không policy.

- [ ] **Step 2: Kiểm tra tĩnh bằng mắt + grep**

Run: `grep -c "create table" supabase/schema.sql`
Expected: `7`.
Run: `grep -c "enable row level security" supabase/schema.sql`
Expected: `7`.
Run: `grep -c "supabase_realtime add table" supabase/schema.sql`
Expected: `1`.

- [ ] **Step 3: NGƯỜI DÙNG chạy trên Supabase** — dán toàn bộ nội dung vào SQL Editor → Run.
Expected: `Success. No rows returned`. (Ghi lại bước này trong `docs/supabase-setup.md` ở Task 4.)

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(db): add Supabase schema with RLS and realtime"
```

---

### Task 4: Edge Function `account` + `docs/supabase-setup.md`

**Files:**
- Create: `supabase/functions/account/index.ts`
- Create: `docs/supabase-setup.md`

**Interfaces:**
- Consumes: schema Task 3; `profiles`, `recovery_codes`, RPC `verify_recovery_code`.
- Produces (gọi từ `auth.js` Task 5): `POST {url}/functions/v1/account` với `Authorization: Bearer <anonKey>` và body JSON:
  - `{ action: 'signin', username, password }` → `{ access_token, refresh_token }`
  - `{ action: 'reset-email', username }` → `{ ok: true }`
  - `{ action: 'recover', username, code, new_password }` → `{ ok: true }` hoặc HTTP 400 `{ error }`

- [ ] **Step 1: Viết `supabase/functions/account/index.ts`** (Deno, không khung). Xử lý:
  - CORS headers cho `POST`/`OPTIONS`.
  - Đọc env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, và anon key = `SUPABASE_ANON_KEY ?? SUPABASE_PUBLISHABLE_KEY`.
  - `adminClient = createClient(url, serviceKey)`; `anonClient = createClient(url, anonKey)`.
  - `signin`: tra `adminClient.from('profiles').select('id').eq('username', normalize).maybeSingle()` → nếu có, `adminClient.auth.admin.getUserById(id)` lấy `email`, rồi `anonClient.auth.signInWithPassword({ email, password })`; lỗi → 400 `{ error: 'Sai tên tài khoản hoặc mật khẩu.' }`; thành công → trả tokens.
  - `reset-email`: tra id/email; nếu có → `anonClient.auth.resetPasswordForEmail(email, { redirectTo })`; **luôn** trả `{ ok: true }` (chống dò).
  - `recover`: tra id; `adminClient.rpc('verify_recovery_code', { p_user_id: id, p_code: code })`; nếu `false` → 400 `{ error: 'Mã dự phòng không đúng.' }`; nếu đúng → `adminClient.auth.admin.updateUserById(id, { password: new_password })` → `{ ok: true }`.
  - `normalize` username = trim + lower.
  - Không log/không trả email ra ngoài.

- [ ] **Step 2: Viết `docs/supabase-setup.md`** với các mục, mỗi mục có link trực tiếp khi có thể:
  1. Tạo project Supabase (free, không thẻ).
  2. Copy `Project URL` + `anon/publishable key` → dán vào `supabase-config.js`.
  3. Auth → Providers → Email: tắt **Confirm email**; Auth → URL Configuration: đặt Site URL (URL deploy).
  4. Dán `supabase/schema.sql` vào SQL Editor → Run.
  5. Deploy hàm: Dashboard → Edge Functions → Create `account` → dán `supabase/functions/account/index.ts` → Deploy.
  6. (Tùy chọn) SMTP riêng (Resend free) vì email mặc định giới hạn 2 mail/giờ.
  7. Checklist kiểm thử tay (gồm Review Focus 2–5): đăng ký, đăng nhập bằng tên tài khoản, sai mật khẩu, quên mật khẩu (email), khôi phục bằng mã, mã sai, đồng bộ 2 thiết bị/tab, chat chung/riêng/nhóm, badge chưa đọc.

- [ ] **Step 3: Kiểm tra tĩnh**

Run: `grep -c "signin" supabase/functions/account/index.ts`
Expected: ≥ 1.
Run: `grep -c "reset-email" supabase/functions/account/index.ts`
Expected: ≥ 1.
Run: `grep -c "recover" supabase/functions/account/index.ts`
Expected: ≥ 1.

- [ ] **Step 4: NGƯỜI DÙNG deploy + chạy checklist** theo `docs/supabase-setup.md`.
Expected: tất cả mục checklist "đạt"; ghi lại mục nào chưa đạt.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/account/index.ts docs/supabase-setup.md
git commit -m "feat: add account edge function and Supabase setup guide"
```

---

### Task 5: Viết lại `auth.js` cho Supabase

**Files:**
- Modify: `auth.js` (thay toàn bộ nội dung)
- Test: `tests/auth.test.js` (chỉ test `authErrorMessage`)

**Interfaces:**
- Consumes: `client`, `SDK_CDN` từ `./supabase-init.js`; `normalizeUsername`, `looksLikeEmail` từ `./core.js`.
- Produces (dùng bởi `main.js` Task 8):
  - `toAppUser(su) -> { uid, id, email, displayName }` (uid = `su.id`; displayName = `su.user_metadata?.username || su.email`)
  - `async signUpAccount({username, email, password}) -> { user, recoveryCode }` — trước tiên `client.rpc('is_username_available', { p_username: normalizeUsername(username) })`; nếu `false` → ném lỗi `'Tên tài khoản đã tồn tại.'` (Review Focus 3). Sau đó `client.auth.signUp({ email, password, options: { data: { username: normalizeUsername(username) } } })`; nếu có session → gọi `regenerateRecoveryCode()`; trả user + mã.
  - `async signInAccount(identifier, password) -> { user }` — nếu `looksLikeEmail` → `signInWithPassword({email, password})`; ngược lại gọi Edge Function `account` action `signin` rồi `client.auth.setSession({ access_token, refresh_token })`.
  - `async signOutAccount()`
  - `onAuthUser(cb) -> () => void` — `client.auth.onAuthStateChange`; bỏ qua event `PASSWORD_RECOVERY` (đưa qua `onPasswordRecovery`).
  - `onPasswordRecovery(cb) -> () => void`
  - `async requestPasswordReset(identifier) -> { ok }` — gọi Edge Function `reset-email` (email hoặc username đều gửi; nếu là email, gọi `client.auth.resetPasswordForEmail`).
  - `async recoverWithCode({username, code, newPassword}) -> { ok }`
  - `async updatePassword(newPassword)` — `client.auth.updateUser({ password })`
  - `async regenerateRecoveryCode() -> string` — sinh 12 ký tự từ bảng `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` bằng `crypto.getRandomValues`, rồi `client.rpc('set_my_recovery_code', { p_code: code })`.
  - `authErrorMessage(err) -> string`

- [ ] **Step 1: Viết test thất bại** — tạo `tests/auth.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage } from '../auth.js';

test('authErrorMessage: dịch lỗi phổ biến, có mặc định', () => {
  assert.equal(authErrorMessage({ message: 'Invalid login credentials' }), 'Sai tên tài khoản hoặc mật khẩu.');
  assert.equal(authErrorMessage({ message: 'User already registered' }), 'Email này đã được đăng ký.');
  assert.equal(authErrorMessage(null), 'Đã xảy ra lỗi. Vui lòng thử lại.');
});
```

- [ ] **Step 2: Chạy test cho chắc là FAIL**

Run: `node --test tests/auth.test.js`
Expected: FAIL — `authErrorMessage` chưa đúng/không tồn tại.

- [ ] **Step 3: Viết lại `auth.js`** theo Interfaces. `authErrorMessage` so khớp `err.message` (dạng Supabase) và trả câu tiếng Việt tương ứng; mặc định `'Đã xảy ra lỗi: ' + (err.message || 'không rõ')`. Không import SDK ở top-level; dùng `client` từ `./supabase-init.js`.

- [ ] **Step 4: Chạy test cho PASS**

Run: `node --test tests/auth.test.js`
Expected: PASS. (Test chỉ chạm `authErrorMessage`; không gọi mạng.)

- [ ] **Step 5: Commit**

```bash
git add auth.js tests/auth.test.js
git commit -m "feat(auth): rewrite auth.js for Supabase"
```

---

### Task 6: Viết lại `cloud-sync.js` (subjects) + sửa cầu nối `window.*`

**Files:**
- Modify: `cloud-sync.js` (thay toàn bộ nội dung)

**Interfaces:**
- Consumes: `client` từ `./supabase-init.js`; `cacheKeyFor`, `shouldOfferUpload`, `legacyCacheAllowed` từ `./core.js`; RPC/table `subjects`.
- Produces (giữ tên cũ + BỔ SUNG cầu nối còn thiếu):
  - **Ở cấp module (chạy ngay khi file được nạp, KHÔNG đợi tới `initSync`) phải gán:** `window.initSync = initSync`, `window.teardownSync = teardownSync`, `window.cloudSubjectsEmpty = cloudSubjectsEmpty`, `window.migrateLocalToCloud = migrateLocalToCloud`, `window.cloudSaveSubject`, `window.cloudDeleteSubject`, `window.cloudClearAllSubjects`. (Sửa lỗi hiện có: `script.js` gọi `window.initSync` ngay trong `setupCloudSync` nên nếu gán bên trong `initSync` sẽ bị "gà–trứng".)
  - `async initSync(user)` — đặt `localStorage.UNI_LAST_UID`; đăng ký realtime `subjects` filter `owner=eq.<uid>`; khi có thay đổi → `select` lại rồi gọi `window.applyCloudSubjects(list)`.
  - `teardownSync()`
  - `async ensureUserProfile(user)` — upsert `profiles { id: user.uid, username: <metadata username hoặc email> }`.
  - `async cloudSubjectsEmpty(user) -> boolean`
  - `async migrateLocalToCloud(user, list) -> void`
  - Mọi thao tác ghi dùng `upsert`/`delete` trên `subjects` với `{ owner: uid, id, payload }` (payload = môn học bỏ `id`).
  - Ánh xạ đọc: `Object.assign({ id: row.id }, row.payload)`.

- [ ] **Step 1: Viết lại `cloud-sync.js`** theo Interfaces. Realtime: `client.channel('subjects').on('postgres_changes', { event: '*', schema: 'public', table: 'subjects', filter: 'owner=eq.' + uid }, refetch).subscribe()`; `teardownSync` gọi `client.removeChannel(channel)`. Ghi/xoá lỗi → `console.warn` (script.js đã có toast riêng; không throw để không chặn UI).

- [ ] **Step 2: Kiểm tra tĩnh cầu nối đã được gán**

Run: `grep -c "window.initSync" cloud-sync.js`
Expected: `1`.
Run: `grep -c "window.teardownSync" cloud-sync.js`
Expected: `1`.
Run: `grep -c "window.cloudSubjectsEmpty" cloud-sync.js`
Expected: `1`.
Run: `grep -c "window.migrateLocalToCloud" cloud-sync.js`
Expected: `1`.

- [ ] **Step 3: Kiểm tra cú pháp**

Run: `node --check cloud-sync.js`
Expected: không in gì (cú pháp hợp lệ).

- [ ] **Step 4: NGƯỜI DÙNG kiểm thử đồng bộ** — đăng nhập trên 2 tab; thêm môn ở tab A; tab B tự hiện. Kiểm thử theo `docs/supabase-setup.md`.
Expected: tab B cập nhật không cần tải lại.

- [ ] **Step 5: Commit**

```bash
git add cloud-sync.js
git commit -m "feat(sync): rewrite cloud-sync for Supabase and expose window bridges"
```

---

### Task 7: Viết lại `chat.js` (rooms / messages / reads / directory)

**Files:**
- Modify: `chat.js` (thay toàn bộ nội dung, giữ bố cục DOM và tên hàm export)

**Interfaces:**
- Consumes: `client` từ `./supabase-init.js`; `core.js` (`isPublicRoomId`, `unreadCount`, `roomLabel`, `directRoomId`, `filterDirectory`, `sortMessagesAsc`); bảng `profiles`, `rooms`, `room_members`, `messages`, `reads`; `window.escapeHtml/openModal/closeModal/showToast` từ `script.js`.
- Produces (giữ nguyên chữ ký cũ để `main.js` không phải đổi):
  - `subscribeRoomList(cb)`, `subscribeMessages(roomId, cb)`, `openRoom(roomId)`
  - `async sendMessage(roomId, text)`, `async markRoomRead(roomId)`
  - `async listDirectory(cb)`
  - `async openDirect(otherUid)`
  - `async createGroup(name, memberUids)`, `async renameGroup(roomId, name)`, `async addGroupMembers(roomId, uids)`, `async removeGroupMember(roomId, uid)`, `async leaveGroup(roomId)`
  - `async ensurePublicRoom()`, `async initChat(user)`, `teardownChat()`

Ánh xạ dữ liệu (khớp những gì `renderRoomList`/`renderMessages` mong đợi):
- Room: `{ id, type, name, ownerId: owner, members: [uids], lastMessage: last_message_at ? { text, senderId: last_message_sender, senderName: <tra directoryMap>, createdAt: last_message_at } : null }`.
- Message: `{ id, senderId: sender, senderName, text: body, createdAt: created_at }`.
- Directory: `{ uid: id, displayName: username }` (KHÔNG có email).

- [ ] **Step 1: Viết lại `chat.js`** theo Interfaces:
  - `subscribeRoomList`: `select` phòng `public` + phòng của mình qua `room_members.select('rooms(*)').eq('user_id', uid)`; subscribe `rooms` (RLS) và `room_members` filter `user_id=eq.<uid>` → refetch.
  - `subscribeMessages`: `select messages where room_id = roomId order created_at desc limit 50` + channel filter `room_id=eq.<roomId>`; trả về `sortMessagesAsc`.
  - `sendMessage`: `insert` messages `{room_id, sender: uid, sender_name, body}` rồi `update rooms` set `last_message_text/sender/at, updated_at`.
  - `markRoomRead`: `upsert reads { room_id, user_id, last_read_at: now() }`.
  - Số chưa đọc: mỗi phòng (trừ phòng đang mở) `select count` messages `created_at > lastReadAt`; tính lại khi room list đổi hoặc có tin mới; dùng `unreadCount`/`readMap`.
  - `openDirect`: nếu chưa có phòng `directRoomId(uid, other)` → insert `rooms` + 2 dòng `room_members`.
  - `createGroup`: insert `rooms` (type `group`, owner, name) + `room_members` cho tất cả uid.
  - `renameGroup`/`addGroupMembers`/`removeGroupMember`: cập nhật `rooms`/`room_members` (add: upsert; remove: delete).
  - `ensurePublicRoom`: upsert `rooms` id `public` type `public` nếu chưa có.
  - `initChat`: giữ nguyên guard chống trùng listener như bản cũ; gọi `wireChatUi`/`wireGroupUi`; subscribe room list/reads/directory; `openRoom('public')`.

- [ ] **Step 2: Kiểm tra cú pháp**

Run: `node --check chat.js`
Expected: không in gì.

- [ ] **Step 3: Kiểm tra tên hàm export còn nguyên**

Run: `grep -c "export" chat.js`
Expected: ≥ 12.
Run: `grep -n "initChat\|teardownChat\|listDirectory\|openDirect\|createGroup" chat.js`
Expected: có đủ các tên.

- [ ] **Step 4: NGƯỜI DÙNG kiểm thử chat** theo checklist `docs/supabase-setup.md` (chung, riêng, nhóm, badge chưa đọc).
Expected: đạt các mục chat.

- [ ] **Step 5: Commit**

```bash
git add chat.js
git commit -m "feat(chat): rewrite chat.js for Supabase"
```

---

### Task 8: Giao diện đăng nhập mới (`index.html`) + nối `main.js`

**Files:**
- Modify: `index.html` (khu `#authScreen`; đổi script tags)
- Modify: `main.js` (thay toàn bộ nội dung)

**Interfaces:**
- Consumes: `auth.js` (Task 5), `cloud-sync.js` (`ensureUserProfile`, Task 6), `chat.js` (`initChat`, `teardownChat`, Task 7), `core.js` (`validateSignup`, `looksLikeEmail`).
- Produces: app chạy được: đăng ký/đăng nhập/đăng xuất/khôi phục/đặt lại mật khẩu + mở app + chat + đồng bộ.

Thay đổi `index.html` trong `#authScreen`:
- Ô nhập khi đăng nhập: **`#authIdentifier`** (nhãn "Tên tài khoản hoặc email").
- Khối đăng ký (`#authRegisterFields`): **`#authUsername`** (Tên tài khoản), **`#authEmail`** (Email khôi phục, `type=email`), `#authPassword`.
- Bỏ nút Google + dải "hoặc" (`#authGoogle`, `.auth-divider`).
- Thêm link **`#forgotLink`** ("Quên mật khẩu?") và bảng **`#forgotPanel`** (ẩn) gồm: `#forgotUsername`, `#forgotSendEmail`, `#forgotCode`, `#forgotNewPassword`, `#forgotSubmit`, `#forgotBack`, `#forgotMsg`.
- Thêm màn **`#resetScreen`** (ẩn) cho luồng link email: `#resetNewPassword`, `#resetSubmit`, `#resetMsg`.
- Thêm modal **`#recoveryCodeModal`** (ẩn): `#recoveryCodeText`, `#recoveryCodeCopy`, `#recoveryCodeDone`.
- Ở cuối `<body>`: thay `firebase-config.js` → `supabase-config.js`; thay các `<script type="module" src="firebase-init.js|cloud-sync.js|chat.js|main.js">` → `supabase-init.js|cloud-sync.js|chat.js|main.js`. Đổi thông điệp `file://` trong script classic từ `docs/firebase-setup.md` → `docs/supabase-setup.md`.

- [ ] **Step 1: Sửa `index.html`** đúng các ID/markup nêu trên. Giữ nguyên phần `<main>`, modal chat, icon.

- [ ] **Step 2: Viết lại `main.js`**:
  - Import từ `auth.js`: `onAuthUser, onPasswordRecovery, signUpAccount, signInAccount, signOutAccount, requestPasswordReset, recoverWithCode, updatePassword, authErrorMessage`.
  - Import `validateSignup, looksLikeEmail` từ `./core.js`; `initChat, teardownChat` từ `./chat.js`; `ensureUserProfile` từ `./cloud-sync.js`.
  - `setMode('login'|'register')`: ẩn/hiện `#authUsername` và `#authEmail` theo mode (đăng nhập dùng `#authIdentifier`; đăng ký dùng `#authUsername`+`#authEmail`).
  - Submit đăng ký: `validateSignup` → lỗi hiển thị tiếng Việt; gọi `signUpAccount`; nếu `recoveryCode` → hiện `#recoveryCodeModal` (copy = `navigator.clipboard.writeText`).
  - Submit đăng nhập: gọi `signInAccount(identifier, password)`; lỗi → `authErrorMessage`.
  - `showError` dùng `#authError`/`#forgotMsg`/`#resetMsg` tuỳ luồng.
  - Quên mật khẩu: `#forgotSendEmail` → `requestPasswordReset(#forgotUsername)` → luôn báo "đã gửi"; `#forgotSubmit` → `recoverWithCode` → thành công báo "đã đặt lại, hãy đăng nhập".
  - `onPasswordRecovery` → hiện `#resetScreen`; `#resetSubmit` → `updatePassword` → ẩn, báo thành công.
  - `applyUser(user)`: `showAuthScreen(false)`, set `#userName = user.displayName`, ẩn avatar (`photoURL` null), `window.startUniSchedule(user)`, `initChat(user)`, `ensureUserProfile(user)`; khi `null` → teardown.
  - `start()`: kiểm `window.supabaseReady`; nếu không → hiện lỗi dựa `window.supabaseError` (`file-protocol`/`missing-config`) và khoá `#authSubmit`; ngược lại `initAuthUI()` + `onAuthUser(applyUser)`.
  - Bỏ hết Google/redirect/Firebase.

- [ ] **Step 3: Kiểm tra cú pháp**

Run: `node --check main.js`
Expected: không in gì.

- [ ] **Step 4: Kiểm tra không còn tham chiếu Firebase trong mã chạy**

Run: `grep -n "firebase\|FIREBASE\|Google" main.js auth.js cloud-sync.js chat.js index.html`
Expected: không còn (trừ `docs/`).

- [ ] **Step 5: NGƯỜI DÙNG kiểm thử luồng auth** theo checklist (gồm Review Focus 2–5).
Expected: đăng ký → hiện mã dự phòng; đăng nhập bằng tên tài khoản; đăng xuất; quên mật khẩu email; khôi phục bằng mã; mã sai báo lỗi.

- [ ] **Step 6: Commit**

```bash
git add index.html main.js
git commit -m "feat(ui): username auth UI and Supabase wiring"
```

---

### Task 9: Dọn Firebase, cập nhật deploy docs, chạy toàn bộ test

**Files:**
- Delete: `firebase-config.js`, `firebase-init.js`, `firestore.rules`, `firebase.json`, `.firebaserc`
- Create/Modify: `docs/deploy.md`
- Modify: `docs/supabase-setup.md` (bổ sung mục deploy web tĩnh + nhắc `supabase-config.js`)
- Modify: `.gitignore` (nếu còn mục Firebase)

**Interfaces:**
- Consumes: toàn bộ Task 1–8.
- Produces: repo sạch Firebase; hướng dẫn deploy.

- [ ] **Step 1: Xoá file Firebase**

Run: `git rm firebase-config.js firebase-init.js firestore.rules firebase.json .firebaserc`
Expected: 5 file bị xoá khỏi index.

- [ ] **Step 2: Kiểm tra không còn tham chiếu**

Run: `grep -rn "firebase" --include=*.js --include=*.html .`
Expected: không kết quả (ngoài `docs/`).

- [ ] **Step 3: Viết `docs/deploy.md`** — hướng dẫn deploy web tĩnh (Cloudflare Pages hoặc GitHub Pages), nhấn mạnh phải chạy qua `https` và điền `supabase-config.js` + đặt Site URL trong Supabase khớp URL deploy.

- [ ] **Step 4: Chạy toàn bộ test**

Run: `node --test tests/*.test.js`
Expected: PASS toàn bộ (test cũ + Task 1 + Task 2 + Task 5).

- [ ] **Step 5: Kiểm tra cú pháp toàn bộ module**

Run: `node --check auth.js && node --check cloud-sync.js && node --check chat.js && node --check main.js && node --check supabase-init.js`
Expected: không in gì.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove Firebase, add deploy docs, full test pass"
```

---

## Manual end-to-end checklist (NGƯỜI DÙNG, sau Task 9)

Chạy web trên `https` (hoặc `http://localhost`), lần lượt:

- [ ] Đăng ký tài khoản mới → hiện mã dự phòng 12 ký tự (copy được) → vào app.
- [ ] Đăng xuất → đăng nhập lại bằng **tên tài khoản** + mật khẩu.
- [ ] Đăng nhập sai mật khẩu → báo "Sai tên tài khoản hoặc mật khẩu."; sai tên tài khoản → cùng thông báo.
- [ ] Đăng ký trùng tên tài khoản → báo "đã tồn tại".
- [ ] Quên mật khẩu (email) → nhận link → đặt mật khẩu mới → đăng nhập bằng mật khẩu mới.
- [ ] Quên mật khẩu (mã) → nhập đúng mã → đặt lại; nhập sai mã → báo lỗi và mật khẩu cũ vẫn dùng được.
- [ ] Thêm môn ở tab A → tab B (khác tab/thiết bị) tự cập nhật.
- [ ] Chat phòng chung; chat riêng 1-1; tạo nhóm, thêm/xoá thành viên, đổi tên (chủ nhóm).
- [ ] Badge số chưa đọc tăng khi có tin mới ở phòng khác; mở phòng → badge mất.
- [ ] Mở bằng `file://` → hiện lỗi và nút đăng nhập bị khoá.
