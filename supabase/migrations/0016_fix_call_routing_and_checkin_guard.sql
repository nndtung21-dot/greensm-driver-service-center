-- =====================================================================
-- Fix 1: call_next_ticket() trong 0015_transfer_ticket_to_counter.sql bị
-- gãy hoàn toàn — JOIN counters qua qt.counter_id, nhưng ticket ở trạng
-- thái WAITING KHÔNG BAO GIỜ có counter_id (chỉ được set khi CALLED).
-- => INNER JOIN loại sạch mọi ticket đang chờ => Agent bấm "Gọi tiếp theo"
-- luôn nhận lỗi "Không còn tài xế nào đang chờ tại quầy của bạn" dù hàng
-- chờ có người.
--
-- Sửa: xác định ticket "thuộc" Agent qua service_cases.assigned_agent_id
-- (đã gán sẵn lúc check-in theo agent_category_assignments — xem 0011),
-- không qua counter_id của ticket. Quầy chỉ được chọn ở bước gán counter,
-- sau khi đã tìm được ticket.
--
-- Giữ cơ chế fallback: ticket chưa có agent nào phụ trách (không match
-- agent_category_assignments) vẫn được Agent bất kỳ trong VP nhận, để
-- không bị kẹt ticket mồ côi.
-- =====================================================================

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
  select role, branch_id into v_role, v_branch from profiles where id = v_agent_id;

  if v_role is null then
    raise exception 'Không tìm thấy thông tin tài khoản.';
  end if;
  if v_role not in ('agent', 'supervisor', 'admin') then
    raise exception 'Không có quyền gọi số.';
  end if;
  if v_branch is null then
    raise exception 'Tài khoản chưa được gán văn phòng.';
  end if;

  -- Tìm ticket WAITING:
  --   Agent   : ticket đã được phân cho mình (assigned_agent_id = mình)
  --             HOẶC chưa ai phụ trách (assigned_agent_id is null).
  --   Supervisor/Admin: mọi ticket WAITING trong VP.
  select qt.id into v_ticket_id
  from queue_tickets qt
  join service_cases cs on cs.ticket_id = qt.id
  where qt.branch_id = v_branch
    and qt.status = 'WAITING'
    and (
      v_role in ('supervisor', 'admin')
      or (v_role = 'agent' and (cs.assigned_agent_id = v_agent_id or cs.assigned_agent_id is null))
    )
  order by (cs.assigned_agent_id = v_agent_id) desc, qt.created_at
  for update of qt skip locked
  limit 1;

  if v_ticket_id is null then
    raise exception 'Không còn tài xế nào đang chờ.';
  end if;

  -- Chọn quầy trống:
  --   Agent   : chỉ quầy mặc định của chính mình (default_agent_id).
  --   Supervisor/Admin: bất kỳ quầy trống nào trong VP.
  select c.id, c.counter_code into v_counter_id, v_counter_code
  from counters c
  where c.branch_id = v_branch
    and c.status = 'AVAILABLE'
    and (v_role in ('supervisor', 'admin') or c.default_agent_id = v_agent_id)
  order by (c.default_agent_id = v_agent_id) desc, c.counter_code
  for update skip locked
  limit 1;

  if v_counter_id is null and v_role = 'agent' then
    raise exception 'Bạn chưa được gán quầy, hoặc quầy của bạn đang bận/đóng.';
  end if;

  update queue_tickets
  set status = 'CALLED', called_at = now(), counter_id = v_counter_id
  where id = v_ticket_id;

  if v_counter_id is not null then
    update counters set status = 'BUSY', current_agent_id = v_agent_id where id = v_counter_id;
  end if;

  update service_cases set status = 'CALLED', assigned_agent_id = v_agent_id
  where service_cases.ticket_id = v_ticket_id
  returning id into v_case_id;

  return query
  select qt.id, qt.ticket_code, qt.queue_number, v_case_id, v_counter_code, d.name, sc.name
  from queue_tickets qt
  join visits vi on vi.id = qt.visit_id
  join drivers d on d.id = vi.driver_id
  join service_categories sc on sc.id = qt.service_category_id
  where qt.id = v_ticket_id;
end;
$$;

revoke all on function call_next_ticket() from public;
grant execute on function call_next_ticket() to authenticated;

-- ---------------------------------------------------------------------
-- Fix 2: call_specific_ticket() (Agent bấm "Gọi" ở 1 dòng cụ thể trong
-- danh sách) trước đây chọn BẤT KỲ quầy trống nào, không nhất quán với
-- mô hình "mỗi Agent có quầy riêng" đã áp dụng cho call_next_ticket.
-- Sửa cho đồng nhất: Agent chỉ dùng quầy mặc định của mình.
-- ---------------------------------------------------------------------

create or replace function call_specific_ticket(p_ticket_id uuid)
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
  v_ticket_branch uuid;
  v_ticket_status ticket_status;
  v_counter_id uuid;
  v_counter_code text;
  v_case_id uuid;
begin
  select role, branch_id into v_role, v_branch from profiles where id = v_agent_id;
  if v_role is null or v_role not in ('agent', 'supervisor', 'admin') then
    raise exception 'Không có quyền gọi số (chỉ Agent/Supervisor/Admin).';
  end if;

  select branch_id, status into v_ticket_branch, v_ticket_status
  from queue_tickets where id = p_ticket_id for update;

  if v_ticket_branch is distinct from v_branch then
    raise exception 'Ticket không thuộc văn phòng của bạn.';
  end if;
  if v_ticket_status <> 'WAITING' then
    raise exception 'Ticket này không còn ở trạng thái chờ.';
  end if;

  select c.id, c.counter_code into v_counter_id, v_counter_code
  from counters c
  where c.branch_id = v_branch
    and c.status = 'AVAILABLE'
    and (v_role in ('supervisor', 'admin') or c.default_agent_id = v_agent_id)
  order by (c.default_agent_id = v_agent_id) desc, c.counter_code
  for update skip locked
  limit 1;

  if v_counter_id is null and v_role = 'agent' then
    raise exception 'Bạn chưa được gán quầy, hoặc quầy của bạn đang bận/đóng.';
  end if;

  update queue_tickets set status = 'CALLED', called_at = now(), counter_id = v_counter_id
  where id = p_ticket_id;

  if v_counter_id is not null then
    update counters set status = 'BUSY', current_agent_id = v_agent_id where id = v_counter_id;
  end if;

  update service_cases set status = 'CALLED', assigned_agent_id = v_agent_id
  where service_cases.ticket_id = p_ticket_id
  returning id into v_case_id;

  return query
  select qt.id, qt.ticket_code, qt.queue_number, v_case_id, v_counter_code, d.name, sc.name
  from queue_tickets qt
  join visits vi on vi.id = qt.visit_id
  join drivers d on d.id = vi.driver_id
  join service_categories sc on sc.id = qt.service_category_id
  where qt.id = p_ticket_id;
end;
$$;

revoke all on function call_specific_ticket(uuid) from public;
revoke execute on function call_specific_ticket(uuid) from anon;
grant execute on function call_specific_ticket(uuid) to authenticated;

-- =====================================================================
-- Fix 3: create_checkin() — 2 lỗi:
--
--   a) Không chặn tài xế check-in khi đang có ticket chưa hoàn tất.
--      Front-end (CheckinFlow.tsx) đã có sẵn logic hiển thị lỗi này
--      nhưng DB chưa từng raise nó -> tài xế bấm nhiều lần ra nhiều số.
--
--   b) visit_code/ticket_code sinh từ random()*9999 (chỉ 10.000 tổ hợp/
--      ngày) trong khi có unique constraint -> theo bài toán ngày sinh,
--      xác suất trùng đã ở mức đáng kể chỉ với vài chục lượt/ngày, gây
--      lỗi "duplicate key" và làm sập lượt check-in đó.
--
--      Sửa: ghép mã từ branch_code + ngày + queue_number (đã atomic/
--      unique tuyệt đối nhờ generate_queue_number) -> loại bỏ hoàn toàn
--      phụ thuộc vào random(), không còn khả năng trùng theo lý thuyết.
-- =====================================================================

create or replace function create_checkin(
  p_driver_id uuid,
  p_branch_id uuid,
  p_category_id uuid,
  p_subcategory_id uuid,
  p_description text
)
returns table (visit_code text, ticket_code text, queue_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit_id uuid;
  v_ticket_id uuid;
  v_business_date date := current_date;
  v_branch_code text;
  v_visit_code text;
  v_ticket_code text;
  v_queue_number text;
  v_sla_minutes int;
  v_assigned_agent uuid;
begin
  -- (a) Chặn check-in trùng khi tài xế đang có ticket chưa hoàn tất
  if exists (
    select 1 from service_cases cs
    where cs.driver_id = p_driver_id
      and cs.status in ('WAITING', 'CALLED', 'PROCESSING', 'PENDING', 'TRANSFERRED')
  ) then
    raise exception 'Tài xế này đang có ticket chưa hoàn tất, vui lòng chờ xử lý xong trước khi check-in mới.';
  end if;

  select branch_code into v_branch_code from branches where id = p_branch_id and status = 'ACTIVE';
  if v_branch_code is null then
    raise exception 'Không tìm thấy văn phòng hợp lệ.';
  end if;

  -- (b) Số thứ tự atomic trước, rồi mới ghép mã — không còn random()
  v_queue_number := generate_queue_number(p_branch_id, v_business_date);
  v_visit_code := 'V' || v_branch_code || to_char(v_business_date, 'YYYYMMDD') || v_queue_number;
  v_ticket_code := 'T' || v_branch_code || to_char(v_business_date, 'YYYYMMDD') || v_queue_number;

  insert into visits (visit_code, driver_id, branch_id)
  values (v_visit_code, p_driver_id, p_branch_id)
  returning id into v_visit_id;

  insert into queue_tickets (
    ticket_code, visit_id, branch_id, business_date,
    queue_number, service_category_id, status
  ) values (
    v_ticket_code, v_visit_id, p_branch_id, v_business_date,
    v_queue_number, p_category_id, 'WAITING'
  ) returning id into v_ticket_id;

  v_sla_minutes := resolve_sla_minutes(p_branch_id, p_category_id, p_subcategory_id);

  select aca.agent_id into v_assigned_agent
  from agent_category_assignments aca
  join profiles p on p.id = aca.agent_id
  where aca.category_id = p_category_id and p.branch_id = p_branch_id
  order by (
    select count(*) from service_cases cs
    where cs.assigned_agent_id = aca.agent_id and cs.status in ('WAITING', 'CALLED', 'PROCESSING')
  ) asc, random()
  limit 1;

  insert into service_cases (
    case_code, ticket_id, visit_id, driver_id, category_id, subcategory_id,
    status, description, sla_due_at, assigned_agent_id
  ) values (
    v_ticket_code, v_ticket_id, v_visit_id, p_driver_id, p_category_id, p_subcategory_id, 'WAITING', p_description,
    case when v_sla_minutes is not null then now() + (v_sla_minutes || ' minutes')::interval else null end,
    v_assigned_agent
  );

  return query select v_visit_code, v_ticket_code, v_queue_number;
end;
$$;

revoke all on function create_checkin(uuid, uuid, uuid, uuid, text) from public;
grant execute on function create_checkin(uuid, uuid, uuid, uuid, text) to anon, authenticated;

-- =====================================================================
-- End of migration 0016
-- =====================================================================
