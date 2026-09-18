-- 0032: Khôi phục cột đánh giá tổng quát ("CSAT Rating (tổng)") trong
-- v_report_raw, bên cạnh 3 cột chi tiết mới thêm ở 0026.
--
-- Vấn đề: 0026 thay hẳn cột "CSAT Rating" cũ bằng 3 cột chi tiết
-- (Thời gian hỗ trợ / Thái độ / Ghi nhận đầy đủ). Nhưng tại thời
-- điểm đó, feedback.rating_time/attitude/resolution chỉ có dữ liệu
-- cho các đánh giá MỚI (từ khi thêm tính năng 3 tiêu chí) — 2.913/
-- 3.023 dòng feedback (96.4%) là kiểu cũ, chỉ có cột `rating` gốc.
-- Kết quả: khi export, gần như toàn bộ lịch sử CSAT cũ hiện trống cả
-- 3 cột, dù dữ liệu vẫn còn nguyên trong bảng feedback — chỉ là
-- không được view xuất ra nữa.
--
-- Fix: thêm lại "CSAT Rating (tổng)" = feedback.rating, cột này luôn
-- có giá trị cho MỌI feedback (cũ lẫn mới, vì rating mới cũng tự
-- tính trung bình lưu vào đây) — không mất dữ liệu, đồng thời vẫn
-- giữ 3 cột chi tiết cho phần dữ liệu mới hơn.

DROP VIEW IF EXISTS v_report_raw;

CREATE VIEW v_report_raw WITH (security_invoker = true) AS
 SELECT cs.case_code AS "Case Code",
    qt.ticket_code AS "Ticket Code",
    qt.queue_number AS "Queue Number",
    b.branch_code AS "Branch Code",
    b.branch_name AS "Branch Name",
    d.sap_id AS "SAP ID",
    sc.name AS "Category",
    ssc.name AS "Subcategory",
    cs.description AS "Description",
    caller.full_name AS "Agent",
    qt.status AS "Ticket Status",
    cs.status AS "Case Status",
    qt.priority AS "Priority",
    c.counter_code AS "Counter",
    vi.checkin_at AS "Check-in",
    qt.called_at AS "Called At",
    qt.serving_at AS "Started At",
    cs.resolved_at AS "Resolved At",
    cs.closed_at AS "Closed At",
    cs.sla_due_at AS "SLA Due At",
    cs.sla_status AS "SLA Status",
    cs.resolution AS "Resolution",
    cs.internal_note AS "Agent Note",
    cs.has_incident_report AS "Viết bản tường trình",
    f.rating AS "CSAT Rating (tổng)",
    f.rating_time AS "Thời gian hỗ trợ",
    f.rating_attitude AS "Thái độ nhân viên hỗ trợ",
    f.rating_resolution AS "Vấn đề Đối tác đã được ghi nhận hỗ trợ đầy đủ",
    f.comment AS "CSAT Comment",
    f.created_at AS "Feedback Created At",
    COALESCE(vi.checkin_at, cs.created_at) AS _filter_date
   FROM service_cases cs
     JOIN queue_tickets qt ON qt.id = cs.ticket_id
     JOIN visits vi ON vi.id = cs.visit_id
     JOIN drivers d ON d.id = cs.driver_id
     JOIN service_categories sc ON sc.id = cs.category_id
     LEFT JOIN service_subcategories ssc ON ssc.id = cs.subcategory_id
     JOIN branches b ON b.id = qt.branch_id
     LEFT JOIN LATERAL ( SELECT p.full_name
           FROM case_history h
             JOIN profiles p ON p.id = h.performed_by
          WHERE h.case_id = cs.id AND h.action = 'STATUS_CHANGED'::text AND h.old_status = 'WAITING'::ticket_status AND h.new_status = 'CALLED'::ticket_status
          ORDER BY h.created_at DESC
         LIMIT 1) caller ON true
     LEFT JOIN LATERAL ( SELECT feedback.rating,
            feedback.rating_time,
            feedback.rating_attitude,
            feedback.rating_resolution,
            feedback.comment,
            feedback.created_at
           FROM feedback
          WHERE feedback.case_id = cs.id
          ORDER BY feedback.created_at DESC
         LIMIT 1) f ON true
     LEFT JOIN counters c ON c.id = qt.counter_id;
