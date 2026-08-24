# Nhật ký lỗi đã phát hiện & sửa trong quá trình build

Ghi lại minh bạch để bạn biết chính xác đã có những gì sai và đã sửa ra sao —
đúng yêu cầu "báo cáo những file/database/function đã thay đổi" (Section 38).

| # | Lỗi | Phát hiện ở | Cách sửa |
|---|---|---|---|
| 1 | `departments`, `queue_counters` thiếu RLS (Supabase security advisor tự phát hiện) | Ngay sau khi apply schema gốc | Bật RLS, thêm policy đọc cho staff |
| 2 | Function nội bộ không pin `search_path` → rủi ro search_path hijacking | Security advisor | Thêm `SET search_path = public` cho mọi function |
| 3 | Supabase tự cấp quyền `EXECUTE` cho `anon` trên MỌI function mới tạo (default privilege), kể cả khi chỉ `grant ... to authenticated` | Kiểm tra thủ công bằng `has_function_privilege` sau khi tạo RPC Agent Portal | `revoke execute ... from anon` tường minh cho mọi RPC không dành cho kiosk công khai |
| 4 | Agent không thấy được ticket WAITING chưa ai nhận trong VP mình (chỉ thấy ticket đã gán cho họ) | Test bằng role `authenticated` thật (không phải quyền admin) | Sửa `service_cases_staff_select` để Agent thấy toàn bộ case trong VP |
| 5 | Supervisor thấy được ticket của MỌI VP thay vì chỉ VP mình phụ trách | Rà soát trước khi build Supervisor Dashboard | Thêm điều kiện branch-scoping vào policy |
| 6 | `reassign_case`, `set_counter_status` không kiểm tra Supervisor có đúng VP hay không | Rà soát cùng lúc với #5 | Thêm kiểm tra branch trong RPC |
| 7 | **Đệ quy vô hạn RLS** ("stack depth limit exceeded"): sau khi bảng `profiles` có 2 policy SELECT trở lên, `current_role_name()`/`current_branch_id()` (chạy dưới quyền người gọi) tự gọi lại chính nó | Test trực tiếp RPC `set_case_pending` bằng role thật | Chuyển 2 hàm này sang `SECURITY DEFINER` — mẫu chuẩn cho hàm "tra cứu quyền của chính mình" |
| 8 | Khi Transfer ticket sang **bộ phận** (không chỉ định Agent cụ thể), không Agent nào claim được vì `start_processing` yêu cầu đúng `assigned_agent_id` | Test luồng Transfer end-to-end | Agent đầu tiên bấm "Bắt đầu xử lý" sẽ tự nhận ticket nếu `assigned_agent_id` đang NULL |
| 9 | **`call_next_ticket()` gãy hoàn toàn** (0015): join `queue_tickets` với `counters` qua `qt.counter_id`, nhưng ticket ở trạng thái WAITING không bao giờ có `counter_id` (chỉ set khi CALLED) → INNER JOIN loại sạch mọi ticket đang chờ → Agent luôn nhận "Không còn tài xế nào đang chờ" dù hàng chờ có người | Rà soát code theo yêu cầu người dùng (không phải test thủ công — lỗi logic phát hiện qua đọc SQL) | 0016: xác định ticket "thuộc" Agent qua `service_cases.assigned_agent_id` (đã gán lúc check-in), không qua `counter_id` của ticket; quầy chỉ chọn sau khi đã có ticket. Đồng bộ luôn `call_specific_ticket()` để nhất quán quy tắc "Agent chỉ dùng quầy mặc định của mình" |
| 10 | `create_checkin()` không chặn tài xế check-in khi đang có ticket chưa hoàn tất, dù front-end đã có sẵn logic hiển thị lỗi này | Rà soát code | 0016: thêm kiểm tra `exists (... status in (WAITING,CALLED,PROCESSING,PENDING,TRANSFERRED))` trước khi tạo visit/ticket mới |
| 11 | `visit_code`/`ticket_code` sinh từ `random()*9999` (chỉ 10.000 tổ hợp/ngày) trong khi có `unique` constraint → theo bài toán ngày sinh, xác suất trùng đáng kể chỉ với vài chục lượt/ngày, gây lỗi `duplicate key` làm sập lượt check-in đó | Rà soát code | 0016: ghép mã từ `branch_code + ngày + queue_number` (đã atomic/unique tuyệt đối nhờ `generate_queue_number`) — loại bỏ hoàn toàn phụ thuộc `random()` |
| 12 | `.env.local` (chứa anon key + URL project — không phải service role key) bị track nhầm vào git trước khi `.gitignore` có rule `.env*.local` | Rà soát repo | `git rm --cached .env.local`; file vẫn còn trên máy để chạy local, chỉ ngừng theo dõi trong git |
| 13 | `/api/admin/create-user` chấp nhận mật khẩu 6 ký tự và không kiểm tra định dạng email | Rà soát code | Nâng tối thiểu lên 8 ký tự, thêm kiểm tra regex email cơ bản |
| 14 | Edge Function `sheets-sync` không có lớp xác thực nào trong thân hàm — nếu deploy với `--no-verify-jwt` (thường cần để chạy theo lịch/cron), bất kỳ ai biết URL function đều gọi được | Rà soát code | Thêm kiểm tra secret dùng chung tuỳ chọn (`CRON_SHARED_SECRET` qua header `x-cron-secret`), chỉ có hiệu lực nếu bạn tự set secret này |

**Bài học rút ra cho các Phase sau (đã áp dụng nhất quán):**
- Mọi RPC không dành cho public phải `revoke execute ... from anon` tường minh, không chỉ dựa vào việc "không grant".
- Mọi policy/RPC liên quan Supervisor phải luôn kiểm tra branch, không chỉ kiểm tra role.
- Hàm "tra cứu quyền của chính mình" dùng trong RLS policy phải là `SECURITY DEFINER` nếu bảng đó có từ 2 policy trở lên.
- Luôn test bằng `set local role authenticated/anon` + `set_config('request.jwt.claim.sub', ...)` thay vì tin vào test chạy bằng quyền admin/superuser (quyền cao bypass RLS nên có thể che giấu lỗi thật).
