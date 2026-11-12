import {
  CalendarCheck,
  CheckCheck,
  Phone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { APP } from "@/lib/config";
import { ratio, type LeadStats } from "@/lib/leads/stats";
import { cn } from "@/lib/utils";

const TONES = {
  // Bốn sắc cùng họ xanh của logo (ngọc → dương → chàm → lục), đủ khác để phân biệt mà không chói.
  cyan: {
    card: "border-cyan-200/80 from-cyan-50 dark:border-cyan-900/60 dark:from-cyan-950/40",
    value: "text-cyan-700 dark:text-cyan-300",
    sub: "text-cyan-700 dark:text-cyan-400",
    icon: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  },
  blue: {
    card: "border-blue-200/80 from-blue-50 dark:border-blue-900/60 dark:from-blue-950/40",
    value: "text-blue-700 dark:text-blue-300",
    sub: "text-blue-600 dark:text-blue-400",
    icon: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300",
  },
  indigo: {
    card: "border-indigo-200/80 from-indigo-50 dark:border-indigo-900/60 dark:from-indigo-950/40",
    value: "text-indigo-700 dark:text-indigo-300",
    sub: "text-indigo-600 dark:text-indigo-400",
    icon: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300",
  },
  teal: {
    card: "border-teal-200/80 from-teal-50 dark:border-teal-900/60 dark:from-teal-950/40",
    value: "text-teal-700 dark:text-teal-300",
    sub: "text-teal-700 dark:text-teal-400",
    icon: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300",
  },
} as const;

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  icon: LucideIcon;
  tone: keyof typeof TONES;
}) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-2 rounded-xl border bg-linear-to-br to-card p-3.5 sm:p-5",
        t.card,
      )}
    >
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
        <span className={cn("text-2xl font-bold tabular-nums sm:text-3xl", t.value)}>
          {value.toLocaleString("vi-VN")}
        </span>
        <span className={cn("text-xs", t.sub)}>{sub}</span>
      </div>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-10", t.icon)}>
        <Icon className="size-5" />
      </span>
    </div>
  );
}

export function StatCards({ stats }: { stats: LeadStats }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-4">
      <StatCard
        tone="cyan"
        icon={Phone}
        label={`Tổng số (${APP.branch.name})`}
        value={stats.total}
        sub="Toàn bộ lead Telesale"
      />
      <StatCard
        tone="blue"
        icon={CheckCheck}
        label="Số sale thực nhận"
        value={stats.received}
        sub={`${ratio(stats.received, stats.total)} tổng số`}
      />
      <StatCard
        tone="indigo"
        icon={CalendarCheck}
        label="Số lịch"
        value={stats.appointments}
        sub={`${ratio(stats.appointments, stats.received)} số thực nhận`}
      />
      <StatCard
        tone="teal"
        icon={Sparkles}
        label="Tiềm năng"
        value={stats.potential}
        sub="Cơ hội chốt"
      />
    </div>
  );
}
