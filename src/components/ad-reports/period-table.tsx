"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { METRICS, change, formatMetric, type Metric, type Totals } from "@/lib/ad-reports/aggregate";
import { cn } from "@/lib/utils";

/** Kiểu ô bảng dùng chung cho các bảng Tổng quan / Phân tích (có kẻ đường dọc giữa các cột). */
export const TH = "border-l px-2.5 py-2 text-right text-xs font-medium whitespace-nowrap";
export const TD = "border-l px-2.5 py-2 text-right whitespace-nowrap tabular-nums";
export const FIRST_TH = "bg-muted px-3 py-2 text-left text-xs font-medium whitespace-nowrap";
export const YELLOW = "bg-yellow-100 text-yellow-950 dark:bg-yellow-900/40 dark:text-yellow-50";
export const LIME = "bg-lime-100 text-lime-950 dark:bg-lime-900/40 dark:text-lime-50";
export const ORANGE = "bg-orange-100 text-orange-950 dark:bg-orange-900/40 dark:text-orange-50";
/** Doanh số, tỉ lệ ads / doanh số — cùng màu xanh với ô "Doanh số theo ngày" ở Nhập liệu. */
export const SKY = "bg-sky-100 text-sky-950 dark:bg-sky-900/40 dark:text-sky-50";

/** Màu tiêu đề cột của từng chỉ số (giống sheet: chi tiêu cam, các chỉ số vàng / xanh nõn chuối xen kẽ). */
export const METRIC_HEAD: Record<Metric["key"], string> = {
  spend: ORANGE,
  messages: YELLOW,
  costPerMessage: LIME,
  data: YELLOW,
  costPerData: LIME,
  dataRate: YELLOW,
  revenue: SKY,
  adRevenue: SKY,
};

/** "▲ 12,5%" xanh khi tốt, đỏ khi xấu, xám khi chỉ số không có chiều tốt / xấu (chi tiêu). */
export function Change({ metric, current, previous }: { metric: Metric; current: number | null; previous: number | null }) {
  const c = change(metric, current, previous);
  if (!c || c.direction === null || c.pct === null) return null;
  const Icon = c.direction === "up" ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        c.tone === "good" && "text-emerald-700 dark:text-emerald-400",
        c.tone === "bad" && "text-red-600 dark:text-red-400",
        c.tone === "neutral" && "text-muted-foreground",
      )}
      title={`So với ${metric.unit === "%" ? "tỉ lệ" : "số"} của dòng trên`}
    >
      <Icon className="size-3" />
      {Math.abs(c.pct * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%
    </span>
  );
}

export type PeriodRow = {
  key: string;
  label: React.ReactNode;
  /** Dòng phụ dưới tên (ví dụ khoảng ngày thật). */
  sub?: string;
  totals: Totals;
  /** "total": dòng Tổng (tô đậm); "subtotal": dòng tổng phụ (cả năm); "row": dòng thường. */
  kind?: "total" | "subtotal" | "row";
};

/**
 * Bảng kỳ × chỉ số: mỗi dòng một kỳ (tháng / năm / khoảng ngày), mỗi cột một chỉ số.
 * `showChange`: dưới mỗi số ghi tăng / giảm bao nhiêu % so với dòng thường liền trên.
 */
export function PeriodTable({
  firstHead,
  rows,
  showChange = false,
  empty = "Chưa có số liệu.",
}: {
  firstHead: string;
  rows: PeriodRow[];
  showChange?: boolean;
  empty?: string;
}) {
  // Dòng thường liền trên của mỗi dòng (để tính tăng / giảm); dòng Tổng, tổng phụ thì không so.
  const previousOf: (Totals | null)[] = [];
  let last: Totals | null = null;
  for (const row of rows) {
    const plain = (row.kind ?? "row") === "row";
    previousOf.push(plain ? last : null);
    if (plain) last = row.totals;
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="table-pin w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className={FIRST_TH}>{firstHead}</th>
            {METRICS.map((m) => (
              <th key={m.key} className={cn(TH, METRIC_HEAD[m.key])}>
                {m.key === "spend" ? "Tổng chi tiêu" : m.key === "messages" ? "Tổng mess" : m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={METRICS.length + 1} className="h-20 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const kind = row.kind ?? "row";
              const prev = previousOf[i];
              return (
                <tr
                  key={row.key}
                  className={cn(
                    "border-b last:border-0",
                    kind === "total" && "bg-accent font-semibold text-accent-foreground",
                    kind === "subtotal" && "bg-muted/60 font-medium",
                    kind === "row" && "hover:bg-muted/50",
                  )}
                >
                  <td className="px-3 py-2 text-left whitespace-nowrap">
                    <div className="font-medium">{row.label}</div>
                    {row.sub && <div className="text-xs font-normal text-muted-foreground tabular-nums">{row.sub}</div>}
                  </td>
                  {METRICS.map((m) => {
                    const value = m.value(row.totals);
                    return (
                      <td key={m.key} className={cn(TD, "align-top")}>
                        <div>{formatMetric(m, value)}</div>
                        {showChange && prev && (
                          <div className="leading-4">
                            <Change metric={m} current={value} previous={m.value(prev)} />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
