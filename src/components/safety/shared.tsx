"use client";

import { AccessNotice } from "@/components/access-notice";
import { SetupNotice } from "@/components/setup-notice";
import { Skeleton } from "@/components/ui/skeleton";
import { isAdminRole, isManagerRole, useCurrentStaff } from "@/hooks/use-current-staff";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** Quyền của người đang đăng nhập đối với các chức năng an toàn dữ liệu. */
export function useRole() {
  const staff = useCurrentStaff();
  const role = staff.status === "ok" ? staff.role : null;
  return {
    staff,
    userId: staff.status === "ok" ? staff.userId : null,
    /** Quản trị cấp cao, Quản trị, Lead: được hoàn tác lead về phiên bản cũ. */
    isManager: role !== null && isManagerRole(role),
    /** Được tick quyền "Xoá dữ liệu" (hoặc là Quản trị cấp cao): thấy nút Chuyển vào thùng rác. */
    canDelete: staff.status === "ok" && staff.canDelete,
    /** Quản trị cấp cao, Quản trị: Thùng rác, Nhật ký, khoá tài khoản. */
    isAdmin: role !== null && isAdminRole(role),
    /** Quản trị cấp cao: xoá vĩnh viễn, đổi ngưỡng an toàn. */
    isSuperAdmin: role === "super_admin",
  };
}

/** Chỉ hiện nội dung cho Quản trị; người khác thấy lý do không xem được. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { staff, isAdmin } = useRole();

  if (!isSupabaseConfigured) return <SetupNotice />;
  if (staff.status === "loading") {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (staff.status === "no-access" || staff.status === "locked") {
    return <AccessNotice staff={staff} />;
  }
  if (staff.status === "error") {
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
        Không tải được thông tin tài khoản: {staff.message}
      </p>
    );
  }
  if (!isAdmin) {
    return (
      <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Trang này chỉ dành cho Quản trị.
      </p>
    );
  }
  return <>{children}</>;
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
