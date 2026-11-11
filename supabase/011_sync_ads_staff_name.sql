-- =====================================================================
-- Smile Hub ERP — TÊN NHÂN VIÊN ADS LUÔN THEO TÊN TÀI KHOẢN
--
-- Chạy SAU supabase/008_staff_accounts.sql (009, 010 chạy hay chưa đều được).
-- Chạy lại file này nhiều lần cũng không sao. Toàn bộ nằm trong một giao
-- dịch: lỗi ở đâu thì không thay đổi gì.
--
-- Lỗi được sửa (chủ phòng khám báo 12/11/2026): sửa tên nhân viên ở Tài khoản
-- & Phân quyền thì góc dưới bên trái và danh sách tài khoản đổi theo, nhưng ở
-- Cài đặt TKQC, Nhập liệu, Tổng quan vẫn hiện tên lúc tạo — vì tên ở đó lấy từ
-- dòng "nhân viên Ads" (ads_staff) tạo ra lúc thêm người.
--
-- File này SỬA DỮ LIỆU (theo yêu cầu đó): dòng nhân viên Ads nào gắn với một
-- tài khoản mà đang khác tên tài khoản thì đổi theo tên tài khoản. Từ nay mỗi
-- lần sửa tên tài khoản, tên nhân viên Ads đổi theo ngay. Mỗi lần đổi đều vào
-- Nhật ký hệ thống.
-- =====================================================================
begin;

-- Tên còn trống trong danh sách nhân viên Ads (trùng tên người khác thì thêm " (2)", " (3)"…).
create or replace function private.free_ads_staff_name(p_name text, p_except uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_base text := left(btrim(p_name), 110);
  v_try  text := v_base;
  v_n    int  := 1;
begin
  while exists (
    select 1 from public.ads_staff a
    where lower(a.full_name) = lower(v_try) and a.deleted_at is null and a.id <> p_except) loop
    v_n := v_n + 1;
    v_try := format('%s (%s)', v_base, v_n);
  end loop;
  return v_try;
end;
$$;

create or replace function private.sync_ads_staff_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.full_name is distinct from old.full_name then
    update public.ads_staff a
    set full_name = private.free_ads_staff_name(new.full_name, a.id)
    where a.user_id = new.user_id and a.deleted_at is null and a.full_name is distinct from new.full_name;
  end if;
  return null;
end;
$$;

create or replace trigger sync_ads_staff_name
  after update of full_name on public.staff
  for each row execute function private.sync_ads_staff_name();

-- Sửa các dòng đang lệch tên.
select set_config('app.audit_note', 'Đồng bộ tên nhân viên Ads theo tên tài khoản', true);
update public.ads_staff a
set full_name = private.free_ads_staff_name(s.full_name, a.id)
from public.staff s
where s.user_id = a.user_id and a.deleted_at is null and a.full_name <> s.full_name;
select set_config('app.audit_note', '', true);

revoke all on function private.free_ads_staff_name(text, uuid) from public;
revoke all on function private.sync_ads_staff_name() from public;

notify pgrst, 'reload schema';

commit;
