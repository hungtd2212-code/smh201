// Kiểm thử supabase/022_hr_positions.sql (2 chức vụ phòng Hành chính Nhân sự) trên Postgres chạy trong
// bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
//
// Kiểm 3 việc: (1) quyền của mọi tài khoản đang có không đổi; (2) 2 vai trò HCNS không vào được dữ liệu
// khách hàng và Marketing nhưng vẫn xem được danh sách nhân sự, cơ sở, ai đang online; (3) file 022 sống
// chung được với file 021 (2 chức vụ Kế toán) dù chạy theo thứ tự nào.
//
// Chạy:  npm run test:db
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb } from "./harness.mjs";

const BASE = ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "008_staff_accounts.sql",
  "009_admin_account.sql", "010_ads_daily_data.sql", "011_sync_ads_staff_name.sql", "012_ad_targets.sql",
  "013_revenue_avatars.sql", "014_monthly_targets.sql", "015_telesale_positions.sql", "016_lead_ads_runs_ads.sql",
  "017_week_carry.sql", "018_daily_revenue.sql", "019_online_presence.sql"];
const HR = "022_hr_positions.sql";
const ACCOUNTING = "021_accounting_positions.sql";
const PHONE = "0911222333";

/** Các bảng một tài khoản có thể đọc qua API — dùng để so "thấy bao nhiêu dòng" trước và sau 022. */
const TABLES = ["leads", "lead_touches", "audit_log", "campaigns", "ad_posts", "channels", "pages", "services",
  "app_settings", "staff", "branches", "staff_shifts", "ads_staff", "ad_accounts", "ad_account_assignments",
  "ad_daily_reports", "ads_daily_data", "ad_targets", "ad_revenue", "export_log", "security_alerts", "backup_runs"];

/** Dựng một cơ sở dữ liệu schema.sql → 019 có sẵn 7 tài khoản (đủ 7 vai trò cũ) và vài dòng dữ liệu. */
async function setup() {
  const t = await createTestDb();
  const { db, read, one, addUser } = t;
  await db.exec(`
    alter table auth.users
      add column instance_id uuid, add column aud text, add column role text,
      add column encrypted_password text, add column email_confirmed_at timestamptz,
      add column raw_app_meta_data jsonb, add column raw_user_meta_data jsonb,
      add column created_at timestamptz, add column updated_at timestamptz,
      add column confirmation_token text, add column recovery_token text,
      add column email_change_token_new text, add column email_change text,
      add column banned_until timestamptz;
    create table auth.identities (
      id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id),
      provider_id text not null, provider text not null, identity_data jsonb not null,
      last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
    create schema extensions;
    create function extensions.gen_salt(text) returns text language sql as $$ select 'salt' $$;
    create function extensions.crypt(text, text) returns text language sql as $$ select 'hash:' || $1 $$;
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

  const U = {};
  for (const name of ["owner", "adm", "mm", "ads1", "lead1", "sale1", "page1"]) U[name] = await addUser(name);
  await db.exec(read("schema.sql"));
  await db.exec(`
    insert into public.staff (user_id, full_name, role, created_at) values
      ('${U.owner}', 'Chủ phòng khám',  'admin', now() - interval '10 days'),
      ('${U.adm}',   'Quản trị 2',      'admin', now() - interval '5 days'),
      ('${U.lead1}', 'Trưởng Telesale', 'lead',  now()),
      ('${U.sale1}', 'Telesale 1',      'sale',  now());
  `);
  for (const file of BASE) await db.exec(read(file));
  await db.exec(`
    insert into public.staff (user_id, full_name, role) values
      ('${U.mm}',    'Trưởng Marketing', 'marketing_manager'),
      ('${U.ads1}',  'Nhân viên Ads',    'ads_staff'),
      ('${U.page1}', 'Trực page',        'page');
  `);

  // Vài dòng dữ liệu khách hàng và Marketing để phép thử "không thấy gì" có ý nghĩa.
  const fb = (await one(`select id from public.channels order by created_at limit 1`)).id;
  const svc = (await one(`select id from public.services order by created_at limit 1`)).id;
  const page = (await one(`insert into public.pages (name, channel_id) values ('Fanpage thử', $1) returning id`, [fb])).id;
  const camp = (await one(
    `insert into public.campaigns (name, channel_id, page_id, service_id) values ('Camp thử', $1, $2, $3) returning id`,
    [fb, page, svc])).id;
  await db.query(
    `insert into public.ad_posts (campaign_id, url, post_key, title) values ($1, 'https://facebook.com/smh/posts/1', 'fb:1', 'Bài thử')`,
    [camp]);
  const lead = (await one(`insert into public.leads (full_name, phone) values ('Khách thử', $1) returning id`, [PHONE])).id;
  await db.query(`insert into public.lead_touches (lead_id, phone, result) values ($1, $2, 'new')`, [lead, PHONE]);
  await db.query(
    `insert into public.staff_shifts (user_id, work_date, start_time, end_time) values ($1, current_date, '08:00', '17:00')`,
    [U.sale1]);
  await db.exec(`insert into realtime.messages (topic, extension) values ('smh-online', 'presence')`);
  const hq = (await one(`select id from public.branches order by created_at limit 1`)).id;
  return { ...t, U, fb, lead, hq };
}

/** Mỗi tài khoản thấy bao nhiêu dòng ở từng bảng, và các hàm về lead trả lời thế nào. */
async function accessOf(t, uid) {
  const seen = {};
  for (const table of TABLES) seen[table] = (await t.as(uid, `select count(*)::int n from public.${table}`))[0].n;
  seen.check_lead_phone = (await t.errOf(uid, `select public.check_lead_phone($1)`, [PHONE])) ?? "ok";
  await t.db.exec(`set realtime.topic = 'smh-online'`);
  try {
    seen.online = (await t.as(uid, `select count(*)::int n from realtime.messages where extension = 'presence'`))[0].n;
  } finally {
    await t.db.exec(`reset realtime.topic`);
  }
  return seen;
}
/**
 * `skip`: các mục có số dòng đổi vì chính phép thử (thêm tài khoản → thêm dòng nhân sự và nhật ký;
 * người HCNS báo online → thêm dòng online), bỏ ra khi so trước / sau.
 */
const accessOfAll = async (t, users, skip = []) => {
  const result = {};
  for (const [name, uid] of Object.entries(users)) {
    result[name] = await accessOf(t, uid);
    for (const table of skip) delete result[name][table];
  }
  return JSON.stringify(result);
};
const GROWING = ["staff", "audit_log", "online"];

const CREATE = `select public.create_staff_account($1, '123456789@', $2, $3, $4) as id`;
const UPDATE = `select public.update_staff_account($1, $2, $3, $4)`;
const POSITION_CHECKS = `select count(*)::int n from pg_constraint
  where conrelid = 'public.staff'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%lead_ads%'`;
const staffRows = async (t) => JSON.stringify(await t.all(`select to_jsonb(s) j from public.staff s order by user_id`));

// ===========================================================================
const t = await setup();
const { db, read, ok, section, one, as, errOf, finish, U, lead, hq } = t;
const create = async (uid, username, position, name) => (await as(uid, CREATE, [username, name, position, hq]))[0].id;
const createErr = (uid, username, position) => errOf(uid, CREATE, [username, "Người thử", position, hq]);
let e, row;

section("Chạy 022 trên dữ liệu đang có (schema.sql → 019)");
e = await createErr(U.adm, "hcns.truoc", "hr_staff");
ok(/Chọn vị trí/.test(e ?? ""), "(trước 022) vị trí Nhân viên HCNS chưa dùng được", e);
const accessBefore = await accessOfAll(t, U);
const accessBeforeFixed = await accessOfAll(t, U, GROWING);
const staffBefore = await staffRows(t);
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;
ok(JSON.parse(accessBefore).sale1.leads === 1 && JSON.parse(accessBefore).sale1.check_lead_phone === "ok",
  "(trước 022) Telesale xem được lead và kiểm tra được số điện thoại");

await db.exec(read(HR));
ok(true, "022 chạy không lỗi");
await db.exec(read(HR));
ok(true, "chạy lại 022 lần hai không lỗi");
ok((await staffRows(t)) === staffBefore, "022 không đổi dòng nhân sự nào đang có");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "022 không ghi nhật ký (không sửa dữ liệu)");
ok((await one(POSITION_CHECKS)).n === 1, "chỉ còn đúng một ràng buộc danh sách vị trí");
ok((await accessOfAll(t, U)) === accessBefore, "7 tài khoản cũ (đủ 7 vai trò) thấy đúng những gì đã thấy trước 022");

// ---------------------------------------------------------------------------
section("Thêm người ở 2 vị trí HCNS");
const manager = await create(U.adm, "hcns.truong", "hr_manager", "Trưởng phòng HCNS Một");
row = await one(`select role, position, page_access, accepts_leads from public.staff where user_id = $1`, [manager]);
ok(row.role === "hr_manager" && row.position === "hr_manager" && row.page_access.length === 0 && !row.accepts_leads,
  "vị trí Trưởng phòng HCNS → vai trò Trưởng phòng HCNS, chưa có quyền xem trang nào, không nhận lead", row);
const staff = await create(U.adm, "hcns.vien", "hr_staff", "Nhân viên HCNS Một");
row = await one(`select role, position, page_access from public.staff where user_id = $1`, [staff]);
ok(row.role === "hr_staff" && row.position === "hr_staff" && row.page_access.length === 0,
  "vị trí Nhân viên HCNS → vai trò Nhân viên HCNS, chưa có quyền xem trang nào", row);
row = await one(`select email from auth.users where id = $1`, [staff]);
ok(row.email === "hcns.vien@smilehub.local", "… có tài khoản đăng nhập bằng tên đăng nhập", row);
e = await createErr(U.mm, "hcns.hai", "hr_staff");
ok(/Chỉ Quản trị được thêm người/.test(e ?? ""), "Trưởng Marketing thêm Nhân viên HCNS → bị từ chối", e);
e = await createErr(manager, "hcns.ba", "hr_staff");
ok(/Chỉ Quản trị được thêm người/.test(e ?? ""), "Trưởng phòng HCNS tự thêm người → bị từ chối (vẫn chỉ Quản trị thêm người)", e);
e = await errOf(manager, `select public.set_staff_page_access($1, '{/telesale/leads}')`, [staff]);
ok(/Chỉ Quản trị/.test(e ?? ""), "Trưởng phòng HCNS tự phân quyền trang → bị từ chối", e);
await as(U.adm, `select public.set_staff_page_access($1, '{/nhan-su/nhan-vien,/telesale/leads}')`, [staff]);
ok((await one(`select page_access from public.staff where user_id = $1`, [staff])).page_access.length === 2,
  "Quản trị tick trang cho Nhân viên HCNS được như mọi vị trí khác");

// ---------------------------------------------------------------------------
section("HCNS không vào được dữ liệu khách hàng và Marketing");
const staffTotal = (await one(`select count(*)::int n from public.staff`)).n;
const CLOSED = TABLES.filter((name) => name !== "staff" && name !== "branches");
for (const [who, uid] of [["Trưởng phòng HCNS", manager], ["Nhân viên HCNS", staff]]) {
  const got = await accessOf(t, uid);
  const leaked = CLOSED.filter((name) => got[name] !== 0);
  ok(leaked.length === 0, `${who} không đọc được lead, lịch sử lead, chiến dịch, bài post, kênh, page, dịch vụ, cấu hình, báo cáo ads`, leaked);
  ok(/chưa được cấp quyền/.test(got.check_lead_phone), `${who} kiểm tra một số điện thoại → bị từ chối`, got.check_lead_phone);
  e = await errOf(uid, `select public.intake_lead($1, 'Khách', $2)`, ["0933444555", t.fb]);
  ok(/chưa được cấp quyền/.test(e ?? ""), `${who} thêm lead → bị từ chối`, e);
  await as(uid, `update public.leads set full_name = 'Bị sửa' where id = $1`, [lead]).catch(() => null);
  ok((await one(`select full_name from public.leads where id = $1`, [lead])).full_name === "Khách thử", `${who} không sửa được lead`);
  e = await errOf(uid, `select public.set_accepts_leads($1, true)`, [uid]);
  ok(/Không có quyền/.test(e ?? ""), `${who} tự bật nhận lead → bị từ chối`, e);
  e = await errOf(uid, `select * from public.ads_leaderboard(current_date)`);
  ok(/Chỉ nhân viên Ads/.test(e ?? ""), `${who} xem bảng vinh danh quảng cáo → bị từ chối`, e);

  ok(got.staff === staffTotal, `${who} xem được danh sách nhân sự`, got.staff);
  ok(got.branches >= 1, `${who} xem được danh sách cơ sở`, got.branches);
  ok(got.online >= 1, `${who} xem được ai đang online`, got.online);
  await db.exec(`set realtime.topic = 'smh-online'`);
  e = await errOf(uid, `insert into realtime.messages (topic, extension, event) values ('smh-online', 'presence', 'track')`);
  await db.exec(`reset realtime.topic`);
  ok(e === null, `${who} báo được mình đang online`, e);
}
ok((await one(`select count(*)::int n from public.leads where phone = '0933444555'`)).n === 0, "không có lead nào lọt vào từ tài khoản HCNS");
e = await errOf(U.lead1, `select public.set_accepts_leads($1, true)`, [staff]);
ok(/staff_hr_no_leads_check/.test(e ?? ""), "Trưởng Telesale bật nhận lead cho người HCNS → bị từ chối", e);

await db.exec(`update public.staff set locked_at = now(), locked_reason = 'thử' where user_id = '${staff}'`);
row = await accessOf(t, staff);
ok(row.staff === 1 && row.branches === 0 && row.online === 0, "Nhân viên HCNS bị khoá: chỉ còn đọc được dòng của chính mình", row);
await db.exec(`update public.staff set locked_at = null, locked_reason = null where user_id = '${staff}'`);

// ---------------------------------------------------------------------------
section("Đổi vị trí qua lại");
await as(U.adm, UPDATE, [staff, "Nhân viên HCNS Một", "hr_manager", hq]);
row = await one(`select role, position from public.staff where user_id = $1`, [staff]);
ok(row.role === "hr_manager" && row.position === "hr_manager", "đổi Nhân viên HCNS → Trưởng phòng HCNS: vai trò đổi theo", row);
await as(U.adm, UPDATE, [staff, "Nhân viên HCNS Một", "telesale", hq]);
ok((await accessOf(t, staff)).leads === 1, "chuyển người từ HCNS sang Telesale → xem được lead như Telesale");
await as(U.adm, `select public.set_accepts_leads($1, true)`, [staff]);
await as(U.adm, UPDATE, [staff, "Nhân viên HCNS Một", "hr_staff", hq]);
row = await one(`select role, accepts_leads from public.staff where user_id = $1`, [staff]);
ok(row.role === "hr_staff" && !row.accepts_leads, "chuyển Telesale đang nhận lead sang HCNS → tự ra khỏi vòng chia lead", row);
ok((await accessOf(t, staff)).leads === 0, "… và lại không xem được lead");
const tele = await create(U.adm, "tele.mot", "telesale", "Telesale Một");
ok((await one(`select role from public.staff where user_id = $1`, [tele])).role === "sale", "6 vị trí cũ vẫn dùng được như trước");
e = await createErr(U.adm, "bac.si", "bac_si");
ok(/Chọn vị trí/.test(e ?? ""), "vị trí chưa khai báo → vẫn bị từ chối", e);
e = null;
try {
  await db.query(`update public.staff set position = 'bac_si' where user_id = $1`, [tele]);
} catch (err) {
  e = err.message;
}
ok(/staff_position_check/.test(e ?? ""), "cột vị trí chỉ nhận các vị trí đã khai báo", e);
ok((await accessOfAll(t, U, GROWING)) === accessBeforeFixed,
  "sau tất cả: 7 tài khoản cũ vẫn thấy đúng như trước 022 (không tính dòng nhân sự / nhật ký / online mới thêm)");
row = JSON.parse(await accessOfAll(t, U));
ok(row.sale1.staff === (await one(`select count(*)::int n from public.staff`)).n && row.ads1.staff === row.sale1.staff,
  "… vẫn xem được cả danh sách nhân sự, gồm người HCNS mới thêm", row.sale1.staff);
ok(row.sale1.online === 3 && row.ads1.online === 3, "… và thấy cả người HCNS đang online", row.sale1.online);

// ---------------------------------------------------------------------------
// File 021 do việc "2 chức vụ Kế toán" thêm vào; chưa có file đó thì bỏ qua phần này.
if (existsSync(join(dirname(fileURLToPath(import.meta.url)), "..", ACCOUNTING))) {
  section("Sống chung với 021 (2 chức vụ Kế toán)");
  const t2 = await setup();
  const u2 = t2.U;
  const make = async (username, position) => (await t2.as(u2.adm, CREATE, [username, "Người thử", position, t2.hq]))[0].id;
  const makeErr = (username, position) => t2.errOf(u2.adm, CREATE, [username, "Người thử", position, t2.hq]);
  const roleOf = async (uid) => (await t2.one(`select role from public.staff where user_id = $1`, [uid])).role;

  await t2.db.exec(t2.read(ACCOUNTING));
  const acct = await make("kt.vien", "accountant");
  const acctBefore = JSON.stringify(await accessOf(t2, acct));
  await t2.db.exec(t2.read(HR));
  ok(true, "chạy 021 rồi 022 không lỗi");
  ok((await t2.one(POSITION_CHECKS)).n === 1, "chỉ còn đúng một ràng buộc danh sách vị trí");
  ok(JSON.stringify(await accessOf(t2, acct)) === acctBefore, "Kế toán viên thấy đúng những gì đã thấy trước 022");
  ok((await roleOf(await make("kt.truong", "chief_accountant"))) === "chief_accountant", "sau 022 vẫn thêm được Kế toán trưởng (022 giữ vị trí của 021)");
  const hr2 = await make("hcns.vien", "hr_staff");
  ok((await roleOf(hr2)) === "hr_staff", "thêm được Nhân viên HCNS");
  const got = await accessOf(t2, hr2);
  ok(got.leads === 0 && got.services === 0 && got.staff >= 9, "Nhân viên HCNS: không thấy lead, dịch vụ; thấy danh sách nhân sự", got);

  // Lỡ chạy lại 021 sau 022: hoặc bị từ chối (đã có tài khoản HCNS), hoặc mất vị trí HCNS — chạy lại 022 là đủ.
  const rerun = await t2.db.exec(t2.read(ACCOUNTING)).then(() => null, (err) => err.message);
  if (rerun) await t2.db.exec("rollback").catch(() => null);
  await t2.db.exec(t2.read(HR));
  ok((await roleOf(await make("hcns.hai", "hr_manager"))) === "hr_manager", "lỡ chạy lại 021 sau 022 → chạy lại 022 thì vị trí HCNS dùng lại được", rerun);
  ok((await roleOf(await make("kt.ba", "accountant"))) === "accountant", "… và vị trí Kế toán vẫn dùng được");
  ok((await roleOf(hr2)) === "hr_staff" && (await roleOf(acct)) === "accountant", "… tài khoản đã tạo giữ nguyên vai trò");
  e = await makeErr("bac.si", "bac_si");
  ok(/Chọn vị trí/.test(e ?? ""), "vị trí chưa khai báo → vẫn bị từ chối", e);
}

finish();
