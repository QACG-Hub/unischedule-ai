// Guard: mở bằng file:// → supabaseError = 'file-protocol', không nạp SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.SUPABASE_CONFIG = { url: 'https://demo.supabase.co', anonKey: 'sb_publishable_fake' };
globalThis.location = { protocol: 'file:' };

const mod = await import('../supabase-init.js');

test('giao thức file:// → file-protocol', () => {
  assert.equal(globalThis.supabaseReady, false);
  assert.equal(globalThis.supabaseError, 'file-protocol');
  assert.equal(mod.client, null);
});
