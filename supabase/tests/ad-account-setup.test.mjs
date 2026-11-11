// Kiểm thử supabase/007_ad_account_setup.sql (nhân viên tự cài đặt TKQC) trên Postgres chạy trong
// bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "mm", "ads1", "ads2", "ads3", "sale1"]) {
  U[name] = await addUser(name);
}

section("Chạy schema.sql → 007 trên dữ liệu đang có");
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "seeds/005_marketing_sample.sql", "006_ad_daily_reports.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  insert into public.staff (user_id, full_name, role) values
    ('${U.mm}',    'Trưởng Marketing', 'marketing_manager'),
    ('${U.ads1}',  'Dương',            'sale'),
    ('${U.ads2}',  'Linh',             'sale'),
    ('${U.ads3}',  'Khoa',             'ads_staff'),
    ('${U.sale1}', 'Telesale 1',       'sale');
`);
const fbId = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const accountsBefore = await all(`select to_jsonb(a) - 'updated_at' j from public.ad_accounts a order by id`);
const staffBefore = (await one(`select count(*)::int n from public.ads_staff`)).n;

await db.exec(read("007_ad_account_setup.sql"));
ok(true, "007 chạy không lỗi");
await db.exec(read("007_ad_account_setup.sql"));
ok(true, "chạy lại 007 lần hai không lỗi");
const accountsAfter = await all(`select to_jsonb(a) - 'updated_at' - 'account_kind' - 'payment_kind' j from public.ad_accounts a order by id`);
ok(JSON.stringify(accountsAfter) === JSON.stringify(accountsBefore), "TKQC đang có giữ nguyên từng cột");
ok((await one(`select count(*)::int n from public.ad_accounts where account_kind is not null or payment_kind is not null`)).n === 0, "… hai cột mới để trống cho TKQC cũ");
const khoa = await one(`select id, full_name from public.ads_staff where user_id = $1 and deleted_at is null`, [U.ads3]);
ok(khoa?.full_name === "Khoa" && (await one(`select count(*)::int n from public.ads_staff`)).n === staffBefore + 1,
  "tài khoản đã là Nhân viên Ads từ trước được tạo dòng nhân viên Ads", khoa);

// ---------------------------------------------------------------------------
section("Đặt vai trò Nhân viên Ads → tự có dòng nhân viên Ads");
await as(U.owner, `select public.set_staff_role($1, 'ads_staff')`, [U.ads1]);
let row = await one(`select id, full_name, user_id from public.ads_staff where user_id = $1 and deleted_at is null`, [U.ads1]);
const seedDuong = await one(`select id from public.ads_staff where full_name = 'Dương'`);
ok(row?.id === seedDuong.id, "trùng tên một nhân viên Ads chưa có tài khoản (Dương) → gắn vào dòng đó, giữ số liệu cũ", row);
await as(U.owner, `select public.set_staff_role($1, 'ads_staff')`, [U.ads2]);
row = await one(`select full_name from public.ads_staff where user_id = $1`, [U.ads2]);
ok(row?.full_name === "Linh", "tên mới → tạo dòng nhân viên Ads mới", row);
const duong = seedDuong.id;
const linh = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads2])).id;
await as(U.owner, `select public.set_staff_role($1, 'sale')`, [U.ads2]);
await as(U.owner, `select public.set_staff_role($1, 'ads_staff')`, [U.ads2]);
ok((await one(`select count(*)::int n from public.ads_staff where user_id = $1`, [U.ads2])).n === 1, "đổi vai trò qua lại không tạo dòng trùng");

// ---------------------------------------------------------------------------
section("Nhân viên tự thêm TKQC");
const ADD = `select public.add_ad_account($1, $2, $3, $4, $5) as id`;
const add = async (uid, name, ext, kind = "rented", pay = "company_card", staff = null) =>
  (await as(uid, ADD, [name, ext, kind, pay, staff]))[0].id;
const addErr = (uid, name, ext, kind = "rented", pay = "company_card", staff = null) =>
  errOf(uid, ADD, [name, ext, kind, pay, staff]);

const a1 = await add(U.ads2, "Linh 01", "act_1234 5678 90", "rented", "company_card");
let acc = await one(`select * from public.ad_accounts where id = $1`, [a1]);
ok(acc.name === "Linh 01" && acc.account_id === "1234567890" && acc.account_kind === "rented" && acc.payment_kind === "company_card"
  && acc.channel_id === fbId && acc.is_active && acc.created_by === U.ads2, "thêm được: tên, ID (bỏ act_ và khoảng trắng), loại, thanh toán, kênh Facebook", acc);
let asg = await one(`select ads_staff_id, from_date::text, to_date from public.ad_account_assignments where ad_account_id = $1 and deleted_at is null`, [a1]);
ok(asg.ads_staff_id === linh && asg.from_date === "2020-01-01" && asg.to_date === null, "TKQC thuộc về người thêm, từ trước tới nay", asg);
const a2 = await add(U.ads2, "Linh 02", "222222222", "self_built", "personal");
ok(Boolean(a2), "thêm TKQC thứ hai");
const seen = async (uid) => (await as(uid, `select name from public.ad_accounts where deleted_at is null order by name`)).map((x) => x.name);
ok(JSON.stringify(await seen(U.ads2)) === JSON.stringify(["Linh 01", "Linh 02"]), "nhân viên chỉ thấy TKQC của mình", await seen(U.ads2));
ok(!(await seen(U.ads1)).some((n) => n.startsWith("Linh")), "nhân viên khác không thấy TKQC của người này");
ok((await seen(U.mm)).includes("Linh 01") && (await seen(U.mm)).includes("THE DUONG 01"), "Trưởng Marketing thấy TKQC của tất cả mọi người");
const yesterday = (await one(`select (private.today_vn() - 1)::text d`)).d;
ok((await errOf(U.ads2, `insert into public.ad_daily_reports (report_date, ad_account_id, spend, messages, data_count) values ($1::date, $2, 100000, 3, 1)`, [yesterday, a1])) === null,
  "gửi được báo cáo cho TKQC vừa thêm (kể cả ngày đã qua)");
const log = await all(`select table_name, action, actor_id from public.audit_log where actor_id = $1 and table_name in ('ad_accounts', 'ad_account_assignments') order by id`, [U.ads2]);
ok(log.filter((l) => l.action === "insert").length === 4, "mỗi lần thêm TKQC đều vào nhật ký", log);

// ---------------------------------------------------------------------------
section("Chốt chặn khi thêm");
let e = await addErr(U.ads2, "  ", "123456789");
ok(/Nhập tên tài khoản/.test(e ?? ""), "bỏ trống tên → bị từ chối", e);
e = await addErr(U.ads2, "Linh 03", "12ab");
ok(/chỉ gồm chữ số/.test(e ?? ""), "ID có chữ → bị từ chối", e);
e = await addErr(U.ads2, "Linh 03", "333333333", "x");
ok(/TK thuê hoặc Tự build/.test(e ?? ""), "chưa chọn loại tài khoản → bị từ chối", e);
e = await addErr(U.ads2, "Linh 03", "333333333", "rented", null);
ok(/cá nhân hoặc thẻ công ty/.test(e ?? ""), "chưa chọn thanh toán → bị từ chối", e);
e = await addErr(U.ads1, "Dương X", "1234567890");
ok(/đã được khai báo/.test(e ?? "") && /Linh 01/.test(e ?? ""), "ID đã có người khai báo → bị từ chối, nói rõ TKQC nào", e);
e = await addErr(U.ads1, "linh 01", "444444444");
ok(/Đã có TKQC tên/.test(e ?? ""), "trùng tên TKQC → bị từ chối", e);
e = await addErr(U.ads1, "Dương 99", "555555555", "rented", "personal", linh);
ok(/chỉ thêm được TKQC cho chính mình/.test(e ?? ""), "nhân viên thêm TKQC cho người khác → bị từ chối", e);
e = await addErr(U.sale1, "Sale 01", "666666666");
ok(/Chỉ nhân viên chạy quảng cáo hoặc quản lý/.test(e ?? ""), "telesale thêm TKQC → bị từ chối", e);
e = await addErr(U.mm, "Không chủ", "777777777");
ok(/Chọn nhân viên quảng cáo/.test(e ?? ""), "quản lý thêm mà không chọn nhân viên → bị từ chối", e);
const m1 = await add(U.mm, "Dương 05", "888888888", "self_built", "company_card", duong);
ok((await one(`select ads_staff_id from public.ad_account_assignments where ad_account_id = $1`, [m1])).ads_staff_id === duong, "quản lý thêm TKQC cho nhân viên khác được");
ok((await seen(U.ads1)).includes("Dương 05"), "… và nhân viên đó thấy ngay TKQC này");
e = await errOf(U.ads2, `insert into public.ad_accounts (name, channel_id) values ('Lách luật', $1)`, [fbId]);
ok(/row-level security/.test(e ?? ""), "nhân viên ghi thẳng vào bảng TKQC → bị từ chối", e);

// ---------------------------------------------------------------------------
section("Xoá TKQC (nút thùng rác)");
const REMOVE = `select public.remove_ad_account($1) as r`;
e = await errOf(U.ads1, REMOVE, [a2]);
ok(/chỉ xoá được TKQC của chính mình/.test(e ?? ""), "nhân viên xoá TKQC của người khác → bị từ chối", e);
e = await errOf(U.sale1, REMOVE, [a2]);
ok(/chỉ xoá được TKQC của chính mình/.test(e ?? ""), "telesale xoá TKQC → bị từ chối", e);
let r = (await as(U.ads2, REMOVE, [a2]))[0].r;
acc = await one(`select deleted_at, deleted_by from public.ad_accounts where id = $1`, [a2]);
ok(r === "trashed" && acc.deleted_at && acc.deleted_by === U.ads2, "TKQC chưa có báo cáo → chuyển vào Thùng rác (không xoá hẳn)", { r, acc });
ok((await one(`select count(*)::int n from public.ad_account_assignments where ad_account_id = $1 and deleted_at is null`, [a2])).n === 0, "… phân công của TKQC đó cũng vào thùng rác");
ok((await as(U.owner, `select id from public.trash_items where id = $1`, [a2])).length === 1, "… và hiện trong Thùng rác để Quản trị khôi phục");
ok(!(await seen(U.ads2)).includes("Linh 02"), "… nhân viên không còn thấy TKQC đó");
r = (await as(U.ads2, REMOVE, [a1]))[0].r;
acc = await one(`select deleted_at, is_active from public.ad_accounts where id = $1`, [a1]);
ok(r === "deactivated" && acc.deleted_at === null && acc.is_active === false, "TKQC đã có báo cáo → chỉ chuyển sang Ngừng dùng, giữ số liệu", { r, acc });
ok((await one(`select count(*)::int n from public.ad_daily_reports where ad_account_id = $1`, [a1])).n === 1, "… báo cáo cũ vẫn nguyên");
const back = await add(U.ads2, "Linh 01 mới", "1234567890", "self_built", "personal");
acc = await one(`select name, is_active, account_kind from public.ad_accounts where id = $1`, [a1]);
ok(back === a1 && acc.is_active && acc.name === "Linh 01 mới" && acc.account_kind === "self_built", "thêm lại đúng ID đó → dùng lại TKQC cũ (giữ lịch sử), cập nhật thông tin", acc);
r = (await as(U.mm, REMOVE, [m1]))[0].r;
ok(r === "trashed", "quản lý xoá được TKQC của bất kỳ ai");
e = await errOf(U.ads2, `delete from public.ad_accounts where id = $1`, [a1]);
ok(/permission denied|row-level security/.test(e ?? "") || (await one(`select count(*)::int n from public.ad_accounts where id = $1`, [a1])).n === 1, "không ai xoá hẳn TKQC bằng lệnh xoá", e);

finish();
