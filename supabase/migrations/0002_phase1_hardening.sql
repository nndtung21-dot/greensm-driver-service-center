-- =====================================================================
-- Phase 1 hardening — gộp các bản vá đã áp dụng cho sạch lịch sử migration:
--   fix_rls_departments_queue_counters, harden_function_search_path,
--   perf_indexes_and_rls_initplan, add_is_demo_flags
-- =====================================================================

-- RLS còn thiếu ở 2 bảng (phát hiện qua Supabase security advisor)
ALTER TABLE public.queue_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY departments_staff_select ON public.departments FOR SELECT
  USING (current_role_name() IN ('agent','supervisor','admin'));

-- Pin search_path cho mọi function nội bộ (chống search_path hijacking)
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.generate_queue_number(uuid, date) SET search_path = public;
ALTER FUNCTION public.resolve_sla_minutes(uuid, uuid, uuid) SET search_path = public;
ALTER FUNCTION public.log_case_status_change() SET search_path = public;
ALTER FUNCTION public.current_role_name() SET search_path = public;
ALTER FUNCTION public.current_branch_id() SET search_path = public;

-- Index cho các foreign key hay JOIN (Agent/Supervisor views)
create index if not exists idx_case_history_performed_by on case_history (performed_by);
create index if not exists idx_case_transfers_case_id on case_transfers (case_id);
create index if not exists idx_case_transfers_created_by on case_transfers (created_by);
create index if not exists idx_case_transfers_from_agent on case_transfers (from_agent_id);
create index if not exists idx_case_transfers_from_dept on case_transfers (from_department_id);
create index if not exists idx_case_transfers_to_agent on case_transfers (to_agent_id);
create index if not exists idx_case_transfers_to_dept on case_transfers (to_department_id);
create index if not exists idx_counters_current_agent on counters (current_agent_id);
create index if not exists idx_feedback_driver on feedback (driver_id);
create index if not exists idx_profiles_branch on profiles (branch_id);
create index if not exists idx_profiles_department on profiles (department_id);
create index if not exists idx_queue_tickets_counter on queue_tickets (counter_id);
create index if not exists idx_queue_tickets_category on queue_tickets (service_category_id);
create index if not exists idx_queue_tickets_visit on queue_tickets (visit_id);
create index if not exists idx_service_cases_category on service_cases (category_id);
create index if not exists idx_service_cases_driver on service_cases (driver_id);
create index if not exists idx_service_cases_subcategory on service_cases (subcategory_id);
create index if not exists idx_service_cases_ticket on service_cases (ticket_id);
create index if not exists idx_service_cases_visit on service_cases (visit_id);
create index if not exists idx_sla_rules_branch on sla_rules (branch_id);
create index if not exists idx_sla_rules_category on sla_rules (category_id);
create index if not exists idx_sla_rules_subcategory on sla_rules (subcategory_id);

-- auth.uid() chỉ evaluate 1 lần/query thay vì mỗi hàng (performance)
create or replace function current_role_name()
returns user_role language sql stable set search_path = public as $$
  select role from profiles where id = (select auth.uid());
$$;
create or replace function current_branch_id()
returns uuid language sql stable set search_path = public as $$
  select branch_id from profiles where id = (select auth.uid());
$$;
alter policy profiles_self_select on profiles
  using (id = (select auth.uid()) or current_role_name() = 'admin');

-- Section 35: cờ đánh dấu dữ liệu demo, có cách xoá trước production
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
