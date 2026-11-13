/**
 * Thông báo trên nút chuông (supabase/026_pancake_seen_alerts.sql): hệ thống tự tạo, ví dụ khi một page mất kết
 * nối Pancake quá 3 phút và khi nối lại được. Mỗi người tự đánh dấu đã đọc. Hiện cho Admin, COO, Trưởng Telesale.
 */
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";

export type NotificationKind = "pancake_down" | "pancake_up";

export type AppNotification = {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  /** Trang trong ERP để bấm vào (luôn bắt đầu bằng "/"). */
  link: string | null;
  created_at: string;
  read: boolean;
};

/** null = cơ sở dữ liệu chưa chạy file 026 (ẩn nút chuông, không báo lỗi). */
export async function fetchNotifications(limit = 30): Promise<AppNotification[] | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("notifications")
    .select("id, kind, title, body, link, created_at, notification_reads(read_at)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isNotMigrated(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => {
    const { notification_reads: reads, ...rest } = row as typeof row & { notification_reads: { read_at: string }[] | null };
    return { ...(rest as Omit<AppNotification, "read">), read: (reads ?? []).length > 0 };
  });
}

/** Đánh dấu đã đọc: truyền danh sách mã, hoặc bỏ trống để đọc hết. */
export async function markNotificationsRead(ids?: number[]): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("notifications_mark_read", { p_ids: ids ?? null });
  if (error && !isNotMigrated(error)) throw new Error(error.message);
}

/** Chỉ cho đi tới trang trong ERP (không mở link ngoài lọt từ dữ liệu). */
export const safeInternalLink = (link: string | null | undefined) => (link && /^\/[A-Za-z0-9/_-]*$/.test(link) ? link : null);
