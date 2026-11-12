// Kiểm thử danh sách người để chọn ở "Nhập thay cho" và "Thêm TKQC" (src/lib/catalog/ads-runners.ts).
// Chạy:  npm run test:ui
import { adsRunners } from "../src/lib/catalog/ads-runners.ts";

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

const account = (user_id, role, deleted_at = null) => ({ user_id, role, deleted_at });
const person = (id, full_name, user_id, extra = {}) => ({
  id, full_name, staff_code: null, user_id, is_active: true, note: null, deleted_at: null, ...extra,
});

const staff = [
  account("u-owner", "super_admin"),
  account("u-coo", "admin"),
  account("u-lead", "marketing_manager"),
  account("u-hoa", "ads_staff"),
  account("u-be", "ads_staff"),
  account("u-cu", "ads_staff", "2026-11-01T00:00:00Z"),
  account("u-page", "page"),
  account("u-sale", "sale"),
];
const adsStaff = [
  person("a-an", "An", null),                       // tên mẫu, chưa có tài khoản
  person("a-duong", "Dương", null),
  person("a-hoa", "Nguyễn Quỳnh Hoa", "u-hoa"),
  person("a-be", "Nguyễn Văn BÊ", "u-be", { is_active: false }),
  person("a-lead", "Lead Ads", "u-lead"),
  person("a-cu", "Người đã xoá", "u-cu"),           // tài khoản đã xoá khỏi danh sách nhân sự
  person("a-page", "Trực page cũ", "u-page"),       // từng là nhân viên Ads, nay vị trí khác
  person("a-la", "Tài khoản lạ", "u-khong-co"),     // gắn với tài khoản không còn trong danh sách
  person("a-rac", "Trong thùng rác", "u-hoa", { deleted_at: "2026-11-02T00:00:00Z" }),
];

console.log("\n== Người để chọn ở Nhập thay cho / Thêm TKQC");
const names = adsRunners(adsStaff, staff).map((p) => p.full_name);
ok(JSON.stringify(names) === JSON.stringify(["Nguyễn Quỳnh Hoa", "Nguyễn Văn BÊ", "Lead Ads"]),
  "chỉ người có tài khoản ở vị trí Nhân viên quảng cáo hoặc Lead Ads, giữ nguyên thứ tự", names);
ok(!names.includes("An") && !names.includes("Dương"), "tên chưa có tài khoản không hiện");
ok(!names.includes("Người đã xoá"), "tài khoản đã xoá khỏi danh sách nhân sự không hiện");
ok(!names.includes("Trực page cũ"), "người đã chuyển sang vị trí khác không hiện");
ok(!names.includes("Tài khoản lạ") && !names.includes("Trong thùng rác"), "dòng gắn tài khoản không tồn tại / dòng trong thùng rác không hiện");
ok(names.includes("Nguyễn Văn BÊ"), "người đang nghỉ vẫn trả về (màn hình tự ghi “đã nghỉ” hoặc lọc tiếp)");
ok(adsRunners(adsStaff, []).length === 0 && adsRunners([], staff).length === 0, "không có tài khoản / không có nhân viên Ads → danh sách rỗng");

console.log(`\n${passed} đạt, ${failed} lỗi`);
if (failed > 0) process.exit(1);
