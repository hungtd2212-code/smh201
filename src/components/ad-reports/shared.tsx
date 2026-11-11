import Link from "next/link";

/** Lời báo khi cơ sở dữ liệu chưa có bảng báo cáo ads hằng ngày. */
export function NotReady() {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      Màn này chưa dùng được: cơ sở dữ liệu chưa được cập nhật cho báo cáo ads hằng ngày (file{" "}
      <code>supabase/006_ad_daily_reports.sql</code> chưa chạy). Các phần khác vẫn chạy bình thường.
    </p>
  );
}

export function StatsError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
      <p className="font-medium text-destructive">Không tải được báo cáo</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * Đường tới các trang danh mục (tạm ẩn khỏi menu Marketing) cho Quản trị / Trưởng Marketing:
 * giao TK ADS cho nhân viên, gắn tài khoản đăng nhập cho nhân viên Ads.
 */
export function ManagerLinks() {
  const link = "font-medium text-foreground underline underline-offset-2 hover:text-primary";
  return (
    <p className="text-sm text-muted-foreground">
      Dành cho quản lý: giao TK ADS cho từng nhân viên ở trang{" "}
      <Link href="/marketing/tkqc-page" className={link}>
        TKQC &amp; Page
      </Link>
      ; gắn tài khoản đăng nhập cho nhân viên ở trang{" "}
      <Link href="/marketing/nhan-vien-ads" className={link}>
        Nhân viên Ads
      </Link>
      .
    </p>
  );
}
