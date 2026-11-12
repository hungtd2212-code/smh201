// Kiểm thử quyền ghi của "Nhập từ Excel" (Marketing → Tổng quan) trên Postgres chạy trong bộ nhớ: quản lý thêm
// được nhiều dòng một lượt cho ngày cũ của người khác, mỗi lượt được cả hoặc không được gì, nhân viên không nhập
// thay người khác, nhập nhiều dòng không bị tự khoá tài khoản. Không cần file migration mới. Không đụng tới cơ
// sở dữ liệu thật.
//
// Chạy:  node supabase/tests/ad-import.test.mjs
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "ads1", "ads2"]) U[name] = await addUser(name);

section("Chạy schema.sql → 018");
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "008_staff_accounts.sql",
  "010_ads_daily_data.sql", "011_sync_ads_staff_name.sql", "012_ad_targets.sql", "013_revenue_avatars.sql",
  "014_monthly_targets.sql", "015_telesale_positions.sql", "016_lead_ads_runs_ads.sql", "017_week_carry.sql",
  "018_daily_revenue.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.ads1}', 'Dương', 'ads_staff'),
    ('${U.ads2}', 'An', 'ads_staff');
`);
ok(true, "schema → 018 chạy xong");
const duong = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads1])).id;
const an = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads2])).id;
// TKQC nhân viên tự khai báo: phụ trách từ 01/01/2020 → nhập được ngày cũ.
const d1 = (await as(U.ads1, `select public.add_ad_account('THE DUONG 01', '1111111111', 'rented', 'personal') as id`))[0].id;
const a1 = (await as(U.ads2, `select public.add_ad_account('An 01', '2222222222', 'rented', 'personal') as id`))[0].id;
// TKQC thứ hai của Dương nhưng chỉ phụ trách từ 30 ngày trước.
const d2 = (await as(U.ads1, `select public.add_ad_account('Dương 01', '3333333333', 'rented', 'personal') as id`))[0].id;
await db.query(`update public.ad_account_assignments set from_date = private.today_vn() - 30 where ad_account_id = $1`, [d2]);
const day = async (n) => (await one(`select (private.today_vn() - $1::int)::text as d`, [n])).d;
const D = {};
for (const n of [0, 1, 5, 6, 7, 40, 41, 42, 60]) D[n] = await day(n);
const M = (await one(`select (date_trunc('month', private.today_vn()) - interval '2 month')::date::text as m`)).m;

const rows = (...values) => values.map((v) => `(${v})`).join(", ");
const count = async (table) => (await one(`select count(*)::int n from public.${table}`)).n;

// ---------------------------------------------------------------------------
section("Quản lý nhập nhiều dòng một lượt cho ngày cũ");
let e = await errOf(U.mm, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages) values ${rows(
  `'${D[42]}', '${d1}', 500000, 3`, `'${D[41]}', '${d1}', 400000, 0`, `'${D[40]}', '${a1}', 300000, 2`)}`);
ok(e === null, "Trưởng Marketing thêm 3 dòng chi tiêu TKQC (của Dương và An) cho 40 ngày trước", e);
const r42 = await one(`select spend, messages, data_count, user_id from public.ad_daily_reports where report_date = $1 and ad_account_id = $2`, [D[42], d1]);
ok(Number(r42.spend) === 500000 && r42.messages === 3 && r42.data_count === 0 && r42.user_id === U.mm, "ghi đúng số, data cũ = 0, người gửi = người nhập", r42);
e = await errOf(U.mm, `insert into public.ads_daily_data (report_date, ads_staff_id, data_count, revenue) values ${rows(
  `'${D[42]}', '${duong}', 1, null`, `'${D[41]}', '${duong}', 0, 20150000`, `'${D[40]}', '${an}', 2, null`)}`);
ok(e === null, "thêm 3 dòng Data / doanh thu ngày cho 2 người (doanh thu trống được)", e);
ok(Number((await one(`select revenue from public.ads_daily_data where report_date = $1 and ads_staff_id = $2`, [D[41], duong])).revenue) === 20150000, "doanh thu theo ngày ghi đúng");
e = await errOf(U.owner, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages) values ('${D[60]}', '${d1}', 1000, 1)`);
ok(e === null, "Quản trị cũng nhập được", e);
e = await errOf(U.mm, `insert into public.ad_revenue (month, ads_staff_id, amount) values ${rows(`'${M}', '${duong}', 29650000`, `'${M}', null, 5000000`)}`);
ok(e === null, "thêm doanh thu tháng (một người + chưa rõ nhân viên)", e);

// ---------------------------------------------------------------------------
section("Mỗi lượt được cả hoặc không được gì");
const before = await count("ad_daily_reports");
e = await errOf(U.mm, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages) values ${rows(
  `'${D[7]}', '${d1}', 100, 0`, `'${D[40]}', '${d2}', 100, 0`)}`);
ok(/không có người phụ trách/.test(e ?? ""), "một dòng TKQC chưa ai phụ trách ngày đó → cả lượt bị từ chối", e);
ok((await count("ad_daily_reports")) === before, "… không dòng nào được ghi");
e = await errOf(U.mm, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages) values ${rows(
  `'${D[6]}', '${d1}', 100, 0`, `'${D[42]}', '${d1}', 999, 9`)}`);
ok(/duplicate key|unique/.test(e ?? ""), "ngày + TKQC đã có → cả lượt bị từ chối (không ghi đè)", e);
ok((await count("ad_daily_reports")) === before && Number((await one(`select spend from public.ad_daily_reports where report_date = $1 and ad_account_id = $2`, [D[42], d1])).spend) === 500000, "… số cũ giữ nguyên");
e = await errOf(U.mm, `insert into public.ads_daily_data (report_date, ads_staff_id, data_count) values ${rows(`'${D[5]}', '${duong}', 1`, `'${D[42]}', '${duong}', 7`)}`);
ok(/duplicate key|unique/.test(e ?? ""), "dòng Data đã có → cả lượt bị từ chối", e);
const tomorrow = (await one(`select (private.today_vn() + 1)::text as d`)).d;
e = await errOf(U.mm, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages) values ('${tomorrow}', '${d1}', 100, 0)`);
ok(/chưa tới/.test(e ?? ""), "ngày chưa tới → từ chối", e);
e = await errOf(U.mm, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages) values ('${D[5]}', '${d1}', -1, 0)`);
ok(/check constraint/.test(e ?? ""), "chi tiêu âm → từ chối", e);

// ---------------------------------------------------------------------------
section("Nhân viên không nhập thay người khác");
e = await errOf(U.ads2, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages) values ('${D[5]}', '${d1}', 100, 0)`);
ok(e !== null, "An không thêm được chi tiêu TKQC của Dương", e);
e = await errOf(U.ads2, `insert into public.ads_daily_data (report_date, ads_staff_id, data_count) values ('${D[5]}', '${duong}', 1)`);
ok(e !== null, "An không thêm được Data của Dương", e);
e = await errOf(U.ads2, `insert into public.ad_revenue (month, ads_staff_id, amount) values ('${M}', '${an}', 1)`);
ok(e !== null, "nhân viên Ads không thêm được doanh thu tháng", e);

// ---------------------------------------------------------------------------
section("Nhập nhiều dòng không bị tự khoá tài khoản");
await db.exec(`update public.app_settings set value = '20'::jsonb where key = 'anomaly_max_changes_per_hour'`);
const many = [];
for (let n = 100; n < 160; n++) many.push(`'${await day(n)}', '${d1}', ${n * 1000}, 1`);
e = await errOf(U.mm, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages) values ${rows(...many)}`);
ok(e === null, "thêm 60 dòng một lượt (ngưỡng cảnh báo hạ còn 20)", e);
const mm = await one(`select locked_at from public.staff where user_id = $1`, [U.mm]);
ok(mm.locked_at === null && (await count("security_alerts")) === 0, "thêm mới không tính là sửa / xoá → không cảnh báo, không khoá", mm);
const logged = (await one(`select count(*)::int n from public.audit_log where table_name = 'ad_daily_reports' and action = 'insert' and actor_id = $1`, [U.mm])).n;
ok(logged === 3 + 60, "mỗi dòng nhập đều vào nhật ký", logged);
ok((await all(`select 1 from public.ad_daily_reports where report_date = $1`, [D[1]])).length === 0, "không đụng ngày khác");

finish();
