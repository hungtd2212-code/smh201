// Kiểm thử supabase/008_staff_accounts.sql (danh sách cơ sở, thêm người dùng, phân quyền trang) trên
// Postgres chạy trong bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
//
// Bảng auth.users / auth.identities và hàm mã hoá mật khẩu ở đây là bản giả lập rút gọn của Supabase:
// kiểm được quy tắc của ứng dụng, còn việc đăng nhập thật phải thử trên Supabase.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

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
`);

const U = {};
for (const name of ["owner", "adm", "mm", "sale1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 008 trên dữ liệu đang có");
await db.exec(read("schema.sql"));
await db.exec(`
  insert into public.staff (user_id, full_name, role, created_at) values
    ('${U.owner}', 'Chủ phòng khám', 'admin', now() - interval '10 days'),
    ('${U.adm}',   'Quản trị 2',     'admin', now() - interval '5 days'),
    ('${U.sale1}', 'Telesale 1',     'sale',  now());
`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql"]) {
  await db.exec(read(file));
}
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.mm}', 'Trưởng Marketing', 'marketing_manager')`);
const staffBefore = await all(`select to_jsonb(s) j from public.staff s order by user_id`);

await db.exec(read("008_staff_accounts.sql"));
ok(true, "008 chạy không lỗi");
await db.exec(read("008_staff_accounts.sql"));
ok(true, "chạy lại 008 lần hai không lỗi");
const staffAfter = await all(`select to_jsonb(s) - 'username' - 'position' - 'branch_id' - 'page_access' - 'deleted_at' j from public.staff s order by user_id`);
ok(JSON.stringify(staffAfter) === JSON.stringify(staffBefore), "tài khoản đang có giữ nguyên từng cột");
ok((await one(`select count(*)::int n from public.staff where page_access is not null or position is not null`)).n === 0, "… cột mới để trống: tài khoản cũ vẫn thấy menu theo vai trò như trước");
const branches = await all(`select id, name from public.branches`);
ok(branches.length === 1 && branches[0].name === "201 Trường Chinh", "có sẵn đúng một cơ sở: 201 Trường Chinh", branches);
const hq = branches[0].id;

// ---------------------------------------------------------------------------
section("Danh sách cơ sở");
const b2 = (await as(U.adm, `insert into public.branches (name, address) values ('Cơ sở 2', '12 Láng Hạ') returning id`))[0].id;
ok(Boolean(b2), "Quản trị thêm được cơ sở (tên, địa chỉ)");
let e = await errOf(U.adm, `insert into public.branches (name) values ('cơ sở 2')`);
ok(/branches_name_key|duplicate/.test(e ?? ""), "trùng tên cơ sở → bị từ chối", e);
e = await errOf(U.mm, `insert into public.branches (name) values ('Cơ sở 3')`);
ok(/row-level security/.test(e ?? ""), "Trưởng Marketing thêm cơ sở → bị từ chối", e);
ok((await as(U.sale1, `select name from public.branches`)).length === 2, "mọi nhân viên xem được danh sách cơ sở");
e = await errOf(U.adm, `delete from public.branches where id = $1`, [b2]);
ok(/permission denied/.test(e ?? ""), "không ai xoá được cơ sở (chỉ chuyển Ngừng dùng)", e);
await as(U.adm, `update public.branches set is_active = false where id = $1`, [b2]);

// ---------------------------------------------------------------------------
section("Thêm người dùng");
const CREATE = `select public.create_staff_account($1, $2, $3, $4, $5) as id`;
const create = async (uid, username, position, branch = hq, name = "Nhân viên mới", pw = "123456789@") =>
  (await as(uid, CREATE, [username, pw, name, position, branch]))[0].id;
const createErr = (uid, username, position, branch = hq, name = "Nhân viên mới", pw = "123456789@") =>
  errOf(uid, CREATE, [username, pw, name, position, branch]);

const linh = await create(U.adm, " Dieu.Linh ", "ads_staff", hq, "Đinh Thị Diệu Linh");
let user = await one(`select email, encrypted_password, email_confirmed_at, aud, role, confirmation_token from auth.users where id = $1`, [linh]);
ok(user.email === "dieu.linh@smilehub.local" && user.encrypted_password === "hash:123456789@" && user.email_confirmed_at
  && user.aud === "authenticated" && user.confirmation_token === "", "tạo tài khoản đăng nhập: tên đăng nhập → dieu.linh@smilehub.local, mật khẩu mã hoá, xác nhận sẵn", user);
ok((await one(`select provider, provider_id from auth.identities where user_id = $1`, [linh]))?.provider === "email", "… kèm danh tính đăng nhập bằng mật khẩu");
let row = await one(`select full_name, role, username, position, branch_id, page_access from public.staff where user_id = $1`, [linh]);
ok(row.full_name === "Đinh Thị Diệu Linh" && row.role === "ads_staff" && row.username === "dieu.linh" && row.position === "ads_staff"
  && row.branch_id === hq && Array.isArray(row.page_access) && row.page_access.length === 0,
  "… và dòng nhân sự: vị trí Nhân viên quảng cáo → vai trò Nhân viên Ads, nơi làm việc, chưa có quyền xem trang nào", row);
ok(Boolean(await one(`select id from public.ads_staff where user_id = $1 and deleted_at is null`, [linh])), "nhân viên quảng cáo tự có trong danh sách nhân viên Ads");
const log = await one(`select actor_id, new_data from public.audit_log where table_name = 'staff' and record_id = $1 and action = 'insert'`, [linh]);
ok(log?.actor_id === U.adm && !JSON.stringify(log.new_data).includes("123456789@"), "việc thêm người được ghi nhật ký, không ghi mật khẩu", log);
const page1 = await create(U.adm, "trucpage1", "page", hq, "Trực page 1");
ok((await one(`select role from public.staff where user_id = $1`, [page1])).role === "page", "vị trí Trực page → vai trò Trực page");
const leadAds = await create(U.adm, "lead.ads", "lead_ads", hq, "Lead Ads");
ok((await one(`select role from public.staff where user_id = $1`, [leadAds])).role === "marketing_manager", "vị trí Lead Ads → vai trò Trưởng Marketing");

e = await createErr(U.adm, "coo1", "coo");
ok(/Chỉ Quản trị cấp cao được thêm người ở vị trí COO/.test(e ?? ""), "Quản trị thường thêm COO → bị từ chối", e);
const coo = await create(U.owner, "coo1", "coo", hq, "COO");
ok((await one(`select role from public.staff where user_id = $1`, [coo])).role === "admin", "Quản trị cấp cao thêm COO được → vai trò Quản trị");
for (const [args, re, label] of [
  [["ab", "page"], /Tên đăng nhập 3–30/, "tên đăng nhập quá ngắn"],
  [["Thu Hoa", "page"], /Tên đăng nhập 3–30/, "tên đăng nhập có khoảng trắng"],
  [["thư.hoa", "page"], /Tên đăng nhập 3–30/, "tên đăng nhập có dấu"],
  [["thu.hoa", "page", hq, "Hoa", "1234567"], /tối thiểu 8/, "mật khẩu dưới 8 ký tự"],
  [["thu.hoa", "page", hq, "  "], /Nhập tên nhân viên/, "bỏ trống tên nhân viên"],
  [["thu.hoa", null], /Chọn vị trí/, "chưa chọn vị trí"],
  [["thu.hoa", "page", null], /Chọn nơi làm việc/, "chưa chọn nơi làm việc"],
  [["thu.hoa", "page", b2], /Chọn nơi làm việc/, "cơ sở đang ngừng dùng"],
  [["DIEU.LINH", "page"], /đã có người dùng/, "trùng tên đăng nhập (không phân biệt hoa thường)"],
]) {
  e = await createErr(U.adm, ...args);
  ok(re.test(e ?? ""), `${label} → bị từ chối`, e);
}
e = await createErr(U.mm, "mm.new", "page");
ok(/Chỉ Quản trị được thêm người/.test(e ?? ""), "Trưởng Marketing thêm người → bị từ chối", e);
ok((await one(`select has_function_privilege('anon', 'public.create_staff_account(text, text, text, text, uuid)', 'execute') as p`)).p === false, "người chưa đăng nhập không gọi được hàm thêm người");

// ---------------------------------------------------------------------------
section("Sửa, đặt lại mật khẩu, khoá");
const UPDATE = `select public.update_staff_account($1, $2, $3, $4)`;
await as(U.adm, UPDATE, [page1, "Trực page Một", "ads_staff", b2]);
row = await one(`select full_name, role, position, branch_id from public.staff where user_id = $1`, [page1]);
ok(row.full_name === "Trực page Một" && row.role === "ads_staff" && row.position === "ads_staff" && row.branch_id === b2, "sửa tên, vị trí (vai trò đổi theo), nơi làm việc", row);
await as(U.adm, UPDATE, [page1, "Trực page Một", null, hq]);
ok((await one(`select role from public.staff where user_id = $1`, [page1])).role === "ads_staff", "không chọn vị trí → giữ nguyên vị trí cũ");
e = await errOf(U.adm, UPDATE, [coo, "COO đổi tên", null, hq]);
ok(/Chỉ Quản trị cấp cao/.test(e ?? ""), "Quản trị thường sửa tài khoản COO → bị từ chối", e);
e = await errOf(U.adm, UPDATE, [page1, "X", "coo", hq]);
ok(/Chỉ Quản trị cấp cao/.test(e ?? ""), "Quản trị thường nâng người khác lên COO → bị từ chối", e);
e = await errOf(U.adm, UPDATE, [U.owner, "X", "page", hq]);
ok(/Quản trị cấp cao/.test(e ?? ""), "không sửa được tài khoản Quản trị cấp cao", e);
e = await errOf(U.adm, UPDATE, [U.adm, "Tự sửa", "page", hq]);
ok(/chính mình/.test(e ?? ""), "không tự sửa tài khoản của mình ở đây", e);

await as(U.adm, `select public.reset_staff_password($1, $2)`, [linh, "MatKhauMoi@1"]);
ok((await one(`select encrypted_password from auth.users where id = $1`, [linh])).encrypted_password === "hash:MatKhauMoi@1", "Quản trị đặt lại mật khẩu được");
const note = await one(`select note, actor_id, new_data from public.audit_log where table_name = 'staff' and record_id = $1 and note = 'Đặt lại mật khẩu'`, [linh]);
ok(note?.actor_id === U.adm && !JSON.stringify(note.new_data).includes("MatKhauMoi"), "… ghi nhật ký “Đặt lại mật khẩu”, không ghi mật khẩu", note);
e = await errOf(U.adm, `select public.reset_staff_password($1, $2)`, [U.owner, "abcdefgh"]);
ok(/Quản trị cấp cao/.test(e ?? ""), "không đặt lại được mật khẩu Quản trị cấp cao", e);
e = await errOf(U.mm, `select public.reset_staff_password($1, $2)`, [linh, "abcdefgh"]);
ok(/Chỉ Quản trị/.test(e ?? ""), "Trưởng Marketing đặt lại mật khẩu → bị từ chối", e);

await as(U.adm, `select public.set_staff_lock($1, true)`, [linh]);
ok((await one(`select banned_until from auth.users where id = $1`, [linh])).banned_until !== null, "khoá tài khoản → cấm đăng nhập luôn");
await as(U.adm, `select public.set_staff_lock($1, false)`, [linh]);
ok((await one(`select banned_until from auth.users where id = $1`, [linh])).banned_until === null, "mở khoá → đăng nhập lại được");

// ---------------------------------------------------------------------------
section("Phân quyền trang");
const ACCESS = `select public.set_staff_page_access($1, $2::text[])`;
await as(U.adm, ACCESS, [linh, "{/marketing/tong-quan,/marketing/nhap-lieu,/marketing/nhap-lieu}"]);
ok(JSON.stringify((await one(`select page_access from public.staff where user_id = $1`, [linh])).page_access) === JSON.stringify(["/marketing/nhap-lieu", "/marketing/tong-quan"]), "tick trang nào thì lưu trang đó (bỏ trùng)");
e = await errOf(U.adm, ACCESS, [linh, "{javascript:alert(1)}"]);
ok(/không hợp lệ/.test(e ?? ""), "đường dẫn trang lạ → bị từ chối", e);
e = await errOf(U.adm, ACCESS, [U.adm, "{/marketing/tong-quan}"]);
ok(/chính mình/.test(e ?? ""), "không tự phân quyền cho mình", e);
e = await errOf(U.sale1, ACCESS, [linh, "{/marketing/tong-quan}"]);
ok(/Chỉ Quản trị/.test(e ?? ""), "telesale phân quyền → bị từ chối", e);
e = await errOf(U.adm, `update public.staff set page_access = '{}' where user_id = $1`, [linh]);
ok(/permission denied/.test(e ?? ""), "sửa thẳng bảng nhân sự → bị từ chối", e);
const logins = await as(U.adm, `select * from public.list_staff_logins()`);
ok(logins.some((l) => l.user_id === U.owner && l.email === "owner@test"), "Quản trị xem được email đăng nhập của tài khoản cũ");
e = await errOf(U.sale1, `select * from public.list_staff_logins()`);
ok(/Chỉ Quản trị/.test(e ?? ""), "người khác không xem được email đăng nhập", e);

// ---------------------------------------------------------------------------
section("Xoá nhân sự");
const REMOVE = `select public.remove_staff_account($1)`;
e = await errOf(U.adm, REMOVE, [page1]);
ok(/chưa được cấp quyền xoá/.test(e ?? ""), "Quản trị chưa được tick “Xoá dữ liệu” → không xoá được", e);
await as(U.owner, REMOVE, [page1]);
row = await one(`select deleted_at, locked_at, locked_reason from public.staff where user_id = $1`, [page1]);
ok(row.deleted_at && row.locked_at && /Đã xoá/.test(row.locked_reason), "Quản trị cấp cao xoá được: ẩn khỏi danh sách, khoá luôn", row);
ok((await one(`select banned_until from auth.users where id = $1`, [page1])).banned_until !== null, "… và cấm đăng nhập");
ok((await one(`select count(*)::int n from public.staff where user_id = $1`, [page1])).n === 1, "… nhưng không xoá hẳn (tên vẫn còn trong dữ liệu cũ)");
ok((await one(`select is_active from public.ads_staff where user_id = $1`, [page1])).is_active === false, "… nhân viên Ads tương ứng chuyển sang Nghỉ");
e = await errOf(U.owner, REMOVE, [U.owner]);
ok(/chính mình/.test(e ?? ""), "không tự xoá mình", e);
e = await errOf(U.owner, UPDATE, [page1, "Sửa người đã xoá", null, hq]);
ok(/Không tìm thấy tài khoản/.test(e ?? ""), "người đã xoá không sửa được nữa", e);

// ---------------------------------------------------------------------------
section("009: tài khoản Quản trị cấp cao mặc định là admin");
await db.query(`insert into auth.identities (user_id, provider_id, provider, identity_data) values ($1::uuid, $2, 'email', $3::jsonb)`,
  [U.owner, U.owner, JSON.stringify({ sub: U.owner, email: "owner@test" })]);
await db.exec(`update public.staff set full_name = 'Tên của bạn' where user_id = '${U.owner}'`);
await db.exec(read("009_admin_account.sql"));
ok(true, "009 chạy không lỗi");
let owner = await one(`select s.full_name, s.username, u.email, i.identity_data ->> 'email' as identity_email
  from public.staff s join auth.users u on u.id = s.user_id left join auth.identities i on i.user_id = s.user_id
  where s.user_id = $1`, [U.owner]);
ok(owner.full_name === "Admin" && owner.username === "admin" && owner.email === "admin@smilehub.local" && owner.identity_email === "admin@smilehub.local",
  "Quản trị cấp cao: tên Admin, tên đăng nhập admin (đăng nhập bằng “admin”)", owner);
ok((await one(`select count(*)::int n from public.staff where username is null and role = 'admin'`)).n >= 1, "… tài khoản Quản trị khác không bị đổi");
await db.exec(read("009_admin_account.sql"));
ok((await one(`select username from public.staff where user_id = $1`, [U.owner])).username === "admin", "chạy lại 009 lần hai không đổi gì thêm");

const OWN = `select public.update_own_account($1, $2)`;
await as(U.owner, OWN, ["Trịnh Duy Hưng", "Admin"]);
owner = await one(`select s.full_name, s.username, u.email from public.staff s join auth.users u on u.id = s.user_id where s.user_id = $1`, [U.owner]);
ok(owner.full_name === "Trịnh Duy Hưng" && owner.username === "admin" && owner.email === "admin@smilehub.local", "tự sửa tên được; tên đăng nhập giữ nguyên (không phân biệt hoa thường)", owner);
await as(U.owner, OWN, ["Trịnh Duy Hưng", "hung.admin"]);
owner = await one(`select s.username, u.email from public.staff s join auth.users u on u.id = s.user_id where s.user_id = $1`, [U.owner]);
ok(owner.username === "hung.admin" && owner.email === "hung.admin@smilehub.local", "tự đổi tên đăng nhập → đăng nhập bằng tên mới", owner);
e = await errOf(U.owner, OWN, ["X", "dieu.linh"]);
ok(/đã có người dùng/.test(e ?? ""), "đổi sang tên đăng nhập của người khác → bị từ chối", e);
e = await errOf(U.owner, OWN, ["X", "a b"]);
ok(/Tên đăng nhập 3–30/.test(e ?? ""), "tên đăng nhập sai dạng → bị từ chối", e);
e = await errOf(U.adm, OWN, ["X", "adm.new"]);
ok(/Chỉ Quản trị cấp cao/.test(e ?? ""), "Quản trị thường dùng hàm này → bị từ chối", e);

section("009: xoá cơ sở");
const b3 = (await as(U.adm, `insert into public.branches (name) values ('Cơ sở tạm') returning id`))[0].id;
const DEL = `select public.delete_branch($1)`;
e = await errOf(U.adm, DEL, [b3]);
ok(/Chỉ Quản trị cấp cao được xoá cơ sở/.test(e ?? ""), "Quản trị thường xoá cơ sở → bị từ chối", e);
await as(U.owner, DEL, [b3]);
ok((await one(`select count(*)::int n from public.branches where id = $1`, [b3])).n === 0, "Quản trị cấp cao xoá được cơ sở chưa có nhân sự");
ok((await one(`select action from public.audit_log where table_name = 'branches' and record_id = $1 order by id desc limit 1`, [b3])).action === "purge", "… việc xoá được ghi nhật ký");
e = await errOf(U.owner, DEL, [hq]);
ok(/còn \d+ nhân sự/.test(e ?? ""), "cơ sở còn nhân sự → không xoá được", e);

// ---------------------------------------------------------------------------
section("011: tên nhân viên Ads luôn theo tên tài khoản");
// Tình trạng trước 011: đã sửa tên tài khoản nhưng tên nhân viên Ads vẫn là tên lúc tạo.
await as(U.adm, UPDATE, [linh, "Nguyễn Văn An", null, hq]);
ok((await one(`select full_name from public.ads_staff where user_id = $1`, [linh])).full_name === "Đinh Thị Diệu Linh", "(trước 011) tên nhân viên Ads vẫn là tên lúc tạo");
const freeName = (await as(U.mm, `insert into public.ads_staff (full_name) values ('Lê Thảo') returning id`))[0].id;
await db.exec(read("011_sync_ads_staff_name.sql"));
ok(true, "011 chạy không lỗi");
await db.exec(read("011_sync_ads_staff_name.sql"));
ok(true, "chạy lại 011 lần hai không lỗi");
ok((await one(`select full_name from public.ads_staff where user_id = $1`, [linh])).full_name === "Nguyễn Văn An", "dòng đang lệch tên được sửa theo tên tài khoản");
const syncLog = await one(`select note, old_data, new_data from public.audit_log where table_name = 'ads_staff' and note like 'Đồng bộ tên%' order by id desc limit 1`);
ok(syncLog?.old_data.full_name === "Đinh Thị Diệu Linh" && syncLog.new_data.full_name === "Nguyễn Văn An", "… và ghi nhật ký tên cũ → tên mới", syncLog);
await as(U.adm, UPDATE, [linh, "Nguyễn Văn An B", null, hq]);
ok((await one(`select full_name from public.ads_staff where user_id = $1`, [linh])).full_name === "Nguyễn Văn An B", "từ nay sửa tên tài khoản → tên nhân viên Ads đổi theo ngay");
await as(U.adm, UPDATE, [linh, "lê thảo", null, hq]);
ok((await one(`select full_name from public.ads_staff where user_id = $1`, [linh])).full_name === "lê thảo (2)", "trùng tên một nhân viên Ads khác → thêm (2) cho khỏi trùng");
ok((await one(`select full_name from public.ads_staff where id = $1`, [freeName])).full_name === "Lê Thảo", "… nhân viên Ads kia giữ nguyên tên");

// ---------------------------------------------------------------------------
section("015: thêm 2 vị trí Telesale");
// 015 chỉ dựa vào 008 (cột staff.position và hàm role_of_position) nên chạy thẳng ở đây.
e = await createErr(U.adm, "tele.truoc", "telesale");
ok(/Chọn vị trí/.test(e ?? ""), "(trước 015) vị trí Telesale chưa dùng được", e);
const positionChecks = `select count(*)::int n from pg_constraint
  where conrelid = 'public.staff'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%lead_ads%'`;
const staffBefore015 = JSON.stringify(await all(`select to_jsonb(s) j from public.staff s order by user_id`));
await db.exec(read("015_telesale_positions.sql"));
ok(true, "015 chạy không lỗi");
await db.exec(read("015_telesale_positions.sql"));
ok(true, "chạy lại 015 lần hai không lỗi");
ok(JSON.stringify(await all(`select to_jsonb(s) j from public.staff s order by user_id`)) === staffBefore015, "015 không đổi dòng nhân sự nào đang có");
ok((await one(positionChecks)).n === 1, "chỉ còn đúng một ràng buộc danh sách vị trí");

const tele = await create(U.adm, "tele.mot", "telesale", hq, "Telesale Một");
row = await one(`select role, position, page_access from public.staff where user_id = $1`, [tele]);
ok(row.role === "sale" && row.position === "telesale" && row.page_access.length === 0, "vị trí Telesale → vai trò Telesale, chưa có quyền xem trang nào", row);
const teleLead = await create(U.adm, "truong.tele", "lead_telesale", hq, "Trưởng Telesale");
ok((await one(`select role from public.staff where user_id = $1`, [teleLead])).role === "lead", "vị trí Trưởng Telesale → vai trò Trưởng Telesale");
await as(U.adm, UPDATE, [tele, "Telesale Một", "lead_telesale", hq]);
row = await one(`select role, position from public.staff where user_id = $1`, [tele]);
ok(row.role === "lead" && row.position === "lead_telesale", "đổi vị trí Telesale → Trưởng Telesale: vai trò đổi theo", row);
await as(U.adm, UPDATE, [tele, "Telesale Một", "page", hq]);
ok((await one(`select role from public.staff where user_id = $1`, [tele])).role === "page", "4 vị trí cũ vẫn dùng được như trước");
e = await createErr(U.adm, "bac.si", "bac_si");
ok(/Chọn vị trí/.test(e ?? ""), "vị trí chưa khai báo → bị từ chối", e);
e = await errOf(U.adm, UPDATE, [tele, "Telesale Một", "bac_si", hq]);
ok(/Vị trí không hợp lệ/.test(e ?? ""), "sửa sang vị trí chưa khai báo → bị từ chối", e);
let checkErr = null;
try {
  await db.query(`update public.staff set position = 'bac_si' where user_id = $1`, [tele]);
} catch (err) {
  checkErr = err.message;
}
ok(/staff_position_check/.test(checkErr ?? ""), "cột vị trí chỉ nhận 6 vị trí đã khai báo", checkErr);
e = await createErr(U.mm, "tele.hai", "telesale");
ok(/Chỉ Quản trị được thêm người/.test(e ?? ""), "Trưởng Marketing thêm Telesale → bị từ chối", e);

// ---------------------------------------------------------------------------
section("016: Lead Ads cũng là người chạy quảng cáo");
const adsRow = (uid) => one(`select id, full_name from public.ads_staff where user_id = $1 and deleted_at is null`, [uid]);
const adsCount = async () => (await one(`select count(*)::int n from public.ads_staff`)).n;
ok(!(await adsRow(leadAds)), "(trước 016) tài khoản Lead Ads chưa có tên trong danh sách nhân viên Ads");
const adsBefore016 = await adsCount();
await db.exec(read("016_lead_ads_runs_ads.sql"));
ok(true, "016 chạy không lỗi");
ok((await adsRow(leadAds))?.full_name === "Lead Ads", "tài khoản Lead Ads đang có → được thêm tên vào danh sách nhân viên Ads");
ok(Boolean(await adsRow(U.mm)), "… kể cả tài khoản Trưởng Marketing tạo từ trước khi có vị trí");
ok((await adsCount()) === adsBefore016 + 2, "… mỗi người đúng một dòng, không đụng tới dòng nào khác");
await db.exec(read("016_lead_ads_runs_ads.sql"));
ok((await adsCount()) === adsBefore016 + 2, "chạy lại 016 lần hai không tạo trùng");

const lead2 = await create(U.adm, "lead.ads2", "lead_ads", hq, "Lead Ads Hai");
ok((await adsRow(lead2))?.full_name === "Lead Ads Hai", "thêm người ở vị trí Lead Ads → tự có tên trong danh sách nhân viên Ads");
await as(U.adm, UPDATE, [teleLead, "Trưởng Telesale", "lead_ads", hq]);
ok(Boolean(await adsRow(teleLead)), "đổi người sang vị trí Lead Ads → cũng được thêm tên");
ok(!(await adsRow(tele)), "vị trí khác (Trực page) không có tên trong danh sách nhân viên Ads");
const ads3 = await create(U.adm, "ads.ba", "ads_staff", hq, "Nhân viên Ads Ba");
ok(Boolean(await adsRow(ads3)), "vị trí Nhân viên quảng cáo vẫn tự có tên như trước");

// Lead Ads khai báo TKQC cho chính mình, rồi cho một nhân viên.
const ADD_ACCOUNT = `select public.add_ad_account($1, $2, $3, $4, $5) as id`;
const ownerOfAccount = async (id) =>
  (await one(`select ads_staff_id from public.ad_account_assignments where ad_account_id = $1 and deleted_at is null`, [id])).ads_staff_id;
const leadRow = await adsRow(lead2);
const leadAccount = (await as(lead2, ADD_ACCOUNT, ["LEAD 01", "900000000000001", "rented", "company_card", leadRow.id]))[0].id;
ok((await ownerOfAccount(leadAccount)) === leadRow.id, "Lead Ads thêm được TKQC đứng tên chính mình");
const staffAccount = (await as(lead2, ADD_ACCOUNT, ["ADS BA 01", "900000000000002", "self_built", "personal", (await adsRow(ads3)).id]))[0].id;
ok((await ownerOfAccount(staffAccount)) === (await adsRow(ads3)).id, "Lead Ads thêm được TKQC cho một Nhân viên quảng cáo");

finish();
