-- 0038: Nền tảng phân quyền theo văn phòng (bước 1/4). Chưa bật RLS nên không đổi hành vi.
--
-- Bối cảnh: toàn bộ bảng public đang tắt RLS và role anon được cấp đủ quyền
-- đọc/ghi/xoá, nên bất kỳ ai có khoá anon (nằm công khai trong mã nguồn web) đọc
-- được cả danh sách tài xế, vé, hồ sơ nhân viên, đánh giá. Admin của văn phòng
-- này cũng thấy toàn bộ vé và quầy của văn phòng khác.
--
-- Mô hình: mỗi tài khoản thuộc 1 văn phòng (profiles.branch_id). Riêng tài khoản
-- admin có cờ all_branches (super admin) xem được tất cả văn phòng.

alter table public.profiles add column if not exists all_branches boolean not null default false;
update public.profiles set all_branches = true where lower(email) = 'v.tungnnd@greensm.com';

-- service_cases.branch_id: lọc theo văn phòng nhanh, dùng được cho realtime
alter table public.service_cases add column if not exists branch_id uuid;
update public.service_cases cs set branch_id = qt.branch_id
from public.queue_tickets qt where qt.id = cs.ticket_id and cs.branch_id is null;

create or replace function public.service_cases_set_branch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null then
    select qt.branch_id into new.branch_id from public.queue_tickets qt where qt.id = new.ticket_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_service_cases_set_branch on public.service_cases;
create trigger trg_service_cases_set_branch before insert on public.service_cases
  for each row execute function public.service_cases_set_branch();

-- Chạy riêng ngoài transaction (CREATE INDEX CONCURRENTLY không chạy trong transaction):
--   create index concurrently if not exists service_cases_branch_id_idx on public.service_cases (branch_id);

-- Hàm kiểm tra quyền (chỉ tính tài khoản ACTIVE)
create or replace function public.active_role()
returns text language sql stable security definer set search_path = public as $$
  select p.role::text from public.profiles p where p.id = (select auth.uid()) and p.status = 'ACTIVE';
$$;

create or replace function public.active_branch()
returns uuid language sql stable security definer set search_path = public as $$
  select p.branch_id from public.profiles p where p.id = (select auth.uid()) and p.status = 'ACTIVE';
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.all_branches and p.role = 'admin' from public.profiles p
                   where p.id = (select auth.uid()) and p.status = 'ACTIVE'), false);
$$;

create or replace function public.can_access_branch(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or (p_branch is not null and p_branch = public.active_branch());
$$;

revoke all on function public.active_role(), public.active_branch(), public.is_super_admin(), public.can_access_branch(uuid) from public;
grant execute on function public.active_role(), public.active_branch(), public.is_super_admin(), public.can_access_branch(uuid) to anon, authenticated;
