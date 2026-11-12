"use client";

import { Target } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  daysBetween,
  entriesOf,
  periodElapsed,
  sumDays,
  totalsByDay,
  trackGoals,
  trackPeriods,
  monthsBetween,
  type TrackItem,
  type TrackPeriod,
} from "@/lib/ad-reports/aggregate";
import { formatDay } from "@/lib/ad-reports/dates";
import { targetFor } from "@/lib/ad-reports/targets";
import type { AdAccountAssignment } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { useAdReports } from "./hooks";
import { revenueByMonth, useRevenue } from "./revenue";
import { StatsError } from "./shared";
import type { TargetsState } from "./targets";

/**
 * Theo dõi mục tiêu (kiểu "Monthly / Quarterly / Annual Tracking"): 3 cột Tháng · Quý · Năm, mỗi cột 6 thẻ —
 * Ngân sách, Số điện thoại, Giá số, Giá mess, Doanh thu, Ads / doanh thu. Mỗi thẻ: số hiện tại, thanh tiến độ,
 * mục tiêu, và "tốt / kém hơn kỳ vọng bao nhiêu %" (kỳ vọng = mục tiêu × phần kỳ đã qua).
 * Mục tiêu đặt theo tháng; quý = 3 tháng, năm = 12 tháng.
 */

const THEME: Record<TrackPeriod["key"], { head: string; card: string }> = {
  month: {
    head: "bg-cyan-400 text-cyan-950 dark:bg-cyan-700 dark:text-cyan-50",
    card: "bg-cyan-50 dark:bg-cyan-950/40",
  },
  quarter: {
    head: "bg-violet-400 text-violet-950 dark:bg-violet-700 dark:text-violet-50",
    card: "bg-violet-50 dark:bg-violet-950/40",
  },
  year: {
    head: "bg-pink-400 text-pink-950 dark:bg-pink-700 dark:text-pink-50",
    card: "bg-pink-50 dark:bg-pink-950/40",
  },
};

const BAR: Record<TrackItem["status"], string> = {
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  bad: "bg-red-500",
  none: "bg-muted-foreground/30",
};
const NOTE: Record<TrackItem["status"], string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-300",
  bad: "text-red-700 dark:text-red-400",
  none: "text-muted-foreground",
};

function fmt(item: TrackItem, value: number | null) {
  if (value === null) return "–";
  if (item.unit === "percent") return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
  if (item.unit === "money") return `${Math.round(value).toLocaleString("vi-VN")}đ`;
  return Math.round(value).toLocaleString("vi-VN");
}

function TrackCard({ item, period, elapsed }: { item: TrackItem; period: TrackPeriod; elapsed: number }) {
  const sign = item.kind === "progress" ? "≥" : "≤";
  const showPace = item.kind !== "cap" && item.goal !== null && elapsed > 0 && elapsed < 1;
  return (
    <div className={cn("grid gap-2 rounded-xl px-4 py-3", THEME[period.key].card)}>
      <div>
        <div className="font-semibold">
          {item.label} ({period.label})
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {formatDay(period.from).slice(0, 5)} – {formatDay(period.to)}
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr_auto] items-end gap-x-3 gap-y-1">
        <span className="text-xs text-muted-foreground">Hiện tại</span>
        <span className={cn("text-center text-xs font-medium", NOTE[item.status])}>{item.note}</span>
        <span className="text-right text-xs text-muted-foreground">Mục tiêu</span>
        <span className="text-lg font-bold tabular-nums">{fmt(item, item.actual)}</span>
        <div className="relative mb-1.5 h-3.5 rounded-full bg-white/80 dark:bg-white/10">
          <div
            className={cn("h-full rounded-full", BAR[item.status])}
            style={{ width: `${Math.min(100, Math.max(item.fill * 100, item.goal && item.actual ? 3 : 0))}%` }}
          />
          {showPace && (
            <span
              className="absolute -top-1 h-5.5 w-0.5 rounded bg-foreground/50"
              style={{ left: `${elapsed * 100}%` }}
              title="Mức kỳ vọng tới hôm nay"
            />
          )}
        </div>
        <span className="text-right text-lg font-bold whitespace-nowrap tabular-nums">
          {item.goal === null ? <span className="text-sm font-normal text-muted-foreground">—</span> : `${sign}${fmt(item, item.goal)}`}
        </span>
      </div>
    </div>
  );
}

export function GoalTrackingSection({
  staffId,
  who,
  targetsState,
  assignments,
  today,
  onEditTargets,
}: {
  /** null = cả công ty (mọi nhân viên). */
  staffId: string | null;
  who: string;
  targetsState: TargetsState;
  assignments: AdAccountAssignment[];
  today: string;
  /** Quản lý: mở hộp đặt mục tiêu. */
  onEditTargets?: () => void;
}) {
  const year = today.slice(0, 4);
  const { state } = useAdReports(`${year}-01-01`, today);
  const { state: revenue } = useRevenue(`${year}-01`, today.slice(0, 7));
  const byDay = useMemo(
    () =>
      state.status === "ready"
        ? totalsByDay(entriesOf(state.reports, state.data ?? [], assignments), staffId)
        : null,
    [state, assignments, staffId],
  );

  if (targetsState.status === "not-migrated") {
    return (
      <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        Theo dõi mục tiêu cần chạy file supabase/012_ad_targets.sql trên Supabase trước.
      </p>
    );
  }
  if (state.status === "error") return <StatsError message={state.message} />;
  if (!byDay || targetsState.status === "loading" || revenue.status === "loading") {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }
  const target = targetsState.status === "ready" ? targetFor(targetsState.targets, staffId) : null;
  const revenueMonths = revenue.status === "ready" ? revenueByMonth(revenue.rows, staffId) : new Map<string, number>();
  const periods = trackPeriods(today);
  const columns = periods.map((period) => {
    const elapsed = periodElapsed(period, today);
    const actual = sumDays(byDay, daysBetween(period.from, today < period.to ? today : period.to));
    const money = monthsBetween(period.from.slice(0, 7), today.slice(0, 7) < period.to.slice(0, 7) ? today.slice(0, 7) : period.to.slice(0, 7))
      .reduce((s, m) => s + (revenueMonths.get(m) ?? 0), 0);
    return { period, elapsed, items: trackGoals(actual, money, target, period.months, elapsed) };
  });

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="flex items-center gap-2 font-medium">
            <Target className="size-4 text-muted-foreground" />
            Theo dõi mục tiêu — {who}
          </h2>
          <p className="text-sm text-muted-foreground">
            “Kỳ vọng” = mục tiêu × phần thời gian đã qua của kỳ. Vạch đứng trên thanh: mức kỳ vọng tới hôm nay.
            {revenue.status === "not-migrated" && " Doanh thu cần chạy file 013 mới có số."}
          </p>
        </div>
        {onEditTargets && (
          <Button size="sm" variant="outline" onClick={onEditTargets}>
            <Target />
            {target ? "Sửa mục tiêu" : "Đặt mục tiêu"}
          </Button>
        )}
      </div>
      {!target && (
        <p className="rounded-xl border border-dashed px-4 py-2.5 text-sm text-muted-foreground">
          Chưa đặt mục tiêu{staffId ? " cho người này" : " cho cả công ty"} — các thẻ dưới chỉ hiện số thực đạt.
          {onEditTargets ? " Bấm “Đặt mục tiêu” để có thanh tiến độ." : " Quản lý sẽ đặt mục tiêu cho bạn."}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        {columns.map(({ period, elapsed, items }) => (
          <div key={period.key} className="grid content-start gap-3">
            <div className={cn("rounded-xl px-4 py-3 text-lg font-bold", THEME[period.key].head)}>
              Theo dõi {period.label.toLowerCase()}
            </div>
            {items.map((item) => (
              <TrackCard key={item.key} item={item} period={period} elapsed={elapsed} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
