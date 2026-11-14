-- =====================================================================
-- 035 — BẢNG LEAD: CỘT "NV ADS" (SỐ NÀY CỦA NHÂN VIÊN ADS NÀO)
--
-- Chỉ THÊM MỘT HÀM ĐỌC. Không thêm / sửa / xoá dữ liệu nào, không đổi bảng nào. Chạy lại nhiều lần được.
--
-- Cột leads.ads_staff_id chỉ có khi trực page chọn bài chạy lúc dán số; số Pancake tự kéo về thì trống. Hàm này tính
-- nhân viên Ads cho từng số theo cùng cách với mục "SĐT theo nhân viên" (file 034):
--   1. Số do Pancake kéo về (lần kéo tạo ra số này trong Lead): quảng cáo khách bấm sau cùng lúc đó → TKQC của quảng
--      cáo → nhân viên phụ trách TKQC vào ngày hôm đó.
--   2. Chưa có (số dán tay, hoặc quảng cáo chưa tra ra TKQC): nhân viên Ads đã lưu sẵn trên số (bài chạy đã chọn).
--   3. Vẫn chưa có: quảng cáo ghi trên số (ads_id) → TKQC → nhân viên phụ trách vào ngày số về.
-- Ai thấy số nào ở bảng Lead thì chỉ lấy được nhân viên Ads của chính những số đó (như quyền xem bảng Lead).
-- Cần chạy sau file 034 (dùng private.pancake_import_ad và cột pancake_imports.ad_ids).
-- =====================================================================

create or replace function public.leads_ads_staff(p_from timestamptz, p_to timestamptz)
returns table (lead_id uuid, ads_staff_id uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > interval '400 days' then
    raise exception 'Khoảng ngày không hợp lệ (tối đa 400 ngày)' using errcode = '22023';
  end if;
  if not private.is_staff() then
    return;
  end if;

  return query
  with l as (
    select l.id, l.ads_staff_id, l.ads_id, (l.created_at at time zone 'Asia/Ho_Chi_Minh')::date as d
    from public.leads l
    where l.created_at >= p_from and l.created_at <= p_to
      and l.deleted_at is null
      and (private.sees_all_leads() or (private.staff_role() = 'sale' and l.assignee_id = auth.uid()))),
  imp as (
    -- Lần Pancake kéo về đã tạo ra số này trong Lead.
    select distinct on (i.lead_id) i.lead_id, private.pancake_import_ad(i.ad_ids, i.ad_id) as ad,
           (i.created_at at time zone 'Asia/Ho_Chi_Minh')::date as d
    from public.pancake_imports i
    where i.outcome = 'new' and i.lead_id in (select l.id from l)
    order by i.lead_id, i.created_at, i.id),
  acc as (
    select distinct on (private.fb_account_digits(t.account_id)) private.fb_account_digits(t.account_id) as fb, t.id
    from public.ad_accounts t
    where t.deleted_at is null and private.fb_account_digits(t.account_id) is not null
    order by private.fb_account_digits(t.account_id), t.is_active desc, t.created_at desc),
  owner as (
    -- Quảng cáo + ngày → nhân viên phụ trách TKQC của quảng cáo vào ngày đó.
    select x.id,
           (select a.ads_staff_id
            from private.ads_ad_map m
            join acc on acc.fb = m.fb_account_id
            join public.ad_account_assignments a on a.ad_account_id = acc.id and a.deleted_at is null
             and a.from_date <= coalesce(imp.d, x.d) and (a.to_date is null or a.to_date >= coalesce(imp.d, x.d))
            where m.ad_id = imp.ad
            order by a.from_date desc limit 1) as by_pancake,
           x.ads_staff_id as saved,
           (select a.ads_staff_id
            from private.ads_ad_map m
            join acc on acc.fb = m.fb_account_id
            join public.ad_account_assignments a on a.ad_account_id = acc.id and a.deleted_at is null
             and a.from_date <= x.d and (a.to_date is null or a.to_date >= x.d)
            where m.ad_id = nullif(btrim(x.ads_id), '')
            order by a.from_date desc limit 1) as by_ad
    from l x
    left join imp on imp.lead_id = x.id)
  select o.id, coalesce(o.by_pancake, o.saved, o.by_ad)
  from owner o
  where coalesce(o.by_pancake, o.saved, o.by_ad) is not null;
end;
$$;

revoke all on function public.leads_ads_staff(timestamptz, timestamptz) from public, anon;
grant execute on function public.leads_ads_staff(timestamptz, timestamptz) to authenticated;
