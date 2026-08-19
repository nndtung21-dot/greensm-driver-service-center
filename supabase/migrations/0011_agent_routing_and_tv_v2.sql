-- =====================================================================
-- Tự động phân bổ ticket theo Agent-Chủ đề + Map Agent-Quầy + TV theo quầy
-- =====================================================================

alter table counters add column if not exists default_agent_id uuid references profiles(id);

create or replace function create_checkin(
  p_driver_id uuid, p_branch_id uuid, p_category_id uuid,
  p_subcategory_id uuid, p_description text
)
returns table (visit_code text, ticket_code text, queue_number text)
language plpgsql security definer set search_path = public as $$
declare
  v_visit_id uuid; v_ticket_id uuid; v_business_date date := current_date;
  v_visit_code text; v_ticket_code text; v_queue_number text;
  v_sla_minutes int; v_assigned_agent uuid;
begin
  v_visit_code := 'V' || to_char(now(), 'YYYYMMDD') || lpad(floor(random()*9999)::text, 4, '0');
  v_ticket_code := 'T' || to_char(now(), 'YYYYMMDD') || lpad(floor(random()*9999)::text, 4, '0');

  insert into visits (visit_code, driver_id, branch_id)
  values (v_visit_code, p_driver_id, p_branch_id) returning id into v_visit_id;

  v_queue_number := generate_queue_number(p_branch_id, v_business_date);

  insert into queue_tickets (ticket_code, visit_id, branch_id, business_date, queue_number, service_category_id, status)
  values (v_ticket_code, v_visit_id, p_branch_id, v_business_date, v_queue_number, p_category_id, 'WAITING')
  returning id into v_ticket_id;

  v_sla_minutes := resolve_sla_minutes(p_branch_id, p_category_id, p_subcategory_id);

  select aca.agent_id into v_assigned_agent
  from agent_category_assignments aca
  join profiles p on p.id = aca.agent_id
  where aca.category_id = p_category_id and p.branch_id = p_branch_id
  order by (
    select count(*) from service_cases cs
    where cs.assigned_agent_id = aca.agent_id and cs.status in ('WAITING','CALLED','PROCESSING')
  ) asc, random()
  limit 1;

  insert into service_cases (case_code, ticket_id, visit_id, driver_id, category_id, subcategory_id, status, description, sla_due_at, assigned_agent_id)
  values (
    v_ticket_code, v_ticket_id, v_visit_id, p_driver_id, p_category_id, p_subcategory_id, 'WAITING', p_description,
    case when v_sla_minutes is not null then now() + (v_sla_minutes || ' minutes')::interval else null end,
    v_assigned_agent
  );

  return query select v_visit_code, v_ticket_code, v_queue_number;
end;
$$;

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

  select qt.id into v_ticket_id
  from queue_tickets qt
  join service_cases cs on cs.ticket_id = qt.id
  where qt.branch_id = v_branch and qt.status = 'WAITING'
    and (cs.assigned_agent_id = v_agent_id or cs.assigned_agent_id is null)
  order by (cs.assigned_agent_id = v_agent_id) desc, qt.created_at
  for update skip locked limit 1;

  if v_ticket_id is null then
    raise exception 'Không còn tài xế nào đang chờ (thuộc bạn hoặc chưa được phân).';
  end if;

  select c.id, c.counter_code into v_counter_id, v_counter_code
  from counters c
  where c.branch_id = v_branch and c.status = 'AVAILABLE'
  order by (c.default_agent_id = v_agent_id) desc, c.counter_code
  for update skip locked limit 1;

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

drop function if exists tv_counters_status(text);
drop function if exists tv_agent_queue_list(text);

create function tv_counters_status(p_branch_code text)
returns table (
  counter_code text, counter_name text, counter_status counter_status,
  agent_id uuid, agent_name text, queue_number text, called_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select co.counter_code, co.counter_name, co.status, co.default_agent_id, p.full_name,
    qt.queue_number, qt.called_at
  from counters co
  join branches b on b.id = co.branch_id
  left join profiles p on p.id = co.default_agent_id
  left join queue_tickets qt on qt.counter_id = co.id and qt.status in ('CALLED','PROCESSING')
  where b.branch_code = p_branch_code
  order by co.counter_code;
$$;
revoke all on function tv_counters_status(text) from public;
grant execute on function tv_counters_status(text) to anon, authenticated;

create function tv_agent_queue_list(p_branch_code text)
returns table (agent_id uuid, ticket_code text, queue_number text, driver_name text, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select cs.assigned_agent_id, qt.ticket_code, qt.queue_number, d.name, qt.created_at
  from queue_tickets qt
  join service_cases cs on cs.ticket_id = qt.id
  join visits v on v.id = qt.visit_id
  join drivers d on d.id = v.driver_id
  join branches b on b.id = qt.branch_id
  where b.branch_code = p_branch_code
    and qt.status in ('WAITING', 'CALLED', 'PROCESSING')
  order by qt.created_at;
$$;
revoke all on function tv_agent_queue_list(text) from public;
grant execute on function tv_agent_queue_list(text) to anon, authenticated;
