# Xoá lịch sử = ẩn cuộc trò chuyện — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sau khi "Xoá lịch sử", ẩn luôn cuộc trò chuyện (chat riêng + nhóm) khỏi danh sách bên trái; tự hiện lại khi có tin mới hiển thị.

**Architecture:** Không đổi database. Suy ra trạng thái "ẩn" từ `reads.cleared_at` sẵn có cộng với việc không còn tin nào hiển thị (dùng `previewByRoom` đã lọc chặn + mốc xoá). Thêm một hàm thuần `isRoomHidden` trong `core.js`, rồi lọc trong `renderRoomList` và đóng khung chat khi xoá phòng đang mở.

**Tech Stack:** Vanilla JS (ES module), Supabase Postgres + Realtime, `node --test`. Không framework/bundler.

**Spec:** `docs/superpowers/specs/2026-11-05-chat-clear-hides-conversation-design.md`

## Global Constraints

- Nền tĩnh, vanilla JS; không thêm framework/bundler/dependency.
- `core.js` chỉ được **thêm** hàm thuần (không sửa hành vi hàm cũ).
- UI tiếng Việt, giữ nguyên văn phong và bố cục DOM hiện có.
- Không đổi `supabase/schema.sql`.
- Mốc xoá theo giờ server (`cleared_at`) — không dùng giờ máy khách.
- Kênh chung (`room.type === 'public'`) không bao giờ bị ẩn.
- Lệnh kiểm tra: `npm test` (= `node --test tests/*.test.js`), `node --check <file>.js`.

## Review Focus

- Phòng có `cleared_at` nhưng `previewByRoom` chưa kịp tính (`undefined`): phải rơi về `room.lastMessage`, tránh ẩn/hiện sai.
- Kênh chung lỡ có `cleared_at`: `isRoomHidden` phải luôn trả `false`.
- Phòng chưa từng xoá (`cleared_at` null) dù không có tin: **không** ẩn.
- Tin mới của người bị chặn: không kéo phòng hiện lại (preview rỗng) — nằm ngoài test tự động, xác nhận khi đọc code ở Task 2.
- Xoá phòng đang mở: phải hủy đăng ký `messagesUnsub` để callback không vẽ vào khung đã đóng.

---

### Task 1: Hàm thuần `isRoomHidden`

**Files:**
- Modify: `core.js` (thêm export cạnh `newestMessageTime`)
- Test: `tests/core.test.js`

**Interfaces:**
- Consumes: không.
- Produces: `isRoomHidden(room: {type?: string} | null | undefined, clearedAt: number | null, preview: any) -> boolean`.

- [ ] **Step 1: Thêm `isRoomHidden` vào danh sách import của test**

Trong `tests/core.test.js`, dòng import từ `../core.js` đang có `visibleMessages, blockTimes, blockedByMe, newestMessageTime,`. Thêm `isRoomHidden` vào ngay sau `newestMessageTime`.

- [ ] **Step 2: Viết test thất bại**

Thêm vào cuối `tests/core.test.js`:

```js
test('isRoomHidden ẩn phòng đã xoá lịch sử khi không còn tin hiển thị', () => {
  assert.equal(isRoomHidden({ type: 'direct' }, 200, null), true);
  assert.equal(isRoomHidden({ type: 'group' }, 200, undefined), true);
});

test('isRoomHidden không ẩn khi còn tin mới hiển thị', () => {
  assert.equal(isRoomHidden({ type: 'direct' }, 200, { createdAt: 300 }), false);
});

test('isRoomHidden không ẩn phòng chưa xoá lịch sử', () => {
  assert.equal(isRoomHidden({ type: 'direct' }, null, null), false);
});

test('isRoomHidden không bao giờ ẩn kênh chung', () => {
  assert.equal(isRoomHidden({ type: 'public' }, 200, null), false);
});

test('isRoomHidden chịu dữ liệu rỗng/không hợp lệ', () => {
  assert.equal(isRoomHidden(null, 200, null), false);
  assert.equal(isRoomHidden(undefined, 200, null), false);
});
```

- [ ] **Step 3: Chạy test để chắc chắn nó thất bại**

Run: `cd /public/tkb && node --test tests/core.test.js`
Expected: FAIL — `isRoomHidden is not defined` (hoặc lỗi import), các test cũ vẫn chạy.

- [ ] **Step 4: Cài đặt `isRoomHidden` trong `core.js`**

Thêm ngay sau hàm `newestMessageTime`:

```js
// Phòng đã xoá lịch sử và không còn tin hiển thị nào → ẩn khỏi danh sách của
// riêng mình. Kênh chung không bao giờ bị ẩn. `preview` là tin hiển thị mới nhất
// (null/undefined nghĩa là không còn tin nào để xem).
export function isRoomHidden(room, clearedAt, preview) {
    if (!room || room.type === 'public') return false;
    if (clearedAt == null) return false;
    return !preview;
}
```

- [ ] **Step 5: Chạy test để chắc chắn nó qua**

Run: `cd /public/tkb && npm test`
Expected: PASS toàn bộ (54 test cũ + 5 test mới = 59).

- [ ] **Step 6: Commit**

```bash
git add core.js tests/core.test.js
git commit -m "feat(core): isRoomHidden — ẩn phòng đã xoá lịch sử khi hết tin hiển thị"
```

---

### Task 2: Nối vào `chat.js` (lọc danh sách + đóng khung khi xoá)

**Files:**
- Modify: `chat.js:8-12` (import), `chat.js:1104-1108` (`renderRoomList`), `chat.js:269-276` (`clearHistory`)

**Interfaces:**
- Consumes: `isRoomHidden(room, clearedAt, preview)` từ Task 1; `clearedMap`, `previewByRoom`, `currentRoomId`, `currentMessages`, `messagesUnsub` sẵn có trong module.
- Produces: không (thay đổi hành vi UI).

- [ ] **Step 1: Import `isRoomHidden`**

Trong `chat.js`, dòng import từ `./core.js` đang kết thúc bằng `blockedByMe, newestMessageTime`. Thêm `, isRoomHidden` vào cuối danh sách trước `} from './core.js';`.

- [ ] **Step 2: Lọc phòng ẩn trong `renderRoomList`**

Trong `renderRoomList`, sau khi định nghĩa `previewAt` và trước dòng `const activeSorted = split.active.slice()...`, đổi thành lọc bỏ phòng ẩn rồi mới sắp xếp:

```js
    const activeSorted = split.active.filter(function (room) {
        return !isRoomHidden(room, clearedMap[room.id] == null ? null : clearedMap[room.id], previewAt(room));
    }).sort(function (a, b) {
        const pa = previewAt(a);
        const pb = previewAt(b);
        return ((pb && pb.createdAt) || 0) - ((pa && pa.createdAt) || 0);
    });
```

- [ ] **Step 3: Đóng khung chat khi xoá phòng đang mở**

Trong `clearHistory`, ngay sau dòng `clearedMap[roomId] = mark;` và trước `refreshChatViews();`, thêm:

```js
    // Phòng đang mở mà bị ẩn thì đóng khung, đưa về "Chọn một phòng".
    if (roomId === currentRoomId) {
        currentRoomId = null;
        currentMessages = [];
        if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
        const ml = document.getElementById('messageList');
        if (ml) ml.innerHTML = '';
        setChatTitle();
        updateChatMenuBtn();
    }
```

- [ ] **Step 4: Kiểm tra cú pháp và test**

Run: `cd /public/tkb && node --check chat.js && npm test`
Expected: `node --check` im lặng (OK); `npm test` PASS 59/59.

- [ ] **Step 5: Smoke cục bộ (Chromium)**

Run: `cd /public/tkb && node /tmp/opencode/check-task5.mjs`
Expected: `Kết quả: TẤT CẢ PASS` (các khối UI/menu vẫn còn; không lỗi console nghiêm trọng).

- [ ] **Step 6: Commit**

```bash
git add chat.js
git commit -m "feat(chat): xoá lịch sử ẩn luôn cuộc trò chuyện, tự hiện lại khi có tin mới"
```
