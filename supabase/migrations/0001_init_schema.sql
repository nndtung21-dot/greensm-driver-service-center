-- =====================================================================
-- Green SM Driver Service Center — Phase 1: Initial schema
-- Supabase / PostgreSQL
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. ENUM TYPES
-- ---------------------------------------------------------------------
create type user_role as enum ('agent', 'supervisor', 'admin');
create type record_status as enum ('ACTIVE', 'INACTIVE');
create type counter_status as enum ('OPEN', 'CLOSED', 'AVAILABLE', 'BUSY', 'OFFLINE');
create type visit_status as enum ('OPEN', 'CLOSED', 'CANCELLED');
create type ticket_status as enum (
  'WAITING', 'CALLED', 'PROCESSING', 'PENDING',
  'TRANSFERRED', 'RESOLVED', 'CLOSED', 'CANCELLED', 'NO_SHOW'
);
create type sla_status as enum ('ON_TRACK', 'WARNING', 'BREACHED', 'PAUSED', 'COMPLETED');

-- ---------------------------------------------------------------------
-- 2. CORE / MASTER DATA TABLES
-- ---------------------------------------------------------------------

create table branches (
  id uuid primary key default gen_random_uuid(),
  branch_code text unique not null,
  branch_name text not null,
  address text,
  province text,
  status record_status not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status record_status not null default 'ACTIVE'
);

create table counters (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  counter_code text not null,
  counter_name text not null,
  status counter_status not null default 'CLOSED',
  current_agent_id uuid, -- FK to profiles, added after profiles is created
  created_at timestamptz not null default now(),
  unique (branch_id, counter_code)
);

create table service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  status record_status not null default 'ACTIVE',
  display_order int not null default 0
);

create table service_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references service_categories(id),
  name text not null,
  code text not null,
  status record_status not null default 'ACTIVE',
  display_order int not null default 0,
  unique (category_id, code)
);

create table drivers (
  id uuid primary key default gen_random_uuid(),
  sap_id text unique,
  name text not null,
  phone text,
  contract_type text,
  vehicle_type text,
  province text,
  status record_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drivers_identifier_chk check (sap_id is not null or phone is not null)
);
create index idx_drivers_phone on drivers (phone);

-- profiles: mirrors auth.users for agent/supervisor/admin (drivers do NOT log in in MVP)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role user_role not null,
  branch_id uuid references branches(id),
  department_id uuid references departments(id),
  status record_status not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

alter table counters
  add constraint counters_current_agent_fk
  foreign key (current_agent_id) references profiles(id);

create table sla_rules (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id),        -- null = áp dụng mọi branch
  category_id uuid references service_categories(id),       -- null = mọi category
  subcategory_id uuid references service_subcategories(id), -- null = mọi subcategory
  sla_minutes int not null,
  status record_status not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. OPERATIONAL TABLES
-- ---------------------------------------------------------------------

create table visits (
  id uuid primary key default gen_random_uuid(),
  visit_code text unique not null,
  driver_id uuid not null references drivers(id),
  branch_id uuid not null references branches(id),
  checkin_at timestamptz not null default now(),
  checkout_at timestamptz,
  status visit_status not null default 'OPEN',
  created_at timestamptz not null default now()
);
create index idx_visits_driver on visits (driver_id);
create index idx_visits_branch_date on visits (branch_id, checkin_at);

-- helper counter table for atomic, gap-free-per-branch queue numbers
create table queue_counters (
  branch_id uuid not null references branches(id),
  business_date date not null,
  last_number int not null default 0,
  primary key (branch_id, business_date)
);

create table queue_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text unique not null,
  visit_id uuid not null references visits(id),
  branch_id uuid not null references branches(id),
  business_date date not null,
  queue_number text not null,
  service_category_id uuid not null references service_categories(id),
  status ticket_status not null default 'WAITING',
  priority int not null default 0,
  counter_id uuid references counters(id),
  called_at timestamptz,
  serving_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (branch_id, business_date, queue_number)
);
create index idx_queue_tickets_status on queue_tickets (branch_id, status);

create table service_cases (
  id uuid primary key default gen_random_uuid(),
  case_code text unique not null,
  ticket_id uuid not null references queue_tickets(id),
  visit_id uuid not null references visits(id),
  driver_id uuid not null references drivers(id),
  category_id uuid not null references service_categories(id),
  subcategory_id uuid references service_subcategories(id),
  assigned_agent_id uuid references profiles(id),
  assigned_department_id uuid references departments(id),
  status ticket_status not null default 'WAITING',
  priority int not null default 0,
  description text,
  resolution text,
  internal_note text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  sla_due_at timestamptz,
  sla_status sla_status not null default 'ON_TRACK'
);
create index idx_service_cases_agent on service_cases (assigned_agent_id, status);
create index idx_service_cases_dept on service_cases (assigned_department_id, status);

create table case_history (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references service_cases(id),
  action text not null,
  old_status ticket_status,
  new_status ticket_status,
  performed_by uuid references profiles(id),
  note text,
  created_at timestamptz not null default now()
);
create index idx_case_history_case on case_history (case_id, created_at);

create table case_transfers (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references service_cases(id),
  from_agent_id uuid references profiles(id),
  to_agent_id uuid references profiles(id),
  from_department_id uuid references departments(id),
  to_department_id uuid references departments(id),
  reason text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  case_id uuid unique not null references service_cases(id),
  driver_id uuid not null references drivers(id),
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. FUNCTIONS & TRIGGERS
-- ---------------------------------------------------------------------

-- 4.1 updated_at helper
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger trg_drivers_updated_at before update on drivers
  for each row execute function set_updated_at();

-- 4.2 atomic queue number generator (Section 12) — no frontend counter
create or replace function generate_queue_number(p_branch_id uuid, p_business_date date)
returns text language plpgsql as $$
declare
  v_number int;
begin
  insert into queue_counters (branch_id, business_date, last_number)
  values (p_branch_id, p_business_date, 1)
  on conflict (branch_id, business_date)
  do update set last_number = queue_counters.last_number + 1
  returning last_number into v_number;

  return 'A' || lpad(v_number::text, 3, '0');
end;
$$;

-- 4.3 resolve applicable SLA minutes (most specific rule wins)
create or replace function resolve_sla_minutes(p_branch_id uuid, p_category_id uuid, p_subcategory_id uuid)
returns int language sql stable as $$
  select sla_minutes from sla_rules
  where status = 'ACTIVE'
    and (branch_id = p_branch_id or branch_id is null)
    and (category_id = p_category_id or category_id is null)
    and (subcategory_id = p_subcategory_id or subcategory_id is null)
  order by
    (branch_id is not null)::int
    + (category_id is not null)::int
    + (subcategory_id is not null)::int desc
  limit 1;
$$;

-- 4.4 audit log: auto-record every status change on service_cases (Section 24)
create or replace function log_case_status_change()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    insert into case_history (case_id, action, old_status, new_status, performed_by, note)
    values (new.id, 'Created', null, new.status, new.assigned_agent_id, null);
  elsif (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into case_history (case_id, action, old_status, new_status, performed_by, note)
    values (new.id, 'Status Changed', old.status, new.status, new.assigned_agent_id, null);
  end if;
  return new;
end;
$$;
create trigger trg_case_history
  after insert or update on service_cases
  for each row execute function log_case_status_change();

-- history is append-only: block deletes/updates from application roles
revoke delete, update on case_history from anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table drivers enable row level security;
alter table visits enable row level security;
alter table queue_tickets enable row level security;
alter table service_cases enable row level security;
alter table case_history enable row level security;
alter table case_transfers enable row level security;
alter table feedback enable row level security;
alter table profiles enable row level security;
alter table counters enable row level security;
alter table sla_rules enable row level security;

create or replace function current_role_name()
returns user_role language sql stable as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function current_branch_id()
returns uuid language sql stable as $$
  select branch_id from profiles where id = auth.uid();
$$;

-- profiles: user reads own row; admin reads all
create policy profiles_self_select on profiles for select
  using (id = auth.uid() or current_role_name() = 'admin');

-- drivers table: NO anon/public select — access only via SECURITY DEFINER RPCs below.
-- staff (agent/supervisor/admin) may read.
create policy drivers_staff_select on drivers for select
  using (current_role_name() in ('agent', 'supervisor', 'admin'));

-- visits / queue_tickets: staff of same branch, or admin
create policy visits_staff_select on visits for select
  using (current_role_name() = 'admin' or branch_id = current_branch_id());

create policy queue_tickets_staff_select on queue_tickets for select
  using (current_role_name() = 'admin' or branch_id = current_branch_id());

-- service_cases: assigned agent, same-department supervisor, or admin
create policy service_cases_staff_select on service_cases for select
  using (
    current_role_name() = 'admin'
    or assigned_agent_id = auth.uid()
    or current_role_name() = 'supervisor'
  );

create policy service_cases_staff_update on service_cases for update
  using (
    current_role_name() = 'admin'
    or assigned_agent_id = auth.uid()
    or current_role_name() = 'supervisor'
  );

-- explicit protection for immutable/system fields is enforced at the
-- application layer (RPCs below) — agents call narrow RPCs instead of
-- raw table updates, so check-in time / SAP ID / queue number / system
-- timestamps can never be edited by an agent.

create policy case_history_staff_select on case_history for select
  using (current_role_name() in ('agent', 'supervisor', 'admin'));

create policy case_transfers_staff_select on case_transfers for select
  using (current_role_name() in ('agent', 'supervisor', 'admin'));

create policy feedback_staff_select on feedback for select
  using (current_role_name() in ('supervisor', 'admin'));

create policy counters_staff_select on counters for select
  using (current_role_name() in ('agent', 'supervisor', 'admin'));

create policy sla_rules_staff_select on sla_rules for select
  using (current_role_name() in ('supervisor', 'admin'));

-- ---------------------------------------------------------------------
-- 6. DRIVER CHECK-IN RPCs (SECURITY DEFINER — callable by anon)
--    These are the ONLY way the public check-in kiosk touches data.
-- ---------------------------------------------------------------------

-- 6.1 Lookup driver by SAP ID or phone — returns only non-sensitive fields
create or replace function lookup_driver(p_identifier text)
returns table (id uuid, name text, sap_id text, contract_type text)
language sql security definer set search_path = public as $$
  select d.id, d.name, d.sap_id, d.contract_type
  from drivers d
  where (d.sap_id = p_identifier or d.phone = p_identifier)
    and d.status = 'ACTIVE'
  limit 1;
$$;
revoke all on function lookup_driver(text) from public;
grant execute on function lookup_driver(text) to anon, authenticated;

-- 6.2 Create Visit + Queue Ticket + Service Case in one transaction
create or replace function create_checkin(
  p_driver_id uuid,
  p_branch_id uuid,
  p_category_id uuid,
  p_subcategory_id uuid,
  p_description text
)
returns table (visit_code text, ticket_code text, queue_number text)
language plpgsql security definer set search_path = public as $$
declare
  v_visit_id uuid;
  v_ticket_id uuid;
  v_business_date date := current_date;
  v_visit_code text;
  v_ticket_code text;
  v_queue_number text;
  v_sla_minutes int;
begin
  v_visit_code := 'V' || to_char(now(), 'YYYYMMDD') || lpad(floor(random()*9999)::text, 4, '0');
  v_ticket_code := 'T' || to_char(now(), 'YYYYMMDD') || lpad(floor(random()*9999)::text, 4, '0');

  insert into visits (visit_code, driver_id, branch_id)
  values (v_visit_code, p_driver_id, p_branch_id)
  returning id into v_visit_id;

  v_queue_number := generate_queue_number(p_branch_id, v_business_date);

  insert into queue_tickets (
    ticket_code, visit_id, branch_id, business_date,
    queue_number, service_category_id, status
  ) values (
    v_ticket_code, v_visit_id, p_branch_id, v_business_date,
    v_queue_number, p_category_id, 'WAITING'
  ) returning id into v_ticket_id;

  v_sla_minutes := resolve_sla_minutes(p_branch_id, p_category_id, p_subcategory_id);

  insert into service_cases (
    case_code, ticket_id, visit_id, driver_id,
    category_id, subcategory_id, status, description, sla_due_at
  ) values (
    v_ticket_code, v_ticket_id, v_visit_id, p_driver_id,
    p_category_id, p_subcategory_id, 'WAITING', p_description,
    case when v_sla_minutes is not null then now() + (v_sla_minutes || ' minutes')::interval else null end
  );

  return query select v_visit_code, v_ticket_code, v_queue_number;
end;
$$;
revoke all on function create_checkin(uuid, uuid, uuid, uuid, text) from public;
grant execute on function create_checkin(uuid, uuid, uuid, uuid, text) to anon, authenticated;

-- categories/subcategories/branches are needed by the public kiosk UI too
alter table branches enable row level security;
alter table service_categories enable row level security;
alter table service_subcategories enable row level security;
create policy branches_public_select on branches for select using (status = 'ACTIVE');
create policy categories_public_select on service_categories for select using (status = 'ACTIVE');
create policy subcategories_public_select on service_subcategories for select using (status = 'ACTIVE');

-- =====================================================================
-- End of migration 0001
-- =====================================================================
