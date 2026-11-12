-- =====================================================================
-- Smile Hub ERP — MARKETING: "DOANH THU THEO NGÀY" BÊN CẠNH "DATA XIN ĐƯỢC"
--
-- Chạy SAU supabase/014_monthly_targets.sql (015 → 017 chạy hay chưa đều
-- được). Chạy lại file này nhiều lần cũng không sao. Toàn bộ nằm trong một
-- giao dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: thêm 1 cột (để trống) vào
-- bảng ads_daily_data, cập nhật hàm kiểm tra và bảng vinh danh.
--
-- Lý do (chủ phòng khám, 12/11/2026): lúc nhập liệu, cạnh ô "Data xin được"
-- có thêm ô "Doanh thu theo ngày". Không bắt buộc — chưa biết thì để trống,
-- vào Tổng quan sửa lại trong 24 giờ kể từ lúc gửi (quản lý sửa bất kỳ lúc
-- nào). Sau này khi Telesale / Tư vấn nhập doanh thu thì bỏ ô này hoặc dùng
-- làm số tham chiếu.
--
-- Cách tính doanh thu tháng của một nhân viên Ads (tỉ lệ Ads / doanh thu,
-- mục tiêu doanh thu, bảng vinh danh):
--   • Quản lý đã nhập doanh thu tháng (bảng ad_revenue, file 013) và > 0
--     → dùng số của quản lý.
--   • Chưa nhập (hoặc để 0) → cộng doanh thu theo ngày nhân viên đã nhập.
--   Không bao giờ cộng cả hai (không tính trùng).
-- =====================================================================
begin;


-- ---------------------------------------------------------------------
-- 1. CỘT DOANH THU THEO NGÀY (để trống = chưa nhập)
-- ---------------------------------------------------------------------
alter table public.ads_daily_data
  add column if not exists revenue bigint check (revenue >= 0);   -- đồng; null = chưa nhập

comment on column public.ads_daily_data.revenue is
  'Doanh thu theo ngày (đ) nhân viên Ads tự nhập — không bắt buộc. Quản lý nhập doanh thu tháng (ad_revenue) thì dùng số của quản lý.';


-- ---------------------------------------------------------------------
-- 2. KIỂM TRA KHI GỬI / SỬA — như file 010, thêm cột doanh thu:
--    đổi data HOẶC doanh thu đều tính là sửa (nhân viên: trong 24 giờ).
-- ---------------------------------------------------------------------
create or replace function private.ads_daily_data_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid    := (select auth.uid());
  v_manager boolean := v_uid is null or private.manages_marketing();
begin
  if tg_op = 'INSERT' then
    if new.report_date is null or new.report_date > private.today_vn() then
      raise exception 'Không gửi báo cáo cho ngày chưa tới' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ads_staff a where a.id = new.ads_staff_id and a.deleted_at is null) then
      raise exception 'Không tìm thấy nhân viên Ads' using errcode = '22023';
    end if;
    if not v_manager and private.my_ads_staff_id() is distinct from new.ads_staff_id then
      raise exception 'Bạn chỉ gửi được số liệu của chính mình' using errcode = '42501';
    end if;
    if v_uid is not null then
      new.user_id := v_uid;
    end if;
    new.submitted_at := now();
    new.updated_at := now();
    new.updated_by := null;
    return new;
  end if;

  -- SỬA
  if new.report_date is distinct from old.report_date or new.ads_staff_id is distinct from old.ads_staff_id then
    raise exception 'Không đổi được ngày hoặc nhân viên của báo cáo đã gửi' using errcode = '22023';
  end if;
  new.submitted_at := old.submitted_at;   -- mốc 24 giờ không bao giờ đổi
  new.user_id := old.user_id;
  if new.data_count is not distinct from old.data_count and new.revenue is not distinct from old.revenue then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
    return new;
  end if;
  if not v_manager and now() >= old.submitted_at + interval '24 hours' then
    raise exception 'Báo cáo đã quá 24 giờ, không thể sửa' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.updated_by := v_uid;
  return new;
end;
$$;
revoke all on function private.ads_daily_data_guard() from public;


-- ---------------------------------------------------------------------
-- 3. QUYỀN GHI CỘT MỚI (vẫn không ai xoá được)
-- ---------------------------------------------------------------------
grant insert (report_date, ads_staff_id, data_count, revenue) on public.ads_daily_data to authenticated;
grant update (data_count, revenue) on public.ads_daily_data to authenticated;


-- ---------------------------------------------------------------------
-- 4. BẢNG VINH DANH — như file 014; doanh thu = số quản lý nhập (nếu > 0),
--    chưa nhập thì cộng doanh thu theo ngày.
-- ---------------------------------------------------------------------
create or replace function public.ads_leaderboard(p_month date)
returns table (
  ads_staff_id      uuid,
  full_name         text,
  avatar_url        text,
  is_active         boolean,
  spend             bigint,
  messages          bigint,
  data_count        bigint,
  revenue           bigint,
  data_target       int,
  max_cost_per_data int
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
begin
  if not ((select private.manages_marketing()) or (select private.my_ads_staff_id()) is not null) then
    raise exception 'Chỉ nhân viên Ads, Trưởng Marketing và Quản trị xem được bảng vinh danh' using errcode = '42501';
  end if;
  return query
  with owned as (
    select distinct on (r.id) r.report_date, r.spend, r.messages, r.data_count, x.ads_staff_id as sid
    from public.ad_daily_reports r
    join public.ad_account_assignments x
      on x.ad_account_id = r.ad_account_id and x.deleted_at is null
     and x.from_date <= r.report_date and (x.to_date is null or x.to_date >= r.report_date)
    where r.report_date between v_from and v_to
    order by r.id, x.from_date desc
  ),
  per_day as (
    select o.sid, o.report_date, sum(o.spend) as spend, sum(o.messages) as messages, sum(o.data_count) as legacy
    from owned o group by o.sid, o.report_date
  ),
  shared_data as (
    select d.ads_staff_id as sid, d.report_date, d.data_count
    from public.ads_daily_data d where d.report_date between v_from and v_to
  ),
  merged as (
    select coalesce(p.sid, d.sid) as sid,
           coalesce(p.spend, 0) as spend,
           coalesce(p.messages, 0) as messages,
           coalesce(d.data_count, p.legacy, 0) as data
    from per_day p full join shared_data d on d.sid = p.sid and d.report_date = p.report_date
  ),
  totals as (
    select m.sid, sum(m.spend)::bigint as spend, sum(m.messages)::bigint as messages, sum(m.data)::bigint as data
    from merged m group by m.sid
  ),
  money as (
    select v.ads_staff_id as sid, sum(v.amount)::bigint as revenue
    from public.ad_revenue v where v.month = v_from and v.ads_staff_id is not null group by v.ads_staff_id
  ),
  daily_money as (
    select d.ads_staff_id as sid, sum(d.revenue)::bigint as revenue
    from public.ads_daily_data d
    where d.report_date between v_from and v_to and d.revenue is not null
    group by d.ads_staff_id
  )
  select a.id, a.full_name::text, s.avatar_url, a.is_active,
         coalesce(t.spend, 0::bigint), coalesce(t.messages, 0::bigint), coalesce(t.data, 0::bigint),
         coalesce(nullif(mo.revenue, 0), dm.revenue, 0::bigint),
         own.monthly_data,
         coalesce(own.max_cost_per_data, team.max_cost_per_data)
  from public.ads_staff a
  left join public.staff s on s.user_id = a.user_id
  left join totals t on t.sid = a.id
  left join money mo on mo.sid = a.id
  left join daily_money dm on dm.sid = a.id
  left join lateral (
    select g.monthly_data, g.max_cost_per_data from public.ad_targets g
    where g.ads_staff_id = a.id and g.month <= v_from order by g.month desc limit 1
  ) own on true
  left join lateral (
    select g.max_cost_per_data from public.ad_targets g
    where g.ads_staff_id is null and g.month <= v_from order by g.month desc limit 1
  ) team on true
  where a.deleted_at is null and (a.is_active or t.sid is not null or mo.sid is not null or dm.sid is not null)
  order by a.full_name;
end;
$$;
revoke all on function public.ads_leaderboard(date) from public, anon;
grant execute on function public.ads_leaderboard(date) to authenticated;

-- Báo cho lớp API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
