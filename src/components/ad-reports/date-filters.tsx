"use client";

import { vi } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addDays, dateToIso, formatDay, isoToDate } from "@/lib/ad-reports/dates";

/** Bộ chọn ngày / tháng của các màn báo cáo ads. */

const pick = (active: boolean): "default" | "outline" => (active ? "default" : "outline");

/** Chọn MỘT ngày (màn Nhập liệu). */
export function SingleDayFilter({
  value,
  today,
  onChange,
}: {
  value: string;
  today: string;
  onChange: (day: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const yesterday = addDays(today, -1);
  const custom = Boolean(value) && value !== today && value !== yesterday;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={pick(value === today)} disabled={!today} onClick={() => onChange(today)}>
        Hôm nay
      </Button>
      <Button variant={pick(value === yesterday)} disabled={!today} onClick={() => onChange(yesterday)}>
        Hôm qua
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={pick(custom)} disabled={!today}>
            <CalendarDays />
            Tuỳ chỉnh
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          {today && (
            <Calendar
              mode="single"
              locale={vi}
              defaultMonth={isoToDate(value || today)}
              selected={value ? isoToDate(value) : undefined}
              disabled={{ after: isoToDate(today) }}
              onSelect={(date) => {
                if (!date) return;
                onChange(dateToIso(date));
                setOpen(false);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
      <p className="ml-1 text-sm text-muted-foreground">
        Ngày báo cáo: <span className="font-semibold text-foreground tabular-nums">{formatDay(value) || "…"}</span>
      </p>
    </div>
  );
}

/**
 * Chọn THÁNG và NĂM (màn Tổng quan). `value` dạng "yyyy-MM". Năm: từ 2024 tới năm hiện tại.
 */
export function MonthFilter({
  value,
  today,
  onChange,
}: {
  value: string;
  today: string;
  onChange: (month: string) => void;
}) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const thisYear = Number((today || value).slice(0, 4));
  const years = Array.from({ length: Math.max(1, thisYear - 2024 + 1) }, (_, i) => 2024 + i);
  if (!years.includes(year)) years.push(year);
  const set = (y: number, m: number) => onChange(`${y}-${String(m).padStart(2, "0")}`);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={String(month)} onValueChange={(m) => set(year, Number(m))}>
        <SelectTrigger className="w-32" aria-label="Tháng">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <SelectItem key={m} value={String(m)}>
              Tháng {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={String(year)} onValueChange={(y) => set(Number(y), month)}>
        <SelectTrigger className="w-28" aria-label="Năm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {today && value !== today.slice(0, 7) && (
        <Button variant="ghost" onClick={() => onChange(today.slice(0, 7))}>
          Về tháng này
        </Button>
      )}
    </div>
  );
}

