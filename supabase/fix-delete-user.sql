-- ============================================================================
-- UniSchedule AI — Sửa lỗi KHÔNG XOÁ ĐƯỢC tài khoản + dọn tài khoản test
-- Chạy 1 lần: Supabase Dashboard > SQL Editor > dán toàn bộ file > Run.
-- An toàn khi chạy lặp lại.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PHẦN 1) Sửa trigger guard_room_update
-- Nguyên nhân lỗi: bảng rooms có FK "owner references auth.users(id) on delete
-- set null". Khi xoá một tài khoản đang sở hữu phòng, Postgres tự chạy
-- UPDATE rooms SET owner = null. Trigger guard_room_update lại chặn mọi thay
-- đổi owner -> việc xoá tài khoản thất bại.
-- Cách sửa: cho phép đặt owner = null khi KHÔNG có người dùng JWT (auth.uid()
-- is null) — đúng tình huống hệ thống xoá tài khoản.
-- ---------------------------------------------------------------------------
create or replace function public.guard_room_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null and new.owner is null and old.owner is not null then
        return new;
    end if;

    if new.id <> old.id or new.type <> old.type then
        raise exception 'Không được đổi id/loại phòng';
    end if;

    if old.type = 'public' then
        if new.name is distinct from old.name or new.owner is distinct from old.owner then
            raise exception 'Phòng chung không được đổi tên/chủ';
        end if;
    elsif old.type = 'direct' then
        if new.name is distinct from old.name or new.owner is distinct from old.owner then
            raise exception 'Chat riêng không được đổi tên/chủ';
        end if;
    else
        -- group: chủ nhóm mới được đổi name; không ai được đổi owner.
        if new.owner is distinct from old.owner then
            raise exception 'Không được đổi chủ nhóm';
        end if;
        if auth.uid() <> old.owner and new.name is distinct from old.name then
            raise exception 'Chỉ chủ nhóm được đổi tên nhóm';
        end if;
    end if;
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- PHẦN 2) Dọn tài khoản test zzz*@example.com
-- Xoá dữ liệu phụ thuộc không có khoá ngoại trước (phòng, tin nhắn, lượt đọc),
-- rồi xoá tài khoản. Các bảng profiles/subjects/room_members/recovery_codes tự
-- động xoá theo khoá ngoại (on delete cascade).
-- ---------------------------------------------------------------------------
delete from public.messages m
    using auth.users u
    where m.sender = u.id and u.email like 'zzz%@example.com';

delete from public.reads r
    using auth.users u
    where r.user_id = u.id and u.email like 'zzz%@example.com';

-- Xoá phòng do tài khoản test sở hữu (kéo theo room_members/messages của phòng đó).
delete from public.rooms rm
    using auth.users u
    where rm.owner = u.id and u.email like 'zzz%@example.com';

-- Cuối cùng xoá tài khoản.
delete from auth.users where email like 'zzz%@example.com';

-- Xem còn sót tài khoản test nào không (kỳ vọng: 0 dòng).
select count(*) as con_lai from auth.users where email like 'zzz%@example.com';
