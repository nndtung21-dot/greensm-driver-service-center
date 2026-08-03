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

**Bài học rút ra cho các Phase sau (đã áp dụng nhất quán):**
- Mọi RPC không dành cho public phải `revoke execute ... from anon` tường minh, không chỉ dựa vào việc "không grant".
- Mọi policy/RPC liên quan Supervisor phải luôn kiểm tra branch, không chỉ kiểm tra role.
- Hàm "tra cứu quyền của chính mình" dùng trong RLS policy phải là `SECURITY DEFINER` nếu bảng đó có từ 2 policy trở lên.
- Luôn test bằng `set local role authenticated/anon` + `set_config('request.jwt.claim.sub', ...)` thay vì tin vào test chạy bằng quyền admin/superuser (quyền cao bypass RLS nên có thể che giấu lỗi thật).
