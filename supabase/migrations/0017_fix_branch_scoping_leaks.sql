-- =====================================================================
-- Fix: counters_staff_select và feedback_staff_select thiếu điều kiện
-- branch, trong khi mọi policy staff khác trong dự án đều có (xem
-- docs/security-fixes-log.md #5: "Mọi policy/RPC liên quan Supervisor
-- phải luôn kiểm tra branch, không chỉ kiểm tra role" — nguyên tắc đã
-- công bố nhưng bị bỏ sót ở 2 bảng này).
--
--   counters: Supervisor Dashboard SELECT * from counters không giới hạn
--   branch -> Supervisor VP này thấy được tên quầy, trạng thái mở/đóng,
--   agent nào đang trực của MỌI VP khác. Ghi (set_counter_status RPC) đã
--   được chặn đúng branch từ trước, chỉ có phần ĐỌC bị hở.
--
--   feedback: bảng gốc cho phép mọi Supervisor đọc toàn bộ đánh giá/nhận
--   xét (có thể chứa nội dung khiếu nại nhạy cảm) của MỌI VP. View
--   v_report_feedback tình cờ an toàn nhờ join qua service_cases/
--   queue_tickets (đã có branch RLS), nhưng bảng gốc vẫn hở nếu ai đó gọi
--   thẳng /rest/v1/feedback bằng JWT Supervisor.
-- =====================================================================

drop policy if exists counters_staff_select on counters;
create policy counters_staff_select on counters for select
  using (
    public.current_role_name() = 'admin'
    or branch_id = public.current_branch_id()
  );

drop policy if exists feedback_staff_select on feedback;
create policy feedback_staff_select on feedback for select
  using (
    public.current_role_name() = 'admin'
    or (
      public.current_role_name() = 'supervisor'
      and exists (
        select 1 from service_cases cs
        join queue_tickets qt on qt.id = cs.ticket_id
        where cs.id = feedback.case_id and qt.branch_id = public.current_branch_id()
      )
    )
  );

-- =====================================================================
-- Cùng nguyên tắc, độ nhạy cảm thấp hơn nhiều (không phải dữ liệu khách
-- hàng, chỉ là config nội bộ) nhưng sửa cho nhất quán toàn hệ thống.
-- =====================================================================

drop policy if exists agent_category_assignments_staff_select on agent_category_assignments;
create policy agent_category_assignments_staff_select on agent_category_assignments for select
  using (
    public.current_role_name() = 'admin'
    or exists (
      select 1 from profiles p
      where p.id = agent_category_assignments.agent_id
        and p.branch_id = public.current_branch_id()
    )
  );

-- sla_rules.branch_id NULL nghĩa là áp dụng mọi VP (xem resolve_sla_minutes)
-- nên vẫn phải cho Supervisor thấy các rule NULL-branch, chỉ chặn rule của
-- VP KHÁC cụ thể.
drop policy if exists sla_rules_staff_select on sla_rules;
create policy sla_rules_staff_select on sla_rules for select
  using (
    public.current_role_name() = 'admin'
    or (
      public.current_role_name() = 'supervisor'
      and (branch_id = public.current_branch_id() or branch_id is null)
    )
  );
