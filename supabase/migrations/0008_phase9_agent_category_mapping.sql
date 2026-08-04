-- Phase 9 (bổ sung theo yêu cầu): Admin quản lý việc Agent phụ trách chủ đề
-- (category) nào. Một Agent có thể phụ trách nhiều category (many-to-many).
create table if not exists agent_category_assignments (
  agent_id uuid not null references profiles(id) on delete cascade,
  category_id uuid not null references service_categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agent_id, category_id)
);

alter table agent_category_assignments enable row level security;

create policy agent_category_assignments_staff_select on agent_category_assignments for select
  using (current_role_name() in ('agent','supervisor','admin'));

create policy agent_category_assignments_admin_write on agent_category_assignments for all
  using (current_role_name() = 'admin')
  with check (current_role_name() = 'admin');
