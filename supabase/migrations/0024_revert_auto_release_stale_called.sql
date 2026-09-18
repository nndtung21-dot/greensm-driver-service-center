-- 0024: Revert 0023 — do NOT auto-release stale CALLED tickets.
--
-- Decision: keep the data as-is when a ticket sits CALLED for 5+
-- minutes without processing starting; only warn agents/supervisors
-- via a popup in the Agent Portal (frontend-only, see queue page),
-- so a human always makes the call instead of the system silently
-- requeuing/reassigning.

SELECT cron.unschedule('release-stale-called-tickets')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-stale-called-tickets');

DROP FUNCTION IF EXISTS public.release_stale_called_tickets();
