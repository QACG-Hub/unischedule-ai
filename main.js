/* ==========================================================================
   UniSchedule AI - Entry điều phối
   Chờ trạng thái đăng nhập: có user → mở app (window.startUniSchedule),
   chưa có → hiện màn đăng nhập và ẩn app.
   ========================================================================== */

import {
    onAuthUser, signInEmail, signUpEmail, signInGoogle,
    signOutUser, handleRedirectResult, authErrorMessage
} from './auth.js';
import { validateRegistration } from './core.js';

let mode = 'login';

function $(id) { return document.getElementById(id); }

function showError(msg, warn) {
    const el = $('authError');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.toggle('warn', !!warn);
}

function clearError() {
    const el = $('authError');
    el.textContent = '';
    el.classList.add('hidden');
    el.classList.remove('warn');
}

function setMode(next) {
    mode = next;
    const isReg = mode === 'register';
    $('authTabLogin').classList.toggle('active', !isReg);
    $('authTabRegister').classList.toggle('active', isReg);
    $('authNameWrap').classList.toggle('hidden', !isReg);
    $('authName').required = isReg;
    $('authSubmit').textContent = isReg ? 'Đăng ký' : 'Đăng nhập';
    $('authPassword').setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
    clearError();
}

function showAuthScreen(show) {
    $('authScreen').classList.toggle('hidden', !show);
}

function applyUser(user) {
    if (user) {
        showAuthScreen(false);
        $('userMenu').classList.remove('hidden');
        $('userName').textContent = user.displayName || user.email || 'Người dùng';
        const img = $('userAvatar');
        if (user.photoURL) { img.src = user.photoURL; img.style.display = ''; }
        else { img.removeAttribute('src'); img.style.display = 'none'; }
        if (typeof window.startUniSchedule === 'function') window.startUniSchedule(user);
    } else {
        showAuthScreen(true);
        $('userMenu').classList.add('hidden');
        if (typeof window.stopUniSchedule === 'function') window.stopUniSchedule();
    }
}

function initAuthUI() {
    $('authTabLogin').addEventListener('click', function () { setMode('login'); });
    $('authTabRegister').addEventListener('click', function () { setMode('register'); });

    $('authForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        clearError();

        const name = $('authName').value.trim();
        const email = $('authEmail').value.trim();
        const password = $('authPassword').value;

        if (mode === 'register') {
            const errors = validateRegistration({ name: name, email: email, password: password });
            if (errors.length) {
                if (errors.indexOf('name') !== -1) showError('Vui lòng nhập họ tên.');
                else if (errors.indexOf('email') !== -1) showError('Email không hợp lệ.');
                else showError('Mật khẩu cần ít nhất 6 ký tự.');
                return;
            }
        }

        const btn = $('authSubmit');
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = mode === 'register' ? 'Đang tạo tài khoản...' : 'Đang đăng nhập...';
        try {
            if (mode === 'register') await signUpEmail(name, email, password);
            else await signInEmail(email, password);
            $('authPassword').value = '';
        } catch (err) {
            showError(authErrorMessage(err));
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    });

    $('authGoogle').addEventListener('click', async function () {
        clearError();
        try { await signInGoogle(); }
        catch (err) { showError(authErrorMessage(err)); }
    });

    $('logoutBtn').addEventListener('click', function () {
        signOutUser().catch(function (err) { window.alert(authErrorMessage(err)); });
    });

    handleRedirectResult().catch(function (err) { showError(authErrorMessage(err)); });
}

function start() {
    if (!window.firebaseReady) {
        showAuthScreen(true);
        setMode('login');
        const msg = window.firebaseError === 'file-protocol'
            ? 'Ứng dụng cần chạy qua http(s). Hãy mở bằng server tĩnh (xem docs/firebase-setup.md).'
            : 'Chưa cấu hình Firebase. Hãy điền firebase-config.js (xem docs/firebase-setup.md).';
        showError(msg, true);
        $('authSubmit').disabled = true;
        $('authGoogle').disabled = true;
        if (typeof window.stopUniSchedule === 'function') window.stopUniSchedule();
        return;
    }
    initAuthUI();
    onAuthUser(applyUser);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}
