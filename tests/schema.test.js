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
