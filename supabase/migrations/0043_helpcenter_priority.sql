-- 0043: Ưu tiên tài xế đã gửi yêu cầu trên Trung tâm hỗ trợ (Help Center).
--
-- Luồng: sau khi xác nhận thông tin, tài xế chọn "Đã có mã yêu cầu" và dán mã
-- (dạng mã hồ sơ Salesforce, vd 500Pn000020tCVrIAM). Không đối chiếu với Help
-- Center (không có API): chỉ lưu mã, agent xác minh khi tài xế đến quầy.
--
-- Thứ tự gọi trong hàng chờ của MỖI agent (không đổi cách chia vé cho agent):
--   1. vé chuyển quầy về (mới chuyển gần nhất trước)
--   2. vé có mã Help Center (queue_tickets.priority = 1), check-in sớm trước
--   3. vé thường, check-in sớm trước
-- Áp dụng giống nhau cho: call_next_ticket, danh sách vé của agent, TV.
-- Agent vẫn bấm "Gọi" từng dòng tự do (thứ tự chỉ là gợi ý).
--
-- Thứ tự triển khai: chạy migration này TRƯỚC khi deploy frontend (frontend mới
-- gọi create_checkin với tham số p_helpcenter_code).

-- 1) Dữ liệu
alter table public.service_cases
  add column if not exists helpcenter_code text,
  add column if not exists helpcenter_verified boolean,
  add column if not exists helpcenter_verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists helpcenter_verified_at timestamptz;
-- queue_tickets.priority (int, mặc định 0) đã có sẵn, chưa dùng: 1 = có mã Help Center.

-- 2) create_checkin nhận thêm mã Help Center (tham số có mặc định: frontend cũ vẫn gọi được)
drop function if exists public.create_checkin(uuid, uuid, uuid, uuid, text);

create or replace function public.create_checkin(
  p_driver_id uuid,
  p_branch_id uuid,
  p_category_id uuid,
  p_subcategory_id uuid,
  p_description text,
  p_helpcenter_code text default null
)
returns table(visit_code text, ticket_code text, queue_number text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_visit_id uuid;
  v_ticket_id uuid;
  v_business_date date := current_date;
  v_branch_code text;
  v_visit_code text;
  v_ticket_code text;
  v_queue_number text;
  v_assigned_agent uuid;
  -- mã Help Center: bỏ mọi khoảng trắng, rỗng coi như không có, tối đa 64 ký tự
  v_hc_code text := left(nullif(regexp_replace(coalesce(p_helpcenter_code, ''), '\s', '', 'g'), ''), 64);
  -- khung giờ nhận check-in (giờ VN)
  c_open  constant text := '08:25';
  c_close constant text := '17:45';
  v_hm    text := to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'HH24:MI');
begin
  -- CHỐT KHUNG GIỜ: chỉ nhận check-in trong khoảng [08:25, 17:45] giờ VN.
  if v_hm < c_open or v_hm > c_close then
    raise exception
      'CHECKIN_CLOSED: Ngoài giờ nhận check-in. Hệ thống chỉ nhận từ % đến % (giờ Việt Nam).',
      c_open, c_close;
  end if;

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
    queue_number, service_category_id, status, priority
  ) values (
    v_ticket_code, v_visit_id, p_branch_id, v_business_date,
    v_queue_number, p_category_id, 'WAITING',
    case when v_hc_code is not null then 1 else 0 end
  ) returning id into v_ticket_id;

  select aca.agent_id into v_assigned_agent
  from agent_category_assignments aca
  join profiles p on p.id = aca.agent_id
  where aca.category_id = p_category_id and p.branch_id = p_branch_id
    and p.status = 'ACTIVE'
    and not exists (
      select 1 from counters c
      where c.default_agent_id = aca.agent_id and c.status = 'CLOSED'
    )
  order by (
    select count(*) from service_cases cs
    where cs.assigned_agent_id = aca.agent_id and cs.status in ('WAITING', 'CALLED', 'PROCESSING')
  ) asc, random()
  limit 1;

  insert into service_cases (
    case_code, ticket_id, visit_id, driver_id, category_id, subcategory_id,
    status, description, assigned_agent_id, helpcenter_code
  ) values (
    v_ticket_code, v_ticket_id, v_visit_id, p_driver_id, p_category_id, p_subcategory_id, 'WAITING', p_description,
    v_assigned_agent, v_hc_code
  );

  return query select v_visit_code, v_ticket_code, v_queue_number;
end;
$function$;

revoke all on function public.create_checkin(uuid, uuid, uuid, uuid, text, text) from public;
grant execute on function public.create_checkin(uuid, uuid, uuid, uuid, text, text) to anon, authenticated;

-- 3) "Gọi tiếp theo": thêm ưu tiên Help Center sau nhóm vé chuyển quầy về
create or replace function public.call_next_ticket(p_counter_id uuid)
returns table(ticket_id uuid, ticket_code text, queue_number text, case_id uuid, counter_code text, driver_name text, category_name text)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_agent_id uuid := auth.uid();
  v_role user_role;
  v_branch uuid;
  v_counter_branch uuid;
  v_current_agent uuid;
  v_default_agent uuid;
  v_counter_code text;
  v_counter_status counter_status;
  v_selected_ticket_id uuid;
  v_case_id uuid;
BEGIN
  SELECT p.role, p.branch_id INTO v_role, v_branch
  FROM public.profiles AS p
  WHERE p.id = v_agent_id AND p.status = 'ACTIVE';

  IF v_role IS NULL THEN RAISE EXCEPTION 'Không tìm thấy thông tin tài khoản.'; END IF;
  IF v_role NOT IN ('agent', 'supervisor', 'admin') THEN RAISE EXCEPTION 'Không có quyền gọi số.'; END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Tài khoản chưa được gán văn phòng.'; END IF;

  SELECT c.branch_id, c.current_agent_id, c.default_agent_id, c.counter_code, c.status
  INTO v_counter_branch, v_current_agent, v_default_agent, v_counter_code, v_counter_status
  FROM public.counters AS c
  WHERE c.id = p_counter_id
  FOR UPDATE;

  IF v_counter_branch IS NULL THEN RAISE EXCEPTION 'Không tìm thấy quầy.'; END IF;
  IF v_counter_branch IS DISTINCT FROM v_branch THEN RAISE EXCEPTION 'Quầy không thuộc văn phòng của bạn.'; END IF;
  IF v_role = 'agent' AND v_current_agent IS DISTINCT FROM v_agent_id AND v_default_agent IS DISTINCT FROM v_agent_id THEN RAISE EXCEPTION 'Quầy này không phải quầy bạn đang phụ trách.'; END IF;
  IF v_counter_status <> 'AVAILABLE' THEN RAISE EXCEPTION 'Quầy đang bận hoặc không khả dụng.'; END IF;

  SELECT qt.id INTO v_selected_ticket_id
  FROM public.queue_tickets AS qt
  JOIN public.visits AS vi ON vi.id = qt.visit_id
  JOIN public.service_cases AS sc ON sc.ticket_id = qt.id
  WHERE qt.branch_id = v_branch
    AND qt.status = 'WAITING'
    AND sc.status = 'WAITING'
    AND (qt.counter_id IS NULL OR qt.counter_id = p_counter_id)
    AND (sc.assigned_agent_id IS NULL OR sc.assigned_agent_id = v_agent_id)
    AND EXISTS (
      SELECT 1
      FROM public.agent_category_assignments AS aca
      WHERE aca.agent_id = v_agent_id
        AND aca.category_id = qt.service_category_id
    )
  ORDER BY
    CASE WHEN qt.transferred_at IS NOT NULL THEN 0 ELSE 1 END ASC,
    qt.transferred_at DESC NULLS LAST,
    qt.priority DESC,
    vi.checkin_at ASC NULLS LAST,
    qt.created_at ASC,
    qt.id ASC
  FOR UPDATE OF qt SKIP LOCKED
  LIMIT 1;

  IF v_selected_ticket_id IS NULL THEN
    RAISE EXCEPTION 'Không còn ticket WAITING thuộc các chủ đề bạn được phân công tại quầy này.';
  END IF;

  UPDATE public.queue_tickets AS qt
  SET status = 'CALLED', called_at = now(), counter_id = p_counter_id, transferred_at = NULL
  WHERE qt.id = v_selected_ticket_id
    AND (qt.counter_id IS NULL OR qt.counter_id = p_counter_id)
    AND qt.status = 'WAITING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket vừa được thay đổi hoặc chuyển sang quầy khác. Vui lòng gọi lại.';
  END IF;

  UPDATE public.counters AS c
  SET status = 'BUSY', current_agent_id = v_agent_id
  WHERE c.id = p_counter_id;

  UPDATE public.service_cases AS sc
  SET status = 'CALLED', assigned_agent_id = v_agent_id
  WHERE sc.ticket_id = v_selected_ticket_id
  RETURNING sc.id INTO v_case_id;

  RETURN QUERY
  SELECT qt.id AS ticket_id,
         qt.ticket_code AS ticket_code,
         qt.queue_number AS queue_number,
         v_case_id AS case_id,
         v_counter_code AS counter_code,
         d.name AS driver_name,
         cat.name AS category_name
  FROM public.queue_tickets AS qt
  JOIN public.visits AS vi ON vi.id = qt.visit_id
  JOIN public.drivers AS d ON d.id = vi.driver_id
  JOIN public.service_categories AS cat ON cat.id = qt.service_category_id
  WHERE qt.id = v_selected_ticket_id;
END;
$function$;

-- 4) Danh sách TV: trả thêm thông tin để xếp đúng thứ tự (TV không hiện nhãn ưu tiên)
--    Đổi kiểu trả về nên phải drop rồi tạo lại.
drop function if exists public.tv_agent_queue_list(text);

create function public.tv_agent_queue_list(p_branch_code text)
returns table(agent_id uuid, ticket_code text, queue_number text, driver_name text, created_at timestamptz,
              priority integer, transferred_at timestamptz, checkin_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    cs.assigned_agent_id,
    qt.ticket_code,
    qt.queue_number,
    d.name,
    qt.created_at,
    qt.priority,
    qt.transferred_at,
    v.checkin_at
  from public.queue_tickets qt
  join public.service_cases cs on cs.ticket_id = qt.id
  join public.visits v on v.id = qt.visit_id
  join public.drivers d on d.id = v.driver_id
  join public.branches b on b.id = qt.branch_id
  where b.branch_code = p_branch_code
    and qt.status in ('WAITING', 'CALLED', 'PROCESSING')
    and cs.status in ('WAITING', 'CALLED', 'PROCESSING')
  order by
    (qt.transferred_at is not null) desc,
    qt.transferred_at desc nulls last,
    qt.priority desc,
    v.checkin_at asc nulls last,
    qt.created_at asc;
$function$;

revoke all on function public.tv_agent_queue_list(text) from public;
grant execute on function public.tv_agent_queue_list(text) to anon, authenticated;

-- 5) View cho agent: thêm cột ở CUỐI (create or replace chỉ cho thêm cột ở cuối)
create or replace view public.v_agent_queue with (security_invoker = true) as
 SELECT qt.id AS ticket_id,
    qt.ticket_code,
    qt.queue_number,
    qt.status,
    qt.priority,
    qt.branch_id,
    b.branch_code,
    b.branch_name,
    qt.service_category_id AS category_id,
    sc.code AS category_code,
    sc.name AS category_name,
    qt.counter_id,
    c.counter_code,
    c.counter_name,
    c.status AS counter_status,
    cs.id AS case_id,
    cs.status AS case_status,
    cs.assigned_agent_id,
    ap.full_name AS assigned_agent_name,
    vi.driver_id,
    d.name AS driver_name,
    d.sap_id,
    d.driver_code,
    d.app_code,
    d.license_plate,
    d.contract_type,
    d.vehicle_type,
    d.province,
    cs.description,
    cs.resolution,
    cs.internal_note,
    qt.created_at,
    qt.called_at,
    qt.serving_at,
    qt.completed_at,
    cs.started_at,
    cs.resolved_at,
    cs.closed_at,
    cs.sla_due_at,
    cs.sla_status,
    cs.helpcenter_code,
    cs.helpcenter_verified,
    qt.transferred_at,
    vi.checkin_at
   FROM queue_tickets qt
     JOIN visits vi ON vi.id = qt.visit_id
     JOIN drivers d ON d.id = vi.driver_id
     JOIN service_cases cs ON cs.ticket_id = qt.id
     JOIN service_categories sc ON sc.id = qt.service_category_id
     JOIN branches b ON b.id = qt.branch_id
     LEFT JOIN counters c ON c.id = qt.counter_id
     LEFT JOIN profiles ap ON ap.id = cs.assigned_agent_id
  WHERE qt.branch_id = (( SELECT p.branch_id
           FROM profiles p
          WHERE p.id = auth.uid()));

create or replace view public.v_case_detail with (security_invoker = true) as
 SELECT cs.id AS case_id,
    cs.case_code,
    cs.ticket_id,
    qt.ticket_code,
    qt.queue_number,
    qt.status,
    qt.priority,
    qt.counter_id,
    qt.called_at,
    qt.serving_at,
    qt.completed_at,
    cs.visit_id,
    vi.visit_code,
    vi.checkin_at,
    vi.checkout_at,
    qt.branch_id,
    b.branch_code,
    b.branch_name,
    cs.driver_id,
    d.sap_id,
    d.driver_code,
    d.app_code,
    d.name AS driver_name,
    d.license_plate,
    d.contract_type,
    d.vehicle_type,
    d.province,
    d.driver_type,
    d.work_status,
    d.account_status,
    d.lock_reason,
    cs.category_id,
    sc.code AS category_code,
    sc.name AS category_name,
    cs.subcategory_id,
    ssc.code AS subcategory_code,
    ssc.name AS subcategory_name,
    cs.assigned_agent_id,
    ap.full_name AS assigned_agent_name,
    cs.assigned_department_id,
    cs.description,
    cs.resolution,
    cs.internal_note,
    cs.pending_reason,
    cs.pending_next_step,
    cs.pending_expected_at,
    cs.created_at,
    cs.started_at,
    cs.resolved_at,
    cs.closed_at,
    cs.sla_due_at,
    cs.sla_status,
    co.counter_code,
    co.counter_name,
    cs.helpcenter_code,
    cs.helpcenter_verified,
    cs.helpcenter_verified_at,
    vp.full_name AS helpcenter_verified_by_name
   FROM service_cases cs
     JOIN queue_tickets qt ON qt.id = cs.ticket_id
     JOIN visits vi ON vi.id = cs.visit_id
     JOIN drivers d ON d.id = cs.driver_id
     JOIN service_categories sc ON sc.id = cs.category_id
     LEFT JOIN service_subcategories ssc ON ssc.id = cs.subcategory_id
     JOIN branches b ON b.id = qt.branch_id
     LEFT JOIN profiles ap ON ap.id = cs.assigned_agent_id
     LEFT JOIN counters co ON co.id = qt.counter_id
     LEFT JOIN profiles vp ON vp.id = cs.helpcenter_verified_by;

-- 6) Agent xác minh mã khi tài xế đến quầy (chỉ ghi nhận, không đổi thứ tự).
--    p_valid: true = mã đúng, false = không hợp lệ, null = bỏ kết quả.
create or replace function public.verify_helpcenter_code(p_case_id uuid, p_valid boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch uuid;
  v_code text;
  v_status ticket_status;
begin
  if public.active_role() is null then
    raise exception 'Không có quyền.';
  end if;

  select cs.branch_id, cs.helpcenter_code, cs.status
  into v_branch, v_code, v_status
  from public.service_cases cs
  where cs.id = p_case_id
  for update;

  if v_branch is null then raise exception 'Không tìm thấy vé.'; end if;
  if not public.can_access_branch(v_branch) then raise exception 'Vé không thuộc văn phòng của bạn.'; end if;
  if v_code is null then raise exception 'Vé này không có mã Help Center.'; end if;

  update public.service_cases
  set helpcenter_verified = p_valid,
      helpcenter_verified_by = case when p_valid is null then null else auth.uid() end,
      helpcenter_verified_at = case when p_valid is null then null else now() end
  where id = p_case_id;

  insert into public.case_history(case_id, action, old_status, new_status, performed_by, note)
  values (p_case_id, 'Xác minh mã Help Center', v_status, v_status, auth.uid(),
          case when p_valid then 'Mã đúng' when not p_valid then 'Mã không hợp lệ' else 'Bỏ kết quả xác minh' end
          || ' (' || v_code || ')');
end;
$function$;

revoke all on function public.verify_helpcenter_code(uuid, boolean) from public, anon;
grant execute on function public.verify_helpcenter_code(uuid, boolean) to authenticated;

-- 7) Raw data: thêm "Mã Help Center", "Xác minh mã Help Center" (cột "Priority" có sẵn:
--    1 = có mã). Sửa luôn tên cột bị Postgres cắt (giới hạn 63 byte):
--    "Vấn đề Đối tác đã được ghi nhận hỗ trợ đầy đủ" (72 byte) -> "Vấn đề được ghi nhận hỗ trợ đầy đủ".
drop view if exists public.v_report_raw;

create view public.v_report_raw with (security_invoker = true) as
 SELECT cs.case_code AS "Case Code",
    qt.ticket_code AS "Ticket Code",
    qt.queue_number AS "Queue Number",
    b.branch_code AS "Branch Code",
    b.branch_name AS "Branch Name",
    d.sap_id AS "SAP ID",
    sc.name AS "Category",
    ssc.name AS "Subcategory",
    cs.description AS "Description",
    caller.full_name AS "Agent",
    qt.status AS "Ticket Status",
    cs.status AS "Case Status",
    qt.priority AS "Priority",
    cs.helpcenter_code AS "Mã Help Center",
    CASE
      WHEN cs.helpcenter_code IS NULL THEN NULL
      WHEN cs.helpcenter_verified IS TRUE THEN 'Đúng'
      WHEN cs.helpcenter_verified IS FALSE THEN 'Không hợp lệ'
      ELSE 'Chưa xác minh'
    END AS "Xác minh mã Help Center",
    c.counter_code AS "Counter",
    vi.checkin_at AS "Check-in",
    qt.called_at AS "Called At",
    qt.serving_at AS "Started At",
    cs.resolved_at AS "Resolved At",
    cs.closed_at AS "Closed At",
    cs.sla_due_at AS "SLA Due At",
    cs.sla_status AS "SLA Status",
    cs.resolution AS "Resolution",
    cs.internal_note AS "Agent Note",
    cs.has_incident_report AS "Viết bản tường trình",
    f.rating AS "CSAT Rating (tổng)",
    f.rating_time AS "Thời gian hỗ trợ",
    f.rating_attitude AS "Thái độ nhân viên hỗ trợ",
    f.rating_resolution AS "Vấn đề được ghi nhận hỗ trợ đầy đủ",
    f.comment AS "CSAT Comment",
    f.created_at AS "Feedback Created At",
    COALESCE(vi.checkin_at, cs.created_at) AS _filter_date
   FROM service_cases cs
     JOIN queue_tickets qt ON qt.id = cs.ticket_id
     JOIN visits vi ON vi.id = cs.visit_id
     JOIN drivers d ON d.id = cs.driver_id
     JOIN service_categories sc ON sc.id = cs.category_id
     LEFT JOIN service_subcategories ssc ON ssc.id = cs.subcategory_id
     JOIN branches b ON b.id = qt.branch_id
     LEFT JOIN LATERAL ( SELECT p.full_name
           FROM case_history h
             JOIN profiles p ON p.id = h.performed_by
          WHERE h.case_id = cs.id AND h.action = 'STATUS_CHANGED'::text AND h.old_status = 'WAITING'::ticket_status AND h.new_status = 'CALLED'::ticket_status
          ORDER BY h.created_at DESC
         LIMIT 1) caller ON true
     LEFT JOIN LATERAL ( SELECT feedback.rating,
            feedback.rating_time,
            feedback.rating_attitude,
            feedback.rating_resolution,
            feedback.comment,
            feedback.created_at
           FROM feedback
          WHERE feedback.case_id = cs.id
          ORDER BY feedback.created_at DESC
         LIMIT 1) f ON true
     LEFT JOIN counters c ON c.id = qt.counter_id;

revoke all on public.v_report_raw from anon;
grant select on public.v_report_raw to authenticated;
