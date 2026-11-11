-- =====================================================================
-- Smile Hub ERP — PHÂN HỆ MARKETING, GIAI ĐOẠN 1: VAI TRÒ, QUYỀN, DANH MỤC
--
-- Chạy SAU supabase/004_delete_permission.sql. Chạy lại file này nhiều lần
-- cũng không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay
-- đổi gì. Sau khi đã chạy file này thì KHÔNG chạy lại 002, 003, 004 nữa
-- (các file đó sẽ đưa quy tắc phân quyền cũ quay lại).
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có: chỉ thêm bảng, thêm cột,
-- thêm vai trò và đổi quy tắc phân quyền.
--
-- Thêm:
--   • Vai trò: marketing_manager (Trưởng Marketing), ads_staff (Nhân viên Ads).
--     Các vai trò cũ giữ nguyên mã: lead = Trưởng Telesale, sale = Telesale,
--     page = Trực page.
--   • Quyền "Xuất file" tick theo từng tài khoản (staff.can_export) + sổ ghi
--     mỗi lần xuất file (export_log).
--   • Danh mục: ads_staff (Nhân viên Ads), ad_accounts (TKQC),
--     ad_account_assignments (phân công TKQC theo ngày), ad_posts (bài post).
--   • pages: thêm link và trực page phụ trách. campaigns: thêm TKQC, mục tiêu.
--   • Mọi bảng mới: thùng rác (xoá mềm), nhật ký thay đổi, người tạo, ngày sửa.
--
-- Đổi quy tắc:
--   • Danh mục Marketing (kênh, page, TKQC, chiến dịch, bài post, nhân viên
--     Ads) do Quản trị và Trưởng Marketing quản lý. Trưởng Telesale không còn
--     sửa các danh mục này.
--   • Nhân viên Ads chỉ thấy TKQC được giao, và chỉ thấy / sửa chiến dịch,
--     bài post thuộc các TKQC đó. Nhân viên Ads không xem được lead (phần
--     "lead của bài mình chạy" sẽ mở ở giai đoạn báo cáo).
-- =====================================================================
begin;


-- ---------------------------------------------------------------------
-- 0. VAI TRÒ VÀ QUYỀN XUẤT FILE
-- ---------------------------------------------------------------------
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('super_admin', 'admin', 'marketing_manager', 'ads_staff', 'lead', 'sale', 'page'));

alter table public.staff
  add column if not exists can_export boolean not null default false;  -- được tick quyền "Xuất file"

-- Vai trò của người đang gọi (null nếu chưa có tên trong bảng staff hoặc đang bị khoá).
create or replace function private.staff_role()
returns text language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s
  where s.user_id = (select auth.uid()) and s.locked_at is null;
$$;

-- Người quản lý phân hệ Marketing: Quản trị cấp cao, Quản trị, Trưởng Marketing.
create or replace function private.manages_marketing()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null
      and s.role in ('super_admin', 'admin', 'marketing_manager'));
$$;

-- Được xuất file: Quản trị luôn có; người khác chỉ khi được tick.
create or replace function private.can_export()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null
      and (s.role in ('super_admin', 'admin') or s.can_export));
$$;

-- "Hôm nay" theo giờ Việt Nam.
create or replace function private.today_vn()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date;
$$;


-- ---------------------------------------------------------------------
-- 1. MIỀN / CƠ SỞ — chưa làm (chủ phòng khám quyết định 11/11/2026)
--    Không có danh mục Miền. Cột "branch" sẵn có ở pages, campaigns, leads, staff
--    giữ nguyên như cũ (mặc định 'HN') và chưa hiện trên màn hình nào của Marketing.
--    Khi mở thêm cơ sở: chỉ cần hiện cột này lên form và thêm một bộ lọc.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 2. NHÂN VIÊN ADS
--    Tách khỏi bảng staff: có thể khai báo người chạy ads trước khi họ có tài
--    khoản đăng nhập, và người đã nghỉ vẫn giữ nguyên số liệu lịch sử.
-- ---------------------------------------------------------------------
create table if not exists public.ads_staff (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null check (char_length(full_name) between 1 and 120),
  staff_code text check (staff_code is null or char_length(staff_code) between 1 and 30),  -- mã nhân viên nội bộ
  user_id    uuid references public.staff (user_id) on delete set null,                    -- tài khoản đăng nhập (nếu có)
  is_active  boolean not null default true,                                                -- true = Đang làm · false = Nghỉ
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);
create unique index if not exists ads_staff_name_live_key
  on public.ads_staff (lower(full_name)) where deleted_at is null;
create unique index if not exists ads_staff_code_live_key
  on public.ads_staff (lower(staff_code)) where deleted_at is null and staff_code is not null;
create unique index if not exists ads_staff_user_live_key
  on public.ads_staff (user_id) where deleted_at is null and user_id is not null;


-- ---------------------------------------------------------------------
-- 3. TÀI KHOẢN QUẢNG CÁO (TKQC) VÀ PHÂN CÔNG THEO NGÀY
--    Số liệu của ngày nào thuộc về người phụ trách TKQC ngày đó.
-- ---------------------------------------------------------------------
create table if not exists public.ad_accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),                    -- vd "THE DUONG 01"
  account_id text check (account_id is null or char_length(account_id) between 1 and 60),  -- ID tài khoản trên nền tảng
  channel_id uuid not null references public.channels (id),
  is_active  boolean not null default true,
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);
create unique index if not exists ad_accounts_name_live_key
  on public.ad_accounts (lower(name)) where deleted_at is null;
create unique index if not exists ad_accounts_external_live_key
  on public.ad_accounts (channel_id, account_id) where deleted_at is null and account_id is not null;

create table if not exists public.ad_account_assignments (
  id            uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null references public.ad_accounts (id),
  ads_staff_id  uuid not null references public.ads_staff (id),
  from_date     date not null,
  to_date       date check (to_date is null or to_date >= from_date),   -- null = đang phụ trách
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references auth.users (id) on delete set null
);
create index if not exists ad_account_assignments_account_idx
  on public.ad_account_assignments (ad_account_id, from_date desc);
create index if not exists ad_account_assignments_staff_idx
  on public.ad_account_assignments (ads_staff_id);

-- Một TKQC mỗi ngày chỉ có một người phụ trách: không cho hai phân công chồng ngày nhau.
create or replace function private.guard_assignment_overlap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('ad_account_assignments'), hashtext(new.ad_account_id::text));
  if exists (
    select 1 from public.ad_account_assignments x
    where x.ad_account_id = new.ad_account_id and x.id <> new.id and x.deleted_at is null
      and x.from_date <= coalesce(new.to_date, 'infinity'::date)
      and coalesce(x.to_date, 'infinity'::date) >= new.from_date) then
    raise exception 'TKQC này đã có người phụ trách trong khoảng ngày đó — hãy kết thúc phân công cũ trước'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

create or replace trigger guard_assignment_overlap
  before insert or update on public.ad_account_assignments
  for each row execute function private.guard_assignment_overlap();


-- ---------------------------------------------------------------------
-- 4. PAGE VÀ CHIẾN DỊCH: thêm cột
-- ---------------------------------------------------------------------
alter table public.pages
  add column if not exists url text,                                       -- link page
  add column if not exists page_staff_ids uuid[] not null default '{}';    -- trực page phụ trách (staff.user_id)

alter table public.campaigns
  add column if not exists ad_account_id uuid references public.ad_accounts (id),   -- TKQC chạy chiến dịch
  add column if not exists objective text
    check (objective is null or objective in ('messages', 'engagement', 'conversion'));  -- Tin nhắn / Tương tác / Chuyển đổi
create index if not exists campaigns_ad_account_idx on public.campaigns (ad_account_id);


-- ---------------------------------------------------------------------
-- 5. BÀI POST
--    Trực page dán link bài → hệ thống tách ID bài và so với bảng này để biết
--    lead đến từ Bài → Chiến dịch → TKQC → Nhân viên Ads nào.
-- ---------------------------------------------------------------------

-- Tách ID bài / ID ads từ một link Facebook hoặc TikTok (hoặc mã bài "idpage_idbài").
-- Trả về: platform (facebook | tiktok | other), kind, post_id, ad_id, key.
--   kind = post    : tách được ID bài
--          ad      : chỉ có ID ads
--          short   : link rút gọn / link chia sẻ — không có ID bài, chỉ so khớp được theo đúng link này
--          unknown : không nhận ra, so khớp theo nguyên link
--   key  = khoá dùng để so khớp hai link có trỏ về cùng một bài hay không.
create or replace function public.parse_post_link(p_url text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_in       text := btrim(coalesce(p_url, ''));
  v_rest     text;
  v_host     text;
  v_path     text;
  v_query    text;
  v_platform text := 'other';
  v_kind     text := 'unknown';
  v_post     text;
  v_ad       text;
  v_key      text;
begin
  if v_in = '' then
    return null;
  end if;

  -- Mã bài copy từ Pancake: "<id page>_<id bài>"
  if v_in ~ '^[0-9]{5,}_[0-9]{5,}$' then
    v_post := split_part(v_in, '_', 2);
    return jsonb_build_object('platform', 'facebook', 'kind', 'post',
                              'post_id', v_post, 'ad_id', null, 'key', 'fb:' || v_post);
  end if;

  v_rest  := regexp_replace(regexp_replace(v_in, '^[a-zA-Z][a-zA-Z0-9+.-]*://', ''), '#.*$', '');
  v_host  := lower(coalesce(substring(v_rest from '^[^/?]*'), ''));
  v_path  := regexp_replace(coalesce(substring(v_rest from '^[^/?]*(/[^?]*)'), ''), '/+$', '');
  v_query := '&' || coalesce(substring(v_rest from '\?(.*)$'), '');
  v_ad    := substring(v_query from '&(?:ad_id|adid|selected_ad_ids|ad_ids)=([0-9]{5,})');

  if v_host ~ '(^|\.)(facebook\.com|fb\.com)$' then
    v_platform := 'facebook';
    v_post := coalesce(
      substring(v_query from '&story_fbid=([A-Za-z0-9_.-]+)'),
      substring(v_query from '&fbid=([A-Za-z0-9_.-]+)'),
      case when v_path ~ '^/(watch|video\.php)$' then substring(v_query from '&v=([0-9]+)') end,
      substring(v_path from '/(?:posts|videos|permalink)/(?:[^/]+/)*([A-Za-z0-9_.-]+)$'),
      substring(v_path from '/(?:posts|videos|permalink)/([A-Za-z0-9_.-]+)'),
      substring(v_path from '/reels?/([A-Za-z0-9_.-]+)'),
      substring(v_path from '/photos/(?:[^/]+/)*([0-9]+)$'),
      substring(v_path from '^/[0-9]{5,}_([0-9]{5,})$'));
    if v_post is null and v_path ~ '^/share/' then
      v_post := substring(v_path from '^/share/(?:[pvr]/)?([A-Za-z0-9_-]+)');
      if v_post is not null then
        v_kind := 'short';
        v_key := 'fbshare:' || v_post;
        v_post := null;
      end if;
    end if;

  elsif v_host in ('fb.watch', 'fb.me') then
    v_platform := 'facebook';
    v_post := substring(v_path from '^/([A-Za-z0-9_-]+)');
    if v_post is not null then
      v_kind := 'short';
      v_key := 'fbshort:' || v_host || '/' || v_post;
      v_post := null;
    end if;

  elsif v_host ~ '(^|\.)tiktok\.com$' then
    v_platform := 'tiktok';
    v_post := coalesce(
      substring(v_path from '/(?:video|photo)/([0-9]{6,})'),
      substring(v_path from '^/v/([0-9]{6,})'));
    if v_post is null then
      v_post := case
        when v_host ~ '^(vm|vt)\.' then substring(v_path from '^/([A-Za-z0-9_-]+)')
        when v_path ~ '^/t/' then substring(v_path from '^/t/([A-Za-z0-9_-]+)')
      end;
      if v_post is not null then
        v_kind := 'short';
        v_key := 'ttshort:' || v_post;
        v_post := null;
      end if;
    end if;
  end if;

  if v_key is null then
    if v_post is not null then
      v_kind := 'post';
      v_key := case v_platform when 'facebook' then 'fb:' else 'tt:' end || v_post;
    elsif v_ad is not null and v_platform = 'facebook' then
      v_kind := 'ad';
      v_key := 'fbad:' || v_ad;
    else
      v_key := 'url:' || v_host || v_path || case when v_query <> '&' then '?' || substr(v_query, 2) else '' end;
    end if;
  end if;

  return jsonb_build_object('platform', v_platform, 'kind', v_kind,
                            'post_id', v_post, 'ad_id', v_ad, 'key', v_key);
end;
$$;

create table if not exists public.ad_posts (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id),          -- null = bài "Chưa khai báo"
  url         text not null check (char_length(url) between 8 and 1000),
  platform    text,                                           -- tự tách từ link
  post_id     text,                                           -- tự tách từ link
  ad_id       text,                                           -- tự tách từ link, hoặc nhập tay
  post_key    text not null,                                  -- khoá so khớp, tự tách từ link
  title       text check (title is null or char_length(title) <= 200),   -- tên gợi nhớ
  media_type  text check (media_type is null or media_type in ('image', 'video')),
  start_date  date,                                           -- ngày bắt đầu chạy
  status      text not null default 'active' check (status in ('active', 'paused', 'undeclared')),
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references auth.users (id) on delete set null,
  -- "Chưa khai báo" đúng khi và chỉ khi bài chưa gắn chiến dịch.
  constraint ad_posts_declared_check check ((status = 'undeclared') = (campaign_id is null))
);
create unique index if not exists ad_posts_key_live_key
  on public.ad_posts (post_key) where deleted_at is null;
create index if not exists ad_posts_campaign_idx on public.ad_posts (campaign_id);

-- Mỗi lần thêm bài hoặc đổi link: tách lại ID bài, ID ads và khoá so khớp.
create or replace function private.ad_posts_fill()
returns trigger language plpgsql set search_path = '' as $$
declare
  v jsonb;
begin
  new.url := btrim(new.url);
  if tg_op = 'UPDATE' and new.url is not distinct from old.url then
    new.platform := old.platform;
    new.post_id  := old.post_id;
    new.post_key := old.post_key;
    return new;
  end if;

  v := public.parse_post_link(new.url);
  if v is null
     or (v ->> 'kind' = 'unknown' and new.url !~* '^https?://[^/?#]+\.[^/?#]+') then
    raise exception 'Link bài post không hợp lệ — hãy dán đầy đủ link bắt đầu bằng https://' using errcode = '22023';
  end if;
  new.platform := v ->> 'platform';
  new.post_id  := v ->> 'post_id';
  new.post_key := v ->> 'key';
  new.ad_id    := coalesce(v ->> 'ad_id', nullif(btrim(coalesce(new.ad_id, '')), ''));
  return new;
end;
$$;

create or replace trigger ad_posts_fill
  before insert or update on public.ad_posts
  for each row execute function private.ad_posts_fill();


-- ---------------------------------------------------------------------
-- 6. THÙNG RÁC, NGÀY SỬA, NHẬT KÝ cho các bảng mới
--    (và thêm "người tạo", "ngày sửa" cho 4 bảng danh mục cũ)
-- ---------------------------------------------------------------------
create or replace function private.soft_delete_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['leads', 'channels', 'services', 'pages', 'campaigns',
               'ads_staff', 'ad_accounts', 'ad_account_assignments', 'ad_posts'];
$$;

create or replace function private.undoable_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['leads', 'channels', 'services', 'pages', 'campaigns', 'staff_shifts',
               'ads_staff', 'ad_accounts', 'ad_account_assignments', 'ad_posts'];
$$;

-- Cột không bao giờ hoàn tác (do hệ thống tự tính).
create or replace function private.undo_excluded(p_table text)
returns text[] language sql immutable set search_path = '' as $$
  select array['id', 'created_at', 'created_by', 'updated_at']
      || case p_table
           when 'leads' then array['touch_count', 'last_touch_at']
           when 'ad_posts' then array['platform', 'post_id', 'post_key']
           else array[]::text[]
         end;
$$;

do $$
declare t text;
begin
  foreach t in array array['channels', 'services', 'pages', 'campaigns'] loop
    execute format(
      'alter table public.%I
         add column if not exists created_by uuid default auth.uid() references auth.users (id) on delete set null,
         add column if not exists updated_at timestamptz not null default now()', t);
  end loop;

  foreach t in array array['ads_staff', 'ad_accounts', 'ad_account_assignments', 'ad_posts'] loop
    execute format(
      'create index if not exists %I on public.%I (deleted_at) where deleted_at is not null',
      t || '_deleted_idx', t);
    execute format(
      'create or replace trigger guard_soft_delete
         before insert or update on public.%I
         for each row execute function private.guard_soft_delete()', t);
  end loop;

  foreach t in array array['channels', 'services', 'pages', 'campaigns',
                           'ads_staff', 'ad_accounts', 'ad_account_assignments', 'ad_posts'] loop
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


-- ---------------------------------------------------------------------
-- 7. "CỦA MÌNH" ĐỐI VỚI NHÂN VIÊN ADS
-- ---------------------------------------------------------------------

-- Dòng ads_staff gắn với tài khoản đang gọi (chỉ khi tài khoản đó có vai trò Nhân viên Ads).
create or replace function private.my_ads_staff_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select a.id
  from public.ads_staff a
  join public.staff s on s.user_id = a.user_id
  where a.user_id = (select auth.uid()) and a.deleted_at is null
    and s.locked_at is null and s.role = 'ads_staff'
  limit 1;
$$;

-- Người đang gọi có được giao TKQC này không.
--   p_current = false: từng được giao (để xem);  true: đang được giao hôm nay và còn đang làm (để sửa).
create or replace function private.has_ad_account(p_ad_account_id uuid, p_current boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.ad_account_assignments x
    join public.ads_staff a on a.id = x.ads_staff_id
    where x.ad_account_id = p_ad_account_id
      and x.deleted_at is null
      and a.id = private.my_ads_staff_id()
      and (not p_current
           or (a.is_active
               and x.from_date <= private.today_vn()
               and (x.to_date is null or x.to_date >= private.today_vn()))));
$$;

-- Chiến dịch này có thuộc một TKQC của người đang gọi không.
create or replace function private.has_campaign(p_campaign_id uuid, p_current boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = p_campaign_id and c.deleted_at is null
      and private.has_ad_account(c.ad_account_id, p_current));
$$;


-- ---------------------------------------------------------------------
-- 8. PHÂN QUYỀN (RLS)
-- ---------------------------------------------------------------------

-- NHÂN VIÊN ADS: quản lý Marketing thấy tất cả; nhân viên Ads chỉ thấy dòng của mình.
alter table public.ads_staff enable row level security;
drop policy if exists ads_staff_select on public.ads_staff;
create policy ads_staff_select on public.ads_staff
  for select to authenticated
  using ((select private.manages_marketing())
         or ((select private.is_staff()) and user_id = (select auth.uid())));
drop policy if exists ads_staff_insert_manager on public.ads_staff;
create policy ads_staff_insert_manager on public.ads_staff
  for insert to authenticated with check ((select private.manages_marketing()));
drop policy if exists ads_staff_update_manager on public.ads_staff;
create policy ads_staff_update_manager on public.ads_staff
  for update to authenticated
  using ((select private.manages_marketing()) and deleted_at is null)
  with check ((select private.manages_marketing()));

-- TKQC: quản lý Marketing thấy tất cả; nhân viên Ads chỉ thấy TKQC từng được giao.
alter table public.ad_accounts enable row level security;
drop policy if exists ad_accounts_select on public.ad_accounts;
create policy ad_accounts_select on public.ad_accounts
  for select to authenticated
  using ((select private.manages_marketing()) or private.has_ad_account(id));
drop policy if exists ad_accounts_insert_manager on public.ad_accounts;
create policy ad_accounts_insert_manager on public.ad_accounts
  for insert to authenticated with check ((select private.manages_marketing()));
drop policy if exists ad_accounts_update_manager on public.ad_accounts;
create policy ad_accounts_update_manager on public.ad_accounts
  for update to authenticated
  using ((select private.manages_marketing()) and deleted_at is null)
  with check ((select private.manages_marketing()));

-- PHÂN CÔNG TKQC: quản lý Marketing thấy và sửa; nhân viên Ads chỉ thấy phân công của mình.
alter table public.ad_account_assignments enable row level security;
drop policy if exists ad_account_assignments_select on public.ad_account_assignments;
create policy ad_account_assignments_select on public.ad_account_assignments
  for select to authenticated
  using ((select private.manages_marketing()) or ads_staff_id = (select private.my_ads_staff_id()));
drop policy if exists ad_account_assignments_insert_manager on public.ad_account_assignments;
create policy ad_account_assignments_insert_manager on public.ad_account_assignments
  for insert to authenticated with check ((select private.manages_marketing()));
drop policy if exists ad_account_assignments_update_manager on public.ad_account_assignments;
create policy ad_account_assignments_update_manager on public.ad_account_assignments
  for update to authenticated
  using ((select private.manages_marketing()) and deleted_at is null)
  with check ((select private.manages_marketing()));

-- KÊNH, PAGE: mọi nhân viên xem (để tra tên nguồn của lead); quản lý Marketing thêm / sửa.
do $$
declare t text;
begin
  foreach t in array array['channels', 'pages'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_manager', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check ((select private.manages_marketing()))', t || '_insert_manager', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_manager', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using ((select private.manages_marketing()) and deleted_at is null)
         with check ((select private.manages_marketing()))', t || '_update_manager', t);
  end loop;
end $$;

-- CHIẾN DỊCH: nhân viên Ads chỉ thấy chiến dịch thuộc TKQC từng được giao, và chỉ thêm / sửa
-- trong TKQC đang được giao. Các vai trò khác vẫn xem được (để tra tên nguồn của lead).
drop policy if exists campaigns_select_staff on public.campaigns;
create policy campaigns_select_staff on public.campaigns
  for select to authenticated
  using ((select private.is_staff())
         and ((select private.staff_role()) <> 'ads_staff' or private.has_ad_account(ad_account_id)));
drop policy if exists campaigns_insert_manager on public.campaigns;
create policy campaigns_insert_manager on public.campaigns
  for insert to authenticated
  with check ((select private.manages_marketing()) or private.has_ad_account(ad_account_id, true));
drop policy if exists campaigns_update_manager on public.campaigns;
create policy campaigns_update_manager on public.campaigns
  for update to authenticated
  using (deleted_at is null
         and ((select private.manages_marketing()) or private.has_ad_account(ad_account_id, true)))
  with check ((select private.manages_marketing()) or private.has_ad_account(ad_account_id, true));

-- BÀI POST: như chiến dịch. Bài "Chưa khai báo" thì nhân viên Ads nào cũng thấy, để vào nhận
-- bài về chiến dịch của mình.
alter table public.ad_posts enable row level security;
drop policy if exists ad_posts_select on public.ad_posts;
create policy ad_posts_select on public.ad_posts
  for select to authenticated
  using ((select private.is_staff())
         and ((select private.staff_role()) <> 'ads_staff'
              or campaign_id is null
              or private.has_campaign(campaign_id)));
drop policy if exists ad_posts_insert on public.ad_posts;
create policy ad_posts_insert on public.ad_posts
  for insert to authenticated
  with check ((select private.manages_marketing()) or private.has_campaign(campaign_id, true));
drop policy if exists ad_posts_update on public.ad_posts;
create policy ad_posts_update on public.ad_posts
  for update to authenticated
  using (deleted_at is null
         and ((select private.manages_marketing())
              or (campaign_id is null and (select private.staff_role()) = 'ads_staff')
              or private.has_campaign(campaign_id, true)))
  with check ((select private.manages_marketing()) or private.has_campaign(campaign_id, true));

do $$
declare t text;
begin
  foreach t in array array['ads_staff', 'ad_accounts', 'ad_account_assignments', 'ad_posts'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

-- LEAD: nhân viên Ads không xem / sửa lead (giai đoạn báo cáo sẽ mở riêng "lead của bài mình chạy").
drop policy if exists leads_select_staff on public.leads;
create policy leads_select_staff on public.leads
  for select to authenticated
  using ((select private.is_staff())
         and (select private.staff_role()) <> 'ads_staff'
         and (deleted_at is null or (select private.is_admin())));

drop policy if exists leads_update_staff on public.leads;
create policy leads_update_staff on public.leads
  for update to authenticated
  using ((select private.is_staff()) and (select private.staff_role()) <> 'ads_staff' and deleted_at is null)
  with check ((select private.is_staff()));

drop policy if exists lead_touches_select_staff on public.lead_touches;
create policy lead_touches_select_staff on public.lead_touches
  for select to authenticated
  using ((select private.is_staff()) and (select private.staff_role()) <> 'ads_staff');


-- ---------------------------------------------------------------------
-- 9. GIAO TKQC CHO NHÂN VIÊN ADS
--    Giao từ ngày D: phân công đang mở của TKQC tự kết thúc vào ngày D - 1.
-- ---------------------------------------------------------------------
create or replace function public.assign_ad_account(
  p_ad_account_id uuid, p_ads_staff_id uuid, p_from_date date, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_open   public.ad_account_assignments%rowtype;
  v_later  date;
  v_id     uuid;
  v_closed int := 0;
begin
  if not private.manages_marketing() then
    raise exception 'Chỉ Quản trị hoặc Trưởng Marketing được phân công TKQC' using errcode = '42501';
  end if;
  if p_from_date is null then
    raise exception 'Chưa chọn ngày bắt đầu phụ trách' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ad_accounts a where a.id = p_ad_account_id and a.deleted_at is null) then
    raise exception 'Không tìm thấy TKQC' using errcode = '22023';
  end if;
  if not exists (
       select 1 from public.ads_staff s
       where s.id = p_ads_staff_id and s.deleted_at is null and s.is_active) then
    raise exception 'Không tìm thấy nhân viên Ads (hoặc người này đã nghỉ)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ad_account_assignments'), hashtext(p_ad_account_id::text));

  select min(x.from_date) into v_later
  from public.ad_account_assignments x
  where x.ad_account_id = p_ad_account_id and x.deleted_at is null and x.from_date >= p_from_date;
  if v_later is not null then
    raise exception 'TKQC này đã có phân công bắt đầu từ ngày % — hãy chọn ngày sau đó, hoặc sửa phân công ấy trước',
      to_char(v_later, 'DD/MM/YYYY') using errcode = '23P01';
  end if;

  select * into v_open
  from public.ad_account_assignments x
  where x.ad_account_id = p_ad_account_id and x.deleted_at is null
    and (x.to_date is null or x.to_date >= p_from_date)
  order by x.from_date desc
  limit 1;
  if found then
    if v_open.ads_staff_id = p_ads_staff_id and v_open.to_date is null then
      raise exception 'Người này đang phụ trách TKQC này rồi' using errcode = '22023';
    end if;
    update public.ad_account_assignments set to_date = p_from_date - 1 where id = v_open.id;
    v_closed := 1;
  end if;

  insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date, note, created_by)
  values (p_ad_account_id, p_ads_staff_id, p_from_date,
          nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'closed', v_closed);
end;
$$;


-- ---------------------------------------------------------------------
-- 10. THÙNG RÁC: thêm các bảng mới
-- ---------------------------------------------------------------------

-- Chuyển vào Thùng rác: như bản ở file 004, thêm quy tắc "ai quản lý danh mục nào"
-- và các chốt chặn cho bảng mới.
create or replace function public.soft_delete_records(p_table text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_n      int  := coalesce(cardinality(p_ids), 0);
  v_recent int;
  v_done   int;
begin
  if p_table is null or p_table <> all (private.soft_delete_tables()) then
    raise exception 'Loại dữ liệu này không có thùng rác' using errcode = '22023';
  end if;
  if not private.can_delete() then
    raise exception 'Tài khoản của bạn chưa được cấp quyền xoá dữ liệu' using errcode = '42501';
  end if;
  -- Ngoài ô tick còn phải là người quản lý loại danh mục đó.
  if p_table = 'services' then
    if not private.is_manager() then
      raise exception 'Chỉ Quản trị hoặc Trưởng Telesale được chuyển dịch vụ vào thùng rác' using errcode = '42501';
    end if;
  elsif p_table <> 'leads' then
    if not private.manages_marketing() then
      raise exception 'Chỉ Quản trị hoặc Trưởng Marketing được chuyển danh mục Marketing vào thùng rác' using errcode = '42501';
    end if;
  end if;
  if v_n = 0 then
    return jsonb_build_object('deleted', 0);
  end if;
  if v_n > 1000 then
    raise exception 'Mỗi lần chỉ chuyển được tối đa 1000 bản ghi vào thùng rác' using errcode = '22023';
  end if;

  select count(*) into v_recent
  from public.audit_log a
  where a.actor_id = v_uid and a.action = 'delete' and a.at > now() - interval '10 minutes';
  if v_n + v_recent > private.setting_int('bulk_delete_confirm_over', 20)
     and not private.password_confirmed_recently() then
    raise exception 'PASSWORD_REQUIRED'
      using errcode = 'P0001', hint = 'Xoá nhiều bản ghi cần nhập lại mật khẩu để xác nhận';
  end if;

  if p_table = 'channels' and exists (
       select 1 from public.pages p where p.channel_id = any (p_ids) and p.deleted_at is null) then
    raise exception 'Kênh còn page đang dùng — hãy chuyển các page của kênh vào thùng rác trước' using errcode = '23503';
  end if;
  if p_table = 'channels' and exists (
       select 1 from public.ad_accounts a where a.channel_id = any (p_ids) and a.deleted_at is null) then
    raise exception 'Kênh còn TKQC đang dùng — hãy chuyển các TKQC của kênh vào thùng rác trước' using errcode = '23503';
  end if;
  if p_table = 'channels' and exists (
       select 1 from public.campaigns c where c.channel_id = any (p_ids) and c.deleted_at is null) then
    raise exception 'Kênh còn chiến dịch — hãy chuyển các chiến dịch của kênh vào thùng rác trước' using errcode = '23503';
  end if;
  if p_table = 'pages' and exists (
       select 1 from public.campaigns c where c.page_id = any (p_ids) and c.deleted_at is null) then
    raise exception 'Page còn chiến dịch — hãy chuyển các chiến dịch của page vào thùng rác trước' using errcode = '23503';
  end if;
  if p_table = 'ad_accounts' and exists (
       select 1 from public.campaigns c where c.ad_account_id = any (p_ids) and c.deleted_at is null) then
    raise exception 'TKQC còn chiến dịch — hãy chuyển các chiến dịch của TKQC vào thùng rác trước' using errcode = '23503';
  end if;
  if p_table = 'campaigns' and exists (
       select 1 from public.ad_posts p where p.campaign_id = any (p_ids) and p.deleted_at is null) then
    raise exception 'Chiến dịch còn bài post — hãy chuyển các bài post của chiến dịch vào thùng rác trước' using errcode = '23503';
  end if;
  if p_table = 'ads_staff' and exists (
       select 1 from public.ad_account_assignments x where x.ads_staff_id = any (p_ids) and x.deleted_at is null) then
    raise exception 'Nhân viên Ads này đã từng được giao TKQC. Nếu người này nghỉ, hãy chuyển trạng thái sang "Nghỉ" để giữ số liệu lịch sử'
      using errcode = '23503';
  end if;

  perform set_config('app.soft_delete', 'on', true);
  execute format(
    'update public.%I set deleted_at = now(), deleted_by = $1 where id = any ($2) and deleted_at is null',
    p_table) using v_uid, p_ids;
  get diagnostics v_done = row_count;
  perform set_config('app.soft_delete', 'off', true);

  return jsonb_build_object('deleted', v_done);
end;
$$;

-- Khôi phục từ Thùng rác (chỉ Quản trị): như bản ở file 003, thêm các bảng mới.
create or replace function public.restore_records(p_table text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id        uuid;
  v_n         int;
  v_restored  int := 0;
  v_conflicts int := 0;
  v_blocked   int := 0;
begin
  if p_table is null or p_table <> all (private.soft_delete_tables()) then
    raise exception 'Loại dữ liệu này không có thùng rác' using errcode = '22023';
  end if;
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị được khôi phục dữ liệu' using errcode = '42501';
  end if;

  perform set_config('app.soft_delete', 'on', true);
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    -- Bản ghi cha còn nằm trong thùng rác → phải khôi phục bản ghi cha trước.
    if (p_table = 'pages' and exists (
          select 1 from public.pages p join public.channels c on c.id = p.channel_id
          where p.id = v_id and c.deleted_at is not null))
       or (p_table = 'ad_accounts' and exists (
          select 1 from public.ad_accounts a join public.channels c on c.id = a.channel_id
          where a.id = v_id and c.deleted_at is not null))
       or (p_table = 'campaigns' and exists (
          select 1 from public.campaigns x
          join public.channels c on c.id = x.channel_id
          left join public.pages p on p.id = x.page_id
          left join public.ad_accounts a on a.id = x.ad_account_id
          where x.id = v_id
            and (c.deleted_at is not null or p.deleted_at is not null or a.deleted_at is not null)))
       or (p_table = 'ad_posts' and exists (
          select 1 from public.ad_posts x join public.campaigns c on c.id = x.campaign_id
          where x.id = v_id and c.deleted_at is not null))
       or (p_table = 'ad_account_assignments' and exists (
          select 1 from public.ad_account_assignments x
          join public.ad_accounts a on a.id = x.ad_account_id
          join public.ads_staff s on s.id = x.ads_staff_id
          where x.id = v_id and (a.deleted_at is not null or s.deleted_at is not null))) then
      v_blocked := v_blocked + 1;
      continue;
    end if;

    begin
      execute format(
        'update public.%I set deleted_at = null, deleted_by = null where id = $1 and deleted_at is not null',
        p_table) using v_id;
      get diagnostics v_n = row_count;
      v_restored := v_restored + v_n;
    exception when unique_violation or exclusion_violation then
      v_conflicts := v_conflicts + 1;   -- trùng tên / trùng số / trùng ngày phân công
    end;
  end loop;
  perform set_config('app.soft_delete', 'off', true);

  return jsonb_build_object('restored', v_restored, 'conflicts', v_conflicts, 'blocked', v_blocked);
end;
$$;

-- Thùng rác: một danh sách chung cho mọi loại dữ liệu (chỉ Quản trị thấy).
create or replace view public.trash_items with (security_invoker = true) as
  select 'leads'::text as table_name, l.id, l.full_name || ' · ' || l.phone as label, l.deleted_at, l.deleted_by
  from public.leads l where l.deleted_at is not null and (select private.is_admin())
  union all
  select 'channels', c.id, c.name, c.deleted_at, c.deleted_by
  from public.channels c where c.deleted_at is not null and (select private.is_admin())
  union all
  select 'pages', p.id, p.name, p.deleted_at, p.deleted_by
  from public.pages p where p.deleted_at is not null and (select private.is_admin())
  union all
  select 'campaigns', g.id, g.name, g.deleted_at, g.deleted_by
  from public.campaigns g where g.deleted_at is not null and (select private.is_admin())
  union all
  select 'services', s.id, s.name, s.deleted_at, s.deleted_by
  from public.services s where s.deleted_at is not null and (select private.is_admin())
  union all
  select 'ads_staff', a.id, a.full_name, a.deleted_at, a.deleted_by
  from public.ads_staff a where a.deleted_at is not null and (select private.is_admin())
  union all
  select 'ad_accounts', a.id, a.name, a.deleted_at, a.deleted_by
  from public.ad_accounts a where a.deleted_at is not null and (select private.is_admin())
  union all
  select 'ad_account_assignments', x.id,
         a.name || ' → ' || s.full_name || ' (từ ' || to_char(x.from_date, 'DD/MM/YYYY') || ')',
         x.deleted_at, x.deleted_by
  from public.ad_account_assignments x
  join public.ad_accounts a on a.id = x.ad_account_id
  join public.ads_staff s on s.id = x.ads_staff_id
  where x.deleted_at is not null and (select private.is_admin())
  union all
  select 'ad_posts', p.id, coalesce(p.title, p.url), p.deleted_at, p.deleted_by
  from public.ad_posts p where p.deleted_at is not null and (select private.is_admin());
revoke all on public.trash_items from anon, authenticated;
grant select on public.trash_items to authenticated;


-- ---------------------------------------------------------------------
-- 11. TÀI KHOẢN: đổi vai trò, tick quyền "Xuất file", sổ xuất file
-- ---------------------------------------------------------------------

-- Đổi vai trò một tài khoản. Quản trị đổi được các vai trò thường; riêng việc cấp / thu
-- vai trò Quản trị chỉ Quản trị cấp cao làm được. Không ai đổi được vai trò Quản trị cấp cao
-- qua ứng dụng, và không ai tự đổi vai trò của chính mình.
create or replace function public.set_staff_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị được đổi vai trò' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'Không tự đổi vai trò của chính mình' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('admin', 'marketing_manager', 'ads_staff', 'lead', 'sale', 'page') then
    raise exception 'Vai trò không hợp lệ' using errcode = '22023';
  end if;
  select s.role into v_old from public.staff s where s.user_id = p_user_id;
  if v_old is null then
    raise exception 'Không tìm thấy tài khoản' using errcode = '22023';
  end if;
  if v_old = 'super_admin' then
    raise exception 'Không đổi được vai trò của Quản trị cấp cao' using errcode = '42501';
  end if;
  if (v_old = 'admin' or p_role = 'admin') and not private.is_super_admin() then
    raise exception 'Chỉ Quản trị cấp cao được cấp hoặc thu vai trò Quản trị' using errcode = '42501';
  end if;

  update public.staff
  set role = p_role,
      -- Không còn là telesale thì ra khỏi vòng chia lead.
      accepts_leads = case when p_role in ('lead', 'sale') then accepts_leads else false end
  where user_id = p_user_id;
end;
$$;

-- Tick / bỏ tick quyền "Xuất file". Quản trị luôn có quyền này nên không cần tick.
create or replace function public.set_staff_can_export(p_user_id uuid, p_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị được cấp hoặc thu quyền xuất file' using errcode = '42501';
  end if;
  select s.role into v_role from public.staff s where s.user_id = p_user_id;
  if v_role is null then
    raise exception 'Không tìm thấy tài khoản' using errcode = '22023';
  end if;
  if v_role in ('super_admin', 'admin') then
    raise exception 'Quản trị luôn có quyền này, không cần tick' using errcode = '22023';
  end if;

  update public.staff set can_export = coalesce(p_allowed, false) where user_id = p_user_id;
end;
$$;

-- Sổ ghi mỗi lần xuất file (chỉ ghi thêm, không sửa, không xoá).
create table if not exists public.export_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  user_id   uuid not null,
  what      text not null,                        -- loại dữ liệu, vd "leads"
  row_count int,
  details   jsonb not null default '{}'::jsonb,   -- bộ lọc đang dùng, tên file…
  ip        text
);
create index if not exists export_log_at_idx on public.export_log (at desc);

alter table public.export_log enable row level security;
drop policy if exists export_log_select_admin on public.export_log;
create policy export_log_select_admin on public.export_log
  for select to authenticated using ((select private.is_admin()));
revoke all on public.export_log from anon, authenticated;
grant select on public.export_log to authenticated;   -- ghi chỉ qua hàm log_export()

-- Ứng dụng gọi hàm này TRƯỚC khi tạo file: không có quyền thì bị từ chối, có quyền thì được ghi sổ.
create or replace function public.log_export(p_what text, p_row_count int default null, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
begin
  if not private.can_export() then
    raise exception 'Tài khoản của bạn chưa được cấp quyền xuất file' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_what, '')), '') is null then
    raise exception 'Thiếu loại dữ liệu xuất' using errcode = '22023';
  end if;

  insert into public.export_log (user_id, what, row_count, details, ip)
  values (
    (select auth.uid()), btrim(p_what), p_row_count, coalesce(p_details, '{}'::jsonb),
    coalesce(
      v_headers ->> 'cf-connecting-ip',
      v_headers ->> 'x-real-ip',
      nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '')));
end;
$$;


-- ---------------------------------------------------------------------
-- 12. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function private.staff_role() from public;
revoke all on function private.manages_marketing() from public;
revoke all on function private.can_export() from public;
revoke all on function private.today_vn() from public;
revoke all on function private.my_ads_staff_id() from public;
revoke all on function private.has_ad_account(uuid, boolean) from public;
revoke all on function private.has_campaign(uuid, boolean) from public;
grant execute on function private.staff_role() to authenticated;
grant execute on function private.manages_marketing() to authenticated;
grant execute on function private.my_ads_staff_id() to authenticated;
grant execute on function private.has_ad_account(uuid, boolean) to authenticated;
grant execute on function private.has_campaign(uuid, boolean) to authenticated;

revoke all on function public.parse_post_link(text) from public, anon;
revoke all on function public.assign_ad_account(uuid, uuid, date, text) from public, anon;
revoke all on function public.soft_delete_records(text, uuid[]) from public, anon;
revoke all on function public.restore_records(text, uuid[]) from public, anon;
revoke all on function public.set_staff_role(uuid, text) from public, anon;
revoke all on function public.set_staff_can_export(uuid, boolean) from public, anon;
revoke all on function public.log_export(text, int, jsonb) from public, anon;
grant execute on function public.parse_post_link(text) to authenticated;
grant execute on function public.assign_ad_account(uuid, uuid, date, text) to authenticated;
grant execute on function public.soft_delete_records(text, uuid[]) to authenticated;
grant execute on function public.restore_records(text, uuid[]) to authenticated;
grant execute on function public.set_staff_role(uuid, text) to authenticated;
grant execute on function public.set_staff_can_export(uuid, boolean) to authenticated;
grant execute on function public.log_export(text, int, jsonb) to authenticated;

-- Báo cho lớp API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
