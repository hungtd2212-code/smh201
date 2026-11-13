/**
 * Thử nghiệm "Ads tự động" (supabase/027_ads_auto_test.sql): số Facebook tự kéo về được để RIÊNG một chỗ và chỉ
 * dùng để SO với số nhân viên nhập tay ở Nhập liệu — không sửa số nhân viên. File này là phần tính toán thuần
 * (không gọi mạng) để kiểm thử riêng được: tests/ads-auto.test.mjs.
 */

/** Số tin nhắn của Facebook đem ra so với ô "Số lượng tin nhắn" nhân viên nhập. */
export type MessageMetric = "conversations" | "new_contacts" | "connections";

export const METRIC_LABELS: Record<MessageMetric, string> = {
  conversations: "Lượt bắt đầu trò chuyện qua tin nhắn",
  new_contacts: "Người liên hệ nhắn tin mới",
  connections: "Lượt kết nối qua tin nhắn",
};

/** Một dòng đối chiếu: một (ngày, TKQC) có số nhập tay hoặc số Facebook (hoặc cả hai). */
export type CompareRow = {
  report_date: string; // yyyy-MM-dd
  ad_account_id: string;
  /** Nhân viên Ads phụ trách TKQC hôm đó (null = không ai). */
  ads_staff_id: string | null;
  manual_spend: number | null;
  manual_messages: number | null;
  manual_at: string | null;
  auto_spend: number | null;
  auto_currency: string | null;
  auto_conversations: number | null;
  auto_new_contacts: number | null;
  auto_connections: number | null;
  auto_fetched_at: string | null;
  /** Số khách nhắn tin từ quảng cáo của TKQC này, theo thống kê quảng cáo của Pancake (null = Pancake không có). */
  pancake_messages: number | null;
  /** Số khách để lại số điện thoại, theo Pancake. */
  pancake_phones: number | null;
};

/** Số Pancake của những quảng cáo chưa gắn được vào TKQC nào trong ERP (trong khoảng ngày đang xem). */
export type PancakeUnassigned = { messages: number; phones: number };

/** Tình trạng hỏi số Pancake của một page. */
export type PancakePage = {
  pancake_page_id: string;
  name: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

/** Một TKQC trong phần "Kết nối Facebook". */
export type AutoAccount = {
  ad_account_id: string;
  name: string;
  /** ID nhân viên điền ở TKQC & Page (nguyên văn). */
  account_id: string | null;
  /** ID chỉ còn chữ số; null = trống hoặc không đúng dạng. */
  fb_account_id: string | null;
  is_active: boolean;
  is_facebook: boolean;
  fb_name: string | null;
  currency: string | null;
  timezone: string | null;
  fb_status: number | null;
  checked_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  first_day: string | null;
  last_day: string | null;
};

export type AutoStatus = {
  has_token: boolean;
  token_hint: string | null;
  token_set_at: string | null;
  token_set_by: string | null;
  auto_enabled: boolean;
  last_auto_at: string | null;
  /** Số lượt hỏi Facebook đang chờ trả lời. */
  pending: number;
  /** Số việc Pancake còn lại: (page, ngày) chưa hỏi xong + quảng cáo đang tra TKQC. */
  pancake_pending: number;
  /** Các page Pancake đang được hỏi số (đang bật, có token). */
  pancake_pages: PancakePage[];
  accounts: AutoAccount[];
};

/** Kết quả so một dòng. */
export type MatchStatus =
  | "match" // khớp
  | "near" // lệch nhẹ
  | "off" // lệch
  | "no_manual" // Facebook có chi tiêu nhưng nhân viên chưa nhập
  | "no_auto" // nhân viên có nhập nhưng chưa có số Facebook
  | "idle" // không chạy: Facebook 0 đồng, nhân viên không nhập
  | "other_currency" // TKQC không tính bằng VND → không so trực tiếp được
  | "not_facebook"; // TKQC không phải Facebook (TikTok…) → không kéo được

export const STATUS_LABELS: Record<MatchStatus, string> = {
  match: "Khớp",
  near: "Lệch nhẹ",
  off: "Lệch",
  no_manual: "NV chưa nhập",
  no_auto: "Chưa có số FB",
  idle: "Không chạy",
  other_currency: "Khác tiền tệ",
  not_facebook: "Không phải FB",
};

/** Thứ tự hiện ở phần tổng hợp: cần xem trước lên trước. */
export const STATUS_ORDER: MatchStatus[] = ["off", "near", "no_manual", "no_auto", "match", "other_currency", "not_facebook", "idle"];

export type Verdict = "match" | "near" | "off";
const RANK: Record<Verdict, number> = { match: 0, near: 1, off: 2 };
const worst = (a: Verdict, b: Verdict): Verdict => (RANK[a] >= RANK[b] ? a : b);

/**
 * So chi tiêu (đồng). Khớp: lệch ≤ 1.000đ hoặc ≤ 0,5%. Lệch nhẹ: ≤ 3% (thường do Facebook cập nhật số sau khi
 * nhân viên đã nhập). Còn lại: lệch.
 */
export function spendVerdict(manual: number, auto: number): Verdict {
  const diff = Math.abs(manual - auto);
  const base = Math.max(manual, auto);
  if (diff <= Math.max(1000, base * 0.005)) return "match";
  if (diff <= base * 0.03) return "near";
  return "off";
}

/** So số tin nhắn. Khớp: bằng nhau. Lệch nhẹ: lệch 1, hoặc ≤ 5%. Còn lại: lệch. */
export function countVerdict(manual: number, auto: number): Verdict {
  const diff = Math.abs(manual - auto);
  if (diff === 0) return "match";
  if (diff <= Math.max(1, Math.round(Math.max(manual, auto) * 0.05))) return "near";
  return "off";
}

export const autoMessages = (row: CompareRow, metric: MessageMetric): number | null =>
  metric === "conversations" ? row.auto_conversations : metric === "new_contacts" ? row.auto_new_contacts : row.auto_connections;

export type ComparedRow = CompareRow & {
  status: MatchStatus;
  /** Số Facebook theo loại tin nhắn đang chọn. */
  fb_messages: number | null;
  /** Facebook − nhân viên (null nếu thiếu một bên). */
  spend_diff: number | null;
  messages_diff: number | null;
  spend_verdict: Verdict | null;
  messages_verdict: Verdict | null;
};

const isVnd = (currency: string | null) => !currency || currency.toUpperCase() === "VND";

/** So một dòng. `isFacebook` = TKQC thuộc kênh Facebook (lấy từ danh sách TKQC). */
export function compareRow(row: CompareRow, metric: MessageMetric, isFacebook: boolean): ComparedRow {
  const fbMessages = autoMessages(row, metric);
  const hasManual = row.manual_spend !== null;
  const hasAuto = row.auto_spend !== null;
  const base = {
    ...row,
    fb_messages: hasAuto ? fbMessages ?? 0 : null,
    spend_diff: null,
    messages_diff: null,
    spend_verdict: null,
    messages_verdict: null,
  };
  if (!hasAuto) {
    return { ...base, status: isFacebook ? "no_auto" : "not_facebook" };
  }
  const fbSpend = row.auto_spend ?? 0;
  if (!hasManual) {
    return { ...base, status: fbSpend > 0 || (fbMessages ?? 0) > 0 ? "no_manual" : "idle" };
  }
  const manualSpend = row.manual_spend ?? 0;
  const manualMessages = row.manual_messages ?? 0;
  const messagesVerdict = countVerdict(manualMessages, fbMessages ?? 0);
  const withDiff = { ...base, messages_diff: (fbMessages ?? 0) - manualMessages, messages_verdict: messagesVerdict };
  if (!isVnd(row.auto_currency)) {
    return { ...withDiff, status: "other_currency" };
  }
  const spendV = spendVerdict(manualSpend, fbSpend);
  return {
    ...withDiff,
    spend_diff: fbSpend - manualSpend,
    spend_verdict: spendV,
    status: worst(spendV, messagesVerdict),
  };
}

export type CompareSummary = {
  counts: Record<MatchStatus, number>;
  /** Tổng trên những dòng có cả hai bên và tính bằng VND. */
  manualSpend: number;
  fbSpend: number;
  manualMessages: number;
  fbMessages: number;
  /** Số dòng có cả hai bên (đem ra so được). */
  compared: number;
  /** Tổng số Pancake trên mọi dòng (đã gắn TKQC). */
  pancakeMessages: number;
  pancakePhones: number;
};

/** Dòng có số Pancake (khách nhắn tin hoặc để lại số). */
export const hasPancake = (row: CompareRow) => (row.pancake_messages ?? 0) > 0 || (row.pancake_phones ?? 0) > 0;

/** Ẩn ở bộ lọc "Tất cả": TKQC không chạy hôm đó và Pancake cũng không có khách nào. */
export const isHiddenIdle = (row: ComparedRow) => row.status === "idle" && !hasPancake(row);

export function summarize(rows: ComparedRow[]): CompareSummary {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<MatchStatus, number>;
  const sum = { manualSpend: 0, fbSpend: 0, manualMessages: 0, fbMessages: 0, compared: 0, pancakeMessages: 0, pancakePhones: 0 };
  for (const row of rows) {
    counts[row.status]++;
    sum.pancakeMessages += row.pancake_messages ?? 0;
    sum.pancakePhones += row.pancake_phones ?? 0;
    if (row.spend_verdict !== null) {
      sum.compared++;
      sum.manualSpend += row.manual_spend ?? 0;
      sum.fbSpend += row.auto_spend ?? 0;
      sum.manualMessages += row.manual_messages ?? 0;
      sum.fbMessages += row.fb_messages ?? 0;
    }
  }
  return { counts, ...sum };
}

/** Dòng cần xem lại (lọc "Chỉ hiện dòng lệch"). */
export const needsLook = (status: MatchStatus) => status === "off" || status === "near" || status === "no_manual" || status === "no_auto";

/** Múi giờ cùng giờ Việt Nam (UTC+7): ngày của Facebook trùng ngày Việt Nam. */
const UTC7 = new Set(["Asia/Ho_Chi_Minh", "Asia/Saigon", "Asia/Bangkok", "Asia/Jakarta", "Asia/Phnom_Penh", "Asia/Vientiane", "Etc/GMT-7"]);

/** Tên trạng thái TKQC của Facebook (account_status). */
export const FB_ACCOUNT_STATUS: Record<number, string> = {
  1: "Đang hoạt động",
  2: "Bị vô hiệu hoá",
  3: "Chưa thanh toán",
  7: "Đang xét duyệt rủi ro",
  8: "Chờ thanh toán",
  9: "Trong thời gian ân hạn",
  100: "Chờ đóng",
  101: "Đã đóng",
  201: "Đang hoạt động",
  202: "Đã đóng",
};

/** Điều cần lưu ý về một TKQC (hiện dưới tên TKQC). */
export function accountWarnings(acc: AutoAccount): string[] {
  const out: string[] = [];
  if (acc.currency && acc.currency.toUpperCase() !== "VND") {
    out.push(`TKQC tính bằng ${acc.currency}: chi tiêu không so trực tiếp với số đồng nhân viên nhập`);
  }
  if (acc.timezone && !UTC7.has(acc.timezone)) {
    out.push(`Múi giờ ${acc.timezone}: "một ngày" của Facebook lệch với ngày Việt Nam`);
  }
  if (acc.fb_status !== null && acc.fb_status !== 1 && acc.fb_status !== 201) {
    out.push(`Trên Facebook: ${FB_ACCOUNT_STATUS[acc.fb_status] ?? `trạng thái ${acc.fb_status}`}`);
  }
  return out;
}

export type HealthTone = "good" | "warn" | "bad" | "idle";

/** Tình trạng kéo số của một TKQC: màu + chữ. */
export function accountHealth(acc: AutoAccount, hasToken: boolean): { tone: HealthTone; text: string } {
  if (!acc.is_facebook) return { tone: "idle", text: "Không phải TKQC Facebook — không kéo được" };
  if (!acc.account_id?.trim()) return { tone: "warn", text: "Chưa điền ID TKQC (trang TKQC & Page)" };
  if (!acc.fb_account_id) return { tone: "warn", text: `ID TKQC "${acc.account_id}" không đúng dạng (chỉ gồm chữ số)` };
  if (!acc.is_active) return { tone: "idle", text: "TKQC đang ngừng dùng — không kéo" };
  if (!hasToken) return { tone: "idle", text: "Chờ dán token" };
  if (acc.last_error) return { tone: "bad", text: acc.last_error };
  if (acc.last_ok_at) return { tone: "good", text: "Kéo được" };
  if (acc.checked_at) return { tone: "good", text: "Đã kết nối, đang chờ số" };
  return { tone: "idle", text: "Đang kiểm tra…" };
}

/** Khoảng ngày mặc định: 7 ngày, tới hôm qua (hôm nay nhân viên thường chưa nhập). */
export function defaultRange(today: string, days = 7) {
  const shift = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(-days), to: shift(-1) };
}

/** Token Facebook có đúng dạng không (giống kiểm tra trong cơ sở dữ liệu). Bỏ khoảng trắng / xuống dòng 2 đầu. */
export function cleanToken(raw: string): { token: string; ok: boolean } {
  const token = raw.trim();
  return { token, ok: /^EAA[A-Za-z0-9]+$/.test(token) && token.length >= 40 && token.length <= 2000 };
}
