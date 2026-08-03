-- =====================================================================
-- Phase 7: Feedback / CSAT — Section 28
-- =====================================================================

create or replace function lookup_ticket_for_feedback(p_ticket_code text)
returns table (case_id uuid, ticket_code text, queue_number text, status ticket_status, already_rated boolean)
language sql security definer set search_path = public stable as $$
  select cs.id, qt.ticket_code, qt.queue_number, cs.status,
         exists(select 1 from feedback f where f.case_id = cs.id)
  from service_cases cs
  join queue_tickets qt on qt.id = cs.ticket_id
  where qt.ticket_code = p_ticket_code
  limit 1;
$$;
revoke all on function lookup_ticket_for_feedback(text) from public;
grant execute on function lookup_ticket_for_feedback(text) to anon, authenticated;

create or replace function submit_feedback(p_case_id uuid, p_rating int, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status ticket_status; v_driver_id uuid;
begin
  if p_rating < 1 or p_rating > 5 then raise exception 'Đánh giá phải từ 1 đến 5 sao.'; end if;
  select status, driver_id into v_status, v_driver_id from service_cases where id = p_case_id;
  if v_status is null then raise exception 'Không tìm thấy ticket.'; end if;
  if v_status not in ('RESOLVED','CLOSED') then raise exception 'Ticket chưa hoàn tất, chưa thể đánh giá.'; end if;
  insert into feedback (case_id, driver_id, rating, comment) values (p_case_id, v_driver_id, p_rating, p_comment);
exception when unique_violation then
  raise exception 'Ticket này đã được đánh giá rồi.';
end;
$$;
revoke all on function submit_feedback(uuid, int, text) from public;
grant execute on function submit_feedback(uuid, int, text) to anon, authenticated;
