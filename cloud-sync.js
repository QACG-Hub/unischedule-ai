/* ==========================================================================
   UniSchedule AI - Đồng bộ thời khóa biểu với Supabase
   Nguồn sự thật là bảng `subjects`; localStorage chỉ là cache đọc nhanh.
   Cầu nối cho script.js (classic) được gán NGAY ở cấp module, vì
   script.js gọi các cầu nối này ngay khi đăng nhập.
   ========================================================================== */

import { client } from './supabase-init.js';
import { cacheKeyFor, shouldOfferUpload, legacyCacheAllowed } from './core.js';

// Cầu nối cho script.js (classic script, không import ES module được).
window.cacheKeyFor = cacheKeyFor;
window.shouldOfferUpload = shouldOfferUpload;
window.legacyCacheAllowed = legacyCacheAllowed;

let uid = null;
let channel = null;

// Đọc lại toàn bộ môn của tài khoản rồi đẩy sang script.js.
async function refetch() {
    if (!client || !uid) return;
    const { data, error } = await client
        .from('subjects')
        .select('id, payload')
        .eq('owner', uid);
    if (error) {
        console.warn('Lỗi đọc danh sách môn:', error);
        return;
    }
    const list = (data || []).map(function (row) {
        return Object.assign({ id: row.id }, row.payload || {});
    });
    if (typeof window.applyCloudSubjects === 'function') window.applyCloudSubjects(list);
}

function subjectPayload(s) {
    const payload = Object.assign({}, s);
    delete payload.id;
    return payload;
}

async function saveSubject(s) {
    if (!client || !uid || !s || !s.id) return;
    const { error } = await client
        .from('subjects')
        .upsert({ owner: uid, id: s.id, payload: subjectPayload(s), updated_at: new Date().toISOString() }, { onConflict: 'owner,id' });
    if (error) throw error;
}

async function deleteSubject(id) {
    if (!client || !uid || !id) return;
    const { error } = await client.from('subjects').delete().eq('owner', uid).eq('id', id);
    if (error) throw error;
}

async function clearAllSubjects() {
    if (!client || !uid) return;
    const { error } = await client.from('subjects').delete().eq('owner', uid);
    if (error) throw error;
}

// Nghe realtime toàn bộ môn của tài khoản.
export async function initSync(user) {
    if (!client || !user || !user.uid) return;
    uid = user.uid;
    try { localStorage.setItem('UNI_LAST_UID', uid); } catch (e) { /* bỏ qua */ }

    if (channel) { client.removeChannel(channel); channel = null; }

    channel = client
        .channel('subjects-' + uid)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'subjects',
            filter: 'owner=eq.' + uid
        }, function () {
            refetch().catch(function (e) { console.warn('Lỗi đồng bộ môn:', e); });
        })
        .subscribe();

    await refetch();
}

export function teardownSync() {
    if (channel && client) { client.removeChannel(channel); channel = null; }
    uid = null;
}

// Hồ sơ công khai: id + tên tài khoản (KHÔNG chứa email).
export async function ensureUserProfile(user) {
    if (!client || !user || !user.uid) return;
    const username = user.username || user.displayName || user.email || ('user_' + String(user.uid).slice(0, 8));
    const { error } = await client
        .from('profiles')
        .upsert({ id: user.uid, username: username }, { onConflict: 'id' });
    if (error) throw error;
}

// Cloud của tài khoản có đang trống không.
export async function cloudSubjectsEmpty(user) {
    if (!client) return true;
    const { count, error } = await client
        .from('subjects')
        .select('id', { count: 'exact', head: true })
        .eq('owner', user.uid);
    if (error) throw error;
    return !count;
}

// Ghi toàn bộ danh sách cục bộ lên tài khoản.
export async function migrateLocalToCloud(user, list) {
    if (!client) return;
    const rows = (list || [])
        .filter(function (s) { return s && s.id; })
        .map(function (s) {
            return { owner: user.uid, id: s.id, payload: subjectPayload(s), updated_at: new Date().toISOString() };
        });
    if (!rows.length) return;
    const { error } = await client.from('subjects').upsert(rows, { onConflict: 'owner,id' });
    if (error) throw error;
}

// Cầu nối bắt buộc cho script.js: gán ở cấp module (không đợi tới initSync).
window.initSync = initSync;
window.teardownSync = teardownSync;
window.cloudSubjectsEmpty = cloudSubjectsEmpty;
window.migrateLocalToCloud = migrateLocalToCloud;
window.cloudSaveSubject = function (s) {
    saveSubject(s).catch(function (e) { console.warn('cloudSaveSubject:', e); });
};
window.cloudDeleteSubject = function (id) {
    deleteSubject(id).catch(function (e) { console.warn('cloudDeleteSubject:', e); });
};
window.cloudClearAllSubjects = function () {
    clearAllSubjects().catch(function (e) { console.warn('cloudClearAllSubjects:', e); });
};
