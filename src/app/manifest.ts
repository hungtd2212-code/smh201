import type { MetadataRoute } from "next";
import { APP } from "@/lib/config";

/**
 * Cho phép "Thêm vào màn hình chính" trên điện thoại: mở như một ứng dụng riêng (không thanh địa chỉ),
 * biểu tượng logo trên nền trắng. Mở ra vào trang chủ "/", nơi chọn màn hình làm việc theo vị trí.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP.name} — ${APP.branch.name}`,
    short_name: APP.name,
    description: `Hệ thống quản lý phòng khám nha khoa ${APP.name} — cơ sở ${APP.branch.name}`,
    lang: "vi",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f9fb",
    theme_color: "#f6f9fb",
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
