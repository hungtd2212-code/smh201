"use client";

import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { selectableStatuses } from "@/lib/leads/crm";
import { getLeadStatus } from "@/lib/leads/status";
import type { LeadStatusRow } from "@/lib/leads/types";
import { cn } from "@/lib/utils";

/** Nhãn màu của một trạng thái khách hàng (giống ô chọn trong Google Sheet). */
export function StatusChip({
  status,
  className,
}: {
  status: Pick<LeadStatusRow, "name" | "color" | "text_color">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
      style={{ backgroundColor: status.color, color: status.text_color }}
    >
      {status.name}
    </span>
  );
}

/**
 * Ô Tình trạng: bấm vào nhãn → danh sách nhãn màu để chọn. Số chưa có tình trạng hiện "Chưa xử lý";
 * lead cũ (trạng thái theo kiểu cũ, chưa đổi sang trạng thái mới) hiện nhãn cũ màu xám.
 */
export function StatusPicker({
  statuses,
  value,
  legacyStatus,
  onPick,
  disabled,
  align = "start",
  variant = "inline",
}: {
  statuses: LeadStatusRow[];
  value: string | null;
  /** Cột `status` cũ của lead — chỉ dùng để hiện khi chưa có trạng thái mới. */
  legacyStatus?: string | null;
  onPick: (statusId: string) => void;
  disabled?: boolean;
  align?: "start" | "end";
  /**
   * "inline": nhãn nhỏ gọn trong ô bảng. "field": ô chọn to, rõ, kín bề ngang như một ô nhập (cửa sổ chi tiết lead) —
   * chưa có tình trạng thì viền vàng nhắc chọn.
   */
  variant?: "inline" | "field";
}) {
  const [open, setOpen] = useState(false);
  const current = statuses.find((s) => s.id === value);
  const options = selectableStatuses(statuses, value);
  const legacy = !current && legacyStatus && legacyStatus !== "so_moi" ? getLeadStatus(legacyStatus).label : null;

  const field = variant === "field";
  const unset = !current && !legacy;

  const label = current ? (
    <StatusChip status={current} className={field ? "px-3 py-1 text-sm" : undefined} />
  ) : legacy ? (
    <span className={cn("truncate text-muted-foreground italic", field ? "text-sm" : "text-xs")}>Cũ: {legacy}</span>
  ) : field ? (
    <span className="truncate text-sm font-medium">Chưa xử lý — bấm để chọn tình trạng</span>
  ) : (
    <span className="text-xs text-muted-foreground">Chưa xử lý</span>
  );

  if (disabled) return <span className="inline-flex max-w-full">{label}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {field ? (
          <button
            type="button"
            aria-label="Đổi tình trạng"
            className={cn(
              "group flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border-2 px-2 text-left shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              unset
                ? "border-dashed border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70"
                : "border-primary/30 bg-background hover:border-primary/60 hover:bg-accent/50 data-[state=open]:border-primary/60",
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="flex min-w-0 items-center">{label}</span>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 text-xs font-medium",
                unset ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground group-hover:text-foreground",
              )}
            >
              {unset ? "Chọn" : "Đổi"}
              <ChevronDown className="size-4" />
            </span>
          </button>
        ) : (
          <button
            type="button"
            aria-label="Đổi tình trạng"
            className="group inline-flex max-w-full items-center gap-1 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={(event) => event.stopPropagation()}
          >
            {label}
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("gap-1 p-1.5", field ? "w-(--radix-popover-trigger-width) min-w-56" : "w-56")}
        onClick={(event) => event.stopPropagation()}
      >
        {options.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Chưa có trạng thái nào. Quản lý thêm ở Telesale → Cài đặt.</p>
        )}
        {options.map((s) => (
          <button
            key={s.id}
            type="button"
            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            onClick={() => {
              setOpen(false);
              if (s.id !== value) onPick(s.id);
            }}
          >
            <StatusChip status={s} />
            {s.id === value && <Check className="size-4 shrink-0 text-muted-foreground" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
