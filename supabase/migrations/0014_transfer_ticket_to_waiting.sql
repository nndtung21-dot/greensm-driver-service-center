create or replace function transfer_ticket_to_waiting(p_ticket_id uuid)
returns void
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
  v_counter_id uuid;
begin
  select p.role, p.branch_id
  into v_role, v_branch
  from profiles p
  where p.id = v_agent_id;

  if v_role is null or v_role not in ('agent', 'supervisor') then
    raise exception 'Không có quyền chuyển ticket.';
  end if;

  select
    qt.branch_id,
    qt.status,
    qt.counter_id
  into
    v_ticket_branch,
    v_ticket_status,
    v_counter_id
  from queue_tickets qt
  where qt.id = p_ticket_id
  for update;

  if v_ticket_branch is null then
    raise exception 'Không tìm thấy ticket.';
  end if;

  if v_ticket_branch is distinct from v_branch then
    raise exception 'Ticket không thuộc văn phòng của bạn.';
  end if;

  if v_ticket_status not in ('CALLED', 'PROCESSING') then
    raise exception 'Ticket hiện không ở trạng thái đang xử lý.';
  end if;

  update queue_tickets qt
  set
    status = 'WAITING',
    counter_id = null,
    called_at = null
  where qt.id = p_ticket_id;

  update service_cases cs
  set
    status = 'WAITING',
    assigned_agent_id = null
  where cs.ticket_id = p_ticket_id;

  if v_counter_id is not null then
    update counters c
    set
      status = 'AVAILABLE',
      current_agent_id = null
    where c.id = v_counter_id
      and c.status = 'BUSY';
  end if;
end;
$$;

revoke all on function transfer_ticket_to_waiting(uuid) from public;
grant execute on function transfer_ticket_to_waiting(uuid) to authenticated;
