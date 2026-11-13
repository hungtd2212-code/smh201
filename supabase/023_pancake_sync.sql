-- =====================================================================
-- Smile Hub ERP — TỰ KÉO SỐ ĐIỆN THOẠI TỪ PANCAKE VỀ BẢNG LEAD
--
-- Chạy SAU supabase/020_telesale_crm.sql. Chạy lại nhiều lần cũng không sao.
-- Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có. Nó thêm:
--   • bảng pancake_pages: page Pancake nào nối với page nào trong ERP. Page Access Token cất ở
--     bảng riêng (private.pancake_tokens), không ai đọc lại được qua ứng dụng;
--   • bảng pancake_imports: nhật ký từng số đã kéo về, để không kéo trùng và để xem lại;
--   • lịch chạy mỗi phút (tiện ích pg_cron của Supabase) hỏi Pancake các hội thoại vừa có hoạt động
--     (tiện ích pg_net gọi https://pages.fm/api/public_api/v2/pages/{id}/conversations —
--     tài liệu: https://developer.pancake.biz);
--   • tách phần lõi của add_lead ra private.add_lead_core để số từ Pancake đi đúng quy tắc của
--     nút "Thêm số": chia cho Telesale (tự động / để chưa chia), số trùng giữ sale cũ.
--
-- Vì sao hỏi định kỳ mà không dùng Webhook của Pancake: Webhook tốn thêm 1 slot kết nối (trả phí)
-- cho mỗi page; hỏi bằng Page Access Token thì miễn phí, giới hạn 5 lần / giây / page — ở đây
-- chỉ 1 lần / phút / page. Câu trả lời của Pancake về sau (pg_net chạy nền), nên được đọc ở lượt
-- chạy kế tiếp: số mới thường vào bảng Lead sau 1–2 phút.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. TIỆN ÍCH CỦA SUPABASE: pg_net (gọi web từ cơ sở dữ liệu), pg_cron (lịch chạy)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;                       -- theo hướng dẫn của Supabase
    grant all privileges on all tables in schema cron to postgres;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1. THÊM SỐ: tách phần lõi để Pancake dùng chung
--    public.add_lead (nút "Thêm số") giữ nguyên cách gọi và quyền như file 020;
--    phần còn lại chuyển sang private.add_lead_core. Thêm p_ads_id: ID quảng cáo Pancake báo về,
--    giữ lại kể cả khi bài chạy đó chưa khai báo trong ERP.
-- ---------------------------------------------------------------------
create or replace function private.add_lead_core(
  p_actor       uuid,                       -- người thêm; null = hệ thống (Pancake)
  p_phone       text,
  p_full_name   text,
  p_channel_id  uuid,
  p_page_id     uuid,
  p_ad_post_id  uuid,
  p_service_id  uuid,
  p_note        text,
  p_pancake_url text,
  p_assignee_id uuid,                       -- đã kiểm tra quyền ở hàm gọi; null = theo cài đặt
  p_branch      text,
  p_ads_id      text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
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
  if v_phone !~ '^0[0-9]{9,10}$' then
    raise exception 'Số điện thoại không hợp lệ' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'Thiếu tên khách' using errcode = '22023';
  end if;
  if p_assignee_id is not null and not private.is_telesale(p_assignee_id) then
    raise exception 'Chỉ chia số cho nhân viên Telesale đang làm' using errcode = '22023';
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
  v_ads_id := coalesce(v_ads_id, nullif(btrim(coalesce(p_ads_id, '')), ''));

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
      v_post.id, v_ads_staff, v_ads_id,
      (select s.full_name from public.staff s where s.user_id = v_assignee), v_assignee, v_mode, v_note, v_url,
      now(), 1, p_actor)
    returning id into v_lead_id;
  else
    -- Số trùng: cập nhật nguồn gần nhất, giữ sale cũ (trừ khi sale cũ không còn nhận được), báo khách nhắn lại.
    update public.leads set
      source = v_channel, channel_id = v_channel_id, page_id = v_page_id, campaign_id = v_campaign.id,
      ad_post_id = v_post.id, ads_staff_id = v_ads_staff, ads_id = coalesce(v_ads_id, ads_id),
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
    v_lead_id, p_actor, v_phone, v_name, v_channel_id, v_page_id, v_campaign.id, v_service_id,
    v_post.id, v_ads_staff, v_ads_id, v_branch, v_note, v_url, v_outcome, v_assignee, v_mode);

  return jsonb_build_object(
    'outcome', v_outcome,
    'lead_id', v_lead_id,
    'phone', v_phone,
    'full_name', case when v_outcome = 'new' then v_name else v_lead.full_name end,
    'assignee', (select s.full_name from public.staff s where s.user_id = v_assignee),
    'assign_mode', v_mode);
end;
$$;
revoke all on function private.add_lead_core(uuid, text, text, uuid, uuid, uuid, uuid, text, text, uuid, text, text) from public, anon, authenticated;

-- Nút "Thêm số": kiểm tra quyền của người bấm rồi gọi phần lõi (cách gọi giữ nguyên như file 020).
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
begin
  if not private.is_staff() or private.staff_role() = 'ads_staff' then
    raise exception 'Tài khoản này không được thêm số' using errcode = '42501';
  end if;
  if p_assignee_id is not null and not private.can_transfer_leads() then
    raise exception 'Chỉ Admin, COO, Trưởng Telesale và Trực page được chọn sale' using errcode = '42501';
  end if;
  return private.add_lead_core((select auth.uid()), p_phone, p_full_name, p_channel_id, p_page_id, p_ad_post_id,
                               p_service_id, p_note, p_pancake_url, p_assignee_id, p_branch, null);
end;
$$;
revoke all on function public.add_lead(text, text, uuid, uuid, uuid, uuid, text, text, uuid, text) from public, anon;
grant execute on function public.add_lead(text, text, uuid, uuid, uuid, uuid, text, text, uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. BẢNG: KẾT NỐI PAGE, TOKEN, LƯỢT HỎI ĐANG CHỜ, NHẬT KÝ SỐ KÉO VỀ
-- ---------------------------------------------------------------------
create table if not exists public.pancake_pages (
  id              uuid primary key default gen_random_uuid(),
  pancake_page_id text not null unique check (pancake_page_id ~ '^[A-Za-z0-9_.-]{3,80}$'),  -- ID page trên Pancake
  page_id         uuid not null references public.pages (id),                                -- page trong ERP
  is_active       boolean not null default true,
  token_hint      text,                       -- 4 ký tự cuối của Page Access Token, chỉ để nhận ra
  sync_from       timestamptz not null default now(),   -- chỉ lấy hội thoại có hoạt động sau mốc này
  last_ok_at      timestamptz,                -- lần cuối hỏi Pancake thành công
  last_error      text,
  last_error_at   timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- Token không nằm ở bảng trên: không ai đọc lại được qua ứng dụng, chỉ hệ thống dùng để hỏi Pancake.
create table if not exists private.pancake_tokens (
  pancake_page_id text primary key references public.pancake_pages (pancake_page_id) on update cascade,
  token           text not null,
  updated_at      timestamptz not null default now()
);
revoke all on private.pancake_tokens from public, anon, authenticated;

-- Lượt hỏi Pancake đang chờ trả lời (pg_net gửi nền).
create table if not exists private.pancake_requests (
  request_id      bigint primary key,
  pancake_page_id text not null,
  sweep_started   timestamptz not null,       -- lúc bắt đầu lượt quét; quét xong thì thành mốc sync_from mới
  page_no         int not null,               -- trang thứ mấy (mỗi trang 60 hội thoại)
  created_at      timestamptz not null default now()
);
revoke all on private.pancake_requests from public, anon, authenticated;

-- Mỗi số trong mỗi hội thoại chỉ kéo về một lần.
create table if not exists public.pancake_imports (
  id                bigint generated always as identity primary key,
  pancake_page_id   text not null,
  conversation_id   text not null,
  phone             text not null,
  full_name         text,
  conversation_type text,
  ad_id             text,
  outcome           text not null check (outcome in ('new', 'duplicate', 'invalid', 'error')),
  lead_id           uuid references public.leads (id) on delete set null,
  error             text,
  created_at        timestamptz not null default now(),
  unique (pancake_page_id, conversation_id, phone)
);
create index if not exists pancake_imports_created_idx on public.pancake_imports (created_at desc);

alter table public.pancake_pages enable row level security;
alter table public.pancake_imports enable row level security;
drop policy if exists pancake_pages_select on public.pancake_pages;
create policy pancake_pages_select on public.pancake_pages
  for select to authenticated using ((select private.is_manager()));
drop policy if exists pancake_imports_select on public.pancake_imports;
create policy pancake_imports_select on public.pancake_imports
  for select to authenticated using ((select private.is_manager()));
-- Chỉ xem; thêm / sửa đi qua các hàm bên dưới.
revoke all on public.pancake_pages from anon, authenticated;
revoke all on public.pancake_imports from anon, authenticated;
grant select on public.pancake_pages to authenticated;
grant select on public.pancake_imports to authenticated;

-- Nhật ký thay đổi kết nối (không ghi các cột hệ thống tự cập nhật mỗi phút).
create or replace trigger zz_audit
  after insert or update or delete on public.pancake_pages
  for each row execute function private.audit_row('id', 'updated_at,sync_from,last_ok_at,last_error,last_error_at');


-- ---------------------------------------------------------------------
-- 3. ĐỌC HỘI THOẠI PANCAKE → THÊM SỐ
-- ---------------------------------------------------------------------

-- Giờ Pancake trả về dạng "2026-01-15T10:00:00" (giờ UTC, không ghi múi giờ).
create or replace function private.pancake_time(p text)
returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  if p ~ '(Z|z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
    return p::timestamptz;
  end if;
  return p::timestamp at time zone 'UTC';
exception when others then
  return null;
end;
$$;
revoke all on function private.pancake_time(text) from public;

-- Hội thoại đến từ quảng cáo (ad_ids) hoặc bình luận dưới bài (post_id "idpage_idbài") → bài chạy trong ERP.
create or replace function private.pancake_find_post(p_ad_ids jsonb, p_post_id text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_post text := nullif(btrim(coalesce(p_post_id, '')), '');
begin
  if jsonb_typeof(p_ad_ids) = 'array' then
    select p.id into v_id from public.ad_posts p
    where p.deleted_at is null and p.ad_id in (select jsonb_array_elements_text(p_ad_ids))
    order by p.created_at desc limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  if v_post is not null then
    if v_post ~ '^[0-9]+_[0-9]+$' then
      v_post := split_part(v_post, '_', 2);
    end if;
    select p.id into v_id from public.ad_posts p
    where p.deleted_at is null and (p.post_key = 'fb:' || v_post or p.post_id = v_post)
    order by p.created_at desc limit 1;
  end if;
  return v_id;
end;
$$;
revoke all on function private.pancake_find_post(jsonb, text) from public;

-- Một hội thoại: mỗi số mới trong recent_phone_numbers → thêm số (như nút "Thêm số", người thêm = hệ thống).
-- Trả về số lượng số đã thêm / cập nhật vào bảng Lead.
create or replace function private.pancake_take(p_conn public.pancake_pages, p_conv jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_conv_id text := nullif(btrim(coalesce(p_conv ->> 'id', '')), '');
  v_name    text := left(coalesce(
                      nullif(btrim(coalesce(p_conv #>> '{customers,0,name}', '')), ''),
                      nullif(btrim(coalesce(p_conv #>> '{from,name}', '')), ''),
                      'Khách Pancake'), 200);
  v_ad_id   text;
  v_post_id uuid;
  v_page    public.pages%rowtype;
  v_url     text;
  v_item    jsonb;
  v_raw     text;
  v_phone   text;
  v_valid   boolean;
  v_import  bigint;
  v_result  jsonb;
  v_taken   int := 0;
begin
  if v_conv_id is null or jsonb_typeof(p_conv -> 'recent_phone_numbers') is distinct from 'array' then
    return 0;
  end if;
  select * into v_page from public.pages p where p.id = p_conn.page_id;
  if jsonb_typeof(p_conv -> 'ad_ids') = 'array' then
    v_ad_id := nullif(btrim(coalesce(p_conv #>> '{ad_ids,0}', '')), '');
  end if;
  v_post_id := private.pancake_find_post(p_conv -> 'ad_ids', p_conv ->> 'post_id');
  v_url := 'https://pancake.vn/' || p_conn.pancake_page_id || '?c_id=' || v_conv_id;

  for v_item in select * from jsonb_array_elements(p_conv -> 'recent_phone_numbers') loop
    v_raw := btrim(coalesce(case jsonb_typeof(v_item)
                              when 'object' then v_item ->> 'phone_number'
                              when 'string' then v_item #>> '{}' end, ''));
    continue when v_raw = '';
    v_phone := public.normalize_phone(v_raw);
    v_valid := v_phone ~ '^0[0-9]{9,10}$';

    insert into public.pancake_imports (pancake_page_id, conversation_id, phone, full_name, conversation_type, ad_id, outcome)
    values (p_conn.pancake_page_id, v_conv_id, case when v_valid then v_phone else left(v_raw, 40) end,
            v_name, left(p_conv ->> 'type', 30), v_ad_id, case when v_valid then 'new' else 'invalid' end)
    on conflict (pancake_page_id, conversation_id, phone) do nothing
    returning id into v_import;
    continue when v_import is null or not v_valid;   -- đã kéo rồi, hoặc không phải số điện thoại

    begin
      v_result := private.add_lead_core(null, v_phone, v_name, v_page.channel_id, p_conn.page_id, v_post_id,
                                        null, null, v_url, null, v_page.branch, v_ad_id);
      update public.pancake_imports
      set outcome = v_result ->> 'outcome', lead_id = (v_result ->> 'lead_id')::uuid
      where id = v_import;
      v_taken := v_taken + 1;
    exception when others then
      update public.pancake_imports set outcome = 'error', error = left(sqlerrm, 300) where id = v_import;
    end;
  end loop;
  return v_taken;
end;
$$;
revoke all on function private.pancake_take(public.pancake_pages, jsonb) from public;

-- Gửi một lượt hỏi Pancake (chạy nền). Trả về mã lượt hỏi.
create or replace function private.pancake_request(p_pancake_page_id text, p_sweep timestamptz, p_page_no int, p_last_id text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_token  text;
  v_params jsonb;
  v_id     bigint;
begin
  select t.token into v_token from private.pancake_tokens t where t.pancake_page_id = p_pancake_page_id;
  if v_token is null then
    return null;
  end if;
  v_params := jsonb_build_object(
    'page_access_token', v_token,
    'fields', 'id,type,page_id,post_id,has_phone,updated_at,from,customers,recent_phone_numbers,ad_ids');
  if p_last_id is not null then
    v_params := v_params || jsonb_build_object('last_conversation_id', p_last_id);
  end if;
  v_id := net.http_get(
    url := 'https://pages.fm/api/public_api/v2/pages/' || p_pancake_page_id || '/conversations',
    params := v_params,
    timeout_milliseconds := 20000);
  insert into private.pancake_requests (request_id, pancake_page_id, sweep_started, page_no)
  values (v_id, p_pancake_page_id, p_sweep, p_page_no);
  return v_id;
end;
$$;
revoke all on function private.pancake_request(text, timestamptz, int, text) from public;

-- Mỗi phút: đọc câu trả lời đã về, thêm số, rồi gửi lượt hỏi mới cho page đang bật.
-- Pancake trả 60 hội thoại có hoạt động gần nhất; nếu cả 60 đều mới hơn mốc thì hỏi tiếp trang sau
-- (tối đa 20 trang một lượt quét). Quét xong không lỗi → mốc sync_from = lúc bắt đầu lượt quét.
create or replace function private.pancake_sync()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r        record;
  v_conn   public.pancake_pages%rowtype;
  v_body   jsonb;
  v_convs  jsonb;
  v_conv   jsonb;
  v_upd    timestamptz;
  v_oldest timestamptz;
  v_cutoff timestamptz;
  v_err    text;
  v_added  int := 0;
  v_sent   int := 0;
begin
  -- Hai lượt chạy cùng lúc (lịch mỗi phút và nút "Đồng bộ ngay") thì lượt sau bỏ qua.
  if not pg_try_advisory_xact_lock(hashtext('private.pancake_sync')) then
    return jsonb_build_object('skipped', true);
  end if;
  -- Ghi chú cho nhật ký thay đổi; cũng để việc thêm số hàng loạt không bị tính là bất thường.
  perform set_config('app.audit_note', 'Kéo số từ Pancake', true);

  -- 1. Câu trả lời đã về (hoặc chờ quá 3 phút).
  for r in
    select q.request_id, q.pancake_page_id, q.sweep_started, q.page_no,
           h.id as resp_id, h.status_code, h.content, h.timed_out, h.error_msg
    from private.pancake_requests q
    left join net._http_response h on h.id = q.request_id
    where h.id is not null or q.created_at < now() - interval '3 minutes'
    order by q.created_at
  loop
    delete from private.pancake_requests where request_id = r.request_id;
    select * into v_conn from public.pancake_pages p where p.pancake_page_id = r.pancake_page_id;
    continue when not found or not v_conn.is_active;

    v_err := null;
    v_body := null;
    if r.resp_id is null or r.status_code is null then
      v_err := case when r.timed_out then 'Pancake không trả lời kịp, sẽ thử lại'
                    else coalesce('Không gọi được Pancake: ' || nullif(r.error_msg, ''), 'Pancake không trả lời, sẽ thử lại') end;
    elsif r.status_code in (401, 403) then
      v_err := 'Page Access Token sai hoặc đã bị đổi — lấy lại token trong Pancake (Cài đặt → Công cụ)';
    elsif r.status_code = 404 then
      v_err := 'Pancake không thấy page này — kiểm tra lại ID page';
    elsif r.status_code = 429 then
      v_err := 'Pancake báo hỏi quá nhanh, sẽ thử lại';
    elsif r.status_code <> 200 then
      v_err := 'Pancake báo lỗi ' || r.status_code || ', sẽ thử lại';
    else
      begin
        v_body := r.content::jsonb;
      exception when others then
        v_body := null;
      end;
      if v_body is null or jsonb_typeof(v_body) <> 'object' then
        v_err := 'Pancake trả về dữ liệu không đọc được';
      elsif (v_body ->> 'success') = 'false' then
        v_err := 'Pancake báo lỗi: ' || left(coalesce(v_body ->> 'message', v_body ->> 'error_message',
                                                       v_body ->> 'error', 'không rõ lý do'), 200);
      elsif jsonb_typeof(v_body -> 'conversations') is distinct from 'array' then
        v_err := 'Pancake trả về dữ liệu không đọc được';
      end if;
    end if;

    if v_err is not null then
      update public.pancake_pages set last_error = v_err, last_error_at = now() where id = v_conn.id;
      continue;
    end if;

    v_convs := v_body -> 'conversations';
    v_cutoff := v_conn.sync_from - interval '2 minutes';   -- chừa 2 phút phòng lệch giờ
    v_oldest := null;
    for v_conv in select * from jsonb_array_elements(v_convs) loop
      v_upd := private.pancake_time(v_conv ->> 'updated_at');
      v_oldest := least(coalesce(v_oldest, v_upd), v_upd);
      if v_upd is null or v_upd >= v_cutoff then
        v_added := v_added + private.pancake_take(v_conn, v_conv);
      end if;
    end loop;

    if jsonb_array_length(v_convs) >= 60 and v_oldest is not null and v_oldest >= v_cutoff and r.page_no < 20 then
      begin
        perform private.pancake_request(v_conn.pancake_page_id, r.sweep_started, r.page_no + 1,
                                        v_convs -> (jsonb_array_length(v_convs) - 1) ->> 'id');
        v_sent := v_sent + 1;
      exception when others then
        update public.pancake_pages
        set last_error = left('Không gửi được lượt hỏi Pancake: ' || sqlerrm, 300), last_error_at = now()
        where id = v_conn.id;
      end;
    else
      update public.pancake_pages
      set sync_from = greatest(sync_from, r.sweep_started), last_ok_at = now(), last_error = null, last_error_at = null
      where id = v_conn.id;
    end if;
  end loop;

  -- 2. Lượt hỏi mới cho page đang bật, có token, không còn lượt nào đang chờ.
  for v_conn in
    select p.* from public.pancake_pages p
    where p.is_active
      and exists (select 1 from private.pancake_tokens t where t.pancake_page_id = p.pancake_page_id)
      and not exists (select 1 from private.pancake_requests q where q.pancake_page_id = p.pancake_page_id)
  loop
    begin
      perform private.pancake_request(v_conn.pancake_page_id, now(), 1, null);
      v_sent := v_sent + 1;
    exception when others then
      update public.pancake_pages
      set last_error = left('Không gửi được lượt hỏi Pancake: ' || sqlerrm, 300), last_error_at = now()
      where id = v_conn.id;
    end;
  end loop;

  return jsonb_build_object('added', v_added, 'requests', v_sent);
end;
$$;
revoke all on function private.pancake_sync() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. CÀI ĐẶT (Telesale → Cài đặt → Kết nối Pancake): Admin, COO, Trưởng Telesale
-- ---------------------------------------------------------------------

-- Thêm / sửa kết nối. p_id null = kết nối mới (bắt buộc có token); sửa thì token để trống = giữ token cũ.
-- p_from_today: kết nối mới lấy cả số từ đầu hôm nay (mặc định chỉ lấy từ lúc kết nối).
create or replace function public.pancake_save_page(
  p_id              uuid,
  p_pancake_page_id text,
  p_page_id         uuid,
  p_token           text default null,
  p_from_today      boolean default false
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pid   text := btrim(coalesce(p_pancake_page_id, ''));
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_id    uuid := p_id;
begin
  if not private.is_manager() then
    raise exception 'Chỉ Admin, COO và Trưởng Telesale được kết nối Pancake' using errcode = '42501';
  end if;
  if v_pid !~ '^[A-Za-z0-9_.-]{3,80}$' then
    raise exception 'ID page Pancake không hợp lệ' using errcode = '22023';
  end if;
  if p_page_id is null or not exists (select 1 from public.pages p where p.id = p_page_id and p.deleted_at is null) then
    raise exception 'Chọn page trong ERP để gắn số kéo về' using errcode = '22023';
  end if;
  if v_token is not null and (v_token ~ '\s' or char_length(v_token) not between 20 and 4000) then
    raise exception 'Page Access Token không hợp lệ — dán đúng chuỗi trong Pancake (Cài đặt → Công cụ)' using errcode = '22023';
  end if;
  if exists (select 1 from public.pancake_pages c where c.pancake_page_id = v_pid and c.id is distinct from v_id) then
    raise exception 'Page Pancake này đã được kết nối rồi' using errcode = '23505';
  end if;

  if v_id is null then
    if v_token is null then
      raise exception 'Dán Page Access Token của page' using errcode = '22023';
    end if;
    insert into public.pancake_pages (pancake_page_id, page_id, token_hint, sync_from)
    values (v_pid, p_page_id, right(v_token, 4),
            case when p_from_today then private.today_vn()::timestamp at time zone 'Asia/Ho_Chi_Minh' else now() end)
    returning id into v_id;
  else
    update public.pancake_pages c set
      last_error = case when v_token is not null or c.pancake_page_id <> v_pid then null else c.last_error end,
      last_error_at = case when v_token is not null or c.pancake_page_id <> v_pid then null else c.last_error_at end,
      pancake_page_id = v_pid,
      page_id = p_page_id,
      token_hint = coalesce(right(v_token, 4), c.token_hint),
      updated_at = now()
    where c.id = v_id;
    if not found then
      raise exception 'Không tìm thấy kết nối này' using errcode = '22023';
    end if;
  end if;

  if v_token is not null then
    insert into private.pancake_tokens (pancake_page_id, token, updated_at)
    values (v_pid, v_token, now())
    on conflict (pancake_page_id) do update set token = excluded.token, updated_at = now();
  end if;
  return v_id;
end;
$$;
revoke all on function public.pancake_save_page(uuid, text, uuid, text, boolean) from public, anon;
grant execute on function public.pancake_save_page(uuid, text, uuid, text, boolean) to authenticated;

-- Tạm dừng / chạy lại. Chạy lại thì lấy từ lúc bật (số trong lúc dừng không kéo về).
create or replace function public.pancake_set_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_manager() then
    raise exception 'Chỉ Admin, COO và Trưởng Telesale được kết nối Pancake' using errcode = '42501';
  end if;
  update public.pancake_pages c set
    sync_from = case when p_active and not c.is_active then now() else c.sync_from end,
    last_error = case when p_active and not c.is_active then null else c.last_error end,
    last_error_at = case when p_active and not c.is_active then null else c.last_error_at end,
    is_active = coalesce(p_active, c.is_active),
    updated_at = now()
  where c.id = p_id;
  if not found then
    raise exception 'Không tìm thấy kết nối này' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.pancake_set_active(uuid, boolean) from public, anon;
grant execute on function public.pancake_set_active(uuid, boolean) to authenticated;

-- Nút "Đồng bộ ngay": chạy một lượt như lịch mỗi phút.
create or replace function public.pancake_sync_now()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_manager() then
    raise exception 'Chỉ Admin, COO và Trưởng Telesale được đồng bộ Pancake' using errcode = '42501';
  end if;
  return private.pancake_sync();
end;
$$;
revoke all on function public.pancake_sync_now() from public, anon;
grant execute on function public.pancake_sync_now() to authenticated;


-- ---------------------------------------------------------------------
-- 5. LỊCH CHẠY: mỗi phút hỏi Pancake; mỗi đêm dọn nhật ký lịch chạy cũ hơn 7 ngày
-- ---------------------------------------------------------------------
select cron.schedule('smh-pancake-sync', '* * * * *', 'select private.pancake_sync()');
select cron.schedule('smh-cron-cleanup', '17 20 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

commit;
