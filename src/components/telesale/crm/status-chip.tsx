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
}: {
  statuses: LeadStatusRow[];
  value: string | null;
  /** Cột `status` cũ của lead — chỉ dùng để hiện khi chưa có trạng thái mới. */
  legacyStatus?: string | null;
  onPick: (statusId: string) => void;
  disabled?: boolean;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const current = statuses.find((s) => s.id === value);
  const options = selectableStatuses(statuses, value);
  const legacy = !current && legacyStatus && legacyStatus !== "so_moi" ? getLeadStatus(legacyStatus).label : null;

  const label = current ? (
    <StatusChip status={current} />
  ) : legacy ? (
    <span className="truncate text-xs text-muted-foreground italic">Cũ: {legacy}</span>
  ) : (
    <span className="text-xs text-muted-foreground">Chưa xử lý</span>
  );

  if (disabled) return <span className="inline-flex max-w-full">{label}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Đổi tình trạng"
          className="group inline-flex max-w-full items-center gap-1 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={(event) => event.stopPropagation()}
        >
          {label}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-56 gap-1 p-1.5"
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
