/**
 * Gửi báo cáo Ads ngày vào nhóm Telegram (supabase/032_telegram_report.sql). Mọi việc đi qua các hàm của Supabase;
 * chỉ Quản trị và Trưởng Marketing dùng được. Token bot gửi đi một lần khi dán, không bao giờ đọc lại được.
 */
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";
import type { ReportPreview, TelegramStatus } from "./telegram-logic";

export * from "./telegram-logic";

export const TELEGRAM_NOT_READY = "Cơ sở dữ liệu chưa được cập nhật cho phần này (file supabase/032_telegram_report.sql chưa chạy).";

type RpcError = { message: string; code?: string };

function rpcError(error: RpcError): Error {
  if (isNotMigrated(error)) return new Error(TELEGRAM_NOT_READY);
  if (/permission denied/i.test(error.message)) return new Error("Bạn không có quyền làm việc này.");
  return new Error(error.message);
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(fn, args);
  if (error) throw rpcError(error);
  return data as T;
}

/** null = chưa chạy file 032. */
export async function fetchTelegramStatus(): Promise<TelegramStatus | null> {
  const { data, error } = await getSupabaseBrowserClient().rpc("telegram_status");
  if (error) {
    if (isNotMigrated(error)) return null;
    throw rpcError(error);
  }
  const s = data as TelegramStatus;
  return { ...s, pending: Number(s.pending ?? 0), chats: s.chats ?? [], recent: s.recent ?? [] };
}

export const saveTelegramToken = (token: string) => call<null>("telegram_save_token", { p_token: token });
export const findTelegramChats = () => call<null>("telegram_find_chats");
export const setTelegramChat = (chatId: string) => call<null>("telegram_set_chat", { p_chat_id: chatId });
export const setTelegramEnabled = (enabled: boolean) => call<null>("telegram_set_enabled", { p_enabled: enabled });
export const removeTelegramToken = () => call<null>("telegram_remove_token");
export const previewTelegramReport = (day: string) => call<ReportPreview>("telegram_preview", { p_day: day });
export const sendTelegramReport = (day: string) => call<number>("telegram_send_now", { p_day: day });
export const collectTelegramNow = () => call<{ answers?: number; pending?: number }>("telegram_collect_now");
