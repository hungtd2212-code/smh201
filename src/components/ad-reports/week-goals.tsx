"use client";

import { CheckCircle2, Clock3, Flag, Minus, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { StaffAvatar } from "@/components/staff/staff-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  WEEKDAYS,
  carryGoals,
  dailyGoals,
  daysBetween,
  firstDayOf,
  goalOf,
  judge,
  lastDayOf,
  phaseOf,
  sumDays,
  totalsByDay,
  weekdayOf,
  weeksOfMonth,
  type DayGoal,
  type Entry,
  type KpiCheck,
  type Phase,
  type TargetValues,
  type Totals,
  type Verdict,
  type Week,
  type WeekPlan,
} from "@/lib/ad-reports/aggregate";
import { formatDay, monthLabel } from "@/lib/ad-reports/dates";
import { formatNumber } from "@/lib/ad-reports/number";
import { carryModeFor, targetFor } from "@/lib/ad-reports/targets";
import type { AdAccountAssignment, AdsStaff } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { GlassBar, TONE_TEXT, type Tone } from "./glass";
import { RangePicker, type DayRange } from "./period-picker";
import type { TargetsState } from "./targets";

/**
 * Về đích theo tuần & ngày (như sheet "Báo cáo tuần"): mục tiêu tháng chia đều xuống từng ngày, tuần (T2 → CN, cắt ở
 * đầu / cuối tháng) = cộng các ngày. Về đích = đủ số điện thoại VÀ giá số / giá mess không vượt mức tối đa.
 * Tuần đã qua mà chưa đủ số: phần thiếu dồn sang tuần sau hoặc chia đều cho các tuần còn lại — Quản trị / Trưởng
 * Marketing chốt một cách cho cả công ty trong hộp Mục tiêu (file 017); nhân viên chỉ xem. Ô "Cả tháng" vẫn so với mục
 * tiêu tháng gốc.
 * "Cá nhân về đích thì tổ chức về đích — mỗi ngày về đích thì cả tuần về đích, cả tuần về đích thì cả tháng về đích."
 *   • Quản lý xem tất cả: bảng mỗi người một dòng × mỗi tuần một cột (+ dòng cả công ty), bấm tên để xem lịch từng ngày.
 *   • Một người (nhân viên tự xem, hoặc quản lý lọc một người): lịch từng ngày của người đó.
 * Bấm vào một tuần / một ngày để lọc cả trang Tổng quan theo khoảng đó.
 */

type Line = {
  key: string;
  name: string;
  avatar: string | null;
  team: boolean;
  target: TargetValues | null;
  /** Mục tiêu từng ngày chia đều đầu tháng (dùng cho ô "Cả tháng"). */
  baseGoals: Map<string, DayGoal>;
  /** Mục tiêu từng ngày sau khi dồn phần thiếu của các tuần không đạt. */
  goals: Map<string, DayGoal>;
  /** Kế hoạch từng tuần (cùng thứ tự với các tuần của tháng). */
  plans: WeekPlan[];
  byDay: Map<string, Totals>;
};

const CARRY_TEXT = { spread: "chia đều các tuần còn lại", next: "dồn sang tuần sau" } as const;

type Result = { totals: Totals; goal: DayGoal; verdict: Verdict; phase: Phase; tone: Tone; fill: number };

const isCap = (c: KpiCheck) => c.key === "costPerData" || c.key === "costPerMessage";

/** Kết quả của một dòng trên các ngày `days` (một ngày, một tuần hay cả tháng). `goals`: mặc định mục tiêu đã dồn. */
function resultOf(line: Line, days: string[], today: string, goals = line.goals): Result {
  const phase = phaseOf(days[0], days.at(-1) ?? days[0], today);
  const passed = days.filter((d) => d <= today);
  const totals = sumDays(line.byDay, passed);
  const goal = goalOf(goals, days);
  const verdict = judge(totals, goal, line.target);
  let tone: Tone;
  if (phase === "future" || verdict.met === null) tone = "none";
  else if (verdict.met) tone = "good";
  else if (phase === "past") tone = "bad";
  else {
    // Đang chạy: giá đang vượt, hoặc số điện thoại chậm hơn 15% so với phần mục tiêu tới hôm nay → nhắc (vàng).
    const expected = goalOf(goals, passed).data;
    const slow = expected !== null && totals.data < expected * 0.85;
    tone = verdict.checks.some((c) => isCap(c) && !c.met) || slow ? "warning" : "running";
  }
  const fill = goal.data ? totals.data / goal.data : verdict.met ? 1 : 0;
  return { totals, goal, verdict, phase, tone, fill };
}

const money = (value: number) => `${formatNumber(value)}đ`;

/** Dòng giải thích mục tiêu tuần có phần dồn: "70 chia đều + 30 dồn từ tuần trước = 100 số". */
const carryText = (plan?: WeekPlan) =>
  plan && plan.carriedIn > 0 && plan.base !== null
    ? `• Mục tiêu tuần: ${formatNumber(plan.base)} chia đều + ${formatNumber(plan.carriedIn)} dồn từ tuần trước = ${formatNumber(plan.base + plan.carriedIn)} số`
    : null;

/** Chữ hiện khi rê chuột: từng chỉ tiêu đạt / chưa. `plan`: kế hoạch tuần (để ghi phần dồn). */
function describe(name: string, label: string, r: Result, plan?: WeekPlan) {
  const carry = carryText(plan);
  if (r.phase === "future") {
    const head = `${name} — ${label}: chưa tới${r.goal.data ? ` (cần ${formatNumber(r.goal.data)} số)` : ""}`;
    return carry ? `${head}\n${carry}` : head;
  }
  const head =
    r.verdict.met === null
      ? r.totals.spend === 0 && r.totals.data === 0
        ? "chưa có số để xét"
        : "chưa đặt mục tiêu số điện thoại / giá"
      : r.verdict.met
        ? "VỀ ĐÍCH ✓"
        : r.phase === "current"
          ? "đang chạy"
          : "chưa về đích ✗";
  const lines = r.verdict.checks.map((c) => {
    const value = c.actual === null ? "chưa có số" : c.key === "data" ? formatNumber(c.actual) : money(c.actual);
    const goal = c.key === "data" ? formatNumber(c.goal) : money(c.goal);
    const rule = c.kind === "min" ? `cần ≥ ${goal}` : `tối đa ${goal}`;
    return `• ${c.label}: ${value} (${rule}) ${c.met ? "✓" : "✗"}${c.key === "budget" ? " — chỉ nhắc" : ""}`;
  });
  if (r.verdict.checks.length === 0) lines.push(`• Số điện thoại: ${formatNumber(r.totals.data)}`);
  if (carry) lines.unshift(carry);
  return [`${name} — ${label}: ${head}`, ...lines].join("\n");
}

/** Nhãn nhỏ "+30 dồn" trên ô tuần nhận phần thiếu của tuần trước. */
function CarryBadge({ plan }: { plan?: WeekPlan }) {
  if (!plan || plan.carriedIn <= 0) return null;
  return (
    <span className="w-fit rounded-full bg-amber-100/90 px-1.5 text-[10px] font-semibold text-amber-800 tabular-nums dark:bg-amber-900/50 dark:text-amber-200">
      +{formatNumber(plan.carriedIn)} dồn
    </span>
  );
}

function StatusIcon({ tone, phase }: { tone: Tone; phase: Phase }) {
  const size = "size-3.5 shrink-0";
  if (phase === "future") return <Minus className={cn(size, "text-muted-foreground/50")} aria-label="Chưa tới" />;
  if (tone === "good") return <CheckCircle2 className={cn(size, "text-emerald-500")} aria-label="Về đích" />;
  if (tone === "bad") return <XCircle className={cn(size, "text-rose-500")} aria-label="Chưa về đích" />;
  if (tone === "running") return <Clock3 className={cn(size, "text-sky-500")} aria-label="Đang chạy" />;
  if (tone === "warning") return <Clock3 className={cn(size, "text-amber-500")} aria-label="Đang chậm" />;
  return <Minus className={cn(size, "text-muted-foreground/50")} aria-label="Chưa đặt mục tiêu" />;
}

const OUTLINE: Record<Tone, string> = {
  good: "outline-emerald-400/70",
  bad: "outline-rose-400/60",
  warning: "outline-amber-400/70",
  running: "outline-sky-400/60",
  none: "outline-transparent",
};

/** Số điện thoại / mục tiêu gọn: "12/34", tuần chưa tới: "cần 238". */
/** `compact`: ô ngày trên điện thoại (rộng ~40px) chỉ hiện số đạt được; mục tiêu xem khi bấm / rê chuột. */
function DataText({ r, compact = false }: { r: Result; compact?: boolean }) {
  const narrowHidden = compact ? "max-sm:hidden" : undefined;
  if (r.phase === "future") {
    return (
      <span className="text-muted-foreground tabular-nums">
        {r.goal.data ? (
          <>
            <span className={narrowHidden}>cần </span>
            {formatNumber(r.goal.data)}
          </>
        ) : (
          "—"
        )}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      <span className="font-semibold">{formatNumber(r.totals.data)}</span>
      {r.goal.data ? (
        <span className={cn("text-muted-foreground", narrowHidden)}>/{formatNumber(r.goal.data)}</span>
      ) : (
        <span className={cn("text-muted-foreground", narrowHidden)}> số</span>
      )}
    </span>
  );
}

/** Ô tổng nổi bật hơn ô thường: Cả tháng xanh ngọc (cùng màu "Tháng" ở phần mục tiêu), Cả tuần tím nhạt. */
const ACCENT = {
  month:
    "border border-cyan-300/80 bg-linear-to-br from-cyan-100 to-sky-50 shadow-[0_6px_16px_-10px] shadow-cyan-600/40 dark:border-cyan-400/30 dark:from-cyan-500/25 dark:to-cyan-500/10",
  week:
    "border border-violet-300/80 bg-linear-to-br from-violet-100 to-fuchsia-50 shadow-[0_6px_16px_-10px] shadow-violet-600/40 dark:border-violet-400/30 dark:from-violet-500/25 dark:to-violet-500/10",
} as const;
const ACCENT_TEXT = {
  month: "text-cyan-700 dark:text-cyan-300",
  week: "text-violet-700 dark:text-violet-300",
} as const;

/** Ô kết quả của một tuần / cả tháng. `accent` = ô tổng (cả tháng, cả tuần): nền màu, số to hơn. */
function ResultCell({
  r,
  title,
  selected,
  onClick,
  extra,
  accent,
}: {
  r: Result;
  title: string;
  selected?: boolean;
  onClick?: () => void;
  extra?: React.ReactNode;
  accent?: keyof typeof ACCENT;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "grid w-full min-w-[5.5rem] gap-1 rounded-xl px-2 py-1.5 text-left outline-1 -outline-offset-1 transition-transform hover:-translate-y-px",
        accent ? ACCENT[accent] : "glass-soft",
        OUTLINE[r.tone],
        selected && "outline-2 outline-sky-500",
        r.phase === "future" && "opacity-60",
      )}
    >
      <span className={cn("flex items-center justify-between gap-1", accent ? "text-sm" : "text-xs")}>
        <DataText r={r} />
        <StatusIcon tone={r.tone} phase={r.phase} />
      </span>
      <GlassBar size="sm" fill={r.fill} tone={r.tone} label={title.split("\n")[0]} />
      {extra}
    </button>
  );
}

/** Ô một ngày trên lịch. */
function DayCell({ day, r, name, selected, onClick }: { day: string; r: Result; name: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={describe(name, `ngày ${formatDay(day)}`, r)}
      className={cn(
        "glass-soft grid h-[3.3rem] w-full content-between rounded-lg px-1 pt-1 pb-1.5 text-left outline-1 -outline-offset-1 transition-transform hover:-translate-y-px sm:h-[3.6rem] sm:rounded-xl sm:px-1.5",
        OUTLINE[r.tone],
        selected && "outline-2 outline-sky-500",
        r.phase === "future" && "opacity-55",
      )}
    >
      <span className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
        {Number(day.slice(8))}
        <StatusIcon tone={r.tone} phase={r.phase} />
      </span>
      <span className="truncate text-xs">
        <DataText r={r} compact />
      </span>
      <GlassBar size="sm" fill={r.fill} tone={r.tone} label={`Ngày ${formatDay(day)}`} />
    </button>
  );
}

const sameRange = (range: DayRange | null, from: string, to: string) => range?.from === from && range?.to === to;
const weekSpan = (w: Week) => `${w.from.slice(8)}–${formatDay(w.to).slice(0, 5)}`;

/** Lịch từng ngày (T2 → CN) của một dòng, cột cuối = cả tuần, dưới cùng = cả tháng. */
function DayCalendar({
  line,
  weeks,
  today,
  range,
  onPickRange,
}: {
  line: Line;
  weeks: Week[];
  today: string;
  range: DayRange | null;
  onPickRange: (range: DayRange | null) => void;
}) {
  const days = weeks.flatMap((w) => w.days);
  const dayResults = days.map((day) => ({ day, r: resultOf(line, [day], today) }));
  const judgedDays = dayResults.filter((d) => d.r.phase === "past" && d.r.verdict.met !== null);
  const weekResults = weeks.map((w, i) => ({ w, r: resultOf(line, w.days, today), plan: line.plans[i] }));
  const judgedWeeks = weekResults.filter((x) => x.r.phase === "past" && x.r.verdict.met !== null);
  const month = resultOf(line, days, today, line.baseGoals);
  // Hàng lịch = tuần lịch T2 → CN; tuần báo cáo gộp (vd 1–8/11) chiếm 2 hàng, ô "Cả tuần" kéo dài theo.
  const rowOf = new Map<string, number>();
  let row = 0;
  for (const [i, day] of days.entries()) {
    if (i > 0 && weekdayOf(day) === 0) row += 1;
    rowOf.set(day, row);
  }

  return (
    <div className="grid gap-2">
      <div className="pb-1 sm:overflow-x-auto">
        <div className="grid grid-cols-7 gap-1 sm:min-w-[36rem] sm:grid-cols-[repeat(7,minmax(0,1fr))_minmax(6.5rem,1.3fr)] sm:gap-1.5">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className="text-center text-[11px] font-medium text-muted-foreground" style={{ gridRow: 1, gridColumn: i + 1 }}>
              {d}
            </div>
          ))}
          <div className={cn("hidden text-center text-[11px] font-semibold sm:block", ACCENT_TEXT.week)} style={{ gridRow: 1, gridColumn: 8 }}>
            Cả tuần
          </div>
          {dayResults.map(({ day, r }) => (
            <div key={day} style={{ gridRow: (rowOf.get(day) ?? 0) + 2, gridColumn: weekdayOf(day) + 1 }}>
              <DayCell
                day={day}
                r={r}
                name={line.name}
                selected={sameRange(range, day, day)}
                onClick={() => onPickRange(sameRange(range, day, day) ? null : { from: day, to: day })}
              />
            </div>
          ))}
          {weekResults.map(({ w, r, plan }) => {
            const first = rowOf.get(w.from) ?? 0;
            const span = (rowOf.get(w.to) ?? first) - first + 1;
            return (
              <div key={w.index} className="hidden sm:grid" style={{ gridRow: `${first + 2} / span ${span}`, gridColumn: 8 }}>
                <ResultCell
                  r={r}
                  title={describe(line.name, `tuần ${w.index} (${weekSpan(w)})`, r, plan)}
                  selected={sameRange(range, w.from, w.to)}
                  onClick={() => onPickRange(sameRange(range, w.from, w.to) ? null : { from: w.from, to: w.to })}
                  accent="week"
                  extra={
                    <span className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                      Tuần {w.index} · {weekSpan(w)}
                      <CarryBadge plan={plan} />
                    </span>
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
      {/* Điện thoại: cột "Cả tuần" nằm dưới lịch, hai ô một hàng. */}
      <div className="grid grid-cols-2 gap-1.5 sm:hidden">
        {weekResults.map(({ w, r, plan }) => (
          <ResultCell
            key={w.index}
            r={r}
            title={describe(line.name, `tuần ${w.index} (${weekSpan(w)})`, r, plan)}
            selected={sameRange(range, w.from, w.to)}
            onClick={() => onPickRange(sameRange(range, w.from, w.to) ? null : { from: w.from, to: w.to })}
            accent="week"
            extra={
              <span className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                Tuần {w.index} · {weekSpan(w)}
                <CarryBadge plan={plan} />
              </span>
            }
          />
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          <b className="tabular-nums">
            {judgedDays.filter((d) => d.r.verdict.met).length}/{judgedDays.length}
          </b>{" "}
          ngày về đích
        </span>
        <span>
          <b className="tabular-nums">
            {judgedWeeks.filter((x) => x.r.verdict.met).length}/{judgedWeeks.length}
          </b>{" "}
          tuần về đích
        </span>
        <span className={cn("flex items-center gap-1", TONE_TEXT[month.tone])}>
          <StatusIcon tone={month.tone} phase={month.phase} />
          Cả tháng:{" "}
          {month.verdict.met === null
            ? "chưa đặt mục tiêu"
            : month.verdict.met
              ? "về đích"
              : month.phase === "past"
                ? "chưa về đích"
                : `đang chạy — ${formatNumber(month.totals.data)}${month.goal.data ? `/${formatNumber(month.goal.data)}` : ""} số`}
        </span>
        <span className="text-muted-foreground">(chỉ tính ngày / tuần đã qua)</span>
      </p>
    </div>
  );
}

export function WeekGoals({
  month,
  today,
  entries,
  people,
  assignments,
  avatarOf,
  staffId,
  who,
  targetsState,
  range,
  onPickRange,
  onEditTargets,
}: {
  month: string;
  today: string;
  entries: Entry[];
  /** Mọi nhân viên Ads (để dựng bảng khi xem tất cả). */
  people: AdsStaff[];
  assignments: AdAccountAssignment[];
  avatarOf: (p: AdsStaff) => string | null;
  /** Đang xem một người (null = tất cả nhân viên / cả công ty). */
  staffId: string | null;
  who: string;
  targetsState: TargetsState;
  range: DayRange | null;
  onPickRange: (range: DayRange | null) => void;
  /** Quản lý: mở hộp Mục tiêu (để đổi cách dồn). */
  onEditTargets?: () => void;
}) {
  const [focus, setFocus] = useState<string>("team");
  const weeks = useMemo(() => weeksOfMonth(month), [month]);
  const targets = targetsState.status === "ready" ? targetsState.targets : null;
  const carry = useMemo(() => carryModeFor(targets ?? [], month), [targets, month]);
  const carryMode = carry.mode;

  const lines = useMemo(() => {
    if (!targets) return [];
    const from = firstDayOf(month);
    const to = lastDayOf(month);
    const monthDays = new Set(daysBetween(from, to));
    // Mục tiêu chia đều đầu tháng, rồi dồn phần thiếu của các tuần đã qua mà chưa đủ số.
    const plan = (target: TargetValues | null, byDay: Map<string, Totals>) => {
      const baseGoals = dailyGoals(target, month);
      const { goals, plans } = carryGoals(baseGoals, weeks, (days) => sumDays(byDay, days).data, today, carryMode);
      return { baseGoals, goals, plans };
    };
    const make = (p: AdsStaff): Line => {
      const target = targetFor(targets, p.id, month);
      const byDay = totalsByDay(entries, p.id, (d) => monthDays.has(d));
      return { key: p.id, name: p.full_name, avatar: avatarOf(p), team: false, target, byDay, ...plan(target, byDay) };
    };
    if (staffId) {
      const p = people.find((x) => x.id === staffId);
      return p ? [make(p)] : [];
    }
    // Người có TKQC trong tháng hoặc đã có số.
    const shown = people
      .filter(
        (p) =>
          assignments.some((x) => x.ads_staff_id === p.id && x.from_date <= to && (!x.to_date || x.to_date >= from)) ||
          entries.some((e) => e.staffId === p.id && monthDays.has(e.day)),
      )
      .map(make);
    // Cả công ty: mục tiêu dòng "Cả nhóm"; chưa đặt số / ngân sách chung thì cộng của từng người.
    const team = targetFor(targets, null, month);
    const sum = (pick: (t: TargetValues) => number | null | undefined) =>
      shown.reduce((s, l) => s + (l.target ? (pick(l.target) ?? 0) : 0), 0) || null;
    const teamTarget: TargetValues | null =
      team || shown.some((l) => l.target)
        ? {
            monthly_budget: team?.monthly_budget ?? sum((t) => t.monthly_budget),
            monthly_data: team?.monthly_data ?? sum((t) => t.monthly_data),
            max_cost_per_data: team?.max_cost_per_data ?? null,
            max_cost_per_message: team?.max_cost_per_message ?? null,
          }
        : null;
    const teamByDay = totalsByDay(entries, null, (d) => monthDays.has(d));
    const teamLine: Line = {
      key: "team",
      name: "Cả công ty",
      avatar: null,
      team: true,
      target: teamTarget,
      byDay: teamByDay,
      ...plan(teamTarget, teamByDay),
    };
    return [teamLine, ...shown];
  }, [targets, month, weeks, today, carryMode, staffId, people, assignments, entries, avatarOf]);

  if (targetsState.status === "loading") return <Skeleton className="h-72 w-full rounded-3xl" />;
  if (!targets || lines.length === 0) return null;

  const focused = lines.find((l) => l.key === focus) ?? lines[0];
  const anyTarget = lines.some((l) => l.target?.monthly_data || l.target?.max_cost_per_data || l.target?.max_cost_per_message);
  const staffLines = lines.filter((l) => !l.team);
  const monthDays = weeks.flatMap((w) => w.days);

  return (
    <section className="glass-stage grid gap-3 overflow-hidden rounded-3xl border border-white/70 p-3 sm:p-4 dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <span className="glass flex size-7 items-center justify-center rounded-full">
              <Flag className="size-3.5" />
            </span>
            Về đích theo tuần & ngày — {who} · {monthLabel(month).toLowerCase()}
          </h2>
          <p className="text-[11px] text-muted-foreground sm:hidden">
            Mục tiêu chia đều từng ngày; tuần không đạt thì dồn phần thiếu. Bấm một tuần hay một ngày để lọc cả trang.
          </p>
          <p className="hidden max-w-3xl text-[11px] text-muted-foreground sm:block">
            Đầu tháng mục tiêu chia đều cho từng ngày; tuần (thứ Hai → Chủ nhật) = cộng các ngày. Tuần đã qua mà chưa đủ số
            thì phần thiếu được dồn tiếp theo cách quản lý đã chốt (bên phải). Về đích = đủ số điện thoại và giá số, giá mess không vượt
            mức tối đa (vượt ngân sách chỉ nhắc). Rê chuột để xem chi tiết; bấm một tuần hay một ngày để lọc cả trang.
          </p>
        </div>
        <div className="grid gap-1.5 sm:justify-items-end">
          <span className="glass-soft w-fit rounded-full px-3 py-1 text-[11px] font-medium italic">
            Cá nhân về đích → tổ chức về đích · Ngày về đích → tuần về đích → tháng về đích
          </span>
          <div className="glass-soft flex flex-wrap items-center gap-1.5 rounded-full py-1 pr-1 pl-3 text-[11px]">
            <span className="text-muted-foreground">Tuần không đạt thì phần thiếu:</span>
            <span className="font-semibold">{CARRY_TEXT[carryMode]}</span>
            <span className="text-muted-foreground">
              {carry.from ? `(quản lý chốt${carry.from !== month ? ` từ ${monthLabel(carry.from).toLowerCase()}` : ""})` : "(mặc định)"}
            </span>
            {onEditTargets ? (
              <button
                type="button"
                onClick={onEditTargets}
                className="rounded-full bg-foreground px-2.5 py-1 font-medium text-background shadow-sm transition-opacity hover:opacity-85"
              >
                Đổi
              </button>
            ) : (
              <span className="pr-2" />
            )}
          </div>
        </div>
      </div>

      {!anyTarget ? (
        <p className="glass-soft rounded-2xl px-4 py-2.5 text-sm text-muted-foreground">
          {monthLabel(month)} chưa có mục tiêu số điện thoại / giá số nên chưa xét về đích — dưới đây chỉ là số thực đạt.
        </p>
      ) : (
        !lines.some((l) => l.target?.monthly_data) && (
          <p className="glass-soft rounded-2xl px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
            {monthLabel(month)} chưa đặt mục tiêu <b>số điện thoại</b> nên đang chỉ xét giá số / giá mess. Đặt “Số điện thoại
            (data) / tháng” trong nút Mục tiêu để biết mỗi ngày, mỗi tuần cần bao nhiêu số.
          </p>
        )
      )}

      {lines.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1.5">
            <thead>
              <tr>
                <th className="px-1 text-left text-[11px] font-medium text-muted-foreground max-sm:sticky max-sm:left-0 max-sm:z-10">
                  <span className="max-sm:hidden">Bấm tên để xem từng ngày</span>
                  <span className="sm:hidden">Bấm tên xem ngày</span>
                </th>
                {weeks.map((w) => (
                  <th key={w.index} className="px-1 text-left text-[11px] font-medium text-muted-foreground">
                    <button
                      type="button"
                      className={cn("grid text-left hover:text-foreground", sameRange(range, w.from, w.to) && "text-sky-600 dark:text-sky-400")}
                      onClick={() => onPickRange(sameRange(range, w.from, w.to) ? null : { from: w.from, to: w.to })}
                    >
                      <span className="font-semibold">Tuần {w.index}</span>
                      <span className="tabular-nums">{weekSpan(w)}</span>
                    </button>
                  </th>
                ))}
                <th className={cn("px-1 text-left text-[11px] font-medium", ACCENT_TEXT.month)}>
                  <span className="grid">
                    <span className="font-semibold">Cả tháng</span>
                    <span className="tabular-nums">{monthLabel(month).slice(6)}</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const cells = weeks.map((w, i) => {
                  const r = resultOf(line, w.days, today);
                  const plan = line.plans[i];
                  // Dòng cả công ty: bao nhiêu người về đích tuần đó.
                  const judged =
                    line.team && r.phase !== "future"
                      ? staffLines.map((p) => resultOf(p, w.days, today)).filter((x) => x.verdict.met !== null)
                      : [];
                  const extra =
                    judged.length > 0 || (plan && plan.carriedIn > 0) ? (
                      <span className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                        {judged.length > 0 && `${judged.filter((x) => x.verdict.met).length}/${judged.length} người về đích`}
                        <CarryBadge plan={plan} />
                      </span>
                    ) : null;
                  return { w, r, plan, extra };
                });
                const whole = resultOf(line, monthDays, today, line.baseGoals);
                return (
                  <tr key={line.key}>
                    <td className="min-w-32 rounded-xl max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:bg-background/85 max-sm:backdrop-blur-sm sm:min-w-36">
                      <button
                        type="button"
                        onClick={() => setFocus(line.key)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/50 dark:hover:bg-white/5",
                          focused.key === line.key && "glass-soft",
                          line.team && "font-semibold",
                        )}
                      >
                        {line.team ? (
                          <span className="flex size-6 items-center justify-center rounded-full bg-linear-to-br from-cyan-400 to-violet-500 text-white">
                            <Flag className="size-3" />
                          </span>
                        ) : (
                          <StaffAvatar name={line.name} url={line.avatar} className="size-6 text-[10px]" />
                        )}
                        <span className="truncate">{line.name}</span>
                      </button>
                    </td>
                    {cells.map(({ w, r, plan, extra }) => (
                      <td key={w.index}>
                        <ResultCell
                          r={r}
                          title={describe(line.name, `tuần ${w.index} (${weekSpan(w)})`, r, plan)}
                          selected={sameRange(range, w.from, w.to)}
                          onClick={() => onPickRange(sameRange(range, w.from, w.to) ? null : { from: w.from, to: w.to })}
                          extra={extra}
                        />
                      </td>
                    ))}
                    <td>
                      <ResultCell r={whole} title={describe(line.name, monthLabel(month).toLowerCase(), whole)} accent="month" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="glass grid gap-2 rounded-2xl p-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {focused.team ? (
            <Flag className="size-4 text-muted-foreground" />
          ) : (
            <StaffAvatar name={focused.name} url={focused.avatar} className="size-6 text-[10px]" />
          )}
          Từng ngày — {focused.name}
        </div>
        <DayCalendar line={focused} weeks={weeks} today={today} range={range} onPickRange={onPickRange} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Lọc trang theo tuần / ngày                                                                       */
/* ------------------------------------------------------------------------------------------------ */

/** Nút lọc: Cả tháng · Tuần 1…5 · Hôm qua · Hôm nay · Chọn ngày (lịch). `range` = null → cả tháng. */
export function DayFilter({
  month,
  today,
  range,
  onChange,
}: {
  month: string;
  today: string;
  range: DayRange | null;
  onChange: (range: DayRange | null) => void;
}) {
  const weeks = weeksOfMonth(month);
  const yesterday = daysBetween(firstDayOf(month), lastDayOf(month)).filter((d) => d < today).at(-1);
  const chip = (on: boolean) =>
    cn(
      "flex h-8 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors",
      on ? "bg-foreground text-background shadow-sm" : "glass-soft hover:brightness-105",
    );
  const custom = range !== null && !weeks.some((w) => sameRange(range, w.from, w.to)) && range.from !== range.to;
  const lastDay = lastDayOf(month);

  return (
    <div className="glass-stage flex flex-wrap items-center gap-1.5 rounded-2xl border border-white/70 p-1.5 dark:border-white/10" role="group" aria-label="Lọc theo tuần / ngày">
      <button type="button" className={chip(range === null)} onClick={() => onChange(null)}>
        Cả tháng
      </button>
      {weeks.map((w) => (
        <button
          key={w.index}
          type="button"
          disabled={w.from > today}
          className={cn(chip(sameRange(range, w.from, w.to)), w.from > today && "cursor-not-allowed opacity-40")}
          onClick={() => onChange({ from: w.from, to: w.to })}
        >
          Tuần {w.index}
          <span className="text-xs tabular-nums opacity-70">{weekSpan(w)}</span>
        </button>
      ))}
      {yesterday && (
        <button type="button" className={chip(sameRange(range, yesterday, yesterday))} onClick={() => onChange({ from: yesterday, to: yesterday })}>
          Hôm qua
        </button>
      )}
      {month === today.slice(0, 7) && (
        <button type="button" className={chip(sameRange(range, today, today))} onClick={() => onChange({ from: today, to: today })}>
          Hôm nay
        </button>
      )}
      <RangePicker
        label={custom || (range && range.from === range.to) ? "Ngày" : "Chọn ngày"}
        value={range ?? { from: firstDayOf(month), to: today < lastDay ? today : lastDay }}
        today={today}
        onChange={onChange}
      />
    </div>
  );
}
