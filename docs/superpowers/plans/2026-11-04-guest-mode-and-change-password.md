# Chế độ khách + Đổi mật khẩu bằng mk cũ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép dùng app không cần tài khoản (lưu local, có thể nâng cấp lên tài khoản) và cho người dùng đổi mật khẩu bằng cách xác minh mật khẩu cũ.

**Architecture:** Tái dùng hạ tầng cache localStorage theo uid sẵn có (`cacheKeyFor`, `migrateLocalToCloud`). Khách dùng uid cố định `'guest'`, bỏ qua đồng bộ cloud và chat. Nâng cấp = đăng ký mới rồi migrate dữ liệu local của khách lên tài khoản. Đổi mật khẩu = đăng nhập lại để xác minh mật khẩu cũ rồi `updateUser`.

**Tech Stack:** Vanilla JS (ES modules + `script.js` classic), Supabase JS v2, Node test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-04-guest-mode-and-change-password-design.md`

## Global Constraints

- Nền tĩnh; không thêm framework/bundler/thư viện mới.
- Giao diện tiếng Việt.
- Bộ test bắt buộc: `node --test tests/*.test.js` (Node 22) — không được làm hỏng 30 test hiện có.
- Không hỗ trợ offline: giữ nguyên hành vi chặn khi `window.supabaseReady` false.
- Mã dự phòng/mật khẩu: mật khẩu tối thiểu 6 ký tự.
- uid khách = `'guest'`; cờ phiên `UNI_GUEST='1'`; cache khách ở `cacheKeyFor('guest')`.
- Nâng cấp chỉ qua đường đăng ký; trùng email → báo "Email này đã được đăng ký." và KHÔNG migrate.
- Migrate lỗi → giữ cache khách + toast, không mất dữ liệu.

## Review Focus

- Khách và tài khoản thật trên cùng máy không đọc được dữ liệu của nhau (khóa cache tách biệt).
- Mật khẩu cũ sai thì mật khẩu KHÔNG đổi.
- Nâng cấp khi email đã tồn tại: không tạo tài khoản, không migrate, dữ liệu khách còn nguyên.
- Tải lại trang khi đang ở chế độ khách vẫn là khách (không bị đá ra màn đăng nhập).
- Migrate thất bại: cache khách còn nguyên, có cảnh báo.

---

### Task 1: Helper thuần trong `core.js`

**Files:**
- Modify: `core.js`
- Test: `tests/core.test.js`

**Interfaces:**
- Produces:
  - `export const GUEST_UID = 'guest'`
  - `export function isGuestUid(uid: string) => boolean`
  - `export function shouldMigrateGuest(options: { upgradeMode: boolean, hasGuestData: boolean }) => boolean`

- [ ] **Step 1: Write the failing test**

Thêm vào `tests/core.test.js` (import thêm `GUEST_UID, isGuestUid, shouldMigrateGuest` trong câu `import {...} from '../core.js'`):

```js
test('isGuestUid nhận đúng uid khách', () => {
  assert.equal(GUEST_UID, 'guest');
  assert.equal(isGuestUid('guest'), true);
  assert.equal(isGuestUid('0f8e-uid-that'), false);
  // Cache khách tách biệt cache tài khoản thật.
  assert.equal(cacheKeyFor(GUEST_UID), 'uni_schedule_cache_v1__guest');
});

test('shouldMigrateGuest chỉ khi đang nâng cấp và có dữ liệu khách', () => {
  assert.equal(shouldMigrateGuest({ upgradeMode: true, hasGuestData: true }), true);
  assert.equal(shouldMigrateGuest({ upgradeMode: true, hasGuestData: false }), false);
  assert.equal(shouldMigrateGuest({ upgradeMode: false, hasGuestData: true }), false);
  assert.equal(shouldMigrateGuest({}), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.js`
Expected: FAIL — `isGuestUid is not a function` / import lỗi.

- [ ] **Step 3: Implement in `core.js`**

Thêm hằng và hai hàm thuần (đặt cạnh `cacheKeyFor`):

```js
// uid cố định cho chế độ khách (dữ liệu chỉ lưu trên máy).
export const GUEST_UID = 'guest';

export function isGuestUid(uid) {
    return uid === GUEST_UID;
}

// Chỉ migrate dữ liệu khách lên tài khoản khi đang trong luồng nâng cấp và có dữ liệu.
export function shouldMigrateGuest(options) {
    var o = options || {};
    return !!o.upgradeMode && !!o.hasGuestData;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/core.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core.js tests/core.test.js
git commit -m "feat(core): thêm helper chế độ khách"
```

---

### Task 2: `changePassword` trong `auth.js`

**Files:**
- Modify: `auth.js`
- Test: `tests/auth.test.js`

**Interfaces:**
- Produces: `export async function changePassword(email: string, oldPassword: string, newPassword: string, supabaseClient?) => Promise<void>`
  - Xác minh bằng `supabaseClient.auth.signInWithPassword({ email, password: oldPassword })`.
  - Sai → ném `Error('Mật khẩu cũ không đúng.')` có `{ known: true }`.
  - Thiếu `email` → ném `Error('Không xác định được email tài khoản.')` có `{ known: true }`.
  - Sau đó `supabaseClient.auth.updateUser({ password: newPassword })`; lỗi → ném nguyên lỗi.
  - Tham số `supabaseClient` tùy chọn để test; mặc định dùng `requireClient()`.
- Consumes: `requireClient()` (đã có trong `auth.js`).

- [ ] **Step 1: Write the failing test**

Thêm vào `tests/auth.test.js`:

```js
import { changePassword } from '../auth.js';

function fakeClient(pwOk) {
  return {
    auth: {
      signInWithPassword: async ({ password }) =>
        pwOk === password ? { error: null } : { error: { message: 'Invalid login credentials' } },
      updateUser: async () => ({ error: null })
    }
  };
}

test('changePassword: đổi được khi mk cũ đúng', async () => {
  await assert.doesNotReject(() => changePassword('a@b.com', 'old123', 'new123456', fakeClient('old123')));
});

test('changePassword: mk cũ sai thì báo lỗi known và KHÔNG đổi', async () => {
  await assert.rejects(
    () => changePassword('a@b.com', 'sai', 'new123456', fakeClient('old123')),
    (e) => e.known === true && /Mật khẩu cũ không đúng/.test(e.message)
  );
});

test('changePassword: thiếu email thì báo lỗi', async () => {
  await assert.rejects(
    () => changePassword('', 'old123', 'new123456', fakeClient('old123')),
    /email tài khoản/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/auth.test.js`
Expected: FAIL — `changePassword is not a function`.

- [ ] **Step 3: Implement `changePassword` in `auth.js`**

Thêm hàm export (gần `updatePassword`):

```js
// Đổi mật khẩu: xác minh mật khẩu cũ bằng cách đăng nhập lại rồi cập nhật.
export async function changePassword(email, oldPassword, newPassword, supabaseClient) {
    const c = supabaseClient || requireClient();
    if (!email) {
        throw Object.assign(new Error('Không xác định được email tài khoản.'), { known: true });
    }
    const { error: signErr } = await c.auth.signInWithPassword({
        email: String(email),
        password: String(oldPassword || '')
    });
    if (signErr) {
        throw Object.assign(new Error('Mật khẩu cũ không đúng.'), { known: true });
    }
    const { error } = await c.auth.updateUser({ password: String(newPassword || '') });
    if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth.js tests/auth.test.js
git commit -m "feat(auth): đổi mật khẩu có xác minh mk cũ"
```

---

### Task 3: Cầu nối refetch + chặn sync cho khách trong `script.js`

**Files:**
- Modify: `cloud-sync.js`, `script.js`

**Interfaces:**
- Produces: `window.refreshCloudSubjects()` — đọc lại danh sách môn từ cloud cho uid hiện tại (gọi `refetch` trong `cloud-sync.js`).
- Consumes: `user.guest` được `main.js` đặt (Task 6).

- [ ] **Step 1: Expose bridge trong `cloud-sync.js`**

Cạnh các dòng `window.initSync = initSync;` v.v., thêm:

```js
window.refreshCloudSubjects = function () {
    refetch().catch(function (e) { console.warn('refreshCloudSubjects:', e); });
};
```

- [ ] **Step 2: Guard trong `script.js` `startUniSchedule`**

Sửa dòng `if (currentUid) setupCloudSync(user);` thành:

```js
    if (currentUid && !(user && user.guest)) setupCloudSync(user);
```

(Chỉ khách mới bỏ qua sync; tài khoản thật giữ nguyên.)

- [ ] **Step 3: Verify thủ công (không có test đơn vị cho cầu nối DOM)**

Run: `node --test tests/*.test.js`
Expected: PASS 30 test (không hồi quy). Kiểm tra bằng mắt: `grep -n "refreshCloudSubjects" cloud-sync.js`.

- [ ] **Step 4: Commit**

```bash
git add cloud-sync.js script.js
git commit -m "feat(sync): cầu nối refetch + bỏ sync cho khách"
```

---

### Task 4: Markup trong `index.html`

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces các id mới: `guestBtn`, `upgradeBtn`, `changePasswordBtn`, `changePasswordModal`, `cpOld`, `cpNew`, `cpMsg`, `cpSubmit`, `cpClose`.

- [ ] **Step 1: Thêm nút khách ở màn đăng nhập**

Ngay sau `<button type="button" id="forgotLink" class="auth-link">Quên mật khẩu?</button>` (dòng ~123), thêm:

```html
            <button type="button" id="guestBtn" class="auth-link">Dùng tiếp không cần tài khoản</button>
```

- [ ] **Step 2: Thêm nút trong cụm menu tài khoản**

Trong `<div id="userMenu" ...>`, trước `recoveryBtn`, thêm:

```html
                <button id="upgradeBtn" class="btn btn-glass btn-sm hidden" title="Nâng cấp tài khoản">Nâng cấp</button>
                <button id="changePasswordBtn" class="btn btn-glass btn-sm" title="Đổi mật khẩu">
                    <svg class="ico"><use href="#i-key"/></svg>
                </button>
```

- [ ] **Step 3: Thêm modal đổi mật khẩu**

Ngay sau khối `#recoveryCodeModal` (kết thúc dòng ~616), thêm:

```html
    <!-- ============ MODAL: Đổi mật khẩu ============ -->
    <div id="changePasswordModal" class="modal-backdrop hidden">
        <div class="modal">
            <div class="modal-head">
                <h3>Đổi mật khẩu</h3>
                <button class="modal-close" id="cpClose"><svg class="ico"><use href="#i-x"/></svg></button>
            </div>
            <div class="modal-body">
                <div>
                    <label class="label" for="cpOld">Mật khẩu cũ</label>
                    <input type="password" id="cpOld" class="input" autocomplete="current-password">
                </div>
                <div>
                    <label class="label" for="cpNew">Mật khẩu mới</label>
                    <input type="password" id="cpNew" class="input" placeholder="Ít nhất 6 ký tự" autocomplete="new-password">
                </div>
                <p id="cpMsg" class="auth-error hidden"></p>
                <div class="row">
                    <button type="button" id="cpSubmit" class="btn btn-primary btn-sm">Đổi mật khẩu</button>
                </div>
            </div>
        </div>
    </div>
```

- [ ] **Step 4: Verify**

Mở `http://localhost:3000`, mở DevTools Console, chạy:
`['guestBtn','upgradeBtn','changePasswordBtn','changePasswordModal','cpOld','cpNew','cpMsg','cpSubmit','cpClose'].forEach(id => console.log(id, !!document.getElementById(id)))`
Expected: tất cả `true`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(ui): nút khách, nút nâng cấp, modal đổi mật khẩu"
```

---

### Task 5: Chế độ khách trong `main.js`

**Files:**
- Modify: `main.js`

**Interfaces:**
- Consumes: `GUEST_UID`, `isGuestUid` (Task 1); `window.startUniSchedule`/`stopUniSchedule`; `initChat`/`teardownChat`.
- Produces: biến `guestActive`; hàm `enterGuestUI()`, `exitGuest()`, `setHeaderMode(isGuest)`, `setChatVisible(visible)`; `applyUser` xử lý nhánh khách.

- [ ] **Step 1: Import helper + khai báo state**

Thêm vào khối import từ `./core.js`: `GUEST_UID, isGuestUid`. Ở đầu file (cạnh `let passwordRecovery = false;`) thêm:

```js
let guestActive = false;
const GUEST_KEY = 'UNI_GUEST';
```

- [ ] **Step 2: Thêm các hàm UI khách**

Thêm sau `setMode`:

```js
function setChatVisible(visible) {
    $('btnTabChat').classList.toggle('hidden', !visible);
    if (!visible) {
        $('chatTab').classList.add('hidden');
        if (typeof window.switchTab === 'function') window.switchTab('todayTab');
    }
}

function setHeaderMode(isGuest) {
    $('upgradeBtn').classList.toggle('hidden', !isGuest);
    $('recoveryBtn').classList.toggle('hidden', isGuest);
    $('changePasswordBtn').classList.toggle('hidden', isGuest);
}

function guestUser() {
    return { uid: GUEST_UID, id: GUEST_UID, guest: true, displayName: 'Khách', email: null };
}

function enterGuestUI() {
    showAuthScreen(false);
    showResetScreen(false);
    showForgotPanel(false);
    $('userMenu').classList.remove('hidden');
    $('userName').textContent = 'Khách';
    $('userAvatar').style.display = 'none';
    setHeaderMode(true);
    setChatVisible(false);
    teardownChat();
    if (typeof window.startUniSchedule === 'function') window.startUniSchedule(guestUser());
}

function exitGuest() {
    guestActive = false;
    try { localStorage.removeItem(GUEST_KEY); } catch (e) { /* bỏ qua */ }
    if (typeof window.stopUniSchedule === 'function') window.stopUniSchedule();
    setChatVisible(true);
    setHeaderMode(false);
    $('userMenu').classList.add('hidden');
    showAuthScreen(true);
    setMode('login');
}
```

- [ ] **Step 3: Cập nhật `applyUser`**

Thay `if (user) { ... } else { ... }` để: khi không có user mà `guestActive` → `enterGuestUI()`; khi có user thật → xóa cờ khách, `setHeaderMode(false)`, `setChatVisible(true)`:

- Trong nhánh `if (user)`, thêm đầu nhánh:
```js
        guestActive = false;
        try { localStorage.removeItem(GUEST_KEY); } catch (e) { /* bỏ qua */ }
        setHeaderMode(false);
        setChatVisible(true);
```
- Đổi `} else {` thành `} else if (guestActive) { enterGuestUI(); } else {` (nhánh `else` cũ giữ nguyên).

- [ ] **Step 4: Wire nút khách + khôi phục trạng thái khi tải lại**

Trong `initAuthUI()`, thêm:

```js
    $('guestBtn').addEventListener('click', function () {
        guestActive = true;
        try { localStorage.setItem(GUEST_KEY, '1'); } catch (e) { /* bỏ qua */ }
        enterGuestUI();
    });
```

Trong `start()`, trước `onAuthUser(applyUser);` thêm:

```js
    try { guestActive = localStorage.getItem(GUEST_KEY) === '1'; } catch (e) { /* bỏ qua */ }
```

(Đặt sau `initAuthUI()`; `onAuthUser` sẽ gọi `applyUser(null)` → nhánh khách giữ nguyên.)

- [ ] **Step 5: Verify thủ công**

Run: `node --test tests/*.test.js` → PASS 30.
Trình duyệt: bấm "Dùng tiếp không cần tài khoản" → app hiện, tab Trò Chuyện biến mất, header hiện "Nâng cấp". Tải lại (F5) → vẫn ở chế độ khách. Thêm 1 môn → tải lại → còn môn.

- [ ] **Step 6: Commit**

```bash
git add main.js
git commit -m "feat(guest): vào/ra chế độ khách, ẩn chat"
```

---

### Task 6: Nâng cấp khách → tài khoản trong `main.js`

**Files:**
- Modify: `main.js`

**Interfaces:**
- Consumes: `shouldMigrateGuest`, `cacheKeyFor` (Task 1); `migrateLocalToCloud`, `cloudSubjectsEmpty`, `window.refreshCloudSubjects` (Task 3); `signUpAccount`.
- Produces: biến `upgradeMode`; hàm `guestLocalList()`, `finishUpgrade(user)`.

- [ ] **Step 1: Import + state**

Thêm `shouldMigrateGuest, cacheKeyFor` vào import từ `./core.js`. Dùng cầu nối
`window.migrateLocalToCloud` và `window.refreshCloudSubjects` (đã có sẵn trong
`cloud-sync.js`, Task 3). Ở đầu file thêm:

```js
let upgradeMode = false;
```

- [ ] **Step 2: Đọc dữ liệu local của khách**

Thêm hàm:

```js
function guestLocalList() {
    try {
        const raw = localStorage.getItem(cacheKeyFor(GUEST_UID));
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}
```

- [ ] **Step 3: Wire nút nâng cấp**

Trong `initAuthUI()`, thêm:

```js
    $('upgradeBtn').addEventListener('click', function () {
        upgradeMode = true;
        $('userMenu').classList.add('hidden');
        setMode('register');
        showAuthScreen(true);
    });
```

Đồng thời, trong handler sẵn có `$('authTabLogin').addEventListener(...)`, thêm dòng
`upgradeMode = false;` để chuyển sang đăng nhập thì huỷ ý định nâng cấp.

- [ ] **Step 4: Migrate sau khi đăng ký**

Trong handler `$('authForm').addEventListener('submit', ...)`, ở nhánh `mode === 'register'`, ngay sau khi `signUpAccount(...)` trả về `res` thành công (trước khi mở modal mã dự phòng), thêm:

```js
                const guestList = guestLocalList();
                if (shouldMigrateGuest({ upgradeMode: upgradeMode, hasGuestData: guestList.length > 0 })) {
                    try {
                        await window.migrateLocalToCloud(res.user, guestList);
                        if (typeof window.refreshCloudSubjects === 'function') window.refreshCloudSubjects();
                    } catch (e) {
                        if (typeof window.showToast === 'function') {
                            window.showToast('Không tải được dữ liệu khách lên tài khoản. Dữ liệu vẫn còn trên máy.', 'error');
                        }
                    }
                }
                upgradeMode = false;
```

- [ ] **Step 5: Verify**

Run: `node --test tests/*.test.js` → PASS 30.
Trình duyệt: là khách, thêm 2 môn → bấm Nâng cấp → đăng ký (email mới) → vào app, thấy 2 môn đã có (kiểm tra cả trên tài khoản ở tab khác). Thử lại với email đã tồn tại → báo "Email này đã được đăng ký.", dữ liệu khách vẫn còn (quay lại khách thấy môn cũ).

- [ ] **Step 6: Commit**

```bash
git add main.js
git commit -m "feat(guest): nâng cấp khách lên tài khoản (migrate)"
```

---

### Task 7: Nối modal đổi mật khẩu trong `main.js`

**Files:**
- Modify: `main.js`

**Interfaces:**
- Consumes: `changePassword` (Task 2); user hiện tại (email trong phiên).
- Produces: handler cho `changePasswordBtn`, `cpSubmit`, `cpClose`.

- [ ] **Step 1: Import `changePassword`**

Thêm `changePassword` vào import từ `./auth.js`.

- [ ] **Step 2: Wire modal**

Trong `initAuthUI()`, thêm:

```js
    $('changePasswordBtn').addEventListener('click', function () {
        clearMsg('cpMsg');
        $('cpOld').value = '';
        $('cpNew').value = '';
        if (typeof window.openModal === 'function') window.openModal('changePasswordModal');
    });

    $('cpClose').addEventListener('click', function () {
        if (typeof window.closeModal === 'function') window.closeModal('changePasswordModal');
    });

    $('cpSubmit').addEventListener('click', async function () {
        clearMsg('cpMsg');
        const email = currentAppUser && currentAppUser.email ? currentAppUser.email : null;
        const oldPw = $('cpOld').value;
        const newPw = $('cpNew').value;
        if (!oldPw) { showMsg('cpMsg', 'Vui lòng nhập mật khẩu cũ.'); return; }
        if (newPw.length < 6) { showMsg('cpMsg', 'Mật khẩu mới cần ít nhất 6 ký tự.'); return; }
        try {
            await changePassword(email, oldPw, newPw);
            $('cpOld').value = '';
            $('cpNew').value = '';
            if (typeof window.closeModal === 'function') window.closeModal('changePasswordModal');
            if (typeof window.showToast === 'function') window.showToast('Đã đổi mật khẩu', 'info');
        } catch (err) {
            showMsg('cpMsg', authErrorMessage(err));
        }
    });
```

- [ ] **Step 3: Lưu user hiện tại**

Ở đầu file thêm `let currentAppUser = null;`. Trong `applyUser`, trong nhánh `if (user)`, đặt `currentAppUser = user;`; trong `else if (guestActive)` và `else` đặt `currentAppUser = null;`.

- [ ] **Step 4: Verify**

Run: `node --test tests/*.test.js` → PASS 30.
Trình duyệt: đăng nhập tài khoản thật → bấm nút đổi mật khẩu → nhập mk cũ SAI → báo "Mật khẩu cũ không đúng."; nhập mk cũ ĐÚNG + mk mới ≥6 → báo đổi thành công, đăng nhập lại bằng mk mới OK. Ở chế độ khách, nút đổi mật khẩu bị ẩn.

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "feat(auth): nối modal đổi mật khẩu"
```

---

### Task 8: Tài liệu + chạy toàn bộ test

**Files:**
- Modify: `docs/supabase-setup.md`

- [ ] **Step 1: Bổ sung checklist**

Thêm vào mục checklist của `docs/supabase-setup.md`:

```markdown
- [ ] Không đăng nhập: bấm "Dùng tiếp không cần tài khoản" → dùng được, không có tab Trò Chuyện, tải lại vẫn còn dữ liệu.
- [ ] Khách bấm "Nâng cấp" → đăng ký → dữ liệu local chuyển lên tài khoản.
- [ ] Đổi mật khẩu: mk cũ sai → báo lỗi; mk cũ đúng → đổi được.
```

- [ ] **Step 2: Run full suite**

Run: `node --test tests/*.test.js`
Expected: PASS toàn bộ (30 cũ + test mới của Task 1, 2).

- [ ] **Step 3: Commit**

```bash
git add docs/supabase-setup.md
git commit -m "docs: checklist chế độ khách + đổi mật khẩu"
```
