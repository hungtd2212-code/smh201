-- =====================================================================
-- Smile Hub ERP — LEAD ADS CŨNG LÀ NGƯỜI CHẠY QUẢNG CÁO
--
-- Chạy SAU supabase/015_telesale_positions.sql. Chạy lại file này nhiều lần
-- cũng không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay
-- đổi gì. Đã chạy file này thì KHÔNG chạy lại 007 nữa (007 sẽ đưa quy tắc về
-- "chỉ Nhân viên quảng cáo").
--
-- Lý do (chủ phòng khám, 12/11/2026): Lead Ads vẫn phải chạy quảng cáo, nên
-- tên Lead Ads phải có trong ô "Nhập thay cho" và ô nhân viên của "Thêm TKQC"
-- cùng với các Nhân viên quảng cáo.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có. Việc duy nhất nó làm với
-- dữ liệu: tài khoản nào ĐANG ở vai trò Trưởng Marketing (vị trí Lead Ads) mà
-- chưa có tên trong danh sách Nhân viên Ads thì được thêm tên vào (hoặc gắn
-- vào dòng cùng tên đang chưa có tài khoản, để giữ số liệu cũ của người đó).
--
-- Từ nay: thêm người / đổi người sang vị trí Lead Ads → tự có tên trong danh
-- sách Nhân viên Ads, giống vị trí Nhân viên quảng cáo (file 007).
-- =====================================================================
begin;

create or replace function private.sync_ads_staff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role in ('ads_staff', 'marketing_manager')
     and (tg_op = 'INSERT' or old.role is distinct from new.role) then
    perform private.ensure_ads_staff(new.user_id);
  end if;
  return null;
end;
$$;
revoke all on function private.sync_ads_staff() from public;

-- Tài khoản đã là Lead Ads từ trước khi chạy file này.
select private.ensure_ads_staff(s.user_id)
from public.staff s
where s.role = 'marketing_manager'
  and s.deleted_at is null
  and not exists (select 1 from public.ads_staff a where a.user_id = s.user_id and a.deleted_at is null);

commit;
