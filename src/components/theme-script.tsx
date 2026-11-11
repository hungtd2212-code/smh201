"use client";

import { THEME_INIT_SCRIPT } from "@/hooks/use-theme";

/**
 * Bật giao diện tối (nếu người dùng đã chọn) ngay khi trình duyệt đọc HTML,
 * trước khi trang được vẽ → không bị nháy sáng.
 *
 * Mẹo `type`: trên máy chủ là script thật (chạy ngay); khi React dựng lại ở
 * trình duyệt thì là "text/plain" (không chạy lại, React không cảnh báo).
 * Cách làm theo hướng dẫn "Preventing Flash" của Next.js.
 */
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  );
}
