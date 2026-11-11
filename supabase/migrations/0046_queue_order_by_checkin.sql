-- 0046: Thứ tự hàng chờ = giờ check-in (ai đến trước gọi trước), ở mọi nơi.
--
-- Trước đây vé chuyển quầy về được xếp lên đầu, và vé CHUYỂN SAU đứng TRƯỚC
-- (transferred_at DESC). Quầy nhận nhiều vé chuyển (vd Quầy 06 HCM) thì danh sách
-- liên tục đảo: A078/A095 (check-in 09:49/10:06, chuyển 10:21) bị xếp trên A057
-- (check-in 09:21, chuyển 09:28). Từ 0043 danh sách agent và TV dùng cùng quy tắc
-- nên lỗi lộ ra trên màn hình.
--
-- Giờ: call_next_ticket và tv_agent_queue_list chỉ xếp theo giờ check-in. Vé chuyển
-- quầy giữ giờ check-in gốc nên vẫn tự đứng trước các vé đến sau.

set local lock_timeout = '5s';

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
    v.checkin_at asc nulls last,
    qt.created_at asc;
$function$;
