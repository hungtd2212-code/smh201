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
    ];
  },
};

export default nextConfig;
