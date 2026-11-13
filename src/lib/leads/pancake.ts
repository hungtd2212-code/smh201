/**
 * Kết nối Pancake (supabase/023_pancake_sync.sql): mỗi phút hệ thống hỏi Pancake các hội thoại vừa có hoạt
 * động, số điện thoại mới trong đó tự vào bảng Lead. File này chỉ có kiểu dữ liệu và phần tính toán thuần
 * (kiểm thử ở tests/pancake.test.mjs); đọc / ghi cơ sở dữ liệu nằm ở pancake-repo.ts.
 */

/** Một page Pancake đã kết nối. Token không bao giờ đọc về trình duyệt — chỉ có 4 ký tự cuối để nhận ra. */
export type PancakePage = {
  id: string;
  pancake_page_id: string;
  /** Page trong ERP (danh mục Page) mà số kéo về được gắn vào. */
  page_id: string;
  is_active: boolean;
  token_hint: string | null;
  /** Chỉ lấy hội thoại có hoạt động sau mốc này. */
  sync_from: string;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
};

export type PancakeImportOutcome = "new" | "duplicate" | "invalid" | "error";

/** Một số điện thoại đã kéo từ một hội thoại Pancake (mỗi số trong mỗi hội thoại chỉ kéo một lần). */
export type PancakeImport = {
  id: number;
  pancake_page_id: string;
  conversation_id: string;
  phone: string;
  full_name: string | null;
  conversation_type: string | null;
  ad_id: string | null;
  outcome: PancakeImportOutcome;
  lead_id: string | null;
  error: string | null;
  created_at: string;
};

export type PancakeSyncResult = { added?: number; requests?: number; skipped?: boolean };

export const IMPORT_OUTCOMES: Record<PancakeImportOutcome, { label: string; tone: "ok" | "muted" | "warn" | "error" }> = {
  new: { label: "Số mới", tone: "ok" },
  duplicate: { label: "Trùng — giữ sale cũ", tone: "muted" },
  invalid: { label: "Không phải SĐT", tone: "warn" },
  error: { label: "Lỗi", tone: "error" },
};

/** Đúng quy tắc của cơ sở dữ liệu (pancake_pages.pancake_page_id). */
export const PANCAKE_PAGE_ID = /^[A-Za-z0-9_.-]{3,80}$/;

/**
 * Lấy ID page Pancake từ chữ người dùng dán: ID trần ("105738241234567", "tt_6711…"), link Pancake có ID
 * (pancake.vn/<id>?c_id=…), link Facebook có ID số (profile.php?id=…, facebook.com/<số>) hoặc mã bài
 * "idpage_idbài". Tên page ("bacsidoankimhoa") hay chữ khác thì trả null.
 */
export function parsePancakePageId(input: string | null | undefined): string | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  const bare = asPageId(text);
  if (bare) return bare;
  // Link Pancake chỉ dùng được khi trên thanh địa chỉ là ID; page có tên riêng thì Pancake hiện tên
  // (vd pancake.vn/bacsidoankimhoa) — tên đó không gọi API được, nên không nhận.
  const pancake = text.match(/(?:pancake\.vn|pages\.fm)\/([A-Za-z0-9_-]{3,80})(?=[/?#]|$)/i);
  if (pancake && asPageId(pancake[1])) return asPageId(pancake[1]);
  const facebook =
    text.match(/[?&]id=(\d{6,})(?=&|#|$)/) ??
    text.match(/facebook\.com\/(?:pages\/[^/?#]+\/)?(\d{6,})(?=[/?#]|$)/i);
  return facebook ? facebook[1] : null;
}

/**
 * Một ID page Pancake gọi API được: dãy số (page Facebook), mã bài "idpage_idbài" (lấy phần page), hoặc ID có
 * tiền tố nền tảng khác như "tt_6711…" (TikTok). Tên page (chữ, dấu chấm) không phải ID.
 */
function asPageId(text: string): string | null {
  if (/^\d{6,}$/.test(text)) return text;
  const post = text.match(/^(\d{6,})_\d{6,}$/);
  if (post) return post[1];
  if (/^[a-z]{2,5}_[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*$/.test(text) && text.length <= 80) return text;
  return null;
}

/** Lời nhắc khi chữ dán vào ô "ID page" không phải ID. */
export const PANCAKE_ID_HINT =
  "Cần ID dạng số của page (vd 1500650126455233), không phải tên page. Chọn page đã thêm ở TKQC & Page thì ID tự điền.";

/**
 * Kiểm tra nhanh chữ dán vào ô token trước khi gửi (không đọc / lưu gì). Trả lời nhắc nếu rõ ràng không phải
 * token — hay gặp nhất là dán nhầm đường link của page.
 */
export function pancakeTokenProblem(token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  if (/:\/\/|^www\.|facebook\.com|fb\.com|pancake\.vn|pages\.fm/i.test(t))
    return "Đây là đường link, không phải token. Token lấy ở Pancake: mở page → Cài đặt → Công cụ → Page Access Token.";
  if (/\s/.test(t)) return "Token không có dấu cách — copy lại cho đúng.";
  if (t.length < 20) return "Token quá ngắn — copy lại cho đủ.";
  return null;
}

/** Đổi lời báo lỗi tiếng Anh của Pancake sang việc cần làm. */
function explainPancakeError(message: string): string {
  if (/invalid\s*access[_ ]?token|access[_ ]?token.*(invalid|expired)/i.test(message))
    return "Pancake không nhận token — bấm Sửa: kiểm tra ID page là dãy số, rồi dán lại Page Access Token lấy đúng ở page đó (Cài đặt → Công cụ)";
  return message;
}

/** Giờ Việt Nam "HH:mm" và "dd/mm HH:mm" (không import crm.ts để chạy được trong kiểm thử bằng node). */
function vnClock(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { time: `${p.hour}:${p.minute}`, short: `${p.day}/${p.month} ${p.hour}:${p.minute}` };
}

export type PancakeHealth = { tone: "ok" | "waiting" | "warn" | "error" | "paused"; label: string };

/** Tình trạng một kết nối để hiện cho người xem (một dòng). */
export function pancakeHealth(conn: PancakePage, now: Date = new Date()): PancakeHealth {
  if (!conn.is_active) return { tone: "paused", label: "Đang tạm dừng — số mới không được kéo về" };
  if (conn.last_error) {
    const since = vnClock(conn.last_error_at);
    const text = explainPancakeError(conn.last_error);
    return { tone: "error", label: since ? `${text} (lúc ${since.time})` : text };
  }
  const ok = vnClock(conn.last_ok_at);
  if (!ok || !conn.last_ok_at) return { tone: "waiting", label: "Đang chờ lần hỏi Pancake đầu tiên (1–2 phút)" };
  const minutes = (now.getTime() - new Date(conn.last_ok_at).getTime()) / 60000;
  if (minutes > 5) return { tone: "warn", label: `Lần hỏi được gần nhất ${ok.short} — lịch chạy có thể đang dừng` };
  return { tone: "ok", label: `Đang chạy · hỏi Pancake lần cuối lúc ${ok.time}` };
}

/** Link mở đúng hội thoại trong Pancake. */
export const pancakeConversationUrl = (pancakePageId: string, conversationId: string) =>
  `https://pancake.vn/${encodeURIComponent(pancakePageId)}?c_id=${encodeURIComponent(conversationId)}`;
