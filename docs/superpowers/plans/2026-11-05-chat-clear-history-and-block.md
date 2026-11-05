# Xoá lịch sử trò chuyện + Chặn người dùng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho người dùng tự xoá lịch sử trò chuyện (riêng chat 1-1 và nhóm) và chặn một người (hiệu lực hai phía), có ẩn tin mới + bỏ chặn, mà không đổi giao diện hiện có.

**Architecture:** Chặn hành động ở tầng dữ liệu bằng RLS + bảng `blocks` (gửi tin 1-1, thêm thành viên, nhận lời mời). Ẩn tin làm ở client bằng hàm thuần `visibleMessages` lọc theo mốc xoá (`reads.cleared_at`) và mốc chặn (thời điểm chặn sớm nhất giữa hai người). Một popup hành động dùng chung cho "bấm tên người".

**Tech Stack:** HTML/CSS/JS thuần (ES modules), Supabase (Postgres + RLS + Realtime), Node 22 test runner.

**Spec:** `docs/superpowers/specs/2026-11-05-chat-clear-history-and-block-design.md`

## Global Constraints

- Web tĩnh, không framework/bundler; giao diện tiếng Việt; giữ nguyên bố cục DOM và tên hàm export hiện có (chỉ thêm).
- `core.js` là hàm thuần, không phụ thuộc DOM; chỉ thêm hàm mới.
- `supabase/schema.sql` phải **idempotent** (chạy lặp an toàn).
- RLS là lớp bảo vệ chính; không tin client.
- Test chạy: `node --test tests/*.test.js` (Node 22). Kiểm tra cú pháp module: `node --check <file>.js`.
- Không bao giờ lộ email vào bảng công khai; không thêm khoá bí mật vào repo.
- Người bị chặn **không gửi được** tin 1-1 (cả hai chiều); ở nhóm/kênh chung họ vẫn gửi cho người khác nhưng tin bị **ẩn** với người chặn.
- Mốc ẩn tin = thời điểm chặn **sớm nhất** giữa hai người; tin trước mốc vẫn xem được.
- "Xoá lịch sử" áp dụng cho mọi tin kể cả tin của mình; bộ lọc **chặn** miễn trừ tin của chính người xem.

## Review Focus

These are the inputs/conditions most likely to bite a real user; each is pinned by a test or a verification step in the task that owns the code.

1. **Lệch đồng hồ:** client ghi `cleared_at` bằng giờ máy, còn `messages.created_at` do server tạo. Đồng hồ máy nhanh có thể ẩn nhầm tin mới. Kỳ vọng: tin mới nhất luôn hiện; chỉ mất phần cũ. (Task 3 tests + Task 6 REST.)
2. **Realtime `blocks` dưới RLS:** bên bị chặn phải nhận được dòng chặn để tự ẩn tin mà không cần tải lại. Kỳ vọng: cả hai phía cập nhật tức thì. (Task 4 verification.)
3. **`room_members_insert` với `upsert(ignoreDuplicates)`:** dòng ON CONFLICT có thể bỏ qua `WITH CHECK`. Kỳ vọng: cặp đang chặn không bao giờ thành thành viên. (Task 2 + Task 6 REST.)
4. **Phòng direct chỉ còn một thành viên:** nếu có cách xoá thành viên kia thì "không còn người khác" → gửi được. Kỳ vọng: không lách được. (Task 2 `can_send_to_room` + Task 6 REST.)
5. **Giới hạn 50 tin:** tin bị ẩn nằm lẫn trong 50 tin lấy về có thể làm trống khung. Kỳ vọng: không tệ hơn hiện tại. (Task 3 note, Task 6 smoke.)
6. **Preview/đếm chưa đọc khi mọi tin bị ẩn:** kỳ vọng "Chưa có tin nhắn" + không có badge, phòng rớt xuống cuối. (Task 3 tests ở tầng dữ liệu qua `visibleMessages`.)

---

### Task 1: Hàm thuần lọc tin nhắn (core.js)

**Files:**
- Modify: `core.js`
- Test: `tests/core.test.js`

**Interfaces:**
- Consumes: `toMillis` (đã có trong `core.js`, hàm nội bộ).
- Produces:
  - `visibleMessages(messages, options) -> Message[]` với `options = { clearedAt?: number|null, blocked?: { [uid]: number }, selfUid?: string }`. `Message` có `{ senderId, createdAt }` (`createdAt` là ms).
  - `blockTimes(blocks, selfUid) -> { [uid]: number }` với `blocks` là mảng `{ blocker, blocked, createdAt }`; trả mốc `createdAt` **nhỏ nhất** theo từng uid còn lại (bỏ qua dòng không liên quan tới `selfUid`).

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/core.test.js` (và thêm `visibleMessages, blockTimes` vào danh sách import từ `../core.js` ở đầu file):

```js
test('visibleMessages bỏ tin trước/đúng mốc xoá lịch sử', () => {
  const msgs = [{ senderId: 'a', createdAt: 100 }, { senderId: 'b', createdAt: 200 }, { senderId: 'a', createdAt: 300 }];
  assert.deepEqual(visibleMessages(msgs, { clearedAt: 200 }).map((m) => m.createdAt), [300]);
});

test('visibleMessages ẩn tin mới của người bị chặn, giữ tin trước mốc', () => {
  const msgs = [{ senderId: 'x', createdAt: 100 }, { senderId: 'x', createdAt: 300 }, { senderId: 'y', createdAt: 300 }];
  const r = visibleMessages(msgs, { blocked: { x: 200 }, selfUid: 'me' });
  assert.deepEqual(r.map((m) => m.createdAt), [100, 300]);
  assert.equal(r[1].senderId, 'y');
});

test('visibleMessages không ẩn tin của chính người xem khỏi bộ lọc chặn', () => {
  const msgs = [{ senderId: 'me', createdAt: 300 }];
  assert.equal(visibleMessages(msgs, { blocked: { me: 100 }, selfUid: 'me' }).length, 1);
});

test('visibleMessages chịu dữ liệu rỗng/không hợp lệ', () => {
  assert.deepEqual(visibleMessages(null, {}), []);
  assert.deepEqual(visibleMessages([null], {}), []);
});

test('visibleMessages trả mảng mới, không sửa mảng vào', () => {
  const msgs = [{ senderId: 'x', createdAt: 100 }];
  const out = visibleMessages(msgs, { clearedAt: 50 });
  assert.equal(out.length, 0);
  assert.equal(msgs.length, 1);
});

test('blockTimes lấy mốc chặn sớm nhất giữa hai chiều', () => {
  const blocks = [
    { blocker: 'me', blocked: 'x', createdAt: 200 },
    { blocker: 'x', blocked: 'me', createdAt: 100 },
    { blocker: 'me', blocked: 'y', createdAt: 500 }
  ];
  assert.deepEqual(blockTimes(blocks, 'me'), { x: 100, y: 500 });
});

test('blockTimes bỏ qua dòng không liên quan và dữ liệu rỗng', () => {
  assert.deepEqual(blockTimes([{ blocker: 'a', blocked: 'b', createdAt: 1 }], 'me'), {});
  assert.deepEqual(blockTimes(null, 'me'), {});
});
```

- [ ] **Step 2: Chạy test để chắc chắn thất bại**

Run: `node --test tests/core.test.js`
Expected: FAIL — `visibleMessages is not defined` (hoặc import lỗi).

- [ ] **Step 3: Cài đặt trong `core.js`**

Thêm 2 hàm export (đặt cạnh `unreadCount`/`sortMessagesAsc`):

```js
// Lọc tin hiển thị theo mốc xoá lịch sử (clearedAt, ms) và mốc chặn theo từng
// người gửi (blocked: uid -> ms). Không bao giờ ẩn tin của chính selfUid khỏi
// bộ lọc chặn. Trả mảng mới.
export function visibleMessages(messages, options) {
    var o = options || {};
    var list = Array.isArray(messages) ? messages : [];
    var cleared = toMillis(o.clearedAt);
    var blocked = o.blocked || {};
    var selfUid = o.selfUid;
    return list.filter(function (m) {
        if (!m) return false;
        var t = toMillis(m.createdAt);
        if (cleared !== null && t !== null && t <= cleared) return false;
        var sender = m.senderId;
        if (sender !== selfUid && blocked[sender] != null) {
            var bt = toMillis(blocked[sender]);
            if (t !== null && bt !== null && t > bt) return false;
        }
        return true;
    });
}

// Từ các dòng bảng blocks (createdAt là ms) suy ra mốc chặn sớm nhất theo từng
// người còn lại. Dòng không liên quan tới selfUid bị bỏ qua.
export function blockTimes(blocks, selfUid) {
    var map = {};
    (Array.isArray(blocks) ? blocks : []).forEach(function (b) {
        if (!b) return;
        var other = b.blocker === selfUid ? b.blocked : (b.blocked === selfUid ? b.blocker : null);
        if (!other) return;
        var t = toMillis(b.createdAt);
        if (t === null) return;
        if (map[other] == null || t < map[other]) map[other] = t;
    });
    return map;
}
```

- [ ] **Step 4: Chạy test để chắc chắn đạt**

Run: `node --test tests/*.test.js`
Expected: PASS toàn bộ (trước 37, thêm 7 test mới).

- [ ] **Step 5: Commit**

```bash
git add core.js tests/core.test.js
git commit -m "feat(chat): hàm thuần visibleMessages + blockTimes"
```

---

### Task 2: Schema — bảng `blocks`, `reads.cleared_at`, RLS chặn

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces (dùng bởi chat.js/REST):
  - Bảng `public.blocks(blocker uuid, blocked uuid, created_at timestamptz)` PK `(blocker, blocked)`, `check (blocker <> blocked)`.
  - Cột `public.reads.cleared_at timestamptz`.
  - Hàm `public.is_blocked(uuid, uuid) -> boolean`, `public.room_owner(text) -> uuid`, `public.can_send_to_room(text) -> boolean`.
  - Policy mới: `blocks_select` (đọc nếu là một trong hai phía), `blocks_insert` (`blocker = auth.uid()`), `blocks_delete` (`blocker = auth.uid()`).
  - Policy đổi: `messages_insert` dùng `can_send_to_room`; `room_members_insert` thêm `not is_blocked(auth.uid(), user_id)`; `room_members_update` thêm kiểm tra chặn với chủ phòng.
  - `blocks` nằm trong publication `supabase_realtime` và trong danh sách bảng bị drop-policy khi chạy lại.

- [ ] **Step 1: Thêm bảng `blocks` và cột `cleared_at`**

Trong `supabase/schema.sql`, sau khối `create table ... reads` (khoảng dòng 76-81), sửa `reads` để có cột mới và thêm bảng `blocks`:

```sql
create table if not exists public.reads (
    room_id text not null,
    user_id uuid not null,
    last_read_at timestamptz not null default now(),
    cleared_at timestamptz,
    primary key (room_id, user_id)
);

-- Cho database đã tồn tại trước khi có cột này.
alter table public.reads add column if not exists cleared_at timestamptz;

create table if not exists public.blocks (
    blocker uuid not null references auth.users(id) on delete cascade,
    blocked uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker, blocked),
    check (blocker <> blocked)
);
```

- [ ] **Step 2: Thêm hàm phụ trợ + grant**

Thêm sau hàm `owns_room` (khoảng dòng 150-162), trước `is_username_available`:

```sql
-- Có tồn tại chặn giữa a và b (bất kỳ chiều nào)?
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.blocks
        where (blocker = a and blocked = b) or (blocker = b and blocked = a)
    );
$$;

-- Chủ phòng (SECURITY DEFINER để policy đọc được mà không phụ thuộc RLS của rooms).
create or replace function public.room_owner(p_room_id text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
    select owner from public.rooms where id = p_room_id;
$$;

-- Gửi được tin vào phòng? Đọc được phòng VÀ nếu là chat riêng thì không chặn nhau.
create or replace function public.can_send_to_room(p_room_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select public.can_read_room(p_room_id)
       and (
            (select type from public.rooms where id = p_room_id) is distinct from 'direct'
            or not exists (
                select 1 from public.room_members m
                where m.room_id = p_room_id
                  and m.user_id <> auth.uid()
                  and public.is_blocked(auth.uid(), m.user_id)
            )
       );
$$;
```

Thêm grant cạnh các grant hàm hiện có (khoảng dòng 209-213):

```sql
grant execute on function public.is_blocked(uuid, uuid) to authenticated;
grant execute on function public.room_owner(text) to authenticated;
grant execute on function public.can_send_to_room(text) to authenticated;
```

- [ ] **Step 3: Bật RLS, thêm `blocks` vào drop-loop và publication**

Trong khối bật RLS (khoảng dòng 292-298) thêm:
```sql
alter table public.blocks         enable row level security;
```
Trong danh sách tablename của drop-loop (khoảng dòng 309) thêm `'blocks'`:
```sql
          and tablename in ('profiles','recovery_codes','subjects','rooms','room_members','messages','reads','blocks')
```
Trong mảng realtime (khoảng dòng 453) thêm `'blocks'`:
```sql
    foreach t in array array['rooms', 'room_members', 'messages', 'reads', 'subjects', 'profiles', 'blocks'] loop
```

- [ ] **Step 4: Đổi/thêm policy**

Thay policy `messages_insert`:
```sql
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
    for insert to authenticated
    with check (public.can_send_to_room(room_id) and sender = auth.uid());
```

Thay policy `room_members_insert`:
```sql
drop policy if exists room_members_insert on public.room_members;
create policy room_members_insert on public.room_members
    for insert to authenticated
    with check (
        public.owns_room(room_id)
        and status in ('active', 'pending')
        and not public.is_blocked(auth.uid(), user_id)
    );
```

Thay policy `room_members_update`:
```sql
drop policy if exists room_members_update on public.room_members;
create policy room_members_update on public.room_members
    for update to authenticated
    using (user_id = auth.uid() or public.owns_room(room_id))
    with check (
        (user_id = auth.uid() or public.owns_room(room_id))
        and not public.is_blocked(auth.uid(), public.room_owner(room_id))
    );
```

Thêm policy cho `blocks` (sau khối policy `reads`):
```sql
-- blocks: chỉ đọc dòng liên quan tới mình; chỉ tạo/xoá chặn của chính mình.
drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks
    for select to authenticated
    using (blocker = auth.uid() or blocked = auth.uid());

drop policy if exists blocks_insert on public.blocks;
create policy blocks_insert on public.blocks
    for insert to authenticated
    with check (blocker = auth.uid());

drop policy if exists blocks_delete on public.blocks;
create policy blocks_delete on public.blocks
    for delete to authenticated
    using (blocker = auth.uid());
```

- [ ] **Step 5: Kiểm tra cú pháp/đầy đủ (tĩnh)**

Run:
```bash
grep -c "create table if not exists public.blocks" supabase/schema.sql
grep -c "can_send_to_room" supabase/schema.sql
grep -c "blocks_select" supabase/schema.sql
grep -c "'profiles', 'blocks'" supabase/schema.sql
```
Expected: mỗi lệnh trả về số ≥ 1 (không có 0).

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(db): bảng blocks + reads.cleared_at + RLS chặn gửi/thêm thành viên"
```

- [ ] **Step 7: Người dùng chạy SQL (chặn, chờ xác nhận)**

Dặn người dùng mở https://supabase.com/dashboard/project/tofydyyvndrqvewqohfx/sql/new, dán **toàn bộ** `supabase/schema.sql`, Run. Expected: "Success. No rows returned." (Không có bước này thì Task 6 không chạy được.)

---

### Task 3: chat.js — lọc tin, xoá lịch sử, preview/sắp xếp

**Files:**
- Modify: `chat.js`

**Interfaces:**
- Consumes: `visibleMessages` từ `./core.js` (Task 1).
- Produces (dùng bởi Task 4/5):
  - Biến module `clearedMap` (`roomId -> ms`), `blockedMap` (`uid -> ms`, khởi tạo `{}`), `previewByRoom` (`roomId -> {text,senderName,senderId,createdAt}|null`).
  - `clearHistory(roomId) -> Promise<void>` (export).
  - `refreshChatViews() -> void` (nội bộ): render lại tin đang mở + danh sách phòng + thông tin nhóm.

- [ ] **Step 1: Khai báo state mới + import**

Thêm `visibleMessages` vào danh sách import từ `./core.js` (dòng 8-11). Thêm biến module cạnh `lastReadMap` (dòng 18):
```js
let clearedMap = {};        // roomId -> mốc xoá lịch sử (ms)
let blockedMap = {};        // uid -> mốc chặn sớm nhất (ms)  (Task 4 nạp dữ liệu)
let previewByRoom = {};     // roomId -> tin hiển thị gần nhất (hoặc null)
let currentMessages = [];   // tin thô của phòng đang mở
```

- [ ] **Step 2: Đọc `cleared_at` trong `subscribeReads`**

Sửa `refetch` (dòng 255-265): đổi select và lưu thêm map:
```js
const { data, error } = await client.from('reads').select('room_id, last_read_at, cleared_at').eq('user_id', uid);
if (error) { console.warn('subscribeReads:', error); return; }
const readMap = {};
const clearMap = {};
(data || []).forEach(function (r) {
    readMap[r.room_id] = r.last_read_at ? ms(r.last_read_at) : null;
    clearMap[r.room_id] = r.cleared_at ? ms(r.cleared_at) : null;
});
lastReadMap = readMap;
clearedMap = clearMap;
await recomputeUnread();
renderRoomList(roomsCache);
```

- [ ] **Step 3: Tính preview + chưa đọc trên tin đã lọc**

Sửa `recomputeUnread` (dòng 237-248) để lọc theo `clearedMap`/`blockedMap` và lưu preview:
```js
async function recomputeUnread() {
    if (!client || !currentUser) return;
    const uid = currentUser.uid;
    const token = ++unreadToken;
    const results = {};
    const previews = {};
    await Promise.all(roomsCache.map(async function (room) {
        const msgs = sortMessagesAsc(await fetchRoomMessages(room.id, 50));
        const visible = visibleMessages(msgs, {
            clearedAt: clearedMap[room.id] == null ? null : clearedMap[room.id],
            blocked: blockedMap,
            selfUid: uid
        });
        results[room.id] = room.id === currentRoomId
            ? 0
            : unreadCount(visible, lastReadMap[room.id] == null ? null : lastReadMap[room.id]);
        previews[room.id] = visible.length ? visible[visible.length - 1] : null;
    }));
    if (token !== unreadToken) return; // có lần tính mới hơn đang chạy
    unreadByRoom = results;
    previewByRoom = previews;
}
```

- [ ] **Step 4: `renderMessages` lọc theo state**

Thay `renderMessages` (dòng 789-807): lưu tin thô rồi lọc:
```js
function renderMessages(raw) {
    const el = document.getElementById('messageList');
    if (!el) return;
    currentMessages = Array.isArray(raw) ? raw : [];
    const uid = currentUser && currentUser.uid;
    const msgs = visibleMessages(currentMessages, {
        clearedAt: clearedMap[currentRoomId] == null ? null : clearedMap[currentRoomId],
        blocked: blockedMap,
        selfUid: uid
    });
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    el.innerHTML = '';
    (msgs || []).forEach(function (m) {
        // ...giữ nguyên phần tạo row như cũ...
    });
    if (nearBottom) el.scrollTop = el.scrollHeight;
}
```

- [ ] **Step 5: Preview + sắp xếp danh sách phòng theo tin hiển thị**

Trong `renderRoomList` (dòng 718-787), thay phần `split.active.forEach(...)` bằng bản đã sắp xếp lại và dùng preview đã lọc. Trước vòng lặp:
```js
const previewAt = function (room) {
    if (previewByRoom[room.id] !== undefined) return previewByRoom[room.id];
    return room.lastMessage;
};
const activeSorted = split.active.slice().sort(function (a, b) {
    const pa = previewAt(a);
    const pb = previewAt(b);
    return ((pb && pb.createdAt) || 0) - ((pa && pa.createdAt) || 0);
});
```
Trong vòng lặp dùng `activeSorted`; preview:
```js
const last = previewAt(room);
const preview = last
    ? esc(last.senderName || '') + ': ' + esc(last.text || '')
    : 'Chưa có tin nhắn';
```

- [ ] **Step 6: Hàm `clearHistory` + `refreshChatViews`**

Thêm cạnh `markRoomRead` (sau dòng 233):
```js
export async function clearHistory(roomId) {
    if (!client || !currentUser || !roomId || isPublicRoomId(roomId)) return;
    const now = new Date().toISOString();
    const { error } = await client.from('reads').upsert(
        { room_id: roomId, user_id: currentUser.uid, cleared_at: now },
        { onConflict: 'room_id,user_id' }
    );
    if (error) {
        console.warn('clearHistory:', error);
        if (typeof window.showToast === 'function') window.showToast('Không xoá được lịch sử trò chuyện.', 'error');
        return;
    }
    clearedMap[roomId] = Date.parse(now);
    refreshChatViews();
    if (roomListRefresh) roomListRefresh().catch(logErr);
    if (typeof window.showToast === 'function') window.showToast('Đã xoá lịch sử trò chuyện', 'info');
}

function refreshChatViews() {
    if (currentRoomId) renderMessages(currentMessages);
    recomputeUnread()
        .then(function () { renderRoomList(roomsCache); })
        .catch(logErr);
    const gi = document.getElementById('groupInfoModal');
    if (gi && !gi.classList.contains('hidden')) renderGroupInfo();
}
```

- [ ] **Step 7: Kiểm tra cú pháp + test hiện có**

Run: `node --check chat.js && node --test tests/*.test.js`
Expected: `node --check` không in gì (OK); test PASS.

- [ ] **Step 8: Commit**

```bash
git add chat.js
git commit -m "feat(chat): lọc tin theo mốc xoá + preview/đếm chưa đọc theo tin hiển thị"
```

---

### Task 4: chat.js — trạng thái chặn, chặn/bỏ chặn, chốt chặn server

**Files:**
- Modify: `chat.js`

**Interfaces:**
- Consumes: `blockTimes` (`./core.js`) (Task 1); `blockedMap`, `refreshChatViews` (Task 3).
- Produces (dùng bởi Task 5):
  - `blockUser(uid) -> Promise<void>`, `unblockUser(uid) -> Promise<void>` (export).
  - `blockedMap` được nạp bằng realtime; `openDirect` từ chối khi bị chặn.
  - Hàm tiện ích `otherUidOfDirect(room) -> string|null`.

- [ ] **Step 1: `refreshBlocks` + `subscribeBlocks`**

Thêm `blockTimes` vào import từ `./core.js`. Thêm biến module `let blocksUnsub = null;` cạnh các `*Unsub`. Thêm (gần `subscribeReads`, dòng 250-273):
```js
async function refreshBlocks() {
    if (!client || !currentUser) return;
    const { data, error } = await client.from('blocks').select('blocker, blocked, created_at');
    if (error) { console.warn('refreshBlocks:', error); return; }
    blockedMap = blockTimes((data || []).map(function (r) {
        return { blocker: r.blocker, blocked: r.blocked, createdAt: Date.parse(r.created_at) };
    }), currentUser.uid);
    refreshChatViews();
    setChatTitle();
    renderPickUserList();
    const gi = document.getElementById('groupInfoModal');
    if (gi && !gi.classList.contains('hidden')) renderGroupInfo();
}

function subscribeBlocks() {
    if (!client || !currentUser) return function () { };
    const uid = currentUser.uid;
    const channel = client.channel('blocks-' + uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks' },
            function () { refreshBlocks().catch(logErr); })
        .subscribe();
    refreshBlocks().catch(logErr);
    return function () { removeChannel(channel); };
}
```

- [ ] **Step 2: `blockUser` / `unblockUser` (export)**

```js
export async function blockUser(uid) {
    if (!client || !currentUser || !uid || uid === currentUser.uid) return;
    const { error } = await client.from('blocks').insert({ blocker: currentUser.uid, blocked: uid });
    if (error && error.code !== '23505') {
        console.warn('blockUser:', error);
        if (typeof window.showToast === 'function') window.showToast('Không chặn được người này.', 'error');
        return;
    }
    await refreshBlocks();
    if (typeof window.showToast === 'function') window.showToast('Đã chặn người dùng', 'info');
}

export async function unblockUser(uid) {
    if (!client || !currentUser || !uid) return;
    const { error } = await client.from('blocks').delete()
        .eq('blocker', currentUser.uid).eq('blocked', uid);
    if (error) {
        console.warn('unblockUser:', error);
        if (typeof window.showToast === 'function') window.showToast('Không bỏ chặn được.', 'error');
        return;
    }
    await refreshBlocks();
    if (typeof window.showToast === 'function') window.showToast('Đã bỏ chặn', 'info');
}

function otherUidOfDirect(room) {
    if (!room || room.type !== 'direct') return null;
    const uid = currentUser && currentUser.uid;
    const members = room.members || [];
    for (let i = 0; i < members.length; i++) if (members[i] !== uid) return members[i];
    return null;
}
```

- [ ] **Step 3: Chặn mở chat riêng với người đã chặn**

Trong `openDirect` (dòng 307), ngay sau `if (otherUid === currentUser.uid) return;`:
```js
if (blockedMap[otherUid]) {
    if (typeof window.showToast === 'function') window.showToast('Không thể nhắn tin cho người này', 'error');
    return;
}
```

- [ ] **Step 4: Ẩn người bị chặn khỏi danh bạ và danh sách thêm thành viên**

- `renderPickUserList` (dòng 345): thêm `.filter(function (u) { return !blockedMap[u.uid]; })` sau `.filter(function (u) { return u.uid !== uid; })`.
- `renderCreateGroupList` (dòng 480): thêm `.filter(function (u) { return !blockedMap[u.uid]; })`.
- `renderGroupInfo` (dòng 568-570): trong `candidates`, thêm `.filter(function (u) { return !blockedMap[u.uid]; })`.

- [ ] **Step 5: Báo lỗi khi server chặn (không im lặng)**

- `sendMessage` (dòng 211): thay nhánh lỗi:
```js
if (error) {
    console.warn('sendMessage:', error);
    if (typeof window.showToast === 'function') window.showToast('Không gửi được tin nhắn (có thể do đang chặn nhau).', 'error');
    return;
}
```
- `addGroupMembers` (dòng 428): thay nhánh lỗi để hiện toast tương tự rồi `return`.
- `acceptGroupInvite` (dòng 452): thay nhánh lỗi để hiện toast `'Không thể đồng ý lời mời này (có thể do đang chặn nhau).'` rồi `return`.

- [ ] **Step 6: Nạp/ngắt trong vòng đời**

Trong `initChat` (dòng 690-693) thêm sau `readsUnsub = subscribeReads();`:
```js
blocksUnsub = subscribeBlocks();
```
Trong `teardownChat` (dòng 696-700) thêm:
```js
if (blocksUnsub) { blocksUnsub(); blocksUnsub = null; }
```
và trong phần reset state thêm `clearedMap = {}; blockedMap = {}; previewByRoom = {}; currentMessages = [];`.

- [ ] **Step 7: Kiểm tra cú pháp + test**

Run: `node --check chat.js && node --test tests/*.test.js`
Expected: `node --check` OK; test PASS.

- [ ] **Step 8: Commit**

```bash
git add chat.js
git commit -m "feat(chat): trạng thái chặn, chặn/bỏ chặn, chốt chặn chat riêng + báo lỗi server"
```

---

### Task 5: Giao diện — menu "⋮", bấm tên người, danh sách đã chặn

**Files:**
- Modify: `index.html`, `style.css`, `chat.js`

**Interfaces:**
- Consumes: `blockUser`, `unblockUser`, `clearHistory`, `otherUidOfDirect` (Task 3-4); `blockedMap`, `directoryMap`.
- Produces:
  - Popup `#userActionMenu` + `showUserActions(anchorEl, actions)` / `hideUserActions()`.
  - Menu đầu chat `#chatMenuBtn` / `#chatMenu` / `#chatMenuClear` / `#chatMenuBlock` + `updateChatMenuBtn()`.
  - Modal `#blockedListModal` / `#blockedList`, nút `#blockedListBtn` trong `#userMenu`.

- [ ] **Step 1: Thêm icon vào sprite SVG**

Trong `index.html`, cạnh `i-info` (dòng 38-39), thêm:
```html
<symbol id="i-more" viewBox="0 0 24 24"><path d="M12 5.5h.01M12 12h.01M12 18.5h.01"/></symbol>
<symbol id="i-ban" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></symbol>
```

- [ ] **Step 2: Thêm nút "⋮" + menu vào đầu chat**

Trong `.chat-pane-head` (dòng 406-411), thay `#groupInfoBtn` hiện có bằng khối gói cả nút thông tin nhóm và nút "⋮" (để chúng nằm cùng bên phải):
```html
<div class="chat-pane-actions">
    <button type="button" id="groupInfoBtn" class="btn btn-light btn-sm hidden" title="Thông tin nhóm">
        <svg class="ico"><use href="#i-info"/></svg>
    </button>
    <button type="button" id="chatMenuBtn" class="btn btn-light btn-sm hidden" title="Tuỳ chọn" aria-haspopup="true">
        <svg class="ico"><use href="#i-more"/></svg>
    </button>
    <div id="chatMenu" class="chat-menu hidden" role="menu">
        <button type="button" id="chatMenuClear" class="chat-menu-item" role="menuitem">Xoá lịch sử trò chuyện</button>
        <button type="button" id="chatMenuBlock" class="chat-menu-item danger hidden" role="menuitem">Chặn người này</button>
    </div>
</div>
```

- [ ] **Step 3: Thêm nút "Danh sách đã chặn" vào menu tài khoản + 2 khối mới**

Trong `#userMenu`, trước `#logoutBtn` (dòng 75):
```html
<button id="blockedListBtn" class="btn btn-glass btn-sm" title="Danh sách đã chặn">
    <svg class="ico"><use href="#i-ban"/></svg>
</button>
```
Thêm 2 khối trước thẻ `</body>` (gần các modal khác, ví dụ sau `#groupInfoModal`):
```html
<div id="blockedListModal" class="modal-backdrop hidden">
    <div class="modal">
        <div class="modal-head">
            <h3>Danh sách đã chặn</h3>
            <button class="modal-close" onclick="closeModal('blockedListModal')"><svg class="ico"><use href="#i-x"/></svg></button>
        </div>
        <div class="modal-body">
            <div id="blockedList" class="pick-user-list"></div>
        </div>
    </div>
</div>

<div id="userActionMenu" class="user-action-menu hidden" role="menu"></div>
```

- [ ] **Step 4: CSS**

Thêm vào `style.css` (sau khối "Nhóm chat", cuối file):
```css
/* ---------- Menu tuỳ chọn chat + thao tác người dùng ---------- */
.chat-pane-head { position: relative; }
.chat-pane-actions { position: relative; display: flex; align-items: center; gap: 8px; }
.chat-menu {
    position: absolute; right: 0; top: calc(100% + 6px); z-index: 30;
    min-width: 200px; padding: 4px;
    background: #fff; border: 1px solid var(--border);
    border-radius: 10px; box-shadow: var(--shadow);
}
.chat-menu-item {
    display: block; width: 100%; text-align: left;
    background: none; border: none; font: inherit; font-size: 13px;
    padding: 8px 10px; border-radius: 8px; cursor: pointer; color: var(--text);
}
.chat-menu-item:hover { background: var(--soft); }
.chat-menu-item.danger { color: var(--red); }
.user-action-menu {
    position: fixed; z-index: 60; min-width: 170px; padding: 4px;
    background: #fff; border: 1px solid var(--border);
    border-radius: 10px; box-shadow: var(--shadow);
}
.user-action-item {
    display: block; width: 100%; text-align: left;
    background: none; border: none; font: inherit; font-size: 13px;
    padding: 8px 10px; border-radius: 8px; cursor: pointer; color: var(--text);
}
.user-action-item:hover { background: var(--soft); }
.user-action-item.danger { color: var(--red); }
.msg-sender-btn { background: none; border: none; padding: 0; font: inherit; cursor: pointer; }
.msg-sender-btn:hover { text-decoration: underline; }
.member-name-btn { background: none; border: none; padding: 0; font: inherit; cursor: pointer; text-align: left; }
.member-name-btn:hover { text-decoration: underline; }
```

- [ ] **Step 5: Popup hành động dùng chung + đóng menu**

Thêm vào `chat.js` (gần `wireChatUi`):
```js
function hideUserActions() {
    const menu = document.getElementById('userActionMenu');
    if (menu) { menu.classList.add('hidden'); menu.innerHTML = ''; }
}

function showUserActions(anchor, actions) {
    const menu = document.getElementById('userActionMenu');
    if (!menu || !anchor) return;
    menu.innerHTML = '';
    (actions || []).forEach(function (a) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'user-action-item' + (a.danger ? ' danger' : '');
        b.setAttribute('role', 'menuitem');
        b.textContent = a.label;
        b.addEventListener('click', function () { hideUserActions(); if (a.onClick) a.onClick(); });
        menu.appendChild(b);
    });
    menu.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - mw - 8);
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = top + 'px';
}

function userActionsFor(uid) {
    const name = (directoryMap[uid] || {}).displayName || 'Người dùng';
    const actions = [];
    if (!blockedMap[uid]) {
        actions.push({ label: 'Nhắn tin riêng', onClick: function () {
            if (typeof window.closeModal === 'function') window.closeModal('groupInfoModal');
            openDirect(uid).catch(function (e) { console.warn('openDirect:', e); });
        } });
        actions.push({ label: 'Chặn ' + name, danger: true, onClick: function () { blockUser(uid).catch(logErr); } });
    } else {
        actions.push({ label: 'Bỏ chặn ' + name, onClick: function () { unblockUser(uid).catch(logErr); } });
    }
    return actions;
}
```

- [ ] **Step 6: Menu "⋮" đầu chat**

Thêm vào `chat.js`:
```js
function updateChatMenuBtn() {
    const btn = document.getElementById('chatMenuBtn');
    const clear = document.getElementById('chatMenuClear');
    const block = document.getElementById('chatMenuBlock');
    if (!btn) return;
    const room = currentRoom();
    const type = room ? room.type : (isPublicRoomId(currentRoomId) ? 'public' : null);
    const show = type === 'direct' || type === 'group';
    btn.classList.toggle('hidden', !show);
    if (!show) {
        const menu = document.getElementById('chatMenu');
        if (menu) menu.classList.add('hidden');
        return;
    }
    if (clear) clear.classList.remove('hidden');
    if (block) {
        if (type === 'direct') {
            const other = otherUidOfDirect(room);
            block.classList.remove('hidden');
            block.textContent = (other && blockedMap[other]) ? 'Bỏ chặn' : 'Chặn người này';
        } else {
            block.classList.add('hidden');
        }
    }
}
```

- [ ] **Step 7: Nối sự kiện trong `wireChatUi`**

Thêm trong `wireChatUi` (dòng 363-379):
```js
const menuBtn = document.getElementById('chatMenuBtn');
if (menuBtn && !menuBtn.dataset.wired) {
    menuBtn.dataset.wired = '1';
    menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const menu = document.getElementById('chatMenu');
        if (menu) menu.classList.toggle('hidden');
    });
}
const clearBtn = document.getElementById('chatMenuClear');
if (clearBtn && !clearBtn.dataset.wired) {
    clearBtn.dataset.wired = '1';
    clearBtn.addEventListener('click', function () {
        const menu = document.getElementById('chatMenu');
        if (menu) menu.classList.add('hidden');
        if (currentRoomId) clearHistory(currentRoomId).catch(logErr);
    });
}
const blockBtn = document.getElementById('chatMenuBlock');
if (blockBtn && !blockBtn.dataset.wired) {
    blockBtn.dataset.wired = '1';
    blockBtn.addEventListener('click', function () {
        const menu = document.getElementById('chatMenu');
        if (menu) menu.classList.add('hidden');
        const room = currentRoom();
        const other = otherUidOfDirect(room);
        if (!other) return;
        if (blockedMap[other]) unblockUser(other).catch(logErr);
        else blockUser(other).catch(logErr);
    });
}
const blockedBtn = document.getElementById('blockedListBtn');
if (blockedBtn && !blockedBtn.dataset.wired) {
    blockedBtn.dataset.wired = '1';
    blockedBtn.addEventListener('click', function () {
        renderBlockedList();
        if (typeof window.openModal === 'function') window.openModal('blockedListModal');
    });
}
```

- [ ] **Step 8: `renderBlockedList`**

Thêm vào `chat.js`:
```js
function renderBlockedList() {
    const el = document.getElementById('blockedList');
    if (!el) return;
    el.innerHTML = '';
    const uids = Object.keys(blockedMap);
    if (!uids.length) {
        el.innerHTML = '<div class="pick-user-empty">Bạn chưa chặn ai.</div>';
        return;
    }
    uids.forEach(function (uid) {
        const name = (directoryMap[uid] || {}).displayName || 'Người dùng';
        const row = document.createElement('div');
        row.className = 'group-member-row';
        const span = document.createElement('span');
        span.className = 'pick-user-name';
        span.textContent = name;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-light btn-sm';
        btn.textContent = 'Bỏ chặn';
        btn.addEventListener('click', function () { unblockUser(uid).then(renderBlockedList).catch(logErr); });
        row.appendChild(span);
        row.appendChild(btn);
        el.appendChild(row);
    });
}
```

- [ ] **Step 9: Bấm tên người gửi trong tin nhắn**

Trong `renderMessages` (đã sửa ở Task 3), đổi dòng tên người gửi cho tin không phải của mình:
```js
(m.senderId === uid ? '' : '<button type="button" class="msg-sender msg-sender-btn" data-uid="' + esc(m.senderId) + '">' + esc(m.senderName || '') + '</button>') +
```
Sau vòng lặp tạo row, thêm gắn sự kiện (event delegation):
```js
el.querySelectorAll('.msg-sender-btn').forEach(function (b) {
    b.addEventListener('click', function (e) {
        e.stopPropagation();
        showUserActions(b, userActionsFor(b.dataset.uid));
    });
});
```

- [ ] **Step 10: Bấm tên thành viên trong "Thông tin nhóm"**

Trong `renderGroupInfo` (dòng 526-528), thay dòng tạo tên thành viên bằng nút bấm được:
```js
const nameBtn = document.createElement('button');
nameBtn.type = 'button';
nameBtn.className = 'pick-user-name member-name-btn';
nameBtn.textContent = (info.displayName || 'Người dùng') + (isMe ? ' (bạn)' : '');
row.appendChild(nameBtn);
if (!isMe) {
    nameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        showUserActions(nameBtn, userActionsFor(m));
    });
}
```
(Giữ nguyên nút xoá/huỷ của chủ nhóm thêm vào `row` sau đó.)

- [ ] **Step 11: Gọi `updateChatMenuBtn` + đóng menu khi bấm ra ngoài**

- Gọi `updateChatMenuBtn();` ở cuối `renderRoomList` (cạnh `updateGroupInfoBtn();`, dòng 784) và trong `openRoom` (sau `setChatTitle();`, dòng 191).
- Thêm listener toàn cục (cạnh khối `document.addEventListener('submit', ...)`, dòng 820):
```js
if (typeof document !== 'undefined') {
    document.addEventListener('click', function () { hideUserActions(); const m = document.getElementById('chatMenu'); if (m) m.classList.add('hidden'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideUserActions(); const m = document.getElementById('chatMenu'); if (m) m.classList.add('hidden'); } });
}
```

- [ ] **Step 12: Kiểm tra cú pháp + test + smoke**

Run: `node --check chat.js && node --test tests/*.test.js`
Expected: OK; PASS.
Run smoke (nếu đã có script): `node /tmp/opencode/smoke-deploy.mjs` — Expected: TẤT CẢ PASS (không lỗi console mới).

- [ ] **Step 13: Commit**

```bash
git add index.html style.css chat.js
git commit -m "feat(chat): UI menu ⋮, bấm tên để nhắn/chặn, danh sách đã chặn"
```

---

### Task 6: Kiểm chứng tích hợp + tài liệu

**Files:**
- Test: `/tmp/opencode/verify-block.mjs` (ngoài repo)
- Modify: `docs/superpowers/specs/2026-11-05-chat-clear-history-and-block-design.md` (đổi "chờ duyệt" → "đã duyệt, đã làm")

**Interfaces:**
- Consumes: schema đã chạy (Task 2 Step 7); app đã deploy hoặc chạy local.

- [ ] **Step 1: Chạy toàn bộ unit test**

Run: `node --test tests/*.test.js`
Expected: PASS (37 + 7 = 44 test).

- [ ] **Step 2: Viết script REST kiểm chứng RLS**

Tạo `/tmp/opencode/verify-block.mjs` (mẫu tham khảo `/tmp/opencode/verify-consent.mjs`), đăng ký 3 tài khoản tạm (A, B, C) qua Supabase Auth anon, rồi khẳng định:
- A và B tạo phòng direct + gửi tin → **thành công**.
- A chặn B (`blocks` insert) → **201/204**.
- Sau khi chặn: A insert tin vào phòng direct A-B → **403** (`42501`); B insert cùng phòng → **403**.
- B thêm A vào nhóm (owner B insert `room_members` user A) → **403**.
- B "Đồng ý" lời mời cũ (update `room_members` của B trong nhóm do A làm chủ) → **403**.
- A bỏ chặn (`blocks` delete) → sau đó A gửi tin lại → **thành công**.
- A xoá lịch sử (`reads.upsert {cleared_at}`) → đọc lại thấy `cleared_at` khác null; B vẫn đọc được tin cũ (không đổi).
In ra `PASS/FAIL` từng mục và tổng kết.

- [ ] **Step 3: Chạy script kiểm chứng**

Run: `node /tmp/opencode/verify-block.mjs`
Expected: tất cả PASS. Nếu 403 không xuất hiện → schema chưa chạy đúng; quay lại Task 2 Step 7.

- [ ] **Step 4: Smoke tải trang + console**

Run: `node /tmp/opencode/smoke-deploy.mjs`
Expected: TẤT CẢ PASS (chỉ còn cảnh báo favicon 404).

- [ ] **Step 5: Cập nhật trạng thái spec + commit cuối**

Sửa dòng trạng thái trong spec thành "đã duyệt, đã triển khai". Commit:
```bash
git add docs/superpowers/specs/2026-11-05-chat-clear-history-and-block-design.md docs/superpowers/plans/2026-11-05-chat-clear-history-and-block.md
git commit -m "docs: đánh dấu hoàn thành feature xoá lịch sử + chặn"
```

- [ ] **Step 6: Nhắc việc bảo mật còn treo**

Nhắc người dùng (không phải việc của agent): revoke token GitHub đã lộ; revoke khoá Supabase `sb_secret_...`; đặt Site URL/Redirect URLs = `https://qacg-hub.github.io/unischedule-ai/`.

---

## Ghi chú cho người thực thi

- Tất cả giao diện bằng tiếng Việt, dùng lại `.btn`, `.modal`, `.pick-user-list`, `.group-member-row` sẵn có để giữ nguyên phong cách.
- `reads.upsert` chỉ cập nhật cột được cung cấp, nên `cleared_at` không bị `markRoomRead` ghi đè và ngược lại.
- Ở nhóm/kênh chung, người bị chặn vẫn gửi được cho người khác; chỉ người chặn không thấy tin mới của họ.
- Không tạo bảng mới cho mốc xoá; dùng `reads.cleared_at`.
- Nếu Realtime không giao dòng `blocks` (kiểm tra RLS publication), `refreshBlocks` vẫn chạy sau mỗi lần chặn/bỏ chặn cục bộ; chỉ tình huống người kia chặn bạn mới cần realtime.
