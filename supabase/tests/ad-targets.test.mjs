// Kiểm thử supabase/012_ad_targets.sql (mục tiêu quảng cáo) trên Postgres chạy trong bộ nhớ.
// Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "ads1", "ads2", "sale1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 012 trên dữ liệu đang có");
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin'), ('${U.sale1}', 'Telesale 1', 'sale')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "010_ads_daily_data.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.ads1}', 'Dương', 'ads_staff'),
    ('${U.ads2}', 'An', 'ads_staff');
`);
const duong = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads1])).id;
const an = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads2])).id;
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;
const tablesBefore = (await all(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).map((r) => r.table_name);

await db.exec(read("012_ad_targets.sql"));
ok(true, "012 chạy không lỗi");
await db.exec(read("012_ad_targets.sql"));
ok(true, "chạy lại 012 lần hai không lỗi");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "chạy 012 không sửa dữ liệu cũ (không ghi nhật ký)");
const tablesAfter = (await all(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).map((r) => r.table_name);
ok(tablesAfter.length === tablesBefore.length + 1 && tablesAfter.includes("ad_targets"), "chỉ thêm đúng 1 bảng ad_targets");

// ---------------------------------------------------------------------------
section("Đặt mục tiêu");
const ADD = `insert into public.ad_targets (ads_staff_id, monthly_budget, monthly_data, max_cost_per_message, max_cost_per_data) values ($1, $2, $3, $4, $5) returning *`;
const team = (await as(U.mm, ADD, [null, 300000000, 1500, 60000, 150000]))[0];
ok(team.monthly_budget == 300000000 && team.updated_by === U.mm, "Trưởng Marketing đặt mục tiêu cả nhóm", team);
ok((await one(`select actor_id from public.audit_log where table_name = 'ad_targets' order by id desc limit 1`)).actor_id === U.mm, "… vào nhật ký");
let e = await errOf(U.owner, ADD, [null, 1, 1, 1, 1]);
ok(/ad_targets_team_key|duplicate/.test(e ?? ""), "chỉ một dòng cả nhóm", e);
const mine = (await as(U.owner, ADD, [duong, 100000000, null, null, 140000]))[0];
ok(mine.monthly_data === null && mine.max_cost_per_data === 140000, "Quản trị đặt mục tiêu riêng cho nhân viên, ô trống = không đặt", mine);
e = await errOf(U.mm, ADD, [duong, 1, 1, 1, 1]);
ok(/ad_targets_staff_key|duplicate/.test(e ?? ""), "mỗi nhân viên một dòng", e);
e = await errOf(U.ads1, ADD, [an, 1, 1, 1, 1]);
ok(/row-level security/.test(e ?? ""), "nhân viên Ads không tự đặt mục tiêu", e);
e = await errOf(U.mm, ADD, [an, -1, null, null, null]);
ok(/check constraint/.test(e ?? ""), "số âm → bị từ chối", e);

section("Sửa, không xoá");
await as(U.mm, `update public.ad_targets set max_cost_per_data = 130000 where id = $1`, [team.id]);
ok((await one(`select max_cost_per_data from public.ad_targets where id = $1`, [team.id])).max_cost_per_data === 130000, "quản lý sửa được");
ok((await as(U.ads1, `update public.ad_targets set max_cost_per_data = 1 where id = $1 returning id`, [mine.id])).length === 0, "nhân viên Ads không sửa được (kể cả dòng của mình)");
e = await errOf(U.mm, `update public.ad_targets set ads_staff_id = $2 where id = $1`, [mine.id, an]);
ok(/permission denied/.test(e ?? ""), "không đổi mục tiêu sang người khác", e);
for (const uid of [U.mm, U.owner]) {
  e = await errOf(uid, `delete from public.ad_targets where id = $1`, [team.id]);
  ok(/permission denied/.test(e ?? ""), "xoá → bị từ chối", e);
}

section("Ai xem được");
const seen = async (uid) => (await as(uid, `select ads_staff_id from public.ad_targets`)).map((x) => x.ads_staff_id);
ok((await seen(U.mm)).length === 2 && (await seen(U.owner)).length === 2, "quản lý thấy tất cả");
const s1 = await seen(U.ads1);
ok(s1.length === 2 && s1.includes(null) && s1.includes(duong), "nhân viên thấy dòng cả nhóm + của mình", s1);
const s2 = await seen(U.ads2);
ok(s2.length === 1 && s2[0] === null, "nhân viên khác chỉ thấy dòng cả nhóm", s2);
ok((await seen(U.sale1)).length === 0, "telesale không thấy");

finish();
