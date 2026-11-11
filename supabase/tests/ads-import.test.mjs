// Kiểm thử file nạp số liệu tháng 10/2026 chép từ Google Sheet "BC ads T10 2026 - SMH"
// (supabase/import/ads_2026_10.sql — số liệu thật của phòng khám nên KHÔNG nằm trong Git; không có
// file thì bỏ qua). Nạp vào một Postgres trong bộ nhớ đang ở đúng trạng thái của cơ sở dữ liệu thật
// (schema → 006 + dữ liệu mẫu 005), rồi dùng CHÍNH phần tính toán của trang báo cáo
// (src/lib/ads-stats/compute.ts) để so từng con số với sheet "Tổng" và "BÁO CÁO TUẦN".
//
// Chạy:  npm run test:db
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NO_OWNER,
  daysOfMonth,
  metricsOf,
  ownerLookup,
  summarize,
  totalsByStaff,
  weeksOfMonth,
} from "../../src/lib/ads-stats/compute.ts";
import { createTestDb } from "./harness.mjs";

const importFile = "import/ads_2026_10.sql";
if (!existsSync(join(dirname(fileURLToPath(import.meta.url)), "..", importFile))) {
  console.log(`\n(bỏ qua: không có supabase/${importFile})`);
  process.exit(0);
}

const { db, read, ok, section, one, all, addUser, finish } = await createTestDb();

section("Dựng cơ sở dữ liệu như bản thật: schema → 006 + dữ liệu mẫu 005");
const owner = await addUser("owner");
await db.exec(read("schema.sql"));
await db.exec(`insert into public.staff (user_id, full_name, role) values ('${owner}', 'Chủ phòng khám', 'admin')`);
for (const file of ["002_marketing_lead.sql", "003_data_safety.sql", "004_delete_permission.sql",
  "005_marketing_catalog.sql", "seeds/005_marketing_sample.sql", "006_ads_daily_stats.sql"]) {
  await db.exec(read(file));
}
const staffBefore = (await one(`select count(*)::int n from public.ads_staff`)).n;
ok(staffBefore === 7, "có sẵn 7 nhân viên Ads của dữ liệu mẫu", staffBefore);

section("Nạp số liệu tháng 10/2026");
await db.exec(read(importFile));
ok(true, "file nạp chạy không lỗi");
const count = async () => one(`
  select (select count(*)::int from public.ad_daily_spend) as spend,
         (select count(*)::int from public.ads_daily_results) as results,
         (select count(*)::int from public.ad_accounts) as accounts,
         (select count(*)::int from public.ad_account_assignments) as assignments,
         (select count(*)::int from public.ads_staff) as staff`);
const first = await count();
await db.exec(read(importFile));
const second = await count();
ok(JSON.stringify(first) === JSON.stringify(second), "chạy lại lần hai không sinh dòng trùng", [first, second]);
ok(first.staff === 7, "không tạo thêm nhân viên Ads (5 người của sheet đã có sẵn)", first.staff);
ok(first.accounts === 10, "10 TKQC: 2 có sẵn (THE DUONG 01, An 02) + 8 TKQC mới của sheet", first.accounts);
ok(first.spend === 170 && first.results === 115, "170 dòng chi tiêu, 115 dòng kết quả", first);
const notes = await all(`select distinct note from public.audit_log where table_name in ('ad_daily_spend', 'ads_daily_results')`);
ok(notes.length === 1 && /Nạp số liệu tháng 10\/2026/.test(notes[0].note), "nhật ký ghi rõ đây là đợt nạp từ Google Sheet", notes);

// Số đã có trong hệ thống thì file nạp không ghi đè; tổng lệch sheet thì huỷ toàn bộ.
await db.exec(`update public.ad_daily_spend set spend = spend + 1 where stat_date = '2026-10-05' and ad_account_id = (select id from public.ad_accounts where name = 'An 01')`);
let e = null;
try {
  await db.exec(read(importFile));
} catch (error) {
  e = error.message;
}
ok(/không khớp sheet/.test(e ?? ""), "đã sửa số trong hệ thống rồi chạy lại file nạp → file tự huỷ, không ghi đè", e);
await db.exec(`rollback`).catch(() => {});
await db.exec(`update public.ad_daily_spend set spend = spend - 1 where stat_date = '2026-10-05' and ad_account_id = (select id from public.ad_accounts where name = 'An 01')`);

// ---------------------------------------------------------------------------
// Từ đây dùng đúng phần tính toán của trang báo cáo.
const stats = {
  spend: (await all(`select stat_date::text, ad_account_id, spend from public.ad_daily_spend`))
    .map((r) => ({ ...r, spend: Number(r.spend) })),
  results: (await all(`select stat_date::text, ads_staff_id, messages, data_count, sales, revenue,
      q_potential, q_booked, q_wrong_area, q_no_response, note from public.ads_daily_results`))
    .map((r) => ({ ...r, sales: Number(r.sales), revenue: Number(r.revenue) })),
};
const assignments = await all(`select id, ad_account_id, ads_staff_id, from_date::text, to_date::text, note, deleted_at
  from public.ad_account_assignments where deleted_at is null`);
const ownerOf = ownerLookup(assignments);
const staffId = Object.fromEntries((await all(`select id, full_name from public.ads_staff`)).map((s) => [s.full_name, s.id]));
const accountId = Object.fromEntries((await all(`select id, name from public.ad_accounts`)).map((a) => [a.name, a.id]));
const days = daysOfMonth("2026-10");

section("Bảng tổng tháng 10 (sheet “Tổng”)");
const month = summarize(stats, days, ownerOf, null);
const t = month.total;
ok(t.spend === 151150103, "chi tiêu ads 151.150.103", t.spend);
ok(t.data === 195 && t.sales === 462050000 && t.revenue === 288650000, "data 195 · doanh số 462.050.000 · doanh thu 288.650.000", t);
ok(t.messages === 596, "tổng mess 596 (sheet ghi 591 vì chưa cộng 5 mess của sheet Sang(âu))", t.messages);
ok(t.potential === 49 && t.booked === 15 && t.wrongArea === 34 && t.noResponse === 26,
  "chất lượng data 49 · 15 · 34 · 26 (sheet ghi 48 · 15 · 32 · 25 vì sheet An cộng thiếu ngày 31/10)", t);
const m = metricsOf(t);
ok(Math.round(m.costPerData) === 775129, "giá data 775.129", m.costPerData);
ok((m.adsOverSales * 100).toFixed(2) === "32.71", "ads / doanh số 32,71%", m.adsOverSales);
// Bỏ 5 mess của Sang(âu) ra thì đúng bằng hai con số sheet đang hiện.
ok(Math.round(t.spend / 591) === 255753 && ((t.data / 591) * 100).toFixed(2) === "32.99", "với 591 mess như sheet: giá mess 255.753 · tỉ lệ xin số 32,99%");
ok(month.days.length === 31 && month.days.every((d) => d.entered), "đủ 31 ngày, ngày nào cũng có số");

const accounts = {
  "Anh Hưng 2": 18766432, "Anh Hưng 1 (Châu âu)": 2210832, "THE DUONG 01": 2942980, "THE DUONG 02": 23626803,
  "Dương 01": 150539, "Anh Hưng 1": 35018430, "LTN 01": 30035076, "Anh Nam 35": 1409607, "An 01": 36989404,
};
for (const [name, value] of Object.entries(accounts)) {
  ok(month.spendByAccount.get(accountId[name]) === value, `cột TKQC ${name}: ${value.toLocaleString("vi-VN")}`, month.spendByAccount.get(accountId[name]));
}
ok(month.spendByAccount.size === 9 && !month.spendByAccount.has(accountId["An 02"]), "không TKQC nào khác phát sinh chi tiêu");

// Vài ngày bất kỳ, so với dòng của ngày đó trên sheet nhân viên.
const dayOf = (staff, day) => summarize(stats, days, ownerOf, staffId[staff]).days.find((d) => d.day === day);
let d = dayOf("Dương", "2026-10-12");
ok(d.totals.spend === 1055162 && d.totals.messages === 3 && d.totals.data === 3 && d.totals.potential === 1 && d.totals.wrongArea === 1 && d.totals.noResponse === 1
  && d.spendByAccount.get(accountId["THE DUONG 01"]) === 179629 && d.spendByAccount.get(accountId["THE DUONG 02"]) === 875533, "Dương 12/10: 1.055.162 · 3 mess · 3 data", d.totals);
d = dayOf("An", "2026-10-13");
ok(d.totals.spend === 1174279 && d.totals.messages === 4 && d.totals.data === 2 && d.totals.sales === 64000000 && d.totals.revenue === 44000000, "An 13/10: 1.174.279 · 4 mess · 2 data · 64.000.000 / 44.000.000", d.totals);
d = dayOf("Nam", "2026-10-31");
ok(d.totals.spend === 1738588 && d.totals.messages === 7 && d.totals.data === 3, "Nam 31/10 (2 TKQC): 1.738.588 · 7 mess · 3 data", d.totals);
d = dayOf("Sang", "2026-10-08");
ok(d.totals.spend === 1715413 && d.totals.messages === 7 && d.totals.data === 2, "Sang 8/10 (gộp sheet Sang và Sang(âu)): 1.715.413 · 7 mess · 2 data", d.totals);

section("Theo nhân viên, cả tháng (sheet “BÁO CÁO TUẦN”, bảng tháng)");
const byStaff = totalsByStaff(stats, "2026-10-01", "2026-10-31", ownerOf);
const expectStaff = {
  // [chi tiêu, mess, data, doanh số, doanh thu, KHTN, đặt lịch hẹn, lạc tỉnh, không tương tác]
  "Dương": [26720322, 72, 20, 41050000, 29650000, 7, 1, 3, 2],
  "Nam": [31444683, 127, 43, 59500000, 31000000, 14, 1, 7, 7],
  "An": [36989404, 227, 64, 300500000, 191000000, 15, 9, 17, 13], // sheet: 14 · 9 · 15 · 12 (thiếu ngày 31/10)
  "Sang": [35018430 + 2210832, 165 + 5, 68, 61000000, 37000000, 13, 4, 7, 4], // gộp Sang và Sang (Âu)
  "A Hưng": [18766432, 0, 0, 0, 0, 0, 0, 0, 0],
};
const flat = (x) => x ? [x.spend, x.messages, x.data, x.sales, x.revenue, x.potential, x.booked, x.wrongArea, x.noResponse] : null;
for (const [name, want] of Object.entries(expectStaff)) {
  const got = flat(byStaff.get(staffId[name]));
  ok(JSON.stringify(got) === JSON.stringify(want), `${name}: ${want[0].toLocaleString("vi-VN")} · ${want[1]} mess · ${want[2]} data`, got);
}
ok(!byStaff.has(NO_OWNER) && byStaff.size === 5, "mọi đồng chi tiêu đều có người phụ trách; Trung, Hằng không có số");
const duong = metricsOf(byStaff.get(staffId["Dương"]));
ok(Math.round(duong.costPerMessage) === 371116 && Math.round(duong.costPerData) === 1336016 && (duong.dataRate * 100).toFixed(2) === "27.78" && (duong.adsOverSales * 100).toFixed(2) === "65.09",
  "Dương: giá mess 371.116 · giá data 1.336.016 · xin số 27,78% · ads/doanh số 65,09%", duong);
ok(metricsOf(byStaff.get(staffId["A Hưng"])).costPerMessage === null, "A Hưng không có mess → giá mess là “–” (sheet hiện #DIV/0!)");

section("Theo tuần (sheet “BÁO CÁO TUẦN”)");
const weeks = weeksOfMonth("2026-10");
ok(weeks.map((w) => w.label).join(" | ") === "1–4/10 | 5–11/10 | 12–18/10 | 19–25/10 | 26–31/10", "5 tuần đúng như sheet", weeks.map((w) => w.label));
// Mỗi tuần: [Dương, Nam, An, Sang, A Hưng] × [chi tiêu, mess, data, doanh số, doanh thu]; Sang tuần 2 cộng cả Sang (Âu).
const expectWeeks = [
  { total: [15556584, 62, 21, 21150000, 16150000],
    staff: { "Dương": [2240918, 9, 3, 21150000, 16150000], "Nam": [3059933, 8, 3, 0, 0], "An": [3601022, 22, 4, 0, 0], "Sang": [5747088, 23, 11, 0, 0], "A Hưng": [907623, 0, 0, 0, 0] } },
  { total: [35679360, 103 + 5, 34, 103400000, 86500000],
    staff: { "Dương": [6422170, 15, 2, 16400000, 10000000], "Nam": [6628357, 22, 8, 0, 0], "An": [5804637, 36, 10, 87000000, 76500000], "Sang": [8302333 + 2210832, 30 + 5, 14, 0, 0], "A Hưng": [6311031, 0, 0, 0, 0] } },
  { total: [33018687, 117, 40, 119000000, 81000000],
    staff: { "Dương": [6689985, 16, 8, 0, 0], "Nam": [5990745, 19, 10, 0, 0], "An": [8062195, 44, 12, 119000000, 81000000], "Sang": [7037371, 38, 10, 0, 0], "A Hưng": [5238391, 0, 0, 0, 0] } },
  { total: [34100167, 127, 37, 132000000, 79500000],
    staff: { "Dương": [5820086, 12, 3, 0, 0], "Nam": [8052056, 37, 11, 50500000, 22000000], "An": [8831755, 47, 11, 48500000, 32500000], "Sang": [7701982, 31, 12, 33000000, 25000000], "A Hưng": [3694288, 0, 0, 0, 0] } },
  { total: [32795305, 182, 63, 86500000, 25500000],
    // Dương: dòng của Dương trên sheet tuần này ghi doanh số 0, nhưng ngày 29/10 có 3.500.000 / 3.500.000
    // và chính dòng Tổng của sheet (86.500.000 / 25.500.000) đã cộng khoản đó.
    staff: { "Dương": [5547163, 20, 4, 3500000, 3500000], "Nam": [7713592, 41, 11, 9000000, 9000000], "An": [10689795, 78, 27, 46000000, 1000000], "Sang": [6229656, 43, 21, 28000000, 12000000], "A Hưng": [2615099, 0, 0, 0, 0] } },
];
const five = (x) => x ? [x.spend, x.messages, x.data, x.sales, x.revenue] : [0, 0, 0, 0, 0];
for (const [index, week] of weeks.entries()) {
  const want = expectWeeks[index];
  const perStaff = totalsByStaff(stats, week.from, week.to, ownerOf);
  const wrong = Object.entries(want.staff)
    .filter(([name, numbers]) => JSON.stringify(five(perStaff.get(staffId[name]))) !== JSON.stringify(numbers))
    .map(([name]) => [name, five(perStaff.get(staffId[name]))]);
  ok(wrong.length === 0, `tuần ${week.label}: 5 nhân viên khớp sheet (chi tiêu, mess, data, doanh số, doanh thu)`, wrong);
  const sum = summarize(stats, days.filter((x) => x >= week.from && x <= week.to), ownerOf, null).total;
  ok(JSON.stringify(five(sum)) === JSON.stringify(want.total), `tuần ${week.label}: dòng Tổng ${want.total[0].toLocaleString("vi-VN")} · ${want.total[1]} mess · ${want.total[2]} data`, five(sum));
}

finish();
