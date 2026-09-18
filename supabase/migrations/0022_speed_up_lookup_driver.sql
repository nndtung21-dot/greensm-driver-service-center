-- 0022: Fix lookup_driver() doing a full sequential scan of `drivers`
-- (224k+ rows) on every single call — the root cause of the frequent
-- "canceling statement due to statement timeout" errors and the
-- intermittent 500s from /rest/v1/rpc/lookup_driver during check-in.
--
-- lookup_driver() matches on upper(trim(...)) / upper(regexp_replace(...))
-- expressions, so the existing plain btree indexes on sap_id and
-- driver_code were never used by the planner. These expression indexes
-- mirror the exact expressions used in lookup_driver() so Postgres can
-- use a Bitmap Index Scan / BitmapOr instead of a Seq Scan.
--
-- Measured impact (EXPLAIN ANALYZE, prod data, ~224,500 rows):
--   before: Seq Scan, ~3.4s–4.0s per lookup
--   after:  Bitmap Heap Scan, ~17ms–22ms per lookup
--
-- Created CONCURRENTLY to avoid locking the table for writes while
-- building on a live table; if re-running this file manually outside
-- of CONCURRENTLY-compatible tooling, drop CONCURRENTLY and run each
-- statement individually (CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction block).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drivers_sap_id_norm
  ON public.drivers (upper(trim(coalesce(sap_id,''))));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drivers_driver_code_norm
  ON public.drivers (upper(trim(coalesce(driver_code,''))));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drivers_app_code_norm
  ON public.drivers (upper(trim(coalesce(app_code,''))));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drivers_license_plate_norm
  ON public.drivers (upper(regexp_replace(coalesce(license_plate,''), '[ .-]', '', 'g')))
  WHERE assignment_status = 'VehicleAssigned';

ANALYZE public.drivers;
