// Kiểm thử supabase/020_telesale_crm.sql (Telesale CRM: trạng thái tuỳ chỉnh, chia số, đổi sale, ai thấy số nào)
// trên Postgres chạy trong bộ nhớ. Không đụng tới cơ sở dữ liệu thật.
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "coo", "tl", "sale1", "sale2", "sale3", "page1", "mm", "ads1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 019 rồi 020 trên dữ liệu đang có");
await db.exec(`
  create schema realtime;
  create table realtime.messages (id bigserial primary key, topic text, extension text);
  create function realtime.topic() returns text language sql stable as $$ select null::text $$;
`);
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "008_staff_accounts.sql",
  "010_ads_daily_data.sql", "011_sync_ads_staff_name.sql", "012_ad_targets.sql", "013_revenue_avatars.sql",
  "014_monthly_targets.sql", "015_telesale_positions.sql", "016_lead_ads_runs_ads.sql", "017_week_carry.sql",
  "018_daily_revenue.sql", "019_online_presence.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  update public.staff set role = 'super_admin' where user_id = '${U.owner}';
  insert into public.staff (user_id, full_name, role) values
    ('${U.coo}', 'COO', 'admin'),
    ('${U.tl}', 'Trưởng Tele', 'lead'),
    ('${U.sale1}', 'Sale Một', 'sale'),
    ('${U.sale2}', 'Sale Hai', 'sale'),
    ('${U.sale3}', 'Sale Ba', 'sale'),
    ('${U.page1}', 'Trực Page', 'page'),
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.ads1}', 'Dương Ads', 'ads_staff');
  update public.staff set accepts_leads = true where user_id in ('${U.sale1}', '${U.sale2}');
  -- Quản trị bật nhận số cũng không được chia (chỉ nhân viên Telesale).
  update public.staff set accepts_leads = true where user_id = '${U.coo}';
`);
const fb = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const zalo = (await one(`select id from public.channels where name = 'Zalo'`)).id;
const svc = (await one(`select id from public.services where name = 'Niềng răng'`)).id;

// Một lead có từ trước (màn hình cũ): phải giữ nguyên sau khi chạy 020.
const old = await as(U.page1, `select public.intake_lead('0911000001', 'Khách cũ', $1, null, null, $2, null, 'HN', 'ghi chú cũ', null, $3) r`, [fb, svc, U.sale1]);
const oldLeadId = old[0].r.lead_id;
const snapshot = async () => JSON.stringify(await all(`select id, full_name, phone, status, assignee_id, assignee, note, service_id, channel_id, touch_count from public.leads order by id`));
const before = await snapshot();
const auditBefore = (await one(`select count(*)::int n from public.audit_log where table_name = 'leads'`)).n;

await db.exec(read("020_telesale_crm.sql"));
ok(true, "020 chạy không lỗi");
await db.exec(read("020_telesale_crm.sql"));
ok(true, "chạy lại 020 lần hai không lỗi");
ok((await snapshot()) === before, "lead đang có giữ nguyên (trạng thái cũ, sale, ghi chú…)");
ok((await one(`select count(*)::int n from public.audit_log where table_name = 'leads'`)).n === auditBefore, "chạy 020 không sửa lead nào (không ghi nhật ký)");
const oldLead = await one(`select status_id, transfer_count, consult_info from public.leads where id = $1`, [oldLeadId]);
ok(oldLead.status_id === null && oldLead.transfer_count === 0 && oldLead.consult_info === null, "lead cũ: cột mới để trống", oldLead);
ok((await one(`select value #>> '{}' v from public.app_settings where key = 'lead_assign_mode'`)).v === "auto", "cách chia số mặc định: tự động");

// ---------------------------------------------------------------------------
section("Trạng thái khách hàng tuỳ chỉnh");
const statuses = await all(`select id, name, sort_order, needs_appointment, needs_deal from public.lead_statuses order by sort_order`);
ok(statuses.length === 12 && statuses[0].name === "KHTN" && statuses[11].name === "Gọi lại sau", "12 trạng thái làm sẵn theo ảnh, đúng thứ tự", statuses.map((s) => s.name));
ok(statuses.find((s) => s.name === "Đặt lịch hẹn").needs_appointment && statuses.find((s) => s.name === "Chốt").needs_deal, "Đặt lịch hẹn cần lịch hẹn, Chốt cần doanh số");
const S = Object.fromEntries(statuses.map((s) => [s.name, s.id]));
ok((await as(U.sale1, `select count(*)::int n from public.lead_statuses`))[0].n === 12, "telesale đọc được danh sách trạng thái");
let e = await errOf(U.sale1, `insert into public.lead_statuses (name, color, text_color) values ('Thử', '#000000', '#ffffff')`);
ok(/row-level security/.test(e ?? ""), "telesale không thêm được trạng thái", e);
e = await errOf(U.page1, `insert into public.lead_statuses (name, color, text_color) values ('Thử', '#000000', '#ffffff')`);
ok(/row-level security/.test(e ?? ""), "trực page không thêm được trạng thái", e);
const added = (await as(U.tl, `insert into public.lead_statuses (name, color, text_color, sort_order) values ('Khách VIP', '#0f766e', '#ffffff', 13) returning id`))[0].id;
ok(Boolean(added), "Trưởng Telesale thêm trạng thái mới");
e = await errOf(U.tl, `insert into public.lead_statuses (name, color, text_color) values (' khách vip ', '#0f766e', '#ffffff')`);
ok(/duplicate|lead_statuses_name_key/.test(e ?? ""), "trùng tên (không phân biệt hoa thường) → từ chối", e);
e = await errOf(U.tl, `insert into public.lead_statuses (name, color, text_color) values ('Màu sai', 'red', '#ffffff')`);
ok(/check constraint/.test(e ?? ""), "màu phải dạng #rrggbb", e);
await as(U.coo, `update public.lead_statuses set name = 'Khách VIP 2', is_active = false where id = $1`, [added]);
ok((await one(`select name, is_active from public.lead_statuses where id = $1`, [added])).is_active === false, "COO đổi tên, ẩn trạng thái");
e = await errOf(U.tl, `delete from public.lead_statuses where id = $1`, [added]);
ok(/permission denied/.test(e ?? ""), "không ai xoá được trạng thái (chỉ ẩn)", e);
ok((await one(`select count(*)::int n from public.audit_log where table_name = 'lead_statuses' and record_id = $1`, [added])).n === 2, "thêm / sửa trạng thái vào nhật ký");

const ids = (await all(`select id from public.lead_statuses order by sort_order`)).map((r) => r.id);
const swapped = [ids[1], ids[0], ...ids.slice(2)];
const auditN = (await one(`select count(*)::int n from public.audit_log where table_name = 'lead_statuses'`)).n;
await as(U.tl, `select public.reorder_lead_statuses($1::uuid[])`, [swapped]);
const after = (await all(`select id from public.lead_statuses order by sort_order`)).map((r) => r.id);
ok(after[0] === ids[1] && after[1] === ids[0], "đổi chỗ 2 trạng thái (nút ↑ ↓)");
ok((await one(`select count(*)::int n from public.audit_log where table_name = 'lead_statuses'`)).n - auditN === 2, "chỉ 2 dòng đổi chỗ bị sửa (không tính vào cảnh báo bất thường)");
e = await errOf(U.sale1, `select public.reorder_lead_statuses($1::uuid[])`, [ids]);
ok(/Chỉ Quản trị/.test(e ?? ""), "telesale không sắp xếp được", e);
await as(U.tl, `select public.reorder_lead_statuses($1::uuid[])`, [ids]);

// ---------------------------------------------------------------------------
section("Thêm số: chia tự động chỉ cho nhân viên Telesale đang bật nhận số");
const ADD = `select public.add_lead($1, $2, $3, null, null, $4) r`;
const r1 = (await as(U.page1, ADD, ["0912 000 001", "Lan", fb, svc]))[0].r;
const r2 = (await as(U.page1, ADD, ["0912000002", "Hoa", fb, svc]))[0].r;
const r3 = (await as(U.page1, ADD, ["+84912000003", "Mai", zalo, svc]))[0].r;
ok(r1.outcome === "new" && r1.phone === "0912000001", "số mới, chuẩn hoá số", r1);
const got = [r1, r2, r3].map((r) => r.assignee);
ok(got.every((n) => n === "Sale Một" || n === "Sale Hai") && new Set(got.slice(0, 2)).size === 2, "xoay vòng giữa 2 telesale đang bật (COO bật nhận số cũng không được chia)", got);
ok([r1, r2, r3].every((r) => r.assign_mode === "round_robin"), "chế độ: xoay vòng");
const l1 = await one(`select assignee_id, assignee, status_id, source, created_by from public.leads where id = $1`, [r1.lead_id]);
ok(l1.status_id === null && l1.source === "Facebook" && l1.created_by === U.page1, "số mới: chưa có tình trạng, ghi nguồn và người thêm", l1);
e = await errOf(U.page1, ADD, ["12345", "Sai", fb, svc]);
ok(/không hợp lệ/.test(e ?? ""), "số sai định dạng → từ chối", e);
e = await errOf(U.page1, ADD, ["0912000009", "  ", fb, svc]);
ok(/Thiếu tên/.test(e ?? ""), "thiếu tên → từ chối", e);
e = await errOf(U.page1, ADD, ["0912000009", "Không nguồn", null, svc]);
ok(/Chưa chọn nguồn/.test(e ?? ""), "không có nguồn và không có bài chạy → từ chối", e);
e = await errOf(U.ads1, ADD, ["0912000009", "Ads thêm", fb, svc]);
ok(/không được thêm số/.test(e ?? ""), "nhân viên Ads không thêm số", e);

section("Thêm số: chọn bài chạy → tự biết page, chiến dịch, nhân viên Ads");
const adsStaff = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads1])).id;
const pageId = (await one(`insert into public.pages (name, channel_id) values ('Smile Hub', $1) returning id`, [fb])).id;
const acc = (await one(`insert into public.ad_accounts (name, channel_id, account_id) values ('TK 01', $1, '1234567890') returning id`, [fb])).id;
await db.query(`insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date) values ($1, $2, '2020-01-01')`, [acc, adsStaff]);
const camp = (await one(`insert into public.campaigns (name, channel_id, page_id, service_id, ad_account_id) values ('Niềng T11', $1, $2, $3, $4) returning id`, [fb, pageId, svc, acc])).id;
const post = (await one(`insert into public.ad_posts (campaign_id, url, title) values ($1, 'https://www.facebook.com/smilehub/posts/pfbid0abc123', 'Video niềng') returning id, post_id, ad_id`, [camp]));
const POST_ADD = `select public.add_lead($1, $2, null, null, $3) r`;
const r4 = (await as(U.page1, POST_ADD, ["0912000004", "Ngọc", post.id]))[0].r;
const l4 = await one(`select channel_id, page_id, campaign_id, service_id, ad_post_id, ads_staff_id from public.leads where id = $1`, [r4.lead_id]);
ok(l4.channel_id === fb && l4.page_id === pageId && l4.campaign_id === camp && l4.service_id === svc, "bài chạy → kênh, page, chiến dịch, dịch vụ", l4);
ok(l4.ad_post_id === post.id && l4.ads_staff_id === adsStaff, "… và nhân viên Ads phụ trách TKQC hôm nay", l4);
ok((await one(`select ads_staff_id, ad_post_id, result from public.lead_touches where lead_id = $1`, [r4.lead_id])).ads_staff_id === adsStaff, "lần tiếp cận cũng ghi bài và nhân viên Ads");

section("Số trùng: giữ sale cũ, đánh dấu trùng, báo khách nhắn lại");
const before1 = await one(`select assignee_id from public.leads where id = $1`, [r1.lead_id]);
const d1 = (await as(U.page1, `select public.add_lead('0912000001', 'Lan (nhắn lại)', $1, null, null, null, 'hỏi giá') r`, [zalo]))[0].r;
const ld = await one(`select assignee_id, full_name, touch_count, recontacted_at, source, note from public.leads where id = $1`, [r1.lead_id]);
ok(d1.outcome === "duplicate" && d1.lead_id === r1.lead_id && d1.assign_mode === "kept", "số trùng → cùng lead, giữ sale", d1);
ok(ld.assignee_id === before1.assignee_id && ld.full_name === "Lan" && ld.touch_count === 2 && ld.recontacted_at && ld.source === "Zalo", "giữ tên + sale, đếm 2 lần, nguồn gần nhất, báo nhắn lại", ld);
ok(ld.note === "hỏi giá", "lưu ý mới được ghi thêm", ld.note);
const check = (await as(U.sale3, `select public.check_lead_phone_v2('0912000001') r`))[0].r;
ok(check.outcome === "duplicate" && check.lead.touch_count === 2 && check.lead.status_name === null, "kiểm tra nhanh: báo trùng, sale, số lần", check);
ok((await as(U.page1, `select public.check_lead_phone_v2('0912999999') r`))[0].r.outcome === "new", "kiểm tra nhanh: số mới");

section("Chia tay khi thêm số");
const MAN = `select public.add_lead($1, $2, $3, null, null, null, null, null, $4) r`;
const r5 = (await as(U.page1, MAN, ["0912000005", "Tú", fb, U.sale3]))[0].r;
ok(r5.assignee === "Sale Ba" && r5.assign_mode === "manual", "trực page chọn sale (kể cả người đang tắt nhận số)", r5);
e = await errOf(U.sale1, MAN, ["0912000006", "Tự chọn", fb, U.sale1]);
ok(/Chỉ Admin, COO, Trưởng Telesale và Trực page/.test(e ?? ""), "telesale thêm số không tự chọn sale được", e);
e = await errOf(U.page1, MAN, ["0912000006", "Chia cho COO", fb, U.coo]);
ok(/nhân viên Telesale/.test(e ?? ""), "không chia cho người không phải Telesale", e);
const r6 = (await as(U.sale1, ADD, ["0912000006", "Sale tự thêm", fb, svc]))[0].r;
ok(r6.outcome === "new" && r6.assign_mode === "round_robin", "telesale thêm số: chia theo cài đặt", r6);

section("Cách chia: thủ công → số để Chưa chia");
await as(U.tl, `update public.app_settings set value = '"manual"'::jsonb where key = 'lead_assign_mode'`);
const r7 = (await as(U.page1, ADD, ["0912000007", "Chờ chia", fb, svc]))[0].r;
ok(r7.assignee === null && r7.assign_mode === null, "chế độ thủ công: số mới chưa chia", r7);
e = await errOf(U.sale1, `update public.app_settings set value = '"auto"'::jsonb where key = 'lead_assign_mode'`);
ok(e === null && (await one(`select value #>> '{}' v from public.app_settings where key = 'lead_assign_mode'`)).v === "manual", "telesale không đổi được cách chia (0 dòng)");
await as(U.tl, `update public.app_settings set value = '"auto"'::jsonb where key = 'lead_assign_mode'`);

// ---------------------------------------------------------------------------
section("Ai thấy số nào");
const count = async (uid) => (await as(uid, `select count(*)::int n from public.leads`))[0].n;
const total = (await one(`select count(*)::int n from public.leads where deleted_at is null`)).n;
const mine = async (uid) => (await one(`select count(*)::int n from public.leads where assignee_id = $1`, [uid])).n;
ok((await count(U.sale1)) === (await mine(U.sale1)) && (await mine(U.sale1)) > 0, "Telesale chỉ thấy số mình quản lý");
ok((await count(U.sale3)) === 1, "Sale Ba thấy đúng 1 số được chia tay");
for (const who of ["owner", "coo", "tl", "page1", "mm"]) ok((await count(U[who])) === total, `${who} thấy tất cả ${total} số`);
ok((await count(U.ads1)) === 0, "nhân viên Ads không thấy số");
ok((await as(U.sale3, `select count(*)::int n from public.lead_touches`))[0].n === 1, "lần tiếp cận: telesale chỉ thấy của số mình");
ok((await as(U.sale3, `select count(*)::int n from public.audit_log where table_name = 'leads'`))[0].n >= 1
  && (await as(U.sale3, `select count(distinct record_id)::int n from public.audit_log where table_name = 'leads'`))[0].n === 1, "nhật ký: telesale chỉ thấy lịch sử số mình");

// ---------------------------------------------------------------------------
section("Telesale chăm sóc số của mình");
const UPD = `update public.leads set status_id = $2, consult_info = $3, gender = 'female', age = 28, area = 'Đống Đa', budget = '20-30 triệu', appointment_at = now() + interval '1 day' where id = $1 returning status_id, status_changed_at, consult_info`;
const own = (await as(U.sale3, UPD, [r5.lead_id, S["Đặt lịch hẹn"], "Khách muốn niềng trong suốt"]))[0];
ok(own.status_id === S["Đặt lịch hẹn"] && own.consult_info.startsWith("Khách muốn"), "đổi tình trạng, ghi khai thác thông tin", own);
await as(U.sale3, `update public.leads set consult_info = $2, deal_amount = 45000000, paid_amount = 5000000 where id = $1`, [r5.lead_id, "Khách muốn niềng trong suốt, hẹn thứ 7"]);
const hist = await as(U.sale3, `select new_data->>'consult_info' c, old_data->>'consult_info' o from public.audit_log where table_name = 'leads' and record_id = $1 and new_data ? 'consult_info' order by id`, [r5.lead_id]);
ok(hist.length === 2 && hist[1].o === "Khách muốn niềng trong suốt" && hist[1].c.endsWith("thứ 7"), "lịch sử khai thác thông tin: từng lần sửa, nội dung cũ / mới", hist);
const n0 = (await as(U.sale1, `update public.leads set consult_info = 'chen ngang' where id = $1 returning id`, [r5.lead_id])).length;
ok(n0 === 0, "telesale không sửa được số của người khác");
e = await errOf(U.sale3, `update public.leads set age = 300 where id = $1`, [r5.lead_id]);
ok(/leads_crm_fields_check/.test(e ?? ""), "tuổi sai → từ chối", e);
e = await errOf(U.sale3, `update public.leads set gender = 'x' where id = $1`, [r5.lead_id]);
ok(/leads_crm_fields_check/.test(e ?? ""), "giới tính chỉ Nam / Nữ", e);

section("Đổi sale quản lý số (đảo số)");
e = await errOf(U.sale3, `update public.leads set assignee_id = $2 where id = $1`, [r5.lead_id, U.sale1]);
ok(/Chỉ Admin, COO, Trưởng Telesale và Trực page/.test(e ?? ""), "telesale không tự đổi sale", e);
e = await errOf(U.mm, `update public.leads set assignee_id = $2 where id = $1`, [r5.lead_id, U.sale1]);
ok(/Chỉ Admin, COO/.test(e ?? ""), "Trưởng Marketing không đổi sale", e);
const t1 = (await as(U.page1, `update public.leads set assignee_id = $2, assignee = 'gõ bừa' where id = $1 returning assignee, assignee_id, previous_assignee_id, transfer_count, transferred_at, assign_mode`, [r5.lead_id, U.sale1]))[0];
ok(t1.assignee === "Sale Một" && t1.previous_assignee_id === U.sale3 && t1.transfer_count === 1 && t1.transferred_at && t1.assign_mode === "manual", "trực page đảo số: ghi sale trước, đếm 1 lần, tên sale đúng", t1);
const t2 = (await as(U.tl, `update public.leads set assignee_id = $2 where id = $1 returning previous_assignee_id, transfer_count`, [r5.lead_id, U.sale2]))[0];
ok(t2.previous_assignee_id === U.sale1 && t2.transfer_count === 2, "Trưởng Telesale đảo tiếp: lần 2", t2);
ok((await count(U.sale3)) === 0 && (await as(U.sale2, `select count(*)::int n from public.leads where id = $1`, [r5.lead_id]))[0].n === 1, "sale cũ hết thấy, sale mới thấy số");
e = await errOf(U.coo, `update public.leads set assignee_id = $2 where id = $1`, [r5.lead_id, U.page1]);
ok(/nhân viên Telesale/.test(e ?? ""), "không đảo cho người không phải Telesale", e);
const t3 = (await as(U.coo, `update public.leads set assignee_id = $2 where id = $1 returning assignee`, [r7.lead_id, U.sale3]))[0];
const l7 = await one(`select previous_assignee_id, transfer_count from public.leads where id = $1`, [r7.lead_id]);
ok(t3.assignee === "Sale Ba" && l7.previous_assignee_id === null && l7.transfer_count === 0, "chia số đang Chưa chia: không tính là đảo", l7);

section("Số trùng khi sale cũ đã bị khoá → chia lại");
await db.exec(`update public.staff set locked_at = now() where user_id = '${U.sale3}'`);
const d7 = (await as(U.page1, ADD, ["0912000007", "Chờ chia", fb, svc]))[0].r;
const l7b = await one(`select assignee_id, previous_assignee_id, transfer_count from public.leads where id = $1`, [r7.lead_id]);
ok(d7.outcome === "duplicate" && d7.assign_mode === "round_robin" && [U.sale1, U.sale2].includes(l7b.assignee_id), "sale cũ bị khoá → chia cho người khác", { d7, l7b });
ok(l7b.previous_assignee_id === U.sale3 && l7b.transfer_count === 1, "… ghi là một lần đảo số");

finish();
