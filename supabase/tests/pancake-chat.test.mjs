// Kiểm thử supabase/024_pancake_chat.sql (xem cuộc chat Pancake trong cửa sổ chi tiết lead) trên Postgres chạy
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

finish();
