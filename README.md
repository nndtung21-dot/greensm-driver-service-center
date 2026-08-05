# Green SM Driver Service Center — Driver Check-in (Phase 2)

Kiosk/tablet check-in flow: Section 5–11 của master prompt.
`.env.local` đã được điền sẵn với project Supabase bạn cung cấp
(`krcqwzffwpylhjkdqhwn`), dùng **anon key** (an toàn cho browser, được
bảo vệ bởi RLS) — **không** phải service role key.

## ⚠️ Bước bắt buộc trước tiên: áp dụng schema

Claude chạy trong sandbox không có quyền truy cập mạng ra ngoài tới
`supabase.com`, nên **chưa** tự động apply được migration
`supabase/migrations/0001_init_schema.sql` vào project thật của bạn.
Chọn 1 trong 2 cách:

**Cách A — SQL Editor (nhanh nhất):**
1. Mở [Supabase SQL Editor](https://supabase.com/dashboard/project/krcqwzffwpylhjkdqhwn/sql/new)
2. Dán toàn bộ nội dung file `supabase/migrations/0001_init_schema.sql`
3. Run

**Cách B — Supabase CLI (khuyến nghị cho lâu dài, giữ lịch sử migration):**
```bash
npm install -g supabase
supabase login
supabase link --project-ref krcqwzffwpylhjkdqhwn
supabase db push
```

Sau khi chạy xong, bạn cần **thêm dữ liệu tối thiểu** để test được (branch,
category, subcategory, và ít nhất 1 driver) — xem mục "Dữ liệu để test" bên dưới.

## Chạy ứng dụng

```bash
npm install
npm run dev
```
Mở http://localhost:3000 → tự chuyển đến `/checkin`.

## Dữ liệu tối thiểu để test (chạy trong SQL Editor sau khi có schema)

```sql
insert into branches (branch_code, branch_name, province)
values ('HCM01', 'Green SM - VP Quận 7', 'TP.HCM');

insert into service_categories (name, code, display_order) values
  ('Tài chính', 'FINANCE', 1),
  ('Xe / Pin / Sạc', 'VEHICLE', 2);

insert into service_subcategories (category_id, name, code, display_order)
select id, 'Đối soát thu nhập', 'RECONCILE', 1 from service_categories where code = 'FINANCE';

insert into drivers (sap_id, name, phone, contract_type)
values ('123456', 'Nguyễn Văn A', '0900000000', 'Full-time');

insert into sla_rules (category_id, sla_minutes)
select id, 30 from service_categories where code = 'FINANCE';
```

Sau đó set `NEXT_PUBLIC_KIOSK_BRANCH_CODE=HCM01` trong `.env.local` (hoặc để
trống nếu bạn muốn test màn hình chọn VP).

## Cấu trúc

```
src/
  app/
    layout.tsx        # font + shell
    page.tsx           # redirect -> /checkin
    checkin/page.tsx    # entry point kiosk
    globals.css
  components/driver/
    ui.tsx              # KioskButton, StepCard (atoms dùng lại mọi bước)
    steps.tsx           # từng màn hình: Welcome, Identify, Category...
    CheckinFlow.tsx     # state machine điều phối toàn bộ luồng + gọi Supabase
  lib/
    supabase/client.ts  # anon client — KHÔNG bao giờ thêm service role key
    types.ts
supabase/migrations/
  0001_init_schema.sql  # đã tạo ở bước trước
```

## Thiết kế
Bảng màu xanh đậm (`brand-900 #06402B` / `brand-700 #0B6E4F`) trên nền trắng/mint
nhạt, phông chữ Manrope (tiêu đề) + Inter (nội dung, hỗ trợ tốt dấu tiếng Việt).
Mỗi màn hình chỉ có 1 hành động chính, nút lớn (tối thiểu ~88px cao) cho màn
hình cảm ứng. Điểm nhấn duy nhất là màn hình "Số của bạn" — số thứ tự hiện lớn
trên nền mint, gợi liên tưởng tấm vé giấy tại quầy dịch vụ ngân hàng/sân bay.

## Phase 3 — Agent Portal (đã xong)

Truy cập: `/agent/login`

**Tài khoản demo** (đã tạo sẵn trên project Supabase của bạn — **đổi/xoá trước khi
giao cho nhân viên thật**, xem `docs/demo-data.md`):

| Email | Vai trò | VP | Bộ phận |
|---|---|---|---|
| agent1.demo@greensm.internal | agent | HCM01 | Vận hành |
| agent2.demo@greensm.internal | agent | HCM01 | Tài chính |
| agent3.demo@greensm.internal | agent | HCM01 | Xe / Pin / Sạc |
| agent4.demo@greensm.internal | agent | HAN01 | Vận hành |
| agent5.demo@greensm.internal | agent | HAN01 | Tài chính |
| supervisor1.demo@greensm.internal | supervisor | HCM01 | — |
| supervisor2.demo@greensm.internal | supervisor | HAN01 | — |

Mật khẩu chung (demo): `GreenSM#Demo2026`

**Chức năng đã có** (Section 13-21):
- `/agent/queue` — stat cards (Waiting/Processing/Pending/Over SLA/Completed Today),
  bảng queue realtime, nút "GỌI TIẾP THEO" + "Gọi" từng dòng.
- `/agent/ticket/[case_id]` — thông tin tài xế/Visit/yêu cầu, timeline lịch sử,
  Bắt đầu xử lý → Resolve (kết quả + ghi chú nội bộ) → Đóng ticket.
- `/agent/performance` — số ticket đã xử lý/hoàn thành, Avg. Handling Time thật
  (SLA Compliance/FCR/CSAT chờ Phase 5 & 7).

**Đã kiểm chứng bằng RLS thật** (không phải quyền admin): Agent VP nào chỉ thấy
ticket của VP đó, không thấy VP khác; agent không assigned không resolve được
case của agent khác; anon key (kiosk) không đọc được dữ liệu Agent Portal.

**Bảo mật quan trọng đã phát hiện & sửa trong quá trình build:** Supabase tự động
cấp quyền EXECUTE cho `anon` trên MỌI function mới tạo (default privilege), kể cả
khi mình chỉ `grant ... to authenticated`. Phải luôn `revoke execute ... from anon`
tường minh cho mọi RPC không dành cho kiosk công khai — đã áp dụng cho 5 RPC của
Agent Portal.

## Chưa làm (Phase 4-8 tiếp theo)
TV Display, Transfer/Pending (form + SLA pause), Supervisor Dashboard,
Feedback/CSAT, Google Sheets export.

## Phase 4 — TV Display
`/tv/[branchCode]` (vd: `/tv/HCM01`) — public, không cần đăng nhập, chữ cực lớn,
realtime qua Supabase Realtime + fallback poll 15s, đọc dữ liệu qua 2 RPC public
`tv_now_serving`/`tv_waiting_count` (không lộ tên/SAP ID tài xế). Có phát âm
thanh bằng Web Speech API khi có số mới.

## Phase 5 — Transfer / Pending / SLA pause
Trên `/agent/ticket/[id]`, khi status = PROCESSING có thêm 2 nút: "Đặt Pending"
(bắt buộc lý do + bước tiếp theo) và "Chuyển ticket" (chọn bộ phận + agent tuỳ
chọn + lý do). SLA tự pause khi Pending và cộng bù lại thời gian khi tiếp tục
xử lý (`sla_paused_at`). Ticket được transfer sang bộ phận (chưa chỉ định agent)
sẽ được Agent đầu tiên bấm "Bắt đầu xử lý" tự nhận.

## Phase 6 — Supervisor Dashboard
`/supervisor/dashboard` (đăng nhập qua `/agent/login`, tự chuyển hướng theo vai
trò). KPI realtime (Visits/Drivers/Tickets/Completed/Waiting/Processing/
Pending/Over SLA/Avg Waiting/Avg Handling/SLA Compliance/CSAT), quản lý mở/đóng
quầy, bảng ticket toàn VP kèm Reassign. Supervisor chỉ thấy đúng VP mình phụ
trách (đã kiểm chứng bằng RLS thật).

## Phase 7 — Feedback/CSAT
`/feedback/[ticketCode]` — tài xế tự tra cứu bằng mã ticket (in trên màn hình
check-in thành công), đánh giá 1-5 sao + nhận xét, không cần đăng nhập, mỗi
ticket chỉ đánh giá được 1 lần.

## Phase 8 — Google Sheets Export
Đã có sẵn 5 view báo cáo (`v_report_visit_log`, `v_report_case_log`,
`v_report_agent_performance`, `v_report_daily_summary`, `v_report_feedback`) và
Edge Function `supabase/functions/sheets-sync/index.ts` đọc các view này rồi
ghi sang Google Sheets qua Service Account. **Cần bạn tự làm 3 bước** (không thể
làm thay vì cần tài khoản Google của bạn):

1. Tạo Service Account trên Google Cloud Console, bật Google Sheets API, tải
   file JSON key.
2. Mở Google Sheet đích, "Share" cho email của Service Account (quyền Editor).
   Copy Sheet ID từ URL (`.../d/<SHEET_ID>/edit`).
3. Deploy + cấu hình secrets:
   ```bash
   supabase functions deploy sheets-sync
   supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"
   supabase secrets set GOOGLE_SHEET_ID="<SHEET_ID>"
   ```
4. Lên lịch chạy: vào Supabase Dashboard → Edge Functions → Cron (hoặc dùng
   `pg_cron` + `pg_net` gọi HTTP đến function theo lịch bạn muốn, ví dụ mỗi giờ).

Test thủ công bằng cách gọi URL function 1 lần (`https://<project>.functions.supabase.co/sheets-sync`)
và kiểm tra Google Sheet có 5 tab tương ứng chưa.

## Bảo mật cần bạn tự bật thêm (không sửa được qua SQL)
Supabase Dashboard → Authentication → Policies/Settings → bật **"Leaked
Password Protection"** (kiểm tra mật khẩu qua HaveIBeenPwned) — advisor gợi ý,
áp dụng cho mọi tài khoản Agent/Supervisor/Admin.

## Nhật ký lỗi đã sửa
Xem `docs/security-fixes-log.md` — toàn bộ lỗi RLS/quyền đã phát hiện và sửa
trong quá trình build, để minh bạch và tránh lặp lại khi bạn tự mở rộng thêm.

## Phase 9 — Admin UI (bổ sung ngoài 8 Phase gốc)
Truy cập qua `/agent/login` với tài khoản vai trò `admin` (demo:
`admin.demo@greensm.internal` / `GreenSM#Demo2026`).

- **`/admin/agents`** — gán Agent phụ trách chủ đề (category) nào (many-to-many,
  hiện chỉ mang tính tổ chức, chưa dùng để giới hạn "Gọi tiếp theo").
- **`/admin/categories`** — thêm/tắt category và subcategory.
- **`/admin/branches`** — thêm VP mới, thêm quầy cho từng VP.
- **`/admin/sla`** — thêm/tắt rule SLA theo VP/category/subcategory.
- **`/admin/users`** — sửa vai trò/VP/bộ phận của nhân viên hiện có, và gán vai
  trò cho tài khoản vừa tạo bên Supabase Dashboard (Authentication → Users)
  nhưng chưa có profile.
- **`/admin/export`** — xuất 5 dataset báo cáo ra file CSV trực tiếp từ trình
  duyệt (mở được bằng Excel/Google Sheets), không cần chờ tích hợp Google
  Sheets tự động ở Phase 8.

Toàn bộ CRUD này dùng RLS `admin`-only trực tiếp trên bảng (không qua RPC) vì
là thao tác đơn giản, đã test bằng role `authenticated` thật để đảm bảo Agent/
Supervisor không tự ý sửa được.

## Phase 9b — NO_SHOW & FCR
- Agent có thêm nút **"Tài xế không đến (NO_SHOW)"** khi ticket đang ở trạng
  thái CALLED (Section 19 đã liệt kê trạng thái này nhưng trước đó chưa có
  thao tác).
- **FCR (First Contact Resolution)** được định nghĩa là: tỉ lệ ticket hoàn
  thành mà KHÔNG từng bị Transfer sang bộ phận/agent khác. Hiển thị ở trang
  Hiệu suất của Agent và Supervisor Dashboard. Đây là định nghĩa mặc định hợp
  lý — nếu công ty có định nghĩa FCR khác, cần chỉnh lại view
  `v_report_agent_performance`.
