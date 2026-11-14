// Kiểm thử phần tính toán của bảng Lead mới (src/lib/leads/crm.ts).
// Chạy:  npm run test:ui
import {
  duplicateCount,
  filterLeads,
  hasRole,
  matchesQuery,
  missingForStatus,
  money,
  moveStatus,
  SEES_ALL_ROLES,
  selectableStatuses,
  STAFF_HUES,
  staffHue,
  staffHues,
  TRANSFER_ROLES,
  vnDateTime,
} from "../src/lib/leads/crm.ts";

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

console.log("\n== Đổi thứ tự trạng thái (nút ↑ ↓)");
ok(same(moveStatus(["a", "b", "c"], "b", -1), ["b", "a", "c"]), "đưa lên");
ok(same(moveStatus(["a", "b", "c"], "b", 1), ["a", "c", "b"]), "đưa xuống");
ok(same(moveStatus(["a", "b", "c"], "a", -1), ["a", "b", "c"]) && same(moveStatus(["a", "b", "c"], "c", 1), ["a", "b", "c"]), "đã ở đầu / cuối thì giữ nguyên");
ok(same(moveStatus(["a"], "x", 1), ["a"]), "id lạ thì giữ nguyên");

console.log("\n== Trạng thái để chọn");
const st = (id, name, sort_order, is_active = true, extra = {}) => ({ id, name, sort_order, is_active, color: "#000000", text_color: "#ffffff", needs_appointment: false, needs_deal: false, ...extra });
const statuses = [st("c", "Chốt", 5), st("k", "KNM", 3), st("h", "Ẩn", 4, false), st("d", "Đặt lịch hẹn", 4, true, { needs_appointment: true })];
ok(same(selectableStatuses(statuses, null).map((s) => s.id), ["k", "d", "c"]), "bỏ trạng thái đã ẩn, xếp theo thứ tự");
ok(same(selectableStatuses(statuses, "h").map((s) => s.id), ["k", "h", "d", "c"]), "trạng thái hiện tại vẫn hiện dù đã ẩn");

console.log("\n== Trạng thái cần nhập thêm");
const chot = st("c", "Chốt", 5, true, { needs_deal: true });
ok(same(missingForStatus(statuses[3], { appointment_at: null, deal_amount: null }), ["Lịch hẹn"]), "Đặt lịch hẹn mà chưa có lịch hẹn");
ok(missingForStatus(statuses[3], { appointment_at: "2026-11-14T02:00:00Z", deal_amount: null }).length === 0, "đã có lịch hẹn → đủ");
ok(same(missingForStatus(chot, { appointment_at: null, deal_amount: 0 }), ["Doanh số"]), "Chốt mà doanh số 0");
ok(missingForStatus(undefined, { appointment_at: null, deal_amount: null }).length === 0, "chưa chọn trạng thái → không thiếu gì");

console.log("\n== Tìm và lọc");
const lead = (id, extra = {}) => ({
  id, full_name: "Khách", phone: "0912000001", note: null, consult_info: null, area: null,
  status_id: null, assignee_id: null, recontacted_at: null, touch_count: 1, ...extra,
});
const leads = [
  lead("1", { full_name: "Nguyễn Thị Lan", phone: "0912345678", status_id: "k", assignee_id: "s1" }),
  lead("2", { full_name: "Trần Hoà", consult_info: "Muốn niềng răng trong suốt", assignee_id: "s2", recontacted_at: "x", touch_count: 3 }),
  lead("3", { full_name: "Lê Minh", area: "Đống Đa" }),
];
ok(matchesQuery(leads[0], "lan") && matchesQuery(leads[0], "nguyen thi"), "tìm tên không dấu");
ok(matchesQuery(leads[0], "0912 345") && matchesQuery(leads[0], "+84912345678"), "tìm số có dấu cách / +84");
ok(matchesQuery(leads[1], "nieng rang") && matchesQuery(leads[2], "dong da"), "tìm trong khai thác thông tin, khu vực");
ok(!matchesQuery(leads[2], "lan"), "không khớp thì loại");
const base = { query: "", status: "all", sale: "all", recontacted: false };
ok(same(filterLeads(leads, { ...base, status: "none" }).map((l) => l.id), ["2", "3"]), "lọc Chưa xử lý");
ok(same(filterLeads(leads, { ...base, status: "k" }).map((l) => l.id), ["1"]), "lọc theo tình trạng");
ok(same(filterLeads(leads, { ...base, sale: "unassigned" }).map((l) => l.id), ["3"]), "lọc Chưa chia");
ok(same(filterLeads(leads, { ...base, sale: "s2" }).map((l) => l.id), ["2"]), "lọc theo sale");
ok(same(filterLeads(leads, { ...base, recontacted: true }).map((l) => l.id), ["2"]), "lọc khách nhắn lại");
ok(duplicateCount(leads[1]) === 2 && duplicateCount(leads[0]) === 0, "số lần trùng = số lần thêm − 1");

console.log("\n== Quyền theo vai trò");
ok(["super_admin", "admin", "lead", "page"].every((r) => hasRole(TRANSFER_ROLES, r)) && !hasRole(TRANSFER_ROLES, "sale") && !hasRole(TRANSFER_ROLES, "marketing_manager"), "đổi sale: Admin, COO, Trưởng Telesale, Trực page");
ok(hasRole(SEES_ALL_ROLES, "page") && !hasRole(SEES_ALL_ROLES, "sale") && !hasRole(SEES_ALL_ROLES, null), "Telesale không thấy tất cả");

console.log("\n== Định dạng");
ok(money(45000000) === "45.000.000" && money(null) === "", "tiền có dấu chấm hàng nghìn");
const t = vnDateTime("2026-11-12T17:30:00Z");
ok(t.day === "13/11/2026" && t.time === "00:30" && t.short === "13/11 00:30", "giờ Việt Nam", t);
ok(vnDateTime(null) === null && vnDateTime("hỏng") === null, "trống / hỏng → null");

console.log("\n== Màu khung tên nhân viên Ads");
{
  const ids = ["b2c1", "a9f0", "77d3", "e4aa", "0c5b", "f1f1", "9e02", "5d6c"];
  const hues = staffHues(ids);
  ok(hues.size === 8 && new Set(hues.values()).size === 8, "8 người → 8 màu khác nhau", [...hues]);
  ok([...hues.values()].every((h) => STAFF_HUES.includes(h)), "màu lấy trong bảng màu");
  const more = staffHues([...ids, "3b3b", "c0de"]);
  ok(ids.every((id) => more.get(id) === hues.get(id)), "thêm người mới (cuối danh sách): người cũ giữ nguyên màu", [...more]);
  ok(new Set(more.values()).size === 10, "người mới nhận màu chưa ai dùng");
  ok(same([...staffHues([...ids, ids[0]])], [...hues]), "id lặp lại chỉ tính một lần");
  const many = staffHues(Array.from({ length: 15 }, (_, i) => `id${i}`));
  ok(many.size === 15 && new Set(many.values()).size === 12, "đông hơn 12 người: dùng đủ 12 màu rồi mới lặp lại");
  ok(staffHue(hues, "a9f0") === hues.get("a9f0") && STAFF_HUES.includes(staffHue(hues, "đã-xoá")), "người không có trong danh sách vẫn có màu");
}

console.log(`\n${passed} ok, ${failed} lỗi`);
if (failed > 0) process.exit(1);
