/* ==========================================================================
   UniSchedule AI - Chat
   Phòng chung, chat riêng 1-1, chat nhóm; tin nhắn realtime qua Firestore.
   ========================================================================== */

import { db, SDK_VERSION } from './firebase-init.js';
import { isPublicRoomId, unreadCount, roomLabel, directRoomId, filterDirectory } from './core.js';

let fs = null;
async function loadFs() {
    if (!fs) {
        fs = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`);
    }
    return fs;
}

let currentUser = null;
let roomListUnsub = null;
let messagesUnsub = null;
let directoryUnsub = null;
let currentRoomId = null;
let roomsCache = [];
let directoryMap = {};      // uid -> { displayName, class, photoURL } (Task 6 điền)
let directoryUsers = [];    // danh sách phẳng cho modal chọn người
let lastReadMap = {};       // roomId -> lastReadAt (Task 8 dùng)

function esc(s) {
    if (typeof window !== 'undefined' && typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function toMillis(v) {
    if (v == null) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    var n = Number(v);
    return isNaN(n) ? 0 : n;
}

function timeLabel(ts) {
    var d = ts && typeof ts.toDate === 'function' ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d || isNaN(d.getTime())) return '';
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
}

function unwrap(doc) {
    return Object.assign({ id: doc.id }, doc.data());
}

/* ------------------------- Phòng chung ------------------------- */

export async function ensurePublicRoom() {
    const S = await loadFs();
    const ref = S.doc(db, 'rooms', 'public');
    const snap = await S.getDoc(ref);
    if (!snap.exists()) {
        try {
            await S.setDoc(ref, {
                type: 'public',
                name: null,
                members: [],
                ownerId: null,
                createdAt: S.serverTimestamp(),
                updatedAt: S.serverTimestamp(),
                lastMessage: null
            });
        } catch (e) {
            // Có thể người khác vừa tạo trước — bỏ qua.
            console.warn('ensurePublicRoom:', e);
        }
    }
}

/* ------------------------- Danh sách phòng ------------------------- */

export function subscribeRoomList(cb) {
    const S = fs;
    const uid = currentUser && currentUser.uid;
    if (!S || !uid) return function () { };

    let publicRoom = null;
    let myRooms = [];

    function emit() {
        const list = [];
        if (publicRoom) list.push(publicRoom);
        myRooms.forEach(function (r) { if (r.id !== 'public') list.push(r); });
        list.sort(function (a, b) {
            const ta = a.lastMessage ? toMillis(a.lastMessage.createdAt) : 0;
            const tb = b.lastMessage ? toMillis(b.lastMessage.createdAt) : 0;
            return tb - ta;
        });
        roomsCache = list;
        renderRoomList(list);
        if (typeof cb === 'function') cb(list);
    }

    const unsubPublic = S.onSnapshot(S.doc(db, 'rooms', 'public'), function (snap) {
        publicRoom = snap.exists() ? unwrap(snap) : null;
        emit();
    }, function (err) { console.warn('subscribeRoomList(public):', err); });

    const unsubMine = S.onSnapshot(
        S.query(S.collection(db, 'rooms'), S.where('members', 'array-contains', uid)),
        function (snap) {
            myRooms = snap.docs.map(unwrap);
            emit();
        },
        function (err) { console.warn('subscribeRoomList(mine):', err); }
    );

    roomListUnsub = function () { unsubPublic(); unsubMine(); };
    return roomListUnsub;
}

/* ------------------------- Tin nhắn ------------------------- */

export function subscribeMessages(roomId, cb) {
    const S = fs;
    if (!S) return function () { };
    const q = S.query(
        S.collection(db, 'rooms', roomId, 'messages'),
        S.orderBy('createdAt', 'asc'),
        S.limit(50)
    );
    return S.onSnapshot(q, function (snap) {
        const msgs = snap.docs.map(unwrap);
        if (typeof cb === 'function') cb(msgs);
    }, function (err) { console.warn('subscribeMessages:', err); });
}

export function openRoom(roomId) {
    if (!fs || !currentUser || !roomId) return;
    currentRoomId = roomId;
    setChatTitle();
    renderRoomList(roomsCache);

    if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
    messagesUnsub = subscribeMessages(roomId, function (msgs) {
        renderMessages(msgs);
        markRoomRead(roomId);
    });
}

export async function sendMessage(roomId, text) {
    text = String(text == null ? '' : text).trim();
    if (!text || !fs || !currentUser) return;
    const S = fs;
    const senderName = currentUser.displayName || currentUser.email || 'Người dùng';
    await S.addDoc(S.collection(db, 'rooms', roomId, 'messages'), {
        senderId: currentUser.uid,
        senderName: senderName,
        text: text,
        type: 'text',
        createdAt: S.serverTimestamp()
    });
    await S.updateDoc(S.doc(db, 'rooms', roomId), {
        lastMessage: {
            text: text,
            senderId: currentUser.uid,
            senderName: senderName,
            createdAt: S.serverTimestamp()
        },
        updatedAt: S.serverTimestamp()
    });
}

export async function markRoomRead(roomId) {
    if (!fs || !currentUser || !roomId) return;
    const S = fs;
    try {
        await S.setDoc(
            S.doc(db, 'users', currentUser.uid, 'reads', roomId),
            { lastReadAt: S.serverTimestamp() },
            { merge: true }
        );
    } catch (e) { /* bỏ qua, không chặn chat */ }
}

/* ------------------------- Danh bạ người dùng ------------------------- */

// Công khai hồ sơ tối thiểu (KHÔNG email) để người khác chat riêng.
export async function upsertDirectory(user, extra) {
    if (!user || !user.uid) return;
    const S = await loadFs();
    const payload = {
        displayName: user.displayName || 'Người dùng',
        class: (extra && extra.class) || null,
        photoURL: user.photoURL || null,
        updatedAt: S.serverTimestamp()
    };
    await S.setDoc(S.doc(db, 'directory', user.uid), payload, { merge: true });
}

export function listDirectory(cb) {
    const S = fs;
    if (!S) return function () { };
    return S.onSnapshot(S.collection(db, 'directory'), function (snap) {
        const users = snap.docs.map(function (d) {
            return Object.assign({ uid: d.id }, d.data());
        });
        const map = {};
        users.forEach(function (u) { map[u.uid] = u; });
        directoryMap = map;
        directoryUsers = users;
        // Cập nhật lại nhãn phòng riêng đang hiển thị.
        renderRoomList(roomsCache);
        setChatTitle();
        if (typeof cb === 'function') cb(users);
    }, function (err) { console.warn('listDirectory:', err); });
}

/* ------------------------- Chat riêng 1-1 ------------------------- */

export async function openDirect(otherUid) {
    if (!fs || !currentUser || !otherUid) return;
    if (otherUid === currentUser.uid) return;
    const S = fs;
    const roomId = directRoomId(currentUser.uid, otherUid);
    const ref = S.doc(db, 'rooms', roomId);
    const snap = await S.getDoc(ref);
    if (!snap.exists()) {
        try {
            await S.setDoc(ref, {
                type: 'direct',
                name: null,
                members: [currentUser.uid, otherUid],
                ownerId: null,
                createdAt: S.serverTimestamp(),
                updatedAt: S.serverTimestamp(),
                lastMessage: null
            });
        } catch (e) {
            // Người kia có thể vừa tạo trước — bỏ qua.
            console.warn('openDirect:', e);
        }
    }
    openRoom(roomId);
}

/* ------------------------- Modal chọn người ------------------------- */

function renderPickUserList() {
    const el = document.getElementById('pickUserList');
    if (!el) return;
    const search = document.getElementById('pickUserSearch');
    const q = search ? search.value : '';
    const uid = currentUser && currentUser.uid;
    const list = filterDirectory(directoryUsers, q).filter(function (u) { return u.uid !== uid; });
    el.innerHTML = '';
    if (!list.length) {
        el.innerHTML = '<div class="pick-user-empty">Không tìm thấy người dùng nào.</div>';
        return;
    }
    list.forEach(function (u) {
        const item = document.createElement('div');
        item.className = 'pick-user-item';
        item.innerHTML =
            '<div class="pick-user-name">' + esc(u.displayName || 'Người dùng') + '</div>' +
            (u.class ? '<div class="pick-user-class">' + esc(u.class) + '</div>' : '');
        item.addEventListener('click', function () {
            if (typeof window.closeModal === 'function') window.closeModal('pickUserModal');
            openDirect(u.uid).catch(function (e) { console.warn('openDirect:', e); });
        });
        el.appendChild(item);
    });
}

function wireChatUi() {
    const btn = document.getElementById('btnPickUser');
    if (btn && !btn.dataset.wired) {
        btn.dataset.wired = '1';
        btn.addEventListener('click', function () {
            const search = document.getElementById('pickUserSearch');
            if (search) search.value = '';
            renderPickUserList();
            if (typeof window.openModal === 'function') window.openModal('pickUserModal');
        });
    }
    const search = document.getElementById('pickUserSearch');
    if (search && !search.dataset.wired) {
        search.dataset.wired = '1';
        search.addEventListener('input', renderPickUserList);
    }
}

/* ------------------------- Vòng đời ------------------------- */

export async function initChat(user) {
    currentUser = user;
    await loadFs();
    wireChatUi();
    await ensurePublicRoom();
    subscribeRoomList(null);
    directoryUnsub = listDirectory(function () { renderPickUserList(); });
    openRoom('public');
}

export function teardownChat() {
    if (roomListUnsub) { roomListUnsub(); roomListUnsub = null; }
    if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
    if (directoryUnsub) { directoryUnsub(); directoryUnsub = null; }
    currentUser = null;
    currentRoomId = null;
    roomsCache = [];
    directoryMap = {};
    const rl = document.getElementById('roomList');
    if (rl) rl.innerHTML = '';
    const ml = document.getElementById('messageList');
    if (ml) ml.innerHTML = '';
    const t = document.getElementById('chatTitle');
    if (t) t.textContent = 'Chọn một phòng';
}

/* ------------------------- Render ------------------------- */

function renderRoomList(list) {
    const el = document.getElementById('roomList');
    if (!el) return;
    const uid = currentUser && currentUser.uid;
    el.innerHTML = '';
    (list || []).forEach(function (room) {
        const item = document.createElement('div');
        item.className = 'room-item' + (room.id === currentRoomId ? ' active' : '');
        item.dataset.roomId = room.id;
        const label = roomLabel(room, uid, directoryMap);
        const preview = room.lastMessage
            ? esc(room.lastMessage.senderName || '') + ': ' + esc(room.lastMessage.text || '')
            : 'Chưa có tin nhắn';
        item.innerHTML =
            '<div class="room-item-main">' +
            '<div class="room-item-name">' + esc(label) + '</div>' +
            '<div class="room-item-preview">' + preview + '</div>' +
            '</div>';
        item.addEventListener('click', function () { openRoom(room.id); });
        el.appendChild(item);
    });
}

function renderMessages(msgs) {
    const el = document.getElementById('messageList');
    if (!el) return;
    const uid = currentUser && currentUser.uid;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    el.innerHTML = '';
    (msgs || []).forEach(function (m) {
        const row = document.createElement('div');
        row.className = 'msg' + (m.senderId === uid ? ' mine' : '');
        row.innerHTML =
            '<div class="msg-bubble">' +
            (m.senderId === uid ? '' : '<div class="msg-sender">' + esc(m.senderName || '') + '</div>') +
            '<div class="msg-text">' + esc(m.text || '') + '</div>' +
            '<div class="msg-time">' + timeLabel(m.createdAt) + '</div>' +
            '</div>';
        el.appendChild(row);
    });
    if (nearBottom) el.scrollTop = el.scrollHeight;
}

function setChatTitle() {
    const t = document.getElementById('chatTitle');
    if (!t) return;
    const uid = currentUser && currentUser.uid;
    const room = roomsCache.filter(function (r) { return r.id === currentRoomId; })[0]
        || (isPublicRoomId(currentRoomId) ? { type: 'public' } : null);
    t.textContent = room ? roomLabel(room, uid, directoryMap) : 'Chọn một phòng';
}

/* ------------------------- Gắn form gửi tin ------------------------- */

if (typeof document !== 'undefined') {
    document.addEventListener('submit', function (e) {
        if (e.target && e.target.id === 'messageForm') {
            e.preventDefault();
            const input = document.getElementById('messageInput');
            const text = input ? input.value : '';
            if (input) input.value = '';
            if (currentRoomId) sendMessage(currentRoomId, text).catch(function (err) {
                console.warn('sendMessage:', err);
            });
        }
    });
}
