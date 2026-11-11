// Kiểm thử các file SQL trong thư mục supabase/ trên một Postgres chạy ngay trong bộ nhớ
// (PGlite), có giả lập các thứ Supabase cung cấp sẵn: role anon / authenticated, schema auth,
// auth.uid(), auth.jwt(). Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  npm run test:db
// Nên chạy lại mỗi khi sửa hoặc thêm file SQL, TRƯỚC khi đem chạy trên Supabase.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(dir, name), "utf8");
const db = new PGlite();

let passed = 0;
let failed = 0;
function ok(cond, label, extra) {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${extra !== undefined ? " → " + JSON.stringify(extra) : ""}`);
  }
}
const section = (name) => console.log(`\n== ${name}`);

// --- Giả lập Supabase: role, schema auth, quyền mặc định -------------------
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

const U = {};
for (const name of ["owner", "adm", "lead1", "sale1", "sale2", "page1"]) {
  U[name] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`${name}@test`])).rows[0].id;
}

section("Chạy schema.sql, 002, 003, 004");
await db.exec(read("schema.sql"));
await db.exec(`
  insert into public.staff (user_id, full_name, role, created_at) values
    ('${U.owner}', 'Chủ phòng khám', 'admin', now() - interval '10 days'),
    ('${U.adm}',   'Quản trị 2',     'admin', now() - interval '5 days'),
    ('${U.lead1}', 'Trưởng nhóm',    'lead',  now()),
    ('${U.sale1}', 'Telesale 1',     'sale',  now()),
    ('${U.sale2}', 'Telesale 2',     'sale',  now());
`);
await db.exec(read("002_marketing_lead.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.page1}', 'Trực page 1', 'page')`);
await db.exec(read("003_data_safety.sql"));
ok(true, "ba file chạy không lỗi");
await db.exec(read("003_data_safety.sql"));
ok(true, "chạy lại 003 lần hai không lỗi");
await db.exec(read("004_delete_permission.sql"));
await db.exec(read("004_delete_permission.sql"));
ok(true, "004 chạy hai lần không lỗi");

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;

/** Chạy một lệnh như thể người dùng `uid` gọi qua API (role authenticated + JWT). */
async function as(uid, sql, params = [], { pwAgo = 3600 } = {}) {
  const claims = {
    sub: uid,
    role: "authenticated",
    amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - pwAgo }],
  };
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await db.query(`select set_config('request.headers', $1, true)`, [
      JSON.stringify({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1, 10.0.0.2" }),
    ]);
    const result = await db.query(sql, params);
    await db.exec("commit");
    return result.rows;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
/** Như `as` nhưng trả về thông báo lỗi (hoặc null nếu không lỗi). */
async function errOf(uid, sql, params, opts) {
  try {
    await as(uid, sql, params, opts);
    return null;
  } catch (error) {
    return error.message;
  }
}
const arr = (ids) => `{${ids.join(",")}}`;
const pause = (ms) => new Promise((res) => setTimeout(res, ms));
/**
 * Một mốc giờ của cơ sở dữ liệu, dùng làm đầu / cuối khoảng thời gian khi thử hoàn tác theo lô
 * (khoảng tính từ mốc "từ" đến TRƯỚC mốc "đến"). Đồng hồ của PGlite chỉ chính xác tới
 * mili-giây, nên phải nghỉ vài mili-giây trước và sau khi lấy mốc; nếu không, thao tác ngay
 * sát mốc có thể mang đúng giờ của mốc và rơi ra ngoài khoảng. Postgres thật chính xác tới
 * micro-giây nên không gặp chuyện này. Trả về dạng chữ để JavaScript không làm tròn.
 */
const dbNow = async () => {
  await pause(5);
  const { t } = await one(`select clock_timestamp()::text as t`);
  await pause(5);
  return t;
};

const role = async (uid) => (await one(`select role from public.staff where user_id = $1`, [uid])).role;
section("Vai trò");
ok((await role(U.owner)) === "super_admin", "quản trị tạo sớm nhất được nâng thành super_admin");
ok((await role(U.adm)) === "admin", "quản trị thứ hai giữ nguyên admin");

// --- Danh mục --------------------------------------------------------------
const fb = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const svc = (await one(`select id from public.services where name = 'Niềng răng'`)).id;
const pageRow = (await as(U.lead1, `insert into public.pages (name, channel_id) values ('Fanpage A', $1) returning id`, [fb]))[0];
const camp = (await as(U.lead1, `insert into public.campaigns (name, channel_id, page_id, service_id) values ('Camp A', $1, $2, $3) returning id`, [fb, pageRow.id, svc]))[0];

const intake = async (uid, phone, name, assignee = null) =>
  (await as(uid, `select public.intake_lead($1, $2, $3, $4, $5, $6, null, 'HN', null, null, $7) as r`, [phone, name, fb, pageRow.id, camp.id, svc, assignee]))[0].r;

section("Dán lead + nhật ký");
const l1 = await intake(U.page1, "0911000001", "Khách Một");
ok(l1.outcome === "new", "dán số mới", l1);
let log = await all(`select * from public.audit_log where table_name = 'leads' and record_id = $1 order by id`, [l1.lead_id]);
ok(log.length === 1 && log[0].action === "insert" && log[0].actor_id === U.page1, "ghi 1 dòng insert, đúng người dán", log);
ok(log[0].ip === "203.0.113.9", "ghi đúng IP", log[0].ip);
ok(log[0].new_data === null && log[0].old_data === null, "insert không lưu dữ liệu thừa");

await as(U.sale1, `update public.leads set status = 'hen_lich', note = 'hẹn thứ 7' where id = $1`, [l1.lead_id]);
log = await all(`select * from public.audit_log where table_name = 'leads' and record_id = $1 order by id`, [l1.lead_id]);
ok(log.length === 2 && log[1].action === "update", "sửa → 1 dòng update");
ok(
  JSON.stringify(Object.keys(log[1].new_data).sort()) === JSON.stringify(["note", "status", "status_changed_at"]),
  "chỉ lưu các cột bị đổi",
  Object.keys(log[1].new_data),
);
ok(log[1].old_data.status === "so_moi" && log[1].new_data.status === "hen_lich", "giá trị cũ / mới đúng");
await as(U.sale1, `update public.leads set note = 'hẹn thứ 7' where id = $1`, [l1.lead_id]);
ok((await one(`select count(*)::int n from public.audit_log where record_id = $1`, [l1.lead_id])).n === 2, "sửa mà không đổi gì → không ghi thêm");
ok((await one(`select count(*)::int n from public.audit_log where table_name = 'staff'`)).n === 0, "lượt xoay vòng (last_assigned_at) không bị ghi");

section("Quyền xoá dữ liệu theo ô tick");
// Gọi với danh sách rỗng: hàm kiểm tra quyền trước, rồi trả về 0 mà không đụng bản ghi nào.
const mayTrash = (uid, table = "leads") => errOf(uid, `select public.soft_delete_records('${table}', '{}'::uuid[])`);
const ticked = async (uid) => (await one(`select can_delete from public.staff where user_id = $1`, [uid])).can_delete;
ok((await all(`select 1 from public.staff where can_delete`)).length === 0, "mặc định không tài khoản nào được tick");
for (const [who, uid] of [["telesale", U.sale1], ["trực page", U.page1], ["Lead", U.lead1], ["Quản trị", U.adm]]) {
  const err = await mayTrash(uid);
  ok(/chưa được cấp quyền xoá dữ liệu/.test(err ?? ""), `${who} chưa được tick → không chuyển được vào thùng rác`, err);
}
ok((await mayTrash(U.owner)) === null, "Quản trị cấp cao luôn có quyền, không cần tick");

// Ai được tick
let perm = await errOf(U.sale1, `select public.set_staff_can_delete($1, true)`, [U.sale1]);
ok(/Chỉ Quản trị cấp cao/.test(perm ?? ""), "telesale tự tick cho mình → bị từ chối", perm);
perm = await errOf(U.adm, `select public.set_staff_can_delete($1, true)`, [U.lead1]);
ok(/Chỉ Quản trị cấp cao/.test(perm ?? ""), "Quản trị thường tick cho người khác → bị từ chối", perm);
perm = await errOf(U.sale1, `update public.staff set can_delete = true where user_id = $1`, [U.sale1]);
ok(/permission denied/.test(perm ?? ""), "telesale sửa thẳng bảng staff → bị từ chối", perm);
ok((await ticked(U.sale1)) === false, "… ô tick của telesale vẫn trống");
perm = await errOf(U.owner, `select public.set_staff_can_delete($1, false)`, [U.owner]);
ok(/luôn có quyền này/.test(perm ?? ""), "không bỏ tick được của Quản trị cấp cao", perm);

// Tick cho telesale: chuyển được lead, không đụng được danh mục; bỏ tick thì mất quyền ngay.
await as(U.owner, `select public.set_staff_can_delete($1, true)`, [U.sale1]);
ok((await mayTrash(U.sale1)) === null, "telesale được tick → chuyển được lead vào thùng rác");
perm = await mayTrash(U.sale1, "channels");
ok(/Chỉ Quản trị hoặc Lead/.test(perm ?? ""), "telesale được tick vẫn không chuyển được danh mục", perm);
let permLog = await all(`select actor_id, old_data, new_data from public.audit_log where table_name = 'staff' and record_id = $1 order by id desc limit 1`, [U.sale1]);
ok(permLog[0]?.actor_id === U.owner && permLog[0].old_data.can_delete === false && permLog[0].new_data.can_delete === true, "lần tick được ghi vào nhật ký", permLog[0]);
await as(U.owner, `select public.set_staff_can_delete($1, false)`, [U.sale1]);
perm = await mayTrash(U.sale1);
ok(/chưa được cấp quyền xoá dữ liệu/.test(perm ?? ""), "bỏ tick → mất quyền ngay", perm);

// Tài khoản được tick nhưng đang bị khoá thì không làm được gì.
await as(U.owner, `select public.set_staff_can_delete($1, true)`, [U.sale2]);
await db.query(`update public.staff set locked_at = now() where user_id = $1`, [U.sale2]);
perm = await mayTrash(U.sale2);
ok(/chưa được cấp quyền xoá dữ liệu/.test(perm ?? ""), "được tick nhưng đang bị khoá → không chuyển được", perm);
await db.query(`update public.staff set locked_at = null, can_delete = false where user_id = $1`, [U.sale2]);

// Các phép thử phía dưới dùng Lead (trưởng nhóm) đã được tick.
await as(U.owner, `select public.set_staff_can_delete($1, true)`, [U.lead1]);
ok((await mayTrash(U.lead1)) === null && (await mayTrash(U.lead1, "channels")) === null, "Lead được tick → chuyển được cả lead lẫn danh mục");

section("Quyền xoá");
let e = await errOf(U.sale1, `update public.leads set deleted_at = now() where id = $1`, [l1.lead_id]);
ok(/Chuyển vào thùng rác \/ khôi phục/.test(e ?? ""), "telesale tự sửa deleted_at → bị chặn", e);
e = await errOf(U.sale1, `select public.soft_delete_records('leads', $1::uuid[])`, [arr([l1.lead_id])]);
ok(/chưa được cấp quyền xoá dữ liệu/.test(e ?? ""), "telesale (không được tick) gọi hàm chuyển vào thùng rác → bị từ chối", e);
e = await errOf(U.page1, `select public.soft_delete_records('leads', $1::uuid[])`, [arr([l1.lead_id])]);
ok(/chưa được cấp quyền xoá dữ liệu/.test(e ?? ""), "trực page (không được tick) gọi hàm chuyển vào thùng rác → bị từ chối", e);
// Không tài khoản nào — kể cả Quản trị cấp cao — xoá thẳng được một lead.
for (const [who, uid] of [["telesale", U.sale1], ["trực page", U.page1], ["Lead", U.lead1], ["Quản trị", U.adm], ["Quản trị cấp cao", U.owner]]) {
  e = await errOf(uid, `delete from public.leads where id = $1`, [l1.lead_id]);
  ok(/permission denied/.test(e ?? ""), `${who} DELETE thẳng một lead → bị từ chối`, e);
  e = await errOf(uid, `delete from public.lead_touches where lead_id = $1`, [l1.lead_id]);
  ok(/permission denied/.test(e ?? ""), `${who} DELETE thẳng lần tiếp cận → bị từ chối`, e);
}
ok((await one(`select count(*)::int n from public.leads where id = $1`, [l1.lead_id])).n === 1, "… lead vẫn còn nguyên");

// Số điện thoại đã thêm thì không ai sửa hay gỡ được, trừ Quản trị cấp cao.
const phoneBefore = (await one(`select phone from public.leads where id = $1`, [l1.lead_id])).phone;
for (const [who, uid] of [["telesale", U.sale1], ["Lead", U.lead1], ["Quản trị", U.adm]]) {
  e = await errOf(uid, `update public.leads set phone = '0999999999' where id = $1`, [l1.lead_id]);
  ok(/không sửa hay gỡ được/.test(e ?? ""), `${who} sửa số điện thoại của lead → bị chặn`, e);
}
e = await errOf(U.sale1, `update public.leads set phone = '', note = 'gỡ số' where id = $1`, [l1.lead_id]);
ok(/không sửa hay gỡ được/.test(e ?? ""), "telesale gỡ trắng số điện thoại → bị chặn", e);
ok((await one(`select phone from public.leads where id = $1`, [l1.lead_id])).phone === phoneBefore, "… số điện thoại còn nguyên");
e = await errOf(U.sale1, `update public.leads set phone = $2, note = 'hẹn thứ 7' where id = $1`, [l1.lead_id, phoneBefore]);
ok(e === null, "gửi lại đúng số cũ kèm thay đổi khác → không bị chặn", e);
e = await errOf(U.owner, `update public.leads set phone = '0911000009' where id = $1`, [l1.lead_id]);
ok(e === null, "Quản trị cấp cao sửa được số điện thoại", e);
log = await all(`select old_data, new_data from public.audit_log where record_id = $1 order by id desc limit 1`, [l1.lead_id]);
ok(log[0].old_data.phone === phoneBefore && log[0].new_data.phone === "0911000009", "… và số cũ được giữ trong nhật ký", log[0]);
await db.query(`update public.leads set phone = $2 where id = $1`, [l1.lead_id, phoneBefore]);
e = await errOf(U.lead1, `select public.soft_delete_records('staff', $1::uuid[])`, [arr([U.sale1])]);
ok(/không có thùng rác/.test(e ?? ""), "bảng không có thùng rác → từ chối", e);

section("Xoá mềm, thùng rác, khôi phục");
let r = (await as(U.lead1, `select public.soft_delete_records('leads', $1::uuid[]) as r`, [arr([l1.lead_id])]))[0].r;
ok(r.deleted === 1, "Lead (trưởng nhóm) đã được tick chuyển được 1 lead vào thùng rác", r);
ok((await as(U.sale1, `select id from public.leads where id = $1`, [l1.lead_id])).length === 0, "telesale không còn thấy lead đã xoá");
ok((await as(U.adm, `select id from public.leads where id = $1`, [l1.lead_id])).length === 1, "quản trị vẫn thấy");
ok((await as(U.adm, `select * from public.trash_items`)).length === 1, "thùng rác (quản trị) có 1 dòng");
ok((await as(U.lead1, `select * from public.trash_items`)).length === 0, "thùng rác với Lead: trống");
e = await errOf(U.sale1, `update public.leads set note = 'x' where id = $1 returning id`, [l1.lead_id]);
ok(e === null, "telesale sửa lead đã xoá → không lỗi nhưng không đổi dòng nào");
ok((await one(`select note from public.leads where id = $1`, [l1.lead_id])).note === "hẹn thứ 7", "… dữ liệu giữ nguyên");
log = await all(`select action, actor_id from public.audit_log where record_id = $1 order by id desc limit 1`, [l1.lead_id]);
ok(log[0].action === "delete" && log[0].actor_id === U.lead1, "nhật ký ghi hành động delete");

let chk = (await as(U.page1, `select public.check_lead_phone('0911000001') as r`))[0].r;
ok(chk.outcome === "new", "số của lead đã xoá được coi là số mới", chk);
const l1b = await intake(U.page1, "0911000001", "Khách Một (mới)");
ok(l1b.outcome === "new" && l1b.lead_id !== l1.lead_id, "dán lại → tạo lead mới");
e = await errOf(U.lead1, `select public.restore_records('leads', $1::uuid[])`, [arr([l1.lead_id])]);
ok(/Chỉ Quản trị/.test(e ?? ""), "Lead không được khôi phục", e);
r = (await as(U.adm, `select public.restore_records('leads', $1::uuid[]) as r`, [arr([l1.lead_id])]))[0].r;
ok(r.restored === 0 && r.conflicts === 1, "khôi phục khi đã có lead mới cùng số → báo trùng", r);
await as(U.lead1, `select public.soft_delete_records('leads', $1::uuid[])`, [arr([l1b.lead_id])]);
r = (await as(U.adm, `select public.restore_records('leads', $1::uuid[]) as r`, [arr([l1.lead_id])]))[0].r;
ok(r.restored === 1, "xoá lead mới rồi khôi phục lead cũ → được", r);
ok((await as(U.sale1, `select id from public.leads where id = $1`, [l1.lead_id])).length === 1, "telesale thấy lại lead");

section("Danh mục: xoá, trùng tên, khôi phục");
e = await errOf(U.lead1, `select public.soft_delete_records('channels', $1::uuid[])`, [arr([fb])]);
ok(/còn page/.test(e ?? ""), "xoá kênh còn page → bị chặn", e);
e = await errOf(U.lead1, `select public.soft_delete_records('pages', $1::uuid[])`, [arr([pageRow.id])]);
ok(/còn chiến dịch/.test(e ?? ""), "xoá page còn chiến dịch → bị chặn", e);
const zalo = (await one(`select id from public.channels where name = 'Zalo'`)).id;
await as(U.lead1, `select public.soft_delete_records('channels', $1::uuid[])`, [arr([zalo])]);
ok((await as(U.sale1, `select id from public.channels where id = $1`, [zalo])).length === 1, "kênh đã xoá vẫn đọc được (để tra tên)");
e = await errOf(U.lead1, `update public.channels set name = 'Zalo 2' where id = $1`, [zalo]);
ok((await one(`select name from public.channels where id = $1`, [zalo])).name === "Zalo", "không sửa được kênh đã xoá");
const zalo2 = (await as(U.lead1, `insert into public.channels (name) values ('Zalo') returning id`))[0].id;
ok(Boolean(zalo2), "tạo kênh mới trùng tên kênh đã xoá → được");
r = (await as(U.adm, `select public.restore_records('channels', $1::uuid[]) as r`, [arr([zalo])]))[0].r;
ok(r.conflicts === 1, "khôi phục kênh cũ khi đã có kênh cùng tên → báo trùng", r);
e = await errOf(U.lead1, `insert into public.channels (name) values ('Facebook')`);
ok(/duplicate key/.test(e ?? ""), "trùng tên với kênh đang dùng vẫn bị chặn", e);
e = await errOf(U.lead1, `insert into public.channels (name, deleted_at) values ('Rác', now())`);
ok(/nằm sẵn trong thùng rác/.test(e ?? ""), "không tạo được bản ghi ở trạng thái đã xoá", e);

section("Xoá hàng loạt cần mật khẩu");
const bulk = [];
for (let i = 0; i < 30; i++) bulk.push((await intake(U.page1, `09220000${String(i).padStart(2, "0")}`, `Loạt ${i}`)).lead_id);
// Xoá các dòng "delete" cũ khỏi cửa sổ 10 phút để phép thử độc lập.
await db.exec(`update public.audit_log set at = at - interval '1 hour' where action = 'delete'`);
e = await errOf(U.lead1, `select public.soft_delete_records('leads', $1::uuid[])`, [arr(bulk.slice(0, 21))]);
ok(e === "PASSWORD_REQUIRED", "xoá 21 lead, mật khẩu nhập đã lâu → đòi mật khẩu", e);
r = (await as(U.lead1, `select public.soft_delete_records('leads', $1::uuid[]) as r`, [arr(bulk.slice(0, 20))]))[0].r;
ok(r.deleted === 20, "xoá đúng 20 lead → không cần mật khẩu", r);
e = await errOf(U.lead1, `select public.soft_delete_records('leads', $1::uuid[])`, [arr(bulk.slice(20, 21))]);
ok(e === "PASSWORD_REQUIRED", "xoá thêm 1 lead trong 10 phút (tổng 21) → đòi mật khẩu", e);
r = (await as(U.lead1, `select public.soft_delete_records('leads', $1::uuid[]) as r`, [arr(bulk.slice(20, 30))], { pwAgo: 30 }))[0].r;
ok(r.deleted === 10, "vừa nhập lại mật khẩu → xoá được", r);
const tx = await all(`select count(distinct txid)::int n from public.audit_log where action = 'delete' and at > now() - interval '5 minutes'`);
ok(tx[0].n === 2, "mỗi lần xoá hàng loạt chung một mã thao tác (txid)", tx);

section("Xoá vĩnh viễn");
e = await errOf(U.adm, `select public.purge_records('leads', $1::uuid[])`, [arr(bulk.slice(0, 2))], { pwAgo: 10 });
ok(/Chỉ Quản trị cấp cao/.test(e ?? ""), "admin thường không được xoá vĩnh viễn", e);
e = await errOf(U.owner, `select public.purge_records('leads', $1::uuid[])`, [arr(bulk.slice(0, 2))]);
ok(e === "PASSWORD_REQUIRED", "super_admin chưa nhập lại mật khẩu → đòi mật khẩu", e);
e = await errOf(U.owner, `select public.purge_records('leads', $1::uuid[])`, [arr(bulk.slice(0, 2))], { pwAgo: 10 });
ok(/chưa đủ 90 ngày/.test(e ?? ""), "chưa đủ 90 ngày → từ chối", e);
await db.query(`update public.leads set deleted_at = now() - interval '91 days' where id = any ($1::uuid[])`, [arr(bulk.slice(0, 2))]);
r = (await as(U.owner, `select public.purge_records('leads', $1::uuid[]) as r`, [arr(bulk.slice(0, 2))], { pwAgo: 10 }))[0].r;
ok(r.purged === 2, "đủ 91 ngày + mật khẩu → xoá vĩnh viễn 2 lead", r);
log = await all(`select action, old_data from public.audit_log where record_id = $1 order by id desc limit 1`, [bulk[0]]);
ok(log[0].action === "purge" && log[0].old_data.phone === "0922000000", "nhật ký giữ nguyên bản ghi đã xoá vĩnh viễn");
ok((await one(`select count(*)::int n from public.lead_touches where lead_id = $1`, [bulk[0]])).n === 0, "các lần tiếp cận của lead đó cũng bị xoá");
e = await errOf(U.owner, `select public.purge_records('channels', $1::uuid[])`, [arr([fb])], { pwAgo: 10 });
ok(e === null, "xoá vĩnh viễn bản ghi chưa nằm trong thùng rác → không xoá gì");
ok((await one(`select count(*)::int n from public.channels where id = $1`, [fb])).n === 1, "… kênh vẫn còn");

section("Hoàn tác về phiên bản");
const l2 = await intake(U.page1, "0933000001", "Khách Hai", U.sale1);
await as(U.sale1, `update public.leads set status = 'goi_lai_sau', note = 'gọi lại chiều' where id = $1`, [l2.lead_id]);
const v1 = (await one(`select id from public.audit_log where record_id = $1 order by id desc limit 1`, [l2.lead_id])).id;
const t1 = (await one(`select status_changed_at from public.leads where id = $1`, [l2.lead_id])).status_changed_at;
await new Promise((res) => setTimeout(res, 20));
await as(U.sale1, `update public.leads set status = 'fail', note = null, full_name = 'Tên sai' where id = $1`, [l2.lead_id]);
await as(U.sale2, `update public.leads set appointment_at = now(), invalid_phone = true where id = $1`, [l2.lead_id]);
e = await errOf(U.sale1, `select public.revert_record_to_version($1)`, [v1]);
ok(/không có quyền hoàn tác/.test(e ?? ""), "telesale không được hoàn tác", e);
r = (await as(U.lead1, `select public.revert_record_to_version($1) as r`, [v1]))[0].r;
const after = await one(`select status, note, full_name, appointment_at, invalid_phone, status_changed_at, touch_count from public.leads where id = $1`, [l2.lead_id]);
ok(after.status === "goi_lai_sau" && after.note === "gọi lại chiều" && after.full_name === "Khách Hai", "trạng thái, ghi chú, tên trở về phiên bản đã chọn", after);
ok(after.appointment_at === null && after.invalid_phone === false, "thay đổi của người khác sau đó cũng được gỡ", after);
ok(new Date(after.status_changed_at).getTime() === new Date(t1).getTime(), "mốc đổi trạng thái trở về đúng mốc cũ", [after.status_changed_at, t1]);
log = await all(`select note, actor_id from public.audit_log where record_id = $1 order by id desc limit 1`, [l2.lead_id]);
ok(/Hoàn tác về phiên bản/.test(log[0].note ?? "") && log[0].actor_id === U.lead1, "lần hoàn tác cũng được ghi nhật ký", log[0]);
r = (await as(U.lead1, `select public.revert_record_to_version($1) as r`, [v1]))[0].r;
ok(r.columns === 0, "hoàn tác lần nữa → không còn gì để đổi", r);
const touchInvalid = await one(`select is_invalid from public.lead_touches where lead_id = $1 order by created_at desc limit 1`, [l2.lead_id]);
ok(touchInvalid.is_invalid === false, "dấu số sai trên lần dán cũng được trả lại");

section("Hoàn tác theo lô");
const b = [];
for (let i = 0; i < 4; i++) b.push((await intake(U.page1, `09440000${i}0`, `Lô ${i}`)).lead_id);
const from = await dbNow();
await as(U.sale2, `update public.leads set status = 'so_huy', note = 'phá' where id = any ($1::uuid[])`, [arr(b)]);
await as(U.sale2, `update public.leads set full_name = 'XXX' where id = $1`, [b[0]]);
await as(U.adm, `update public.leads set note = 'quản trị sửa tay' where id = $1`, [b[1]]); // người khác sửa tiếp
const created = (await intake(U.sale2, "0944000099", "Lead do sale2 tạo")).lead_id;
const to = await dbNow();
e = await errOf(U.lead1, `select public.undo_changes($1, $2, $3, false)`, [U.sale2, from, to]);
ok(/Chỉ Quản trị/.test(e ?? ""), "Lead không được hoàn tác theo lô", e);
r = (await as(U.adm, `select public.undo_changes($1, $2, $3, false) as r`, [U.sale2, from, to]))[0].r;
ok(r.applied === false && r.records === 4 && r.conflicts === 1 && r.trashed === 1, "xem trước: 4 bản ghi, 1 xung đột, 1 vào thùng rác", r);
ok((await one(`select status from public.leads where id = $1`, [b[0]])).status === "so_huy", "xem trước không đổi dữ liệu");
r = (await as(U.adm, `select public.undo_changes($1, $2, $3, true) as r`, [U.sale2, from, to]))[0].r;
ok(r.applied === true && r.records === 4, "áp dụng", r);
const rows = await all(`select id, status, note, full_name from public.leads where id = any ($1::uuid[])`, [arr(b)]);
ok(rows.every((x) => x.status === "so_moi"), "trạng thái 4 lead trở về Số mới", rows.map((x) => x.status));
ok(rows.find((x) => x.id === b[0]).full_name === "Lô 0", "tên trở về");
ok(rows.find((x) => x.id === b[1]).note === "quản trị sửa tay", "cột người khác sửa sau được giữ nguyên");
ok(rows.find((x) => x.id === b[2]).note === null, "ghi chú trở về trống");
ok((await one(`select deleted_at from public.leads where id = $1`, [created])).deleted_at !== null, "lead tài khoản đó tạo → vào thùng rác");
log = await all(`select distinct note from public.audit_log where note like 'Hoàn tác theo lô%'`);
ok(log.length === 1, "ghi chú hoàn tác theo lô", log);

// sale2 (tạm được tick) chuyển lead vào thùng rác rồi bị hoàn tác → lead được khôi phục
await db.query(`update public.staff set can_delete = true where user_id = $1`, [U.sale2]);
const from2 = await dbNow();
await as(U.sale2, `select public.soft_delete_records('leads', $1::uuid[])`, [arr([b[3]])], { pwAgo: 10 });
const to2 = await dbNow();
r = (await as(U.adm, `select public.undo_changes($1, $2, $3, true) as r`, [U.sale2, from2, to2]))[0].r;
ok((await one(`select deleted_at from public.leads where id = $1`, [b[3]])).deleted_at === null, "hoàn tác theo lô khôi phục lead bị xoá", r);
await db.query(`update public.staff set can_delete = false where user_id = $1`, [U.sale2]);

section("Cảnh báo bất thường và khoá tài khoản");
await db.exec(`update public.app_settings set value = '5' where key = 'anomaly_max_changes_per_hour'`);
await db.exec(`update public.audit_log set at = at - interval '2 hours'`);
const many = [];
for (let i = 0; i < 8; i++) many.push((await intake(U.page1, `09550000${i}0`, `Nhiều ${i}`)).lead_id);
for (let i = 0; i < 5; i++) await as(U.sale1, `update public.leads set note = 'a' where id = $1`, [many[i]]);
ok((await one(`select locked_at from public.staff where user_id = $1`, [U.sale1])).locked_at === null, "5 bản ghi (= ngưỡng) → chưa khoá");
await as(U.sale1, `update public.leads set note = 'b' where id = $1`, [many[0]]);
ok((await one(`select locked_at from public.staff where user_id = $1`, [U.sale1])).locked_at === null, "sửa lại cùng bản ghi → không tính thêm");
await as(U.sale1, `update public.leads set note = 'a' where id = $1`, [many[5]]);
const locked = await one(`select locked_at, locked_reason, accepts_leads from public.staff where user_id = $1`, [U.sale1]);
ok(locked.locked_at !== null, "bản ghi thứ 6 → tự khoá", locked);
const alerts = await as(U.adm, `select * from public.security_alerts where resolved_at is null`);
ok(alerts.length === 1 && alerts[0].user_id === U.sale1 && alerts[0].locked === true, "có 1 cảnh báo cho quản trị", alerts);
ok((await as(U.sale1, `select id from public.leads`)).length === 0, "tài khoản bị khoá không còn đọc được lead");
await as(U.sale1, `update public.leads set note = 'c' where id = $1`, [many[6]]);
ok((await one(`select note from public.leads where id = $1`, [many[6]])).note === null, "… và không sửa được gì");
e = await errOf(U.sale1, `select public.intake_lead('0955999999', 'x', $1)`, [fb]);
ok(/chưa được cấp quyền/.test(e ?? ""), "… không dán được lead", e);
// (sale1 còn có 2 dòng nhật ký tick / bỏ tick quyền xoá ở trên — chỉ xét dòng khoá tài khoản)
log = await all(`select note from public.audit_log where table_name = 'staff' and record_id = $1 and new_data ? 'locked_at'`, [U.sale1]);
ok(log.length === 1 && /tự khoá/.test(log[0].note), "việc tự khoá được ghi nhật ký", log);
e = await errOf(U.lead1, `select public.resolve_security_alert($1, true)`, [alerts[0].id]);
ok(/Chỉ Quản trị/.test(e ?? ""), "Lead không xử lý được cảnh báo", e);
await as(U.adm, `select public.resolve_security_alert($1, true)`, [alerts[0].id]);
ok((await one(`select locked_at from public.staff where user_id = $1`, [U.sale1])).locked_at === null, "quản trị xử lý cảnh báo + mở khoá");
ok((await as(U.sale1, `select id from public.leads limit 1`)).length === 1, "mở khoá xong đọc lại được");

await db.exec(`update public.audit_log set at = at - interval '2 hours'`);
for (let i = 0; i < 7; i++) await as(U.owner, `update public.leads set note = 'o' where id = $1`, [many[i]]);
ok((await one(`select locked_at from public.staff where user_id = $1`, [U.owner])).locked_at === null, "super_admin vượt ngưỡng → không bị khoá");
ok((await one(`select count(*)::int n from public.security_alerts where user_id = $1 and not locked`, [U.owner])).n === 1, "… nhưng vẫn có cảnh báo");
await db.exec(`update public.app_settings set value = '150' where key = 'anomaly_max_changes_per_hour'`);

section("Khoá tay");
e = await errOf(U.adm, `select public.set_staff_lock($1, true, 'thử')`, [U.adm]);
ok(/chính mình/.test(e ?? ""), "không tự khoá mình", e);
e = await errOf(U.adm, `select public.set_staff_lock($1, true, 'thử')`, [U.owner]);
ok(/Quản trị cấp cao/.test(e ?? ""), "admin không khoá được super_admin", e);
await as(U.adm, `select public.set_staff_lock($1, true, 'nghỉ việc')`, [U.sale2]);
ok((await one(`select locked_reason from public.staff where user_id = $1`, [U.sale2])).locked_reason === "nghỉ việc", "admin khoá telesale");
e = await errOf(U.page1, `select public.intake_lead('0966000001', 'Khách', $1, null, null, null, null, 'HN', null, null, $2)`, [fb, U.sale2]);
ok(/đang bị khoá/.test(e ?? ""), "không chia tay cho tài khoản bị khoá", e);
await as(U.owner, `select public.set_staff_lock($1, false)`, [U.sale2]);
ok((await one(`select locked_at from public.staff where user_id = $1`, [U.sale2])).locked_at === null, "super_admin mở khoá");

section("Cấu hình");
await as(U.lead1, `update public.app_settings set value = '45' where key = 'lead_reopen_days'`);
ok((await one(`select value from public.app_settings where key = 'lead_reopen_days'`)).value === 45, "Lead sửa được số ngày mở lại lead");
await as(U.lead1, `update public.app_settings set value = '0' where key = 'trash_min_days'`);
ok((await one(`select value from public.app_settings where key = 'trash_min_days'`)).value === 90, "Lead KHÔNG sửa được ngưỡng an toàn");
await as(U.adm, `update public.app_settings set value = '0' where key = 'trash_min_days'`);
ok((await one(`select value from public.app_settings where key = 'trash_min_days'`)).value === 90, "admin thường cũng không");
await as(U.owner, `update public.app_settings set value = '120' where key = 'trash_min_days'`);
ok((await one(`select value from public.app_settings where key = 'trash_min_days'`)).value === 120, "super_admin sửa được");
e = await errOf(U.owner, `update public.app_settings set key = 'x' where key = 'trash_min_days'`);
ok(/permission denied/.test(e ?? ""), "không ai đổi được tên khoá cấu hình", e);
await db.exec(`update public.app_settings set value = '"abc"' where key = 'anomaly_max_changes_per_hour'`);
e = await errOf(U.sale2, `update public.leads set note = 'z' where id = $1`, [many[7]]);
ok(e === null, "cấu hình sai định dạng không làm hỏng thao tác sửa", e);
await db.exec(`update public.app_settings set value = '150' where key = 'anomaly_max_changes_per_hour'; update public.app_settings set value = '90' where key = 'trash_min_days'`);

section("Ai xem được nhật ký");
ok((await as(U.adm, `select count(*)::int n from public.audit_log`))[0].n > 50, "quản trị xem toàn bộ");
const saleLog = await as(U.sale2, `select distinct table_name from public.audit_log`);
ok(saleLog.length === 1 && saleLog[0].table_name === "leads", "telesale chỉ xem nhật ký của lead", saleLog);
const hidden = await as(U.sale2, `select count(*)::int n from public.audit_log where record_id = $1`, [created]);
ok(hidden[0].n === 0, "telesale không xem được nhật ký của lead trong thùng rác", hidden);
ok((await as(U.sale2, `select count(*)::int n from public.backup_runs`))[0].n === 0, "telesale không xem được bảng sao lưu");
e = await errOf(U.sale2, `insert into public.audit_log (table_name, record_id, action) values ('leads', 'x', 'update')`);
ok(/permission denied/.test(e ?? ""), "không ai ghi tay vào nhật ký", e);
e = await errOf(U.adm, `delete from public.audit_log`);
ok(/permission denied/.test(e ?? ""), "không ai xoá được nhật ký", e);

section("Ghi nhận chạy thử khôi phục");
await as(U.adm, `select public.log_restore_test(true, 'khôi phục ra project test, đủ 3 bảng')`);
ok((await as(U.adm, `select kind, status from public.backup_runs`)).length === 1, "quản trị ghi nhận được");
e = await errOf(U.lead1, `select public.log_restore_test(true, 'x')`);
ok(/Chỉ Quản trị/.test(e ?? ""), "Lead không ghi được", e);

section("Mở lại lead không xoá dấu số sai của lần dán cũ");
const l3 = await intake(U.page1, "0977000001", "Khách Ba");
await as(U.sale2, `update public.leads set invalid_phone = true, status = 'fail' where id = $1`, [l3.lead_id]);
await db.query(`update public.leads set status_changed_at = now() - interval '100 days' where id = $1`, [l3.lead_id]);
const re = await intake(U.page1, "0977000001", "Khách Ba");
ok(re.outcome === "reopened", "dán lại sau 100 ngày → mở lại", re);
const touches = await all(`select result, is_invalid from public.lead_touches where lead_id = $1 order by created_at`, [l3.lead_id]);
ok(touches[0].is_invalid === true && touches[1].is_invalid === false, "lần dán cũ vẫn là số sai, lần mới thì không", touches);

section("Người ngoài (anon) không gọi được gì");
await db.exec("begin; set local role anon;");
let anonErr = null;
try {
  await db.query(`select public.undo_changes(gen_random_uuid(), now() - interval '1 hour', now(), false)`);
} catch (error) {
  anonErr = error.message;
}
await db.exec("rollback");
ok(/permission denied/.test(anonErr ?? ""), "anon gọi hàm → bị từ chối", anonErr);
await db.exec("begin; set local role anon;");
anonErr = null;
try {
  await db.query(`select * from public.trash_items`);
} catch (error) {
  anonErr = error.message;
}
await db.exec("rollback");
ok(/permission denied/.test(anonErr ?? ""), "anon đọc thùng rác → bị từ chối", anonErr);

console.log(`\n${passed} đạt, ${failed} lỗi`);
process.exit(failed ? 1 : 0);
