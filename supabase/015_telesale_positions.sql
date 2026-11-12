-- =====================================================================
-- Smile Hub ERP — THÊM 2 VỊ TRÍ TELESALE KHI THÊM NGƯỜI
--
-- Chạy SAU supabase/014_monthly_targets.sql. Chạy lại file này nhiều lần
-- cũng không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay
-- đổi gì. Đã chạy file này thì KHÔNG chạy lại 008 nữa (008 sẽ đưa danh sách
-- vị trí về 4 vị trí cũ).
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có.
--
-- Thêm 2 vị trí ở Cài đặt → Tài khoản & Phân quyền → Thêm người:
--   • Trưởng Telesale → vai trò Trưởng Telesale
--   • Telesale        → vai trò Telesale
-- Hai vai trò này đã có từ trước; quyền đọc / ghi dữ liệu của chúng KHÔNG đổi
-- (Telesale vẫn xem được mọi lead như hiện nay).
-- =====================================================================
begin;

-- Danh sách vị trí được phép: bỏ ràng buộc cũ (4 vị trí), đặt ràng buộc mới (6 vị trí).
do $$
declare c record;
begin
  for c in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.staff'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) like '%lead_ads%'
  loop
    execute format('alter table public.staff drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.staff
  add constraint staff_position_check
  check (position is null
         or position in ('coo', 'lead_ads', 'ads_staff', 'page', 'lead_telesale', 'telesale'));

-- Vị trí → vai trò (quyết định được đọc / ghi dữ liệu nào).
create or replace function private.role_of_position(p_position text)
returns text language sql immutable set search_path = '' as $$
  select case p_position
           when 'coo' then 'admin'
           when 'lead_ads' then 'marketing_manager'
           when 'ads_staff' then 'ads_staff'
           when 'page' then 'page'
           when 'lead_telesale' then 'lead'
           when 'telesale' then 'sale'
         end;
$$;
revoke all on function private.role_of_position(text) from public;

commit;
