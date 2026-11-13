// Kiểm thử supabase/027_ads_auto_test.sql (thử nghiệm tự kéo báo cáo Ads từ Facebook + đối chiếu với số nhân
// viên nhập tay) trên Postgres chạy trong bộ nhớ. Không gọi Facebook thật: pg_net được thay bằng bản giả,
// "Facebook" trả lời bằng dữ liệu dựng sẵn theo mẫu của tài liệu Marketing API (GET /act_{id}/insights).
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "tl", "ads1", "sale1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 026, rồi 027");
await db.exec(`
  create schema realtime;
  create table realtime.messages (id bigserial primary key, topic text, extension text);
  create function realtime.topic() returns text language sql stable as $$ select null::text $$;
  create schema net;
  create sequence net.request_seq;
  create table net.http_request_queue (id bigint primary key, url text, params jsonb, timeout_milliseconds int,
    method text not null default 'GET', body jsonb, headers jsonb);
  create table net._http_response (id bigint primary key, status_code int, content_type text, headers jsonb,
    content text, timed_out boolean, error_msg text, created timestamptz not null default now());
  create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}',
                               timeout_milliseconds int default 5000)
  returns bigint language sql as $$
    insert into net.http_request_queue (id, url, params, timeout_milliseconds, headers)
    values (nextval('net.request_seq'), url, params, timeout_milliseconds, headers) returning id
  $$;
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
  "023_pancake_sync.sql", "024_pancake_chat.sql", "025_pancake_reply.sql", "026_pancake_seen_alerts.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  update public.staff set role = 'super_admin' where user_id = '${U.owner}';
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.tl}', 'Trưởng Tele', 'lead'),
    ('${U.ads1}', 'Dương Ads', 'ads_staff'),
    ('${U.sale1}', 'Sale Một', 'sale');
`);
const duong = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads1])).id;
const D = {};
for (const row of await all(`select g, (private.today_vn() - g)::text as d from generate_series(-1, 120) g`)) D[row.g] = row.d;

const fb = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const tiktok = (await one(`select id from public.channels where name = 'TikTok'`)).id;
const addAccount = async (name, accountId, channel, active = true) =>
  (await one(`insert into public.ad_accounts (name, account_id, channel_id, is_active) values ($1, $2, $3, $4) returning id`,
    [name, accountId, channel, active])).id;
const A1 = await addAccount("Dương 01", "1111111111", fb);
const A2 = await addAccount("Dương 02", "2222222222", fb);
const ATT = await addAccount("TikTok 01", "3333333333", tiktok);
const ANOID = await addAccount("Chưa có ID", null, fb);
const AOFF = await addAccount("Ngừng dùng", "5555555555", fb, false);
const ABAD = await addAccount("ID lạ", "abc-xyz", fb);
for (const acc of [A1, A2, ATT, ANOID, AOFF, ABAD]) {
  await db.query(`insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date) values ($1, $2, '2020-01-01')`, [acc, duong]);
}

// Số nhân viên nhập tay trước khi chạy 027 — phải giữ nguyên.
await as(U.ads1, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages, data_count) values
  ($1::date, $3, 500000, 10, 3), ($2::date, $3, 800000, 12, 4), ($1::date, $4, 300000, 5, 1), ($1::date, $5, 100000, 2, 0)`,
  [D[2], D[3], A1, A2, ATT]);
await as(U.ads1, `insert into public.ads_daily_data (report_date, ads_staff_id, data_count) values ($1::date, $2, 8)`, [D[2], duong]);
const manualBefore = JSON.stringify(await all(`select * from public.ad_daily_reports order by id`));
const dataBefore = JSON.stringify(await all(`select * from public.ads_daily_data order by id`));
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;

await db.exec(read("027_ads_auto_test.sql"));
ok(true, "027 chạy không lỗi");
await db.exec(read("027_ads_auto_test.sql"));
ok(true, "chạy lại 027 lần hai không lỗi");
const jobs = await all(`select jobname, schedule, command from cron.job where jobname = 'smh-ads-auto'`);
ok(jobs.length === 1 && jobs[0].schedule === "* * * * *" && jobs[0].command === "select private.ads_auto_tick()", "lịch mỗi phút (không đặt trùng)", jobs);
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "chạy 027 không sửa dữ liệu cũ (không ghi nhật ký)");

section("Tiện ích");
const digits = async (v) => (await one(`select private.fb_account_digits($1) as d`, [v])).d;
ok(await digits("act_1234567890") === "1234567890", "bỏ act_ ở đầu");
ok(await digits(" ACT_1234 5678 90 ") === "1234567890", "bỏ khoảng trắng, chữ hoa");
ok(await digits("1234.5678.90") === "1234567890", "bỏ dấu chấm");
ok(await digits("abc") === null && await digits(null) === null && await digits("123") === null, "ID lạ / trống / quá ngắn → null");
const num = async (v) => (await one(`select private.fb_number($1) as n`, [v])).n;
ok(Number(await num("152000")) === 152000 && Number(await num("12.34")) === 12.34, "đọc số chi tiêu");
ok(await num("1e5") === null && await num("-5") === null && await num(null) === null, "số lạ → null");
const act = async (arr, type) => (await one(`select private.fb_action($1::jsonb, $2) as n`, [JSON.stringify(arr), type])).n;
ok(await act([{ action_type: "x", value: "3" }, { action_type: "x", value: "2" }, { action_type: "y", value: "9" }], "x") === 5, "cộng action cùng loại");
ok(await act(null, "x") === 0 && await act({ a: 1 }, "x") === 0, "actions trống / sai dạng → 0");
const errText = async (body, status) => (await one(`select private.fb_error_text($1::jsonb, $2) as t`, [JSON.stringify(body), status])).t;
ok(/hết hạn/.test(await errText({ error: { code: 190, message: "Invalid OAuth access token" } }, 400)), "lỗi 190 → token hết hạn");
ok(/quyền/.test(await errText({ error: { code: 200, message: "Permissions error" } }, 403)), "lỗi 200 → chưa cấp quyền");
ok(/sai ID TKQC/.test(await errText({ error: { code: 100, error_subcode: 33, message: "Unsupported get request" } }, 400)), "lỗi 100/33 → sai ID");
ok(/^Facebook báo lỗi: \(#100\) bad field/.test(await errText({ error: { code: 100, message: "(#100) bad field" } }, 400)), "lỗi 100 khác → nguyên câu của Facebook");
ok(/hỏi quá nhiều/.test(await errText({ error: { code: 17 } }, 400)) && /hỏi quá nhiều/.test(await errText({ error: { code: 80004 } }, 400)), "lỗi giới hạn → sẽ thử lại");
ok(/tạm thời/.test(await errText(null, 502)), "lỗi 5xx → tạm thời");
const targets = (await all(`select ad_account_id, fb_account_id from private.ads_auto_targets() order by fb_account_id`));
ok(JSON.stringify(targets.map((t) => t.ad_account_id)) === JSON.stringify([A1, A2]),
  "chỉ kéo TKQC Facebook đang dùng có ID hợp lệ (bỏ TikTok, chưa có ID, ngừng dùng, ID lạ)", targets);

section("Quyền");
for (const who of ["tl", "ads1", "sale1"]) {
  const e = await errOf(U[who], `select public.ads_auto_status()`);
  ok(/Chỉ Quản trị và Trưởng Marketing/.test(e ?? ""), `${who} không xem được tình trạng`, e);
  ok(/Chỉ Quản trị và Trưởng Marketing/.test((await errOf(U[who], `select public.ads_auto_save_token('EAA${"x".repeat(40)}')`)) ?? ""), `${who} không dán được token`);
  ok(/Chỉ Quản trị và Trưởng Marketing/.test((await errOf(U[who], `select * from public.ads_auto_compare($1::date, $2::date)`, [D[7], D[0]])) ?? ""), `${who} không xem được đối chiếu`);
}
ok(/permission denied/.test((await errOf(U.mm, `select * from private.ads_auto_config`)) ?? ""), "không ai đọc được bảng token");
ok(/permission denied/.test((await errOf(U.mm, `select private.ads_auto_tick()`)) ?? ""), "không ai tự gọi được lịch chạy");
ok(/permission denied/.test((await errOf(U.mm, `insert into public.ads_auto_daily (report_date, ad_account_id, fb_account_id) values ($1::date, $2, '1')`, [D[1], A1])) ?? ""), "không ai tự ghi số Facebook");
ok(/permission denied/.test((await errOf(U.mm, `update public.ads_auto_accounts set last_error = 'x'`)) ?? ""), "không ai tự sửa tình trạng TKQC");

section("Chưa có token");
let st = (await as(U.mm, `select public.ads_auto_status() s`))[0].s;
ok(st.has_token === false && st.auto_enabled === true && st.pending === 0, "chưa có token, tự kéo đang bật", st);
ok(st.accounts.length === 6 && st.accounts[0].is_facebook === true && st.accounts.at(-1).is_facebook === false, "liệt kê đủ TKQC, Facebook lên trước");
ok(st.accounts.find((a) => a.ad_account_id === ABAD).fb_account_id === null, "TKQC có ID lạ → không có ID Facebook");
let e = await errOf(U.mm, `select public.ads_auto_pull($1::date, $2::date)`, [D[3], D[0]]);
ok(/Chưa có token/.test(e ?? ""), "chưa dán token thì không kéo được", e);
await db.exec(`select private.ads_auto_tick()`);
ok((await one(`select count(*)::int n from net.http_request_queue`)).n === 0, "chưa có token: lịch chạy không hỏi Facebook");

section("Dán token");
const TOKEN = "EAAG" + "aBcD1234".repeat(20) + "Zz9Q";
for (const bad of ["", "abc", "EAA short", `EAA${"x".repeat(40)} `.trim() + " y", `EBB${"x".repeat(40)}`, `EAA${"x".repeat(40)}!`]) {
  e = await errOf(U.mm, `select public.ads_auto_save_token($1)`, [bad]);
  ok(/Token không đúng dạng/.test(e ?? ""), `token sai dạng bị chặn: ${JSON.stringify(bad.slice(0, 12))}`, e);
}
let r = (await as(U.mm, `select public.ads_auto_save_token($1) r`, ["  " + TOKEN + "\n"]))[0].r;
ok(r.accounts === 2, "dán token (bỏ khoảng trắng 2 đầu) → kéo luôn 2 TKQC", r);
const reqs = await all(`select id, url, params, headers from net.http_request_queue order by id`);
ok(reqs.length === 4, "4 lượt hỏi: 2 kiểm tra TKQC + 2 kéo số", reqs.length);
const acctReq = reqs.find((q) => q.url.endsWith("act_1111111111"));
const insReq = reqs.find((q) => q.url.endsWith("act_1111111111/insights"));
const insReq2 = reqs.find((q) => q.url.endsWith("act_2222222222/insights"));
ok(acctReq && acctReq.url.startsWith("https://graph.facebook.com/v26.0/"), "hỏi đúng Graph API", acctReq?.url);
ok(acctReq?.params.fields === "name,currency,timezone_name,account_status", "kiểm tra TKQC: tên, tiền tệ, múi giờ, trạng thái");
ok(insReq && insReq.params.level === "account" && insReq.params.time_increment === "1" && insReq.params.limit === "500", "kéo số theo ngày, cấp TKQC, một trang", insReq?.params);
const range = JSON.parse(insReq.params.time_range);
ok(range.since === D[6] && range.until === D[0], "dán token → kéo 7 ngày gần nhất", range);
ok(reqs.every((q) => q.headers?.Authorization === `Bearer ${TOKEN}`), "token đi trong header Authorization");
ok(reqs.every((q) => !q.url.includes(TOKEN) && !JSON.stringify(q.params).includes(TOKEN)), "token không nằm trên địa chỉ / tham số");
st = (await as(U.mm, `select public.ads_auto_status() s`))[0].s;
ok(st.has_token === true && st.token_hint === "Zz9Q" && st.token_set_by === "Trưởng Marketing" && st.pending === 4, "tình trạng: có token, 4 ký tự cuối, ai dán", st);
ok(!JSON.stringify(st).includes(TOKEN.slice(0, 20)), "tình trạng không bao giờ chứa token");
e = await errOf(U.mm, `select public.ads_auto_pull($1::date, $2::date)`, [D[3], D[0]]);
ok(/Đang kéo số/.test(e ?? ""), "đang chờ Facebook trả lời thì không kéo chồng", e);

section("Facebook trả lời");
const answer = (id, status, body) => db.query(`insert into net._http_response (id, status_code, content, timed_out) values ($1, $2, $3, false)`,
  [id, status, body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body)]);
await answer(acctReq.id, 200, { name: "SMH Dương 01", currency: "VND", timezone_name: "Asia/Ho_Chi_Minh", account_status: 1, id: "act_1111111111" });
await answer(reqs.find((q) => q.url.endsWith("act_2222222222")).id, 400,
  { error: { message: "Unsupported get request. Object with ID 'act_2222222222' does not exist", type: "GraphMethodException", code: 100, error_subcode: 33 } });
const row = (day, spend, conv, extra = []) => ({
  date_start: day, date_stop: day, spend: String(spend), account_currency: "VND",
  actions: [
    { action_type: "onsite_conversion.messaging_conversation_started_7d", value: String(conv) },
    { action_type: "onsite_conversion.messaging_first_reply", value: String(Math.max(0, conv - 2)) },
    { action_type: "onsite_conversion.total_messaging_connection", value: String(conv + 1) },
    { action_type: "link_click", value: "40" },
    ...extra,
  ],
});
await answer(insReq.id, 200, { data: [row(D[2], 500000, 10), row(D[3], 812345, 11), row(D[1], 250000, 4), row("2000-01-01", 1, 1)], paging: { cursors: { before: "a", after: "b" } } });
r = (await as(U.mm, `select public.ads_auto_collect_now() r`))[0].r;
ok(r.answers === 3 && r.pending === 1, "đọc 3 câu trả lời đã về, còn 1 lượt chờ", r);
const days = await all(`select report_date::text d, spend, currency, conversations, new_contacts, connections from public.ads_auto_daily where ad_account_id = $1 order by report_date`, [A1]);
ok(days.length === 7, "đủ 7 ngày (ngày không có dòng = 0)", days.length);
const day = (d) => days.find((x) => x.d === d);
ok(Number(day(D[2]).spend) === 500000 && day(D[2]).conversations === 10 && day(D[2]).new_contacts === 8 && day(D[2]).connections === 11, "lưu chi tiêu + 3 loại số tin nhắn", day(D[2]));
ok(Number(day(D[4]).spend) === 0 && day(D[4]).conversations === 0 && day(D[4]).currency === "VND", "ngày Facebook không trả dòng → 0 đ, cùng tiền tệ", day(D[4]));
ok(!days.some((x) => x.d === "2000-01-01"), "dòng ngoài khoảng ngày hỏi bị bỏ qua");
let acc = await all(`select ad_account_id, fb_name, currency, timezone, fb_status, last_ok_at, last_error from public.ads_auto_accounts order by fb_account_id`);
ok(acc[0].fb_name === "SMH Dương 01" && acc[0].currency === "VND" && acc[0].timezone === "Asia/Ho_Chi_Minh" && acc[0].fb_status === 1 && acc[0].last_ok_at && !acc[0].last_error, "TKQC 1: thông tin + kéo được", acc[0]);
ok(/sai ID TKQC/.test(acc[1].last_error ?? ""), "TKQC 2: báo lỗi dễ hiểu", acc[1]);

// Lượt còn lại: trả về rác.
await answer(insReq2.id, 200, "<html>oops</html>");
await as(U.mm, `select public.ads_auto_collect_now()`);
ok(/không đọc được/.test((await one(`select last_error from public.ads_auto_accounts where ad_account_id = $1`, [A2])).last_error ?? ""), "câu trả lời không phải JSON → báo lỗi, không hỏng");
ok((await one(`select count(*)::int n from public.ads_auto_daily where ad_account_id = $1`, [A2])).n === 0, "lỗi thì không ghi số");
ok((await one(`select count(*)::int n from private.ads_auto_requests`)).n === 0, "không còn lượt chờ");

section("Kéo lại một khoảng ngày");
for (const [from, to, msg] of [[D[0], D[1], "Khoảng ngày không hợp lệ"], [D[1], D[-1], "chưa tới"], [D[100], D[0], "tối đa 93 ngày"]]) {
  e = await errOf(U.mm, `select public.ads_auto_pull($1::date, $2::date)`, [from, to]);
  ok(new RegExp(msg).test(e ?? ""), `chặn: ${msg}`, e);
}
e = await errOf(U.mm, `select public.ads_auto_pull('2020-01-01'::date, '2020-01-05'::date)`);
ok(/37 tháng/.test(e ?? ""), "chặn ngày quá cũ", e);
const beforePull = (await one(`select max(id)::int m from net.http_request_queue`)).m;
r = (await as(U.owner, `select public.ads_auto_pull($1::date, $2::date) r`, [D[30], D[0]]))[0].r;
ok(r.accounts === 2, "kéo 31 ngày cho 2 TKQC", r);
const pulled = await all(`select url, params from net.http_request_queue where id > $1 order by id`, [beforePull]);
ok(pulled.filter((q) => q.url.endsWith("/insights")).length === 2, "2 lượt kéo số");
ok(pulled.filter((q) => !q.url.endsWith("/insights")).map((q) => q.url).join() === "https://graph.facebook.com/v26.0/act_2222222222",
  "chỉ kiểm tra lại TKQC chưa kiểm tra được (TKQC 1 vừa kiểm tra xong thì thôi)", pulled.map((q) => q.url));

section("Hết giờ chờ / Facebook lỗi");
await db.exec(`update private.ads_auto_requests set created_at = now() - interval '4 minutes'`);
await as(U.mm, `select public.ads_auto_collect_now()`);
ok(/không trả lời/.test((await one(`select last_error from public.ads_auto_accounts where ad_account_id = $1`, [A1])).last_error ?? ""), "chờ quá 3 phút → báo Facebook không trả lời");
ok((await one(`select count(*)::int n from public.ads_auto_daily where ad_account_id = $1`, [A1])).n === 7, "số đã kéo trước đó giữ nguyên");

// Token hết hạn
r = (await as(U.mm, `select public.ads_auto_pull($1::date, $2::date) r`, [D[2], D[2]]))[0].r;
let last = await all(`select q.id, q.url from net.http_request_queue q where q.url like '%/insights' order by q.id desc limit 2`);
for (const q of last) await answer(q.id, 400, { error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190, error_subcode: 463 } });
await as(U.mm, `select public.ads_auto_collect_now()`);
acc = await all(`select last_error from public.ads_auto_accounts order by fb_account_id`);
ok(acc.every((a) => /hết hạn/.test(a.last_error ?? "")), "token hết hạn → báo dán token mới", acc);

section("Lịch chạy mỗi giờ");
await db.exec(`delete from private.ads_auto_requests`);
let n0 = (await one(`select count(*)::int n from net.http_request_queue`)).n;
await db.exec(`select private.ads_auto_tick()`);
ok((await one(`select count(*)::int n from net.http_request_queue`)).n === n0, "vừa kéo xong thì chưa kéo lại");
await db.exec(`update private.ads_auto_config set last_auto_at = now() - interval '61 minutes'`);
await db.exec(`select private.ads_auto_tick()`);
const auto = await all(`select url, params from net.http_request_queue order by id desc limit 10`);
const autoIns = auto.slice(0, 3).filter((q) => q.url.endsWith("/insights"));
ok(autoIns.length === 2 && autoIns.every((q) => JSON.parse(q.params.time_range).since === D[2] && JSON.parse(q.params.time_range).until === D[0]),
  "quá 1 giờ → tự kéo 3 ngày gần nhất", auto.map((q) => q.params.time_range));
ok(auto.slice(0, 3).filter((q) => !q.url.endsWith("/insights")).map((q) => q.url).join() === "https://graph.facebook.com/v26.0/act_2222222222",
  "và kiểm tra lại TKQC chưa kiểm tra được trong ngày");
n0 = (await one(`select count(*)::int n from net.http_request_queue`)).n;
await db.exec(`select private.ads_auto_tick()`);
ok((await one(`select count(*)::int n from net.http_request_queue`)).n === n0, "lượt kế tiếp không hỏi trùng");
await as(U.mm, `select public.ads_auto_set_enabled(false)`);
await db.exec(`delete from private.ads_auto_requests; update private.ads_auto_config set last_auto_at = now() - interval '2 hours'`);
n0 = (await one(`select count(*)::int n from net.http_request_queue`)).n;
await db.exec(`select private.ads_auto_tick()`);
ok((await one(`select count(*)::int n from net.http_request_queue`)).n === n0, "tắt tự kéo → lịch không hỏi");
await as(U.mm, `select public.ads_auto_set_enabled(true)`);

section("Đối chiếu với số nhập tay");
// Kéo lại số đúng cho TKQC 1 (ngày 2, 3).
await db.exec(`delete from private.ads_auto_requests`);
await as(U.mm, `select public.ads_auto_pull($1::date, $2::date)`, [D[3], D[2]]);
last = await all(`select q.request_id id, q.ad_account_id from private.ads_auto_requests q where q.kind = 'insights'`);
await answer(last.find((q) => q.ad_account_id === A1).id, 200, { data: [row(D[2], 500000, 10), row(D[3], 812345, 11)] });
await answer(last.find((q) => q.ad_account_id === A2).id, 200, { data: [row(D[2], 300000, 7)] });
await as(U.mm, `select public.ads_auto_collect_now()`);
const cmp = await as(U.mm, `select report_date::text d, ad_account_id a, ads_staff_id s, manual_spend, manual_messages, auto_spend, auto_currency, auto_conversations, auto_new_contacts, auto_connections from public.ads_auto_compare($1::date, $2::date)`, [D[3], D[2]]);
const c = (d, a) => cmp.find((x) => x.d === d && x.a === a);
ok(c(D[2], A1) && Number(c(D[2], A1).manual_spend) === 500000 && Number(c(D[2], A1).auto_spend) === 500000 && c(D[2], A1).manual_messages === 10 && c(D[2], A1).auto_conversations === 10, "ngày khớp: hai bên cùng số", c(D[2], A1));
ok(Number(c(D[3], A1).manual_spend) === 800000 && Number(c(D[3], A1).auto_spend) === 812345, "ngày lệch: thấy cả hai số", c(D[3], A1));
ok(c(D[2], A2).manual_messages === 5 && c(D[2], A2).auto_conversations === 7, "TKQC 2 lệch tin nhắn");
ok(c(D[3], A2) && c(D[3], A2).manual_spend === null && Number(c(D[3], A2).auto_spend) === 0, "ngày nhân viên chưa nhập: chỉ có số Facebook");
ok(c(D[2], ATT) && c(D[2], ATT).auto_spend === null, "TKQC TikTok: chỉ có số nhập tay");
ok(cmp.every((x) => x.s === duong), "kèm người phụ trách hôm đó");
ok(cmp[0].d >= cmp.at(-1).d, "ngày mới nhất lên trước");
e = await errOf(U.mm, `select * from public.ads_auto_compare($1::date, $2::date)`, [D[100], D[0]]);
ok(/tối đa 93 ngày/.test(e ?? ""), "đối chiếu tối đa 93 ngày", e);

section("Không đụng số nhập tay");
ok(JSON.stringify(await all(`select * from public.ad_daily_reports order by id`)) === manualBefore, "ad_daily_reports giữ nguyên");
ok(JSON.stringify(await all(`select * from public.ads_daily_data order by id`)) === dataBefore, "ads_daily_data giữ nguyên");

section("Gỡ token");
await as(U.owner, `select public.ads_auto_remove_token()`);
st = (await as(U.owner, `select public.ads_auto_status() s`))[0].s;
ok(st.has_token === false && st.token_hint === null, "gỡ token: không còn token", st);
ok((await one(`select token from private.ads_auto_config`)).token === null, "token đã xoá khỏi cơ sở dữ liệu");
ok((await one(`select count(*)::int n from public.ads_auto_daily`)).n > 0, "số đã kéo vẫn giữ");
await db.exec(`delete from private.ads_auto_requests; update private.ads_auto_config set last_auto_at = null`);
n0 = (await one(`select count(*)::int n from net.http_request_queue`)).n;
await db.exec(`select private.ads_auto_tick()`);
ok((await one(`select count(*)::int n from net.http_request_queue`)).n === n0, "gỡ token → lịch không hỏi Facebook");

finish();
