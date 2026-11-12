"use client";

import { Trophy } from "lucide-react";
import { useState } from "react";
import {
  formatMetric,
  metricOf,
  totalsByAccount,
  type MetricKey,
} from "@/lib/ad-reports/aggregate";
import type { AdDailyReport } from "@/lib/ad-reports/types";
import type { AdAccount, AdAccountAssignment, AdsStaff } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { ChartCard, EfficiencyMap, MetricTabs, StaffChart } from "./charts";
import type { DayRange } from "./period-picker";
import { FIRST_TH, LIME, ORANGE, TD, TH, YELLOW } from "./period-table";

/**
 * Phân tích → Theo TKQC (kiểu Meta Ads Manager / Madgicx): mỗi TKQC tiêu bao nhiêu, ra bao nhiêu mess, giá mess
 * bao nhiêu — để quyết định giữ, tăng hay tắt TKQC. "Data xin được" nhập chung cho cả ngày của mỗi nhân viên nên
 * không tách được theo từng TKQC.
 */

const KEYS: MetricKey[] = ["spend", "messages", "costPerMessage"];
const pct = (v: number) => `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;

export function AccountRanking({
  reports,
  assignments,
  accounts,
  people,
  staffId,
  range,
  who,
}: {
  reports: AdDailyReport[];
  assignments: AdAccountAssignment[];
  accounts: AdAccount[];
  people: AdsStaff[];
  staffId: string | null;
  range: DayRange;
  who: string;
}) {
  const [metricKey, setMetricKey] = useState<MetricKey>("costPerMessage");
  const metric = metricOf(metricKey);
  const byAccount = totalsByAccount(reports, assignments, staffId, (d) => d >= range.from && d <= range.to);
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.full_name ?? "—") : "Chưa có người phụ trách");
  const rows = [...byAccount]
    .map(([id, v]) => {
      const account = accounts.find((a) => a.id === id);
      return {
        id,
        name: account?.name ?? "TKQC đã xoá",
        code: account?.account_id ?? null,
        inactive: account ? !account.is_active : true,
        ...v,
        ownerNames: [...v.owners].map(nameOf).join(", "),
      };
    })
    .sort((a, b) => b.totals.spend - a.totals.spend);
  const totalSpend = rows.reduce((s, r) => s + r.totals.spend, 0);
  const costs = rows.map((r) => metricOf("costPerMessage").value(r.totals)).filter((v): v is number => v !== null);
  const best = costs.length >= 2 ? Math.min(...costs) : null;
  const worst = costs.length >= 3 ? Math.max(...costs) : null;

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Khoảng ngày này chưa có báo cáo TKQC nào.
      </p>
    );
  }

  return (
    <>
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Xếp hạng TKQC{who ? ` — ${who}` : ""}</h2>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            Xếp theo chi tiêu. <Trophy className="size-3.5 text-emerald-600 dark:text-emerald-400" /> giá mess rẻ nhất · ô đỏ
            nhạt: đắt nhất
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="table-pin w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className={cn(FIRST_TH, "w-10 text-right")}>#</th>
                <th className={cn(FIRST_TH, "border-l")}>TKQC</th>
                <th className={cn(FIRST_TH, "border-l")}>Người phụ trách</th>
                <th className={cn(TH, "bg-muted")}>Ngày chạy</th>
                <th className={cn(TH, ORANGE)}>Chi tiêu</th>
                <th className={cn(TH, ORANGE)}>Tỉ trọng</th>
                <th className={cn(TH, YELLOW)}>Mess</th>
                <th className={cn(TH, LIME)}>Giá mess</th>
                <th className={cn(TH, "bg-muted")}>Chi tiêu TB / ngày chạy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const cost = metricOf("costPerMessage").value(r.totals);
                const isBest = cost !== null && cost === best;
                const isWorst = cost !== null && cost === worst && worst !== best;
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="border-l px-3 py-2">
                      <div className="font-medium whitespace-nowrap">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.code ? `ID ${r.code}` : ""}
                        {r.inactive && <span className="ml-1">(đã ngừng dùng)</span>}
                      </div>
                    </td>
                    <td className="border-l px-3 py-2 text-sm whitespace-nowrap">{r.ownerNames}</td>
                    <td className={TD}>{r.activeDays}</td>
                    <td className={cn(TD, "font-medium")}>{formatMetric(metricOf("spend"), r.totals.spend)}</td>
                    <td className={TD}>{totalSpend > 0 ? pct(r.totals.spend / totalSpend) : "–"}</td>
                    <td className={TD}>{formatMetric(metricOf("messages"), r.totals.messages)}</td>
                    <td
                      className={cn(
                        TD,
                        isBest && "bg-emerald-50 font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
                        isWorst && "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {isBest && <Trophy className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
                        {formatMetric(metricOf("costPerMessage"), cost)}
                      </span>
                    </td>
                    <td className={TD}>
                      {r.activeDays > 0 ? formatMetric(metricOf("spend"), r.totals.spend / r.activeDays) : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          “Data xin được” nhập chung cho cả ngày của mỗi nhân viên nên không tách được theo từng TKQC — bảng này so chi
          tiêu, mess và giá mess.
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          title={`${metric.label} của từng TKQC`}
          note="Xếp từ cao xuống thấp."
          actions={<MetricTabs value={metricKey} onChange={setMetricKey} keys={KEYS} />}
        >
          <StaffChart metric={metric} rows={rows.map((r) => ({ key: r.id, name: r.name, totals: r.totals }))} />
        </ChartCard>
        <ChartCard
          title="Bản đồ hiệu quả TKQC"
          note="Ngang: số mess. Dọc: giá mỗi mess. Càng về góc dưới bên phải càng tốt. Nét đứt: mức trung bình."
        >
          <EfficiencyMap by="messages" rows={rows.map((r) => ({ key: r.id, name: r.name, slot: 0, totals: r.totals }))} />
        </ChartCard>
      </div>
    </>
  );
}
