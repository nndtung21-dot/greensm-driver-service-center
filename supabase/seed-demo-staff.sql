-- =====================================================================
-- Seed: 7 tài khoản demo (5 Agent + 2 Supervisor) — Section 35
-- ⚠️ CHỈ DÙNG ĐỂ TEST. Xoá/đổi mật khẩu trước khi giao cho nhân viên thật.
-- Chạy trong Supabase SQL Editor (cần quyền ghi vào schema auth).
-- =====================================================================

do $$
declare
  v_password text := 'GreenSM#Demo2026'; -- đổi ngay nếu dùng thật
  staff_data record; v_user_id uuid; v_branch_id uuid; v_dept_id uuid;
begin
  for staff_data in
    select * from (values
      ('agent1.demo@greensm.internal', 'Agent Demo 1', 'agent'::user_role, 'HCM01', 'Vận hành'),
      ('agent2.demo@greensm.internal', 'Agent Demo 2', 'agent'::user_role, 'HCM01', 'Tài chính'),
      ('agent3.demo@greensm.internal', 'Agent Demo 3', 'agent'::user_role, 'HCM01', 'Xe / Pin / Sạc'),
      ('agent4.demo@greensm.internal', 'Agent Demo 4', 'agent'::user_role, 'HAN01', 'Vận hành'),
      ('agent5.demo@greensm.internal', 'Agent Demo 5', 'agent'::user_role, 'HAN01', 'Tài chính'),
      ('supervisor1.demo@greensm.internal', 'Supervisor Demo 1', 'supervisor'::user_role, 'HCM01', null),
      ('supervisor2.demo@greensm.internal', 'Supervisor Demo 2', 'supervisor'::user_role, 'HAN01', null)
    ) as t(email, full_name, role, branch_code, department_name)
  loop
    select id into v_branch_id from branches where branch_code = staff_data.branch_code;
    v_dept_id := null;
    if staff_data.department_name is not null then
      select id into v_dept_id from departments where name = staff_data.department_name;
    end if;
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      staff_data.email, crypt(v_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      false, now(), now(), '', '', '', '', false, false
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_user_id, v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', staff_data.email),
      'email', now(), now(), now()
    );

    insert into profiles (id, full_name, email, role, branch_id, department_id)
    values (v_user_id, staff_data.full_name, staff_data.email, staff_data.role, v_branch_id, v_dept_id);
  end loop;
end $$;
