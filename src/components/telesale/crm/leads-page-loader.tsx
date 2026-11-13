"use client";

import dynamic from "next/dynamic";
import { CatalogGate } from "@/components/catalog/shared";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Bảng Lead phụ thuộc vào ngày giờ hiện tại và dữ liệu của người đang đăng nhập, nên chỉ dựng trên trình duyệt
 * (không dựng sẵn trên máy chủ).
 */
const LeadsPage = dynamic(() => import("./leads-page").then((m) => m.LeadsPage), {
  ssr: false,
  loading: () => (
    <div className="grid gap-4">
      <Skeleton className="h-14 w-64" />
      <Skeleton className="h-9 w-full max-w-3xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  ),
});

export function LeadsPageLoader() {
  return (
    <CatalogGate>
      <LeadsPage />
    </CatalogGate>
  );
}
