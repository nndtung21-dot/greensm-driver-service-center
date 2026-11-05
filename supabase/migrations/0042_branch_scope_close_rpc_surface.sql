-- 0042: Thu hẹp các hàm RPC chạy với quyền chủ sở hữu (bỏ qua RLS) mà người chưa đăng nhập gọi được.
--
-- 1) get_case_detail, get_case_history, debug_current_user: không nơi nào trong app dùng, trả dữ liệu
--    case/lịch sử theo uuid mà không kiểm tra đăng nhập hay văn phòng. Gỡ quyền gọi (chưa xoá hàm).
-- 2) call_next_ticket, resolve_case, set_counter_status, transfer_ticket_to_counter: chỉ dành cho
--    nhân viên đăng nhập, bỏ quyền của anon/PUBLIC và cấp rõ cho authenticated.
-- Giữ nguyên cho người chưa đăng nhập đúng nhóm kiosk/QR/TV: lookup_driver, create_checkin,
-- checkin_window_open, lookup_ticket_for_feedback, submit_feedback(_detailed), tv_*.

revoke execute on function public.get_case_detail(uuid), public.get_case_history(uuid), public.debug_current_user()
  from public, anon, authenticated;

revoke execute on function
  public.call_next_ticket(uuid),
  public.resolve_case(uuid, text, text, boolean),
  public.set_counter_status(uuid, text),
  public.transfer_ticket_to_counter(uuid, uuid, text)
  from public, anon;
grant execute on function
  public.call_next_ticket(uuid),
  public.resolve_case(uuid, text, text, boolean),
  public.set_counter_status(uuid, text),
  public.transfer_ticket_to_counter(uuid, uuid, text)
  to authenticated;
