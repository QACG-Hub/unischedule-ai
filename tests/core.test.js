import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  directRoomId, cacheKeyFor, shouldOfferUpload, filterDirectory,
  roomLabel, unreadCount, validateRegistration, isPublicRoomId,
  sortMessagesAsc, legacyCacheAllowed, partitionRooms,
  visibleMessages, blockTimes,
  normalizeUsername, isValidUsername, isValidRecoveryCode,
  looksLikeEmail, validateSignup, profileUsername,
  GUEST_UID, isGuestUid, shouldMigrateGuest
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

test('partitionRooms tách lời mời pending khỏi phòng đang tham gia', () => {
  const rooms = [
    { id: 'g1', myStatus: 'pending' },
    { id: 'g2', myStatus: 'active' },
    { id: 'pub' }
  ];
  const r = partitionRooms(rooms, 'u1');
  assert.deepEqual(r.invites.map((x) => x.id), ['g1']);
  assert.deepEqual(r.active.map((x) => x.id), ['g2', 'pub']);
});

test('partitionRooms chịu được dữ liệu rỗng/không hợp lệ', () => {
  assert.deepEqual(partitionRooms(null, 'u1'), { invites: [], active: [] });
  assert.deepEqual(partitionRooms([null], 'u1'), { invites: [], active: [] });
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

test('directRoomId ổn định với uid chứa ký tự đặc biệt', () => {
  assert.equal(directRoomId('uid_A!', 'uid_B!'), directRoomId('uid_B!', 'uid_A!'));
});

test('filterDirectory bỏ qua người không có tên khi query rỗng', () => {
  const users = [{ displayName: 'An' }, { class: 'KTPM' }];
  assert.equal(filterDirectory(users, '').length, 2);
  assert.equal(filterDirectory(users, 'an').length, 1);
});

test('shouldOfferUpload: đổi tài khoản trên cùng máy thì KHÔNG đề nghị tải lên', () => {
  assert.equal(shouldOfferUpload({ localOwner: 'oldUid', uid: 'newUid', hasLocalData: true, hasCloudData: false }), false);
});

test('sortMessagesAsc sắp tin cũ → mới, hỗ trợ Timestamp và số', () => {
  const ts = (n) => ({ toMillis: () => n });
  const msgs = [{ createdAt: ts(300) }, { createdAt: 100 }, { createdAt: ts(200) }];
  const sorted = sortMessagesAsc(msgs);
  assert.deepEqual(sorted.map((m) => (m.createdAt.toMillis ? m.createdAt.toMillis() : m.createdAt)), [100, 200, 300]);
  assert.equal(sorted[0].createdAt, 100);
  assert.equal(sorted[2].createdAt.toMillis(), 300);
});

test('legacyCacheAllowed chỉ khi cache chưa có chủ hoặc đúng chủ', () => {
  assert.equal(legacyCacheAllowed(null, 'u1'), true);
  assert.equal(legacyCacheAllowed(undefined, 'u1'), true);
  assert.equal(legacyCacheAllowed('u1', 'u1'), true);
  assert.equal(legacyCacheAllowed('uOld', 'u1'), false);
});

test('normalizeUsername trim + thường hóa', () => {
  assert.equal(normalizeUsername('  AnB  '), 'anb');
  assert.equal(normalizeUsername(null), '');
});

test('isValidUsername 3..20, chỉ a-z0-9._-', () => {
  assert.equal(isValidUsername('an_b-99'), true);
  assert.equal(isValidUsername('ab'), false);
  assert.equal(isValidUsername('a'.repeat(21)), false);
  assert.equal(isValidUsername('An B'), false);
  assert.equal(isValidUsername('ăn'), false);
});

test('isValidRecoveryCode 12 ký tự A-Z0-9, không phân biệt hoa thường', () => {
  assert.equal(isValidRecoveryCode('ABCD2345WXYZ'), true);
  assert.equal(isValidRecoveryCode('abcd2345wxyz'), true);
  assert.equal(isValidRecoveryCode('ABC'), false);
  assert.equal(isValidRecoveryCode('ABCD-234-WXYZ'), false);
});

test('looksLikeEmail nhận diện theo dấu @', () => {
  assert.equal(looksLikeEmail('an@uni.app'), true);
  assert.equal(looksLikeEmail('anb'), false);
});

test('validateSignup trả mảng tên trường lỗi', () => {
  assert.deepEqual(validateSignup({ username: 'anb', email: 'a@b.com', password: '123456' }), []);
  assert.deepEqual(
    validateSignup({ username: 'a', email: 'x', password: '1' }).sort(),
    ['email', 'password', 'username']
  );
});

test('profileUsername: ưu tiên username/displayName hợp lệ, KHÔNG bao giờ lộ email', () => {
  assert.equal(profileUsername({ uid: 'u1', username: 'anb' }), 'anb');
  assert.equal(profileUsername({ uid: 'u1', displayName: 'AnB' }), 'anb');
  assert.equal(profileUsername({ uid: 'AbC12345-x', displayName: 'a@b.com' }), 'user_abc12345');
  assert.equal(profileUsername({ uid: 'u1', displayName: 'a@b.com' }).indexOf('@'), -1);
  assert.equal(profileUsername(null).indexOf('@'), -1);
});

test('isGuestUid nhận đúng uid khách', () => {
  assert.equal(GUEST_UID, 'guest');
  assert.equal(isGuestUid('guest'), true);
  assert.equal(isGuestUid('0f8e-uid-that'), false);
  // Cache khách tách biệt cache tài khoản thật.
  assert.equal(cacheKeyFor(GUEST_UID), 'uni_schedule_cache_v1__guest');
});

test('shouldMigrateGuest chỉ khi đang nâng cấp và có dữ liệu khách', () => {
  assert.equal(shouldMigrateGuest({ upgradeMode: true, hasGuestData: true }), true);
  assert.equal(shouldMigrateGuest({ upgradeMode: true, hasGuestData: false }), false);
  assert.equal(shouldMigrateGuest({ upgradeMode: false, hasGuestData: true }), false);
  assert.equal(shouldMigrateGuest({}), false);
});

test('visibleMessages bỏ tin trước/đúng mốc xoá lịch sử', () => {
  const msgs = [{ senderId: 'a', createdAt: 100 }, { senderId: 'b', createdAt: 200 }, { senderId: 'a', createdAt: 300 }];
  assert.deepEqual(visibleMessages(msgs, { clearedAt: 200 }).map((m) => m.createdAt), [300]);
});

test('visibleMessages ẩn tin mới của người bị chặn, giữ tin trước mốc', () => {
  const msgs = [{ senderId: 'x', createdAt: 100 }, { senderId: 'x', createdAt: 300 }, { senderId: 'y', createdAt: 300 }];
  const r = visibleMessages(msgs, { blocked: { x: 200 }, selfUid: 'me' });
  assert.deepEqual(r.map((m) => m.createdAt), [100, 300]);
  assert.equal(r[1].senderId, 'y');
});

test('visibleMessages không ẩn tin của chính người xem khỏi bộ lọc chặn', () => {
  const msgs = [{ senderId: 'me', createdAt: 300 }];
  assert.equal(visibleMessages(msgs, { blocked: { me: 100 }, selfUid: 'me' }).length, 1);
});

test('visibleMessages chịu dữ liệu rỗng/không hợp lệ', () => {
  assert.deepEqual(visibleMessages(null, {}), []);
  assert.deepEqual(visibleMessages([null], {}), []);
});

test('visibleMessages trả mảng mới, không sửa mảng vào', () => {
  const msgs = [{ senderId: 'x', createdAt: 100 }];
  const out = visibleMessages(msgs, { clearedAt: 100 });
  assert.equal(out.length, 0);
  assert.equal(msgs.length, 1);
  assert.notEqual(out, msgs);
});

test('blockTimes lấy mốc chặn sớm nhất giữa hai chiều', () => {
  const blocks = [
    { blocker: 'me', blocked: 'x', createdAt: 200 },
    { blocker: 'x', blocked: 'me', createdAt: 100 },
    { blocker: 'me', blocked: 'y', createdAt: 500 }
  ];
  assert.deepEqual(blockTimes(blocks, 'me'), { x: 100, y: 500 });
});

test('blockTimes bỏ qua dòng không liên quan và dữ liệu rỗng', () => {
  assert.deepEqual(blockTimes([{ blocker: 'a', blocked: 'b', createdAt: 1 }], 'me'), {});
  assert.deepEqual(blockTimes(null, 'me'), {});
});
