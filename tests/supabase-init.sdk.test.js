// Guard: cấu hình hợp lệ nhưng KHÔNG nạp được SDK (mất mạng/CDN) →
// supabaseError = 'sdk-unavailable', không làm sập cả app.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.SUPABASE_CONFIG = { url: 'https://demo.supabase.co', anonKey: 'sb_publishable_fake' };
globalThis.location = { protocol: 'http:' };

const mod = await import('../supabase-init.js');

test('SDK không nạp được → sdk-unavailable, ready=false', () => {
    assert.equal(globalThis.supabaseReady, false);
    assert.equal(globalThis.supabaseError, 'sdk-unavailable');
    assert.equal(mod.client, null);
});
