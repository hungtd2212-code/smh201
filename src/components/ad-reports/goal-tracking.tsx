"use client";

import { Target } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  daysBetween,
  entriesOf,
  monthsBetween,
  periodElapsed,
  planFor,
  revenueMonths,
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
import { GlassBar, TONE_DOT, TONE_TEXT, shortMoney, type Tone } from "./glass";
import { useAdReports } from "./hooks";
import { useRevenue } from "./revenue";
import { StatsError } from "./shared";
import type { TargetsState } from "./targets";

/**
 * Theo dõi mục tiêu Tháng · Quý · Năm, dạng kính mờ gọn: mỗi kỳ một tấm kính, mỗi chỉ số một dòng — số hiện tại /
 * mục tiêu, thanh mảnh (phần tô màu = đã hoàn thành, phần trắng = chưa hoàn thành), ghi chú tốt / kém hơn kỳ vọng.
 * Mục tiêu đặt theo từng tháng; quý / năm = cộng mục tiêu các tháng trong kỳ.
 */

/** Màu pha dưới tấm kính của từng kỳ (như ảnh mẫu: Tháng xanh ngọc, Quý tím, Năm hồng). */
const TINT: Record<TrackPeriod["key"], string> = {
  month: "[--glass-tint:oklch(0.9_0.09_205/0.6)] dark:[--glass-tint:oklch(0.45_0.09_205/0.22)]",
  quarter: "[--glass-tint:oklch(0.9_0.07_290/0.6)] dark:[--glass-tint:oklch(0.45_0.1_290/0.22)]",
  year: "[--glass-tint:oklch(0.92_0.06_350/0.6)] dark:[--glass-tint:oklch(0.45_0.1_350/0.22)]",
};

const DOT: Record<TrackPeriod["key"], string> = {
  month: "from-cyan-300 to-sky-500",
  quarter: "from-violet-300 to-indigo-500",
  year: "from-pink-300 to-fuchsia-500",
};

const TONE: Record<TrackItem["status"], Tone> = { good: "good", warning: "warning", bad: "bad", none: "none" };

function fmt(item: TrackItem, value: number | null, full = false) {
  if (value === null) return "–";
  if (item.unit === "percent") return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
  if (item.unit === "money") return full ? `${Math.round(value).toLocaleString("vi-VN")}đ` : shortMoney(value);
  return Math.round(value).toLocaleString("vi-VN");
}

/** "Tháng 11", "Quý 4", "Năm 2026". */
function periodName(period: TrackPeriod) {
  const m = Number(period.from.slice(5, 7));
  if (period.key === "month") return `Tháng ${m}/${period.from.slice(0, 4)}`;
  if (period.key === "quarter") return `Quý ${Math.floor((m - 1) / 3) + 1}`;
  return `Năm ${period.from.slice(0, 4)}`;
}

function TrackRow({ item, elapsed }: { item: TrackItem; elapsed: number }) {
  const sign = item.kind === "progress" ? "≥" : "≤";
  const done = item.kind === "cap" && item.fill >= 1 ? "Đạt" : `${Math.round(item.fill * 100)}%`;
  const showPace = item.kind !== "cap" && elapsed > 0 && elapsed < 1;
  const tone = TONE[item.status];
  return (
    <div className="grid gap-1.5 py-2.5 first:pt-1.5 last:pb-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
        <span
          className="text-sm whitespace-nowrap tabular-nums"
          title={`Hiện tại ${fmt(item, item.actual, true)} · Mục tiêu ${sign}${fmt(item, item.goal, true)}`}
        >
          <span className="font-semibold">{fmt(item, item.actual)}</span>
          <span className="text-muted-foreground">
            {" "}
            / {sign}
            {fmt(item, item.goal)}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <GlassBar fill={item.fill} tone={tone} pace={showPace ? elapsed : null} label={`${item.label}: ${done}`} />
        <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums">{done}</span>
      </div>
      <div className={cn("flex items-center gap-1.5 text-[11px] leading-tight", TONE_TEXT[tone])}>
        <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
        {item.note}
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
  // Điện thoại: mỗi lần xem một bảng (tháng / quý / năm) thay vì xếp chồng cả ba. Máy tính: luôn đủ ba cột.
  const [shown, setShown] = useState<TrackPeriod["key"]>("month");
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
    return <Skeleton className="h-64 w-full rounded-3xl" />;
  }
  const targets = targetsState.status === "ready" ? targetsState.targets : [];
  const targetOf = (month: string) => targetFor(targets, staffId, month);
  // Doanh thu tháng: số quản lý nhập là chính, tháng nào chưa có thì cộng doanh thu theo ngày nhân viên đã nhập.
  const moneyByMonth = revenueMonths(
    revenue.status === "ready" ? revenue.rows : [],
    state.status === "ready" ? (state.data ?? []) : [],
    staffId,
  );
  const thisMonth = today.slice(0, 7);
  const columns = trackPeriods(today).map((period) => {
    const elapsed = periodElapsed(period, today);
    const actual = sumDays(byDay, daysBetween(period.from, today < period.to ? today : period.to));
    const lastMonth = thisMonth < period.to.slice(0, 7) ? thisMonth : period.to.slice(0, 7);
    const money = monthsBetween(period.from.slice(0, 7), lastMonth).reduce((s, m) => s + (moneyByMonth.get(m) ?? 0), 0);
    // Chỉ hiện những chỉ số đã đặt mục tiêu.
    const items = trackGoals(actual, money, planFor(period, today, targetOf)).filter((i) => i.goal !== null);
    return { period, elapsed, items };
  });
  const anyGoal = columns.some((c) => c.items.length > 0);
  const monthName = `tháng ${Number(thisMonth.slice(5))}/${thisMonth.slice(0, 4)}`;

  return (
    <section className="glass-stage grid gap-3 overflow-hidden rounded-3xl border border-white/70 p-3 sm:p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <span className="glass flex size-7 items-center justify-center rounded-full">
              <Target className="size-3.5" />
            </span>
            Tiến độ mục tiêu — {who}
          </h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-linear-to-r from-emerald-400 to-teal-500" />
              đã hoàn thành
            </span>
            <span className="flex items-center gap-1.5">
              <span className="glass-track h-1.5 w-4 rounded-full" />
              chưa hoàn thành
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-px bg-slate-900/45 dark:bg-white/60" />
              mức cần đạt tới hôm nay
            </span>
            <span>Xanh = đúng / vượt kỳ vọng · vàng = hơi chậm · đỏ = chậm hoặc vượt mức cho phép</span>
            {revenue.status === "not-migrated" && <span>Doanh số cần chạy file 013 mới có số.</span>}
          </p>
        </div>
        {onEditTargets && (
          <Button size="sm" variant="outline" className="glass rounded-full" onClick={onEditTargets}>
            <Target />
            {anyGoal ? "Sửa mục tiêu" : "Đặt mục tiêu"}
          </Button>
        )}
      </div>
      {!anyGoal ? (
        <p className="glass rounded-2xl px-4 py-3 text-sm text-muted-foreground">
          Chưa có mục tiêu {monthName}
          {staffId ? " cho người này" : " cho cả công ty"}.
          {onEditTargets ? " Bấm “Đặt mục tiêu” để đặt từ đầu tháng." : " Quản lý sẽ đặt mục tiêu cho bạn từ đầu tháng."}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <div role="tablist" aria-label="Kỳ theo dõi" className="glass-soft grid grid-cols-3 gap-1 rounded-full p-1 md:hidden">
            {columns.map(({ period }) => (
              <button
                key={period.key}
                type="button"
                role="tab"
                aria-selected={shown === period.key}
                onClick={() => setShown(period.key)}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors",
                  shown === period.key ? "bg-foreground text-background shadow-sm" : "text-muted-foreground",
                )}
              >
                <span className={cn("size-2 shrink-0 rounded-full bg-linear-to-br", DOT[period.key])} />
                {period.key === "month" ? `Tháng ${Number(period.from.slice(5, 7))}` : periodName(period)}
              </button>
            ))}
          </div>
          {columns.map(({ period, elapsed, items }) => (
            <div
              key={period.key}
              className={cn(
                "glass content-start rounded-2xl px-3.5 pt-3 pb-3 md:grid",
                shown === period.key ? "grid" : "hidden",
                TINT[period.key],
              )}
            >
              <div className="grid gap-0.5 border-b border-slate-900/5 pb-2 dark:border-white/10">
                <span className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
                  <span className={cn("size-2.5 shrink-0 rounded-full bg-linear-to-br shadow-sm", DOT[period.key])} />
                  {periodName(period)}
                </span>
                <span className="pl-[1.125rem] text-[11px] text-muted-foreground tabular-nums">
                  {formatDay(period.from).slice(0, 5)} – {formatDay(period.to).slice(0, 5)} · đã qua {Math.round(elapsed * 100)}%
                </span>
              </div>
              {items.length === 0 ? (
                <p className="pt-2 text-xs text-muted-foreground">Chưa có mục tiêu.</p>
              ) : (
                <div className="divide-y divide-slate-900/5 dark:divide-white/10">
                  {items.map((item) => (
                    <TrackRow key={item.key} item={item} elapsed={elapsed} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
