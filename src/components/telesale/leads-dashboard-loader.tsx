"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Màn hình Leads phụ thuộc vào ngày giờ hiện tại và dữ liệu của người đang
 * đăng nhập, nên chỉ dựng trên trình duyệt (không dựng sẵn trên máy chủ).
 */
const LeadsDashboard = dynamic(
  () => import("./leads-dashboard").then((m) => m.LeadsDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-5">
        <Skeleton className="h-14 w-64" />
        <Skeleton className="h-8 w-full max-w-3xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-30 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    ),
  },
);

export function LeadsDashboardLoader() {
  return <LeadsDashboard />;
}
