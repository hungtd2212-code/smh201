-- =====================================================================
-- Smile Hub ERP — ADS TỰ ĐỘNG: DANH SÁCH SĐT THEO NHÂN VIÊN (đối chiếu từng số với số nhân viên báo)
--
-- Chạy SAU supabase/033_telegram_report_detail.sql. Chạy lại nhiều lần cũng không sao.
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có. Nó thêm:
--   • cột pancake_imports.ad_ids: mọi quảng cáo khách đã bấm, theo thứ tự Pancake trả về (bấm trước ở đầu, bấm sau
--     cùng ở cuối). Khách bấm nhiều quảng cáo → số tính cho quảng cáo bấm SAU CÙNG trước lúc kéo số về. Số đã kéo
--     trước khi chạy file này chỉ nhớ quảng cáo đầu tiên → vẫn tính theo quảng cáo đó. Việc thêm số vào bảng Lead
--     (Telesale) giữ nguyên như file 023;
--   • bảng private.ads_ad_names: tên quảng cáo theo thống kê quảng cáo của Pancake (để hiện "228", "6 - 1"…);
--   • quảng cáo của số Pancake chưa biết thuộc TKQC nào → hỏi Facebook như file 031;
--   • hàm public.ads_staff_phones(từ ngày, đến ngày): từng số Pancake + số form lead Facebook theo từng TKQC, gắn
--     với nhân viên phụ trách TKQC hôm đó. Form lead = "onsite_conversion.lead" (khách điền form tức thì) trong số
--     Facebook đã kéo về hằng giờ (file 027) — không gọi thêm Facebook.
--   • Một lần: hỏi lại số Pancake từ 01/11/2026 để có tên quảng cáo (như lượt hỏi lại mỗi giờ, không nhân đôi số).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. BẢNG
-- ---------------------------------------------------------------------
alter table public.pancake_imports add column if not exists ad_ids jsonb;

create table if not exists private.ads_ad_names (
  ad_id             text primary key,
  name              text not null,
  optimization_goal text,            -- CONVERSATIONS (tin nhắn), LEAD_GENERATION (form)…
  updated_at        timestamptz not null default now()
);
revoke all on private.ads_ad_names from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. SỐ PANCAKE: NHỚ ĐỦ QUẢNG CÁO, TÍNH CHO QUẢNG CÁO BẤM SAU CÙNG
-- ---------------------------------------------------------------------

-- Quảng cáo tính cho một số: phần tử cuối của ad_ids; chưa nhớ danh sách thì quảng cáo đầu tiên (như trước).
create or replace function private.pancake_import_ad(p_ad_ids jsonb, p_ad_id text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    case when jsonb_typeof(p_ad_ids) = 'array' and jsonb_array_length(p_ad_ids) > 0
         then nullif(btrim(coalesce(p_ad_ids ->> (jsonb_array_length(p_ad_ids) - 1), '')), '') end,
    nullif(btrim(coalesce(p_ad_id, '')), ''));
$$;

-- Như file 023, thêm: nhớ cả danh sách quảng cáo khách đã bấm (ad_ids). Việc thêm số vào bảng Lead giữ nguyên.
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

    insert into public.pancake_imports (pancake_page_id, conversation_id, phone, full_name, conversation_type, ad_id, ad_ids, outcome)
    values (p_conn.pancake_page_id, v_conv_id, case when v_valid then v_phone else left(v_raw, 40) end,
            v_name, left(p_conv ->> 'type', 30), v_ad_id,
            case when jsonb_typeof(p_conv -> 'ad_ids') = 'array' then p_conv -> 'ad_ids' end,
            case when v_valid then 'new' else 'invalid' end)
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

-- Như file 031, thêm quảng cáo của các số Pancake (để biết số đó thuộc TKQC nào, nhân viên nào).
create or replace function private.ads_pancake_unmapped()
returns setof text language sql stable security definer set search_path = '' as $$
  select u.ad_id
  from (select d.ad_id, d.report_date as last_day from public.ads_pancake_daily d where d.fb_account_id is null
        union all
        select private.pancake_import_ad(i.ad_ids, i.ad_id), (i.created_at at time zone 'Asia/Ho_Chi_Minh')::date
        from public.pancake_imports i) u
  where u.ad_id ~ '^[0-9]{5,30}$'
    and not exists (select 1 from private.ads_ad_map m
                    where m.ad_id = u.ad_id and (m.fb_account_id is not null or m.retry_at > now()))
    and not exists (select 1 from private.ads_pancake_requests q where q.kind = 'ad' and q.ad_id = u.ad_id)
  group by u.ad_id
  order by max(u.last_day) desc;
$$;


-- ---------------------------------------------------------------------
-- 3. ĐỌC SỐ PANCAKE: NHƯ FILE 031, THÊM TÊN QUẢNG CÁO
-- ---------------------------------------------------------------------
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

    -- Tên quảng cáo (file 034): danh sách SĐT hiện tên bài chạy thay cho mã số.
    insert into private.ads_ad_names as n (ad_id, name, optimization_goal, updated_at)
    select distinct on (e ->> 'ad_id') e ->> 'ad_id', left(btrim(e ->> 'name'), 200),
           left(nullif(btrim(coalesce(e ->> 'optimization_goal', '')), ''), 40), now()
    from jsonb_array_elements(v_list) e
    where jsonb_typeof(e) = 'object' and (e ->> 'ad_id') ~ '^[0-9]{5,30}$'
      and nullif(btrim(coalesce(e ->> 'name', '')), '') is not null
    on conflict (ad_id) do update
      set name = excluded.name, optimization_goal = excluded.optimization_goal, updated_at = now();

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
-- 4. DANH SÁCH SĐT THEO NHÂN VIÊN
-- ---------------------------------------------------------------------
-- phones: từng số Pancake kéo về trong khoảng ngày (giờ Việt Nam), kèm quảng cáo, TKQC, nhân viên phụ trách TKQC
--   hôm đó. gap = vì sao chưa gắn được nhân viên: no_ad (khách không đến từ quảng cáo), unmapped (đang tra TKQC của
--   quảng cáo), outside (TKQC chưa có trong ERP), no_staff (TKQC hôm đó chưa giao nhân viên).
-- forms: số khách điền form tức thì theo Facebook, từng (ngày, TKQC).
-- since: lúc bắt đầu có từng số Pancake (trước đó chỉ có số đếm theo thống kê).
create or replace function public.ads_staff_phones(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  perform private.ads_auto_guard();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Khoảng ngày không hợp lệ (tối đa 93 ngày)' using errcode = '22023';
  end if;
  v_from := p_from::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';

  return jsonb_build_object(
    'since', (select min(i.created_at) from public.pancake_imports i),
    'phones', coalesce((
      with acc as (
        select distinct on (private.fb_account_digits(t.account_id)) private.fb_account_digits(t.account_id) as fb, t.id
        from public.ad_accounts t
        where t.deleted_at is null and private.fb_account_digits(t.account_id) is not null
        order by private.fb_account_digits(t.account_id), t.is_active desc, t.created_at desc),
      i as (
        select i.*, (i.created_at at time zone 'Asia/Ho_Chi_Minh')::date as d,
               private.pancake_import_ad(i.ad_ids, i.ad_id) as ad
        from public.pancake_imports i
        where i.created_at >= v_from and i.created_at < v_to)
      select jsonb_agg(jsonb_build_object(
               'id', i.id,
               'report_date', i.d,
               'at', i.created_at,
               'phone', i.phone,
               'full_name', i.full_name,
               'outcome', i.outcome,
               'ad_id', i.ad,
               'ad_name', n.name,
               'ad_goal', n.optimization_goal,
               'ad_account_id', acc.id,
               'ads_staff_id', z.ads_staff_id,
               'gap', case when i.ad is null then 'no_ad'
                           when m.fb_account_id is null then 'unmapped'
                           when acc.id is null then 'outside'
                           when z.ads_staff_id is null then 'no_staff' end,
               'page_name', pg.name,
               'pancake_url', 'https://pancake.vn/' || i.pancake_page_id || '?c_id=' || i.conversation_id)
             order by i.created_at, i.id)
      from i
      left join private.ads_ad_map m on m.ad_id = i.ad
      left join private.ads_ad_names n on n.ad_id = i.ad
      left join acc on acc.fb = m.fb_account_id
      left join lateral (
        select a.ads_staff_id from public.ad_account_assignments a
        where a.ad_account_id = acc.id and a.deleted_at is null
          and a.from_date <= i.d and (a.to_date is null or a.to_date >= i.d)
        order by a.from_date desc limit 1) z on true
      left join public.pancake_pages pp on pp.pancake_page_id = i.pancake_page_id
      left join public.pages pg on pg.id = pp.page_id), '[]'::jsonb),
    'forms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'report_date', y.report_date,
               'ad_account_id', y.ad_account_id,
               'ads_staff_id', z.ads_staff_id,
               'leads', private.fb_action(y.actions, 'onsite_conversion.lead'))
             order by y.report_date, y.ad_account_id)
      from public.ads_auto_daily y
      left join lateral (
        select a.ads_staff_id from public.ad_account_assignments a
        where a.ad_account_id = y.ad_account_id and a.deleted_at is null
          and a.from_date <= y.report_date and (a.to_date is null or a.to_date >= y.report_date)
        order by a.from_date desc limit 1) z on true
      where y.report_date between p_from and p_to
        and private.fb_action(y.actions, 'onsite_conversion.lead') > 0), '[]'::jsonb));
end;
$$;


-- ---------------------------------------------------------------------
-- 5. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function private.pancake_import_ad(jsonb, text) from public;
revoke all on function private.pancake_take(public.pancake_pages, jsonb) from public;
revoke all on function private.ads_pancake_unmapped() from public, anon, authenticated;
revoke all on function private.ads_pancake_collect() from public, anon, authenticated;
revoke all on function public.ads_staff_phones(date, date) from public, anon;
grant execute on function public.ads_staff_phones(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- 6. MỘT LẦN: HỎI LẠI SỐ PANCAKE TỪ 01/11/2026 ĐỂ CÓ TÊN QUẢNG CÁO
--    Như file 031: chỉ khi đã có token Facebook (phần Ads tự động đang dùng). Hỏi lại thì thay số cũ bằng số mới
--    của chính ngày đó (như lượt hỏi lại mỗi giờ), không nhân đôi.
-- ---------------------------------------------------------------------
select private.ads_pancake_queue(date '2026-11-01', private.today_vn())
where exists (select 1 from private.ads_auto_config c where c.id and c.token is not null);

commit;
