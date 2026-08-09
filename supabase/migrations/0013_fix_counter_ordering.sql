-- Sắp xếp quầy theo SỐ (1,2,3,4,5) thay vì theo CHỮ.
drop function if exists tv_counters_status(text);

create function tv_counters_status(p_branch_code text)
returns table (
  counter_code text, counter_name text, counter_status counter_status,
  agent_id uuid, agent_name text, queue_number text, called_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select co.counter_code, co.counter_name, co.status, co.default_agent_id, p.full_name,
    qt.queue_number, qt.called_at
  from counters co
  join branches b on b.id = co.branch_id
  left join profiles p on p.id = co.default_agent_id
  left join queue_tickets qt on qt.counter_id = co.id and qt.status in ('CALLED','PROCESSING')
  where b.branch_code = p_branch_code
  order by
    case when co.counter_code ~ '^[0-9]+$' then lpad(co.counter_code, 10, '0') else null end nulls last,
    co.counter_code;
$$;
revoke all on function tv_counters_status(text) from public;
grant execute on function tv_counters_status(text) to anon, authenticated;
