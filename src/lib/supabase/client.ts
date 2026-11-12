import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./env";

/** Supabase client dùng trong trình duyệt (Client Components). */
export function getSupabaseBrowserClient() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Chưa cấu hình Supabase: thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY trong .env.local",
    );
  }
  // createBrowserClient tự tái sử dụng một client duy nhất trong trình duyệt.
  // worker: nhịp "còn sống" của Realtime (dãy người đang online) chạy trong Web Worker, để tab nằm
  // nền lâu không bị trình duyệt hãm chậm rồi rớt khỏi danh sách online.
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { worker: true } });
}
