/* ==========================================================================
   UniSchedule AI - Khởi tạo Supabase
   ES module: chạy được trong trình duyệt và trong Node (để test các guard).
   Nếu chưa điền cấu hình hoặc đang mở bằng file:// thì KHÔNG nạp SDK,
   đặt window.supabaseError tương ứng và window.supabaseReady = false.
   SDK được nạp động nên Node không gọi mạng khi test.
   ========================================================================== */

export const SDK_CDN = 'https://esm.sh/@supabase/supabase-js@2';

const g = globalThis;
const win = g.window || g;
const config = (win && win.SUPABASE_CONFIG) || g.SUPABASE_CONFIG || {};

export function isConfigReady(cfg) {
    if (!cfg) return false;
    const url = cfg.url;
    const key = cfg.anonKey;
    if (typeof url !== 'string' || typeof key !== 'string') return false;
    if (!url || !key) return false;
    if (url.indexOf('DÁN') === 0 || url.indexOf('DAN_') === 0) return false;
    if (key.indexOf('DÁN') === 0 || key.indexOf('DAN_') === 0) return false;
    return true;
}

export let client = null;

if (g.location && g.location.protocol === 'file:') {
    win.supabaseError = 'file-protocol';
    win.supabaseReady = false;
    console.error('[UniSchedule] Supabase cần chạy qua http(s); file:// không hoạt động. ' +
        'Hãy dùng server tĩnh hoặc nơi deploy (xem docs/deploy.md).');
} else if (!isConfigReady(config)) {
    win.supabaseError = 'missing-config';
    win.supabaseReady = false;
    console.error('[UniSchedule] Chưa điền cấu hình Supabase trong supabase-config.js.');
} else {
    const mod = await import(SDK_CDN);
    client = mod.createClient(config.url, config.anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });
    win.supabaseError = null;
    win.supabaseReady = true;
    console.info('[UniSchedule] Supabase đã sẵn sàng.');
}
