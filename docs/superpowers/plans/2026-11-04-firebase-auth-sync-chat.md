# Kế hoạch triển khai: Tài khoản, đồng bộ TKB, và Chat (Firebase)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm tài khoản đăng nhập, đồng bộ thời khóa biểu theo tài khoản qua nhiều thiết bị, và chat (phòng chung + riêng 1-1 + nhóm) cho app `UniSchedule AI`, giữ nguyên nền tĩnh.

**Architecture:** Frontend tĩnh hiện có (`index.html`, `style.css`, `script.js`) được giữ làm lõi; thêm các module ES mới (`core.js`, `firebase-init.js`, `auth.js`, `cloud-sync.js`, `chat.js`) nạp qua CDN Firebase SDK. Một entry `main.js` điều phối: chờ trạng thái đăng nhập → gọi `window.startUniSchedule(user)` (do `script.js` cung cấp) hoặc hiện màn đăng nhập. Logic thuần tách vào `core.js` để test bằng `node --test`; phần phụ thuộc Firebase kiểm tra thủ công theo bước.

**Tech Stack:** JavaScript ES modules, Firebase JS SDK (Auth + Firestore) qua gstatic CDN, Firebase Hosting, `node:test` + `node:assert/strict` (dev, không phụ thuộc).

**Spec:** `docs/specs/2026-11-04-firebase-auth-sync-chat-design.md`

## Global Constraints

- Nền tảng **file tĩnh**: không framework, không bundler; **không phụ thuộc runtime** ngoài Firebase SDK nạp qua CDN. `package.json` chỉ để Node chạy test, **không** có dependency.
- App **bắt buộc chạy qua `http(s)`**; `file://` không hoạt động với Firebase.
- Dùng **gói miễn phí** Firebase (Spark).
- Toàn bộ giao diện **tiếng Việt**, nhất quán phong cách hiện có.
- Giữ tương thích khóa `localStorage` cũ: `uni_schedule_subjects_v2`.
- **Không** lộ email người khác; danh bạ chat chỉ có tên/lớp/ảnh.
- **Không** dùng service worker/PWA.
- Cấu hình Firebase (`firebase-config.js`) là công khai được; bảo vệ bằng Security Rules.
- Phiên bản Firebase SDK: pin một bản cụ thể tại Task 2 (bản mới nhất ổn định tại thời điểm làm).

## Review Focus

Năm trường hợp dễ vỡ mà test đơn vị không phủ hết; mỗi dòng có bước kiểm ở task sở hữu:

1. **Đổi tài khoản trên cùng trình duyệt** → người sau **không** được thấy hay được đề nghị tải TKB của người trước (Task 4, test + kiểm thủ công).
2. **`rooms/public` chưa tồn tại** ở lần chạy đầu → app tự tạo và chat vẫn gửi được (Task 5).
3. **Mất mạng giữa lúc gửi tin** → tin được xếp hàng và tự gửi lại khi có mạng; UI không kẹt (Task 5).
4. **Mở app bằng `file://`** → hiện thông báo rõ ràng, không màn trắng (Task 2).
5. **Hai thiết bị cùng đổi tên một nhóm** → ghi sau thắng, không lỗi/crash (Task 7).

---

### Task 1: Khung test & các hàm thuần (`core.js`)

**Files:**
- Create: `package.json`
- Create: `core.js`
- Test: `tests/core.test.js`
- Modify: `.gitignore` (tạo nếu chưa có)

**Interfaces:**
- Consumes: không.
- Produces (ESM exports từ `core.js`):
  - `directRoomId(uidA: string, uidB: string): string`
  - `cacheKeyFor(uid: string): string`
  - `shouldOfferUpload({ localOwner, uid, hasLocalData, hasCloudData }): boolean`
  - `filterDirectory(users: Array<{displayName?:string}>, query: string): Array<object>`
  - `roomLabel(room, uid: string, directoryMap: Record<string,{displayName?:string}>): string`
  - `unreadCount(messages: Array<{createdAt:any}>, lastReadAt: any): number`
  - `validateRegistration({ name, email, password }): string[]`
  - `isPublicRoomId(id: string): boolean`

- [ ] **Step 1: Khởi tạo git và `package.json`**

Thư mục chưa phải git repo — khởi tạo để lưu mốc:

```bash
cd /public/tkb && git init && git add -A && git commit -m "chore: snapshot trước khi thêm Firebase"
```

Tạo `package.json` (không dependency):

```json
{
  "name": "unischedule-ai",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test tests/" }
}
```

Tạo `.gitignore`:

```
node_modules/
firebase-debug.log
.DS_Store
```

- [ ] **Step 2: Viết test thất bại**

`tests/core.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  directRoomId, cacheKeyFor, shouldOfferUpload, filterDirectory,
  roomLabel, unreadCount, validateRegistration, isPublicRoomId
} from '../core.js';

test('directRoomId không phụ thuộc thứ tự uid', () => {
  assert.equal(directRoomId('b', 'a'), 'dm_a_b');
  assert.equal(directRoomId('a', 'b'), 'dm_a_b');
});

test('cacheKeyFor gắn uid vào khóa', () => {
  assert.equal(cacheKeyFor('u1'), 'uni_schedule_cache_v1__u1');
});

test('shouldOfferUpload chỉ khi cache chưa có chủ hoặc đúng chủ, và cloud trống', () => {
  assert.equal(shouldOfferUpload({ localOwner: null, uid: 'u1', hasLocalData: true, hasCloudData: false }), true);
  assert.equal(shouldOfferUpload({ localOwner: 'u1', uid: 'u1', hasLocalData: true, hasCloudData: false }), true);
  assert.equal(shouldOfferUpload({ localOwner: 'uX', uid: 'u1', hasLocalData: true, hasCloudData: false }), false);
  assert.equal(shouldOfferUpload({ localOwner: null, uid: 'u1', hasLocalData: true, hasCloudData: true }), false);
  assert.equal(shouldOfferUpload({ localOwner: null, uid: 'u1', hasLocalData: false, hasCloudData: false }), false);
});

test('filterDirectory tìm theo tên, không phân biệt hoa thường, rỗng thì trả hết', () => {
  const users = [{ displayName: 'An' }, { displayName: 'Bình' }];
  assert.equal(filterDirectory(users, '').length, 2);
  assert.deepEqual(filterDirectory(users, 'bì'), [{ displayName: 'Bình' }]);
});

test('roomLabel phân biệt loại phòng', () => {
  assert.equal(roomLabel({ type: 'public' }, 'u1', {}), 'Phòng chung');
  assert.equal(roomLabel({ type: 'group', name: 'KTPM' }, 'u1', {}), 'KTPM');
  const dm = { type: 'direct', members: ['u1', 'u2'] };
  assert.equal(roomLabel(dm, 'u1', { u2: { displayName: 'Bình' } }), 'Bình');
  assert.equal(roomLabel(dm, 'u1', {}), 'Trò chuyện riêng');
});

test('unreadCount đếm tin sau mốc đã đọc', () => {
  const msgs = [{ createdAt: 100 }, { createdAt: 200 }, { createdAt: 300 }];
  assert.equal(unreadCount(msgs, 150), 2);
  assert.equal(unreadCount(msgs, null), 3);
  assert.equal(unreadCount(msgs, 300), 0);
});

test('validateRegistration bắt lỗi thiếu/ sai', () => {
  assert.deepEqual(validateRegistration({ name: 'An', email: 'a@b.com', password: '123456' }), []);
  assert.deepEqual(validateRegistration({ name: '', email: 'x', password: '1' }).sort(), ['email', 'name', 'password']);
});

test('isPublicRoomId', () => {
  assert.equal(isPublicRoomId('public'), true);
  assert.equal(isPublicRoomId('dm_a_b'), false);
});
```

- [ ] **Step 3: Chạy test để chắc chắn thất bại**

Run: `cd /public/tkb && node --test tests/`
Expected: FAIL, `Cannot find module '../core.js'`.

- [ ] **Step 4: Viết `core.js`**

Tạo các export với chữ ký ở Interfaces. Gợi ý hiện thực:
- `directRoomId`: `'dm_' + [String(uidA), String(uidB)].sort().join('_')`.
- `cacheKeyFor`: `'uni_schedule_cache_v1__' + uid`.
- `shouldOfferUpload`: `false` nếu `hasCloudData` hoặc không `hasLocalData`; ngược lại `true` khi `localOwner == null` hoặc `localOwner === uid`.
- `filterDirectory`: chuẩn hóa `query` (trim, lowercase); rỗng → trả bản sao; ngược lại lọc `displayName` chứa chuỗi.
- `roomLabel`: `public` → `'Phòng chung'`; `group` → `room.name || 'Nhóm'`; `direct` → tên người còn lại từ `directoryMap`, thiếu thì `'Trò chuyện riêng'`.
- `unreadCount`: mốc `null` → đếm hết; hỗ trợ giá trị có `.toMillis()` (Firestore Timestamp) hoặc số.
- `validateRegistration`: mảng lỗi gồm `'name'` (rỗng), `'email'` (không khớp `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`), `'password'` (< 6 ký tự).
- `isPublicRoomId`: `id === 'public'`.

- [ ] **Step 5: Chạy test để chắc chắn đạt**

Run: `cd /public/tkb && node --test tests/`
Expected: PASS toàn bộ.

- [ ] **Step 6: Commit**

```bash
git add package.json core.js tests/core.test.js .gitignore
git commit -m "feat: thêm hàm thuần core và khung test"
```

---

### Task 2: Cấu hình & khởi tạo Firebase (`firebase-init.js`)

**Files:**
- Create: `firebase-config.js`
- Create: `firebase-init.js`
- Create: `docs/firebase-setup.md`
- Modify: `index.html` (nạp `firebase-config.js` + `firebase-init.js`)

**Interfaces:**
- Consumes: không.
- Produces:
  - `firebase-config.js` (classic script) đặt `window.FIREBASE_CONFIG = { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId }` (giá trị placeholder).
  - `firebase-init.js` (module) export `app`, `auth`, `db`.
  - Đặt `window.firebaseReady = true` sau khi khởi tạo; `window.SDK_VERSION` = chuỗi phiên bản đã pin.

- [ ] **Step 1: Tạo `firebase-config.js`**

Classic script (không phải module) để dễ sửa tay:

```js
// Điền cấu hình từ Firebase Console > Project settings > Your apps > Web app.
window.FIREBASE_CONFIG = {
  apiKey: "DÁN_API_KEY",
  authDomain: "DÁN.firebaseapp.com",
  projectId: "DÁN_PROJECT_ID",
  storageBucket: "DÁN.appspot.com",
  messagingSenderId: "DÁN_SENDER_ID",
  appId: "DÁN_APP_ID"
};
```

- [ ] **Step 2: Tạo `firebase-init.js`**

Module; chốt `SDK_VERSION` (ví dụ `11.0.0`, cập nhật theo bản mới nhất tại thời điểm làm). Dùng `import { initializeApp } from 'https://www.gstatic.com/firebasejs/<SDK_VERSION>/firebase-app.js'`, tương tự cho `getAuth` và `initializeFirestore` + `persistentLocalCache`.

Yêu cầu:
- Nếu `window.FIREBASE_CONFIG.apiKey` bắt đầu bằng `"DÁN"` → ghi `console.error` và đặt `window.firebaseError = 'missing-config'`; vẫn import thành công nhưng đặt `window.firebaseReady = false`.
- Nếu `location.protocol === 'file:'` → đặt `window.firebaseError = 'file-protocol'`, `window.firebaseReady = false`.
- Ngược lại tạo `app`, `auth`, `db` (Firestore bật `persistentLocalCache`), đặt `window.firebaseReady = true`, `window.SDK_VERSION`.

- [ ] **Step 3: Nạp vào `index.html`**

Trước thẻ script hiện có, thêm:

```html
<script src="firebase-config.js"></script>
<script type="module" src="firebase-init.js"></script>
```

(giữ `<script src="script.js" defer></script>`).

- [ ] **Step 4: Viết `docs/firebase-setup.md`**

Các bước cho chủ dự án: tạo project → thêm Web app → copy config vào `firebase-config.js` → bật Authentication (Email/Password, Google) → tạo Firestore (production mode) → thêm `localhost` + domain hosting vào Authorized domains → cài `firebase-tools`, `firebase login`, `firebase init hosting` (public = thư mục hiện tại).

- [ ] **Step 5: Kiểm thủ công — cấu hình thiếu**

Run: `cd /public/tkb && npx --yes serve -l 5000 .` rồi mở `http://localhost:5000`.
Expected: Console có `missing-config` (vì config còn placeholder); trang không trắng.

- [ ] **Step 6: Kiểm thủ công — chạy qua http và sau khi điền config**

Sau khi chủ dự án điền config thật và `firebase serve` (hoặc server tĩnh), mở bằng `http://localhost:...`.
Expected: Console có `window.firebaseReady === true`; `window.SDK_VERSION` in ra phiên bản đã pin.

- [ ] **Step 7: Commit**

```bash
git add firebase-config.js firebase-init.js index.html docs/firebase-setup.md
git commit -m "feat: cấu hình và khởi tạo Firebase"
```

---

### Task 3: Đăng nhập & màn hình xác thực (`auth.js`)

**Files:**
- Create: `auth.js`
- Create: `main.js`
- Modify: `index.html` (màn đăng nhập, header người dùng)
- Modify: `style.css`
- Modify: `script.js` (bỏ auto-init; thêm `window.startUniSchedule`, `window.stopUniSchedule`)

**Interfaces:**
- Consumes: `app`, `auth`, `db` (Task 2); `validateRegistration` (Task 1).
- Produces:
  - `auth.js`: `signInEmail(email, password)`, `signUpEmail(name, email, password)`, `signInGoogle()`, `signOutUser()`, `onAuthUser(cb)` — tất cả trả Promise ngoài `onAuthUser`.
  - `main.js`: entry điều phối; gọi `window.startUniSchedule(user)` khi có user, ngược lại hiện `#authScreen` và gọi `window.stopUniSchedule()`.
  - `script.js`: `window.startUniSchedule(user)` chạy khởi tạo app với uid hiện tại; `window.stopUniSchedule()` ẩn nội dung app, xóa state trong bộ nhớ.

- [ ] **Step 1: Thêm màn đăng nhập vào `index.html`**

Trước `<main class="page">`, thêm `#authScreen` (class `hidden` mặc định) gồm: tiêu đề app, hai tab "Đăng nhập"/"Đăng ký", input `#authName` (chỉ hiện khi đăng ký), `#authEmail`, `#authPassword`, nút submit `#authSubmit`, nút `#authGoogle`, vùng lỗi `#authError`. Thêm vào header một khối `#userMenu` (class `hidden`) chứa avatar `#userAvatar`, tên `#userName`, nút `#logoutBtn`.

- [ ] **Step 2: Viết test thất bại cho validateRegistration (đã có ở Task 1) — bổ sung ca biên**

Thêm vào `tests/core.test.js`:

```js
test('validateRegistration: email có khoảng trắng bị coi là sai', () => {
  assert.deepEqual(validateRegistration({ name: 'An', email: 'a b@c.com', password: '123456' }), ['email']);
});
```

Run: `node --test tests/` → PASS (đã có hàm). Giữ làm chốt hồi quy.

- [ ] **Step 3: Viết `auth.js`**

Dùng `import { auth } from './firebase-init.js'` và các hàm Auth (`signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `GoogleAuthProvider`, `signInWithPopup`, `signInWithRedirect`, `getRedirectResult`, `updateProfile`, `signOut`, `onAuthStateChanged`). Yêu cầu:
- `signUpEmail`: tạo user, `updateProfile(user, { displayName: name })`.
- `signInGoogle`: thử `signInWithPopup`; nếu lỗi `auth/popup-blocked` hoặc `auth/operation-not-supported-in-this-environment` → `signInWithRedirect`.
- Dịch mã lỗi Firebase phổ biến sang thông báo tiếng Việt (sai mật khẩu, email đã dùng, mật khẩu yếu, mất mạng).
- `onAuthUser(cb)` bọc `onAuthStateChanged`.

- [ ] **Step 4: Viết `main.js` và sửa `script.js`**

`main.js`: gắn sự kiện form/`#authGoogle`/`#logoutBtn`; gọi `onAuthUser`. Khi có user: ẩn `#authScreen`, hiện `#userMenu`, điền tên/ảnh, gọi `window.startUniSchedule(user)`. Khi không: hiện `#authScreen`, gọi `window.stopUniSchedule()`.

`script.js`: đổi khối cuối — bỏ `init()` tự chạy; thêm:

```js
window.startUniSchedule = function (user) { currentUid = user ? user.uid : null; init(); };
window.stopUniSchedule = function () { currentUid = null; subjectsList = []; };
```

thêm biến `var currentUid = null;` ở đầu. (Không xóa `init` và các hàm render hiện có.)

- [ ] **Step 5: Thêm CSS màn đăng nhập & menu người dùng vào `style.css`**

Card đăng nhập giữa màn, hai tab, input full-width, `#userMenu` nằm trong `.header-inner` (avatar tròn, tên ẩn trên mobile).

- [ ] **Step 6: Kiểm thủ công**

Run: server tĩnh + mở app.
Expected: chưa đăng nhập → chỉ thấy màn đăng nhập; đăng ký tài khoản mới (`ten@vidu.com`/`123456`) → vào app, header hiện tên; tải lại trang → vẫn đăng nhập; bấm đăng xuất → về màn đăng nhập.

- [ ] **Step 7: Commit**

```bash
git add auth.js main.js index.html style.css script.js tests/core.test.js
git commit -m "feat: đăng nhập, đăng ký, đăng xuất"
```

---

### Task 4: Đồng bộ thời khóa biểu (`cloud-sync.js` + rules)

**Files:**
- Create: `cloud-sync.js`
- Create: `firestore.rules`
- Modify: `index.html` (nạp `cloud-sync.js`/`main.js`)
- Modify: `script.js` (dùng cache theo uid, nạp cloud khi `startUniSchedule`)

**Interfaces:**
- Consumes: `db` (Task 2), `cacheKeyFor`/`shouldOfferUpload` (Task 1), `window.startUniSchedule` (Task 3).
- Produces:
  - `cloud-sync.js`: `initSync(user)`, `teardownSync()`, `migrateLocalToCloud(user, list)`, và đặt `window.cloudSaveSubject`, `window.cloudDeleteSubject`, `window.cloudClearAllSubjects`.
  - `script.js`: `window.applyCloudSubjects(list)` cập nhật `subjectsList` + render; `saveToLocalStorage()` dùng khóa `cacheKeyFor(currentUid)`.

- [ ] **Step 1: Viết `cloud-sync.js`**

Dùng `db`, các hàm Firestore (`collection`, `doc`, `setDoc`, `deleteDoc`, `writeBatch`, `onSnapshot`, `serverTimestamp`, `collectionGroup`... chỉ những hàm cần). Yêu cầu:
- `initSync(user)`: nghe `onSnapshot(collection(db,'users',uid,'subjects'))`; khi có dữ liệu gọi `window.applyCloudSubjects(list)`. Trả `unsubscribe`.
- `window.cloudSaveSubject(s)`: `setDoc(doc(db,'users',uid,'subjects',s.id), { ...s, updatedAt: serverTimestamp() })` (bỏ `id` khỏi payload nếu muốn, nhưng phải dùng `s.id` làm doc id).
- `window.cloudDeleteSubject(id)`: `deleteDoc(...)`.
- `window.cloudClearAllSubjects()`: `writeBatch` xóa hết document con.
- `migrateLocalToCloud(user, list)`: batch ghi toàn bộ `list`.
- Đặt `window.UNI_LAST_UID` khi đăng nhập; xóa khi teardown (tùy chọn).

- [ ] **Step 2: Viết `firestore.rules` (phần users/subjects)**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
      match /subjects/{subjectId} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
      match /reads/{roomId} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }
    match /directory/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

(Task 6 sẽ bổ sung `rooms`/`messages`.)

- [ ] **Step 3: Sửa `script.js`**

- Thêm `window.applyCloudSubjects = function (list) { subjectsList = Array.isArray(list) ? list : []; saveToLocalStorage(); renderCurrentView(); };`
- `saveToLocalStorage()` dùng `localStorage.setItem(cacheKeyFor(currentUid), JSON.stringify(subjectsList))`. `loadFromLocalStorage()` đọc khóa theo uid; lần đầu đọc thêm khóa cũ `uni_schedule_subjects_v2` làm nguồn "chưa có chủ".
- Trong `startUniSchedule`: sau `init()`, nếu `window.initSync` tồn tại → gọi `initSync(user)`; kiểm tra `shouldOfferUpload({ localOwner: localStorage.getItem('UNI_LAST_UID'), uid: user.uid, hasLocalData: <có cache>, hasCloudData: <cloud rỗng> })`, nếu `true` thì `confirm()` và `migrateLocalToCloud`.
- Trong `stopUniSchedule`: gọi `window.teardownSync()` nếu có; đặt `UNI_LAST_UID = null`.

Các hàm `editSubject`/`deleteSubject`/`confirmClearAll`/`saveOcrResultsToSchedule` đã gọi `window.cloud*` — không cần sửa thêm.

- [ ] **Step 4: Test hồi quy cho quy tắc cache (thuần)**

Thêm vào `tests/core.test.js`:

```js
test('shouldOfferUpload: đổi tài khoản trên cùng máy thì KHÔNG đề nghị tải lên', () => {
  assert.equal(shouldOfferUpload({ localOwner: 'oldUid', uid: 'newUid', hasLocalData: true, hasCloudData: false }), false);
});
```

Run: `node --test tests/` → PASS.

- [ ] **Step 5: Kiểm thủ công — đồng bộ hai thiết bị**

Run: server tĩnh, mở ở 2 trình duyệt (hoặc 2 profile).
Expected: thêm môn ở trình duyệt A → B tự hiện; xóa ở B → A mất; tải lại A/B vẫn đúng.

- [ ] **Step 6: Kiểm thủ công — đổi tài khoản cùng máy**

Đăng nhập A, thêm môn; đăng xuất; đăng ký/đăng nhập B (tài khoản trống).
Expected: B **không** thấy TKB của A và **không** được đề nghị tải TKB của A lên.

- [ ] **Step 7: Commit**

```bash
git add cloud-sync.js firestore.rules script.js index.html tests/core.test.js
git commit -m "feat: đồng bộ thời khóa biểu theo tài khoản"
```

---

### Task 5: Chat — khung, phòng chung, tin nhắn thời gian thực (`chat.js`)

**Files:**
- Create: `chat.js`
- Modify: `index.html` (tab "Trò chuyện", khung chat)
- Modify: `style.css`
- Modify: `main.js` (gọi `initChat(user)`/`teardownChat()`)
- Modify: `firestore.rules` (thêm `rooms`/`messages`)

**Interfaces:**
- Consumes: `db`, `auth` (Task 2); `isPublicRoomId`, `unreadCount` (Task 1).
- Produces (`chat.js`):
  - `initChat(user)`, `teardownChat()`
  - `ensurePublicRoom()` → Promise, tạo `rooms/public` nếu chưa có
  - `subscribeRoomList(cb: (rooms) => void): () => void`
  - `openRoom(roomId)`
  - `subscribeMessages(roomId, cb: (messages) => void): () => void`
  - `sendMessage(roomId, text)`
  - `markRoomRead(roomId)`

- [ ] **Step 1: Thêm tab và khung chat vào `index.html`**

- Thêm symbol icon `#i-chat` vào sprite SVG.
- Thêm nút `.tab-nav` id `btnTabChat` gọi `switchTab('chatTab')`.
- Thêm `<section id="chatTab" class="tab-content hidden">` gồm: cột danh sách phòng `#roomList` (có mục phòng chung), cột khung chat `#chatPane` với tiêu đề `#chatTitle`, vùng tin nhắn `#messageList`, form `#messageForm` + `#messageInput`.
- Thêm `chatTab: 'btnTabChat'` vào map trong `switchTab` (script.js).

- [ ] **Step 2: Viết `chat.js` (phần phòng chung)**

- `ensurePublicRoom()`: nếu `getDoc(doc(db,'rooms','public'))` không tồn tại → `setDoc` với `{ type:'public', name:null, members:[], ownerId:null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastMessage:null }`.
- `subscribeRoomList(cb)`: lấy phòng chung (doc) + `query(collection(db,'rooms'), where('members','array-contains', uid))`; gộp, sắp theo `lastMessage.createdAt` giảm dần; gọi `cb`.
- `subscribeMessages(roomId, cb)`: `query(collection(db,'rooms',roomId,'messages'), orderBy('createdAt','asc'), limit(50))`, return `unsubscribe`.
- `sendMessage(roomId, text)`: thêm doc vào `rooms/{roomId}/messages` với `{ senderId: uid, senderName: user.displayName, text, type:'text', createdAt: serverTimestamp() }`; cập nhật `rooms/{roomId}.lastMessage` + `updatedAt`.
- Render tin nhắn bằng DOM API + `escapeHtml`/`ico` hiện có (hoặc hàm cục bộ tương đương).
- Điều khiển UI: hiện `#chatTab`, chuyển tab, tự cuộn xuống cuối khi có tin mới.

- [ ] **Step 3: Bổ sung rules cho `rooms`/`messages` vào `firestore.rules`**

```
match /rooms/{roomId} {
  function isMember() { return request.auth != null && request.auth.uid in resource.data.members; }
  function isPublic() { return resource.data.type == 'public'; }
  allow read: if request.auth != null && (resource.data.type == 'public' || request.auth.uid in resource.data.members);
  allow create: if request.auth != null && (
      (request.resource.data.type == 'public' && roomId == 'public') ||
      (request.resource.data.type == 'direct' && request.auth.uid in request.resource.data.members && request.resource.data.members.size() == 2) ||
      (request.resource.data.type == 'group' && request.resource.data.ownerId == request.auth.uid && request.auth.uid in request.resource.data.members)
  );
  allow update: if request.auth != null && (
      request.resource.data.type == 'public' ||
      request.auth.uid in resource.data.members
  );
  allow delete: if request.auth != null && resource.data.type == 'group' && resource.data.ownerId == request.auth.uid;

  match /messages/{messageId} {
    function room() { return get(/databases/$(database)/documents/rooms/$(roomId)).data; }
    allow read: if request.auth != null && (room().type == 'public' || request.auth.uid in room().members);
    allow create: if request.auth != null
      && (room().type == 'public' || request.auth.uid in room().members)
      && request.resource.data.senderId == request.auth.uid
      && request.resource.data.createdAt == request.time;
    allow update, delete: if false;
  }
}
```

- [ ] **Step 4: Nối vào `main.js`**

Khi có user: gọi `ensurePublicRoom().then(initChat(user))`. Khi đăng xuất: `teardownChat()` (hủy các `unsubscribe`).

- [ ] **Step 5: Kiểm thủ công — phòng chung realtime**

Run: server + 2 trình duyệt, cùng đăng nhập khác tài khoản.
Expected: mở tab "Trò chuyện" → thấy "Phòng chung"; gửi ở A → B hiện gần như tức thì; tải lại vẫn còn; `rooms/public` tồn tại trong Firestore; nếu xóa doc `rooms/public` rồi tải lại app → tự tạo lại và vẫn chat được.

- [ ] **Step 6: Kiểm thủ công — mất mạng khi gửi**

Bật offline (DevTools) trong khi mở tab chat, gửi 1 tin, rồi bật mạng lại.
Expected: UI không kẹt; tin được gửi khi có mạng (nhờ cache `persistentLocalCache`).

- [ ] **Step 7: Kiểm thủ công — chặn đọc trái phép**

Xác nhận user không phải thành viên không đọc được `rooms/{khác}`/tin nhắn của phòng riêng (thử đọc qua console Firestore).
Expected: bị từ chối.

- [ ] **Step 8: Commit**

```bash
git add chat.js index.html style.css main.js firestore.rules
git commit -m "feat: chat phòng chung thời gian thực"
```

---

### Task 6: Chat riêng 1-1 & danh bạ người dùng

**Files:**
- Modify: `chat.js`
- Modify: `main.js` (ghi `directory/{uid}` khi đăng nhập)
- Modify: `index.html` (nút "Chat riêng", modal chọn người)
- Modify: `style.css`

**Interfaces:**
- Consumes: `directRoomId`, `filterDirectory`, `roomLabel` (Task 1); `subscribeRoomList`, `openRoom`, `sendMessage` (Task 5).
- Produces (`chat.js`):
  - `upsertDirectory(user, { class?: string })`
  - `listDirectory(cb: (users) => void): () => void`
  - `openDirect(otherUid)`
  - `subscribeMessages` dùng chung cho direct.

- [ ] **Step 1: `upsertDirectory` và `listDirectory`**

- `upsertDirectory(user)`: `setDoc(doc(db,'directory',uid), { displayName: user.displayName || 'Người dùng', class: null, photoURL: user.photoURL || null, updatedAt: serverTimestamp() }, { merge:true })`. Gọi trong `main.js` sau khi có user.
- `listDirectory(cb)`: `onSnapshot(collection(db,'directory'))` → mảng user; UI lọc bằng `filterDirectory`.

- [ ] **Step 2: `openDirect(otherUid)`**

`roomId = directRoomId(uid, otherUid)`; nếu chưa có `rooms/{roomId}` → `setDoc` với `{ type:'direct', members:[uid, otherUid], ownerId:null, name:null, createdAt, updatedAt, lastMessage:null }`; gọi `openRoom(roomId)`.

- [ ] **Step 3: UI chọn người**

Thêm nút "Chat riêng" ở đầu `#roomList`; mở modal `#pickUserModal` với ô tìm `#pickUserSearch` và danh sách `#pickUserList` (render từ `listDirectory` + `filterDirectory`). Bấm một người → `openDirect(uid)` và đóng modal. Danh sách **không** hiện email.

- [ ] **Step 4: Tên phòng direct**

Khi render danh sách phòng và tiêu đề chat, dùng `roomLabel(room, uid, directoryMap)` để hiện tên người còn lại.

- [ ] **Step 5: Test hồi quy**

`tests/core.test.js` đã phủ `directRoomId`/`filterDirectory`/`roomLabel`. Thêm:

```js
test('directRoomId ổn định với uid chứa ký tự đặc biệt', () => {
  assert.equal(directRoomId('uid_A!', 'uid_B!'), directRoomId('uid_B!', 'uid_A!'));
});
```

Run: `node --test tests/` → PASS.

- [ ] **Step 6: Kiểm thủ công — chat riêng hai chiều**

Run: 2 trình duyệt, 2 tài khoản.
Expected: A chọn B trong "Chat riêng" → gửi tin → B thấy trong danh sách phòng và nhận được; B trả lời → A nhận; hai bên thấy **cùng một** phòng (không tạo trùng).

- [ ] **Step 7: Commit**

```bash
git add chat.js index.html style.css main.js tests/core.test.js
git commit -m "feat: chat riêng 1-1 và danh bạ người dùng"
```

---

### Task 7: Chat nhóm

**Files:**
- Modify: `chat.js`
- Modify: `index.html` (nút "+ Tạo nhóm", modal, thao tác trong phòng nhóm)
- Modify: `style.css`

**Interfaces:**
- Consumes: `listDirectory`, `openRoom`, `sendMessage` (Task 5–6).
- Produces (`chat.js`):
  - `createGroup(name: string, memberUids: string[])`
  - `renameGroup(roomId: string, name: string)`
  - `addGroupMembers(roomId: string, uids: string[])`
  - `removeGroupMember(roomId: string, uid: string)`
  - `leaveGroup(roomId: string)`

- [ ] **Step 1: Viết các hàm nhóm**

- `createGroup`: `addDoc(collection(db,'rooms'), { type:'group', name, members:[uid, ...memberUids], ownerId: uid, createdAt, updatedAt, lastMessage:null })`; mở phòng.
- `renameGroup`: `updateDoc` đổi `name`, `updatedAt`.
- `addGroupMembers`: `arrayUnion(...uids)`; `removeGroupMember`/`leaveGroup`: `arrayRemove(uid)`.
- Đối chiếu rules Task 5: đổi `members` cần `ownerId == uid` hoặc tự bớt chính mình → đảm bảo thao tác "rời nhóm" chỉ `arrayRemove(uid)` của chính mình.

- [ ] **Step 2: UI**

- Nút "+ Tạo nhóm" cạnh "Chat riêng": mở modal `#createGroupModal` gồm `#groupNameInput` + danh sách chọn nhiều `#groupMemberList` (checkbox). Bấm "Tạo" → `createGroup`.
- Trong phòng nhóm: nút `#groupInfoBtn` mở panel `#groupInfoModal` hiển thị thành viên; owner thấy nút đổi tên/thêm/bớt; ai cũng thấy "Rời nhóm".

- [ ] **Step 3: Kiểm thủ công — tạo nhóm & nhắn**

Run: 3 tài khoản (2 trình duyệt + cửa sổ ẩn danh).
Expected: A tạo nhóm với B, C → cả ba thấy nhóm trong danh sách, tên đúng; gửi tin → cả ba nhận; nếu C chưa mở thì vẫn thấy khi mở.

- [ ] **Step 4: Kiểm thủ công — vòng đời thành viên**

A (owner) thêm D, bớt C; C tự bấm "Rời nhóm"; A đổi tên nhóm.
Expected: đúng như thiết kế; C không còn thấy nhóm; D thấy; tên đổi ở mọi người.

- [ ] **Step 5: Kiểm thủ công — hai thiết bị đổi tên cùng nhóm**

A và B đổi tên nhóm gần như cùng lúc.
Expected: ghi sau thắng, không lỗi, danh sách hội tụ về một tên.

- [ ] **Step 6: Commit**

```bash
git add chat.js index.html style.css
git commit -m "feat: chat nhóm"
```

---

### Task 8: Hoàn thiện — chưa đọc, đăng xuất, deploy

**Files:**
- Modify: `chat.js` (số chưa đọc, markRoomRead)
- Modify: `script.js` / `main.js` (dọn dẹp khi đăng xuất)
- Create: `docs/deploy.md`
- Modify: `docs/firebase-setup.md` nếu cần

**Interfaces:**
- Consumes: `unreadCount` (Task 1); `markRoomRead` (Task 5).
- Produces: không API mới.

- [ ] **Step 1: Số chưa đọc**

- `markRoomRead(roomId)`: `setDoc(doc(db,'users',uid,'reads',roomId), { lastReadAt: serverTimestamp() }, { merge:true })`.
- Gọi khi mở phòng và khi có tin mới trong phòng đang mở.
- Badge chưa đọc trong danh sách phòng dùng `unreadCount(messages, lastReadAt)` (đã test hàm thuần).

- [ ] **Step 2: Dọn dẹp khi đăng xuất**

Xác nhận `teardownSync`/`teardownChat` hủy mọi `unsubscribe`; xóa `subjectsList` trong bộ nhớ; đặt `UNI_LAST_UID = null`; ẩn tab chat. Không xóa cache theo uid.

- [ ] **Step 3: Kiểm thủ công — phiên & quyền riêng tư**

- Đăng nhập A → tải lại → vẫn A.
- Đăng xuất → về màn đăng nhập; console không còn listener cũ.
- Đăng nhập B → không thấy dữ liệu A.

- [ ] **Step 4: Viết `docs/deploy.md`**

Hướng dẫn deploy: copy `firestore.rules` vào Firestore Rules trong Console (hoặc `firebase deploy --only firestore:rules`), `firebase deploy --only hosting`, thêm domain vào Authorized domains, kiểm tra đăng nhập Google.

- [ ] **Step 5: Kiểm thủ công — smoke sau deploy**

Run: mở domain hosting.
Expected: đăng nhập, đồng bộ TKB, chat chung/riêng/nhóm đều chạy; không lỗi console.

- [ ] **Step 6: Chạy toàn bộ test**

Run: `cd /public/tkb && node --test tests/`
Expected: PASS toàn bộ.

- [ ] **Step 7: Commit**

```bash
git add chat.js script.js main.js docs/deploy.md
git commit -m "feat: số chưa đọc, dọn dẹp đăng xuất, hướng dẫn deploy"
```

---

## Self-review của kế hoạch

- **Spec coverage:** §5.1→Task 2; §5.2→Task 1–8 (tạo từng file); §5.3→Task 3; §5.4→Task 4; §5.5→Task 4–7; §5.6→Task 4 (users) + Task 5 (rooms/messages); §5.7→Task 5–7; §5.8→Task 2 + Task 8; §6→Task 3–4; §7 (5 giai đoạn)→ánh xạ vào 8 task; §10 (6 điểm đã chốt)→cache (T4), rules public (T5), mất mạng (T5), http(s) (T2), danh bạ (T6), vòng đời nhóm (T7).
- **Không có task thừa:** mỗi task có test/kiểm thủ công và commit riêng.
- **Nhất quán kiểu:** tên hàm `directRoomId`, `cacheKeyFor`, `shouldOfferUpload`, `filterDirectory`, `roomLabel`, `unreadCount`, `validateRegistration`, `isPublicRoomId`, `initSync`/`teardownSync`, `initChat`/`teardownChat`, `ensurePublicRoom`, `openRoom`, `sendMessage`, `markRoomRead`, `openDirect`, `createGroup`… dùng thống nhất giữa các task.
- **Rủi ro còn lại:** Cloud Functions (dọn dữ liệu mồ côi, bảo vệ khóa Gemini) để ngoài phạm vi như spec §9.
