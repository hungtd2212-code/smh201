"use client";

import { Target } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  daysBetween,
  entriesOf,
  monthsBetween,
  periodElapsed,
  planFor,
  sumDays,
  totalsByDay,
  trackGoals,
  trackPeriods,
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
 * Theo dõi mục tiêu (kiểu "Monthly / Quarterly / Annual Tracking"): 3 cột Tháng · Quý · Năm. Mỗi thẻ: số hiện tại,
 * thanh tiến độ (phần tô màu = đã hoàn thành, phần trắng = chưa hoàn thành), mục tiêu, và tốt / kém hơn kỳ vọng
 * bao nhiêu %. Mục tiêu đặt theo từng tháng; quý / năm = cộng mục tiêu các tháng trong kỳ.
 */

const THEME: Record<TrackPeriod["key"], { head: string; card: string }> = {
  month: {
    head: "bg-cyan-400 text-cyan-950 dark:bg-cyan-700 dark:text-cyan-50",
    card: "bg-cyan-100/70 dark:bg-cyan-950/50",
  },
  quarter: {
    head: "bg-violet-400 text-violet-950 dark:bg-violet-700 dark:text-violet-50",
    card: "bg-violet-100/70 dark:bg-violet-950/50",
  },
  year: {
    head: "bg-pink-400 text-pink-950 dark:bg-pink-700 dark:text-pink-50",
    card: "bg-pink-100/70 dark:bg-pink-950/50",
  },
};

const BAR: Record<TrackItem["status"], string> = {
  good: "bg-green-500",
  warning: "bg-amber-500",
  bad: "bg-red-500",
  none: "bg-muted-foreground/40",
};
const NOTE: Record<TrackItem["status"], string> = {
  good: "text-green-700 dark:text-green-400",
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
  const width = Math.min(100, Math.max(item.fill * 100, item.actual ? 4 : 0));
  const label = item.kind === "cap" && item.fill >= 1 ? "Đạt" : `${Math.round(item.fill * 100)}%`;
  const showPace = item.kind !== "cap" && elapsed > 0 && elapsed < 1;
  return (
    <div className={cn("grid gap-3 rounded-2xl px-5 py-4", THEME[period.key].card)}>
      <div>
        <div className="text-base font-semibold">
          {item.label} ({period.label})
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {formatDay(period.from).slice(0, 5)} – {formatDay(period.to)} ({period.label})
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5">
        <span className="text-sm text-muted-foreground">Hiện tại</span>
        <span className={cn("text-center text-sm font-medium", NOTE[item.status])}>{item.note}</span>
        <span className="text-right text-sm text-muted-foreground">Mục tiêu</span>
        <span className="text-lg font-bold tabular-nums">{fmt(item, item.actual)}</span>
        <div
          className="relative h-8 overflow-hidden rounded-full bg-white shadow-inner dark:bg-white/15"
          role="progressbar"
          aria-valuenow={Math.round(item.fill * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${item.label}: ${label}`}
        >
          <div className={cn("flex h-full items-center justify-end rounded-full pr-3", BAR[item.status])} style={{ width: `${width}%` }}>
            {width >= 18 && <span className="text-xs font-semibold text-white tabular-nums">{label}</span>}
          </div>
          {width < 18 && (
            <span className="absolute inset-y-0 flex items-center text-xs font-semibold text-muted-foreground tabular-nums" style={{ left: `calc(${width}% + 8px)` }}>
              {label}
            </span>
          )}
          {showPace && (
            <span
              className="absolute inset-y-1 w-0.5 rounded bg-foreground/40"
              style={{ left: `${elapsed * 100}%` }}
              title="Mức kỳ vọng tới hôm nay"
            />
          )}
        </div>
        <span className="text-right text-lg font-bold whitespace-nowrap tabular-nums">
          {sign}
          {fmt(item, item.goal)}
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
  const targets = targetsState.status === "ready" ? targetsState.targets : [];
  const targetOf = (month: string) => targetFor(targets, staffId, month);
  const revenueMonths = revenue.status === "ready" ? revenueByMonth(revenue.rows, staffId) : new Map<string, number>();
  const thisMonth = today.slice(0, 7);
  const columns = trackPeriods(today).map((period) => {
    const elapsed = periodElapsed(period, today);
    const actual = sumDays(byDay, daysBetween(period.from, today < period.to ? today : period.to));
    const lastMonth = thisMonth < period.to.slice(0, 7) ? thisMonth : period.to.slice(0, 7);
    const money = monthsBetween(period.from.slice(0, 7), lastMonth).reduce((s, m) => s + (revenueMonths.get(m) ?? 0), 0);
    // Chỉ hiện những chỉ số đã đặt mục tiêu.
    const items = trackGoals(actual, money, planFor(period, today, targetOf)).filter((i) => i.goal !== null);
    return { period, elapsed, items };
  });
  const anyGoal = columns.some((c) => c.items.length > 0);
  const monthName = `tháng ${Number(thisMonth.slice(5))}/${thisMonth.slice(0, 4)}`;

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Target className="size-5 text-muted-foreground" />
            Tiến độ mục tiêu — {who}
          </h2>
          <p className="text-sm text-muted-foreground">
            Phần tô màu: đã hoàn thành · phần trắng: chưa hoàn thành. Vạch đứng: mức cần đạt tới hôm nay. Xanh = đúng / vượt
            kỳ vọng, vàng = hơi chậm, đỏ = chậm hoặc vượt mức cho phép.
            {revenue.status === "not-migrated" && " Doanh thu cần chạy file 013 mới có số."}
          </p>
        </div>
        {onEditTargets && (
          <Button size="sm" variant="outline" onClick={onEditTargets}>
            <Target />
            {anyGoal ? "Sửa mục tiêu" : "Đặt mục tiêu"}
          </Button>
        )}
      </div>
      {!anyGoal ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Chưa có mục tiêu {monthName}
          {staffId ? " cho người này" : " cho cả công ty"}.
          {onEditTargets ? " Bấm “Đặt mục tiêu” để đặt từ đầu tháng." : " Quản lý sẽ đặt mục tiêu cho bạn từ đầu tháng."}
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          {columns.map(({ period, elapsed, items }) => (
            <div key={period.key} className="grid content-start gap-3">
              <div className={cn("rounded-2xl px-5 py-3.5 text-xl font-bold", THEME[period.key].head)}>
                Theo dõi {period.label.toLowerCase()}
              </div>
              {items.length === 0 ? (
                <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">Chưa có mục tiêu.</p>
              ) : (
                items.map((item) => <TrackCard key={item.key} item={item} period={period} elapsed={elapsed} />)
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
