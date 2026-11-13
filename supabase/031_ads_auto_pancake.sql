-- =====================================================================
-- Smile Hub ERP — ADS TỰ ĐỘNG: THÊM SỐ TIN NHẮN + SỐ ĐIỆN THOẠI THEO THỐNG KÊ QUẢNG CÁO CỦA PANCAKE
--
-- Chạy SAU supabase/029_fix_save_token.sql. Chạy lại nhiều lần cũng không sao.
-- Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có, và KHÔNG BAO GIỜ ghi vào hai bảng nhân viên nhập tay
-- (ad_daily_reports, ads_daily_data). Nó thêm:
--   • public.ads_pancake_daily: số Pancake theo (ngày Việt Nam, page Pancake, quảng cáo):
--       - messages = "sum_click": số khách nhắn tin vào page từ quảng cáo đó (Pancake tự đếm),
--       - phones   = "sum_phone_number": số khách để lại số điện thoại (Pancake tự đếm);
--   • private.ads_ad_map: quảng cáo nào thuộc TKQC nào. Lấy từ chính câu trả lời của Pancake (page đã nối
--     tài khoản quảng cáo trên Pancake), còn lại hỏi Facebook GET /{ad_id}?fields=account_id bằng token
--     Ads tự động (file 027). Một quảng cáo không bao giờ đổi TKQC nên chỉ hỏi một lần;
--   • hàng đợi (page, ngày) cần hỏi Pancake: mỗi lần gửi tối đa 3 lượt / page (Pancake cho 5 lượt / giây / page);
--   • lịch chạy mỗi phút (của file 027) làm thêm việc này; mỗi giờ hỏi lại 3 ngày gần nhất;
--     nút "Kéo lại số khoảng này" kéo luôn số Pancake của khoảng đó;
--   • ads_auto_compare có thêm 2 cột pancake_messages, pancake_phones; dòng ad_account_id = null là số
--     Pancake của quảng cáo chưa gắn được vào TKQC nào trong ERP (để biết còn sót bao nhiêu).
--
-- Nguồn số: Pancake Public API GET /pages/{page_id}/statistics/ads?type=by_id&since&until
-- (since / until là giờ Unix; ở đây 00:00:00 → 23:59:59 giờ Việt Nam của từng ngày).
-- Token Page Pancake nằm ở private.pancake_tokens (file 023), không ai đọc lại được qua ứng dụng.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. BẢNG
-- ---------------------------------------------------------------------

-- Số Pancake theo ngày, page, quảng cáo (chỉ lưu quảng cáo có tin nhắn hoặc có số điện thoại).
create table if not exists public.ads_pancake_daily (
  report_date     date not null,
  pancake_page_id text not null,
  ad_id           text not null check (ad_id ~ '^[0-9]{5,30}$'),
  fb_account_id   text,                       -- TKQC Pancake báo kèm (chỉ có khi page đã nối tài khoản quảng cáo)
  messages        int not null default 0 check (messages >= 0),   -- sum_click
  phones          int not null default 0 check (phones >= 0),     -- sum_phone_number
  fetched_at      timestamptz not null default now(),
  primary key (report_date, pancake_page_id, ad_id)
);
create index if not exists ads_pancake_daily_ad_idx on public.ads_pancake_daily (ad_id);

alter table public.ads_pancake_daily enable row level security;
drop policy if exists ads_pancake_daily_select on public.ads_pancake_daily;
create policy ads_pancake_daily_select on public.ads_pancake_daily
  for select to authenticated using ((select private.manages_marketing()));
-- Chỉ xem; chỉ hệ thống ghi.
revoke all on public.ads_pancake_daily from anon, authenticated;
grant select on public.ads_pancake_daily to authenticated;

-- Quảng cáo → TKQC (chữ số). fb_account_id null = chưa tra được; tra lại sau `retry_at`.
create table if not exists private.ads_ad_map (
  ad_id         text primary key,
  fb_account_id text,
  source        text not null check (source in ('pancake', 'facebook')),
  checked_at    timestamptz not null default now(),
  retry_at      timestamptz,
  last_error    text
);
revoke all on private.ads_ad_map from public, anon, authenticated;

-- Hàng đợi: (page, ngày) cần hỏi Pancake. Xong thì xoá; lỗi thì thử lại tối đa 5 lần.
create table if not exists private.ads_pancake_jobs (
  pancake_page_id text not null,
  report_date     date not null,
  attempts        int not null default 0,
  next_try_at     timestamptz not null default now(),
  primary key (pancake_page_id, report_date)
);
revoke all on private.ads_pancake_jobs from public, anon, authenticated;

-- Lượt hỏi đang chờ trả lời (pg_net gửi nền): 'stats' = hỏi Pancake, 'ad' = hỏi Facebook quảng cáo thuộc TKQC nào.
create table if not exists private.ads_pancake_requests (
  request_id      bigint primary key,
  kind            text not null check (kind in ('stats', 'ad')),
  pancake_page_id text,
  report_date     date,
  ad_id           text,
  created_at      timestamptz not null default now()
);
revoke all on private.ads_pancake_requests from public, anon, authenticated;

-- (Ngày, page) Pancake đã trả lời xong: ngày đã hỏi mà TKQC không có dòng nào = 0 khách (khác "chưa hỏi").
create table if not exists private.ads_pancake_days (
  report_date     date not null,
  pancake_page_id text not null,
  fetched_at      timestamptz not null default now(),
  primary key (report_date, pancake_page_id)
);
revoke all on private.ads_pancake_days from public, anon, authenticated;

-- Tình trạng hỏi Pancake của từng page.
create table if not exists private.ads_pancake_state (
  pancake_page_id text primary key,
  last_ok_at      timestamptz,
  last_error      text,
  last_error_at   timestamptz
);
revoke all on private.ads_pancake_state from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. TIỆN ÍCH
-- ---------------------------------------------------------------------

-- 00:00:00 giờ Việt Nam của một ngày, dạng giờ Unix (giây).
create or replace function private.vn_day_epoch(p_day date)
returns bigint language sql immutable set search_path = '' as $$
  select extract(epoch from (p_day::timestamp at time zone 'Asia/Ho_Chi_Minh'))::bigint;
$$;

-- Số nguyên không âm trong JSON (số hoặc chuỗi số); dạng lạ → 0.
create or replace function private.json_count(p jsonb)
returns int language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) in ('number', 'string') and (p #>> '{}') ~ '^[0-9]{1,9}(\.0+)?$'
              then floor((p #>> '{}')::numeric)::int else 0 end;
$$;

-- Các page Pancake được hỏi: đang bật trong Kết nối Pancake và có token.
create or replace function private.ads_pancake_pages()
returns setof text language sql stable security definer set search_path = '' as $$
  select p.pancake_page_id from public.pancake_pages p
  where p.is_active and exists (select 1 from private.pancake_tokens t where t.pancake_page_id = p.pancake_page_id);
$$;

-- Đưa (page, ngày) vào hàng đợi cho mọi page. Đã có trong hàng đợi → hỏi lại từ đầu. Trả về số page.
create or replace function private.ads_pancake_queue(p_since date, p_until date)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_pages int;
begin
  if p_since is null or p_until is null or p_since > p_until then
    return 0;
  end if;
  insert into private.ads_pancake_jobs (pancake_page_id, report_date)
  select g.pg, p_since + i
  from private.ads_pancake_pages() g(pg), generate_series(0, p_until - p_since) i
  on conflict (pancake_page_id, report_date) do update set attempts = 0, next_try_at = now();
  select count(*) into v_pages from private.ads_pancake_pages();
  return v_pages;
end;
$$;

-- Quảng cáo đang cần hỏi Facebook xem thuộc TKQC nào (có số Pancake mà chưa biết TKQC).
create or replace function private.ads_pancake_unmapped()
returns setof text language sql stable security definer set search_path = '' as $$
  select d.ad_id from public.ads_pancake_daily d
  where d.fb_account_id is null
    and not exists (select 1 from private.ads_ad_map m
                    where m.ad_id = d.ad_id and (m.fb_account_id is not null or m.retry_at > now()))
    and not exists (select 1 from private.ads_pancake_requests q where q.kind = 'ad' and q.ad_id = d.ad_id)
  group by d.ad_id
  order by max(d.report_date) desc;
$$;

-- Còn bao nhiêu việc: (page, ngày) chưa hỏi xong + lượt đang chờ + quảng cáo cần tra TKQC (khi có token Facebook).
create or replace function private.ads_pancake_pending()
returns int language sql stable security definer set search_path = '' as $$
  select ((select count(*) from private.ads_pancake_jobs)
        + (select count(*) from private.ads_pancake_requests q
           where not (q.kind = 'stats' and exists (select 1 from private.ads_pancake_jobs j
                                                   where j.pancake_page_id = q.pancake_page_id and j.report_date = q.report_date)))
        + case when exists (select 1 from private.ads_auto_config c where c.id and c.token is not null)
               then (select count(*) from private.ads_pancake_unmapped()) else 0 end)::int;
$$;


-- ---------------------------------------------------------------------
-- 3. HỎI PANCAKE / FACEBOOK (chạy nền) VÀ ĐỌC CÂU TRẢ LỜI
-- ---------------------------------------------------------------------

-- Hỏi Pancake số quảng cáo của một page trong một ngày Việt Nam.
create or replace function private.ads_pancake_request_stats(p_pancake_page_id text, p_day date)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_since bigint := private.vn_day_epoch(p_day);
  v_id    bigint;
begin
  select t.token into v_token from private.pancake_tokens t where t.pancake_page_id = p_pancake_page_id;
  if v_token is null or p_day is null then
    return null;
  end if;
  v_id := net.http_get(
    url := 'https://pages.fm/api/public_api/v1/pages/' || p_pancake_page_id || '/statistics/ads',
    params := jsonb_build_object(
      'page_access_token', v_token,
      'type', 'by_id',
      'since', v_since::text,
      'until', (v_since + 86399)::text),
    timeout_milliseconds := 30000);
  insert into private.ads_pancake_requests (request_id, kind, pancake_page_id, report_date)
  values (v_id, 'stats', p_pancake_page_id, p_day);
  return v_id;
end;
$$;

-- Hỏi Facebook một quảng cáo thuộc TKQC nào (token đi trong header, không nằm trên địa chỉ).
create or replace function private.ads_pancake_request_ad(p_ad_id text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_id    bigint;
begin
  select c.token into v_token from private.ads_auto_config c where c.id;
  if v_token is null or p_ad_id !~ '^[0-9]{5,30}$' then
    return null;
  end if;
  v_id := net.http_get(
    url := private.fb_graph_base() || p_ad_id,
    params := jsonb_build_object('fields', 'account_id'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token),
    timeout_milliseconds := 30000);
  insert into private.ads_pancake_requests (request_id, kind, ad_id) values (v_id, 'ad', p_ad_id);
  return v_id;
end;
$$;

-- Gửi lượt hỏi mới: mỗi page tối đa 3 lượt đang chờ, ngày gần nhất trước; tra TKQC tối đa 5 quảng cáo một lúc.
create or replace function private.ads_pancake_dispatch()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_page text;
  v_day  date;
  v_ad   text;
  v_free int;
  v_sent int := 0;
begin
  -- Page đã tắt / mất token → bỏ việc của page đó.
  delete from private.ads_pancake_jobs j
  where not exists (select 1 from private.ads_pancake_pages() g(pg) where g.pg = j.pancake_page_id);

  for v_page in select distinct j.pancake_page_id from private.ads_pancake_jobs j where j.next_try_at <= now() loop
    v_free := 3 - (select count(*) from private.ads_pancake_requests q where q.kind = 'stats' and q.pancake_page_id = v_page);
    continue when v_free <= 0;
    for v_day in
      select j.report_date from private.ads_pancake_jobs j
      where j.pancake_page_id = v_page and j.next_try_at <= now()
        and not exists (select 1 from private.ads_pancake_requests q
                        where q.kind = 'stats' and q.pancake_page_id = v_page and q.report_date = j.report_date)
      order by j.report_date desc
      limit v_free
    loop
      begin
        if private.ads_pancake_request_stats(v_page, v_day) is not null then
          v_sent := v_sent + 1;
        end if;
      exception when others then
        update private.ads_pancake_jobs set attempts = attempts + 1, next_try_at = now() + interval '2 minutes'
        where pancake_page_id = v_page and report_date = v_day;
        insert into private.ads_pancake_state (pancake_page_id, last_error, last_error_at)
        values (v_page, left('Không gửi được lượt hỏi Pancake: ' || sqlerrm, 300), now())
        on conflict (pancake_page_id) do update set last_error = excluded.last_error, last_error_at = excluded.last_error_at;
      end;
    end loop;
  end loop;

  if exists (select 1 from private.ads_auto_config c where c.id and c.token is not null) then
    v_free := 5 - (select count(*) from private.ads_pancake_requests q where q.kind = 'ad');
    if v_free > 0 then
      for v_ad in select u from private.ads_pancake_unmapped() u limit v_free loop
        begin
          if private.ads_pancake_request_ad(v_ad) is not null then
            v_sent := v_sent + 1;
          end if;
        exception when others then
          insert into private.ads_ad_map as m (ad_id, source, checked_at, retry_at, last_error)
          values (v_ad, 'facebook', now(), now() + interval '30 minutes', left(sqlerrm, 300))
          on conflict (ad_id) do update
            set checked_at = now(), retry_at = excluded.retry_at, last_error = excluded.last_error
            where m.fb_account_id is null;
        end;
      end loop;
    end if;
  end if;
  return v_sent;
end;
$$;

-- Câu báo lỗi dễ hiểu từ câu trả lời lỗi của Pancake (không bao giờ chứa token).
create or replace function private.pancake_error_text(p_body jsonb, p_status int)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_status = 429 then 'Pancake báo hỏi quá nhiều, hệ thống sẽ tự thử lại'
    when p_status in (401, 403) then 'Token Page Pancake sai hoặc đã hết hạn — dán lại token ở Kết nối Pancake'
    when p_status >= 500 then 'Pancake đang lỗi tạm thời, hệ thống sẽ tự thử lại'
    when jsonb_typeof(p_body) = 'object' and nullif(btrim(coalesce(p_body ->> 'message', '')), '') is not null
      then 'Pancake báo lỗi: ' || left(btrim(p_body ->> 'message'), 200)
    when p_status = 200 then 'Pancake trả về dữ liệu không đọc được'
    else 'Pancake báo lỗi ' || coalesce(p_status::text, 'không rõ')
  end;
$$;

-- Đọc các câu trả lời đã về (hoặc chờ quá 3 phút), lưu số; rồi gửi lượt hỏi mới.
create or replace function private.ads_pancake_collect()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r       record;
  v_body  jsonb;
  v_list  jsonb;
  v_err   text;
  v_code  int;
  v_acc   text;
  v_done  int := 0;
  v_rows  int := 0;
  v_n     int;
  v_sent  int;
  v_retry boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('private.ads_pancake_collect')) then
    return jsonb_build_object('skipped', true);
  end if;

  for r in
    select q.request_id, q.kind, q.pancake_page_id, q.report_date, q.ad_id,
           h.id as resp_id, h.status_code, h.content, h.timed_out, h.error_msg
    from private.ads_pancake_requests q
    left join net._http_response h on h.id = q.request_id
    where h.id is not null or q.created_at < now() - interval '3 minutes'
    order by q.created_at
  loop
    delete from private.ads_pancake_requests where request_id = r.request_id;
    v_done := v_done + 1;
    v_body := null;
    begin
      v_body := r.content::jsonb;
    exception when others then
      v_body := null;
    end;

    if r.kind = 'ad' then
      -- Facebook: { "account_id": "123…", "id": "…" }
      v_acc := case when jsonb_typeof(v_body) = 'object' then private.fb_account_digits(v_body ->> 'account_id') end;
      if r.status_code = 200 and v_acc is not null then
        insert into private.ads_ad_map as m (ad_id, fb_account_id, source, checked_at, retry_at, last_error)
        values (r.ad_id, v_acc, 'facebook', now(), null, null)
        on conflict (ad_id) do update
          set fb_account_id = excluded.fb_account_id, source = 'facebook', checked_at = now(), retry_at = null, last_error = null;
      else
        v_code := case when (v_body #>> '{error,code}') ~ '^[0-9]{1,9}$' then (v_body #>> '{error,code}')::int end;
        insert into private.ads_ad_map as m (ad_id, source, checked_at, retry_at, last_error)
        values (r.ad_id, 'facebook', now(),
                -- Không có quyền / không có quảng cáo này (TKQC ngoài hệ thống) → 7 ngày sau mới hỏi lại;
                -- token hỏng, hỏi quá nhiều, Facebook lỗi, không trả lời → 30 phút sau.
                case when r.status_code is not null and r.status_code < 500 and r.status_code <> 429
                          and v_code is not null and v_code not in (1, 2, 4, 17, 32, 190, 613)
                          and v_code not between 80000 and 80099
                     then now() + interval '7 days' else now() + interval '30 minutes' end,
                left(case when r.status_code is null then 'Facebook không trả lời'
                          else private.fb_error_text(v_body, r.status_code) end, 300))
        on conflict (ad_id) do update
          set checked_at = now(), retry_at = excluded.retry_at, last_error = excluded.last_error
          where m.fb_account_id is null;
      end if;
      continue;
    end if;

    -- Pancake: mảng, mỗi phần tử một quảng cáo.
    v_list := case when jsonb_typeof(v_body) = 'array' then v_body
                   when jsonb_typeof(v_body -> 'data') = 'array' then v_body -> 'data' end;
    v_err := null;
    if r.resp_id is null or r.status_code is null then
      v_err := case when r.timed_out then 'Pancake không trả lời kịp, hệ thống sẽ tự thử lại'
                    else coalesce('Không gọi được Pancake: ' || nullif(left(r.error_msg, 200), ''),
                                  'Pancake không trả lời, hệ thống sẽ tự thử lại') end;
    elsif r.status_code <> 200 or v_list is null
          or (jsonb_typeof(v_body) = 'object' and v_body ->> 'success' = 'false') then
      v_err := private.pancake_error_text(v_body, r.status_code);
    end if;

    if v_err is not null then
      update private.ads_pancake_jobs
        set attempts = attempts + 1, next_try_at = now() + (attempts + 1) * interval '2 minutes'
      where pancake_page_id = r.pancake_page_id and report_date = r.report_date;
      delete from private.ads_pancake_jobs
      where pancake_page_id = r.pancake_page_id and report_date = r.report_date and attempts >= 5;
      insert into private.ads_pancake_state (pancake_page_id, last_error, last_error_at)
      values (r.pancake_page_id, v_err, now())
      on conflict (pancake_page_id) do update set last_error = excluded.last_error, last_error_at = excluded.last_error_at;
      continue;
    end if;

    -- Thay toàn bộ số của (ngày, page) bằng số mới.
    delete from public.ads_pancake_daily
    where report_date = r.report_date and pancake_page_id = r.pancake_page_id;
    insert into public.ads_pancake_daily (report_date, pancake_page_id, ad_id, fb_account_id, messages, phones, fetched_at)
    select r.report_date, r.pancake_page_id, x.ad_id, max(x.acc), sum(x.msgs), sum(x.phones), now()
    from (select e ->> 'ad_id' as ad_id, private.fb_account_digits(e ->> 'account_id') as acc,
                 private.json_count(e -> 'sum_click') as msgs, private.json_count(e -> 'sum_phone_number') as phones
          from jsonb_array_elements(v_list) e
          where jsonb_typeof(e) = 'object' and (e ->> 'ad_id') ~ '^[0-9]{5,30}$') x
    group by x.ad_id
    having sum(x.msgs) > 0 or sum(x.phones) > 0;
    get diagnostics v_n = row_count;
    v_rows := v_rows + v_n;

    -- Pancake báo kèm TKQC (page đã nối tài khoản quảng cáo) → nhớ luôn, khỏi hỏi Facebook.
    insert into private.ads_ad_map as m (ad_id, fb_account_id, source, checked_at)
    select distinct on (e ->> 'ad_id') e ->> 'ad_id', private.fb_account_digits(e ->> 'account_id'), 'pancake', now()
    from jsonb_array_elements(v_list) e
    where jsonb_typeof(e) = 'object' and (e ->> 'ad_id') ~ '^[0-9]{5,30}$'
      and private.fb_account_digits(e ->> 'account_id') is not null
    on conflict (ad_id) do update
      set fb_account_id = excluded.fb_account_id, checked_at = now(), retry_at = null, last_error = null
      where m.fb_account_id is null;

    insert into private.ads_pancake_days (report_date, pancake_page_id, fetched_at)
    values (r.report_date, r.pancake_page_id, now())
    on conflict (report_date, pancake_page_id) do update set fetched_at = now();
    delete from private.ads_pancake_jobs where pancake_page_id = r.pancake_page_id and report_date = r.report_date;
    v_retry := exists (select 1 from private.ads_pancake_jobs j where j.pancake_page_id = r.pancake_page_id and j.attempts > 0);
    -- Còn ngày khác của page đang chờ thử lại vì lỗi → giữ câu báo lỗi.
    insert into private.ads_pancake_state as st (pancake_page_id, last_ok_at) values (r.pancake_page_id, now())
    on conflict (pancake_page_id) do update
      set last_ok_at = now(),
          last_error = case when v_retry then st.last_error end,
          last_error_at = case when v_retry then st.last_error_at end;
  end loop;

  v_sent := private.ads_pancake_dispatch();
  return jsonb_build_object('answers', v_done, 'rows', v_rows, 'sent', v_sent, 'pending', private.ads_pancake_pending());
end;
$$;


-- ---------------------------------------------------------------------
-- 4. GẮN VÀO LỊCH CHẠY VÀ CÁC HÀM CÓ SẴN CỦA FILE 027
-- ---------------------------------------------------------------------

-- Lịch mỗi phút: như file 027, thêm: đọc / gửi lượt hỏi Pancake; mỗi giờ hỏi lại số Pancake 3 ngày gần nhất.
create or replace function private.ads_auto_tick()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cfg   private.ads_auto_config%rowtype;
  v_today date := private.today_vn();
  v_sent  int := 0;
begin
  perform private.ads_auto_collect();
  select * into v_cfg from private.ads_auto_config c where c.id;
  if found and v_cfg.token is not null and v_cfg.auto_enabled
     and (v_cfg.last_auto_at is null or v_cfg.last_auto_at < now() - interval '59 minutes') then
    update private.ads_auto_config set last_auto_at = now() where id;
    v_sent := private.ads_auto_queue('insights', v_today - 2, v_today);
    v_sent := v_sent + private.ads_auto_queue('account', null, null, interval '20 hours');
    perform private.ads_pancake_queue(v_today - 2, v_today);
  end if;
  -- Việc Pancake đã xếp hàng (kể cả của nút Kéo lại) vẫn chạy cho xong, kể cả khi vừa gỡ token / tắt tự kéo.
  perform private.ads_pancake_collect();
  return jsonb_build_object('requests', v_sent);
end;
$$;

-- Kéo lại một khoảng ngày: như file 027, kéo luôn số Pancake của khoảng đó.
create or replace function public.ads_auto_pull(p_since date, p_until date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.today_vn();
  v_n     int;
  v_pages int;
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
  v_pages := private.ads_pancake_queue(p_since, p_until);
  perform private.ads_pancake_dispatch();
  return jsonb_build_object('accounts', v_n, 'pancake_pages', v_pages);
end;
$$;

-- Đọc ngay các câu trả lời đã về (màn hình gọi vài giây một lần sau khi bấm Kéo): Facebook + Pancake.
create or replace function public.ads_auto_collect_now()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_fb jsonb;
  v_pc jsonb;
begin
  perform private.ads_auto_guard();
  v_fb := private.ads_auto_collect();
  v_pc := private.ads_pancake_collect();
  return v_fb || jsonb_build_object(
    'answers', coalesce((v_fb ->> 'answers')::int, 0) + coalesce((v_pc ->> 'answers')::int, 0),
    'pancake_pending', coalesce((v_pc ->> 'pending')::int, private.ads_pancake_pending()));
end;
$$;

-- Tình trạng: như file 027, thêm tình trạng hỏi Pancake (không bao giờ trả token).
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
    'pancake_pending', private.ads_pancake_pending(),
    'pancake_pages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pancake_page_id', p.pancake_page_id,
               'name', g.name,
               'last_ok_at', s.last_ok_at,
               'last_error', s.last_error,
               'last_error_at', s.last_error_at)
             order by lower(g.name))
      from public.pancake_pages p
      join private.ads_pancake_pages() a(pg) on a.pg = p.pancake_page_id
      left join public.pages g on g.id = p.page_id
      left join private.ads_pancake_state s on s.pancake_page_id = p.pancake_page_id), '[]'::jsonb),
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

-- ĐỐI CHIẾU: như file 027, thêm 2 cột số Pancake. Đổi kiểu trả về nên phải xoá hàm cũ rồi tạo lại.
-- Dòng ad_account_id = null: số Pancake của quảng cáo chưa gắn được TKQC (TKQC ngoài ERP / chưa tra xong).
-- Số Pancake null = Pancake chưa trả lời ngày đó; 0 = đã trả lời, TKQC không có khách nào.
drop function if exists public.ads_auto_compare(date, date);
create function public.ads_auto_compare(p_from date, p_to date)
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


-- ---------------------------------------------------------------------
-- 5. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function private.vn_day_epoch(date) from public;
revoke all on function private.json_count(jsonb) from public;
revoke all on function private.ads_pancake_pages() from public, anon, authenticated;
revoke all on function private.ads_pancake_queue(date, date) from public, anon, authenticated;
revoke all on function private.ads_pancake_unmapped() from public, anon, authenticated;
revoke all on function private.ads_pancake_pending() from public, anon, authenticated;
revoke all on function private.ads_pancake_request_stats(text, date) from public, anon, authenticated;
revoke all on function private.ads_pancake_request_ad(text) from public, anon, authenticated;
revoke all on function private.ads_pancake_dispatch() from public, anon, authenticated;
revoke all on function private.pancake_error_text(jsonb, int) from public;
revoke all on function private.ads_pancake_collect() from public, anon, authenticated;
revoke all on function private.ads_auto_tick() from public, anon, authenticated;

revoke all on function public.ads_auto_pull(date, date) from public, anon;
revoke all on function public.ads_auto_collect_now() from public, anon;
revoke all on function public.ads_auto_status() from public, anon;
revoke all on function public.ads_auto_compare(date, date) from public, anon;
grant execute on function public.ads_auto_pull(date, date) to authenticated;
grant execute on function public.ads_auto_collect_now() to authenticated;
grant execute on function public.ads_auto_status() to authenticated;
grant execute on function public.ads_auto_compare(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- 6. LẦN ĐẦU: XẾP HÀNG SỐ PANCAKE TỪ 20/09/2026 (ngày bắt đầu có báo cáo nhập vào hệ thống) TỚI HÔM NAY
--    Chỉ khi đã có token Facebook (phần Ads tự động đang dùng). Lịch mỗi phút tự hỏi dần, ~20 phút xong;
--    mở trang Ads tự động thì nhanh hơn. Chạy lại file này thì chỉ hỏi lại, không nhân đôi số.
-- ---------------------------------------------------------------------
select private.ads_pancake_queue(date '2026-09-20', private.today_vn())
where exists (select 1 from private.ads_auto_config c where c.id and c.token is not null);

commit;
