-- =====================================================================
-- Phát hiện khi debug lỗi "Database error creating new user": có 1
-- trigger `on_auth_user_created` trên auth.users + hàm `handle_new_user()`
-- KHÔNG nằm trong bất kỳ migration nào của repo này (được tạo thẳng trên
-- Supabase Dashboard, không rõ từ khi nào — nhiều khả năng còn sót lại từ
-- 1 template khởi tạo Supabase Auth mặc định).
--
-- Trigger này tự insert vào public.profiles với:
--   role      = 'admin'       (CỐ ĐỊNH, bất kể role thực sự được chọn)
--   branch_id = 'a1111111-...' (CỐ ĐỊNH, 1 VP hardcode)
-- mỗi khi có 1 dòng mới trong auth.users — chạy TRƯỚC và ĐỘC LẬP với
-- create_user API route của app (route đó tự insert profiles theo đúng
-- role/branch admin chọn). Hai bên đụng nhau qua ON CONFLICT DO NOTHING
-- phía trigger, nghĩa là dòng profiles bị trigger tạo trước sẽ THẮNG —
-- mọi tài khoản tạo qua app đều âm thầm bị gán role=admin sai, không
-- phải role đã chọn. Khi VP hardcode đó không còn tồn tại (bị xoá qua
-- các lần seed/test), trigger vi phạm khoá ngoại -> toàn bộ transaction
-- tạo user (kể cả tạo thẳng trên Supabase Dashboard) bị rollback với
-- lỗi "Database error creating new user".
--
-- Xoá hẳn: app đã có create_user API route tự quản lý đúng
-- role/branch/status, không cần trigger này.
-- =====================================================================

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
