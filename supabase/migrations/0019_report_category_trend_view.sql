-- =====================================================================
-- Theo yêu cầu: thêm trend "Visit theo category" theo ngày (7 ngày) trên
-- Supervisor Dashboard, đặt cạnh chart "Check-in theo ngày" (đã có sẵn,
-- đã hiện đúng phần "Total visit theo ngày" nên không làm trùng).
--
-- View riêng (không sửa v_report_daily_summary hiện có) để không đổi độ
-- chi tiết (grain) của view đó — v_report_daily_summary đang là 1 dòng/
-- branch/ngày, dùng cho các thẻ KPI "Avg Waiting/Handling Time"; nếu thêm
-- category vào GROUP BY của chính nó sẽ nhân dòng lên và làm sai các thẻ
-- đó ở phía frontend.
-- =====================================================================

create or replace view v_report_category_trend with (security_invoker = true) as
select
  qt.branch_id, br.branch_name as branch, qt.business_date,
  sc.name as category, count(qt.id) as visit_count
from queue_tickets qt
join branches br on br.id = qt.branch_id
join service_categories sc on sc.id = qt.service_category_id
group by qt.branch_id, br.branch_name, qt.business_date, sc.name;
