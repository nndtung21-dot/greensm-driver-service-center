-- =====================================================================
-- Phase 6: Supervisor Dashboard — Section 25
-- =====================================================================

create or replace function reassign_case(p_case_id uuid, p_to_agent_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller_role user_role; v_caller_branch uuid; v_case_branch uuid;
begin
  select role, branch_id into v_caller_role, v_caller_branch from profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('supervisor','admin') then
    raise exception 'Chỉ Supervisor/Admin được reassign ticket.';
  end if;
  select qt.branch_id into v_case_branch
  from service_cases cs join queue_tickets qt on qt.id = cs.ticket_id where cs.id = p_case_id;
  if v_caller_role = 'supervisor' and v_case_branch is distinct from v_caller_branch then
    raise exception 'Ticket không thuộc văn phòng bạn phụ trách.';
  end if;
  update service_cases set assigned_agent_id = p_to_agent_id where id = p_case_id;
end;
$$;
revoke all on function reassign_case(uuid, uuid) from public;
revoke execute on function reassign_case(uuid, uuid) from anon;
grant execute on function reassign_case(uuid, uuid) to authenticated;

create or replace function set_counter_status(p_counter_id uuid, p_status counter_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller_role user_role; v_caller_branch uuid; v_counter_branch uuid;
begin
  select role, branch_id into v_caller_role, v_caller_branch from profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('supervisor','admin') then
    raise exception 'Chỉ Supervisor/Admin được mở/đóng quầy.';
  end if;
  if p_status not in ('AVAILABLE','CLOSED') then
    raise exception 'Chỉ được đặt quầy về AVAILABLE hoặc CLOSED thủ công.';
  end if;
  select branch_id into v_counter_branch from counters where id = p_counter_id;
  if v_caller_role = 'supervisor' and v_counter_branch is distinct from v_caller_branch then
    raise exception 'Quầy không thuộc văn phòng bạn phụ trách.';
  end if;
  update counters set status = p_status,
    current_agent_id = case when p_status = 'CLOSED' then null else current_agent_id end
  where id = p_counter_id;
end;
$$;
revoke all on function set_counter_status(uuid, counter_status) from public;
revoke execute on function set_counter_status(uuid, counter_status) from anon;
grant execute on function set_counter_status(uuid, counter_status) to authenticated;

-- QUAN TRỌNG: current_role_name()/current_branch_id() phải là SECURITY DEFINER.
-- Từ đây bảng `profiles` sẽ có 2 policy SELECT trở lên; nếu 2 hàm này chạy
-- dưới quyền người gọi (mặc định), Postgres không đảm bảo thứ tự short-circuit
-- giữa các policy OR nhau -> tự gọi lại chính nó -> "stack depth limit exceeded".
-- (Lỗi này từng xảy ra thật khi build — xem docs/security-fixes-log.md.)
create or replace function current_role_name()
returns user_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = (select auth.uid());
$$;
create or replace function current_branch_id()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from profiles where id = (select auth.uid());
$$;

-- Cho phép Agent/Supervisor thấy hồ sơ đồng nghiệp CÙNG VP (chọn khi Transfer/Reassign)
create policy profiles_branch_colleagues_select on profiles for select
  using (current_role_name() in ('agent','supervisor') and branch_id = current_branch_id());
