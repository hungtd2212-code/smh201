// Kiểm thử supabase/023_pancake_sync.sql (tự kéo số điện thoại từ Pancake về bảng Lead) trên Postgres chạy
// trong bộ nhớ. Không gọi Pancake thật: pg_net / pg_cron được thay bằng bản giả, "Pancake" trả lời bằng dữ liệu
// dựng sẵn theo đúng mẫu của tài liệu developer.pancake.biz (GET /pages/{id}/conversations).
//
// Chạy:  npm run test:db
import { createTestDb } from "./harness.mjs";

const { db, read, ok, section, one, all, addUser, as, errOf, finish } = await createTestDb();

const U = {};
for (const name of ["owner", "coo", "tl", "sale1", "sale2", "page1", "mm", "ads1"]) U[name] = await addUser(name);

section("Chạy schema.sql → 021, rồi 023");
await db.exec(`
  create schema realtime;
  create table realtime.messages (id bigserial primary key, topic text, extension text);
  create function realtime.topic() returns text language sql stable as $$ select null::text $$;

  -- pg_net giả: ghi lại lượt hỏi; câu trả lời do phép thử tự điền vào net._http_response.
  create schema net;
  create sequence net.request_seq;
  create table net.http_request_queue (id bigint primary key, url text, params jsonb, timeout_milliseconds int);
  create table net._http_response (id bigint primary key, status_code int, content_type text, headers jsonb,
    content text, timed_out boolean, error_msg text, created timestamptz not null default now());
  create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}',
                               timeout_milliseconds int default 5000)
  returns bigint language sql as $$
    insert into net.http_request_queue values (nextval('net.request_seq'), url, params, timeout_milliseconds) returning id
  $$;

  -- pg_cron giả.
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
  create table cron.job_run_details (end_time timestamptz);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
    returning jobid
  $$;
`);
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${U.owner}', 'Chủ phòng khám', 'admin')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "006_ad_daily_reports.sql", "007_ad_account_setup.sql", "008_staff_accounts.sql",
  "010_ads_daily_data.sql", "011_sync_ads_staff_name.sql", "012_ad_targets.sql", "013_revenue_avatars.sql",
  "014_monthly_targets.sql", "015_telesale_positions.sql", "016_lead_ads_runs_ads.sql", "017_week_carry.sql",
  "018_daily_revenue.sql", "019_online_presence.sql", "020_telesale_crm.sql", "021_accounting_positions.sql"]) {
  await db.exec(read(file));
}
await db.exec(`
  update public.staff set role = 'super_admin' where user_id = '${U.owner}';
  insert into public.staff (user_id, full_name, role) values
    ('${U.coo}', 'COO', 'admin'),
    ('${U.tl}', 'Trưởng Tele', 'lead'),
    ('${U.sale1}', 'Sale Một', 'sale'),
    ('${U.sale2}', 'Sale Hai', 'sale'),
    ('${U.page1}', 'Trực Page', 'page'),
    ('${U.mm}', 'Trưởng Marketing', 'marketing_manager'),
    ('${U.ads1}', 'Dương Ads', 'ads_staff');
  update public.staff set accepts_leads = true where user_id in ('${U.sale1}', '${U.sale2}');
`);
const fb = (await one(`select id from public.channels where name = 'Facebook'`)).id;
const svc = (await one(`select id from public.services where name = 'Niềng răng'`)).id;
const adsStaff = (await one(`select id from public.ads_staff where user_id = $1`, [U.ads1])).id;
const pageId = (await one(`insert into public.pages (name, channel_id, branch) values ('Smile Hub', $1, 'HN') returning id`, [fb])).id;
const acc = (await one(`insert into public.ad_accounts (name, channel_id, account_id) values ('TK 01', $1, '1234567890') returning id`, [fb])).id;
await db.query(`insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date) values ($1, $2, '2020-01-01')`, [acc, adsStaff]);
const camp = (await one(`insert into public.campaigns (name, channel_id, page_id, service_id, ad_account_id) values ('Niềng T11', $1, $2, $3, $4) returning id`, [fb, pageId, svc, acc])).id;
const adPost = (await one(`insert into public.ad_posts (campaign_id, url, title, ad_id) values ($1, 'https://www.facebook.com/smilehub/posts/pfbid0abc123', 'Video niềng', '120200000000000001') returning id, ad_id`, [camp]));
const commentPost = (await one(`insert into public.ad_posts (campaign_id, url, title) values ($1, '111222333_444555666', 'Bài ảnh') returning id, post_key`, [camp]));
ok(adPost.ad_id === "120200000000000001" && commentPost.post_key === "fb:444555666", "chuẩn bị bài chạy (có ID quảng cáo / mã bài)", { adPost, commentPost });

// Một lead nhập tay có từ trước.
const oldLead = (await as(U.page1, `select public.add_lead('0911000001', 'Khách cũ', $1) r`, [fb]))[0].r;
const snapshot = async () => JSON.stringify(await all(`select id, full_name, phone, status_id, assignee_id, note, touch_count from public.leads order by id`));
const before = await snapshot();

await db.exec(read("023_pancake_sync.sql"));
ok(true, "023 chạy không lỗi");
await db.exec(read("023_pancake_sync.sql"));
ok(true, "chạy lại 023 lần hai không lỗi");
ok((await snapshot()) === before, "lead đang có giữ nguyên");
const jobs = await all(`select jobname, schedule, command from cron.job order by jobname`);
ok(jobs.length === 2 && jobs.some((j) => j.jobname === "smh-pancake-sync" && j.schedule === "* * * * *" && j.command === "select private.pancake_sync()"),
  "lịch chạy mỗi phút đã đặt (chạy lại không đặt trùng)", jobs);

// ---------------------------------------------------------------------------
section("Nút \"Thêm số\" vẫn như cũ sau khi tách phần lõi");
let r = (await as(U.page1, `select public.add_lead('0911000002', 'Khách mới', $1, null, $2) r`, [fb, adPost.id]))[0].r;
ok(r.outcome === "new" && r.assign_mode === "round_robin", "trực page thêm số mới → tự chia", r);
let l = await one(`select page_id, service_id, ad_post_id, ads_staff_id, ads_id, created_by from public.leads where id = $1`, [r.lead_id]);
ok(l.page_id === pageId && l.service_id === svc && l.ad_post_id === adPost.id && l.ads_staff_id === adsStaff && l.ads_id === adPost.ad_id && l.created_by === U.page1,
  "bài chạy → page, dịch vụ, nhân viên Ads; người thêm là trực page", l);
r = (await as(U.page1, `select public.add_lead('0911000001', 'Khách cũ', $1) r`, [fb]))[0].r;
ok(r.outcome === "duplicate" && r.assign_mode === "kept" && r.assignee === oldLead.assignee, "số trùng giữ sale cũ", r);
let e = await errOf(U.ads1, `select public.add_lead('0911000003', 'X', $1)`, [fb]);
ok(/không được thêm số/.test(e ?? ""), "nhân viên Ads không thêm được số", e);
e = await errOf(U.sale1, `select public.add_lead('0911000003', 'X', $1, null, null, null, null, null, $2)`, [fb, U.sale2]);
ok(/Chỉ Admin, COO, Trưởng Telesale và Trực page/.test(e ?? ""), "telesale không tự chọn sale", e);
e = await errOf(U.tl, `select public.add_lead('0911000003', 'X', $1, null, null, null, null, null, $2)`, [fb, U.page1]);
ok(/Chỉ chia số cho nhân viên Telesale/.test(e ?? ""), "chỉ chia cho Telesale", e);
e = await errOf(U.sale1, `select private.add_lead_core(null, '0911000003', 'X', '${fb}', null, null, null, null, null, null, 'HN', null)`);
ok(/permission denied/.test(e ?? ""), "không ai gọi thẳng được phần lõi", e);

// ---------------------------------------------------------------------------
section("Kết nối page (Telesale → Cài đặt)");
const TOKEN = "pk_test_token_abcdefghijklmnopqrstuvwxyz_9F3Q";
e = await errOf(U.sale1, `select public.pancake_save_page(null, '111222333', $1, $2)`, [pageId, TOKEN]);
ok(/Chỉ Admin, COO và Trưởng Telesale/.test(e ?? ""), "telesale không kết nối được", e);
e = await errOf(U.page1, `select public.pancake_save_page(null, '111222333', $1, $2)`, [pageId, TOKEN]);
ok(/Chỉ Admin, COO và Trưởng Telesale/.test(e ?? ""), "trực page không kết nối được", e);
e = await errOf(U.tl, `select public.pancake_save_page(null, '111 222', $1, $2)`, [pageId, TOKEN]);
ok(/ID page Pancake không hợp lệ/.test(e ?? ""), "ID page sai dạng → từ chối", e);
e = await errOf(U.tl, `select public.pancake_save_page(null, '111222333', $1, null)`, [pageId]);
ok(/Dán Page Access Token/.test(e ?? ""), "kết nối mới phải có token", e);
e = await errOf(U.tl, `select public.pancake_save_page(null, '111222333', $1, 'ngắn')`, [pageId]);
ok(/Page Access Token không hợp lệ/.test(e ?? ""), "token sai dạng → từ chối", e);
e = await errOf(U.tl, `select public.pancake_save_page(null, '111222333', null, $1)`, [TOKEN]);
ok(/Chọn page trong ERP/.test(e ?? ""), "phải chọn page trong ERP", e);

const connId = (await as(U.tl, `select public.pancake_save_page(null, ' 111222333 ', $1, $2) id`, [pageId, TOKEN]))[0].id;
let conn = (await as(U.tl, `select * from public.pancake_pages where id = $1`, [connId]))[0];
ok(conn && conn.pancake_page_id === "111222333" && conn.token_hint === "9F3Q" && conn.is_active, "Trưởng Telesale kết nối page", conn);
ok(!("token" in conn), "bảng kết nối không có cột token");
ok((await as(U.coo, `select count(*)::int n from public.pancake_pages`))[0].n === 1, "COO xem được kết nối");
ok((await as(U.page1, `select count(*)::int n from public.pancake_pages`))[0].n === 0 && (await as(U.sale1, `select count(*)::int n from public.pancake_pages`))[0].n === 0,
  "telesale, trực page không xem được kết nối");
e = await errOf(U.owner, `select token from private.pancake_tokens`);
ok(/permission denied/.test(e ?? ""), "không ai đọc được token qua ứng dụng (kể cả chủ)", e);
e = await errOf(U.tl, `update public.pancake_pages set is_active = false`);
ok(/permission denied/.test(e ?? ""), "không sửa thẳng bảng kết nối", e);
e = await errOf(U.tl, `select public.pancake_save_page(null, '111222333', $1, $2)`, [pageId, TOKEN]);
ok(/đã được kết nối/.test(e ?? ""), "một page Pancake chỉ kết nối một lần", e);
const auditText = JSON.stringify(await all(`select old_data, new_data from public.audit_log where table_name = 'pancake_pages'`));
ok(!auditText.includes(TOKEN), "token không lọt vào nhật ký thay đổi");

// ---------------------------------------------------------------------------
section("Mỗi phút: hỏi Pancake → đọc câu trả lời → thêm số");
const pending = () => all(`select q.id, q.url, q.params from net.http_request_queue q
  where not exists (select 1 from net._http_response h where h.id = q.id) order by q.id`);
/** "Pancake" trả lời mọi lượt hỏi đang chờ. */
async function pancakeAnswers(handler) {
  for (const q of await pending()) {
    const { status = 200, body } = handler(q);
    await db.query(`insert into net._http_response (id, status_code, content, timed_out) values ($1, $2, $3, false)`,
      [q.id, status, typeof body === "string" ? body : JSON.stringify(body)]);
  }
}
const tick = async () => (await one(`select private.pancake_sync() r`)).r;   // như lịch pg_cron (quyền postgres)
const iso = (minutesFromNow) => new Date(Date.now() + minutesFromNow * 60000).toISOString().replace("Z", "").slice(0, 19);
const conv = (id, extra = {}) => ({
  id, type: "INBOX", page_id: "111222333", post_id: null, has_phone: true, updated_at: iso(0),
  from: { id: "psid" + id, name: "Khách " + id }, customers: [{ id: "c" + id, fb_id: "psid" + id, name: "Khách " + id }],
  recent_phone_numbers: [], ad_ids: null, ...extra,
});

let t = await tick();
let reqs = await pending();
ok(t.requests === 1 && reqs.length === 1, "lượt đầu: gửi 1 lượt hỏi cho page đang bật", t);
ok(reqs[0].url === "https://pages.fm/api/public_api/v2/pages/111222333/conversations"
  && reqs[0].params.page_access_token === TOKEN && /recent_phone_numbers/.test(reqs[0].params.fields) && !("last_conversation_id" in reqs[0].params),
  "đúng địa chỉ API Pancake, kèm token và các trường cần lấy", reqs[0]);
t = await tick();
ok(t.requests === 0 && (await pending()).length === 1, "chưa có trả lời thì không gửi thêm lượt hỏi");

await pancakeAnswers(() => ({ body: { success: true, conversations: [
  conv("A", { recent_phone_numbers: [{ phone_number: "0912 345 678" }], ad_ids: ["999", "120200000000000001"] }),
  conv("B", { type: "COMMENT", post_id: "111222333_444555666", recent_phone_numbers: [{ phone_number: "+84987654321" }], customers: [], from: { name: "Bình Luận" } }),
  conv("C", { has_phone: false }),
  conv("D", { recent_phone_numbers: [{ phone_number: "0933333333" }], updated_at: iso(-30) }),
  conv("E", { recent_phone_numbers: [{ phone_number: "12345" }] }),
  conv("F", { recent_phone_numbers: [{ phone_number: "0944444444", order_id: 7 }, { phone_number: "0955555555" }], ad_ids: ["120299999999999999"], customers: [{ name: "" }], from: { name: "" } }),
] } }));
t = await tick();
ok(t.added === 4, "thêm 4 số (A, B, F×2); bỏ hội thoại không có số / cũ hơn mốc / số sai", t);
const A = await one(`select * from public.leads where phone = '0912345678'`);
ok(A && A.full_name === "Khách A" && A.page_id === pageId && A.channel_id === fb && A.branch === "HN", "A: tên khách, page và nguồn theo kết nối", A && { name: A.full_name, page: A.page_id });
ok(A.ad_post_id === adPost.id && A.service_id === svc && A.ads_staff_id === adsStaff && A.ads_id === adPost.ad_id, "A: đến từ quảng cáo → đúng bài chạy, dịch vụ, nhân viên Ads",
  { ad_post_id: A.ad_post_id, ads_staff_id: A.ads_staff_id, ads_id: A.ads_id });
ok(A.pancake_url === "https://pancake.vn/111222333?c_id=A", "A: có link mở hội thoại Pancake", A.pancake_url);
ok(A.created_by === null && ["round_robin"].includes(A.assign_mode) && [U.sale1, U.sale2].includes(A.assignee_id), "A: người thêm là hệ thống, tự chia cho Telesale",
  { created_by: A.created_by, mode: A.assign_mode });
const B = await one(`select full_name, ad_post_id from public.leads where phone = '0987654321'`);
ok(B && B.full_name === "Bình Luận" && B.ad_post_id === commentPost.id, "B: bình luận dưới bài → đúng bài chạy theo mã bài; +84 đổi về 0", B);
const F = await all(`select full_name, ads_id, ad_post_id from public.leads where phone in ('0944444444', '0955555555') order by phone`);
ok(F.length === 2 && F.every((x) => x.full_name === "Khách Pancake" && x.ads_id === "120299999999999999" && x.ad_post_id === null),
  "F: hai số cùng hội thoại; không có tên → \"Khách Pancake\"; quảng cáo chưa khai báo vẫn giữ ID quảng cáo", F);
ok(!(await one(`select 1 x from public.leads where phone = '0933333333'`)), "D: hoạt động trước lúc kết nối → không kéo");
const imports = await all(`select conversation_id, phone, outcome from public.pancake_imports order by id`);
ok(JSON.stringify(imports.map((i) => `${i.conversation_id}:${i.outcome}`)) === JSON.stringify(["A:new", "B:new", "E:invalid", "F:new", "F:new"]),
  "nhật ký: 4 số mới, 1 số không hợp lệ", imports);
ok((await one(`select count(*)::int n from public.audit_log where table_name = 'leads' and action = 'insert' and actor_id is null and note = 'Kéo số từ Pancake'`)).n === 4,
  "nhật ký thay đổi ghi \"Kéo số từ Pancake\"");
conn = await one(`select * from public.pancake_pages where id = $1`, [connId]);
ok(conn.last_ok_at && !conn.last_error && t.requests === 1, "quét xong: ghi lần chạy tốt, gửi lượt hỏi mới", { t, err: conn.last_error });

section("Hội thoại cũ có tin nhắn mới: không kéo lại số đã kéo");
const touchBefore = (await one(`select touch_count from public.leads where phone = '0912345678'`)).touch_count;
const oldAssignee = (await one(`select assignee_id from public.leads where phone = '0911000001'`)).assignee_id;
await pancakeAnswers(() => ({ body: { conversations: [
  conv("A", { recent_phone_numbers: [{ phone_number: "0912345678" }] }),
  conv("G", { recent_phone_numbers: [{ phone_number: "0911000001" }] }),   // số đã có (nhập tay) → trùng
] } }));
t = await tick();
ok(t.added === 1 && (await one(`select touch_count from public.leads where phone = '0912345678'`)).touch_count === touchBefore, "A không bị tính thêm lần nữa", t);
const old = await one(`select touch_count, recontacted_at, assignee_id, pancake_url from public.leads where phone = '0911000001'`);
ok(old.touch_count === 3 && old.recontacted_at && oldAssignee && old.assignee_id === oldAssignee, "G: số đã có → trùng, giữ sale cũ, báo khách nhắn lại", old);
ok(old.pancake_url === "https://pancake.vn/111222333?c_id=G", "G: thêm link Pancake vào số cũ", old.pancake_url);
ok((await one(`select outcome from public.pancake_imports where conversation_id = 'G'`)).outcome === "duplicate", "nhật ký ghi \"trùng\"");

section("Pancake báo lỗi → giữ mốc cũ, báo lỗi, lần sau thử lại");
const syncFromBefore = (await one(`select sync_from from public.pancake_pages where id = $1`, [connId])).sync_from;
await pancakeAnswers(() => ({ status: 401, body: { success: false, message: "Invalid access token" } }));
t = await tick();
conn = await one(`select * from public.pancake_pages where id = $1`, [connId]);
ok(/Token sai/.test(conn.last_error ?? "") && conn.last_error_at && +conn.sync_from === +syncFromBefore && t.requests === 1, "401 → báo token sai, mốc giữ nguyên, hỏi lại", conn.last_error);
await pancakeAnswers(() => ({ body: { success: false, message: "Page not found" } }));
await tick();
ok(/Pancake báo lỗi: Page not found/.test((await one(`select last_error from public.pancake_pages where id = $1`, [connId])).last_error ?? ""), "success:false → báo đúng lời Pancake");
await pancakeAnswers(() => ({ body: "<html>Bad gateway</html>" }));
await tick();
ok(/không đọc được/.test((await one(`select last_error from public.pancake_pages where id = $1`, [connId])).last_error ?? ""), "trả về không phải JSON → báo lỗi, không hỏng");
await db.exec(`update private.pancake_requests set created_at = now() - interval '5 minutes'`);
t = await tick();
ok(/không trả lời/.test((await one(`select last_error from public.pancake_pages where id = $1`, [connId])).last_error ?? "") && t.requests === 1, "chờ quá 3 phút không có trả lời → báo lỗi, hỏi lại", t);
await pancakeAnswers(() => ({ body: { conversations: [] } }));
await tick();
conn = await one(`select * from public.pancake_pages where id = $1`, [connId]);
ok(!conn.last_error && +conn.sync_from > +syncFromBefore, "hỏi lại được → hết báo lỗi, mốc tiến lên");

section("Nhiều hội thoại mới cùng lúc → hỏi tiếp trang sau");
const many = Array.from({ length: 60 }, (_, i) => conv("P" + i, { recent_phone_numbers: i === 59 ? [{ phone_number: "0966000059" }] : [] }));
await pancakeAnswers(() => ({ body: { conversations: many } }));
t = await tick();
reqs = await pending();
ok(reqs.length === 1 && reqs[0].params.last_conversation_id === "P59", "đủ 60 hội thoại mới → hỏi trang sau từ hội thoại cuối", reqs[0]?.params);
const mid = await one(`select sync_from from public.pancake_pages where id = $1`, [connId]);
await pancakeAnswers(() => ({ body: { conversations: [conv("Q", { recent_phone_numbers: [{ phone_number: "0977000001" }] }), conv("R", { updated_at: iso(-60) })] } }));
t = await tick();
ok(t.added === 1 && (await one(`select 1 x from public.leads where phone = '0977000001'`)), "trang sau cũng được thêm số", t);
ok(+(await one(`select sync_from from public.pancake_pages where id = $1`, [connId])).sync_from > +mid.sync_from, "gặp hội thoại cũ hơn mốc → xong lượt quét, mốc tiến lên");

section("Tạm dừng / chạy lại, Đồng bộ ngay, ai xem nhật ký");
e = await errOf(U.sale1, `select public.pancake_set_active($1, false)`, [connId]);
ok(/Chỉ Admin, COO và Trưởng Telesale/.test(e ?? ""), "telesale không tạm dừng được", e);
await as(U.coo, `select public.pancake_set_active($1, false)`, [connId]);
await pancakeAnswers(() => ({ body: { conversations: [conv("S", { recent_phone_numbers: [{ phone_number: "0988000001" }] })] } }));
t = await tick();
ok(t.requests === 0 && t.added === 0 && !(await one(`select 1 x from public.leads where phone = '0988000001'`)), "đang tạm dừng: bỏ câu trả lời, không hỏi nữa", t);
await as(U.coo, `select public.pancake_set_active($1, true)`, [connId]);
conn = await one(`select * from public.pancake_pages where id = $1`, [connId]);
ok(conn.is_active && Date.now() - +conn.sync_from < 60000, "chạy lại: lấy từ lúc bật", conn.sync_from);
e = await errOf(U.page1, `select public.pancake_sync_now()`);
ok(/Chỉ Admin, COO và Trưởng Telesale/.test(e ?? ""), "trực page không bấm Đồng bộ ngay", e);
t = (await as(U.tl, `select public.pancake_sync_now() r`))[0].r;
ok(t.requests === 1, "Trưởng Telesale bấm Đồng bộ ngay → gửi lượt hỏi", t);
await pancakeAnswers(() => ({ body: { conversations: [conv("T", { recent_phone_numbers: [{ phone_number: "0988000002" }] })] } }));
t = (await as(U.tl, `select public.pancake_sync_now() r`))[0].r;
const T = await one(`select created_by, assignee_id from public.leads where phone = '0988000002'`);
ok(t.added === 1 && T && T.created_by === null, "Đồng bộ ngay thêm số như lịch chạy (người thêm là hệ thống)", { t, T });
ok((await one(`select count(*)::int n from public.security_alerts`)).n === 0 && (await one(`select locked_at from public.staff where user_id = $1`, [U.tl])).locked_at === null,
  "kéo nhiều số không bị tính là bất thường, không khoá người bấm");
ok((await as(U.tl, `select count(*)::int n from public.pancake_imports`))[0].n > 0 && (await as(U.sale1, `select count(*)::int n from public.pancake_imports`))[0].n === 0,
  "nhật ký số kéo về: quản lý xem được, telesale không");

section("Sửa kết nối");
await as(U.tl, `select public.pancake_save_page($1, '111222333', $2, null)`, [connId, pageId]);
ok((await one(`select token from private.pancake_tokens where pancake_page_id = '111222333'`)).token === TOKEN, "để trống token → giữ token cũ");
const NEW_TOKEN = "pk_test_token_second_value_0000000000_ZZ77";
await db.exec(`update public.pancake_pages set last_error = 'lỗi cũ', last_error_at = now() where id = '${connId}'`);
await as(U.tl, `select public.pancake_save_page($1, '111222999', $2, $3)`, [connId, pageId, NEW_TOKEN]);
conn = await one(`select * from public.pancake_pages where id = $1`, [connId]);
const tok = await all(`select pancake_page_id, token from private.pancake_tokens`);
ok(conn.pancake_page_id === "111222999" && conn.token_hint === "ZZ77" && !conn.last_error && tok.length === 1 && tok[0].pancake_page_id === "111222999" && tok[0].token === NEW_TOKEN,
  "đổi ID page và token → token đi theo, xoá báo lỗi cũ", { conn: conn.pancake_page_id, tok });
const fromToday = (await as(U.tl, `select public.pancake_save_page(null, '777888999', $1, $2, true) id`, [pageId, TOKEN]))[0].id;
const today = await one(`select (sync_from at time zone 'Asia/Ho_Chi_Minh')::text t from public.pancake_pages where id = $1`, [fromToday]);
ok(/ 00:00:00$/.test(today.t), "kết nối mới có tick \"lấy cả số từ đầu hôm nay\" → mốc 0 giờ hôm nay", today);

section("Không gửi được lượt hỏi → báo ngay trên màn hình, không làm hỏng lượt chạy");
await db.exec(`
  delete from private.pancake_requests;
  alter function net.http_get(text, jsonb, jsonb, int) rename to http_get_ok;
  create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $$ begin raise exception 'pg_net chưa bật'; end $$;
`);
t = await tick();
const broken = await all(`select pancake_page_id, last_error from public.pancake_pages where is_active order by pancake_page_id`);
ok(t.requests === 0 && broken.length === 2 && broken.every((c) => /Không gửi được lượt hỏi Pancake: pg_net chưa bật/.test(c.last_error ?? "")),
  "lỗi gửi ghi vào từng kết nối", broken);
await db.exec(`
  drop function net.http_get(text, jsonb, jsonb, int);
  alter function net.http_get_ok(text, jsonb, jsonb, int) rename to http_get;
`);
t = await tick();
ok(t.requests === 2, "gửi lại được ở lượt sau", t);

finish();
