-- =====================================================================
-- Smile Hub ERP — DOANH THU TỪ ADS, ẢNH ĐẠI DIỆN, BẢNG VINH DANH
--
-- Chạy SAU supabase/012_ad_targets.sql. Chạy lại nhiều lần cũng không sao.
-- Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: thêm 1 bảng, 1 cột, 1 kho
-- ảnh và 2 hàm.
--
-- Lý do (chủ phòng khám, 12/11/2026):
--   1. Doanh thu tháng mang về từ quảng cáo — để tính tỉ lệ chi phí ads /
--      doanh thu, so với mục tiêu doanh thu và vinh danh nhân viên Ads. Khi chưa
--      có phân hệ Thu ngân, Quản trị / Trưởng Marketing nhập theo tháng cho
--      từng nhân viên Ads (hoặc dòng "chưa rõ nhân viên").
--   2. Ảnh đại diện cho mỗi người (Quản trị thêm khi tạo / sửa tài khoản; mỗi
--      người tự đổi ảnh của mình được) — để báo cáo có mặt người.
--   3. Bảng vinh danh top 3: nhân viên Ads xem được tổng tháng của cả nhóm
--      (chi tiêu, mess, data, doanh thu, mục tiêu data) để so thứ hạng.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. DOANH THU THEO THÁNG
-- ---------------------------------------------------------------------
create table if not exists public.ad_revenue (
  id           uuid primary key default gen_random_uuid(),
  month        date not null check (extract(day from month) = 1),     -- ngày 1 của tháng
  ads_staff_id uuid references public.ads_staff (id),                  -- trống = chưa rõ nhân viên
  amount       bigint not null check (amount >= 0),                    -- doanh thu (đ)
  note         text check (note is null or char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid() references auth.users (id) on delete set null
);
create unique index if not exists ad_revenue_month_unassigned_key on public.ad_revenue (month) where ads_staff_id is null;
create unique index if not exists ad_revenue_month_staff_key on public.ad_revenue (month, ads_staff_id) where ads_staff_id is not null;

create or replace function private.ad_revenue_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.month := date_trunc('month', new.month)::date;
    if new.ads_staff_id is not null
       and not exists (select 1 from public.ads_staff a where a.id = new.ads_staff_id and a.deleted_at is null) then
      raise exception 'Không tìm thấy nhân viên Ads' using errcode = '22023';
    end if;
  elsif new.month is distinct from old.month or new.ads_staff_id is distinct from old.ads_staff_id then
    raise exception 'Không đổi được tháng hoặc nhân viên của doanh thu đã nhập' using errcode = '22023';
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create or replace trigger ad_revenue_guard
  before insert or update on public.ad_revenue
  for each row execute function private.ad_revenue_guard();

create or replace trigger zz_audit
  after insert or update or delete on public.ad_revenue
  for each row execute function private.audit_row('id', 'updated_at,updated_by');

alter table public.ad_revenue enable row level security;

drop policy if exists ad_revenue_select on public.ad_revenue;
create policy ad_revenue_select on public.ad_revenue
  for select to authenticated
  using ((select private.manages_marketing()) or ads_staff_id = (select private.my_ads_staff_id()));

drop policy if exists ad_revenue_insert on public.ad_revenue;
create policy ad_revenue_insert on public.ad_revenue
  for insert to authenticated with check ((select private.manages_marketing()));

drop policy if exists ad_revenue_update on public.ad_revenue;
create policy ad_revenue_update on public.ad_revenue
  for update to authenticated
  using ((select private.manages_marketing())) with check ((select private.manages_marketing()));

revoke all on public.ad_revenue from anon, authenticated;
grant select on public.ad_revenue to authenticated;
grant insert (month, ads_staff_id, amount, note) on public.ad_revenue to authenticated;
grant update (amount, note) on public.ad_revenue to authenticated;
revoke all on function private.ad_revenue_guard() from public;


-- ---------------------------------------------------------------------
-- 2. ẢNH ĐẠI DIỆN
-- ---------------------------------------------------------------------
alter table public.staff add column if not exists avatar_url text;

-- Đặt / bỏ ảnh đại diện: Quản trị đặt cho mọi người; mỗi người tự đặt cho mình.
-- Chỉ nhận ảnh trong kho "avatars" của Supabase.
create or replace function public.set_staff_avatar(p_user_id uuid, p_url text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_admin() or p_user_id = (select auth.uid())) then
    raise exception 'Chỉ Quản trị hoặc chính người đó đổi được ảnh đại diện' using errcode = '42501';
  end if;
  if p_url is not null and p_url !~ '^https://[^\s]+/storage/v1/object/public/avatars/[^\s]+$' then
    raise exception 'Ảnh đại diện không hợp lệ' using errcode = '22023';
  end if;
  update public.staff set avatar_url = p_url where user_id = p_user_id and deleted_at is null;
  if not found then
    raise exception 'Không tìm thấy tài khoản' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.set_staff_avatar(uuid, text) from public, anon;
grant execute on function public.set_staff_avatar(uuid, text) to authenticated;

-- Kho ảnh "avatars" (ai cũng xem được ảnh qua đường link; tối đa 2 MB, chỉ JPG / PNG / WEBP).
-- Tải lên: Quản trị (mọi thư mục) hoặc chính người đó (thư mục mang mã tài khoản của mình).
-- Bỏ qua phần này khi chạy thử ngoài Supabase (không có kho ảnh).
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  execute 'drop policy if exists avatars_insert on storage.objects';
  execute $p$
    create policy avatars_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'avatars'
      and (private.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
    )$p$;
  execute 'drop policy if exists avatars_delete on storage.objects';
  execute $p$
    create policy avatars_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'avatars'
      and (private.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
    )$p$;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. BẢNG VINH DANH: tổng một tháng của từng nhân viên Ads
--    (cùng cách tính như màn Tổng quan: báo cáo TKQC tính cho người cầm TKQC
--    ngày đó; data lấy dòng "Data xin được" chung, ngày chưa có dòng chung thì
--    cộng data ở báo cáo TKQC cũ).
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
  left join public.ad_targets own on own.ads_staff_id = a.id
  left join public.ad_targets team on team.ads_staff_id is null
  where a.deleted_at is null and (a.is_active or t.sid is not null or mo.sid is not null)
  order by a.full_name;
end;
$$;
revoke all on function public.ads_leaderboard(date) from public, anon;
grant execute on function public.ads_leaderboard(date) to authenticated;

notify pgrst, 'reload schema';

commit;
