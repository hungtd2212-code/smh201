/**
 * Chuẩn hoá số điện thoại và tách SĐT / tên từ một đoạn chat.
 * Quy tắc chuẩn hoá phải giống hàm public.normalize_phone() trong Supabase.
 */

/** "+84 912.345-678" → "0912345678" */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return /^84\d{9,10}$/.test(digits) ? `0${digits.slice(2)}` : digits;
}

/** Số Việt Nam sau khi chuẩn hoá: bắt đầu bằng 0, dài 10–11 chữ số. */
export function isValidPhone(normalized: string): boolean {
  return /^0\d{9,10}$/.test(normalized);
}

// Số điện thoại có thể bị ngắt bởi dấu cách, chấm, gạch: "09 12.345-678", "+84 912 345 678".
const PHONE_IN_TEXT = /(?:\+?84|0)(?:[\s.\-]?\d){9,10}(?!\d)/g;

// "tên em là Lan", "mình tên: Nguyễn Văn A", "Họ tên - Trần B", "name: C"
const NAME_LABEL =
  /(?:họ\s*(?:và\s*)?tên|tên\s*(?:em|mình|chị|anh|e|c|a|tôi|khách)?|name)\s*(?:là|:|-|=)\s*([^\n,.;|\d]{2,50})/i;

/**
 * Dọn phần thừa quanh tên:
 * - nhãn số điện thoại đứng sau tên trên cùng dòng: "Trần Đức - SĐT 09…" → "Trần Đức"
 * - từ đệm cuối câu: "Lan ạ", "Hoa nhé"
 */
const cleanName = (name: string) =>
  name
    .replace(/[\s\-–—|,;:(]*(?:s[đd]t|số\s*(?:đt|điện\s*thoại|zalo)?|đt|điện\s*thoại|phone|tel|zalo)\b.*$/i, "")
    .replace(/\s+(ạ|nhé|nha|nhá|ơi|á|a|nè|đó|đấy)\s*$/i, "")
    .replace(/[\s\-–—|,;:(]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Tách SĐT và tên từ đoạn chat dán vào.
 * Tên được đoán theo thứ tự: (1) câu có nhãn "tên ... là / :", (2) tên người nói
 * ở đầu dòng chứa số điện thoại, dạng "Nguyễn Lan: sđt em 09...".
 * Không đoán được thì để trống cho người dùng tự nhập.
 */
export function parseChatSnippet(text: string): { phone: string | null; name: string | null } {
  let phone: string | null = null;
  let phoneLine: string | null = null;

  for (const match of text.matchAll(PHONE_IN_TEXT)) {
    const candidate = normalizePhone(match[0]);
    if (isValidPhone(candidate)) {
      phone = candidate;
      const start = text.lastIndexOf("\n", match.index) + 1;
      const end = text.indexOf("\n", match.index);
      phoneLine = text.slice(start, end === -1 ? undefined : end);
      break;
    }
  }

  let name: string | null = null;
  const labelled = text.match(NAME_LABEL);
  if (labelled) {
    name = cleanName(labelled[1]);
  } else if (phoneLine) {
    // "Tên người nói: nội dung" — tên 1–5 từ, không chứa số.
    const speaker = phoneLine.match(/^\s*([^:\d\n]{2,40}?)\s*:/);
    if (speaker && speaker[1].trim().split(/\s+/).length <= 5) name = cleanName(speaker[1]);
  }

  return { phone, name: name || null };
}
