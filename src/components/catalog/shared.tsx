"use client";

import { Trash2, type LucideIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AccessNotice } from "@/components/access-notice";
import { useCatalogs } from "@/components/catalog-provider";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isManagerRole, managesMarketingRole, useCurrentStaff } from "@/hooks/use-current-staff";
import { softDeleteRecords } from "@/lib/safety/repo";
import type { SoftDeleteTable } from "@/lib/safety/types";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

/** Các mảnh dùng chung cho những trang danh mục (kênh, page, chiến dịch, dịch vụ, chia lead). */

/** true nếu người đang đăng nhập là Quản trị hoặc Trưởng Telesale (sửa dịch vụ, chia lead). */
export function useCanManage() {
  const staff = useCurrentStaff();
  return staff.status === "ok" && isManagerRole(staff.role);
}

/** true nếu người đang đăng nhập là Quản trị hoặc Trưởng Marketing (thêm / sửa danh mục Marketing). */
export function useManagesMarketing() {
  const staff = useCurrentStaff();
  return staff.status === "ok" && managesMarketingRole(staff.role);
}

/**
 * Báo "chưa dùng được" khi cơ sở dữ liệu chưa có danh mục Marketing; đã sẵn sàng thì không hiện gì.
 */
export function MarketingNotReady({ what }: { what: string }) {
  const { catalogs, ready } = useCatalogs();
  if (!ready || catalogs.marketingReady) return null;
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      {what} chưa dùng được: cơ sở dữ liệu chưa được cập nhật cho phân hệ Marketing (file{" "}
      <code>supabase/005_marketing_catalog.sql</code> chưa chạy). Các phần cũ vẫn chạy bình thường.
    </p>
  );
}

/** Dòng báo "chỉ xem" cho người không có quyền thêm / sửa ở trang đang mở. */
export function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{children}</p>
  );
}

/** Tiêu đề trang: ô biểu tượng màu logo + tên + mô tả + nút hành động bên phải. */
export function PageHeader({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid gap-1">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-linear-to-br from-brand-teal to-brand-blue text-white">
            <Icon className="size-4" />
          </span>
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** Chỉ hiện nội dung khi đã kết nối và tải xong danh mục; nếu không thì báo lý do. */
export function CatalogGate({ children }: { children: React.ReactNode }) {
  const { ready, error } = useCatalogs();
  const staff = useCurrentStaff();

  if (!isSupabaseConfigured) return <SetupNotice />;
  if (staff.status === "no-access" || staff.status === "locked") {
    return <AccessNotice staff={staff} />;
  }
  if (!ready) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
        <p className="font-medium text-destructive">Không tải được danh mục</p>
        <p className="mt-1 text-muted-foreground">{error}</p>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Nút chuyển một dòng danh mục vào Thùng rác, có hỏi lại trước khi chuyển.
 * Chỉ hiện với tài khoản được tick quyền "Xoá dữ liệu".
 * `what` là tên gọi kèm loại, ví dụ "kênh Zalo".
 */
export function DeleteRowButton({
  table,
  id,
  what,
}: {
  table: SoftDeleteTable;
  id: string;
  what: string;
}) {
  const { reload } = useCatalogs();
  const staff = useCurrentStaff();
  const [open, setOpen] = useState(false);

  if (staff.status !== "ok" || !staff.canDelete) return null;

  async function remove() {
    await softDeleteRecords(table, [id]);
    toast.success(`Đã chuyển ${what} vào Thùng rác`);
    await reload();
  }

  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={`Chuyển ${what} vào thùng rác`}
        title="Chuyển vào thùng rác" onClick={() => setOpen(true)}>
        <Trash2 />
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Chuyển ${what} vào thùng rác?`}
        description={
          <>
            <p>
              Mục này sẽ được chuyển vào Thùng rác và không còn hiện trong các form. Lead cũ vẫn
              giữ đúng tên kèm chữ “(trong thùng rác)”.
            </p>
            <p>
              Nếu chỉ muốn tạm ngừng dùng, hãy bấm Sửa rồi bỏ tick “Đang dùng”. Quản
              trị có thể khôi phục trong Cài đặt → Thùng rác.
            </p>
          </>
        }
        confirmLabel="Chuyển vào Thùng rác"
        destructive
        onConfirm={remove}
      />
    </>
  );
}

export function ActivePill({
  active,
  onLabel = "Đang dùng",
  offLabel = "Đã tắt",
}: {
  active: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        active
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/50")} />
      {active ? onLabel : offLabel}
    </span>
  );
}

/** 1500000 → "1.500.000 ₫" */
export const formatVnd = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString("vi-VN")} ₫`;

/** Ngày hôm nay theo giờ Việt Nam, dạng yyyy-MM-dd. Chỉ gọi trong xử lý sự kiện; lúc vẽ màn hình dùng `useTodayVn()`. */
export const todayVn = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

const neverChanges = () => () => {};
const noDay = () => "";

/**
 * Ngày hôm nay theo giờ Việt Nam (yyyy-MM-dd) để dùng lúc vẽ màn hình. Khi Next.js dựng sẵn trang
 * trên máy chủ thì trả về "" (lúc đó chưa có dữ liệu nào để so ngày) — tránh "đóng băng" ngày dựng trang.
 */
export const useTodayVn = () => useSyncExternalStore(neverChanges, todayVn, noDay);

/** "2026-11-11" → "11/11/2026" */
export const formatDate = (iso: string | null) =>
  iso ? iso.split("-").reverse().join("/") : "—";
