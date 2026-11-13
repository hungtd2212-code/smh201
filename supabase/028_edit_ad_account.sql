-- =====================================================================
-- Smile Hub ERP — SỬA THÔNG TIN TKQC (nút bút ở Nhập liệu → Cài đặt TKQC)
--
-- Chạy SAU supabase/007_ad_account_setup.sql. Chạy lại nhiều lần cũng không sao.
-- Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: chỉ thêm một hàm.
--
-- public.update_ad_account: sửa tên, ID tài khoản, loại tài khoản, thanh toán của một TKQC — cùng các
-- quy tắc như lúc thêm (add_ad_account, file 007):
--   • Quản trị / Trưởng Marketing sửa được mọi TKQC; Nhân viên Ads chỉ sửa TKQC mình đang cầm.
--   • Tên không trùng TKQC khác; ID chỉ gồm chữ số (bỏ "act_" và khoảng trắng), không trùng TKQC khác.
--   • Không đổi người phụ trách ở đây (việc đó ở trang TKQC & Page, có ngày bắt đầu).
--   • Báo cáo cũ gắn với TKQC (không gắn với ID Facebook) nên giữ nguyên. Mọi lần sửa vào Nhật ký hệ thống.
-- =====================================================================
begin;

create or replace function public.update_ad_account(
  p_id uuid, p_name text, p_account_id text, p_account_kind text, p_payment_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  -- "act_123 456" → "123456": bỏ khoảng trắng và tiền tố act_ của Facebook (như add_ad_account).
  v_ext  text := regexp_replace(regexp_replace(lower(coalesce(p_account_id, '')), '\s', '', 'g'), '^act_', '');
  v_row  public.ad_accounts%rowtype;
  v_dup  text;
begin
  select * into v_row from public.ad_accounts a where a.id = p_id and a.deleted_at is null;
  if not found then
    raise exception 'Không tìm thấy TKQC (có thể đã bị xoá)' using errcode = '22023';
  end if;
  if not private.manages_marketing() and not private.has_ad_account(p_id, true) then
    raise exception 'Bạn chỉ sửa được TKQC của chính mình' using errcode = '42501';
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
  select a.name into v_dup from public.ad_accounts a
  where a.account_id = v_ext and a.deleted_at is null and a.id <> p_id limit 1;
  if v_dup is not null then
    raise exception 'ID tài khoản % đã được khai báo (TKQC "%")', v_ext, v_dup using errcode = '23505';
  end if;
  if exists (select 1 from public.ad_accounts a
             where lower(a.name) = lower(v_name) and a.deleted_at is null and a.id <> p_id) then
    raise exception 'Đã có TKQC tên "%" — hãy đặt tên khác', v_name using errcode = '23505';
  end if;

  if (v_row.name, v_row.account_id, v_row.account_kind, v_row.payment_kind)
     is not distinct from (v_name, v_ext, p_account_kind, p_payment_kind) then
    return;   -- không đổi gì: không ghi nhật ký
  end if;
  update public.ad_accounts
  set name = v_name, account_id = v_ext, account_kind = p_account_kind, payment_kind = p_payment_kind
  where id = p_id;
end;
$$;

revoke all on function public.update_ad_account(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_ad_account(uuid, text, text, text, text) to authenticated;

-- Báo cho lớp API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
