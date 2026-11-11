/**
 * Biến môi trường Supabase. Lấy ở Supabase Dashboard → Project Settings → API Keys.
 * Hỗ trợ cả tên mới (PUBLISHABLE_KEY) lẫn tên cũ (ANON_KEY).
 *
 * Đây là khoá công khai, được phép nằm trong trình duyệt. Việc bảo vệ dữ liệu
 * do Row Level Security trong `supabase/schema.sql` đảm nhiệm.
 * KHÔNG bao giờ đặt khoá `service_role` / `secret` vào biến NEXT_PUBLIC_*.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

/** false = chưa kết nối → ứng dụng chạy bằng dữ liệu mẫu, không cần đăng nhập. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);
