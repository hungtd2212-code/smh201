// Kiểm thử supabase/035_lead_ads_staff.sql (bảng Lead: cột "NV ADS") trên Postgres chạy trong bộ nhớ.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "tl", "ads1", "ads2", "sale1", "sale2"]) U[name] = await addUser(name);

section("Chạy schema.sql → 034, rồi 035");
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
  "027_ads_auto_test.sql", "028_edit_ad_account.sql", "029_fix_save_token.sql", "031_ads_auto_pancake.sql",
  "032_telegram_report.sql", "033_telegram_report_detail.sql", "034_ads_staff_phones.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  update public.staff set role = 'super_admin' where user_id = '${U.owner}';
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.tl}', 'Trưởng Tele', 'lead'),
    ('${U.ads1}', 'Dương Ads', 'ads_staff'),
    ('${U.ads2}', 'Sang Ads', 'ads_staff'),
    ('${U.sale1}', 'Sale Một', 'sale'),
    ('${U.sale2}', 'Sale Hai', 'sale');
`);
const duong = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads1])).id;
const sang = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads2])).id;
const D = {};
for (const row of await all(`select g, (private.today_vn() - g)::text as d from generate_series(-1, 10) g`)) D[row.g] = row.d;

const fb = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const addAccount = async (name, accountId) =>
  (await one(`insert into public.ad_accounts (name, account_id, channel_id) values ($1, $2, $3) returning id`, [name, accountId, fb])).id;
const A1 = await addAccount("Dương 01", "1111111111");
const A2 = await addAccount("Sang 01", "act_2222222222");
const A3 = await addAccount("Chưa giao", "3333333333");
await db.query(`insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date) values ($1, $2, '2020-01-01')`, [A1, duong]);
await db.query(`insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date) values ($1, $2, '2020-01-01')`, [A2, sang]);

const PG = "1500650126455233";
const page = (await one(`insert into public.pages (name, channel_id) values ('Smile Hub 201', $1) returning id`, [fb])).id;
await db.query(`insert into public.pancake_pages (pancake_page_id, page_id, is_active) values ($1, $2, true)`, [PG, page]);
await db.query(`insert into private.pancake_tokens (pancake_page_id, token) values ($1, $2)`, [PG, "pk_token_" + "a".repeat(30)]);

const conn = `(select p from public.pancake_pages p where p.pancake_page_id = '${PG}')`;
const take = async (conv) => (await one(`select private.pancake_take(${conn}, $1::jsonb) n`, [JSON.stringify(conv)])).n;
const AD = { duong: "52562931254365", sang: "52560525595435", unknown: "52599999999999", nostaff: "52588888888888" };
await db.exec(`insert into private.ads_ad_map (ad_id, fb_account_id, source) values
  ('${AD.duong}', '1111111111', 'pancake'), ('${AD.sang}', '2222222222', 'pancake'), ('${AD.nostaff}', '3333333333', 'pancake')`);
// TKQC Dương 01: Dương phụ trách tới hết ngày D2, từ D1 giao cho Sang.
await db.query(`update public.ad_account_assignments set to_date = $1::date where ad_account_id = $2`, [D[2], A1]);
await db.query(`insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date) values ($1, $2, $3::date)`, [A1, sang, D[1]]);

// Số Pancake kéo về lúc 10:00 ngày D3: khách bấm quảng cáo của Sang trước, của Dương sau.
await take({ id: `${PG}_c1`, customers: [{ name: "Khách Một" }], recent_phone_numbers: [{ phone_number: "0901000001" }], ad_ids: [AD.sang, AD.duong] });
await take({ id: `${PG}_c2`, customers: [{ name: "Khách Hai" }], recent_phone_numbers: [{ phone_number: "0901000002" }], ad_ids: [AD.unknown] });
await take({ id: `${PG}_c3`, customers: [{ name: "Khách Ba" }], recent_phone_numbers: [{ phone_number: "0901000003" }] });
await take({ id: `${PG}_c4`, customers: [{ name: "Khách Bốn" }], recent_phone_numbers: [{ phone_number: "0901000004" }], ad_ids: [AD.nostaff] });
await db.query(`update public.pancake_imports set created_at = ($1::date + time '10:00') at time zone 'Asia/Ho_Chi_Minh'`, [D[3]]);
// Hôm sau khách Một nhắn lại qua quảng cáo của Sang (số đã có trong Lead) → số vẫn tính cho lần tạo ra số.
await take({ id: `${PG}_c1b`, customers: [{ name: "Khách Một" }], recent_phone_numbers: [{ phone_number: "0901000001" }], ad_ids: [AD.sang] });
const leadOf = async (phone) => (await one(`select id from public.leads where phone = $1`, [phone])).id;
const L1 = await leadOf("0901000001"), L2 = await leadOf("0901000002"), L3 = await leadOf("0901000003"), L4 = await leadOf("0901000004");
await db.query(`update public.leads set created_at = ($1::date + time '10:00') at time zone 'Asia/Ho_Chi_Minh'`, [D[3]]);
// Số dán tay: một số trực page đã chọn bài chạy (lưu sẵn nhân viên Sang), quảng cáo đang tra TKQC → vẫn Sang.
await db.query(`update public.leads set ads_staff_id = $1 where id = $2`, [sang, L2]);
// Hai số chỉ có mã quảng cáo Dương 01 (không qua Pancake): ngày D3 (Dương còn phụ trách) và ngày D0 (đã giao Sang).
const addLead = async (phone, day, adsId, assignee = null) => (await one(
  `insert into public.leads (full_name, phone, source, ads_id, created_at, assignee_id)
   values ('Khách dán tay', $1, 'Facebook', $2, ($3::date + time '09:00') at time zone 'Asia/Ho_Chi_Minh', $4) returning id`,
  [phone, adsId, day, assignee])).id;
const L5 = await addLead("0901000005", D[3], AD.duong, U.sale1);
const L6 = await addLead("0901000006", D[0], AD.duong);
const L7 = await addLead("0901000007", D[0], null);
await db.query(`update public.leads set deleted_at = now() where id = $1`, [await addLead("0901000008", D[0], AD.duong)]);

const leadsBefore = JSON.stringify(await all(`select * from public.leads order by id`));
const importsBefore = JSON.stringify(await all(`select * from public.pancake_imports order by id`));
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;
await db.exec(read("035_lead_ads_staff.sql"));
ok(true, "035 chạy không lỗi");
await db.exec(read("035_lead_ads_staff.sql"));
ok(true, "chạy lại 035 lần hai không lỗi");
ok(JSON.stringify(await all(`select * from public.leads order by id`)) === leadsBefore, "bảng Lead giữ nguyên");
ok(JSON.stringify(await all(`select * from public.pancake_imports order by id`)) === importsBefore, "số Pancake đã kéo giữ nguyên");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "không ghi nhật ký (không sửa dữ liệu)");

section("Nhân viên Ads của từng số");
const range = [`${D[10]}T00:00:00+07:00`, `${D[-1]}T23:59:59+07:00`];
const staffOf = async (who) => new Map((await as(U[who], `select * from public.leads_ads_staff($1::timestamptz, $2::timestamptz)`, range))
  .map((r) => [r.lead_id, r.ads_staff_id]));
const mm = await staffOf("mm");
ok(mm.get(L1) === duong, "số Pancake: quảng cáo khách bấm sau cùng lúc kéo về (Dương), không đổi khi khách nhắn lại qua quảng cáo khác", mm.get(L1));
ok(mm.get(L2) === sang, "quảng cáo chưa tra ra TKQC → nhân viên đã lưu sẵn trên số");
ok(!mm.has(L3), "khách không đến từ quảng cáo → không có nhân viên");
ok(!mm.has(L4), "TKQC chưa giao nhân viên → không có nhân viên");
ok(mm.get(L5) === duong, "số dán tay chỉ có mã quảng cáo: nhân viên phụ trách TKQC vào ngày số về (D3: Dương)");
ok(mm.get(L6) === sang, "cùng quảng cáo, ngày D0 TKQC đã giao Sang → Sang");
ok(!mm.has(L7), "số không có quảng cáo → không có");
ok(mm.size === 4, "số đã xoá (Thùng rác) không trả về", [...mm.keys()].length);
ok((await staffOf("tl")).size === 4, "Trưởng Tele xem được như bảng Lead");
const s1 = await staffOf("sale1");
ok(s1.size === 1 && s1.get(L5) === duong, "Sale chỉ lấy được số của mình", [...s1]);
ok((await staffOf("sale2")).size === 0, "Sale khác không lấy được số của người khác");
ok((await staffOf("ads1")).size === 0, "nhân viên Ads không xem bảng Lead → không có gì");
const narrow = new Map((await as(U.mm, `select * from public.leads_ads_staff($1::timestamptz, $2::timestamptz)`,
  [`${D[0]}T00:00:00+07:00`, `${D[0]}T23:59:59+07:00`])).map((r) => [r.lead_id, r.ads_staff_id]));
ok(narrow.size === 1 && narrow.get(L6) === sang, "chỉ lấy số trong khoảng ngày", [...narrow]);
ok(/Khoảng ngày không hợp lệ/.test((await errOf(U.mm, `select * from public.leads_ads_staff($2::timestamptz, $1::timestamptz)`, range)) ?? ""), "khoảng ngày ngược → báo lỗi");
ok(/Khoảng ngày không hợp lệ/.test((await errOf(U.mm, `select * from public.leads_ads_staff(now() - interval '401 days', now())`)) ?? ""), "quá 400 ngày → báo lỗi");
ok(/permission denied/.test((await errOf(U.mm, `select * from private.ads_ad_map`)) ?? ""), "vẫn không ai đọc thẳng được bảng quảng cáo → TKQC");

await finish();
