-- 0034: Đóng quầy nghỉ trưa — hoàn thiện tính năng đã có sẵn giao
-- diện (Supervisor Dashboard gọi set_counter_status từ trước) nhưng
-- hàm này CHƯA TỪNG TỒN TẠI trên DB thật (giống v_report_agent_performance
-- ở 0030) — supervisor bấm "Đóng/Mở" trước đây không có tác dụng gì.
--
-- 2 thay đổi đi cùng nhau:
-- 1. set_counter_status(p_counter_id, p_status): đóng quầy → tự động
--    phân lại toàn bộ vé WAITING của agent chính chủ quầy đó sang
--    agent khác đang có mặt (không bị đóng quầy), cùng chủ đề, rảnh
--    nhất. Vé không tìm được ai thay → giữ nguyên, trả về danh sách
--    để supervisor xử lý tay. Chặn đóng quầy đang BUSY.
-- 2. create_checkin: loại trừ agent đang có quầy CLOSED khỏi việc
--    phân vé MỚI — nếu không, vé mới sẽ tiếp tục dồn vào agent đang
--    nghỉ ngay sau khi vừa phân lại xong vé cũ.

create or replace function public.set_counter_status(p_counter_id uuid, p_status text)
returns table(reassigned_count int, unresolved_ticket_codes text[])
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_role user_role;
  v_branch uuid;
  v_counter_branch uuid;
  v_counter_status text;
  v_break_agent uuid;
  v_break_agent_name text;
  r record;
  v_new_agent uuid;
  v_reassigned int := 0;
  v_unresolved text[] := array[]::text[];
begin
  if p_status not in ('AVAILABLE','CLOSED') then
    raise exception 'Trạng thái không hợp lệ.';
  end if;

  select p.role, p.branch_id into v_role, v_branch
  from public.profiles p where p.id = v_actor and p.status = 'ACTIVE';

  if v_role is null or v_role not in ('supervisor','admin') then
    raise exception 'Chỉ supervisor/admin được đóng/mở quầy.';
  end if;

  select c.branch_id, c.status::text, c.default_agent_id
  into v_counter_branch, v_counter_status, v_break_agent
  from public.counters c
  where c.id = p_counter_id
  for update;

  if v_counter_branch is null then raise exception 'Không tìm thấy quầy.'; end if;
  if v_counter_branch is distinct from v_branch then raise exception 'Quầy không thuộc văn phòng của bạn.'; end if;

  if p_status = 'CLOSED' then
    if v_counter_status = 'CLOSED' then
      raise exception 'Quầy đã đóng rồi.';
    end if;
    if v_counter_status = 'BUSY' then
      raise exception 'Quầy đang bận (có ticket đang xử lý), không thể đóng.';
    end if;
    if v_break_agent is null then
      raise exception 'Quầy chưa có Agent mặc định.';
    end if;

    select p.full_name into v_break_agent_name from public.profiles p where p.id = v_break_agent;

    update public.counters c
    set status = 'CLOSED', current_agent_id = null
    where c.id = p_counter_id;

    for r in
      select cs.id as case_id, cs.category_id, qt.ticket_code
      from public.service_cases cs
      join public.queue_tickets qt on qt.id = cs.ticket_id
      where cs.assigned_agent_id = v_break_agent
        and cs.status = 'WAITING'
        and qt.branch_id = v_branch
    loop
      select aca.agent_id into v_new_agent
      from public.agent_category_assignments aca
      join public.profiles p on p.id = aca.agent_id
      where aca.category_id = r.category_id
        and p.branch_id = v_branch
        and p.status = 'ACTIVE'
        and aca.agent_id <> v_break_agent
        and not exists (
          select 1 from public.counters c2
          where c2.default_agent_id = aca.agent_id and c2.status = 'CLOSED'
        )
      order by (
        select count(*) from public.service_cases cs2
        where cs2.assigned_agent_id = aca.agent_id and cs2.status in ('WAITING','CALLED','PROCESSING')
      ) asc, random()
      limit 1;

      if v_new_agent is not null then
        update public.service_cases
        set assigned_agent_id = v_new_agent
        where id = r.case_id;

        insert into public.case_history(case_id, action, old_status, new_status, performed_by, note)
        values (r.case_id, 'Phân lại Agent', 'WAITING', 'WAITING', v_actor,
          'Tự động chuyển từ ' || coalesce(v_break_agent_name,'agent nghỉ') || ' sang agent khác do quầy đóng nghỉ.');

        v_reassigned := v_reassigned + 1;
      else
        v_unresolved := array_append(v_unresolved, r.ticket_code);
      end if;

      v_new_agent := null;
    end loop;

  else
    if v_counter_status <> 'CLOSED' then
      raise exception 'Quầy không ở trạng thái đóng.';
    end if;

    update public.counters c
    set status = 'AVAILABLE', current_agent_id = null
    where c.id = p_counter_id;
  end if;

  return query select v_reassigned, v_unresolved;
end;
$function$;

revoke all on function public.set_counter_status(uuid, text) from public;
grant execute on function public.set_counter_status(uuid, text) to authenticated;

create or replace function public.create_checkin(p_driver_id uuid, p_branch_id uuid, p_category_id uuid, p_subcategory_id uuid, p_description text)
 RETURNS TABLE(visit_code text, ticket_code text, queue_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_visit_id uuid;
  v_ticket_id uuid;
  v_business_date date := current_date;
  v_branch_code text;
  v_visit_code text;
  v_ticket_code text;
  v_queue_number text;
  v_assigned_agent uuid;
  c_open  constant text := '08:25';
  c_close constant text := '17:45';
  v_hm    text := to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'HH24:MI');
begin
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
    status, description, assigned_agent_id
  ) values (
    v_ticket_code, v_ticket_id, v_visit_id, p_driver_id, p_category_id, p_subcategory_id, 'WAITING', p_description,
    v_assigned_agent
  );

  return query select v_visit_code, v_ticket_code, v_queue_number;
end;
$function$;
