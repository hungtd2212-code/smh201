-- =====================================================================
-- Smile Hub ERP — BÁO CÁO TELEGRAM: MẪU TIN CHI TIẾT (mess theo trình quảng cáo và mess theo Pancake)
--
-- Chạy SAU supabase/032_telegram_report.sql. Chạy lại nhiều lần cũng không sao.
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu: chỉ đổi cách soạn tin (private.telegram_report).
--
-- Mẫu mới (chủ phòng khám gửi 14/11/2026), mỗi nhân viên Ads một tin:
--   BC ngày 12/11 - Sang
--   Chi tiêu: 764.868                ← Facebook
--
--   Mess trình: 5                    ← trình quản lý quảng cáo Facebook: lượt bắt đầu trò chuyện qua tin nhắn
--   Giá mess trình: 152.974          ← chi tiêu / mess trình
--   Mess pan: 7                      ← thống kê quảng cáo Pancake
--   Giá mess pan: 109.267            ← chi tiêu / mess pan
--   -------
--   Data: 1                          ← số điện thoại theo Pancake
--   Giá Data: 764.868                ← chi tiêu / data
--   Tỷ lệ xin số: 20%                ← data / mess trình (như mẫu: 1 / 5)
-- =====================================================================
begin;

create or replace function private.telegram_report(p_day date)
returns table (seq int, title text, body text)
language sql stable security definer set search_path = '' as $$
  with r as (
    select c.* from private.ads_auto_compare_rows(p_day, p_day) c where c.ad_account_id is not null),
  g as (
    select private.telegram_staff_name(s.full_name) as who,
           sum(case when upper(coalesce(r.auto_currency, 'VND')) = 'VND' then coalesce(r.auto_spend, 0) else 0 end) as spend,
           sum(coalesce(r.auto_conversations, 0)) as mess_fb,
           sum(coalesce(r.pancake_messages, 0)) as mess_pan,
           sum(coalesce(r.pancake_phones, 0)) as data
    from r left join public.ads_staff s on s.id = r.ads_staff_id
    group by 1)
  select (row_number() over (order by g.spend desc, g.who))::int, g.who,
         'BC ngày ' || to_char(p_day, 'FMDD/FMMM') || ' - ' || g.who || E'\n'
         || 'Chi tiêu: ' || private.vn_int(g.spend) || E'\n'
         || E'\n'
         || 'Mess trình: ' || private.vn_int(g.mess_fb) || E'\n'
         || 'Giá mess trình: ' || case when g.mess_fb > 0 then private.vn_int(g.spend / g.mess_fb) else '0' end || E'\n'
         || 'Mess pan: ' || private.vn_int(g.mess_pan) || E'\n'
         || 'Giá mess pan: ' || case when g.mess_pan > 0 then private.vn_int(g.spend / g.mess_pan) else '0' end || E'\n'
         || '-------' || E'\n'
         || 'Data: ' || private.vn_int(g.data) || E'\n'
         || 'Giá Data: ' || case when g.data > 0 then private.vn_int(g.spend / g.data) else '0' end || E'\n'
         || 'Tỷ lệ xin số: ' || private.vn_pct(g.data, g.mess_fb)
  from g
  where g.spend > 0 or g.mess_fb > 0 or g.mess_pan > 0 or g.data > 0
  order by 1;
$$;
revoke all on function private.telegram_report(date) from public, anon, authenticated;

commit;
