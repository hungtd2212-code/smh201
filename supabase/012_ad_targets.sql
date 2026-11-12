-- =====================================================================
-- Smile Hub ERP — MARKETING: MỤC TIÊU QUẢNG CÁO (ngân sách, data, giá tối đa)
--
-- Chạy SAU supabase/010_ads_daily_data.sql (011 chạy hay chưa đều được).
-- Chạy lại file này nhiều lần cũng không sao. Toàn bộ nằm trong một giao
-- dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: chỉ thêm 1 bảng mới.
--
-- Lý do (chủ phòng khám, 12/11/2026): đặt mục tiêu để màn Tổng quan hiện
-- thanh tiến độ và cảnh báo khi vượt — ví dụ giá data tối đa 150.000đ,
-- ngân sách tháng 300 triệu, data mục tiêu 1.500 / tháng.
--
--   • Một dòng "cả nhóm" (ads_staff_id trống) + tuỳ ý mỗi nhân viên Ads một dòng.
--   • Ô để trống = không đặt mục tiêu đó. Giá tối đa của nhân viên để trống
--     thì màn hình dùng giá tối đa của cả nhóm.
--   • Quản trị và Trưởng Marketing đặt / sửa. Nhân viên Ads chỉ xem dòng cả nhóm
--     và dòng của mình. Không ai xoá (muốn bỏ thì để trống các ô).
--   • Mọi lần sửa vào Nhật ký hệ thống.
-- =====================================================================
begin;

create table if not exists public.ad_targets (
  id                   uuid primary key default gen_random_uuid(),
  ads_staff_id         uuid references public.ads_staff (id),           -- trống = cả nhóm
  monthly_budget       bigint check (monthly_budget is null or monthly_budget >= 0),             -- ngân sách / tháng (đ)
  monthly_data         int check (monthly_data is null or monthly_data >= 0),                    -- data mục tiêu / tháng
  max_cost_per_message int check (max_cost_per_message is null or max_cost_per_message >= 0),    -- giá mess tối đa (đ)
  max_cost_per_data    int check (max_cost_per_data is null or max_cost_per_data >= 0),          -- giá data tối đa (đ)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid default auth.uid() references auth.users (id) on delete set null
);
-- Chỉ một dòng "cả nhóm" và mỗi nhân viên một dòng.
create unique index if not exists ad_targets_team_key on public.ad_targets ((ads_staff_id is null)) where ads_staff_id is null;
create unique index if not exists ad_targets_staff_key on public.ad_targets (ads_staff_id) where ads_staff_id is not null;

create or replace function private.ad_targets_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.ads_staff_id is distinct from old.ads_staff_id then
    raise exception 'Không đổi được mục tiêu sang người khác' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and new.ads_staff_id is not null
     and not exists (select 1 from public.ads_staff a where a.id = new.ads_staff_id and a.deleted_at is null) then
    raise exception 'Không tìm thấy nhân viên Ads' using errcode = '22023';
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace trigger ad_targets_guard
  before insert or update on public.ad_targets
  for each row execute function private.ad_targets_guard();

create or replace trigger zz_audit
  after insert or update or delete on public.ad_targets
  for each row execute function private.audit_row('id', 'updated_at,updated_by');

alter table public.ad_targets enable row level security;

drop policy if exists ad_targets_select on public.ad_targets;
create policy ad_targets_select on public.ad_targets
  for select to authenticated
  using (
    (select private.manages_marketing())
    or ads_staff_id is null and (select private.my_ads_staff_id()) is not null
    or ads_staff_id = (select private.my_ads_staff_id())
  );

drop policy if exists ad_targets_insert on public.ad_targets;
create policy ad_targets_insert on public.ad_targets
  for insert to authenticated
  with check ((select private.manages_marketing()));

drop policy if exists ad_targets_update on public.ad_targets;
create policy ad_targets_update on public.ad_targets
  for update to authenticated
  using ((select private.manages_marketing()))
  with check ((select private.manages_marketing()));

revoke all on public.ad_targets from anon, authenticated;
grant select on public.ad_targets to authenticated;
grant insert (ads_staff_id, monthly_budget, monthly_data, max_cost_per_message, max_cost_per_data) on public.ad_targets to authenticated;
grant update (monthly_budget, monthly_data, max_cost_per_message, max_cost_per_data) on public.ad_targets to authenticated;

revoke all on function private.ad_targets_guard() from public;

notify pgrst, 'reload schema';

commit;
