-- =====================================================================
-- Phase 3: Agent Portal — Sections 13-21
-- (Bản gộp: đã sửa sẵn các lỗi RLS/grant phát hiện trong quá trình build
-- thật — xem docs/security-fixes-log.md để biết chi tiết từng lỗi.)
-- =====================================================================

drop policy if exists service_cases_staff_update on service_cases;

create or replace view v_agent_queue with (security_invoker = true) as
select
  qt.id as ticket_id, qt.ticket_code, qt.queue_number, qt.branch_id, qt.status,
  qt.created_at, qt.called_at, qt.counter_id, co.counter_code,
  d.name as driver_name, d.sap_id, sc.name as category_name,
  cs.id as case_id, cs.assigned_agent_id, cs.sla_due_at, cs.resolved_at, cs.closed_at
from queue_tickets qt
join visits v on v.id = qt.visit_id
join drivers d on d.id = v.driver_id
join service_categories sc on sc.id = qt.service_category_id
join service_cases cs on cs.ticket_id = qt.id
left join counters co on co.id = qt.counter_id;

create or replace view v_case_detail with (security_invoker = true) as
select
  cs.id as case_id, cs.status, cs.description, cs.resolution, cs.internal_note,
  cs.created_at, cs.started_at, cs.resolved_at, cs.closed_at, cs.sla_due_at,
  cs.assigned_agent_id, qt.id as ticket_id, qt.ticket_code, qt.queue_number, qt.called_at,
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

-- Agent phải thấy được toàn bộ ticket đang chờ của VP mình, không chỉ ticket
-- đã gán cho họ (cần thiết cho "Queue của tôi" / "Gọi tiếp theo" — Section 15)
create policy service_cases_staff_select on service_cases for select
  using (
    current_role_name() = 'admin'
    or assigned_agent_id = (select auth.uid())
    or (
      current_role_name() in ('agent','supervisor')
      and exists (
        select 1 from queue_tickets qt
        where qt.id = service_cases.ticket_id and qt.branch_id = current_branch_id()
      )
    )
  );

create or replace function call_next_ticket()
returns table (ticket_id uuid, ticket_code text, queue_number text, case_id uuid, counter_code text, driver_name text, category_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid(); v_role user_role; v_branch uuid;
  v_ticket_id uuid; v_counter_id uuid; v_counter_code text; v_case_id uuid;
begin
  select role, branch_id into v_role, v_branch from profiles where id = v_agent_id;
  if v_role is null or v_role not in ('agent','supervisor') then
    raise exception 'Không có quyền gọi số (chỉ Agent/Supervisor).';
  end if;
  if v_branch is null then raise exception 'Tài khoản chưa được gán văn phòng (branch_id).'; end if;

  select qt.id into v_ticket_id from queue_tickets qt
  where qt.branch_id = v_branch and qt.status = 'WAITING'
  order by qt.created_at for update skip locked limit 1;
  if v_ticket_id is null then raise exception 'Không còn tài xế nào đang chờ.'; end if;

  select c.id, c.counter_code into v_counter_id, v_counter_code from counters c
  where c.branch_id = v_branch and c.status = 'AVAILABLE'
  order by c.counter_code for update skip locked limit 1;

  update queue_tickets set status = 'CALLED', called_at = now(), counter_id = v_counter_id where id = v_ticket_id;
  if v_counter_id is not null then
    update counters set status = 'BUSY', current_agent_id = v_agent_id where id = v_counter_id;
  end if;
  update service_cases set status = 'CALLED', assigned_agent_id = v_agent_id
  where service_cases.ticket_id = v_ticket_id returning id into v_case_id;

  return query
  select qt.id, qt.ticket_code, qt.queue_number, v_case_id, v_counter_code, d.name, sc.name
  from queue_tickets qt
  join visits vi on vi.id = qt.visit_id join drivers d on d.id = vi.driver_id
  join service_categories sc on sc.id = qt.service_category_id
  where qt.id = v_ticket_id;
end;
$$;
revoke all on function call_next_ticket() from public;
revoke execute on function call_next_ticket() from anon;
grant execute on function call_next_ticket() to authenticated;

create or replace function call_specific_ticket(p_ticket_id uuid)
returns table (ticket_id uuid, ticket_code text, queue_number text, case_id uuid, counter_code text, driver_name text, category_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid(); v_role user_role; v_branch uuid;
  v_ticket_branch uuid; v_ticket_status ticket_status;
  v_counter_id uuid; v_counter_code text; v_case_id uuid;
begin
  select role, branch_id into v_role, v_branch from profiles where id = v_agent_id;
  if v_role is null or v_role not in ('agent','supervisor') then
    raise exception 'Không có quyền gọi số (chỉ Agent/Supervisor).';
  end if;
  select branch_id, status into v_ticket_branch, v_ticket_status from queue_tickets where id = p_ticket_id for update;
  if v_ticket_branch is distinct from v_branch then raise exception 'Ticket không thuộc văn phòng của bạn.'; end if;
  if v_ticket_status <> 'WAITING' then raise exception 'Ticket này không còn ở trạng thái chờ.'; end if;

  select c.id, c.counter_code into v_counter_id, v_counter_code from counters c
  where c.branch_id = v_branch and c.status = 'AVAILABLE'
  order by c.counter_code for update skip locked limit 1;

  update queue_tickets set status = 'CALLED', called_at = now(), counter_id = v_counter_id where id = p_ticket_id;
  if v_counter_id is not null then
    update counters set status = 'BUSY', current_agent_id = v_agent_id where id = v_counter_id;
  end if;
  update service_cases set status = 'CALLED', assigned_agent_id = v_agent_id
  where service_cases.ticket_id = p_ticket_id returning id into v_case_id;

  return query
  select qt.id, qt.ticket_code, qt.queue_number, v_case_id, v_counter_code, d.name, sc.name
  from queue_tickets qt
  join visits vi on vi.id = qt.visit_id join drivers d on d.id = vi.driver_id
  join service_categories sc on sc.id = qt.service_category_id
  where qt.id = p_ticket_id;
end;
$$;
revoke all on function call_specific_ticket(uuid) from public;
revoke execute on function call_specific_ticket(uuid) from anon;
grant execute on function call_specific_ticket(uuid) to authenticated;

create or replace function start_processing(p_case_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid(); v_ticket_id uuid; v_assigned uuid; v_role user_role;
begin
  select assigned_agent_id, ticket_id into v_assigned, v_ticket_id from service_cases where id = p_case_id;
  select role into v_role from profiles where id = v_agent_id;
  if v_role is null or (v_assigned is distinct from v_agent_id and v_role not in ('supervisor','admin')) then
    raise exception 'Bạn không có quyền xử lý ticket này.';
  end if;
  update service_cases set status = 'PROCESSING', started_at = coalesce(started_at, now()) where id = p_case_id;
  update queue_tickets set status = 'PROCESSING', serving_at = coalesce(serving_at, now()) where id = v_ticket_id;
end;
$$;
revoke all on function start_processing(uuid) from public;
revoke execute on function start_processing(uuid) from anon;
grant execute on function start_processing(uuid) to authenticated;

create or replace function resolve_case(p_case_id uuid, p_resolution text, p_internal_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid(); v_ticket_id uuid; v_assigned uuid; v_role user_role; v_counter_id uuid;
begin
  select assigned_agent_id, ticket_id into v_assigned, v_ticket_id from service_cases where id = p_case_id;
  select role into v_role from profiles where id = v_agent_id;
  if v_role is null or (v_assigned is distinct from v_agent_id and v_role not in ('supervisor','admin')) then
    raise exception 'Bạn không có quyền hoàn tất ticket này.';
  end if;
  update service_cases set status = 'RESOLVED', resolution = p_resolution, internal_note = p_internal_note, resolved_at = now()
  where id = p_case_id;
  select counter_id into v_counter_id from queue_tickets where id = v_ticket_id;
  update queue_tickets set status = 'RESOLVED', completed_at = now() where id = v_ticket_id;
  if v_counter_id is not null then
    update counters set status = 'AVAILABLE', current_agent_id = null where id = v_counter_id and status = 'BUSY';
  end if;
end;
$$;
revoke all on function resolve_case(uuid, text, text) from public;
revoke execute on function resolve_case(uuid, text, text) from anon;
grant execute on function resolve_case(uuid, text, text) to authenticated;

create or replace function close_case(p_case_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid(); v_assigned uuid; v_role user_role; v_ticket_id uuid;
begin
  select assigned_agent_id, ticket_id into v_assigned, v_ticket_id from service_cases where id = p_case_id;
  select role into v_role from profiles where id = v_agent_id;
  if v_role is null or (v_assigned is distinct from v_agent_id and v_role not in ('supervisor','admin')) then
    raise exception 'Bạn không có quyền đóng ticket này.';
  end if;
  update service_cases set status = 'CLOSED', closed_at = now() where id = p_case_id;
  update queue_tickets set status = 'CLOSED' where id = v_ticket_id;
end;
$$;
revoke all on function close_case(uuid) from public;
revoke execute on function close_case(uuid) from anon;
grant execute on function close_case(uuid) to authenticated;

alter publication supabase_realtime add table queue_tickets;
alter publication supabase_realtime add table service_cases;
alter publication supabase_realtime add table counters;

-- Các hàm nội bộ thuần tuý không cần lộ qua PostgREST RPC
revoke execute on function generate_queue_number(uuid, date) from anon, authenticated;
revoke execute on function log_case_status_change() from anon, authenticated;
revoke execute on function resolve_sla_minutes(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function set_updated_at() from anon, authenticated;
