-- 0039: Policy phân quyền theo văn phòng (bước 2/4). Tạo policy trước khi bật RLS (0040).
--
-- Quy tắc:
--  * Super admin (profiles.all_branches, role admin): xem tất cả văn phòng.
--  * Admin/supervisor/agent thường: chỉ dữ liệu của văn phòng mình.
--  * Người chưa đăng nhập: chỉ đọc văn phòng/chủ đề/nhu cầu ACTIVE (kiosk). Mọi thứ khác đi qua hàm RPC.
--  * Vé/case/lượt đến/lịch sử: chỉ đọc; mọi thay đổi qua RPC (SECURITY DEFINER, không bị RLS chặn).
--  * Danh mục dùng chung (chủ đề, nhu cầu, luật SLA chung): admin của bất kỳ văn phòng sửa được.
--  * Văn phòng: chỉ super admin tạo/sửa. Quầy, hồ sơ nhân viên: admin trong văn phòng mình.
--  * Đánh giá: admin/supervisor thấy cả văn phòng; agent chỉ thấy đánh giá của case mình phụ trách.

alter view public.v_case_detail set (security_invoker = true);
alter view public.v_report_daily_summary set (security_invoker = true);

drop policy if exists "Public Policy agent_category_assignments" on public.agent_category_assignments;
drop policy if exists agent_category_assignments_staff_select on public.agent_category_assignments;
drop policy if exists counters_staff_select on public.counters;
drop policy if exists feedback_staff_select on public.feedback;
drop policy if exists sla_rules_staff_select on public.sla_rules;
drop policy if exists "Public All Tickets" on public.tickets;
drop policy if exists "Public Policy tickets" on public.tickets;

create policy branches_anon_select on public.branches for select to anon using (status = 'ACTIVE');
create policy branches_staff_select on public.branches for select to authenticated using (public.can_access_branch(id));
create policy branches_super_insert on public.branches for insert to authenticated with check ((select public.is_super_admin()));
create policy branches_super_update on public.branches for update to authenticated using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
create policy branches_super_delete on public.branches for delete to authenticated using ((select public.is_super_admin()));

create policy counters_staff_select on public.counters for select to authenticated
  using ((select public.is_super_admin()) or branch_id = (select public.active_branch()));
create policy counters_admin_insert on public.counters for insert to authenticated
  with check ((select public.active_role()) = 'admin' and ((select public.is_super_admin()) or branch_id = (select public.active_branch())));
create policy counters_admin_update on public.counters for update to authenticated
  using ((select public.active_role()) = 'admin' and ((select public.is_super_admin()) or branch_id = (select public.active_branch())))
  with check ((select public.active_role()) = 'admin' and ((select public.is_super_admin()) or branch_id = (select public.active_branch())));
create policy counters_admin_delete on public.counters for delete to authenticated
  using ((select public.active_role()) = 'admin' and ((select public.is_super_admin()) or branch_id = (select public.active_branch())));

create policy profiles_staff_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_super_admin()) or branch_id = (select public.active_branch()));
create policy profiles_admin_insert on public.profiles for insert to authenticated
  with check ((select public.active_role()) = 'admin'
    and (all_branches = false or (select public.is_super_admin()))
    and ((select public.is_super_admin()) or branch_id = (select public.active_branch())));
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select public.active_role()) = 'admin'
    and (all_branches = false or (select public.is_super_admin()))
    and ((select public.is_super_admin()) or branch_id = (select public.active_branch())))
  with check ((select public.active_role()) = 'admin'
    and (all_branches = false or (select public.is_super_admin()))
    and ((select public.is_super_admin()) or branch_id = (select public.active_branch())));

create policy queue_tickets_staff_select on public.queue_tickets for select to authenticated
  using ((select public.is_super_admin()) or branch_id = (select public.active_branch()));
create policy service_cases_staff_select on public.service_cases for select to authenticated
  using ((select public.is_super_admin()) or branch_id = (select public.active_branch()));
create policy visits_staff_select on public.visits for select to authenticated
  using ((select public.is_super_admin()) or branch_id = (select public.active_branch()));

create policy case_history_staff_select on public.case_history for select to authenticated
  using ((select public.is_super_admin()) or case_id in (select id from public.service_cases));
create policy case_transfers_staff_select on public.case_transfers for select to authenticated
  using ((select public.is_super_admin()) or case_id in (select id from public.service_cases));

create policy feedback_staff_select on public.feedback for select to authenticated
  using (
    (select public.is_super_admin())
    or ((select public.active_role()) in ('admin','supervisor') and case_id in (select id from public.service_cases))
    or case_id in (select id from public.service_cases where assigned_agent_id = (select auth.uid()))
  );

create policy sla_rules_staff_select on public.sla_rules for select to authenticated
  using (branch_id is null or (select public.is_super_admin()) or branch_id = (select public.active_branch()));
create policy sla_rules_admin_insert on public.sla_rules for insert to authenticated
  with check ((select public.active_role()) = 'admin' and (branch_id is null or (select public.is_super_admin()) or branch_id = (select public.active_branch())));
create policy sla_rules_admin_update on public.sla_rules for update to authenticated
  using ((select public.active_role()) = 'admin' and (branch_id is null or (select public.is_super_admin()) or branch_id = (select public.active_branch())))
  with check ((select public.active_role()) = 'admin' and (branch_id is null or (select public.is_super_admin()) or branch_id = (select public.active_branch())));
create policy sla_rules_admin_delete on public.sla_rules for delete to authenticated
  using ((select public.active_role()) = 'admin' and (branch_id is null or (select public.is_super_admin()) or branch_id = (select public.active_branch())));

create policy service_categories_anon_select on public.service_categories for select to anon using (status = 'ACTIVE');
create policy service_categories_staff_select on public.service_categories for select to authenticated using (true);
create policy service_categories_admin_insert on public.service_categories for insert to authenticated with check ((select public.active_role()) = 'admin');
create policy service_categories_admin_update on public.service_categories for update to authenticated using ((select public.active_role()) = 'admin') with check ((select public.active_role()) = 'admin');
create policy service_categories_admin_delete on public.service_categories for delete to authenticated using ((select public.active_role()) = 'admin');

create policy service_subcategories_anon_select on public.service_subcategories for select to anon using (status = 'ACTIVE');
create policy service_subcategories_staff_select on public.service_subcategories for select to authenticated using (true);
create policy service_subcategories_admin_insert on public.service_subcategories for insert to authenticated with check ((select public.active_role()) = 'admin');
create policy service_subcategories_admin_update on public.service_subcategories for update to authenticated using ((select public.active_role()) = 'admin') with check ((select public.active_role()) = 'admin');
create policy service_subcategories_admin_delete on public.service_subcategories for delete to authenticated using ((select public.active_role()) = 'admin');

create policy aca_staff_select on public.agent_category_assignments for select to authenticated
  using (agent_id in (select id from public.profiles));
create policy aca_admin_insert on public.agent_category_assignments for insert to authenticated
  with check ((select public.active_role()) = 'admin' and agent_id in (select id from public.profiles));
create policy aca_admin_delete on public.agent_category_assignments for delete to authenticated
  using ((select public.active_role()) = 'admin' and agent_id in (select id from public.profiles));

create policy drivers_staff_select on public.drivers for select to authenticated using (true);
create policy drivers_admin_insert on public.drivers for insert to authenticated with check ((select public.active_role()) = 'admin');
create policy drivers_admin_update on public.drivers for update to authenticated using ((select public.active_role()) = 'admin') with check ((select public.active_role()) = 'admin');

-- bảng cũ: departments chỉ đọc (view báo cáo còn join); tickets, queue_counters không có policy = chặn hết
create policy departments_staff_select on public.departments for select to authenticated using (true);
