import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage, changePassword } from '../auth.js';

test('authErrorMessage: dịch lỗi phổ biến, có mặc định', () => {
  assert.equal(authErrorMessage({ message: 'Invalid login credentials' }), 'Sai tên tài khoản hoặc mật khẩu.');
  assert.equal(authErrorMessage({ message: 'User already registered' }), 'Email này đã được đăng ký.');
  assert.equal(authErrorMessage(null), 'Đã xảy ra lỗi. Vui lòng thử lại.');
});

test('authErrorMessage: thông điệp do hàm account trả về (known) giữ nguyên', () => {
  const err = Object.assign(new Error('Tên tài khoản đã tồn tại.'), { known: true });
  assert.equal(authErrorMessage(err), 'Tên tài khoản đã tồn tại.');
});

test('authErrorMessage: lạ thì bọc lại', () => {
  assert.equal(authErrorMessage({ message: 'boom' }), 'Đã xảy ra lỗi: boom');
});

function fakeClient(pwOk) {
  const calls = { updateUser: 0 };
  const client = {
    auth: {
      signInWithPassword: async ({ password }) =>
        pwOk === password ? { error: null } : { error: { message: 'Invalid login credentials' } },
      updateUser: async () => { calls.updateUser += 1; return { error: null }; }
    },
    calls
  };
  return client;
}

test('changePassword: đổi được khi mk cũ đúng', async () => {
  const c = fakeClient('old123');
  await assert.doesNotReject(() => changePassword('a@b.com', 'old123', 'new123456', c));
  assert.equal(c.calls.updateUser, 1);
});

test('changePassword: mk cũ sai thì báo lỗi known và KHÔNG đổi', async () => {
  const c = fakeClient('old123');
  await assert.rejects(
    () => changePassword('a@b.com', 'sai', 'new123456', c),
    (e) => e.known === true && /Mật khẩu cũ không đúng/.test(e.message)
  );
  assert.equal(c.calls.updateUser, 0);
});

test('changePassword: thiếu email thì báo lỗi', async () => {
  const c = fakeClient('old123');
  await assert.rejects(
    () => changePassword('', 'old123', 'new123456', c),
    /email tài khoản/
  );
  assert.equal(c.calls.updateUser, 0);
});
