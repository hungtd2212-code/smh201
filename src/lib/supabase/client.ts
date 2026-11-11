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
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
}
