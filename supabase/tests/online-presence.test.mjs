// Kiểm thử supabase/019_online_presence.sql (ai đang online) trên Postgres chạy trong bộ nhớ.
// Không đụng tới cơ sở dữ liệu thật. Schema `realtime` của Supabase được giả lập tối thiểu:
// bảng realtime.messages và hàm realtime.topic() đọc tên kênh đang xin vào.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "sale1", "ads1", "locked", "stranger"]) U[name] = await addUser(name);

section("Chạy schema.sql → 018 rồi 019 trên dữ liệu đang có");
await db.exec(`
  create schema realtime;
  create table realtime.messages (
    id bigserial primary key, topic text not null, extension text not null,
    payload jsonb, event text, private boolean default true);
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$
    select nullif(current_setting('realtime.topic', true), '')::text $$;
  grant usage on schema realtime to anon, authenticated;
  grant select, insert on realtime.messages to anon, authenticated;
  grant usage on sequence realtime.messages_id_seq to anon, authenticated;
  grant execute on function realtime.topic() to anon, authenticated;
`);
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin'), ('${U.sale1}', 'Telesale 1', 'sale')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "008_staff_accounts.sql",
  "010_ads_daily_data.sql", "011_sync_ads_staff_name.sql", "012_ad_targets.sql", "013_revenue_avatars.sql",
  "014_monthly_targets.sql", "015_telesale_positions.sql", "016_lead_ads_runs_ads.sql", "017_week_carry.sql",
  "018_daily_revenue.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  insert into public.staff (user_id, full_name, role) values
    ('${U.ads1}', 'Dương', 'ads_staff'),
    ('${U.locked}', 'Người bị khoá', 'sale');
  update public.staff set locked_at = now(), locked_reason = 'thử' where user_id = '${U.locked}';
`);
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;
const staffBefore = JSON.stringify((await db.query(`select to_jsonb(s) j from public.staff s order by user_id`)).rows);

await db.exec(read("019_online_presence.sql"));
ok(true, "019 chạy không lỗi");
await db.exec(read("019_online_presence.sql"));
ok(true, "chạy lại 019 lần hai không lỗi");
ok((await one(`select count(*)::int n from pg_policies where schemaname = 'realtime' and policyname like 'smh_online_%'`)).n === 2, "đúng 2 quy tắc, chạy lại không nhân đôi");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "không ghi nhật ký (không sửa dữ liệu)");
ok(JSON.stringify((await db.query(`select to_jsonb(s) j from public.staff s order by user_id`)).rows) === staffBefore, "tài khoản giữ nguyên từng cột");

// ---------------------------------------------------------------------------
section("Ai vào được kênh smh-online");
const TRACK = `insert into realtime.messages (topic, extension, event) values ('smh-online', $1, 'track') returning id`;
const READ = `select count(*)::int n from realtime.messages where extension = 'presence'`;
await db.exec(`insert into realtime.messages (topic, extension) values ('smh-online', 'presence')`);
const onTopic = async (topic, run) => {
  await db.exec(`set realtime.topic = '${topic}'`);
  try {
    return await run();
  } finally {
    await db.exec(`reset realtime.topic`);
  }
};

await onTopic("smh-online", async () => {
  ok((await as(U.sale1, TRACK, ["presence"])).length === 1, "Telesale báo mình đang online");
  ok((await as(U.ads1, TRACK, ["presence"])).length === 1, "nhân viên Ads báo mình đang online");
  ok((await as(U.owner, READ))[0].n >= 1, "Quản trị xem được ai đang online");
  ok((await as(U.sale1, READ))[0].n >= 1, "Telesale cũng xem được");

  let e = await errOf(U.locked, TRACK, ["presence"]);
  ok(/row-level security/.test(e ?? ""), "tài khoản bị khoá không vào được", e);
  ok((await as(U.locked, READ))[0].n === 0, "… và không thấy ai");
  e = await errOf(U.stranger, TRACK, ["presence"]);
  ok(/row-level security/.test(e ?? ""), "đăng nhập nhưng không phải nhân viên → không vào được", e);
  ok((await as(U.stranger, READ))[0].n === 0, "… và không thấy ai");

  e = await errOf(U.sale1, TRACK, ["broadcast"]);
  ok(/row-level security/.test(e ?? ""), "chỉ mở phần báo online, không mở gửi tin (broadcast)", e);
});

await onTopic("kenh-khac", async () => {
  const e = await errOf(U.owner, TRACK, ["presence"]);
  ok(/row-level security/.test(e ?? ""), "kênh khác tên không được mở", e);
  ok((await as(U.owner, READ))[0].n === 0, "… và không đọc được");
});

await db.exec(`set realtime.topic = 'smh-online'`);
await db.exec("begin; set local role anon;");
let anonError = null;
try {
  await db.query(TRACK, ["presence"]);
} catch (error) {
  anonError = error.message;
}
const anonRead = anonError ? null : (await db.query(READ)).rows[0].n;
await db.exec("rollback; reset realtime.topic;");
ok(/row-level security/.test(anonError ?? ""), "người ngoài (chưa đăng nhập) không vào được", anonError ?? anonRead);

finish();
