-- 0036: Supervisor/admin gọi vé của agent khác: vé và quầy vẫn thuộc về
-- agent phụ trách, không gán cho người bấm; và phải gọi tại quầy của chính
-- agent đó.
--
-- Trước đây call_specific_ticket cho supervisor/admin chọn quầy trống đầu
-- tiên theo mã quầy, đặt quầy BUSY với current_agent = người bấm và gán vé
-- cho người bấm. Hậu quả quan sát được: vé A103/A107/A118/A121 bị
-- supervisor1.demo giữ ở quầy của người khác, chủ quầy không có nút "Bắt đầu
-- xử lý", quầy bị chiếm, backlog chủ quầy bị che trên TV.
--
-- Thay đổi:
-- 1. Supervisor/admin gọi vé đang gán cho agent khác -> vé giữ nguyên người
--    phụ trách, gọi tại quầy của agent đó (default hoặc current), quầy
--    current_agent = agent đó. Quầy của agent đang bận/đóng -> báo lỗi rõ
--    ràng, không chiếm quầy khác.
-- 2. Không còn gọi vé mà không có quầy. Trước đây vé đã chuyển sang quầy Q
--    mà Q đang bận, supervisor vẫn gọi được và counter_id bị ghi NULL (kiểu
--    A197: CALLED 34 ngày không gắn quầy, tài xế bị chặn check-in lại).
--
-- Không đổi hành vi của role agent. call_next_ticket giữ nguyên (supervisor
-- không có phân công chủ đề nên không gọi được qua hàm đó).

create or replace function public.call_specific_ticket(p_ticket_id uuid)
returns table(ticket_id uuid, ticket_code text, queue_number text, case_id uuid, counter_code text, driver_name text, category_name text)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_agent_id uuid := auth.uid();
  v_role user_role;
  v_branch uuid;
  v_ticket_branch uuid;
  v_ticket_status ticket_status;
  v_counter_id uuid;
  v_counter_code text;
  v_case_id uuid;
  v_category_id uuid;
  v_assigned_agent_id uuid;
  v_ticket_counter_id uuid;
  v_calling_for_other boolean;
  v_holder uuid;
BEGIN
  SELECT p.role,p.branch_id INTO v_role,v_branch
  FROM public.profiles p
  WHERE p.id=v_agent_id AND p.status='ACTIVE';

  IF v_role IS NULL OR v_role NOT IN ('agent','supervisor','admin') THEN
    RAISE EXCEPTION 'Không có quyền gọi số.';
  END IF;

  SELECT qt.branch_id,qt.status,qt.service_category_id,sc.assigned_agent_id,qt.counter_id
  INTO v_ticket_branch,v_ticket_status,v_category_id,v_assigned_agent_id,v_ticket_counter_id
  FROM public.queue_tickets qt
  LEFT JOIN public.service_cases sc ON sc.ticket_id=qt.id
  WHERE qt.id=p_ticket_id
  FOR UPDATE OF qt;

  IF v_ticket_branch IS NULL THEN RAISE EXCEPTION 'Không tìm thấy ticket.'; END IF;
  IF v_ticket_branch IS DISTINCT FROM v_branch THEN RAISE EXCEPTION 'Ticket không thuộc văn phòng của bạn.'; END IF;
  IF v_ticket_status <> 'WAITING' THEN RAISE EXCEPTION 'Ticket này không còn ở trạng thái chờ.'; END IF;

  IF v_role='agent' AND v_assigned_agent_id IS DISTINCT FROM v_agent_id
     AND NOT EXISTS (
       SELECT 1 FROM public.agent_category_assignments aca
       WHERE aca.agent_id=v_agent_id AND aca.category_id=v_category_id
     ) THEN
    RAISE EXCEPTION 'Bạn chưa được phân công chủ đề này.';
  END IF;

  -- Không cho Agent gọi ticket đang nằm ở quầy khác.
  IF v_role='agent' AND v_ticket_counter_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.counters c
      WHERE c.id = v_ticket_counter_id
        AND c.branch_id = v_branch
        AND c.status = 'AVAILABLE'
        AND (c.current_agent_id = v_agent_id OR c.default_agent_id = v_agent_id)
    ) THEN
      RAISE EXCEPTION 'Ticket đang thuộc quầy khác. Không thể kéo ticket về quầy hiện tại.';
    END IF;
  END IF;

  -- Supervisor/admin gọi hộ vé của agent khác: giữ vé và quầy cho agent đó.
  v_calling_for_other := v_role IN ('supervisor','admin')
                         AND v_assigned_agent_id IS NOT NULL
                         AND v_assigned_agent_id <> v_agent_id;
  v_holder := CASE WHEN v_calling_for_other THEN v_assigned_agent_id ELSE v_agent_id END;

  SELECT c.id,c.counter_code
  INTO v_counter_id,v_counter_code
  FROM public.counters c
  WHERE c.branch_id=v_branch
    AND c.status='AVAILABLE'
    AND (v_role IN ('supervisor','admin') OR c.default_agent_id=v_agent_id OR c.current_agent_id=v_agent_id)
    AND (NOT v_calling_for_other OR c.default_agent_id=v_assigned_agent_id OR c.current_agent_id=v_assigned_agent_id)
    AND (v_ticket_counter_id IS NULL OR c.id=v_ticket_counter_id)
  ORDER BY (c.default_agent_id=v_holder) DESC,c.counter_code
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_counter_id IS NULL THEN
    IF v_calling_for_other THEN
      RAISE EXCEPTION 'Quầy của agent phụ trách vé này đang bận hoặc đã đóng, chưa thể gọi thay.';
    ELSIF v_role='agent' THEN
      RAISE EXCEPTION 'Bạn chưa được gán quầy, hoặc ticket đang thuộc quầy khác / quầy của bạn đang bận.';
    ELSE
      RAISE EXCEPTION 'Không có quầy trống để gọi vé này.';
    END IF;
  END IF;

  UPDATE public.queue_tickets qt
  SET status='CALLED',called_at=now(),counter_id=v_counter_id,transferred_at=NULL
  WHERE qt.id=p_ticket_id
    AND qt.status='WAITING'
    AND (v_ticket_counter_id IS NULL OR qt.counter_id=v_ticket_counter_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket vừa được thay đổi hoặc chuyển sang quầy khác. Vui lòng tải lại queue.';
  END IF;

  UPDATE public.counters c
  SET status='BUSY',current_agent_id=v_holder
  WHERE c.id=v_counter_id;

  UPDATE public.service_cases sc
  SET status='CALLED',assigned_agent_id=v_holder
  WHERE sc.ticket_id=p_ticket_id
  RETURNING sc.id INTO v_case_id;

  RETURN QUERY
  SELECT qt.id,qt.ticket_code,qt.queue_number,v_case_id,v_counter_code,d.name,cat.name
  FROM public.queue_tickets qt
  JOIN public.visits vi ON vi.id=qt.visit_id
  JOIN public.drivers d ON d.id=vi.driver_id
  JOIN public.service_categories cat ON cat.id=qt.service_category_id
  WHERE qt.id=p_ticket_id;
END;
$function$;
