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
  pancakePhonesByStaff,
  spendVerdict,
  staffBlocks,
  staffDataMap,
  staffDayKey,
  summarize,
} from "../src/lib/ads-auto/compare.ts";
import { cleanBotToken, lastBatch } from "../src/lib/ads-auto/telegram-logic.ts";
import { countCustomers, countsAsData, groupPhones, verdictText } from "../src/lib/ads-auto/phones.ts";

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

console.log("\n== SĐT nhân viên báo");
const sd = staffDataMap([
  { report_date: "2026-11-12", ads_staff_id: "s1", data_count: 3 },
  { report_date: "2026-11-12", ads_staff_id: "s2", data_count: 0 },
  { report_date: "2026-11-13", ads_staff_id: "s1", data_count: "2" },
]);
ok(sd.get(staffDayKey("2026-11-12", "s1")) === 3 && sd.get(staffDayKey("2026-11-12", "s2")) === 0 && sd.get(staffDayKey("2026-11-13", "s1")) === 2, "số nhân viên báo theo ngày + nhân viên (báo 0 vẫn có)", [...sd]);
ok(!sd.has(staffDayKey("2026-11-13", "s2")), "nhân viên chưa báo → không có số");
const day = (acc, staff, phones) => ({ ...base, report_date: "2026-11-12", ad_account_id: acc, ads_staff_id: staff, pancake_phones: phones });
const pb = pancakePhonesByStaff([day("a1", "s1", 2), day("a2", "s1", 3), day("a3", "s2", null), day("a4", "s3", null), day("a5", "s3", 0), day("a6", null, 4)]);
ok(pb.get(staffDayKey("2026-11-12", "s1")) === 5 && pb.get(staffDayKey("2026-11-12", "s3")) === 0 && pb.get(staffDayKey("2026-11-12", null)) === 4, "tổng SĐT Pancake các TKQC của mỗi nhân viên", [...pb]);
ok(pb.get(staffDayKey("2026-11-12", "s2")) === null, "Pancake chưa có số TKQC nào của nhân viên → chưa có tổng");
const staffNames = { s1: "Sang", s2: "An", s3: undefined };
const accNames = { a1: "TK B", a2: "TK A", a3: "TK C", a4: "TK D", a5: "TK E", a6: "TK F" };
const blocks = staffBlocks([day("a6", null, 4), day("a1", "s1", 2), day("a3", "s2", null), day("a2", "s1", 3)], (id) => staffNames[id], (id) => accNames[id]);
ok(JSON.stringify(blocks.map((b) => b.map((r) => r.ad_account_id))) === JSON.stringify([["a3"], ["a2", "a1"], ["a6"]]), "gom theo nhân viên (theo tên), trong nhóm theo tên TKQC, dòng không ai phụ trách xuống cuối", blocks.map((b) => b.map((r) => r.ad_account_id)));

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

console.log("\n== SĐT theo nhân viên");
const P = (id, staff, phone, extra = {}) => ({ id, report_date: "2026-11-13", at: `2026-11-13T0${id}:00:00Z`, phone, full_name: "Khách", outcome: "new",
  ad_id: "1", ad_name: null, ad_goal: null, ad_account_id: "acc", ads_staff_id: staff, gap: staff ? null : "unmapped", page_name: null,
  pancake_url: `https://pancake.vn/pg?c_id=conv${id}`, ...extra });
const groups = groupPhones("2026-11-13", {
  phones: [P(3, "s2", "0903"), P(1, "s2", "0901"), P(2, "s2", "0901", { outcome: "duplicate" }), P(4, "s2", "12", { outcome: "invalid" }),
    P(5, null, "0905"), P(6, null, "0906", { gap: "no_ad" }), P(7, "s1", "0907", { report_date: "2026-11-12" })],
  forms: [{ report_date: "2026-11-13", ad_account_id: "acc", ads_staff_id: "s1", leads: 2 }, { report_date: "2026-11-13", ad_account_id: "x", ads_staff_id: "s2", leads: 0 },
    { report_date: "2026-11-13", ad_account_id: "y", ads_staff_id: null, leads: 1 }],
}, new Map([["s1", 2], ["s2", 3], ["s3", 4]]), (id) => ({ s1: "Sang", s2: "An", s3: "Dương" })[id]);
ok(JSON.stringify(groups.map((g) => g.key)) === JSON.stringify(["s2", "s3", "s1", "gap:unmapped", "gap:no_staff", "gap:no_ad"]),
  "nhóm nhân viên theo tên, nhóm chưa gắn nhân viên xuống cuối; nhân viên có báo mà không có số vẫn hiện", groups.map((g) => g.key));
const an = groups[0];
ok(an.phones.map((p) => p.id).join() === "1,2,3,4" && an.pancake === 2 && an.form === 0 && an.total === 2 && an.reported === 3,
  "xếp theo giờ; một số kéo 2 lần chỉ tính 1; số sai không tính", { ids: an.phones.map((p) => p.id), pancake: an.pancake });
ok(groups[2].form === 2 && groups[2].phones.length === 0 && groups[2].total === 2 && groups[2].reported === 2, "chỉ có form lead (số ngày khác không vào)", groups[2]);
ok(groups[1].total === 0 && groups[1].reported === 4, "nhân viên báo mà hệ thống không thấy số nào");
ok(groups[4].form === 1 && groups[4].reported === null, "form của TKQC chưa giao nhân viên");
ok(!countsAsData({ outcome: "invalid" }) && countsAsData({ outcome: "duplicate" }), "khách cũ vẫn tính, số sai không");
const conv = (id, phone, c, extra = {}) => P(id, "s1", phone, { pancake_url: `https://pancake.vn/pg?c_id=${c}`, ...extra });
ok(countCustomers([conv(1, "0901", "A"), conv(2, "0902", "A")]) === 1, "một khách để lại 2 số trong một hội thoại → 1 khách");
ok(countCustomers([conv(1, "0901", "A"), conv(2, "0901", "B"), conv(3, "0903", "C")]) === 2, "cùng một số ở 2 hội thoại (2 page) → 1 khách");
ok(countCustomers([conv(1, "0901", "A"), conv(2, "0902", "B"), conv(3, "0902", "C"), conv(4, "0904", "C")]) === 2, "nối nhiều bước: B–C chung số, C có thêm số → 1 khách");
ok(countCustomers([conv(1, "12", "A", { outcome: "invalid" })]) === 0 && countCustomers([]) === 0, "chỉ có số sai / không có số → 0");
ok(verdictText({ reported: 2, total: 2 }).tone === "match" && verdictText({ reported: 3, total: 2 }).text === "NV báo nhiều hơn 1"
  && verdictText({ reported: 0, total: 2 }).text === "NV báo ít hơn 2" && verdictText({ reported: null, total: 1 }).text === "Chưa báo", "câu so số");

console.log("\n== Telegram");
const bot = "7012345678:AAH" + "xYz_-9".repeat(6);
ok(cleanBotToken(`  ${bot}\n`).ok && cleanBotToken(`  ${bot}\n`).token === bot, "token bot đúng (bỏ khoảng trắng 2 đầu)");
ok(!cleanBotToken("123:abc").ok && !cleanBotToken(`EAA${"x".repeat(40)}`).ok && !cleanBotToken(`${bot} x`).ok, "token bot sai dạng");
const item = (id, batch, seq, status, extra = {}) => ({ id, batch_id: batch, kind: "auto", report_date: "2026-11-13", seq, title: `NV${seq}`, status,
  sent_at: status === "sent" ? `2026-11-14T03:0${seq}:00Z` : null, error: status === "failed" ? "Bot không còn trong nhóm" : null, created_at: "", ...extra });
const lb = lastBatch([item(5, "b2", 3, "failed"), item(4, "b2", 2, "sent"), item(3, "b2", 1, "sent"), item(2, "b1", 1, "sent")]);
ok(lb.total === 3 && lb.sent === 2 && lb.failed === 1 && lb.waiting === 0 && lb.error === "Bot không còn trong nhóm" && lb.lastSentAt === "2026-11-14T03:02:00Z", "lượt gửi gần nhất: đếm tin tới / lỗi", lb);
ok(lastBatch([]) === null, "chưa gửi lần nào");

console.log(`\n${passed} đạt, ${failed} lỗi`);
process.exit(failed ? 1 : 0);
