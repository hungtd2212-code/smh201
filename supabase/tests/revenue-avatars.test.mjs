// Kiểm thử supabase/013_revenue_avatars.sql (doanh thu tháng, ảnh đại diện, bảng vinh danh) trên Postgres
// chạy trong bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "ads1", "ads2", "sale1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 013 trên dữ liệu đang có");
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin'), ('${U.sale1}', 'Telesale 1', 'sale')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "008_staff_accounts.sql",
  "010_ads_daily_data.sql", "011_sync_ads_staff_name.sql", "012_ad_targets.sql"]) {
  await db.exec(read(file));
}
await db.exec(read("012_ad_targets.sql"));
ok(true, "012 (bản có mục tiêu doanh thu) chạy lại lần hai không lỗi");
ok((await all(`select column_name from information_schema.columns where table_name = 'ad_targets' and column_name in ('monthly_revenue', 'max_ad_revenue_pct')`)).length === 2, "ad_targets có thêm doanh thu mục tiêu, tỉ lệ ads / doanh thu tối đa");
await db.exec(`
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.ads1}', 'Dương', 'ads_staff'),
    ('${U.ads2}', 'An', 'ads_staff');
`);
const duong = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads1])).id;
const an = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads2])).id;
const staffBefore = await all(`select to_jsonb(s) j from public.staff s order by user_id`);
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;

await db.exec(read("013_revenue_avatars.sql"));
ok(true, "013 chạy không lỗi");
await db.exec(read("013_revenue_avatars.sql"));
ok(true, "chạy lại 013 lần hai không lỗi");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "chạy 013 không sửa dữ liệu cũ (không ghi nhật ký)");
const staffAfter = await all(`select to_jsonb(s) - 'avatar_url' j from public.staff s order by user_id`);
ok(JSON.stringify(staffAfter) === JSON.stringify(staffBefore), "tài khoản đang có giữ nguyên từng cột (chỉ thêm cột ảnh, để trống)");

// ---------------------------------------------------------------------------
section("Doanh thu tháng");
const ADD = `insert into public.ad_revenue (month, ads_staff_id, amount) values ($1::date, $2, $3) returning *`;
const r1 = (await as(U.mm, ADD, ["2026-11-15", duong, 50000000]))[0];
ok(r1.month.toISOString().slice(0, 10) === "2026-11-01" && r1.updated_by === U.mm, "Trưởng Marketing nhập doanh thu; ngày tự về đầu tháng", r1.month);
ok((await one(`select actor_id from public.audit_log where table_name = 'ad_revenue' order by id desc limit 1`)).actor_id === U.mm, "… vào nhật ký");
let e = await errOf(U.owner, ADD, ["2026-11-01", duong, 1]);
ok(/ad_revenue_month_staff_key|duplicate/.test(e ?? ""), "mỗi nhân viên mỗi tháng một dòng", e);
ok((await as(U.owner, ADD, ["2026-11-01", null, 7000000])).length === 1, "Quản trị nhập dòng chưa rõ nhân viên");
e = await errOf(U.owner, ADD, ["2026-11-01", null, 1]);
ok(/ad_revenue_month_unassigned_key|duplicate/.test(e ?? ""), "mỗi tháng một dòng chưa rõ nhân viên", e);
await as(U.mm, ADD, ["2026-11-01", an, 20000000]);
e = await errOf(U.ads1, ADD, ["2026-10-01", duong, 1]);
ok(/row-level security/.test(e ?? ""), "nhân viên Ads không tự nhập doanh thu", e);
e = await errOf(U.mm, ADD, ["2026-10-01", duong, -5]);
ok(/check constraint/.test(e ?? ""), "doanh thu âm → bị từ chối", e);
await as(U.mm, `update public.ad_revenue set amount = 55000000 where id = $1`, [r1.id]);
ok(Number((await one(`select amount from public.ad_revenue where id = $1`, [r1.id])).amount) === 55000000, "quản lý sửa được");
e = await errOf(U.mm, `update public.ad_revenue set month = '2026-10-01' where id = $1`, [r1.id]);
ok(/permission denied/.test(e ?? ""), "không đổi tháng của doanh thu đã nhập", e);
e = await errOf(U.owner, `delete from public.ad_revenue where id = $1`, [r1.id]);
ok(/permission denied/.test(e ?? ""), "không ai xoá được", e);
const seen = async (uid) => (await as(uid, `select ads_staff_id from public.ad_revenue`)).map((x) => x.ads_staff_id);
ok((await seen(U.mm)).length === 3, "quản lý thấy tất cả");
ok(JSON.stringify(await seen(U.ads1)) === JSON.stringify([duong]), "nhân viên chỉ thấy doanh thu của mình");
ok((await seen(U.sale1)).length === 0, "telesale không thấy");

// ---------------------------------------------------------------------------
section("Ảnh đại diện");
const URL = "https://abc.supabase.co/storage/v1/object/public/avatars/" + U.ads1 + "/1.jpg";
await as(U.owner, `select public.set_staff_avatar($1, $2)`, [U.ads1, URL]);
ok((await one(`select avatar_url from public.staff where user_id = $1`, [U.ads1])).avatar_url === URL, "Quản trị đặt ảnh cho nhân viên");
await as(U.ads2, `select public.set_staff_avatar($1, $2)`, [U.ads2, URL.replace(U.ads1, U.ads2)]);
ok((await one(`select avatar_url from public.staff where user_id = $1`, [U.ads2])).avatar_url !== null, "mỗi người tự đặt ảnh của mình");
e = await errOf(U.ads2, `select public.set_staff_avatar($1, $2)`, [U.ads1, null]);
ok(/Chỉ Quản trị hoặc chính người đó/.test(e ?? ""), "không đổi ảnh của người khác", e);
e = await errOf(U.owner, `select public.set_staff_avatar($1, $2)`, [U.ads1, "https://evil.example/x.jpg"]);
ok(/không hợp lệ/.test(e ?? ""), "chỉ nhận ảnh trong kho avatars", e);
e = await errOf(U.ads1, `update public.staff set avatar_url = null where user_id = $1`, [U.ads1]);
ok(/permission denied/.test(e ?? ""), "không sửa thẳng cột ảnh (phải qua hàm)", e);
await as(U.owner, `select public.set_staff_avatar($1, null)`, [U.ads1]);
ok((await one(`select avatar_url from public.staff where user_id = $1`, [U.ads1])).avatar_url === null, "bỏ ảnh được");

// ---------------------------------------------------------------------------
section("Bảng vinh danh");
// TKQC A: Dương cầm tới 10/11, sau đó An. TKQC B: An cầm.
const A = (await as(U.ads1, `select public.add_ad_account('Dương 01', '1111111111', 'rented', 'personal') as id`))[0].id;
const B = (await as(U.ads2, `select public.add_ad_account('An 01', '2222222222', 'rented', 'personal') as id`))[0].id;
await db.exec(`set session_replication_role = replica`);
await db.query(`update public.ad_account_assignments set to_date = '2026-11-10' where ad_account_id = $1`, [A]);
await db.query(`insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date) values ($1, $2, '2026-11-11')`, [A, an]);
await db.query(`insert into public.ad_daily_reports (report_date, ad_account_id, user_id, spend, messages, data_count) values
  ('2026-11-01', $1, $3, 1000000, 20, 4),   -- Dương; ngày này có dòng Data chung → bỏ data 4
  ('2026-11-02', $1, $3, 500000, 10, 3),    -- Dương; báo cáo cũ, chưa có dòng chung → tính 3
  ('2026-11-11', $1, $4, 700000, 7, 0),     -- An (TKQC A đã đổi người)
  ('2026-11-11', $2, $4, 300000, 3, 0),     -- An
  ('2026-10-31', $1, $3, 999999, 9, 9)      -- tháng trước, không tính`, [A, B, U.ads1, U.ads2]);
await db.query(`insert into public.ads_daily_data (report_date, ads_staff_id, data_count, user_id) values
  ('2026-11-01', $1, 6, $3), ('2026-11-11', $2, 5, $4)`, [duong, an, U.ads1, U.ads2]);
await db.exec(`set session_replication_role = origin`);
await as(U.mm, `insert into public.ad_targets (ads_staff_id, monthly_data, max_cost_per_data) values ($1, 20, 200000), (null, null, 150000)`, [an]);

const LB = `select * from public.ads_leaderboard('2026-11-20')`;
const board = Object.fromEntries((await as(U.ads1, LB)).map((r) => [r.full_name, r]));
ok(Number(board["Dương"].spend) === 1500000 && Number(board["Dương"].messages) === 30, "Dương: chi tiêu, mess của tháng (không tính tháng trước)", board["Dương"]);
ok(Number(board["Dương"].data_count) === 9, "Dương: data = 6 (dòng chung) + 3 (báo cáo cũ)", board["Dương"].data_count);
ok(Number(board["An"].spend) === 1000000 && Number(board["An"].data_count) === 5, "An: TKQC đổi người tính cho người cầm ngày đó", board["An"]);
ok(Number(board["Dương"].revenue) === 55000000 && Number(board["An"].revenue) === 20000000, "doanh thu từng người (không tính dòng chưa rõ nhân viên)");
ok(board["An"].data_target === 20 && board["An"].max_cost_per_data === 200000, "mục tiêu riêng của An");
ok(board["Dương"].data_target === null && board["Dương"].max_cost_per_data === 150000, "Dương chưa có mục tiêu riêng → giá data tối đa của cả nhóm");
ok((await as(U.mm, LB)).length === 2, "Trưởng Marketing xem được");
e = await errOf(U.sale1, LB);
ok(/bảng vinh danh/.test(e ?? ""), "telesale không xem được", e);

finish();
