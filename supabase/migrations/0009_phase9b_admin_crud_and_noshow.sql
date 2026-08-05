-- =====================================================================
-- Phase 9b: Admin CRUD (categories/subcategories/branches/counters/SLA/
-- departments/users) + NO_SHOW handling + FCR metric
-- =====================================================================

create policy branches_admin_write on branches for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy categories_admin_write on service_categories for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy subcategories_admin_write on service_subcategories for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy counters_admin_write on counters for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy sla_rules_admin_write on sla_rules for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy departments_admin_write on departments for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy profiles_admin_update on profiles for update
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy profiles_admin_insert on profiles for insert
  with check (current_role_name() = 'admin');

create or replace function admin_list_pending_users()
returns table (id uuid, email text, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select u.id, u.email, u.created_at
  from auth.users u
  left join profiles p on p.id = u.id
  where p.id is null
    and current_role_name() = 'admin'
  order by u.created_at desc;
$$;
revoke all on function admin_list_pending_users() from public;
revoke execute on function admin_list_pending_users() from anon;
grant execute on function admin_list_pending_users() to authenticated;

create or replace function mark_no_show(p_case_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid := auth.uid();
  v_assigned uuid;
  v_role user_role;
  v_ticket_id uuid;
  v_status ticket_status;
  v_counter_id uuid;
begin
  select assigned_agent_id, ticket_id, status into v_assigned, v_ticket_id, v_status
  from service_cases where id = p_case_id;
  select role into v_role from profiles where id = v_agent_id;
  if v_role is null or (v_assigned is distinct from v_agent_id and v_role not in ('supervisor','admin')) then
    raise exception 'Bạn không có quyền thao tác ticket này.';
  end if;
  if v_status <> 'CALLED' then
    raise exception 'Chỉ đánh dấu NO_SHOW khi ticket đang ở trạng thái Đã gọi (CALLED).';
  end if;

  update service_cases set status = 'NO_SHOW', closed_at = now() where id = p_case_id;
  select counter_id into v_counter_id from queue_tickets where id = v_ticket_id;
  update queue_tickets set status = 'NO_SHOW' where id = v_ticket_id;
  if v_counter_id is not null then
    update counters set status = 'AVAILABLE', current_agent_id = null
    where id = v_counter_id and status = 'BUSY';
  end if;
end;
$$;
revoke all on function mark_no_show(uuid) from public;
revoke execute on function mark_no_show(uuid) from anon;
grant execute on function mark_no_show(uuid) to authenticated;

create or replace view v_report_agent_performance with (security_invoker = true) as
select
  p.full_name as agent, br.branch_name as branch, dep.name as department,
  count(cs.id) as total_cases,
  count(*) filter (where cs.status in ('RESOLVED','CLOSED')) as completed_cases,
  round(avg(extract(epoch from (cs.resolved_at - cs.started_at)) / 60)
    filter (where cs.started_at is not null and cs.resolved_at is not null)) as avg_handling_time_min,
  round(100.0 * count(*) filter (where cs.status in ('RESOLVED','CLOSED') and cs.resolved_at <= cs.sla_due_at)
    / nullif(count(*) filter (where cs.status in ('RESOLVED','CLOSED') and cs.sla_due_at is not null), 0), 1) as sla_compliance_pct,
  round(100.0 * count(*) filter (
      where cs.status in ('RESOLVED','CLOSED')
        and not exists (select 1 from case_transfers ct where ct.case_id = cs.id)
    ) / nullif(count(*) filter (where cs.status in ('RESOLVED','CLOSED')), 0), 1) as fcr_pct
from service_cases cs
join profiles p on p.id = cs.assigned_agent_id
left join branches br on br.id = p.branch_id
left join departments dep on dep.id = p.department_id
group by p.full_name, br.branch_name, dep.name;
