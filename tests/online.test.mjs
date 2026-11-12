// Kiểm thử phần gom danh sách "ai đang online" (src/lib/staff/online.ts).
// Chạy:  npm run test:ui
import { onlinePeople, sinceLabel } from "../src/lib/staff/online.ts";

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

console.log("\n== Gom theo người");
const meta = (name, since, extra = {}) => ({ name, avatar_url: null, position: "Telesale", since, presence_ref: "x", ...extra });
const state = {
  me: [meta("Chủ phòng khám", "2026-11-13T01:00:00Z", { position: "CEO" })],
  dương: [
    meta("Dương", "2026-11-13T02:00:00Z"),
    meta("Dương Ads", "2026-11-13T03:00:00Z", { avatar_url: "https://x/d.jpg" }), // tab mở sau
  ],
  an: [meta("An", "2026-11-13T04:00:00Z")],
  hỏng: [{ presence_ref: "y" }], // dòng thiếu tên → bỏ
  bình: [meta("Bình", "2026-11-13T00:30:00Z")],
};
const people = onlinePeople(state, "me");
ok(JSON.stringify(people.map((p) => p.name)) === JSON.stringify(["An", "Bình", "Dương Ads", "Chủ phòng khám"]), "mỗi người một dòng, xếp theo tên, mình ở cuối, bỏ dòng hỏng", people.map((p) => p.name));
const duong = people.find((p) => p.userId === "dương");
ok(duong.since === "2026-11-13T02:00:00Z" && duong.avatarUrl === "https://x/d.jpg", "nhiều tab: lấy giờ mở sớm nhất, tên / ảnh của tab mới nhất", duong);
ok(people.at(-1).me && !people[0].me && people.at(-1).position === "CEO", "đánh dấu chính mình");
ok(onlinePeople({}, "me").length === 0, "kênh trống → danh sách trống");

console.log("\n== Giờ online");
const now = new Date("2026-11-13T07:00:00Z"); // 14:00 giờ Việt Nam
ok(sinceLabel("2026-11-13T01:15:00Z", now) === "từ 08:15", "hôm nay: chỉ giờ (giờ Việt Nam)", sinceLabel("2026-11-13T01:15:00Z", now));
ok(sinceLabel("2026-11-12T16:30:00Z", now) === "từ 23:30 12/11", "từ hôm trước: thêm ngày", sinceLabel("2026-11-12T16:30:00Z", now));
ok(sinceLabel("2026-11-12T17:30:00Z", now) === "từ 00:30", "0:30 sáng nay theo giờ Việt Nam vẫn là hôm nay", sinceLabel("2026-11-12T17:30:00Z", now));
ok(sinceLabel("không phải ngày", now) === "", "giờ hỏng → để trống");

console.log(`\n${passed} ok, ${failed} lỗi`);
if (failed > 0) process.exit(1);
