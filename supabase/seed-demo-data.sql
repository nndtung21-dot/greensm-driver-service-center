-- =====================================================================
-- Seed: config thật + dữ liệu demo (Section 35)
-- Chạy 1 lần sau khi đã apply hết migrations 0001-0007.
-- =====================================================================

-- ---- Config thật (giữ lại cho production) ----
insert into departments (name) values
  ('Vận hành'), ('Tài chính'), ('Xe / Pin / Sạc'), ('Hợp đồng'), ('Tài khoản / App'), ('Khiếu nại')
on conflict do nothing;

insert into service_categories (name, code, display_order) values
  ('Vận hành', 'OPERATIONS', 1), ('Tài chính', 'FINANCE', 2), ('Xe / Pin / Sạc', 'VEHICLE', 3),
  ('Hợp đồng', 'CONTRACT', 4), ('Tài khoản / App', 'ACCOUNT', 5), ('Khiếu nại', 'COMPLAINT', 6), ('Khác', 'OTHER', 7)
on conflict (code) do nothing;

insert into service_subcategories (category_id, name, code, display_order)
select id, v.name, v.code, v.ord from service_categories,
  (values ('Vấn đề chuyến','TRIP_ISSUE',1),('Vấn đề App','APP_ISSUE',2),('Vấn đề vận hành','OPS_ISSUE',3),
          ('Trạng thái tài khoản','ACCOUNT_STATUS',4),('Khác','OTHER',5)) as v(name, code, ord)
where service_categories.code = 'OPERATIONS' on conflict (category_id, code) do nothing;

insert into service_subcategories (category_id, name, code, display_order)
select id, v.name, v.code, v.ord from service_categories,
  (values ('Đối soát thu nhập','RECONCILE',1),('Thanh toán','PAYMENT',2),('Thưởng','BONUS',3),
          ('Phạt / Khấu trừ','PENALTY',4),('Khác','OTHER',5)) as v(name, code, ord)
where service_categories.code = 'FINANCE' on conflict (category_id, code) do nothing;

insert into service_subcategories (category_id, name, code, display_order)
select id, v.name, v.code, v.ord from service_categories,
  (values ('Vấn đề xe','VEHICLE_ISSUE',1),('Pin','BATTERY',2),('Sạc','CHARGING',3),
          ('Bảo dưỡng','MAINTENANCE',4),('Đổi xe','SWAP',5),('Khác','OTHER',6)) as v(name, code, ord)
where service_categories.code = 'VEHICLE' on conflict (category_id, code) do nothing;

insert into service_subcategories (category_id, name, code, display_order)
select id, 'Khác', 'OTHER', 1 from service_categories
where code in ('CONTRACT','ACCOUNT','COMPLAINT','OTHER') on conflict (category_id, code) do nothing;

insert into sla_rules (category_id, sla_minutes)
select id, 30 from service_categories where code = 'OPERATIONS'
union all select id, 30 from service_categories where code = 'FINANCE'
union all select id, 60 from service_categories where code = 'VEHICLE'
union all select id, 30 from service_categories where code = 'COMPLAINT';
insert into sla_rules (sla_minutes) values (45);

-- ---- Dữ liệu demo (is_demo = true, xoá bằng docs/demo-data.md trước production) ----
insert into branches (branch_code, branch_name, province, is_demo) values
  ('HCM01', 'Green SM - VP Quận 7 (Demo)', 'TP.HCM', true),
  ('HAN01', 'Green SM - VP Cầu Giấy (Demo)', 'Hà Nội', true)
on conflict (branch_code) do nothing;

insert into counters (branch_id, counter_code, counter_name, status)
select b.id, c.code, c.name, 'CLOSED' from branches b,
  (values ('01','Quầy 01'),('02','Quầy 02'),('03','Quầy 03')) as c(code,name)
where b.branch_code = 'HCM01' on conflict (branch_id, counter_code) do nothing;

insert into counters (branch_id, counter_code, counter_name, status)
select b.id, c.code, c.name, 'CLOSED' from branches b,
  (values ('01','Quầy 01'),('02','Quầy 02')) as c(code,name)
where b.branch_code = 'HAN01' on conflict (branch_id, counter_code) do nothing;

insert into drivers (sap_id, name, phone, contract_type, vehicle_type, province, is_demo)
select 'DEMO' || lpad(g::text,4,'0'), 'Tài xế Demo ' || lpad(g::text,2,'0'),
  '09' || lpad((10000000 + g)::text, 8, '0'),
  case when g % 3 = 0 then 'Part-time' else 'Full-time' end,
  case when g % 2 = 0 then 'Xe máy điện' else 'Ô tô điện' end,
  case when g % 2 = 0 then 'TP.HCM' else 'Hà Nội' end, true
from generate_series(1,20) as g on conflict (sap_id) do nothing;

-- 30 visit + queue_ticket + service_case demo, trải nhiều trạng thái khác nhau
do $$
declare
  v_driver_ids uuid[]; v_branch_hcm uuid; v_branch_han uuid; v_cat_ids uuid[];
  i int; v_driver uuid; v_branch uuid; v_cat uuid; v_sub uuid;
  v_visit_id uuid; v_ticket_id uuid; v_queue_number text; v_status ticket_status;
  v_created timestamptz; v_sla_min int;
  statuses ticket_status[] := array['WAITING','CALLED','PROCESSING','PENDING','RESOLVED','CLOSED','RESOLVED','CLOSED','WAITING','CALLED'];
begin
  select array_agg(id) into v_driver_ids from drivers where is_demo = true;
  select id into v_branch_hcm from branches where branch_code = 'HCM01';
  select id into v_branch_han from branches where branch_code = 'HAN01';
  select array_agg(id order by display_order) into v_cat_ids from service_categories where code <> 'OTHER';

  for i in 1..30 loop
    v_driver := v_driver_ids[1 + ((i-1) % array_length(v_driver_ids,1))];
    v_branch := case when i % 2 = 0 then v_branch_hcm else v_branch_han end;
    v_cat := v_cat_ids[1 + ((i-1) % array_length(v_cat_ids,1))];
    select id into v_sub from service_subcategories where category_id = v_cat order by random() limit 1;
    v_status := statuses[1 + ((i-1) % array_length(statuses,1))];
    v_created := now() - (floor(random()*180)::int || ' minutes')::interval;

    insert into visits (visit_code, driver_id, branch_id, checkin_at)
    values ('V' || to_char(v_created,'YYYYMMDD') || lpad(i::text,4,'0'), v_driver, v_branch, v_created)
    returning id into v_visit_id;

    v_queue_number := generate_queue_number(v_branch, v_created::date);

    insert into queue_tickets (ticket_code, visit_id, branch_id, business_date, queue_number,
      service_category_id, status, created_at, called_at, serving_at, completed_at)
    values ('T' || to_char(v_created,'YYYYMMDD') || lpad(i::text,4,'0'), v_visit_id, v_branch,
      v_created::date, v_queue_number, v_cat, v_status, v_created,
      case when v_status in ('CALLED','PROCESSING','PENDING','RESOLVED','CLOSED') then v_created + interval '3 minutes' else null end,
      case when v_status in ('PROCESSING','PENDING','RESOLVED','CLOSED') then v_created + interval '5 minutes' else null end,
      case when v_status in ('RESOLVED','CLOSED') then v_created + interval '15 minutes' else null end
    ) returning id into v_ticket_id;

    v_sla_min := resolve_sla_minutes(v_branch, v_cat, v_sub);

    insert into service_cases (case_code, ticket_id, visit_id, driver_id, category_id, subcategory_id,
      status, description, resolution, created_at, started_at, resolved_at, closed_at, sla_due_at)
    values ('T' || to_char(v_created,'YYYYMMDD') || lpad(i::text,4,'0'), v_ticket_id, v_visit_id, v_driver,
      v_cat, v_sub, v_status, 'Yêu cầu demo #' || i,
      case when v_status in ('RESOLVED','CLOSED') then 'Đã xử lý xong (dữ liệu demo).' else null end,
      v_created,
      case when v_status in ('PROCESSING','PENDING','RESOLVED','CLOSED') then v_created + interval '5 minutes' else null end,
      case when v_status in ('RESOLVED','CLOSED') then v_created + interval '15 minutes' else null end,
      case when v_status = 'CLOSED' then v_created + interval '20 minutes' else null end,
      case when v_sla_min is not null then v_created + (v_sla_min || ' minutes')::interval else null end
    );
  end loop;
end $$;
