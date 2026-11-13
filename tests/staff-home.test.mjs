// Kiểm thử màn hình làm việc đầu tiên sau đăng nhập / bấm logo (src/lib/staff/home.ts).
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
const all = [LEADS, NHAP_LIEU, TONG_QUAN, "/marketing/phan-tich"];
let got;

console.log("Theo vị trí (vai trò đi kèm vị trí), được xem đủ trang");
got = homeFor("lead_ads", "marketing_manager", all);
ok(got === NHAP_LIEU, "Lead Ads → Nhập liệu", got);
got = homeFor("ads_staff", "ads_staff", all);
ok(got === NHAP_LIEU, "Nhân viên quảng cáo → Nhập liệu", got);
got = homeFor("coo", "admin", all);
ok(got === TONG_QUAN, "COO → Tổng quan", got);
got = homeFor("page", "page", all);
ok(got === LEADS, "Trực page → Leads như cũ", got);
got = homeFor("lead_telesale", "lead", all);
ok(got === LEADS, "Trưởng Telesale → Leads như cũ", got);
got = homeFor("telesale", "sale", all);
ok(got === LEADS, "Telesale → Leads như cũ", got);

console.log("Admin");
got = homeFor(null, "super_admin", null);
ok(got === TONG_QUAN, "tài khoản admin (Quản trị cấp cao, chưa có vị trí) → Tổng quan", got);
got = homeFor(null, "admin", all);
ok(got === TONG_QUAN, "Quản trị chưa có vị trí → Tổng quan", got);
got = homeFor("coo", "super_admin", null);
ok(got === TONG_QUAN, "Quản trị cấp cao có vị trí COO → Tổng quan", got);

console.log("Tài khoản cũ chưa có vị trí: theo vai trò");
got = homeFor(null, "ads_staff", all);
ok(got === LEADS, "Nhân viên Ads cũ chưa có vị trí → Leads như cũ", got);
got = homeFor(null, "sale", all);
ok(got === LEADS, "Telesale cũ → Leads", got);

console.log("Không được xem trang đã chọn");
got = homeFor("ads_staff", "ads_staff", [LEADS, TONG_QUAN]);
ok(got === LEADS, "Nhân viên quảng cáo chưa được tick Nhập liệu → Leads", got);
got = homeFor("coo", "admin", ["/marketing/phan-tich", NHAP_LIEU]);
ok(got === "/marketing/phan-tich", "COO không được xem Tổng quan lẫn Leads → trang đầu tiên trên menu", got);
got = homeFor(null, "admin", [LEADS]);
ok(got === LEADS, "Quản trị chỉ được tick Leads → Leads", got);
got = homeFor("page", "page", ["/marketing/phan-tich"]);
ok(got === "/marketing/phan-tich", "Trực page không được xem Leads → trang đầu tiên trên menu", got);
got = homeFor("lead_ads", "marketing_manager", []);
ok(got === DEFAULT_HOME, "chưa được tick trang nào → Leads (trang đó tự báo chưa có quyền)", got);

console.log("Kế toán: chưa có trang riêng, mở trang đầu tiên được tick");
got = homeFor("chief_accountant", "chief_accountant", ["/thu-chi/phieu-thu-chi", "/thu-chi/so-quy"]);
ok(got === "/thu-chi/phieu-thu-chi", "Kế toán trưởng được tick Thu chi → trang đầu tiên được tick", got);
got = homeFor("accountant", "accountant", ["/thu-ngan/thu-tien"]);
ok(got === "/thu-ngan/thu-tien", "Kế toán viên được tick Thu ngân → trang đó", got);

console.log(`\n${passed} ok, ${failed} lỗi`);
if (failed) process.exit(1);
