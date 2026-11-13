-- =====================================================================
-- 026 — "KHÁCH ĐÃ XEM" TRONG KHUNG CHAT + THÔNG BÁO MẤT KẾT NỐI PANCAKE
--
-- 1. Khung chat (file 024, 025) trả thêm mốc khách đã đọc tin của page (Pancake: read_watermarks) → dưới tin
--    của page hiện "Đã xem 11:44" như Messenger; đầu khung chat ghi khách đã xem lúc nào.
-- 2. Thông báo (nút chuông trên thanh trên cùng): mỗi phút hệ thống xem các kết nối Pancake; page nào mất
--    kết nối liên tục từ 3 phút → tạo thông báo "Mất kết nối Pancake"; nối lại được → "Đã kết nối lại".
--    Mỗi người tự đánh dấu đã đọc (không ảnh hưởng người khác). Hiện cho Admin, COO, Trưởng Telesale.
--
-- Không đổi / xoá dữ liệu cũ: chỉ thêm bảng mới, thay nội dung 1 hàm, thêm 1 lịch chạy mỗi phút.
-- Chạy lại nhiều lần không sao. Cần chạy sau 025.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. KHÁCH ĐÃ XEM
-- ---------------------------------------------------------------------
-- Đọc cuộc chat (file 024, 025) + mốc khách đã xem: Pancake trả read_watermarks = khách đã đọc tới lúc nào.
create or replace function public.pancake_chat_read(p_request_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req    private.pancake_chat_requests%rowtype;
  v_found  boolean;
  v_status int;
  v_body   text;
  v_timed  boolean;
  v_json   jsonb;
  v_err    text;
  v_msgs   jsonb;
  v_seen   jsonb;
  v_mark   numeric;
begin
  select * into v_req from private.pancake_chat_requests q
  where q.request_id = p_request_id and q.requested_by = (select auth.uid());
  if not found then
    raise exception 'Lượt tải cuộc chat đã hết hạn — bấm Tải lại';
  end if;

  select true, h.status_code, h.content, h.timed_out into v_found, v_status, v_body, v_timed
  from net._http_response h where h.id = p_request_id;
  if v_found is null then
    if v_req.created_at < now() - interval '30 seconds' then
      delete from private.pancake_chat_requests where request_id = p_request_id;
      return jsonb_build_object('state', 'error', 'message', 'Pancake không trả lời kịp — bấm Tải lại');
    end if;
    return jsonb_build_object('state', 'pending');
  end if;
  delete from private.pancake_chat_requests where request_id = p_request_id;

  if v_status is null then
    v_err := case when v_timed then 'Pancake không trả lời kịp — bấm Tải lại' else 'Không gọi được Pancake — bấm Tải lại' end;
  elsif v_status in (401, 403) then
    v_err := 'Page Access Token của page này sai hoặc đã bị đổi — quản lý vào Telesale → Cài đặt để kết nối lại';
  elsif v_status = 404 then
    v_err := 'Pancake không thấy cuộc chat này (có thể đã bị xoá)';
  elsif v_status = 429 then
    v_err := 'Pancake báo hỏi quá nhanh — đợi vài giây rồi bấm Tải lại';
  elsif v_status <> 200 then
    v_err := 'Pancake báo lỗi ' || v_status || ' — bấm Tải lại';
  else
    begin
      v_json := v_body::jsonb;
    exception when others then
      v_json := null;
    end;
    if v_json is null or jsonb_typeof(v_json) <> 'object' then
      v_err := 'Pancake trả về dữ liệu không đọc được';
    elsif (v_json ->> 'success') = 'false' then
      v_err := 'Pancake báo lỗi: ' || left(coalesce(v_json ->> 'message', v_json ->> 'error_message',
                                                     v_json ->> 'error', 'không rõ lý do'), 200);
    elsif jsonb_typeof(v_json -> 'messages') is distinct from 'array' then
      v_err := 'Pancake trả về dữ liệu không đọc được';
    end if;
  end if;
  if v_err is not null then
    return jsonb_build_object('state', 'error', 'message', v_err);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m ->> 'id',
           'at', private.pancake_time(m ->> 'inserted_at'),
           -- Tin của page: người gửi là chính page, hoặc có nhân viên Pancake đứng tên.
           'from_page', coalesce(m #>> '{from,id}' = v_req.pancake_page_id, false)
                        or nullif(m #>> '{from,admin_id}', '') is not null,
           'sender', left(coalesce(nullif(m #>> '{from,admin_name}', ''), m #>> '{from,name}'), 200),
           'text', left(coalesce(nullif(btrim(m ->> 'original_message'), ''),
                                 btrim(regexp_replace(coalesce(m ->> 'message', ''), '<[^>]*>', '', 'g'))), 5000),
           'removed', coalesce(m -> 'is_removed' = 'true'::jsonb, false),
           'kind', m ->> 'type',
           'attachments', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'type', a ->> 'type',
                      'url', coalesce(a #>> '{video_data,url}', a ->> 'url'),
                      'preview', a ->> 'url',
                      'title', left(a ->> 'title', 300),
                      'link', a ->> 'link',
                      'text', left(a ->> 'message', 1000),
                      'mime', a ->> 'mime_type',
                      -- Thẻ quảng cáo (type ad_click): ảnh + nội dung bài quảng cáo.
                      'ad_image', case when jsonb_typeof(a -> 'post_attachments') = 'array'
                                       then a #>> '{post_attachments,0,url}' end,
                      'ad_text', case when jsonb_typeof(a -> 'post_attachments') = 'array'
                                      then left(a #>> '{post_attachments,0,description}', 3000) end)), '[]'::jsonb)
             from jsonb_array_elements(case when jsonb_typeof(m -> 'attachments') = 'array'
                                            then m -> 'attachments' else '[]'::jsonb end) a
             where jsonb_typeof(a) = 'object'))
         order by x.ord), '[]'::jsonb)
  into v_msgs
  from jsonb_array_elements(v_json -> 'messages') with ordinality as x(m, ord)
  where jsonb_typeof(x.m) = 'object';

  -- Dấu "đã xem" của khách (không phải của page). Mốc tính bằng giây (đôi khi mili giây).
  if jsonb_typeof(v_json -> 'read_watermarks') = 'array' then
    select w into v_seen
    from jsonb_array_elements(v_json -> 'read_watermarks') w
    where jsonb_typeof(w) = 'object'
      and coalesce(w ->> 'psid', '') <> v_req.pancake_page_id
      and (w ->> 'psid' = v_json #>> '{conv_from,id}' or v_json #>> '{conv_from,id}' is null)
      and (w ->> 'watermark') ~ '^[0-9]{9,14}$'
    order by (w ->> 'watermark')::numeric desc
    limit 1;
  end if;
  if v_seen is not null then
    v_mark := (v_seen ->> 'watermark')::numeric;
    if v_mark > 100000000000 then
      v_mark := v_mark / 1000;
    end if;
  end if;

  return jsonb_build_object(
    'state', 'ok',
    'pancake_page_id', v_req.pancake_page_id,
    'conversation_id', v_req.conversation_id,
    'customer', v_json #>> '{conv_from,name}',
    'count', jsonb_array_length(v_json -> 'messages'),
    'customer_seen_at', case when v_mark is not null then to_timestamp(v_mark) end,
    'customer_seen_message_id', v_seen ->> 'message_id',
    'messages', v_msgs);
end;
$$;
revoke all on function public.pancake_chat_read(bigint) from public, anon;
grant execute on function public.pancake_chat_read(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 2. THÔNG BÁO
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('pancake_down', 'pancake_up')),
  audience   text not null default 'manager' check (audience in ('manager')),   -- ai thấy: Admin, COO, Trưởng Telesale
  title      text not null,
  body       text,
  link       text check (link is null or link ~ '^/[A-Za-z0-9/_-]*$'),            -- trang trong ERP để bấm vào
  ref        text,                                                                -- vd ID page Pancake
  created_at timestamptz not null default now()
);
create index if not exists notifications_created_idx on public.notifications (created_at desc);

-- Ai đã đọc thông báo nào (mỗi người một dòng).
create table if not exists public.notification_reads (
  notification_id bigint not null references public.notifications (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (audience = 'manager' and (select private.is_manager()));
drop policy if exists notification_reads_select on public.notification_reads;
create policy notification_reads_select on public.notification_reads
  for select to authenticated using (user_id = (select auth.uid()));
-- Chỉ xem; đánh dấu đã đọc đi qua hàm bên dưới, thông báo do hệ thống tạo.
revoke all on public.notifications from anon, authenticated;
revoke all on public.notification_reads from anon, authenticated;
grant select on public.notifications to authenticated;
grant select on public.notification_reads to authenticated;

-- Đánh dấu đã đọc: p_ids = các thông báo vừa bấm; để trống = đọc hết.
create or replace function public.notifications_mark_read(p_ids bigint[] default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_n   int;
begin
  if v_uid is null or not private.is_manager() then
    return 0;
  end if;
  insert into public.notification_reads (notification_id, user_id)
  select n.id, v_uid from public.notifications n
  where n.audience = 'manager' and (p_ids is null or n.id = any (p_ids))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.notifications_mark_read(bigint[]) from public, anon;
grant execute on function public.notifications_mark_read(bigint[]) to authenticated;


-- ---------------------------------------------------------------------
-- 3. MỖI PHÚT: XEM KẾT NỐI PANCAKE → THÔNG BÁO KHI MẤT / CÓ LẠI
-- ---------------------------------------------------------------------
-- Trạng thái từng kết nối: đang mất từ lúc nào, đã báo chưa.
create table if not exists private.pancake_alert_state (
  pancake_page_id text primary key,
  down_since      timestamptz,             -- null = đang ổn
  last_problem    text,
  notified        boolean not null default false
);
revoke all on private.pancake_alert_state from public, anon, authenticated;

create or replace function private.pancake_watch()
returns int language plpgsql security definer set search_path = '' as $$
declare
  r         record;
  s         private.pancake_alert_state%rowtype;
  v_problem text;
  v_name    text;
  v_n       int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('private.pancake_watch')) then
    return 0;
  end if;
  for r in
    select p.*, pg.name as page_name
    from public.pancake_pages p left join public.pages pg on pg.id = p.page_id
  loop
    v_name := coalesce(r.page_name, r.pancake_page_id);
    v_problem := null;
    if r.is_active then
      if r.last_error is not null then
        v_problem := r.last_error;
      elsif r.last_ok_at is null and r.created_at < now() - interval '5 minutes' then
        v_problem := 'Chưa hỏi được Pancake lần nào kể từ lúc kết nối';
      elsif r.last_ok_at < now() - interval '5 minutes' then
        v_problem := 'Không hỏi được Pancake từ ' || to_char(r.last_ok_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')
                     || ' — lịch chạy tự động có thể đang dừng';
      end if;
    end if;

    insert into private.pancake_alert_state (pancake_page_id) values (r.pancake_page_id) on conflict do nothing;
    select * into s from private.pancake_alert_state a where a.pancake_page_id = r.pancake_page_id for update;

    if v_problem is not null then
      if s.down_since is null then
        update private.pancake_alert_state
        set down_since = now(), last_problem = left(v_problem, 300), notified = false
        where pancake_page_id = r.pancake_page_id;
      else
        update private.pancake_alert_state set last_problem = left(v_problem, 300) where pancake_page_id = r.pancake_page_id;
        -- Chỉ báo khi lỗi kéo dài từ 3 phút (lỗi thoáng qua một lượt thì lượt sau tự hết, không làm phiền).
        if not s.notified and s.down_since <= now() - interval '3 minutes' then
          insert into public.notifications (kind, title, body, link, ref)
          values ('pancake_down', 'Mất kết nối Pancake: ' || v_name,
                  left(v_problem, 300) || '. Số điện thoại mới của page này đang KHÔNG tự về bảng Lead.',
                  '/telesale/cai-dat', r.pancake_page_id);
          update private.pancake_alert_state set notified = true where pancake_page_id = r.pancake_page_id;
          v_n := v_n + 1;
        end if;
      end if;
    elsif s.down_since is not null then
      -- Có lại kết nối (tạm dừng thì không tính là "kết nối lại").
      if s.notified and r.is_active then
        insert into public.notifications (kind, title, body, link, ref)
        values ('pancake_up', 'Đã kết nối lại Pancake: ' || v_name,
                'Số mới lại tự về bảng Lead. Mất kết nối từ '
                || to_char(s.down_since at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || ' đến '
                || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || '.',
                '/telesale/cai-dat', r.pancake_page_id);
        v_n := v_n + 1;
      end if;
      update private.pancake_alert_state set down_since = null, last_problem = null, notified = false
      where pancake_page_id = r.pancake_page_id;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.pancake_watch() from public, anon, authenticated;

-- Lịch chạy mỗi phút (chạy lại file này không đặt trùng).
select cron.schedule('smh-pancake-watch', '* * * * *', 'select private.pancake_watch()');
