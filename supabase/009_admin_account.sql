-- =====================================================================
-- Smile Hub ERP — TÀI KHOẢN QUẢN TRỊ CẤP CAO, XOÁ CƠ SỞ
--
-- Chạy SAU supabase/008_staff_accounts.sql. Chạy lại file này nhiều lần
-- cũng không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay
-- đổi gì. Đã chạy file này thì KHÔNG chạy lại 002 → 008 nữa.
--
-- File này SỬA DỮ LIỆU của đúng một tài khoản (theo yêu cầu của chủ phòng khám
-- ngày 11/11/2026): tài khoản Quản trị cấp cao chưa có tên đăng nhập thì được
-- đặt tên đăng nhập "admin" (đăng nhập bằng "admin" thay cho email cũ, mật khẩu
-- giữ nguyên), và tên "Admin" nếu đang là tên tạm "Tên của bạn".
--
-- Thêm:
--   • update_own_account(): Quản trị cấp cao tự sửa tên và tên đăng nhập của
--     mình (nút bút ở dòng của mình trong Tài khoản & Phân quyền). Đổi mật khẩu
--     làm ngay trong ứng dụng, không qua hàm này.
--   • delete_branch(): Quản trị cấp cao xoá một cơ sở chưa có nhân sự nào.
-- =====================================================================
begin;


-- ---------------------------------------------------------------------
-- 1. QUẢN TRỊ CẤP CAO TỰ SỬA TÊN, TÊN ĐĂNG NHẬP
-- ---------------------------------------------------------------------
create or replace function private.set_login(p_user_id uuid, p_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text := private.login_email(p_username);
begin
  update public.staff set username = p_username where user_id = p_user_id;
  update auth.users set email = v_email, updated_at = now()
  where id = p_user_id and lower(email) is distinct from v_email;
  update auth.identities
  set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
  where user_id = p_user_id and provider = 'email';
end;
$$;

create or replace function public.update_own_account(p_full_name text, p_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := (select auth.uid());
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if not private.is_super_admin() then
    raise exception 'Chỉ Quản trị cấp cao tự sửa được thông tin của mình ở đây' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'Nhập tên' using errcode = '22023';
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
    raise exception 'Tên đăng nhập 3–30 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch dưới'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.staff s where s.username = v_username and s.user_id <> v_uid)
     or exists (select 1 from auth.users u where lower(u.email) = private.login_email(v_username) and u.id <> v_uid) then
    raise exception 'Tên đăng nhập "%" đã có người dùng — hãy chọn tên khác', v_username using errcode = '23505';
  end if;

  update public.staff set full_name = v_name where user_id = v_uid;
  if (select s.username from public.staff s where s.user_id = v_uid) is distinct from v_username then
    perform private.set_login(v_uid, v_username);
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. XOÁ CƠ SỞ (chỉ Quản trị cấp cao, chỉ khi không còn nhân sự)
-- ---------------------------------------------------------------------
create or replace function public.delete_branch(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name  text;
  v_staff int;
begin
  if not private.is_super_admin() then
    raise exception 'Chỉ Quản trị cấp cao được xoá cơ sở' using errcode = '42501';
  end if;
  select b.name into v_name from public.branches b where b.id = p_id;
  if v_name is null then
    raise exception 'Không tìm thấy cơ sở' using errcode = '22023';
  end if;
  select count(*) into v_staff from public.staff s where s.branch_id = p_id;
  if v_staff > 0 then
    raise exception 'Cơ sở "%" còn % nhân sự (kể cả người đã xoá) — hãy chuyển họ sang cơ sở khác trước', v_name, v_staff
      using errcode = '23503';
  end if;
  delete from public.branches where id = p_id;   -- nhật ký vẫn giữ bản ghi cũ (hành động "Xoá vĩnh viễn")
end;
$$;


-- ---------------------------------------------------------------------
-- 3. TÀI KHOẢN QUẢN TRỊ CẤP CAO: TÊN ĐĂNG NHẬP "admin", TÊN "Admin"
-- ---------------------------------------------------------------------
do $$
declare
  v_owner uuid;
begin
  select s.user_id into v_owner
  from public.staff s
  where s.role = 'super_admin' and s.username is null
  order by s.created_at
  limit 1;
  if v_owner is null
     or exists (select 1 from public.staff s where s.username = 'admin')
     or exists (select 1 from auth.users u where lower(u.email) = 'admin@smilehub.local') then
    return;
  end if;
  perform set_config('app.audit_note', 'Đặt tên đăng nhập mặc định admin cho Quản trị cấp cao', true);
  update public.staff set full_name = 'Admin' where user_id = v_owner and full_name = 'Tên của bạn';
  perform private.set_login(v_owner, 'admin');
  perform set_config('app.audit_note', '', true);
end $$;


-- ---------------------------------------------------------------------
-- 4. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function private.set_login(uuid, text) from public;
revoke all on function public.update_own_account(text, text) from public, anon;
revoke all on function public.delete_branch(uuid) from public, anon;
grant execute on function public.update_own_account(text, text) to authenticated;
grant execute on function public.delete_branch(uuid) to authenticated;

-- Báo cho lớp API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
