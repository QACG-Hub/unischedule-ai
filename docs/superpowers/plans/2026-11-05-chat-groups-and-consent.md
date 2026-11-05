# Kế hoạch: Sửa chat riêng + Tạo nhóm, tìm theo tên, mời thành viên cần đồng ý

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa lỗi chat riêng & tạo nhóm (RLS lỗi thời), thêm ô tìm theo tên khi tạo nhóm, và yêu cầu người được thêm vào nhóm phải đồng ý.

**Architecture:** Giữ nguyên vanilla JS + Supabase. Migration `supabase/schema.sql` tự xoá & tạo lại mọi policy để tự sửa DB lỗi thời, đồng thời thêm cột `room_members.status` cho luồng đồng ý. Logic phân loại phòng (lời mời vs đang tham gia) đưa vào `core.js` để test bằng `node --test`; UI/REST nằm trong `chat.js`.

**Tech Stack:** Vanilla ES modules, Supabase (Postgres + RLS + Realtime), Node 22 test runner, Chromium headless (đo DOM).

**Spec:** `docs/superpowers/specs/2026-11-05-chat-groups-and-consent-design.md`

## Global Constraints

- Nền tĩnh, không framework/bundler; chạy qua http(s).
- Giao diện tiếng Việt.
- Giữ nguyên giao diện chat và chữ ký các hàm export của `chat.js` (main.js phải chạy nguyên).
- `supabase/schema.sql` phải chạy lại được nhiều lần (idempotent).
- Test: `node --test tests/*.test.js` (Node 22).
- KHÔNG ghi service_role key vào repo.

## Review Focus

- Hai người cùng mở chat riêng một lúc → cả hai phải ở trong phòng và gửi được tin.
- Mời lại người đã là thành viên active → giữ `active`, không hạ về `pending`.
- Người `pending` cố đọc/gửi tin → phải bị RLS chặn.
- Người không phải chủ nhóm cố thêm thành viên → phải bị chặn.
- Từ chối lời mời rồi được mời lại → vẫn đồng ý được.
- Chủ nhóm xoá/cascade nhóm có lời mời đang chờ → không để lại dòng mồ côi.

---

### Task 1: Migration DB — cột `status`, policy tự lành, luồng đồng ý

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: (không)
- Produces:
  - Cột `public.room_members.status text not null default 'active'` với constraint `check (status in ('active','pending'))`.
  - Hàm `public.is_room_member(p_room_id text)` → chỉ `status='active'`.
  - Hàm `public.can_read_room(p_room_id text)` → `public` hoặc thành viên `active`.
  - Hàm `public.is_invited(p_room_id text)` → mình đang `pending`.
  - Policy `room_members_update` (mới) + trigger `guard_room_member_update`.
  - `rooms_select` cho phép người `is_invited` thấy phòng.

- [ ] **Step 1: Thêm cột `status` (idempotent)**

Chèn ngay sau block `create table ... public.room_members (...)`:

```sql
alter table public.room_members
    add column if not exists status text not null default 'active';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'room_members_status_check'
    ) then
        alter table public.room_members
            add constraint room_members_status_check check (status in ('active', 'pending'));
    end if;
end $$;
```

- [ ] **Step 2: Cập nhật `is_room_member` và `can_read_room`, thêm `is_invited`**

Trong `is_room_member`: thêm `and status = 'active'` vào `where`.
Trong `can_read_room`: thêm `and m.status = 'active'` vào subquery `room_members`.

Thêm hàm mới cạnh `owns_room`:

```sql
create or replace function public.is_invited(p_room_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.room_members
        where room_id = p_room_id and user_id = auth.uid() and status = 'pending'
    );
$$;
```

Và grant: `grant execute on function public.is_invited(text) to authenticated;`

- [ ] **Step 3: Thêm trigger chặn đổi `room_id`/`user_id`**

```sql
create or replace function public.guard_room_member_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.room_id <> old.room_id or new.user_id <> old.user_id then
        raise exception 'Không được đổi phòng/người của thành viên';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_guard_room_member_update on public.room_members;
create trigger trg_guard_room_member_update
    before update on public.room_members
    for each row execute function public.guard_room_member_update();
```

- [ ] **Step 4: Thêm block xoá động mọi policy cũ trước khi tạo policy**

Đặt ngay trước phần `-- Policy` (sau khi bật RLS):

```sql
-- Xoá mọi policy cũ trên các bảng liên quan để migration tự lành.
do $$
declare r record;
begin
    for r in
        select policyname, tablename from pg_policies
        where schemaname = 'public'
          and tablename in ('profiles','recovery_codes','subjects','rooms','room_members','messages','reads')
    loop
        execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    end loop;
end $$;
```

- [ ] **Step 5: Cập nhật policy `rooms_select` và `room_members_*`**

- `rooms_select` → `using (type = 'public' or public.is_room_member(id) or public.is_invited(id))`.
- `room_members_select` → `using (public.can_read_room(room_id) or user_id = auth.uid() or public.owns_room(room_id))`.
- `room_members_insert` → `with check (public.owns_room(room_id) and status in ('active','pending'))`.
- Thêm mới `room_members_update`:
```sql
drop policy if exists room_members_update on public.room_members;
create policy room_members_update on public.room_members
    for update to authenticated
    using (user_id = auth.uid() or public.owns_room(room_id))
    with check (user_id = auth.uid() or public.owns_room(room_id));
```
- Giữ nguyên `room_members_delete`.

- [ ] **Step 6: Người dùng chạy migration**

Hướng dẫn người dùng: Supabase Dashboard → SQL Editor → dán toàn bộ `supabase/schema.sql` → **Run**. (Không thể chạy SQL bằng anon key từ CLI.)

- [ ] **Step 7: Kiểm chứng migration trên DB thật**

Chạy `node /tmp/opencode/verify-consent.mjs` (viết ở Task 5). Kỳ vọng:
- Tạo phòng direct → không còn 403; B đọc được tin của A.
- Tạo nhóm: A chủ `active`, B `pending`; B **không** đọc được tin; B accept → đọc được.
- B (không phải chủ) thêm người → 403.

- [ ] **Step 8: Commit**

```bash
git add supabase/schema.sql
git commit -m "fix(db): migration tự lành + luồng đồng ý thành viên nhóm"
```

---

### Task 2: Hàm thuần `partitionRooms` + test

**Files:**
- Modify: `core.js`
- Test: `tests/core.test.js`

**Interfaces:**
- Consumes: (không)
- Produces: `partitionRooms(rooms, uid) -> { invites: Room[], active: Room[] }`, trong đó `Room.myStatus` là trạng thái thành viên của `uid` (`'active'`/`'pending'`); phòng thiếu `myStatus` coi như `active`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/core.test.js` (import `partitionRooms`):

```js
test('partitionRooms tách lời mời pending khỏi phòng đang tham gia', () => {
  const rooms = [
    { id: 'g1', myStatus: 'pending' },
    { id: 'g2', myStatus: 'active' },
    { id: 'pub' }
  ];
  const r = partitionRooms(rooms, 'u1');
  assert.deepEqual(r.invites.map(x => x.id), ['g1']);
  assert.deepEqual(r.active.map(x => x.id), ['g2', 'pub']);
});
```

- [ ] **Step 2: Chạy test để chắc chắn fail**

Run: `node --test tests/core.test.js`
Expected: FAIL vì `partitionRooms` chưa được export/định nghĩa.

- [ ] **Step 3: Cài đặt `partitionRooms` trong `core.js`**

```js
// Tách danh sách phòng: lời mời đang chờ (myStatus='pending') và phòng đã tham gia.
export function partitionRooms(rooms, uid) {
    var invites = [];
    var active = [];
    (Array.isArray(rooms) ? rooms : []).forEach(function (room) {
        if (room && room.myStatus === 'pending') invites.push(room);
        else if (room) active.push(room);
    });
    return { invites: invites, active: active };
}
```

Export nó trong danh sách `export function` (đặt cạnh `roomLabel`).

- [ ] **Step 4: Chạy test**

Run: `node --test tests/*.test.js`
Expected: PASS toàn bộ (36 test).

- [ ] **Step 5: Commit**

```bash
git add core.js tests/core.test.js
git commit -m "feat(chat): thêm partitionRooms tách lời mời nhóm + test"
```

---

### Task 3: Markup ô tìm khi tạo nhóm

**Files:**
- Modify: `index.html:565`

**Interfaces:**
- Consumes: (không)
- Produces: phần tử `#groupSearch` (input) ngay trên `#groupMemberList`.

- [ ] **Step 1: Thêm input tìm kiếm**

Trong `#createGroupModal`, thay:

```html
<label class="label" style="margin-top:12px">Chọn thành viên</label>
<div id="groupMemberList" class="pick-user-list"></div>
```

bằng:

```html
<label class="label" style="margin-top:12px">Chọn thành viên</label>
<input type="text" id="groupSearch" class="input" placeholder="Tìm theo tên..." autocomplete="off">
<div id="groupMemberList" class="pick-user-list"></div>
```

- [ ] **Step 2: Kiểm tra DOM**

Run: `grep -c 'id="groupSearch"' index.html`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(chat): thêm ô tìm thành viên trong màn tạo nhóm"
```

---

### Task 4: `chat.js` — tìm kiếm, trạng thái pending, đồng ý/từ chối

**Files:**
- Modify: `chat.js`

**Interfaces:**
- Consumes: `partitionRooms` từ `core.js` (Task 2); cột `room_members.status` (Task 1); `#groupSearch` (Task 3).
- Produces (export mới): `acceptGroupInvite(roomId)`, `declineGroupInvite(roomId)`.

- [ ] **Step 1: Import `partitionRooms`**

Thêm `partitionRooms` vào import từ `./core.js`.

- [ ] **Step 2: `createGroup` — chủ `active`, người được mời `pending`**

Thay dòng tạo `rows`:

```js
const rows = ids.map(function (m) {
    return { room_id: data.id, user_id: m, status: m === uid ? 'active' : 'pending' };
});
```

- [ ] **Step 3: `addGroupMembers` — chèn `pending`**

Đổi rows thành `{ room_id: roomId, user_id: m, status: 'pending' }`. Sau khi thêm, hiển thị toast: `window.showToast('Đã gửi lời mời tham gia nhóm', 'info')`.

- [ ] **Step 4: `openDirect` — upsert phòng + hai thành viên `active`**

Đổi `insert` phòng thành `upsert({...}, { onConflict: 'id', ignoreDuplicates: true })`; giữ members như cũ (mặc định `active`).

- [ ] **Step 5: Thêm thao tác chấp nhận / từ chối lời mời**

```js
export async function acceptGroupInvite(roomId) {
    if (!client || !currentUser || !roomId) return;
    const { error } = await client.from('room_members')
        .update({ status: 'active' })
        .eq('room_id', roomId).eq('user_id', currentUser.uid);
    if (error) { console.warn('acceptGroupInvite:', error); return; }
    if (roomListRefresh) await roomListRefresh().catch(logErr);
    openRoom(roomId);
}

export async function declineGroupInvite(roomId) {
    if (!client || !currentUser || !roomId) return;
    const { error } = await client.from('room_members')
        .delete().eq('room_id', roomId).eq('user_id', currentUser.uid);
    if (error) { console.warn('declineGroupInvite:', error); return; }
    if (roomListRefresh) await roomListRefresh().catch(logErr);
}
```

- [ ] **Step 6: `subscribeRoomList` — lấy `status`, dựng `myStatus`/pendingMembers**

- `mineRes`: `client.from('room_members').select('status, rooms(*)').eq('user_id', uid)`.
- `membersRes`: `client.from('room_members').select('room_id, user_id, status')`.
- Dựng `membersMap` (chỉ `status==='active'`), `pendingMap` (chỉ `'pending'`), `myStatusMap` (dòng của `uid`).
- Gọi `mapRoom(row, membersMap, pendingMap, myStatusMap)`.

`mapRoom` bổ sung:

```js
function mapRoom(row, membersMap, pendingMap, myStatusMap) {
    const members = membersMap[row.id] || [];
    return {
        id: row.id, type: row.type, name: row.name, ownerId: row.owner,
        members: members,
        pendingMembers: pendingMap[row.id] || [],
        myStatus: myStatusMap[row.id] || 'active',
        lastMessage: row.last_message_at ? { /* giữ nguyên */ } : null
    };
}
```

- [ ] **Step 7: `renderRoomList` — hiện lời mời ở trên, có nút Đồng ý/Từ chối**

Dùng `partitionRooms(list, uid)`. Với mỗi phòng trong `invites`, render mục có nhãn `Lời mời: <tên nhóm>`, kèm 2 nút gọi `acceptGroupInvite`/`declineGroupInvite` (dùng `item.addEventListener`, không inline onclick). Sau đó render `active` như cũ.

- [ ] **Step 8: `openRoom` — bỏ qua phòng đang pending**

Đầu hàm: nếu phòng trong `roomsCache` có `myStatus === 'pending'` thì `return`.

- [ ] **Step 9: `renderGroupInfo` — thành viên active + đang chờ (chủ thấy)**

Với chủ nhóm, sau danh sách active, render thêm các `pendingMembers` với nhãn `(đang chờ)` và nút huỷ (gọi `removeGroupMember`).

- [ ] **Step 10: `renderCreateGroupList` + wire ô tìm `#groupSearch`**

- `renderCreateGroupList`: lọc `directoryUsers` (trừ mình) qua `filterDirectory(users, q)` với `q = #groupSearch.value`.
- Trong `wireGroupUi`, khi mở modal reset `#groupSearch.value=''`; thêm listener `input` gọi `renderCreateGroupList`.

- [ ] **Step 11: Giữ checkbox đã chọn khi lọc**

Không cần: mỗi lần lọc dựng lại danh sách. Chấp nhận đơn giản (chọn xong bấm Tạo nhóm; nếu cần giữ, ghi chú lại). OK theo phạm vi.

- [ ] **Step 12: Kiểm tra cú pháp + toàn bộ test**

Run:
```bash
cp chat.js /tmp/opencode/chat.mjs && node --check /tmp/opencode/chat.mjs && node --test tests/*.test.js
```
Expected: không lỗi cú pháp; test PASS.

- [ ] **Step 13: Commit**

```bash
git add chat.js
git commit -m "feat(chat): tìm thành viên khi tạo nhóm + mời cần đồng ý"
```

---

### Task 5: Kịch bản kiểm chứng end-to-end trên Supabase thật

**Files:**
- Create: `/tmp/opencode/verify-consent.mjs` (không commit — chứa thông tin tài khoản test)

**Interfaces:**
- Consumes: DB đã migrate (Task 1).
- Produces: bằng chứng HTTP cho từng kịch bản.

- [ ] **Step 1: Viết script**

Tạo 3 tài khoản test A/B/C qua `/auth/v1/signup`; rồi:
1. A tạo direct với B, A gửi tin, B đọc tin (kỳ vọng 200, có tin).
2. A tạo group, thêm B (pending). Kiểm tra: B đọc tin → rỗng; B cập nhật `status='active'` cho dòng của mình → 200; A gửi tin → B đọc được.
3. Mời lại B (đang active) → vẫn `active` (không hạ pending).
4. B (không phải chủ nhóm của A) thêm C vào nhóm A → 403.
5. B từ chối (xoá dòng) rồi được mời lại → accept được.

- [ ] **Step 2: Chạy**

Run: `node /tmp/opencode/verify-consent.mjs`
Expected: tất cả kịch bản PASS; in ra email tài khoản test để người dùng xoá.

- [ ] **Step 3: Báo người dùng xoá tài khoản test + thu hồi khoá đã lộ**

Nhắc xoá các tài khoản `zzz*@example.com` và thu hồi `sb_secret_...`.

---

### Task 6: Kiểm chứng giao diện bằng Chromium headless

**Files:**
- (không đổi file repo)

- [ ] **Step 1: Chụp màn tạo nhóm + danh sách lời mời**

Dùng CDP (đã có mẫu `/tmp/opencode/cdp*.mjs`): mở app, vào tab Trò chuyện, mở màn tạo nhóm → xác nhận ô tìm hiển thị; kiểm tra `docScrollWidth == viewport` ở 390/1280.

- [ ] **Step 2: Chạy lại test + cây sạch**

Run: `node --test tests/*.test.js && git status --short`
Expected: test PASS; cây sạch.
