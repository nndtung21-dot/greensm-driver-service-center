-- 0030: v_report_agent_performance chưa từng tồn tại trên DB thật
-- (đã định nghĩa trong 0009 nhưng migration đó rõ ràng chưa apply
-- phần view này lên production). Hậu quả: trang "Hiệu suất cá nhân"
-- của agent (/agent/performance) gọi view này để lấy SLA Compliance
-- % và FCR % → 404 âm thầm → 2 chỉ số này luôn hiện "—" vĩnh viễn
-- cho MỌI agent, không ai để ý vì trang không crash.
--
-- Phát hiện khi rà log edge_logs, thấy GET v_report_agent_performance
-- trả 404. Tạo lại đúng theo định nghĩa gốc trong 0009.

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
