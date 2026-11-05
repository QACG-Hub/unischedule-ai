/* ==========================================================================
   UniSchedule AI - Chat
   Phòng chung, chat riêng 1-1, chat nhóm; tin nhắn realtime qua Supabase.
   Giữ nguyên bố cục DOM và tên hàm export để main.js không phải đổi.
   ========================================================================== */

import { client } from './supabase-init.js';
import {
    isPublicRoomId, unreadCount, roomLabel, directRoomId,
    filterDirectory, sortMessagesAsc, partitionRooms, visibleMessages
} from './core.js';

let currentUser = null;
let currentRoomId = null;
let roomsCache = [];
let directoryMap = {};      // uid -> { displayName }
let directoryUsers = [];    // danh sách phẳng cho modal chọn người
let lastReadMap = {};       // roomId -> mốc đọc (ms)
let unreadByRoom = {};      // roomId -> số chưa đọc
let unreadToken = 0;
let clearedMap = {};        // roomId -> mốc xoá lịch sử (ms)
let blockedMap = {};        // uid -> mốc chặn sớm nhất (ms)  (Task 4 nạp dữ liệu)
let previewByRoom = {};     // roomId -> tin hiển thị gần nhất (hoặc null)
let currentMessages = [];   // tin thô của phòng đang mở

let roomListRefresh = null;
let roomListUnsub = null;
let messagesUnsub = null;
let directoryUnsub = null;
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
    var d = ts ? new Date(ts) : null;
    if (!d || isNaN(d.getTime())) return '';
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
}

function ms(iso) {
    var n = Date.parse(iso);
    return isNaN(n) ? 0 : n;
}

function mapMessage(row) {
    return {
        id: row.id,
        senderId: row.sender,
        senderName: row.sender_name || '',
        text: row.body,
        createdAt: ms(row.created_at)
    };
}

function removeChannel(ch) {
    if (ch && client) { try { client.removeChannel(ch); } catch (e) { /* bỏ qua */ } }
}

// Lấy tối đa `limit` tin mới nhất của một phòng (đã ánh xạ sang dạng app).
async function fetchRoomMessages(roomId, limit) {
    if (!client) return [];
    const { data, error } = await client
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) { console.warn('fetchRoomMessages:', error); return []; }
    return (data || []).map(mapMessage);
}

/* ------------------------- Phòng chung ------------------------- */

export async function ensurePublicRoom() {
    if (!client) return;
    const { error } = await client
        .from('rooms')
        .upsert({ id: 'public', type: 'public', name: null, owner: null }, { onConflict: 'id', ignoreDuplicates: true });
    // Có thể người khác vừa tạo trước — bỏ qua.
    if (error) console.warn('ensurePublicRoom:', error);
}

/* ------------------------- Danh sách phòng ------------------------- */

function mapRoom(row, membersMap, pendingMap, myStatusMap) {
    const members = membersMap[row.id] || [];
    return {
        id: row.id,
        type: row.type,
        name: row.name,
        ownerId: row.owner,
        members: members,
        pendingMembers: (pendingMap && pendingMap[row.id]) || [],
        myStatus: (myStatusMap && myStatusMap[row.id]) || 'active',
        lastMessage: row.last_message_at ? {
            text: row.last_message_text || '',
            senderId: row.last_message_sender,
            senderName: (directoryMap[row.last_message_sender] || {}).displayName || '',
            createdAt: ms(row.last_message_at)
        } : null
    };
}

export function subscribeRoomList(cb) {
    if (!client || !currentUser) return function () { };
    const uid = currentUser.uid;

    async function refresh() {
        const [pubRes, mineRes, membersRes] = await Promise.all([
            client.from('rooms').select('*').eq('id', 'public').maybeSingle(),
            client.from('room_members').select('status, rooms(*)').eq('user_id', uid),
            client.from('room_members').select('room_id, user_id, status')
        ]);
        if (pubRes.error) console.warn('subscribeRoomList(public):', pubRes.error);
        if (mineRes.error) console.warn('subscribeRoomList(mine):', mineRes.error);
        if (membersRes.error) console.warn('subscribeRoomList(members):', membersRes.error);

        const membersMap = {};
        const pendingMap = {};
        (membersRes.data || []).forEach(function (r) {
            const target = r.status === 'pending' ? pendingMap : membersMap;
            (target[r.room_id] = target[r.room_id] || []).push(r.user_id);
        });

        const myStatusMap = {};
        (mineRes.data || []).forEach(function (r) {
            if (r.rooms) myStatusMap[r.rooms.id] = r.status || 'active';
        });

        const list = [];
        if (pubRes.data) list.push(mapRoom(pubRes.data, membersMap, pendingMap, myStatusMap));
        (mineRes.data || []).forEach(function (r) {
            const row = r.rooms;
            if (row && row.id !== 'public') list.push(mapRoom(row, membersMap, pendingMap, myStatusMap));
        });
        list.sort(function (a, b) {
            return (b.lastMessage ? b.lastMessage.createdAt : 0) - (a.lastMessage ? a.lastMessage.createdAt : 0);
        });
        roomsCache = list;
        await recomputeUnread();
        renderRoomList(list);
        if (typeof cb === 'function') cb(list);
    }

    const channel = client.channel('roomlist-' + uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, function () { refresh().catch(logErr); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members' }, function () { refresh().catch(logErr); })
        .subscribe();

    roomListRefresh = refresh;
    refresh().catch(logErr);

    roomListUnsub = function () { removeChannel(channel); roomListRefresh = null; };
    return roomListUnsub;
}

function logErr(e) { console.warn('chat:', e); }

/* ------------------------- Tin nhắn ------------------------- */

export function subscribeMessages(roomId, cb) {
    if (!client) return function () { };
    async function refetch() {
        const msgs = sortMessagesAsc(await fetchRoomMessages(roomId, 50));
        if (typeof cb === 'function') cb(msgs);
    }
    const channel = client.channel('messages-' + roomId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'room_id=eq.' + roomId },
            function () { refetch().catch(logErr); })
        .subscribe();
    refetch().catch(logErr);
    return function () { removeChannel(channel); };
}

export function openRoom(roomId) {
    if (!client || !currentUser || !roomId) return;
    const target = roomsCache.filter(function (r) { return r.id === roomId; })[0];
    if (target && target.myStatus === 'pending') return; // chưa đồng ý lời mời
    currentRoomId = roomId;
    unreadByRoom[roomId] = 0;
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
    if (!text || !client || !currentUser) return;
    const senderName = currentUser.displayName || currentUser.email || 'Người dùng';
    const { error } = await client.from('messages').insert({
        room_id: roomId,
        sender: currentUser.uid,
        sender_name: senderName,
        body: text
    });
    if (error) { console.warn('sendMessage:', error); return; }
    const { error: updErr } = await client.from('rooms').update({
        last_message_text: text,
        last_message_sender: currentUser.uid,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).eq('id', roomId);
    if (updErr) console.warn('sendMessage(room):', updErr);
    if (roomListRefresh) roomListRefresh().catch(logErr);
}

export async function markRoomRead(roomId) {
    if (!client || !currentUser || !roomId) return;
    try {
        await client.from('reads').upsert(
            { room_id: roomId, user_id: currentUser.uid, last_read_at: new Date().toISOString() },
            { onConflict: 'room_id,user_id' }
        );
        lastReadMap[roomId] = Date.now();
        unreadByRoom[roomId] = 0;
        renderRoomList(roomsCache);
    } catch (e) { /* bỏ qua, không chặn chat */ }
}

export async function clearHistory(roomId) {
    if (!client || !currentUser || !roomId || isPublicRoomId(roomId)) return;
    const now = new Date().toISOString();
    const { error } = await client.from('reads').upsert(
        { room_id: roomId, user_id: currentUser.uid, cleared_at: now },
        { onConflict: 'room_id,user_id' }
    );
    if (error) {
        console.warn('clearHistory:', error);
        if (typeof window.showToast === 'function') window.showToast('Không xoá được lịch sử trò chuyện.', 'error');
        return;
    }
    clearedMap[roomId] = Date.parse(now);
    refreshChatViews();
    if (roomListRefresh) roomListRefresh().catch(logErr);
    if (typeof window.showToast === 'function') window.showToast('Đã xoá lịch sử trò chuyện', 'info');
}

function refreshChatViews() {
    if (currentRoomId) renderMessages(currentMessages);
    recomputeUnread()
        .then(function () { renderRoomList(roomsCache); })
        .catch(logErr);
    const gi = document.getElementById('groupInfoModal');
    if (gi && !gi.classList.contains('hidden')) renderGroupInfo();
}

/* ------------------------- Chưa đọc ------------------------- */

async function recomputeUnread() {
    if (!client || !currentUser) return;
    const uid = currentUser.uid;
    const token = ++unreadToken;
    const results = {};
    const previews = {};
    await Promise.all(roomsCache.map(async function (room) {
        const msgs = sortMessagesAsc(await fetchRoomMessages(room.id, 50));
        const visible = visibleMessages(msgs, {
            clearedAt: clearedMap[room.id] == null ? null : clearedMap[room.id],
            blocked: blockedMap,
            selfUid: uid
        });
        results[room.id] = room.id === currentRoomId
            ? 0
            : unreadCount(visible, lastReadMap[room.id] == null ? null : lastReadMap[room.id]);
        previews[room.id] = visible.length ? visible[visible.length - 1] : null;
    }));
    if (token !== unreadToken) return; // có lần tính mới hơn đang chạy
    unreadByRoom = results;
    previewByRoom = previews;
}

// Nghe mốc đã đọc của chính mình để tính lại số chưa đọc.
function subscribeReads() {
    if (!client || !currentUser) return function () { };
    const uid = currentUser.uid;

    async function refetch() {
        const { data, error } = await client.from('reads').select('room_id, last_read_at, cleared_at').eq('user_id', uid);
        if (error) { console.warn('subscribeReads:', error); return; }
        const readMap = {};
        const clearMap = {};
        (data || []).forEach(function (r) {
            readMap[r.room_id] = r.last_read_at ? ms(r.last_read_at) : null;
            clearMap[r.room_id] = r.cleared_at ? ms(r.cleared_at) : null;
        });
        lastReadMap = readMap;
        clearedMap = clearMap;
        await recomputeUnread();
        renderRoomList(roomsCache);
    }

    const channel = client.channel('reads-' + uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reads', filter: 'user_id=eq.' + uid },
            function () { refetch().catch(logErr); })
        .subscribe();
    refetch().catch(logErr);
    return function () { removeChannel(channel); };
}

/* ------------------------- Danh bạ người dùng ------------------------- */

// Tương thích chữ ký cũ của main.js (phiên bản cũ). Hồ sơ công khai do
// ensureUserProfile trong cloud-sync.js đảm nhiệm; giữ hàm rỗng để không vỡ import.
export async function upsertDirectory() { /* no-op */ }

export function listDirectory(cb) {
    if (!client) return function () { };
    async function refetch() {
        const { data, error } = await client.from('profiles').select('id, username');
        if (error) { console.warn('listDirectory:', error); return; }
        const users = (data || []).map(function (p) {
            return { uid: p.id, displayName: p.username };
        });
        const map = {};
        users.forEach(function (u) { map[u.uid] = u; });
        directoryMap = map;
        directoryUsers = users;
        renderRoomList(roomsCache);
        setChatTitle();
        if (typeof cb === 'function') cb(users);
    }
    const channel = client.channel('profiles-directory')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' },
            function () { refetch().catch(logErr); })
        .subscribe();
    refetch().catch(logErr);
    return function () { removeChannel(channel); };
}

/* ------------------------- Chat riêng 1-1 ------------------------- */

export async function openDirect(otherUid) {
    if (!client || !currentUser || !otherUid) return;
    if (otherUid === currentUser.uid) return;
    const uid = currentUser.uid;
    const roomId = directRoomId(uid, otherUid);

    const { data: existing } = await client.from('rooms').select('id').eq('id', roomId).maybeSingle();
    if (!existing) {
        // Người tạo phòng thành chủ và thêm CẢ HAI thành viên (đều active, chat
        // riêng không cần chờ đồng ý). Policy room_members_insert chỉ cho chủ chèn.
        // Dùng insert thay vì upsert: upsert (ON CONFLICT) của PostgREST còn kiểm
        // tra policy SELECT của rooms, mà phòng vừa tạo chưa có thành viên nên chủ
        // chưa đọc lại được (báo 42501). Trùng id (người kia tạo trước) là 23505,
        // bỏ qua vì đã có phòng.
        const { error: insErr } = await client.from('rooms').insert(
            { id: roomId, type: 'direct', name: null, owner: uid }
        );
        if (insErr && insErr.code !== '23505') console.warn('openDirect(room):', insErr);
        const { error: memErr } = await client.from('room_members').upsert(
            [{ room_id: roomId, user_id: uid, status: 'active' },
             { room_id: roomId, user_id: otherUid, status: 'active' }],
            { onConflict: 'room_id,user_id', ignoreDuplicates: true }
        );
        if (memErr) console.warn('openDirect(members):', memErr);
    }

    if (roomListRefresh) await roomListRefresh().catch(logErr);
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
        item.innerHTML = '<div class="pick-user-name">' + esc(u.displayName || 'Người dùng') + '</div>';
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
    if (!client || !currentUser) return null;
    const uid = currentUser.uid;
    const cleanName = String(name || '').trim() || 'Nhóm';
    const ids = Array.from(new Set([uid].concat(memberUids || [])));

    // Tự sinh id ở client: không dùng .select() ngay sau insert vì phòng vừa tạo
    // chưa có dòng room_members nên policy SELECT của rooms chưa cho chủ đọc lại
    // (RETURNING sẽ báo 42501). Chèn xong thành viên rồi mới đọc qua refresh().
    const roomId = 'grp_' + uid.slice(0, 8) + '_' + Date.now().toString(36);
    const { error } = await client.from('rooms').insert({
        id: roomId,
        type: 'group',
        name: cleanName,
        owner: uid
    });
    if (error) { console.warn('createGroup:', error); return null; }

    // Người tạo là thành viên chính thức; người được mời ở trạng thái chờ đồng ý.
    const rows = ids.map(function (m) {
        return { room_id: roomId, user_id: m, status: m === uid ? 'active' : 'pending' };
    });
    const { error: memErr } = await client.from('room_members').upsert(rows, { onConflict: 'room_id,user_id', ignoreDuplicates: true });
    if (memErr) console.warn('createGroup(members):', memErr);

    if (roomListRefresh) await roomListRefresh().catch(logErr);
    openRoom(roomId);
    return roomId;
}

export async function renameGroup(roomId, name) {
    if (!client || !currentUser || !roomId) return;
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    const { error } = await client.from('rooms').update({
        name: cleanName, updated_at: new Date().toISOString()
    }).eq('id', roomId);
    if (error) console.warn('renameGroup:', error);
    if (roomListRefresh) roomListRefresh().catch(logErr);
}

export async function addGroupMembers(roomId, uids) {
    if (!client || !currentUser || !roomId || !uids || !uids.length) return;
    const rows = uids.map(function (m) { return { room_id: roomId, user_id: m, status: 'pending' }; });
    const { error } = await client.from('room_members').upsert(rows, { onConflict: 'room_id,user_id', ignoreDuplicates: true });
    if (error) { console.warn('addGroupMembers:', error); return; }
    if (typeof window.showToast === 'function') window.showToast('Đã gửi lời mời tham gia nhóm', 'info');
    if (roomListRefresh) roomListRefresh().catch(logErr);
}

export async function removeGroupMember(roomId, uid) {
    if (!client || !currentUser || !roomId || !uid) return;
    const { error } = await client.from('room_members').delete().eq('room_id', roomId).eq('user_id', uid);
    if (error) console.warn('removeGroupMember:', error);
    if (roomListRefresh) roomListRefresh().catch(logErr);
}

export async function leaveGroup(roomId) {
    if (!currentUser) return;
    await removeGroupMember(roomId, currentUser.uid);
}

// Người được mời đồng ý vào nhóm: chuyển dòng của mình sang 'active'.
export async function acceptGroupInvite(roomId) {
    if (!client || !currentUser || !roomId) return;
    const { error } = await client.from('room_members')
        .update({ status: 'active' })
        .eq('room_id', roomId)
        .eq('user_id', currentUser.uid);
    if (error) { console.warn('acceptGroupInvite:', error); return; }
    if (roomListRefresh) await roomListRefresh().catch(logErr);
    openRoom(roomId);
}

// Người được mời từ chối: xoá dòng của mình.
export async function declineGroupInvite(roomId) {
    if (!client || !currentUser || !roomId) return;
    const { error } = await client.from('room_members')
        .delete()
        .eq('room_id', roomId)
        .eq('user_id', currentUser.uid);
    if (error) { console.warn('declineGroupInvite:', error); return; }
    if (roomListRefresh) await roomListRefresh().catch(logErr);
}

function currentRoom() {
    return roomsCache.filter(function (r) { return r.id === currentRoomId; })[0] || null;
}

/* ------------------------- UI nhóm ------------------------- */

function renderCreateGroupList() {
    const el = document.getElementById('groupMemberList');
    if (!el) return;
    const uid = currentUser && currentUser.uid;
    const search = document.getElementById('groupSearch');
    const q = search ? search.value : '';
    const others = directoryUsers.filter(function (u) { return u.uid !== uid; });
    const users = filterDirectory(others, q);
    el.innerHTML = '';
    if (!users.length) {
        el.innerHTML = '<div class="pick-user-empty">Không tìm thấy người dùng nào.</div>';
        return;
    }
    users.forEach(function (u) {
        const row = document.createElement('label');
        row.className = 'group-pick-row';
        row.innerHTML =
            '<input type="checkbox" value="' + esc(u.uid) + '">' +
            '<span class="pick-user-name">' + esc(u.displayName || 'Người dùng') + '</span>';
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

        // Lời mời đang chờ (chỉ chủ nhóm thấy).
        if (isOwner) {
            (room.pendingMembers || []).forEach(function (m) {
                const info = directoryMap[m] || {};
                const row = document.createElement('div');
                row.className = 'group-member-row';
                row.innerHTML = '<span class="pick-user-name">' + esc(info.displayName || 'Người dùng') + ' (đang chờ)</span>';
                const cancel = document.createElement('button');
                cancel.type = 'button';
                cancel.className = 'icon-btn';
                cancel.title = 'Huỷ lời mời';
                cancel.innerHTML = '<svg class="ico"><use href="#i-x"/></svg>';
                cancel.addEventListener('click', function () {
                    removeGroupMember(room.id, m).catch(function (e) { console.warn('removeGroupMember:', e); });
                });
                row.appendChild(cancel);
                list.appendChild(row);
            });
        }
    }

    // Danh sách có thể thêm (owner).
    const addList = document.getElementById('groupAddList');
    if (addList && isOwner) {
        const members = (room.members || []).concat(room.pendingMembers || []);
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
            const search = document.getElementById('groupSearch');
            if (search) search.value = '';
            renderCreateGroupList();
            if (typeof window.openModal === 'function') window.openModal('createGroupModal');
        });
    }

    const groupSearch = document.getElementById('groupSearch');
    if (groupSearch && !groupSearch.dataset.wired) {
        groupSearch.dataset.wired = '1';
        groupSearch.addEventListener('input', renderCreateGroupList);
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
    // onAuthStateChange có thể phát lại cho cùng người → không dựng lại listener.
    if (currentUser) {
        if (currentUser.uid === user.uid) { currentUser = user; return; }
        teardownChat();
    }
    currentUser = user;
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
    unreadByRoom = {};
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

    const split = partitionRooms(list || [], uid);

    // Lời mời tham gia nhóm: hiện trên cùng, kèm nút Đồng ý / Từ chối.
    split.invites.forEach(function (room) {
        const label = roomLabel(room, uid, directoryMap);
        const item = document.createElement('div');
        item.className = 'room-item room-invite';
        item.dataset.roomId = room.id;
        item.innerHTML =
            '<div class="room-item-main">' +
            '<div class="room-item-name">Lời mời: ' + esc(label) + '</div>' +
            '<div class="room-item-preview">Mời bạn tham gia nhóm</div>' +
            '</div>';

        const actions = document.createElement('div');
        actions.className = 'room-invite-actions';

        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn btn-primary btn-sm';
        ok.textContent = 'Đồng ý';
        ok.addEventListener('click', function (e) {
            e.stopPropagation();
            acceptGroupInvite(room.id).catch(function (err) { console.warn('acceptGroupInvite:', err); });
        });

        const no = document.createElement('button');
        no.type = 'button';
        no.className = 'btn btn-light btn-sm';
        no.textContent = 'Từ chối';
        no.addEventListener('click', function (e) {
            e.stopPropagation();
            declineGroupInvite(room.id).catch(function (err) { console.warn('declineGroupInvite:', err); });
        });

        actions.appendChild(ok);
        actions.appendChild(no);
        item.appendChild(actions);
        el.appendChild(item);
    });

    const previewAt = function (room) {
        if (previewByRoom[room.id] !== undefined) return previewByRoom[room.id];
        return room.lastMessage;
    };
    const activeSorted = split.active.slice().sort(function (a, b) {
        const pa = previewAt(a);
        const pb = previewAt(b);
        return ((pb && pb.createdAt) || 0) - ((pa && pa.createdAt) || 0);
    });

    activeSorted.forEach(function (room) {
        const item = document.createElement('div');
        item.className = 'room-item' + (room.id === currentRoomId ? ' active' : '');
        item.dataset.roomId = room.id;
        const label = roomLabel(room, uid, directoryMap);
        const last = previewAt(room);
        const preview = last
            ? esc(last.senderName || '') + ': ' + esc(last.text || '')
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
    const gi = document.getElementById('groupInfoModal');
    if (gi && !gi.classList.contains('hidden')) renderGroupInfo();
}

function renderMessages(raw) {
    const el = document.getElementById('messageList');
    if (!el) return;
    currentMessages = Array.isArray(raw) ? raw : [];
    const uid = currentUser && currentUser.uid;
    const msgs = visibleMessages(currentMessages, {
        clearedAt: clearedMap[currentRoomId] == null ? null : clearedMap[currentRoomId],
        blocked: blockedMap,
        selfUid: uid
    });
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
