-- 0044: Bỏ ưu tiên theo mã Help Center (đã chạy lên production ngày 09/11/2026).
--
-- Mã Help Center tài xế tự nhập chưa được xác minh (có tài xế nhập cả Mã SAP vào ô mã),
-- nên không được cho vé nhảy lên trước. Vẫn lưu mã để agent thấy và xác minh.
-- - create_checkin: không đặt priority = 1 nữa
-- - call_next_ticket, tv_agent_queue_list: bỏ priority khỏi ORDER BY
--   (tv_agent_queue_list vẫn trả cột priority để TV cũ không lỗi)
-- - đưa priority của các vé đã tạo về 0
-- File này được ghi lại từ định nghĩa đang chạy trên production (chưa kịp commit lúc chạy).

set local lock_timeout = '5s';

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
  -- mã Help Center (chỉ lưu để agent xác minh, KHÔNG cho ưu tiên): bỏ mọi khoảng trắng, rỗng coi như không có, tối đa 64 ký tự
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
    queue_number, service_category_id, status
  ) values (
    v_ticket_code, v_visit_id, p_branch_id, v_business_date,
    v_queue_number, p_category_id, 'WAITING'
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

create or replace function public.tv_agent_queue_list(p_branch_code text)
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
    v.checkin_at asc nulls last,
    qt.created_at asc;
$function$;

update public.queue_tickets set priority = 0 where priority <> 0;
