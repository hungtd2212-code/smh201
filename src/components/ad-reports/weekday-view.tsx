"use client";

import { Trophy } from "lucide-react";
import {
  METRICS,
  WEEKDAYS,
  compactMetric,
  daysBetween,
  firstDayOf,
  formatMetric,
  lastDayOf,
  totalsByWeekday,
  weekdayOf,
  zero,
  type Metric,
  type Totals,
} from "@/lib/ad-reports/aggregate";
import { formatDay, monthLabel } from "@/lib/ad-reports/dates";
import { cn } from "@/lib/utils";
import { ChartCard } from "./charts";
import { FIRST_TH, TD, TH } from "./period-table";

/**
 * Phân tích → Theo thứ & ngày (kiểu chia theo ngày của Meta Ads Manager):
 *   • bảng thứ trong tuần (T2 … CN): mỗi thứ trung bình tiêu bao nhiêu, ra bao nhiêu mess / data, giá bao nhiêu;
 *   • lịch nhiệt từng tháng: ô càng đậm, chỉ số ngày đó càng cao.
 * Màu: một màu xanh, nhạt → đậm theo độ lớn (không mang nghĩa tốt / xấu); ô tốt nhất có hình cúp.
 */

/** Nền ô theo độ lớn (0 → 1): pha màu xanh vào nền; ô đậm thì chữ trắng. */
function heat(share: number | null) {
  if (share === null) return {};
  const pct = Math.round(8 + share * 72);
  return {
    style: { backgroundColor: `color-mix(in oklab, var(--heat) ${pct}%, transparent)` },
    dark: pct >= 52,
  };
}

/** Giá trị "mỗi ngày" của chỉ số cộng dồn (chia cho số ngày); chỉ số tính ra giữ nguyên. */
const perDay = (metric: Metric, totals: Totals, days: number) => {
  const v = metric.value(totals);
  if (v === null) return null;
  return metric.kind === "sum" ? (days > 0 ? v / days : null) : v;
};

export function WeekdayView({
  months,
  byDay,
  today,
  metric,
  metricTabs,
  who,
}: {
  months: string[];
  byDay: Map<string, Totals>;
  today: string;
  metric: Metric;
  metricTabs: React.ReactNode;
  who: string;
}) {
  // Chỉ tính những ngày đã qua (tới hôm nay).
  const days = months.flatMap((m) => daysBetween(firstDayOf(m), lastDayOf(m))).filter((d) => d <= today);
  const week = totalsByWeekday(byDay, days);

  return (
    <div className="grid gap-5 [--heat:#2a78d6] dark:[--heat:#3987e5]">
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Theo thứ trong tuần{who ? ` — ${who}` : ""}</h2>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            Chi tiêu, mess, data: trung bình mỗi ngày. Ô càng đậm càng cao.
            <Trophy className="ml-1 size-3.5 text-emerald-600 dark:text-emerald-400" /> thứ tốt nhất
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="table-pin w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className={FIRST_TH}>Chỉ số</th>
                {WEEKDAYS.map((w, i) => (
                  <th key={w} className={cn(TH, "bg-muted text-center")}>
                    {w}
                    <div className="text-[11px] font-normal text-muted-foreground">{week[i].days} ngày</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const values = week.map((w) => perDay(m, w.totals, w.days));
                const known = values.filter((v): v is number => v !== null);
                const max = known.length > 0 ? Math.max(...known) : 0;
                const best =
                  m.better === null || known.length < 2 ? null : m.better === "up" ? Math.max(...known) : Math.min(...known);
                return (
                  <tr key={m.key} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      {m.kind === "sum" ? `${m.label} / ngày` : m.label}
                    </td>
                    {values.map((v, i) => {
                      const h = heat(v === null || max === 0 ? null : v / max);
                      return (
                        <td key={i} className={cn(TD, "text-center", h.dark && "text-white")} style={h.style}>
                          <span className="inline-flex items-center gap-1">
                            {best !== null && v === best && v !== 0 && (
                              <Trophy className={cn("size-3.5", h.dark ? "text-white" : "text-emerald-600 dark:text-emerald-400")} />
                            )}
                            {formatMetric(m, v)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ChartCard
        title={`Lịch nhiệt — ${metric.label}`}
        note="Mỗi ô một ngày; ô càng đậm thì chỉ số ngày đó càng cao. Ô trống: chưa có số (hoặc không tính được)."
        actions={metricTabs}
      >
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {months.map((month) => (
            <MonthCalendar key={month} month={month} byDay={byDay} today={today} metric={metric} days={days} />
          ))}
        </div>
      </ChartCard>
    </div>
  );
}

function MonthCalendar({
  month,
  byDay,
  today,
  metric,
  days,
}: {
  month: string;
  byDay: Map<string, Totals>;
  today: string;
  metric: Metric;
  /** Mọi ngày đang xem — để mọi tháng dùng chung một thang màu. */
  days: string[];
}) {
  const scaleMax = Math.max(0, ...days.map((d) => metric.value(byDay.get(d) ?? zero()) ?? 0));
  const monthDays = daysBetween(firstDayOf(month), lastDayOf(month));
  const blanks = weekdayOf(monthDays[0]);
  return (
    <div className="grid gap-1.5">
      <h3 className="text-sm font-medium">{monthLabel(month)}</h3>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {monthDays.map((day) => {
          const future = day > today;
          const t = byDay.get(day);
          const v = t ? metric.value(t) : null;
          const h = heat(v === null || scaleMax === 0 || future ? null : v / scaleMax);
          return (
            <div
              key={day}
              title={`${formatDay(day)}: ${future ? "chưa tới" : formatMetric(metric, v, true)}`}
              className={cn(
                "flex aspect-square min-h-9 flex-col items-center justify-center rounded-md border text-[11px] leading-tight",
                future ? "border-dashed text-muted-foreground/50" : "border-transparent bg-muted/40",
                h.dark && "text-white",
              )}
              style={h.style}
            >
              <span className={cn("font-medium", !h.dark && "text-muted-foreground")}>{Number(day.slice(8))}</span>
              {!future && v !== null && v !== 0 && <span className="font-semibold tabular-nums">{compactMetric(metric, v)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
