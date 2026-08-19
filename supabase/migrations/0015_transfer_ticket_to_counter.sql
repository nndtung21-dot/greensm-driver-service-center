create or replace function transfer_ticket_to_counter(
  p_ticket_id uuid,
  p_target_counter_id uuid
)
returns table (
  ticket_id uuid,
  ticket_code text,
  queue_number text,
  target_counter_code text,
  target_agent_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid := auth.uid();
  v_role user_role;
  v_branch uuid;
  v_ticket_branch uuid;
  v_ticket_status ticket_status;
  v_target_branch uuid;
  v_target_agent uuid;
  v_target_code text;
begin
  select role, branch_id into v_role, v_branch
  from profiles where id = v_agent_id;

  if v_role is null or v_role not in ('agent', 'supervisor') then
    raise exception 'Không có quyền chuyển ticket.';
  end if;

  if v_branch is null then
    raise exception 'Tài khoản chưa được gán văn phòng.';
  end if;

  select branch_id, status
  into v_ticket_branch, v_ticket_status
  from queue_tickets
  where id = p_ticket_id
  for update;

  if v_ticket_branch is distinct from v_branch then
    raise exception 'Ticket không thuộc văn phòng của bạn.';
  end if;

  if v_ticket_status not in ('CALLED', 'PROCESSING') then
    raise exception 'Chỉ có thể chuyển ticket đang được gọi hoặc đang xử lý.';
  end if;

  select c.branch_id, c.default_agent_id, c.counter_code
  into v_target_branch, v_target_agent, v_target_code
  from counters c
  where c.id = p_target_counter_id
  for update;

  if v_target_branch is distinct from v_branch then
    raise exception 'Quầy đích không thuộc văn phòng này.';
  end if;

  if v_target_agent is null then
    raise exception 'Quầy đích chưa được gán Agent.';
  end if;

  update queue_tickets
  set status = 'WAITING',
      counter_id = null,
      called_at = null
  where id = p_ticket_id;

  update service_cases
  set status = 'WAITING',
      assigned_agent_id = v_target_agent
  where service_cases.ticket_id = p_ticket_id;

  return query
  select qt.id, qt.ticket_code, qt.queue_number,
         v_target_code, v_target_agent
  from queue_tickets qt
  where qt.id = p_ticket_id;
end;
$$;

revoke all on function transfer_ticket_to_counter(uuid, uuid) from public;
grant execute on function transfer_ticket_to_counter(uuid, uuid) to authenticated;

create or replace function call_next_ticket()
returns table (
  ticket_id uuid,
  ticket_code text,
  queue_number text,
  case_id uuid,
  counter_code text,
  driver_name text,
  category_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid := auth.uid();
  v_role user_role;
  v_branch uuid;
  v_ticket_id uuid;
  v_counter_id uuid;
  v_counter_code text;
  v_case_id uuid;
begin
  select role, branch_id into v_role, v_branch
  from profiles where id = v_agent_id;

  if v_role is null or v_role not in ('agent', 'supervisor') then
    raise exception 'Không có quyền gọi số (chỉ Agent/Supervisor).';
  end if;

  if v_branch is null then
    raise exception 'Tài khoản chưa được gán văn phòng.';
  end if;

  select qt.id into v_ticket_id
  from queue_tickets qt
  join service_cases cs on cs.ticket_id = qt.id
  where qt.branch_id = v_branch
    and qt.status = 'WAITING'
    and (cs.assigned_agent_id = v_agent_id or cs.assigned_agent_id is null)
  order by (cs.assigned_agent_id = v_agent_id) desc, qt.created_at
  for update of qt skip locked
  limit 1;

  if v_ticket_id is null then
    raise exception 'Không còn tài xế nào đang chờ (thuộc bạn hoặc chưa được phân).';
  end if;

  select c.id, c.counter_code
  into v_counter_id, v_counter_code
  from counters c
  where c.branch_id = v_branch
    and c.status = 'AVAILABLE'
    and c.default_agent_id = v_agent_id
  order by c.counter_code
  for update skip locked
  limit 1;

  if v_counter_id is null then
    raise exception 'Quầy của bạn hiện không AVAILABLE.';
  end if;

  update queue_tickets
  set status = 'CALLED',
      called_at = now(),
      counter_id = v_counter_id
  where id = v_ticket_id;

  update counters
  set status = 'BUSY',
      current_agent_id = v_agent_id
  where id = v_counter_id;

  update service_cases
  set status = 'CALLED',
      assigned_agent_id = v_agent_id
  where service_cases.ticket_id = v_ticket_id
  returning id into v_case_id;

  return query
  select qt.id, qt.ticket_code, qt.queue_number,
         v_case_id, v_counter_code, d.name, sc.name
  from queue_tickets qt
  join visits vi on vi.id = qt.visit_id
  join drivers d on d.id = vi.driver_id
  join service_categories sc on sc.id = qt.service_category_id
  where qt.id = v_ticket_id;
end;
$$;

revoke all on function call_next_ticket() from public;
grant execute on function call_next_ticket() to authenticated;
