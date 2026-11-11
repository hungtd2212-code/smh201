// Kiểm thử supabase/005_marketing_catalog.sql (Marketing giai đoạn 1: vai trò, quyền, danh mục)
// trên Postgres chạy trong bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, arr, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "adm", "mm", "ads1", "ads2", "ads3", "lead1", "sale1", "page1"]) {
  U[name] = await addUser(name);
}

section("Chạy schema.sql → 005 trên dữ liệu đang có");
await db.exec(read("schema.sql"));
await db.exec(`
  insert into public.staff (user_id, full_name, role, created_at) values
    ('${U.owner}', 'Chủ phòng khám', 'admin', now() - interval '10 days'),
    ('${U.adm}',   'Quản trị 2',     'admin', now() - interval '5 days'),
    ('${U.lead1}', 'Trưởng Telesale', 'lead', now()),
    ('${U.sale1}', 'Telesale 1',     'sale',  now());
`);
await db.exec(read("002_marketing_lead.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.page1}', 'Trực page 1', 'page')`);
await db.exec(read("003_data_safety.sql"));
await db.exec(read("004_delete_permission.sql"));

// Dữ liệu "đang có" trước khi chạy 005: một page, một chiến dịch, một lead.
const fb = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const tiktok = (await one(`select id from public.channels where name = 'TikTok'`)).id;
const svc = (await one(`select id from public.services where name = 'Niềng răng'`)).id;
const oldPage = (await as(U.lead1, `insert into public.pages (name, channel_id) values ('Fanpage cũ', $1) returning id`, [fb]))[0].id;
const oldCamp = (await as(U.lead1, `insert into public.campaigns (name, channel_id, page_id, service_id, budget) values ('Camp cũ', $1, $2, $3, 5000000) returning id`, [fb, oldPage, svc]))[0].id;
const intake = async (uid, phone, name) =>
  (await as(uid, `select public.intake_lead($1, $2, $3, $4, $5, $6) as r`, [phone, name, fb, oldPage, oldCamp, svc]))[0].r;
const oldLead = (await intake(U.page1, "0911000001", "Khách cũ")).lead_id;
const before = await one(`select to_jsonb(l) - 'updated_at' as j from public.leads l where id = $1`, [oldLead]);
const auditBefore = (await one(`select count(*)::int n from public.audit_log`)).n;

await db.exec(read("005_marketing_catalog.sql"));
ok(true, "005 chạy không lỗi");
await db.exec(read("005_marketing_catalog.sql"));
ok(true, "chạy lại 005 lần hai không lỗi");

const after = await one(`select to_jsonb(l) - 'updated_at' as j from public.leads l where id = $1`, [oldLead]);
ok(JSON.stringify(after.j) === JSON.stringify(before.j), "lead đang có giữ nguyên từng cột");
const campAfter = await one(`select name, budget, page_id, ad_account_id, objective, branch from public.campaigns where id = $1`, [oldCamp]);
ok(campAfter.name === "Camp cũ" && Number(campAfter.budget) === 5000000 && campAfter.page_id === oldPage, "chiến dịch đang có giữ nguyên", campAfter);
ok(campAfter.ad_account_id === null && campAfter.objective === null, "… cột mới (TKQC, mục tiêu) để trống");
const pageAfter = await one(`select name, url, page_staff_ids from public.pages where id = $1`, [oldPage]);
ok(pageAfter.name === "Fanpage cũ" && pageAfter.url === null && pageAfter.page_staff_ids.length === 0, "page đang có giữ nguyên, cột mới để trống", pageAfter);
ok((await one(`select count(*)::int n from public.audit_log`)).n === auditBefore, "chạy 005 không ghi dòng nhật ký nào (không sửa dữ liệu cũ)");
ok((await one(`select to_regclass('public.regions') as t`)).t === null, "không tạo danh mục Miền (chỉ quản lý một cơ sở)");
const roles = await all(`select role from public.staff order by created_at, full_name`);
ok(roles.map((r) => r.role).sort().join(",") === "admin,lead,page,sale,super_admin", "vai trò cũ giữ nguyên", roles);

await db.exec(`
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}',   'Trưởng Marketing', 'marketing_manager'),
    ('${U.ads1}', 'Ads Dương',        'ads_staff'),
    ('${U.ads2}', 'Ads An',           'ads_staff'),
    ('${U.ads3}', 'Ads Sang',         'ads_staff');
`);
ok(true, "thêm được tài khoản vai trò Trưởng Marketing, Nhân viên Ads");
let e = null;
try {
  await db.exec(`update public.staff set role = 'boss' where user_id = '${U.sale1}'`);
} catch (error) {
  e = error.message;
}
ok(/staff_role_check/.test(e ?? ""), "vai trò lạ → bị từ chối", e);

const rlsDenied = /row-level security/;

// ---------------------------------------------------------------------------
section("Đổi vai trò");
e = await errOf(U.sale1, `select public.set_staff_role($1, 'admin')`, [U.sale1]);
ok(/Chỉ Quản trị/.test(e ?? ""), "telesale đổi vai trò → bị từ chối", e);
e = await errOf(U.mm, `select public.set_staff_role($1, 'ads_staff')`, [U.sale1]);
ok(/Chỉ Quản trị/.test(e ?? ""), "Trưởng Marketing đổi vai trò → bị từ chối", e);
e = await errOf(U.adm, `select public.set_staff_role($1, 'admin')`, [U.sale1]);
ok(/Chỉ Quản trị cấp cao/.test(e ?? ""), "Quản trị thường cấp vai trò Quản trị → bị từ chối", e);
e = await errOf(U.adm, `select public.set_staff_role($1, 'sale')`, [U.owner]);
ok(/Quản trị cấp cao/.test(e ?? ""), "không đổi được vai trò của Quản trị cấp cao", e);
e = await errOf(U.owner, `select public.set_staff_role($1, 'sale')`, [U.owner]);
ok(/chính mình/.test(e ?? ""), "không tự đổi vai trò của mình", e);
e = await errOf(U.owner, `select public.set_staff_role($1, 'super_admin')`, [U.adm]);
ok(/không hợp lệ/.test(e ?? ""), "không cấp được vai trò Quản trị cấp cao qua ứng dụng", e);
await db.query(`update public.staff set accepts_leads = true where user_id = $1`, [U.sale1]);
await as(U.adm, `select public.set_staff_role($1, 'ads_staff')`, [U.sale1]);
let row = await one(`select role, accepts_leads from public.staff where user_id = $1`, [U.sale1]);
ok(row.role === "ads_staff" && row.accepts_leads === false, "Quản trị đổi telesale → Nhân viên Ads, tự ra khỏi vòng chia lead", row);
let log = await all(`select actor_id, old_data, new_data from public.audit_log where table_name = 'staff' and record_id = $1 order by id desc limit 1`, [U.sale1]);
ok(log[0]?.actor_id === U.adm && log[0].old_data.role === "sale" && log[0].new_data.role === "ads_staff", "lần đổi vai trò được ghi nhật ký", log[0]);
await as(U.adm, `select public.set_staff_role($1, 'sale')`, [U.sale1]);
await as(U.owner, `select public.set_staff_role($1, 'admin')`, [U.sale1]);
ok((await one(`select role from public.staff where user_id = $1`, [U.sale1])).role === "admin", "Quản trị cấp cao cấp được vai trò Quản trị");
e = await errOf(U.adm, `select public.set_staff_role($1, 'sale')`, [U.sale1]);
ok(/Chỉ Quản trị cấp cao/.test(e ?? ""), "Quản trị thường thu vai trò Quản trị của người khác → bị từ chối", e);
await as(U.owner, `select public.set_staff_role($1, 'sale')`, [U.sale1]);

// ---------------------------------------------------------------------------
section("Quyền xuất file");
e = await errOf(U.sale1, `select public.log_export('leads', 10, '{}'::jsonb)`);
ok(/chưa được cấp quyền xuất file/.test(e ?? ""), "telesale chưa được tick → không xuất được", e);
e = await errOf(U.mm, `select public.log_export('leads', 10, '{}'::jsonb)`);
ok(/chưa được cấp quyền xuất file/.test(e ?? ""), "Trưởng Marketing chưa được tick → không xuất được", e);
ok((await errOf(U.adm, `select public.log_export('leads', 10, '{"file":"a.xlsx"}'::jsonb)`)) === null, "Quản trị xuất được, không cần tick");
e = await errOf(U.sale1, `select public.set_staff_can_export($1, true)`, [U.sale1]);
ok(/Chỉ Quản trị/.test(e ?? ""), "telesale tự tick quyền xuất file → bị từ chối", e);
e = await errOf(U.sale1, `update public.staff set can_export = true where user_id = $1`, [U.sale1]);
ok(/permission denied/.test(e ?? ""), "sửa thẳng bảng staff → bị từ chối", e);
e = await errOf(U.owner, `select public.set_staff_can_export($1, true)`, [U.adm]);
ok(/luôn có quyền này/.test(e ?? ""), "Quản trị luôn có quyền, không tick được", e);
await as(U.adm, `select public.set_staff_can_export($1, true)`, [U.sale1]);
ok((await errOf(U.sale1, `select public.log_export('leads', 3)`)) === null, "được tick → xuất được");
const exports = await as(U.adm, `select user_id, what, row_count, details, ip from public.export_log order by id`);
ok(exports.length === 2 && exports[1].user_id === U.sale1 && exports[1].row_count === 3 && exports[0].details.file === "a.xlsx" && exports[0].ip === "203.0.113.9", "mỗi lần xuất được ghi sổ: ai, cái gì, bao nhiêu dòng, IP", exports);
ok((await as(U.sale1, `select * from public.export_log`)).length === 0, "telesale không xem được sổ xuất file");
e = await errOf(U.adm, `insert into public.export_log (user_id, what) values ($1, 'x')`, [U.adm]);
ok(/permission denied/.test(e ?? ""), "không ai ghi tay vào sổ xuất file", e);
await as(U.adm, `select public.set_staff_can_export($1, false)`, [U.sale1]);
e = await errOf(U.sale1, `select public.log_export('leads', 3)`);
ok(/chưa được cấp quyền xuất file/.test(e ?? ""), "bỏ tick → mất quyền ngay", e);

// ---------------------------------------------------------------------------
section("Danh mục Marketing: ai được thêm / sửa");
const addAdsStaff = async (uid, name, userId = null, code = null) =>
  (await as(uid, `insert into public.ads_staff (full_name, user_id, staff_code) values ($1, $2, $3) returning id`, [name, userId, code]))[0].id;
const duong = await addAdsStaff(U.mm, "Dương", U.ads1, "MKT01");
const an = await addAdsStaff(U.mm, "An", U.ads2, "MKT02");
const sang = await addAdsStaff(U.adm, "Sang", U.ads3);
const hang = await addAdsStaff(U.mm, "Hằng"); // chưa có tài khoản đăng nhập
ok(Boolean(duong && an && sang && hang), "Trưởng Marketing và Quản trị thêm được nhân viên Ads (kể cả người chưa có tài khoản)");
e = await errOf(U.mm, `insert into public.ads_staff (full_name) values ('dương')`);
ok(/duplicate key/.test(e ?? ""), "trùng tên nhân viên Ads → bị chặn", e);
e = await errOf(U.mm, `insert into public.ads_staff (full_name, staff_code) values ('Nam', 'mkt01')`);
ok(/duplicate key/.test(e ?? ""), "trùng mã nhân viên → bị chặn", e);
e = await errOf(U.mm, `insert into public.ads_staff (full_name, user_id) values ('Dương 2', $1)`, [U.ads1]);
ok(/duplicate key/.test(e ?? ""), "một tài khoản gắn hai nhân viên Ads → bị chặn", e);
for (const [who, uid] of [["Trưởng Telesale", U.lead1], ["telesale", U.sale1], ["trực page", U.page1], ["nhân viên Ads", U.ads1]]) {
  e = await errOf(uid, `insert into public.ads_staff (full_name) values ('Lạ')`);
  ok(rlsDenied.test(e ?? ""), `${who} thêm nhân viên Ads → bị từ chối`, e);
}

const addAccount = async (uid, name, channel = fb, accountId = null) =>
  (await as(uid, `insert into public.ad_accounts (name, channel_id, account_id) values ($1, $2, $3) returning id`, [name, channel, accountId]))[0].id;
const acc1 = await addAccount(U.mm, "THE DUONG 01", fb, "act_1001");
const acc2 = await addAccount(U.mm, "An 02", fb, "act_1002");
const acc3 = await addAccount(U.adm, "TikTok Sang 01", tiktok);
e = await errOf(U.mm, `insert into public.ad_accounts (name, channel_id) values ('the duong 01', $1)`, [fb]);
ok(/duplicate key/.test(e ?? ""), "trùng tên TKQC → bị chặn", e);
e = await errOf(U.mm, `insert into public.ad_accounts (name, channel_id, account_id) values ('Khác tên', $1, 'act_1001')`, [fb]);
ok(/duplicate key/.test(e ?? ""), "trùng ID tài khoản trong cùng kênh → bị chặn", e);
e = await errOf(U.lead1, `insert into public.ad_accounts (name, channel_id) values ('Lạ', $1)`, [fb]);
ok(rlsDenied.test(e ?? ""), "Trưởng Telesale thêm TKQC → bị từ chối", e);
e = await errOf(U.lead1, `insert into public.pages (name, channel_id) values ('Page lạ', $1)`, [fb]);
ok(rlsDenied.test(e ?? ""), "Trưởng Telesale không còn thêm được page", e);
e = await errOf(U.lead1, `insert into public.channels (name) values ('Kênh lạ')`);
ok(rlsDenied.test(e ?? ""), "Trưởng Telesale không còn thêm được kênh", e);
await as(U.lead1, `update public.pages set name = 'Bị sửa' where id = $1`, [oldPage]);
ok((await one(`select name from public.pages where id = $1`, [oldPage])).name === "Fanpage cũ", "… và không sửa được page");
ok((await errOf(U.lead1, `insert into public.services (name) values ('Dịch vụ thử')`)) === null, "Trưởng Telesale vẫn thêm được dịch vụ (không thuộc Marketing)");

const newPage = (await as(U.mm, `insert into public.pages (name, channel_id, url, page_staff_ids) values ('Smile Hub 2', $1, 'https://facebook.com/smilehub.2', $2::uuid[]) returning id`, [fb, arr([U.page1])]))[0].id;
ok(Boolean(newPage), "Trưởng Marketing thêm page kèm link, trực page phụ trách");
ok((await one(`select branch from public.pages where id = $1`, [newPage])).branch === "HN", "… không cần chọn cơ sở: page mới tự thuộc cơ sở mặc định");
await as(U.mm, `update public.pages set page_staff_ids = '{}' where id = $1`, [newPage]);
log = await all(`select old_data, new_data from public.audit_log where table_name = 'pages' and record_id = $1 order by id desc limit 1`, [newPage]);
ok(JSON.stringify(Object.keys(log[0].new_data)) === '["page_staff_ids"]' && log[0].old_data.page_staff_ids[0] === U.page1, "đổi trực page phụ trách được ghi nhật ký, không kèm cột ngày sửa", log[0]);

// ---------------------------------------------------------------------------
section("Phân công TKQC theo ngày");
const day = async (offset) => (await one(`select (private.today_vn() + $1::int)::text as d`, [offset])).d;
const assign = async (uid, account, staff, from) =>
  (await as(uid, `select public.assign_ad_account($1, $2, $3::date) as r`, [account, staff, from]))[0].r;

let r = await assign(U.mm, acc1, duong, await day(-60));
ok(r.closed === 0 && Boolean(r.id), "giao TKQC lần đầu", r);
e = await errOf(U.mm, `select public.assign_ad_account($1, $2, $3::date)`, [acc1, duong, await day(-10)]);
ok(/đang phụ trách TKQC này rồi/.test(e ?? ""), "giao lại cho đúng người đang phụ trách → báo lỗi", e);
r = await assign(U.mm, acc1, an, await day(-30));
const closedRow = await one(`select to_date::text as d from public.ad_account_assignments where ad_account_id = $1 and ads_staff_id = $2`, [acc1, duong]);
ok(r.closed === 1 && closedRow.d === (await day(-31)), "giao cho người khác → phân công cũ tự kết thúc hôm trước", [r, closedRow]);
e = await errOf(U.mm, `select public.assign_ad_account($1, $2, $3::date)`, [acc1, sang, await day(-45)]);
ok(/đã có phân công bắt đầu từ ngày/.test(e ?? ""), "giao lùi về trước một phân công đã có → báo lỗi", e);
e = await errOf(U.mm, `insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date, to_date) values ($1, $2, $3::date, $4::date)`, [acc1, sang, await day(-50), await day(-40)]);
ok(/đã có người phụ trách trong khoảng ngày đó/.test(e ?? ""), "thêm tay một phân công chồng ngày → bị chặn", e);
e = await errOf(U.ads1, `select public.assign_ad_account($1, $2, $3::date)`, [acc1, duong, await day(0)]);
ok(/Chỉ Quản trị hoặc Trưởng Marketing/.test(e ?? ""), "nhân viên Ads tự giao TKQC cho mình → bị từ chối", e);
e = await errOf(U.ads1, `insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date) values ($1, $2, $3::date)`, [acc3, duong, await day(0)]);
ok(rlsDenied.test(e ?? ""), "… thêm thẳng vào bảng phân công cũng bị từ chối", e);
await as(U.mm, `update public.ads_staff set is_active = false where id = $1`, [hang]);
e = await errOf(U.mm, `select public.assign_ad_account($1, $2, $3::date)`, [acc3, hang, await day(0)]);
ok(/đã nghỉ/.test(e ?? ""), "giao TKQC cho người đã nghỉ → báo lỗi", e);
await assign(U.mm, acc2, duong, await day(-60));
await assign(U.adm, acc3, sang, await day(-60));
// Lúc này: acc1 = Dương (đã hết) → An (đang);  acc2 = Dương (đang);  acc3 = Sang (đang)

// ---------------------------------------------------------------------------
section("Nhân viên Ads chỉ thấy phần của mình");
const names = async (uid, table, col = "name") =>
  (await as(uid, `select ${col} as v from public.${table} where deleted_at is null order by 1`)).map((x) => x.v);
ok((await names(U.ads1, "ad_accounts")).join("|") === "An 02|THE DUONG 01", "Dương thấy TKQC đang giữ và TKQC từng giữ", await names(U.ads1, "ad_accounts"));
ok((await names(U.ads2, "ad_accounts")).join("|") === "THE DUONG 01", "An chỉ thấy TKQC của mình", await names(U.ads2, "ad_accounts"));
ok((await names(U.mm, "ad_accounts")).length === 3, "Trưởng Marketing thấy tất cả TKQC");
ok((await names(U.sale1, "ad_accounts")).length === 0 && (await names(U.page1, "ad_accounts")).length === 0, "telesale, trực page không thấy TKQC");
ok((await names(U.ads1, "ads_staff", "full_name")).join("|") === "Dương", "nhân viên Ads chỉ thấy dòng của chính mình");
ok((await names(U.mm, "ads_staff", "full_name")).length === 4, "Trưởng Marketing thấy tất cả nhân viên Ads");
ok((await names(U.sale1, "ads_staff", "full_name")).length === 0, "telesale không thấy danh sách nhân viên Ads");
ok((await as(U.ads1, `select id from public.ad_account_assignments`)).length === 2, "Dương thấy 2 phân công của mình");
ok((await as(U.ads2, `select id from public.ad_account_assignments`)).length === 1, "An thấy 1 phân công của mình");

const addCamp = (uid, name, account) =>
  as(uid, `insert into public.campaigns (name, channel_id, ad_account_id, objective, service_id) values ($1, $2, $3, 'messages', $4) returning id`, [name, fb, account, svc]);
const campD = (await addCamp(U.ads1, "Niềng răng — mess (Dương)", acc2))[0].id;
ok(Boolean(campD), "Dương thêm chiến dịch vào TKQC đang giữ");
e = await errOf(U.ads1, `insert into public.campaigns (name, channel_id, ad_account_id) values ('Lạ', $1, $2)`, [fb, acc1]);
ok(rlsDenied.test(e ?? ""), "Dương thêm chiến dịch vào TKQC đã giao cho người khác → bị từ chối", e);
e = await errOf(U.ads1, `insert into public.campaigns (name, channel_id, ad_account_id) values ('Lạ', $1, $2)`, [fb, acc3]);
ok(rlsDenied.test(e ?? ""), "Dương thêm chiến dịch vào TKQC của người khác → bị từ chối", e);
e = await errOf(U.ads1, `insert into public.campaigns (name, channel_id) values ('Không TKQC', $1)`, [fb]);
ok(rlsDenied.test(e ?? ""), "nhân viên Ads thêm chiến dịch không gắn TKQC → bị từ chối", e);
e = await errOf(U.mm, `insert into public.campaigns (name, channel_id, ad_account_id, objective) values ('Sai mục tiêu', $1, $2, 'sales')`, [fb, acc1]);
ok(/objective/.test(e ?? ""), "mục tiêu lạ → bị chặn", e);
const campA = (await addCamp(U.ads2, "Bọc sứ — mess (An)", acc1))[0].id;
const campS = (await addCamp(U.mm, "TikTok — Sang", acc3))[0].id;

ok((await names(U.ads2, "campaigns")).join("|") === "Bọc sứ — mess (An)", "An chỉ thấy chiến dịch trong TKQC của mình", await names(U.ads2, "campaigns"));
ok((await names(U.ads1, "campaigns")).length === 2, "Dương thấy chiến dịch của TKQC đang giữ và TKQC từng giữ", await names(U.ads1, "campaigns"));
ok((await names(U.sale1, "campaigns")).length === 4, "telesale vẫn xem được tên mọi chiến dịch (để tra nguồn của lead)");
await as(U.ads1, `update public.campaigns set budget = 9000000 where id = $1`, [campD]);
ok(Number((await one(`select budget from public.campaigns where id = $1`, [campD])).budget) === 9000000, "Dương sửa được chiến dịch của mình");
await as(U.ads1, `update public.campaigns set budget = 1 where id = $1`, [campA]);
ok((await one(`select budget from public.campaigns where id = $1`, [campA])).budget === null, "Dương không sửa được chiến dịch trong TKQC đã giao cho An");
e = await errOf(U.ads1, `update public.campaigns set ad_account_id = $2 where id = $1`, [campD, acc3]);
ok(rlsDenied.test(e ?? ""), "Dương chuyển chiến dịch của mình sang TKQC người khác → bị từ chối", e);
await as(U.ads2, `update public.campaigns set name = 'Bị An sửa' where id = $1`, [oldCamp]);
ok((await one(`select name from public.campaigns where id = $1`, [oldCamp])).name === "Camp cũ", "nhân viên Ads không sửa được chiến dịch cũ chưa gắn TKQC");

ok((await as(U.ads1, `select id from public.leads`)).length === 0, "nhân viên Ads không xem được lead");
ok((await as(U.ads1, `select id from public.lead_touches`)).length === 0, "… cũng không xem được các lần dán số");
await as(U.ads1, `update public.leads set note = 'ads sửa' where id = $1`, [oldLead]);
ok((await one(`select note from public.leads where id = $1`, [oldLead])).note === null, "… và không sửa được lead");
ok((await as(U.ads1, `select id from public.audit_log`)).length === 0, "… không xem được nhật ký");
ok((await as(U.mm, `select id from public.leads`)).length === 1, "Trưởng Marketing xem được lead");
ok((await as(U.sale1, `select id from public.leads`)).length === 1 && (await as(U.page1, `select id from public.lead_touches`)).length === 1, "telesale, trực page vẫn xem lead như trước");

await as(U.mm, `update public.ads_staff set is_active = false where id = $1`, [duong]);
e = await errOf(U.ads1, `insert into public.campaigns (name, channel_id, ad_account_id) values ('Sau khi nghỉ', $1, $2)`, [fb, acc2]);
ok(rlsDenied.test(e ?? ""), "nhân viên Ads đã chuyển sang Nghỉ → không thêm được chiến dịch", e);
await as(U.mm, `update public.ads_staff set is_active = true where id = $1`, [duong]);
await db.query(`update public.staff set locked_at = now() where user_id = $1`, [U.ads1]);
ok((await as(U.ads1, `select id from public.ad_accounts`)).length === 0 && (await as(U.ads1, `select id from public.campaigns`)).length === 0, "tài khoản Ads bị khoá → không thấy gì");
await db.query(`update public.staff set locked_at = null where user_id = $1`, [U.ads1]);
await db.query(`update public.staff set role = 'sale' where user_id = $1`, [U.ads1]);
ok((await as(U.ads1, `select id from public.ad_accounts`)).length === 0, "đổi sang vai trò khác → không còn thấy TKQC");
await db.query(`update public.staff set role = 'ads_staff' where user_id = $1`, [U.ads1]);

// ---------------------------------------------------------------------------
section("Tách ID bài từ link");
const parse = async (url) => (await one(`select public.parse_post_link($1) as r`, [url])).r;
const cases = [
  ["https://www.facebook.com/smilehub/posts/1234567890123456", "post", "fb:1234567890123456"],
  ["https://m.facebook.com/story.php?story_fbid=1234567890123456&id=100012345", "post", "fb:1234567890123456"],
  ["https://www.facebook.com/permalink.php?story_fbid=1234567890123456&id=100012345&__cft__[0]=AZabc&__tn__=%2CO%2CP-R", "post", "fb:1234567890123456"],
  ["facebook.com/smilehub/posts/ten-bai-viet/1234567890123456/?mibextid=abc#comment", "post", "fb:1234567890123456"],
  ["https://www.facebook.com/100012345_1234567890123456", "post", "fb:1234567890123456"],
  ["100012345_1234567890123456", "post", "fb:1234567890123456"],
  ["https://www.facebook.com/smilehub/posts/pfbid02AbCdEfGh", "post", "fb:pfbid02AbCdEfGh"],
  ["https://www.facebook.com/smilehub/videos/987654321098765/", "post", "fb:987654321098765"],
  ["https://www.facebook.com/watch/?v=987654321098765", "post", "fb:987654321098765"],
  ["https://web.facebook.com/reel/555666777888", "post", "fb:555666777888"],
  ["https://www.facebook.com/photo/?fbid=444555666777&set=a.111", "post", "fb:444555666777"],
  ["https://www.facebook.com/smilehub/photos/a.111/444555666777/", "post", "fb:444555666777"],
  ["https://www.facebook.com/groups/9999/permalink/333444555666/", "post", "fb:333444555666"],
  ["https://fb.watch/abcDEF123/", "short", "fbshort:fb.watch/abcDEF123"],
  ["https://www.facebook.com/share/p/1AbCdEfGh/", "short", "fbshare:1AbCdEfGh"],
  ["https://adsmanager.facebook.com/adsmanager/manage/ads?act=1001&selected_ad_ids=120200000000002", "ad", "fbad:120200000000002"],
  ["https://www.tiktok.com/@smilehub/video/7412345678901234567?is_from_webapp=1&sender_device=pc", "post", "tt:7412345678901234567"],
  ["https://m.tiktok.com/v/7412345678901234567.html", "post", "tt:7412345678901234567"],
  ["https://vt.tiktok.com/ZSabc123/", "short", "ttshort:ZSabc123"],
  ["https://www.tiktok.com/t/ZTxyz789/", "short", "ttshort:ZTxyz789"],
  ["https://zalo.me/smilehub", "unknown", "url:zalo.me/smilehub"],
];
for (const [url, kind, key] of cases) {
  const p = await parse(url);
  ok(p.kind === kind && p.key === key, `${url.slice(0, 70)} → ${key}`, p);
}
const withAd = await parse("https://www.facebook.com/smilehub/posts/1234567890123456?ad_id=120200000000001&utm_source=fb");
ok(withAd.post_id === "1234567890123456" && withAd.ad_id === "120200000000001" && withAd.platform === "facebook", "link kèm ad_id → tách được cả ID bài lẫn ID ads", withAd);
ok((await parse("   ")) === null, "ô trống → không có kết quả");

// ---------------------------------------------------------------------------
section("Bài post");
const addPost = (uid, campaign, url, extra = "") =>
  as(uid, `insert into public.ad_posts (campaign_id, url, title, media_type ${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, 'Bài thử', 'video' ${extra ? ", " + extra.split("=")[1] : ""}) returning id, platform, post_id, ad_id, post_key, status`, [campaign, url]);
const postD = (await addPost(U.ads1, campD, " https://www.facebook.com/smilehub/posts/1234567890123456?ad_id=120200000000001 "))[0];
ok(postD.platform === "facebook" && postD.post_id === "1234567890123456" && postD.ad_id === "120200000000001" && postD.post_key === "fb:1234567890123456" && postD.status === "active", "Dương thêm bài vào chiến dịch của mình, hệ thống tự tách ID bài và ID ads", postD);
e = await errOf(U.mm, `insert into public.ad_posts (campaign_id, url) values ($1, 'https://m.facebook.com/story.php?story_fbid=1234567890123456&id=1')`, [campA]);
ok(/duplicate key/.test(e ?? ""), "cùng một bài (link dạng khác) khai báo lần hai → bị chặn", e);
e = await errOf(U.mm, `insert into public.ad_posts (campaign_id, url) values ($1, 'bài niềng răng số 3')`, [campA]);
ok(/không hợp lệ/.test(e ?? ""), "gõ chữ thay vì link → bị từ chối", e);
e = await errOf(U.ads1, `insert into public.ad_posts (campaign_id, url) values ($1, 'https://www.facebook.com/smilehub/posts/2222222222222222')`, [campA]);
ok(rlsDenied.test(e ?? ""), "Dương thêm bài vào chiến dịch của An → bị từ chối", e);
e = await errOf(U.sale1, `insert into public.ad_posts (campaign_id, url) values ($1, 'https://www.facebook.com/smilehub/posts/2222222222222222')`, [campA]);
ok(rlsDenied.test(e ?? ""), "telesale thêm bài post → bị từ chối", e);
const postA = (await addPost(U.ads2, campA, "https://www.tiktok.com/@smilehub/video/7412345678901234567"))[0];
ok(postA.post_key === "tt:7412345678901234567", "An thêm bài TikTok vào chiến dịch của mình", postA);
const manual = (await as(U.mm, `insert into public.ad_posts (campaign_id, url, ad_id) values ($1, 'https://www.facebook.com/smilehub/posts/3333333333333333', ' 120299999999999 ') returning ad_id`, [campS]))[0];
ok(manual.ad_id === "120299999999999", "link không kèm ID ads → giữ ID ads nhập tay", manual);

ok((await as(U.ads2, `select id from public.ad_posts`)).length === 1, "An chỉ thấy bài của mình");
ok((await as(U.ads1, `select id from public.ad_posts`)).length === 2, "Dương thấy bài của TKQC đang giữ và TKQC từng giữ");
ok((await as(U.sale1, `select id from public.ad_posts`)).length === 3, "telesale xem được bài post (để tra nguồn của lead)");

// Bài "Chưa khai báo" (giai đoạn 2: trực page dán link lạ thì hệ thống tự tạo)
const loose = (await one(`insert into public.ad_posts (url, status) values ('https://www.facebook.com/smilehub/posts/4444444444444444', 'undeclared') returning id`)).id;
ok((await as(U.ads1, `select id from public.ad_posts where id = $1`, [loose])).length === 1 && (await as(U.ads2, `select id from public.ad_posts where id = $1`, [loose])).length === 1, "bài Chưa khai báo: nhân viên Ads nào cũng thấy");
e = await errOf(U.ads1, `update public.ad_posts set campaign_id = $2, status = 'active' where id = $1`, [loose, campA]);
ok(rlsDenied.test(e ?? ""), "Dương nhận bài về chiến dịch của An → bị từ chối", e);
e = await errOf(U.ads1, `update public.ad_posts set status = 'active' where id = $1`, [loose]);
ok(e !== null, "đổi trạng thái mà không gắn chiến dịch → bị chặn", e);
await as(U.ads1, `update public.ad_posts set campaign_id = $2, status = 'active' where id = $1`, [loose, campD]);
row = await one(`select campaign_id, status from public.ad_posts where id = $1`, [loose]);
ok(row.campaign_id === campD && row.status === "active", "Dương nhận bài Chưa khai báo về chiến dịch của mình", row);
ok((await as(U.ads2, `select id from public.ad_posts where id = $1`, [loose])).length === 0, "… sau đó An không còn thấy bài ấy");
e = await errOf(U.mm, `update public.ad_posts set status = 'undeclared' where id = $1`, [loose]);
ok(/ad_posts_declared_check/.test(e ?? ""), "bài đã gắn chiến dịch không quay về Chưa khai báo được", e);

await as(U.ads1, `update public.ad_posts set post_key = 'fb:giả', post_id = 'giả', title = 'Đổi tên' where id = $1`, [postD.id]);
row = await one(`select post_key, post_id, title from public.ad_posts where id = $1`, [postD.id]);
ok(row.post_key === "fb:1234567890123456" && row.post_id === "1234567890123456" && row.title === "Đổi tên", "không sửa tay được ID bài / khoá so khớp; các cột khác sửa bình thường", row);
await as(U.ads1, `update public.ad_posts set url = 'https://www.facebook.com/smilehub/videos/5555555555555555/' where id = $1`, [postD.id]);
row = await one(`select post_key, ad_id from public.ad_posts where id = $1`, [postD.id]);
ok(row.post_key === "fb:5555555555555555" && row.ad_id === "120200000000001", "đổi link → tách lại ID bài, giữ ID ads đã có", row);
log = await all(`select action, actor_id, new_data from public.audit_log where table_name = 'ad_posts' and record_id = $1 order by id`, [postD.id]);
ok(log.length === 3 && log[0].action === "insert" && log[2].actor_id === U.ads1 && !("updated_at" in log[2].new_data) && log[2].new_data.post_key === "fb:5555555555555555", "thêm / sửa bài post đều được ghi nhật ký", log.map((x) => [x.action, Object.keys(x.new_data ?? {})]));
ok((await one(`select updated_at > created_at as changed from public.ad_posts where id = $1`, [postD.id])).changed === true, "ngày sửa tự cập nhật");

// ---------------------------------------------------------------------------
section("Thùng rác với các bảng mới");
const mayTrash = (uid, table) => errOf(uid, `select public.soft_delete_records('${table}', '{}'::uuid[])`);
e = await mayTrash(U.mm, "ad_posts");
ok(/chưa được cấp quyền xoá dữ liệu/.test(e ?? ""), "Trưởng Marketing chưa được tick → không chuyển được vào thùng rác", e);
for (const uid of [U.mm, U.lead1, U.sale1, U.ads1]) await as(U.owner, `select public.set_staff_can_delete($1, true)`, [uid]);
ok((await mayTrash(U.mm, "ad_posts")) === null && (await mayTrash(U.mm, "pages")) === null && (await mayTrash(U.mm, "ad_accounts")) === null, "Trưởng Marketing được tick → chuyển được danh mục Marketing");
e = await mayTrash(U.lead1, "pages");
ok(/Chỉ Quản trị hoặc Trưởng Marketing/.test(e ?? ""), "Trưởng Telesale được tick vẫn không chuyển được danh mục Marketing", e);
ok((await mayTrash(U.lead1, "services")) === null && (await mayTrash(U.lead1, "leads")) === null, "… nhưng chuyển được dịch vụ và lead");
e = await mayTrash(U.mm, "services");
ok(/Chỉ Quản trị hoặc Trưởng Telesale/.test(e ?? ""), "Trưởng Marketing không chuyển được dịch vụ", e);
e = await mayTrash(U.ads1, "campaigns");
ok(/Chỉ Quản trị hoặc Trưởng Marketing/.test(e ?? ""), "nhân viên Ads được tick vẫn không chuyển được chiến dịch", e);
ok((await mayTrash(U.sale1, "leads")) === null, "telesale được tick vẫn chuyển được lead như trước");

const trash = async (uid, table, ids) => (await as(uid, `select public.soft_delete_records($1, $2::uuid[]) as r`, [table, arr(ids)]))[0].r;
e = await errOf(U.mm, `select public.soft_delete_records('campaigns', $1::uuid[])`, [arr([campD])]);
ok(/còn bài post/.test(e ?? ""), "chiến dịch còn bài post → bị chặn", e);
e = await errOf(U.mm, `select public.soft_delete_records('ad_accounts', $1::uuid[])`, [arr([acc2])]);
ok(/còn chiến dịch/.test(e ?? ""), "TKQC còn chiến dịch → bị chặn", e);
e = await errOf(U.mm, `select public.soft_delete_records('ads_staff', $1::uuid[])`, [arr([duong])]);
ok(/chuyển trạng thái sang "Nghỉ"/.test(e ?? ""), "nhân viên Ads đã từng được giao TKQC → bị chặn, gợi ý chuyển sang Nghỉ", e);
e = await errOf(U.mm, `select public.soft_delete_records('channels', $1::uuid[])`, [arr([tiktok])]);
ok(/còn TKQC/.test(e ?? ""), "kênh còn TKQC → bị chặn", e);
r = await trash(U.mm, "ads_staff", [hang]);
ok(r.deleted === 1, "nhân viên Ads chưa từng được giao TKQC → chuyển được", r);

r = await trash(U.mm, "ad_posts", [postD.id, loose]);
ok(r.deleted === 2, "chuyển 2 bài post vào thùng rác", r);
r = await trash(U.mm, "campaigns", [campD]);
ok(r.deleted === 1, "hết bài post → chuyển được chiến dịch", r);
ok((await as(U.ads1, `select id from public.campaigns where id = $1`, [campD])).length === 1, "chiến dịch trong thùng rác vẫn đọc được (để tra tên)");
await as(U.ads1, `update public.campaigns set name = 'Sửa trong thùng rác' where id = $1`, [campD]);
ok((await one(`select name from public.campaigns where id = $1`, [campD])).name === "Niềng răng — mess (Dương)", "… nhưng không sửa được");
const items = await as(U.adm, `select table_name, label from public.trash_items order by table_name, label`);
ok(items.length === 4 && items.some((x) => x.table_name === "ad_posts" && x.label === "Đổi tên") && items.some((x) => x.table_name === "ads_staff" && x.label === "Hằng"), "thùng rác (Quản trị) liệt kê cả bảng mới, có tên dễ đọc", items);
ok((await as(U.mm, `select * from public.trash_items`)).length === 0, "Trưởng Marketing không xem được thùng rác");
e = await errOf(U.mm, `select public.restore_records('ad_posts', $1::uuid[])`, [arr([postD.id])]);
ok(/Chỉ Quản trị/.test(e ?? ""), "Trưởng Marketing không khôi phục được", e);
r = (await as(U.adm, `select public.restore_records('ad_posts', $1::uuid[]) as r`, [arr([postD.id])]))[0].r;
ok(r.restored === 0 && r.blocked === 1, "khôi phục bài post khi chiến dịch còn trong thùng rác → bị chặn", r);
await as(U.adm, `select public.restore_records('campaigns', $1::uuid[])`, [arr([campD])]);
// Trong lúc bài nằm trong thùng rác, có người khai báo lại đúng bài đó.
const again = (await as(U.mm, `insert into public.ad_posts (campaign_id, url) values ($1, 'https://www.facebook.com/smilehub/videos/5555555555555555') returning id`, [campA]))[0].id;
r = (await as(U.adm, `select public.restore_records('ad_posts', $1::uuid[]) as r`, [arr([postD.id, loose])]))[0].r;
ok(r.restored === 1 && r.conflicts === 1, "khôi phục 2 bài: 1 được, 1 trùng với bài vừa khai báo lại", r);
await trash(U.mm, "ad_posts", [again]);

// Phân công: chuyển vào thùng rác rồi khôi phục khi đã có người khác thế chỗ
const anAssign = (await one(`select id from public.ad_account_assignments where ad_account_id = $1 and ads_staff_id = $2`, [acc1, an])).id;
await trash(U.mm, "ad_account_assignments", [anAssign]);
ok((await as(U.ads2, `select id from public.ad_accounts`)).length === 0, "phân công vào thùng rác → An không còn thấy TKQC");
await assign(U.mm, acc1, sang, await day(-5));
r = (await as(U.adm, `select public.restore_records('ad_account_assignments', $1::uuid[]) as r`, [arr([anAssign])]))[0].r;
ok(r.restored === 0 && r.conflicts === 1, "khôi phục phân công cũ khi đã có người khác phụ trách cùng ngày → báo trùng", r);

// Xoá vĩnh viễn và hoàn tác vẫn chạy với bảng mới
e = await errOf(U.adm, `select public.purge_records('ad_posts', $1::uuid[])`, [arr([again])], { pwAgo: 10 });
ok(/Chỉ Quản trị cấp cao/.test(e ?? ""), "Quản trị thường không xoá vĩnh viễn được bài post", e);
await db.query(`update public.ad_posts set deleted_at = now() - interval '91 days' where id = $1`, [again]);
r = (await as(U.owner, `select public.purge_records('ad_posts', $1::uuid[]) as r`, [arr([again])], { pwAgo: 10 }))[0].r;
ok(r.purged === 1, "Quản trị cấp cao xoá vĩnh viễn bài post đã nằm thùng rác đủ 90 ngày", r);
for (const uid of [U.mm, U.ads1, U.ads2, U.sale1, U.lead1, U.adm, U.owner]) {
  e = await errOf(uid, `delete from public.ad_posts where id = $1`, [postA.id]);
  if (!/permission denied/.test(e ?? "")) ok(false, "DELETE thẳng bài post phải bị từ chối", e);
}
ok((await one(`select count(*)::int n from public.ad_posts where id = $1`, [postA.id])).n === 1, "không tài khoản nào DELETE thẳng được bài post");

await as(U.mm, `update public.campaigns set name = 'Tên mới', budget = 1 where id = $1`, [campS]);
const v0 = (await one(`select id from public.audit_log where table_name = 'campaigns' and record_id = $1 and action = 'insert'`, [campS])).id;
e = await errOf(U.mm, `select public.revert_record_to_version($1)`, [v0]);
ok(e !== null, "Trưởng Marketing không dùng được hoàn tác (chỉ Quản trị)", e);
await as(U.adm, `select public.revert_record_to_version($1)`, [v0]);
row = await one(`select name, budget, ad_account_id from public.campaigns where id = $1`, [campS]);
ok(row.name === "TikTok — Sang" && row.budget === null && row.ad_account_id === acc3, "Quản trị hoàn tác chiến dịch về phiên bản lúc tạo", row);

// ---------------------------------------------------------------------------
section("Chức năng cũ vẫn chạy sau 005");
const l2 = await intake(U.page1, "0911000002", "Khách mới");
ok(l2.outcome === "new", "trực page dán lead mới như trước", l2);
ok((await intake(U.page1, "0911000001", "Khách cũ")).outcome === "duplicate", "dán số trùng → báo trùng như trước");
await as(U.sale1, `update public.leads set status = 'hen_lich' where id = $1`, [l2.lead_id]);
ok((await one(`select status from public.leads where id = $1`, [l2.lead_id])).status === "hen_lich", "telesale sửa lead như trước");
r = await trash(U.sale1, "leads", [l2.lead_id]);
ok(r.deleted === 1, "telesale được tick chuyển lead vào thùng rác như trước", r);
r = (await as(U.adm, `select public.restore_records('leads', $1::uuid[]) as r`, [arr([l2.lead_id])]))[0].r;
ok(r.restored === 1, "Quản trị khôi phục lead như trước", r);
e = await errOf(U.sale1, `update public.leads set phone = '0999999999' where id = $1`, [l2.lead_id]);
ok(/không sửa hay gỡ được/.test(e ?? ""), "số điện thoại vẫn không sửa được", e);

section("Dữ liệu mẫu");
const count = async (table) => (await one(`select count(*)::int n from public.${table} where deleted_at is null`)).n;
await db.exec(read("seeds/005_marketing_sample.sql"));
const seeded = [await count("ads_staff"), await count("ad_accounts"), await count("ad_account_assignments"), await count("campaigns"), await count("ad_posts")];
const sevenNames = await all(`select full_name from public.ads_staff where deleted_at is null and full_name in ('Dương', 'Nam', 'An', 'Sang', 'A Hưng', 'Trung', 'Hằng')`);
ok(sevenNames.length === 7, "có đủ 7 nhân viên Ads", sevenNames);
const sample = await one(`select p.post_key, p.platform, c.name, a.name as account from public.ad_posts p join public.campaigns c on c.id = p.campaign_id join public.ad_accounts a on a.id = c.ad_account_id where p.title = 'Video niềng răng 01 (mẫu)'`);
ok(sample?.post_key === "fb:1000000000000001" && sample.account === "THE DUONG 01", "có chiến dịch và bài post mẫu, gắn đúng TKQC", sample);
await db.exec(read("seeds/005_marketing_sample.sql"));
const reseeded = [await count("ads_staff"), await count("ad_accounts"), await count("ad_account_assignments"), await count("campaigns"), await count("ad_posts")];
ok(JSON.stringify(seeded) === JSON.stringify(reseeded), "chạy lại file dữ liệu mẫu lần hai không thêm dòng trùng", [seeded, reseeded]);

section("Người ngoài (anon) không gọi được gì");
for (const sql of [
  `select * from public.ad_accounts`,
  `select * from public.ad_posts`,
  `select * from public.export_log`,
  `select public.assign_ad_account(gen_random_uuid(), gen_random_uuid(), current_date)`,
  `select public.set_staff_role(gen_random_uuid(), 'admin')`,
  `select public.log_export('leads')`,
]) {
  await db.exec("begin; set local role anon;");
  let anonErr = null;
  try {
    await db.query(sql);
  } catch (error) {
    anonErr = error.message;
  }
  await db.exec("rollback");
  ok(/permission denied/.test(anonErr ?? ""), `anon: ${sql.slice(0, 48)}… → bị từ chối`, anonErr);
}

finish();
