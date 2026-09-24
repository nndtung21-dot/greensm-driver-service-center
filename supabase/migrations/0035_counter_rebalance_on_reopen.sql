-- 0035: Khi MỞ lại quầy (sau nghỉ trưa), kéo bớt vé từ agent đang
-- bận nhất (trong các chủ đề agent vừa mở quầy phụ trách) về cho họ,
-- cho tới khi cân bằng tải lại — đối xứng với hành vi lúc ĐÓNG quầy
-- (0034). Nếu không, agent quay lại sẽ ngồi không chờ vé check-in
-- mới trong khi người khác vẫn đang gánh phần việc đã nhận lúc họ
-- vắng mặt.
--
-- Thuật toán: lặp — mỗi lần tìm 1 vé WAITING thuộc chủ đề agent này
-- phụ trách, đang gán cho agent khác có tải > tải của agent này + 1,
-- ưu tiên rút từ agent đang bận nhất trước, vé cũ nhất trước. Dừng
-- khi không còn vé nào đáng chuyển nữa (tải đã cân bằng tương đối)
-- hoặc chạm giới hạn an toàn 500 vòng lặp.

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
  v_pull_case_id uuid;
  v_safety int := 0;
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

  if v_break_agent is not null then
    select p.full_name into v_break_agent_name from public.profiles p where p.id = v_break_agent;
  end if;

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
    -- MỞ LẠI
    if v_counter_status <> 'CLOSED' then
      raise exception 'Quầy không ở trạng thái đóng.';
    end if;

    update public.counters c
    set status = 'AVAILABLE', current_agent_id = null
    where c.id = p_counter_id;

    if v_break_agent is not null then
      loop
        v_safety := v_safety + 1;
        exit when v_safety > 500;

        select cs.id
        into v_pull_case_id
        from public.service_cases cs
        join public.queue_tickets qt on qt.id = cs.ticket_id
        join public.agent_category_assignments aca
          on aca.category_id = cs.category_id and aca.agent_id = v_break_agent
        where cs.status = 'WAITING'
          and qt.branch_id = v_branch
          and cs.assigned_agent_id is not null
          and cs.assigned_agent_id <> v_break_agent
          and (
            select count(*) from public.service_cases cs3
            where cs3.assigned_agent_id = cs.assigned_agent_id and cs3.status in ('WAITING','CALLED','PROCESSING')
          ) > (
            select count(*) from public.service_cases cs4
            where cs4.assigned_agent_id = v_break_agent and cs4.status in ('WAITING','CALLED','PROCESSING')
          ) + 1
        order by (
          select count(*) from public.service_cases cs5
          where cs5.assigned_agent_id = cs.assigned_agent_id and cs5.status in ('WAITING','CALLED','PROCESSING')
        ) desc, qt.created_at asc
        limit 1;

        exit when v_pull_case_id is null;

        update public.service_cases
        set assigned_agent_id = v_break_agent
        where id = v_pull_case_id;

        insert into public.case_history(case_id, action, old_status, new_status, performed_by, note)
        values (v_pull_case_id, 'Phân lại Agent', 'WAITING', 'WAITING', v_actor,
          'Tự động cân bằng tải: chuyển sang ' || coalesce(v_break_agent_name,'agent') || ' vừa mở lại quầy.');

        v_reassigned := v_reassigned + 1;
        v_pull_case_id := null;
      end loop;
    end if;
  end if;

  return query select v_reassigned, v_unresolved;
end;
$function$;
