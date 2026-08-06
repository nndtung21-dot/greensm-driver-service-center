-- Section 18 (điều chỉnh theo yêu cầu): hiển thị TV theo từng quầy + danh sách
-- ticket đang chờ/đang xử lý. Vẫn public (anon), vẫn KHÔNG lộ tên/SAP ID tài xế.

create or replace function tv_counters_status(p_branch_code text)
returns table (
  counter_code text, counter_name text, counter_status counter_status,
  queue_number text, called_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select co.counter_code, co.counter_name, co.status,
    qt.queue_number, qt.called_at
  from counters co
  join branches b on b.id = co.branch_id
  left join queue_tickets qt
    on qt.counter_id = co.id and qt.status in (\'CALLED\',\'PROCESSING\')
  where b.branch_code = p_branch_code
  order by co.counter_code;
$$;
revoke all on function tv_counters_status(text) from public;
grant execute on function tv_counters_status(text) to anon, authenticated;

create or replace function tv_queue_list(p_branch_code text)
returns table (queue_number text, status ticket_status, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select qt.queue_number, qt.status, qt.created_at
  from queue_tickets qt
  join branches b on b.id = qt.branch_id
  where b.branch_code = p_branch_code
    and qt.status in (\'WAITING\',\'PROCESSING\')
  order by qt.created_at;
$$;
revoke all on function tv_queue_list(text) from public;
grant execute on function tv_queue_list(text) to anon, authenticated;
