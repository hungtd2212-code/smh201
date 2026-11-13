/**
 * Phần tính toán thuần của "Báo cáo Telegram" (không gọi mạng) để kiểm thử riêng được: tests/ads-auto.test.mjs.
 * Gọi cơ sở dữ liệu ở ./telegram.ts.
 */
export type TelegramChat = { chat_id: string; title: string | null; type: string | null };

export type OutboxItem = {
  id: number;
  batch_id: string;
  kind: "auto" | "manual";
  report_date: string;
  seq: number;
  title: string;
  status: "queued" | "sending" | "sent" | "failed";
  sent_at: string | null;
  error: string | null;
  created_at: string;
};

export type TelegramStatus = {
  has_token: boolean;
  token_hint: string | null;
  token_set_at: string | null;
  token_set_by: string | null;
  bot_username: string | null;
  chat_id: string | null;
  chat_title: string | null;
  enabled: boolean;
  send_hour: number;
  last_sent_for: string | null;
  last_error: string | null;
  last_error_at: string | null;
  /** Tin chưa gửi xong + lượt hỏi Telegram đang chờ. */
  pending: number;
  chats: TelegramChat[];
  /** 30 tin gần nhất, mới nhất trước. */
  recent: OutboxItem[];
};

export type ReportPreview = { missing: string | null; messages: { title: string; body: string }[] };

/** Token bot Telegram có đúng dạng không (như kiểm tra trong cơ sở dữ liệu). Bỏ khoảng trắng / xuống dòng 2 đầu. */
export function cleanBotToken(raw: string): { token: string; ok: boolean } {
  const token = raw.trim();
  return { token, ok: /^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$/.test(token) };
}

/** Lượt gửi gần nhất (các tin cùng batch_id), kèm số tin đã tới / lỗi. */
export function lastBatch(recent: OutboxItem[]) {
  const first = recent[0];
  if (!first) return null;
  const items = recent.filter((o) => o.batch_id === first.batch_id).sort((a, b) => a.seq - b.seq);
  const sent = items.filter((o) => o.status === "sent");
  const failed = items.filter((o) => o.status === "failed");
  const lastSentAt = sent.map((o) => o.sent_at ?? "").sort().at(-1) || null;
  return {
    kind: first.kind,
    reportDate: first.report_date,
    total: items.length,
    sent: sent.length,
    failed: failed.length,
    waiting: items.length - sent.length - failed.length,
    error: failed.find((o) => o.error)?.error ?? null,
    lastSentAt,
  };
}
