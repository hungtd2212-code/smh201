"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { visiblePages } from "@/lib/nav";
import { DEFAULT_HOME, homeFor } from "@/lib/staff/home";

/**
 * Trang chủ "/" (sau khi đăng nhập, hoặc bấm logo): đưa mỗi người tới màn hình làm việc đầu tiên theo vị trí —
 * Lead Ads / Nhân viên quảng cáo → Nhập liệu, Admin / COO → Tổng quan, còn lại → Leads (src/lib/staff/home.ts).
 */
export default function HomePage() {
  const staff = useCurrentStaff();
  const router = useRouter();

  let target: string | null = null;
  if (staff.status === "ok") {
    const allowed = staff.role === "super_admin" ? null : visiblePages(staff.role, staff.pageAccess);
    target = homeFor(staff.position, staff.role, allowed);
  } else if (staff.status !== "loading") {
    // Dữ liệu mẫu, chưa được cấp quyền, bị khoá, lỗi: như trước — trang Leads tự báo tình trạng.
    target = DEFAULT_HOME;
  }

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Đang mở màn hình làm việc">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
