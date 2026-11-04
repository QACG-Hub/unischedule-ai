/* ==========================================================================
   UniSchedule AI - Hàm thuần (pure helpers)
   Không phụ thuộc DOM, không phụ thuộc Firebase → chạy được cả trong Node
   (để test bằng `node --test`) lẫn trong trình duyệt qua ES module.
   ========================================================================== */

// Id phòng chat riêng 1-1, ổn định bất kể thứ tự uid.
export function directRoomId(uidA, uidB) {
    return 'dm_' + [String(uidA), String(uidB)].sort().join('_');
}

// Khóa cache localStorage theo từng tài khoản.
export function cacheKeyFor(uid) {
    return 'uni_schedule_cache_v1__' + uid;
}

// Có nên đề nghị tải TKB cục bộ lên tài khoản không.
// Chỉ khi: cloud đang trống, có dữ liệu cục bộ, và cache chưa có chủ hoặc đúng chủ.
export function shouldOfferUpload(options) {
    var localOwner = options.localOwner;
    var uid = options.uid;
    var hasLocalData = options.hasLocalData;
    var hasCloudData = options.hasCloudData;
    if (hasCloudData || !hasLocalData) return false;
    return localOwner === null || localOwner === undefined || localOwner === uid;
}

// Lọc danh bạ theo tên; query rỗng trả về bản sao toàn bộ.
export function filterDirectory(users, query) {
    var list = Array.isArray(users) ? users : [];
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return list.slice();
    return list.filter(function (u) {
        return String((u && u.displayName) || '').toLowerCase().indexOf(q) !== -1;
    });
}

// Nhãn hiển thị của một phòng.
export function roomLabel(room, uid, directoryMap) {
    if (!room) return '';
    if (room.type === 'public') return 'Phòng chung';
    if (room.type === 'group') return room.name || 'Nhóm';
    // direct
    var members = room.members || [];
    var other = null;
    for (var i = 0; i < members.length; i++) {
        if (members[i] !== uid) { other = members[i]; break; }
    }
    var profile = other && directoryMap ? directoryMap[other] : null;
    return (profile && profile.displayName) || 'Trò chuyện riêng';
}

// Đếm số tin chưa đọc so với mốc đã đọc (hỗ trợ Firestore Timestamp hoặc số).
function toMillis(value) {
    if (value == null) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    var n = Number(value);
    return isNaN(n) ? null : n;
}

export function unreadCount(messages, lastReadAt) {
    var list = Array.isArray(messages) ? messages : [];
    var mark = toMillis(lastReadAt);
    if (mark === null) return list.length;
    return list.filter(function (m) {
        var t = toMillis(m && m.createdAt);
        return t !== null && t > mark;
    }).length;
}

// Kiểm tra dữ liệu đăng ký; trả mảng tên trường lỗi (rỗng = hợp lệ).
export function validateRegistration(input) {
    var errors = [];
    var name = String((input && input.name) || '').trim();
    var email = String((input && input.email) || '');
    var password = String((input && input.password) || '');
    if (!name) errors.push('name');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('email');
    if (password.length < 6) errors.push('password');
    return errors;
}

export function isPublicRoomId(id) {
    return id === 'public';
}
