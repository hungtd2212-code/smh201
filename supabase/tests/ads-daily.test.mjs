// Kiểm thử supabase/006_ads_daily_stats.sql (số liệu ads hằng ngày: chi tiêu theo TKQC, kết quả
// theo nhân viên) trên Postgres chạy trong bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
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
await db.exec(read("002_marketing_lead.sql"));
await db.exec(read("003_data_safety.sql"));
await db.exec(read("004_delete_permission.sql"));
await db.exec(read("005_marketing_catalog.sql"));
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
const hang = await addAdsStaff("Hằng"); // chưa có tài khoản đăng nhập
const duong01 = await addAccount("THE DUONG 01");
const duong02 = await addAccount("THE DUONG 02");
const an01 = await addAccount("An 01");
const empty01 = await addAccount("Trống 01");
await assign(duong01, duong, D[30]);
await assign(duong02, duong, D[30]);
await assign(an01, an, D[30]);

const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;
const accountsBefore = await all(`select to_jsonb(a) j from public.ad_accounts a order by id`);

await db.exec(read("006_ads_daily_stats.sql"));
ok(true, "006 chạy không lỗi");
await db.exec(read("006_ads_daily_stats.sql"));
ok(true, "chạy lại 006 lần hai không lỗi");
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "chạy 006 không ghi dòng nhật ký nào (không sửa dữ liệu cũ)");
const accountsAfter = await all(`select to_jsonb(a) j from public.ad_accounts a order by id`);
ok(JSON.stringify(accountsAfter) === JSON.stringify(accountsBefore), "TKQC đang có giữ nguyên từng cột");
ok((await one(`select count(*)::int n from public.ad_daily_spend`)).n === 0 && (await one(`select count(*)::int n from public.ads_daily_results`)).n === 0, "hai bảng số liệu ngày mới, đang trống");

/** Gọi hàm lưu số liệu một ngày. `spend` = { [id TKQC]: số tiền }. */
const SAVE = `select public.save_ads_daily($1::date, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12) as r`;
const saveArgs = (date, staffId, spend = {}, r = {}) => [
  date,
  staffId,
  JSON.stringify(Object.entries(spend).map(([ad_account_id, amount]) => ({ ad_account_id, spend: amount }))),
  r.mess ?? 0, r.data ?? 0, r.sales ?? 0, r.revenue ?? 0,
  r.q1 ?? 0, r.q2 ?? 0, r.q3 ?? 0, r.q4 ?? 0, r.note ?? null,
];
const save = async (uid, ...args) => (await as(uid, SAVE, saveArgs(...args)))[0].r;
const saveErr = (uid, ...args) => errOf(uid, SAVE, saveArgs(...args));
const spendOf = async (date, account) =>
  (await one(`select spend from public.ad_daily_spend where stat_date = $1 and ad_account_id = $2`, [date, account]))?.spend;
const auditCount = async (table) =>
  (await one(`select count(*)::int n from public.audit_log where table_name = $1`, [table])).n;

// ---------------------------------------------------------------------------
section("Nhân viên Ads nhập số của mình");
const day1 = { mess: 10, data: 3, sales: 5000000, revenue: 2000000, q1: 1, q2: 1, q3: 0, q4: 1, note: "  ngày đầu  " };
let r = await save(U.ads1, D[1], duong, { [duong01]: 1500000, [duong02]: 0 }, day1);
ok(Number(r.spend) === 1500000, "lưu được, trả về tổng chi tiêu", r);
ok(Number(await spendOf(D[1], duong01)) === 1500000, "chi tiêu TKQC được ghi");
ok((await spendOf(D[1], duong02)) === undefined, "TKQC để 0 đ và chưa có số → không tạo dòng thừa");
let row = await one(`select * from public.ads_daily_results where stat_date = $1 and ads_staff_id = $2`, [D[1], duong]);
ok(row.messages === 10 && row.data_count === 3 && Number(row.sales) === 5000000 && Number(row.revenue) === 2000000
  && row.q_potential === 1 && row.q_booked === 1 && row.q_wrong_area === 0 && row.q_no_response === 1
  && row.note === "ngày đầu" && row.created_by === U.ads1, "kết quả ngày được ghi đúng từng cột, có người tạo", row);
let log = await all(`select table_name, action, actor_id, ip from public.audit_log where table_name in ('ad_daily_spend', 'ads_daily_results') order by id`);
ok(log.length === 2 && log.every((l) => l.action === "insert" && l.actor_id === U.ads1 && l.ip === "203.0.113.9"), "nhập số được ghi nhật ký: ai, IP", log);

const before = [await auditCount("ad_daily_spend"), await auditCount("ads_daily_results")];
await save(U.ads1, D[1], duong, { [duong01]: 1500000, [duong02]: 0 }, day1);
ok((await auditCount("ad_daily_spend")) === before[0] && (await auditCount("ads_daily_results")) === before[1], "lưu lại y nguyên → không ghi thêm nhật ký");
ok((await one(`select count(*)::int n from public.ads_daily_results`)).n === 1, "… và không sinh dòng trùng");

await save(U.ads1, D[1], duong, { [duong01]: 1600000, [duong02]: 250000 }, { ...day1, mess: 12 });
row = await one(`select messages, data_count from public.ads_daily_results where stat_date = $1 and ads_staff_id = $2`, [D[1], duong]);
ok(row.messages === 12 && row.data_count === 3 && Number(await spendOf(D[1], duong01)) === 1600000 && Number(await spendOf(D[1], duong02)) === 250000, "nhập lại cùng ngày = sửa số (ghi đè)");
log = await all(`select action, old_data, new_data, actor_id from public.audit_log where table_name = 'ads_daily_results' order by id desc limit 1`);
ok(log[0].action === "update" && log[0].old_data.messages === 10 && log[0].new_data.messages === 12 && Object.keys(log[0].new_data).length === 1, "sửa số được ghi nhật ký: số cũ → số mới, chỉ cột đã đổi", log[0]);
const versionAfterFirstEdit = (await one(`select max(id)::int id from public.audit_log where table_name = 'ads_daily_results'`)).id;
log = await all(`select action, old_data, new_data from public.audit_log where table_name = 'ad_daily_spend' order by id desc limit 2`);
ok(log.some((l) => l.action === "update" && Number(l.old_data.spend) === 1500000 && Number(l.new_data.spend) === 1600000), "sửa chi tiêu cũng được ghi nhật ký", log);

await save(U.ads1, D[1], duong, { [duong01]: 1600000, [duong02]: 0 }, { ...day1, mess: 12 });
ok(Number(await spendOf(D[1], duong02)) === 0, "TKQC đã có số, nhập lại 0 đ → sửa về 0 (không xoá dòng)");

// ---------------------------------------------------------------------------
section("Chốt chặn khi nhập");
let e = await saveErr(U.ads1, D[1], an, {}, { mess: 5 });
ok(/chỉ nhập được số liệu của chính mình/.test(e ?? ""), "nhân viên Ads nhập cho người khác → bị từ chối", e);
e = await saveErr(U.ads1, D[1], duong, { [an01]: 100000 });
ok(/không do nhân viên này phụ trách/.test(e ?? "") && /An 01/.test(e ?? ""), "nhập chi tiêu cho TKQC của người khác → bị từ chối, có tên TKQC", e);
e = await saveErr(U.ads1, D[-1], duong, { [duong01]: 100000 });
ok(/ngày chưa tới/.test(e ?? ""), "nhập cho ngày mai → bị từ chối", e);
ok((await saveErr(U.ads1, D[0], duong, { [duong01]: 100000 }, { mess: 1 })) === null, "nhập cho hôm nay (giờ Việt Nam) → được");
e = await saveErr(U.ads1, D[35], duong, { [duong01]: 100000 });
ok(/không do nhân viên này phụ trách/.test(e ?? ""), "nhập chi tiêu cho ngày trước khi được giao TKQC → bị từ chối", e);
e = await saveErr(U.ads1, D[2], duong, {}, { mess: -1 });
ok(/số âm/.test(e ?? ""), "số mess âm → bị từ chối", e);
e = await saveErr(U.ads1, D[2], duong, { [duong01]: -5 });
ok(/số âm/.test(e ?? ""), "chi tiêu âm → bị từ chối", e);
ok((await one(`select count(*)::int n from public.ads_daily_results where stat_date = $1`, [D[2]])).n === 0, "lần lưu bị từ chối không để lại dòng nào");
e = await saveErr(U.sale1, D[1], duong, {}, { mess: 5 });
ok(/chỉ nhập được số liệu của chính mình/.test(e ?? ""), "telesale nhập số liệu ads → bị từ chối", e);
e = await saveErr(U.mm, D[1], "00000000-0000-0000-0000-000000000000", {}, { mess: 5 });
ok(/Không tìm thấy nhân viên Ads/.test(e ?? ""), "nhân viên Ads không tồn tại → bị từ chối", e);
const fn = "public.save_ads_daily(date, uuid, jsonb, int, int, numeric, numeric, int, int, int, int, text)";
ok((await one(`select has_function_privilege('anon', '${fn}', 'execute') as p`)).p === false, "người chưa đăng nhập không gọi được hàm lưu");

for (const uid of [U.ads1, U.mm, U.owner]) {
  e = await errOf(uid, `insert into public.ad_daily_spend (stat_date, ad_account_id, spend) values ($1, $2, 1)`, [D[3], duong01]);
  const e2 = await errOf(uid, `update public.ads_daily_results set messages = 999`);
  const e3 = await errOf(uid, `delete from public.ad_daily_spend`);
  const e4 = await errOf(uid, `delete from public.ads_daily_results`);
  ok([e, e2, e3, e4].every((x) => /permission denied/.test(x ?? "")), `ghi / sửa / xoá thẳng vào bảng → bị từ chối (${uid === U.ads1 ? "nhân viên Ads" : uid === U.mm ? "Trưởng Marketing" : "Quản trị cấp cao"})`, [e, e2, e3, e4]);
}

// ---------------------------------------------------------------------------
section("Ai xem được số của ai");
await save(U.ads2, D[1], an, { [an01]: 900000 }, { mess: 7, data: 2 });
await save(U.mm, D[1], hang, {}, { mess: 4, data: 1, note: "Trưởng Marketing nhập hộ" });
ok((await one(`select created_by from public.ads_daily_results where ads_staff_id = $1`, [hang])).created_by === U.mm, "Trưởng Marketing nhập hộ người chưa có tài khoản");

const seen = async (uid) => ({
  results: (await as(uid, `select ads_staff_id from public.ads_daily_results`)).map((x) => x.ads_staff_id),
  spend: (await as(uid, `select ad_account_id from public.ad_daily_spend`)).map((x) => x.ad_account_id),
});
let s = await seen(U.ads1);
ok(s.results.length > 0 && s.results.every((id) => id === duong), "nhân viên Ads chỉ thấy kết quả của mình");
ok(s.spend.length > 0 && s.spend.every((id) => id === duong01 || id === duong02), "… và chi tiêu của TKQC mình phụ trách");
s = await seen(U.ads2);
ok(s.results.every((id) => id === an) && s.spend.every((id) => id === an01) && s.spend.length === 1, "nhân viên Ads khác cũng vậy");
s = await seen(U.mm);
ok(new Set(s.results).size === 3 && new Set(s.spend).size === 3, "Trưởng Marketing thấy tất cả", s);
s = await seen(U.adm);
ok(new Set(s.results).size === 3 && new Set(s.spend).size === 3, "Quản trị thấy tất cả");
s = await seen(U.sale1);
ok(s.results.length === 0 && s.spend.length === 0, "telesale không thấy số liệu ads");

// ---------------------------------------------------------------------------
section("Đổi người phụ trách TKQC giữa chừng");
await save(U.mm, D[10], duong, { [duong02]: 700000 }, { mess: 3 });
await assign(duong02, an, D[5]); // từ 5 ngày trước, THE DUONG 02 do An phụ trách
await save(U.ads2, D[3], an, { [duong02]: 400000, [an01]: 100000 }, { mess: 2 });
e = await saveErr(U.ads1, D[3], duong, { [duong02]: 1 });
ok(/không do nhân viên này phụ trách/.test(e ?? ""), "người cũ không nhập được chi tiêu cho ngày đã giao TKQC cho người khác", e);
ok((await saveErr(U.ads1, D[10], duong, { [duong02]: 750000 }, { mess: 3 })) === null, "… nhưng vẫn sửa được số của những ngày mình còn phụ trách");
const days = async (uid, account) =>
  (await as(uid, `select stat_date::text d from public.ad_daily_spend where ad_account_id = $1 order by stat_date`, [account])).map((x) => x.d);
let d = await days(U.ads1, duong02);
ok(d.length === 1 && d[0] === D[10], "người cũ chỉ còn thấy chi tiêu của những ngày mình phụ trách", d);
d = await days(U.ads2, duong02);
// Dòng của hôm qua (D[1]) do người cũ nhập, nhưng ngày đó nay thuộc người mới → tính cho người mới.
ok(d.length === 2 && d[0] === D[3] && d[1] === D[1], "người mới thấy mọi ngày kể từ ngày nhận, kể cả số người cũ đã nhập", d);

// ---------------------------------------------------------------------------
section("Không chuyển vào thùng rác thứ đang có số liệu");
await as(U.owner, `select public.set_staff_can_delete($1, true)`, [U.mm]);
e = await errOf(U.mm, `select public.soft_delete_records('ad_accounts', $1::uuid[])`, [arr([duong01])]);
ok(/đã có số liệu chi tiêu hằng ngày/.test(e ?? ""), "TKQC có số liệu → không vào thùng rác", e);
e = await errOf(U.mm, `select public.soft_delete_records('ads_staff', $1::uuid[])`, [arr([hang])]);
ok(/đã có số liệu hằng ngày/.test(e ?? ""), "nhân viên Ads có số liệu → không vào thùng rác", e);
const assignmentId = (await one(`select id from public.ad_account_assignments where ad_account_id = $1 and deleted_at is null`, [duong01])).id;
e = await errOf(U.mm, `select public.soft_delete_records('ad_account_assignments', $1::uuid[])`, [arr([assignmentId])]);
ok(/đã có số liệu chi tiêu trong khoảng ngày/.test(e ?? ""), "phân công có số liệu trong khoảng ngày → không vào thùng rác", e);
e = await errOf(U.mm, `select public.soft_delete_records('ad_accounts', $1::uuid[])`, [arr([empty01])]);
ok(e === null, "TKQC chưa có số liệu → vẫn chuyển vào thùng rác được", e);
ok((await one(`select deleted_at from public.ad_accounts where id = $1`, [duong01])).deleted_at === null, "TKQC có số liệu vẫn nguyên");

// ---------------------------------------------------------------------------
section("Hoàn tác một lần sửa số");
await save(U.ads1, D[1], duong, { [duong01]: 1600000 }, { ...day1, mess: 99, data: 50 });
e = await errOf(U.ads1, `select public.revert_record_to_version($1)`, [versionAfterFirstEdit]);
ok(/không có quyền/.test(e ?? ""), "nhân viên Ads không tự hoàn tác được", e);
await as(U.adm, `select public.revert_record_to_version($1)`, [versionAfterFirstEdit]);
row = await one(`select messages, data_count, stat_date::text d, ads_staff_id from public.ads_daily_results where stat_date = $1 and ads_staff_id = $2`, [D[1], duong]);
ok(row.messages === 12 && row.data_count === 3, "Quản trị hoàn tác → số quay về phiên bản đã chọn", row);

finish();
