import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";
import type { PancakeChatResult, PancakeImport, PancakePage, PancakeSyncResult } from "./pancake";

/** Đọc / ghi phần kết nối Pancake (supabase/023_pancake_sync.sql). Chỉ Admin, COO, Trưởng Telesale. */

const NOT_READY = "Phần kết nối Pancake cần chạy file supabase/023_pancake_sync.sql trên Supabase trước.";

function pancakeError(error: { message: string; code?: string }): Error {
  if (isNotMigrated(error)) return new Error(NOT_READY);
  return new Error(error.message);
}

export async function fetchPancakePages(): Promise<PancakePage[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("pancake_pages")
    .select("id, pancake_page_id, page_id, is_active, token_hint, sync_from, last_ok_at, last_error, last_error_at, created_at")
    .order("created_at");
  if (error) throw pancakeError(error);
  return data as PancakePage[];
}

/** Các số kéo về gần đây, mới nhất trước. */
export async function fetchPancakeImports(limit = 30): Promise<PancakeImport[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("pancake_imports")
    .select("id, pancake_page_id, conversation_id, phone, full_name, conversation_type, ad_id, outcome, lead_id, error, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw pancakeError(error);
  return data as PancakeImport[];
}

/** Thêm (id null) hoặc sửa kết nối. Sửa mà để trống token thì giữ token cũ. */
export async function savePancakePage(input: {
  id: string | null;
  pancakePageId: string;
  pageId: string;
  token: string | null;
  fromToday: boolean;
}): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient().rpc("pancake_save_page", {
    p_id: input.id,
    p_pancake_page_id: input.pancakePageId,
    p_page_id: input.pageId,
    p_token: input.token,
    p_from_today: input.fromToday,
  });
  if (error) throw pancakeError(error);
  return data as string;
}

export async function setPancakeActive(id: string, active: boolean): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("pancake_set_active", { p_id: id, p_active: active });
  if (error) throw pancakeError(error);
}

/** Chạy ngay một lượt như lịch mỗi phút (đọc câu trả lời đã về, gửi lượt hỏi mới). */
export async function pancakeSyncNow(): Promise<PancakeSyncResult> {
  const { data, error } = await getSupabaseBrowserClient().rpc("pancake_sync_now");
  if (error) throw pancakeError(error);
  return (data ?? {}) as PancakeSyncResult;
}

const CHAT_NOT_READY = "Phần xem cuộc chat cần chạy file supabase/024_pancake_chat.sql trên Supabase trước.";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tải cuộc chat Pancake của một lead (30 tin gần nhất, hoặc 30 tin cũ hơn khi truyền currentCount).
 * Cơ sở dữ liệu hỏi Pancake hộ (token không về trình duyệt); hàm này chờ câu trả lời, tối đa ~25 giây.
 */
export async function loadPancakeChat(leadId: string, currentCount?: number): Promise<PancakeChatResult> {
  const supabase = getSupabaseBrowserClient();
  const chatError = (error: { message: string; code?: string }) =>
    new Error(isNotMigrated(error) ? CHAT_NOT_READY : error.message);
  const { data, error } = await supabase.rpc("pancake_chat_open", {
    p_lead_id: leadId,
    p_current_count: currentCount && currentCount > 0 ? currentCount : null,
  });
  if (error) throw chatError(error);
  const start = data as PancakeChatResult | { state: "pending"; request_id: number };
  if (start.state !== "pending") return start;

  const started = Date.now();
  for (let i = 0; Date.now() - started < 25000; i++) {
    await sleep(i < 4 ? 350 : 800);
    const { data: answer, error: readError } = await supabase.rpc("pancake_chat_read", { p_request_id: start.request_id });
    if (readError) throw chatError(readError);
    const result = answer as PancakeChatResult | { state: "pending" };
    if (result.state !== "pending") return result;
  }
  return { state: "error", message: "Pancake không trả lời kịp — bấm Tải lại" };
}
