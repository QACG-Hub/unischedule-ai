# Thiết kế: Sửa chat riêng + Tạo nhóm, tìm theo tên, mời thành viên cần đồng ý

**Ngày:** 2026-11-05
**Trạng thái:** đã chốt (người dùng đã "ok làm đi")

## Vấn đề / yêu cầu

1. Chat riêng 1-1 không gửi/nhận được tin.
2. Màn "Tạo nhóm" chưa tạo được.
3. Màn "Tạo nhóm" cần ô tìm theo tên người dùng.
4. Khi thêm người vào nhóm, người được thêm phải **đồng ý** mới vào.

## Nguyên nhân gốc (đã kiểm chứng trên Supabase thật)

Dựng lại bằng 2 tài khoản test qua REST:

- `auth.uid()` hoạt động tốt: ghi `profiles`, `subjects` thành công.
- Insert phòng `type='public'` → **201**.
- Insert phòng `type='direct'` và `type='group'` → **403** `new row violates row-level security policy for table "rooms"`.

Kết luận: policy `rooms_insert` trên **database thật đang lỗi thời**, chỉ cho phép phòng chung. Vì phòng không tạo được nên `room_members` và `messages` cũng bị chặn theo → chat riêng và tạo nhóm đều hỏng. Repo (cả bản đầu `b89378c` lẫn bản hiện tại `91e837e`) đã cho phép direct/group, tức là `supabase/schema.sql` **chưa từng được chạy đầy đủ** trên project.

## Quyết định thiết kế

### 1. Sửa DB: migration tự lành

`supabase/schema.sql` sẽ:

- Thêm cột `room_members.status` (`'active' | 'pending'`, mặc định `'active'`).
- **Xoá toàn bộ policy hiện có** trên các bảng liên quan (động, theo `pg_policies`) rồi tạo lại policy chuẩn → sửa được cả policy cũ/lạ/restrictive mà không cần biết tên.
- `is_room_member()` và `can_read_room()` chỉ tính thành viên `active` → người `pending` không đọc/gửi được tin.
- Thêm `is_invited()` (đang `pending` với chính mình).
- `rooms_select`: cho phép `public` **hoặc** thành viên active **hoặc** người được mời (`is_invited`) → người được mời thấy được tên nhóm để bấm đồng ý.
- `room_members_select`: `can_read_room` hoặc dòng của chính mình hoặc chủ phòng.
- `room_members_update` (mới): `user_id = auth.uid()` (tự chấp nhận lời mời) hoặc `owns_room` (chủ).
- Trigger `guard_room_member_update`: không cho đổi `room_id`/`user_id` khi update.
- `room_members_insert`: chỉ chủ phòng (giữ nguyên).

Chạy lại file này nhiều lần vẫn an toàn (idempotent).

### 2. Luồng đồng ý (chọn mặc định hợp lý)

- **Chat riêng:** tức thời. Người tạo là chủ, thêm cả hai người trạng thái `active`. Không cần đồng ý.
- **Tạo nhóm / thêm thành viên:** người tạo `active`; người được thêm `pending`.
- Người được mời thấy mục **"Lời mời tham gia nhóm"** trong danh sách phòng, kèm nút **Đồng ý / Từ chối**.
  - Đồng ý → `update status='active'` cho dòng của mình.
  - Từ chối → xoá dòng của mình (RLS delete cho phép `user_id = auth.uid()`).
- Khi đang `pending`, KHÔNG đọc được tin nhắn (RLS chặn).
- Chủ nhóm thấy thành viên đang chờ trong "Thông tin nhóm" (nhãn "đang chờ") và có thể huỷ lời mời.
- Mời lại người đã là thành viên active: giữ nguyên `active`, không hạ cấp.

### 3. Ô tìm theo tên khi tạo nhóm

Thêm `#groupSearch` vào `#createGroupModal`, lọc bằng hàm thuần `filterDirectory` (đã có, đã test) — giống màn "Chat riêng".

## Logic thuần (test bằng `node --test`)

- `partitionRooms(rooms, uid)` → `{ invites, active }` dựa trên `room.myStatus === 'pending'`.
- Tái dùng `filterDirectory` cho ô tìm.

## Ngoài phạm vi

- Thông báo đẩy/email cho lời mời.
- Đồng ý cho chat riêng.
- Giới hạn số lần dùng mã dự phòng, v.v. (đã ghi ở danh sách deferred trước đó).
