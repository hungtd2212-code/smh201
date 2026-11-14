"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  METRICS,
  compactMetric,
  formatMetric,
  type Metric,
  type MetricKey,
  type Totals,
} from "@/lib/ad-reports/aggregate";
import { cn } from "@/lib/utils";

/**
 * Biểu đồ của Marketing → Tổng quan / Phân tích.
 *   • Chỉ số cộng dồn (chi tiêu, mess, data) → cột; chỉ số tính ra (giá mess, giá data, tỉ lệ) → đường.
 *   • Một trục dọc duy nhất: mỗi lần xem một chỉ số (chọn ở hàng nút phía trên).
 *   • Màu theo thứ tự cố định (xanh dương, cam, xanh ngọc, vàng, hồng, xanh lá, tím, đỏ), có bản cho nền tối.
 */
const PALETTE = [
  { light: "#2a78d6", dark: "#3987e5" },
  { light: "#eb6834", dark: "#d95926" },
  { light: "#1baf7a", dark: "#199e70" },
  { light: "#eda100", dark: "#c98500" },
  { light: "#e87ba4", dark: "#d55181" },
  { light: "#008300", dark: "#008300" },
  { light: "#6250d6", dark: "#9085e9" },
  { light: "#e34948", dark: "#e66767" },
];
export const MAX_SERIES = PALETTE.length;

/** Ô màu nhỏ (ngoài biểu đồ) đúng màu của vị trí `slot`, tự đổi theo nền sáng / tối. */
export function Swatch({ slot, className }: { slot: number; className?: string }) {
  const color = PALETTE[slot % PALETTE.length];
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-[3px] bg-(--swatch-light) dark:bg-(--swatch-dark)", className)}
      style={{ "--swatch-light": color.light, "--swatch-dark": color.dark } as React.CSSProperties}
    />
  );
}

/** Cấu hình màu theo vị trí cố định của từng thứ (nhân viên…): khoá "s0", "s1"… → var(--color-s0)… */
const slotConfig = (slots: number[]): ChartConfig =>
  Object.fromEntries(slots.map((slot) => [`s${slot}`, { label: `s${slot}`, theme: PALETTE[slot % PALETTE.length] }]));
const slotVar = (slot: number) => `var(--color-s${slot})`;

const axisTick = { fontSize: 11 };

/** Hàng nút chọn chỉ số để vẽ. */
export function MetricTabs({
  value,
  onChange,
  keys,
}: {
  value: MetricKey;
  onChange: (key: MetricKey) => void;
  /** Chỉ hiện các chỉ số này (mặc định: cả 6). */
  keys?: MetricKey[];
}) {
  return (
    <div role="tablist" aria-label="Chỉ số trên biểu đồ" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {METRICS.filter((m) => !keys || keys.includes(m.key)).map((m) => (
        <button
          key={m.key}
          type="button"
          role="tab"
          aria-selected={value === m.key}
          onClick={() => onChange(m.key)}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
            value === m.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Khung bao biểu đồ: tiêu đề + nút chọn chỉ số + biểu đồ. */
export function ChartCard({
  title,
  note,
  actions,
  children,
}: {
  title: string;
  note?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="font-medium">{title}</h2>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function TipBox({ title, rows }: { title: string; rows: { color?: string; name?: string; value: string }[] }) {
  return (
    <div className="grid min-w-36 gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{title}</div>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          {row.color && <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: row.color }} />}
          {row.name && <span className="text-muted-foreground">{row.name}</span>}
          <span className="ml-auto pl-3 font-mono font-medium tabular-nums">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ height }: { height: string }) {
  return (
    <p className={cn("flex items-center justify-center text-sm text-muted-foreground", height)}>
      Chưa có số liệu trong khoảng này
    </p>
  );
}

export type TrendPoint = { key: string; label: string; title: string; totals: Totals };

/**
 * Một chuỗi theo thời gian (theo ngày / tháng / năm) của một chỉ số. Tuỳ chọn:
 *   • `previous`: kỳ trước (cùng vị trí trên trục ngang) — vẽ nét đứt màu xám để so;
 *   • `target`: mức mục tiêu — đường ngang màu đỏ (ví dụ giá data tối đa).
 */
export function TrendChart({
  points,
  metric,
  height = "h-72",
  previous,
  currentLabel = "Kỳ này",
  target,
}: {
  points: TrendPoint[];
  metric: Metric;
  height?: string;
  previous?: { label: string; totals: (Totals | null)[]; titles?: string[] };
  currentLabel?: string;
  target?: { value: number; label: string } | null;
}) {
  const data = points.map((p, i) => {
    const before = previous?.totals[i];
    return {
      ...p,
      value: metric.value(p.totals),
      previous: before ? metric.value(before) : null,
      previousTitle: previous?.titles?.[i],
    };
  });
  const hasCurrent = data.some((d) => d.value !== null && d.value !== 0);
  const hasPrevious = Boolean(previous) && data.some((d) => d.previous !== null && d.previous !== 0);
  if (!hasCurrent && !hasPrevious) return <Empty height={height} />;
  const config: ChartConfig = { value: { label: metric.label, theme: PALETTE[0] } };
  const many = data.length > 16;
  const bars = metric.kind === "sum";

  return (
    <div className="grid gap-2">
      {(hasPrevious || target) && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <li className="flex items-center gap-1.5">
            <Swatch slot={0} className={bars ? "" : "h-0.5 w-4 rounded-full"} />
            <span className="text-muted-foreground">{currentLabel}</span>
          </li>
          {hasPrevious && previous && (
            <li className="flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-muted-foreground" />
              <span className="text-muted-foreground">{previous.label}</span>
            </li>
          )}
          {target && (
            <li className="flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-red-500" />
              <span className="text-muted-foreground">{target.label}</span>
            </li>
          )}
        </ul>
      )}
      <ChartContainer config={config} className={cn("aspect-auto w-full", height)}>
        <ComposedChart accessibilityLayer data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={axisTick}
            interval={many ? "preserveStartEnd" : 0}
            minTickGap={many ? 8 : 2}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tick={axisTick}
            tickFormatter={(v: number) => compactMetric(metric, v)}
          />
          <ChartTooltip
            cursor={bars ? { fill: "var(--muted)", opacity: 0.6 } : true}
            content={({ active, payload }) => {
              const p = active ? payload?.[0]?.payload : null;
              if (!p) return null;
              const rows: { color?: string; name?: string; value: string }[] = [
                { color: "var(--color-value)", name: currentLabel, value: formatMetric(metric, p.value, true) },
              ];
              if (hasPrevious && previous) {
                rows.push({
                  color: "var(--muted-foreground)",
                  name: p.previousTitle ? `${previous.label} · ${p.previousTitle}` : previous.label,
                  value: formatMetric(metric, p.previous, true),
                });
              }
              if (target) rows.push({ color: "#ef4444", name: target.label, value: formatMetric(metric, target.value, true) });
              return <TipBox title={p.title} rows={rows} />;
            }}
          />
          {bars ? (
            <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          ) : (
            <Line
              dataKey="value"
              type="linear"
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={many ? false : { r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--color-value)" }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          {hasPrevious && (
            <Line
              dataKey="previous"
              type="linear"
              stroke="var(--muted-foreground)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--muted-foreground)" }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          {target && (
            <ReferenceLine y={target.value} stroke="#ef4444" strokeWidth={1.5} ifOverflow="extendDomain" />
          )}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

export type CompareSeries = {
  key: string;
  name: string;
  /** Giá trị theo từng vị trí trục ngang (cùng độ dài với `xLabels`); null = không có. */
  totals: (Totals | null)[];
  /** Tên của từng điểm trong ô gợi ý (ví dụ ngày thật của kỳ đó). */
  titles?: string[];
  /** Màu cố định (vị trí trong bảng màu); bỏ trống = theo thứ tự đường. */
  slot?: number;
  /** Nét đứt (kỳ trước). */
  dashed?: boolean;
};

/** Nhiều đường trên cùng trục (so sánh tháng / kỳ / năm), có chú thích màu. */
export function CompareLineChart({
  xLabels,
  series,
  metric,
  height = "h-72",
}: {
  xLabels: string[];
  series: CompareSeries[];
  metric: Metric;
  height?: string;
}) {
  const shown = series.slice(0, MAX_SERIES);
  const data = xLabels.map((label, i) => {
    const row: Record<string, string | number | null> = { label, index: i };
    for (const s of shown) {
      const t = s.totals[i];
      row[s.key] = t ? metric.value(t) : null;
    }
    return row;
  });
  const slotOf = (s: CompareSeries, i: number) => (s.slot ?? i) % PALETTE.length;
  const config: ChartConfig = Object.fromEntries(
    shown.map((s, i) => [s.key, { label: s.name, theme: PALETTE[slotOf(s, i)] }]),
  );
  const hasValue = data.some((row) => shown.some((s) => row[s.key] !== null && row[s.key] !== 0));
  const many = xLabels.length > 16;

  return (
    <div className="grid gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {shown.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            {s.dashed ? (
              <span
                className="w-4 border-t-2 border-dashed border-(--swatch-light) dark:border-(--swatch-dark)"
                style={{ "--swatch-light": PALETTE[slotOf(s, i)].light, "--swatch-dark": PALETTE[slotOf(s, i)].dark } as React.CSSProperties}
              />
            ) : (
              <Swatch slot={slotOf(s, i)} className="h-0.5 w-4 rounded-full" />
            )}
            <span className="text-muted-foreground">{s.name}</span>
          </li>
        ))}
      </ul>
      {!hasValue ? (
        <Empty height={height} />
      ) : (
        <ChartContainer config={config} className={cn("aspect-auto w-full", height)}>
          <LineChart accessibilityLayer data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              interval={many ? "preserveStartEnd" : 0}
              minTickGap={many ? 8 : 2}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tick={axisTick}
              tickFormatter={(v: number) => compactMetric(metric, v)}
            />
            <ChartTooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const index = Number(payload[0]?.payload?.index ?? 0);
                return (
                  <TipBox
                    title={String(label)}
                    rows={shown.map((s) => ({
                      color: `var(--color-${s.key})`,
                      name: s.titles?.[index] ? `${s.name} · ${s.titles[index]}` : s.name,
                      value: formatMetric(metric, (data[index]?.[s.key] as number | null) ?? null, true),
                    }))}
                  />
                );
              }}
            />
            {shown.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.name}
                type="linear"
                stroke={`var(--color-${s.key})`}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={many ? false : { r: 3.5, strokeWidth: 2, stroke: "var(--card)", fill: `var(--color-${s.key})` }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      )}
    </div>
  );
}

/** Thanh ngang: một chỉ số của từng nhân viên (xếp từ cao xuống thấp). */
export function StaffChart({ rows, metric }: { rows: { key: string; name: string; totals: Totals }[]; metric: Metric }) {
  const data = rows
    .map((r) => ({ ...r, value: metric.value(r.totals) }))
    .filter((r) => r.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const height = Math.max(120, data.length * 34 + 30);
  if (!data.some((d) => d.value !== 0)) return <Empty height="h-32" />;
  const config: ChartConfig = { value: { label: metric.label, theme: PALETTE[0] } };

  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid horizontal={false} />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          tickFormatter={(v: number) => compactMetric(metric, v)}
        />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={130} tick={{ fontSize: 12 }} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={({ active, payload }) => {
            const p = active ? payload?.[0]?.payload : null;
            if (!p) return null;
            return <TipBox title={p.name} rows={[{ name: metric.label, value: formatMetric(metric, p.value, true) }]} />;
          }}
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Chi tiêu và doanh số của từng người: mỗi người hai thanh nằm ngang cùng một trục tiền (cam = chi tiêu, xanh = doanh
 * số), số cuối thanh doanh số là tỉ lệ ads / doanh số. Xếp theo doanh số, cao nhất trên cùng.
 */
export function SpendRevenueChart({ rows }: { rows: { key: string; name: string; totals: Totals }[] }) {
  const money = METRICS.find((m) => m.key === "revenue") ?? METRICS[0];
  const share = METRICS.find((m) => m.key === "adRevenue") ?? METRICS[0];
  const data = rows
    .filter((r) => r.totals.spend > 0 || r.totals.revenue > 0)
    .map((r) => {
      const pct = share.value(r.totals);
      return { ...r, spend: r.totals.spend, revenue: r.totals.revenue, pct, pctLabel: pct === null ? "" : formatMetric(share, pct) };
    })
    .sort((a, b) => b.revenue - a.revenue || b.spend - a.spend);
  if (!data.some((d) => d.revenue > 0)) return <Empty height="h-32" />;
  const config: ChartConfig = {
    spend: { label: "Chi tiêu", theme: PALETTE[1] },
    revenue: { label: "Doanh số", theme: PALETTE[0] },
  };
  const height = Math.max(140, data.length * 46 + 30);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Swatch slot={1} />
          Chi tiêu
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch slot={0} />
          Doanh số
        </span>
        <span>Số cuối thanh xanh: tỉ lệ ads/doanh số (càng thấp càng tốt)</span>
      </div>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <BarChart
          accessibilityLayer
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 56, bottom: 0, left: 0 }}
          barGap={2}
          barCategoryGap="22%"
        >
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v: number) => compactMetric(money, v)} />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={130} tick={{ fontSize: 12 }} />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload }) => {
              const p = active ? payload?.[0]?.payload : null;
              if (!p) return null;
              return (
                <TipBox
                  title={p.name}
                  rows={[
                    { color: "var(--color-spend)", name: "Chi tiêu", value: formatMetric(money, p.spend, true) },
                    { color: "var(--color-revenue)", name: "Doanh số", value: p.revenue > 0 ? formatMetric(money, p.revenue, true) : "Chưa nhập" },
                    { name: "Ads/doanh số", value: formatMetric(share, p.pct) },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="spend" fill="var(--color-spend)" radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false} />
          <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false}>
            <LabelList dataKey="pctLabel" position="right" offset={6} className="fill-foreground" fontSize={11} />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

export type EntityValue = { key: string; name: string; slot: number; totals: Totals };

/** Cột dọc: một chỉ số của từng người (mỗi người một màu cố định), đường nét đứt = cả nhóm. */
export function EntityBarChart({
  rows,
  metric,
  group,
  height = "h-72",
}: {
  rows: EntityValue[];
  metric: Metric;
  /** Giá trị của cả nhóm (đường tham chiếu); null = không vẽ. */
  group: number | null;
  height?: string;
}) {
  const data = rows.map((r) => ({ ...r, value: metric.value(r.totals) }));
  if (!data.some((d) => d.value !== null && d.value !== 0)) return <Empty height={height} />;
  return (
    <ChartContainer config={slotConfig(rows.map((r) => r.slot))} className={cn("aspect-auto w-full", height)}>
      <BarChart accessibilityLayer data={data} margin={{ top: 22, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} interval={0} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tick={axisTick}
          tickFormatter={(v: number) => compactMetric(metric, v)}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={({ active, payload }) => {
            const p = active ? payload?.[0]?.payload : null;
            if (!p) return null;
            return (
              <TipBox
                title={p.name}
                rows={[
                  { color: slotVar(p.slot), name: metric.label, value: formatMetric(metric, p.value, true) },
                  ...(group !== null ? [{ name: "Cả nhóm", value: formatMetric(metric, group, true) }] : []),
                ]}
              />
            );
          }}
        />
        {group !== null && (
          <ReferenceLine
            y={group}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{
              value: metric.kind === "sum" ? "TB mỗi người" : "Cả nhóm",
              position: "insideTopRight",
              fontSize: 11,
              fill: "var(--muted-foreground)",
            }}
          />
        )}
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.key} fill={slotVar(d.slot)} />
          ))}
          <LabelList
            dataKey="value"
            position="top"
            offset={6}
            className="fill-foreground"
            fontSize={11}
            fontWeight={600}
            formatter={(v: unknown) => (typeof v === "number" ? compactMetric(metric, v) : "")}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Bản đồ hiệu quả: trục ngang = số data mang về, trục dọc = giá mỗi data. Hai đường nét đứt (trung bình
 * của nhóm) chia 4 góc — góc dưới bên phải là "nhiều data, giá rẻ" (tốt nhất).
 */
export function EfficiencyMap({
  rows,
  height = "h-80",
  by = "data",
}: {
  rows: EntityValue[];
  height?: string;
  /** "data": data × giá data (nhân viên); "messages": mess × giá mess (TKQC — data không tách theo TKQC). */
  by?: "data" | "messages";
}) {
  const pick = (t: Totals) => (by === "data" ? t.data : t.messages);
  const data = rows
    .map((r) => ({ ...r, x: pick(r.totals), y: pick(r.totals) > 0 ? r.totals.spend / pick(r.totals) : null }))
    .filter((d): d is typeof d & { y: number } => d.y !== null);
  if (data.length < 2) {
    return (
      <p className={cn("flex items-center justify-center text-center text-sm text-muted-foreground", height)}>
        Cần ít nhất 2 {by === "data" ? "người đã có data" : "TKQC đã có mess"} trong khoảng này để vẽ.
      </p>
    );
  }
  const totalData = data.reduce((s, d) => s + d.x, 0);
  const totalSpend = data.reduce((s, d) => s + d.totals.spend, 0);
  const avgX = totalData / data.length;
  const avgY = totalData > 0 ? totalSpend / totalData : 0;
  const cost = METRICS.find((m) => m.key === (by === "data" ? "costPerData" : "costPerMessage")) ?? METRICS[0];
  const count = METRICS.find((m) => m.key === by) ?? METRICS[0];
  const corner = "pointer-events-none absolute text-[11px] font-medium text-muted-foreground";

  return (
    <div className="relative">
      <ChartContainer config={slotConfig(data.map((d) => d.slot))} className={cn("aspect-auto w-full", height)}>
        <ScatterChart accessibilityLayer margin={{ top: 24, right: 56, bottom: 8, left: 0 }}>
          <CartesianGrid />
          <XAxis
            type="number"
            dataKey="x"
            name={count.label}
            tickLine={false}
            axisLine={false}
            tick={axisTick}
            tickFormatter={(v: number) => compactMetric(count, v)}
            domain={[0, "auto"]}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={cost.label}
            tickLine={false}
            axisLine={false}
            width={52}
            tick={axisTick}
            tickFormatter={(v: number) => compactMetric(cost, v)}
            domain={[0, "auto"]}
          />
          <ZAxis range={[160, 160]} />
          <ReferenceLine x={avgX} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
          <ReferenceLine y={avgY} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
          <ChartTooltip
            cursor={false}
            content={({ active, payload }) => {
              const p = active ? payload?.[0]?.payload : null;
              if (!p) return null;
              return (
                <TipBox
                  title={p.name}
                  rows={[
                    { color: slotVar(p.slot), name: count.label, value: formatMetric(count, p.x) },
                    { name: cost.label, value: formatMetric(cost, p.y, true) },
                    { name: "Chi tiêu", value: `${Math.round(p.totals.spend).toLocaleString("vi-VN")}đ` },
                  ]}
                />
              );
            }}
          />
          <Scatter data={data} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.key} fill={slotVar(d.slot)} stroke="var(--card)" strokeWidth={2} />
            ))}
            <LabelList
              dataKey="name"
              content={({ x, y, value }) => (
                // Tên đầy đủ trên một dòng (nhãn mặc định tự xuống dòng theo bề rộng chấm).
                <text
                  x={Number(x ?? 0) + 7}
                  y={Number(y ?? 0) - 4}
                  textAnchor="middle"
                  className="fill-foreground"
                  fontSize={12}
                  fontWeight={500}
                >
                  {String(value ?? "")}
                </text>
              )}
            />
          </Scatter>
        </ScatterChart>
      </ChartContainer>
      <span className={cn(corner, "right-14 bottom-9")}>Nhiều {count.label.toLowerCase()} · giá rẻ ✓</span>
      <span className={cn(corner, "top-1 left-14")}>Ít {count.label.toLowerCase()} · giá đắt</span>
    </div>
  );
}

/** Thanh tỉ trọng 100%: mỗi người chiếm bao nhiêu phần chi tiêu / mess / data của cả nhóm. */
export function ShareBars({ rows }: { rows: EntityValue[] }) {
  const parts: { label: string; pick: (t: Totals) => number }[] = [
    { label: "Chi tiêu", pick: (t) => t.spend },
    { label: "Mess", pick: (t) => t.messages },
    { label: "Data", pick: (t) => t.data },
  ];
  return (
    <div className="grid gap-3">
      {parts.map((part) => {
        const total = rows.reduce((s, r) => s + part.pick(r.totals), 0);
        return (
          <div key={part.label} className="grid gap-1 sm:grid-cols-[5rem_1fr] sm:items-center sm:gap-3">
            <span className="text-sm text-muted-foreground">{part.label}</span>
            {total === 0 ? (
              <span className="text-sm text-muted-foreground">Chưa có số</span>
            ) : (
              <div className="flex h-7 w-full gap-0.5 overflow-hidden rounded-md">
                {rows.map((r) => {
                  const share = part.pick(r.totals) / total;
                  if (share <= 0) return null;
                  const pct = (share * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
                  return (
                    <div
                      key={r.key}
                      className="relative h-full"
                      style={{ width: `${share * 100}%` }}
                      title={`${r.name}: ${pct}% ${part.label.toLowerCase()} của nhóm`}
                    >
                      <Swatch slot={r.slot} className="size-full rounded-none" />
                      {share >= 0.12 && (
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white tabular-nums [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">
                          {pct}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
