// Kiểm thử supabase/017_week_carry.sql (quản lý chốt cách dồn phần thiếu của tuần không đạt) trên Postgres chạy
// trong bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  node supabase/tests/week-carry.test.mjs
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "ads1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 014 rồi 017 trên dữ liệu đang có");
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "008_staff_accounts.sql",
  "010_ads_daily_data.sql", "011_sync_ads_staff_name.sql", "012_ad_targets.sql", "013_revenue_avatars.sql",
  "014_monthly_targets.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.ads1}', 'Dương', 'ads_staff');
`);
const duong = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads1])).id;
const ADD = `insert into public.ad_targets (month, ads_staff_id, monthly_budget, monthly_data, max_cost_per_data) values ($1::date, $2, $3, $4, $5) returning *`;
const team = (await as(U.mm, ADD, ["2026-11-01", null, 700000000, 1000, 700000]))[0];
const own = (await as(U.mm, ADD, ["2026-11-01", duong, 230000000, 330, null]))[0];
const before = JSON.stringify(await as(U.owner, `select id, month, ads_staff_id, monthly_budget, monthly_data, max_cost_per_data from public.ad_targets order by id`));

await db.exec(read("017_week_carry.sql"));
ok(true, "017 chạy không lỗi");
await db.exec(read("017_week_carry.sql"));
ok(true, "chạy lại 017 lần hai không lỗi");
const after = JSON.stringify(await as(U.owner, `select id, month, ads_staff_id, monthly_budget, monthly_data, max_cost_per_data from public.ad_targets order by id`));
ok(before === after, "dữ liệu mục tiêu đang có giữ nguyên");
ok((await one(`select week_carry from public.ad_targets where id = $1`, [team.id])).week_carry === null, "dòng cũ: cách dồn để trống (= chia đều)");

// ---------------------------------------------------------------------------
section("Quản lý chốt cách dồn trên dòng Cả nhóm");
await as(U.mm, `update public.ad_targets set week_carry = 'next' where id = $1`, [team.id]);
ok((await one(`select week_carry from public.ad_targets where id = $1`, [team.id])).week_carry === "next", "Trưởng Marketing chốt 'dồn sang tuần sau'");
await as(U.owner, `update public.ad_targets set week_carry = 'spread' where id = $1`, [team.id]);
ok((await one(`select week_carry from public.ad_targets where id = $1`, [team.id])).week_carry === "spread", "Quản trị đổi sang 'chia đều các tuần còn lại'");
const dec = (await as(U.mm, `insert into public.ad_targets (month, ads_staff_id, week_carry) values ('2026-12-01', null, 'next') returning week_carry`))[0];
ok(dec.week_carry === "next", "đặt mới dòng Cả nhóm tháng sau kèm cách dồn");
let e = await errOf(U.mm, `update public.ad_targets set week_carry = 'abc' where id = $1`, [team.id]);
ok(/ad_targets_week_carry_check/.test(e ?? ""), "chỉ nhận 'next' hoặc 'spread'", e);
e = await errOf(U.mm, `update public.ad_targets set week_carry = 'next' where id = $1`, [own.id]);
ok(/ad_targets_week_carry_check/.test(e ?? ""), "dòng của từng nhân viên không có cách dồn riêng (cả công ty một cách)", e);
const res = await as(U.ads1, `update public.ad_targets set week_carry = 'next' where id = $1 returning id`, [team.id]).catch((err) => err);
ok((Array.isArray(res) && res.length === 0) || /permission|row-level/.test(String(res?.message ?? res)), "nhân viên Ads không đổi được", res);
ok((await one(`select week_carry from public.ad_targets where id = $1`, [team.id])).week_carry === "spread", "giá trị vẫn là của quản lý");
const seen = await as(U.ads1, `select week_carry from public.ad_targets where id = $1`, [team.id]);
ok(seen.length === 1 && seen[0].week_carry === "spread", "nhân viên Ads xem được cách dồn đã chốt");

section("Lịch sử chỉnh sửa ghi lại");
const history = await as(U.mm, `select * from public.ad_targets_history(50)`);
const change = history.find((h) => h.action === "update" && h.target_id === team.id && h.new_data?.week_carry === "spread");
ok(change && change.actor_name === "Chủ phòng khám" && change.old_data.week_carry === "next", "ghi ai đổi cách dồn, cũ → mới", change);

finish();
