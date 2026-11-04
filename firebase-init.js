/* ==========================================================================
   UniSchedule AI - Khởi tạo Firebase
   ES module: chạy được trong trình duyệt và trong Node (để test các guard).
   Nếu chưa điền cấu hình hoặc đang mở bằng file:// thì KHÔNG nạp SDK,
   đặt window.firebaseError tương ứng và window.firebaseReady = false.
   ========================================================================== */

export const SDK_VERSION = '13.2.0';

const g = globalThis;
const win = g.window || g;
const config = (win && win.FIREBASE_CONFIG) || g.FIREBASE_CONFIG || {};

function isConfigReady(cfg) {
    const key = cfg && cfg.apiKey;
    return typeof key === 'string' && key.length > 0
        && key.indexOf('DÁN') !== 0 && key.indexOf('DAN_') !== 0;
}

export let app = null;
export let auth = null;
export let db = null;

if (g.location && g.location.protocol === 'file:') {
    win.firebaseError = 'file-protocol';
    win.firebaseReady = false;
    console.error('[UniSchedule] Firebase cần chạy qua http(s); file:// không hoạt động. ' +
        'Hãy dùng server tĩnh hoặc Firebase Hosting.');
} else if (!isConfigReady(config)) {
    win.firebaseError = 'missing-config';
    win.firebaseReady = false;
    console.error('[UniSchedule] Chưa điền cấu hình Firebase trong firebase-config.js.');
} else {
    const { initializeApp } = await import(
        `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`);
    const { getAuth } = await import(
        `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`);
    const { initializeFirestore, persistentLocalCache } = await import(
        `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`);

    app = initializeApp(config);
    auth = getAuth(app);
    db = initializeFirestore(app, { localCache: persistentLocalCache() });

    win.SDK_VERSION = SDK_VERSION;
    win.firebaseReady = true;
    console.info('[UniSchedule] Firebase đã sẵn sàng (SDK ' + SDK_VERSION + ').');
}
