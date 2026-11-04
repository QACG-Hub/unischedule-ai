/* ==========================================================================
   UniSchedule AI - Xác thực
   Bọc Firebase Auth: đăng nhập/đăng ký email, Google, đăng xuất, theo dõi phiên.
   SDK được nạp lười (chỉ khi gọi hàm) để không tốn mạng khi cấu hình thiếu.
   ========================================================================== */

import { auth, SDK_VERSION } from './firebase-init.js';

let sdk = null;
async function loadSdk() {
    if (!sdk) {
        sdk = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`);
    }
    return sdk;
}

export async function signInEmail(email, password) {
    const S = await loadSdk();
    return S.signInWithEmailAndPassword(auth, email, password);
}

export async function signUpEmail(name, email, password) {
    const S = await loadSdk();
    const cred = await S.createUserWithEmailAndPassword(auth, email, password);
    if (name) await S.updateProfile(cred.user, { displayName: name });
    return cred;
}

export async function signInGoogle() {
    const S = await loadSdk();
    const provider = new S.GoogleAuthProvider();
    try {
        return await S.signInWithPopup(auth, provider);
    } catch (err) {
        const code = err && err.code;
        if (code === 'auth/popup-blocked' ||
            code === 'auth/operation-not-supported-in-this-environment' ||
            code === 'auth/cancelled-popup-request') {
            return S.signInWithRedirect(auth, provider);
        }
        throw err;
    }
}

export async function handleRedirectResult() {
    const S = await loadSdk();
    return S.getRedirectResult(auth);
}

export async function signOutUser() {
    const S = await loadSdk();
    return S.signOut(auth);
}

export async function onAuthUser(cb) {
    const S = await loadSdk();
    return S.onAuthStateChanged(auth, cb);
}

const ERROR_MESSAGES = {
    'auth/invalid-email': 'Email không hợp lệ.',
    'auth/user-not-found': 'Không tìm thấy tài khoản với email này.',
    'auth/wrong-password': 'Sai mật khẩu.',
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
    'auth/email-already-in-use': 'Email này đã được đăng ký.',
    'auth/weak-password': 'Mật khẩu quá yếu (cần ít nhất 6 ký tự).',
    'auth/network-request-failed': 'Mất kết nối mạng. Vui lòng thử lại.',
    'auth/too-many-requests': 'Bạn thử quá nhiều lần. Vui lòng đợi một lát.',
    'auth/popup-closed-by-user': 'Bạn đã đóng cửa sổ đăng nhập Google.',
    'auth/unauthorized-domain': 'Tên miền này chưa được cho phép trong Firebase Auth.'
};

export function authErrorMessage(err) {
    if (!err) return 'Đã xảy ra lỗi. Vui lòng thử lại.';
    return ERROR_MESSAGES[err.code] || 'Đã xảy ra lỗi: ' + (err.code || err.message || 'không rõ');
}
