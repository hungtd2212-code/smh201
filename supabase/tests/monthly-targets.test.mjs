// Kiểm thử supabase/014_monthly_targets.sql (mục tiêu theo tháng, lịch sử sửa) trên Postgres chạy trong bộ nhớ.
// Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "ads1", "ads2", "sale1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 014 trên dữ liệu đang có");
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin'), ('${U.sale1}', 'Telesale 1', 'sale')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "008_staff_accounts.sql",
  "010_ads_daily_data.sql", "011_sync_ads_staff_name.sql", "012_ad_targets.sql", "013_revenue_avatars.sql"]) {
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
// Một dòng mục tiêu đặt trước khi có 014 (không có tháng).
const old = (await as(U.mm, `insert into public.ad_targets (ads_staff_id, monthly_data) values ($1, 30) returning id, created_at`, [duong]))[0];

await db.exec(read("014_monthly_targets.sql"));
ok(true, "014 chạy không lỗi");
await db.exec(read("014_monthly_targets.sql"));
ok(true, "chạy lại 014 lần hai không lỗi");
const kept = await one(`select month::text, monthly_data from public.ad_targets where id = $1`, [old.id]);
ok(kept.monthly_data === 30 && kept.month.endsWith("-01"), "dòng cũ giữ nguyên số, được gán vào tháng nó được tạo", kept);
// Dời dòng cũ về tháng 8 để các phép thử bên dưới không đụng tháng hiện tại.
await db.exec(`set session_replication_role = replica`);
await db.query(`update public.ad_targets set month = '2026-08-01' where id = $1`, [old.id]);
await db.exec(`set session_replication_role = origin`);

// ---------------------------------------------------------------------------
section("Mỗi tháng một bộ mục tiêu");
const ADD = `insert into public.ad_targets (month, ads_staff_id, monthly_budget, monthly_data, max_cost_per_data) values ($1::date, $2, $3, $4, $5) returning *`;
const oct = (await as(U.mm, ADD, ["2026-10-20", null, 200000000, 1000, 160000]))[0];
ok(oct.month.toISOString().slice(0, 10) === "2026-10-01", "ngày tự về đầu tháng", oct.month);
ok((await as(U.mm, ADD, ["2026-11-01", null, 300000000, 1500, 150000])).length === 1, "tháng khác đặt được dòng cả nhóm mới");
let e = await errOf(U.owner, ADD, ["2026-11-01", null, 1, 1, 1]);
ok(/ad_targets_team_month_key|duplicate/.test(e ?? ""), "mỗi tháng một dòng cả nhóm", e);
ok((await as(U.mm, ADD, ["2026-11-01", duong, 100000000, 500, null])).length === 1, "nhân viên có mục tiêu riêng từng tháng");
e = await errOf(U.mm, ADD, ["2026-11-01", duong, 1, 1, 1]);
ok(/ad_targets_staff_month_key|duplicate/.test(e ?? ""), "mỗi nhân viên mỗi tháng một dòng", e);
e = await errOf(U.mm, `update public.ad_targets set month = '2026-12-01' where id = $1`, [oct.id]);
ok(/permission denied/.test(e ?? ""), "không đổi được tháng của mục tiêu đã đặt", e);
e = await errOf(U.ads1, ADD, ["2026-12-01", duong, 1, 1, 1]);
ok(/row-level security/.test(e ?? ""), "nhân viên Ads không tự đặt", e);
await as(U.owner, `update public.ad_targets set max_cost_per_data = 140000 where id = $1`, [oct.id]);
ok((await one(`select max_cost_per_data from public.ad_targets where id = $1`, [oct.id])).max_cost_per_data === 140000, "quản lý sửa được");

section("Lịch sử chỉnh sửa");
const history = await as(U.mm, `select * from public.ad_targets_history(50)`);
const edit = history.find((h) => h.action === "update" && h.target_id === oct.id);
ok(edit && edit.actor_name === "Chủ phòng khám" && edit.old_data.max_cost_per_data === 160000 && edit.new_data.max_cost_per_data === 140000,
  "ghi ai sửa, số cũ → số mới", edit);
ok(history.filter((h) => h.action === "insert").length >= 4 && history[0].id > history.at(-1).id, "có cả lần đặt mới, mới nhất trước");
ok(history.some((h) => h.action === "insert" && h.actor_name === "Trưởng Marketing" && h.month?.toISOString().slice(0, 10) === "2026-11-01"), "biết tháng và người đặt");
e = await errOf(U.ads1, `select * from public.ad_targets_history(50)`);
ok(/lịch sử mục tiêu/.test(e ?? ""), "nhân viên Ads không xem lịch sử", e);

section("Bảng vinh danh dùng mục tiêu của tháng");
await as(U.mm, ADD, ["2026-10-01", an, null, 40, null]);
const board = async (m) => Object.fromEntries((await as(U.ads1, `select * from public.ads_leaderboard($1::date)`, [m])).map((r) => [r.full_name, r]));
let b = await board("2026-11-15");
ok(b["Dương"].data_target === 500 && b["Dương"].max_cost_per_data === 150000, "tháng 11: mục tiêu riêng tháng 11 + giá tối đa cả nhóm tháng 11", b["Dương"]);
ok(b["An"].data_target === 40 && b["An"].max_cost_per_data === 150000, "An chưa đặt tháng 11 → dùng tháng gần nhất trước đó (tháng 10)", b["An"]);
b = await board("2026-12-01");
ok(b["Dương"].data_target === 500, "tháng 12 chưa đặt → dùng tháng 11");
b = await board("2026-09-01");
ok(b["Dương"].data_target === 30, "tháng 9 → dùng mục tiêu tháng 8");
b = await board("2026-07-01");
ok(b["Dương"].data_target === null && b["An"].data_target === null, "trước tháng đặt mục tiêu đầu tiên → chưa có mục tiêu");

finish();
