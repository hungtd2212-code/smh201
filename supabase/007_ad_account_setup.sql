-- =====================================================================
-- Smile Hub ERP — MARKETING: NHÂN VIÊN TỰ CÀI ĐẶT TKQC CỦA MÌNH
--
-- Chạy SAU supabase/006_ad_daily_reports.sql. Chạy lại file này nhiều lần
-- cũng không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay
-- đổi gì. Đã chạy file này thì KHÔNG chạy lại 002 → 006 nữa.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: chỉ thêm 2 cột (để trống
-- cho TKQC cũ), 2 hàm, 1 trigger. Tài khoản nào đang có vai trò Nhân viên Ads
-- mà chưa có dòng "nhân viên Ads" thì được tạo thêm dòng đó.
--
-- Thêm:
--   • TKQC có thêm "Loại tài khoản" (TK thuê / Tự build) và "Thanh toán"
--     (Tài khoản cá nhân / Thẻ công ty).
--   • Tài khoản được đặt vai trò Nhân viên Ads (ở Cài đặt → Tài khoản & Phân
--     quyền) tự có dòng nhân viên Ads — không phải khai báo riêng nữa.
--   • add_ad_account(): nhân viên Ads tự thêm TKQC của mình (màn Nhập liệu →
--     Cài đặt TKQC); Quản trị / Trưởng Marketing thêm cho bất kỳ ai. TKQC thêm
--     theo cách này thuộc về người đó "từ trước tới nay" (phân công từ
--     01/01/2020), nên gửi được báo cáo cho cả những ngày đã qua.
--   • remove_ad_account(): nút thùng rác ở Cài đặt TKQC. TKQC chưa có báo cáo
--     → chuyển vào Thùng rác (Quản trị khôi phục được). Đã có báo cáo → chỉ
--     chuyển sang "Ngừng dùng" để giữ nguyên số liệu cũ.
-- =====================================================================
begin;


-- ---------------------------------------------------------------------
-- 1. HAI CỘT MỚI CỦA TKQC
-- ---------------------------------------------------------------------
alter table public.ad_accounts
  add column if not exists account_kind text
    check (account_kind is null or account_kind in ('rented', 'self_built')),         -- TK thuê / Tự build
  add column if not exists payment_kind text
    check (payment_kind is null or payment_kind in ('personal', 'company_card'));     -- TK cá nhân / Thẻ công ty


-- ---------------------------------------------------------------------
-- 2. TÀI KHOẢN VAI TRÒ NHÂN VIÊN ADS TỰ CÓ DÒNG "NHÂN VIÊN ADS"
-- ---------------------------------------------------------------------
-- Trả về dòng ads_staff của tài khoản p_user_id; chưa có thì tạo (hoặc gắn vào
-- dòng cùng tên đang chưa có tài khoản, để giữ số liệu cũ của người đó).
create or replace function private.ensure_ads_staff(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_name text;
  v_try  text;
  v_n    int := 1;
begin
  select a.id into v_id
  from public.ads_staff a
  where a.user_id = p_user_id and a.deleted_at is null
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select s.full_name into v_name from public.staff s where s.user_id = p_user_id;
  if v_name is null then
    return null;
  end if;

  select a.id into v_id
  from public.ads_staff a
  where lower(a.full_name) = lower(v_name) and a.user_id is null and a.deleted_at is null
  limit 1;
  if v_id is not null then
    update public.ads_staff set user_id = p_user_id, is_active = true where id = v_id;
    return v_id;
  end if;

  v_try := left(v_name, 110);
  while exists (
    select 1 from public.ads_staff a where lower(a.full_name) = lower(v_try) and a.deleted_at is null) loop
    v_n := v_n + 1;
    v_try := format('%s (%s)', left(v_name, 110), v_n);
  end loop;

  insert into public.ads_staff (full_name, user_id, created_by)
  values (v_try, p_user_id, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.sync_ads_staff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'ads_staff' and (tg_op = 'INSERT' or old.role is distinct from new.role) then
    perform private.ensure_ads_staff(new.user_id);
  end if;
  return null;
end;
$$;

create or replace trigger sync_ads_staff
  after insert or update of role on public.staff
  for each row execute function private.sync_ads_staff();

-- Tài khoản đã là Nhân viên Ads từ trước khi chạy file này.
select private.ensure_ads_staff(s.user_id)
from public.staff s
where s.role = 'ads_staff'
  and not exists (select 1 from public.ads_staff a where a.user_id = s.user_id and a.deleted_at is null);


-- ---------------------------------------------------------------------
-- 3. THÊM TKQC (nút "+ Thêm TKQC")
-- ---------------------------------------------------------------------
create or replace function public.add_ad_account(
  p_name text, p_account_id text, p_account_kind text, p_payment_kind text, p_ads_staff_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_name    text := btrim(coalesce(p_name, ''));
  -- "act_123 456" → "123456": bỏ khoảng trắng và tiền tố act_ của Facebook.
  v_ext     text := regexp_replace(regexp_replace(lower(coalesce(p_account_id, '')), '\s', '', 'g'), '^act_', '');
  v_staff   uuid;
  v_channel uuid;
  v_found   public.ad_accounts%rowtype;
  v_id      uuid;
begin
  if private.manages_marketing() then
    v_staff := p_ads_staff_id;
    if v_staff is null then
      raise exception 'Chọn nhân viên quảng cáo sở hữu TKQC này' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ads_staff a where a.id = v_staff and a.deleted_at is null) then
      raise exception 'Không tìm thấy nhân viên quảng cáo' using errcode = '22023';
    end if;
  elsif private.staff_role() = 'ads_staff' then
    v_staff := private.ensure_ads_staff(v_uid);
    if p_ads_staff_id is not null and p_ads_staff_id is distinct from v_staff then
      raise exception 'Bạn chỉ thêm được TKQC cho chính mình' using errcode = '42501';
    end if;
  else
    raise exception 'Chỉ nhân viên chạy quảng cáo hoặc quản lý Marketing được thêm TKQC' using errcode = '42501';
  end if;

  if char_length(v_name) not between 1 and 120 then
    raise exception 'Nhập tên tài khoản (tối đa 120 ký tự)' using errcode = '22023';
  end if;
  if v_ext !~ '^[0-9]{5,30}$' then
    raise exception 'ID tài khoản chỉ gồm chữ số, vd 123456789012345' using errcode = '22023';
  end if;
  if p_account_kind is null or p_account_kind not in ('rented', 'self_built') then
    raise exception 'Chọn loại tài khoản: TK thuê hoặc Tự build' using errcode = '22023';
  end if;
  if p_payment_kind is null or p_payment_kind not in ('personal', 'company_card') then
    raise exception 'Chọn thanh toán: tài khoản cá nhân hoặc thẻ công ty' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ad_accounts'), hashtext(v_ext));

  -- Cùng ID đã khai báo: nếu là TKQC của chính người này đang "Ngừng dùng" thì dùng lại.
  select * into v_found
  from public.ad_accounts a
  where a.account_id = v_ext and a.deleted_at is null
  limit 1;
  if found then
    if not v_found.is_active and exists (
         select 1 from public.ad_account_assignments x
         where x.ad_account_id = v_found.id and x.ads_staff_id = v_staff and x.deleted_at is null
           and x.to_date is null) then
      if exists (
           select 1 from public.ad_accounts a
           where lower(a.name) = lower(v_name) and a.deleted_at is null and a.id <> v_found.id) then
        raise exception 'Đã có TKQC tên "%" — hãy đặt tên khác', v_name using errcode = '23505';
      end if;
      update public.ad_accounts
      set is_active = true, name = v_name, account_kind = p_account_kind, payment_kind = p_payment_kind
      where id = v_found.id;
      return v_found.id;
    end if;
    raise exception 'ID tài khoản % đã được khai báo (TKQC "%")', v_ext, v_found.name using errcode = '23505';
  end if;
  if exists (select 1 from public.ad_accounts a where lower(a.name) = lower(v_name) and a.deleted_at is null) then
    raise exception 'Đã có TKQC tên "%" — hãy đặt tên khác', v_name using errcode = '23505';
  end if;

  -- Kênh: Facebook (TKQC hiện đều chạy Facebook); không có thì kênh đầu tiên đang dùng.
  select c.id into v_channel
  from public.channels c
  where c.deleted_at is null and c.is_active
  order by (lower(c.name) = 'facebook') desc, c.sort_order, c.name
  limit 1;
  if v_channel is null then
    raise exception 'Chưa có kênh quảng cáo nào đang dùng' using errcode = '22023';
  end if;

  insert into public.ad_accounts (name, account_id, channel_id, account_kind, payment_kind, created_by)
  values (v_name, v_ext, v_channel, p_account_kind, p_payment_kind, v_uid)
  returning id into v_id;

  insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date, note, created_by)
  values (v_id, v_staff, date '2020-01-01', 'Khai báo ở Nhập liệu → Cài đặt TKQC', v_uid);

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. XOÁ TKQC (nút thùng rác ở Cài đặt TKQC)
-- ---------------------------------------------------------------------
-- Trả về 'trashed' (đã chuyển vào Thùng rác) hoặc 'deactivated' (đã có báo cáo
-- hoặc chiến dịch → chỉ chuyển sang Ngừng dùng, giữ nguyên số liệu).
create or replace function public.remove_ad_account(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_name text;
begin
  select a.name into v_name from public.ad_accounts a where a.id = p_id and a.deleted_at is null;
  if v_name is null then
    raise exception 'Không tìm thấy TKQC (có thể đã bị xoá)' using errcode = '22023';
  end if;
  if not private.manages_marketing() and not private.has_ad_account(p_id, true) then
    raise exception 'Bạn chỉ xoá được TKQC của chính mình' using errcode = '42501';
  end if;

  if exists (select 1 from public.ad_daily_reports r where r.ad_account_id = p_id)
     or exists (select 1 from public.campaigns c where c.ad_account_id = p_id and c.deleted_at is null) then
    update public.ad_accounts set is_active = false where id = p_id;
    return 'deactivated';
  end if;

  perform set_config('app.soft_delete', 'on', true);
  update public.ad_account_assignments
  set deleted_at = now(), deleted_by = v_uid
  where ad_account_id = p_id and deleted_at is null;
  update public.ad_accounts set deleted_at = now(), deleted_by = v_uid where id = p_id;
  perform set_config('app.soft_delete', 'off', true);
  return 'trashed';
end;
$$;


-- ---------------------------------------------------------------------
-- 5. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function private.ensure_ads_staff(uuid) from public;
revoke all on function private.sync_ads_staff() from public;
revoke all on function public.add_ad_account(text, text, text, text, uuid) from public, anon;
revoke all on function public.remove_ad_account(uuid) from public, anon;
grant execute on function public.add_ad_account(text, text, text, text, uuid) to authenticated;
grant execute on function public.remove_ad_account(uuid) to authenticated;

-- Báo cho lớp API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
