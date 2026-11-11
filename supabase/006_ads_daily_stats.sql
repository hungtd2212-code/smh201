-- =====================================================================
-- Smile Hub ERP — MARKETING: SỐ LIỆU ADS HẰNG NGÀY (thay cho Google Sheet "BC ads")
--
-- Chạy SAU supabase/005_marketing_catalog.sql. Chạy lại file này nhiều lần
-- cũng không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay
-- đổi gì. Đã chạy file này thì KHÔNG chạy lại 002 → 005 nữa.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: chỉ thêm 2 bảng, 1 hàm
-- lưu số liệu và vài chốt chặn.
--
-- Cách ghi số (giống các sheet từng nhân viên trong file Google Sheet):
--   • ad_daily_spend    — chi tiêu của TỪNG TKQC trong từng ngày.
--   • ads_daily_results — kết quả của TỪNG NHÂN VIÊN ADS trong từng ngày:
--     tổng mess, data, doanh số, doanh thu và chất lượng data (KHTN, đặt lịch
--     hẹn, lạc tỉnh, không tương tác).
--   Chi tiêu của ngày nào thuộc về người phụ trách TKQC ngày đó (theo bảng
--   phân công ad_account_assignments) — không lưu lặp tên người vào dòng chi tiêu.
--   Giá mess, giá data, tỉ lệ xin số, ads/doanh số là số TÍNH RA, không lưu.
--
-- Quy tắc:
--   • Mỗi (ngày, TKQC) và mỗi (ngày, nhân viên) chỉ có một dòng.
--   • Chỉ ghi qua hàm save_ads_daily(): nhân viên Ads nhập số của chính mình,
--     cho các TKQC mình phụ trách ngày đó; Quản trị và Trưởng Marketing nhập
--     cho mọi người. Không nhập cho ngày chưa tới.
--   • Không ai xoá được dòng số liệu — nhập sai thì sửa lại số. Mỗi lần sửa
--     đều vào Nhật ký hệ thống (ai, lúc nào, số cũ → số mới) và hoàn tác được.
--   • Nhân viên Ads chỉ xem được số của mình; Quản trị và Trưởng Marketing
--     xem được tất cả.
-- =====================================================================
begin;


-- ---------------------------------------------------------------------
-- 1. HAI BẢNG SỐ LIỆU NGÀY
-- ---------------------------------------------------------------------
create table if not exists public.ad_daily_spend (
  id            uuid primary key default gen_random_uuid(),
  stat_date     date not null,
  ad_account_id uuid not null references public.ad_accounts (id),
  spend         numeric(14, 0) not null default 0 check (spend >= 0),   -- chi tiêu ads trong ngày (đ)
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  constraint ad_daily_spend_day_account_key unique (stat_date, ad_account_id)
);
create index if not exists ad_daily_spend_account_idx
  on public.ad_daily_spend (ad_account_id, stat_date);

create table if not exists public.ads_daily_results (
  id            uuid primary key default gen_random_uuid(),
  stat_date     date not null,
  ads_staff_id  uuid not null references public.ads_staff (id),
  messages      int not null default 0 check (messages >= 0),              -- tổng mess
  data_count    int not null default 0 check (data_count >= 0),            -- data (số điện thoại xin được)
  sales         numeric(14, 0) not null default 0 check (sales >= 0),      -- doanh số (đ)
  revenue       numeric(14, 0) not null default 0 check (revenue >= 0),    -- doanh thu (đ)
  q_potential   int not null default 0 check (q_potential >= 0),           -- chất lượng data: KHTN
  q_booked      int not null default 0 check (q_booked >= 0),              --   đặt lịch hẹn
  q_wrong_area  int not null default 0 check (q_wrong_area >= 0),          --   lạc tỉnh
  q_no_response int not null default 0 check (q_no_response >= 0),         --   không tương tác
  note          text check (note is null or char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  constraint ads_daily_results_day_staff_key unique (stat_date, ads_staff_id)
);
create index if not exists ads_daily_results_staff_idx
  on public.ads_daily_results (ads_staff_id, stat_date);


-- ---------------------------------------------------------------------
-- 2. NGÀY SỬA, NHẬT KÝ, HOÀN TÁC
--    Hai bảng này không có thùng rác: dòng số liệu không xoá được, chỉ sửa số.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ad_daily_spend', 'ads_daily_results'] loop
    execute format(
      'create or replace trigger %I
         before update on public.%I
         for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format(
      'create or replace trigger zz_audit
         after insert or update or delete on public.%I
         for each row execute function private.audit_row(%L, %L)', t, 'id', 'updated_at');
  end loop;
end $$;

-- Như bản ở file 005, thêm hai bảng số liệu ngày.
create or replace function private.undoable_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['leads', 'channels', 'services', 'pages', 'campaigns', 'staff_shifts',
               'ads_staff', 'ad_accounts', 'ad_account_assignments', 'ad_posts',
               'ad_daily_spend', 'ads_daily_results'];
$$;

-- Cột không bao giờ hoàn tác (do hệ thống tự tính, hoặc là "khoá" của dòng).
create or replace function private.undo_excluded(p_table text)
returns text[] language sql immutable set search_path = '' as $$
  select array['id', 'created_at', 'created_by', 'updated_at']
      || case p_table
           when 'leads' then array['touch_count', 'last_touch_at']
           when 'ad_posts' then array['platform', 'post_id', 'post_key']
           when 'ad_daily_spend' then array['stat_date', 'ad_account_id']
           when 'ads_daily_results' then array['stat_date', 'ads_staff_id']
           else array[]::text[]
         end;
$$;


-- ---------------------------------------------------------------------
-- 3. PHÂN QUYỀN (RLS): chỉ đọc; ghi qua hàm save_ads_daily()
-- ---------------------------------------------------------------------

-- Người đang gọi có phụ trách TKQC này vào ngày p_day không.
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

alter table public.ad_daily_spend enable row level security;
drop policy if exists ad_daily_spend_select on public.ad_daily_spend;
create policy ad_daily_spend_select on public.ad_daily_spend
  for select to authenticated
  using ((select private.manages_marketing()) or private.has_ad_account_on(ad_account_id, stat_date));
revoke all on public.ad_daily_spend from anon, authenticated;
grant select on public.ad_daily_spend to authenticated;

alter table public.ads_daily_results enable row level security;
drop policy if exists ads_daily_results_select on public.ads_daily_results;
create policy ads_daily_results_select on public.ads_daily_results
  for select to authenticated
  using ((select private.manages_marketing()) or ads_staff_id = (select private.my_ads_staff_id()));
revoke all on public.ads_daily_results from anon, authenticated;
grant select on public.ads_daily_results to authenticated;


-- ---------------------------------------------------------------------
-- 4. LƯU SỐ LIỆU MỘT NGÀY CỦA MỘT NHÂN VIÊN ADS
--    p_spend: [{"ad_account_id": "…", "spend": 1500000}, …] — các TKQC người đó
--    phụ trách ngày p_date. Gọi lại cho cùng ngày = sửa số (ghi đè).
-- ---------------------------------------------------------------------
create or replace function public.save_ads_daily(
  p_date date, p_ads_staff_id uuid, p_spend jsonb default '[]'::jsonb,
  p_messages int default 0, p_data int default 0,
  p_sales numeric default 0, p_revenue numeric default 0,
  p_potential int default 0, p_booked int default 0,
  p_wrong_area int default 0, p_no_response int default 0,
  p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_item    jsonb;
  v_account uuid;
  v_amount  numeric;
  v_name    text;
  v_spend   numeric := 0;
begin
  if not private.manages_marketing()
     and private.my_ads_staff_id() is distinct from p_ads_staff_id then
    raise exception 'Bạn chỉ nhập được số liệu của chính mình' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'Chưa chọn ngày' using errcode = '22023';
  end if;
  if p_date > private.today_vn() then
    raise exception 'Không nhập số liệu cho ngày chưa tới' using errcode = '22023';
  end if;
  if p_date < date '2020-01-01' then
    raise exception 'Ngày không hợp lệ' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ads_staff s where s.id = p_ads_staff_id and s.deleted_at is null) then
    raise exception 'Không tìm thấy nhân viên Ads' using errcode = '22023';
  end if;
  if least(coalesce(p_messages, 0), coalesce(p_data, 0), coalesce(p_sales, 0), coalesce(p_revenue, 0),
           coalesce(p_potential, 0), coalesce(p_booked, 0), coalesce(p_wrong_area, 0),
           coalesce(p_no_response, 0)) < 0 then
    raise exception 'Số liệu không được là số âm' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_spend, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách chi tiêu không hợp lệ' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_spend, '[]'::jsonb)) loop
    v_account := (v_item ->> 'ad_account_id')::uuid;
    v_amount  := coalesce((v_item ->> 'spend')::numeric, 0);
    if v_amount < 0 then
      raise exception 'Chi tiêu không được là số âm' using errcode = '22023';
    end if;
    if not exists (
         select 1 from public.ad_account_assignments x
         where x.ad_account_id = v_account and x.ads_staff_id = p_ads_staff_id
           and x.deleted_at is null
           and x.from_date <= p_date and (x.to_date is null or x.to_date >= p_date)) then
      select a.name into v_name from public.ad_accounts a where a.id = v_account;
      raise exception 'TKQC "%" không do nhân viên này phụ trách vào ngày % — kiểm tra lại phân công ở trang TKQC & Page',
        coalesce(v_name, '?'), to_char(p_date, 'DD/MM/YYYY') using errcode = '22023';
    end if;

    -- Không tạo dòng "0 đ" cho TKQC chưa từng có số ngày đó; đã có dòng thì sửa (kể cả về 0).
    if v_amount > 0 or exists (
         select 1 from public.ad_daily_spend d
         where d.stat_date = p_date and d.ad_account_id = v_account) then
      insert into public.ad_daily_spend as d (stat_date, ad_account_id, spend, created_by)
      values (p_date, v_account, v_amount, v_uid)
      on conflict on constraint ad_daily_spend_day_account_key
      do update set spend = excluded.spend
      where d.spend is distinct from excluded.spend;
    end if;
    v_spend := v_spend + v_amount;
  end loop;

  insert into public.ads_daily_results as r (
    stat_date, ads_staff_id, messages, data_count, sales, revenue,
    q_potential, q_booked, q_wrong_area, q_no_response, note, created_by)
  values (
    p_date, p_ads_staff_id, coalesce(p_messages, 0), coalesce(p_data, 0),
    coalesce(p_sales, 0), coalesce(p_revenue, 0),
    coalesce(p_potential, 0), coalesce(p_booked, 0), coalesce(p_wrong_area, 0), coalesce(p_no_response, 0),
    nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  on conflict on constraint ads_daily_results_day_staff_key
  do update set
    messages = excluded.messages, data_count = excluded.data_count,
    sales = excluded.sales, revenue = excluded.revenue,
    q_potential = excluded.q_potential, q_booked = excluded.q_booked,
    q_wrong_area = excluded.q_wrong_area, q_no_response = excluded.q_no_response,
    note = excluded.note;

  return jsonb_build_object('spend', v_spend);
end;
$$;


-- ---------------------------------------------------------------------
-- 5. CHỐT CHẶN: không chuyển vào thùng rác thứ đang có số liệu ngày
--    (nếu không, báo cáo cũ sẽ mất tên TKQC / tên người / người phụ trách).
-- ---------------------------------------------------------------------
create or replace function private.guard_trash_daily_stats()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is null or old.deleted_at is not null then
    return new;
  end if;

  -- Mỗi bảng một nhánh riêng: nhánh nào chỉ đọc các cột mà bảng đó có.
  if tg_table_name = 'ad_accounts' then
    if exists (select 1 from public.ad_daily_spend d where d.ad_account_id = new.id) then
      raise exception 'TKQC này đã có số liệu chi tiêu hằng ngày. Nếu không dùng nữa, hãy bấm Sửa rồi bỏ tick "Đang dùng" để giữ số liệu lịch sử'
        using errcode = '23503';
    end if;
  elsif tg_table_name = 'ads_staff' then
    if exists (select 1 from public.ads_daily_results r where r.ads_staff_id = new.id) then
      raise exception 'Nhân viên Ads này đã có số liệu hằng ngày. Nếu người này nghỉ, hãy chuyển trạng thái sang "Nghỉ" để giữ số liệu lịch sử'
        using errcode = '23503';
    end if;
  elsif tg_table_name = 'ad_account_assignments' then
    if exists (
         select 1 from public.ad_daily_spend d
         where d.ad_account_id = new.ad_account_id
           and d.stat_date >= new.from_date
           and (new.to_date is null or d.stat_date <= new.to_date)) then
      raise exception 'Phân công này đã có số liệu chi tiêu trong khoảng ngày phụ trách — không chuyển vào thùng rác được'
        using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['ad_accounts', 'ads_staff', 'ad_account_assignments'] loop
    execute format(
      'create or replace trigger guard_trash_daily_stats
         before update of deleted_at on public.%I
         for each row execute function private.guard_trash_daily_stats()', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 6. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function private.has_ad_account_on(uuid, date) from public;
revoke all on function private.guard_trash_daily_stats() from public;
grant execute on function private.has_ad_account_on(uuid, date) to authenticated;

revoke all on function public.save_ads_daily(date, uuid, jsonb, int, int, numeric, numeric, int, int, int, int, text)
  from public, anon;
grant execute on function public.save_ads_daily(date, uuid, jsonb, int, int, numeric, numeric, int, int, int, int, text)
  to authenticated;

-- Báo cho lớp API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
