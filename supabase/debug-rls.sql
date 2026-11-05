-- Chẩn đoán: chạy 1 lần để mình đọc trạng thái DB từ xa.
create or replace function public.zz_policy_debug()
returns jsonb
language sql
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'current_user', current_user,
        'session_user', session_user,
        'auth_uid', auth.uid()::text,
        'auth_role', auth.role(),
        'jwt_sub', current_setting('request.jwt.claim.sub', true),
        'policies', coalesce((
            select jsonb_agg(jsonb_build_object(
                't', tablename, 'p', policyname, 'cmd', cmd,
                'perm', permissive, 'check', with_check, 'qual', qual
            ) order by tablename, policyname)
            from pg_policies
            where schemaname = 'public' and tablename in ('rooms', 'room_members', 'messages')
        ), '[]'::jsonb),
        'rooms_columns', coalesce((
            select jsonb_agg(jsonb_build_object(
                'c', column_name, 't', data_type, 'gen', is_generated,
                'nullable', is_nullable, 'def', column_default
            ) order by ordinal_position)
            from information_schema.columns
            where table_schema = 'public' and table_name = 'rooms'
        ), '[]'::jsonb),
        'rooms_triggers', coalesce((
            select jsonb_agg(jsonb_build_object(
                'tg', t.tgname, 'enabled', t.tgenabled, 'fn', p.proname, 'type', t.tgtype
            ))
            from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_proc p on p.oid = t.tgfoid
            where c.relname = 'rooms' and not t.tgisinternal
        ), '[]'::jsonb),
        'rooms_rls', (select relrowsecurity from pg_class where relname = 'rooms'),
        'rooms_forcerls', (select relforcerowsecurity from pg_class where relname = 'rooms')
    );
$$;
grant execute on function public.zz_policy_debug() to anon, authenticated;
