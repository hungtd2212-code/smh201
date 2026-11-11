-- =====================================================================
-- Smile Hub ERP — MARKETING: "DATA XIN ĐƯỢC" GHI CHUNG CHO CẢ NGÀY
--
-- Chạy SAU supabase/008_staff_accounts.sql (009 chạy hay chưa đều được).
-- Chạy lại file này nhiều lần cũng không sao. Toàn bộ nằm trong một giao
-- dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: thêm 1 bảng, và cho cột
-- data_count của báo cáo TKQC giá trị mặc định 0 (không còn phải nhập).
--
-- Lý do (chủ phòng khám, 12/11/2026): lúc nhập liệu, nhân viên Ads biết từng
-- TKQC tiêu bao nhiêu tiền, ra bao nhiêu mess; còn số điện thoại xin được thì
-- lấy từ trực page nên chỉ biết TỔNG của cả ngày, không biết số nào ra từ TKQC
-- nào. Vì vậy "Data xin được" ghi một dòng chung cho mỗi (ngày, nhân viên Ads).
--
-- Quy tắc giống báo cáo TKQC (file 006):
--   • Nhân viên Ads chỉ gửi / xem số của chính mình; Quản trị và Trưởng
--     Marketing: tất cả (nhập thay được).
--   • Mỗi (ngày, nhân viên) gửi một lần, không gửi cho ngày chưa tới.
--   • Nhân viên sửa được trong 24 giờ kể từ lúc gửi lần đầu; quản lý sửa bất
--     kỳ lúc nào. Không ai xoá được. Mọi lần gửi / sửa vào Nhật ký hệ thống.
-- =====================================================================
begin;


-- ---------------------------------------------------------------------
-- 1. BẢNG DATA XIN ĐƯỢC THEO NGÀY, THEO NHÂN VIÊN ADS
-- ---------------------------------------------------------------------
create table if not exists public.ads_daily_data (
  id           uuid primary key default gen_random_uuid(),
  report_date  date not null,
  ads_staff_id uuid not null references public.ads_staff (id),
  data_count   int not null check (data_count >= 0),     -- số điện thoại xin được trong ngày (mọi TKQC)
  user_id      uuid default auth.uid() references auth.users (id) on delete set null,  -- tài khoản bấm Gửi
  submitted_at timestamptz not null default now(),       -- lúc gửi lần đầu, không bao giờ đổi
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,
  constraint ads_daily_data_day_staff_key unique (report_date, ads_staff_id)
);
create index if not exists ads_daily_data_staff_idx on public.ads_daily_data (ads_staff_id, report_date);

-- Báo cáo TKQC không còn ô "Data xin được" riêng.
alter table public.ad_daily_reports alter column data_count set default 0;


-- ---------------------------------------------------------------------
-- 2. KIỂM TRA KHI GỬI / SỬA
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
  if new.data_count is not distinct from old.data_count then
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

create or replace trigger ads_daily_data_guard
  before insert or update on public.ads_daily_data
  for each row execute function private.ads_daily_data_guard();

create or replace trigger zz_audit
  after insert or update or delete on public.ads_daily_data
  for each row execute function private.audit_row('id', 'updated_at,updated_by');

-- Hoàn tác (như bản ở file 006, thêm bảng này).
create or replace function private.undoable_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['leads', 'channels', 'services', 'pages', 'campaigns', 'staff_shifts',
               'ads_staff', 'ad_accounts', 'ad_account_assignments', 'ad_posts',
               'ad_daily_reports', 'ads_daily_data'];
$$;

create or replace function private.undo_excluded(p_table text)
returns text[] language sql immutable set search_path = '' as $$
  select array['id', 'created_at', 'created_by', 'updated_at']
      || case p_table
           when 'leads' then array['touch_count', 'last_touch_at']
           when 'ad_posts' then array['platform', 'post_id', 'post_key']
           when 'ad_daily_reports' then array['report_date', 'ad_account_id', 'user_id', 'submitted_at', 'updated_by']
           when 'ads_daily_data' then array['report_date', 'ads_staff_id', 'user_id', 'submitted_at', 'updated_by']
           else array[]::text[]
         end;
$$;


-- ---------------------------------------------------------------------
-- 3. PHÂN QUYỀN (RLS) — không ai có quyền xoá
-- ---------------------------------------------------------------------
alter table public.ads_daily_data enable row level security;

drop policy if exists ads_daily_data_select on public.ads_daily_data;
create policy ads_daily_data_select on public.ads_daily_data
  for select to authenticated
  using ((select private.manages_marketing()) or ads_staff_id = (select private.my_ads_staff_id()));

drop policy if exists ads_daily_data_insert on public.ads_daily_data;
create policy ads_daily_data_insert on public.ads_daily_data
  for insert to authenticated
  with check ((select private.manages_marketing()) or ads_staff_id = (select private.my_ads_staff_id()));

drop policy if exists ads_daily_data_update on public.ads_daily_data;
create policy ads_daily_data_update on public.ads_daily_data
  for update to authenticated
  using ((select private.manages_marketing()) or ads_staff_id = (select private.my_ads_staff_id()))
  with check ((select private.manages_marketing()) or ads_staff_id = (select private.my_ads_staff_id()));

revoke all on public.ads_daily_data from anon, authenticated;
grant select on public.ads_daily_data to authenticated;
grant insert (report_date, ads_staff_id, data_count) on public.ads_daily_data to authenticated;
grant update (data_count) on public.ads_daily_data to authenticated;

revoke all on function private.ads_daily_data_guard() from public;

-- Báo cho lớp API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
