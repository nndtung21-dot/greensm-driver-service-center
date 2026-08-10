drop view if exists v_case_detail;

create view v_case_detail with (security_invoker = true) as
select
  cs.id as case_id, cs.status, cs.description, cs.resolution, cs.internal_note,
  cs.created_at, cs.started_at, cs.resolved_at, cs.closed_at, cs.sla_due_at,
  cs.assigned_agent_id, cs.pending_reason, cs.pending_next_step, cs.pending_expected_at,
  qt.id as ticket_id, qt.ticket_code, qt.queue_number, qt.called_at,
  vi.visit_code, vi.checkin_at, br.branch_name,
  d.name as driver_name, d.sap_id, d.contract_type, d.vehicle_type,
  d.driver_code, d.app_code, d.work_status, d.account_status, d.lock_reason, d.driver_type,
  sc.name as category_name, ssc.name as subcategory_name
from service_cases cs
join queue_tickets qt on qt.id = cs.ticket_id
join visits vi on vi.id = cs.visit_id
join branches br on br.id = vi.branch_id
join drivers d on d.id = cs.driver_id
join service_categories sc on sc.id = cs.category_id
left join service_subcategories ssc on ssc.id = cs.subcategory_id;
