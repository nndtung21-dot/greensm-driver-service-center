-- 0025: Thêm 3 tiêu chí đánh giá riêng cho trang quét QR (/feedback/[ticketCode]):
--   - Thời gian hỗ trợ
--   - Thái độ nhân viên hỗ trợ
--   - Vấn đề Đối tác đã được ghi nhận hỗ trợ đầy đủ
--
-- Giữ nguyên cột `rating` (tổng quát, 1 sao) để không phá vỡ các báo cáo/
-- CSAT hiện có (agent performance, supervisor dashboard, export) — với các
-- đánh giá gửi từ trang QR, `rating` được tự tính = làm tròn trung bình
-- cộng của 3 tiêu chí. Luồng đánh giá 1-sao ngay trên màn hình kiosk sau
-- check-in (submit_feedback cũ) giữ nguyên, không đổi.

alter table feedback
  add column rating_time int check (rating_time between 1 and 5),
  add column rating_attitude int check (rating_attitude between 1 and 5),
  add column rating_resolution int check (rating_resolution between 1 and 5);

create or replace function submit_feedback_detailed(
  p_case_id uuid,
  p_rating_time int,
  p_rating_attitude int,
  p_rating_resolution int,
  p_comment text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_status ticket_status;
  v_driver_id uuid;
  v_overall int;
begin
  if p_rating_time not between 1 and 5
     or p_rating_attitude not between 1 and 5
     or p_rating_resolution not between 1 and 5 then
    raise exception 'Mỗi mục đánh giá phải từ 1 đến 5 sao.';
  end if;

  select status, driver_id into v_status, v_driver_id from service_cases where id = p_case_id;
  if v_status is null then raise exception 'Không tìm thấy ticket.'; end if;
  if v_status not in ('RESOLVED','CLOSED') then raise exception 'Ticket chưa hoàn tất, chưa thể đánh giá.'; end if;

  v_overall := round((p_rating_time + p_rating_attitude + p_rating_resolution) / 3.0);

  insert into feedback (case_id, driver_id, rating, rating_time, rating_attitude, rating_resolution, comment)
  values (p_case_id, v_driver_id, v_overall, p_rating_time, p_rating_attitude, p_rating_resolution, p_comment);
exception when unique_violation then
  raise exception 'Ticket này đã được đánh giá rồi.';
end;
$$;

revoke all on function submit_feedback_detailed(uuid, int, int, int, text) from public;
grant execute on function submit_feedback_detailed(uuid, int, int, int, text) to anon, authenticated;

drop view if exists v_report_feedback;

create view v_report_feedback with (security_invoker = true) as
select
  cs.case_code as case_id, d.name as driver_name, br.branch_name as branch,
  f.rating, f.rating_time, f.rating_attitude, f.rating_resolution, f.comment, f.created_at
from feedback f
join service_cases cs on cs.id = f.case_id
join drivers d on d.id = f.driver_id
join queue_tickets qt on qt.id = cs.ticket_id
join branches br on br.id = qt.branch_id;
