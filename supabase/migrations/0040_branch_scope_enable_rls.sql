-- 0040: Thu hồi quyền thừa và BẬT RLS (bước 3/4).
-- Đã kiểm tra trước bằng giao dịch tự hoàn tác, giả lập super admin, admin HN, admin HCM,
-- agent HCM, agent HN và người chưa đăng nhập (đọc, ghi và các RPC kiosk/QR/TV).
set local lock_timeout = '5s';

revoke all on all tables in schema public from anon;
grant select on public.branches, public.service_categories, public.service_subcategories to anon;
alter default privileges in schema public revoke all on tables from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;

-- Không FORCE: các hàm RPC SECURITY DEFINER (chủ sở hữu postgres, BYPASSRLS) chạy như cũ.
alter table public.agent_category_assignments enable row level security;
alter table public.branches                   enable row level security;
alter table public.case_history               enable row level security;
alter table public.case_transfers             enable row level security;
alter table public.counters                   enable row level security;
alter table public.departments                enable row level security;
alter table public.drivers                    enable row level security;
alter table public.feedback                   enable row level security;
alter table public.profiles                   enable row level security;
alter table public.queue_counters             enable row level security;
alter table public.queue_tickets              enable row level security;
alter table public.service_cases              enable row level security;
alter table public.service_categories         enable row level security;
alter table public.service_subcategories      enable row level security;
alter table public.sla_rules                  enable row level security;
alter table public.tickets                    enable row level security;
alter table public.visits                     enable row level security;
