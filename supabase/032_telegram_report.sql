-- =====================================================================
-- Smile Hub ERP — ADS TỰ ĐỘNG: GỬI BÁO CÁO NGÀY VÀO NHÓM TELEGRAM (10h sáng, số hôm qua, mỗi nhân viên Ads một tin)
--
-- Chạy SAU supabase/031_ads_auto_pancake.sql. Chạy lại nhiều lần cũng không sao.
-- Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có. Nó thêm:
--   • private.telegram_config: token bot Telegram (Quản trị dán, không ai đọc lại được qua ứng dụng), nhóm nhận
--     báo cáo, giờ gửi (mặc định 10h), bật / tắt;
--   • private.telegram_chats: các nhóm bot đã được thêm vào (đọc từ getUpdates của Telegram) để chọn;
--   • private.telegram_outbox: các tin chờ gửi / đã gửi. Tin gửi lần lượt từng tin (tin sau gửi khi tin trước
--     đã tới) để nhóm nhận đúng thứ tự;
--   • lịch chạy 20 giây một lần: đọc câu trả lời của Telegram, gửi tin kế tiếp; 10h sáng (giờ Việt Nam) xếp báo
--     cáo ngày hôm qua — chỉ khi đã có số Facebook và số Pancake của ngày đó;
--   • private.ads_auto_compare_rows: phần thân của ads_auto_compare (file 031) tách ra để lịch chạy dùng được;
--     public.ads_auto_compare giữ nguyên kết quả, chỉ gọi lại phần này.
--
-- Mẫu tin (theo mẫu nhân viên đang tự báo trong nhóm), mỗi nhân viên Ads một tin:
--   BC ngày 12/11 - Sang
--   Chi tiêu: 764.868        ← Facebook
--   Mess: 5                  ← tin nhắn theo thống kê quảng cáo Pancake
--   Giá mess: 152.974        ← chi tiêu / mess
--   Data: 1                  ← số điện thoại theo Pancake
--   Giá Data: 764.868        ← chi tiêu / data
--   Tỷ lệ xin số: 20%        ← data / mess
-- Số được gộp theo nhân viên đang cầm TKQC vào ngày đó (ad_account_assignments).
-- Telegram Bot API: https://core.telegram.org/bots/api (getMe, getUpdates, sendMessage).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. BẢNG
-- ---------------------------------------------------------------------
create table if not exists private.telegram_config (
  id            boolean primary key default true check (id),
  bot_token     text,                       -- null = chưa có / đã gỡ
  token_hint    text,                       -- 4 ký tự cuối
  token_set_at  timestamptz,
  token_set_by  uuid references auth.users (id) on delete set null,
  bot_username  text,                       -- tên bot (getMe), vd smh_baocao_bot
  chat_id       text,                       -- nhóm nhận báo cáo
  chat_title    text,
  enabled       boolean not null default true,
  send_hour     int not null default 10 check (send_hour between 0 and 24),   -- 24 = không bao giờ tới giờ (dùng khi kiểm thử)
  last_sent_for date,                       -- ngày báo cáo gần nhất đã xếp gửi tự động
  last_error    text,
  last_error_at timestamptz
);
revoke all on private.telegram_config from public, anon, authenticated;

create table if not exists private.telegram_chats (
  chat_id    text primary key,
  title      text,
  chat_type  text,
  bot_status text,                          -- member / administrator / left / kicked (nếu Telegram báo)
  seen_at    timestamptz not null default now()
);
revoke all on private.telegram_chats from public, anon, authenticated;

create table if not exists private.telegram_outbox (
  id          bigint generated always as identity primary key,
  batch_id    uuid not null,
  kind        text not null check (kind in ('auto', 'manual')),
  report_date date not null,
  seq         int not null,
  title       text not null,
  body        text not null,
  status      text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts    int not null default 0,
  next_try_at timestamptz not null default now(),
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists telegram_outbox_status_idx on private.telegram_outbox (status, id);
revoke all on private.telegram_outbox from public, anon, authenticated;

create table if not exists private.telegram_requests (
  request_id bigint primary key,
  kind       text not null check (kind in ('getme', 'updates', 'send')),
  outbox_id  bigint,
  created_at timestamptz not null default now()
);
revoke all on private.telegram_requests from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. SỐ ĐỐI CHIẾU KHÔNG QUA KIỂM TRA QUYỀN (cho lịch chạy) + ads_auto_compare gọi lại
-- ---------------------------------------------------------------------
-- Như ads_auto_compare của file 031 (cùng cột, cùng cách ghép), không kiểm tra quyền: chỉ hệ thống gọi.
create or replace function private.ads_auto_compare_rows(p_from date, p_to date)
returns table (
  report_date        date,
  ad_account_id      uuid,
  ads_staff_id       uuid,
  manual_spend       bigint,
  manual_messages    int,
  manual_at          timestamptz,
  auto_spend         numeric,
  auto_currency      text,
  auto_conversations int,
  auto_new_contacts  int,
  auto_connections   int,
  auto_fetched_at    timestamptz,
  pancake_messages   int,
  pancake_phones     int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
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
  acc as (
    select distinct on (private.fb_account_digits(t.account_id)) private.fb_account_digits(t.account_id) as fb, t.id
    from public.ad_accounts t
    where t.deleted_at is null and private.fb_account_digits(t.account_id) is not null
    order by private.fb_account_digits(t.account_id), t.is_active desc, t.created_at desc),
  p as (
    select pd.report_date as d, acc.id as a,
           sum(pd.messages)::int as msgs, sum(pd.phones)::int as phones
    from public.ads_pancake_daily pd
    left join private.ads_ad_map mp on mp.ad_id = pd.ad_id
    left join acc on acc.fb = coalesce(pd.fb_account_id, mp.fb_account_id)
    where pd.report_date between p_from and p_to
    group by pd.report_date, acc.id),
  pf as (
    select distinct f.report_date as d from private.ads_pancake_days f where f.report_date between p_from and p_to),
  j as (
    select coalesce(m.d, x.d) as d, coalesce(m.a, x.a) as a,
           m.spend as m_spend, m.messages as m_messages, m.updated_at as m_at,
           x.spend as x_spend, x.currency as x_currency, x.conversations as x_conv,
           x.new_contacts as x_new, x.connections as x_conn, x.fetched_at as x_at
    from m full join x on x.d = m.d and x.a = m.a),
  k as (
    select coalesce(j.d, p.d) as d, coalesce(j.a, p.a) as a, j.m_spend, j.m_messages, j.m_at, j.x_spend,
           j.x_currency, j.x_conv, j.x_new, j.x_conn, j.x_at, p.msgs, p.phones
    from j full join p on p.d = j.d and p.a = j.a)
  select k.d, k.a,
         (select z.ads_staff_id from public.ad_account_assignments z
          where z.ad_account_id = k.a and z.deleted_at is null
            and z.from_date <= k.d and (z.to_date is null or z.to_date >= k.d)
          order by z.from_date desc limit 1),
         k.m_spend, k.m_messages, k.m_at, k.x_spend, k.x_currency, k.x_conv, k.x_new, k.x_conn, k.x_at,
         -- Pancake đã trả lời ngày đó mà TKQC không có khách nào → 0; chưa hỏi → null.
         coalesce(k.msgs, case when k.d in (select pf.d from pf) then 0 end),
         coalesce(k.phones, case when k.d in (select pf.d from pf) then 0 end)
  from k
  order by k.d desc, k.a nulls last;
end;
$$;

create or replace function public.ads_auto_compare(p_from date, p_to date)
returns table (
  report_date        date,
  ad_account_id      uuid,
  ads_staff_id       uuid,
  manual_spend       bigint,
  manual_messages    int,
  manual_at          timestamptz,
  auto_spend         numeric,
  auto_currency      text,
  auto_conversations int,
  auto_new_contacts  int,
  auto_connections   int,
  auto_fetched_at    timestamptz,
  pancake_messages   int,
  pancake_phones     int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.ads_auto_guard();
  return query select * from private.ads_auto_compare_rows(p_from, p_to);
end;
$$;


-- ---------------------------------------------------------------------
-- 3. SOẠN BÁO CÁO
-- ---------------------------------------------------------------------

-- 1960184 → "1.960.184" (làm tròn tới đồng).
create or replace function private.vn_int(p numeric)
returns text language sql immutable set search_path = '' as $$
  select replace(to_char(round(coalesce(p, 0)), 'FM999,999,999,999,999,990'), ',', '.');
$$;

-- Tỷ lệ data / mess: "33,33%", "50%", "0%".
create or replace function private.vn_pct(p_part numeric, p_whole numeric)
returns text language sql immutable set search_path = '' as $$
  select case when coalesce(p_whole, 0) = 0 then '0%'
              else replace(rtrim(rtrim(to_char(round(coalesce(p_part, 0) * 100.0 / p_whole, 2), 'FM999999990.00'), '0'), '.'), '.', ',') || '%'
         end;
$$;

-- Tên nhân viên trong tin: bỏ chữ "Ads" ở cuối tên ("Dương Ads" → "Dương").
create or replace function private.telegram_staff_name(p text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(btrim(regexp_replace(coalesce(p, ''), '\s+ads\s*$', '', 'i')), ''), nullif(btrim(p), ''), 'Chưa giao nhân viên');
$$;

-- Báo cáo một ngày: mỗi nhân viên Ads (có chi tiêu hoặc có khách) một tin, chi tiêu nhiều lên trước.
create or replace function private.telegram_report(p_day date)
returns table (seq int, title text, body text)
language sql stable security definer set search_path = '' as $$
  with r as (
    select c.* from private.ads_auto_compare_rows(p_day, p_day) c where c.ad_account_id is not null),
  g as (
    select private.telegram_staff_name(s.full_name) as who,
           sum(case when upper(coalesce(r.auto_currency, 'VND')) = 'VND' then coalesce(r.auto_spend, 0) else 0 end) as spend,
           sum(coalesce(r.pancake_messages, 0)) as mess,
           sum(coalesce(r.pancake_phones, 0)) as data
    from r left join public.ads_staff s on s.id = r.ads_staff_id
    group by 1)
  select (row_number() over (order by g.spend desc, g.who))::int, g.who,
         'BC ngày ' || to_char(p_day, 'FMDD/FMMM') || ' - ' || g.who || E'\n'
         || 'Chi tiêu: ' || private.vn_int(g.spend) || E'\n'
         || 'Mess: ' || private.vn_int(g.mess) || E'\n'
         || 'Giá mess: ' || case when g.mess > 0 then private.vn_int(g.spend / g.mess) else '0' end || E'\n'
         || 'Data: ' || private.vn_int(g.data) || E'\n'
         || 'Giá Data: ' || case when g.data > 0 then private.vn_int(g.spend / g.data) else '0' end || E'\n'
         || 'Tỷ lệ xin số: ' || private.vn_pct(g.data, g.mess)
  from g
  where g.spend > 0 or g.mess > 0 or g.data > 0
  order by 1;
$$;

-- Ngày đó đã đủ số chưa: null = đủ; còn lại là lý do.
create or replace function private.telegram_data_missing(p_day date)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.ads_auto_daily d where d.report_date = p_day)
      then 'Chưa có số Facebook ngày ' || to_char(p_day, 'DD/MM/YYYY')
    when not exists (select 1 from private.ads_pancake_days d where d.report_date = p_day)
      then 'Chưa có số Pancake ngày ' || to_char(p_day, 'DD/MM/YYYY')
  end;
$$;

-- Xếp báo cáo một ngày vào hàng gửi. Trả về số tin.
create or replace function private.telegram_queue_report(p_day date, p_kind text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid := gen_random_uuid();
  v_n     int;
begin
  insert into private.telegram_outbox (batch_id, kind, report_date, seq, title, body)
  select v_batch, p_kind, p_day, t.seq, t.title, t.body from private.telegram_report(p_day) t;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. HỎI / GỬI TELEGRAM (chạy nền) VÀ ĐỌC CÂU TRẢ LỜI
-- ---------------------------------------------------------------------
create or replace function private.telegram_base()
returns text language sql stable security definer set search_path = '' as $$
  select 'https://api.telegram.org/bot' || c.bot_token || '/' from private.telegram_config c where c.id and c.bot_token is not null;
$$;

create or replace function private.telegram_request(p_kind text, p_outbox_id bigint default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_base text := private.telegram_base();
  v_chat text;
  v_body text;
  v_id   bigint;
begin
  if v_base is null then
    return null;
  end if;
  if p_kind = 'getme' then
    v_id := net.http_get(url := v_base || 'getMe', timeout_milliseconds := 20000);
  elsif p_kind = 'updates' then
    v_id := net.http_get(url := v_base || 'getUpdates',
                         params := jsonb_build_object('limit', '100', 'allowed_updates', '["my_chat_member","message"]'),
                         timeout_milliseconds := 20000);
  else
    select c.chat_id into v_chat from private.telegram_config c where c.id;
    select o.body into v_body from private.telegram_outbox o where o.id = p_outbox_id;
    if v_chat is null or v_body is null then
      return null;
    end if;
    v_id := net.http_post(url := v_base || 'sendMessage',
                          body := jsonb_build_object('chat_id', v_chat, 'text', v_body, 'disable_web_page_preview', true),
                          headers := jsonb_build_object('Content-Type', 'application/json'),
                          timeout_milliseconds := 20000);
  end if;
  insert into private.telegram_requests (request_id, kind, outbox_id) values (v_id, p_kind, p_outbox_id);
  return v_id;
end;
$$;

-- Câu báo lỗi dễ hiểu từ câu trả lời của Telegram (không bao giờ chứa token).
create or replace function private.telegram_error_text(p_body jsonb, p_status int)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_status is null then 'Telegram không trả lời, hệ thống sẽ thử lại'
    when p_status = 401 or (p_body ->> 'error_code') = '401' then 'Token bot sai hoặc đã bị thu hồi — dán lại token bot'
    when p_status = 403 then 'Bot không còn trong nhóm (bị xoá / bị chặn) — thêm lại bot vào nhóm'
    when p_status = 429 then 'Telegram báo gửi quá nhanh, hệ thống sẽ thử lại'
    when p_status >= 500 then 'Telegram đang lỗi tạm thời, hệ thống sẽ thử lại'
    when coalesce(p_body ->> 'description', '') ilike '%chat not found%' then 'Không tìm thấy nhóm — thêm bot vào nhóm rồi bấm Tìm nhóm'
    when nullif(p_body ->> 'description', '') is not null then 'Telegram báo lỗi: ' || left(p_body ->> 'description', 200)
    else 'Telegram báo lỗi ' || p_status
  end;
$$;

-- Gửi tin kế tiếp (mỗi lúc một tin để nhóm nhận đúng thứ tự).
create or replace function private.telegram_dispatch()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_id   bigint;
  v_next timestamptz;
begin
  if exists (select 1 from private.telegram_outbox o where o.status = 'sending') then
    return 0;
  end if;
  -- Luôn là tin xếp trước nhất; tin đó đang chờ thử lại thì các tin sau cũng chờ (giữ đúng thứ tự).
  select o.id, o.next_try_at into v_id, v_next from private.telegram_outbox o
  where o.status = 'queued' order by o.id limit 1;
  if v_id is null or v_next > now() then
    return 0;
  end if;
  if private.telegram_request('send', v_id) is null then
    update private.telegram_outbox
      set status = 'failed', error = 'Chưa có bot hoặc chưa chọn nhóm nhận báo cáo'
    where status = 'queued';
    return 0;
  end if;
  update private.telegram_outbox set status = 'sending', attempts = attempts + 1 where id = v_id;
  return 1;
end;
$$;

-- Đọc câu trả lời đã về (hoặc chờ quá 2 phút), rồi gửi tin kế tiếp.
create or replace function private.telegram_collect()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r       record;
  v_body  jsonb;
  v_ok    boolean;
  v_err   text;
  v_new   text;
  v_u     jsonb;
  v_chat  jsonb;
  v_done  int := 0;
  v_retry boolean;
  v_batch uuid;
begin
  if not pg_try_advisory_xact_lock(hashtext('private.telegram_collect')) then
    return jsonb_build_object('skipped', true);
  end if;

  for r in
    select q.request_id, q.kind, q.outbox_id, h.id as resp_id, h.status_code, h.content
    from private.telegram_requests q
    left join net._http_response h on h.id = q.request_id
    where h.id is not null or q.created_at < now() - interval '2 minutes'
    order by q.created_at
  loop
    delete from private.telegram_requests where request_id = r.request_id;
    v_done := v_done + 1;
    v_body := null;
    begin
      v_body := r.content::jsonb;
    exception when others then
      v_body := null;
    end;
    v_ok := r.status_code = 200 and jsonb_typeof(v_body) = 'object' and (v_body ->> 'ok') = 'true';
    v_err := case when v_ok then null else private.telegram_error_text(v_body, r.status_code) end;

    if r.kind = 'getme' then
      update private.telegram_config
        set bot_username = case when v_ok then left(v_body #>> '{result,username}', 64) else bot_username end,
            last_error = v_err, last_error_at = case when v_ok then null else now() end
      where id;

    elsif r.kind = 'updates' then
      if v_ok and jsonb_typeof(v_body -> 'result') = 'array' then
        for v_u in select * from jsonb_array_elements(v_body -> 'result') loop
          v_chat := coalesce(v_u #> '{my_chat_member,chat}', v_u #> '{message,chat}');
          continue when jsonb_typeof(v_chat) is distinct from 'object'
                     or (v_chat ->> 'type') not in ('group', 'supergroup')
                     or (v_chat ->> 'id') !~ '^-?[0-9]{1,20}$';
          insert into private.telegram_chats as c (chat_id, title, chat_type, bot_status, seen_at)
          values (v_chat ->> 'id', left(v_chat ->> 'title', 200), v_chat ->> 'type',
                  v_u #>> '{my_chat_member,new_chat_member,status}', now())
          on conflict (chat_id) do update
            set title = coalesce(excluded.title, c.title), chat_type = excluded.chat_type,
                bot_status = coalesce(excluded.bot_status, c.bot_status), seen_at = now();
          -- Nhóm thường được nâng lên siêu nhóm → đổi ID.
          v_new := v_u #>> '{message,migrate_to_chat_id}';
          if v_new ~ '^-?[0-9]{1,20}$' then
            insert into private.telegram_chats as c (chat_id, title, chat_type, seen_at)
            values (v_new, left(v_chat ->> 'title', 200), 'supergroup', now())
            on conflict (chat_id) do update set seen_at = now();
            update private.telegram_chats set bot_status = 'left' where chat_id = v_chat ->> 'id';
            update private.telegram_config set chat_id = v_new where id and chat_id = v_chat ->> 'id';
          end if;
        end loop;
        update private.telegram_config set last_error = null, last_error_at = null where id and last_error is not null;
      else
        update private.telegram_config set last_error = v_err, last_error_at = now() where id;
      end if;

    else
      if v_ok then
        update private.telegram_outbox set status = 'sent', sent_at = now(), error = null where id = r.outbox_id;
        update private.telegram_config set last_error = null, last_error_at = null where id and last_error is not null;
      else
        -- Nhóm đã lên siêu nhóm: Telegram cho ID mới → gửi lại vào ID mới.
        v_new := v_body #>> '{parameters,migrate_to_chat_id}';
        if v_new ~ '^-?[0-9]{1,20}$' then
          update private.telegram_config set chat_id = v_new where id;
          update private.telegram_outbox set status = 'queued', attempts = 0, next_try_at = now() where id = r.outbox_id;
          continue;
        end if;
        v_retry := r.status_code is null or r.status_code = 429 or r.status_code >= 500;
        select o.batch_id into v_batch from private.telegram_outbox o where o.id = r.outbox_id;
        update private.telegram_outbox
          set status = case when v_retry and attempts < 3 then 'queued' else 'failed' end,
              next_try_at = now() + interval '30 seconds', error = v_err
        where id = r.outbox_id;
        -- Lỗi không tự hết (token sai, bot bị xoá khỏi nhóm…) → bỏ các tin còn lại của lượt này.
        if not v_retry then
          update private.telegram_outbox set status = 'failed', error = v_err
          where batch_id = v_batch and status = 'queued';
        end if;
        update private.telegram_config set last_error = v_err, last_error_at = now() where id;
      end if;
    end if;
  end loop;

  perform private.telegram_dispatch();
  return jsonb_build_object('answers', v_done, 'pending', private.telegram_pending());
end;
$$;

create or replace function private.telegram_pending()
returns int language sql stable security definer set search_path = '' as $$
  select ((select count(*) from private.telegram_outbox o where o.status in ('queued', 'sending'))
        + (select count(*) from private.telegram_requests q where q.kind <> 'send'))::int;
$$;

-- Lịch 20 giây một lần: đọc câu trả lời, gửi tin kế tiếp; tới giờ thì xếp báo cáo hôm qua (một lần mỗi ngày).
create or replace function private.telegram_tick()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cfg     private.telegram_config%rowtype;
  v_day     date := private.today_vn() - 1;
  v_missing text;
  v_n       int := 0;
begin
  perform private.telegram_collect();
  select * into v_cfg from private.telegram_config c where c.id;
  if not found or v_cfg.bot_token is null or v_cfg.chat_id is null or not v_cfg.enabled
     or extract(hour from now() at time zone 'Asia/Ho_Chi_Minh') < v_cfg.send_hour
     or v_cfg.last_sent_for >= v_day then
    return jsonb_build_object('queued', 0);
  end if;
  v_missing := private.telegram_data_missing(v_day);
  if v_missing is not null then
    -- Chưa đủ số: chờ lượt sau (số Facebook / Pancake tự kéo mỗi giờ).
    update private.telegram_config
      set last_error = 'Chưa gửi báo cáo ' || to_char(v_day, 'DD/MM') || ': ' || v_missing || ' — hệ thống sẽ gửi khi có số',
          last_error_at = now()
    where id and last_error is distinct from 'Chưa gửi báo cáo ' || to_char(v_day, 'DD/MM') || ': ' || v_missing || ' — hệ thống sẽ gửi khi có số';
    return jsonb_build_object('queued', 0, 'missing', v_missing);
  end if;
  v_n := private.telegram_queue_report(v_day, 'auto');
  update private.telegram_config set last_sent_for = v_day where id;
  perform private.telegram_dispatch();
  return jsonb_build_object('queued', v_n);
end;
$$;


-- ---------------------------------------------------------------------
-- 5. HÀM CHO MÀN HÌNH (Quản trị, Trưởng Marketing; màn hình chỉ cho Quản trị bấm)
-- ---------------------------------------------------------------------

-- Dán token bot (lấy từ @BotFather). Dán xong: hỏi tên bot và tìm các nhóm bot đã được thêm vào.
create or replace function public.telegram_save_token(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_token text := btrim(coalesce(p_token, ''), E' \t\r\n');
begin
  perform private.ads_auto_guard();
  if v_token !~ '^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$' then
    raise exception 'Token bot không đúng dạng: token Telegram có dạng 123456789:AAH… (lấy ở @BotFather). Kiểm tra lại, đừng copy thừa chữ'
      using errcode = '22023';
  end if;
  insert into private.telegram_config (id, bot_token, token_hint, token_set_at, token_set_by)
  values (true, v_token, right(v_token, 4), now(), (select auth.uid()))
  on conflict (id) do update
    set bot_token = excluded.bot_token, token_hint = excluded.token_hint, token_set_at = excluded.token_set_at,
        token_set_by = excluded.token_set_by, bot_username = null, chat_id = null, chat_title = null,
        last_error = null, last_error_at = null;
  delete from private.telegram_chats where chat_id is not null;
  perform private.telegram_request('getme');
  perform private.telegram_request('updates');
end;
$$;

-- Tìm các nhóm bot đã được thêm vào (Telegram giữ tin 24 giờ: thêm bot / gõ lệnh trong nhóm rồi bấm Tìm nhóm).
create or replace function public.telegram_find_chats()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ads_auto_guard();
  if private.telegram_base() is null then
    raise exception 'Chưa có token bot Telegram' using errcode = '22023';
  end if;
  perform private.telegram_request('updates');
end;
$$;

-- Chọn nhóm nhận báo cáo. Đã qua giờ gửi hôm nay thì lần tự gửi đầu tiên là sáng mai.
create or replace function public.telegram_set_chat(p_chat_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_chat private.telegram_chats%rowtype;
begin
  perform private.ads_auto_guard();
  select * into v_chat from private.telegram_chats c where c.chat_id = p_chat_id;
  if not found then
    raise exception 'Không thấy nhóm này — bấm Tìm nhóm lại' using errcode = '22023';
  end if;
  update private.telegram_config
    set chat_id = v_chat.chat_id, chat_title = v_chat.title, last_error = null, last_error_at = null,
        last_sent_for = case when extract(hour from now() at time zone 'Asia/Ho_Chi_Minh') >= send_hour
                             then private.today_vn() - 1 else private.today_vn() - 2 end
  where id;
end;
$$;

create or replace function public.telegram_set_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ads_auto_guard();
  update private.telegram_config set enabled = coalesce(p_enabled, true) where id;
end;
$$;

-- Gỡ bot: ngừng gửi. Các tin chưa gửi bị huỷ.
create or replace function public.telegram_remove_token()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ads_auto_guard();
  update private.telegram_config
    set bot_token = null, token_hint = null, bot_username = null, chat_id = null, chat_title = null,
        token_set_at = now(), token_set_by = (select auth.uid()), last_error = null, last_error_at = null
  where id;
  update private.telegram_outbox set status = 'failed', error = 'Đã gỡ bot' where status in ('queued', 'sending');
  delete from private.telegram_chats where chat_id is not null;
end;
$$;

-- Xem trước báo cáo một ngày (đúng các tin sẽ gửi).
create or replace function public.telegram_preview(p_day date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.ads_auto_guard();
  return jsonb_build_object(
    'missing', private.telegram_data_missing(p_day),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'body', t.body) order by t.seq)
                          from private.telegram_report(p_day) t), '[]'::jsonb));
end;
$$;

-- Gửi ngay báo cáo một ngày vào nhóm (nút "Gửi ngay"). Trả về số tin.
create or replace function public.telegram_send_now(p_day date)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_missing text;
  v_n       int;
begin
  perform private.ads_auto_guard();
  if not exists (select 1 from private.telegram_config c where c.id and c.bot_token is not null and c.chat_id is not null) then
    raise exception 'Chưa có bot hoặc chưa chọn nhóm nhận báo cáo' using errcode = '22023';
  end if;
  if p_day is null or p_day >= private.today_vn() or p_day < private.today_vn() - 92 then
    raise exception 'Chọn một ngày đã qua (tối đa 93 ngày trước)' using errcode = '22023';
  end if;
  if exists (select 1 from private.telegram_outbox o where o.status in ('queued', 'sending')) then
    raise exception 'Đang gửi báo cáo, đợi gửi xong rồi bấm lại' using errcode = '55006';
  end if;
  v_missing := private.telegram_data_missing(p_day);
  if v_missing is not null then
    raise exception '%', v_missing using errcode = '22023';
  end if;
  v_n := private.telegram_queue_report(p_day, 'manual');
  if v_n = 0 then
    raise exception 'Ngày này không có nhân viên nào chạy quảng cáo' using errcode = '22023';
  end if;
  perform private.telegram_dispatch();
  return v_n;
end;
$$;

create or replace function public.telegram_collect_now()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.ads_auto_guard();
  return private.telegram_collect();
end;
$$;

-- Tình trạng (không bao giờ trả token).
create or replace function public.telegram_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg private.telegram_config%rowtype;
begin
  perform private.ads_auto_guard();
  select * into v_cfg from private.telegram_config c where c.id;
  return jsonb_build_object(
    'has_token', v_cfg.bot_token is not null,
    'token_hint', case when v_cfg.bot_token is not null then v_cfg.token_hint end,
    'token_set_at', v_cfg.token_set_at,
    'token_set_by', (select s.full_name from public.staff s where s.user_id = v_cfg.token_set_by),
    'bot_username', v_cfg.bot_username,
    'chat_id', v_cfg.chat_id,
    'chat_title', v_cfg.chat_title,
    'enabled', coalesce(v_cfg.enabled, true),
    'send_hour', coalesce(v_cfg.send_hour, 10),
    'last_sent_for', v_cfg.last_sent_for,
    'last_error', v_cfg.last_error,
    'last_error_at', v_cfg.last_error_at,
    'pending', private.telegram_pending(),
    'chats', coalesce((select jsonb_agg(jsonb_build_object('chat_id', c.chat_id, 'title', c.title, 'type', c.chat_type)
                                        order by c.seen_at desc)
                       from private.telegram_chats c
                       where coalesce(c.bot_status, 'member') not in ('left', 'kicked')), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', o.id, 'batch_id', o.batch_id, 'kind', o.kind, 'report_date', o.report_date,
                                 'seq', o.seq, 'title', o.title, 'status', o.status, 'sent_at', o.sent_at,
                                 'error', o.error, 'created_at', o.created_at) order by o.id desc)
                        from (select * from private.telegram_outbox order by id desc limit 30) o), '[]'::jsonb));
end;
$$;


-- ---------------------------------------------------------------------
-- 6. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function private.ads_auto_compare_rows(date, date) from public, anon, authenticated;
revoke all on function private.vn_int(numeric) from public;
revoke all on function private.vn_pct(numeric, numeric) from public;
revoke all on function private.telegram_staff_name(text) from public;
revoke all on function private.telegram_report(date) from public, anon, authenticated;
revoke all on function private.telegram_data_missing(date) from public, anon, authenticated;
revoke all on function private.telegram_queue_report(date, text) from public, anon, authenticated;
revoke all on function private.telegram_base() from public, anon, authenticated;
revoke all on function private.telegram_request(text, bigint) from public, anon, authenticated;
revoke all on function private.telegram_error_text(jsonb, int) from public;
revoke all on function private.telegram_dispatch() from public, anon, authenticated;
revoke all on function private.telegram_collect() from public, anon, authenticated;
revoke all on function private.telegram_pending() from public, anon, authenticated;
revoke all on function private.telegram_tick() from public, anon, authenticated;

revoke all on function public.ads_auto_compare(date, date) from public, anon;
grant execute on function public.ads_auto_compare(date, date) to authenticated;
revoke all on function public.telegram_save_token(text) from public, anon;
revoke all on function public.telegram_find_chats() from public, anon;
revoke all on function public.telegram_set_chat(text) from public, anon;
revoke all on function public.telegram_set_enabled(boolean) from public, anon;
revoke all on function public.telegram_remove_token() from public, anon;
revoke all on function public.telegram_preview(date) from public, anon;
revoke all on function public.telegram_send_now(date) from public, anon;
revoke all on function public.telegram_collect_now() from public, anon;
revoke all on function public.telegram_status() from public, anon;
grant execute on function public.telegram_save_token(text) to authenticated;
grant execute on function public.telegram_find_chats() to authenticated;
grant execute on function public.telegram_set_chat(text) to authenticated;
grant execute on function public.telegram_set_enabled(boolean) to authenticated;
grant execute on function public.telegram_remove_token() to authenticated;
grant execute on function public.telegram_preview(date) to authenticated;
grant execute on function public.telegram_send_now(date) to authenticated;
grant execute on function public.telegram_collect_now() to authenticated;
grant execute on function public.telegram_status() to authenticated;


-- ---------------------------------------------------------------------
-- 7. LỊCH CHẠY 20 GIÂY MỘT LẦN
-- ---------------------------------------------------------------------
select cron.schedule('smh-telegram', '20 seconds', 'select private.telegram_tick()');

commit;
