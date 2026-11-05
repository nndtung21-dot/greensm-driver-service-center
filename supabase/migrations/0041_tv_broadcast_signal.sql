-- 0041: TV (không đăng nhập) không còn đọc thẳng bảng qua realtime được nữa (RLS đã bật ở 0040).
-- Thay bằng tín hiệu "có thay đổi" gửi theo từng văn phòng qua kênh `tv:<mã văn phòng>`,
-- KHÔNG kèm dữ liệu. TV nhận tín hiệu rồi tự gọi lại các hàm RPC như trước.
-- Bọc exception: lỗi kênh realtime không bao giờ được làm hỏng thao tác gọi vé.

create or replace function public.tv_broadcast_change()
returns trigger language plpgsql security definer set search_path = public, realtime as $$
declare
  v_branch uuid;
  v_code text;
begin
  v_branch := case tg_op when 'DELETE' then old.branch_id else new.branch_id end;
  if v_branch is not null then
    select b.branch_code into v_code from public.branches b where b.id = v_branch;
    if v_code is not null then
      perform realtime.send(jsonb_build_object('t', extract(epoch from clock_timestamp())), 'changed', 'tv:' || v_code, false);
    end if;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists trg_tv_broadcast on public.queue_tickets;
create trigger trg_tv_broadcast after insert or update or delete on public.queue_tickets
  for each row execute function public.tv_broadcast_change();

drop trigger if exists trg_tv_broadcast on public.service_cases;
create trigger trg_tv_broadcast after insert or update or delete on public.service_cases
  for each row execute function public.tv_broadcast_change();

drop trigger if exists trg_tv_broadcast on public.counters;
create trigger trg_tv_broadcast after insert or update or delete on public.counters
  for each row execute function public.tv_broadcast_change();
