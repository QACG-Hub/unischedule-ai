# Triển khai UniSchedule AI (web tĩnh)

App là web tĩnh (HTML/CSS/JS thuần), **không cần build**. Chỉ cần đưa toàn bộ
thư mục lên một dịch vụ host tĩnh có **HTTPS**. Xem `docs/supabase-setup.md`
để tạo project Supabase và lấy cấu hình trước.

> ⚠️ Phải chạy qua `http(s)`. Mở trực tiếp bằng `file://` sẽ không hoạt động
> (module ES bị chặn) — `supabase-init.js` sẽ phát hiện và báo lỗi.

## 1. Điền cấu hình trước khi deploy

Mở `supabase-config.js` và dán **Project URL** + **anon/publishable key**:

```js
window.SUPABASE_CONFIG = {
    url: 'https://<project-id>.supabase.co',
    anonKey: '<anon-publishable-key>'
};
```

Trong Supabase → **Authentication → URL Configuration**:
- **Site URL**: địa chỉ deploy (VD `https://unischedule.pages.dev`).
- **Redirect URLs**: thêm cùng địa chỉ đó (để link khôi phục mật khẩu quay lại đúng trang).

> Nếu đổi địa chỉ deploy, nhớ cập nhật lại Site URL / Redirect URLs trong Supabase.

## 2. Cách A — Cloudflare Pages (khuyên dùng, miễn phí)

1. Đẩy thư mục dự án lên GitHub/GitLab, **hoặc** dùng "Direct Upload".
2. Vào https://pages.cloudflare.com → **Create a project**.
3. Nếu nối Git:
   - **Framework preset**: `None`.
   - **Build command**: để trống.
   - **Build output directory**: `/` (thư mục gốc).
4. Bấm **Save and Deploy**. Cloudflare cấp URL dạng `https://<ten>.pages.dev`.
5. Mở URL, kiểm tra theo checklist trong `docs/supabase-setup.md`.

## 3. Cách B — GitHub Pages

1. Đẩy toàn bộ thư mục lên một repo GitHub.
2. Repo → **Settings → Pages** → **Source**: `Deploy from a branch`.
3. Chọn branch (`main`) và thư mục `/ (root)` → **Save**.
4. Đợi 1–2 phút, mở `https://<user>.github.io/<repo>/`.
5. Cập nhật **Site URL** / **Redirect URLs** trong Supabase cho khớp URL này.

## 4. Cách C — bất kỳ host tĩnh nào

Copy toàn bộ file (trừ `supabase/`, `docs/`, `tests/`, `.superpowers/` nếu muốn gọn)
lên host (Vercel, Netlify, Nginx, ...). Yêu cầu duy nhất: phục vụ qua **HTTPS**
và giữ nguyên cấu trúc thư mục (các module import lẫn nhau bằng đường dẫn tương đối).

## 5. Chạy thử cục bộ trước khi deploy

```bash
cd /public/tkb
npx serve
```

Mở địa chỉ `npx serve` in ra (VD `http://localhost:3000`). Nhớ thêm
`http://localhost:3000` vào **Redirect URLs** trong Supabase nếu thử luồng email.

## 6. Cập nhật về sau

Vì là web tĩnh, deploy lại = copy lại file. Không có bước build.
Khi sửa bảng/RLS, chạy lại `supabase/schema.sql` trong SQL Editor (file an toàn
khi chạy lặp). Khi sửa hàm `account`, deploy lại Edge Function đó.
