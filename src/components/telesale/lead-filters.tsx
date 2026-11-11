"use client";

import { isSameDay, subDays, subMonths } from "date-fns";
import { CalendarDays, Download, Funnel, RefreshCw } from "lucide-react";
import { useState } from "react";
import { vi } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  dayRange,
  formatRange,
  isSingleDay,
  isWholeMonth,
  monthKey,
  monthRange,
  type DayRange,
} from "./date-range";

type Props = {
  range: DayRange;
  onRangeChange: (range: DayRange) => void;
  loading: boolean;
  onRefresh: () => void;
  onExport: () => void;
  exporting: boolean;
  canExport: boolean;
};

export function LeadFilters({
  range,
  onRangeChange,
  loading,
  onRefresh,
  onExport,
  exporting,
  canExport,
}: Props) {
  const today = new Date();
  const yesterday = subDays(today, 1);

  // 12 tháng gần nhất, cộng thêm tháng đang xem nếu nó cũ hơn.
  const months = Array.from({ length: 12 }, (_, i) => subMonths(today, i));
  if (!months.some((m) => monthKey(m) === monthKey(range.from))) {
    months.push(range.from);
  }
  const selectedMonth = isWholeMonth(range) ? monthKey(range.from) : "";

  const isDay = (day: Date) =>
    isSingleDay(range) && isSameDay(range.from, day);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Funnel className="size-4" />
        Bộ lọc:
      </span>

      <RangePicker range={range} onApply={onRangeChange} />

      <Select
        value={selectedMonth}
        onValueChange={(key) => {
          const [year, month] = key.split("-").map(Number);
          onRangeChange(monthRange(new Date(year, month - 1, 1)));
        }}
      >
        <SelectTrigger className="w-40" aria-label="Chọn tháng">
          <SelectValue placeholder="Chọn tháng" />
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={monthKey(m)} value={monthKey(m)}>
              Tháng {m.getMonth() + 1}/{m.getFullYear()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        className={cn(isDay(today) && "bg-muted")}
        onClick={() => onRangeChange(dayRange(today))}
      >
        Hôm nay
      </Button>
      <Button
        variant="outline"
        className={cn(isDay(yesterday) && "bg-muted")}
        onClick={() => onRangeChange(dayRange(yesterday))}
      >
        Hôm qua
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Tải lại dữ liệu"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
        <Button
          variant="outline"
          onClick={onExport}
          disabled={!canExport || exporting}
        >
          <Download />
          {exporting ? "Đang xuất…" : "Tải Excel"}
        </Button>
      </div>
    </div>
  );
}

/** Ô chọn khoảng ngày tuỳ ý (từ ngày – đến ngày). */
function RangePicker({
  range,
  onApply,
}: {
  range: DayRange;
  onApply: (range: DayRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from?: Date; to?: Date }>(range);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(range);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="font-medium tabular-nums">
          <CalendarDays className="text-muted-foreground" />
          {formatRange(range)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="range"
          locale={vi}
          numberOfMonths={2}
          defaultMonth={range.from}
          selected={draft.from ? { from: draft.from, to: draft.to } : undefined}
          onSelect={(next) => setDraft(next ?? {})}
        />
        <div className="flex justify-end gap-2 border-t px-1 pt-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Huỷ
          </Button>
          <Button
            disabled={!draft.from}
            onClick={() => {
              if (!draft.from) return;
              onApply({
                from: dayRange(draft.from).from,
                to: dayRange(draft.to ?? draft.from).to,
              });
              setOpen(false);
            }}
          >
            Áp dụng
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
