import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  directRoomId, cacheKeyFor, shouldOfferUpload, filterDirectory,
  roomLabel, unreadCount, validateRegistration, isPublicRoomId
} from '../core.js';

test('directRoomId không phụ thuộc thứ tự uid', () => {
  assert.equal(directRoomId('b', 'a'), 'dm_a_b');
  assert.equal(directRoomId('a', 'b'), 'dm_a_b');
});

test('cacheKeyFor gắn uid vào khóa', () => {
  assert.equal(cacheKeyFor('u1'), 'uni_schedule_cache_v1__u1');
});

test('shouldOfferUpload chỉ khi cache chưa có chủ hoặc đúng chủ, và cloud trống', () => {
  assert.equal(shouldOfferUpload({ localOwner: null, uid: 'u1', hasLocalData: true, hasCloudData: false }), true);
  assert.equal(shouldOfferUpload({ localOwner: 'u1', uid: 'u1', hasLocalData: true, hasCloudData: false }), true);
  assert.equal(shouldOfferUpload({ localOwner: 'uX', uid: 'u1', hasLocalData: true, hasCloudData: false }), false);
  assert.equal(shouldOfferUpload({ localOwner: null, uid: 'u1', hasLocalData: true, hasCloudData: true }), false);
  assert.equal(shouldOfferUpload({ localOwner: null, uid: 'u1', hasLocalData: false, hasCloudData: false }), false);
});

test('filterDirectory tìm theo tên, không phân biệt hoa thường, rỗng thì trả hết', () => {
  const users = [{ displayName: 'An' }, { displayName: 'Bình' }];
  assert.equal(filterDirectory(users, '').length, 2);
  assert.deepEqual(filterDirectory(users, 'bì'), [{ displayName: 'Bình' }]);
});

test('roomLabel phân biệt loại phòng', () => {
  assert.equal(roomLabel({ type: 'public' }, 'u1', {}), 'Phòng chung');
  assert.equal(roomLabel({ type: 'group', name: 'KTPM' }, 'u1', {}), 'KTPM');
  const dm = { type: 'direct', members: ['u1', 'u2'] };
  assert.equal(roomLabel(dm, 'u1', { u2: { displayName: 'Bình' } }), 'Bình');
  assert.equal(roomLabel(dm, 'u1', {}), 'Trò chuyện riêng');
});

test('unreadCount đếm tin sau mốc đã đọc', () => {
  const msgs = [{ createdAt: 100 }, { createdAt: 200 }, { createdAt: 300 }];
  assert.equal(unreadCount(msgs, 150), 2);
  assert.equal(unreadCount(msgs, null), 3);
  assert.equal(unreadCount(msgs, 300), 0);
});

test('validateRegistration bắt lỗi thiếu/ sai', () => {
  assert.deepEqual(validateRegistration({ name: 'An', email: 'a@b.com', password: '123456' }), []);
  assert.deepEqual(validateRegistration({ name: '', email: 'x', password: '1' }).sort(), ['email', 'name', 'password']);
});

test('isPublicRoomId', () => {
  assert.equal(isPublicRoomId('public'), true);
  assert.equal(isPublicRoomId('dm_a_b'), false);
});

test('validateRegistration: email có khoảng trắng bị coi là sai', () => {
  assert.deepEqual(validateRegistration({ name: 'An', email: 'a b@c.com', password: '123456' }), ['email']);
});
