-- =====================================================================
-- 025 — TRẢ LỜI KHÁCH NGAY TRONG KHUNG CHAT PANCAKE (cửa sổ chi tiết lead)
--
-- Ô "Trả lời từ <tên page>" dưới khung chat: gõ → Enter → tin đi qua Pancake tới khách (Messenger / bình luận).
-- Token của page vẫn nằm kín trong private.pancake_tokens; trình duyệt không bao giờ thấy:
--   1. pancake_chat_send(lead, chữ, [mã bình luận]): kiểm tra người gửi được xem số này, rồi nhờ pg_net gọi
--      POST /pages/{page}/conversations/{conv}/messages (chạy nền) → trả mã lượt gửi.
--   2. pancake_chat_send_result(mã): Pancake đã nhận chưa, lỗi gì.
-- Mỗi tin gửi đi được ghi lại (ai gửi, lúc nào, nội dung, kết quả) trong private.pancake_chat_sends.
--
-- Cũng cập nhật pancake_chat_read (file 024) để trả kèm ảnh + nội dung thẻ quảng cáo khách bấm vào.
--
-- Không đổi / xoá dữ liệu cũ: chỉ thêm 1 bảng (riêng tư) và thay nội dung vài hàm. Chạy lại nhiều lần không sao.
-- Cần chạy sau 024.
-- =====================================================================

-- Nhật ký tin gửi từ ERP. outcome null = đang chờ Pancake trả lời.
create table if not exists private.pancake_chat_sends (
  request_id         bigint primary key,
  lead_id            uuid not null,
  pancake_page_id    text not null,
  conversation_id    text not null,
  action             text not null check (action in ('reply_inbox', 'reply_comment')),
  reply_to           text,
  message            text not null,
  sent_by            uuid not null,
  created_at         timestamptz not null default now(),
  outcome            text check (outcome in ('sent', 'failed')),
  pancake_message_id text,
  error              text,
  finished_at        timestamptz
);
create index if not exists pancake_chat_sends_by_idx on private.pancake_chat_sends (sent_by, created_at desc);
create index if not exists pancake_chat_sends_conv_idx on private.pancake_chat_sends (conversation_id, created_at desc);
revoke all on private.pancake_chat_sends from public, anon, authenticated;


-- Người đang đăng nhập có được xem / trả lời số này không, và cuộc chat nằm ở page nào.
-- state: 'ok' (kèm page, hội thoại, token) | 'no_link' | 'not_connected'. Không được xem → báo lỗi.
create or replace function private.pancake_chat_access(
  p_lead_id uuid,
  out o_state text, out o_page text, out o_conv text, out o_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_lead   public.leads%rowtype;
  v_target text[];
begin
  -- Ai xem được số nào: đúng như bảng Lead (Telesale chỉ số mình quản lý; quản lý, trực page thấy tất cả).
  select * into v_lead from public.leads l where l.id = p_lead_id and l.deleted_at is null;
  if not found or v_uid is null or not private.is_staff()
     or not (private.sees_all_leads() or (private.staff_role() = 'sale' and v_lead.assignee_id = v_uid)) then
    raise exception 'Bạn không xem được số này' using errcode = '42501';
  end if;

  v_target := private.pancake_chat_target(v_lead.pancake_url);
  if v_target is null then
    o_state := 'no_link';
    return;
  end if;
  o_page := v_target[1];
  o_conv := v_target[2];
  select t.token into o_token from private.pancake_tokens t where t.pancake_page_id = o_page;
  -- Link có tên page thay vì ID (vd pancake.vn/bacsidoankimhoa): ID page là phần đầu mã hội thoại.
  if o_token is null and position('_' in o_conv) > 0 then
    o_page := split_part(o_conv, '_', 1);
    select t.token into o_token from private.pancake_tokens t where t.pancake_page_id = o_page;
  end if;
  o_state := case when o_token is null then 'not_connected' else 'ok' end;
end;
$$;
revoke all on function private.pancake_chat_access(uuid) from public, anon, authenticated;


-- Xem cuộc chat (file 024), nay dùng chung phần kiểm tra quyền ở trên.
create or replace function public.pancake_chat_open(p_lead_id uuid, p_current_count int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_access record;
  v_params jsonb;
  v_id     bigint;
begin
  select * into v_access from private.pancake_chat_access(p_lead_id);
  if v_access.o_state <> 'ok' then
    return jsonb_build_object('state', v_access.o_state);
  end if;

  -- Chống bấm liên tục (Pancake chỉ cho mỗi page 5 lượt hỏi / giây).
  if (select count(*) from private.pancake_chat_requests q
      where q.requested_by = v_uid and q.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Tải cuộc chat quá nhanh — đợi một chút rồi bấm Tải lại';
  end if;
  delete from private.pancake_chat_requests where created_at < now() - interval '10 minutes';

  v_params := jsonb_build_object('page_access_token', v_access.o_token);
  if coalesce(p_current_count, 0) > 0 then
    v_params := v_params || jsonb_build_object('current_count', p_current_count::text);
  end if;
  v_id := net.http_get(
    url := 'https://pages.fm/api/public_api/v1/pages/' || v_access.o_page || '/conversations/' || v_access.o_conv || '/messages',
    params := v_params,
    timeout_milliseconds := 15000);
  insert into private.pancake_chat_requests (request_id, lead_id, pancake_page_id, conversation_id, requested_by)
  values (v_id, p_lead_id, v_access.o_page, v_access.o_conv, v_uid);
  return jsonb_build_object('state', 'pending', 'request_id', v_id);
end;
$$;
revoke all on function public.pancake_chat_open(uuid, int) from public, anon;
grant execute on function public.pancake_chat_open(uuid, int) to authenticated;


-- Đọc cuộc chat (file 024) + thẻ quảng cáo: ảnh và nội dung bài quảng cáo khách bấm "Gửi tin nhắn".
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

  return jsonb_build_object(
    'state', 'ok',
    'pancake_page_id', v_req.pancake_page_id,
    'conversation_id', v_req.conversation_id,
    'customer', v_json #>> '{conv_from,name}',
    'count', jsonb_array_length(v_json -> 'messages'),
    'messages', v_msgs);
end;
$$;
revoke all on function public.pancake_chat_read(bigint) from public, anon;
grant execute on function public.pancake_chat_read(bigint) to authenticated;


-- 1. Gửi tin trả lời. p_reply_to: mã bình luận của khách (cuộc chat là bình luận) — để trống = nhắn Messenger.
create or replace function public.pancake_chat_send(p_lead_id uuid, p_message text, p_reply_to text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_access  record;
  v_text    text := btrim(coalesce(p_message, ''), E' \t\r\n');
  v_reply   text := nullif(btrim(coalesce(p_reply_to, '')), '');
  v_action  text;
  v_body    jsonb;
  v_id      bigint;
begin
  select * into v_access from private.pancake_chat_access(p_lead_id);
  if v_access.o_state = 'no_link' then
    raise exception 'Số này không có cuộc chat Pancake để trả lời';
  elsif v_access.o_state <> 'ok' then
    raise exception 'Page của cuộc chat này chưa kết nối Pancake — quản lý vào Telesale → Cài đặt';
  end if;
  if v_text = '' then
    raise exception 'Chưa nhập tin nhắn';
  end if;
  if char_length(v_text) > 2000 then
    raise exception 'Tin nhắn dài quá (tối đa 2.000 ký tự) — chia thành nhiều tin';
  end if;
  if v_reply is not null and v_reply !~ '^[A-Za-z0-9_.-]{3,200}$' then
    raise exception 'Mã bình luận không hợp lệ';
  end if;

  -- Chống bấm gửi hai lần / gửi dồn dập.
  if exists (select 1 from private.pancake_chat_sends s
             where s.sent_by = v_uid and s.conversation_id = v_access.o_conv and s.message = v_text
               and s.created_at > now() - interval '15 seconds' and s.outcome is distinct from 'failed') then
    raise exception 'Tin này vừa gửi rồi';
  end if;
  if (select count(*) from private.pancake_chat_sends s
      where s.sent_by = v_uid and s.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Gửi quá nhanh — đợi một chút rồi gửi tiếp';
  end if;

  v_action := case when v_reply is null then 'reply_inbox' else 'reply_comment' end;
  v_body := jsonb_build_object('action', v_action, 'message', v_text);
  if v_reply is not null then
    v_body := v_body || jsonb_build_object('message_id', v_reply);
  end if;
  v_id := net.http_post(
    url := 'https://pages.fm/api/public_api/v1/pages/' || v_access.o_page || '/conversations/' || v_access.o_conv || '/messages',
    body := v_body,
    params := jsonb_build_object('page_access_token', v_access.o_token),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000);
  insert into private.pancake_chat_sends (request_id, lead_id, pancake_page_id, conversation_id, action, reply_to, message, sent_by)
  values (v_id, p_lead_id, v_access.o_page, v_access.o_conv, v_action, v_reply, v_text, v_uid);
  return jsonb_build_object('state', 'pending', 'request_id', v_id);
end;
$$;
revoke all on function public.pancake_chat_send(uuid, text, text) from public, anon;
grant execute on function public.pancake_chat_send(uuid, text, text) to authenticated;


-- 2. Kết quả lượt gửi: pending | sent | error (kèm lời báo).
create or replace function public.pancake_chat_send_result(p_request_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_send   private.pancake_chat_sends%rowtype;
  v_found  boolean;
  v_status int;
  v_body   text;
  v_timed  boolean;
  v_json   jsonb;
  v_err    text;
begin
  select * into v_send from private.pancake_chat_sends s
  where s.request_id = p_request_id and s.sent_by = (select auth.uid());
  if not found then
    raise exception 'Không tìm thấy lượt gửi này';
  end if;
  if v_send.outcome = 'sent' then
    return jsonb_build_object('state', 'sent', 'id', v_send.pancake_message_id);
  elsif v_send.outcome = 'failed' then
    return jsonb_build_object('state', 'error', 'message', v_send.error);
  end if;

  select true, h.status_code, h.content, h.timed_out into v_found, v_status, v_body, v_timed
  from net._http_response h where h.id = p_request_id;
  if v_found is null then
    if v_send.created_at < now() - interval '45 seconds' then
      v_err := 'Pancake không trả lời kịp — tin có thể chưa tới khách, bấm tải lại khung chat để xem trước khi gửi lại';
    else
      return jsonb_build_object('state', 'pending');
    end if;
  elsif v_status is null then
    v_err := case when v_timed then 'Pancake không trả lời kịp — tin có thể chưa tới khách, bấm tải lại khung chat để xem trước khi gửi lại'
                  else 'Không gọi được Pancake — tin chưa gửi' end;
  elsif v_status in (401, 403) then
    v_err := 'Page Access Token của page này sai hoặc đã bị đổi — quản lý vào Telesale → Cài đặt để kết nối lại';
  elsif v_status = 429 then
    v_err := 'Pancake báo gửi quá nhanh — đợi vài giây rồi gửi lại';
  else
    begin
      v_json := v_body::jsonb;
    exception when others then
      v_json := null;
    end;
    if v_status = 200 and coalesce(v_json ->> 'success', '') = 'true' then
      update private.pancake_chat_sends
      set outcome = 'sent', pancake_message_id = left(v_json ->> 'id', 200), finished_at = now()
      where request_id = p_request_id;
      return jsonb_build_object('state', 'sent', 'id', v_json ->> 'id');
    end if;
    v_err := 'Pancake không gửi được: ' || left(coalesce(
               nullif(v_json ->> 'message', ''), nullif(v_json ->> 'message_code', ''),
               nullif(v_json ->> 'error_message', ''), nullif(v_json ->> 'error', ''),
               'lỗi ' || v_status), 300);
  end if;

  update private.pancake_chat_sends
  set outcome = 'failed', error = v_err, finished_at = now()
  where request_id = p_request_id;
  return jsonb_build_object('state', 'error', 'message', v_err);
end;
$$;
revoke all on function public.pancake_chat_send_result(bigint) from public, anon;
grant execute on function public.pancake_chat_send_result(bigint) to authenticated;
