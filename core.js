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

// uid cố định cho chế độ khách (dữ liệu chỉ lưu trên máy).
export const GUEST_UID = 'guest';

export function isGuestUid(uid) {
    return uid === GUEST_UID;
}

// Chỉ migrate dữ liệu khách lên tài khoản khi đang trong luồng nâng cấp và có dữ liệu.
export function shouldMigrateGuest(options) {
    var o = options || {};
    return !!o.upgradeMode && !!o.hasGuestData;
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

// Tách danh sách phòng: lời mời đang chờ (myStatus='pending') và phòng đã tham gia.
// Phòng thiếu myStatus coi như đang tham gia.
export function partitionRooms(rooms, uid) {
    var invites = [];
    var active = [];
    (Array.isArray(rooms) ? rooms : []).forEach(function (room) {
        if (!room) return;
        if (room.myStatus === 'pending') invites.push(room);
        else active.push(room);
    });
    return { invites: invites, active: active };
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

// Sắp xếp tin nhắn cũ → mới (Firestore desc + limit trả về mới nhất trước).
export function sortMessagesAsc(messages) {
    var list = Array.isArray(messages) ? messages.slice() : [];
    return list.sort(function (a, b) {
        var ta = toMillis(a && a.createdAt);
        var tb = toMillis(b && b.createdAt);
        return (ta === null ? 0 : ta) - (tb === null ? 0 : tb);
    });
}

// Lọc tin hiển thị theo mốc xoá lịch sử (clearedAt, ms) và mốc chặn theo từng
// người gửi (blocked: uid -> ms). Không bao giờ ẩn tin của chính selfUid khỏi
// bộ lọc chặn. Trả mảng mới.
export function visibleMessages(messages, options) {
    var o = options || {};
    var list = Array.isArray(messages) ? messages : [];
    var cleared = toMillis(o.clearedAt);
    var blocked = o.blocked || {};
    var selfUid = o.selfUid;
    return list.filter(function (m) {
        if (!m) return false;
        var t = toMillis(m.createdAt);
        if (cleared !== null && t !== null && t <= cleared) return false;
        var sender = m.senderId;
        if (sender !== selfUid && blocked[sender] != null) {
            var bt = toMillis(blocked[sender]);
            if (t !== null && bt !== null && t > bt) return false;
        }
        return true;
    });
}

// Từ các dòng bảng blocks (createdAt là ms) suy ra mốc chặn sớm nhất theo từng
// người còn lại. Dòng không liên quan tới selfUid bị bỏ qua.
export function blockTimes(blocks, selfUid) {
    var map = {};
    (Array.isArray(blocks) ? blocks : []).forEach(function (b) {
        if (!b) return;
        var other = b.blocker === selfUid ? b.blocked : (b.blocked === selfUid ? b.blocker : null);
        if (!other) return;
        var t = toMillis(b.createdAt);
        if (t === null) return;
        if (map[other] == null || t < map[other]) map[other] = t;
    });
    return map;
}

// Tập uid mà CHÍNH selfUid đã chặn (một chiều). Dùng cho UI "Bỏ chặn" / danh
// sách đã chặn, để không nhầm với người chặn mình.
export function blockedByMe(blocks, selfUid) {
    var map = {};
    (Array.isArray(blocks) ? blocks : []).forEach(function (b) {
        if (b && b.blocker === selfUid && b.blocked) map[b.blocked] = true;
    });
    return map;
}

// Mốc thời gian mới nhất trong danh sách tin (ms), hoặc fallback. Dùng làm mốc
// "xoá lịch sử" dựa trên giờ SERVER của tin (tránh lệch đồng hồ máy khách).
export function newestMessageTime(messages, fallbackMs) {
    var max = null;
    (Array.isArray(messages) ? messages : []).forEach(function (m) {
        var t = toMillis(m && m.createdAt);
        if (t !== null && (max === null || t > max)) max = t;
    });
    var fb = toMillis(fallbackMs);
    if (fb !== null && (max === null || fb > max)) max = fb;
    return max;
}

// Phòng đã xoá lịch sử và không còn tin hiển thị nào → ẩn khỏi danh sách của
// riêng mình. Kênh chung không bao giờ bị ẩn. `preview` là tin hiển thị mới nhất
// (null/undefined nghĩa là không còn tin nào để xem).
export function isRoomHidden(room, clearedAt, preview) {
    if (!room || room.type === 'public') return false;
    if (clearedAt == null) return false;
    return !preview;
}

// Danh sách phòng sẽ hiện ở cột bên trái: bỏ phòng đã xoá lịch sử mà không còn
// tin hiển thị, nhưng LUÔN giữ phòng đang mở (activeRoomId) để khung chat đang
// xem không biến mất khỏi danh sách. `previews` là map room.id -> tin hiển thị
// mới nhất (null nếu rỗng); thiếu khóa = chưa tính xong, coi như rỗng để không
// hiện chớp nhoáng phòng đã xoá.
export function filterVisibleRooms(rooms, clearedMap, previews, activeRoomId) {
    var clears = clearedMap || {};
    var prev = previews || {};
    return (Array.isArray(rooms) ? rooms : []).filter(function (room) {
        if (!room) return false;
        if (room.id === activeRoomId) return true;
        var preview = Object.prototype.hasOwnProperty.call(prev, room.id) ? prev[room.id] : undefined;
        return !isRoomHidden(room, clears[room.id], preview);
    });
}

// Tin xem trước của phòng cho danh sách, đã tôn trọng mốc xoá + chặn.
// `options.preview` là giá trị previewByRoom đã tính (undefined = chưa tính).
// Khi chưa tính xong, chỉ dùng tin thô `room.lastMessage` nếu chắc chắn nó vẫn
// hiển thị (phòng chưa xoá và người gửi không bị chặn sau thời điểm tin).
export function roomPreview(room, options) {
    var o = options || {};
    if (o.preview !== undefined) return o.preview;
    if (!room) return null;
    if (o.clearedAt != null) return null;
    var last = room.lastMessage || null;
    if (!last) return null;
    var blocked = o.blocked || {};
    if (o.selfUid !== last.senderId && blocked[last.senderId] != null) {
        var bt = toMillis(blocked[last.senderId]);
        var t = toMillis(last.createdAt);
        if (t !== null && bt !== null && t > bt) return null;
    }
    return last;
}

// Chỉ được đọc cache cũ (khóa chung, chưa gắn uid) khi chưa có chủ hoặc đúng chủ.
export function legacyCacheAllowed(localOwner, uid) {
    return localOwner === null || localOwner === undefined || localOwner === uid;
}

/* ------------------------- Tài khoản (Supabase) ------------------------- */

// Chuẩn hoá tên tài khoản: bỏ khoảng trắng đầu/cuối, chuyển chữ thường.
export function normalizeUsername(username) {
    return String(username == null ? '' : username).trim().toLowerCase();
}

// Tên tài khoản hợp lệ: 3–20 ký tự, chỉ a-z 0-9 . _ -
export function isValidUsername(username) {
    var u = normalizeUsername(username);
    return u.length >= 3 && u.length <= 20 && /^[a-z0-9._-]+$/.test(u);
}

// Mã dự phòng hợp lệ: đúng 12 ký tự A-Z0-9 (không phân biệt hoa/thường khi nhập).
export function isValidRecoveryCode(code) {
    return /^[A-Z0-9]{12}$/.test(String(code == null ? '' : code).trim().toUpperCase());
}

// Người dùng nhập email (đăng nhập trực tiếp) hay tên tài khoản.
export function looksLikeEmail(value) {
    return String(value == null ? '' : value).indexOf('@') !== -1;
}

// Kiểm tra dữ liệu đăng ký Supabase; trả mảng tên trường lỗi (rỗng = hợp lệ).
export function validateSignup(input) {
    var errors = [];
    var username = (input && input.username);
    var email = String((input && input.email) || '');
    var password = String((input && input.password) || '');
    if (!isValidUsername(username)) errors.push('username');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('email');
    if (password.length < 6) errors.push('password');
    return errors;
}

// Tên tài khoản để lưu vào bảng công khai `profiles`: ưu tiên username/displayName
// hợp lệ; TUYỆT ĐỐI không dùng email (tránh lộ email ra bảng công khai).
export function profileUsername(user) {
    var u = user || {};
    var candidates = [u.username, u.displayName];
    for (var i = 0; i < candidates.length; i++) {
        if (isValidUsername(candidates[i])) return normalizeUsername(candidates[i]);
    }
    var uid = String(u.uid || u.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
    return 'user_' + (uid || 'unknown');
}
