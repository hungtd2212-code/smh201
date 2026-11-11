-- =====================================================================
-- Smile Hub ERP — CÀI ĐẶT: DANH SÁCH CƠ SỞ, THÊM NGƯỜI DÙNG, PHÂN QUYỀN TRANG
--
-- Chạy SAU supabase/007_ad_account_setup.sql. Chạy lại file này nhiều lần
-- cũng không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay
-- đổi gì. Đã chạy file này thì KHÔNG chạy lại 002 → 007 nữa.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: thêm 1 bảng (branches, kèm
-- sẵn cơ sở "201 Trường Chinh"), thêm 5 cột cho staff (để trống với tài khoản
-- cũ) và các hàm dưới đây.
--
-- Thêm:
--   • Danh sách cơ sở (Cài đặt → Danh sách cơ sở): tên, địa chỉ, đang dùng.
--   • Thêm người dùng ngay trong ứng dụng (Cài đặt → Tài khoản & Phân quyền):
--     tên đăng nhập, mật khẩu, tên nhân viên, vị trí, nơi làm việc. Tài khoản
--     đăng nhập được tạo luôn (Supabase Auth), không phải vào Supabase nữa.
--     Đăng nhập bằng tên đăng nhập (hệ thống đổi thành <tên>@smilehub.local).
--   • Vị trí: COO, Lead Ads, Nhân viên quảng cáo, Trực page. Mỗi vị trí đi kèm
--     một vai trò quyết định được đọc / ghi dữ liệu nào:
--       COO → Quản trị · Lead Ads → Trưởng Marketing ·
--       Nhân viên quảng cáo → Nhân viên Ads · Trực page → Trực page.
--   • Phân quyền trang (staff.page_access): tick trang nào thì trang đó hiện ở
--     menu trái. Người mới thêm chưa có trang nào. null = tài khoản cũ, hiện
--     menu theo vai trò như trước. Quản trị cấp cao luôn thấy mọi trang.
--   • Sửa, đặt lại mật khẩu, xoá (ẩn khỏi danh sách + cấm đăng nhập, không xoá
--     hẳn), khoá / mở khoá. Khoá tài khoản giờ chặn luôn việc đăng nhập.
-- =====================================================================
begin;


-- ---------------------------------------------------------------------
-- 1. DANH SÁCH CƠ SỞ
-- ---------------------------------------------------------------------
create table if not exists public.branches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  address    text check (address is null or char_length(address) <= 300),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists branches_name_key on public.branches (lower(name));

create or replace trigger branches_set_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();
create or replace trigger zz_audit
  after insert or update or delete on public.branches
  for each row execute function private.audit_row('id', 'updated_at');

alter table public.branches enable row level security;
drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches
  for select to authenticated using ((select private.is_staff()));
drop policy if exists branches_insert_admin on public.branches;
create policy branches_insert_admin on public.branches
  for insert to authenticated with check ((select private.is_admin()));
drop policy if exists branches_update_admin on public.branches;
create policy branches_update_admin on public.branches
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
revoke all on public.branches from anon, authenticated;
grant select on public.branches to authenticated;
grant insert (name, address, is_active), update (name, address, is_active) on public.branches to authenticated;

-- Cơ sở đang có.
insert into public.branches (name)
select '201 Trường Chinh'
where not exists (select 1 from public.branches);


-- ---------------------------------------------------------------------
-- 2. CỘT MỚI CỦA TÀI KHOẢN
-- ---------------------------------------------------------------------
alter table public.staff
  add column if not exists username    text
    check (username is null or username ~ '^[a-z0-9][a-z0-9._]{2,29}$'),          -- tên đăng nhập
  add column if not exists position    text
    check (position is null or position in ('coo', 'lead_ads', 'ads_staff', 'page')),  -- vị trí
  add column if not exists branch_id   uuid references public.branches (id),        -- nơi làm việc
  add column if not exists page_access text[],                                      -- trang được xem
  add column if not exists deleted_at  timestamptz;                                 -- đã xoá khỏi danh sách
create unique index if not exists staff_username_key on public.staff (username) where username is not null;


-- ---------------------------------------------------------------------
-- 3. HÀM NỘI BỘ
-- ---------------------------------------------------------------------
-- Vị trí → vai trò (quyết định được đọc / ghi dữ liệu nào).
create or replace function private.role_of_position(p_position text)
returns text language sql immutable set search_path = '' as $$
  select case p_position
           when 'coo' then 'admin'
           when 'lead_ads' then 'marketing_manager'
           when 'ads_staff' then 'ads_staff'
           when 'page' then 'page'
         end;
$$;

-- Tên đăng nhập → email đăng nhập trong Supabase Auth (ứng dụng làm y như vậy ở màn đăng nhập).
create or replace function private.login_email(p_username text)
returns text language sql immutable set search_path = '' as $$
  select lower(btrim(p_username)) || '@smilehub.local';
$$;

-- Người đang gọi có được sửa / khoá / xoá tài khoản p_target không (p_new_role: vai trò sắp đặt, nếu đổi).
create or replace function private.check_manage_account(p_target uuid, p_new_role text default null)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text;
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị được quản lý tài khoản' using errcode = '42501';
  end if;
  if p_target = (select auth.uid()) then
    raise exception 'Không tự sửa / khoá / xoá tài khoản của chính mình ở đây (đổi mật khẩu ở menu tên của bạn)'
      using errcode = '22023';
  end if;
  select s.role into v_role from public.staff s where s.user_id = p_target and s.deleted_at is null;
  if v_role is null then
    raise exception 'Không tìm thấy tài khoản' using errcode = '22023';
  end if;
  if v_role = 'super_admin' then
    raise exception 'Không sửa được tài khoản Quản trị cấp cao' using errcode = '42501';
  end if;
  if (v_role = 'admin' or p_new_role = 'admin') and not private.is_super_admin() then
    raise exception 'Chỉ Quản trị cấp cao được tạo / sửa tài khoản vị trí COO (Quản trị)' using errcode = '42501';
  end if;
end;
$$;

-- Khoá tài khoản thì cấm luôn đăng nhập (Supabase Auth từ chối); mở khoá thì cho đăng nhập lại.
create or replace function private.sync_auth_ban()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.locked_at is distinct from old.locked_at then
    begin
      update auth.users
      set banned_until = case when new.locked_at is null then null else timestamptz '2999-12-31 00:00:00+00' end
      where id = new.user_id;
    exception when insufficient_privilege or undefined_column then
      null;  -- không chặn được ở Supabase Auth thì vẫn khoá trong ứng dụng như trước
    end;
  end if;
  return null;
end;
$$;

create or replace trigger sync_auth_ban
  after update of locked_at on public.staff
  for each row execute function private.sync_auth_ban();


-- ---------------------------------------------------------------------
-- 4. THÊM NGƯỜI DÙNG
-- ---------------------------------------------------------------------
create or replace function public.create_staff_account(
  p_username text, p_password text, p_full_name text, p_position text, p_branch_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_role     text := private.role_of_position(p_position);
  v_email    text;
  v_id       uuid := gen_random_uuid();
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị được thêm người' using errcode = '42501';
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
    raise exception 'Tên đăng nhập 3–30 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch dưới (vd thu.hoa)'
      using errcode = '22023';
  end if;
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'Mật khẩu tối thiểu 8 ký tự' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'Nhập tên nhân viên' using errcode = '22023';
  end if;
  if v_role is null then
    raise exception 'Chọn vị trí' using errcode = '22023';
  end if;
  if v_role = 'admin' and not private.is_super_admin() then
    raise exception 'Chỉ Quản trị cấp cao được thêm người ở vị trí COO' using errcode = '42501';
  end if;
  if p_branch_id is null
     or not exists (select 1 from public.branches b where b.id = p_branch_id and b.is_active) then
    raise exception 'Chọn nơi làm việc' using errcode = '22023';
  end if;

  v_email := private.login_email(v_username);
  if exists (select 1 from public.staff s where s.username = v_username)
     or exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'Tên đăng nhập "%" đã có người dùng — hãy chọn tên khác', v_username using errcode = '23505';
  end if;

  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object('full_name', v_name, 'username', v_username), now(), now(),
      '', '', '', '');
    insert into auth.identities (user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (
      v_id, v_id::text, 'email',
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
      null, now(), now());
  exception when insufficient_privilege then
    raise exception 'Cơ sở dữ liệu chưa cho phép tạo tài khoản đăng nhập từ ứng dụng — tạm thời thêm người trong Supabase → Authentication'
      using errcode = '42501';
  end;

  -- Người mới chưa được xem trang nào (page_access rỗng) — phân quyền sau.
  insert into public.staff (user_id, full_name, role, username, position, branch_id, page_access)
  values (v_id, v_name, v_role, v_username, p_position, p_branch_id, '{}');
  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. SỬA, ĐẶT LẠI MẬT KHẨU, XOÁ, PHÂN QUYỀN TRANG
-- ---------------------------------------------------------------------
-- p_position = null: giữ nguyên vị trí / vai trò đang có.
create or replace function public.update_staff_account(
  p_user_id uuid, p_full_name text, p_position text, p_branch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  v_role text := private.role_of_position(p_position);
begin
  if p_position is not null and v_role is null then
    raise exception 'Vị trí không hợp lệ' using errcode = '22023';
  end if;
  perform private.check_manage_account(p_user_id, v_role);
  if char_length(v_name) not between 1 and 120 then
    raise exception 'Nhập tên nhân viên' using errcode = '22023';
  end if;
  if p_branch_id is not null
     and not exists (select 1 from public.branches b where b.id = p_branch_id) then
    raise exception 'Không tìm thấy nơi làm việc' using errcode = '22023';
  end if;

  update public.staff
  set full_name = v_name,
      position = coalesce(p_position, position),
      role = coalesce(v_role, role),
      branch_id = p_branch_id,
      -- Không còn là telesale thì ra khỏi vòng chia lead.
      accepts_leads = case when coalesce(v_role, role) in ('lead', 'sale') then accepts_leads else false end
  where user_id = p_user_id;
end;
$$;

create or replace function public.reset_staff_password(p_user_id uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_manage_account(p_user_id);
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'Mật khẩu tối thiểu 8 ký tự' using errcode = '22023';
  end if;
  begin
    update auth.users
    set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
    where id = p_user_id;
  exception when insufficient_privilege then
    raise exception 'Cơ sở dữ liệu chưa cho phép đặt lại mật khẩu từ ứng dụng' using errcode = '42501';
  end;
  -- Ghi nhật ký (không ghi mật khẩu).
  insert into public.audit_log (actor_id, table_name, record_id, action, new_data, note)
  values ((select auth.uid()), 'staff', p_user_id::text, 'update', '{}'::jsonb, 'Đặt lại mật khẩu');
end;
$$;

-- Xoá nhân sự: ẩn khỏi danh sách và cấm đăng nhập. Không xoá hẳn (giữ tên trong lead, nhật ký cũ).
create or replace function public.remove_staff_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_manage_account(p_user_id);
  if not private.can_delete() then
    raise exception 'Tài khoản của bạn chưa được cấp quyền xoá dữ liệu' using errcode = '42501';
  end if;
  update public.staff
  set deleted_at = now(),
      locked_at = coalesce(locked_at, now()),
      locked_reason = 'Đã xoá khỏi danh sách nhân sự',
      accepts_leads = false
  where user_id = p_user_id;
  update public.ads_staff set is_active = false where user_id = p_user_id and deleted_at is null;
end;
$$;

create or replace function public.set_staff_page_access(p_user_id uuid, p_pages text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_manage_account(p_user_id);
  if coalesce(cardinality(p_pages), 0) > 300
     or exists (select 1 from unnest(coalesce(p_pages, '{}')) p where p !~ '^/[a-z0-9/-]{1,80}$') then
    raise exception 'Danh sách trang không hợp lệ' using errcode = '22023';
  end if;
  update public.staff
  set page_access = array(select distinct p from unnest(coalesce(p_pages, '{}')) p order by p)
  where user_id = p_user_id;
end;
$$;

-- Tên đăng nhập / email đăng nhập của các tài khoản (chỉ Quản trị xem) — cho tài khoản cũ chưa có
-- tên đăng nhập (đăng nhập bằng email).
create or replace function public.list_staff_logins()
returns table (user_id uuid, email text) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị xem được' using errcode = '42501';
  end if;
  return query
    select s.user_id, u.email::text
    from public.staff s join auth.users u on u.id = s.user_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function private.role_of_position(text) from public;
revoke all on function private.login_email(text) from public;
revoke all on function private.check_manage_account(uuid, text) from public;
revoke all on function private.sync_auth_ban() from public;
revoke all on function public.create_staff_account(text, text, text, text, uuid) from public, anon;
revoke all on function public.update_staff_account(uuid, text, text, uuid) from public, anon;
revoke all on function public.reset_staff_password(uuid, text) from public, anon;
revoke all on function public.remove_staff_account(uuid) from public, anon;
revoke all on function public.set_staff_page_access(uuid, text[]) from public, anon;
revoke all on function public.list_staff_logins() from public, anon;
grant execute on function public.create_staff_account(text, text, text, text, uuid) to authenticated;
grant execute on function public.update_staff_account(uuid, text, text, uuid) to authenticated;
grant execute on function public.reset_staff_password(uuid, text) to authenticated;
grant execute on function public.remove_staff_account(uuid) to authenticated;
grant execute on function public.set_staff_page_access(uuid, text[]) to authenticated;
grant execute on function public.list_staff_logins() to authenticated;

-- Báo cho lớp API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
