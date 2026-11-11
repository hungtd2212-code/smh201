/**
 * Ô nhập số nguyên ≥ 0 có dấu chấm hàng nghìn (vi-VN): bỏ ký tự không phải chữ số, tự thêm dấu chấm,
 * giữ con trỏ đúng chỗ. Không phụ thuộc React để kiểm thử riêng được (tests/number-input.test.mjs).
 *
 * Giá trị trong form luôn là CHUỖI CHỮ SỐ ("" = chưa nhập, "0", "1000000"); lúc lưu mới đổi sang số.
 */

/** 1000000 → "1.000.000"; "1000000" → "1.000.000"; "" → "". */
export function groupThousands(digits: string | number): string {
  const text = String(digits);
  return text === "" ? "" : text.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Số → chuỗi vi-VN có dấu chấm hàng nghìn: 1234567 → "1.234.567". */
export const formatNumber = (value: number) => groupThousands(Math.round(value));

/**
 * Chuẩn hoá nội dung ô sau khi gõ: giữ lại chữ số, bỏ số 0 thừa ở đầu, thêm dấu chấm.
 * `caret` là vị trí con trỏ trong `raw`; trả về vị trí con trỏ tương ứng trong chuỗi đã định dạng
 * (đứng sau đúng chừng ấy chữ số như trước) — để con trỏ không nhảy khi dấu chấm tự thêm / bớt.
 * Vượt quá `maxDigits` chữ số thì trả về null (bỏ qua lần gõ đó).
 */
export function normalizeInput(raw: string, caret: number, maxDigits: number) {
  const all = raw.replace(/\D/g, "");
  let before = raw.slice(0, Math.max(0, caret)).replace(/\D/g, "").length;
  const lead = /^0+(?=\d)/.exec(all)?.[0].length ?? 0;
  const digits = all.slice(lead);
  before = Math.max(0, before - lead);
  if (digits.length > maxDigits) return null;

  const display = groupThousands(digits);
  let position = 0;
  for (let seen = 0; position < display.length && seen < before; position++) {
    if (/\d/.test(display[position])) seen++;
  }
  return { digits, display, caret: position };
}

/**
 * Nội dung dán vào có phải một số nguyên ≥ 0 không. Nhận: "1000000", "1.000.000", "235,335",
 * "235 335", có thể kèm "đ" / "₫" / "VND" ở cuối. Không nhận: số âm, chữ, số thập phân ("1,5", "12.34").
 * Dấu chấm, dấu phẩy, khoảng trắng chỉ được hiểu là dấu ngăn hàng nghìn (nhóm đúng 3 chữ số).
 */
export function isNumberText(text: string): boolean {
  const value = text
    .replace(/[  ]/g, " ")
    .trim()
    .replace(/\s*(đ|₫|vnđ|vnd)$/i, "");
  return /^\d+$/.test(value) || /^\d{1,3}([.,\s]\d{3})+$/.test(value);
}

/** Chuỗi chữ số → số; "" → null. */
export const toInteger = (digits: string) => (digits === "" ? null : Number(digits));
