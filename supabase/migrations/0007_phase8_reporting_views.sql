-- =====================================================================
-- Phase 8: Reporting views — nền tảng cho Google Sheets Export (Section 31)
-- =====================================================================

create or replace view v_report_visit_log with (security_invoker = true) as
select
  vi.visit_code as visit_id, br.branch_name as branch, d.sap_id, d.name as driver_name,
  vi.checkin_at as check_in, vi.checkout_at as checkout,
  sc.name as category, qt.queue_number, qt.status
from visits vi
join branches br on br.id = vi.branch_id
join drivers d on d.id = vi.driver_id
left join queue_tickets qt on qt.visit_id = vi.id
left join service_categories sc on sc.id = qt.service_category_id;

create or replace view v_report_case_log with (security_invoker = true) as
select
  cs.case_code as case_id, qt.ticket_code as ticket_id, d.sap_id, br.branch_name as branch,
  sc.name as category, ssc.name as subcategory, p.full_name as agent, dep.name as department,
  cs.status, vi.checkin_at as check_in, qt.called_at, cs.started_at, cs.resolved_at, cs.closed_at,
  round(extract(epoch from (coalesce(qt.called_at, now()) - vi.checkin_at)) / 60) as waiting_time_min,
  case when cs.started_at is not null
    then round(extract(epoch from (coalesce(cs.resolved_at, now()) - cs.started_at)) / 60)
    else null end as handling_time_min,
  case
    when cs.status in ('RESOLVED','CLOSED') then 'COMPLETED'
    when cs.status = 'PENDING' then 'PAUSED'
    when cs.sla_due_at is null then 'N/A'
    when cs.sla_due_at < now() then 'BREACHED'
    when cs.sla_due_at < now() + (0.2 * extract(epoch from (cs.sla_due_at - cs.created_at)) * interval '1 second') then 'WARNING'
    else 'ON_TRACK'
  end as sla_status,
  cs.resolution
from service_cases cs
join queue_tickets qt on qt.id = cs.ticket_id
join visits vi on vi.id = cs.visit_id
join branches br on br.id = vi.branch_id
join drivers d on d.id = cs.driver_id
join service_categories sc on sc.id = cs.category_id
left join service_subcategories ssc on ssc.id = cs.subcategory_id
left join profiles p on p.id = cs.assigned_agent_id
left join departments dep on dep.id = cs.assigned_department_id;

create or replace view v_report_agent_performance with (security_invoker = true) as
select
  p.full_name as agent, br.branch_name as branch, dep.name as department,
  count(cs.id) as total_cases,
  count(*) filter (where cs.status in ('RESOLVED','CLOSED')) as completed_cases,
  round(avg(extract(epoch from (cs.resolved_at - cs.started_at)) / 60)
    filter (where cs.started_at is not null and cs.resolved_at is not null)) as avg_handling_time_min,
  round(100.0 * count(*) filter (where cs.status in ('RESOLVED','CLOSED') and cs.resolved_at <= cs.sla_due_at)
    / nullif(count(*) filter (where cs.status in ('RESOLVED','CLOSED') and cs.sla_due_at is not null), 0), 1) as sla_compliance_pct
from service_cases cs
join profiles p on p.id = cs.assigned_agent_id
left join branches br on br.id = p.branch_id
left join departments dep on dep.id = p.department_id
group by p.full_name, br.branch_name, dep.name;

create or replace view v_report_daily_summary with (security_invoker = true) as
select
  br.branch_name as branch, qt.business_date,
  count(distinct vi.id) as total_visits,
  count(distinct vi.driver_id) as unique_drivers,
  count(qt.id) as total_tickets,
  count(*) filter (where qt.status in ('RESOLVED','CLOSED')) as completed_tickets,
  round(avg(extract(epoch from (qt.called_at - vi.checkin_at)) / 60) filter (where qt.called_at is not null)) as avg_waiting_time_min,
  round(avg(extract(epoch from (qt.completed_at - qt.serving_at)) / 60) filter (where qt.completed_at is not null and qt.serving_at is not null)) as avg_handling_time_min
from queue_tickets qt
join visits vi on vi.id = qt.visit_id
join branches br on br.id = qt.branch_id
group by br.branch_name, qt.business_date;

create or replace view v_report_feedback with (security_invoker = true) as
select
  cs.case_code as case_id, d.name as driver_name, br.branch_name as branch,
  f.rating, f.comment, f.created_at
from feedback f
join service_cases cs on cs.id = f.case_id
join drivers d on d.id = f.driver_id
join queue_tickets qt on qt.id = cs.ticket_id
join branches br on br.id = qt.branch_id;
