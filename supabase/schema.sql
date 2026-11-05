-- ============================================================================
-- UniSchedule AI — Supabase schema
-- Cách dùng: Supabase Dashboard > SQL Editor > dán toàn bộ file > Run.
-- Chạy lại được nhiều lần (dùng IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Bảng
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text unique not null,
    created_at timestamptz not null default now()
);

-- Mã dự phòng (băm bcrypt). Không có policy cho người dùng: chỉ RPC/Edge Function đọc.
create table if not exists public.recovery_codes (
    user_id uuid primary key references auth.users(id) on delete cascade,
    code_hash text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.subjects (
    owner uuid not null references auth.users(id) on delete cascade,
    id text not null,
    payload jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (owner, id)
);

create table if not exists public.rooms (
    id text primary key,
    type text not null check (type in ('public', 'direct', 'group')),
    name text,
    owner uuid references auth.users(id) on delete set null,
    last_message_text text,
    last_message_sender uuid,
    last_message_at timestamptz,
    updated_at timestamptz not null default now()
);

create table if not exists public.room_members (
    room_id text not null references public.rooms(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    -- 'active' = đã là thành viên; 'pending' = đang chờ đồng ý lời mời vào nhóm.
    status text not null default 'active',
    primary key (room_id, user_id)
);

-- Thêm cột status cho database đã tạo trước đó (idempotent).
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

create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),
    room_id text not null references public.rooms(id) on delete cascade,
    sender uuid not null,
    sender_name text,
    body text not null,
    created_at timestamptz not null default now()
);

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

create index if not exists messages_room_created_idx on public.messages (room_id, created_at desc);
create index if not exists room_members_user_idx on public.room_members (user_id);
create index if not exists subjects_owner_idx on public.subjects (owner);
create index if not exists reads_user_idx on public.reads (user_id);

-- ---------------------------------------------------------------------------
-- Quyền ở mức bảng (RLS vẫn là lớp kiểm soát chính)
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke all on public.recovery_codes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hàm phụ trợ (SECURITY DEFINER để bỏ qua RLS khi kiểm tra quan hệ phòng)
-- ---------------------------------------------------------------------------

-- Có phải thành viên phòng không (theo người đang đăng nhập).
create or replace function public.is_room_member(p_room_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.room_members
        where room_id = p_room_id and user_id = auth.uid() and status = 'active'
    );
$$;

-- Đọc được phòng không: phòng chung, hoặc là thành viên đã đồng ý.
create or replace function public.can_read_room(p_room_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
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

-- Mình có đang được mời (pending) vào phòng không.
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

-- Có phải chủ phòng (dùng để thêm/xoá thành viên, đổi tên nhóm).
create or replace function public.owns_room(p_room_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.rooms
        where id = p_room_id and owner = auth.uid()
    );
$$;

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

-- Tên tài khoản còn trống không (gọi được cả khi chưa đăng nhập).
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select not exists (
        select 1 from public.profiles where username = lower(btrim(p_username))
    );
$$;

-- Đặt/thay mã dự phòng của chính mình (client gửi mã gốc, server băm bcrypt).
create or replace function public.set_my_recovery_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if auth.uid() is null then
        raise exception 'not authenticated';
    end if;
    insert into public.recovery_codes (user_id, code_hash)
    values (auth.uid(), crypt(p_code, gen_salt('bf')))
    on conflict (user_id)
        do update set code_hash = excluded.code_hash, created_at = now();
end;
$$;

-- Kiểm tra mã dự phòng (CHỈ Edge Function với quyền service_role gọi được).
create or replace function public.verify_recovery_code(p_user_id uuid, p_code text)
returns boolean
language sql
security definer
set search_path = public, extensions
stable
as $$
    select exists (
        select 1 from public.recovery_codes
        where user_id = p_user_id and code_hash = crypt(p_code, code_hash)
    );
$$;

grant execute on function public.is_room_member(text) to authenticated;
grant execute on function public.can_read_room(text) to authenticated;
grant execute on function public.is_invited(text) to authenticated;
grant execute on function public.owns_room(text) to authenticated;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;
grant execute on function public.room_owner(text) to authenticated;
grant execute on function public.can_send_to_room(text) to authenticated;
grant execute on function public.is_username_available(text) to anon, authenticated;

revoke execute on function public.set_my_recovery_code(text) from public;
grant execute on function public.set_my_recovery_code(text) to authenticated;

revoke execute on function public.verify_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_recovery_code(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Trigger: chỉ cho phép đổi đúng thứ được phép trên phòng
-- ---------------------------------------------------------------------------

create or replace function public.guard_room_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Khi xoá tài khoản, FK rooms.owner "on delete set null" chạy UPDATE đặt owner = null.
    -- Lúc đó không có JWT nên auth.uid() is null. Cho phép để việc xoá user không bị chặn.
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

drop trigger if exists trg_guard_room_update on public.rooms;
create trigger trg_guard_room_update
    before update on public.rooms
    for each row execute function public.guard_room_update();

-- Không cho đổi phòng/người của một dòng thành viên khi update (chỉ đổi status).
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

-- ---------------------------------------------------------------------------
-- Bật Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.recovery_codes enable row level security;
alter table public.subjects       enable row level security;
alter table public.rooms          enable row level security;
alter table public.room_members   enable row level security;
alter table public.messages       enable row level security;
alter table public.reads          enable row level security;
alter table public.blocks         enable row level security;

-- Xoá MỌI policy cũ trên các bảng liên quan để migration tự lành, kể cả
-- policy lỗi thời/đặt tên lạ còn sót lại trên database đã cấu hình trước đó.
-- Bọc try/catch từng lệnh để một policy không xoá được không làm dừng cả file.
do $$
declare r record;
begin
    for r in
        select policyname, tablename from pg_policies
        where schemaname = 'public'
          and tablename in ('profiles','recovery_codes','subjects','rooms','room_members','messages','reads','blocks')
    loop
        begin
            execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
        exception when others then
            raise notice 'bo qua policy % tren %: %', r.policyname, r.tablename, sqlerrm;
        end;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Policy
-- ---------------------------------------------------------------------------

-- profiles: đọc cho mọi người đã đăng nhập; chỉ ghi dòng của mình.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
    for select to authenticated using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
    for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
    for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- recovery_codes: KHÔNG policy cho người dùng (chỉ service_role/RPC đọc-ghi).

-- subjects: chỉ chủ tài khoản.
drop policy if exists subjects_all on public.subjects;
create policy subjects_all on public.subjects
    for all to authenticated
    using (owner = auth.uid())
    with check (owner = auth.uid());

-- rooms.
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
    for select to authenticated
    using (type = 'public' or owner = auth.uid() or public.is_room_member(id) or public.is_invited(id));

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

-- room_members.
drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
    for select to authenticated
    using (public.can_read_room(room_id) or user_id = auth.uid() or public.owns_room(room_id));

drop policy if exists room_members_insert on public.room_members;
create policy room_members_insert on public.room_members
    for insert to authenticated
    with check (
        public.owns_room(room_id)
        and status in ('active', 'pending')
        and not public.is_blocked(auth.uid(), user_id)
    );

-- Người được mời tự chuyển dòng của mình sang 'active'; chủ phòng cũng đổi được.
drop policy if exists room_members_update on public.room_members;
create policy room_members_update on public.room_members
    for update to authenticated
    using (user_id = auth.uid() or public.owns_room(room_id))
    with check (
        (user_id = auth.uid() or public.owns_room(room_id))
        and not public.is_blocked(auth.uid(), public.room_owner(room_id))
    );

drop policy if exists room_members_delete on public.room_members;
create policy room_members_delete on public.room_members
    for delete to authenticated
    using (user_id = auth.uid() or public.owns_room(room_id));

-- messages: đọc nếu đọc được phòng; gửi nếu là mình và đọc được phòng.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
    for select to authenticated
    using (public.can_read_room(room_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
    for insert to authenticated
    with check (public.can_send_to_room(room_id) and sender = auth.uid());

-- reads: chỉ dòng của mình.
drop policy if exists reads_all on public.reads;
create policy reads_all on public.reads
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

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

-- ---------------------------------------------------------------------------
-- Tự tạo hồ sơ khi tài khoản mới được tạo (không phụ thuộc trình duyệt)
-- Đọc username từ metadata lúc đăng ký; nếu thiếu/không hợp lệ dùng tên tạm.
-- Nếu username trùng (đua đăng ký), chèn sẽ vi phạm unique → đăng ký báo lỗi
-- thay vì để tài khoản kẹt không có hồ sơ.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    uname text;
begin
    uname := lower(btrim(coalesce(new.raw_user_meta_data->>'username', '')));
    if uname !~ '^[a-z0-9._-]{3,20}$' then
        uname := 'user_' || substr(new.id::text, 1, 8);
    end if;
    insert into public.profiles (id, username)
    values (new.id, uname)
    on conflict (id) do nothing;
    return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Realtime: đưa các bảng cần theo dõi vào publication (idempotent)
-- ---------------------------------------------------------------------------

do $$
declare
    t text;
begin
    foreach t in array array['rooms', 'room_members', 'messages', 'reads', 'subjects', 'profiles', 'blocks'] loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end;
$$;
