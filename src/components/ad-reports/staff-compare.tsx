"use client";

import { Trophy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  METRICS,
  add,
  daysBetween,
  formatMetric,
  isEmpty,
  monthsBetween,
  totalsByDay,
  totalsByMonth,
  totalsByStaff,
  zero,
  type Metric,
  type Totals,
} from "@/lib/ad-reports/aggregate";
import { formatDay, monthLabel } from "@/lib/ad-reports/dates";
import type { AdAccountAssignment, AdsStaff } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { StaffAvatar } from "@/components/staff/staff-avatar";
import {
  ChartCard,
  CompareLineChart,
  EfficiencyMap,
  EntityBarChart,
  MAX_SERIES,
  ShareBars,
  Swatch,
  type EntityValue,
} from "./charts";
import type { DayRange } from "./period-picker";
import { FIRST_TH, METRIC_HEAD, TD, TH } from "./period-table";

/**
 * Phân tích → So sánh nhân viên (chỉ Quản trị / Trưởng Marketing): tick 2–8 người, xem cạnh nhau trong
 * cùng một khoảng ngày. Mỗi người giữ một màu cố định trên mọi biểu đồ (bỏ tick người khác không đổi màu).
 */

type Pick = { id: string; slot: number };
type Entries = Parameters<typeof totalsByStaff>[0];

const overlaps = (x: AdAccountAssignment, range: DayRange) =>
  x.from_date <= range.to && (!x.to_date || x.to_date >= range.from);

/** Người tốt nhất / kém nhất của mỗi chỉ số (chi tiêu không xếp hạng). */
function ranking(metric: Metric, values: (number | null)[]) {
  const known = values.filter((v): v is number => v !== null);
  if (metric.better === null || known.length < 2) return { best: null, worst: null };
  const best = metric.better === "up" ? Math.max(...known) : Math.min(...known);
  const worst = metric.better === "up" ? Math.min(...known) : Math.max(...known);
  return { best, worst: known.length >= 3 && worst !== best ? worst : null };
}

const pct = (value: number) => `${(value * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;

export function StaffCompare({
  people,
  assignments,
  entries,
  range,
  metric,
  metricTabs,
  avatarOf,
}: {
  people: AdsStaff[];
  assignments: AdAccountAssignment[];
  entries: Entries;
  range: DayRange;
  metric: Metric;
  metricTabs: React.ReactNode;
  /** Ảnh đại diện của nhân viên Ads (null = chưa có ảnh). */
  avatarOf: (staff: AdsStaff) => string | null;
}) {
  const inRange = (day: string) => day >= range.from && day <= range.to;
  const byStaff = totalsByStaff(entries, inRange);
  const totalsOf = (id: string) => byStaff.get(id) ?? zero();

  // Chọn được TẤT CẢ nhân viên Ads đang làm (người đã nghỉ thì chỉ hiện khi có số trong khoảng này).
  const candidates = people.filter((p) => p.is_active || !isEmpty(totalsOf(p.id)));
  const accountsIn = (id: string) =>
    new Set(assignments.filter((x) => x.ads_staff_id === id && overlaps(x, range)).map((x) => x.ad_account_id)).size;
  // Mặc định: 3 người chi tiêu nhiều nhất trong khoảng này.
  const topSpenders = candidates
    .filter((p) => !isEmpty(totalsOf(p.id)))
    .sort((a, b) => totalsOf(b.id).spend - totalsOf(a.id).spend)
    .slice(0, 3);
  const defaults = topSpenders.length >= 2 ? topSpenders : candidates.slice(0, 3);

  const [picked, setPicked] = useState<Pick[] | null>(null);
  const chosen = (picked ?? defaults.map((p, i) => ({ id: p.id, slot: i }))).filter((c) =>
    people.some((p) => p.id === c.id),
  );
  const slotOf = new Map(chosen.map((c) => [c.id, c.slot]));

  const toggle = (id: string) => {
    if (slotOf.has(id)) {
      setPicked(chosen.filter((c) => c.id !== id));
      return;
    }
    if (chosen.length >= MAX_SERIES) {
      toast.info(`So sánh được tối đa ${MAX_SERIES} người cùng lúc`);
      return;
    }
    const used = new Set(chosen.map((c) => c.slot));
    const slot = Array.from({ length: MAX_SERIES }, (_, i) => i).find((i) => !used.has(i)) ?? 0;
    setPicked([...chosen, { id, slot }]);
  };
  const pickMany = (list: AdsStaff[]) => setPicked(list.slice(0, MAX_SERIES).map((p, i) => ({ id: p.id, slot: i })));

  // Bảng / biểu đồ theo thứ tự danh sách nhân viên (ổn định khi tick thêm, bỏ bớt).
  const rows: EntityValue[] = people
    .filter((p) => slotOf.has(p.id))
    .map((p) => ({ key: p.id, name: p.full_name, slot: slotOf.get(p.id) ?? 0, totals: totalsOf(p.id) }));
  const group = rows.map((r) => r.totals).reduce(add, zero());
  const groupValue =
    rows.length === 0 ? null : metric.kind === "sum" ? (metric.value(group) ?? 0) / rows.length : metric.value(group);

  // Theo thời gian: từng ngày nếu khoảng ngắn (≤ 62 ngày), từng tháng nếu dài hơn.
  const days = daysBetween(range.from, range.to);
  const daily = days.length <= 62;
  const months = monthsBetween(range.from.slice(0, 7), range.to.slice(0, 7));
  const series = rows.map((r) => {
    const byDay = totalsByDay(entries, r.key, inRange);
    const byMonth = totalsByMonth(byDay);
    return {
      key: `p${r.slot}`,
      name: r.name,
      slot: r.slot,
      totals: daily ? days.map((d) => byDay.get(d) ?? zero()) : months.map((m) => byMonth.get(m) ?? zero()),
    };
  });

  // Nhận xét tự động: ai mang về phần data lớn hơn phần tiền mình tiêu (hiệu quả hơn mức chung của nhóm).
  const insights =
    group.spend > 0 && group.data > 0
      ? rows
          .filter((r) => r.totals.spend > 0)
          .map((r) => ({ r, spendShare: r.totals.spend / group.spend, dataShare: r.totals.data / group.data }))
          .sort((a, b) => b.dataShare - b.spendShare - (a.dataShare - a.spendShare))
      : [];

  return (
    <>
      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-0.5">
            <h2 className="font-medium">
              Tick chọn nhân viên để so sánh ({chosen.length}/{candidates.length} người)
            </h2>
            <p className="text-sm text-muted-foreground">
              Chọn từ 2 người trở lên (tối đa {MAX_SERIES} người cùng lúc để biểu đồ còn dễ nhìn).
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => pickMany(candidates)}>
              Tất cả{candidates.length > MAX_SERIES ? ` (${MAX_SERIES} người đầu)` : ""}
            </Button>
            <Button size="sm" variant="outline" onClick={() => pickMany(topSpenders)}>
              Top 3 chi tiêu
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
              Bỏ chọn hết
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" role="group" aria-label="Nhân viên để so sánh">
          {candidates.map((p) => {
            const slot = slotOf.get(p.id);
            const on = slot !== undefined;
            const totals = totalsOf(p.id);
            const accounts = accountsIn(p.id);
            return (
              <label
                key={p.id}
                className={cn(
                  "relative flex cursor-pointer items-center gap-2.5 rounded-xl border p-2.5 transition-colors",
                  on ? "border-foreground/40 bg-muted shadow-sm" : "hover:bg-muted/60",
                )}
              >
                <input
                  type="checkbox"
                  className="absolute top-2 right-2 size-4 accent-primary"
                  checked={on}
                  onChange={() => toggle(p.id)}
                  aria-label={p.full_name}
                />
                <span className="relative">
                  <StaffAvatar name={p.full_name} url={avatarOf(p)} className="size-10" />
                  {on && (
                    <Swatch slot={slot} className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-card" />
                  )}
                </span>
                <span className="grid min-w-0 gap-0.5 pr-5">
                  <span className="truncate text-sm font-medium">{p.full_name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {!p.is_active
                      ? "Đã nghỉ"
                      : isEmpty(totals)
                        ? accounts > 0
                          ? `${accounts} TKQC · chưa có số`
                          : "Chưa có TKQC"
                        : `${accounts} TKQC · ${Math.round(totals.spend).toLocaleString("vi-VN")}đ`}
                  </span>
                </span>
              </label>
            );
          })}
          {candidates.length === 0 && (
            <span className="text-sm text-muted-foreground">Chưa có nhân viên Ads nào.</span>
          )}
        </div>
      </section>

      {rows.length < 2 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Tick ít nhất 2 nhân viên ở trên để so sánh.
        </p>
      ) : (
        <>
          <section className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">
                Bảng so sánh · {formatDay(range.from)} – {formatDay(range.to)}
              </h2>
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Trophy className="size-3.5 text-emerald-600 dark:text-emerald-400" /> tốt nhất nhóm · ô đỏ nhạt: kém nhất
                nhóm
              </p>
            </div>
            <CompareTable rows={rows} group={group} />
          </section>

          <ChartCard
            title={`${metric.label} của từng người`}
            note={
              metric.kind === "sum"
                ? "Đường nét đứt: trung bình mỗi người trong nhóm đang chọn."
                : "Đường nét đứt: chỉ số của cả nhóm đang chọn."
            }
            actions={metricTabs}
          >
            <EntityBarChart rows={rows} metric={metric} group={groupValue} />
          </ChartCard>

          <div className="grid gap-5 xl:grid-cols-2">
            <ChartCard
              title="Bản đồ hiệu quả"
              note="Ngang: số data mang về. Dọc: giá mỗi data. Càng về góc dưới bên phải càng tốt (nhiều data, giá rẻ). Nét đứt: mức trung bình của nhóm."
            >
              <EfficiencyMap rows={rows} />
            </ChartCard>
            <ChartCard title="Tỉ trọng trong nhóm" note="Mỗi người chiếm bao nhiêu phần chi tiêu, mess và data của nhóm.">
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {rows.map((r) => (
                  <li key={r.key} className="flex items-center gap-1.5">
                    <Swatch slot={r.slot} />
                    <span className="text-muted-foreground">{r.name}</span>
                  </li>
                ))}
              </ul>
              <ShareBars rows={rows} />
              {insights.length >= 2 && (
                <ul className="grid gap-1 border-t pt-3 text-sm">
                  {[insights[0], insights.at(-1)].map((x, i) =>
                    x ? (
                      <li key={x.r.key} className="flex items-start gap-2">
                        <Swatch slot={x.r.slot} className="mt-1.5" />
                        <span>
                          <span className="font-medium">{x.r.name}</span>: tiêu {pct(x.spendShare)} tiền của nhóm, mang về{" "}
                          {pct(x.dataShare)} data —{" "}
                          {i === 0 ? (
                            <span className="text-emerald-700 dark:text-emerald-400">hiệu quả nhất nhóm</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">kém hiệu quả nhất nhóm</span>
                          )}
                          .
                        </span>
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </ChartCard>
          </div>

          <ChartCard
            title={`${metric.label} theo ${daily ? "ngày" : "tháng"} — mỗi người một đường`}
            actions={metricTabs}
          >
            <CompareLineChart
              xLabels={daily ? days.map((d) => `${d.slice(8)}/${d.slice(5, 7)}`) : months.map((m) => monthLabel(m))}
              series={series}
              metric={metric}
            />
          </ChartCard>
        </>
      )}
    </>
  );
}

/** Bảng người × chỉ số, tô ô tốt nhất / kém nhất của từng cột; dòng cuối là cả nhóm. */
function CompareTable({ rows, group }: { rows: EntityValue[]; group: Totals }) {
  const ranks = new Map(METRICS.map((m) => [m.key, ranking(m, rows.map((r) => m.value(r.totals)))]));
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className={FIRST_TH}>Nhân viên</th>
            {METRICS.map((m) => (
              <th key={m.key} className={cn(TH, METRIC_HEAD[m.key])}>
                {m.key === "spend" ? "Tổng chi tiêu" : m.key === "messages" ? "Tổng mess" : m.label}
              </th>
            ))}
            <th className={cn(TH, "bg-muted")}>Tỉ trọng chi tiêu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b hover:bg-muted/50">
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="flex items-center gap-2 font-medium">
                  <Swatch slot={r.slot} />
                  {r.name}
                </span>
              </td>
              {METRICS.map((m) => {
                const value = m.value(r.totals);
                const rank = ranks.get(m.key);
                const best = value !== null && rank?.best === value;
                const worst = value !== null && rank?.worst === value;
                return (
                  <td
                    key={m.key}
                    className={cn(
                      TD,
                      best && "bg-emerald-50 font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
                      worst && "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100",
                    )}
                    title={best ? "Tốt nhất nhóm" : worst ? "Kém nhất nhóm" : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {best && <Trophy className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-label="Tốt nhất" />}
                      {formatMetric(m, value)}
                    </span>
                  </td>
                );
              })}
              <td className={TD}>{group.spend > 0 ? pct(r.totals.spend / group.spend) : "–"}</td>
            </tr>
          ))}
          <tr className="bg-accent font-semibold text-accent-foreground">
            <td className="px-3 py-2">Cả nhóm ({rows.length} người)</td>
            {METRICS.map((m) => (
              <td key={m.key} className={TD}>
                {formatMetric(m, m.value(group))}
              </td>
            ))}
            <td className={TD}>100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
