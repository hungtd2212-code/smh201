-- =====================================================================
-- Smile Hub ERP — MỤC TIÊU QUẢNG CÁO THEO TỪNG THÁNG + LỊCH SỬ CHỈNH SỬA
--
-- Chạy SAU supabase/013_revenue_avatars.sql. Chạy lại nhiều lần cũng không
-- sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
-- Sau file này ĐỪNG chạy lại 012 (nó tạo lại khoá "mỗi người một dòng").
--
-- Lý do (chủ phòng khám, 12/11/2026): Quản trị / Trưởng Marketing đặt mục
-- tiêu từ đầu mỗi tháng (mỗi tháng một bộ), sửa thì có lịch sử biết ai sửa,
-- nhập mục tiêu chung rồi tự động phân bổ xuống từng nhân viên.
--
--   • ad_targets thêm cột month (ngày 1 của tháng): mỗi tháng một dòng "cả
--     nhóm" và mỗi nhân viên một dòng. Tháng chưa đặt thì dùng mục tiêu của
--     tháng gần nhất trước đó.
--   • Dòng mục tiêu đã có (nếu có) được gán vào tháng nó được tạo. Lúc viết
--     file này bảng chưa có dòng nào.
--   • Hàm ad_targets_history: lịch sử đặt / sửa mục tiêu (ai, lúc nào, đổi gì)
--     lấy từ Nhật ký hệ thống — cho Quản trị và Trưởng Marketing.
-- =====================================================================
begin;

alter table public.ad_targets add column if not exists month date;
update public.ad_targets
set month = date_trunc('month', created_at at time zone 'Asia/Ho_Chi_Minh')::date
where month is null;
alter table public.ad_targets alter column month set not null;
alter table public.ad_targets drop constraint if exists ad_targets_month_first_day;
alter table public.ad_targets add constraint ad_targets_month_first_day check (extract(day from month) = 1);

-- Mỗi tháng: một dòng cả nhóm, mỗi nhân viên một dòng.
drop index if exists public.ad_targets_team_key;
drop index if exists public.ad_targets_staff_key;
create unique index if not exists ad_targets_team_month_key on public.ad_targets (month) where ads_staff_id is null;
create unique index if not exists ad_targets_staff_month_key on public.ad_targets (month, ads_staff_id) where ads_staff_id is not null;
create index if not exists ad_targets_month_idx on public.ad_targets (month);

create or replace function private.ad_targets_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.month := date_trunc('month', coalesce(new.month, private.today_vn()))::date;
    if new.ads_staff_id is not null
       and not exists (select 1 from public.ads_staff a where a.id = new.ads_staff_id and a.deleted_at is null) then
      raise exception 'Không tìm thấy nhân viên Ads' using errcode = '22023';
    end if;
  else
    if new.ads_staff_id is distinct from old.ads_staff_id or new.month is distinct from old.month then
      raise exception 'Không đổi được tháng hoặc người của mục tiêu đã đặt' using errcode = '22023';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

revoke insert on public.ad_targets from authenticated;
grant insert (month, ads_staff_id, monthly_budget, monthly_data, max_cost_per_message, max_cost_per_data,
              monthly_revenue, max_ad_revenue_pct) on public.ad_targets to authenticated;


-- ---------------------------------------------------------------------
-- Bảng vinh danh: mục tiêu của tháng đó (chưa đặt thì lấy tháng gần nhất trước đó).
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
  )
  select a.id, a.full_name::text, s.avatar_url, a.is_active,
         coalesce(t.spend, 0::bigint), coalesce(t.messages, 0::bigint), coalesce(t.data, 0::bigint),
         coalesce(mo.revenue, 0::bigint),
         own.monthly_data,
         coalesce(own.max_cost_per_data, team.max_cost_per_data)
  from public.ads_staff a
  left join public.staff s on s.user_id = a.user_id
  left join totals t on t.sid = a.id
  left join money mo on mo.sid = a.id
  left join lateral (
    select g.monthly_data, g.max_cost_per_data from public.ad_targets g
    where g.ads_staff_id = a.id and g.month <= v_from order by g.month desc limit 1
  ) own on true
  left join lateral (
    select g.max_cost_per_data from public.ad_targets g
    where g.ads_staff_id is null and g.month <= v_from order by g.month desc limit 1
  ) team on true
  where a.deleted_at is null and (a.is_active or t.sid is not null or mo.sid is not null)
  order by a.full_name;
end;
$$;
revoke all on function public.ads_leaderboard(date) from public, anon;
grant execute on function public.ads_leaderboard(date) to authenticated;


-- ---------------------------------------------------------------------
-- Lịch sử đặt / sửa mục tiêu (mới nhất trước).
-- ---------------------------------------------------------------------
create or replace function public.ad_targets_history(p_limit int default 300)
returns table (
  id           bigint,
  at           timestamptz,
  action       text,
  actor_name   text,
  target_id    uuid,
  month        date,
  ads_staff_id uuid,
  old_data     jsonb,
  new_data     jsonb
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (select private.manages_marketing()) then
    raise exception 'Chỉ Quản trị và Trưởng Marketing xem được lịch sử mục tiêu' using errcode = '42501';
  end if;
  return query
  select l.id, l.at, l.action,
         coalesce(s.full_name, case when l.actor_id is null then 'Hệ thống' else 'Tài khoản đã xoá' end)::text,
         t.id, t.month, t.ads_staff_id, l.old_data, l.new_data
  from public.audit_log l
  left join public.ad_targets t on t.id::text = l.record_id
  left join public.staff s on s.user_id = l.actor_id
  where l.table_name = 'ad_targets'
  order by l.id desc
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
end;
$$;
revoke all on function public.ad_targets_history(int) from public, anon;
grant execute on function public.ad_targets_history(int) to authenticated;

notify pgrst, 'reload schema';

commit;
