// Kiểm thử phần tính toán của kết nối Pancake (src/lib/leads/pancake.ts).
// Chạy:  npm run test:ui
import {
  chatDayTime,
  decodeChatText,
  explainChatError,
  hasPancakeConversation,
  mergeChatMessages,
  pancakeConversationUrl,
  pancakeHealth,
  pancakeTokenProblem,
  parsePancakePageId,
  safeHttpUrl,
} from "../src/lib/leads/pancake.ts";

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

console.log("\n== Nhận ID page từ chữ người dùng dán");
const cases = [
  ["105738241234567", "105738241234567", "ID trần"],
  ["  105738241234567 ", "105738241234567", "bỏ khoảng trắng"],
  ["tt_6711731671916708866", "tt_6711731671916708866", "page TikTok trên Pancake"],
  ["https://pancake.vn/105738241234567?c_id=105738241234567_998877", "105738241234567", "link hội thoại Pancake"],
  ["https://pages.fm/105738241234567", "105738241234567", "link pages.fm"],
  ["https://www.facebook.com/profile.php?id=61550000000000", "61550000000000", "link Facebook profile.php?id="],
  ["https://www.facebook.com/105738241234567/", "105738241234567", "link Facebook dạng số"],
  ["105738241234567_444555666", "105738241234567", "mã bài idpage_idbài → lấy ID page"],
  ["https://www.facebook.com/nhakhoasmilehub", null, "link Facebook bằng tên → không đoán"],
  ["https://pancake.vn/dashboard", null, "trang chung của Pancake → không phải ID"],
  ["bacsidoankimhoa", null, "tên page (Pancake hiện trên thanh địa chỉ) → không phải ID"],
  ["https://pancake.vn/bacsidoankimhoa?c_id=1", null, "link Pancake bằng tên page → không phải ID"],
  ["Nhakhoa.smile.hub", null, "tên page có dấu chấm → không phải ID"],
  ["12345", null, "dãy số quá ngắn → không phải ID"],
  ["có dấu cách ở giữa", null, "chữ thường → không nhận"],
  ["", null, "trống"],
];
for (const [input, want, label] of cases) {
  const got = parsePancakePageId(input);
  ok(got === want, label, { input, got });
}

console.log("\n== Kiểm tra chữ dán vào ô token");
ok(/đường link/.test(pancakeTokenProblem("https://www.facebook.com/Nhakhoa.smile.hub") ?? ""), "dán link Facebook → báo là link");
ok(/đường link/.test(pancakeTokenProblem("pancake.vn/106290911229090") ?? ""), "dán link Pancake → báo là link");
ok(/dấu cách/.test(pancakeTokenProblem("eyJhbGciOiJIUzI1NiJ9 abc.def") ?? ""), "có dấu cách → báo");
ok(/quá ngắn/.test(pancakeTokenProblem("abc123") ?? ""), "quá ngắn → báo");
ok(pancakeTokenProblem("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0aW1lc3RhbXAiOjE3MDB9.c2lnbmF0dXJl") === null, "chuỗi giống token → không báo");
ok(pancakeTokenProblem("") === null, "để trống → không báo (sửa kết nối thì giữ token cũ)");

console.log("\n== Tình trạng kết nối");
const now = new Date("2026-11-13T05:00:00Z");
const base = { id: "1", pancake_page_id: "1", page_id: "p", is_active: true, token_hint: "abcd", sync_from: "2026-11-13T04:00:00Z", last_ok_at: null, last_error: null, last_error_at: null, created_at: "2026-11-13T04:00:00Z" };
ok(pancakeHealth({ ...base, is_active: false, last_error: "x" }, now).tone === "paused", "tạm dừng đứng trước báo lỗi");
const err = pancakeHealth({ ...base, last_error: "Page Access Token sai", last_error_at: "2026-11-13T04:58:00Z" }, now);
ok(err.tone === "error" && err.label === "Page Access Token sai (lúc 11:58)", "báo lỗi kèm giờ Việt Nam", err);
const bad = pancakeHealth({ ...base, last_error: "Pancake báo lỗi: Invalid access_token", last_error_at: "2026-11-13T07:58:00Z" }, now);
ok(bad.tone === "error" && /Pancake không nhận token — bấm Sửa/.test(bad.label) && /14:58/.test(bad.label), "lỗi tiếng Anh \"Invalid access_token\" → nói rõ cần làm gì", bad);
ok(pancakeHealth(base, now).tone === "waiting", "chưa hỏi được lần nào → đang chờ");
const fine = pancakeHealth({ ...base, last_ok_at: "2026-11-13T04:59:00Z" }, now);
ok(fine.tone === "ok" && /11:59/.test(fine.label), "vừa hỏi được → đang chạy", fine);
ok(pancakeHealth({ ...base, last_ok_at: "2026-11-13T04:50:00Z" }, now).tone === "warn", "quá 5 phút không hỏi được → cảnh báo");

console.log("\n== Link hội thoại");
ok(pancakeConversationUrl("105738241234567", "105738241234567_998877") === "https://pancake.vn/105738241234567?c_id=105738241234567_998877", "link mở hội thoại Pancake");

console.log("\n== Khung chat trong cửa sổ chi tiết lead");
ok(hasPancakeConversation("https://pancake.vn/1500650126455233?c_id=1500650126455233_25871234"), "link hội thoại Pancake → có khung chat");
ok(hasPancakeConversation("https://pancake.vn/smilehub?foo=1&c_id=1500650126455233_1"), "link có tên page, c_id ở sau → vẫn nhận");
ok(!hasPancakeConversation("https://www.facebook.com/abc") && !hasPancakeConversation(null) && !hasPancakeConversation("https://pancake.vn/1500650126455233"),
  "link Facebook / không có c_id / trống → không có khung chat");
ok(safeHttpUrl("https://scontent.xx.fbcdn.net/a.jpg?x=1") === "https://scontent.xx.fbcdn.net/a.jpg?x=1" && safeHttpUrl("javascript:alert(1)") === null
  && safeHttpUrl("data:image/png;base64,AAA") === null && safeHttpUrl(null) === null, "chỉ cho link http(s) làm ảnh / đường dẫn");
ok(decodeChatText("Giá &lt;30tr&gt; &amp; ưu đãi&nbsp;!") === "Giá <30tr> & ưu đãi !", "đổi mã HTML về chữ");
const msg = (id, at, extra = {}) => ({ id, at, from_page: false, sender: null, text: id, removed: false, kind: "INBOX", attachments: [], ...extra });
const merged = mergeChatMessages([msg("b", "2026-11-13T08:02:00Z"), msg("c", "2026-11-13T08:03:00Z")],
  [msg("c", "2026-11-13T08:03:00Z", { text: "c mới" }), msg("a", "2026-11-13T08:01:00Z"), msg("d", "2026-11-13T08:04:00Z")]);
ok(merged.map((m) => m.id).join("") === "abcd" && merged[2].text === "c mới", "ghép tin: bỏ trùng, xếp cũ → mới, tin trùng lấy bản mới", merged.map((m) => m.id));
const dt = chatDayTime("2026-11-13T17:30:00Z");
ok(dt && dt.day === "14/11/2026" && dt.time === "00:30", "giờ tin nhắn theo giờ Việt Nam (qua nửa đêm sang ngày mới)", dt);
ok(chatDayTime(null) === null && chatDayTime("không phải ngày") === null, "không có giờ → không hiện");
ok(/quản lý vào Telesale → Cài đặt/.test(explainChatError("Pancake báo lỗi: Invalid access_token")), "lỗi token tiếng Anh → nói rõ ai làm gì");
ok(explainChatError("Pancake không thấy cuộc chat này") === "Pancake không thấy cuộc chat này", "lỗi khác giữ nguyên");

console.log(`\n${passed} ok, ${failed} lỗi`);
if (failed > 0) process.exit(1);
