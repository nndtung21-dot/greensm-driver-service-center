-- Mở rộng bảng drivers theo đúng cấu trúc dữ liệu thật + hỗ trợ upload hàng ngày.
alter table drivers add column if not exists driver_code text;
alter table drivers add column if not exists app_code text;
alter table drivers add column if not exists work_status text;
alter table drivers add column if not exists account_status text;
alter table drivers add column if not exists lock_reason text;
alter table drivers add column if not exists id_number text;
alter table drivers add column if not exists vehicle_model text;
alter table drivers add column if not exists license_plate text;
alter table drivers add column if not exists assignment_status text;
alter table drivers add column if not exists assigned_at timestamptz;
alter table drivers add column if not exists driver_type text;

-- Unique constraint (không phải partial index) để ON CONFLICT (driver_code) hoạt động đúng.
-- NULL vẫn cho phép trùng nhiều dòng theo đúng chuẩn SQL, không cần điều kiện WHERE riêng.
alter table drivers add constraint drivers_driver_code_key unique (driver_code);

create policy drivers_admin_write on drivers for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');
