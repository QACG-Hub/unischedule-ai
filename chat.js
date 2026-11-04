/* ==========================================================================
   UniSchedule AI - Chat
   Phòng chung, chat riêng 1-1, chat nhóm; tin nhắn realtime qua Firestore.
   ========================================================================== */

import { db, SDK_VERSION } from './firebase-init.js';
import { isPublicRoomId, unreadCount, roomLabel, directRoomId, filterDirectory, sortMessagesAsc, legacyCacheAllowed } from './core.js';

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
let lastReadMap = {};       // roomId -> lastReadAt
let unreadByRoom = {};      // roomId -> số chưa đọc
let unreadMsgs = {};        // roomId -> bản tin gần nhất (để tính lại khi mốc đọc đổi)
let unreadSubs = {};        // roomId -> unsubscribe
let readsUnsub = null;

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
        S.orderBy('createdAt', 'desc'),
        S.limit(50)
    );
    return S.onSnapshot(q, function (snap) {
        const msgs = sortMessagesAsc(snap.docs.map(unwrap));
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

/* ------------------------- Chưa đọc ------------------------- */

// Nghe mốc đã đọc của mọi phòng để tính số chưa đọc.
function subscribeReads() {
    const S = fs;
    const uid = currentUser && currentUser.uid;
    if (!S || !uid) return function () { };
    return S.onSnapshot(S.collection(db, 'users', uid, 'reads'), function (snap) {
        const map = {};
        snap.docs.forEach(function (d) {
            map[d.id] = d.data().lastReadAt || null;
        });
        lastReadMap = map;
        Object.keys(unreadMsgs).forEach(function (rid) {
            unreadByRoom[rid] = unreadCount(unreadMsgs[rid], lastReadMap[rid]);
        });
        renderRoomList(roomsCache);
    }, function (err) { console.warn('subscribeReads:', err); });
}

// Đảm bảo mỗi phòng (trừ phòng đang mở) có một listener đếm tin chưa đọc.
function syncUnreadSubs(list) {
    const S = fs;
    if (!S) return;
    const wanted = {};
    (list || []).forEach(function (r) {
        if (r.id === currentRoomId) return;
        wanted[r.id] = true;
        if (unreadSubs[r.id]) return;
        const q = S.query(
            S.collection(db, 'rooms', r.id, 'messages'),
            S.orderBy('createdAt', 'desc'),
            S.limit(50)
        );
        unreadSubs[r.id] = S.onSnapshot(q, function (snap) {
            const msgs = snap.docs.map(unwrap);
            unreadMsgs[r.id] = msgs;
            unreadByRoom[r.id] = unreadCount(msgs, lastReadMap[r.id]);
            renderRoomList(roomsCache);
        }, function (err) { console.warn('unread ' + r.id + ':', err); });
    });
    Object.keys(unreadSubs).forEach(function (rid) {
        if (!wanted[rid]) {
            unreadSubs[rid]();
            delete unreadSubs[rid];
            delete unreadByRoom[rid];
            delete unreadMsgs[rid];
        }
    });
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

/* ------------------------- Chat nhóm ------------------------- */

export async function createGroup(name, memberUids) {
    if (!fs || !currentUser) return null;
    const S = fs;
    const cleanName = String(name || '').trim() || 'Nhóm';
    const ids = Array.from(new Set([currentUser.uid].concat(memberUids || [])));
    const ref = await S.addDoc(S.collection(db, 'rooms'), {
        type: 'group',
        name: cleanName,
        members: ids,
        ownerId: currentUser.uid,
        createdAt: S.serverTimestamp(),
        updatedAt: S.serverTimestamp(),
        lastMessage: null
    });
    openRoom(ref.id);
    return ref.id;
}

export async function renameGroup(roomId, name) {
    if (!fs || !currentUser || !roomId) return;
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    const S = fs;
    await S.updateDoc(S.doc(db, 'rooms', roomId), { name: cleanName, updatedAt: S.serverTimestamp() });
}

export async function addGroupMembers(roomId, uids) {
    if (!fs || !currentUser || !roomId || !uids || !uids.length) return;
    const S = fs;
    await S.updateDoc(S.doc(db, 'rooms', roomId), {
        members: S.arrayUnion.apply(null, uids),
        updatedAt: S.serverTimestamp()
    });
}

export async function removeGroupMember(roomId, uid) {
    if (!fs || !currentUser || !roomId || !uid) return;
    const S = fs;
    await S.updateDoc(S.doc(db, 'rooms', roomId), {
        members: S.arrayRemove(uid),
        updatedAt: S.serverTimestamp()
    });
}

export async function leaveGroup(roomId) {
    if (!currentUser) return;
    await removeGroupMember(roomId, currentUser.uid);
}

function currentRoom() {
    return roomsCache.filter(function (r) { return r.id === currentRoomId; })[0] || null;
}

/* ------------------------- UI nhóm ------------------------- */

function renderCreateGroupList() {
    const el = document.getElementById('groupMemberList');
    if (!el) return;
    const uid = currentUser && currentUser.uid;
    const users = directoryUsers.filter(function (u) { return u.uid !== uid; });
    el.innerHTML = '';
    if (!users.length) {
        el.innerHTML = '<div class="pick-user-empty">Chưa có người dùng khác.</div>';
        return;
    }
    users.forEach(function (u) {
        const row = document.createElement('label');
        row.className = 'group-pick-row';
        row.innerHTML =
            '<input type="checkbox" value="' + esc(u.uid) + '">' +
            '<span class="pick-user-name">' + esc(u.displayName || 'Người dùng') + '</span>' +
            (u.class ? '<span class="pick-user-class">' + esc(u.class) + '</span>' : '');
        el.appendChild(row);
    });
}

function updateGroupInfoBtn() {
    const btn = document.getElementById('groupInfoBtn');
    if (!btn) return;
    const room = currentRoom();
    btn.classList.toggle('hidden', !(room && room.type === 'group'));
}

function renderGroupInfo() {
    const room = currentRoom();
    if (!room || room.type !== 'group') return;
    const uid = currentUser && currentUser.uid;
    const isOwner = room.ownerId === uid;

    const nameEl = document.getElementById('groupInfoName');
    if (nameEl) nameEl.textContent = room.name || 'Nhóm';

    const renameInput = document.getElementById('groupRenameInput');
    if (renameInput) renameInput.value = room.name || '';

    const actions = document.getElementById('groupOwnerActions');
    if (actions) actions.classList.toggle('hidden', !isOwner);

    // Danh sách thành viên.
    const list = document.getElementById('groupMemberListInfo');
    if (list) {
        list.innerHTML = '';
        (room.members || []).forEach(function (m) {
            const info = directoryMap[m] || {};
            const isMe = m === uid;
            const row = document.createElement('div');
            row.className = 'group-member-row';
            row.innerHTML = '<span class="pick-user-name">' + esc(info.displayName || 'Người dùng') + (isMe ? ' (bạn)' : '') + '</span>';
            if (isOwner && !isMe) {
                const rm = document.createElement('button');
                rm.type = 'button';
                rm.className = 'icon-btn';
                rm.title = 'Xóa khỏi nhóm';
                rm.innerHTML = '<svg class="ico"><use href="#i-x"/></svg>';
                rm.addEventListener('click', function () {
                    removeGroupMember(room.id, m).catch(function (e) { console.warn('removeGroupMember:', e); });
                });
                row.appendChild(rm);
            }
            list.appendChild(row);
        });
    }

    // Danh sách có thể thêm (owner).
    const addList = document.getElementById('groupAddList');
    if (addList && isOwner) {
        const members = room.members || [];
        const candidates = directoryUsers.filter(function (u) {
            return members.indexOf(u.uid) === -1;
        });
        addList.innerHTML = '';
        if (!candidates.length) {
            addList.innerHTML = '<div class="pick-user-empty">Không còn ai để thêm.</div>';
        } else {
            candidates.forEach(function (u) {
                const row = document.createElement('label');
                row.className = 'group-pick-row';
                row.innerHTML =
                    '<input type="checkbox" value="' + esc(u.uid) + '">' +
                    '<span class="pick-user-name">' + esc(u.displayName || 'Người dùng') + '</span>';
                addList.appendChild(row);
            });
        }
    }
}

function openGroupInfo() {
    const room = currentRoom();
    if (!room || room.type !== 'group') return;
    renderGroupInfo();
    if (typeof window.openModal === 'function') window.openModal('groupInfoModal');
}

function wireGroupUi() {
    const createBtn = document.getElementById('btnCreateGroup');
    if (createBtn && !createBtn.dataset.wired) {
        createBtn.dataset.wired = '1';
        createBtn.addEventListener('click', function () {
            const nameInput = document.getElementById('groupNameInput');
            if (nameInput) nameInput.value = '';
            renderCreateGroupList();
            if (typeof window.openModal === 'function') window.openModal('createGroupModal');
        });
    }

    const submit = document.getElementById('createGroupSubmit');
    if (submit && !submit.dataset.wired) {
        submit.dataset.wired = '1';
        submit.addEventListener('click', function () {
            const nameInput = document.getElementById('groupNameInput');
            const name = nameInput ? nameInput.value : '';
            const checks = document.querySelectorAll('#groupMemberList input[type="checkbox"]:checked');
            const uids = Array.prototype.map.call(checks, function (c) { return c.value; });
            if (!uids.length) {
                if (typeof window.showToast === 'function') window.showToast('Chọn ít nhất một thành viên', 'info');
                return;
            }
            if (typeof window.closeModal === 'function') window.closeModal('createGroupModal');
            createGroup(name, uids).catch(function (e) { console.warn('createGroup:', e); });
        });
    }

    const infoBtn = document.getElementById('groupInfoBtn');
    if (infoBtn && !infoBtn.dataset.wired) {
        infoBtn.dataset.wired = '1';
        infoBtn.addEventListener('click', openGroupInfo);
    }

    const renameBtn = document.getElementById('groupRenameBtn');
    if (renameBtn && !renameBtn.dataset.wired) {
        renameBtn.dataset.wired = '1';
        renameBtn.addEventListener('click', function () {
            const input = document.getElementById('groupRenameInput');
            const room = currentRoom();
            if (!input || !room) return;
            renameGroup(room.id, input.value).catch(function (e) { console.warn('renameGroup:', e); });
        });
    }

    const addBtn = document.getElementById('groupAddMembersBtn');
    if (addBtn && !addBtn.dataset.wired) {
        addBtn.dataset.wired = '1';
        addBtn.addEventListener('click', function () {
            const room = currentRoom();
            if (!room) return;
            const checks = document.querySelectorAll('#groupAddList input[type="checkbox"]:checked');
            const uids = Array.prototype.map.call(checks, function (c) { return c.value; });
            if (!uids.length) return;
            addGroupMembers(room.id, uids).catch(function (e) { console.warn('addGroupMembers:', e); });
        });
    }

    const leaveBtn = document.getElementById('groupLeaveBtn');
    if (leaveBtn && !leaveBtn.dataset.wired) {
        leaveBtn.dataset.wired = '1';
        leaveBtn.addEventListener('click', function () {
            const room = currentRoom();
            if (!room) return;
            if (window.confirm('Rời khỏi nhóm "' + (room.name || 'Nhóm') + '"?')) {
                leaveGroup(room.id).then(function () {
                    if (typeof window.closeModal === 'function') window.closeModal('groupInfoModal');
                    openRoom('public');
                }).catch(function (e) { console.warn('leaveGroup:', e); });
            }
        });
    }
}

/* ------------------------- Vòng đời ------------------------- */

export async function initChat(user) {
    if (!user) return;
    // onAuthStateChanged có thể phát lại cho cùng người (refresh token) → không dựng lại listener.
    if (currentUser) {
        if (currentUser.uid === user.uid) { currentUser = user; return; }
        teardownChat();
    }
    currentUser = user;
    await loadFs();
    wireChatUi();
    wireGroupUi();
    await ensurePublicRoom();
    roomListUnsub = subscribeRoomList(null);
    readsUnsub = subscribeReads();
    directoryUnsub = listDirectory(function () { renderPickUserList(); });
    openRoom('public');
}

export function teardownChat() {
    if (roomListUnsub) { roomListUnsub(); roomListUnsub = null; }
    if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
    if (directoryUnsub) { directoryUnsub(); directoryUnsub = null; }
    if (readsUnsub) { readsUnsub(); readsUnsub = null; }
    Object.keys(unreadSubs).forEach(function (rid) { unreadSubs[rid](); });
    unreadSubs = {};
    unreadByRoom = {};
    unreadMsgs = {};
    lastReadMap = {};
    currentUser = null;
    currentRoomId = null;
    roomsCache = [];
    directoryMap = {};
    directoryUsers = [];
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
        const unread = unreadByRoom[room.id] || 0;
        item.innerHTML =
            '<div class="room-item-main">' +
            '<div class="room-item-name">' + esc(label) + '</div>' +
            '<div class="room-item-preview">' + preview + '</div>' +
            '</div>' +
            (unread ? '<span class="room-badge">' + (unread > 99 ? '99+' : unread) + '</span>' : '');
        item.addEventListener('click', function () { openRoom(room.id); });
        el.appendChild(item);
    });
    updateGroupInfoBtn();
    syncUnreadSubs(list);
    const gi = document.getElementById('groupInfoModal');
    if (gi && !gi.classList.contains('hidden')) renderGroupInfo();
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
