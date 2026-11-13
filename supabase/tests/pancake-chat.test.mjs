// Kiểm thử supabase/024_pancake_chat.sql (xem cuộc chat Pancake trong cửa sổ chi tiết lead) và
// supabase/025_pancake_reply.sql (trả lời khách ngay trong khung chat), supabase/026_pancake_seen_alerts.sql
// (khách đã xem, thông báo mất kết nối) trên Postgres chạy
// trong bộ nhớ. Không gọi Pancake thật: pg_net được thay bằng bản giả, "Pancake" trả lời bằng dữ liệu dựng sẵn
// theo mẫu của tài liệu developer.pancake.biz (GET /pages/{id}/conversations/{conv}/messages).
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "tl", "sale1", "sale2", "page1", "ads1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 023, rồi 024");
await db.exec(`
  create schema realtime;
  create table realtime.messages (id bigserial primary key, topic text, extension text);
  create function realtime.topic() returns text language sql stable as $$ select null::text $$;
  create schema net;
  create sequence net.request_seq;
  create table net.http_request_queue (id bigint primary key, url text, params jsonb, timeout_milliseconds int);
  create table net._http_response (id bigint primary key, status_code int, content_type text, headers jsonb,
    content text, timed_out boolean, error_msg text, created timestamptz not null default now());
  create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}',
                               timeout_milliseconds int default 5000)
  returns bigint language sql as $$
    insert into net.http_request_queue values (nextval('net.request_seq'), url, params, timeout_milliseconds) returning id
  $$;
  alter table net.http_request_queue add column method text not null default 'GET', add column body jsonb, add column headers jsonb;
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                                headers jsonb default '{"Content-Type": "application/json"}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$
    insert into net.http_request_queue (id, url, params, timeout_milliseconds, method, body, headers)
    values (nextval('net.request_seq'), url, params, timeout_milliseconds, 'POST', body, headers) returning id
  $$;
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
  create table cron.job_run_details (end_time timestamptz);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
    returning jobid
  $$;
`);
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "008_staff_accounts.sql",
  "010_ads_daily_data.sql", "011_sync_ads_staff_name.sql", "012_ad_targets.sql", "013_revenue_avatars.sql",
  "014_monthly_targets.sql", "015_telesale_positions.sql", "016_lead_ads_runs_ads.sql", "017_week_carry.sql",
  "018_daily_revenue.sql", "019_online_presence.sql", "020_telesale_crm.sql", "021_accounting_positions.sql",
  "023_pancake_sync.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  update public.staff set role = 'super_admin' where user_id = '${U.owner}';
  insert into public.staff (user_id, full_name, role) values
    ('${U.tl}', 'Trưởng Tele', 'lead'),
    ('${U.sale1}', 'Sale Một', 'sale'),
    ('${U.sale2}', 'Sale Hai', 'sale'),
    ('${U.page1}', 'Trực Page', 'page'),
    ('${U.ads1}', 'Dương Ads', 'ads_staff');
`);
const fb = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const pageId = (await one(`insert into public.pages (name, channel_id, branch) values ('Smile Hub', $1, 'HN') returning id`, [fb])).id;
const TOKEN = "pk_test_token_abcdefghijklmnopqrstuvwxyz_9F3Q";
await as(U.tl, `select public.pancake_save_page(null, '111222333', $1, $2)`, [pageId, TOKEN]);

const addLead = async (phone, url, assignee) =>
  (await as(U.tl, `select public.add_lead($1, 'Khách ' || $1, $2, null, null, null, null, $3, $4) r`, [phone, fb, url, assignee]))[0].r.lead_id;
const leadA = await addLead("0911000001", "https://pancake.vn/111222333?c_id=111222333_555", U.sale1);
const leadName = await addLead("0911000002", "https://pancake.vn/smilehubhn?c_id=111222333_777", U.sale1);   // link có tên page
const leadNoLink = await addLead("0911000003", null, U.sale1);
const leadOther = await addLead("0911000004", "https://pancake.vn/999888777?c_id=999888777_1", U.sale1);    // page chưa kết nối
const leadSale2 = await addLead("0911000005", "https://pancake.vn/111222333?c_id=111222333_888", U.sale2);

const before = JSON.stringify(await all(`select * from public.leads order by id`));
await db.exec(read("024_pancake_chat.sql"));
ok(true, "024 chạy không lỗi");
await db.exec(read("024_pancake_chat.sql"));
ok(true, "chạy lại 024 lần hai không lỗi");
ok(JSON.stringify(await all(`select * from public.leads order by id`)) === before, "dữ liệu lead giữ nguyên");

// ---------------------------------------------------------------------------
section("Mở cuộc chat: ai được xem");
const queued = () => all(`select id, url, params from net.http_request_queue order by id`);
let r = (await as(U.sale1, `select public.pancake_chat_open($1) r`, [leadA]))[0].r;
let q = await queued();
ok(r.state === "pending" && r.request_id === Number(q.at(-1).id), "Telesale quản lý số → gửi lượt hỏi Pancake", r);
ok(q.at(-1).url === "https://pages.fm/api/public_api/v1/pages/111222333/conversations/111222333_555/messages"
  && q.at(-1).params.page_access_token === TOKEN && !("current_count" in q.at(-1).params),
  "đúng địa chỉ API tin nhắn, kèm token của page", q.at(-1));
ok(!JSON.stringify(r).includes(TOKEN), "trình duyệt không nhận token");
let e = await errOf(U.sale2, `select public.pancake_chat_open($1)`, [leadA]);
ok(/không xem được số này/.test(e ?? ""), "Telesale khác không mở được chat của số người khác", e);
e = await errOf(U.ads1, `select public.pancake_chat_open($1)`, [leadA]);
ok(/không xem được số này/.test(e ?? ""), "nhân viên Ads không mở được", e);
r = (await as(U.page1, `select public.pancake_chat_open($1) r`, [leadSale2]))[0].r;
ok(r.state === "pending", "trực page mở được mọi số", r);
r = (await as(U.tl, `select public.pancake_chat_open($1, 30) r`, [leadA]))[0].r;
ok(r.state === "pending" && (await queued()).at(-1).params.current_count === "30", "\"Xem tin cũ hơn\" → gửi current_count", (await queued()).at(-1).params);

section("Số không có cuộc chat / page chưa kết nối");
r = (await as(U.sale1, `select public.pancake_chat_open($1) r`, [leadNoLink]))[0].r;
ok(r.state === "no_link", "số nhập tay không có link Pancake", r);
r = (await as(U.sale1, `select public.pancake_chat_open($1) r`, [leadOther]))[0].r;
ok(r.state === "not_connected", "page chưa kết nối Pancake", r);
r = (await as(U.sale1, `select public.pancake_chat_open($1) r`, [leadName]))[0].r;
ok(r.state === "pending" && (await queued()).at(-1).url.includes("/pages/111222333/conversations/111222333_777/"),
  "link có tên page → lấy ID page từ mã hội thoại", (await queued()).at(-1).url);
const target = async (url) => (await one(`select private.pancake_chat_target($1) t`, [url])).t;
ok(JSON.stringify(await target("https://pancake.vn/111222333?foo=1&c_id=111222333_9")) === JSON.stringify(["111222333", "111222333_9"])
  && (await target("https://www.facebook.com/abc")) === null && (await target("https://pancake.vn/111222333?c_id=abc';drop")) !== null,
  "đọc link hội thoại; ký tự lạ bị cắt khỏi mã hội thoại");
ok(!(await target("https://pancake.vn/111222333?c_id=abc';drop"))[1].includes("'"), "mã hội thoại chỉ gồm chữ / số / _ . -");

// ---------------------------------------------------------------------------
section("Đọc câu trả lời");
const open = async (uid, lead) => (await as(uid, `select public.pancake_chat_open($1) r`, [lead]))[0].r.request_id;
const read1 = async (uid, id) => (await as(uid, `select public.pancake_chat_read($1) r`, [id]))[0].r;
const answer = (id, status, body) => db.query(`insert into net._http_response (id, status_code, content, timed_out) values ($1, $2, $3, false)`,
  [id, status, typeof body === "string" ? body : JSON.stringify(body)]);

let id = await open(U.sale1, leadA);
r = await read1(U.sale1, id);
ok(r.state === "pending", "chưa có trả lời → đang chờ", r);
e = await errOf(U.sale2, `select public.pancake_chat_read($1)`, [id]);
ok(/hết hạn/.test(e ?? ""), "người khác không đọc được lượt của mình", e);
await answer(id, 200, {
  success: true, conversation_id: "111222333_555",
  conv_from: { id: "psid555", name: "Văn Nguyễn" },
  customers: [{ id: "c1", name: "Văn Nguyễn", phone_numbers: ["0911000001"], recent_orders: [{ id: 1 }] }],
  messages: [
    { id: "m3", type: "INBOX", inserted_at: "2026-11-13T08:05:00.000000", from: { id: "111222333", name: "Smile Hub", admin_id: "a1", admin_name: "Lan Trực Page" },
      message: "<div>Dạ em gọi lại cho anh nhé</div>", original_message: "Dạ em gọi lại cho anh nhé", attachments: [] },
    { id: "m2", type: "INBOX", inserted_at: "2026-11-13T08:04:00", from: { id: "psid555", name: "Văn Nguyễn" },
      message: "<div></div>", attachments: [{ type: "photo", url: "https://scontent.example/a.jpg" }, "rác"] },
    { id: "m1", type: "INBOX", inserted_at: "2026-11-13T08:03:00", from: { id: "psid555", name: "Văn Nguyễn" },
      message: "Số em 0911 000 001", original_message: "Số em 0911 000 001", is_removed: true },
    "rác",
  ],
});
r = await read1(U.sale1, id);
ok(r.state === "ok" && r.customer === "Văn Nguyễn" && r.count === 4 && r.messages.length === 3, "về rồi → trả tin nhắn (bỏ phần tử hỏng)", r.state);
const [m3, m2, m1] = r.messages;
ok(m3.from_page === true && m3.sender === "Lan Trực Page" && m3.text === "Dạ em gọi lại cho anh nhé", "tin của page: tên nhân viên trả lời", m3);
ok(m2.from_page === false && m2.text === "" && m2.attachments.length === 1 && m2.attachments[0].type === "photo" && m2.attachments[0].url === "https://scontent.example/a.jpg",
  "tin của khách có ảnh", m2);
ok(m1.removed === true && m1.text === "Số em 0911 000 001" && +new Date(m1.at) === +new Date("2026-11-13T08:03:00Z"), "giờ Pancake (UTC) đọc đúng; tin đã gỡ có đánh dấu", m1);
ok(!JSON.stringify(r).includes("recent_orders") && !JSON.stringify(r).includes(TOKEN), "không trả kèm hồ sơ / đơn hàng của khách, không có token");
e = await errOf(U.sale1, `select public.pancake_chat_read($1)`, [id]);
ok(/hết hạn/.test(e ?? ""), "mỗi lượt chỉ đọc được một lần", e);

section("Pancake báo lỗi");
const cases = [
  [401, { success: false, message: "Invalid access_token" }, /Token của page này sai/],
  [404, "Not found", /không thấy cuộc chat/],
  [429, "", /hỏi quá nhanh/],
  [200, { success: false, message: "Conversation not found" }, /Pancake báo lỗi: Conversation not found/],
  [200, "<html>Bad gateway</html>", /không đọc được/],
  [200, { success: true }, /không đọc được/],
  [502, "", /Pancake báo lỗi 502/],
];
for (const [status, body, want] of cases) {
  id = await open(U.sale1, leadA);
  await answer(id, status, body);
  r = await read1(U.sale1, id);
  ok(r.state === "error" && want.test(r.message), `${status} ${typeof body === "string" ? body.slice(0, 20) : body.message ?? "không có messages"} → ${r.message}`, r);
}
id = await open(U.sale1, leadA);
await db.query(`insert into net._http_response (id, status_code, content, timed_out) values ($1, null, null, true)`, [id]);
r = await read1(U.sale1, id);
ok(r.state === "error" && /không trả lời kịp/.test(r.message), "pg_net quá giờ → báo Pancake không trả lời kịp", r);
id = await open(U.sale1, leadA);
await db.exec(`update private.pancake_chat_requests set created_at = now() - interval '1 minute' where request_id = ${id}`);
r = await read1(U.sale1, id);
ok(r.state === "error" && /không trả lời kịp/.test(r.message), "chờ quá 30 giây → báo lỗi, không chờ mãi", r);

section("Chống bấm liên tục, dọn lượt cũ, không ai đọc thẳng bảng chờ");
await db.exec(`delete from private.pancake_chat_requests`);
await db.exec(`insert into private.pancake_chat_requests (request_id, lead_id, pancake_page_id, conversation_id, requested_by)
  select -g, '${leadA}', '111222333', '111222333_555', '${U.sale1}' from generate_series(1, 30) g`);
e = await errOf(U.sale1, `select public.pancake_chat_open($1)`, [leadA]);
ok(/quá nhanh/.test(e ?? ""), "30 lượt / phút / người → chặn", e);
r = (await as(U.tl, `select public.pancake_chat_open($1) r`, [leadA]))[0].r;
ok(r.state === "pending", "người khác vẫn mở được", r);
await db.exec(`update private.pancake_chat_requests set created_at = now() - interval '11 minutes' where request_id < 0`);
await as(U.sale1, `select public.pancake_chat_open($1)`, [leadA]);
ok((await one(`select count(*)::int n from private.pancake_chat_requests where request_id < 0`)).n === 0, "lượt chờ quá 10 phút được dọn");
e = await errOf(U.owner, `select * from private.pancake_chat_requests`);
ok(/permission denied/.test(e ?? ""), "bảng chờ không đọc thẳng được (kể cả chủ)", e);
e = await errOf(U.sale1, `select private.pancake_chat_target('x')`);
ok(/permission denied/.test(e ?? ""), "hàm nội bộ không gọi thẳng được", e);
await db.exec(`update public.leads set deleted_at = now() where id = '${leadA}'`);
e = await errOf(U.tl, `select public.pancake_chat_open($1)`, [leadA]);
ok(/không xem được số này/.test(e ?? ""), "số đã vào thùng rác → không mở chat", e);

// ===========================================================================
section("025: chạy file; xem chat vẫn như cũ");
await db.exec(`update public.leads set deleted_at = null where id = '${leadA}'; delete from private.pancake_chat_requests;`);
const before025 = JSON.stringify(await all(`select * from public.leads order by id`));
await db.exec(read("025_pancake_reply.sql"));
ok(true, "025 chạy không lỗi");
await db.exec(read("025_pancake_reply.sql"));
ok(true, "chạy lại 025 lần hai không lỗi");
ok(JSON.stringify(await all(`select * from public.leads order by id`)) === before025, "dữ liệu lead giữ nguyên");
r = (await as(U.sale1, `select public.pancake_chat_open($1) r`, [leadA]))[0].r;
ok(r.state === "pending" && (await queued()).at(-1).url.endsWith("/pages/111222333/conversations/111222333_555/messages"), "mở chat vẫn chạy", r);
e = await errOf(U.sale2, `select public.pancake_chat_open($1)`, [leadA]);
ok(/không xem được số này/.test(e ?? ""), "vẫn chặn Telesale khác", e);
ok((await as(U.sale1, `select public.pancake_chat_open($1) r`, [leadNoLink]))[0].r.state === "no_link"
  && (await as(U.sale1, `select public.pancake_chat_open($1) r`, [leadOther]))[0].r.state === "not_connected"
  && (await as(U.sale1, `select public.pancake_chat_open($1) r`, [leadName]))[0].r.state === "pending", "không có link / chưa kết nối / link tên page như cũ");
id = await open(U.sale1, leadA);
await answer(id, 200, { success: true, conv_from: { name: "Văn Nguyễn" }, messages: [
  { id: "ad1", type: "INBOX", inserted_at: "2026-11-10T15:31:00", from: { id: "111222333", name: "Smile Hub" }, message: "",
    attachments: [{ type: "ad_click", url: "https://www.facebook.com/122105543367533959", ad_id: "120200000000000001",
      post_attachments: [{ type: "video_inline", url: "https://content.pancake.vn/ad.jpg", description: "🦷 TRỒNG RĂNG IMPLANT – ĐỪNG CHỈ HỎI GIÁ" }] }] },
] });
r = await read1(U.sale1, id);
const ad = r.messages?.[0]?.attachments?.[0];
ok(ad && ad.type === "ad_click" && ad.ad_image === "https://content.pancake.vn/ad.jpg" && /TRỒNG RĂNG IMPLANT/.test(ad.ad_text) && ad.url === "https://www.facebook.com/122105543367533959",
  "thẻ quảng cáo: có ảnh, nội dung bài và link bài", ad);

section("Gửi tin trả lời: ai được gửi, gửi gì");
const send = (uid, lead, text, replyTo = null) => as(uid, `select public.pancake_chat_send($1, $2, $3) r`, [lead, text, replyTo]).then((x) => x[0].r);
r = await send(U.sale1, leadA, "  Dạ em chào anh ạ \n");
q = await queued();
let post = q.at(-1);
const postRow = await one(`select method, body, headers from net.http_request_queue where id = $1`, [post.id]);
ok(r.state === "pending" && r.request_id === Number(post.id), "Telesale quản lý số gửi được → gửi lượt gửi Pancake", r);
ok(postRow.method === "POST" && post.url === "https://pages.fm/api/public_api/v1/pages/111222333/conversations/111222333_555/messages"
  && post.params.page_access_token === TOKEN && JSON.stringify(postRow.body) === JSON.stringify({ action: "reply_inbox", message: "Dạ em chào anh ạ" })
  && postRow.headers["Content-Type"] === "application/json",
  "POST đúng địa chỉ, token ở tham số, nội dung đã cắt khoảng trắng hai đầu", { url: post.url, body: postRow.body });
ok(!JSON.stringify(r).includes(TOKEN), "trình duyệt không nhận token");
const sendId = r.request_id;
e = await errOf(U.sale2, `select public.pancake_chat_send($1, 'x y z')`, [leadA]);
ok(/không xem được số này/.test(e ?? ""), "Telesale khác không trả lời được số của người khác", e);
e = await errOf(U.ads1, `select public.pancake_chat_send($1, 'x y z')`, [leadA]);
ok(/không xem được số này/.test(e ?? ""), "nhân viên Ads không gửi được", e);
ok((await send(U.page1, leadSale2, "Chào chị")).state === "pending", "trực page trả lời được mọi số");
e = await errOf(U.sale1, `select public.pancake_chat_send($1, '   ')`, [leadA]);
ok(/Chưa nhập tin nhắn/.test(e ?? ""), "tin trống → từ chối", e);
e = await errOf(U.sale1, `select public.pancake_chat_send($1, repeat('a', 2001))`, [leadA]);
ok(/dài quá/.test(e ?? ""), "quá 2.000 ký tự → từ chối", e);
e = await errOf(U.sale1, `select public.pancake_chat_send($1, 'Chào anh')`, [leadNoLink]);
ok(/không có cuộc chat Pancake/.test(e ?? ""), "số không có cuộc chat → từ chối", e);
e = await errOf(U.sale1, `select public.pancake_chat_send($1, 'Chào anh')`, [leadOther]);
ok(/chưa kết nối Pancake/.test(e ?? ""), "page chưa kết nối → từ chối", e);
e = await errOf(U.sale1, `select public.pancake_chat_send($1, 'Dạ em chào anh ạ')`, [leadA]);
ok(/vừa gửi rồi/.test(e ?? ""), "bấm gửi hai lần cùng một tin → chặn lần sau", e);
r = await send(U.sale1, leadA, "Dạ em cảm ơn ạ", "111222333_cmt_42");
let row = await one(`select body from net.http_request_queue where id = $1`, [r.request_id]);
ok(JSON.stringify(row.body) === JSON.stringify({ action: "reply_comment", message: "Dạ em cảm ơn ạ", message_id: "111222333_cmt_42" }),
  "cuộc chat là bình luận → trả lời đúng bình luận của khách", row.body);
e = await errOf(U.sale1, `select public.pancake_chat_send($1, 'abc', 'x y''z')`, [leadA]);
ok(/Mã bình luận không hợp lệ/.test(e ?? ""), "mã bình luận lạ → từ chối", e);

section("Kết quả gửi");
const result = async (uid, rid) => (await as(uid, `select public.pancake_chat_send_result($1) r`, [rid]))[0].r;
r = await result(U.sale1, sendId);
ok(r.state === "pending", "Pancake chưa trả lời → đang gửi", r);
e = await errOf(U.sale2, `select public.pancake_chat_send_result($1)`, [sendId]);
ok(/Không tìm thấy lượt gửi/.test(e ?? ""), "người khác không xem được lượt gửi của mình", e);
await answer(sendId, 200, { success: true, id: "111222333_m_9001" });
r = await result(U.sale1, sendId);
ok(r.state === "sent" && r.id === "111222333_m_9001", "Pancake nhận → đã gửi", r);
ok((await result(U.sale1, sendId)).state === "sent", "hỏi lại kết quả vẫn trả \"đã gửi\"");
let log = await one(`select * from private.pancake_chat_sends where request_id = $1`, [sendId]);
ok(log.outcome === "sent" && log.sent_by === U.sale1 && log.message === "Dạ em chào anh ạ" && log.lead_id === leadA && log.pancake_message_id === "111222333_m_9001" && log.finished_at,
  "nhật ký ghi ai gửi, gửi gì, cho số nào, kết quả", { outcome: log.outcome, by: log.sent_by === U.sale1 });

const failCases = [
  [200, { success: false, message: "(#10) This message is sent outside of allowed window." }, /Pancake không gửi được: \(#10\) This message is sent outside of allowed window/],
  [200, { success: false, message_code: "invalid_upload_fb_attachments_result" }, /invalid_upload_fb_attachments_result/],
  [401, { success: false, message: "Invalid access_token" }, /Token của page này sai/],
  [429, "", /gửi quá nhanh/],
  [500, "<html>oops</html>", /Pancake không gửi được: lỗi 500/],
];
let n = 0;
for (const [status, body, want] of failCases) {
  const rid = (await send(U.tl, leadA, `Tin thử ${++n}`)).request_id;
  await answer(rid, status, body);
  r = await result(U.tl, rid);
  log = await one(`select outcome, error from private.pancake_chat_sends where request_id = $1`, [rid]);
  ok(r.state === "error" && want.test(r.message) && log.outcome === "failed" && log.error === r.message, `${status} → ${r.message}`, r);
}
r = await send(U.tl, leadA, "Tin thử 1");
ok(r.state === "pending", "tin gửi lỗi thì gửi lại ngay được (không bị chặn \"vừa gửi\")", r);
let rid = (await send(U.tl, leadA, "Tin quá giờ")).request_id;
await db.query(`insert into net._http_response (id, status_code, content, timed_out) values ($1, null, null, true)`, [rid]);
r = await result(U.tl, rid);
ok(r.state === "error" && /tin có thể chưa tới khách/.test(r.message), "pg_net quá giờ → báo tin có thể chưa tới", r);
rid = (await send(U.tl, leadA, "Tin chờ lâu")).request_id;
await db.exec(`update private.pancake_chat_sends set created_at = now() - interval '1 minute' where request_id = ${rid}`);
r = await result(U.tl, rid);
ok(r.state === "error" && /không trả lời kịp/.test(r.message), "chờ quá 45 giây → báo lỗi, không chờ mãi", r);

section("Chống gửi dồn dập, bảo mật");
await db.exec(`insert into private.pancake_chat_sends (request_id, lead_id, pancake_page_id, conversation_id, action, message, sent_by)
  select -g, '${leadA}', '111222333', '111222333_555', 'reply_inbox', 'tin ' || g, '${U.sale1}' from generate_series(1, 20) g`);
e = await errOf(U.sale1, `select public.pancake_chat_send($1, 'Một tin nữa')`, [leadA]);
ok(/Gửi quá nhanh/.test(e ?? ""), "20 tin / phút / người → chặn", e);
e = await errOf(U.owner, `select * from private.pancake_chat_sends`);
ok(/permission denied/.test(e ?? ""), "nhật ký gửi không đọc thẳng được qua ứng dụng", e);
e = await errOf(U.sale1, `select * from private.pancake_chat_access($1)`, [leadA]);
ok(/permission denied/.test(e ?? ""), "hàm kiểm tra quyền (có token) không gọi thẳng được", e);
await db.exec(`update public.leads set deleted_at = now() where id = '${leadSale2}'`);
e = await errOf(U.page1, `select public.pancake_chat_send($1, 'Chào')`, [leadSale2]);
ok(/không xem được số này/.test(e ?? ""), "số đã vào thùng rác → không gửi", e);

// ===========================================================================
section("026: chạy file; khách đã xem");
await db.exec(`update public.leads set deleted_at = null where id = '${leadSale2}'; delete from private.pancake_chat_requests;`);
const before026 = JSON.stringify(await all(`select * from public.leads order by id`));
await db.exec(read("026_pancake_seen_alerts.sql"));
ok(true, "026 chạy không lỗi");
await db.exec(read("026_pancake_seen_alerts.sql"));
ok(true, "chạy lại 026 lần hai không lỗi");
ok(JSON.stringify(await all(`select * from public.leads order by id`)) === before026, "dữ liệu lead giữ nguyên");
const watchJobs = await all(`select jobname, schedule, command from cron.job where jobname = 'smh-pancake-watch'`);
ok(watchJobs.length === 1 && watchJobs[0].schedule === "* * * * *" && watchJobs[0].command === "select private.pancake_watch()", "lịch xem kết nối mỗi phút (không đặt trùng)", watchJobs);

const chatBody = (extra) => ({ success: true, conv_from: { id: "psid555", name: "Văn Nguyễn" }, messages: [
  { id: "m1", inserted_at: "2026-11-13T04:40:00", from: { id: "psid555", name: "Văn Nguyễn" }, original_message: "Ưu đãi?" },
  { id: "m2", inserted_at: "2026-11-13T04:42:00", from: { id: "111222333", name: "Smile Hub" }, original_message: "Dạ" },
], ...extra });
id = await open(U.sale1, leadA);
await answer(id, 200, chatBody({ read_watermarks: [
  { psid: "111222333", watermark: 1794545999, message_id: "page" },
  { psid: "psid555", watermark: 1794545077, message_id: "m2", is_group_conv: null },
] }));
r = await read1(U.sale1, id);
ok(r.state === "ok" && +new Date(r.customer_seen_at) === 1794545077000 && r.customer_seen_message_id === "m2", "mốc khách đã xem (giây) → giờ; bỏ mốc của page", { at: r.customer_seen_at, mid: r.customer_seen_message_id });
ok(r.messages.length === 2 && r.messages[1].from_page, "tin nhắn vẫn như cũ");
id = await open(U.sale1, leadA);
await answer(id, 200, chatBody({ read_watermarks: [{ psid: "psid555", watermark: 1794545077123 }] }));
r = await read1(U.sale1, id);
ok(+new Date(r.customer_seen_at) === 1794545077123, "mốc bằng mili giây cũng đọc đúng", r.customer_seen_at);
id = await open(U.sale1, leadA);
await answer(id, 200, chatBody({}));
r = await read1(U.sale1, id);
ok(r.state === "ok" && r.customer_seen_at === null, "Pancake không có dấu đã xem → để trống", r.customer_seen_at);
id = await open(U.sale1, leadA);
await answer(id, 200, chatBody({ read_watermarks: [{ psid: "psid555", watermark: "abc" }, "rác"] }));
r = await read1(U.sale1, id);
ok(r.state === "ok" && r.customer_seen_at === null, "dấu đã xem hỏng → bỏ qua, không lỗi", r.customer_seen_at);

section("Thông báo mất kết nối / kết nối lại");
const watch = async () => (await one(`select private.pancake_watch() n`)).n;
const notes = () => all(`select kind, title, body, link, ref from public.notifications order by id`);
await db.exec(`update public.pancake_pages set last_ok_at = now(), last_error = null`);
ok((await watch()) === 0 && (await notes()).length === 0, "đang chạy tốt → không có thông báo");
await db.exec(`update public.pancake_pages set last_error = 'Pancake không trả lời kịp, sẽ thử lại', last_error_at = now() where pancake_page_id = '111222333'`);
ok((await watch()) === 0, "vừa lỗi → chưa báo ngay (chờ xem có tự hết không)");
await db.exec(`update public.pancake_pages set last_error = null, last_ok_at = now() where pancake_page_id = '111222333'`);
ok((await watch()) === 0 && (await notes()).length === 0, "lỗi thoáng qua rồi tự hết → không làm phiền");
await db.exec(`update public.pancake_pages set last_error = 'Page Access Token sai hoặc đã bị đổi', last_error_at = now() where pancake_page_id = '111222333'`);
await watch();
await db.exec(`update private.pancake_alert_state set down_since = now() - interval '4 minutes' where pancake_page_id = '111222333'`);
ok((await watch()) === 1, "lỗi kéo dài 3 phút → tạo 1 thông báo");
let ns = await notes();
ok(ns.length === 1 && ns[0].kind === "pancake_down" && ns[0].title === "Mất kết nối Pancake: Smile Hub" && /Token sai/.test(ns[0].body) && /KHÔNG tự về bảng Lead/.test(ns[0].body)
  && ns[0].link === "/telesale/cai-dat" && ns[0].ref === "111222333", "thông báo ghi tên page, lý do, việc cần làm", ns[0]);
ok((await watch()) === 0 && (await notes()).length === 1, "vẫn lỗi → không báo lặp lại mỗi phút");
await db.exec(`update public.pancake_pages set last_error = null, last_ok_at = now() where pancake_page_id = '111222333'`);
ok((await watch()) === 1, "nối lại được → báo \"Đã kết nối lại\"");
ns = await notes();
ok(ns[1].kind === "pancake_up" && ns[1].title === "Đã kết nối lại Pancake: Smile Hub" && /Mất kết nối từ \d\d:\d\d/.test(ns[1].body), "thông báo kết nối lại có khoảng thời gian mất", ns[1]);
await db.exec(`update public.pancake_pages set last_ok_at = now() - interval '10 minutes' where pancake_page_id = '111222333'`);
await watch();
await db.exec(`update private.pancake_alert_state set down_since = now() - interval '4 minutes' where pancake_page_id = '111222333'`);
await watch();
ns = await notes();
ok(ns.length === 3 && /lịch chạy tự động có thể đang dừng/.test(ns[2].body), "10 phút không hỏi được Pancake (dù không có lỗi) → cũng báo", ns[2]?.body);
await as(U.tl, `select public.pancake_set_active(id, false) from public.pancake_pages where pancake_page_id = '111222333'`);
ok((await watch()) === 0 && (await notes()).length === 3, "tạm dừng kết nối → không báo \"kết nối lại\", không báo lỗi");
await as(U.tl, `select public.pancake_set_active(id, true) from public.pancake_pages where pancake_page_id = '111222333'`);

section("Ai thấy thông báo, đánh dấu đã đọc");
const seeN = async (uid) => (await as(uid, `select count(*)::int n from public.notifications`))[0].n;
ok((await seeN(U.tl)) === 3 && (await seeN(U.owner)) === 3, "Trưởng Telesale, chủ thấy thông báo");
ok((await seeN(U.sale1)) === 0 && (await seeN(U.page1)) === 0 && (await seeN(U.ads1)) === 0, "Telesale, trực page, Ads không thấy");
const firstId = (await one(`select min(id) id from public.notifications`)).id;
ok((await as(U.tl, `select public.notifications_mark_read(array[$1]::bigint[]) n`, [firstId]))[0].n === 1, "Trưởng Telesale đọc 1 thông báo");
ok((await as(U.tl, `select count(*)::int n from public.notification_reads`))[0].n === 1 && (await as(U.owner, `select count(*)::int n from public.notification_reads`))[0].n === 0,
  "đã đọc tính riêng từng người");
ok((await as(U.owner, `select public.notifications_mark_read() n`))[0].n === 3, "chủ bấm \"Đọc hết\"");
ok((await as(U.owner, `select public.notifications_mark_read() n`))[0].n === 0, "bấm lại không tạo trùng");
ok((await as(U.sale1, `select public.notifications_mark_read() n`))[0].n === 0, "telesale gọi đọc hết → không có gì");
e = await errOf(U.tl, `insert into public.notifications (kind, title) values ('pancake_down', 'giả')`);
ok(/permission denied/.test(e ?? ""), "không ai tự tạo thông báo qua ứng dụng", e);
e = await errOf(U.tl, `insert into public.notification_reads (notification_id, user_id) values (${firstId}, '${U.owner}')`);
ok(/permission denied/.test(e ?? ""), "không đánh dấu đọc hộ người khác", e);
e = await errOf(U.owner, `select private.pancake_watch()`);
ok(/permission denied/.test(e ?? ""), "hàm xem kết nối chỉ lịch chạy gọi được", e);

finish();
