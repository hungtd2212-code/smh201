"use client";

import { Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AccessNotice } from "@/components/access-notice";
import { useCatalogs } from "@/components/catalog-provider";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isManagerRole, useCurrentStaff } from "@/hooks/use-current-staff";
import { softDeleteRecords } from "@/lib/safety/repo";
import type { SoftDeleteTable } from "@/lib/safety/types";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

/** Các mảnh dùng chung cho những trang danh mục (kênh, page, chiến dịch, dịch vụ, chia lead). */

/** true nếu người đang đăng nhập là Quản trị hoặc Lead (được thêm / sửa danh mục). */
export function useCanManage() {
  const staff = useCurrentStaff();
  return staff.status === "ok" && isManagerRole(staff.role);
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
  const [open, setOpen] = useState(false);

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

export function ActivePill({ active }: { active: boolean }) {
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
      {active ? "Đang dùng" : "Đã tắt"}
    </span>
  );
}

/** 1500000 → "1.500.000 ₫" */
export const formatVnd = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString("vi-VN")} ₫`;

/** "2026-11-11" → "11/11/2026" */
export const formatDate = (iso: string | null) =>
  iso ? iso.split("-").reverse().join("/") : "—";
