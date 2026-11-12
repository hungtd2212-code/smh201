"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { METRICS, change, formatMetric, type Metric, type Totals } from "@/lib/ad-reports/aggregate";
import { cn } from "@/lib/utils";

/**
 * Thẻ chỉ số kiểu Google Ads / Looker Studio: số lớn, mũi tên tăng / giảm so với kỳ trước (xanh = tốt hơn,
 * đỏ = kém hơn, xám = chi tiêu — không có tốt / xấu), và biểu đồ mini xu hướng trong kỳ.
 */

/** Đường xu hướng nhỏ (không trục) của một chỉ số qua các điểm. */
function Sparkline({ values }: { values: (number | null)[] }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return <div className="h-7" />;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  // Đứt đoạn ở chỗ không có số (ví dụ ngày chưa có mess thì không tính được giá mess).
  const parts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    const x = (i * step).toFixed(2);
    const y = (26 - ((v - min) / span) * 24).toFixed(2);
    parts.push(`${i > 0 && values[i - 1] !== null ? "L" : "M"}${x},${y}`);
  }
  const path = parts.join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full overflow-visible" aria-hidden>
      <path
        d={path}
        fill="none"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-[#2a78d6] dark:stroke-[#3987e5]"
      />
    </svg>
  );
}

function Delta({ metric, current, previous }: { metric: Metric; current: number | null; previous: number | null }) {
  const c = change(metric, current, previous);
  if (!c || c.pct === null) {
    return <span className="text-xs text-muted-foreground">{previous === null || previous === 0 ? "Kỳ trước chưa có số" : "–"}</span>;
  }
  const Icon = c.direction === "up" ? ArrowUp : c.direction === "down" ? ArrowDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        c.tone === "good" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
        c.tone === "bad" && "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
        c.tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3" />
      {Math.abs(c.pct * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%
    </span>
  );
}

const LABELS: Record<Metric["key"], { one: string; many: string }> = {
  spend: { one: "Tổng chi tiêu tháng", many: "Tổng chi tiêu" },
  messages: { one: "Tổng mess", many: "Tổng mess" },
  costPerMessage: { one: "Giá mess", many: "Giá mess" },
  data: { one: "Data", many: "Data" },
  costPerData: { one: "Giá data", many: "Giá data" },
  dataRate: { one: "Tỉ lệ xin số", many: "Tỉ lệ xin số" },
};

export function KpiCards({
  title,
  current,
  previous,
  compareLabel,
  spark,
  oneMonth = false,
}: {
  title?: string;
  current: Totals;
  /** null = không có kỳ để so (ví dụ chọn các tháng rời rạc). */
  previous: Totals | null;
  /** "tháng 10/2026 (cùng kỳ tới ngày 12)"… */
  compareLabel?: string;
  /** Các điểm cho biểu đồ mini (theo ngày hoặc theo tháng). */
  spark: Totals[];
  oneMonth?: boolean;
}) {
  return (
    <section className="grid gap-2">
      {(title || (previous && compareLabel)) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {title && <h2 className="font-medium">{title}</h2>}
          {previous && compareLabel && <p className="text-sm text-muted-foreground">Mũi tên: so với {compareLabel}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {METRICS.map((m) => {
          const value = m.value(current);
          return (
            <div key={m.key} className="grid gap-1 rounded-xl border bg-card px-4 pt-3 pb-2">
              <div className="text-xs text-muted-foreground">{oneMonth ? LABELS[m.key].one : LABELS[m.key].many}</div>
              <div className="text-xl font-semibold tabular-nums">{formatMetric(m, value, true)}</div>
              {previous && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Delta metric={m} current={value} previous={m.value(previous)} />
                  {m.value(previous) !== null && m.value(previous) !== 0 && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      trước: {formatMetric(m, m.value(previous), true)}
                    </span>
                  )}
                </div>
              )}
              <Sparkline values={spark.map((t) => m.value(t))} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
