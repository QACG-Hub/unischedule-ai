/* ==========================================================================
   UniSchedule AI - Entry điều phối (Supabase)
   Đăng ký/đăng nhập bằng tên tài khoản + mật khẩu, khôi phục mật khẩu,
   mở app (window.startUniSchedule) + chat.
   ========================================================================== */

import {
    onAuthUser, onPasswordRecovery, signUpAccount, signInAccount,
    signOutAccount, requestPasswordReset, recoverWithCode, updatePassword,
    regenerateRecoveryCode, authErrorMessage, changePassword
} from './auth.js';
import { validateSignup, isValidRecoveryCode, GUEST_UID, isGuestUid, shouldMigrateGuest, cacheKeyFor } from './core.js';
import { initChat, teardownChat } from './chat.js';
import { ensureUserProfile } from './cloud-sync.js';

let mode = 'login';
let passwordRecovery = false;
let guestActive = false;
let upgradeMode = false;
let currentAppUser = null;
const GUEST_KEY = 'UNI_GUEST';

function $(id) { return document.getElementById(id); }

function showMsg(id, msg, warn) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
    el.classList.toggle('warn', !!warn);
}

function clearMsg(id) { showMsg(id, '', false); }

function showAuthScreen(show) {
    $('authScreen').classList.toggle('hidden', !show);
}

function showResetScreen(show) {
    $('resetScreen').classList.toggle('hidden', !show);
}

function showForgotPanel(show) {
    $('forgotPanel').classList.toggle('hidden', !show);
    $('authForm').classList.toggle('hidden', show);
    $('forgotLink').classList.toggle('hidden', show);
}

function setMode(next) {
    mode = next;
    const isReg = mode === 'register';
    $('authTabLogin').classList.toggle('active', !isReg);
    $('authTabRegister').classList.toggle('active', isReg);
    $('authLoginFields').classList.toggle('hidden', isReg);
    $('authRegisterFields').classList.toggle('hidden', !isReg);
    $('authSubmit').textContent = isReg ? 'Đăng ký' : 'Đăng nhập';
    $('authPassword').setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
    clearMsg('authError');
}

function setChatVisible(visible) {
    $('btnTabChat').classList.toggle('hidden', !visible);
    if (!visible) {
        $('chatTab').classList.add('hidden');
        if (typeof window.switchTab === 'function') window.switchTab('todayTab');
    }
}

function setHeaderMode(isGuest) {
    $('upgradeBtn').classList.toggle('hidden', !isGuest);
    $('recoveryBtn').classList.toggle('hidden', isGuest);
    $('changePasswordBtn').classList.toggle('hidden', isGuest);
}

function guestUser() {
    return { uid: GUEST_UID, id: GUEST_UID, guest: true, displayName: 'Khách', email: null };
}

function guestLocalList() {
    try {
        const raw = localStorage.getItem(cacheKeyFor(GUEST_UID));
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function enterGuestUI() {
    showAuthScreen(false);
    showResetScreen(false);
    showForgotPanel(false);
    $('userMenu').classList.remove('hidden');
    $('userName').textContent = 'Khách';
    $('userAvatar').style.display = 'none';
    setHeaderMode(true);
    setChatVisible(false);
    teardownChat();
    if (typeof window.startUniSchedule === 'function') window.startUniSchedule(guestUser());
}

function exitGuest() {
    guestActive = false;
    try { localStorage.removeItem(GUEST_KEY); } catch (e) { /* bỏ qua */ }
    if (typeof window.stopUniSchedule === 'function') window.stopUniSchedule();
    setChatVisible(true);
    setHeaderMode(false);
    $('userMenu').classList.add('hidden');
    showAuthScreen(true);
    setMode('login');
}

function applyUser(user) {
    if (user) {
        currentAppUser = user;
        guestActive = false;
        try { localStorage.removeItem(GUEST_KEY); } catch (e) { /* bỏ qua */ }
        setHeaderMode(false);
        setChatVisible(true);
        if (passwordRecovery) { showResetScreen(true); return; }
        showAuthScreen(false);
        showResetScreen(false);
        showForgotPanel(false);
        $('userMenu').classList.remove('hidden');
        $('userName').textContent = user.displayName || user.email || 'Người dùng';
        const img = $('userAvatar');
        img.removeAttribute('src');
        img.style.display = 'none';
        if (typeof window.startUniSchedule === 'function') window.startUniSchedule(user);
        initChat(user).catch(function (err) { console.warn('initChat:', err); });
        ensureUserProfile(user).catch(function (err) { console.warn('ensureUserProfile:', err); });
    } else if (guestActive) {
        currentAppUser = null;
        enterGuestUI();
    } else {
        currentAppUser = null;
        showAuthScreen(true);
        showResetScreen(false);
        $('userMenu').classList.add('hidden');
        teardownChat();
        if (typeof window.stopUniSchedule === 'function') window.stopUniSchedule();
    }
}

function showSignupErrors(errors) {
    if (errors.indexOf('username') !== -1) {
        showMsg('authError', 'Tên tài khoản 3–20 ký tự, chỉ gồm chữ thường, số và . _ -');
    } else if (errors.indexOf('email') !== -1) {
        showMsg('authError', 'Email không hợp lệ.');
    } else {
        showMsg('authError', 'Mật khẩu cần ít nhất 6 ký tự.');
    }
}

function wireRecoveryModal() {
    const copy = $('recoveryCodeCopy');
    if (copy) {
        copy.addEventListener('click', function () {
            const code = $('recoveryCodeText').textContent;
            function done() { if (typeof window.showToast === 'function') window.showToast('Đã sao chép mã dự phòng', 'info'); }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(code).then(done).catch(done);
            } else {
                done();
            }
        });
    }
    const doneBtn = $('recoveryCodeDone');
    if (doneBtn) {
        doneBtn.addEventListener('click', function () {
            if (typeof window.closeModal === 'function') window.closeModal('recoveryCodeModal');
        });
    }
}

function initAuthUI() {
    setMode('login');
    wireRecoveryModal();

    $('authTabLogin').addEventListener('click', function () { showForgotPanel(false); setMode('login'); upgradeMode = false; });
    $('authTabRegister').addEventListener('click', function () { showForgotPanel(false); setMode('register'); });

    $('upgradeBtn').addEventListener('click', function () {
        upgradeMode = true;
        $('userMenu').classList.add('hidden');
        setMode('register');
        showAuthScreen(true);
    });

    $('guestBtn').addEventListener('click', function () {
        guestActive = true;
        try { localStorage.setItem(GUEST_KEY, '1'); } catch (e) { /* bỏ qua */ }
        enterGuestUI();
    });

    $('authForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        clearMsg('authError');

        const password = $('authPassword').value;
        const btn = $('authSubmit');
        const original = btn.textContent;

        if (mode === 'register') {
            const errors = validateSignup({
                username: $('authUsername').value,
                email: $('authEmail').value,
                password: password
            });
            if (errors.length) { showSignupErrors(errors); return; }

            btn.disabled = true;
            btn.textContent = 'Đang tạo tài khoản...';
            try {
                const res = await signUpAccount({
                    username: $('authUsername').value,
                    email: $('authEmail').value,
                    password: password
                });
                $('authPassword').value = '';
                const guestList = guestLocalList();
                if (shouldMigrateGuest({ upgradeMode: upgradeMode, hasGuestData: guestList.length > 0 })) {
                    try {
                        await window.migrateLocalToCloud(res.user, guestList);
                        if (typeof window.refreshCloudSubjects === 'function') window.refreshCloudSubjects();
                    } catch (e) {
                        if (typeof window.showToast === 'function') {
                            window.showToast('Không tải được dữ liệu khách lên tài khoản. Dữ liệu vẫn còn trên máy.', 'error');
                        }
                    }
                }
                upgradeMode = false;
                if (res && res.recoveryCode) {
                    $('recoveryCodeText').textContent = res.recoveryCode;
                    if (typeof window.openModal === 'function') window.openModal('recoveryCodeModal');
                }
            } catch (err) {
                showMsg('authError', authErrorMessage(err));
            } finally {
                btn.disabled = false;
                btn.textContent = original;
            }
            return;
        }

        const identifier = $('authIdentifier').value.trim();
        if (!identifier || !password) {
            showMsg('authError', 'Vui lòng nhập tên tài khoản và mật khẩu.');
            return;
        }
        btn.disabled = true;
        btn.textContent = 'Đang đăng nhập...';
        try {
            await signInAccount(identifier, password);
            $('authPassword').value = '';
        } catch (err) {
            showMsg('authError', authErrorMessage(err));
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    });

    $('forgotLink').addEventListener('click', function () {
        clearMsg('authError');
        clearMsg('forgotMsg');
        $('forgotUsername').value = $('authIdentifier').value.trim();
        showForgotPanel(true);
    });

    $('forgotBack').addEventListener('click', function () {
        clearMsg('forgotMsg');
        showForgotPanel(false);
    });

    $('forgotSendEmail').addEventListener('click', async function () {
        clearMsg('forgotMsg');
        const id = $('forgotUsername').value.trim();
        if (!id) { showMsg('forgotMsg', 'Vui lòng nhập tên tài khoản hoặc email.'); return; }
        try {
            await requestPasswordReset(id);
        } catch (err) { /* luôn báo thành công để không lộ tài khoản */ }
        showMsg('forgotMsg', 'Nếu tài khoản tồn tại, email đặt lại mật khẩu đã được gửi. Hãy kiểm tra hộp thư.');
    });

    $('forgotSubmit').addEventListener('click', async function () {
        clearMsg('forgotMsg');
        const username = $('forgotUsername').value.trim();
        const code = $('forgotCode').value.trim();
        const newPassword = $('forgotNewPassword').value;
        if (!username) { showMsg('forgotMsg', 'Vui lòng nhập tên tài khoản.'); return; }
        if (!isValidRecoveryCode(code)) { showMsg('forgotMsg', 'Mã dự phòng phải gồm đúng 12 ký tự chữ/số.'); return; }
        if (newPassword.length < 6) { showMsg('forgotMsg', 'Mật khẩu mới cần ít nhất 6 ký tự.'); return; }
        try {
            await recoverWithCode({ username: username, code: code, newPassword: newPassword });
            $('forgotCode').value = '';
            $('forgotNewPassword').value = '';
            showMsg('forgotMsg', 'Mật khẩu đã được đặt lại. Hãy đăng nhập lại.');
        } catch (err) {
            showMsg('forgotMsg', authErrorMessage(err));
        }
    });

    $('resetSubmit').addEventListener('click', async function () {
        clearMsg('resetMsg');
        const pw = $('resetNewPassword').value;
        if (pw.length < 6) { showMsg('resetMsg', 'Mật khẩu cần ít nhất 6 ký tự.'); return; }
        try {
            await updatePassword(pw);
            passwordRecovery = false;
            showResetScreen(false);
            $('resetNewPassword').value = '';
            showAuthScreen(true);
            showMsg('authError', 'Mật khẩu đã được đặt lại. Hãy đăng nhập.');
            await signOutAccount().catch(function () { /* bỏ qua */ });
        } catch (err) {
            showMsg('resetMsg', authErrorMessage(err));
        }
    });

    $('logoutBtn').addEventListener('click', function () {
        if (guestActive) { exitGuest(); return; }
        signOutAccount().catch(function (err) { window.alert(authErrorMessage(err)); });
    });

    const recoveryBtn = $('recoveryBtn');
    if (recoveryBtn) {
        recoveryBtn.addEventListener('click', async function () {
            if (!window.confirm('Tạo mã dự phòng mới? Mã cũ sẽ không còn dùng được.')) return;
            try {
                const code = await regenerateRecoveryCode();
                $('recoveryCodeText').textContent = code;
                if (typeof window.openModal === 'function') window.openModal('recoveryCodeModal');
            } catch (err) {
                window.alert(authErrorMessage(err));
            }
        });
    }

    $('changePasswordBtn').addEventListener('click', function () {
        clearMsg('cpMsg');
        $('cpOld').value = '';
        $('cpNew').value = '';
        if (typeof window.openModal === 'function') window.openModal('changePasswordModal');
    });

    $('cpClose').addEventListener('click', function () {
        if (typeof window.closeModal === 'function') window.closeModal('changePasswordModal');
    });

    $('cpSubmit').addEventListener('click', async function () {
        clearMsg('cpMsg');
        const email = currentAppUser && currentAppUser.email ? currentAppUser.email : null;
        const oldPw = $('cpOld').value;
        const newPw = $('cpNew').value;
        if (!oldPw) { showMsg('cpMsg', 'Vui lòng nhập mật khẩu cũ.'); return; }
        if (newPw.length < 6) { showMsg('cpMsg', 'Mật khẩu mới cần ít nhất 6 ký tự.'); return; }
        try {
            await changePassword(email, oldPw, newPw);
            $('cpOld').value = '';
            $('cpNew').value = '';
            if (typeof window.closeModal === 'function') window.closeModal('changePasswordModal');
            if (typeof window.showToast === 'function') window.showToast('Đã đổi mật khẩu', 'info');
        } catch (err) {
            showMsg('cpMsg', authErrorMessage(err));
        }
    });
}

function start() {
    if (!window.supabaseReady) {
        showAuthScreen(true);
        setMode('login');
        const msg = window.supabaseError === 'file-protocol'
            ? 'Ứng dụng cần chạy qua http(s). Hãy mở bằng server tĩnh (xem docs/supabase-setup.md).'
            : (window.supabaseError === 'sdk-unavailable'
                ? 'Không tải được thư viện Supabase. Kiểm tra kết nối mạng rồi tải lại trang.'
                : 'Chưa cấu hình Supabase. Hãy điền supabase-config.js (xem docs/supabase-setup.md).');
        showMsg('authError', msg, true);
        $('authSubmit').disabled = true;
        if (typeof window.stopUniSchedule === 'function') window.stopUniSchedule();
        return;
    }

    initAuthUI();

    try { guestActive = localStorage.getItem(GUEST_KEY) === '1'; } catch (e) { /* bỏ qua */ }

    onAuthUser(applyUser);

    onPasswordRecovery(function () {
        passwordRecovery = true;
        showAuthScreen(false);
        showResetScreen(true);
        clearMsg('resetMsg');
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}
