-- =====================================================================
-- Theo yêu cầu: SLA tính từ thời điểm Agent BẮT ĐẦU XỬ LÝ (start_processing)
-- đến khi HOÀN TẤT (resolve_case), thay vì tính từ lúc tài xế CHECK-IN
-- (create_checkin) như trước. Lý do đổi: thời gian tài xế ngồi CHỜ trong
-- hàng đợi (WAITING/CALLED) không nên bị trừ vào thời hạn SLA xử lý hồ sơ
-- của Agent.
--
-- Không cần cột mới: sla_due_at vẫn dùng lại, chỉ đổi THỜI ĐIỂM được set
-- — từ create_checkin() sang start_processing(). Trong lúc ticket còn
-- WAITING/CALLED, sla_due_at = NULL -> SlaBadge (đã có sẵn) tự hiển thị
-- "—" thay vì đếm ngược sai. resume_case()/set_case_pending() (pause/
-- resume khi PENDING) không cần sửa vì chúng chỉ CỘNG/TRỪ tương đối vào
-- sla_due_at hiện có, không quan tâm nó được set từ đâu.
-- =====================================================================

-- 1) create_checkin(): không set sla_due_at nữa (giữ NULL cho tới khi
--    Agent bắt đầu xử lý).
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
  v_assigned_agent uuid;
begin
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

  select aca.agent_id into v_assigned_agent
  from agent_category_assignments aca
  join profiles p on p.id = aca.agent_id
  where aca.category_id = p_category_id and p.branch_id = p_branch_id
  order by (
    select count(*) from service_cases cs
    where cs.assigned_agent_id = aca.agent_id and cs.status in ('WAITING', 'CALLED', 'PROCESSING')
  ) asc, random()
  limit 1;

  -- sla_due_at CHƯA set ở đây nữa (NULL cho tới khi start_processing()).
  insert into service_cases (
    case_code, ticket_id, visit_id, driver_id, category_id, subcategory_id,
    status, description, assigned_agent_id
  ) values (
    v_ticket_code, v_ticket_id, v_visit_id, p_driver_id, p_category_id, p_subcategory_id, 'WAITING', p_description,
    v_assigned_agent
  );

  return query select v_visit_code, v_ticket_code, v_queue_number;
end;
$$;

revoke all on function create_checkin(uuid, uuid, uuid, uuid, text) from public;
grant execute on function create_checkin(uuid, uuid, uuid, uuid, text) to anon, authenticated;

-- 2) start_processing(): set sla_due_at = now() + sla_minutes NGAY LÚC
--    NÀY, chỉ khi chưa có (coalesce theo đúng pattern started_at đã dùng)
--    -> nếu ticket rời PROCESSING rồi quay lại (vd sau Transfer), không bị
--    tính lại đồng hồ SLA lần 2.
create or replace function start_processing(p_case_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid();
  v_ticket_id uuid;
  v_assigned uuid;
  v_role user_role;
  v_status ticket_status;
  v_branch_id uuid;
  v_category_id uuid;
  v_subcategory_id uuid;
  v_sla_due timestamptz;
  v_sla_minutes int;
begin
  select cs.assigned_agent_id, cs.ticket_id, cs.status, cs.category_id, cs.subcategory_id, cs.sla_due_at, qt.branch_id
  into v_assigned, v_ticket_id, v_status, v_category_id, v_subcategory_id, v_sla_due, v_branch_id
  from service_cases cs
  join queue_tickets qt on qt.id = cs.ticket_id
  where cs.id = p_case_id;

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

  if v_sla_due is null then
    v_sla_minutes := resolve_sla_minutes(v_branch_id, v_category_id, v_subcategory_id);
    v_sla_due := case when v_sla_minutes is not null
                       then now() + (v_sla_minutes || ' minutes')::interval
                       else null end;
  end if;

  update service_cases
  set status = 'PROCESSING',
      started_at = coalesce(started_at, now()),
      assigned_agent_id = coalesce(assigned_agent_id, v_agent_id),
      sla_due_at = v_sla_due
  where id = p_case_id;
  update queue_tickets set status = 'PROCESSING', serving_at = coalesce(serving_at, now()) where id = v_ticket_id;
end;
$$;
revoke all on function start_processing(uuid) from public;
revoke execute on function start_processing(uuid) from anon;
grant execute on function start_processing(uuid) to authenticated;

-- 3) v_report_case_log: ngưỡng WARNING trước đây tính theo
--    (sla_due_at - created_at) tức LẪN CẢ thời gian chờ trong hàng đợi
--    vào độ dài "cửa sổ SLA" — sai từ khi đổi mốc. Đổi sang
--    (sla_due_at - started_at), đúng bằng sla_minutes thật.
create or replace view v_report_case_log with (security_invoker = true) as
select
  cs.case_code as case_id, qt.ticket_code as ticket_id, d.sap_id, br.branch_name as branch,
  sc.name as category, ssc.name as subcategory, p.full_name as agent, dep.name as department,
  cs.status, vi.checkin_at as check_in, qt.called_at, cs.started_at, cs.resolved_at, cs.closed_at,
  round(extract(epoch from (coalesce(qt.called_at, now()) - vi.checkin_at)) / 60) as waiting_time_min,
  case when cs.started_at is not null
    then round(extract(epoch from (coalesce(cs.resolved_at, now()) - cs.started_at)) / 60)
    else null end as handling_time_min,
  case
    when cs.status in ('RESOLVED','CLOSED') then 'COMPLETED'
    when cs.status = 'PENDING' then 'PAUSED'
    when cs.sla_due_at is null then 'N/A'
    when cs.sla_due_at < now() then 'BREACHED'
    when cs.sla_due_at < now() + (0.2 * extract(epoch from (cs.sla_due_at - cs.started_at)) * interval '1 second') then 'WARNING'
    else 'ON_TRACK'
  end as sla_status,
  cs.resolution
from service_cases cs
join queue_tickets qt on qt.id = cs.ticket_id
join visits vi on vi.id = cs.visit_id
join branches br on br.id = vi.branch_id
join drivers d on d.id = cs.driver_id
join service_categories sc on sc.id = cs.category_id
left join service_subcategories ssc on ssc.id = cs.subcategory_id
left join profiles p on p.id = cs.assigned_agent_id
left join departments dep on dep.id = cs.assigned_department_id;
