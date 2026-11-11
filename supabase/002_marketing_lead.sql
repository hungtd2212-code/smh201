-- =====================================================================
-- Smile Hub ERP — Phân hệ 1: MARKETING → LEAD (đợt 1)
--
-- Chạy SAU supabase/schema.sql. Chạy lại nhiều lần cũng không sao.
-- Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì cả.
--
-- Thêm:
--   • Danh mục: channels (kênh), pages (page / TKQC), services (dịch vụ),
--     campaigns (chiến dịch)
--   • lead_touches: mỗi lần trực page dán một số = một "lần tiếp cận"
--   • Hàm intake_lead(): chuẩn hoá SĐT, xử lý trùng, chia telesale
--   • staff: vai trò 'page' (trực page), bật/tắt nhận lead, lượt xoay vòng
-- =====================================================================
begin;


-- ---------------------------------------------------------------------
-- 0. Hàm phụ trợ kiểm tra quyền (đặt trong schema "private", không lộ ra API)
-- ---------------------------------------------------------------------
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()));
$$;

-- Quản lý = admin hoặc lead: được sửa danh mục, bật/tắt nhận lead của người khác.
create or replace function private.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.role in ('admin', 'lead')
  );
$$;

revoke all on function private.is_staff() from public;
revoke all on function private.is_manager() from public;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.is_manager() to authenticated;


-- ---------------------------------------------------------------------
-- 1. STAFF: thêm vai trò trực page, cơ sở, bật nhận lead, lượt xoay vòng
-- ---------------------------------------------------------------------
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('admin', 'lead', 'sale', 'page'));

alter table public.staff
  add column if not exists branch text not null default 'HN',
  add column if not exists accepts_leads boolean not null default false,  -- đang bật nhận lead
  add column if not exists last_assigned_at timestamptz;                  -- lần gần nhất được chia lead

-- Nhân viên xem được danh sách đồng nghiệp (để chọn telesale khi chia tay).
drop policy if exists staff_select_staff on public.staff;
create policy staff_select_staff on public.staff
  for select to authenticated using (private.is_staff());


-- ---------------------------------------------------------------------
-- 2. DANH MỤC
-- ---------------------------------------------------------------------
create table if not exists public.channels (            -- Kênh
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 1 and 80),
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.services (            -- Dịch vụ & bảng giá
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 1 and 120),
  price      numeric(14, 0) check (price is null or price >= 0),
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pages (               -- Page / tài khoản quảng cáo
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  channel_id uuid not null references public.channels (id),
  branch     text not null default 'HN',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (channel_id, name)
);

create table if not exists public.campaigns (           -- Chiến dịch
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 160),
  channel_id uuid not null references public.channels (id),
  page_id    uuid references public.pages (id),
  service_id uuid references public.services (id),
  branch     text not null default 'HN',
  start_date date,
  end_date   date,
  budget     numeric(14, 0) check (budget is null or budget >= 0),
  owner_id   uuid references public.staff (user_id) on delete set null,  -- người phụ trách
  ads_id     text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists campaigns_page_idx on public.campaigns (page_id);

-- Quyền cho 4 bảng danh mục: nhân viên xem; admin / lead thêm và sửa; không ai xoá (chỉ tắt).
do $$
declare t text;
begin
  foreach t in array array['channels', 'services', 'pages', 'campaigns'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_staff', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_staff())', t || '_select_staff', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_manager', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.is_manager())', t || '_insert_manager', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_manager', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.is_manager()) with check (private.is_manager())', t || '_update_manager', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

insert into public.channels (name, sort_order) values
  ('Facebook', 1), ('TikTok', 2), ('Google', 3), ('Zalo', 4), ('Giới thiệu', 5), ('Vãng lai', 6)
on conflict (name) do nothing;

insert into public.services (name, sort_order) values
  ('Niềng răng', 1), ('Bọc răng sứ', 2), ('Dán sứ Veneer', 3), ('Cấy ghép Implant', 4),
  ('Tẩy trắng răng', 5), ('Nhổ răng khôn', 6), ('Trám răng', 7), ('Lấy cao răng', 8),
  ('Điều trị tuỷ', 9), ('Khám tổng quát', 10)
on conflict (name) do nothing;


-- ---------------------------------------------------------------------
-- 3. LEADS: gắn nguồn theo danh mục, người được chia, trạng thái liên hệ lại
-- ---------------------------------------------------------------------
alter table public.leads
  add column if not exists channel_id        uuid references public.channels (id),
  add column if not exists page_id           uuid references public.pages (id),
  add column if not exists campaign_id       uuid references public.campaigns (id),
  add column if not exists service_id        uuid references public.services (id),
  add column if not exists pancake_url       text,                       -- link hội thoại Pancake
  add column if not exists assignee_id       uuid references public.staff (user_id) on delete set null,
  add column if not exists assign_mode       text check (assign_mode in ('round_robin', 'manual')),
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists last_touch_at     timestamptz,                -- lần tiếp cận gần nhất
  add column if not exists touch_count       int not null default 0,
  add column if not exists recontacted_at    timestamptz,                -- khách nhắn lại, telesale chưa xử lý
  add column if not exists reopened_at       timestamptz,
  add column if not exists invalid_phone     boolean not null default false;  -- telesale đánh dấu "số sai"

-- Mỗi số điện thoại chỉ có MỘT lead (lần dán sau cập nhật lead cũ thay vì tạo lead mới).
drop index if exists public.leads_phone_idx;
create unique index if not exists leads_phone_key on public.leads (phone);

-- Ghi lại thời điểm đổi trạng thái (để tính "đã huỷ / fail quá X ngày").
create or replace function public.leads_track_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.status_changed_at = now();
  return new;
end;
$$;

create or replace trigger leads_track_status
  before update of status on public.leads
  for each row when (new.status is distinct from old.status)
  execute function public.leads_track_status();

-- Từ nay lead mới chỉ được tạo qua hàm intake_lead() bên dưới (để luôn kiểm tra trùng).
drop policy if exists leads_insert_staff on public.leads;
revoke insert on public.leads from authenticated;


-- ---------------------------------------------------------------------
-- 4. LEAD_TOUCHES — mỗi lần dán số là một "lần tiếp cận"
--    result: new = số mới hợp lệ · duplicate = số trùng · reopened = số mở lại
--            existing_customer = khách cũ.  is_invalid = telesale báo "số sai".
-- ---------------------------------------------------------------------
create table if not exists public.lead_touches (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,  -- người dán
  phone       text not null,
  full_name   text,
  channel_id  uuid references public.channels (id),
  page_id     uuid references public.pages (id),
  campaign_id uuid references public.campaigns (id),
  service_id  uuid references public.services (id),
  ads_id      text,
  branch      text not null default 'HN',
  note        text,
  pancake_url text,
  result      text not null check (result in ('new', 'duplicate', 'reopened', 'existing_customer')),
  is_invalid  boolean not null default false,
  assignee_id uuid references public.staff (user_id) on delete set null,
  assign_mode text check (assign_mode in ('round_robin', 'manual', 'kept'))  -- kept = giữ telesale cũ
);
create index if not exists lead_touches_lead_idx on public.lead_touches (lead_id, created_at desc);
create index if not exists lead_touches_creator_idx on public.lead_touches (created_by, created_at desc);

alter table public.lead_touches enable row level security;
drop policy if exists lead_touches_select_staff on public.lead_touches;
create policy lead_touches_select_staff on public.lead_touches
  for select to authenticated using (private.is_staff());
revoke all on public.lead_touches from anon, authenticated;
grant select on public.lead_touches to authenticated;   -- ghi chỉ qua hàm intake_lead()

-- Lead có sẵn từ trước (chưa có lần tiếp cận nào) → ghi nhận một lần "số mới".
insert into public.lead_touches (lead_id, created_at, created_by, phone, full_name, ads_id, branch, note, result)
select l.id, l.created_at, l.created_by, l.phone, l.full_name, l.ads_id, l.branch, l.note, 'new'
from public.leads l
where not exists (select 1 from public.lead_touches t where t.lead_id = l.id);

update public.leads l
set touch_count = (select count(*) from public.lead_touches t where t.lead_id = l.id),
    last_touch_at = (select max(t.created_at) from public.lead_touches t where t.lead_id = l.id)
where l.touch_count = 0;

-- Telesale đánh dấu / bỏ đánh dấu "số sai" trên lead → ghi vào lần dán đã tạo (hoặc mở lại) lead đó.
create or replace function public.leads_sync_invalid_phone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.lead_touches t
  set is_invalid = new.invalid_phone
  where t.id = (
    select x.id from public.lead_touches x
    where x.lead_id = new.id and x.result in ('new', 'reopened')
    order by x.created_at desc limit 1
  );
  return new;
end;
$$;

create or replace trigger leads_sync_invalid_phone
  after update of invalid_phone on public.leads
  for each row when (new.invalid_phone is distinct from old.invalid_phone)
  execute function public.leads_sync_invalid_phone();


-- ---------------------------------------------------------------------
-- 5. CA LÀM (dùng cho xoay vòng "chỉ chia cho người đang trong ca") và CẤU HÌNH
--    Màn hình Chia ca sẽ làm ở đợt 2. Khi một ngày chưa có ca nào được xếp,
--    hệ thống chia cho mọi telesale đang bật nhận lead.
-- ---------------------------------------------------------------------
create table if not exists public.staff_shifts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.staff (user_id) on delete cascade,
  work_date  date not null,
  start_time time not null,
  end_time   time not null check (end_time > start_time),
  created_at timestamptz not null default now(),
  unique (user_id, work_date, start_time)
);
create index if not exists staff_shifts_date_idx on public.staff_shifts (work_date);

alter table public.staff_shifts enable row level security;
drop policy if exists staff_shifts_select_staff on public.staff_shifts;
create policy staff_shifts_select_staff on public.staff_shifts
  for select to authenticated using (private.is_staff());
drop policy if exists staff_shifts_write_manager on public.staff_shifts;
create policy staff_shifts_write_manager on public.staff_shifts
  for all to authenticated using (private.is_manager()) with check (private.is_manager());
revoke all on public.staff_shifts from anon, authenticated;
grant select, insert, update, delete on public.staff_shifts to authenticated;

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_select_staff on public.app_settings;
create policy app_settings_select_staff on public.app_settings
  for select to authenticated using (private.is_staff());
drop policy if exists app_settings_update_manager on public.app_settings;
create policy app_settings_update_manager on public.app_settings
  for update to authenticated using (private.is_manager()) with check (private.is_manager());
revoke all on public.app_settings from anon, authenticated;
grant select, update on public.app_settings to authenticated;

-- X ngày: lead đã huỷ / fail quá số ngày này mà khách nhắn lại thì được mở lại.
insert into public.app_settings (key, value) values ('lead_reopen_days', '30'::jsonb)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- 6. HÀM NGHIỆP VỤ
-- ---------------------------------------------------------------------

-- "+84 912 345 678" / "0912.345.678" → "0912345678"
create or replace function public.normalize_phone(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case when d ~ '^84[0-9]{9,10}$' then '0' || substr(d, 3) else d end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) t;
$$;

-- Số này đã có lead thì lần dán mới được xử lý thế nào?
create or replace function private.lead_touch_outcome(p_status text, p_status_changed_at timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_status = 'da_lam_dich_vu' then 'existing_customer'      -- đã là khách → CSKH
    when p_status in ('so_huy', 'fail', 'so_het_nhu_cau')
         and p_status_changed_at < now() - make_interval(days => coalesce(
           (select (s.value #>> '{}')::int from public.app_settings s where s.key = 'lead_reopen_days'), 30))
      then 'reopened'                                              -- đã đóng quá X ngày → mở lại
    else 'duplicate'                                               -- đang xử lý → số trùng
  end;
$$;
revoke all on function private.lead_touch_outcome(text, timestamptz) from public;

-- Kiểm tra nhanh khi trực page vừa dán số (chưa lưu gì).
create or replace function public.check_lead_phone(p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_lead  public.leads%rowtype;
begin
  if not private.is_staff() then
    raise exception 'Tài khoản chưa được cấp quyền' using errcode = '42501';
  end if;
  if v_phone !~ '^0[0-9]{9,10}$' then
    return jsonb_build_object('valid', false, 'phone', v_phone);
  end if;

  select * into v_lead from public.leads where phone = v_phone;
  if not found then
    return jsonb_build_object('valid', true, 'phone', v_phone, 'outcome', 'new');
  end if;

  return jsonb_build_object(
    'valid', true,
    'phone', v_phone,
    'outcome', private.lead_touch_outcome(v_lead.status, v_lead.status_changed_at),
    'lead', jsonb_build_object(
      'id', v_lead.id, 'full_name', v_lead.full_name, 'status', v_lead.status,
      'assignee', v_lead.assignee, 'created_at', v_lead.created_at,
      'status_changed_at', v_lead.status_changed_at, 'touch_count', v_lead.touch_count)
  );
end;
$$;

-- Trực page dán một số: chuẩn hoá, xử lý trùng theo quy tắc "nguồn gần nhất", chia telesale.
create or replace function public.intake_lead(
  p_phone       text,
  p_full_name   text,
  p_channel_id  uuid,
  p_page_id     uuid default null,
  p_campaign_id uuid default null,
  p_service_id  uuid default null,
  p_ads_id      text default null,
  p_branch      text default 'HN',
  p_note        text default null,
  p_pancake_url text default null,
  p_assignee_id uuid default null          -- null = xoay vòng; có giá trị = chia tay
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_phone   text := public.normalize_phone(p_phone);
  v_name    text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_url     text := nullif(btrim(coalesce(p_pancake_url, '')), '');
  v_ads     text := nullif(btrim(coalesce(p_ads_id, '')), '');
  v_branch  text := coalesce(nullif(btrim(coalesce(p_branch, '')), ''), 'HN');
  v_today   date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_time    time := (now() at time zone 'Asia/Ho_Chi_Minh')::time;
  v_lead    public.leads%rowtype;
  v_outcome text;
  v_lead_id uuid;
  v_channel_name  text;
  v_service_name  text;
  v_assignee_id   uuid;
  v_assignee_name text;
  v_mode          text;
begin
  if not private.is_staff() then
    raise exception 'Tài khoản chưa được cấp quyền' using errcode = '42501';
  end if;
  if v_phone !~ '^0[0-9]{9,10}$' then
    raise exception 'Số điện thoại không hợp lệ' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'Thiếu họ tên khách' using errcode = '22023';
  end if;

  select c.name into v_channel_name from public.channels c where c.id = p_channel_id;
  if v_channel_name is null then
    raise exception 'Chưa chọn kênh' using errcode = '22023';
  end if;
  select s.name into v_service_name from public.services s where s.id = p_service_id;

  -- Xử lý lần lượt từng lần dán: không chia trùng lượt, không tạo hai lead cùng số.
  perform pg_advisory_xact_lock(hashtext('public.intake_lead'));

  select * into v_lead from public.leads where phone = v_phone for update;
  if not found then
    v_outcome := 'new';
  else
    v_outcome := private.lead_touch_outcome(v_lead.status, v_lead.status_changed_at);
    v_lead_id := v_lead.id;
  end if;

  -- Chỉ lead mới và lead mở lại mới được chia (lead đang xử lý giữ telesale cũ).
  if v_outcome in ('new', 'reopened') then
    if p_assignee_id is not null then
      select s.user_id, s.full_name into v_assignee_id, v_assignee_name
      from public.staff s where s.user_id = p_assignee_id;
      if v_assignee_id is null then
        raise exception 'Không tìm thấy telesale được chọn' using errcode = '22023';
      end if;
      v_mode := 'manual';
    else
      -- Xoay vòng: người đang bật nhận lead, cùng cơ sở, đang trong ca
      -- (ngày chưa xếp ca nào thì bỏ qua điều kiện ca); ai lâu chưa được chia nhất thì nhận.
      select s.user_id, s.full_name into v_assignee_id, v_assignee_name
      from public.staff s
      where s.accepts_leads
        and s.branch = v_branch
        and (
          not exists (select 1 from public.staff_shifts x where x.work_date = v_today)
          or exists (
            select 1 from public.staff_shifts x
            where x.user_id = s.user_id and x.work_date = v_today
              and v_time >= x.start_time and v_time < x.end_time)
        )
      order by s.last_assigned_at asc nulls first, s.created_at asc
      limit 1;
      v_mode := 'round_robin';
    end if;

    -- Chia tay cũng tính một lượt, để số lượng giữa các telesale không lệch.
    if v_assignee_id is not null then
      update public.staff set last_assigned_at = clock_timestamp() where user_id = v_assignee_id;
    end if;
  end if;

  if v_outcome = 'new' then
    insert into public.leads (
      branch, full_name, phone, service, service_id, source, channel_id, page_id, campaign_id,
      ads_id, status, assignee, assignee_id, assign_mode, note, pancake_url,
      last_touch_at, touch_count, created_by)
    values (
      v_branch, v_name, v_phone, v_service_name, p_service_id, v_channel_name, p_channel_id, p_page_id, p_campaign_id,
      v_ads, 'so_moi', v_assignee_name, v_assignee_id, case when v_assignee_id is null then null else v_mode end, v_note, v_url,
      now(), 1, v_uid)
    returning id into v_lead_id;

  elsif v_outcome = 'reopened' then
    update public.leads set
      status = 'so_moi', full_name = v_name,
      service = coalesce(v_service_name, service), service_id = coalesce(p_service_id, service_id),
      source = v_channel_name, channel_id = p_channel_id, page_id = p_page_id, campaign_id = p_campaign_id,
      ads_id = v_ads, branch = v_branch,
      assignee = v_assignee_name, assignee_id = v_assignee_id,
      assign_mode = case when v_assignee_id is null then null else v_mode end,
      note = coalesce(v_note, note), pancake_url = coalesce(v_url, pancake_url),
      appointment_at = null, invalid_phone = false, recontacted_at = null,
      reopened_at = now(), last_touch_at = now(), touch_count = touch_count + 1
    where id = v_lead_id;

  elsif v_outcome = 'duplicate' then
    -- Lead đang xử lý: cập nhật nguồn gần nhất, giữ telesale cũ, báo cho telesale đó.
    update public.leads set
      source = v_channel_name, channel_id = p_channel_id, page_id = p_page_id, campaign_id = p_campaign_id,
      ads_id = coalesce(v_ads, ads_id), pancake_url = coalesce(v_url, pancake_url),
      recontacted_at = now(), last_touch_at = now(), touch_count = touch_count + 1
    where id = v_lead_id;

  else
    -- Khách cũ: không tính là lead marketing, chỉ đánh dấu để CSKH liên hệ.
    update public.leads set
      recontacted_at = now(), last_touch_at = now(), touch_count = touch_count + 1
    where id = v_lead_id;
  end if;

  insert into public.lead_touches (
    lead_id, created_by, phone, full_name, channel_id, page_id, campaign_id, service_id,
    ads_id, branch, note, pancake_url, result, assignee_id, assign_mode)
  values (
    v_lead_id, v_uid, v_phone, v_name, p_channel_id, p_page_id, p_campaign_id, p_service_id,
    v_ads, v_branch, v_note, v_url, v_outcome,
    case when v_outcome in ('new', 'reopened') then v_assignee_id else v_lead.assignee_id end,
    case when v_outcome in ('new', 'reopened') then (case when v_assignee_id is null then null else v_mode end) else 'kept' end);

  return jsonb_build_object(
    'outcome', v_outcome,
    'lead_id', v_lead_id,
    'phone', v_phone,
    'full_name', case when v_outcome in ('new', 'reopened') then v_name else v_lead.full_name end,
    'assignee', case when v_outcome in ('new', 'reopened') then v_assignee_name else v_lead.assignee end,
    'assign_mode', case when v_outcome in ('new', 'reopened') then v_mode else 'kept' end,
    'previous_status', v_lead.status
  );
end;
$$;

-- Bật / tắt nhận lead: quản lý đổi cho bất kỳ ai, nhân viên tự đổi cho mình.
create or replace function public.set_accepts_leads(p_user_id uuid, p_value boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_manager() or (private.is_staff() and p_user_id = (select auth.uid()))) then
    raise exception 'Không có quyền đổi trạng thái nhận lead của người này' using errcode = '42501';
  end if;
  update public.staff set accepts_leads = p_value where user_id = p_user_id;
end;
$$;

revoke all on function public.check_lead_phone(text) from public, anon;
revoke all on function public.intake_lead(text, text, uuid, uuid, uuid, uuid, text, text, text, text, uuid) from public, anon;
revoke all on function public.set_accepts_leads(uuid, boolean) from public, anon;
grant execute on function public.check_lead_phone(text) to authenticated;
grant execute on function public.intake_lead(text, text, uuid, uuid, uuid, uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.set_accepts_leads(uuid, boolean) to authenticated;

-- Báo cho API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
