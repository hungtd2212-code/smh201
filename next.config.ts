import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Ẩn nút công cụ nổi của Next.js khi chạy dev để không che giao diện.
  devIndicators: false,
  // Trang chủ "/" chọn màn hình đầu tiên theo vị trí công việc: src/app/(app)/page.tsx.
  async redirects() {
    return [
      { source: "/telesale", destination: "/telesale/leads", permanent: false },
      // "Chia lead / Chia ca" cũ: phần chia số nay nằm ở Telesale → Cài đặt.
      { source: "/telesale/chia-lead", destination: "/telesale/cai-dat", permanent: false },
    ];
  },
};

export default nextConfig;
