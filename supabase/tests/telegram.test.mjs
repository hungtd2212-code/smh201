// Kiểm thử supabase/032_telegram_report.sql (gửi báo cáo Ads ngày vào nhóm Telegram) trên Postgres chạy trong bộ
// nhớ. Không gọi Telegram thật: pg_net được thay bằng bản giả, câu trả lời dựng theo mẫu của Telegram Bot API.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "tl", "ads1", "ads2"]) U[name] = await addUser(name);

section("Chạy schema.sql → 031, rồi 032");
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
  "023_pancake_sync.sql", "024_pancake_chat.sql", "025_pancake_reply.sql", "026_pancake_seen_alerts.sql",
  "027_ads_auto_test.sql", "028_edit_ad_account.sql", "029_fix_save_token.sql", "031_ads_auto_pancake.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  update public.staff set role = 'super_admin' where user_id = '${U.owner}';
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.tl}', 'Trưởng Tele', 'lead'),
    ('${U.ads1}', 'An Ads', 'ads_staff'),
    ('${U.ads2}', 'Dương Ads', 'ads_staff');
`);
const an = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads1])).id;
const duong = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads2])).id;
const D = {};
for (const row of await all(`select g, (private.today_vn() - g)::text as d from generate_series(-1, 120) g`)) D[row.g] = row.d;
const fb = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const addAccount = async (name, accountId, staffId) => {
  const id = (await one(`insert into public.ad_accounts (name, account_id, channel_id) values ($1, $2, $3) returning id`, [name, accountId, fb])).id;
  await db.query(`insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date) values ($1, $2, '2020-01-01')`, [id, staffId]);
  return id;
};
const A1 = await addAccount("An_smh_001", "1111111111", an);
const A2 = await addAccount("Dương_smh_001", "2222222222", duong);
const A3 = await addAccount("Dương_smh_002", "3333333333", duong);

// Số của ngày hôm qua (D1): Facebook chi tiêu + Pancake tin nhắn / SĐT.
await db.query(`insert into public.ads_auto_daily (report_date, ad_account_id, fb_account_id, spend, currency) values
  ($1::date, $2, '1111111111', 764868, 'VND'), ($1::date, $3, '2222222222', 1500000, 'VND'), ($1::date, $4, '3333333333', 460184, 'VND'),
  ($5::date, $2, '1111111111', 100000, 'VND')`, [D[1], A1, A2, A3, D[2]]);
await db.query(`insert into public.ads_pancake_daily (report_date, pancake_page_id, ad_id, fb_account_id, messages, phones) values
  ($1::date, 'p1', '120200000000000001', '1111111111', 3, 1), ($1::date, 'p2', '120200000000000002', null, 2, 0),
  ($1::date, 'p2', '120200000000000009', '9999999999', 4, 2)`, [D[1]]);
await db.query(`insert into private.ads_ad_map (ad_id, fb_account_id, source) values ('120200000000000002', '1111111111', 'facebook')`);
await db.query(`insert into private.ads_pancake_days (report_date, pancake_page_id) values ($1::date, 'p1'), ($1::date, 'p2')`, [D[1]]);
await as(U.ads1, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages, data_count) values ($1::date, $2, 760000, 5, 1)`, [D[1], A1]);

const cmpSql = `select * from public.ads_auto_compare($1::date, $2::date) order by report_date, ad_account_id nulls last`;
const cmpBefore = JSON.stringify(await as(U.mm, cmpSql, [D[3], D[0]]));
const manualBefore = JSON.stringify(await all(`select * from public.ad_daily_reports order by id`));

await db.exec(read("032_telegram_report.sql"));
ok(true, "032 chạy không lỗi");
await db.exec(read("032_telegram_report.sql"));
ok(true, "chạy lại 032 lần hai không lỗi");
const job = await all(`select schedule, command from cron.job where jobname = 'smh-telegram'`);
ok(job.length === 1 && job[0].schedule === "20 seconds" && job[0].command === "select private.telegram_tick()", "lịch 20 giây một lần", job);
ok(JSON.stringify(await as(U.mm, cmpSql, [D[3], D[0]])) === cmpBefore, "bảng đối chiếu ra đúng như trước");
ok(/Chỉ Quản trị và Trưởng Marketing/.test((await errOf(U.tl, `select * from public.ads_auto_compare($1::date, $2::date)`, [D[1], D[1]])) ?? ""), "đối chiếu vẫn chỉ Quản trị / Trưởng Marketing xem được");

section("Định dạng số");
const vnInt = async (n) => (await one(`select private.vn_int($1::numeric) t`, [n])).t;
ok(await vnInt(1960184) === "1.960.184" && await vnInt(152973.6) === "152.974" && await vnInt(0) === "0" && await vnInt(999) === "999", "số có dấu chấm ngàn, làm tròn");
const pct = async (a, b) => (await one(`select private.vn_pct($1::numeric, $2::numeric) t`, [a, b])).t;
ok(await pct(1, 3) === "33,33%" && await pct(3, 7) === "42,86%" && await pct(1, 2) === "50%" && await pct(1, 8) === "12,5%", "tỷ lệ như mẫu: 33,33% / 42,86% / 50% / 12,5%");
ok(await pct(0, 5) === "0%" && await pct(1, 0) === "0%" && await pct(4, 4) === "100%", "0 mess → 0%; 100%");
const nm = async (s) => (await one(`select private.telegram_staff_name($1) t`, [s])).t;
ok(await nm("Dương Ads") === "Dương" && await nm("Trọng Sang ads") === "Trọng Sang" && await nm("An") === "An" && await nm("Ads") === "Ads" && await nm(null) === "Chưa giao nhân viên",
  "tên trong tin: bỏ chữ Ads ở cuối");

section("Soạn báo cáo theo mẫu");
const dd = `${Number(D[1].slice(8))}/${Number(D[1].slice(5, 7))}`;
const report = await all(`select seq, title, body from private.telegram_report($1::date)`, [D[1]]);
ok(report.length === 2 && report[0].title === "Dương" && report[1].title === "An", "mỗi nhân viên một tin, chi tiêu nhiều lên trước", report.map((r) => r.title));
ok(report[0].body === [`BC ngày ${dd} - Dương`, "Chi tiêu: 1.960.184", "Mess: 0", "Giá mess: 0", "Data: 0", "Giá Data: 0", "Tỷ lệ xin số: 0%"].join("\n"),
  "Dương: cộng 2 TKQC, không có khách → giá 0, tỷ lệ 0%", report[0].body);
ok(report[1].body === [`BC ngày ${dd} - An`, "Chi tiêu: 764.868", "Mess: 5", "Giá mess: 152.974", "Data: 1", "Giá Data: 764.868", "Tỷ lệ xin số: 20%"].join("\n"),
  "An: chi tiêu Facebook, mess + data theo Pancake (cả quảng cáo tra TKQC qua Facebook)", report[1].body);
ok(!report.some((r) => r.body.includes("9999")) , "quảng cáo của TKQC ngoài hệ thống không tính vào ai");
ok((await all(`select 1 from private.telegram_report($1::date)`, [D[5]])).length === 0, "ngày không ai chạy → không có tin");
ok((await one(`select private.telegram_data_missing($1::date) t`, [D[1]])).t === null, "hôm qua đủ số");
ok(/Chưa có số Pancake/.test((await one(`select private.telegram_data_missing($1::date) t`, [D[2]])).t ?? ""), "ngày chưa có số Pancake → báo thiếu");
ok(/Chưa có số Facebook/.test((await one(`select private.telegram_data_missing($1::date) t`, [D[5]])).t ?? ""), "ngày chưa có số Facebook → báo thiếu");

section("Quyền");
for (const who of ["tl", "ads1"]) {
  ok(/Chỉ Quản trị và Trưởng Marketing/.test((await errOf(U[who], `select public.telegram_status()`)) ?? ""), `${who} không xem được`);
  ok(/Chỉ Quản trị và Trưởng Marketing/.test((await errOf(U[who], `select public.telegram_save_token('123456789:${"A".repeat(35)}')`)) ?? ""), `${who} không dán được token bot`);
}
ok(/permission denied/.test((await errOf(U.mm, `select * from private.telegram_config`)) ?? ""), "không ai đọc được bảng token bot");
ok(/permission denied/.test((await errOf(U.mm, `select private.telegram_tick()`)) ?? ""), "không ai tự gọi được lịch chạy");
ok(/permission denied/.test((await errOf(U.mm, `select * from private.telegram_report(current_date)`)) ?? ""), "không ai gọi thẳng phần soạn báo cáo");

section("Dán token bot, tìm nhóm");
let st = (await as(U.mm, `select public.telegram_status() s`))[0].s;
ok(st.has_token === false && st.chat_id === null && st.pending === 0 && st.send_hour === 10, "chưa có bot; giờ gửi mặc định 10h", st);
ok(/Chưa có bot/.test((await errOf(U.mm, `select public.telegram_send_now($1::date)`, [D[1]])) ?? ""), "chưa có bot thì không gửi được");
for (const bad of ["", "abc", "123:short", `EAA${"x".repeat(40)}`, `123456789:${"A".repeat(35)} x`]) {
  ok(/Token bot không đúng dạng/.test((await errOf(U.owner, `select public.telegram_save_token($1)`, [bad])) ?? ""), `token sai dạng bị chặn: ${JSON.stringify(bad.slice(0, 12))}`);
}
const BOT = "7012345678:AAH" + "xYz_-9".repeat(6) + "Qw3r";
let before = (await one(`select coalesce(max(id), 0)::int m from net.http_request_queue`)).m;
await as(U.owner, `select public.telegram_save_token($1)`, [` ${BOT}\n`]);
let reqs = await all(`select id, url, params, method, body from net.http_request_queue where id > $1 order by id`, [before]);
ok(reqs.length === 2 && reqs[0].url === `https://api.telegram.org/bot${BOT}/getMe` && reqs[1].url === `https://api.telegram.org/bot${BOT}/getUpdates`,
  "dán token → hỏi tên bot + tìm nhóm", reqs.map((q) => q.url.replace(BOT, "<token>")));
st = (await as(U.mm, `select public.telegram_status() s`))[0].s;
ok(st.has_token && st.token_hint === "Qw3r" && st.token_set_by === "Chủ phòng khám" && st.pending === 2, "tình trạng: có bot, 4 ký tự cuối, ai dán", st);
ok(!JSON.stringify(st).includes(BOT.slice(0, 20)), "tình trạng không bao giờ chứa token bot");
const answer = (id, status, body) => db.query(`insert into net._http_response (id, status_code, content, timed_out) values ($1, $2, $3, false)`,
  [id, status, body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body)]);
await answer(reqs[0].id, 200, { ok: true, result: { id: 7012345678, is_bot: true, first_name: "SMH Báo cáo", username: "smh_baocao_bot" } });
await answer(reqs[1].id, 200, { ok: true, result: [
  { update_id: 1, my_chat_member: { chat: { id: -1001234567890, title: "SMH - Ads báo cáo", type: "supergroup" }, new_chat_member: { status: "member" } } },
  { update_id: 2, message: { message_id: 5, chat: { id: 123456, first_name: "Riêng", type: "private" }, text: "/start" } },
  { update_id: 3, message: { message_id: 6, chat: { id: -4567, title: "Nhóm cũ", type: "group" }, text: "/start@smh_baocao_bot" } },
  { update_id: 4, my_chat_member: { chat: { id: -999, title: "Nhóm đã rời", type: "group" }, new_chat_member: { status: "left" } } },
] });
await as(U.mm, `select public.telegram_collect_now()`);
st = (await as(U.mm, `select public.telegram_status() s`))[0].s;
ok(st.bot_username === "smh_baocao_bot", "nhớ tên bot", st.bot_username);
ok(st.chats.length === 2 && st.chats.some((c) => c.chat_id === "-1001234567890" && c.title === "SMH - Ads báo cáo") && !st.chats.some((c) => c.chat_id === "123456" || c.chat_id === "-999"),
  "liệt kê nhóm bot đang ở (bỏ chat riêng, bỏ nhóm bot đã rời)", st.chats);

section("Chọn nhóm");
ok(/Không thấy nhóm/.test((await errOf(U.owner, `select public.telegram_set_chat('-1')`)) ?? ""), "nhóm lạ bị chặn");
await as(U.owner, `select public.telegram_set_chat('-1001234567890')`);
st = (await as(U.mm, `select public.telegram_status() s`))[0].s;
ok(st.chat_id === "-1001234567890" && st.chat_title === "SMH - Ads báo cáo", "đã chọn nhóm", st);
const hourNow = (await one(`select extract(hour from now() at time zone 'Asia/Ho_Chi_Minh')::int h`)).h;
ok(st.last_sent_for === (hourNow >= 10 ? D[1] : D[2]), "chọn nhóm sau 10h → lần tự gửi đầu tiên là sáng mai (không gửi ngay)", { h: hourNow, last: st.last_sent_for });

section("Xem trước, gửi ngay");
const pv = (await as(U.mm, `select public.telegram_preview($1::date) p`, [D[1]]))[0].p;
ok(pv.missing === null && pv.messages.length === 2 && pv.messages[1].body === report[1].body, "xem trước đúng các tin sẽ gửi", pv);
ok(/Chưa có số Pancake/.test((await as(U.mm, `select public.telegram_preview($1::date) p`, [D[2]]))[0].p.missing ?? ""), "xem trước ngày thiếu số → báo thiếu");
for (const [day, msg] of [[D[0], "ngày đã qua"], [D[-1], "ngày đã qua"], [D[2], "Chưa có số Pancake"]]) {
  ok(new RegExp(msg).test((await errOf(U.owner, `select public.telegram_send_now($1::date)`, [day])) ?? ""), `chặn gửi: ${msg} (${day})`);
}
before = (await one(`select max(id)::int m from net.http_request_queue`)).m;
let n = (await as(U.owner, `select public.telegram_send_now($1::date) n`, [D[1]]))[0].n;
ok(n === 2, "xếp 2 tin", n);
let sent = await all(`select id, url, method, body from net.http_request_queue where id > $1 order by id`, [before]);
ok(sent.length === 1 && sent[0].method === "POST" && sent[0].url === `https://api.telegram.org/bot${BOT}/sendMessage`, "gửi từng tin một (tin đầu)", sent.length);
ok(sent[0].body.chat_id === "-1001234567890" && sent[0].body.text === report[0].body, "gửi đúng nhóm, đúng nội dung", sent[0].body);
ok(/Đang gửi báo cáo/.test((await errOf(U.owner, `select public.telegram_send_now($1::date)`, [D[1]])) ?? ""), "đang gửi thì không gửi chồng");
await answer(sent[0].id, 200, { ok: true, result: { message_id: 10 } });
await as(U.mm, `select public.telegram_collect_now()`);
sent = await all(`select id, body from net.http_request_queue where id > $1 order by id`, [before]);
ok(sent.length === 2 && sent[1].body.text === report[1].body, "tin đầu tới rồi mới gửi tin sau", sent.length);
await answer(sent[1].id, 200, { ok: true, result: { message_id: 11 } });
await as(U.mm, `select public.telegram_collect_now()`);
st = (await as(U.mm, `select public.telegram_status() s`))[0].s;
ok(st.pending === 0 && st.recent.slice(0, 2).every((o) => o.status === "sent" && o.sent_at && o.kind === "manual"), "cả 2 tin đã gửi", st.recent.slice(0, 2));

section("Telegram báo lỗi");
const lastReq = async () => (await one(`select max(id)::int m from net.http_request_queue`)).m;
await as(U.owner, `select public.telegram_send_now($1::date)`, [D[1]]);
await answer(await lastReq(), 429, { ok: false, error_code: 429, description: "Too Many Requests: retry after 5", parameters: { retry_after: 5 } });
await as(U.mm, `select public.telegram_collect_now()`);
let ob = await all(`select status, attempts, error from private.telegram_outbox where status in ('queued', 'sending') order by id`);
ok(ob.length === 2 && ob[0].status === "queued" && ob[0].attempts === 1 && /quá nhanh/.test(ob[0].error ?? ""), "429 → chờ rồi gửi lại", ob);
await db.exec(`update private.telegram_outbox set next_try_at = now() where status = 'queued'`);
await as(U.mm, `select public.telegram_collect_now()`);
await answer(await lastReq(), 400, { ok: false, error_code: 400, description: "Bad Request: group chat was upgraded to a supergroup chat", parameters: { migrate_to_chat_id: -1009876543210 } });
await as(U.mm, `select public.telegram_collect_now()`);
const resent = await one(`select body from net.http_request_queue where id = $1`, [await lastReq()]);
ok(resent.body.chat_id === "-1009876543210" && (await one(`select chat_id from private.telegram_config`)).chat_id === "-1009876543210",
  "nhóm lên siêu nhóm → đổi sang ID mới, gửi lại", resent.body.chat_id);
await answer(await lastReq(), 403, { ok: false, error_code: 403, description: "Forbidden: bot was kicked from the supergroup chat" });
await as(U.mm, `select public.telegram_collect_now()`);
ob = await all(`select status, error from private.telegram_outbox order by id desc limit 2`);
ok(ob.every((o) => o.status === "failed" && /không còn trong nhóm/.test(o.error ?? "")), "bot bị xoá khỏi nhóm → dừng cả lượt, không thử mãi", ob);
st = (await as(U.mm, `select public.telegram_status() s`))[0].s;
ok(/không còn trong nhóm/.test(st.last_error ?? "") && st.pending === 0, "báo lỗi dễ hiểu trên màn hình", st.last_error);
// Không trả lời: thử lại tối đa 3 lần.
await as(U.owner, `select public.telegram_send_now($1::date)`, [D[1]]);
const firstId = (await one(`select min(id)::int m from private.telegram_outbox where status in ('queued', 'sending')`)).m;
for (let i = 0; i < 3; i++) {
  await db.exec(`update private.telegram_outbox set next_try_at = now() where status = 'queued'; select private.telegram_dispatch()`);
  await db.exec(`update private.telegram_requests set created_at = now() - interval '3 minutes'`);
  await db.exec(`select private.telegram_collect()`);
  if (i === 0) {
    ob = await all(`select id, status from private.telegram_outbox where id >= $1 order by id`, [firstId]);
    ok(ob[0].status === "queued" && ob[1].status === "queued" && (await one(`select count(*)::int n from private.telegram_requests`)).n === 0,
      "tin đầu chờ thử lại → tin sau cũng chờ (giữ đúng thứ tự)", ob);
  }
}
ob = await all(`select status, attempts from private.telegram_outbox where id >= $1 order by id`, [firstId]);
ok(ob[0].status === "failed" && ob[0].attempts === 3 && ob[1].status === "sending", "Telegram không trả lời 3 lần → bỏ tin đó, gửi tin kế tiếp", ob);
await db.exec(`update private.telegram_outbox set status = 'failed' where status in ('queued', 'sending'); delete from private.telegram_requests`);

section("Tự gửi lúc 10h");
await db.exec(`update private.telegram_config set send_hour = 24, last_sent_for = null, last_error = null`);
before = await lastReq();
await db.exec(`select private.telegram_tick()`);
ok(await lastReq() === before, "chưa tới giờ → không gửi");
await db.exec(`update private.telegram_config set send_hour = 0`);
await db.exec(`delete from private.ads_pancake_days where report_date = '${D[1]}'`);
await db.exec(`select private.telegram_tick()`);
ok(await lastReq() === before && /Chưa có số Pancake/.test((await one(`select last_error from private.telegram_config`)).last_error ?? ""), "tới giờ nhưng chưa có số Pancake → chờ, báo lý do");
await db.exec(`insert into private.ads_pancake_days (report_date, pancake_page_id) values ('${D[1]}', 'p1')`);
await db.exec(`select private.telegram_tick()`);
let auto = await all(`select kind, report_date::text d, status from private.telegram_outbox where kind = 'auto' order by id`);
ok(auto.length === 2 && auto.every((o) => o.d === D[1]) && auto[0].status === "sending", "có số → xếp báo cáo hôm qua, gửi tin đầu", auto);
ok((await one(`select last_sent_for::text d from private.telegram_config`)).d === D[1], "nhớ đã gửi ngày hôm qua");
await answer(await lastReq(), 200, { ok: true, result: {} });
await db.exec(`select private.telegram_tick()`);
await answer(await lastReq(), 200, { ok: true, result: {} });
await db.exec(`select private.telegram_tick()`);
await db.exec(`select private.telegram_tick()`);
auto = await all(`select status from private.telegram_outbox where kind = 'auto'`);
ok(auto.length === 2 && auto.every((o) => o.status === "sent"), "gửi xong, không xếp lại lần hai trong ngày", auto);
await db.exec(`update private.telegram_config set last_sent_for = null`);
await as(U.owner, `select public.telegram_set_enabled(false)`);
before = await lastReq();
await db.exec(`select private.telegram_tick()`);
ok(await lastReq() === before, "tắt tự gửi → không gửi");

section("Gỡ bot");
await as(U.owner, `select public.telegram_remove_token()`);
st = (await as(U.owner, `select public.telegram_status() s`))[0].s;
ok(st.has_token === false && st.chat_id === null && st.chats.length === 0, "gỡ bot: không còn token, không còn nhóm", st);
ok((await one(`select bot_token from private.telegram_config`)).bot_token === null, "token bot đã xoá khỏi cơ sở dữ liệu");

section("Không đụng số nhập tay");
ok(JSON.stringify(await all(`select * from public.ad_daily_reports order by id`)) === manualBefore, "ad_daily_reports giữ nguyên");

finish();
