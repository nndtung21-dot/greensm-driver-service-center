-- 0029: TV hiển thị "Đang chờ" theo agent ĐANG TẠM CHIẾM quầy
-- (current_agent_id) thay vì agent CHÍNH CHỦ (default_agent_id).
--
-- Hậu quả trước khi sửa: khi supervisor/admin gọi tạm 1 ticket ở
-- quầy không phải của mình (được phép theo thiết kế phân quyền
-- trong call_next_ticket/call_specific_ticket — chỉ role 'agent'
-- mới bị chặn gọi ở quầy không phải của mình), backlog thật của
-- agent chính chủ quầy đó biến mất khỏi TV cho tới khi quầy được
-- giải phóng.
--
-- Ví dụ thực tế: Quầy 4 (Lê Quốc Tuấn) có 17 ticket đang chờ, nhưng
-- vì tài khoản supervisor demo gọi tạm 1 ticket ở quầy này, TV chỉ
-- hiện "Đang chờ (1)" — theo hàng chờ gần như rỗng của supervisor,
-- che mất backlog thật.
--
-- Fix: đảo ưu tiên coalesce — luôn ưu tiên default_agent_id, chỉ
-- fallback về current_agent_id nếu quầy chưa có agent mặc định.
-- "Số đang gọi" (queue_number/called_at) không bị ảnh hưởng — vẫn
-- lấy đúng ticket thật đang active tại quầy đó qua queue_tickets,
-- độc lập với agent.

create or replace function public.tv_counters_status(p_branch_code text)
returns table(counter_code text, counter_name text, counter_status text, agent_id uuid, agent_name text, queue_number text, called_at timestamp with time zone)
language sql
security definer
set search_path to 'public'
as $function$
  select
    c.counter_code,
    c.counter_name,
    c.status::text,
    coalesce(c.default_agent_id, c.current_agent_id) as agent_id,
    p.full_name,
    case when qt.status in ('CALLED','PROCESSING') then qt.queue_number end,
    case when qt.status in ('CALLED','PROCESSING') then qt.called_at end
  from counters c
  join branches b on b.id = c.branch_id
  left join profiles p
    on p.id = coalesce(c.default_agent_id, c.current_agent_id)
  left join lateral (
    select q.*
    from queue_tickets q
    where q.counter_id = c.id
      and q.status in ('CALLED','PROCESSING')
    order by q.called_at desc nulls last, q.created_at desc
    limit 1
  ) qt on true
  where b.branch_code = p_branch_code
  order by c.counter_code;
$function$;
