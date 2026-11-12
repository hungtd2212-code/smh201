// Kiểm thử màn hình làm việc đầu tiên theo vị trí (src/lib/staff/home.ts).
// Chạy:  npm run test:ui
import { DEFAULT_HOME, homeFor } from "../src/lib/staff/home.ts";

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

const NHAP_LIEU = "/marketing/nhap-lieu";
const TONG_QUAN = "/marketing/tong-quan";
const LEADS = "/telesale/leads";

console.log("Theo vị trí, được xem đủ trang");
const all = [LEADS, NHAP_LIEU, TONG_QUAN, "/marketing/phan-tich"];
let got = homeFor("lead_ads", all);
ok(got === NHAP_LIEU, "Lead Ads → Nhập liệu", got);
got = homeFor("ads_staff", all);
ok(got === NHAP_LIEU, "Nhân viên quảng cáo → Nhập liệu", got);
got = homeFor("coo", all);
ok(got === TONG_QUAN, "COO → Tổng quan", got);
for (const position of ["page", "lead_telesale", "telesale", null]) {
  got = homeFor(position, all);
  ok(got === LEADS, `${position ?? "chưa có vị trí"} → Leads như cũ`, got);
}

console.log("Quản trị cấp cao (không giới hạn trang)");
got = homeFor(null, null);
ok(got === DEFAULT_HOME, "chưa có vị trí → Leads", got);
got = homeFor("coo", null);
ok(got === TONG_QUAN, "có vị trí COO → Tổng quan", got);

console.log("Không được xem trang theo vị trí");
got = homeFor("ads_staff", [LEADS, TONG_QUAN]);
ok(got === LEADS, "Nhân viên quảng cáo chưa được tick Nhập liệu → Leads", got);
got = homeFor("coo", ["/marketing/phan-tich", NHAP_LIEU]);
ok(got === "/marketing/phan-tich", "không được xem Tổng quan lẫn Leads → trang đầu tiên trên menu", got);
got = homeFor("page", ["/marketing/phan-tich"]);
ok(got === "/marketing/phan-tich", "Trực page không được xem Leads → trang đầu tiên trên menu", got);
got = homeFor("lead_ads", []);
ok(got === DEFAULT_HOME, "chưa được tick trang nào → Leads (trang đó tự báo chưa có quyền)", got);

console.log(`\n${passed} ok, ${failed} lỗi`);
if (failed) process.exit(1);
