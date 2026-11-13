-- =====================================================================
-- Smile Hub ERP — THÊM 2 CHỨC VỤ KẾ TOÁN KHI THÊM NGƯỜI
--
-- Chạy SAU supabase/019_online_presence.sql (chạy trước hay sau file 020 đều
-- được). Chạy lại file này nhiều lần cũng không sao. Toàn bộ nằm trong một
-- giao dịch: lỗi ở đâu thì không thay đổi gì. Đã chạy file này thì KHÔNG chạy
-- lại 005, 008, 015 nữa (chúng sẽ đưa danh sách vai trò / vị trí về bản cũ).
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có.
--
-- Thêm 2 vị trí ở Cài đặt → Tài khoản & Phân quyền → Thêm người
-- (chủ phòng khám, 13/11/2026):
--   • Kế toán trưởng → vai trò mới Kế toán trưởng (chief_accountant)
--   • Kế toán viên   → vai trò mới Kế toán viên   (accountant)
--
-- Quyền của 2 vai trò mới — lúc này phân hệ Kế toán chưa có màn hình nào:
--   • Như mọi tài khoản mới: chưa thấy trang nào cho tới khi được tick trang.
--   • KHÔNG đọc, KHÔNG sửa được lead và lịch sử lead (số điện thoại khách),
--     kể cả khi được tick trang Leads. Mở ra khi làm phần Thu ngân, nếu cần.
--   • Không bật "nhận lead" được, nên không bao giờ được chia số.
--   • Vẫn xem được các danh mục chung như mọi nhân viên (cơ sở, dịch vụ &
--     bảng giá, kênh…), không xem được báo cáo quảng cáo.
-- Giới hạn còn lại (giống Nhân viên Ads hiện nay): hàm kiểm tra / thêm một số
-- điện thoại (check_lead_phone, intake_lead) chưa chặn theo vai trò.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. VAI TRÒ: thêm Kế toán trưởng, Kế toán viên
-- ---------------------------------------------------------------------
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('super_admin', 'admin', 'marketing_manager', 'ads_staff', 'lead', 'sale', 'page',
                  'chief_accountant', 'accountant'));

-- Người đang gọi thuộc bộ phận Kế toán (kể cả khi đang bị khoá — đã khoá thì càng không được xem).
create or replace function private.is_accounting()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid())
      and s.role in ('chief_accountant', 'accountant'));
$$;
revoke all on function private.is_accounting() from public;
grant execute on function private.is_accounting() to authenticated;


-- ---------------------------------------------------------------------
-- 2. VỊ TRÍ: bỏ ràng buộc cũ (6 vị trí), đặt ràng buộc mới (8 vị trí)
-- ---------------------------------------------------------------------
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
         or position in ('coo', 'lead_ads', 'ads_staff', 'page', 'lead_telesale', 'telesale',
                         'chief_accountant', 'accountant'));

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
           when 'chief_accountant' then 'chief_accountant'
           when 'accountant' then 'accountant'
         end;
$$;
revoke all on function private.role_of_position(text) from public;


-- ---------------------------------------------------------------------
-- 3. KẾ TOÁN KHÔNG XEM / SỬA LEAD
--    Quy tắc "chặn thêm" (restrictive): áp lên trên mọi quy tắc cho phép đang có,
--    nên không phụ thuộc file 005 hay 020 đang định nghĩa quyền xem lead thế nào.
--    Lịch sử thay đổi của lead (audit_log) đi theo quyền xem lead nên cũng bị chặn.
-- ---------------------------------------------------------------------
drop policy if exists leads_no_accounting on public.leads;
create policy leads_no_accounting on public.leads
  as restrictive for all to authenticated
  using (not (select private.is_accounting()));

drop policy if exists lead_touches_no_accounting on public.lead_touches;
create policy lead_touches_no_accounting on public.lead_touches
  as restrictive for all to authenticated
  using (not (select private.is_accounting()));

-- Kế toán không nằm trong vòng chia lead (số chia cho người không xem được lead là mất số).
alter table public.staff drop constraint if exists staff_accounting_no_leads_check;
alter table public.staff add constraint staff_accounting_no_leads_check
  check (not (accepts_leads and role in ('chief_accountant', 'accountant')));

commit;
