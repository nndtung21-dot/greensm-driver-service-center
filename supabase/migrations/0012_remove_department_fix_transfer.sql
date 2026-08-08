-- Bỏ "bộ phận" khỏi luồng Transfer (lỗi: transfer sang bộ phận không chỉ định
-- Agent -> ticket kẹt, không ai claim được). Transfer giờ LUÔN chỉ định đích
-- danh Agent nhận.
create or replace function transfer_case(
  p_case_id uuid, p_to_agent_id uuid, p_reason text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid();
  v_assigned uuid;
  v_role user_role;
  v_ticket_id uuid;
  v_to_agent_branch uuid;
  v_caller_branch uuid;
begin
  if p_to_agent_id is null then
    raise exception 'Phải chọn Agent nhận ticket.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Phải nhập lý do chuyển.';
  end if;

  select assigned_agent_id, ticket_id into v_assigned, v_ticket_id from service_cases where id = p_case_id;
  select role, branch_id into v_role, v_caller_branch from profiles where id = v_agent_id;
  if v_role is null or (v_assigned is distinct from v_agent_id and v_role not in ('supervisor','admin')) then
    raise exception 'Bạn không có quyền chuyển ticket này.';
  end if;

  select branch_id into v_to_agent_branch from profiles where id = p_to_agent_id;
  if v_to_agent_branch is distinct from v_caller_branch then
    raise exception 'Chỉ được chuyển cho Agent cùng văn phòng.';
  end if;

  insert into case_transfers (case_id, from_agent_id, to_agent_id, reason, created_by)
  values (p_case_id, v_assigned, p_to_agent_id, p_reason, v_agent_id);

  update service_cases set status = 'TRANSFERRED', assigned_agent_id = p_to_agent_id
  where id = p_case_id;
  update queue_tickets set status = 'TRANSFERRED' where id = v_ticket_id;
end;
$$;
revoke all on function transfer_case(uuid, uuid, text) from public;
revoke execute on function transfer_case(uuid, uuid, text) from anon;
grant execute on function transfer_case(uuid, uuid, text) to authenticated;

drop function if exists transfer_case(uuid, uuid, uuid, text);

-- Xoá dữ liệu "bộ phận" (không cần thiết nữa)
update profiles set department_id = null;
update service_cases set assigned_department_id = null;
update case_transfers set from_department_id = null, to_department_id = null;
delete from departments;
