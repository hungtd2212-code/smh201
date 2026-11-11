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
  blue: {
    card: "border-blue-200 from-blue-50 dark:border-blue-900/60 dark:from-blue-950/40",
    value: "text-blue-700 dark:text-blue-300",
    sub: "text-blue-600 dark:text-blue-400",
    icon: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300",
  },
  violet: {
    card: "border-violet-200 from-violet-50 dark:border-violet-900/60 dark:from-violet-950/40",
    value: "text-violet-700 dark:text-violet-300",
    sub: "text-violet-600 dark:text-violet-400",
    icon: "bg-violet-100 text-violet-600 dark:bg-violet-900/50 dark:text-violet-300",
  },
  amber: {
    card: "border-amber-200 from-amber-50 dark:border-amber-900/60 dark:from-amber-950/40",
    value: "text-amber-700 dark:text-amber-300",
    sub: "text-amber-700 dark:text-amber-400",
    icon: "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-300",
  },
  emerald: {
    card: "border-emerald-200 from-emerald-50 dark:border-emerald-900/60 dark:from-emerald-950/40",
    value: "text-emerald-700 dark:text-emerald-300",
    sub: "text-emerald-700 dark:text-emerald-400",
    icon: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300",
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
        "flex items-start justify-between rounded-xl border bg-linear-to-br to-card p-5",
        t.card,
      )}
    >
      <div className="grid gap-1.5">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("text-3xl font-bold tabular-nums", t.value)}>
          {value.toLocaleString("vi-VN")}
        </span>
        <span className={cn("text-xs", t.sub)}>{sub}</span>
      </div>
      <span className={cn("flex size-10 items-center justify-center rounded-lg", t.icon)}>
        <Icon className="size-5" />
      </span>
    </div>
  );
}

export function StatCards({ stats }: { stats: LeadStats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        tone="blue"
        icon={Phone}
        label={`Tổng số (${APP.branch.name})`}
        value={stats.total}
        sub="Toàn bộ lead Telesale"
      />
      <StatCard
        tone="violet"
        icon={CheckCheck}
        label="Số sale thực nhận"
        value={stats.received}
        sub={`${ratio(stats.received, stats.total)} tổng số`}
      />
      <StatCard
        tone="amber"
        icon={CalendarCheck}
        label="Số lịch"
        value={stats.appointments}
        sub={`${ratio(stats.appointments, stats.received)} số thực nhận`}
      />
      <StatCard
        tone="emerald"
        icon={Sparkles}
        label="Tiềm năng"
        value={stats.potential}
        sub="Cơ hội chốt"
      />
    </div>
  );
}
