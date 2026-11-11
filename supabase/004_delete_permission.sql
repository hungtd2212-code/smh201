-- =====================================================================
-- Smile Hub ERP — QUYỀN XOÁ DỮ LIỆU THEO TỪNG TÀI KHOẢN
--
-- Chạy SAU supabase/003_data_safety.sql. Chạy lại file này nhiều lần cũng
-- không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
-- LƯU Ý: sau khi đã chạy file này thì KHÔNG chạy lại 003 nữa (file 003 sẽ
-- đưa quy tắc cũ "Lead trở lên được chuyển vào thùng rác" quay lại).
--
-- Trước: Lead (trưởng nhóm) trở lên được chuyển dữ liệu vào thùng rác.
-- Nay:   chỉ tài khoản được Quản trị cấp cao TICK quyền "Xoá dữ liệu" (ở Cài
--        đặt → Tài khoản & Phân quyền) mới chuyển được vào thùng rác, và chỉ
--        những tài khoản đó mới thấy nút. Mặc định không ai được tick.
--        Quản trị cấp cao luôn có quyền này.
-- Không đổi: xoá vĩnh viễn vẫn chỉ dành cho Quản trị cấp cao; khôi phục vẫn
--        dành cho Quản trị.
-- =====================================================================
begin;

alter table public.staff
  add column if not exists can_delete boolean not null default false;  -- được tick quyền "Xoá dữ liệu"

-- Người đang gọi có quyền chuyển dữ liệu vào thùng rác không.
create or replace function private.can_delete()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null
      and (s.role = 'super_admin' or s.can_delete));
$$;

-- Chuyển vào thùng rác: như bản ở file 003, chỉ khác phần kiểm tra quyền.
-- Danh mục (kênh, page, chiến dịch, dịch vụ) vốn chỉ Quản trị / Lead quản lý, nên
-- ngoài ô tick còn phải đúng vai trò đó.
create or replace function public.soft_delete_records(p_table text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_n      int  := coalesce(cardinality(p_ids), 0);
  v_recent int;
  v_done   int;
begin
  if p_table is null or p_table <> all (private.soft_delete_tables()) then
    raise exception 'Loại dữ liệu này không có thùng rác' using errcode = '22023';
  end if;
  if not private.can_delete() then
    raise exception 'Tài khoản của bạn chưa được cấp quyền xoá dữ liệu' using errcode = '42501';
  end if;
  if p_table <> 'leads' and not private.is_manager() then
    raise exception 'Chỉ Quản trị hoặc Lead được chuyển danh mục vào thùng rác' using errcode = '42501';
  end if;
  if v_n = 0 then
    return jsonb_build_object('deleted', 0);
  end if;
  if v_n > 1000 then
    raise exception 'Mỗi lần chỉ chuyển được tối đa 1000 bản ghi vào thùng rác' using errcode = '22023';
  end if;

  select count(*) into v_recent
  from public.audit_log a
  where a.actor_id = v_uid and a.action = 'delete' and a.at > now() - interval '10 minutes';
  if v_n + v_recent > private.setting_int('bulk_delete_confirm_over', 20)
     and not private.password_confirmed_recently() then
    raise exception 'PASSWORD_REQUIRED'
      using errcode = 'P0001', hint = 'Xoá nhiều bản ghi cần nhập lại mật khẩu để xác nhận';
  end if;

  if p_table = 'channels' and exists (
       select 1 from public.pages p where p.channel_id = any (p_ids) and p.deleted_at is null) then
    raise exception 'Kênh còn page đang dùng — hãy chuyển các page của kênh vào thùng rác trước' using errcode = '23503';
  end if;
  if p_table = 'channels' and exists (
       select 1 from public.campaigns c where c.channel_id = any (p_ids) and c.deleted_at is null) then
    raise exception 'Kênh còn chiến dịch — hãy chuyển các chiến dịch của kênh vào thùng rác trước' using errcode = '23503';
  end if;
  if p_table = 'pages' and exists (
       select 1 from public.campaigns c where c.page_id = any (p_ids) and c.deleted_at is null) then
    raise exception 'Page còn chiến dịch — hãy chuyển các chiến dịch của page vào thùng rác trước' using errcode = '23503';
  end if;

  perform set_config('app.soft_delete', 'on', true);
  execute format(
    'update public.%I set deleted_at = now(), deleted_by = $1 where id = any ($2) and deleted_at is null',
    p_table) using v_uid, p_ids;
  get diagnostics v_done = row_count;
  perform set_config('app.soft_delete', 'off', true);

  return jsonb_build_object('deleted', v_done);
end;
$$;

-- Tick / bỏ tick quyền "Xoá dữ liệu" cho một tài khoản. Chỉ Quản trị cấp cao.
-- (Bảng staff không cho ứng dụng sửa trực tiếp, nên không ai tự tick cho mình được;
-- mỗi lần đổi đều được trigger ghi vào nhật ký.)
create or replace function public.set_staff_can_delete(p_user_id uuid, p_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  if not private.is_super_admin() then
    raise exception 'Chỉ Quản trị cấp cao được cấp hoặc thu quyền xoá dữ liệu' using errcode = '42501';
  end if;
  select s.role into v_role from public.staff s where s.user_id = p_user_id;
  if v_role is null then
    raise exception 'Không tìm thấy tài khoản' using errcode = '22023';
  end if;
  if v_role = 'super_admin' then
    raise exception 'Quản trị cấp cao luôn có quyền này, không cần tick' using errcode = '22023';
  end if;

  update public.staff set can_delete = coalesce(p_allowed, false) where user_id = p_user_id;
end;
$$;

revoke all on function private.can_delete() from public;
revoke all on function public.soft_delete_records(text, uuid[]) from public, anon;
revoke all on function public.set_staff_can_delete(uuid, boolean) from public, anon;
grant execute on function private.can_delete() to authenticated;
grant execute on function public.soft_delete_records(text, uuid[]) to authenticated;
grant execute on function public.set_staff_can_delete(uuid, boolean) to authenticated;

-- Báo cho lớp API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
