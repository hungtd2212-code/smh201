-- =====================================================================
-- Smile Hub ERP — MARKETING: BÁO CÁO ADS HẰNG NGÀY (Nhập liệu + Tổng quan)
--
-- Chạy SAU supabase/005_marketing_catalog.sql. Chạy lại file này nhiều lần
-- cũng không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay
-- đổi gì. Đã chạy file này thì KHÔNG chạy lại 002 → 005 nữa.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: chỉ thêm 1 bảng và các
-- quy tắc của bảng đó.
--
-- Bảng ad_daily_reports: mỗi (ngày, TK ADS) một báo cáo gồm chi tiêu (đồng),
-- số lượng tin nhắn, data xin được — đều là số nguyên ≥ 0, bắt buộc.
--
-- Quy tắc (chặn ngay trong cơ sở dữ liệu, không chỉ ẩn nút):
--   • Nhân viên Ads chỉ xem / gửi báo cáo của TK ADS mình phụ trách vào ngày
--     đó (theo bảng phân công TKQC). Quản trị và Trưởng Marketing: tất cả.
--   • Mỗi (ngày, TK ADS) chỉ gửi một lần. Không gửi cho ngày chưa tới.
--   • submitted_at = lúc gửi lần đầu, không bao giờ đổi. Nhân viên chỉ sửa
--     được trong 24 giờ kể từ mốc đó; sửa không làm mới mốc 24 giờ. Quá hạn
--     → "Báo cáo đã quá 24 giờ, không thể sửa". Quản trị / Trưởng Marketing
--     sửa được bất kỳ lúc nào.
--   • Không ai xoá được báo cáo. Mọi lần gửi / sửa vào Nhật ký hệ thống
--     (ai, lúc nào, số cũ → số mới); Quản trị hoàn tác được.
-- =====================================================================
begin;


-- ---------------------------------------------------------------------
-- 1. BẢNG BÁO CÁO
-- ---------------------------------------------------------------------
create table if not exists public.ad_daily_reports (
  id            uuid primary key default gen_random_uuid(),
  report_date   date not null,
  ad_account_id uuid not null references public.ad_accounts (id),
  user_id       uuid default auth.uid() references auth.users (id) on delete set null,  -- tài khoản bấm Gửi
  spend         bigint not null check (spend >= 0),        -- chi tiêu (đồng)
  messages      int not null check (messages >= 0),        -- số lượng tin nhắn
  data_count    int not null check (data_count >= 0),      -- data xin được
  submitted_at  timestamptz not null default now(),        -- lúc gửi lần đầu, không bao giờ đổi
  updated_at    timestamptz not null default now(),        -- lần sửa số gần nhất (bằng submitted_at nếu chưa sửa)
  updated_by    uuid references auth.users (id) on delete set null,
  constraint ad_daily_reports_day_account_key unique (report_date, ad_account_id)
);
create index if not exists ad_daily_reports_account_idx
  on public.ad_daily_reports (ad_account_id, report_date);


-- ---------------------------------------------------------------------
-- 2. AI PHỤ TRÁCH TK ADS VÀO NGÀY NÀO
-- ---------------------------------------------------------------------
-- Người đang gọi (Nhân viên Ads) có phụ trách TK ADS này vào ngày p_day không.
create or replace function private.has_ad_account_on(p_ad_account_id uuid, p_day date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.ad_account_assignments x
    where x.ad_account_id = p_ad_account_id
      and x.deleted_at is null
      and x.ads_staff_id = private.my_ads_staff_id()
      and x.from_date <= p_day
      and (x.to_date is null or x.to_date >= p_day));
$$;


-- ---------------------------------------------------------------------
-- 3. KIỂM TRA KHI GỬI / SỬA
-- ---------------------------------------------------------------------
create or replace function private.ad_daily_reports_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid    := (select auth.uid());
  -- Thao tác trực tiếp trong Supabase (không có tài khoản) được coi như Quản trị.
  v_manager boolean := v_uid is null or private.manages_marketing();
  v_name    text;
begin
  if tg_op = 'INSERT' then
    if new.report_date is null or new.report_date > private.today_vn() then
      raise exception 'Không gửi báo cáo cho ngày chưa tới' using errcode = '22023';
    end if;
    if not exists (
         select 1
         from public.ad_account_assignments x
         join public.ad_accounts a on a.id = x.ad_account_id and a.deleted_at is null
         where x.ad_account_id = new.ad_account_id and x.deleted_at is null
           and x.from_date <= new.report_date
           and (x.to_date is null or x.to_date >= new.report_date)) then
      select a.name into v_name from public.ad_accounts a where a.id = new.ad_account_id;
      raise exception 'TK ADS "%" không có người phụ trách vào ngày % — kiểm tra phân công ở trang TKQC & Page',
        coalesce(v_name, '?'), to_char(new.report_date, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    if not v_manager and not private.has_ad_account_on(new.ad_account_id, new.report_date) then
      raise exception 'Bạn không phụ trách TK ADS này vào ngày %', to_char(new.report_date, 'DD/MM/YYYY')
        using errcode = '42501';
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
  if new.report_date is distinct from old.report_date
     or new.ad_account_id is distinct from old.ad_account_id then
    raise exception 'Không đổi được ngày hoặc TK ADS của báo cáo đã gửi' using errcode = '22023';
  end if;
  new.submitted_at := old.submitted_at;   -- mốc 24 giờ không bao giờ đổi
  new.user_id := old.user_id;

  if (new.spend, new.messages, new.data_count) is not distinct from (old.spend, old.messages, old.data_count) then
    new.updated_at := old.updated_at;     -- lưu lại y nguyên: không tính là đã sửa
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

create or replace trigger ad_daily_reports_guard
  before insert or update on public.ad_daily_reports
  for each row execute function private.ad_daily_reports_guard();

-- Nhật ký: ghi mọi lần gửi / sửa (bỏ qua hai cột hệ thống tự điền).
create or replace trigger zz_audit
  after insert or update or delete on public.ad_daily_reports
  for each row execute function private.audit_row('id', 'updated_at,updated_by');

-- Hoàn tác (như bản ở file 005, thêm bảng báo cáo).
create or replace function private.undoable_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['leads', 'channels', 'services', 'pages', 'campaigns', 'staff_shifts',
               'ads_staff', 'ad_accounts', 'ad_account_assignments', 'ad_posts',
               'ad_daily_reports'];
$$;

create or replace function private.undo_excluded(p_table text)
returns text[] language sql immutable set search_path = '' as $$
  select array['id', 'created_at', 'created_by', 'updated_at']
      || case p_table
           when 'leads' then array['touch_count', 'last_touch_at']
           when 'ad_posts' then array['platform', 'post_id', 'post_key']
           when 'ad_daily_reports' then array['report_date', 'ad_account_id', 'user_id', 'submitted_at', 'updated_by']
           else array[]::text[]
         end;
$$;


-- ---------------------------------------------------------------------
-- 4. PHÂN QUYỀN (RLS) — không ai có quyền xoá
-- ---------------------------------------------------------------------
alter table public.ad_daily_reports enable row level security;

drop policy if exists ad_daily_reports_select on public.ad_daily_reports;
create policy ad_daily_reports_select on public.ad_daily_reports
  for select to authenticated
  using ((select private.manages_marketing()) or private.has_ad_account_on(ad_account_id, report_date));

drop policy if exists ad_daily_reports_insert on public.ad_daily_reports;
create policy ad_daily_reports_insert on public.ad_daily_reports
  for insert to authenticated
  with check ((select private.manages_marketing()) or private.has_ad_account_on(ad_account_id, report_date));

drop policy if exists ad_daily_reports_update on public.ad_daily_reports;
create policy ad_daily_reports_update on public.ad_daily_reports
  for update to authenticated
  using ((select private.manages_marketing()) or private.has_ad_account_on(ad_account_id, report_date))
  with check ((select private.manages_marketing()) or private.has_ad_account_on(ad_account_id, report_date));

-- Ứng dụng chỉ được ghi các ô số liệu; người gửi, mốc giờ do hệ thống tự điền.
revoke all on public.ad_daily_reports from anon, authenticated;
grant select on public.ad_daily_reports to authenticated;
grant insert (report_date, ad_account_id, spend, messages, data_count) on public.ad_daily_reports to authenticated;
grant update (spend, messages, data_count) on public.ad_daily_reports to authenticated;


-- ---------------------------------------------------------------------
-- 5. CHỐT CHẶN: không chuyển vào thùng rác TK ADS / phân công đã có báo cáo
--    (nếu không, Tổng quan sẽ mất tên TK ADS hoặc mất người phụ trách).
-- ---------------------------------------------------------------------
create or replace function private.guard_trash_ad_reports()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is null or old.deleted_at is not null then
    return new;
  end if;
  if tg_table_name = 'ad_accounts' then
    if exists (select 1 from public.ad_daily_reports r where r.ad_account_id = new.id) then
      raise exception 'TK ADS này đã có báo cáo hằng ngày. Nếu không dùng nữa, hãy bấm Sửa rồi bỏ tick "Đang dùng" để giữ số liệu lịch sử'
        using errcode = '23503';
    end if;
  elsif tg_table_name = 'ad_account_assignments' then
    if exists (
         select 1 from public.ad_daily_reports r
         where r.ad_account_id = new.ad_account_id
           and r.report_date >= new.from_date
           and (new.to_date is null or r.report_date <= new.to_date)) then
      raise exception 'Phân công này đã có báo cáo trong khoảng ngày phụ trách — không chuyển vào thùng rác được'
        using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['ad_accounts', 'ad_account_assignments'] loop
    execute format(
      'create or replace trigger guard_trash_ad_reports
         before update of deleted_at on public.%I
         for each row execute function private.guard_trash_ad_reports()', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 6. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function private.has_ad_account_on(uuid, date) from public;
revoke all on function private.ad_daily_reports_guard() from public;
revoke all on function private.guard_trash_ad_reports() from public;
grant execute on function private.has_ad_account_on(uuid, date) to authenticated;

-- Báo cho lớp API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
