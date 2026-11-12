// Kiểm thử phần đọc file Excel "Nhập từ Excel" (src/lib/ad-reports/import.ts). Không gọi máy chủ.
// Chạy:  npm run test:ui
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readExcelFile from "read-excel-file/node";
import writeExcelFile from "write-excel-file/node";
import {
  columnName, columnRole, dayRanges, fold, nameKey, parseWorkbook, planImport, safeSheetName, templateSheets,
  templateTabs, toDay, toMonth, toNumber,
} from "../src/lib/ad-reports/import.ts";

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

console.log("\n== Đọc chữ, số, ngày");
ok(fold("  Tổng  Mess: ") === "tong mess", "bỏ dấu, gộp khoảng trắng, bỏ dấu hai chấm");
ok(fold("Đặt lịch") === "dat lich", "đ → d");
ok(nameKey("Hưng") !== nameKey("Hùng") && nameKey(" THE  Duong 01 ") === nameKey("the duong 01"), "tên giữ dấu, không phân biệt hoa thường");
ok(toNumber(1526706) === 1526706 && toNumber("1.526.706") === 1526706 && toNumber("1,526,706") === 1526706, "số thường, dấu chấm, dấu phẩy ngăn nghìn");
ok(toNumber("1.526.706 đ") === 1526706 && toNumber(" 45 117 ") === 45117, "bỏ chữ đ và khoảng trắng");
ok(toNumber(null) === null && toNumber("") === null && toNumber("-") === null, "trống / gạch ngang = không nhập");
ok(toNumber("#DIV/0!") === "bad" && toNumber("12,5") === "bad" && toNumber("abc") === "bad" && toNumber(true) === "bad", "chữ / lỗi công thức / số lẻ kiểu phẩy → không đọc được");
ok(toNumber("-5") === -5 && toNumber(-5) === -5, "số âm trả nguyên để báo lỗi");
ok(toDay("1/10/2026") === "2026-10-01" && toDay("01/10/2026") === "2026-10-01" && toDay("2026-10-01") === "2026-10-01", "ngày dạng chữ");
ok(toDay(new Date(Date.UTC(2026, 9, 5))) === "2026-10-05", "ô ngày của Excel");
ok(toDay(46296) === "2026-10-01", "số ngày kiểu Excel", toDay(46296));
ok(toDay("31/02/2026") === "bad" && toDay("Tổng") === "bad" && toDay(15) === "bad", "ngày sai → không đọc được");
ok(toDay(null) === null && toDay("  ") === null, "ô ngày trống");
ok(toMonth("10/2026") === "2026-10" && toMonth("T10/2026") === "2026-10" && toMonth("Tháng 9/2026") === "2026-09", "tháng dạng chữ");
ok(toMonth(new Date(Date.UTC(2026, 9, 1))) === "2026-10" && toMonth("13/2026") === "bad", "tháng từ ô ngày, tháng 13 sai");
ok(columnName(0) === "A" && columnName(25) === "Z" && columnName(26) === "AA", "tên cột Excel");
ok(dayRanges(["2026-10-03", "2026-10-01", "2026-10-02", "2026-10-05"]) === "01/10/2026 – 03/10/2026, 05/10/2026", "gộp ngày liền nhau", dayRanges(["2026-10-03", "2026-10-01", "2026-10-02", "2026-10-05"]));
ok(safeSheetName("Dương [T10]/2026: rất rất rất rất dài tên") .length <= 31 && !/[[\]:/]/.test(safeSheetName("a[b]:c/d")), "tên tab hợp lệ cho Excel");

console.log("\n== Vai trò cột");
ok(columnRole("Ngày") === "day", "Ngày");
ok(["Mess", "Tổng mess", "Số lượng tin nhắn"].every((h) => columnRole(h) === "messages"), "các kiểu cột mess");
ok(["Data", "Data xin được"].every((h) => columnRole(h) === "data"), "các kiểu cột data");
ok(["Doanh thu", "Doanh Thu "].every((h) => columnRole(h) === "revenue"), "cột doanh thu");
ok(["Chi tiêu ads", "Tổng chi tiêu ngày", "Giá Mess", "Giá Data", "Tỉ Lệ Xin Số", "Doanh Số ", "Ads/Doanh số ", "Ghi chú", "Thứ", "", null]
  .every((h) => columnRole(h) === "ignore"), "cột tính sẵn / trống → bỏ qua");
ok(columnRole("THE DUONG 01") === "account" && columnRole("Data 01") === "account", "còn lại là tên TKQC");

// ---------------------------------------------------------------------------
const TODAY = "2026-11-13";
const staff = [
  { id: "duong", full_name: "Dương Ads", is_active: true, deleted_at: null },
  { id: "an", full_name: "An Ads", is_active: true, deleted_at: null },
  { id: "hung", full_name: "Hùng Ads", is_active: false, deleted_at: null },
  { id: "old", full_name: "Người đã xoá", is_active: false, deleted_at: "2026-11-01T00:00:00Z" },
];
const account = (id, name, created_at) => ({ id, name, created_at, deleted_at: null, is_active: true });
const accounts = [
  account("D1", "THE DUONG 01", "2026-11-01T01:00:00Z"),
  account("D2", "Dương 01", "2026-11-01T02:00:00Z"),
  account("A1", "An 01", "2026-11-01T03:00:00Z"),
  { ...account("X", "TKQC đã xoá", "2026-11-01T04:00:00Z"), deleted_at: "2026-11-02T00:00:00Z" },
];
const assignments = [
  { ad_account_id: "D1", ads_staff_id: "duong", from_date: "2026-09-01", to_date: null, deleted_at: null },
  { ad_account_id: "D2", ads_staff_id: "duong", from_date: "2026-10-01", to_date: "2026-10-31", deleted_at: null },
  { ad_account_id: "A1", ads_staff_id: "an", from_date: "2026-10-01", to_date: null, deleted_at: null },
  // Phân công đã xoá không tính.
  { ad_account_id: "A1", ads_staff_id: "duong", from_date: "2026-01-01", to_date: "2026-09-30", deleted_at: "2026-11-01T00:00:00Z" },
];
const catalog = { staff, accounts, assignments, today: TODAY };

console.log("\n== Đọc file đúng mẫu");
const duongTab = {
  sheet: "Dương T10",
  data: [
    ["Nhân viên Ads:", "Dương Ads"],
    ["Tháng:", "10/2026"],
    [],
    ["Ngày", "THE DUONG 01", "Dương 01", "Tổng chi tiêu ngày", "Mess", "Giá mess", "Data", "Doanh thu"],
    ["Tổng tháng", 999, 999, 999, 999, null, 999, 999],
    ["01/10/2026", 351547, "105.422", 456969, 3, 152323, 1, null],
    ["02/10/2026", "425.761", 45117, 470878, null, null, null, null],
    [new Date(Date.UTC(2026, 9, 3)), 540297, null, 540297, 2, null, null, "20.150.000"],
    ["04/10/2026", null, null, null, null, null, null, null], // ngày trống số → bỏ qua
    ["05/10/2026", 100, 200, null, 0, null, 0, 0],
  ],
};
const anTab = {
  sheet: "An Ads",
  data: [
    ["Ngày", "An 01", "Mess", "Data"],
    ["01/10/2026", 833941, 7, 2],
  ],
};
const monthTab = {
  sheet: "Doanh thu tháng",
  data: [
    ["Tháng", "Nhân viên Ads", "Doanh thu"],
    ["10/2026", "Dương Ads", "29.650.000"],
    ["10/2026", "An Ads", null], // trống = dùng doanh thu theo ngày
    ["10/2026", "Chưa rõ nhân viên", 5000000],
    ["T9/2026", "An Ads", 0], // 0 = dùng doanh thu theo ngày
  ],
};
const guide = { sheet: "Hướng dẫn", data: [["Mỗi tab một nhân viên"], ["Ngày", "abc"]] };
const weekly = { sheet: "BÁO CÁO TUẦN.", data: [["Tuần", "Chi tiêu"], ["1", 5]] };
const parsed = parseWorkbook([guide, duongTab, anTab, monthTab, weekly], catalog);
ok(parsed.issues.length === 0, "file đúng mẫu → không lỗi", parsed.issues);
ok(parsed.people.length === 2, "hai nhân viên", parsed.people.map((p) => p.staff.full_name));
const duong = parsed.people.find((p) => p.staff.id === "duong");
ok(same(duong.days.map((d) => d.day), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05"]), "bỏ dòng tổng và ngày trống số", duong.days.map((d) => d.day));
ok(same(duong.days[0].spends, [{ accountId: "D1", spend: 351547 }, { accountId: "D2", spend: 105422 }]), "chi tiêu từng TKQC (số dạng chữ có dấu chấm)", duong.days[0].spends);
ok(duong.days[0].messages === 3 && duong.days[0].data === 1 && duong.days[0].revenue === null, "mess / data / doanh thu trống");
ok(duong.days[1].messages === 0 && duong.days[1].data === 0, "mess, data trống = 0");
ok(duong.days[2].revenue === 20150000, "doanh thu theo ngày");
ok(duong.days[3].revenue === 0 && duong.days[3].data === 0, "ghi 0 rõ ràng vẫn là 0");
ok(same(parsed.dayRange, { from: "2026-10-01", to: "2026-10-05" }), "khoảng ngày trong file");
ok(parsed.months.length === 2 && parsed.months.some((m) => m.staffId === null && m.amount === 5000000), "doanh thu tháng: bỏ dòng trống / 0, nhận dòng chưa rõ nhân viên", parsed.months);
ok(same(parsed.monthRange, { from: "2026-10", to: "2026-10" }), "khoảng tháng trong file");
ok(parsed.notes.some((n) => n.includes("BÁO CÁO TUẦN.")) && !parsed.notes.some((n) => n.includes("Hướng dẫn")), "tab lạ được ghi chú bỏ qua, tab Hướng dẫn bỏ qua im lặng", parsed.notes);
ok(parsed.notes.some((n) => n.includes('"An Ads"') && n.includes("Doanh thu")) === false, "tab thiếu cột Doanh thu không cần ghi chú");

console.log("\n== Lỗi trong file");
const bad = parseWorkbook([
  {
    sheet: "Dương",
    data: [
      ["Nhân viên Ads:", "Dương Ads"],
      ["Ngày", "THE DUONG 01", "TKQC lạ", "An 01", "Mess", "Data"],
      ["01/09/2026", 100, null, null, 1, 1], // D1 có phụ trách từ 01/09
      ["02/09/2026", 100, 50, null, 1, 1], // TKQC lạ
      ["03/09/2026", 100, null, 70, 1, 1], // An 01 do An phụ trách (từ 01/10) → 03/09 chưa ai phụ trách
      ["03/10/2026", 100, null, 70, 1, 1], // An 01 ngày 03/10 do An phụ trách
      ["01/12/2026", 100, null, null, 1, 1], // chưa tới
      ["01/09/2026", 100, null, null, 1, 1], // trùng ngày
      ["", 5, null, null, null, null], // thiếu ngày
      ["32/10/2026", 5, null, null, null, null], // ngày sai
      ["05/10/2026", "#DIV/0!", null, null, 1, 1], // không phải số
      ["06/10/2026", -5, null, null, 1, 1], // số âm
      ["07/10/2026", 100, null, null, 1.5, 1], // mess số lẻ
      ["08/10/2026", null, null, null, 4, 1], // mess nhưng không chi tiêu
    ],
  },
  { sheet: "Trung", data: [["Ngày", "THE DUONG 01"], ["01/10/2026", 5]] }, // không có nhân viên tên Trung
  { sheet: "Người đã xoá", data: [["Ngày", "Mess"], ["01/10/2026", 5]] }, // nhân viên đã xoá
  { sheet: "Dương (2)", data: [["Nhân viên Ads:", "dương ads"], ["Ngày", "Data"], ["01/09/2026", 9]] }, // trùng ngày ở tab khác
  {
    sheet: "Doanh thu tháng",
    data: [
      ["Tháng", "Nhân viên Ads", "Doanh thu"],
      ["12/2026", "An Ads", 5], // chưa tới
      ["abc", "An Ads", 5], // tháng sai
      ["10/2026", "Không ai", 5], // không có người này
      ["10/2026", "An Ads", "5,5"], // không phải số
      ["10/2026", "An Ads", 7],
      ["10/2026", "an ads", 8], // trùng
    ],
  },
], catalog);
const has = (text) => bad.issues.some((i) => i.message.includes(text));
const show = bad.issues.map((i) => `${i.sheet}:${i.row} ${i.message}`);
ok(has('"TKQC lạ"') && has("(1 ô có số)"), "TKQC không có trong phần mềm → báo theo cột", show);
ok(has('TKQC "An 01" chưa có người phụ trách ngày 03/09/2026'), "TKQC chưa ai phụ trách ngày đó", show);
ok(has('TKQC "An 01" ngày 03/10/2026 do An Ads phụ trách, không phải Dương Ads'), "TKQC của người khác ngày đó", show);
ok(has("Ngày 01/12/2026 chưa tới"), "ngày chưa tới");
ok(has("Ngày 01/09/2026 của Dương Ads bị ghi hai lần"), "trùng ngày cùng tab");
ok(bad.issues.filter((i) => i.message.includes("bị ghi hai lần") && i.sheet === "Dương (2)").length === 1, "trùng ngày ở tab khác (tên viết thường vẫn nhận)", show);
ok(has("thiếu ngày") && has('Ngày "32/10/2026" không đọc được'), "thiếu ngày / ngày sai");
ok(has('không phải số: "#DIV/0!"') && has("là số âm") && has("(Mess) phải là số nguyên"), "ô số sai / âm / số lẻ");
ok(has("Ngày 08/10/2026 có mess nhưng không TKQC nào có chi tiêu"), "mess mà không có chi tiêu");
ok(has('Không có nhân viên Ads tên "Trung"') && has('Không có nhân viên Ads tên "Người đã xoá"'), "nhân viên không có / đã xoá");
ok(has("Tháng 12/2026 chưa tới") && has('Tháng "abc" không đọc được') && has('Không có nhân viên Ads tên "Không ai"') && has('Doanh thu "5,5"'), "lỗi tab doanh thu tháng", show);
ok(has("Doanh thu tháng 10/2026 của An Ads bị ghi hai lần"), "trùng doanh thu tháng");
const okDays = bad.people.find((p) => p.staff.id === "duong")?.days.map((d) => d.day) ?? [];
ok(same(okDays, ["2026-09-01"]), "chỉ giữ dòng không lỗi", okDays);

console.log("\n== Thiếu cột, sai tiêu đề");
const loose = parseWorkbook([
  { sheet: "Dương Ads", data: [["Ngày", "THE DUONG 01", "Data"], ["01/10/2026", 5, 1]] },
  { sheet: "An Ads", data: [["Họ và tên", "TKQC", "THE DUONG 01"], ["An", "1/10/2026", 5]] }, // sheet cũ, không có ô Ngày đầu dòng
], catalog);
ok(loose.issues.length === 0, "tên tab = tên nhân viên khi không có ô Nhân viên Ads", loose.issues);
ok(loose.notes.some((n) => n.includes('"Dương Ads" không có cột "Mess"')), "nhắc thiếu cột Mess", loose.notes);
ok(loose.notes.some((n) => n.includes('Bỏ qua tab "An Ads"')), "sheet cũ không đúng mẫu → bỏ qua, có ghi chú", loose.notes);

// ---------------------------------------------------------------------------
console.log("\n== Tính trước những gì sẽ thêm");
const none = { reports: new Set(), data: new Set(), revenue: new Set() };
const plan = planImport(parsed, none);
const d1 = plan.reports.filter((r) => r.report_date === "2026-10-01" && r.ad_account_id.startsWith("D"));
ok(same(d1, [
  { report_date: "2026-10-01", ad_account_id: "D1", spend: 351547, messages: 3 },
  { report_date: "2026-10-01", ad_account_id: "D2", spend: 105422, messages: 0 },
]), "mess cả ngày ghi vào TKQC chi nhiều nhất", d1);
const d2 = plan.reports.filter((r) => r.report_date === "2026-10-02");
ok(d2.find((r) => r.ad_account_id === "D1").messages === 0, "ngày không có mess → 0");
const d5 = plan.reports.filter((r) => r.report_date === "2026-10-05");
ok(d5.find((r) => r.ad_account_id === "D2").messages === 0 && d5.length === 2, "TKQC chi nhiều nhất (D2) nhận mess = 0");
// Dương: 01/10 (2 TKQC), 02/10 (2), 03/10 (1), 05/10 (2); An: 01/10 (1).
ok(plan.reports.length === 2 + 2 + 1 + 2 + 1, "số dòng chi tiêu TKQC sẽ thêm", plan.reports.length);
ok(plan.data.length === 5 && plan.data.every((r) => typeof r.data_count === "number"), "mỗi ngày có số một dòng Data", plan.data);
ok(plan.data.find((r) => r.report_date === "2026-10-03").revenue === 20150000 && plan.data.find((r) => r.report_date === "2026-10-01" && r.ads_staff_id === "duong").revenue === null, "doanh thu ngày đi theo dòng Data");
ok(same(plan.revenue.map((r) => r.month), ["2026-10-01", "2026-10-01"]), "doanh thu tháng ghi ngày đầu tháng", plan.revenue);
const sum = plan.people.find((p) => p.staffId === "duong");
ok(sum.spend === 351547 + 105422 + 425761 + 45117 + 540297 + 300 && sum.messages === 5 && sum.data === 1 && sum.revenue === 20150000, "tổng của từng người để đối chiếu với file", sum);
ok(sum.from === "2026-10-01" && sum.to === "2026-10-05" && sum.days === 4 && sum.newDays === 4, "khoảng ngày, số ngày mới", sum);

const existing = {
  reports: new Set(["2026-10-01|D1"]),
  data: new Set(["2026-10-02|duong"]),
  revenue: new Set(["2026-10|"]),
};
const again = planImport(parsed, existing);
ok(!again.reports.some((r) => r.report_date === "2026-10-01" && r.ad_account_id === "D1"), "đã có (ngày + TKQC) → không ghi đè");
ok(again.reports.find((r) => r.report_date === "2026-10-01" && r.ad_account_id === "D2").messages === 0, "TKQC còn lại không nhận thêm mess (mess đã nằm ở dòng có sẵn)");
ok(again.reports.some((r) => r.report_date === "2026-10-02") && !again.data.some((r) => r.report_date === "2026-10-02" && r.ads_staff_id === "duong"), "đã có dòng Data ngày đó → giữ nguyên, TKQC vẫn thêm");
ok(same(again.skipped, { reports: 1, data: 1, revenue: 1 }), "đếm số bỏ qua", again.skipped);
ok(again.months.find((m) => m.staffId === null).exists === true && again.revenue.length === 1, "doanh thu tháng đã có → bỏ qua");
const all = { reports: new Set(plan.reports.map((r) => `${r.report_date}|${r.ad_account_id}`)), data: new Set(plan.data.map((r) => `${r.report_date}|${r.ads_staff_id}`)), revenue: new Set(["2026-10|duong", "2026-10|"]) };
const twice = planImport(parsed, all);
ok(twice.reports.length === 0 && twice.data.length === 0 && twice.revenue.length === 0, "nhập lại cùng file lần hai → không thêm gì");
ok(twice.people.every((p) => p.newDays === 0 && p.existingDays === p.days), "lần hai: mọi ngày là 'đã có'");

console.log("\n== File mẫu");
const tabs = templateTabs("2026-10", catalog);
ok(same(tabs.map((t) => t.staff.id), ["an", "duong"]), "nhân viên đang làm (Hùng đã nghỉ, không phụ trách TKQC tháng 10)", tabs.map((t) => t.staff.id));
ok(same(tabs.find((t) => t.staff.id === "duong").accounts.map((a) => a.id), ["D1", "D2"]), "TKQC của Dương tháng 10 theo thứ tự tạo");
ok(same(templateTabs("2026-11", catalog).find((t) => t.staff.id === "duong").accounts.map((a) => a.id), ["D1"]), "tháng 11: Dương 01 đã hết phụ trách → không có cột");
ok(templateTabs("2026-09", catalog).find((t) => t.staff.id === "an").accounts.length === 0, "phân công đã xoá không tính");

console.log("\n== File mẫu: ghi ra .xlsx thật, điền số, đọc lại");
{
  const sheets = templateSheets("2026-10", catalog);
  ok(same(sheets.map((s) => s.sheet), ["Hướng dẫn", "An Ads", "Dương Ads", "Doanh thu tháng"]), "các tab của file mẫu", sheets.map((s) => s.sheet));
  const tab = sheets.find((s) => s.sheet === "Dương Ads");
  ok(same(tab.data[3].map((c) => c.value), ["Ngày", "THE DUONG 01", "Dương 01", "Mess", "Data", "Doanh thu"]), "dòng tiêu đề", tab.data[3]);
  ok(tab.data.length === 4 + 31 && tab.data[4][0].value === "01/10/2026" && tab.data[34][0].value === "31/10/2026", "đủ 31 ngày tháng 10");
  ok(templateSheets("2026-11", catalog).find((s) => s.sheet === "Dương Ads").data.length === 4 + 13, "tháng này: chỉ tới hôm nay (13/11)");
  // Người dùng điền số: Dương ngày 1 và 2, An ngày 1, doanh thu tháng của Dương.
  tab.data[4].push(351547, 105422, 3, 1, null);
  tab.data[5].push("425.761", null, 0, 0, 1500000);
  const anSheet = sheets.find((s) => s.sheet === "An Ads");
  anSheet.data[4].push(833941, 7, 2, null);
  const revenueSheet = sheets.find((s) => s.sheet === "Doanh thu tháng");
  revenueSheet.data.find((row) => row[1] === "Dương Ads")[2] = 29650000;

  const dir = mkdtempSync(join(tmpdir(), "smh-import-"));
  try {
    const path = join(dir, "mau.xlsx");
    await writeExcelFile(sheets).toFile(path);
    const read = (await readExcelFile(path)).map(({ sheet, data }) => ({ sheet, data }));
    const back = parseWorkbook(read, catalog);
    ok(back.issues.length === 0, "đọc lại file mẫu đã điền → không lỗi", back.issues);
    const dg = back.people.find((p) => p.staff.id === "duong");
    ok(same(dg?.days.map((d) => [d.day, d.spends.map((x) => x.spend), d.messages, d.data, d.revenue]), [
      ["2026-10-01", [351547, 105422], 3, 1, null],
      ["2026-10-02", [425761], 0, 0, 1500000],
    ]), "số của Dương đọc lại đúng (ngày chưa điền bị bỏ qua)", dg?.days);
    ok(back.people.find((p) => p.staff.id === "an")?.days.length === 1, "số của An đọc lại đúng");
    ok(same(back.months.map((m) => [m.month, m.staffId, m.amount]), [["2026-10", "duong", 29650000]]), "doanh thu tháng đọc lại đúng", back.months);
    ok(back.notes.length === 0, "không có tab nào bị bỏ qua", back.notes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} ok, ${failed} lỗi`);
if (failed > 0) process.exit(1);
