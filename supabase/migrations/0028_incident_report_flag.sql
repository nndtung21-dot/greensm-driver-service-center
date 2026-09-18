-- 0028: Checkbox "Viết bản tường trình" trên màn hình xử lý ticket
-- (khối "Hoàn tất xử lý"). Chỉ là cờ có/không, không bắt buộc, không
-- có nội dung đính kèm — dùng để lọc/báo cáo sau này.

alter table service_cases
  add column has_incident_report boolean not null default false;

-- resolve_case đổi signature (thêm p_has_incident_report) nên phải
-- drop bản 3-tham số cũ để tránh 2 overload cùng tồn tại gây lỗi
-- "function is not unique" khi gọi qua RPC.
drop function if exists public.resolve_case(uuid, text, text);

create or replace function resolve_case(
  p_case_id uuid,
  p_resolution text,
  p_internal_note text,
  p_has_incident_report boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent uuid := auth.uid();
  v_assigned uuid;
  v_ticket uuid;
  v_role user_role;
  v_status ticket_status;
  v_counter uuid;
begin
  select assigned_agent_id, ticket_id, status into v_assigned, v_ticket, v_status
    from service_cases where id = p_case_id;
  select role into v_role from profiles where id = v_agent and status = 'ACTIVE';
  if v_role is null or (v_assigned is distinct from v_agent and v_role not in ('supervisor', 'admin')) then
    raise exception 'Bạn không có quyền hoàn tất ticket này.';
  end if;
  if v_status not in ('CALLED', 'PROCESSING', 'PENDING') then
    raise exception 'Ticket chưa ở trạng thái có thể hoàn tất.';
  end if;

  update service_cases
  set status = 'RESOLVED',
      resolution = p_resolution,
      internal_note = p_internal_note,
      has_incident_report = coalesce(p_has_incident_report, false),
      resolved_at = now(),
      sla_paused_at = null
  where id = p_case_id;

  select counter_id into v_counter from queue_tickets where id = v_ticket;
  update queue_tickets set status = 'RESOLVED', completed_at = now() where id = v_ticket and status in ('CALLED', 'PROCESSING', 'PENDING');
  if v_counter is not null then
    update counters set status = 'AVAILABLE', current_agent_id = null where id = v_counter and status = 'BUSY';
  end if;
end;
$$;

revoke all on function public.resolve_case(uuid, text, text, boolean) from public;
grant execute on function public.resolve_case(uuid, text, text, boolean) to anon, authenticated;

-- v_report_raw: thêm cột "Viết bản tường trình" ngay sau "Agent Note".
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
     LEFT JOIN LATERAL ( SELECT feedback.rating_time,
            feedback.rating_attitude,
            feedback.rating_resolution,
            feedback.comment,
            feedback.created_at
           FROM feedback
          WHERE feedback.case_id = cs.id
          ORDER BY feedback.created_at DESC
         LIMIT 1) f ON true
     LEFT JOIN counters c ON c.id = qt.counter_id;
