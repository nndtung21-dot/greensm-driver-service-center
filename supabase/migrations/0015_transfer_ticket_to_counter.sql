-- ============================================================
-- 1. TRANSFER TICKET TO SELECTED COUNTER
-- ============================================================

create or replace function transfer_ticket_to_counter(
  p_ticket_id uuid,
  p_target_counter_id uuid
)
returns table (
  ticket_id uuid,
  ticket_code text,
  queue_number text,
  target_counter_code text,
  target_agent_id uuid
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

  v_target_branch uuid;
  v_target_agent uuid;
  v_target_code text;
begin

  -- ==========================================================
  -- LẤY PROFILE NGƯỜI THỰC HIỆN
  -- ==========================================================

  select
    role,
    branch_id
  into
    v_role,
    v_branch
  from profiles
  where id = v_agent_id;

  if v_role is null then
    raise exception 'Không tìm thấy thông tin tài khoản.';
  end if;

  if v_role not in ('agent', 'supervisor', 'admin') then
    raise exception 'Không có quyền chuyển ticket.';
  end if;

  if v_branch is null then
    raise exception 'Tài khoản chưa được gán văn phòng.';
  end if;


  -- ==========================================================
  -- LOCK TICKET
  -- ==========================================================

  select
    branch_id,
    status
  into
    v_ticket_branch,
    v_ticket_status
  from queue_tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Không tìm thấy ticket.';
  end if;


  -- ==========================================================
  -- KIỂM TRA CÙNG VĂN PHÒNG
  -- ==========================================================

  if v_ticket_branch is distinct from v_branch then
    raise exception 'Ticket không thuộc văn phòng của bạn.';
  end if;


  -- ==========================================================
  -- CHỈ CHO PHÉP CHUYỂN KHI CALLED / PROCESSING
  -- ==========================================================

  if v_ticket_status not in ('CALLED', 'PROCESSING') then
    raise exception
      'Chỉ có thể chuyển ticket đang được gọi hoặc đang xử lý.';
  end if;


  -- ==========================================================
  -- LẤY QUẦY ĐÍCH
  -- ==========================================================

  select
    c.branch_id,
    c.default_agent_id,
    c.counter_code
  into
    v_target_branch,
    v_target_agent,
    v_target_code
  from counters c
  where c.id = p_target_counter_id
  for update;

  if not found then
    raise exception 'Không tìm thấy quầy đích.';
  end if;


  -- ==========================================================
  -- QUẦY ĐÍCH PHẢI CÙNG VĂN PHÒNG
  -- ==========================================================

  if v_target_branch is distinct from v_branch then
    raise exception 'Quầy đích không thuộc văn phòng này.';
  end if;


  -- ==========================================================
  -- QUẦY ĐÍCH PHẢI CÓ AGENT MẶC ĐỊNH
  -- ==========================================================

  if v_target_agent is null then
    raise exception 'Quầy đích chưa được gán Agent.';
  end if;


  -- ==========================================================
  -- QUAN TRỌNG:
  --
  -- Chuyển ticket về WAITING
  -- NHƯNG GIỮ counter_id = QUẦY ĐÍCH
  --
  -- KHÔNG gọi số.
  -- KHÔNG set CALLED.
  -- ==========================================================

  update queue_tickets
  set
    status = 'WAITING',
    counter_id = p_target_counter_id,
    called_at = null
  where id = p_ticket_id;


  -- ==========================================================
  -- SERVICE CASE:
  --
  -- WAITING
  -- assign cho Agent mặc định của quầy đích
  -- ==========================================================

  update service_cases
  set
    status = 'WAITING',
    assigned_agent_id = v_target_agent
  where ticket_id = p_ticket_id;


  -- ==========================================================
  -- TRẢ KẾT QUẢ
  -- ==========================================================

  return query
  select
    qt.id,
    qt.ticket_code,
    qt.queue_number,
    v_target_code,
    v_target_agent
  from queue_tickets qt
  where qt.id = p_ticket_id;

end;
$$;


revoke all
on function transfer_ticket_to_counter(uuid, uuid)
from public;

grant execute
on function transfer_ticket_to_counter(uuid, uuid)
to authenticated;



-- ============================================================
-- 2. CALL NEXT TICKET
--
-- Agent bấm "GỌI SỐ"
-- => tìm ticket WAITING thuộc QUẦY CỦA AGENT
-- => chuyển ticket thành CALLED
--
-- Không tự chọn quầy khác.
-- ============================================================

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

  -- ==========================================================
  -- LẤY PROFILE AGENT
  -- ==========================================================

  select
    role,
    branch_id
  into
    v_role,
    v_branch
  from profiles
  where id = v_agent_id;

  if v_role is null then
    raise exception 'Không tìm thấy thông tin tài khoản.';
  end if;

  if v_role not in ('agent', 'supervisor', 'admin') then
    raise exception
      'Không có quyền gọi số.';
  end if;

  if v_branch is null then
    raise exception
      'Tài khoản chưa được gán văn phòng.';
  end if;


  -- ==========================================================
  -- TÌM TICKET WAITING
  --
  -- Ticket phải:
  -- 1. Cùng branch
  -- 2. WAITING
  -- 3. Có counter_id
  -- 4. Counter thuộc Agent hiện tại
  --
  -- Ưu tiên ticket được assign trực tiếp cho Agent.
  -- ==========================================================

  select
    qt.id
  into
    v_ticket_id
  from queue_tickets qt

  join service_cases cs
    on cs.ticket_id = qt.id

  join counters c
    on c.id = qt.counter_id

  where
    qt.branch_id = v_branch
    and qt.status = 'WAITING'

    and c.default_agent_id = v_agent_id

    and (
      cs.assigned_agent_id = v_agent_id
      or cs.assigned_agent_id is null
    )

  order by
    (
      cs.assigned_agent_id = v_agent_id
    ) desc,

    qt.created_at

  for update of qt skip locked

  limit 1;


  -- ==========================================================
  -- KHÔNG CÓ TICKET
  -- ==========================================================

  if v_ticket_id is null then
    raise exception
      'Không còn tài xế nào đang chờ tại quầy của bạn.';
  end if;


  -- ==========================================================
  -- LẤY ĐÚNG QUẦY CỦA TICKET
  --
  -- KHÔNG tự tìm AVAILABLE counter.
  -- ==========================================================

  select
    c.id,
    c.counter_code

  into
    v_counter_id,
    v_counter_code

  from queue_tickets qt

  join counters c
    on c.id = qt.counter_id

  where qt.id = v_ticket_id

  for update of c;


  if v_counter_id is null then
    raise exception
      'Ticket chưa được gán quầy.';
  end if;


  -- ==========================================================
  -- KIỂM TRA QUẦY THUỘC AGENT
  -- ==========================================================

  if not exists (
    select 1
    from counters c
    where
      c.id = v_counter_id
      and c.branch_id = v_branch
      and c.default_agent_id = v_agent_id
  ) then

    raise exception
      'Ticket không thuộc quầy của Agent hiện tại.';

  end if;


  -- ==========================================================
  -- CHỈ TẠI ĐÂY MỚI CALLED
  -- ==========================================================

  update queue_tickets
  set
    status = 'CALLED',
    called_at = now()
  where id = v_ticket_id;


  -- ==========================================================
  -- QUẦY -> BUSY
  -- ==========================================================

  update counters
  set
    status = 'BUSY',
    current_agent_id = v_agent_id
  where id = v_counter_id;


  -- ==========================================================
  -- CASE -> CALLED
  -- ==========================================================

  update service_cases
  set
    status = 'CALLED',
    assigned_agent_id = v_agent_id

  where ticket_id = v_ticket_id

  returning id
  into v_case_id;


  -- ==========================================================
  -- TRẢ KẾT QUẢ
  -- ==========================================================

  return query

  select
    qt.id,
    qt.ticket_code,
    qt.queue_number,
    v_case_id,
    v_counter_code,
    d.name,
    sc.name

  from queue_tickets qt

  join visits vi
    on vi.id = qt.visit_id

  join drivers d
    on d.id = vi.driver_id

  join service_categories sc
    on sc.id = qt.service_category_id

  where qt.id = v_ticket_id;

end;
$$;


revoke all
on function call_next_ticket()
from public;

grant execute
on function call_next_ticket()
to authenticated;
