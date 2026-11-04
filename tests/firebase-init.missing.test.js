// Guard: chưa điền cấu hình → firebaseError = 'missing-config', không nạp SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.FIREBASE_CONFIG = {
    apiKey: 'DÁN_API_KEY',
    authDomain: 'DÁN.firebaseapp.com',
    projectId: 'DÁN_PROJECT_ID',
    storageBucket: 'DÁN.appspot.com',
    messagingSenderId: 'DÁN_SENDER_ID',
    appId: 'DÁN_APP_ID'
};
globalThis.location = { protocol: 'http:' };

const mod = await import('../firebase-init.js');

test('cấu hình placeholder → missing-config, SDK không được khởi tạo', () => {
    assert.equal(globalThis.firebaseReady, false);
    assert.equal(globalThis.firebaseError, 'missing-config');
    assert.equal(mod.app, null);
    assert.equal(mod.auth, null);
    assert.equal(mod.db, null);
});
