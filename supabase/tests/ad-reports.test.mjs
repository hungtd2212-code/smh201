// Kiểm thử supabase/006_ad_daily_reports.sql (báo cáo ads hằng ngày: Nhập liệu + Tổng quan) trên
// Postgres chạy trong bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, arr, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "adm", "mm", "ads1", "ads2", "sale1"]) {
  U[name] = await addUser(name);
}

section("Chạy schema.sql → 006 trên dữ liệu đang có");
await db.exec(read("schema.sql"));
await db.exec(`
  insert into public.staff (user_id, full_name, role, created_at) values
    ('${U.owner}', 'Chủ phòng khám', 'admin', now() - interval '10 days'),
    ('${U.adm}',   'Quản trị 2',     'admin', now() - interval '5 days'),
    ('${U.sale1}', 'Telesale 1',     'sale',  now());
`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql", "005_marketing_catalog.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}',   'Trưởng Marketing', 'marketing_manager'),
    ('${U.ads1}', 'Ads Dương',        'ads_staff'),
    ('${U.ads2}', 'Ads An',           'ads_staff');
`);

// D[n] = ngày cách hôm nay (giờ Việt Nam) n ngày, dạng yyyy-MM-dd. D[-1] = ngày mai.
const D = {};
for (const row of await all(`select g, (private.today_vn() - g)::text as d from generate_series(-1, 40) g`)) {
  D[row.g] = row.d;
}

const fb = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const addAdsStaff = async (name, userId = null) =>
  (await as(U.mm, `insert into public.ads_staff (full_name, user_id) values ($1, $2) returning id`, [name, userId]))[0].id;
const addAccount = async (name) =>
  (await as(U.mm, `insert into public.ad_accounts (name, channel_id) values ($1, $2) returning id`, [name, fb]))[0].id;
const assign = (account, staff, from) =>
  as(U.mm, `select public.assign_ad_account($1, $2, $3::date)`, [account, staff, from]);

const duong = await addAdsStaff("Dương", U.ads1);
const an = await addAdsStaff("An", U.ads2);
const duong01 = await addAccount("THE DUONG 01");
const duong02 = await addAccount("THE DUONG 02");
const an01 = await addAccount("An 01");
const empty01 = await addAccount("Trống 01");      // chưa giao cho ai
await assign(duong01, duong, D[30]);
await assign(duong02, duong, D[30]);
await assign(an01, an, D[30]);

const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;
const accountsBefore = await all(`select to_jsonb(a) j from public.ad_accounts a order by id`);
await db.exec(read("006_ad_daily_reports.sql"));
ok(true, "006 chạy không lỗi");
await db.exec(read("006_ad_daily_reports.sql"));
ok(true, "chạy lại 006 lần hai không lỗi");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "chạy 006 không ghi dòng nhật ký nào (không sửa dữ liệu cũ)");
ok(JSON.stringify(await all(`select to_jsonb(a) j from public.ad_accounts a order by id`)) === JSON.stringify(accountsBefore), "TKQC đang có giữ nguyên từng cột");
ok((await one(`select to_regclass('public.ad_daily_spend') a, to_regclass('public.ads_daily_results') b`)).a === null, "không tạo các bảng của bản thiết kế cũ");

const SEND = `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages, data_count)
  values ($1::date, $2, $3, $4, $5) returning *`;
const send = async (uid, date, account, spend, messages, data) => (await as(uid, SEND, [date, account, spend, messages, data]))[0];
const sendErr = (uid, date, account, spend = 0, messages = 0, data = 0) => errOf(uid, SEND, [date, account, spend, messages, data]);
const EDIT = `update public.ad_daily_reports set spend = $2, messages = $3, data_count = $4 where id = $1 returning *`;
const edit = (uid, id, spend, messages, data) => as(uid, EDIT, [id, spend, messages, data]);
const editErr = (uid, id, spend, messages, data) => errOf(uid, EDIT, [id, spend, messages, data]);
const rowOf = (id) => one(`select * from public.ad_daily_reports where id = $1`, [id]);
/** Lùi mốc "gửi lần đầu" của một báo cáo (giả lập thời gian trôi). Tắt trigger để đặt được mốc. */
async function age(id, interval) {
  await db.exec(`set session_replication_role = replica`);
  await db.query(`update public.ad_daily_reports set submitted_at = now() - $2::interval, updated_at = now() - $2::interval where id = $1`, [id, interval]);
  await db.exec(`set session_replication_role = origin`);
}

// ---------------------------------------------------------------------------
section("Nhân viên Ads gửi báo cáo");
const r1 = await send(U.ads1, D[1], duong01, 1000000, 12, 3);
ok(Number(r1.spend) === 1000000 && r1.messages === 12 && r1.data_count === 3, "gửi được, lưu đúng số nguyên", r1);
ok(r1.user_id === U.ads1 && r1.submitted_at && r1.updated_by === null, "người gửi và lúc gửi do hệ thống tự điền", r1);
const r0 = await send(U.ads1, D[0], duong01, 0, 0, 0);
ok(Number(r0.spend) === 0 && r0.messages === 0, "gửi số 0 được (hôm nay, giờ Việt Nam)");
let log = await all(`select action, actor_id, ip, new_data from public.audit_log where table_name = 'ad_daily_reports' order by id`);
ok(log.length === 2 && log.every((l) => l.action === "insert" && l.actor_id === U.ads1 && l.ip === "203.0.113.9"), "mỗi lần gửi được ghi nhật ký: ai, IP", log);

// Gửi hai TK ADS trong một lần (một câu lệnh) — được cả hai hoặc không được gì.
const both = await as(U.ads1, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages, data_count)
  values ($1::date, $2, 500000, 4, 1), ($1::date, $3, 700000, 6, 2) returning id`, [D[2], duong01, duong02]);
ok(both.length === 2, "gửi nhiều TK ADS cùng lúc được");

// ---------------------------------------------------------------------------
section("Chốt chặn khi gửi");
let e = await sendErr(U.ads1, D[1], duong01, 5, 5, 5);
ok(/ad_daily_reports_day_account_key|duplicate key/.test(e ?? ""), "mỗi (ngày, TK ADS) chỉ gửi một lần — gửi lại bị từ chối", e);
e = await sendErr(U.ads1, D[-1], duong01);
ok(/ngày chưa tới/.test(e ?? ""), "gửi cho ngày mai → bị từ chối", e);
e = await sendErr(U.ads1, D[3], an01);
ok(/không phụ trách TK ADS này/.test(e ?? ""), "gửi cho TK ADS của người khác → bị từ chối", e);
e = await sendErr(U.ads1, D[35], duong01);
ok(/không có người phụ trách vào ngày/.test(e ?? ""), "gửi cho ngày trước khi TK ADS được giao → bị từ chối", e);
e = await sendErr(U.mm, D[3], empty01);
ok(/Trống 01.*không có người phụ trách/.test(e ?? ""), "TK ADS chưa giao cho ai → Trưởng Marketing cũng không gửi được", e);
e = await sendErr(U.ads1, D[3], duong01, -5, 0, 0);
ok(/check constraint|spend_check/.test(e ?? ""), "chi tiêu âm → bị từ chối", e);
e = await sendErr(U.ads1, D[3], duong01, 0, -1, 0);
ok(/check constraint|messages_check/.test(e ?? ""), "tin nhắn âm → bị từ chối", e);
e = await errOf(U.ads1, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages, data_count) values ($1::date, $2, '1.5', 1, 1)`, [D[3], duong01]);
ok(/invalid input syntax for type bigint/.test(e ?? ""), "số thập phân → bị từ chối", e);
e = await errOf(U.ads1, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages) values ($1::date, $2, 1, 1)`, [D[3], duong01]);
ok(/null value in column "data_count"/.test(e ?? ""), "bỏ trống một ô → bị từ chối", e);
e = await errOf(U.ads1, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages, data_count, submitted_at) values ($1::date, $2, 1, 1, 1, now() + interval '10 days')`, [D[3], duong01]);
ok(/permission denied/.test(e ?? ""), "tự đặt mốc giờ gửi → bị từ chối", e);
e = await sendErr(U.sale1, D[3], duong01);
ok(/không phụ trách TK ADS này/.test(e ?? ""), "telesale gửi báo cáo ads → bị từ chối", e);
ok((await one(`select count(*)::int n from public.ad_daily_reports where report_date = $1`, [D[3]])).n === 0, "các lần bị từ chối không để lại dòng nào");
const mmReport = await send(U.mm, D[3], an01, 300000, 2, 0);
ok(mmReport.user_id === U.mm, "Trưởng Marketing gửi thay được, ghi rõ ai gửi");

// ---------------------------------------------------------------------------
section("Sửa trong 24 giờ");
await edit(U.ads1, r1.id, 1200000, 12, 4);
let row = await rowOf(r1.id);
ok(Number(row.spend) === 1200000 && row.data_count === 4, "trong 24 giờ: nhân viên sửa được");
ok(row.submitted_at.getTime() === r1.submitted_at.getTime(), "sửa không làm đổi mốc gửi lần đầu (không làm mới 24 giờ)");
ok(row.updated_by === U.ads1 && row.updated_at.getTime() >= row.submitted_at.getTime(), "ghi người sửa và lúc sửa", row);
log = await all(`select action, actor_id, old_data, new_data from public.audit_log where table_name = 'ad_daily_reports' and record_id = $1 order by id desc limit 1`, [r1.id]);
ok(log[0].action === "update" && Number(log[0].old_data.spend) === 1000000 && Number(log[0].new_data.spend) === 1200000
  && log[0].old_data.data_count === 3 && log[0].new_data.data_count === 4 && Object.keys(log[0].new_data).length === 2
  && log[0].actor_id === U.ads1, "nhật ký ghi số cũ → số mới, chỉ các ô đã đổi, ai sửa", log[0]);
const versionAfterEdit = (await one(`select max(id)::int id from public.audit_log where table_name = 'ad_daily_reports' and record_id = $1`, [r1.id])).id;

const auditCount = async () => (await one(`select count(*)::int n from public.audit_log where table_name = 'ad_daily_reports'`)).n;
const nBefore = await auditCount();
const updatedBefore = (await rowOf(r1.id)).updated_at.getTime();
await edit(U.ads1, r1.id, 1200000, 12, 4);
ok((await auditCount()) === nBefore && (await rowOf(r1.id)).updated_at.getTime() === updatedBefore, "lưu lại y nguyên → không tính là sửa, không ghi nhật ký");

e = await errOf(U.ads1, `update public.ad_daily_reports set report_date = $2::date where id = $1`, [r1.id, D[5]]);
ok(/permission denied/.test(e ?? ""), "không đổi được ngày của báo cáo đã gửi", e);
e = await errOf(U.ads1, `update public.ad_daily_reports set submitted_at = now() where id = $1`, [r1.id]);
ok(/permission denied/.test(e ?? ""), "không đổi được mốc gửi lần đầu", e);
let changed = await as(U.ads2, EDIT, [r1.id, 1, 1, 1]);
ok(changed.length === 0 && Number((await rowOf(r1.id)).spend) === 1200000, "nhân viên khác không sửa được báo cáo không phải của mình");

// ---------------------------------------------------------------------------
section("Quá 24 giờ");
await age(r1.id, "23 hours 59 minutes");
ok((await editErr(U.ads1, r1.id, 1300000, 12, 4)) === null, "23 giờ 59 phút sau khi gửi: vẫn sửa được");
await age(r1.id, "24 hours 1 minute");
e = await editErr(U.ads1, r1.id, 1400000, 12, 4);
ok(e === "Báo cáo đã quá 24 giờ, không thể sửa", "quá 24 giờ: nhân viên sửa → database từ chối đúng câu báo", e);
ok(Number((await rowOf(r1.id)).spend) === 1300000, "… số giữ nguyên");
await edit(U.mm, r1.id, 1500000, 13, 4);
ok(Number((await rowOf(r1.id)).spend) === 1500000, "Trưởng Marketing sửa được báo cáo đã quá 24 giờ");
await edit(U.owner, r1.id, 1600000, 13, 4);
row = await rowOf(r1.id);
ok(Number(row.spend) === 1600000 && row.updated_by === U.owner, "Quản trị sửa được báo cáo đã quá 24 giờ");
e = await editErr(U.ads1, r1.id, 1, 1, 1);
ok(e === "Báo cáo đã quá 24 giờ, không thể sửa", "Quản trị sửa xong cũng không mở lại 24 giờ cho nhân viên", e);

// ---------------------------------------------------------------------------
section("Không ai xoá được báo cáo");
for (const [uid, who] of [[U.ads1, "nhân viên Ads"], [U.mm, "Trưởng Marketing"], [U.owner, "Quản trị cấp cao"]]) {
  e = await errOf(uid, `delete from public.ad_daily_reports where id = $1`, [r0.id]);
  ok(/permission denied/.test(e ?? ""), `xoá báo cáo → bị từ chối (${who})`, e);
}
ok(Boolean(await rowOf(r0.id)), "báo cáo vẫn còn");
const fn = "private.has_ad_account_on(uuid, date)";
ok((await one(`select has_function_privilege('anon', '${fn}', 'execute') as p`)).p === false, "người chưa đăng nhập không dùng được hàm phân quyền");
ok((await one(`select has_table_privilege('anon', 'public.ad_daily_reports', 'select') as p`)).p === false, "người chưa đăng nhập không đọc được báo cáo");

// ---------------------------------------------------------------------------
section("Ai xem được báo cáo của ai");
const seen = async (uid) => (await as(uid, `select ad_account_id from public.ad_daily_reports`)).map((x) => x.ad_account_id);
let s = await seen(U.ads1);
ok(s.length > 0 && s.every((id) => id === duong01 || id === duong02), "nhân viên Ads chỉ thấy báo cáo TK ADS mình phụ trách");
s = await seen(U.ads2);
ok(s.length === 1 && s[0] === an01, "… kể cả báo cáo Trưởng Marketing gửi thay cho mình");
ok(new Set(await seen(U.mm)).size === 3 && new Set(await seen(U.adm)).size === 3, "Trưởng Marketing và Quản trị thấy tất cả");
ok((await seen(U.sale1)).length === 0, "telesale không thấy báo cáo ads");

section("Đổi người phụ trách TK ADS giữa chừng");
await assign(duong02, an, D[1]); // từ hôm qua, THE DUONG 02 do An phụ trách
e = await sendErr(U.ads1, D[0], duong02, 1, 1, 1);
ok(/không phụ trách TK ADS này/.test(e ?? ""), "người cũ không gửi được cho ngày đã giao TK ADS cho người khác", e);
ok((await sendErr(U.ads2, D[0], duong02, 1, 1, 1)) === null, "người mới gửi được");
const days = async (uid) => (await as(uid, `select report_date::text d from public.ad_daily_reports where ad_account_id = $1 order by report_date`, [duong02])).map((x) => x.d);
ok(JSON.stringify(await days(U.ads1)) === JSON.stringify([D[2]]), "người cũ chỉ còn thấy những ngày mình phụ trách", await days(U.ads1));
ok(JSON.stringify(await days(U.ads2)) === JSON.stringify([D[0]]), "người mới thấy từ ngày mình nhận", await days(U.ads2));

// ---------------------------------------------------------------------------
section("Thùng rác và hoàn tác");
await as(U.owner, `select public.set_staff_can_delete($1, true)`, [U.mm]);
e = await errOf(U.mm, `select public.soft_delete_records('ad_accounts', $1::uuid[])`, [arr([duong01])]);
ok(/đã có báo cáo hằng ngày/.test(e ?? ""), "TK ADS đã có báo cáo → không vào thùng rác", e);
const assignmentId = (await one(`select id from public.ad_account_assignments where ad_account_id = $1 and deleted_at is null`, [duong01])).id;
e = await errOf(U.mm, `select public.soft_delete_records('ad_account_assignments', $1::uuid[])`, [arr([assignmentId])]);
ok(/đã có báo cáo trong khoảng ngày/.test(e ?? ""), "phân công đã có báo cáo → không vào thùng rác", e);
e = await errOf(U.mm, `select public.soft_delete_records('ad_accounts', $1::uuid[])`, [arr([empty01])]);
ok(e === null, "TK ADS chưa có báo cáo → vẫn chuyển vào thùng rác được", e);

e = await errOf(U.ads1, `select public.revert_record_to_version($1)`, [versionAfterEdit]);
ok(/không có quyền/.test(e ?? ""), "nhân viên Ads không tự hoàn tác được", e);
await as(U.adm, `select public.revert_record_to_version($1)`, [versionAfterEdit]);
row = await rowOf(r1.id);
ok(Number(row.spend) === 1200000 && row.messages === 12 && row.data_count === 4,
  "Quản trị hoàn tác → số quay về phiên bản đã chọn (1.200.000 · 12 · 4)", row);
ok(row.user_id === U.ads1 && row.report_date.getTime() === r1.report_date.getTime(), "hoàn tác không đụng tới ngày, người gửi");

finish();
