-- =====================================================================
-- 024 — XEM CUỘC CHAT PANCAKE NGAY TRONG CỬA SỔ CHI TIẾT LEAD
--
-- Bấm một số trong bảng Lead → bên phải cửa sổ chi tiết hiện cuộc chat Pancake của khách đó, không cần mở
-- tab Pancake.
--
-- Token của page vẫn nằm kín trong private.pancake_tokens (file 023), trình duyệt không bao giờ thấy:
--   1. pancake_chat_open(lead): kiểm tra người bấm được xem số này, rồi nhờ pg_net hỏi Pancake
--      GET /pages/{page}/conversations/{conv}/messages (chạy nền) → trả mã lượt hỏi.
--   2. pancake_chat_read(mã): khi Pancake trả lời xong, chỉ trả nội dung tin nhắn (người gửi, giờ, chữ, ảnh).
--
-- Không đổi / xoá dữ liệu cũ: chỉ thêm 1 bảng chờ (riêng tư) và vài hàm. Chạy lại nhiều lần không sao.
-- Cần chạy sau 023.
-- =====================================================================

-- Lượt hỏi tin nhắn đang chờ Pancake trả lời. Chỉ người bấm mới đọc được câu trả lời của lượt mình.
create table if not exists private.pancake_chat_requests (
  request_id      bigint primary key,
  lead_id         uuid not null,
  pancake_page_id text not null,
  conversation_id text not null,
  requested_by    uuid not null,
  created_at      timestamptz not null default now()
);
create index if not exists pancake_chat_requests_by_idx on private.pancake_chat_requests (requested_by, created_at desc);
revoke all on private.pancake_chat_requests from public, anon, authenticated;


-- Link hội thoại "https://pancake.vn/<page>?c_id=<hội thoại>" → {page, hội thoại}. Không đúng dạng → null.
create or replace function private.pancake_chat_target(p_url text)
returns text[] language sql immutable set search_path = '' as $$
  select regexp_match(coalesce(p_url, ''),
    '(?:pancake\.vn|pages\.fm)/([A-Za-z0-9_.-]{3,80})/?\?(?:[^#]*&)?c_id=([A-Za-z0-9_.-]{3,200})');
$$;
revoke all on function private.pancake_chat_target(text) from public;


-- 1. Bắt đầu tải cuộc chat của một lead. p_current_count: đã có bao nhiêu tin → lấy 30 tin cũ hơn.
create or replace function public.pancake_chat_open(p_lead_id uuid, p_current_count int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_lead   public.leads%rowtype;
  v_target text[];
  v_page   text;
  v_conv   text;
  v_token  text;
  v_params jsonb;
  v_id     bigint;
begin
  -- Ai xem được số nào: đúng như bảng Lead (Telesale chỉ số mình quản lý; quản lý, trực page thấy tất cả).
  select * into v_lead from public.leads l where l.id = p_lead_id and l.deleted_at is null;
  if not found or v_uid is null or not private.is_staff()
     or not (private.sees_all_leads() or (private.staff_role() = 'sale' and v_lead.assignee_id = v_uid)) then
    raise exception 'Bạn không xem được số này' using errcode = '42501';
  end if;

  v_target := private.pancake_chat_target(v_lead.pancake_url);
  if v_target is null then
    return jsonb_build_object('state', 'no_link');
  end if;
  v_page := v_target[1];
  v_conv := v_target[2];
  select t.token into v_token from private.pancake_tokens t where t.pancake_page_id = v_page;
  -- Link có tên page thay vì ID (vd pancake.vn/bacsidoankimhoa): ID page là phần đầu mã hội thoại.
  if v_token is null and position('_' in v_conv) > 0 then
    v_page := split_part(v_conv, '_', 1);
    select t.token into v_token from private.pancake_tokens t where t.pancake_page_id = v_page;
  end if;
  if v_token is null then
    return jsonb_build_object('state', 'not_connected');
  end if;

  -- Chống bấm liên tục (Pancake chỉ cho mỗi page 5 lượt hỏi / giây).
  if (select count(*) from private.pancake_chat_requests q
      where q.requested_by = v_uid and q.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Tải cuộc chat quá nhanh — đợi một chút rồi bấm Tải lại';
  end if;
  delete from private.pancake_chat_requests where created_at < now() - interval '10 minutes';

  v_params := jsonb_build_object('page_access_token', v_token);
  if coalesce(p_current_count, 0) > 0 then
    v_params := v_params || jsonb_build_object('current_count', p_current_count::text);
  end if;
  v_id := net.http_get(
    url := 'https://pages.fm/api/public_api/v1/pages/' || v_page || '/conversations/' || v_conv || '/messages',
    params := v_params,
    timeout_milliseconds := 15000);
  insert into private.pancake_chat_requests (request_id, lead_id, pancake_page_id, conversation_id, requested_by)
  values (v_id, p_lead_id, v_page, v_conv, v_uid);
  return jsonb_build_object('state', 'pending', 'request_id', v_id);
end;
$$;
revoke all on function public.pancake_chat_open(uuid, int) from public, anon;
grant execute on function public.pancake_chat_open(uuid, int) to authenticated;


-- 2. Đọc câu trả lời. Chưa về → {state: pending}; về rồi → chỉ phần tin nhắn (không có token, không có
--    hồ sơ / đơn hàng của khách mà Pancake trả kèm).
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
                      'mime', a ->> 'mime_type')), '[]'::jsonb)
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
