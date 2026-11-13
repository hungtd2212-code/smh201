// Kiểm thử phần tính toán của kết nối Pancake (src/lib/leads/pancake.ts).
// Chạy:  npm run test:ui
import {
  chatDayLabel,
  chatDayTime,
  chatSeenMarks,
  decodeChatText,
  explainChatError,
  hasPancakeConversation,
  lastCustomerMessage,
  mergeChatMessages,
  outsideMessengerWindow,
  pancakeConversationUrl,
  pancakeHealth,
  pancakeProblems,
  pancakeTokenProblem,
  parsePancakePageId,
  safeHttpUrl,
  splitChatPhones,
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
ok(pancakeHealth({ ...base, created_at: "2026-11-13T04:58:00Z" }, now).tone === "waiting", "vừa kết nối, chưa hỏi được lần nào → đang chờ");
ok(pancakeHealth(base, now).tone === "warn" && /Chưa hỏi được Pancake lần nào/.test(pancakeHealth(base, now).label), "kết nối hơn 5 phút mà chưa hỏi được lần nào → cảnh báo");
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

console.log("\n== Ô trả lời, giao diện như Pancake");
const nowVN = new Date("2026-11-13T08:00:00Z"); // 15:00 13/11 giờ Việt Nam
ok(chatDayLabel("2026-11-13T01:00:00Z", nowVN) === "Hôm nay" && chatDayLabel("2026-11-12T10:00:00Z", nowVN) === "Hôm qua"
  && chatDayLabel("2026-11-10T10:00:00Z", nowVN) === "10/11/2026" && chatDayLabel(null, nowVN) === null, "nhãn ngày: Hôm nay / Hôm qua / dd/mm/yyyy");
ok(chatDayLabel("2026-11-12T17:30:00Z", nowVN) === "Hôm nay", "00:30 sáng nay (giờ VN) là Hôm nay dù giờ UTC là hôm qua");
let parts = splitChatPhones("Sô zalo 0356396686", "0965613037");
ok(parts.length === 2 && parts[1].text === "0356396686" && parts[1].phone === "other", "số khác → tô xanh", parts);
parts = splitChatPhones("0965613037", "0965613037");
ok(parts.length === 1 && parts[0].phone === "lead", "số của chính lead → tô cam", parts);
parts = splitChatPhones("Gọi em +84 965 613 037 hoặc 0912.345.678 nhé", "0965613037");
ok(parts.filter((x) => x.phone).map((x) => `${x.text}:${x.phone}`).join("|") === "+84 965 613 037:lead|0912.345.678:other", "số có dấu cách / chấm / +84 vẫn nhận ra", parts);
ok(splitChatPhones("Mã đơn 1234567890123456", null).every((x) => !x.phone) && splitChatPhones("Giá 45000000đ", null).every((x) => !x.phone),
  "dãy số dài / tiền không bị tô nhầm");
ok(splitChatPhones("Chào anh", null).length === 1 && splitChatPhones("", null).length === 0, "không có số → giữ nguyên chữ");
const cm = (id, at, from_page, kind = "INBOX") => ({ id, at, from_page, sender: null, text: id, removed: false, kind, attachments: [] });
const conv1 = [cm("k1", "2026-11-11T08:00:00Z", false), cm("p1", "2026-11-11T08:05:00Z", true)];
ok(lastCustomerMessage(conv1)?.id === "k1" && lastCustomerMessage([cm("p", null, true)]) === null, "tìm tin cuối của khách");
ok(outsideMessengerWindow(conv1, nowVN) === true && outsideMessengerWindow([cm("k", "2026-11-13T01:00:00Z", false)], nowVN) === false,
  "khách nhắn quá 24 giờ → cảnh báo; trong 24 giờ → không");
ok(outsideMessengerWindow([cm("c", "2026-11-01T01:00:00Z", false, "COMMENT")], nowVN) === false, "bình luận không tính giới hạn 24 giờ Messenger");
ok(/24 giờ/.test(explainChatError("Pancake không gửi được: (#10) This message is sent outside of allowed window.")), "lỗi ngoài 24 giờ của Facebook → nói rõ");

console.log("\n== Khách đã xem, cảnh báo mất kết nối");
const sm = (id, at, from_page) => ({ id, at, from_page, sender: null, text: id, removed: false, kind: "INBOX", attachments: [] });
const thread = [sm("k1", "2026-11-13T04:40:00Z", false), sm("p1", "2026-11-13T04:41:00Z", true), sm("p2", "2026-11-13T04:43:00Z", true), sm("p3", "2026-11-13T04:50:00Z", true)];
let marks = chatSeenMarks(thread, "2026-11-13T04:44:37Z");
ok(marks.seenIndex === 2 && marks.latestPageIndex === 3 && marks.latestPageUnseen, "khách đọc tới 11:44 → \"Đã xem\" dưới tin 11:43, tin 11:50 chưa xem", marks);
marks = chatSeenMarks(thread, "2026-11-13T04:50:01Z");
ok(marks.seenIndex === 3 && !marks.latestPageUnseen, "khách đã đọc hết", marks);
marks = chatSeenMarks(thread, null);
ok(marks.seenIndex === -1 && marks.latestPageIndex === 3, "không có mốc đã xem → không đánh dấu", marks);
ok(chatSeenMarks([sm("k", "2026-11-13T04:40:00Z", false)], "2026-11-13T05:00:00Z").latestPageIndex === -1, "chưa có tin của page → không có gì để xem");
const pc = (id, extra) => ({ ...base, id, created_at: "2026-11-13T03:00:00Z", last_ok_at: "2026-11-13T04:59:30Z", ...extra });
const problems = pancakeProblems([
  pc("ok"),
  pc("err", { last_error: "Page Access Token sai", last_error_at: "2026-11-13T04:58:00Z" }),
  pc("stale", { last_ok_at: "2026-11-13T04:40:00Z" }),
  pc("paused", { is_active: false, last_error: "x" }),
  pc("new", { created_at: "2026-11-13T04:59:00Z", last_ok_at: null }),
], now);
ok(problems.map((x) => x.conn.id).join(",") === "err,stale", "mất kết nối = báo lỗi hoặc quá 5 phút không hỏi được; bỏ page tạm dừng / vừa kết nối", problems.map((x) => x.conn.id));

console.log(`\n${passed} ok, ${failed} lỗi`);
if (failed > 0) process.exit(1);
