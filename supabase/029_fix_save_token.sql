-- =====================================================================
-- Smile Hub ERP — SỬA LỖI "UPDATE requires a WHERE clause" KHI DÁN TOKEN FACEBOOK
--
-- Chạy SAU supabase/027_ads_auto_test.sql. Chạy lại nhiều lần cũng không sao.
-- Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: chỉ thay lại một hàm.
--
-- Lỗi: Supabase chặn mọi câu UPDATE không có WHERE khi gọi từ ứng dụng (pg_safeupdate).
-- Hàm ads_auto_save_token (file 027) xoá lỗi cũ của mọi TKQC bằng một câu UPDATE không có WHERE,
-- nên bấm "Lưu token" luôn báo lỗi và token không được lưu. Sửa: chỉ cập nhật các dòng còn lỗi / đã kiểm tra
-- (cùng kết quả, có WHERE). Phần còn lại của hàm giữ nguyên như file 027.
-- =====================================================================
begin;

create or replace function public.ads_auto_save_token(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_token text := btrim(coalesce(p_token, ''), E' \t\r\n');
  v_today date := private.today_vn();
  v_n     int;
begin
  perform private.ads_auto_guard();
  if v_token !~ '^EAA[A-Za-z0-9]+$' or char_length(v_token) not between 40 and 2000 then
    raise exception 'Token không đúng dạng: token Facebook bắt đầu bằng "EAA" và chỉ gồm chữ và số. Kiểm tra lại, đừng copy thừa dấu cách hay xuống dòng'
      using errcode = '22023';
  end if;
  insert into private.ads_auto_config (id, token, token_hint, token_set_at, token_set_by, last_auto_at)
  values (true, v_token, right(v_token, 4), now(), (select auth.uid()), now())
  on conflict (id) do update
    set token = excluded.token, token_hint = excluded.token_hint,
        token_set_at = excluded.token_set_at, token_set_by = excluded.token_set_by, last_auto_at = now();
  update public.ads_auto_accounts set last_error = null, last_error_at = null, checked_at = null, updated_at = now()
  where last_error is not null or last_error_at is not null or checked_at is not null;
  perform private.ads_auto_queue('account', null, null);
  v_n := private.ads_auto_queue('insights', v_today - 6, v_today);
  return jsonb_build_object('accounts', v_n);
end;
$$;

revoke all on function public.ads_auto_save_token(text) from public, anon;
grant execute on function public.ads_auto_save_token(text) to authenticated;

commit;
