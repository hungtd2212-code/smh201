// Kiểm thử phần tính toán của thử nghiệm "Ads tự động" (src/lib/ads-auto/compare.ts): so số Facebook với số
// nhân viên nhập tay.
// Chạy:  npm run test:ui
import {
  accountHealth,
  accountWarnings,
  cleanToken,
  compareRow,
  countVerdict,
  defaultRange,
  hasPancake,
  isHiddenIdle,
  needsLook,
  spendVerdict,
  summarize,
} from "../src/lib/ads-auto/compare.ts";

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

console.log("\n== So chi tiêu");
ok(spendVerdict(500000, 500000) === "match", "bằng nhau → khớp");
ok(spendVerdict(500000, 500900) === "match", "lệch 900đ → khớp");
ok(spendVerdict(10_000_000, 10_045_000) === "match", "lệch 0,45% → khớp");
ok(spendVerdict(800000, 812345) === "near", "lệch 1,5% → lệch nhẹ");
ok(spendVerdict(800000, 900000) === "off", "lệch 12% → lệch");
ok(spendVerdict(0, 0) === "match", "cả hai 0 → khớp");
ok(spendVerdict(0, 50000) === "off", "nhập 0 nhưng FB tiêu 50k → lệch");

console.log("\n== So tin nhắn");
ok(countVerdict(10, 10) === "match", "bằng nhau → khớp");
ok(countVerdict(10, 11) === "near", "lệch 1 → lệch nhẹ");
ok(countVerdict(100, 104) === "near", "lệch 4% → lệch nhẹ");
ok(countVerdict(10, 13) === "off", "lệch 3 trên 13 → lệch");
ok(countVerdict(0, 1) === "near", "0 với 1 → lệch nhẹ");

const base = {
  report_date: "2026-11-11", ad_account_id: "a1", ads_staff_id: "s1",
  manual_spend: 500000, manual_messages: 10, manual_at: "2026-11-11T15:00:00Z",
  auto_spend: 500000, auto_currency: "VND", auto_conversations: 10, auto_new_contacts: 8, auto_connections: 11,
  auto_fetched_at: "2026-11-12T01:00:00Z",
  pancake_messages: 9, pancake_phones: 4,
};

console.log("\n== So một dòng");
let r = compareRow(base, "conversations", true);
ok(r.status === "match" && r.spend_diff === 0 && r.messages_diff === 0 && r.fb_messages === 10, "khớp", r);
r = compareRow(base, "new_contacts", true);
ok(r.status === "off" && r.fb_messages === 8 && r.messages_diff === -2, "đổi loại tin nhắn → so với người liên hệ mới", r);
r = compareRow(base, "connections", true);
ok(r.status === "near" && r.fb_messages === 11, "so với lượt kết nối", r);
r = compareRow({ ...base, manual_spend: 800000, auto_spend: 812345 }, "conversations", true);
ok(r.status === "near" && r.spend_diff === 12345 && r.spend_verdict === "near", "chi tiêu lệch nhẹ", r);
r = compareRow({ ...base, auto_spend: 512345, auto_conversations: 30 }, "conversations", true);
ok(r.status === "off" && r.spend_verdict === "near" && r.messages_verdict === "off", "lấy kết quả xấu hơn của hai phần", r);
r = compareRow({ ...base, manual_spend: null, manual_messages: null, manual_at: null }, "conversations", true);
ok(r.status === "no_manual" && r.spend_diff === null, "FB có tiêu, NV chưa nhập", r);
r = compareRow({ ...base, manual_spend: null, manual_messages: null, auto_spend: 0, auto_conversations: 0 }, "conversations", true);
ok(r.status === "idle", "FB 0đ, NV không nhập → không chạy", r);
r = compareRow({ ...base, auto_spend: null, auto_currency: null, auto_conversations: null, auto_new_contacts: null, auto_connections: null, auto_fetched_at: null }, "conversations", true);
ok(r.status === "no_auto" && r.fb_messages === null, "NV có nhập, chưa có số FB", r);
r = compareRow({ ...base, auto_spend: null, auto_conversations: null }, "conversations", false);
ok(r.status === "not_facebook", "TKQC TikTok → không phải FB", r);
r = compareRow({ ...base, auto_spend: 20.5, auto_currency: "USD" }, "conversations", true);
ok(r.status === "other_currency" && r.spend_diff === null && r.messages_diff === 0, "TKQC tính USD → không so chi tiêu", r);

console.log("\n== Tổng hợp");
const rows = [
  compareRow(base, "conversations", true),
  compareRow({ ...base, ad_account_id: "a2", auto_spend: 900000, auto_conversations: 12 }, "conversations", true),
  compareRow({ ...base, ad_account_id: "a3", manual_spend: null, manual_messages: null }, "conversations", true),
  compareRow({ ...base, ad_account_id: "a4", auto_spend: null }, "conversations", false),
];
const s = summarize(rows);
ok(s.counts.match === 1 && s.counts.off === 1 && s.counts.no_manual === 1 && s.counts.not_facebook === 1 && s.counts.idle === 0, "đếm theo kết quả", s.counts);
ok(s.compared === 2 && s.manualSpend === 1_000_000 && s.fbSpend === 1_400_000 && s.manualMessages === 20 && s.fbMessages === 22, "tổng chỉ tính dòng có cả hai bên", s);
ok(s.pancakeMessages === 36 && s.pancakePhones === 16, "cộng số Pancake mọi dòng", s);
ok(needsLook("off") && needsLook("near") && needsLook("no_manual") && needsLook("no_auto") && !needsLook("match") && !needsLook("idle") && !needsLook("not_facebook"), "dòng cần xem lại");

console.log("\n== Pancake");
const idle = compareRow({ ...base, manual_spend: null, manual_messages: null, auto_spend: 0, auto_conversations: 0, pancake_messages: 0, pancake_phones: 0 }, "conversations", true);
ok(idle.status === "idle" && isHiddenIdle(idle), "không chạy, Pancake 0 khách → ẩn");
const late = compareRow({ ...base, manual_spend: null, manual_messages: null, auto_spend: 0, auto_conversations: 0, pancake_messages: 0, pancake_phones: 1 }, "conversations", true);
ok(late.status === "idle" && !isHiddenIdle(late) && hasPancake(late), "không chạy nhưng Pancake có khách để lại số → vẫn hiện");
ok(!hasPancake({ ...base, pancake_messages: null, pancake_phones: null }), "chưa có số Pancake");
ok(compareRow({ ...base, pancake_messages: 50 }, "conversations", true).status === "match", "số Pancake không tính vào kết quả khớp / lệch");

console.log("\n== TKQC");
const acc = {
  ad_account_id: "a1", name: "Dương 01", account_id: "act_111", fb_account_id: "111", is_active: true, is_facebook: true,
  fb_name: null, currency: null, timezone: null, fb_status: null, checked_at: null, last_ok_at: null,
  last_error: null, last_error_at: null, first_day: null, last_day: null,
};
ok(accountHealth({ ...acc, is_facebook: false }, true).text.startsWith("Không phải TKQC Facebook"), "không phải FB");
ok(accountHealth({ ...acc, account_id: null, fb_account_id: null }, true).text.startsWith("Chưa điền ID"), "chưa có ID");
ok(/không đúng dạng/.test(accountHealth({ ...acc, account_id: "abc", fb_account_id: null }, true).text), "ID lạ");
ok(accountHealth({ ...acc, is_active: false }, true).text.includes("ngừng dùng"), "ngừng dùng");
ok(accountHealth(acc, false).text === "Chờ dán token", "chưa có token");
ok(accountHealth({ ...acc, last_error: "Token hết hạn" }, true).tone === "bad", "lỗi → đỏ");
ok(accountHealth({ ...acc, last_ok_at: "2026-11-13T01:00:00Z" }, true).tone === "good", "kéo được → xanh");
ok(accountWarnings({ ...acc, currency: "VND", timezone: "Asia/Ho_Chi_Minh", fb_status: 1 }).length === 0, "VND, giờ VN, đang hoạt động → không lưu ý");
ok(accountWarnings({ ...acc, currency: "VND", timezone: "Asia/Bangkok", fb_status: 1 }).length === 0, "múi giờ Bangkok cũng là UTC+7");
const w = accountWarnings({ ...acc, currency: "USD", timezone: "America/Los_Angeles", fb_status: 2 });
ok(w.length === 3 && /USD/.test(w[0]) && /America\/Los_Angeles/.test(w[1]) && /vô hiệu hoá/.test(w[2]), "lưu ý tiền tệ, múi giờ, bị vô hiệu hoá", w);

console.log("\n== Khác");
const d = defaultRange("2026-11-13");
ok(d.from === "2026-11-06" && d.to === "2026-11-12", "mặc định 7 ngày tới hôm qua", d);
ok(defaultRange("2026-03-01", 30).from === "2026-01-30", "qua tháng / năm đúng");
const good = "EAAG" + "aBcD1234".repeat(10);
ok(cleanToken(`  ${good}\n`).ok && cleanToken(`  ${good}\n`).token === good, "token đúng (bỏ khoảng trắng 2 đầu)");
ok(!cleanToken("EAA short").ok && !cleanToken(`EBB${good.slice(3)}`).ok && !cleanToken(`${good} x`).ok && !cleanToken("").ok, "token sai dạng");

console.log(`\n${passed} đạt, ${failed} lỗi`);
process.exit(failed ? 1 : 0);
