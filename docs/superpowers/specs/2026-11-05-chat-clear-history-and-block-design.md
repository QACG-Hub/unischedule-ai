# Thiết kế: Xoá lịch sử trò chuyện (cho riêng mình) + Chặn người dùng

**Ngày:** 2026-11-05
**Trạng thái:** chờ người dùng duyệt
**Phương án đã chọn:** Cách 1 — chặn hành động ở server (RLS), ẩn tin ở client.

## Vấn đề / yêu cầu

1. Người dùng tự **xoá lịch sử** của một cuộc trò chuyện, **chỉ cho riêng mình**.
   - Áp dụng cho **chat riêng 1-1** và **nhóm**.
   - **Không** áp dụng cho kênh chat chung.
2. **Chặn** một người, một chiều khi bấm nhưng hiệu lực **hai phía**:
   - Hai người **không chat riêng 1-1** với nhau được nữa.
   - **Không ai thêm được người kia vào nhóm.**
   - **Ẩn tin mới** của người kia ở **nhóm và kênh chung** (cả hai phía).
   - **Vẫn xem lại được lịch sử trước thời điểm chặn.**
   - Có nút **Bỏ chặn** và danh sách những người đã chặn.

## Mục tiêu

- Thêm 2 tính năng trên mà **không đổi giao diện hiện có** (chỉ thêm nút/menu).
- Giữ nguyên `core.js` về hành vi cũ, chỉ **thêm hàm thuần** (để test).
- Dữ liệu đồng bộ theo tài khoản (mở máy khác vẫn đúng).
- Chặn ở tầng dữ liệu cho các hành động không thể lách (gửi tin 1-1, thêm người vào nhóm).

## Ngoài phạm vi (non-goals)

- Không xoá tin của người khác; "xoá lịch sử" chỉ là **ẩn theo góc nhìn của mình**.
- Không ẩn tin **cũ** (trước mốc chặn) — yêu cầu nói rõ vẫn xem được.
- Không thông báo đẩy/email khi bị chặn.
- Không làm policy `SELECT` theo thời gian cho `messages` (đó là Cách 2, đã loại).
- Không chặn việc tạo phòng direct rỗng giữa hai người đã chặn (chặn thật ở gửi tin + thêm thành viên).

## Anti-goals (làm xong vẫn coi như hỏng)

- Người bị chặn vẫn gửi được tin 1-1, hoặc vẫn bị thêm vào nhóm.
- Chặn/xoá lịch sử làm mất tin của người khác.
- Ẩn nhầm tin cũ trước mốc chặn.

## Ràng buộc

- Web tĩnh (HTML/CSS/JS thuần), không framework/bundler; Supabase free.
- Giao diện tiếng Việt. Nền tảng giữ nguyên: `index.html`, `style.css`, `chat.js`, `core.js`, `schema.sql`.
- RLS là lớp bảo vệ chính; không tin client.
- `supabase/schema.sql` phải **idempotent** (chạy lặp an toàn), theo nếp hiện có.

## Phương án đã cân nhắc

- **Cách 1 (chọn):** server chặn các hành động (RLS cho `messages` insert, `room_members` insert), client ẩn tin theo mốc thời gian.
  - Ưu: ít rủi ro, không đụng Realtime, làm nhanh. Trong nhóm ai cũng đọc được tin nên "ẩn" bản chất là hiển thị.
  - Nhược: tin bị ẩn vẫn nằm trong DB (nhưng tin cũ vẫn phải xem được, và người bị chặn vốn là tác giả tin của họ).
- **Cách 2 (loại):** thêm policy `SELECT` cho `messages` lọc theo `blocks` + mốc thời gian. Kín hơn nhưng policy thời gian phức tạp, dễ vỡ Realtime, khó sửa.

## Thiết kế dữ liệu

### Bảng mới `public.blocks`

```sql
create table if not exists public.blocks (
    blocker uuid not null references auth.users(id) on delete cascade,
    blocked uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker, blocked),
    check (blocker <> blocked)
);
```

Một dòng = một lần chặn (một chiều). Hiệu lực hai phía được suy ra bằng hàm `is_blocked`.

### Mốc xoá lịch sử: thêm cột vào `public.reads`

```sql
alter table public.reads add column if not exists cleared_at timestamptz;
```

Lý do: `reads` đã keyed `(room_id, user_id)` và đã có policy `reads_all` cho người dùng tự quản lý dòng của mình; thêm cột rẻ hơn tạo bảng + policy mới. `markRoomRead` chỉ upsert `last_read_at` nên **không ghi đè** `cleared_at`.

### Hàm phụ trợ (SECURITY DEFINER, stable)

```sql
-- Có tồn tại chặn giữa a và b (bất kỳ chiều)?
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
    select exists (
        select 1 from public.blocks
        where (blocker = a and blocked = b) or (blocker = b and blocked = a)
    );
$$;

-- Gửi được tin vào phòng? (đọc được phòng VÀ nếu là direct thì không bị chặn)
create or replace function public.can_send_to_room(p_room_id text)
returns boolean language sql security definer stable set search_path = public as $$
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

### RLS

- `messages_insert` (đổi): `with check (public.can_send_to_room(room_id) and sender = auth.uid())`.
- `room_members_insert` (đổi): `with check (public.owns_room(room_id) and status in ('active','pending') and not public.is_blocked(auth.uid(), user_id))`.
- `room_members_update` (đổi): thêm điều kiện chặn — `with check ((user_id = auth.uid() or public.owns_room(room_id)) and not public.is_blocked(auth.uid(), (select owner from public.rooms where id = room_id)))`. Nhờ đó "Đồng ý" lời mời giữa hai người đang chặn nhau bị từ chối.
- `blocks_select` (mới): `using (blocker = auth.uid() or blocked = auth.uid())`.
- `blocks_insert` (mới): `with check (blocker = auth.uid())`.
- `blocks_delete` (mới): `using (blocker = auth.uid())`.
- `reads` giữ policy `reads_all` `(user_id = auth.uid())`; cột `cleared_at` đi kèm.
- Bật RLS cho `blocks`.

Ghi chú: `rooms_insert` **không** đổi (lúc tạo phòng chưa biết thành viên kia); chặn thật nằm ở `room_members_insert` + `messages_insert` + kiểm tra client trong `openDirect`.

## Luồng ứng dụng (chat.js)

### Tải trạng thái theo người dùng

- `subscribeReads`: đổi select thành `room_id, last_read_at, cleared_at` → lưu thêm `clearedMap` (roomId → ms).
- Thêm `subscribeBlocks` (kênh realtime `blocks` theo `blocker=eq.uid`/`blocked=eq.uid` không lọc được OR — dùng bảng `blocks` không filter rồi tự lọc, hoặc nghe cả bảng). Lưu `blockedMap` (uid → mốc chặn sớm nhất, ms).
  - Mốc chặn dùng để giới hạn ẩn tin: `blockTime = min(created_at)` giữa hai chiều.

### Xoá lịch sử (cho riêng mình)

- Nút chỉ hiện khi `room.type` là `direct` hoặc `group` (ẩn ở `public`).
- Bấm → `reads.upsert({ room_id, user_id, cleared_at: now }, { onConflict: 'room_id,user_id' })`.
- Lọc hiển thị: chỉ hiện tin có `createdAt > clearedAt` của phòng.
- Danh sách phòng: preview chỉ hiện khi `lastMessage.createdAt > clearedAt`; ngược lại "Chưa có tin nhắn".
- Chưa đọc: lọc tin trước khi đếm (dùng chung hàm lọc).
- Đồng bộ: `subscribeReads` phát lại → tính lại.

### Chặn / Bỏ chặn

- **Chặn:** `blocks.insert({ blocker: me, blocked: uid })`.
- **Bỏ chặn:** `blocks.delete().eq('blocker', me).eq('blocked', uid)`.
- **Ẩn tin:** khi render tin ở BẤT KỲ phòng nào, bỏ tin có `senderId` nằm trong `blockedMap` **và** `createdAt > blockTime`. Tin cũ hơn mốc vẫn hiện.
- **Preview danh sách phòng:** cũng ẩn tin của người bị chặn. Dòng xem trước lấy tin **hiển thị được** gần nhất (không dùng thẳng `rooms.last_message_*`) và sắp xếp phòng lại theo tin đó. Nếu không còn tin hiển thị → "Chưa có tin nhắn".
- **Người bị chặn không gửi được tin:** ở DM, RLS chặn cứng cả hai chiều (không gửi được). Ở nhóm/kênh chung, họ vẫn gửi được cho người khác nhưng tin của họ bị **ẩn** khỏi người chặn.
- **Không chat riêng:** `openDirect` kiểm tra `blockedMap` → nếu có, toast "Không thể nhắn tin cho người này" và dừng.
- **Danh bạ:** ẩn người trong `blockedMap` khỏi `#pickUserModal` và danh sách "thêm vào nhóm".
- **Danh sách đã chặn:** trong menu tài khoản → modal mới, mỗi dòng có nút "Bỏ chặn".
- **Server chặn cứng:** nếu vẫn gửi DM / thêm thành viên, RLS trả lỗi; client hiện toast lỗi (không im lặng như hiện tại).

## Giao diện (điểm chạm)

- `#chatPane` header: thêm nút "⋮" `#chatMenuBtn` (chỉ hiện với direct/group). Mở menu nhỏ:
  - "Xoá lịch sử trò chuyện"
  - "Chặn người này" (chỉ direct)
- **Kênh chat chung** (và mọi phòng): bấm vào **tên người gửi** trong một tin nhắn → menu nhỏ có "Chặn &lt;tên&gt;". Đây là chỗ chặn từ kênh chung (không cần nút "⋮" ở đây).
- `#groupInfoModal`: mỗi thành viên (khác mình) có nút "Chặn".
- `#pickUserModal` + danh sách thêm thành viên: ẩn người đã chặn.
- `#userMenu`: thêm nút "Danh sách đã chặn" → modal mới `#blockedListModal`.
- `style.css`: thêm `.chat-menu*`, `.blocked-*`, `.msg-sender-btn` (theo biến CSS hiện có, hỗ trợ màn hình nhỏ).

## Logic thuần mới (core.js, test `node --test`)

- `visibleMessages(messages, options)`:
  - `options.clearedAt` (ms hoặc null): bỏ tin `createdAt <= clearedAt`.
  - `options.blocked` (`{ uid: blockTimeMs }`): bỏ tin có `senderId` trong map và `createdAt > blockTime`.
  - `options.selfUid`: không bao giờ ẩn tin của chính uid này.
  - Trả mảng mới, không sửa mảng vào.
- `unreadCount` hiện có dùng trên mảng **đã lọc**.
- `directRoomId`, `roomLabel`, `partitionRooms` giữ nguyên.

## Quyết định của người viết (builder's calls)

1. Lưu mốc xoá trong `reads.cleared_at` thay vì bảng riêng (ít code, tận dụng RLS sẵn có).
2. Mốc ẩn tin = mốc chặn **sớm nhất** giữa hai người → giữ được toàn bộ lịch sử trước lần chặn đầu.
3. `blocks_select` cho phép đọc cả chiều "bị chặn" → người bị chặn biết mình bị chặn. Chấp nhận để tính năng ẩn tin hoạt động được ở client.
4. Không enforce việc tạo phòng direct rỗng giữa hai người đã chặn.
5. Nút/menu mới đặt trong header chat, thông tin nhóm, **tên người gửi trong tin nhắn (kênh chung)** và menu tài khoản như mục "Giao diện".
6. Preview danh sách phòng ẩn tin bị chặn; lấy tin hiển thị được gần nhất và sắp xếp lại (không dùng thẳng `rooms.last_message_*`).
7. Chặn từ kênh chung thực hiện bằng bấm tên người gửi (không thêm nút "⋮" cho phòng chung).
8. Người bị chặn: DM bị chặn cứng hai chiều; ở nhóm/kênh chung tin bị ẩn khỏi người chặn (không cấm họ gửi cho người khác).
9. Bỏ chặn rồi chặn lại: mốc chặn tính lại từ lần chặn mới (mốc cũ đã xoá cùng lúc bỏ chặn).
10. Lời mời đang chờ: `room_members_update` kiểm tra chặn — nếu người nhận lời mời và chủ phòng đang chặn nhau thì việc "Đồng ý" bị từ chối.
11. Mốc "xoá lịch sử" dùng giờ máy khách (giống `last_read_at` hiện tại). Không bao giờ ẩn tin của chính người đang xem (kể cả khi đồng hồ máy lệch).

## Kiểm chứng dự kiến

- Unit test `visibleMessages` (lọc theo mốc xoá; lọc theo chặn; giữ tin cũ hơn mốc).
- Script REST (3 tài khoản test):
  - A và B chat riêng bình thường.
  - A chặn B: A gửi DM → 403; B gửi DM → 403; B thêm A vào nhóm → 403 (và ngược lại); B "Đồng ý" lời mời cũ của A → 403.
  - A xoá lịch sử phòng nhóm: B vẫn đọc được tin cũ; A (qua `cleared_at`) coi như sạch.
  - A bỏ chặn → gửi DM lại được; chặn lại → mốc mới.
- `node --test tests/*.test.js` xanh.

## Còn để người xây quyết

- Tên class CSS, vị trí chính xác của menu "⋮" trong header, nội dung modal danh sách chặn.
- Số tin tối đa lấy mỗi phòng khi có mốc xoá (giữ 50 như hiện tại, có thể tăng nếu cần).
