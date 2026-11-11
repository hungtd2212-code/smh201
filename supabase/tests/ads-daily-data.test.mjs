// Kiểm thử supabase/010_ads_daily_data.sql ("Data xin được" ghi chung cho mỗi ngày, mỗi nhân viên Ads)
// trên Postgres chạy trong bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "ads1", "ads2", "sale1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 010 trên dữ liệu đang có");
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin'), ('${U.sale1}', 'Telesale 1', 'sale')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql"]) {
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
for (const row of await all(`select g, (private.today_vn() - g)::text as d from generate_series(-1, 5) g`)) D[row.g] = row.d;

// Báo cáo TKQC cũ (trước 010) có ô data riêng — phải giữ nguyên.
const acc = (await as(U.ads1, `select public.add_ad_account('Dương 01', '1111111111', 'rented', 'personal') as id`))[0].id;
const old = (await as(U.ads1, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages, data_count) values ($1::date, $2, 500000, 5, 2) returning id`, [D[2], acc]))[0].id;
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;

await db.exec(read("010_ads_daily_data.sql"));
ok(true, "010 chạy không lỗi");
await db.exec(read("010_ads_daily_data.sql"));
ok(true, "chạy lại 010 lần hai không lỗi");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "chạy 010 không sửa dữ liệu cũ (không ghi nhật ký)");
ok((await one(`select data_count from public.ad_daily_reports where id = $1`, [old])).data_count === 2, "báo cáo TKQC cũ giữ nguyên số data");
const r = (await as(U.ads1, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages) values ($1::date, $2, 300000, 4) returning data_count`, [D[1], acc]))[0];
ok(r.data_count === 0, "báo cáo TKQC mới không cần ô data (mặc định 0)", r);

// ---------------------------------------------------------------------------
section("Gửi Data xin được chung cho cả ngày");
const SEND = `insert into public.ads_daily_data (report_date, ads_staff_id, data_count) values ($1::date, $2, $3) returning *`;
const row = (await as(U.ads1, SEND, [D[1], duong, 7]))[0];
ok(row.data_count === 7 && row.user_id === U.ads1 && row.submitted_at, "nhân viên gửi được số data của mình, hệ thống ghi người gửi / lúc gửi", row);
ok((await one(`select action, actor_id from public.audit_log where table_name = 'ads_daily_data' order by id desc limit 1`)).actor_id === U.ads1, "… vào nhật ký");
ok((await as(U.ads1, SEND, [D[0], duong, 0])).length === 1, "gửi số 0 được");
let e = await errOf(U.ads1, SEND, [D[1], duong, 9]);
ok(/ads_daily_data_day_staff_key|duplicate/.test(e ?? ""), "mỗi (ngày, nhân viên) chỉ gửi một lần", e);
e = await errOf(U.ads1, SEND, [D[-1], duong, 1]);
ok(/ngày chưa tới/.test(e ?? ""), "không gửi cho ngày mai", e);
e = await errOf(U.ads1, SEND, [D[1], an, 1]);
ok(/chính mình/.test(e ?? ""), "không gửi cho người khác", e);
e = await errOf(U.ads1, SEND, [D[3], duong, -1]);
ok(/check constraint/.test(e ?? ""), "số âm → bị từ chối", e);
e = await errOf(U.sale1, SEND, [D[3], duong, 1]);
ok(/chính mình|row-level security/.test(e ?? ""), "telesale gửi → bị từ chối", e);
ok((await as(U.mm, SEND, [D[1], an, 4])).length === 1, "Trưởng Marketing gửi thay được");
e = await errOf(U.ads1, `insert into public.ads_daily_data (report_date, ads_staff_id, data_count, submitted_at) values ($1::date, $2, 1, now() + interval '9 days')`, [D[3], duong]);
ok(/permission denied/.test(e ?? ""), "tự đặt mốc giờ gửi → bị từ chối", e);

// ---------------------------------------------------------------------------
section("Sửa trong 24 giờ, không ai xoá");
const EDIT = `update public.ads_daily_data set data_count = $2 where id = $1 returning *`;
await as(U.ads1, EDIT, [row.id, 8]);
let cur = await one(`select data_count, submitted_at, updated_by from public.ads_daily_data where id = $1`, [row.id]);
ok(cur.data_count === 8 && cur.submitted_at.getTime() === row.submitted_at.getTime() && cur.updated_by === U.ads1, "trong 24 giờ sửa được, mốc gửi không đổi", cur);
await db.exec(`set session_replication_role = replica`);
await db.query(`update public.ads_daily_data set submitted_at = now() - interval '25 hours' where id = $1`, [row.id]);
await db.exec(`set session_replication_role = origin`);
e = await errOf(U.ads1, EDIT, [row.id, 9]);
ok(e === "Báo cáo đã quá 24 giờ, không thể sửa", "quá 24 giờ: nhân viên sửa → database từ chối", e);
await as(U.mm, EDIT, [row.id, 10]);
ok((await one(`select data_count from public.ads_daily_data where id = $1`, [row.id])).data_count === 10, "Trưởng Marketing sửa được bất kỳ lúc nào");
ok((await as(U.ads2, EDIT, [row.id, 1])).length === 0, "nhân viên khác không sửa được");
for (const uid of [U.ads1, U.mm, U.owner]) {
  e = await errOf(uid, `delete from public.ads_daily_data where id = $1`, [row.id]);
  ok(/permission denied/.test(e ?? ""), "xoá → bị từ chối", e);
}

section("Ai xem được của ai");
const seen = async (uid) => (await as(uid, `select ads_staff_id from public.ads_daily_data`)).map((x) => x.ads_staff_id);
ok((await seen(U.ads1)).every((id) => id === duong), "nhân viên chỉ thấy số của mình");
ok((await seen(U.ads2)).length === 1 && (await seen(U.ads2))[0] === an, "… kể cả số Trưởng Marketing nhập thay");
ok(new Set(await seen(U.mm)).size === 2 && new Set(await seen(U.owner)).size === 2, "quản lý thấy tất cả");
ok((await seen(U.sale1)).length === 0, "telesale không thấy");

finish();
