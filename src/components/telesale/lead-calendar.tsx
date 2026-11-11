"use client";

import { startOfDay } from "date-fns";
import { useMemo } from "react";
import { vi } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import type { Lead } from "@/lib/leads/types";
import { dayRange, isSingleDay, monthRange, type DayRange } from "./date-range";

/**
 * Lịch tháng: ngày nào có lead thì có chấm bên dưới.
 * Bấm 1 ngày → lọc theo ngày đó; bấm lại → về cả tháng. Đổi tháng → lọc theo tháng mới.
 */
export function LeadCalendar({
  leads,
  range,
  onRangeChange,
}: {
  /** Mọi lead của (các) tháng đang tải — không phụ thuộc ngày đang chọn. */
  leads: Lead[];
  range: DayRange;
  onRangeChange: (range: DayRange) => void;
}) {
  const daysWithLeads = useMemo(() => {
    const days = new Map<number, Date>();
    for (const lead of leads) {
      const day = startOfDay(new Date(lead.created_at));
      days.set(day.getTime(), day);
    }
    return [...days.values()];
  }, [leads]);

  return (
    <Calendar
      mode="single"
      locale={vi}
      month={range.from}
      onMonthChange={(month) => onRangeChange(monthRange(month))}
      selected={isSingleDay(range) ? range.from : undefined}
      onSelect={(day) =>
        onRangeChange(day ? dayRange(day) : monthRange(range.from))
      }
      modifiers={{ hasLeads: daysWithLeads }}
      modifiersClassNames={{ hasLeads: "day-has-leads" }}
      className="mx-auto w-full max-w-80 [--cell-size:--spacing(9)]"
      classNames={{ root: "mx-auto w-full max-w-80" }}
    />
  );
}
