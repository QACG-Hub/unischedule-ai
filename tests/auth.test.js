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
  return {
    auth: {
      signInWithPassword: async ({ password }) =>
        pwOk === password ? { error: null } : { error: { message: 'Invalid login credentials' } },
      updateUser: async () => ({ error: null })
    }
  };
}

test('changePassword: đổi được khi mk cũ đúng', async () => {
  await assert.doesNotReject(() => changePassword('a@b.com', 'old123', 'new123456', fakeClient('old123')));
});

test('changePassword: mk cũ sai thì báo lỗi known và KHÔNG đổi', async () => {
  await assert.rejects(
    () => changePassword('a@b.com', 'sai', 'new123456', fakeClient('old123')),
    (e) => e.known === true && /Mật khẩu cũ không đúng/.test(e.message)
  );
});

test('changePassword: thiếu email thì báo lỗi', async () => {
  await assert.rejects(
    () => changePassword('', 'old123', 'new123456', fakeClient('old123')),
    /email tài khoản/
  );
});
