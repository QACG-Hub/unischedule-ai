// Guard: chưa điền cấu hình → supabaseError = 'missing-config', không nạp SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConfigReady } from '../supabase-init.js';

test('isConfigReady: cần url + anonKey thật', () => {
  assert.equal(isConfigReady({ url: 'https://x.supabase.co', anonKey: 'sb_publishable_abc' }), true);
  assert.equal(isConfigReady({ url: '', anonKey: 'k' }), false);
  assert.equal(isConfigReady({ url: 'u', anonKey: '' }), false);
  assert.equal(isConfigReady({ url: 'DÁN_URL', anonKey: 'k' }), false);
  assert.equal(isConfigReady({ url: 'DAN_URL', anonKey: 'k' }), false);
  assert.equal(isConfigReady(null), false);
});

test('guard: thiếu cấu hình → supabaseReady=false, supabaseError=missing-config', () => {
  assert.equal(globalThis.supabaseReady, false);
  assert.equal(globalThis.supabaseError, 'missing-config');
});
