-- =====================================================================
-- Phase 4: TV Display (Section 18) + Phase 5: Transfer/Pending/SLA (22-23)
-- =====================================================================

alter table service_cases add column if not exists pending_reason text;
alter table service_cases add column if not exists pending_next_step text;
alter table service_cases add column if not exists pending_expected_at date;
alter table service_cases add column if not exists sla_paused_at timestamptz;

-- v_case_detail cần thêm 3 cột pending_* cho màn hình ticket detail
drop view if exists v_case_detail;
create view v_case_detail with (security_invoker = true) as
select
  cs.id as case_id, cs.status, cs.description, cs.resolution, cs.internal_note,
  cs.created_at, cs.started_at, cs.resolved_at, cs.closed_at, cs.sla_due_at,
  cs.assigned_agent_id, cs.pending_reason, cs.pending_next_step, cs.pending_expected_at,
  qt.id as ticket_id, qt.ticket_code, qt.queue_number, qt.called_at,
  vi.visit_code, vi.checkin_at, br.branch_name,
  d.name as driver_name, d.sap_id, d.contract_type, d.vehicle_type,
  sc.name as category_name, ssc.name as subcategory_name
from service_cases cs
join queue_tickets qt on qt.id = cs.ticket_id
join visits vi on vi.id = cs.visit_id
join branches br on br.id = vi.branch_id
join drivers d on d.id = cs.driver_id
join service_categories sc on sc.id = cs.category_id
left join service_subcategories ssc on ssc.id = cs.subcategory_id;

create or replace function set_case_pending(
  p_case_id uuid, p_reason text, p_next_step text, p_expected_date date default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid(); v_assigned uuid; v_role user_role; v_ticket_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'Phải nhập lý do Pending.'; end if;
  if p_next_step is null or length(trim(p_next_step)) = 0 then raise exception 'Phải nhập bước tiếp theo.'; end if;
  select assigned_agent_id, ticket_id into v_assigned, v_ticket_id from service_cases where id = p_case_id;
  select role into v_role from profiles where id = v_agent_id;
  if v_role is null or (v_assigned is distinct from v_agent_id and v_role not in ('supervisor','admin')) then
    raise exception 'Bạn không có quyền đặt Pending ticket này.';
  end if;
  update service_cases set status = 'PENDING', pending_reason = p_reason, pending_next_step = p_next_step,
    pending_expected_at = p_expected_date, sla_paused_at = now() where id = p_case_id;
  update queue_tickets set status = 'PENDING' where id = v_ticket_id;
end;
$$;
revoke all on function set_case_pending(uuid, text, text, date) from public;
revoke execute on function set_case_pending(uuid, text, text, date) from anon;
grant execute on function set_case_pending(uuid, text, text, date) to authenticated;

create or replace function resume_case(p_case_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid(); v_assigned uuid; v_role user_role;
  v_ticket_id uuid; v_paused_at timestamptz; v_sla_due timestamptz;
begin
  select assigned_agent_id, ticket_id, sla_paused_at, sla_due_at
    into v_assigned, v_ticket_id, v_paused_at, v_sla_due from service_cases where id = p_case_id;
  select role into v_role from profiles where id = v_agent_id;
  if v_role is null or (v_assigned is distinct from v_agent_id and v_role not in ('supervisor','admin')) then
    raise exception 'Bạn không có quyền tiếp tục xử lý ticket này.';
  end if;
  update service_cases set status = 'PROCESSING',
    sla_due_at = case when v_paused_at is not null and v_sla_due is not null
                       then v_sla_due + (now() - v_paused_at) else v_sla_due end,
    sla_paused_at = null where id = p_case_id;
  update queue_tickets set status = 'PROCESSING' where id = v_ticket_id;
end;
$$;
revoke all on function resume_case(uuid) from public;
revoke execute on function resume_case(uuid) from anon;
grant execute on function resume_case(uuid) to authenticated;

create or replace function transfer_case(
  p_case_id uuid, p_to_department_id uuid, p_to_agent_id uuid default null, p_reason text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid(); v_assigned uuid; v_from_dept uuid; v_role user_role; v_ticket_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'Phải nhập lý do chuyển.'; end if;
  select assigned_agent_id, assigned_department_id, ticket_id
    into v_assigned, v_from_dept, v_ticket_id from service_cases where id = p_case_id;
  select role into v_role from profiles where id = v_agent_id;
  if v_role is null or (v_assigned is distinct from v_agent_id and v_role not in ('supervisor','admin')) then
    raise exception 'Bạn không có quyền chuyển ticket này.';
  end if;
  insert into case_transfers (case_id, from_agent_id, to_agent_id, from_department_id, to_department_id, reason, created_by)
  values (p_case_id, v_assigned, p_to_agent_id, v_from_dept, p_to_department_id, p_reason, v_agent_id);
  update service_cases set status = 'TRANSFERRED', assigned_department_id = p_to_department_id, assigned_agent_id = p_to_agent_id
  where id = p_case_id;
  update queue_tickets set status = 'TRANSFERRED' where id = v_ticket_id;
end;
$$;
revoke all on function transfer_case(uuid, uuid, uuid, text) from public;
revoke execute on function transfer_case(uuid, uuid, uuid, text) from anon;
grant execute on function transfer_case(uuid, uuid, uuid, text) to authenticated;

-- start_processing: nay chấp nhận cả TRANSFERRED (Section 19: TRANSFERRED -> PROCESSING),
-- và cho phép Agent đầu tiên bấm "Bắt đầu xử lý" TỰ NHẬN ticket nếu chưa ai phụ trách
-- (trường hợp Transfer sang bộ phận mà chưa chỉ định Agent cụ thể).
create or replace function start_processing(p_case_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid();
  v_ticket_id uuid;
  v_assigned uuid;
  v_role user_role;
  v_status ticket_status;
begin
  select assigned_agent_id, ticket_id, status into v_assigned, v_ticket_id, v_status
  from service_cases where id = p_case_id;
  select role into v_role from profiles where id = v_agent_id;

  if v_role is null then
    raise exception 'Không xác định được vai trò người dùng.';
  end if;
  if v_assigned is not null and v_assigned <> v_agent_id and v_role not in ('supervisor','admin') then
    raise exception 'Ticket đã được gán cho người khác.';
  end if;
  if v_status not in ('CALLED','TRANSFERRED') then
    raise exception 'Ticket không ở trạng thái có thể bắt đầu xử lý.';
  end if;

  update service_cases
  set status = 'PROCESSING', started_at = coalesce(started_at, now()),
      assigned_agent_id = coalesce(assigned_agent_id, v_agent_id)
  where id = p_case_id;
  update queue_tickets set status = 'PROCESSING', serving_at = coalesce(serving_at, now()) where id = v_ticket_id;
end;
$$;
revoke all on function start_processing(uuid) from public;
revoke execute on function start_processing(uuid) from anon;
grant execute on function start_processing(uuid) to authenticated;

-- Section 18: TV Display — public, KHÔNG lộ tên/SAP ID tài xế
create or replace function tv_now_serving(p_branch_code text)
returns table (queue_number text, counter_code text, called_at timestamptz)
language sql security definer set search_path = public stable as $$
  select qt.queue_number, co.counter_code, qt.called_at
  from queue_tickets qt
  join branches b on b.id = qt.branch_id
  left join counters co on co.id = qt.counter_id
  where b.branch_code = p_branch_code and qt.status in ('CALLED','PROCESSING')
  order by qt.called_at desc nulls last limit 5;
$$;
revoke all on function tv_now_serving(text) from public;
grant execute on function tv_now_serving(text) to anon, authenticated;

create or replace function tv_waiting_count(p_branch_code text)
returns integer
language sql security definer set search_path = public stable as $$
  select count(*)::int from queue_tickets qt
  join branches b on b.id = qt.branch_id
  where b.branch_code = p_branch_code and qt.status = 'WAITING';
$$;
revoke all on function tv_waiting_count(text) from public;
grant execute on function tv_waiting_count(text) to anon, authenticated;
