-- 0045: Nạp danh sách tài xế chỉ ghi những dòng thật sự thay đổi.
--
-- Sự cố 09/11 và 11/11: mỗi lần nạp cả danh sách (~137-265 nghìn dòng), trang
-- Admin upsert TOÀN BỘ dòng qua PostgREST. Postgres ghi lại bản ghi mới cho mọi
-- dòng (kể cả không đổi) + cập nhật 7 chỉ mục + phải dọn bản ghi cũ, làm cạn
-- ngân sách Disk IO (gói Micro/Small) và đứng toàn hệ thống chiều 11/11.
-- Đo trên mẫu: ~98% dòng trong file giống hệt DB.
--
-- admin_import_drivers(p_rows, p_columns):
--   * p_rows: mảng JSON tối đa 2000 dòng (driver_code, name bắt buộc).
--   * p_columns: các cột có trong file. Cột không có trong file giữ nguyên dữ liệu cũ.
--   * Mã SAP trong file đang thuộc mã tài xế KHÁC trong DB: gỡ SAP khỏi mã cũ
--     (file mới nhất là nguồn đúng), trả danh sách để hiển thị.
--   * Chỉ UPDATE dòng có ít nhất một cột (trong p_columns) khác DB; INSERT mã mới.
--   * Không dùng bảng tạm (tránh ghi catalog mỗi lần gọi).
--   * Trả về {total, inserted, updated, unchanged, moved:[{sap, from, fromName, to}]}.

create or replace function public.admin_import_drivers(p_rows jsonb, p_columns text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_sap         boolean := 'sap_id' = any(p_columns);
  c_app         boolean := 'app_code' = any(p_columns);
  c_work        boolean := 'work_status' = any(p_columns);
  c_acc         boolean := 'account_status' = any(p_columns);
  c_lock        boolean := 'lock_reason' = any(p_columns);
  c_model       boolean := 'vehicle_model' = any(p_columns);
  c_plate       boolean := 'license_plate' = any(p_columns);
  c_assign      boolean := 'assignment_status' = any(p_columns);
  c_assigned_at boolean := 'assigned_at' = any(p_columns);
  c_type        boolean := 'driver_type' = any(p_columns);
  v_total    int;
  v_inserted int := 0;
  v_updated  int := 0;
  v_moved    jsonb := '[]'::jsonb;
begin
  if public.active_role() is distinct from 'admin' then
    raise exception 'Chỉ admin được nạp danh sách tài xế.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Dữ liệu nạp không hợp lệ.';
  end if;

  v_total := jsonb_array_length(p_rows);
  if v_total = 0 then
    return jsonb_build_object('total', 0, 'inserted', 0, 'updated', 0, 'unchanged', 0, 'moved', '[]'::jsonb);
  end if;
  if v_total > 2000 then
    raise exception 'Mỗi lần gửi tối đa 2000 dòng.';
  end if;

  -- Kiểm tra dữ liệu: bắt buộc Mã tài xế, Họ tên; không trùng Mã tài xế / Mã SAP trong lô
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(driver_code text, name text)
    where nullif(trim(driver_code), '') is null or nullif(trim(name), '') is null
  ) then
    raise exception 'Có dòng thiếu Mã tài xế hoặc Họ & tên.';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(driver_code text)
    group by driver_code having count(*) > 1
  ) then
    raise exception 'Có Mã tài xế bị trùng trong cùng lô.';
  end if;

  if c_sap and exists (
    select 1 from jsonb_to_recordset(p_rows) as x(sap_id text)
    where sap_id is not null group by sap_id having count(*) > 1
  ) then
    raise exception 'Có Mã SAP bị trùng trong cùng lô.';
  end if;

  -- 1) Mã SAP đã chuyển sang mã tài xế mới: gỡ SAP khỏi mã cũ
  if c_sap then
    with src as (
      select * from jsonb_to_recordset(p_rows) as x(driver_code text, sap_id text)
    ),
    moved as (
      update public.drivers d
      set sap_id = null, updated_at = now()
      from src s
      where s.sap_id is not null
        and d.sap_id = s.sap_id
        and d.driver_code <> s.driver_code
      returning s.sap_id, d.driver_code as from_code, d.name as from_name, s.driver_code as to_code
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'sap', sap_id, 'from', from_code, 'fromName', coalesce(from_name, ''), 'to', to_code)), '[]'::jsonb)
    into v_moved
    from moved;
  end if;

  -- 2) Cập nhật CHỈ những dòng có thay đổi (so trên các cột có trong file)
  with src as (
    select * from jsonb_to_recordset(p_rows) as x(
      driver_code text, sap_id text, app_code text, name text,
      work_status text, account_status text, lock_reason text, vehicle_model text,
      license_plate text, assignment_status text, assigned_at timestamptz, driver_type text)
  ),
  upd as (
    update public.drivers d set
      name              = s.name,
      sap_id            = case when c_sap         then s.sap_id            else d.sap_id end,
      app_code          = case when c_app         then s.app_code          else d.app_code end,
      work_status       = case when c_work        then s.work_status       else d.work_status end,
      account_status    = case when c_acc         then s.account_status    else d.account_status end,
      lock_reason       = case when c_lock        then s.lock_reason       else d.lock_reason end,
      vehicle_model     = case when c_model       then s.vehicle_model     else d.vehicle_model end,
      license_plate     = case when c_plate       then s.license_plate     else d.license_plate end,
      assignment_status = case when c_assign      then s.assignment_status else d.assignment_status end,
      assigned_at       = case when c_assigned_at then s.assigned_at       else d.assigned_at end,
      driver_type       = case when c_type        then s.driver_type       else d.driver_type end,
      updated_at        = now()
    from src s
    where d.driver_code = s.driver_code
      and (
           d.name is distinct from s.name
        or (c_sap         and d.sap_id            is distinct from s.sap_id)
        or (c_app         and d.app_code          is distinct from s.app_code)
        or (c_work        and d.work_status       is distinct from s.work_status)
        or (c_acc         and d.account_status    is distinct from s.account_status)
        or (c_lock        and d.lock_reason       is distinct from s.lock_reason)
        or (c_model       and d.vehicle_model     is distinct from s.vehicle_model)
        or (c_plate       and d.license_plate     is distinct from s.license_plate)
        or (c_assign      and d.assignment_status is distinct from s.assignment_status)
        or (c_assigned_at and d.assigned_at       is distinct from s.assigned_at)
        or (c_type        and d.driver_type       is distinct from s.driver_type)
      )
    returning 1
  )
  select count(*) into v_updated from upd;

  -- 3) Thêm tài xế mới
  with src as (
    select * from jsonb_to_recordset(p_rows) as x(
      driver_code text, sap_id text, app_code text, name text,
      work_status text, account_status text, lock_reason text, vehicle_model text,
      license_plate text, assignment_status text, assigned_at timestamptz, driver_type text)
  ),
  ins as (
    insert into public.drivers (
      driver_code, sap_id, app_code, name, work_status, account_status, lock_reason,
      vehicle_model, license_plate, assignment_status, assigned_at, driver_type)
    select
      s.driver_code,
      case when c_sap         then s.sap_id end,
      case when c_app         then s.app_code end,
      s.name,
      case when c_work        then s.work_status end,
      case when c_acc         then s.account_status end,
      case when c_lock        then s.lock_reason end,
      case when c_model       then s.vehicle_model end,
      case when c_plate       then s.license_plate end,
      case when c_assign      then s.assignment_status end,
      case when c_assigned_at then s.assigned_at end,
      case when c_type        then s.driver_type end
    from src s
    where not exists (select 1 from public.drivers d where d.driver_code = s.driver_code)
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_total - v_inserted - v_updated,
    'moved', v_moved
  );
end;
$function$;

revoke all on function public.admin_import_drivers(jsonb, text[]) from public, anon;
grant execute on function public.admin_import_drivers(jsonb, text[]) to authenticated;
