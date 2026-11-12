"use client";

import { vi } from "date-fns/locale";
import { CalendarDays, CalendarRange, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { monthsBetween, shiftMonth } from "@/lib/ad-reports/aggregate";
import { dateToIso, formatDay, isoToDate } from "@/lib/ad-reports/dates";
import { cn } from "@/lib/utils";

/** Bộ chọn khoảng thời gian của Tổng quan / Phân tích: nhiều tháng, cả năm, nhiều năm, khoảng ngày. */

const pad = (n: number) => String(n).padStart(2, "0");
const monthKey = (year: number, month: number) => `${year}-${pad(month)}`;

/** Năm sớm nhất có thể chọn: năm đầu tiên có TKQC (tối thiểu 2 năm gần nhất, tối đa 6 năm). */
export function yearOptions(thisYear: number, firstYear: number) {
  const from = Math.max(thisYear - 5, Math.min(firstYear, thisYear - 1));
  return Array.from({ length: thisYear - from + 1 }, (_, i) => from + i);
}

/** Tên ngắn của một lựa chọn tháng: "Tháng 11/2026", "Cả năm 2026", "3 tháng (T9 – T11/2026)"… */
export function monthsLabel(months: string[], today: string) {
  if (months.length === 0) return "Chưa chọn tháng";
  if (months.length === 1) return `Tháng ${Number(months[0].slice(5))}/${months[0].slice(0, 4)}`;
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const thisMonth = today.slice(0, 7);
  const fullYears = years.filter((y) => {
    const expected = monthsBetween(`${y}-01`, `${y}-12`).filter((m) => m <= thisMonth);
    return expected.every((m) => months.includes(m));
  });
  if (fullYears.length === years.length && months.every((m) => m <= thisMonth)) {
    return `Cả năm ${years.join(", ")}`;
  }
  const contiguous = monthsBetween(months[0], months.at(-1) ?? months[0]).length === months.length;
  const short = (m: string) => `T${Number(m.slice(5))}/${m.slice(0, 4)}`;
  if (contiguous) return `${months.length} tháng (${short(months[0])} – ${short(months.at(-1) ?? months[0])})`;
  return `${months.length} tháng đã chọn`;
}

/**
 * Chọn MỘT HAY NHIỀU THÁNG (tick từng tháng, tick "Cả năm", có thể nhiều năm). `value`: các tháng yyyy-MM
 * đã sắp xếp. Không cho bỏ tick tháng cuối cùng; tháng chưa tới không chọn được.
 */
export function MonthsPicker({
  value,
  today,
  years,
  onChange,
}: {
  value: string[];
  today: string;
  years: number[];
  onChange: (months: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const thisMonth = today.slice(0, 7);
  const selected = new Set(value);
  const commit = (next: Set<string>) => {
    if (next.size === 0) return;
    onChange([...next].sort());
  };
  const toggleMonth = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    commit(next);
  };
  const monthsOfYear = (year: number) =>
    monthsBetween(`${year}-01`, `${year}-12`).filter((m) => m <= thisMonth);
  const toggleYear = (year: number) => {
    const months = monthsOfYear(year);
    const all = months.every((m) => selected.has(m));
    const next = new Set(selected);
    for (const m of months) {
      if (all) next.delete(m);
      else next.add(m);
    }
    commit(next);
  };
  const set = (months: string[]) => onChange([...months].sort());
  const thisYear = Number(thisMonth.slice(0, 4));
  const quick: { label: string; months: string[] }[] = [
    { label: "Tháng này", months: [thisMonth] },
    { label: "Tháng trước", months: [shiftMonth(thisMonth, -1)] },
    { label: "3 tháng gần nhất", months: monthsBetween(shiftMonth(thisMonth, -2), thisMonth) },
    { label: "Năm nay", months: monthsOfYear(thisYear) },
    { label: "Năm ngoái", months: monthsOfYear(thisYear - 1) },
  ];
  const same = (a: string[]) => a.length === value.length && a.every((m) => selected.has(m));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="min-w-56 justify-between font-medium" disabled={!today}>
          <span className="flex items-center gap-2">
            <CalendarRange className="text-muted-foreground" />
            {monthsLabel(value, today)}
          </span>
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-3">
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <Button
              key={q.label}
              size="sm"
              variant={same(q.months) ? "default" : "outline"}
              onClick={() => set(q.months)}
            >
              {q.label}
            </Button>
          ))}
        </div>
        <div className="mt-3 grid max-h-[22rem] gap-3 overflow-y-auto border-t pt-3">
          {[...years].reverse().map((year) => {
            const months = monthsOfYear(year);
            const picked = months.filter((m) => selected.has(m)).length;
            return (
              <div key={year} className="grid gap-1.5">
                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={months.length > 0 && picked === months.length}
                    disabled={months.length === 0}
                    ref={(el) => {
                      if (el) el.indeterminate = picked > 0 && picked < months.length;
                    }}
                    onChange={() => toggleYear(year)}
                  />
                  Cả năm {year}
                </label>
                <div className="grid grid-cols-6 gap-1">
                  {Array.from({ length: 12 }, (_, i) => {
                    const key = monthKey(year, i + 1);
                    const on = selected.has(key);
                    const future = key > thisMonth;
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={future}
                        aria-pressed={on}
                        onClick={() => toggleMonth(key)}
                        className={cn(
                          "flex h-8 items-center justify-center gap-0.5 rounded-md border text-sm tabular-nums transition-colors",
                          on
                            ? "border-primary bg-primary font-medium text-primary-foreground"
                            : "bg-background hover:bg-muted",
                          future && "cursor-not-allowed opacity-40 hover:bg-background",
                        )}
                      >
                        {on && <Check className="size-3" />}T{i + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">Đã chọn {value.length} tháng</span>
          <Button size="sm" onClick={() => setOpen(false)}>
            Xong
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Tick chọn một hay nhiều năm (luôn còn ít nhất một năm). */
export function YearsPicker({
  value,
  years,
  onChange,
}: {
  value: number[];
  years: number[];
  onChange: (years: number[]) => void;
}) {
  const toggle = (year: number) => {
    const next = value.includes(year) ? value.filter((y) => y !== year) : [...value, year];
    if (next.length > 0) onChange(next.sort((a, b) => a - b));
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Chọn năm">
      {years.map((year) => {
        const on = value.includes(year);
        return (
          <Button key={year} size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => toggle(year)}>
            {on && <Check />}
            {year}
          </Button>
        );
      })}
    </div>
  );
}

export type DayRange = { from: string; to: string };

/** Chọn một khoảng ngày trên lịch (không chọn được ngày chưa tới). */
export function RangePicker({
  label,
  value,
  today,
  onChange,
}: {
  label: string;
  value: DayRange;
  today: string;
  onChange: (range: DayRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from?: Date; to?: Date }>({});

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft({ from: isoToDate(value.from), to: isoToDate(value.to) });
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="font-medium tabular-nums" disabled={!today}>
          <CalendarDays className="text-muted-foreground" />
          <span className="text-muted-foreground">{label}:</span>
          {formatDay(value.from)} – {formatDay(value.to)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        {today && (
          <Calendar
            mode="range"
            locale={vi}
            numberOfMonths={2}
            defaultMonth={isoToDate(value.from)}
            disabled={{ after: isoToDate(today) }}
            selected={draft.from ? { from: draft.from, to: draft.to } : undefined}
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
  );
}
