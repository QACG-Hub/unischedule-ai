-- ============================================================================
-- UniSchedule AI — Sửa nhanh RLS cho phần chat
-- Chạy 1 lần: Supabase Dashboard > SQL Editor > dán toàn bộ file > Run.
-- An toàn khi chạy lại nhiều lần. Chỉ đụng tới bảng chat
-- (rooms, room_members, messages) — không thay đổi profiles/subjects/reads.
-- ============================================================================

-- Hàm chẩn đoán: cho biết policy hiện có + vai trò đang chạy (để kiểm tra từ xa).
create or replace function public.zz_policy_debug()
returns jsonb
language sql security definer set search_path = public as $$
    select jsonb_build_object(
        'current_user', current_user,
        'session_user', session_user,
        'policies', coalesce((
            select jsonb_agg(jsonb_build_object(
                't', tablename, 'p', policyname, 'cmd', cmd,
                'perm', permissive, 'check', with_check
            ) order by tablename, policyname)
            from pg_policies
            where schemaname = 'public' and tablename in ('rooms', 'room_members', 'messages')
        ), '[]'::jsonb)
    );
$$;
grant execute on function public.zz_policy_debug() to anon, authenticated;

-- 0) Cột trạng thái thành viên (active = đã vào, pending = chờ đồng ý).
alter table public.room_members
    add column if not exists status text not null default 'active';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'room_members_status_check') then
        alter table public.room_members
            add constraint room_members_status_check check (status in ('active', 'pending'));
    end if;
end $$;

-- 1) Hàm phụ trợ.
create or replace function public.is_room_member(p_room_id text)
returns boolean language sql security definer set search_path = public stable as $$
    select exists (
        select 1 from public.room_members
        where room_id = p_room_id and user_id = auth.uid() and status = 'active'
    );
$$;

create or replace function public.can_read_room(p_room_id text)
returns boolean language sql security definer set search_path = public stable as $$
    select exists (
        select 1 from public.rooms r
        where r.id = p_room_id
          and (
                r.type = 'public'
                or exists (
                    select 1 from public.room_members m
                    where m.room_id = p_room_id and m.user_id = auth.uid() and m.status = 'active'
                )
              )
    );
$$;

create or replace function public.is_invited(p_room_id text)
returns boolean language sql security definer set search_path = public stable as $$
    select exists (
        select 1 from public.room_members
        where room_id = p_room_id and user_id = auth.uid() and status = 'pending'
    );
$$;

grant execute on function public.is_room_member(text) to authenticated;
grant execute on function public.can_read_room(text) to authenticated;
grant execute on function public.is_invited(text) to authenticated;

-- 2) Xoá MỌI policy cũ trên 3 bảng chat (kể cả policy đặt tên lạ còn sót).
--    Bọc try/catch để một policy không xoá được không làm dừng cả file.
do $$
declare r record;
begin
    for r in
        select policyname, tablename from pg_policies
        where schemaname = 'public'
          and tablename in ('rooms', 'room_members', 'messages')
    loop
        begin
            execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
        exception when others then
            raise notice 'bo qua policy % tren %: %', r.policyname, r.tablename, sqlerrm;
        end;
    end loop;
end $$;

-- 3) Tạo lại policy chuẩn.
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
    for select to authenticated
    using (type = 'public' or public.is_room_member(id) or public.is_invited(id));

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms
    for insert to authenticated
    with check (
        (type = 'public' and id = 'public')
        or (type in ('direct', 'group') and owner = auth.uid())
    );

drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms
    for update to authenticated
    using (type = 'public' or public.is_room_member(id))
    with check (type = 'public' or public.is_room_member(id));

drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms
    for delete to authenticated
    using (type = 'group' and owner = auth.uid());

drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
    for select to authenticated
    using (public.can_read_room(room_id) or user_id = auth.uid() or public.owns_room(room_id));

drop policy if exists room_members_insert on public.room_members;
create policy room_members_insert on public.room_members
    for insert to authenticated
    with check (public.owns_room(room_id) and status in ('active', 'pending'));

drop policy if exists room_members_update on public.room_members;
create policy room_members_update on public.room_members
    for update to authenticated
    using (user_id = auth.uid() or public.owns_room(room_id))
    with check (user_id = auth.uid() or public.owns_room(room_id));

drop policy if exists room_members_delete on public.room_members;
create policy room_members_delete on public.room_members
    for delete to authenticated
    using (user_id = auth.uid() or public.owns_room(room_id));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
    for select to authenticated
    using (public.can_read_room(room_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
    for insert to authenticated
    with check (public.can_read_room(room_id) and sender = auth.uid());
