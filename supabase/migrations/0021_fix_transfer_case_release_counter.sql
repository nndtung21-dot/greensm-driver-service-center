-- 0021: Fix transfer_case leaving the old counter stuck at BUSY forever.
--
-- Bug: when a CALLED/PROCESSING ticket was transferred to a different
-- agent via transfer_case(), the ticket correctly went back to WAITING
-- with counter_id cleared, but the *counter itself* (counters.status /
-- current_agent_id) was never released. The counter stayed BUSY with
-- the old agent forever, so:
--   - call_next_ticket()/call_specific_ticket() on that counter always
--     failed with "Quầy đang bận hoặc không khả dụng."
--   - the TV display showed a stuck, empty counter card indefinitely.
--
-- Fix: mirror the same release-the-old-counter logic already used by
-- resolve_case(), mark_no_show(), set_case_pending() and
-- transfer_ticket_to_counter().

CREATE OR REPLACE FUNCTION public.transfer_case(p_case_id uuid, p_to_agent_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agent_id uuid := auth.uid();
  v_assigned uuid;
  v_role user_role;
  v_ticket_id uuid;
  v_to_agent_branch uuid;
  v_caller_branch uuid;
  v_old_counter uuid;
  v_old_status ticket_status;
begin
  if p_to_agent_id is null then
    raise exception 'Phải chọn Agent nhận ticket.';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Phải nhập lý do chuyển.';
  end if;

  select sc.assigned_agent_id, sc.ticket_id
    into v_assigned, v_ticket_id
  from public.service_cases as sc
  where sc.id = p_case_id
  for update;

  if v_ticket_id is null then
    raise exception 'Không tìm thấy ticket của case.';
  end if;

  select p.role, p.branch_id
    into v_role, v_caller_branch
  from public.profiles as p
  where p.id = v_agent_id
    and p.status = 'ACTIVE';

  if v_role is null or (v_assigned is distinct from v_agent_id and v_role not in ('supervisor','admin')) then
    raise exception 'Bạn không có quyền chuyển ticket này.';
  end if;

  select p.branch_id
    into v_to_agent_branch
  from public.profiles as p
  where p.id = p_to_agent_id
    and p.status = 'ACTIVE';

  if v_to_agent_branch is null then
    raise exception 'Agent nhận ticket không tồn tại hoặc không ACTIVE.';
  end if;

  if v_to_agent_branch is distinct from v_caller_branch then
    raise exception 'Chỉ được chuyển cho Agent cùng văn phòng.';
  end if;

  -- Lấy quầy + trạng thái hiện tại của ticket TRƯỚC khi update,
  -- để biết có cần giải phóng quầy hay không.
  select qt.counter_id, qt.status
    into v_old_counter, v_old_status
  from public.queue_tickets qt
  where qt.id = v_ticket_id
  for update;

  insert into public.case_transfers
    (case_id, from_agent_id, to_agent_id, reason, created_by)
  values
    (p_case_id, v_assigned, p_to_agent_id, p_reason, v_agent_id);

  update public.service_cases as sc
  set status = 'WAITING',
      assigned_agent_id = p_to_agent_id
  where sc.id = p_case_id;

  update public.queue_tickets as qt
  set status = 'WAITING',
      counter_id = null,
      called_at = null,
      serving_at = null
  where qt.id = v_ticket_id;

  -- BUGFIX: chuyển ticket sang Agent khác phải giải phóng quầy cũ.
  -- Trước đây quầy bị kẹt ở BUSY vĩnh viễn sau khi ticket đã rời đi,
  -- khiến TV hiển thị sai và agent/supervisor không gọi được ticket
  -- mới ở quầy đó nữa.
  if v_old_status in ('CALLED','PROCESSING') and v_old_counter is not null then
    update public.counters c
    set status = 'AVAILABLE',
        current_agent_id = null
    where c.id = v_old_counter
      and c.status = 'BUSY';
  end if;
end;
$function$;
