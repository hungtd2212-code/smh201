-- =====================================================================
-- Smile Hub ERP — THỬ NGHIỆM: TỰ KÉO BÁO CÁO ADS TỪ FACEBOOK + ĐỐI CHIẾU VỚI SỐ NHÂN VIÊN NHẬP TAY
--
-- Chạy SAU supabase/026_pancake_seen_alerts.sql. Chạy lại nhiều lần cũng không sao.
-- Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có, và KHÔNG BAO GIỜ ghi vào hai bảng nhân viên nhập
-- tay (ad_daily_reports, ads_daily_data) — chỉ ĐỌC hai bảng đó để so. Nó thêm một khu riêng:
--   • private.ads_auto_config: token Facebook (quyền ads_read) do Quản trị / Trưởng Marketing dán vào.
--     Không ai đọc lại được token qua ứng dụng; màn hình chỉ biết "đã có token" và 4 ký tự cuối;
--   • public.ads_auto_daily: số Facebook báo về cho từng (ngày, TKQC): chi tiêu, lượt bắt đầu trò
--     chuyện qua tin nhắn, người liên hệ mới, lượt kết nối tin nhắn;
--   • public.ads_auto_accounts: tình trạng từng TKQC trên Facebook (tên, tiền tệ, múi giờ, lỗi);
--   • lịch chạy mỗi phút (pg_cron): đọc câu trả lời của Facebook, và cứ mỗi giờ hỏi lại số của
--     3 ngày gần nhất (Facebook còn cập nhật số tin nhắn vài ngày sau);
--   • hàm ads_auto_compare: ghép số nhân viên nhập tay với số Facebook theo từng ngày, từng TKQC.
--
-- Nguồn số: Facebook Marketing API (Graph API), GET /act_{id}/insights, level=account,
-- time_increment=1 — tài liệu: https://developers.facebook.com/docs/marketing-api/insights
-- Pancake không có số chi tiêu nên không dùng được cho phần này.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. TIỆN ÍCH CỦA SUPABASE: pg_net, pg_cron (đã bật từ file 023)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;
    grant all privileges on all tables in schema cron to postgres;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1. BẢNG
-- ---------------------------------------------------------------------

-- Cài đặt chung (một dòng). Token nằm ở đây, trong schema private: ứng dụng không đọc được.
create table if not exists private.ads_auto_config (
  id            boolean primary key default true check (id),
  token         text,                       -- null = chưa có / đã gỡ
  token_hint    text,                       -- 4 ký tự cuối, chỉ để nhận ra
  token_set_at  timestamptz,
  token_set_by  uuid references auth.users (id) on delete set null,
  auto_enabled  boolean not null default true,   -- tự kéo mỗi giờ
  last_auto_at  timestamptz                       -- lần tự kéo gần nhất
);
revoke all on private.ads_auto_config from public, anon, authenticated;

-- Lượt hỏi Facebook đang chờ trả lời (pg_net gửi nền).
create table if not exists private.ads_auto_requests (
  request_id    bigint primary key,
  ad_account_id uuid not null,
  fb_account_id text not null,
  kind          text not null check (kind in ('account', 'insights')),   -- hỏi thông tin TKQC / hỏi số theo ngày
  since         date,
  until         date,
  created_at    timestamptz not null default now()
);
revoke all on private.ads_auto_requests from public, anon, authenticated;

-- Tình trạng từng TKQC trên Facebook.
create table if not exists public.ads_auto_accounts (
  ad_account_id uuid primary key references public.ad_accounts (id),
  fb_account_id text not null,
  fb_name       text,                       -- tên TKQC trên Facebook
  currency      text,                       -- VND, USD…
  timezone      text,                       -- vd Asia/Ho_Chi_Minh
  fb_status     int,                        -- account_status của Facebook (1 = đang hoạt động)
  checked_at    timestamptz,                -- lần cuối hỏi thông tin TKQC thành công
  last_ok_at    timestamptz,                -- lần cuối kéo số thành công
  last_error    text,
  last_error_at timestamptz,
  updated_at    timestamptz not null default now()
);

-- Số Facebook báo về theo ngày (theo múi giờ của TKQC). Khu riêng, không liên quan tới số nhập tay.
create table if not exists public.ads_auto_daily (
  report_date   date not null,
  ad_account_id uuid not null references public.ad_accounts (id),
  fb_account_id text not null,
  spend         numeric(18, 2) not null default 0 check (spend >= 0),   -- chi tiêu, theo tiền tệ của TKQC
  currency      text,
  conversations int not null default 0,     -- Lượt bắt đầu cuộc trò chuyện qua tin nhắn
  new_contacts  int not null default 0,     -- Người liên hệ nhắn tin mới
  connections   int not null default 0,     -- Tổng lượt kết nối qua tin nhắn
  actions       jsonb not null default '[]',   -- toàn bộ "actions" Facebook trả về, để soi khi cần
  fetched_at    timestamptz not null default now(),
  primary key (report_date, ad_account_id)
);
create index if not exists ads_auto_daily_account_idx on public.ads_auto_daily (ad_account_id, report_date);

alter table public.ads_auto_accounts enable row level security;
alter table public.ads_auto_daily enable row level security;
drop policy if exists ads_auto_accounts_select on public.ads_auto_accounts;
create policy ads_auto_accounts_select on public.ads_auto_accounts
  for select to authenticated using ((select private.manages_marketing()));
drop policy if exists ads_auto_daily_select on public.ads_auto_daily;
create policy ads_auto_daily_select on public.ads_auto_daily
  for select to authenticated using ((select private.manages_marketing()));
-- Chỉ xem; chỉ hệ thống ghi.
revoke all on public.ads_auto_accounts from anon, authenticated;
revoke all on public.ads_auto_daily from anon, authenticated;
grant select on public.ads_auto_accounts to authenticated;
grant select on public.ads_auto_daily to authenticated;


-- ---------------------------------------------------------------------
-- 2. TIỆN ÍCH
-- ---------------------------------------------------------------------

-- Địa chỉ Graph API. Mỗi phiên bản Marketing API dùng được khoảng 1 năm: hết hạn thì đổi số ở đây.
create or replace function private.fb_graph_base()
returns text language sql immutable set search_path = '' as $$
  select 'https://graph.facebook.com/v26.0/';
$$;

-- ID TKQC nhân viên điền ("act_123…", "123 456…") → chỉ còn chữ số; không hợp lệ → null.
create or replace function private.fb_account_digits(p text)
returns text language sql immutable set search_path = '' as $$
  select case when x ~ '^[0-9]{5,25}$' then x end
  from (select regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '^act_', ''), '[[:space:].-]', '', 'g') as x) s;
$$;

-- Kênh này có phải Facebook không.
create or replace function private.is_facebook_channel(p_channel_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.channels c
                 where c.id = p_channel_id and lower(c.name) ~ '(facebook|^fb( |$)|^meta( |$))');
$$;

-- Các TKQC sẽ được kéo số: chưa xoá, đang dùng, thuộc kênh Facebook, có ID TKQC hợp lệ.
create or replace function private.ads_auto_targets()
returns table (ad_account_id uuid, fb_account_id text)
language sql stable security definer set search_path = '' as $$
  select a.id, private.fb_account_digits(a.account_id)
  from public.ad_accounts a
  where a.deleted_at is null and a.is_active
    and private.is_facebook_channel(a.channel_id)
    and private.fb_account_digits(a.account_id) is not null;
$$;

-- "123456" / "1234.5" → số; dạng lạ → null.
create or replace function private.fb_number(p text)
returns numeric language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(p, '')) ~ '^[0-9]{1,15}(\.[0-9]{1,6})?$' then btrim(p)::numeric end;
$$;

-- Tổng "value" của một loại action trong mảng actions Facebook trả về.
create or replace function private.fb_action(p_actions jsonb, p_type text)
returns int language sql immutable set search_path = '' as $$
  select coalesce(round(sum(private.fb_number(a ->> 'value'))), 0)::int
  from jsonb_array_elements(case when jsonb_typeof(p_actions) = 'array' then p_actions else '[]'::jsonb end) a
  where a ->> 'action_type' = p_type;
$$;

-- Câu báo lỗi dễ hiểu từ câu trả lời lỗi của Facebook (không bao giờ chứa token).
create or replace function private.fb_error_text(p_body jsonb, p_status int)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_err  jsonb := case when jsonb_typeof(p_body -> 'error') = 'object' then p_body -> 'error' end;
  v_code int;
  v_sub  int;
  v_msg  text;
begin
  if (v_err ->> 'code') ~ '^[0-9]{1,9}$' then v_code := (v_err ->> 'code')::int; end if;
  if (v_err ->> 'error_subcode') ~ '^[0-9]{1,9}$' then v_sub := (v_err ->> 'error_subcode')::int; end if;
  v_msg := left(btrim(coalesce(v_err ->> 'error_user_msg', v_err ->> 'message', '')), 200);
  return case
    when v_code = 190 or (v_code is null and p_status = 401) then
      'Token Facebook sai, đã hết hạn hoặc đã bị thu hồi — dán token mới'
    when v_code in (4, 17, 32, 613) or v_code between 80000 and 80099 or p_status = 429 then
      'Facebook báo hỏi quá nhiều, hệ thống sẽ tự thử lại sau'
    when v_code in (10, 200, 270, 272, 273, 274, 275, 278, 294) or v_code between 200 and 299 then
      'Token chưa được cấp quyền xem TKQC này — thêm TKQC cho người dùng hệ thống (quyền Xem hiệu quả) rồi bấm Kiểm tra lại'
    when v_code = 100 and v_sub = 33 then
      'Facebook không đọc được TKQC này: sai ID TKQC, hoặc token chưa được cấp quyền với TKQC này'
    when v_code in (1, 2) or p_status >= 500 then
      'Facebook đang lỗi tạm thời, hệ thống sẽ tự thử lại'
    when v_msg <> '' then 'Facebook báo lỗi: ' || v_msg
    else 'Facebook báo lỗi ' || coalesce(p_status::text, 'không rõ')
  end;
end;
$$;

-- Chỉ Quản trị và Trưởng Marketing.
create or replace function private.ads_auto_guard()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.manages_marketing() then
    raise exception 'Chỉ Quản trị và Trưởng Marketing dùng được phần Ads tự động' using errcode = '42501';
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. HỎI FACEBOOK (chạy nền) VÀ ĐỌC CÂU TRẢ LỜI
-- ---------------------------------------------------------------------

-- Gửi một lượt hỏi. Token đi trong header Authorization (không nằm trên địa chỉ).
create or replace function private.ads_auto_request(p_ad_account_id uuid, p_fb_id text, p_kind text, p_since date, p_until date)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_token  text;
  v_url    text;
  v_params jsonb;
  v_id     bigint;
begin
  select c.token into v_token from private.ads_auto_config c where c.id;
  if v_token is null or p_fb_id is null then
    return null;
  end if;
  if p_kind = 'account' then
    v_url := private.fb_graph_base() || 'act_' || p_fb_id;
    v_params := jsonb_build_object('fields', 'name,currency,timezone_name,account_status');
  else
    v_url := private.fb_graph_base() || 'act_' || p_fb_id || '/insights';
    v_params := jsonb_build_object(
      'level', 'account',
      'time_increment', '1',
      'time_range', jsonb_build_object('since', to_char(p_since, 'YYYY-MM-DD'), 'until', to_char(p_until, 'YYYY-MM-DD'))::text,
      'fields', 'spend,actions,account_currency,date_start,date_stop',
      'use_unified_attribution_setting', 'true',
      'limit', '500');
  end if;
  v_id := net.http_get(
    url := v_url,
    params := v_params,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token),
    timeout_milliseconds := 30000);
  insert into private.ads_auto_requests (request_id, ad_account_id, fb_account_id, kind, since, until)
  values (v_id, p_ad_account_id, p_fb_id, p_kind, p_since, p_until);
  return v_id;
end;
$$;

-- Gửi lượt hỏi cho mọi TKQC Facebook có ID (bỏ qua TKQC đang có lượt cùng loại chờ trả lời).
-- kind = 'account': chỉ hỏi những TKQC chưa kiểm tra trong `p_recheck` gần đây. Trả về số TKQC đã hỏi.
create or replace function private.ads_auto_queue(p_kind text, p_since date, p_until date, p_recheck interval default interval '0')
returns int language plpgsql security definer set search_path = '' as $$
declare
  t      record;
  v_sent int := 0;
begin
  for t in
    select g.ad_account_id, g.fb_account_id from private.ads_auto_targets() g
    where not exists (select 1 from private.ads_auto_requests q
                      where q.ad_account_id = g.ad_account_id and q.kind = p_kind)
      and (p_kind <> 'account' or not exists (
            select 1 from public.ads_auto_accounts s
            where s.ad_account_id = g.ad_account_id and s.fb_account_id = g.fb_account_id
              and s.checked_at > now() - p_recheck))
  loop
    begin
      if private.ads_auto_request(t.ad_account_id, t.fb_account_id, p_kind, p_since, p_until) is not null then
        v_sent := v_sent + 1;
      end if;
    exception when others then
      insert into public.ads_auto_accounts (ad_account_id, fb_account_id, last_error, last_error_at)
      values (t.ad_account_id, t.fb_account_id, left('Không gửi được lượt hỏi Facebook: ' || sqlerrm, 300), now())
      on conflict (ad_account_id) do update
        set fb_account_id = excluded.fb_account_id, last_error = excluded.last_error,
            last_error_at = excluded.last_error_at, updated_at = now();
    end;
  end loop;
  return v_sent;
end;
$$;

-- Đọc các câu trả lời đã về (hoặc chờ quá 3 phút), lưu vào ads_auto_daily / ads_auto_accounts.
create or replace function private.ads_auto_collect()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r        record;
  v_body   jsonb;
  v_err    text;
  v_row    jsonb;
  v_day    date;
  v_cur    text;
  v_status int;
  v_saved  int := 0;
  v_done   int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('private.ads_auto_collect')) then
    return jsonb_build_object('skipped', true);
  end if;

  for r in
    select q.request_id, q.ad_account_id, q.fb_account_id, q.kind, q.since, q.until,
           h.id as resp_id, h.status_code, h.content, h.timed_out, h.error_msg
    from private.ads_auto_requests q
    left join net._http_response h on h.id = q.request_id
    where h.id is not null or q.created_at < now() - interval '3 minutes'
    order by q.created_at
  loop
    delete from private.ads_auto_requests where request_id = r.request_id;
    v_done := v_done + 1;
    -- TKQC đã bị xoá / đổi ID trong lúc chờ → bỏ câu trả lời này.
    continue when not exists (select 1 from private.ads_auto_targets() g
                              where g.ad_account_id = r.ad_account_id and g.fb_account_id = r.fb_account_id);

    v_err := null;
    v_body := null;
    begin
      v_body := r.content::jsonb;
    exception when others then
      v_body := null;
    end;
    if r.resp_id is null or r.status_code is null then
      v_err := case when r.timed_out then 'Facebook không trả lời kịp, hệ thống sẽ tự thử lại'
                    else coalesce('Không gọi được Facebook: ' || nullif(left(r.error_msg, 200), ''),
                                  'Facebook không trả lời, hệ thống sẽ tự thử lại') end;
    elsif r.status_code <> 200 or jsonb_typeof(v_body -> 'error') = 'object' then
      v_err := private.fb_error_text(v_body, r.status_code);
    elsif v_body is null or jsonb_typeof(v_body) <> 'object'
          or (r.kind = 'insights' and jsonb_typeof(v_body -> 'data') is distinct from 'array') then
      v_err := 'Facebook trả về dữ liệu không đọc được';
    end if;

    if v_err is not null then
      insert into public.ads_auto_accounts (ad_account_id, fb_account_id, last_error, last_error_at)
      values (r.ad_account_id, r.fb_account_id, v_err, now())
      on conflict (ad_account_id) do update
        set fb_account_id = excluded.fb_account_id, last_error = excluded.last_error,
            last_error_at = excluded.last_error_at, updated_at = now();
      continue;
    end if;

    if r.kind = 'account' then
      v_status := case when (v_body ->> 'account_status') ~ '^[0-9]{1,4}$' then (v_body ->> 'account_status')::int end;
      insert into public.ads_auto_accounts (ad_account_id, fb_account_id, fb_name, currency, timezone, fb_status, checked_at)
      values (r.ad_account_id, r.fb_account_id, left(v_body ->> 'name', 200), upper(left(v_body ->> 'currency', 10)),
              left(v_body ->> 'timezone_name', 60), v_status, now())
      on conflict (ad_account_id) do update
        set fb_account_id = excluded.fb_account_id, fb_name = excluded.fb_name, currency = excluded.currency,
            timezone = excluded.timezone, fb_status = excluded.fb_status, checked_at = now(),
            last_error = null, last_error_at = null, updated_at = now();
      continue;
    end if;

    -- Số theo ngày. Ngày nào Facebook không trả dòng nào = hôm đó TKQC không tiêu đồng nào → ghi 0.
    v_cur := null;
    for v_row in select * from jsonb_array_elements(v_body -> 'data') loop
      v_day := case when (v_row ->> 'date_start') ~ '^\d{4}-\d{2}-\d{2}$' then (v_row ->> 'date_start')::date end;
      continue when v_day is null or v_day < r.since or v_day > r.until;
      v_cur := coalesce(upper(left(v_row ->> 'account_currency', 10)), v_cur);
      insert into public.ads_auto_daily (report_date, ad_account_id, fb_account_id, spend, currency,
                                         conversations, new_contacts, connections, actions, fetched_at)
      values (v_day, r.ad_account_id, r.fb_account_id,
              coalesce(private.fb_number(v_row ->> 'spend'), 0),
              upper(left(v_row ->> 'account_currency', 10)),
              private.fb_action(v_row -> 'actions', 'onsite_conversion.messaging_conversation_started_7d'),
              private.fb_action(v_row -> 'actions', 'onsite_conversion.messaging_first_reply'),
              private.fb_action(v_row -> 'actions', 'onsite_conversion.total_messaging_connection'),
              case when jsonb_typeof(v_row -> 'actions') = 'array' then v_row -> 'actions' else '[]'::jsonb end,
              now())
      on conflict (report_date, ad_account_id) do update
        set fb_account_id = excluded.fb_account_id, spend = excluded.spend, currency = excluded.currency,
            conversations = excluded.conversations, new_contacts = excluded.new_contacts,
            connections = excluded.connections, actions = excluded.actions, fetched_at = now();
      v_saved := v_saved + 1;
    end loop;

    insert into public.ads_auto_daily (report_date, ad_account_id, fb_account_id, spend, currency,
                                       conversations, new_contacts, connections, actions, fetched_at)
    select r.since + i, r.ad_account_id, r.fb_account_id, 0,
           coalesce(v_cur, (select s.currency from public.ads_auto_accounts s where s.ad_account_id = r.ad_account_id)),
           0, 0, 0, '[]'::jsonb, now()
    from generate_series(0, r.until - r.since) i
    where not exists (select 1 from jsonb_array_elements(v_body -> 'data') x
                      where x ->> 'date_start' = to_char(r.since + i, 'YYYY-MM-DD'))
    on conflict (report_date, ad_account_id) do update
      set fb_account_id = excluded.fb_account_id, spend = 0, conversations = 0, new_contacts = 0,
          connections = 0, actions = '[]'::jsonb, fetched_at = now();

    insert into public.ads_auto_accounts (ad_account_id, fb_account_id, last_ok_at)
    values (r.ad_account_id, r.fb_account_id, now())
    on conflict (ad_account_id) do update
      set fb_account_id = excluded.fb_account_id, last_ok_at = now(),
          last_error = null, last_error_at = null, updated_at = now();
  end loop;

  return jsonb_build_object('answers', v_done, 'days', v_saved,
                            'pending', (select count(*) from private.ads_auto_requests));
end;
$$;

-- Lịch mỗi phút: đọc câu trả lời; mỗi giờ hỏi lại 3 ngày gần nhất; mỗi ngày kiểm tra lại thông tin TKQC.
create or replace function private.ads_auto_tick()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cfg   private.ads_auto_config%rowtype;
  v_today date := private.today_vn();
  v_sent  int := 0;
begin
  perform private.ads_auto_collect();
  select * into v_cfg from private.ads_auto_config c where c.id;
  if not found or v_cfg.token is null or not v_cfg.auto_enabled then
    return jsonb_build_object('requests', 0);
  end if;
  if v_cfg.last_auto_at is null or v_cfg.last_auto_at < now() - interval '59 minutes' then
    update private.ads_auto_config set last_auto_at = now() where id;
    v_sent := private.ads_auto_queue('insights', v_today - 2, v_today);
    v_sent := v_sent + private.ads_auto_queue('account', null, null, interval '20 hours');
  end if;
  return jsonb_build_object('requests', v_sent);
end;
$$;


-- ---------------------------------------------------------------------
-- 4. HÀM CHO MÀN HÌNH (Quản trị, Trưởng Marketing)
-- ---------------------------------------------------------------------

-- Dán token. Dán xong: kiểm tra từng TKQC và kéo luôn 7 ngày gần nhất.
create or replace function public.ads_auto_save_token(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_token text := btrim(coalesce(p_token, ''), E' \t\r\n');
  v_today date := private.today_vn();
  v_n     int;
begin
  perform private.ads_auto_guard();
  if v_token !~ '^EAA[A-Za-z0-9]+$' or char_length(v_token) not between 40 and 2000 then
    raise exception 'Token không đúng dạng: token Facebook bắt đầu bằng "EAA" và chỉ gồm chữ và số. Kiểm tra lại, đừng copy thừa dấu cách hay xuống dòng'
      using errcode = '22023';
  end if;
  insert into private.ads_auto_config (id, token, token_hint, token_set_at, token_set_by, last_auto_at)
  values (true, v_token, right(v_token, 4), now(), (select auth.uid()), now())
  on conflict (id) do update
    set token = excluded.token, token_hint = excluded.token_hint,
        token_set_at = excluded.token_set_at, token_set_by = excluded.token_set_by, last_auto_at = now();
  -- Có WHERE: Supabase chặn UPDATE không WHERE khi gọi từ ứng dụng (sửa ở file 029).
  update public.ads_auto_accounts set last_error = null, last_error_at = null, checked_at = null, updated_at = now()
  where last_error is not null or last_error_at is not null or checked_at is not null;
  perform private.ads_auto_queue('account', null, null);
  v_n := private.ads_auto_queue('insights', v_today - 6, v_today);
  return jsonb_build_object('accounts', v_n);
end;
$$;

-- Gỡ token: ngừng hỏi Facebook. Số đã kéo về vẫn giữ.
create or replace function public.ads_auto_remove_token()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ads_auto_guard();
  update private.ads_auto_config set token = null, token_hint = null, token_set_at = now(), token_set_by = (select auth.uid())
  where id;
end;
$$;

-- Bật / tắt tự kéo mỗi giờ.
create or replace function public.ads_auto_set_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ads_auto_guard();
  insert into private.ads_auto_config (id, auto_enabled) values (true, coalesce(p_enabled, true))
  on conflict (id) do update set auto_enabled = excluded.auto_enabled;
end;
$$;

-- Kéo lại số của một khoảng ngày (tối đa 93 ngày; Facebook giữ số 37 tháng).
create or replace function public.ads_auto_pull(p_since date, p_until date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.today_vn();
  v_n     int;
begin
  perform private.ads_auto_guard();
  if not exists (select 1 from private.ads_auto_config c where c.id and c.token is not null) then
    raise exception 'Chưa có token Facebook — dán token trước' using errcode = '22023';
  end if;
  if p_since is null or p_until is null or p_since > p_until then
    raise exception 'Khoảng ngày không hợp lệ' using errcode = '22023';
  end if;
  if p_until > v_today then
    raise exception 'Không kéo được số của ngày chưa tới' using errcode = '22023';
  end if;
  if p_until - p_since > 92 then
    raise exception 'Mỗi lần kéo tối đa 93 ngày' using errcode = '22023';
  end if;
  if p_since < (v_today - interval '37 months')::date then
    raise exception 'Facebook chỉ giữ số liệu 37 tháng gần nhất' using errcode = '22023';
  end if;
  if exists (select 1 from private.ads_auto_requests q where q.kind = 'insights') then
    raise exception 'Đang kéo số, đợi khoảng 1 phút rồi bấm lại' using errcode = '55006';
  end if;
  perform private.ads_auto_queue('account', null, null, interval '1 hour');
  v_n := private.ads_auto_queue('insights', p_since, p_until);
  if v_n = 0 then
    raise exception 'Không có TKQC Facebook nào có ID để kéo — điền ID TKQC ở trang TKQC & Page' using errcode = '22023';
  end if;
  return jsonb_build_object('accounts', v_n);
end;
$$;

-- Đọc ngay các câu trả lời đã về (màn hình gọi vài giây một lần sau khi bấm Kéo).
create or replace function public.ads_auto_collect_now()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.ads_auto_guard();
  return private.ads_auto_collect();
end;
$$;

-- Tình trạng kết nối + danh sách TKQC (không bao giờ trả token).
create or replace function public.ads_auto_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg private.ads_auto_config%rowtype;
begin
  perform private.ads_auto_guard();
  select * into v_cfg from private.ads_auto_config c where c.id;
  return jsonb_build_object(
    'has_token', v_cfg.token is not null,
    'token_hint', case when v_cfg.token is not null then v_cfg.token_hint end,
    'token_set_at', v_cfg.token_set_at,
    'token_set_by', (select s.full_name from public.staff s where s.user_id = v_cfg.token_set_by),
    'auto_enabled', coalesce(v_cfg.auto_enabled, true),
    'last_auto_at', v_cfg.last_auto_at,
    'pending', (select count(*) from private.ads_auto_requests),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ad_account_id', a.id,
               'name', a.name,
               'account_id', a.account_id,
               'fb_account_id', private.fb_account_digits(a.account_id),
               'is_active', a.is_active,
               'is_facebook', private.is_facebook_channel(a.channel_id),
               'fb_name', s.fb_name,
               'currency', s.currency,
               'timezone', s.timezone,
               'fb_status', s.fb_status,
               'checked_at', s.checked_at,
               'last_ok_at', s.last_ok_at,
               'last_error', s.last_error,
               'last_error_at', s.last_error_at,
               'first_day', d.first_day,
               'last_day', d.last_day)
             order by private.is_facebook_channel(a.channel_id) desc, a.is_active desc, lower(a.name))
      from public.ad_accounts a
      left join public.ads_auto_accounts s
        on s.ad_account_id = a.id and s.fb_account_id = private.fb_account_digits(a.account_id)
      left join lateral (select min(x.report_date) as first_day, max(x.report_date) as last_day
                         from public.ads_auto_daily x where x.ad_account_id = a.id) d on true
      where a.deleted_at is null), '[]'::jsonb));
end;
$$;

-- ĐỐI CHIẾU: mỗi (ngày, TKQC) có số nhập tay hoặc số Facebook → một dòng, kèm người phụ trách hôm đó.
-- Chỉ đọc ad_daily_reports, không ghi gì.
create or replace function public.ads_auto_compare(p_from date, p_to date)
returns table (
  report_date       date,
  ad_account_id     uuid,
  ads_staff_id      uuid,
  manual_spend      bigint,
  manual_messages   int,
  manual_at         timestamptz,
  auto_spend        numeric,
  auto_currency     text,
  auto_conversations int,
  auto_new_contacts int,
  auto_connections  int,
  auto_fetched_at   timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.ads_auto_guard();
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 92 then
    raise exception 'Chọn khoảng ngày tối đa 93 ngày' using errcode = '22023';
  end if;
  return query
  with m as (
    select r.report_date as d, r.ad_account_id as a, r.spend, r.messages, r.updated_at
    from public.ad_daily_reports r
    where r.report_date between p_from and p_to),
  x as (
    select y.report_date as d, y.ad_account_id as a, y.spend, y.currency, y.conversations,
           y.new_contacts, y.connections, y.fetched_at
    from public.ads_auto_daily y
    where y.report_date between p_from and p_to),
  j as (
    select coalesce(m.d, x.d) as d, coalesce(m.a, x.a) as a,
           m.spend as m_spend, m.messages as m_messages, m.updated_at as m_at,
           x.spend as x_spend, x.currency as x_currency, x.conversations as x_conv,
           x.new_contacts as x_new, x.connections as x_conn, x.fetched_at as x_at
    from m full join x on x.d = m.d and x.a = m.a)
  select j.d, j.a,
         (select z.ads_staff_id from public.ad_account_assignments z
          where z.ad_account_id = j.a and z.deleted_at is null
            and z.from_date <= j.d and (z.to_date is null or z.to_date >= j.d)
          order by z.from_date desc limit 1),
         j.m_spend, j.m_messages, j.m_at, j.x_spend, j.x_currency, j.x_conv, j.x_new, j.x_conn, j.x_at
  from j
  order by j.d desc, j.a;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function private.fb_graph_base() from public;
revoke all on function private.fb_account_digits(text) from public;
revoke all on function private.is_facebook_channel(uuid) from public;
revoke all on function private.ads_auto_targets() from public;
revoke all on function private.fb_number(text) from public;
revoke all on function private.fb_action(jsonb, text) from public;
revoke all on function private.fb_error_text(jsonb, int) from public;
revoke all on function private.ads_auto_guard() from public;
revoke all on function private.ads_auto_request(uuid, text, text, date, date) from public, anon, authenticated;
revoke all on function private.ads_auto_queue(text, date, date, interval) from public, anon, authenticated;
revoke all on function private.ads_auto_collect() from public, anon, authenticated;
revoke all on function private.ads_auto_tick() from public, anon, authenticated;

revoke all on function public.ads_auto_save_token(text) from public, anon;
revoke all on function public.ads_auto_remove_token() from public, anon;
revoke all on function public.ads_auto_set_enabled(boolean) from public, anon;
revoke all on function public.ads_auto_pull(date, date) from public, anon;
revoke all on function public.ads_auto_collect_now() from public, anon;
revoke all on function public.ads_auto_status() from public, anon;
revoke all on function public.ads_auto_compare(date, date) from public, anon;
grant execute on function public.ads_auto_save_token(text) to authenticated;
grant execute on function public.ads_auto_remove_token() to authenticated;
grant execute on function public.ads_auto_set_enabled(boolean) to authenticated;
grant execute on function public.ads_auto_pull(date, date) to authenticated;
grant execute on function public.ads_auto_collect_now() to authenticated;
grant execute on function public.ads_auto_status() to authenticated;
grant execute on function public.ads_auto_compare(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- 6. LỊCH CHẠY MỖI PHÚT
-- ---------------------------------------------------------------------
select cron.schedule('smh-ads-auto', '* * * * *', 'select private.ads_auto_tick()');

commit;
