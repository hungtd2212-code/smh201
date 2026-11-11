"use client";

import { vi } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addDays, dateToIso, formatDay, isoToDate } from "@/lib/ad-reports/dates";

/** Bộ chọn ngày của các màn báo cáo ads: [Hôm nay] [Hôm qua] [Tuỳ chỉnh]. Không cho chọn ngày chưa tới. */

export type DayRange = { from: string; to: string };

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

/** Chọn một KHOẢNG ngày (màn Tổng quan). */
export function RangeFilter({
  value,
  today,
  onChange,
}: {
  value: DayRange;
  today: string;
  onChange: (range: DayRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from?: Date; to?: Date }>({});
  const yesterday = addDays(today, -1);
  const single = value.from === value.to;
  const isToday = single && value.from === today;
  const isYesterday = single && value.from === yesterday;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={pick(isToday)} disabled={!today} onClick={() => onChange({ from: today, to: today })}>
        Hôm nay
      </Button>
      <Button
        variant={pick(isYesterday)}
        disabled={!today}
        onClick={() => onChange({ from: yesterday, to: yesterday })}
      >
        Hôm qua
      </Button>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next && value.from) setDraft({ from: isoToDate(value.from), to: isoToDate(value.to) });
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button variant={pick(Boolean(today) && !isToday && !isYesterday)} disabled={!today}>
            <CalendarDays />
            Tuỳ chỉnh
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          {today && (
            <Calendar
              mode="range"
              locale={vi}
              numberOfMonths={2}
              defaultMonth={addMonthsBack(isoToDate(value.to || today))}
              selected={draft.from ? { from: draft.from, to: draft.to } : undefined}
              disabled={{ after: isoToDate(today) }}
              onSelect={(next) => setDraft(next ?? {})}
            />
          )}
          <div className="flex justify-end gap-2 border-t px-1 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button
              disabled={!draft.from}
              onClick={() => {
                if (!draft.from) return;
                onChange({ from: dateToIso(draft.from), to: dateToIso(draft.to ?? draft.from) });
                setOpen(false);
              }}
            >
              Áp dụng
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <p className="ml-1 text-sm text-muted-foreground tabular-nums">
        {!value.from ? (
          "…"
        ) : single ? (
          <>
            Ngày <span className="font-semibold text-foreground">{formatDay(value.from)}</span>
          </>
        ) : (
          <>
            Từ <span className="font-semibold text-foreground">{formatDay(value.from)}</span> đến{" "}
            <span className="font-semibold text-foreground">{formatDay(value.to)}</span>
          </>
        )}
      </p>
    </div>
  );
}

/** Lịch hai tháng: hiện tháng trước và tháng đang chọn (tháng đang chọn ở bên phải). */
function addMonthsBack(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}
