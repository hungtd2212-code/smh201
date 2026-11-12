// Kiểm thử phần dựng file Excel "Tải Excel" ở Tổng quan / Phân tích (src/lib/ad-reports/export.ts).
// Chạy:  npm run test:ui
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readExcelFile from "read-excel-file/node";
import writeExcelFile from "write-excel-file/node";
import { entriesOf } from "../src/lib/ad-reports/aggregate.ts";
import { buildAdsExport, daysLabel, exportFileName } from "../src/lib/ad-reports/export.ts";

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
const val = (cell) => (cell !== null && typeof cell === "object" ? cell.value : cell);
const row = (sheet, first) => sheet.data.find((r) => val(r[0]) === first);

const staff = [
  { id: "duong", full_name: "Dương Ads", is_active: true, deleted_at: null },
  { id: "an", full_name: "An Ads", is_active: true, deleted_at: null },
  { id: "hung", full_name: "Hùng Ads", is_active: false, deleted_at: null },
];
const accounts = [
  { id: "D1", name: "THE DUONG 01", account_id: "1111111111", deleted_at: null },
  { id: "A1", name: "An 01", account_id: "3333333333", deleted_at: null },
  { id: "X", name: "Không ai", account_id: "5555555555", deleted_at: null },
];
const assignments = [
  { ad_account_id: "D1", ads_staff_id: "duong", from_date: "2020-01-01", to_date: null, deleted_at: null },
  { ad_account_id: "A1", ads_staff_id: "an", from_date: "2020-01-01", to_date: null, deleted_at: null },
];
const rep = (day, acc, spend, messages) => ({ report_date: day, ad_account_id: acc, spend, messages, data_count: 0 });
const dat = (day, sid, data_count, revenue = null) => ({ report_date: day, ads_staff_id: sid, data_count, revenue });
const reports = [
  rep("2026-10-31", "D1", 100000, 2),
  rep("2026-11-01", "D1", 500000, 5),
  rep("2026-11-01", "A1", 300000, 3),
  rep("2026-11-02", "D1", 200000, 0),
  rep("2026-11-02", "X", 50000, 1), // TKQC chưa ai phụ trách
  rep("2026-11-20", "D1", 999, 9), // ngoài kỳ đang xem
];
const data = [dat("2026-10-31", "duong", 1), dat("2026-11-01", "duong", 2, 1500000), dat("2026-11-01", "an", 1), dat("2026-11-02", "duong", 0, 500000)];
const entries = entriesOf(reports, data, assignments);
const base = { staff, accounts, assignments, reports, data, entries, exportedAt: "13/11/2026 14:05" };
const days = ["2026-11-01", "2026-11-02", "2026-11-03"];

console.log("\n== Tất cả nhân viên, một tháng");
const all = buildAdsExport({ ...base, title: "Tổng quan", who: "Tất cả nhân viên", periodLabel: "Tháng 11/2026", days, staffId: null });
const tab = (sheets, name) => sheets.find((s) => s.sheet === name);
ok(same(all.map((s) => s.sheet), ["Tổng hợp", "Theo ngày", "Theo thứ", "Theo nhân viên", "Theo TKQC", "Chi tiết TKQC", "Chi tiết Data"]), "các tab (không có Theo tháng khi chỉ một tháng)", all.map((s) => s.sheet));
const sum = row(tab(all, "Tổng hợp"), "Cả kỳ đang xem");
ok(same(sum.slice(1).map(val), [1050000, 9, 1050000 / 9, 3, 350000, 3 / 9, 2000000, 3]), "tổng cả kỳ: chi tiêu, mess, giá mess, data, giá data, tỉ lệ, doanh thu, số ngày", sum.map(val));
ok(sum[3].format === "#,##0" && sum[6].format === "0.0%", "định dạng tiền và phần trăm");
ok(val(tab(all, "Tổng hợp").data[1][1]) === "Tất cả nhân viên" && val(tab(all, "Tổng hợp").data[2][1]) === "Tháng 11/2026", "ghi người và kỳ đang xem");
const byDay = tab(all, "Theo ngày");
ok(byDay.data.length === 1 + 3 + 1, "mỗi ngày một dòng + dòng tổng");
const d3 = byDay.data[3];
ok(val(d3[1]) === "Thứ 3" && val(d3[2]) === 0 && d3[4] === "–" && d3[8] === "–", "ngày không có số: 0, giá mess “–”, doanh thu “–”", d3.map(val));
ok(byDay.data[1][0].value instanceof Date && byDay.data[1][0].format === "dd/mm/yyyy", "ngày là ô ngày của Excel");
const people = tab(all, "Theo nhân viên");
ok(same(people.data.slice(1, -1).map((r) => val(r[0])), ["An Ads", "Dương Ads", "Chưa có người phụ trách"]), "người đang làm + dòng TKQC chưa ai phụ trách (Hùng đã nghỉ, không có số → bỏ)", people.data.map((r) => val(r[0])));
ok(same(row(people, "Dương Ads").slice(2).map(val).slice(0, 2), [700000, 5]) && val(row(people, "Dương Ads")[8]) === 2000000, "số của Dương trong kỳ (không tính 31/10, 20/11)");
const acc = tab(all, "Theo TKQC");
ok(same(acc.data.slice(1).map((r) => [val(r[0]), val(r[1]), val(r[2]), val(r[3])]), [
  ["THE DUONG 01", "1111111111", "Dương Ads", 700000],
  ["An 01", "3333333333", "An Ads", 300000],
  ["Không ai", "5555555555", "Chưa có người phụ trách", 50000],
]), "theo TKQC: tên, ID, người phụ trách, chi tiêu (nhiều nhất trước)", acc.data.map((r) => r.map(val)));
ok(val(acc.data[1][6]) === 2, "số ngày chạy của TKQC");
ok(tab(all, "Chi tiết TKQC").data.length === 1 + 4 && tab(all, "Chi tiết Data").data.length === 1 + 3, "chi tiết chỉ trong kỳ đang xem");

console.log("\n== Một nhân viên, nhiều tháng, có kỳ so sánh");
const one = buildAdsExport({
  ...base,
  title: "Phân tích · So sánh tháng",
  who: "Dương Ads",
  periodLabel: "Tháng 10/2026, Tháng 11/2026",
  days: ["2026-10-31", ...days],
  groups: [{ label: "Tháng 10/2026", days: ["2026-10-31"] }, { label: "Tháng 11/2026", days }],
  staffId: "duong",
});
ok(same(one.map((s) => s.sheet), ["Tổng hợp", "Theo ngày", "Theo tháng", "Theo thứ", "Theo TKQC", "Chi tiết TKQC", "Chi tiết Data"]), "có Theo tháng, không có Theo nhân viên", one.map((s) => s.sheet));
const s1 = tab(one, "Tổng hợp");
ok(val(row(s1, "Cả kỳ đang xem")[1]) === 800000 && val(row(s1, "Tháng 10/2026")[1]) === 100000 && val(row(s1, "Tháng 11/2026")[1]) === 700000, "tổng cả kỳ + từng kỳ so sánh, chỉ số của Dương", s1.data.map((r) => r.map(val)));
ok(same(tab(one, "Theo tháng").data.slice(1).map((r) => val(r[0])), ["10/2026", "11/2026", "Tổng"]), "theo tháng");
ok(same(tab(one, "Theo TKQC").data.slice(1).map((r) => val(r[0])), ["THE DUONG 01"]), "chỉ TKQC của Dương");
ok(tab(one, "Chi tiết Data").data.slice(1).every((r) => val(r[1]) === "Dương Ads"), "chi tiết Data chỉ của Dương");
const thu = tab(one, "Theo thứ");
ok(thu.data.length === 8 && val(thu.data[6][0]) === "Thứ 7" && val(thu.data[6][1]) === 100000 && val(thu.data[6][8]) === 1, "theo thứ: 31/10 là thứ 7", thu.data.map((r) => r.map(val)));

console.log("\n== Tên file, nhãn ngày");
ok(exportFileName("Tổng quan", days) === "bao-cao-ads-tong-quan_2026-11-01_2026-11-03.xlsx", "tên file không dấu, có khoảng ngày");
ok(exportFileName("Phân tích · So sánh tháng", []) === "bao-cao-ads-phan-tich-so-sanh-thang.xlsx", "tên file khi không có ngày");
ok(daysLabel(days) === "01/11/2026 – 03/11/2026" && daysLabel(["2026-11-13"]) === "13/11/2026", "nhãn khoảng ngày");

console.log("\n== Ghi ra .xlsx thật và đọc lại");
{
  const dir = mkdtempSync(join(tmpdir(), "smh-export-"));
  try {
    const path = join(dir, "bao-cao.xlsx");
    await writeExcelFile(all).toFile(path);
    const back = await readExcelFile(path);
    ok(same(back.map((s) => s.sheet), all.map((s) => s.sheet)), "đủ các tab");
    const days2 = back.find((s) => s.sheet === "Theo ngày").data;
    ok(days2[1][0] instanceof Date && days2[1][0].toISOString().startsWith("2026-11-01") && days2[1][2] === 800000, "ô ngày và số đọc lại đúng", days2[1]);
    const total = back.find((s) => s.sheet === "Tổng hợp").data.find((r) => r[0] === "Cả kỳ đang xem");
    ok(total[1] === 1050000 && Math.abs(total[6] - 1 / 3) < 1e-9, "tổng và tỉ lệ đọc lại là số", total);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} ok, ${failed} lỗi`);
if (failed > 0) process.exit(1);
