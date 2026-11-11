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
  // Trang chủ hiện là màn hình Telesale → Leads.
  async redirects() {
    return [
      { source: "/", destination: "/telesale/leads", permanent: false },
      { source: "/telesale", destination: "/telesale/leads", permanent: false },
    ];
  },
};

export default nextConfig;
