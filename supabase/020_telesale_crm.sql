-- =====================================================================
-- Smile Hub ERP — TELESALE CRM: TRẠNG THÁI TUỲ CHỈNH, BẢNG LEAD MỚI, CHIA SỐ
--
-- Chạy SAU supabase/019_online_presence.sql. Chạy lại nhiều lần cũng không sao.
-- Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có:
--   • thêm bảng lead_statuses (12 trạng thái làm sẵn theo ảnh chủ phòng khám gửi),
--   • thêm cột mới cho leads / lead_touches (để trống với lead cũ),
--   • thêm 1 dòng cấu hình "cách chia số" (mặc định: tự động).
-- Trạng thái cũ của lead cũ (cột status) giữ nguyên; việc đổi sang trạng thái mới
-- nằm ở file riêng, chỉ chạy khi chủ phòng khám duyệt bảng đối chiếu.
--
-- Quy trình (chủ phòng khám, 13/11/2026):
--   1. Số về (Pancake sau này, hoặc nút "Thêm số") → chỉ chia cho nhân viên Telesale
--      (vai trò Telesale / Trưởng Telesale) đang bật nhận số; tự động xoay vòng
--      hoặc chia tay tuỳ cài đặt.
--   2. Chỉ Admin, COO, Trưởng Telesale và Trực page được đổi sale quản lý số.
--   3. Telesale chỉ thấy số mình đang quản lý; quản lý và trực page thấy tất cả.
--   4. Số trùng (số đã có) → giữ sale cũ, đánh dấu trùng, báo khách nhắn lại.
--   5. Trạng thái khách hàng do quản lý tự thêm / đổi tên / đổi màu / sắp xếp.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. QUYỀN: ai được đổi sale quản lý số (Admin, COO = Quản trị, Trưởng Telesale, Trực page)
-- ---------------------------------------------------------------------
create or replace function private.can_transfer_leads()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null
      and s.role in ('super_admin', 'admin', 'lead', 'page'));
$$;
revoke all on function private.can_transfer_leads() from public;
grant execute on function private.can_transfer_leads() to authenticated;

-- Nhân viên Telesale nhận được số: vai trò Telesale / Trưởng Telesale, không khoá, chưa xoá.
create or replace function private.is_telesale(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = p_user_id and s.locked_at is null and s.deleted_at is null
      and s.role in ('lead', 'sale'));
$$;
revoke all on function private.is_telesale(uuid) from public;


-- ---------------------------------------------------------------------
-- 1. TRẠNG THÁI KHÁCH HÀNG (tuỳ chỉnh ở Telesale → Cài đặt)
-- ---------------------------------------------------------------------
create table if not exists public.lead_statuses (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(btrim(name)) between 1 and 60),
  color             text not null check (color ~ '^#[0-9a-fA-F]{6}$'),        -- màu nền
  text_color        text not null check (text_color ~ '^#[0-9a-fA-F]{6}$'),   -- màu chữ
  sort_order        int  not null default 0,
  is_active         boolean not null default true,     -- false = ẩn khỏi ô chọn (số cũ vẫn giữ)
  needs_appointment boolean not null default false,    -- chọn trạng thái này thì phải có lịch hẹn
  needs_deal        boolean not null default false,    -- chọn trạng thái này thì phải có doanh số
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid() references auth.users (id) on delete set null
);
create unique index if not exists lead_statuses_name_key on public.lead_statuses (lower(btrim(name)));

create or replace trigger lead_statuses_set_updated_at
  before update on public.lead_statuses
  for each row execute function public.set_updated_at();

alter table public.lead_statuses enable row level security;
drop policy if exists lead_statuses_select on public.lead_statuses;
create policy lead_statuses_select on public.lead_statuses
  for select to authenticated using ((select private.is_staff()));
drop policy if exists lead_statuses_insert on public.lead_statuses;
create policy lead_statuses_insert on public.lead_statuses
  for insert to authenticated with check ((select private.is_manager()));
drop policy if exists lead_statuses_update on public.lead_statuses;
create policy lead_statuses_update on public.lead_statuses
  for update to authenticated using ((select private.is_manager())) with check ((select private.is_manager()));
revoke all on public.lead_statuses from anon, authenticated;
grant select, insert, update on public.lead_statuses to authenticated;   -- không xoá, chỉ ẩn

create or replace trigger zz_audit
  after insert or update or delete on public.lead_statuses
  for each row execute function private.audit_row('id', 'updated_at');

-- 12 trạng thái làm sẵn (theo ảnh chủ phòng khám gửi), chỉ khi bảng còn trống.
insert into public.lead_statuses (name, color, text_color, sort_order, needs_appointment, needs_deal)
select v.name, v.color, v.text_color, v.sort_order, v.needs_appointment, v.needs_deal
from (values
  ('KHTN',             '#3f9b35', '#ffffff', 1,  false, false),
  ('Tham khảo thêm',   '#e5e7eb', '#374151', 2,  false, false),
  ('KNM',              '#5b3c94', '#ffffff', 3,  false, false),
  ('Đặt lịch hẹn',     '#f6e05e', '#3f3200', 4,  true,  false),
  ('Chốt',             '#1e4fa3', '#ffffff', 5,  false, true),
  ('Hẹn không đến',    '#e9dcf6', '#5b3c94', 6,  false, false),
  ('Bong',             '#6b3a10', '#fde7cf', 7,  false, false),
  ('Cho SĐT',          '#b42318', '#ffffff', 8,  false, false),
  ('Không có nhu cầu', '#3a3a3a', '#ffffff', 9,  false, false),
  ('Sai số',           '#9b1c1c', '#ffffff', 10, false, false),
  ('Đã qua',           '#f9cdc7', '#b42318', 11, false, false),
  ('Gọi lại sau',      '#d5ecd0', '#25632a', 12, false, false)
) as v (name, color, text_color, sort_order, needs_appointment, needs_deal)
where not exists (select 1 from public.lead_statuses);

-- Sắp xếp lại: nhận danh sách id theo thứ tự mới; chỉ dòng đổi chỗ mới bị sửa.
create or replace function public.reorder_lead_statuses(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_manager() then
    raise exception 'Chỉ Quản trị và Trưởng Telesale được sắp xếp trạng thái' using errcode = '42501';
  end if;
  update public.lead_statuses s
  set sort_order = x.pos
  from unnest(p_ids) with ordinality as x (id, pos)
  where s.id = x.id and s.sort_order is distinct from x.pos::int;
end;
$$;
revoke all on function public.reorder_lead_statuses(uuid[]) from public, anon;
grant execute on function public.reorder_lead_statuses(uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- 2. CỘT MỚI CỦA LEAD (các cột của bảng Lead theo mẫu chủ phòng khám gửi)
-- ---------------------------------------------------------------------
alter table public.leads
  add column if not exists status_id            uuid references public.lead_statuses (id),       -- TÌNH TRẠNG (trống = chưa xử lý)
  add column if not exists ad_post_id           uuid references public.ad_posts (id),            -- BÀI CHẠY
  add column if not exists ads_staff_id         uuid references public.ads_staff (id),           -- nhân viên Ads của bài, lúc số về
  add column if not exists consult_info         text,                                            -- KHAI THÁC THÔNG TIN / NHẬT KÝ TƯ VẤN
  add column if not exists deal_amount          bigint,                                          -- DOANH SỐ (đ)
  add column if not exists paid_amount          bigint,                                          -- DOANH THU (đ)
  add column if not exists area                 text,                                            -- KHU VỰC
  add column if not exists gender               text,                                            -- GIỚI TÍNH
  add column if not exists age                  int,                                             -- TUỔI
  add column if not exists budget               text,                                            -- NGÂN SÁCH
  add column if not exists previous_assignee_id uuid references public.staff (user_id) on delete set null,  -- ĐẢO SỐ: sale trước
  add column if not exists transfer_count       int not null default 0,                          -- số lần đảo
  add column if not exists transferred_at       timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_crm_fields_check') then
    alter table public.leads add constraint leads_crm_fields_check check (
      (consult_info is null or char_length(consult_info) <= 5000)
      and (deal_amount is null or deal_amount >= 0)
      and (paid_amount is null or paid_amount >= 0)
      and (area is null or char_length(area) <= 100)
      and (gender is null or gender in ('male', 'female'))
      and (age is null or age between 1 and 120)
      and (budget is null or char_length(budget) <= 100));
  end if;
end $$;

create index if not exists leads_assignee_idx on public.leads (assignee_id, created_at desc);
create index if not exists leads_status_id_idx on public.leads (status_id);

alter table public.lead_touches
  add column if not exists ad_post_id   uuid references public.ad_posts (id),
  add column if not exists ads_staff_id uuid references public.ads_staff (id);

-- Đổi trạng thái mới cũng ghi lại thời điểm đổi (như cột trạng thái cũ).
create or replace trigger leads_track_status_id
  before update of status_id on public.leads
  for each row when (new.status_id is distinct from old.status_id)
  execute function public.leads_track_status();


-- ---------------------------------------------------------------------
-- 3. ĐỔI SALE QUẢN LÝ SỐ
--    Chỉ Admin, COO, Trưởng Telesale, Trực page; người nhận phải là nhân viên Telesale.
--    Mỗi lần đổi ghi lại sale trước (cột ĐẢO SỐ) và đếm số lần đảo; lịch sử đầy đủ
--    nằm trong nhật ký thay đổi. Chạy cho cả màn hình cũ lẫn mới.
-- ---------------------------------------------------------------------
create or replace function private.leads_guard_assignee()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  -- Hoàn tác / thao tác trực tiếp trong Supabase: giữ nguyên như được yêu cầu.
  if (select auth.uid()) is null or coalesce(current_setting('app.soft_delete', true), '') = 'on' then
    return new;
  end if;
  -- Chia tự động trong hàm add_lead đã tự kiểm tra; người khác phải có quyền đổi sale.
  if coalesce(current_setting('app.lead_assign', true), '') <> 'on' and not private.can_transfer_leads() then
    raise exception 'Chỉ Admin, COO, Trưởng Telesale và Trực page được đổi sale quản lý số' using errcode = '42501';
  end if;
  if new.assignee_id is not null then
    if not private.is_telesale(new.assignee_id) then
      raise exception 'Chỉ chia số cho nhân viên Telesale đang làm' using errcode = '22023';
    end if;
    select s.full_name into v_name from public.staff s where s.user_id = new.assignee_id;
  end if;
  new.assignee := v_name;
  if coalesce(current_setting('app.lead_assign', true), '') <> 'on' then
    new.assign_mode := case when new.assignee_id is null then null else 'manual' end;
  end if;
  if old.assignee_id is not null then
    new.previous_assignee_id := old.assignee_id;
    new.transfer_count := old.transfer_count + 1;
  end if;
  new.transferred_at := now();
  return new;
end;
$$;
revoke all on function private.leads_guard_assignee() from public;

create or replace trigger leads_guard_assignee
  before update of assignee_id on public.leads
  for each row when (new.assignee_id is distinct from old.assignee_id)
  execute function private.leads_guard_assignee();


-- ---------------------------------------------------------------------
-- 4. AI THẤY SỐ NÀO: Telesale chỉ thấy số mình đang quản lý; quản lý, trực page,
--    Trưởng Marketing thấy tất cả; nhân viên Ads không thấy (như trước).
-- ---------------------------------------------------------------------
create or replace function private.sees_all_leads()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null
      and s.role in ('super_admin', 'admin', 'lead', 'page', 'marketing_manager'));
$$;
revoke all on function private.sees_all_leads() from public;
grant execute on function private.sees_all_leads() to authenticated;

drop policy if exists leads_select_staff on public.leads;
create policy leads_select_staff on public.leads
  for select to authenticated
  using ((select private.is_staff())
         and ((select private.sees_all_leads())
              or ((select private.staff_role()) = 'sale' and assignee_id = (select auth.uid())))
         and (deleted_at is null or (select private.is_admin())));

drop policy if exists leads_update_staff on public.leads;
create policy leads_update_staff on public.leads
  for update to authenticated
  using ((select private.is_staff())
         and ((select private.sees_all_leads())
              or ((select private.staff_role()) = 'sale' and assignee_id = (select auth.uid())))
         and deleted_at is null)
  with check ((select private.is_staff()));

drop policy if exists lead_touches_select_staff on public.lead_touches;
create policy lead_touches_select_staff on public.lead_touches
  for select to authenticated
  using ((select private.is_staff())
         and exists (select 1 from public.leads l where l.id = lead_touches.lead_id));


-- ---------------------------------------------------------------------
-- 5. CÁCH CHIA SỐ: auto = tự động xoay vòng · manual = để "Chưa chia", người có quyền tự chia
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values ('lead_assign_mode', '"auto"'::jsonb)
on conflict (key) do nothing;

-- Quản lý (Quản trị, Trưởng Telesale) chỉnh "Số ngày mở lại lead" và "Cách chia số";
-- các ngưỡng an toàn vẫn chỉ Quản trị cấp cao chỉnh.
drop policy if exists app_settings_update_manager on public.app_settings;
create policy app_settings_update_manager on public.app_settings
  for update to authenticated
  using (case when key in ('lead_reopen_days', 'lead_assign_mode') then (select private.is_manager())
              else (select private.is_super_admin()) end)
  with check (case when key in ('lead_reopen_days', 'lead_assign_mode') then (select private.is_manager())
                   else (select private.is_super_admin()) end);

-- Người kế tiếp trong vòng xoay: nhân viên Telesale đang bật nhận số, cùng cơ sở, đang trong
-- ca (ngày chưa xếp ca nào thì bỏ qua điều kiện ca); ai lâu chưa được chia nhất thì nhận.
create or replace function private.next_telesale(p_branch text)
returns uuid language sql stable security definer set search_path = '' as $$
  select s.user_id
  from public.staff s
  where s.accepts_leads
    and s.locked_at is null and s.deleted_at is null
    and s.role in ('lead', 'sale')
    and s.branch = p_branch
    and (
      not exists (select 1 from public.staff_shifts x where x.work_date = private.today_vn())
      or exists (
        select 1 from public.staff_shifts x
        where x.user_id = s.user_id and x.work_date = private.today_vn()
          and (now() at time zone 'Asia/Ho_Chi_Minh')::time >= x.start_time
          and (now() at time zone 'Asia/Ho_Chi_Minh')::time < x.end_time)
    )
  order by s.last_assigned_at asc nulls first, s.created_at asc
  limit 1;
$$;
revoke all on function private.next_telesale(text) from public;


-- ---------------------------------------------------------------------
-- 6. THÊM SỐ (nút "Thêm số"; Pancake sau này cũng gọi hàm này)
--    Chọn bài chạy → tự biết chiến dịch, page, kênh, dịch vụ và nhân viên Ads phụ trách
--    TKQC của bài vào ngày số về.
-- ---------------------------------------------------------------------
create or replace function public.add_lead(
  p_phone       text,
  p_full_name   text,
  p_channel_id  uuid default null,
  p_page_id     uuid default null,
  p_ad_post_id  uuid default null,
  p_service_id  uuid default null,
  p_note        text default null,
  p_pancake_url text default null,
  p_assignee_id uuid default null,          -- null = theo cài đặt (tự động xoay vòng / để chưa chia)
  p_branch      text default 'HN'
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := (select auth.uid());
  v_phone      text := public.normalize_phone(p_phone);
  v_name       text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_url        text := nullif(btrim(coalesce(p_pancake_url, '')), '');
  v_branch     text := coalesce(nullif(btrim(coalesce(p_branch, '')), ''), 'HN');
  v_channel_id uuid := p_channel_id;
  v_page_id    uuid := p_page_id;
  v_service_id uuid := p_service_id;
  v_campaign   public.campaigns%rowtype;
  v_post       public.ad_posts%rowtype;
  v_ads_staff  uuid;
  v_ads_id     text;
  v_channel    text;
  v_service    text;
  v_lead       public.leads%rowtype;
  v_lead_id    uuid;
  v_outcome    text;
  v_assignee   uuid;
  v_mode       text;
  v_auto       boolean;
begin
  if not private.is_staff() or private.staff_role() = 'ads_staff' then
    raise exception 'Tài khoản này không được thêm số' using errcode = '42501';
  end if;
  if v_phone !~ '^0[0-9]{9,10}$' then
    raise exception 'Số điện thoại không hợp lệ' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'Thiếu tên khách' using errcode = '22023';
  end if;
  if p_assignee_id is not null then
    if not private.can_transfer_leads() then
      raise exception 'Chỉ Admin, COO, Trưởng Telesale và Trực page được chọn sale' using errcode = '42501';
    end if;
    if not private.is_telesale(p_assignee_id) then
      raise exception 'Chỉ chia số cho nhân viên Telesale đang làm' using errcode = '22023';
    end if;
  end if;

  -- Bài chạy → chiến dịch → page / kênh / dịch vụ / TKQC → nhân viên Ads của TKQC hôm nay.
  if p_ad_post_id is not null then
    select * into v_post from public.ad_posts p where p.id = p_ad_post_id and p.deleted_at is null;
    if not found then
      raise exception 'Không tìm thấy bài chạy đã chọn' using errcode = '22023';
    end if;
    v_ads_id := coalesce(v_post.ad_id, v_post.post_id);
    if v_post.campaign_id is not null then
      select * into v_campaign from public.campaigns c where c.id = v_post.campaign_id;
      v_channel_id := coalesce(v_channel_id, v_campaign.channel_id);
      v_page_id := coalesce(v_page_id, v_campaign.page_id);
      v_service_id := coalesce(v_service_id, v_campaign.service_id);
      select a.ads_staff_id into v_ads_staff
      from public.ad_account_assignments a
      where a.ad_account_id = v_campaign.ad_account_id and a.deleted_at is null
        and a.from_date <= private.today_vn() and (a.to_date is null or a.to_date >= private.today_vn())
      order by a.from_date desc limit 1;
    end if;
  end if;

  select c.name into v_channel from public.channels c where c.id = v_channel_id and c.deleted_at is null;
  if v_channel is null then
    raise exception 'Chưa chọn nguồn (kênh)' using errcode = '22023';
  end if;
  select s.name into v_service from public.services s where s.id = v_service_id;

  -- Xử lý lần lượt từng số: không chia trùng lượt, không tạo hai lead cùng số.
  perform pg_advisory_xact_lock(hashtext('public.intake_lead'));

  select * into v_lead from public.leads l where l.phone = v_phone and l.deleted_at is null for update;
  v_outcome := case when found then 'duplicate' else 'new' end;
  v_lead_id := v_lead.id;

  -- Cần chia khi: số mới, hoặc số trùng mà sale cũ không còn nhận được (nghỉ, khoá, đổi vị trí).
  if v_outcome = 'new' or v_lead.assignee_id is null or not private.is_telesale(v_lead.assignee_id) then
    if p_assignee_id is not null then
      v_assignee := p_assignee_id;
      v_mode := 'manual';
    else
      select coalesce((s.value #>> '{}') = 'auto', true) into v_auto
      from public.app_settings s where s.key = 'lead_assign_mode';
      if coalesce(v_auto, true) then
        v_assignee := private.next_telesale(v_branch);
        v_mode := case when v_assignee is null then null else 'round_robin' end;
      end if;
    end if;
    -- Chia tay cũng tính một lượt, để số lượng giữa các telesale không lệch.
    if v_assignee is not null then
      update public.staff set last_assigned_at = clock_timestamp() where user_id = v_assignee;
    end if;
  else
    v_assignee := v_lead.assignee_id;
    v_mode := 'kept';
  end if;

  perform set_config('app.lead_assign', 'on', true);
  if v_outcome = 'new' then
    insert into public.leads (
      branch, full_name, phone, service, service_id, source, channel_id, page_id, campaign_id,
      ad_post_id, ads_staff_id, ads_id, assignee, assignee_id, assign_mode, note, pancake_url,
      last_touch_at, touch_count, created_by)
    values (
      v_branch, v_name, v_phone, v_service, v_service_id, v_channel, v_channel_id, v_page_id, v_campaign.id,
      p_ad_post_id, v_ads_staff, v_ads_id,
      (select s.full_name from public.staff s where s.user_id = v_assignee), v_assignee, v_mode, v_note, v_url,
      now(), 1, v_uid)
    returning id into v_lead_id;
  else
    -- Số trùng: cập nhật nguồn gần nhất, giữ sale cũ (trừ khi sale cũ không còn nhận được), báo khách nhắn lại.
    update public.leads set
      source = v_channel, channel_id = v_channel_id, page_id = v_page_id, campaign_id = v_campaign.id,
      ad_post_id = p_ad_post_id, ads_staff_id = v_ads_staff, ads_id = coalesce(v_ads_id, ads_id),
      service = coalesce(service, v_service), service_id = coalesce(service_id, v_service_id),
      pancake_url = coalesce(v_url, pancake_url),
      note = case when v_note is null then note when note is null then v_note else note || E'\n' || v_note end,
      assignee_id = v_assignee,
      assign_mode = case when v_mode = 'kept' then assign_mode else v_mode end,
      recontacted_at = now(), last_touch_at = now(), touch_count = touch_count + 1
    where id = v_lead_id;
  end if;
  perform set_config('app.lead_assign', 'off', true);

  insert into public.lead_touches (
    lead_id, created_by, phone, full_name, channel_id, page_id, campaign_id, service_id,
    ad_post_id, ads_staff_id, ads_id, branch, note, pancake_url, result, assignee_id, assign_mode)
  values (
    v_lead_id, v_uid, v_phone, v_name, v_channel_id, v_page_id, v_campaign.id, v_service_id,
    p_ad_post_id, v_ads_staff, v_ads_id, v_branch, v_note, v_url, v_outcome, v_assignee, v_mode);

  return jsonb_build_object(
    'outcome', v_outcome,
    'lead_id', v_lead_id,
    'phone', v_phone,
    'full_name', case when v_outcome = 'new' then v_name else v_lead.full_name end,
    'assignee', (select s.full_name from public.staff s where s.user_id = v_assignee),
    'assign_mode', v_mode);
end;
$$;
revoke all on function public.add_lead(text, text, uuid, uuid, uuid, uuid, text, text, uuid, text) from public, anon;
grant execute on function public.add_lead(text, text, uuid, uuid, uuid, uuid, text, text, uuid, text) to authenticated;

-- Kiểm tra nhanh khi vừa nhập số (chưa lưu gì): số mới hay trùng, đang ở trạng thái nào, sale nào.
create or replace function public.check_lead_phone_v2(p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_lead  public.leads%rowtype;
begin
  if not private.is_staff() or private.staff_role() = 'ads_staff' then
    raise exception 'Tài khoản này không được thêm số' using errcode = '42501';
  end if;
  if v_phone !~ '^0[0-9]{9,10}$' then
    return jsonb_build_object('valid', false, 'phone', v_phone);
  end if;
  select * into v_lead from public.leads l where l.phone = v_phone and l.deleted_at is null;
  if not found then
    return jsonb_build_object('valid', true, 'phone', v_phone, 'outcome', 'new');
  end if;
  return jsonb_build_object(
    'valid', true, 'phone', v_phone, 'outcome', 'duplicate',
    'lead', jsonb_build_object(
      'id', v_lead.id, 'full_name', v_lead.full_name, 'created_at', v_lead.created_at,
      'assignee', v_lead.assignee, 'touch_count', v_lead.touch_count,
      'status_name', (select st.name from public.lead_statuses st where st.id = v_lead.status_id)));
end;
$$;
revoke all on function public.check_lead_phone_v2(text) from public, anon;
grant execute on function public.check_lead_phone_v2(text) to authenticated;

-- Báo cho API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
