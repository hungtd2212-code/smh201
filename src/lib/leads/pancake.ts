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
 * Lấy ID page Pancake từ chữ người dùng dán: ID trần ("105738241234567", "tt_6711…"), link Pancake
 * (pancake.vn/<id>?c_id=…), link Facebook có ID số (profile.php?id=…, facebook.com/<số>) hoặc mã bài
 * "idpage_idbài". Không nhận ra thì trả null.
 */
export function parsePancakePageId(input: string | null | undefined): string | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  if (/^[A-Za-z0-9_-]{3,80}$/.test(text)) {
    const post = text.match(/^(\d{6,})_\d{6,}$/);
    return post ? post[1] : text;
  }
  const pancake = text.match(/(?:pancake\.vn|pages\.fm)\/([A-Za-z0-9_-]{3,80})(?=[/?#]|$)/i);
  if (pancake && !/^(api|dashboard|login|setting|settings)$/i.test(pancake[1])) return pancake[1];
  const facebook =
    text.match(/[?&]id=(\d{6,})(?=&|#|$)/) ??
    text.match(/facebook\.com\/(?:pages\/[^/?#]+\/)?(\d{6,})(?=[/?#]|$)/i);
  return facebook ? facebook[1] : null;
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
    return { tone: "error", label: since ? `${conn.last_error} (lúc ${since.time})` : conn.last_error };
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
