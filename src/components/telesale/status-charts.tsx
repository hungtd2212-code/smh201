"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { LEAD_STATUSES } from "@/lib/leads/status";
import { formatPercent, type StatusCount } from "@/lib/leads/stats";

/** Nhãn + màu của từng trạng thái cho tooltip biểu đồ. */
const STATUS_CONFIG: ChartConfig = {
  count: { label: "Số lead" },
  ...Object.fromEntries(
    LEAD_STATUSES.map((s) => [s.key, { label: s.label, color: s.color }]),
  ),
};

const toChartData = (byStatus: StatusCount[]) =>
  byStatus.map((s) => ({ ...s, fill: s.color }));

/** Cột: số lead theo từng trạng thái. */
export function StatusBarChart({ byStatus }: { byStatus: StatusCount[] }) {
  return (
    <ChartContainer config={STATUS_CONFIG} className="aspect-auto h-80 w-full">
      <BarChart
        accessibilityLayer
        data={toChartData(byStatus)}
        margin={{ top: 20, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          interval={0}
          angle={-28}
          textAnchor="end"
          height={86}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={36}
          tick={{ fontSize: 11 }}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={<ChartTooltipContent nameKey="key" hideLabel />}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={34}>
          <LabelList
            dataKey="count"
            position="top"
            offset={6}
            className="fill-foreground"
            fontSize={11}
            fontWeight={600}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Vành khuyên: tỷ lệ phần trăm theo trạng thái, kèm chú giải có số liệu. */
export function StatusPieChart({
  byStatus,
  total,
}: {
  byStatus: StatusCount[];
  total: number;
}) {
  const slices = toChartData(byStatus)
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);

  if (total === 0) {
    return (
      <p className="flex h-80 items-center justify-center text-sm text-muted-foreground">
        Không có lead trong khoảng thời gian này
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="relative mx-auto size-48">
        <ChartContainer config={STATUS_CONFIG} className="size-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
            <Pie
              data={slices}
              dataKey="count"
              nameKey="key"
              innerRadius="58%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums">
            {total.toLocaleString("vi-VN")}
          </span>
          <span className="text-xs text-muted-foreground">lead</span>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: s.color }}
            />
            <span className="truncate text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-medium tabular-nums">
              {formatPercent(s.percent)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
