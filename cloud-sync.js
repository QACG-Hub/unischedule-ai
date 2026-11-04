/* ==========================================================================
   UniSchedule AI - Đồng bộ thời khóa biểu với Firestore
   Nguồn sự thật là Firestore; localStorage chỉ là cache đọc nhanh.
   SDK Firestore được nạp lười để không gọi mạng khi chưa cần.
   ========================================================================== */

import { db, SDK_VERSION } from './firebase-init.js';
import { cacheKeyFor, shouldOfferUpload } from './core.js';

// Cầu nối cho script.js (classic script, không import ES module được).
window.cacheKeyFor = cacheKeyFor;
window.shouldOfferUpload = shouldOfferUpload;

let fs = null;
async function loadFs() {
    if (!fs) {
        fs = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`);
    }
    return fs;
}

let uid = null;
let unsubscribe = null;

function subjectRef(S, id) {
    return S.doc(db, 'users', uid, 'subjects', id);
}

async function saveSubject(s) {
    if (!uid || !s || !s.id) return;
    const S = await loadFs();
    const payload = Object.assign({}, s);
    delete payload.id;
    payload.updatedAt = S.serverTimestamp();
    await S.setDoc(subjectRef(S, s.id), payload);
}

async function deleteSubject(id) {
    if (!uid || !id) return;
    const S = await loadFs();
    await S.deleteDoc(subjectRef(S, id));
}

async function clearAllSubjects() {
    if (!uid) return;
    const S = await loadFs();
    const snap = await S.getDocs(S.collection(db, 'users', uid, 'subjects'));
    const batch = S.writeBatch(db);
    snap.docs.forEach(function (d) { batch.delete(d.ref); });
    await batch.commit();
}

// Nghe realtime toàn bộ môn của tài khoản. Trả hàm hủy đăng ký.
export async function initSync(user) {
    uid = user.uid;
    try { localStorage.setItem('UNI_LAST_UID', uid); } catch (e) { /* bỏ qua */ }

    window.cloudSaveSubject = function (s) {
        saveSubject(s).catch(function (e) { console.warn('cloudSaveSubject:', e); });
    };
    window.cloudDeleteSubject = function (id) {
        deleteSubject(id).catch(function (e) { console.warn('cloudDeleteSubject:', e); });
    };
    window.cloudClearAllSubjects = function () {
        clearAllSubjects().catch(function (e) { console.warn('cloudClearAllSubjects:', e); });
    };

    const S = await loadFs();
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    unsubscribe = S.onSnapshot(S.collection(db, 'users', uid, 'subjects'), function (snap) {
        const list = snap.docs.map(function (d) {
            return Object.assign({ id: d.id }, d.data());
        });
        if (typeof window.applyCloudSubjects === 'function') window.applyCloudSubjects(list);
    }, function (err) {
        console.warn('Lỗi nghe danh sách môn:', err);
    });

    return unsubscribe;
}

export function teardownSync() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    uid = null;
}

// Cloud của tài khoản có đang trống không.
export async function cloudSubjectsEmpty(user) {
    const S = await loadFs();
    const snap = await S.getDocs(S.collection(db, 'users', user.uid, 'subjects'));
    return snap.size === 0;
}

// Ghi toàn bộ danh sách cục bộ lên tài khoản.
export async function migrateLocalToCloud(user, list) {
    const S = await loadFs();
    const batch = S.writeBatch(db);
    (list || []).forEach(function (s) {
        if (!s || !s.id) return;
        const payload = Object.assign({}, s);
        delete payload.id;
        payload.updatedAt = S.serverTimestamp();
        batch.set(S.doc(db, 'users', user.uid, 'subjects', s.id), payload);
    });
    await batch.commit();
}
