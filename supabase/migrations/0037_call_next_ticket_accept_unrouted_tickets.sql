-- 0037: "Gọi tiếp theo" không tìm thấy vé (phát hiện khi mở văn phòng HN).
--
-- call_next_ticket(p_counter_id) chỉ chọn vé có counter_id = quầy đang gọi.
-- Nhưng vé mới check-in luôn có counter_id NULL (counter_id chỉ được gán khi
-- vé được gọi hoặc chuyển quầy). Kết quả: agent bấm "Gọi tiếp theo" luôn gặp
-- "Không còn ticket WAITING thuộc các chủ đề bạn được phân công tại quầy này"
-- dù hàng chờ có vé của mình. Đây là lỗi đã từng được sửa ở 0016; bản hàm
-- đang chạy trên DB (có tham số p_counter_id) đã quay lại ràng buộc cũ.
--
-- Sửa: chấp nhận vé chưa gắn quầy (counter_id NULL) hoặc đã được chuyển về
-- đúng quầy này; vé đang gắn quầy khác vẫn bị loại. Các điều kiện còn lại
-- (đúng chủ đề được phân công, vé của mình hoặc chưa gán, thứ tự ưu tiên vé
-- chuyển quầy rồi theo giờ check-in) giữ nguyên.
--
-- Đã kiểm tra trên DB thật trong giao dịch tự hoàn tác: Nguyễn Đức Minh gọi
-- được A006 ở HN01, Kiều Thành Luân gọi được A004 ở HN02.

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
