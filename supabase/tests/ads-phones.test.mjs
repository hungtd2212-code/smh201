// Kiểm thử supabase/034_ads_staff_phones.sql (Ads tự động: danh sách SĐT theo nhân viên) trên Postgres chạy trong bộ
// nhớ. Không gọi Pancake / Facebook thật: pg_net được thay bằng bản giả.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "tl", "ads1", "ads2"]) U[name] = await addUser(name);

section("Chạy schema.sql → 033, rồi 034");
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
  "032_telegram_report.sql", "033_telegram_report_detail.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  update public.staff set role = 'super_admin' where user_id = '${U.owner}';
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.tl}', 'Trưởng Tele', 'lead'),
    ('${U.ads1}', 'Dương Ads', 'ads_staff'),
    ('${U.ads2}', 'Sang Ads', 'ads_staff');
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

// Một số đã kéo về TRƯỚC file 034 (chỉ nhớ quảng cáo đầu tiên) — phải giữ nguyên.
const conn = `(select p from public.pancake_pages p where p.pancake_page_id = '${PG}')`;
const take = async (conv) => (await one(`select private.pancake_take(${conn}, $1::jsonb) n`, [JSON.stringify(conv)])).n;
ok(await take({ id: `${PG}_old`, type: "INBOX", customers: [{ name: "Khách Cũ" }], recent_phone_numbers: [{ phone_number: "0901000001" }],
  ad_ids: ["52500000000001", "52500000000002"] }) === 1, "trước 034: kéo được một số");
const importsBefore = JSON.stringify(await all(`select * from public.pancake_imports order by id`));
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;

await db.exec(read("034_ads_staff_phones.sql"));
ok(true, "034 chạy không lỗi");
await db.exec(read("034_ads_staff_phones.sql"));
ok(true, "chạy lại 034 lần hai không lỗi");
ok(JSON.stringify(await all(`select id, pancake_page_id, conversation_id, phone, full_name, conversation_type, ad_id, outcome, lead_id, error, created_at
  from public.pancake_imports order by id`)) === importsBefore, "số đã kéo về giữ nguyên");
ok((await one(`select ad_ids from public.pancake_imports where conversation_id = $1`, [`${PG}_old`])).ad_ids === null, "số cũ: chưa có danh sách quảng cáo");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "chạy 034 không sửa dữ liệu cũ (không ghi nhật ký)");
ok((await one(`select count(*)::int n from private.ads_pancake_jobs`)).n === 0, "chưa có token Facebook → không hỏi lại số Pancake");

section("Quảng cáo tính cho một số");
const pick = async (ids, first) => (await one(`select private.pancake_import_ad($1::jsonb, $2) a`, [ids === undefined ? null : JSON.stringify(ids), first])).a;
ok(await pick(["1", "2", "3"], "1") === "3", "khách bấm nhiều quảng cáo → quảng cáo bấm sau cùng");
ok(await pick([], "9") === "9" && await pick(undefined, "9") === "9", "chưa nhớ danh sách → quảng cáo đầu tiên như trước");
ok(await pick([52500000000007], null) === "52500000000007", "mã quảng cáo dạng số");
ok(await pick(undefined, null) === null && await pick([" "], " ") === null, "không từ quảng cáo");

section("Kéo số mới: nhớ đủ danh sách quảng cáo");
const AD = { old: "52553036920565", duong: "52562931254365", sang: "52560525595435", unknown: "52599999999999", outside: "52577777777777", nostaff: "52588888888888" };
ok(await take({ id: `${PG}_c1`, type: "INBOX", customers: [{ name: "Khách Một" }],
  recent_phone_numbers: [{ phone_number: "0912 345 678" }, { phone_number: "12345" }], ad_ids: [AD.old, AD.duong] }) === 1,
  "một số đúng vào Lead, một số sai thì không");
const c1 = await all(`select phone, ad_id, ad_ids, outcome from public.pancake_imports where conversation_id = $1 order by id`, [`${PG}_c1`]);
ok(c1.length === 2 && JSON.stringify(c1[0].ad_ids) === JSON.stringify([AD.old, AD.duong]) && c1[0].ad_id === AD.old,
  "nhớ cả danh sách quảng cáo; ad_id (dùng cho Lead) vẫn là quảng cáo đầu tiên như trước", c1);
ok(c1[1].outcome === "invalid", "số sai vẫn ghi lại (không vào Lead)", c1[1]);
const lead = await one(`select l.phone from public.leads l join public.pancake_imports i on i.lead_id = l.id where i.conversation_id = $1`, [`${PG}_c1`]);
ok(lead?.phone === "0912345678", "vẫn thêm số vào bảng Lead như file 023", lead);
await take({ id: `${PG}_c2`, customers: [{ name: "Khách Hai" }], recent_phone_numbers: [{ phone_number: "0912345678" }], ad_ids: [AD.sang] });
await take({ id: `${PG}_c3`, customers: [{ name: "Khách Ba" }], recent_phone_numbers: [{ phone_number: "0903000003" }] });
await take({ id: `${PG}_c4`, customers: [{ name: "Khách Bốn" }], recent_phone_numbers: [{ phone_number: "0904000004" }], ad_ids: [AD.unknown] });
await take({ id: `${PG}_c5`, customers: [{ name: "Khách Năm" }], recent_phone_numbers: [{ phone_number: "0905000005" }], ad_ids: [AD.outside] });
await take({ id: `${PG}_c6`, customers: [{ name: "Khách Sáu" }], recent_phone_numbers: [{ phone_number: "0906000006" }], ad_ids: [AD.nostaff] });
ok((await one(`select outcome from public.pancake_imports where conversation_id = $1`, [`${PG}_c2`])).outcome === "duplicate", "số đã có trong Lead → khách cũ");

// Quảng cáo → TKQC (Pancake báo kèm), trừ AD.unknown.
await db.exec(`insert into private.ads_ad_map (ad_id, fb_account_id, source) values
  ('${AD.old}', '2222222222', 'pancake'), ('${AD.duong}', '1111111111', 'pancake'), ('${AD.sang}', '2222222222', 'pancake'),
  ('52500000000001', '2222222222', 'pancake'), ('${AD.outside}', '9999999999', 'pancake'), ('${AD.nostaff}', '3333333333', 'pancake')`);
const unmapped = (await all(`select u from private.ads_pancake_unmapped() u`)).map((r) => r.u);
ok(JSON.stringify(unmapped) === JSON.stringify([AD.unknown]), "quảng cáo của số Pancake chưa biết TKQC → cần hỏi Facebook", unmapped);

section("Tên quảng cáo theo thống kê Pancake");
await db.query(`insert into private.ads_pancake_requests (request_id, kind, pancake_page_id, report_date) values (9001, 'stats', $1, $2::date)`, [PG, D[1]]);
await db.query(`insert into net._http_response (id, status_code, content, timed_out) values (9001, 200, $1, false)`, [JSON.stringify({ data: [
  { ad_id: AD.duong, account_id: "1111111111", name: "260715T2-136-BA", optimization_goal: "CONVERSATIONS", sum_click: 3, sum_phone_number: 1 },
  { ad_id: AD.sang, account_id: "2222222222", name: " 6 - 1 ", optimization_goal: "LEAD_GENERATION", sum_click: 0, sum_phone_number: 0 },
  { ad_id: AD.old, account_id: "2222222222", name: "", sum_click: 1, sum_phone_number: 0 },
] })]);
await one(`select private.ads_pancake_collect()`);
const names = await all(`select ad_id, name, optimization_goal from private.ads_ad_names order by ad_id`);
ok(names.length === 2 && names.find((n) => n.ad_id === AD.sang)?.name === "6 - 1" && names.find((n) => n.ad_id === AD.duong)?.optimization_goal === "CONVERSATIONS",
  "nhớ tên quảng cáo (kể cả quảng cáo không có số), bỏ tên trống", names);
const daily = await all(`select ad_id, messages, phones from public.ads_pancake_daily order by ad_id`);
ok(daily.length === 2 && daily.find((x) => x.ad_id === AD.duong)?.phones === 1, "số thống kê Pancake vẫn lưu như file 031", daily);

section("Danh sách SĐT theo nhân viên");
// Giờ kéo số: c1, c2, c4, c5, c6 lúc 23:30 ngày D1 (giờ VN); c3 lúc 00:10 ngày D0; số cũ lúc 10:00 ngày D2.
await db.query(`update public.pancake_imports set created_at = ($1::date + time '23:30') at time zone 'Asia/Ho_Chi_Minh' where conversation_id <> $2 and conversation_id <> $3`,
  [D[1], `${PG}_c3`, `${PG}_old`]);
await db.query(`update public.pancake_imports set created_at = ($1::date + time '00:10') at time zone 'Asia/Ho_Chi_Minh' where conversation_id = $2`, [D[0], `${PG}_c3`]);
await db.query(`update public.pancake_imports set created_at = ($1::date + time '10:00') at time zone 'Asia/Ho_Chi_Minh' where conversation_id = $2`, [D[2], `${PG}_old`]);
// Form lead theo Facebook: Dương 2 (form tức thì), Sang 0 (chỉ lead tin nhắn).
await db.query(`insert into public.ads_auto_daily (report_date, ad_account_id, fb_account_id, spend, conversations, actions) values
  ($1::date, $2, '1111111111', 500000, 4, $3::jsonb), ($1::date, $4, '2222222222', 300000, 2, $5::jsonb), ($6::date, $2, '1111111111', 1, 0, $3::jsonb)`,
  [D[1], A1, JSON.stringify([{ action_type: "onsite_conversion.lead", value: "2" }, { action_type: "onsite_conversion.lead_grouped", value: "3" }, { action_type: "lead", value: "3" }]),
   A2, JSON.stringify([{ action_type: "lead", value: "2" }]), D[3]]);

for (const who of ["tl", "ads1"]) {
  ok(/Chỉ Quản trị và Trưởng Marketing/.test((await errOf(U[who], `select public.ads_staff_phones($1::date, $1::date)`, [D[1]])) ?? ""), `${who} không xem được danh sách`);
}
ok(/permission denied/.test((await errOf(U.mm, `select * from private.ads_ad_names`)) ?? ""), "không ai đọc thẳng được bảng tên quảng cáo");
ok(/Khoảng ngày không hợp lệ/.test((await errOf(U.mm, `select public.ads_staff_phones($1::date, $2::date)`, [D[0], D[1]])) ?? ""), "khoảng ngày ngược → báo lỗi");
ok(/Khoảng ngày không hợp lệ/.test((await errOf(U.mm, `select public.ads_staff_phones($1::date - 93, $1::date)`, [D[0]])) ?? ""), "quá 93 ngày → báo lỗi");

const list = (await as(U.mm, `select public.ads_staff_phones($1::date, $1::date) r`, [D[1]]))[0].r;
const ph = (conv) => list.phones.filter((p) => p.pancake_url.endsWith(`c_id=${PG}_${conv}`));
ok(list.phones.length === 6, "ngày D1: 6 dòng (5 hội thoại, một hội thoại có thêm số sai); số 00:10 hôm sau và số ngày khác không vào", list.phones.length);
const one1 = ph("c1").find((p) => p.outcome === "new");
ok(one1?.ads_staff_id === duong && one1.ad_id === AD.duong && one1.ad_name === "260715T2-136-BA" && one1.ad_account_id === A1 && one1.gap === null,
  "khách bấm quảng cáo của Sang trước, của Dương sau → tính cho Dương, kèm tên quảng cáo", one1);
ok(one1.full_name === "Khách Một" && one1.phone === "0912345678" && one1.report_date === D[1] && one1.page_name === "Smile Hub 201", "có tên khách, số, ngày, page", one1);
ok(one1.pancake_url === `https://pancake.vn/${PG}?c_id=${PG}_c1`, "có đường mở hội thoại Pancake");
ok(ph("c1").find((p) => p.outcome === "invalid")?.phone === "12345", "số sai vẫn hiện để biết");
ok(ph("c2")[0]?.ads_staff_id === sang && ph("c2")[0].outcome === "duplicate" && ph("c2")[0].ad_goal === "LEAD_GENERATION", "khách cũ của Sang", ph("c2")[0]);
ok(ph("c4")[0]?.gap === "unmapped" && ph("c4")[0].ads_staff_id === null, "quảng cáo đang tra TKQC");
ok(ph("c5")[0]?.gap === "outside", "TKQC chưa có trong ERP");
ok(ph("c6")[0]?.gap === "no_staff" && ph("c6")[0].ad_account_id === A3, "TKQC chưa giao nhân viên");
const next = (await as(U.mm, `select public.ads_staff_phones($1::date, $1::date) r`, [D[0]]))[0].r;
ok(next.phones.length === 1 && next.phones[0].gap === "no_ad", "00:10 tính sang ngày hôm sau; khách không từ quảng cáo", next.phones);
const old = (await as(U.mm, `select public.ads_staff_phones($1::date, $1::date) r`, [D[2]]))[0].r;
ok(old.phones.length === 1 && old.phones[0].ad_id === "52500000000001" && old.phones[0].ads_staff_id === sang, "số kéo trước 034: tính theo quảng cáo đầu tiên như trước", old.phones);
ok(list.forms.length === 1 && list.forms[0].ads_staff_id === duong && list.forms[0].leads === 2 && list.forms[0].ad_account_id === A1 && list.forms[0].report_date === D[1],
  "form lead: chỉ đếm khách điền form tức thì (không tính lead tin nhắn)", list.forms);
ok(Date.parse(list.since) === Date.parse(`${D[2]}T10:00:00+07:00`), "biết từ lúc nào có từng số Pancake", list.since);
const wide = (await as(U.mm, `select public.ads_staff_phones($1::date, $2::date) r`, [D[3], D[0]]))[0].r;
ok(wide.phones.length === 8 && wide.forms.length === 2, "xem nhiều ngày", { p: wide.phones.length, f: wide.forms.length });

section("Chạy lại 034 sau khi đã có token Facebook: hỏi lại số Pancake từ 01/11/2026");
await as(U.mm, `select public.ads_auto_save_token($1)`, ["EAAG" + "aBcD1234".repeat(20) + "Zz9Q"]);
await db.exec(`delete from private.ads_pancake_jobs`);
await db.exec(read("034_ads_staff_phones.sql"));
const jobs = await one(`select count(*)::int n, min(report_date)::text f from private.ads_pancake_jobs`);
ok(jobs.n > 0 && jobs.f === "2026-11-01", "xếp hàng hỏi lại từ 01/11/2026", jobs);
ok((await one(`select count(*)::int n from private.ads_ad_names`)).n === 2, "chạy lại không mất tên quảng cáo đã nhớ");

await finish();
