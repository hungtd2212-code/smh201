// Kiểm thử supabase/018_daily_revenue.sql ("Doanh thu theo ngày" bên cạnh "Data xin được") trên Postgres chạy
// trong bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  node supabase/tests/daily-revenue.test.mjs
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "ads1", "ads2"]) U[name] = await addUser(name);

section("Chạy schema.sql → 017 rồi 018 trên dữ liệu đang có");
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "008_staff_accounts.sql",
  "010_ads_daily_data.sql", "011_sync_ads_staff_name.sql", "012_ad_targets.sql", "013_revenue_avatars.sql",
  "014_monthly_targets.sql", "015_telesale_positions.sql", "016_lead_ads_runs_ads.sql", "017_week_carry.sql"]) {
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
const D = {};
for (const row of await all(`select g, (private.today_vn() - g)::text as d from generate_series(0, 3) g`)) D[row.g] = row.d;
// Hai ngày chắc chắn cùng một tháng, đã qua: ngày 1 và ngày 2 của tháng trước.
const P = (await one(`select (date_trunc('month', private.today_vn()) - interval '1 month')::date::text as m`)).m;
const P2 = (await one(`select ($1::date + 1)::text as d`, [P])).d;

// Dữ liệu đang có trước 018.
const OLD = `insert into public.ads_daily_data (report_date, ads_staff_id, data_count) values ($1::date, $2, $3) returning *`;
const old1 = (await as(U.ads1, OLD, [D[1], duong, 5]))[0];
const old2 = (await as(U.mm, OLD, [D[1], an, 4]))[0];
const snapshot = async () => JSON.stringify(await all(`select id, report_date, ads_staff_id, data_count, user_id, submitted_at, updated_at, updated_by from public.ads_daily_data order by id`));
const before = await snapshot();
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;

await db.exec(read("018_daily_revenue.sql"));
ok(true, "018 chạy không lỗi");
await db.exec(read("018_daily_revenue.sql"));
ok(true, "chạy lại 018 lần hai không lỗi");
ok((await snapshot()) === before, "dữ liệu Data xin được đang có giữ nguyên");
ok((await all(`select revenue from public.ads_daily_data`)).every((r) => r.revenue === null), "dòng cũ: doanh thu để trống");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "chạy 018 không sửa dữ liệu cũ (không ghi nhật ký)");

// ---------------------------------------------------------------------------
section("Gửi kèm doanh thu theo ngày (không bắt buộc)");
const SEND = `insert into public.ads_daily_data (report_date, ads_staff_id, data_count, revenue) values ($1::date, $2, $3, $4) returning *`;
const row = (await as(U.ads1, SEND, [D[0], duong, 3, 2000000]))[0];
ok(Number(row.revenue) === 2000000 && row.data_count === 3, "nhân viên gửi Data kèm doanh thu", row);
const noRev = (await as(U.ads2, OLD, [D[0], an, 2]))[0];
ok(noRev.revenue === null, "không nhập doanh thu vẫn gửi được (để trống)");
let e = await errOf(U.ads1, SEND, [D[2], duong, 1, -5]);
ok(/check constraint/.test(e ?? ""), "doanh thu âm → bị từ chối", e);
ok((await one(`select action, new_data->>'revenue' as rev from public.audit_log where table_name = 'ads_daily_data' order by id desc limit 1`)).action === "insert", "… vào nhật ký");

// ---------------------------------------------------------------------------
section("Bổ sung / sửa doanh thu ở Tổng quan trong 24 giờ");
const EDIT = `update public.ads_daily_data set data_count = $2, revenue = $3 where id = $1 returning *`;
await as(U.ads1, EDIT, [old1.id, 5, 1500000]);
let cur = await one(`select data_count, revenue, submitted_at, updated_at, updated_by from public.ads_daily_data where id = $1`, [old1.id]);
ok(Number(cur.revenue) === 1500000 && cur.data_count === 5 && cur.updated_by === U.ads1, "chỉ thêm doanh thu (data giữ nguyên) vẫn tính là sửa", cur);
ok(cur.submitted_at.getTime() === old1.submitted_at.getTime(), "mốc 24 giờ không đổi");
const lastAudit = await one(`select old_data->>'revenue' as o, new_data->>'revenue' as n, actor_id from public.audit_log where table_name = 'ads_daily_data' order by id desc limit 1`);
ok(lastAudit.o === null && lastAudit.n === "1500000" && lastAudit.actor_id === U.ads1, "nhật ký ghi doanh thu trống → mới", lastAudit);
const stamp = cur.updated_at.getTime();
await as(U.ads1, EDIT, [old1.id, 5, 1500000]);
ok((await one(`select updated_at from public.ads_daily_data where id = $1`, [old1.id])).updated_at.getTime() === stamp, "lưu lại y nguyên → không tính là sửa");
await as(U.ads1, EDIT, [old1.id, 5, null]);
ok((await one(`select revenue from public.ads_daily_data where id = $1`, [old1.id])).revenue === null, "xoá trắng doanh thu được (trong 24 giờ)");
ok((await as(U.ads2, EDIT, [old1.id, 5, 9])).length === 0, "nhân viên khác không sửa được");

await db.exec(`set session_replication_role = replica`);
await db.query(`update public.ads_daily_data set submitted_at = now() - interval '25 hours' where id = $1`, [old1.id]);
await db.exec(`set session_replication_role = origin`);
e = await errOf(U.ads1, EDIT, [old1.id, 5, 700000]);
ok(e === "Báo cáo đã quá 24 giờ, không thể sửa", "quá 24 giờ: nhân viên thêm doanh thu → database từ chối", e);
await as(U.mm, EDIT, [old1.id, 5, 700000]);
ok(Number((await one(`select revenue from public.ads_daily_data where id = $1`, [old1.id])).revenue) === 700000, "Trưởng Marketing sửa được bất kỳ lúc nào");
await as(U.owner, EDIT, [old2.id, 4, 300000]);
ok(Number((await one(`select revenue from public.ads_daily_data where id = $1`, [old2.id])).revenue) === 300000, "Quản trị sửa được");
for (const uid of [U.ads1, U.mm, U.owner]) {
  e = await errOf(uid, `delete from public.ads_daily_data where id = $1`, [old1.id]);
  ok(/permission denied/.test(e ?? ""), "xoá → bị từ chối", e);
}

// ---------------------------------------------------------------------------
section("Bảng vinh danh: số quản lý nhập là chính, chưa nhập thì cộng doanh thu theo ngày");
await as(U.mm, SEND, [P, duong, 4, 1000000]);
await as(U.mm, SEND, [P2, duong, 6, 2500000]);
await as(U.mm, SEND, [P, an, 2, 4000000]);
await as(U.mm, OLD, [P2, an, 1]);
const board = async () => Object.fromEntries((await as(U.ads1, `select * from public.ads_leaderboard($1::date)`, [P])).map((r) => [r.full_name, r]));
// Hôm nay là mùng 1 thì "hôm qua" (700k của Dương) rơi vào tháng trước.
const extra = D[1].slice(0, 7) === P.slice(0, 7) ? 700000 : 0;
let b = await board();
ok(Number(b["Dương"].revenue) === 3500000 + extra, "Dương chưa có số quản lý → cộng doanh thu ngày (1tr + 2,5tr)", b["Dương"]);
ok(Number(b["An"].revenue) === 4000000, "ngày để trống không tính (An = 4tr)", b["An"]);
ok(Number(b["Dương"].data_count) === 10 && Number(b["An"].data_count) === 3, "số data vẫn cộng như cũ");
const ADD = `insert into public.ad_revenue (month, ads_staff_id, amount) values ($1::date, $2, $3) returning *`;
const monthly = (await as(U.mm, ADD, [P, an, 10000000]))[0];
b = await board();
ok(Number(b["An"].revenue) === 10000000, "quản lý nhập doanh thu tháng → dùng số quản lý, không cộng thêm số ngày", b["An"]);
ok(Number(b["Dương"].revenue) === 3500000 + extra, "người khác không ảnh hưởng");
await as(U.mm, `update public.ad_revenue set amount = 0 where id = $1`, [monthly.id]);
b = await board();
ok(Number(b["An"].revenue) === 4000000, "quản lý xoá trắng (= 0) → quay về cộng doanh thu ngày", b["An"]);
const other = Object.fromEntries((await as(U.mm, `select * from public.ads_leaderboard($1::date)`, [D[0]])).map((r) => [r.full_name, r]));
ok(Number(other["Dương"].revenue) === 2000000 + (extra ? 0 : 700000), "tháng này tính riêng, không lẫn tháng trước", other["Dương"]);

finish();
