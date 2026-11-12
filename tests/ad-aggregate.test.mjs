// Kiểm thử phần cộng dồn số liệu ads của Tổng quan / Phân tích (src/lib/ad-reports/aggregate.ts).
// Chạy:  npm run test:ui
import {
  METRICS, change, checkTargets, compactMetric, daysBetween, entriesOf, formatMetric, funnelCounts, lastDayOf,
  metricOf, monthElapsed, monthsBetween, previousOf, shiftDay, shiftMonth, spikeAlerts, sumDays, totalsByAccount,
  totalsByDay, totalsByMonth, totalsByStaff, totalsByWeekday, weekdayOf, trackPeriods, periodElapsed, trackGoals,
  scoreBoard,
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


console.log("\n== So với kỳ trước");
let p = previousOf(["2026-10"], "2026-11-12");
ok(same(p.months, ["2026-09"]) && p.label === "tháng 9/2026" && p.keep("2026-09-30"), "tháng đã qua → cả tháng trước", p);
p = previousOf(["2026-11"], "2026-11-12");
ok(p.keep("2026-10-12") && !p.keep("2026-10-13") && /cùng kỳ tới ngày 12/.test(p.label), "tháng hiện tại → tháng trước tới cùng ngày", p.label);
p = previousOf(["2026-09", "2026-10", "2026-11"], "2026-11-12");
ok(same(p.months, ["2026-06", "2026-07", "2026-08"]) && p.keep("2026-07-31") && p.keep("2026-08-12") && !p.keep("2026-08-13"), "3 tháng liền nhau → 3 tháng liền trước (tháng 8 ứng với tháng 11 nên cắt tới ngày 12)", p.months);
p = previousOf(monthsBetween("2026-01", "2026-11"), "2026-11-12");
ok(p.months[0] === "2025-01" && p.label.startsWith("năm 2025") && p.keep("2025-11-12") && !p.keep("2025-11-13"), "cả năm nay → năm ngoái cùng kỳ", p.label);
ok(previousOf(["2026-01", "2026-05"], "2026-11-12") === null, "tháng rời rạc → không so");

console.log("\n== Mục tiêu");
ok(monthElapsed("2026-11", "2026-11-15") === 0.5 && monthElapsed("2026-10", "2026-11-15") === 1, "phần tháng đã qua");
const items = checkTargets({ spend: 200, messages: 10, data: 1 }, { monthly_budget: 300, monthly_data: 10, max_cost_per_message: 15, max_cost_per_data: 150 }, 0.5);
const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
ok(byKey.budget.status === "warning", "tiêu 67% khi mới qua 50% tháng → cảnh báo", byKey.budget);
ok(byKey.data.status === "warning", "data 10% khi đã qua 50% tháng → chậm", byKey.data);
ok(byKey.costPerMessage.status === "critical" && byKey.costPerData.status === "critical", "giá mess 20 > 15, giá data 200 > 150 → vượt");
ok(checkTargets({ spend: 400, messages: 0, data: 0 }, { monthly_budget: 300, monthly_data: null, max_cost_per_message: null, max_cost_per_data: 100 }, 0.5)
  .find((i) => i.key === "budget").status === "critical", "vượt ngân sách → đỏ");
ok(checkTargets(zero3(), { monthly_budget: null, monthly_data: null, max_cost_per_message: null, max_cost_per_data: null }, 1).length === 0, "không đặt mục tiêu → không có dòng nào");
function zero3() { return { spend: 0, messages: 0, data: 0 }; }

console.log("\n== Cảnh báo bất thường");
const spikes = new Map();
for (let i = 1; i <= 7; i++) spikes.set(shiftDay("2026-11-11", -i), { spend: 100000, messages: 10, data: 1 });
spikes.set("2026-11-11", { spend: 100000, messages: 10, data: 0 });
let alerts = spikeAlerts(spikes, "2026-11-12");
ok(alerts.length === 1 && /chưa có data/.test(alerts[0].text), "tiêu tiền mà chưa có data → nhắc", alerts);
spikes.set("2026-11-11", { spend: 200000, messages: 10, data: 1 });
alerts = spikeAlerts(spikes, "2026-11-12");
ok(alerts.some((a) => /Giá data ngày 11\/11/.test(a.text) && a.level === "critical"), "giá data gấp đôi 7 ngày trước → đỏ", alerts);
ok(spikeAlerts(new Map(), "2026-11-12").length === 0, "không có số → không cảnh báo");

console.log("\n== Theo thứ, theo TKQC, phễu");
ok(weekdayOf("2026-11-09") === 0 && weekdayOf("2026-11-15") === 6, "09/11/2026 là thứ Hai, 15/11 là Chủ nhật");
const wk = totalsByWeekday(new Map([["2026-11-09", { spend: 5, messages: 1, data: 1 }]]), daysBetween("2026-11-02", "2026-11-15"));
ok(wk[0].days === 2 && wk[0].totals.spend === 5 && wk[6].days === 2, "mỗi thứ 2 ngày trong 2 tuần", wk[0]);
const acc = totalsByAccount(reports, assignments, "duong", (d) => d.startsWith("2026-11"));
ok(acc.get("A").totals.spend === 200000 && acc.get("B").totals.spend === 70000 && !acc.has("C"), "tổng theo TKQC của một người", [...acc.keys()]);
ok(totalsByAccount(reports, assignments, null).get("B").owners.size === 2, "TKQC đổi người: ghi đủ 2 người phụ trách");
const fc = funnelCounts([
  { day: "2026-11-01", status: "so_moi", hasAppointment: false, invalidPhone: false, accountId: null },
  { day: "2026-11-01", status: "hen_lich", hasAppointment: true, invalidPhone: false, accountId: null },
  { day: "2026-11-01", status: "fail", hasAppointment: true, invalidPhone: false, accountId: null },
  { day: "2026-11-01", status: "da_lam_dich_vu", hasAppointment: false, invalidPhone: false, accountId: null },
  { day: "2026-11-01", status: "so_trung", hasAppointment: false, invalidPhone: false, accountId: null },
  { day: "2026-11-01", status: "so_moi", hasAppointment: false, invalidPhone: true, accountId: null },
], ["so_trung", "trung_dich_vu_khac", "so_huy"]);
ok(same(fc, { leads: 4, booked: 3, done: 1 }), "phễu: bỏ số trùng / số sai; hẹn lịch gồm cả lead đã có ngày hẹn", fc);

console.log("\n== Theo dõi mục tiêu tháng / quý / năm");
const periods = trackPeriods("2026-11-12");
ok(periods[1].from === "2026-10-01" && periods[1].to === "2026-12-31" && periods[2].months === 12, "quý 4, năm 2026", periods);
ok(Math.abs(periodElapsed(periods[0], "2026-11-12") - 12 / 30) < 1e-9, "tháng 11 đã qua 12/30");
const goals = { monthly_budget: 100, monthly_data: 30, max_cost_per_message: 2, max_cost_per_data: 5, monthly_revenue: 1000, max_ad_revenue_pct: 20 };
let tg = Object.fromEntries(trackGoals({ spend: 60, messages: 40, data: 15 }, 300, goals, 1, 0.5).map((i) => [i.key, i]));
ok(tg.budget.status === "warning" && /nhanh hơn/.test(tg.budget.note), "tiêu 60% khi qua 50% tháng → nhanh hơn kế hoạch", tg.budget);
ok(tg.data.status === "good" && tg.data.note === "Đúng kỳ vọng", "data 15/30 khi qua nửa tháng → đúng kỳ vọng", tg.data);
ok(tg.costPerData.status === "good" && tg.costPerData.actual === 4, "giá số 4 ≤ 5 → tốt", tg.costPerData);
ok(tg.costPerMessage.status === "good", "giá mess 1,5 ≤ 2");
ok(tg.revenue.status === "bad" && /Kém hơn kỳ vọng 40%/.test(tg.revenue.note), "doanh thu 300 / kỳ vọng 500 → kém 40%", tg.revenue);
ok(tg.adRevenue.status === "warning" && tg.adRevenue.actual === 20, "ads / doanh thu 20% = đúng mức tối đa → chưa vượt nhưng sát mức", tg.adRevenue);
tg = Object.fromEntries(trackGoals({ spend: 60, messages: 40, data: 15 }, 0, goals, 3, 0.5).map((i) => [i.key, i]));
ok(tg.data.goal === 90 && tg.budget.goal === 300, "quý: mục tiêu × 3 tháng");
ok(tg.adRevenue.status === "none" && tg.adRevenue.note === "Chưa có doanh thu", "chưa có doanh thu → chưa tính tỉ lệ");
ok(trackGoals({ spend: 1, messages: 1, data: 1 }, 0, null, 1, 0.5).every((i) => i.status === "none"), "chưa đặt mục tiêu → không chấm");

console.log("\n== Vinh danh");
const board = scoreBoard([
  { id: "a", spend: 100, data: 20, revenue: 1000, dataTarget: 40 },  // ads/dt 10%, giá 5, đạt 100% nhịp
  { id: "b", spend: 100, data: 10, revenue: 500, dataTarget: 40 },   // 20%, giá 10, đạt 50%
  { id: "c", spend: 50, data: 25, revenue: 0, dataTarget: null },    // chưa có doanh thu, giá 2, chưa target
  { id: "d", spend: 0, data: 0, revenue: 0, dataTarget: 10 },        // không chạy → không xếp
], 0.5);
ok(board.length === 3 && !board.some((b) => b.id === "d"), "chỉ xếp người có chi tiêu");
const sc = Object.fromEntries(board.map((b) => [b.id, b]));
ok(Math.abs(sc.a.score - (100 + 40 + 100) / 3) < 0.1, "a: ads/dt 100, giá số 40, target 100", sc.a);
ok(Math.abs(sc.b.score - (50 + 20 + 50) / 3) < 0.1, "b: 50, 20, 50", sc.b);
ok(Math.abs(sc.c.score - (0 + 100 + 0) / 3) < 0.1, "c: thiếu doanh thu, thiếu target → 0 ở hai tiêu chí đó", sc.c);
ok(board[0].id === "a", "a đứng đầu");
ok(scoreBoard([{ id: "x", spend: 10, data: 2, revenue: 0, dataTarget: null }], 1)[0].score === 100, "chỉ có tiêu chí giá số → người duy nhất 100 điểm");
const tiny = scoreBoard([
  { id: "big", spend: 17000000, data: 90, revenue: 0, dataTarget: null },
  { id: "small", spend: 2, data: 5, revenue: 0, dataTarget: null },
], 1);
ok(tiny.length === 1 && tiny[0].id === "big" && tiny[0].score === 100, "người chạy rất ít tiền (2đ ra 5 số) không được xếp hạng", tiny);

console.log(`\n${passed} ok, ${failed} lỗi`);
if (failed > 0) process.exit(1);
