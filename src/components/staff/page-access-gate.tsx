"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { NAV_PAGES, visiblePages } from "@/lib/nav";

const MENU_PAGES = new Set(NAV_PAGES.map((page) => page.href));

/**
 * Chặn mở thẳng (gõ địa chỉ) một trang trên menu mà tài khoản chưa được tick quyền xem.
 * Trang chủ đưa tới trang đầu tiên người đó được xem. Quyền dữ liệu vẫn do Supabase kiểm soát.
 */
export function PageAccessGate({ children }: { children: React.ReactNode }) {
  const staff = useCurrentStaff();
  const pathname = usePathname();
  const router = useRouter();

  const restricted = staff.status === "ok" && staff.role !== "super_admin" && staff.pageAccess !== null;
  const allowed = restricted ? visiblePages(staff.role, staff.pageAccess) : [];
  const blocked = restricted && MENU_PAGES.has(pathname) && !allowed.includes(pathname);
  const firstAllowed = allowed[0];

  // Vào trang chủ (mặc định là Leads) mà không được xem Leads → chuyển tới trang đầu tiên được xem.
  useEffect(() => {
    if (blocked && firstAllowed && pathname === "/telesale/leads") router.replace(firstAllowed);
  }, [blocked, firstAllowed, pathname, router]);

  if (!blocked) return <>{children}</>;
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="grid gap-1">
        {firstAllowed ? (
          <>
            <p>Bạn chưa được cấp quyền xem trang này.</p>
            <p>
              <Link href={firstAllowed} className="font-medium underline underline-offset-2">
                Về trang của bạn
              </Link>
            </p>
          </>
        ) : (
          <p>
            Tài khoản của bạn chưa được phân quyền trang nào. Nhờ Quản trị phân quyền ở Cài đặt → Tài khoản &amp; Phân
            quyền.
          </p>
        )}
      </div>
    </div>
  );
}
