/* ==========================================================================
   UniSchedule AI - Xác thực (Supabase)
   Đăng ký/đăng nhập bằng tên tài khoản + mật khẩu, khôi phục mật khẩu
   (email hoặc mã dự phòng). Email KHÔNG bao giờ lộ ra ngoài: việc tra email
   theo tên tài khoản do Edge Function "account" lo.
   ========================================================================== */

import { client } from './supabase-init.js';
import { normalizeUsername, looksLikeEmail } from './core.js';

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Tên Edge Function đã deploy. Mặc định "account"; có thể ghi đè trong
// supabase-config.js (accountFunction) nếu hàm được deploy dưới tên khác.
function accountFunctionName() {
    const g = globalThis;
    const cfg = (g.window && g.window.SUPABASE_CONFIG) || g.SUPABASE_CONFIG || {};
    const name = cfg && typeof cfg.accountFunction === 'string' ? cfg.accountFunction.trim() : '';
    return name || 'account';
}

function requireClient() {
    if (!client) {
        throw Object.assign(new Error('Chưa cấu hình Supabase.'), { known: true });
    }
    return client;
}

// Supabase user → đối tượng app dùng chung (uid quen thuộc với script.js/chat.js).
export function toAppUser(su) {
    if (!su) return null;
    const meta = su.user_metadata || {};
    return {
        uid: su.id,
        id: su.id,
        email: su.email || null,
        displayName: meta.username || su.email || 'Người dùng'
    };
}

// Sinh mã dự phòng 12 ký tự (bỏ các ký tự dễ nhầm như I, O, 0, 1).
export function createRecoveryCode() {
    const bytes = new Uint8Array(12);
    (globalThis.crypto || crypto).getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    }
    return out;
}

// Gọi Edge Function "account"; lỗi trả { error } → ném Error có cờ known.
async function callAccount(payload) {
    const c = requireClient();
    const { data, error } = await c.functions.invoke(accountFunctionName(), { body: payload });
    if (error) {
        let msg = 'Không kết nối được máy chủ. Vui lòng thử lại.';
        try {
            const body = await error.context.json();
            if (body && body.error) msg = body.error;
        } catch (_e) { /* giữ thông điệp mặc định */ }
        throw Object.assign(new Error(msg), { known: true });
    }
    return data;
}

export async function signUpAccount(input) {
    const c = requireClient();
    const username = normalizeUsername(input.username);
    const email = String(input.email || '').trim();
    const password = String(input.password || '');

    const { data: available, error: checkErr } = await c.rpc('is_username_available', { p_username: username });
    if (checkErr) throw checkErr;
    if (available === false) {
        throw Object.assign(new Error('Tên tài khoản đã tồn tại.'), { known: true });
    }

    const { data, error } = await c.auth.signUp({
        email: email,
        password: password,
        options: { data: { username: username } }
    });
    if (error) throw error;
    if (!data.session) {
        throw Object.assign(
            new Error('Chưa bật đăng nhập ngay. Hãy tắt "Confirm email" trong Supabase.'),
            { known: true }
        );
    }

    const recoveryCode = await regenerateRecoveryCode();
    return { user: toAppUser(data.user), recoveryCode: recoveryCode };
}

export async function signInAccount(identifier, password) {
    const c = requireClient();
    const id = String(identifier || '').trim();

    if (looksLikeEmail(id)) {
        const { data, error } = await c.auth.signInWithPassword({ email: id, password: password });
        if (error) throw error;
        return { user: toAppUser(data.user) };
    }

    const data = await callAccount({ action: 'signin', username: id, password: password });
    const { data: sessionData, error } = await c.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token
    });
    if (error) throw error;
    return { user: toAppUser(sessionData.user) };
}

export async function signOutAccount() {
    const c = requireClient();
    const { error } = await c.auth.signOut();
    if (error) throw error;
}

export function onAuthUser(cb) {
    const c = requireClient();
    const { data } = c.auth.onAuthStateChange(function (event, session) {
        if (event === 'PASSWORD_RECOVERY') return; // xử lý riêng ở onPasswordRecovery
        cb(session && session.user ? toAppUser(session.user) : null);
    });
    return function () { data.subscription.unsubscribe(); };
}

export function onPasswordRecovery(cb) {
    const c = requireClient();
    const { data } = c.auth.onAuthStateChange(function (event) {
        if (event === 'PASSWORD_RECOVERY') cb();
    });
    return function () { data.subscription.unsubscribe(); };
}

export async function requestPasswordReset(identifier) {
    const c = requireClient();
    const id = String(identifier || '').trim();
    const redirectTo = (typeof location !== 'undefined' && location.origin) ? location.origin : undefined;

    if (looksLikeEmail(id)) {
        await c.auth.resetPasswordForEmail(id, redirectTo ? { redirectTo: redirectTo } : undefined);
        return { ok: true };
    }
    await callAccount({ action: 'reset-email', username: id, redirectTo: redirectTo });
    return { ok: true };
}

export async function recoverWithCode(input) {
    await callAccount({
        action: 'recover',
        username: normalizeUsername(input.username),
        code: String(input.code || '').trim().toUpperCase(),
        new_password: String(input.newPassword || '')
    });
    return { ok: true };
}

export async function updatePassword(newPassword) {
    const c = requireClient();
    const { error } = await c.auth.updateUser({ password: String(newPassword || '') });
    if (error) throw error;
}

export async function regenerateRecoveryCode() {
    const c = requireClient();
    const code = createRecoveryCode();
    const { error } = await c.rpc('set_my_recovery_code', { p_code: code });
    if (error) throw error;
    return code;
}

const ERROR_MESSAGES = {
    'Invalid login credentials': 'Sai tên tài khoản hoặc mật khẩu.',
    'User already registered': 'Email này đã được đăng ký.',
    'Email not confirmed': 'Email chưa được xác nhận.',
    'Password should be at least 6 characters': 'Mật khẩu quá yếu (cần ít nhất 6 ký tự).',
    'Unable to validate email address: invalid format': 'Email không hợp lệ.',
    'Email address': 'Email không hợp lệ.',
    'email rate limit exceeded': 'Bạn thử quá nhiều lần. Vui lòng đợi một lát.',
    'For security purposes, you can only request this after': 'Bạn thử quá nhiều lần. Vui lòng đợi một lát.',
    'Failed to fetch': 'Mất kết nối mạng. Vui lòng thử lại.',
    'NetworkError': 'Mất kết nối mạng. Vui lòng thử lại.'
};

export function authErrorMessage(err) {
    if (!err) return 'Đã xảy ra lỗi. Vui lòng thử lại.';
    const m = String(err.message || '');
    if (Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, m)) return ERROR_MESSAGES[m];
    for (const key in ERROR_MESSAGES) {
        if (m.indexOf(key) !== -1) return ERROR_MESSAGES[key];
    }
    if (err.known && m) return m;
    return 'Đã xảy ra lỗi: ' + (m || 'không rõ');
}
