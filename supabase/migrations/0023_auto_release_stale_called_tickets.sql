-- 0023: Auto-release a ticket (and its counter) if it sits at CALLED
-- for more than 5 minutes without anyone clicking "Bắt đầu xử lý".
--
-- Context: an agent can call a ticket (queue_tickets.status='CALLED',
-- counters.status='BUSY') and then never actually start processing
-- it (serving_at stays null) — e.g. distracted, tab closed, demo
-- account left idle. Nothing previously reclaimed that counter, so it
-- stayed BUSY indefinitely, blocking that counter for everyone. This
-- is exactly what happened with counters HCM011 and HCM016 before a
-- manual SQL fix (see migrations 0021/0022 for that incident).
--
-- This job requeues the ticket back to WAITING (unassigned, so any
-- agent covering that category can pick it up — not just the one who
-- abandoned it) and frees the counter, every minute, via pg_cron.

CREATE OR REPLACE FUNCTION public.release_stale_called_tickets()
 RETURNS TABLE(released_ticket_code text, released_counter_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  for r in
    select qt.id as ticket_id, qt.ticket_code, qt.counter_id, cs.id as case_id, c.counter_code
    from public.queue_tickets qt
    join public.service_cases cs on cs.ticket_id = qt.id
    left join public.counters c on c.id = qt.counter_id
    where qt.status = 'CALLED'
      and cs.status = 'CALLED'
      and qt.serving_at is null
      and qt.called_at < now() - interval '5 minutes'
    for update of qt skip locked
  loop
    update public.queue_tickets
    set status = 'WAITING', counter_id = null, called_at = null
    where id = r.ticket_id;

    update public.service_cases
    set status = 'WAITING', assigned_agent_id = null
    where id = r.case_id;

    insert into public.case_history(case_id, action, old_status, new_status, performed_by, note)
    values (
      r.case_id, 'AUTO_RELEASED', 'CALLED', 'WAITING', null,
      'Tự động trả về hàng chờ: ticket được gọi nhưng không xử lý quá 5 phút.'
    );

    if r.counter_id is not null then
      update public.counters
      set status = 'AVAILABLE', current_agent_id = null
      where id = r.counter_id and status = 'BUSY';
    end if;

    released_ticket_code := r.ticket_code;
    released_counter_code := r.counter_code;
    return next;
  end loop;
end;
$function$;

-- Requires pg_cron (enabled by this migration if not already).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Run every minute. Re-running this migration is safe: unschedule
-- first so we don't end up with duplicate jobs of the same name.
SELECT cron.unschedule('release-stale-called-tickets')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-stale-called-tickets');

SELECT cron.schedule(
  'release-stale-called-tickets',
  '* * * * *',
  $$select public.release_stale_called_tickets();$$
);
