-- 0031: v_report_raw đang chậm (2.2s-7.9s trung bình mỗi lần export)
-- vì subquery LATERAL tra "Agent" (ai gọi ticket từ WAITING sang
-- CALLED) join vào case_history theo case_id — nhưng case_history
-- CHƯA CÓ INDEX trên case_id (chỉ có PK trên id). Với ~5.2k case và
-- ~26k dòng lịch sử, mỗi export phải quét tuần tự case_history hàng
-- ngàn lần.
--
-- Đã đo: trước fix ~2.2s-7.9s, sau khi thêm index + VACUUM ANALYZE
-- drivers/service_cases (dọn dead tuples do import/update nhiều):
-- còn ~1.8s. Phần còn lại chủ yếu là join tới bảng drivers (224k
-- dòng) theo driver_id — đã dùng đúng PK index, không còn gì để tối
-- ưu thêm nhiều mà không đổi kiến trúc view.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_case_history_case_id_created_at
  ON public.case_history (case_id, created_at DESC);

-- Lưu ý vận hành: autovacuum trên "drivers" và "service_cases" có vẻ
-- không theo kịp tần suất update (bulk import driver, update case
-- liên tục) — 2 bảng này có 9-12% dead tuples tại thời điểm audit.
-- Đã chạy VACUUM ANALYZE thủ công 1 lần cho cả 2 bảng khi tìm ra vấn
-- đề này; nếu tình trạng chậm quay lại, kiểm tra lại dead_pct qua
-- pg_stat_user_tables trước, rồi VACUUM ANALYZE thủ công nếu cần.
