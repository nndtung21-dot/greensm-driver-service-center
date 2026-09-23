-- 0033: Bắt buộc nhập lý do khi chuyển ticket sang quầy khác.
--
-- Lý do KHÔNG đưa vào v_report_raw/báo cáo — chỉ ghi vào
-- case_history (action='Chuyển quầy', note=lý do) để agent ở quầy
-- nhận thấy được lý do ngay trong panel "Lịch sử" khi mở ticket đó.
--
-- Đổi signature hàm (thêm p_reason) nên drop bản 2-tham số cũ trước,
-- tránh 2 overload cùng tồn tại gây lỗi "function is not unique".

drop function if exists public.transfer_ticket_to_counter(uuid, uuid);

create or replace function public.transfer_ticket_to_counter(
  p_ticket_id uuid,
  p_target_counter_id uuid,
  p_reason text
)
returns table(ticket_id uuid, ticket_code text, queue_number text, target_counter_code text, target_agent_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid:=auth.uid();
  v_role user_role;
  v_branch uuid;
  v_ticket_branch uuid;
  v_status ticket_status;
  v_old_counter uuid;
  v_target_branch uuid;
  v_target_agent uuid;
  v_target_code text;
  v_target_status text;
  v_out_ticket_id uuid;
  v_out_ticket_code text;
  v_out_queue_number text;
  v_case_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Vui lòng nhập lý do chuyển quầy.';
  end if;

  select p.role,p.branch_id into v_role,v_branch
  from public.profiles p
  where p.id=v_actor and p.status='ACTIVE';

  if v_role is null or v_role not in ('agent','supervisor','admin') then
    raise exception 'Không có quyền chuyển ticket.';
  end if;

  select qt.branch_id,qt.status,qt.counter_id,qt.id,qt.ticket_code,qt.queue_number
  into v_ticket_branch,v_status,v_old_counter,v_out_ticket_id,v_out_ticket_code,v_out_queue_number
  from public.queue_tickets qt
  where qt.id=p_ticket_id
  for update;

  if v_ticket_branch is null then raise exception 'Không tìm thấy ticket.'; end if;
  if v_ticket_branch is distinct from v_branch then raise exception 'Ticket không thuộc văn phòng của bạn.'; end if;
  if v_status not in ('WAITING','CALLED') then raise exception 'Chỉ có thể chuyển ticket đang ở WAITING hoặc CALLED.'; end if;

  select c.branch_id,c.default_agent_id,c.counter_code,c.status::text
  into v_target_branch,v_target_agent,v_target_code,v_target_status
  from public.counters c
  where c.id=p_target_counter_id
  for update;

  if v_target_branch is null then raise exception 'Không tìm thấy quầy đích.'; end if;
  if v_target_branch is distinct from v_branch then raise exception 'Quầy đích không thuộc văn phòng này.'; end if;
  if v_target_agent is null then raise exception 'Quầy đích chưa được gán Agent.'; end if;
  if v_target_status not in ('AVAILABLE','BUSY') then raise exception 'Quầy đích hiện đang đóng.'; end if;

  select sc.id into v_case_id from public.service_cases sc where sc.ticket_id=p_ticket_id;

  update public.queue_tickets qt
  set status='WAITING',
      counter_id=p_target_counter_id,
      called_at=null,
      serving_at=null,
      transferred_at=now()
  where qt.id=p_ticket_id;

  update public.service_cases sc
  set status='WAITING',assigned_agent_id=v_target_agent
  where sc.ticket_id=p_ticket_id;

  if v_case_id is not null then
    insert into public.case_history(case_id, action, old_status, new_status, performed_by, note)
    values (v_case_id, 'Chuyển quầy', v_status, 'WAITING', v_actor,
      'Chuyển sang ' || v_target_code || '. Lý do: ' || trim(p_reason));
  end if;

  if v_status='CALLED' and v_old_counter is not null and v_old_counter is distinct from p_target_counter_id then
    update public.counters c
    set status='AVAILABLE',current_agent_id=null
    where c.id=v_old_counter and c.status='BUSY';
  end if;

  return query select v_out_ticket_id,v_out_ticket_code,v_out_queue_number,v_target_code,v_target_agent;
end;
$function$;

revoke all on function public.transfer_ticket_to_counter(uuid, uuid, text) from public;
grant execute on function public.transfer_ticket_to_counter(uuid, uuid, text) to authenticated;
