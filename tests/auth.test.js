import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage } from '../auth.js';

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
