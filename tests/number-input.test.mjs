// Kiểm thử phần xử lý ô nhập số của màn Marketing → Nhập liệu (src/lib/ad-reports/number.ts).
// Chạy:  npm run test:ui
import { groupThousands, isNumberText, normalizeInput, toInteger } from "../src/lib/ad-reports/number.ts";

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

/** Gõ lần lượt từng ký tự vào cuối ô (như người dùng gõ), trả về nội dung ô và chữ số được lưu. */
function typeChars(text, maxDigits = 13) {
  let display = "";
  let digits = "";
  for (const ch of text) {
    const next = normalizeInput(display + ch, display.length + 1, maxDigits);
    if (next) ({ display, digits } = next);
  }
  return { display, digits };
}

/** Dán `text` vào ô đang có `display`, con trỏ ở `caret`. */
function paste(display, caret, text, maxDigits = 13) {
  if (!isNumberText(text)) return null;
  const pasted = text.replace(/\D/g, "");
  return normalizeInput(display.slice(0, caret) + pasted + display.slice(caret), caret + pasted.length, maxDigits);
}

console.log("\n== Gõ số");
let r = typeChars("1000000");
ok(r.display === "1.000.000" && toInteger(r.digits) === 1000000, 'gõ "1000000" → hiện "1.000.000", lưu 1000000', r);
r = typeChars("1.000.000");
ok(r.display === "1.000.000" && toInteger(r.digits) === 1000000, 'gõ "1.000.000" → lưu 1000000', r);
r = typeChars("235335");
ok(r.display === "235.335", '235335 → "235.335"', r);
r = typeChars("0");
ok(r.display === "0" && toInteger(r.digits) === 0, '0 → "0", lưu 0 (hợp lệ)', r);
r = typeChars("-5");
ok(r.display === "5" && !r.display.includes("-"), 'gõ "-5" → dấu trừ bị bỏ qua, không thành số âm', r);
r = typeChars("abc");
ok(r.display === "" && toInteger(r.digits) === null, 'gõ "abc" → không nhận, ô vẫn trống', r);
r = typeChars("007");
ok(r.display === "7", "số 0 thừa ở đầu bị bỏ", r);
r = typeChars("12345678901234", 13);
ok(r.digits.length === 13, "không cho vượt số chữ số tối đa", r);
ok(toInteger("") === null, "ô trống → chưa có giá trị (không phải 0)");

console.log("\n== Dán");
r = paste("", 0, "235,335");
ok(r?.display === "235.335", 'dán "235,335" → "235.335"', r);
r = paste("", 0, "235 335");
ok(r?.display === "235.335", 'dán "235 335" → "235.335"', r);
r = paste("", 0, "1.000.000 đ");
ok(r?.display === "1.000.000", 'dán "1.000.000 đ" → "1.000.000"', r);
ok(paste("", 0, "-5") === null, 'dán "-5" → không nhận');
ok(paste("", 0, "abc") === null, 'dán "abc" → không nhận');
ok(paste("", 0, "1,5") === null && paste("", 0, "12.34") === null, "dán số thập phân → không nhận");
ok(paste("", 0, "12a3") === null, "dán lẫn chữ → không nhận");

console.log("\n== Con trỏ không nhảy");
// "1.000.000", con trỏ sau chữ số thứ 4 ("1.000|.000"), gõ thêm "5" → 10.005.000, con trỏ sau chữ "5".
r = normalizeInput("1.0005.000", 6, 13);
ok(r.display === "10.005.000" && r.caret === 6, 'gõ giữa số: "1.000|.000" + 5 → "10.005|.000"', r);
// Xoá một chữ số ở giữa: "1.234.567", xoá "4" (con trỏ sau "4" ở vị trí 5) → "123.567", con trỏ sau "3".
r = normalizeInput("1.23.567", 4, 13);
ok(r.display === "123.567" && r.caret === 3, 'xoá chữ số giữa: "1.23|.567" → "123|.567"', r);
r = normalizeInput("1234", 4, 13);
ok(r.display === "1.234" && r.caret === 5, "gõ ở cuối: con trỏ vẫn ở cuối sau khi thêm dấu chấm", r);
r = normalizeInput("01234", 1, 13);
ok(r.display === "1.234" && r.caret === 0, "bỏ số 0 đầu: con trỏ về đầu", r);

console.log("\n== Định dạng");
ok(groupThousands(151150103) === "151.150.103" && groupThousands("") === "" && groupThousands(999) === "999", "dấu chấm hàng nghìn kiểu vi-VN");

console.log(`\n${passed} đạt, ${failed} lỗi`);
process.exit(failed ? 1 : 0);
