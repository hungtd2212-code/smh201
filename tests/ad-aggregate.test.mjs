// Kiểm thử phần cộng dồn số liệu ads của Tổng quan / Phân tích (src/lib/ad-reports/aggregate.ts).
// Chạy:  npm run test:ui
import {
  METRICS, change, compactMetric, daysBetween, entriesOf, formatMetric, lastDayOf, metricOf, monthsBetween,
  shiftDay, shiftMonth, sumDays, totalsByDay, totalsByMonth, totalsByStaff,
} from "../src/lib/ad-reports/aggregate.ts";

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("\n== Ngày, tháng");
ok(shiftDay("2026-03-01", -1) === "2026-02-28", "lùi 1 ngày qua đầu tháng 3");
ok(shiftDay("2024-12-31", 1) === "2025-01-01", "tiến 1 ngày qua năm mới");
ok(daysBetween("2026-11-10", "2026-11-12").length === 3, "khoảng 10 → 12 có 3 ngày");
ok(daysBetween("2026-11-12", "2026-11-10").length === 0, "khoảng ngược → rỗng");
ok(lastDayOf("2024-02") === "2024-02-29" && lastDayOf("2026-02") === "2026-02-28", "ngày cuối tháng 2 (năm nhuận / không nhuận)");
ok(shiftMonth("2026-01", -1) === "2025-12" && shiftMonth("2025-12", 1) === "2026-01", "lùi / tiến tháng qua năm");
ok(same(monthsBetween("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]), "các tháng từ 11/2025 tới 02/2026");

console.log("\n== Cộng dồn");
// TKQC A: Dương cầm cả tháng; TKQC B: An cầm tới 10/11, sau đó Dương; TKQC C: không ai cầm.
const assignments = [
  { ad_account_id: "A", ads_staff_id: "duong", from_date: "2020-01-01", to_date: null },
  { ad_account_id: "B", ads_staff_id: "an", from_date: "2020-01-01", to_date: "2026-11-10" },
  { ad_account_id: "B", ads_staff_id: "duong", from_date: "2026-11-11", to_date: null },
];
const report = (day, account, spend, messages, data_count = 0) => ({ report_date: day, ad_account_id: account, spend, messages, data_count });
const reports = [
  report("2026-10-31", "A", 100000, 10, 3), // báo cáo cũ có data riêng, chưa có dòng Data chung → tính 3
  report("2026-11-01", "A", 200000, 20, 9), // báo cáo cũ nhưng ngày đó đã có dòng Data chung → không tính 9
  report("2026-11-01", "B", 50000, 5),
  report("2026-11-11", "B", 70000, 7),
  report("2026-11-11", "C", 1000, 1),
];
const dailyData = [
  { report_date: "2026-11-01", ads_staff_id: "duong", data_count: 6 },
  { report_date: "2026-11-01", ads_staff_id: "an", data_count: 2 },
  { report_date: "2026-11-11", ads_staff_id: "duong", data_count: 4 },
];
const entries = entriesOf(reports, dailyData, assignments);
const duong = totalsByDay(entries, "duong");
ok(same(duong.get("2026-10-31"), { spend: 100000, messages: 10, data: 3 }), "data riêng ở báo cáo cũ được tính khi chưa có dòng chung", duong.get("2026-10-31"));
ok(same(duong.get("2026-11-01"), { spend: 200000, messages: 20, data: 6 }), "ngày có dòng Data chung: chỉ tính dòng chung", duong.get("2026-11-01"));
ok(same(duong.get("2026-11-11"), { spend: 70000, messages: 7, data: 4 }), "TKQC đổi người: số tính cho người cầm vào ngày đó", duong.get("2026-11-11"));
ok(same(totalsByDay(entries, "an").get("2026-11-01"), { spend: 50000, messages: 5, data: 2 }), "An: TKQC B trước khi đổi người");
const all = totalsByDay(entries, null);
ok(all.get("2026-11-11").spend === 71000, "tất cả nhân viên: gồm cả TKQC không ai cầm");
const byStaff = totalsByStaff(entries, (day) => day.startsWith("2026-11"));
ok(byStaff.get(null).spend === 1000 && byStaff.get("duong").spend === 270000 && byStaff.get("an").data === 2, "theo nhân viên trong tháng 11 (khoá null = không ai cầm)");
const months = totalsByMonth(all);
ok(months.get("2026-10").spend === 100000 && months.get("2026-11").spend === 321000, "gộp theo tháng", [...months]);
ok(same(sumDays(duong, daysBetween("2026-11-01", "2026-11-30")), { spend: 270000, messages: 27, data: 10 }), "cộng một khoảng ngày");
ok(totalsByDay(entries, null, (day) => day >= "2026-11-11").size === 1, "lọc ngày");

console.log("\n== Chỉ số và hiển thị");
const t = { spend: 7938367, messages: 136, data: 60 };
ok(formatMetric(metricOf("spend"), t.spend) === "7.938.367", "chi tiêu có dấu chấm");
ok(formatMetric(metricOf("spend"), t.spend, true) === "7.938.367đ", "… kèm đ");
ok(formatMetric(metricOf("costPerMessage"), metricOf("costPerMessage").value(t)) === "58.370", "giá mess = chi tiêu / mess, làm tròn");
ok(formatMetric(metricOf("dataRate"), metricOf("dataRate").value(t)) === "44,12%", "tỉ lệ xin số 44,12%");
ok(formatMetric(metricOf("costPerData"), metricOf("costPerData").value({ spend: 5, messages: 0, data: 0 })) === "–", "chia cho 0 → –");
ok(compactMetric(metricOf("spend"), 7938367) === "7,9 tr" && compactMetric(metricOf("spend"), 1250000000) === "1,25 tỷ", "số gọn trên trục", [compactMetric(metricOf("spend"), 7938367)]);
ok(compactMetric(metricOf("dataRate"), 0.4412) === "44%", "tỉ lệ gọn trên trục");
ok(METRICS.length === 6, "6 chỉ số");

console.log("\n== Tăng / giảm");
let c = change(metricOf("costPerMessage"), 50000, 40000);
ok(c.direction === "up" && c.tone === "bad" && Math.abs(c.pct - 0.25) < 1e-9, "giá mess tăng 25% → xấu", c);
c = change(metricOf("data"), 50, 40);
ok(c.tone === "good", "data tăng → tốt");
c = change(metricOf("spend"), 50, 40);
ok(c.tone === "neutral", "chi tiêu tăng → không tô tốt / xấu");
ok(change(metricOf("data"), 5, 0).pct === null, "kỳ trước bằng 0 → không tính %");
ok(change(metricOf("costPerData"), null, 5) === null, "không tính được → không so");

console.log(`\n${passed} ok, ${failed} lỗi`);
if (failed > 0) process.exit(1);
