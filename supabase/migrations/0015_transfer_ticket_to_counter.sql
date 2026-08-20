-- ============================================================
-- CALL NEXT TICKET
--
-- Agent bấm "GỌI SỐ"
-- => tìm ticket WAITING thuộc QUẦY CỦA AGENT
-- => chuyển ticket thành CALLED
--
-- Agent:
--   Chỉ lấy ticket thuộc quầy mình.
--
-- Supervisor / Admin:
--   Có thể lấy ticket WAITING trong cùng branch.
--
-- counter_id là nguồn xác định ticket thuộc queue nào.
-- assigned_agent_id chỉ dùng để ưu tiên, không dùng để
-- loại ticket khỏi queue.
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
  -- 1. LẤY PROFILE NGƯỜI THỰC HIỆN
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
  -- 2. TÌM TICKET WAITING
  --
  -- AGENT:
  --   Chỉ lấy ticket thuộc quầy của Agent.
  --
  -- SUPERVISOR / ADMIN:
  --   Có thể lấy ticket WAITING trong cùng branch.
  --
  -- QUAN TRỌNG:
  --   counter_id + default_agent_id xác định queue.
  --
  --   assigned_agent_id KHÔNG được dùng để loại ticket.
  --   Chỉ dùng để ưu tiên ticket đã assign cho Agent.
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

    and (
      -- Agent:
      -- chỉ lấy ticket thuộc quầy của Agent hiện tại
      (
        v_role = 'agent'
        and c.default_agent_id = v_agent_id
      )

      -- Supervisor / Admin:
      -- lấy ticket WAITING trong cùng branch
      or v_role in ('supervisor', 'admin')
    )

  order by
    -- Ưu tiên ticket đã được assign cho Agent hiện tại
    (
      cs.assigned_agent_id = v_agent_id
    ) desc,

    -- Sau đó ưu tiên người chờ lâu nhất
    qt.created_at

  for update of qt skip locked

  limit 1;


  -- ==========================================================
  -- 3. KHÔNG CÓ TICKET
  -- ==========================================================

  if v_ticket_id is null then
    raise exception
      'Không còn tài xế nào đang chờ tại quầy của bạn.';
  end if;


  -- ==========================================================
  -- 4. LẤY QUẦY CỦA TICKET
  --
  -- Không tự tìm quầy khác.
  -- Lấy đúng counter_id đang gắn với ticket.
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


  -- ==========================================================
  -- 5. KIỂM TRA TICKET ĐÃ CÓ QUẦY
  -- ==========================================================

  if v_counter_id is null then
    raise exception
      'Ticket chưa được gán quầy.';
  end if;


  -- ==========================================================
  -- 6. KIỂM TRA QUẦY
  --
  -- Agent:
  --   Quầy phải là quầy của Agent.
  --
  -- Supervisor / Admin:
  --   Chỉ cần quầy thuộc cùng branch.
  -- ==========================================================

  if v_role = 'agent' then

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

  else

    if not exists (
      select 1
      from counters c
      where
        c.id = v_counter_id
        and c.branch_id = v_branch
    ) then

      raise exception
        'Ticket không thuộc văn phòng của bạn.';

    end if;

  end if;


  -- ==========================================================
  -- 7. CHUYỂN TICKET -> CALLED
  -- ==========================================================

  update queue_tickets
  set
    status = 'CALLED',
    called_at = now()
  where id = v_ticket_id;


  -- ==========================================================
  -- 8. QUẦY -> BUSY
  -- ==========================================================

  update counters
  set
    status = 'BUSY',
    current_agent_id = v_agent_id
  where id = v_counter_id;


  -- ==========================================================
  -- 9. SERVICE CASE -> CALLED
  --
  -- Agent hiện tại trở thành người xử lý ticket.
  -- ==========================================================

  update service_cases
  set
    status = 'CALLED',
    assigned_agent_id = v_agent_id

  where ticket_id = v_ticket_id

  returning id
  into v_case_id;


  -- ==========================================================
  -- 10. TRẢ KẾT QUẢ
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


-- ============================================================
-- PERMISSION
-- ============================================================

revoke all
on function call_next_ticket()
from public;

grant execute
on function call_next_ticket()
to authenticated;
