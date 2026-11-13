// Kiểm thử supabase/031_ads_auto_pancake.sql (Ads tự động: thêm số tin nhắn + số điện thoại theo thống kê quảng
// cáo của Pancake) trên Postgres chạy trong bộ nhớ. Không gọi Pancake / Facebook thật: pg_net được thay bằng bản
// giả, câu trả lời dựng theo mẫu thật của GET /pages/{page_id}/statistics/ads?type=by_id.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "tl", "ads1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 029, rồi 031");
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
  "027_ads_auto_test.sql", "028_edit_ad_account.sql", "029_fix_save_token.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  update public.staff set role = 'super_admin' where user_id = '${U.owner}';
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.tl}', 'Trưởng Tele', 'lead'),
    ('${U.ads1}', 'Dương Ads', 'ads_staff');
`);
const duong = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads1])).id;
const D = {};
for (const row of await all(`select g, (private.today_vn() - g)::text as d from generate_series(-1, 120) g`)) D[row.g] = row.d;

const fb = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const addAccount = async (name, accountId) =>
  (await one(`insert into public.ad_accounts (name, account_id, channel_id) values ($1, $2, $3) returning id`, [name, accountId, fb])).id;
const A1 = await addAccount("Dương 01", "1111111111");
const A2 = await addAccount("Dương 02", "act_2222222222");
for (const acc of [A1, A2]) {
  await db.query(`insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date) values ($1, $2, '2020-01-01')`, [acc, duong]);
}

// Page Pancake: P1 đã nối tài khoản quảng cáo trên Pancake, P2 chưa nối (Pancake trả "no_user_token"),
// P3 đang tắt, P4 chưa có token.
const P = { P1: "1500650126455233", P2: "1270125846190658", P3: "3333333333333", P4: "4444444444444" };
const PAGE_TOKEN = { P1: "pk_tokenP1_" + "a".repeat(30), P2: "pk_tokenP2_" + "b".repeat(30), P3: "pk_tokenP3_" + "c".repeat(30) };
for (const [key, id] of Object.entries(P)) {
  const page = (await one(`insert into public.pages (name, channel_id) values ($1, $2) returning id`, [`Page ${key}`, fb])).id;
  await db.query(`insert into public.pancake_pages (pancake_page_id, page_id, is_active) values ($1, $2, $3)`, [id, page, key !== "P3"]);
  if (PAGE_TOKEN[key]) await db.query(`insert into private.pancake_tokens (pancake_page_id, token) values ($1, $2)`, [id, PAGE_TOKEN[key]]);
}

// Số nhân viên nhập tay — phải giữ nguyên.
await as(U.ads1, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages, data_count) values
  ($1::date, $2, 500000, 10, 3)`, [D[1], A1]);
const manualBefore = JSON.stringify(await all(`select * from public.ad_daily_reports order by id`));
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;

await db.exec(read("031_ads_auto_pancake.sql"));
ok(true, "031 chạy không lỗi");
await db.exec(read("031_ads_auto_pancake.sql"));
ok(true, "chạy lại 031 lần hai không lỗi");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "chạy 031 không sửa dữ liệu cũ (không ghi nhật ký)");
ok((await one(`select count(*)::int n from private.ads_pancake_jobs`)).n === 0, "chưa có token Facebook → chưa xếp hàng số Pancake");
const jobs = await all(`select jobname, command from cron.job where jobname = 'smh-ads-auto'`);
ok(jobs.length === 1 && jobs[0].command === "select private.ads_auto_tick()", "vẫn một lịch mỗi phút của Ads tự động", jobs);

section("Tiện ích");
const epoch = async (d) => Number((await one(`select private.vn_day_epoch($1::date) e`, [d])).e);
ok(await epoch("2026-11-01") === Date.UTC(2026, 9, 31, 17) / 1000, "00:00 ngày 01/11 giờ Việt Nam = 17:00 ngày 31/10 UTC");
const cnt = async (v) => (await one(`select private.json_count($1::jsonb) n`, [JSON.stringify(v)])).n;
ok(await cnt(3) === 3 && await cnt("4") === 4 && await cnt("2.0") === 2, "đọc số (số / chuỗi)");
ok(await cnt(-1) === 0 && await cnt("abc") === 0 && await cnt(null) === 0 && await cnt({ a: 1 }) === 0 && await cnt(1.5) === 0, "dạng lạ → 0");
const pages = (await all(`select g from private.ads_pancake_pages() g order by 1`)).map((r) => r.g);
ok(JSON.stringify(pages) === JSON.stringify([P.P2, P.P1].sort()), "chỉ hỏi page đang bật và có token", pages);

section("Quyền");
ok(/permission denied/.test((await errOf(U.mm, `select * from private.ads_ad_map`)) ?? ""), "không ai đọc được bảng quảng cáo → TKQC");
ok(/permission denied/.test((await errOf(U.mm, `select * from private.ads_pancake_jobs`)) ?? ""), "không ai đọc được hàng đợi");
ok(/permission denied/.test((await errOf(U.mm, `select private.ads_pancake_collect()`)) ?? ""), "không ai tự gọi được phần đọc câu trả lời");
ok(/permission denied/.test((await errOf(U.mm, `select private.ads_pancake_queue(current_date, current_date)`)) ?? ""), "không ai tự xếp hàng");
ok(/permission denied/.test((await errOf(U.mm, `insert into public.ads_pancake_daily (report_date, pancake_page_id, ad_id) values (current_date, 'x', '12345')`)) ?? ""),
  "không ai tự ghi số Pancake");
for (const who of ["tl", "ads1"]) {
  ok(/Chỉ Quản trị và Trưởng Marketing/.test((await errOf(U[who], `select * from public.ads_auto_compare($1::date, $2::date)`, [D[7], D[0]])) ?? ""),
    `${who} không xem được đối chiếu`);
}

section("Dán token Facebook, bấm Kéo lại số");
const TOKEN = "EAAG" + "aBcD1234".repeat(20) + "Zz9Q";
await as(U.mm, `select public.ads_auto_save_token($1)`, [TOKEN]);
await db.exec(`delete from private.ads_auto_requests`); // bỏ qua phần Facebook (đã kiểm thử ở ads-auto.test.mjs)
let before = (await one(`select coalesce(max(id), 0)::int m from net.http_request_queue`)).m;
let r = (await as(U.mm, `select public.ads_auto_pull($1::date, $2::date) r`, [D[1], D[0]]))[0].r;
ok(r.accounts === 2 && r.pancake_pages === 2, "kéo lại 2 ngày: 2 TKQC Facebook + 2 page Pancake", r);
let sent = await all(`select id, url, params, headers from net.http_request_queue where id > $1 and url like 'https://pages.fm/%' order by id`, [before]);
ok(sent.length === 4, "gửi ngay 4 lượt hỏi Pancake (2 page × 2 ngày)", sent.length);
const stat = (page, day) => sent.find((q) => q.url.includes(`/pages/${page}/`) && Number(q.params.since) === Date.parse(`${day}T00:00:00+07:00`) / 1000);
const s11 = stat(P.P1, D[1]);
ok(s11 && s11.url === `https://pages.fm/api/public_api/v1/pages/${P.P1}/statistics/ads`, "hỏi đúng địa chỉ thống kê quảng cáo", s11?.url);
ok(s11?.params.type === "by_id" && Number(s11.params.until) - Number(s11.params.since) === 86399, "theo từng quảng cáo, đúng một ngày Việt Nam", s11?.params);
ok(s11?.params.page_access_token === PAGE_TOKEN.P1 && stat(P.P2, D[1])?.params.page_access_token === PAGE_TOKEN.P2, "mỗi page dùng token của page đó");
ok(sent.every((q) => !JSON.stringify(q).includes(TOKEN)), "token Facebook không bao giờ gửi sang Pancake");
let st = (await as(U.mm, `select public.ads_auto_status() s`))[0].s;
ok(st.pancake_pending === 4 && st.pancake_pages.length === 2, "tình trạng: còn 4 việc Pancake, 2 page", { p: st.pancake_pending, n: st.pancake_pages.length });
ok(!Object.values(PAGE_TOKEN).some((t) => JSON.stringify(st).includes(t)), "tình trạng không bao giờ chứa token Pancake");

section("Pancake trả lời");
const answer = (id, status, body) => db.query(`insert into net._http_response (id, status_code, content, timed_out) values ($1, $2, $3, false)`,
  [id, status, body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body)]);
const AD = { a: "120200000000000001", b: "120200000000000002", c: "120200000000000003", d: "120200000000000004", x: "52628407257619", y: "52628407257620" };
const full = (ad, account, click, phone) => ({
  ad_id: ad, account_id: account, adset_id: "1", name: "QC", spend: "100000", impressions: "763", clicks: "36",
  messaging_conversation_started_7d: "3", sum_click: click, sum_phone_number: phone, sum_order: 0, total_order_count: 0,
  page_id: P.P1, type: "ads", currency: "VND",
});
await answer(s11.id, 200, [
  full(AD.a, "1111111111", 3, 1),
  full(AD.b, "2222222222", "2", 0),
  full(AD.c, "9999999999", 4, 2), // TKQC không có trong ERP
  full(AD.d, "1111111111", 0, 0), // không có tin nhắn, không có số → không lưu
  "rác", { ad_id: "abc", sum_click: 9 },
]);
await answer(stat(P.P2, D[1]).id, 200, [
  { type: "ads", error_code: "no_user_token", ad_id: AD.x, total_order_count: 1, sum_order: 0, sum_click: 0, sum_phone_number: 1 },
  { type: "ads", error_code: "no_user_token", ad_id: AD.y, sum_click: 2, sum_phone_number: 1 },
  { type: "ads", error_code: "no_user_token", ad_id: AD.a, sum_click: 1, sum_phone_number: 0 },
]);
await answer(stat(P.P1, D[0]).id, 502, "<html>Bad gateway</html>");
await answer(stat(P.P2, D[0]).id, 200, []);
before = (await one(`select max(id)::int m from net.http_request_queue`)).m;
r = (await as(U.mm, `select public.ads_auto_collect_now() r`))[0].r;
ok(r.answers === 4, "đọc 4 câu trả lời", r);
const daily = await all(`select report_date::text d, pancake_page_id p, ad_id, fb_account_id, messages, phones from public.ads_pancake_daily order by pancake_page_id, ad_id`);
ok(daily.length === 6, "lưu 6 quảng cáo có tin nhắn / số điện thoại (bỏ quảng cáo 0 và dòng rác)", daily);
const dget = (p, ad) => daily.find((x) => x.p === p && x.ad_id === ad);
ok(dget(P.P1, AD.a)?.messages === 3 && dget(P.P1, AD.a).phones === 1 && dget(P.P1, AD.a).fb_account_id === "1111111111", "tin nhắn = sum_click, SĐT = sum_phone_number, kèm TKQC", dget(P.P1, AD.a));
ok(dget(P.P1, AD.b)?.messages === 2, "đọc được số dạng chuỗi");
ok(dget(P.P2, AD.x)?.messages === 0 && dget(P.P2, AD.x).phones === 1 && dget(P.P2, AD.x).fb_account_id === null, "page chưa nối quảng cáo: vẫn có số, chưa biết TKQC");
ok(daily.every((x) => x.d === D[1]), "ngày 0: Pancake không có gì → không lưu dòng nào");
const map = await all(`select ad_id, fb_account_id, source from private.ads_ad_map order by ad_id`);
ok(map.length === 4 && map.every((m) => m.source === "pancake"), "nhớ TKQC Pancake báo kèm (cả quảng cáo không có số)", map);
let jobsLeft = await all(`select pancake_page_id p, report_date::text d, attempts from private.ads_pancake_jobs`);
ok(jobsLeft.length === 1 && jobsLeft[0].p === P.P1 && jobsLeft[0].d === D[0] && jobsLeft[0].attempts === 1, "Pancake lỗi → giữ lại để thử lại", jobsLeft);
let state = await all(`select pancake_page_id p, last_ok_at, last_error from private.ads_pancake_state order by 1`);
ok(/tạm thời/.test(state.find((s) => s.p === P.P1)?.last_error ?? "") && state.find((s) => s.p === P.P2)?.last_ok_at, "báo lỗi dễ hiểu cho page lỗi", state);

section("Tra TKQC của quảng cáo qua Facebook");
let lookups = await all(`select id, url, params, headers from net.http_request_queue where id > $1 order by id`, [before]);
ok(JSON.stringify(lookups.map((q) => q.url).sort()) === JSON.stringify([AD.x, AD.y].map((a) => `https://graph.facebook.com/v26.0/${a}`)), "chỉ hỏi Facebook 2 quảng cáo chưa biết TKQC", lookups.map((q) => q.url));
ok(lookups.every((q) => q.params.fields === "account_id" && q.headers?.Authorization === `Bearer ${TOKEN}` && !q.url.includes(TOKEN)), "hỏi account_id, token trong header");
st = (await as(U.mm, `select public.ads_auto_status() s`))[0].s;
ok(st.pancake_pending === 3, "còn 3 việc: 1 ngày chờ thử lại + 2 lượt tra TKQC", st.pancake_pending);
await answer(lookups.find((q) => q.url.endsWith(AD.x)).id, 200, { account_id: "2222222222", id: AD.x });
await answer(lookups.find((q) => q.url.endsWith(AD.y)).id, 400,
  { error: { message: "Unsupported get request. Object with ID does not exist, cannot be loaded due to missing permissions", type: "GraphMethodException", code: 100, error_subcode: 33 } });
before = (await one(`select max(id)::int m from net.http_request_queue`)).m;
await as(U.mm, `select public.ads_auto_collect_now()`);
const mx = await one(`select fb_account_id, source from private.ads_ad_map where ad_id = $1`, [AD.x]);
ok(mx.fb_account_id === "2222222222" && mx.source === "facebook", "Facebook trả TKQC → nhớ", mx);
const my = await one(`select fb_account_id, retry_at > now() + interval '6 days' as later, last_error from private.ads_ad_map where ad_id = $1`, [AD.y]);
ok(my.fb_account_id === null && my.later && /sai ID TKQC|không đọc được/.test(my.last_error ?? ""), "quảng cáo ngoài TKQC của mình → 7 ngày sau mới hỏi lại", my);
ok((await one(`select count(*)::int n from net.http_request_queue where id > $1 and url like 'https://graph.facebook.com/%'`, [before])).n === 0, "không hỏi lại ngay");
st = (await as(U.mm, `select public.ads_auto_status() s`))[0].s;
ok(st.pancake_pending === 1, "chỉ còn ngày chờ thử lại", st.pancake_pending);

section("Đối chiếu: thêm 2 cột Pancake");
await db.query(`insert into public.ads_auto_daily (report_date, ad_account_id, fb_account_id, spend, currency, conversations)
  values ($1::date, $2, '1111111111', 498000, 'VND', 9)`, [D[1], A1]);
let cmp = await as(U.mm, `select report_date::text d, ad_account_id a, ads_staff_id s, manual_spend, manual_messages, auto_spend, auto_conversations, pancake_messages, pancake_phones
  from public.ads_auto_compare($1::date, $2::date)`, [D[1], D[1]]);
const c = (a) => cmp.filter((x) => x.a === a);
ok(c(A1).length === 1, "TKQC 1: số nhập tay, số Facebook, số Pancake trên cùng một dòng", cmp);
ok(Number(c(A1)[0].manual_spend) === 500000 && Number(c(A1)[0].auto_spend) === 498000 && c(A1)[0].auto_conversations === 9, "giữ nguyên số nhập tay và số Facebook", c(A1)[0]);
ok(c(A1)[0].pancake_messages === 4 && c(A1)[0].pancake_phones === 1, "Pancake TKQC 1: cộng cả 2 page (3 + 1 tin nhắn, 1 SĐT)", c(A1)[0]);
ok(c(A2).length === 1 && c(A2)[0].pancake_messages === 2 && c(A2)[0].pancake_phones === 1 && c(A2)[0].manual_spend === null,
  "TKQC 2: TKQC Pancake báo kèm + TKQC tra qua Facebook (ID nhân viên điền dạng act_)", c(A2)[0]);
ok(c(A2)[0].s === duong, "kèm người phụ trách hôm đó");
ok(c(null).length === 1 && c(null)[0].pancake_messages === 6 && c(null)[0].pancake_phones === 3 && c(null)[0].s === null,
  "dòng chưa gắn được TKQC: 4 + 2 tin nhắn, 2 + 1 SĐT", c(null));
ok(cmp.at(-1).a === null, "dòng chưa gắn TKQC nằm cuối ngày");
cmp = await as(U.mm, `select ad_account_id a, pancake_messages from public.ads_auto_compare($1::date, $2::date)`, [D[3], D[2]]);
ok(cmp.length === 0, "ngày không có số nào → không có dòng", cmp);
await db.query(`insert into public.ads_auto_daily (report_date, ad_account_id, fb_account_id, spend, currency) values
  ($1::date, $3, '2222222222', 120000, 'VND'), ($2::date, $3, '2222222222', 90000, 'VND')`, [D[0], D[2], A2]);
cmp = await as(U.mm, `select report_date::text d, ad_account_id a, pancake_messages m, pancake_phones p from public.ads_auto_compare($1::date, $2::date)`, [D[2], D[0]]);
const a2d0 = cmp.find((x) => x.d === D[0] && x.a === A2);
const a2d2 = cmp.find((x) => x.d === D[2] && x.a === A2);
ok(a2d0 && a2d0.m === 0 && a2d0.p === 0, "ngày Pancake đã trả lời mà TKQC không có khách → 0", a2d0);
ok(a2d2 && a2d2.m === null && a2d2.p === null, "ngày Pancake chưa trả lời → để trống (khác 0)", a2d2);

section("Pancake trả lời lại → thay số cũ");
await db.exec(`update private.ads_pancake_jobs set next_try_at = now() - interval '1 second'; delete from private.ads_auto_requests`);
await as(U.mm, `select public.ads_auto_pull($1::date, $2::date)`, [D[1], D[1]]);
let q = await all(`select request_id id, pancake_page_id p from private.ads_pancake_requests where kind = 'stats' and report_date = $1::date`, [D[1]]);
ok(q.length === 2, "hỏi lại 2 page ngày 1", q);
await answer(q.find((x) => x.p === P.P1).id, 200, [full(AD.a, "1111111111", 5, 2)]);
await answer(q.find((x) => x.p === P.P2).id, 200, { success: false, message: "Page access token is invalid" });
await as(U.mm, `select public.ads_auto_collect_now()`);
const p1 = await all(`select ad_id, messages, phones from public.ads_pancake_daily where pancake_page_id = $1 and report_date = $2::date`, [P.P1, D[1]]);
ok(p1.length === 1 && p1[0].messages === 5 && p1[0].phones === 2, "page 1: số mới thay hết số cũ của ngày đó", p1);
ok((await one(`select count(*)::int n from public.ads_pancake_daily where pancake_page_id = $1`, [P.P2])).n === 3, "page 2 lỗi → giữ số cũ");
state = await one(`select last_error from private.ads_pancake_state where pancake_page_id = $1`, [P.P2]);
ok(state.last_error === "Pancake báo lỗi: Page access token is invalid", "báo nguyên câu lỗi của Pancake", state);

section("Thử lại, giới hạn, hết giờ chờ");
await db.exec(`delete from private.ads_pancake_requests; delete from private.ads_pancake_jobs`);
await db.exec(`select private.ads_pancake_queue(private.today_vn() - 9, private.today_vn())`);
ok((await one(`select count(*)::int n from private.ads_pancake_jobs`)).n === 20, "xếp hàng 10 ngày × 2 page");
await db.exec(`select private.ads_pancake_dispatch()`);
let inflight = await all(`select pancake_page_id p, count(*)::int n, max(report_date)::text newest from private.ads_pancake_requests where kind = 'stats' group by 1`);
ok(inflight.length === 2 && inflight.every((x) => x.n === 3 && x.newest === D[0]), "mỗi page tối đa 3 lượt cùng lúc, ngày gần nhất trước", inflight);
await db.exec(`select private.ads_pancake_dispatch()`);
ok((await one(`select count(*)::int n from private.ads_pancake_requests where kind = 'stats'`)).n === 6, "chưa trả lời thì không gửi thêm");
await db.exec(`update private.ads_pancake_requests set created_at = now() - interval '4 minutes'`);
await db.exec(`select private.ads_pancake_collect()`);
ok(/không trả lời/.test((await one(`select last_error from private.ads_pancake_state where pancake_page_id = $1`, [P.P1])).last_error ?? ""), "chờ quá 3 phút → báo Pancake không trả lời");
ok((await one(`select count(*)::int n from private.ads_pancake_jobs where attempts = 1`)).n === 6, "6 ngày đó sẽ thử lại");
ok((await one(`select count(*)::int n from private.ads_pancake_requests where kind = 'stats'`)).n === 6, "và gửi tiếp 6 ngày khác");
// Lỗi mãi → sau 5 lần thì bỏ.
await db.exec(`delete from private.ads_pancake_requests; delete from private.ads_pancake_jobs`);
await db.exec(`select private.ads_pancake_queue(private.today_vn(), private.today_vn())`);
for (let i = 0; i < 5; i++) {
  await db.exec(`update private.ads_pancake_jobs set next_try_at = now() - interval '1 second'`);
  await db.exec(`select private.ads_pancake_dispatch()`);
  for (const x of await all(`select request_id id from private.ads_pancake_requests where kind = 'stats'`)) await answer(x.id, 429, "{}");
  await db.exec(`select private.ads_pancake_collect()`);
}
ok((await one(`select count(*)::int n from private.ads_pancake_jobs`)).n === 0, "lỗi 5 lần → bỏ, không hỏi mãi");
ok(/hỏi quá nhiều/.test((await one(`select last_error from private.ads_pancake_state where pancake_page_id = $1`, [P.P1])).last_error ?? ""), "lỗi 429 → báo hỏi quá nhiều");

section("Lịch mỗi giờ, page tắt");
await db.exec(`delete from private.ads_pancake_requests; delete from private.ads_auto_requests; update private.ads_auto_config set last_auto_at = now() - interval '61 minutes'`);
await db.exec(`select private.ads_auto_tick()`);
const queued = await all(`select pancake_page_id p, min(report_date)::text f, max(report_date)::text t, count(*)::int n from private.ads_pancake_jobs group by 1`);
ok(queued.length === 2 && queued.every((x) => x.f === D[2] && x.t === D[0] && x.n === 3), "mỗi giờ: hỏi lại số Pancake 3 ngày gần nhất", queued);
ok((await one(`select count(*)::int n from private.ads_pancake_requests where kind = 'stats'`)).n === 6, "và gửi luôn");
await db.exec(`update public.pancake_pages set is_active = false where pancake_page_id = '${P.P2}'`);
await db.exec(`select private.ads_auto_tick()`);
ok((await one(`select count(*)::int n from private.ads_pancake_jobs where pancake_page_id = $1`, [P.P2])).n === 0, "tắt page → bỏ việc của page đó");
st = (await as(U.mm, `select public.ads_auto_status() s`))[0].s;
ok(st.pancake_pages.length === 1 && st.pancake_pages[0].pancake_page_id === P.P1 && st.pancake_pages[0].name === "Page P1", "tình trạng chỉ liệt kê page đang hỏi", st.pancake_pages);

section("Gỡ token Facebook");
await as(U.owner, `select public.ads_auto_remove_token()`);
await db.exec(`delete from private.ads_pancake_requests; delete from private.ads_pancake_jobs; delete from private.ads_ad_map where ad_id = '${AD.y}'`);
await db.exec(`update private.ads_auto_config set last_auto_at = null`);
const n0 = (await one(`select count(*)::int n from net.http_request_queue`)).n;
await db.exec(`select private.ads_auto_tick()`);
ok((await one(`select count(*)::int n from net.http_request_queue`)).n === n0, "không còn token → không tự hỏi Pancake, không tra TKQC qua Facebook");
st = (await as(U.owner, `select public.ads_auto_status() s`))[0].s;
ok(st.pancake_pending === 0, "không còn việc chờ", st.pancake_pending);
ok((await one(`select count(*)::int n from public.ads_pancake_daily`)).n > 0, "số đã kéo vẫn giữ");

section("Không đụng số nhập tay");
ok(JSON.stringify(await all(`select * from public.ad_daily_reports order by id`)) === manualBefore, "ad_daily_reports giữ nguyên");
ok((await as(U.tl, `select count(*)::int n from public.ads_pancake_daily`))[0].n === 0, "Trưởng Tele không xem được số Pancake theo quảng cáo");

finish();
