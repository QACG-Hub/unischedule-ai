// Kiểm tra tĩnh schema.sql: các bất biến bảo mật quan trọng.
// Không chạy được Postgres trong môi trường này, nên đọc file SQL và khẳng định
// các thuộc tính an ninh (phát hiện hồi quy ở mức văn bản policy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

test('room_members_insert: KHÔNG cho tự chèn vào phòng bất kỳ (chỉ chủ phòng)', () => {
    const m = sql.match(/create policy room_members_insert[\s\S]*?;/i);
    assert.ok(m, 'thiếu policy room_members_insert');
    // Không được có nhánh "user_id = auth.uid()" không kèm điều kiện phòng.
    assert.doesNotMatch(m[0], /or\s+user_id\s*=\s*auth\.uid\(\)/i,
        'self-insert cho phép gia nhập phòng của người khác (lỗ hổng quyền riêng tư)');
    assert.match(m[0], /owns_room\(room_id\)/i);
});

test('realtime publication có bảng profiles (danh bạ cập nhật trực tiếp)', () => {
    const m = sql.match(/array\s*\[[^\]]*\]/i);
    assert.ok(m, 'thiếu mảng bảng realtime');
    assert.match(m[0], /'profiles'/);
});

test('có trigger tạo profiles khi tài khoản mới được tạo (không phụ thuộc client)', () => {
    assert.match(sql, /create or replace function public\.handle_new_user/i);
    assert.match(sql, /create trigger on_auth_user_created/i);
    assert.match(sql, /on auth\.users/i);
});

test('is_blocked/room_owner: KHÔNG gọi được trực tiếp qua RPC (không lộ đồ thị chặn/chủ phòng)', () => {
    // Không được cấp EXECUTE cho authenticated.
    assert.doesNotMatch(sql, /grant execute on function public\.is_blocked\s*\([^)]*\)\s*to[^;]*authenticated/i,
        'is_blocked cấp cho authenticated → dò được quan hệ chặn của người khác');
    assert.doesNotMatch(sql, /grant execute on function public\.room_owner\s*\([^)]*\)\s*to[^;]*authenticated/i,
        'room_owner cấp cho authenticated → dò được chủ phòng bất kỳ');
    // Phải thu hồi khỏi public/anon/authenticated (RPC RLS helper nội bộ).
    assert.match(sql, /revoke execute on function public\.is_blocked\s*\([^)]*\)\s*from[^;]*public[^;]*anon[^;]*authenticated/i,
        'thiếu revoke execute is_blocked khỏi public, anon, authenticated');
    assert.match(sql, /revoke execute on function public\.room_owner\s*\([^)]*\)\s*from[^;]*public[^;]*anon[^;]*authenticated/i,
        'thiếu revoke execute room_owner khỏi public, anon, authenticated');
});

test('có helper tự-scope i_blocked/i_blocked_owner_of (SECURITY DEFINER) cấp cho authenticated', () => {
    assert.match(sql, /function public\.i_blocked\s*\(\s*other uuid\s*\)/i, 'thiếu i_blocked(uuid)');
    assert.match(sql, /function public\.i_blocked_owner_of\s*\(\s*p_room_id text\s*\)/i, 'thiếu i_blocked_owner_of(text)');
    // Phải là SECURITY DEFINER để đọc blocks mà không phụ thuộc RLS.
    const iBlocked = sql.match(/create or replace function public\.i_blocked\s*\([^)]*\)[\s\S]*?\$\$/i);
    assert.ok(iBlocked && /security definer/i.test(iBlocked[0]), 'i_blocked phải SECURITY DEFINER');
    const iOwner = sql.match(/create or replace function public\.i_blocked_owner_of\s*\([^)]*\)[\s\S]*?\$\$/i);
    assert.ok(iOwner && /security definer/i.test(iOwner[0]), 'i_blocked_owner_of phải SECURITY DEFINER');
    assert.match(sql, /grant execute on function public\.i_blocked\s*\([^)]*\)\s*to[^;]*authenticated/i, 'thiếu grant i_blocked cho authenticated');
    assert.match(sql, /grant execute on function public\.i_blocked_owner_of\s*\([^)]*\)\s*to[^;]*authenticated/i, 'thiếu grant i_blocked_owner_of cho authenticated');
});

test('room_members_insert dùng i_blocked(user_id), không gọi is_blocked trực tiếp', () => {
    const m = sql.match(/create policy room_members_insert[\s\S]*?;/i);
    assert.ok(m, 'thiếu policy room_members_insert');
    assert.match(m[0], /not public\.i_blocked\(user_id\)/i, 'phải chặn bằng i_blocked(user_id)');
    assert.doesNotMatch(m[0], /public\.is_blocked\s*\(/i, 'policy không được gọi is_blocked (đã thu hồi quyền → lỗi permission denied)');
});

test('room_members_update dùng i_blocked_owner_of + i_blocked (chặn cả hai chiều, kể cả chủ phòng)', () => {
    const m = sql.match(/create policy room_members_update[\s\S]*?;/i);
    assert.ok(m, 'thiếu policy room_members_update');
    assert.match(m[0], /not public\.i_blocked_owner_of\(room_id\)/i, 'thiếu chặn chủ phòng ↔ người được mời');
    assert.match(m[0], /not public\.i_blocked\(user_id\)/i, 'thiếu chặn chủ phòng kích hoạt lại người bị chặn');
    assert.doesNotMatch(m[0], /public\.is_blocked\s*\(/i, 'policy không được gọi is_blocked trực tiếp');
    assert.doesNotMatch(m[0], /public\.room_owner\s*\(/i, 'policy không được gọi room_owner trực tiếp');
});

test('blocks: có index theo cột blocked (tra cứu "ai chặn tôi")', () => {
    assert.match(sql, /create index if not exists blocks_blocked_idx on public\.blocks\s*\(\s*blocked\s*\)/i,
        'thiếu index blocks_blocked_idx (blocked)');
});

test('blocks: bật RLS, nằm trong vòng xoá policy và publication realtime', () => {
    assert.match(sql, /alter table public\.blocks\s+enable row level security/i);
    const dropLoop = sql.match(/tablename in \([\s\S]*?\)/i);
    assert.ok(dropLoop && /'blocks'/.test(dropLoop[0]), "blocks chưa nằm trong vòng drop policy");
    const pub = sql.match(/foreach t in array array\[[\s\S]*?\]/i);
    assert.ok(pub && /'blocks'/.test(pub[0]), 'blocks chưa nằm trong publication realtime');
});
