// Guard: mở bằng file:// → firebaseError = 'file-protocol', không nạp SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.FIREBASE_CONFIG = {
    apiKey: 'AIzaSyFakeButNotPlaceholder1234567890',
    authDomain: 'demo.firebaseapp.com',
    projectId: 'demo',
    storageBucket: 'demo.appspot.com',
    messagingSenderId: '1234567890',
    appId: '1:1234567890:web:abcdef'
};
globalThis.location = { protocol: 'file:' };

await import('../firebase-init.js');

test('giao thức file:// → file-protocol', () => {
    assert.equal(globalThis.firebaseReady, false);
    assert.equal(globalThis.firebaseError, 'file-protocol');
});
