// supabase/functions/account/index.ts
// Edge Function "account": đăng nhập bằng tên tài khoản, gửi link khôi phục,
// và đặt lại mật khẩu bằng mã dự phòng. Deploy qua Dashboard > Edge Functions.
// Các biến môi trường SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY
// được Supabase cấp sẵn; không cần dán khóa bí mật nào.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

// Tra tên tài khoản → id + email (email KHÔNG bao giờ trả ra ngoài).
async function lookupUser(username: string): Promise<{ id: string; email: string } | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (error || !data) return null;

  const { data: got, error: userErr } = await admin.auth.admin.getUserById(data.id);
  const email = got?.user?.email;
  if (userErr || !email) return null;
  return { id: data.id, email };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const action = String(body?.action ?? '');

  try {
    if (action === 'signin') {
      const user = await lookupUser(norm(body.username));
      if (!user) return json({ error: 'Sai tên tài khoản hoặc mật khẩu.' }, 400);
      const { data, error } = await anon.auth.signInWithPassword({
        email: user.email,
        password: String(body.password ?? ''),
      });
      if (error || !data.session) {
        return json({ error: 'Sai tên tài khoản hoặc mật khẩu.' }, 400);
      }
      return json({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    }

    if (action === 'reset-email') {
      const user = await lookupUser(norm(body.username));
      if (user) {
        const redirectTo = typeof body.redirectTo === 'string' && body.redirectTo ? body.redirectTo : undefined;
        await anon.auth.resetPasswordForEmail(user.email, redirectTo ? { redirectTo } : undefined);
      }
      // Luôn báo thành công để không lộ tài khoản có tồn tại hay không.
      return json({ ok: true });
    }

    if (action === 'recover') {
      const user = await lookupUser(norm(body.username));
      if (!user) return json({ error: 'Mã dự phòng không đúng.' }, 400);

      const { data: ok, error } = await admin.rpc('verify_recovery_code', {
        p_user_id: user.id,
        p_code: String(body.code ?? ''),
      });
      if (error || !ok) return json({ error: 'Mã dự phòng không đúng.' }, 400);

      const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
        password: String(body.new_password ?? ''),
      });
      if (updErr) return json({ error: 'Không đặt lại được mật khẩu.' }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('account function error:', e);
    return json({ error: 'Lỗi máy chủ. Vui lòng thử lại.' }, 500);
  }
});
