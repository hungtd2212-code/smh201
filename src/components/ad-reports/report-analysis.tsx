"use client";

import {
  BadgeDollarSign,
  CalendarDays,
  CalendarRange,
  CalendarSync,
  ChartLine,
  CreditCard,
  Funnel,
  Grid3x3,
  Repeat,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { useAdsScope } from "@/components/catalog/ads-scope";
import { CatalogGate, MarketingNotReady, PageHeader, ReadOnlyNote, useTodayVn } from "@/components/catalog/shared";
import { useCatalogs } from "@/components/catalog-provider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import {
  add,
  daysBetween,
  entriesOf,
  firstDayOf,
  formatMetric,
  lastDayOf,
  metricOf,
  monthElapsed,
  monthsBetween,
  shiftDay,
  shiftMonth,
  sumDays,
  totalsByDay,
  totalsByMonth,
  zero,
  type Metric,
  type MetricKey,
  type Totals,
} from "@/lib/ad-reports/aggregate";
import { formatDay, monthLabel } from "@/lib/ad-reports/dates";
import type { AdAccount } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { ChartCard, CompareLineChart, MAX_SERIES, MetricTabs, TrendChart } from "./charts";
import { useAdReports } from "./hooks";
import { MonthsPicker, RangePicker, YearsPicker, yearOptions, type DayRange } from "./period-picker";
import { Change, FIRST_TH, PeriodTable, TD, TH, type PeriodRow } from "./period-table";
import { AccountRanking } from "./account-ranking";
import { GoalTrackingSection } from "./goal-tracking";
import { Leaderboard, StaffProgress, useLeaderboard } from "./leaderboard";
import { RevenueDialog } from "./revenue";
import { TargetsDialog, useAdTargets, type TargetsState } from "./targets";
import { FunnelView } from "./funnel-view";
import { KpiCards } from "./kpi-cards";
import { NotReady, StatsError } from "./shared";
import { StaffCompare } from "./staff-compare";
import { WeekdayView } from "./weekday-view";

const ALL = "__all";

/**
 * Marketing → Phân tích: so sánh hiệu quả quảng cáo
 *   • So sánh tháng: các tháng tự chọn (bảng, cột theo tháng, đường lũy kế theo ngày trong tháng).
 *   • So sánh khoảng ngày: 3 / 7 / 15 / 30 ngày gần nhất với cùng số ngày liền trước, hoặc hai khoảng tự chọn.
 *   • So sánh năm: các năm tự chọn (cả năm hoặc cùng kỳ đến hôm nay), đường theo tháng, bảng tháng × năm.
 *   • Tháng cùng kỳ: một tháng (ví dụ tháng 11) qua các năm.
 *   • So sánh nhân viên (chỉ quản lý): 2–8 người cạnh nhau trong cùng khoảng ngày.
 *   • Phễu khách hàng: Chi tiêu → Mess → Data → Lead → Hẹn lịch → Đã làm dịch vụ.
 *   • Theo TKQC: xếp hạng từng TKQC. Theo thứ & ngày: thứ nào trong tuần hiệu quả, lịch nhiệt từng ngày.
 * Nhân viên Ads xem số của mình; Quản trị / Trưởng Marketing xem tất cả hoặc từng người.
 */
export function ReportAnalysis() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={ChartLine}
        title="Phân tích"
        description="So sánh hiệu quả quảng cáo giữa các tháng, các khoảng ngày, các năm và tháng cùng kỳ các năm."
      />
      <CatalogGate>
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <AnalysisBody />
        </Suspense>
      </CatalogGate>
    </div>
  );
}

type Mode = "goals" | "staff" | "funnel" | "accounts" | "weekday" | "months" | "days" | "years" | "same-month";
const MODES: { key: Mode; label: string; icon: typeof CalendarDays }[] = [
  { key: "goals", label: "Mục tiêu & vinh danh", icon: Trophy },
  { key: "staff", label: "So sánh nhân viên", icon: Users },
  { key: "funnel", label: "Phễu khách hàng", icon: Funnel },
  { key: "accounts", label: "Theo TKQC", icon: CreditCard },
  { key: "weekday", label: "Theo thứ & ngày", icon: Grid3x3 },
  { key: "months", label: "So sánh tháng", icon: CalendarRange },
  { key: "days", label: "So sánh khoảng ngày", icon: CalendarDays },
  { key: "years", label: "So sánh năm", icon: CalendarSync },
  { key: "same-month", label: "Tháng cùng kỳ", icon: Repeat },
];
const PRESETS = [3, 7, 15, 30] as const;
type Preset = (typeof PRESETS)[number] | "custom";
type StaffPeriod = "7" | "30" | "this-month" | "last-month" | "this-year" | "custom";
const STAFF_PERIODS: { value: StaffPeriod; label: string }[] = [
  { value: "7", label: "7 ngày" },
  { value: "30", label: "30 ngày" },
  { value: "this-month", label: "Tháng này" },
  { value: "last-month", label: "Tháng trước" },
  { value: "this-year", label: "Năm nay" },
  { value: "custom", label: "Tuỳ chỉnh" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const firstYearOf = (accounts: AdAccount[], fallback: number) =>
  Math.min(fallback, ...accounts.map((a) => (a.created_at ? Number(a.created_at.slice(0, 4)) : fallback)));
const rangeText = (r: DayRange) => (r.from === r.to ? formatDay(r.from) : `${formatDay(r.from)} – ${formatDay(r.to)}`);
const lengthOf = (r: DayRange) => daysBetween(r.from, r.to).length;

/** N ngày kết thúc ở `end`, và N ngày liền trước đó. */
function presetRanges(days: number, end: string): [DayRange, DayRange] {
  const current = { from: shiftDay(end, -(days - 1)), to: end };
  const previous = { from: shiftDay(current.from, -days), to: shiftDay(current.from, -1) };
  return [previous, current];
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <Button
          key={String(o.value)}
          size="sm"
          variant={value === o.value ? "default" : "outline"}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function AnalysisBody() {
  const { catalogs } = useCatalogs();
  const staff = useCurrentStaff();
  const scope = useAdsScope();
  const today = useTodayVn();
  const thisMonth = today.slice(0, 7);
  const thisYear = Number((today || "2026").slice(0, 4));
  const years = yearOptions(thisYear, firstYearOf(catalogs.adAccounts, thisYear));

  const [pickedMode, setMode] = useState<Mode | null>(null);
  // Quản lý mở trang → mặc định So sánh nhân viên; nhân viên Ads → So sánh tháng.
  const mode: Mode = pickedMode ?? "goals";
  const modes = MODES.filter((m) => m.key !== "staff" || scope.managesMarketing);
  const [staffFilter, setStaffFilter] = useState(ALL);
  const [metricKey, setMetricKey] = useState<MetricKey>("spend");
  // So sánh tháng
  const [pickedMonths, setPickedMonths] = useState<string[] | null>(null);
  // So sánh khoảng ngày
  const [preset, setPreset] = useState<Preset>(7);
  const [endToday, setEndToday] = useState(false);
  const [customRanges, setCustomRanges] = useState<[DayRange, DayRange] | null>(null);
  // So sánh năm / tháng cùng kỳ
  const [pickedYears, setPickedYears] = useState<number[] | null>(null);
  const [toDate, setToDate] = useState(true);
  const [pickedMonthNo, setPickedMonthNo] = useState<number | null>(null);
  // So sánh nhân viên
  const [staffPeriod, setStaffPeriod] = useState<StaffPeriod>("this-month");
  const [staffCustom, setStaffCustom] = useState<DayRange | null>(null);
  // Mục tiêu & vinh danh
  const [boardLastMonth, setBoardLastMonth] = useState(false);
  const { state: targetsState, reload: reloadTargets } = useAdTargets();
  const [dialog, setDialog] = useState<"targets" | "revenue" | null>(null);

  const months = pickedMonths ?? (today ? monthsBetween(shiftMonth(thisMonth, -2), thisMonth) : []);
  const end = today ? (endToday ? today : shiftDay(today, -1)) : "";
  const ranges: [DayRange, DayRange] | null = !today
    ? null
    : preset === "custom"
      ? (customRanges ?? presetRanges(7, end))
      : presetRanges(preset, end);
  const chosenYears = pickedYears ?? [thisYear - 1, thisYear];
  const monthNo = pickedMonthNo ?? Number(thisMonth.slice(5) || 1);
  const thisMonthRange: DayRange = { from: today ? firstDayOf(thisMonth) : "", to: today };
  const staffRange: DayRange = !today
    ? thisMonthRange
    : staffPeriod === "7"
      ? { from: shiftDay(today, -6), to: today }
      : staffPeriod === "30"
        ? { from: shiftDay(today, -29), to: today }
        : staffPeriod === "last-month"
          ? { from: firstDayOf(shiftMonth(thisMonth, -1)), to: lastDayOf(shiftMonth(thisMonth, -1)) }
          : staffPeriod === "this-year"
            ? { from: `${thisYear}-01-01`, to: today }
            : staffPeriod === "custom"
              ? (staffCustom ?? thisMonthRange)
              : thisMonthRange;

  // Khoảng ngày cần tải cho kiểu so sánh đang xem.
  let from = "";
  let to = "";
  if (today) {
    if (mode === "staff" || mode === "funnel" || mode === "accounts") {
      ({ from, to } = staffRange);
    } else if ((mode === "months" || mode === "weekday") && months.length > 0) {
      from = firstDayOf(months[0]);
      to = lastDayOf(months.at(-1) ?? months[0]);
    } else if (mode === "days" && ranges) {
      from = ranges[0].from < ranges[1].from ? ranges[0].from : ranges[1].from;
      to = ranges[0].to > ranges[1].to ? ranges[0].to : ranges[1].to;
    } else if (mode === "years") {
      from = `${chosenYears[0]}-01-01`;
      to = `${chosenYears.at(-1)}-12-31`;
    } else if (mode === "same-month") {
      from = `${chosenYears[0]}-${pad(monthNo)}-01`;
      to = lastDayOf(`${chosenYears.at(-1)}-${pad(monthNo)}`);
    }
  }
  const { state } = useAdReports(from, to);

  const me =
    scope.isAdsStaff && staff.status === "ok"
      ? catalogs.adsStaff.find((a) => a.user_id === staff.userId)
      : undefined;
  const person = scope.managesMarketing ? catalogs.adsStaff.find((p) => p.id === staffFilter) : me;
  const staffId = person?.id ?? null;

  const entries = useMemo(
    () => (state.status === "ready" ? entriesOf(state.reports, state.data ?? [], catalogs.assignments) : []),
    [state, catalogs.assignments],
  );
  const byDay = useMemo(() => totalsByDay(entries, staffId), [entries, staffId]);
  const avatarOf = (p: { user_id: string | null }) =>
    catalogs.staff.find((s) => s.user_id === p.user_id)?.avatar_url ?? null;

  if (!catalogs.marketingReady) return <MarketingNotReady what="Màn Phân tích" />;
  if (staff.status === "loading") return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!scope.managesMarketing && !scope.isAdsStaff) {
    return (
      <ReadOnlyNote>
        Màn này dành cho nhân viên chạy quảng cáo (xem số của mình), Trưởng Marketing và Quản trị (xem tất cả).
      </ReadOnlyNote>
    );
  }
  if (state.status === "not-migrated") return <NotReady />;

  const metric = metricOf(metricKey);
  const metricTabs = <MetricTabs value={metricKey} onChange={setMetricKey} />;
  const who = person ? person.full_name : scope.managesMarketing ? "tất cả nhân viên" : "";

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1">
          {modes.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
        {scope.managesMarketing && mode !== "staff" && (
          <Select value={person ? person.id : ALL} onValueChange={setStaffFilter}>
            <SelectTrigger className="w-60" aria-label="Lọc theo nhân viên quảng cáo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tất cả nhân viên</SelectItem>
              {catalogs.adsStaff.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.full_name}
                  {!p.is_active && " (đã nghỉ)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Lựa chọn của từng kiểu so sánh */}
      <div className="flex flex-wrap items-center gap-3">
        {mode === "goals" && today && (
          <>
            <Segmented
              label="Tháng vinh danh"
              value={boardLastMonth ? "last" : "this"}
              onChange={(v) => setBoardLastMonth(v === "last")}
              options={[
                { value: "this", label: "Vinh danh tháng này" },
                { value: "last", label: "Tháng trước" },
              ]}
            />
            {scope.managesMarketing && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={targetsState.status !== "ready"}
                  onClick={() => setDialog("targets")}
                >
                  <Target />
                  Mục tiêu
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog("revenue")}>
                  <BadgeDollarSign />
                  Doanh thu
                </Button>
              </>
            )}
          </>
        )}
        {(mode === "staff" || mode === "funnel" || mode === "accounts") && today && (
          <>
            <Segmented
              label="Khoảng ngày"
              value={staffPeriod}
              onChange={(value) => {
                if (value === "custom" && !staffCustom) setStaffCustom(staffRange);
                setStaffPeriod(value);
              }}
              options={STAFF_PERIODS}
            />
            {staffPeriod === "custom" ? (
              <RangePicker label="Từ – đến" value={staffRange} today={today} onChange={setStaffCustom} />
            ) : (
              <span className="text-sm text-muted-foreground tabular-nums">{rangeText(staffRange)}</span>
            )}
          </>
        )}
        {(mode === "months" || mode === "weekday") && (
          <>
            <MonthsPicker value={months} today={today} years={years} onChange={setPickedMonths} />
            <span className="text-sm text-muted-foreground">
              {mode === "months" ? "Tick các tháng muốn so sánh (có thể khác năm)." : "Tick các tháng muốn xem."}
            </span>
          </>
        )}
        {mode === "days" && ranges && (
          <>
            <Segmented
              label="Số ngày"
              value={preset}
              onChange={(value) => {
                if (value === "custom" && !customRanges) setCustomRanges(ranges);
                setPreset(value);
              }}
              options={[...PRESETS.map((n) => ({ value: n as Preset, label: `${n} ngày` })), { value: "custom", label: "Tuỳ chỉnh" }]}
            />
            {preset === "custom" ? (
              <>
                <RangePicker
                  label="Kỳ A"
                  value={ranges[0]}
                  today={today}
                  onChange={(r) => setCustomRanges([r, ranges[1]])}
                />
                <RangePicker
                  label="Kỳ B"
                  value={ranges[1]}
                  today={today}
                  onChange={(r) => setCustomRanges([ranges[0], r])}
                />
              </>
            ) : (
              <Segmented
                label="Tính đến"
                value={endToday ? "today" : "yesterday"}
                onChange={(v) => setEndToday(v === "today")}
                options={[
                  { value: "yesterday", label: "Đến hôm qua" },
                  { value: "today", label: "Đến hôm nay" },
                ]}
              />
            )}
          </>
        )}
        {(mode === "years" || mode === "same-month") && (
          <>
            {mode === "same-month" && (
              <Select value={String(monthNo)} onValueChange={(v) => setPickedMonthNo(Number(v))}>
                <SelectTrigger className="w-32" aria-label="Tháng">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      Tháng {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <YearsPicker value={chosenYears} years={years} onChange={setPickedYears} />
            {(mode === "years" || monthNo === Number(thisMonth.slice(5))) && today && (
              <Segmented
                label="Phạm vi"
                value={toDate ? "to-date" : "full"}
                onChange={(v) => setToDate(v === "to-date")}
                options={[
                  {
                    value: "to-date",
                    label:
                      mode === "years"
                        ? `Cùng kỳ đến ${today.slice(8)}/${today.slice(5, 7)}`
                        : `Cùng kỳ đến ngày ${Number(today.slice(8))}`,
                  },
                  { value: "full", label: mode === "years" ? "Cả năm" : "Cả tháng" },
                ]}
              />
            )}
          </>
        )}
      </div>

      {dialog === "targets" && targetsState.status === "ready" && (
        <TargetsDialog
          open
          onClose={() => setDialog(null)}
          people={catalogs.adsStaff}
          targets={targetsState.targets}
          assignments={catalogs.assignments}
          today={today}
          onSaved={reloadTargets}
        />
      )}
      {dialog === "revenue" && (
        <RevenueDialog people={catalogs.adsStaff} today={today} onClose={() => setDialog(null)} onSaved={async () => {}} />
      )}

      {scope.isAdsStaff && !me ? (
        <ReadOnlyNote>
          Bạn chưa có TKQC nào. Vào Nhập liệu → Cài đặt TKQC để khai báo các TKQC bạn đang chạy.
        </ReadOnlyNote>
      ) : mode === "goals" && today ? (
        <GoalsView
          month={boardLastMonth ? shiftMonth(thisMonth, -1) : thisMonth}
          today={today}
          staffId={staffId}
          who={person ? person.full_name : scope.managesMarketing ? "cả công ty" : ""}
          isManager={scope.managesMarketing}
          targetsState={targetsState}
          assignments={catalogs.assignments}
          onEditTargets={scope.managesMarketing && targetsState.status === "ready" ? () => setDialog("targets") : undefined}
        />
      ) : state.status === "error" ? (
        <StatsError message={state.message} />
      ) : state.status !== "ready" || !today ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : mode === "staff" ? (
        <StaffCompare
          people={catalogs.adsStaff}
          assignments={catalogs.assignments}
          entries={entries}
          range={staffRange}
          metric={metric}
          metricTabs={metricTabs}
          avatarOf={avatarOf}
        />
      ) : mode === "funnel" ? (
        <FunnelView
          entries={entries}
          assignments={catalogs.assignments}
          campaigns={catalogs.campaigns}
          channels={catalogs.channels}
          people={catalogs.adsStaff}
          staffId={staffId}
          range={staffRange}
          who={who}
        />
      ) : mode === "accounts" ? (
        <AccountRanking
          reports={state.reports}
          assignments={catalogs.assignments}
          accounts={catalogs.adAccounts}
          people={catalogs.adsStaff}
          staffId={staffId}
          range={staffRange}
          who={who}
        />
      ) : mode === "weekday" ? (
        <WeekdayView months={months} byDay={byDay} today={today} metric={metric} metricTabs={metricTabs} who={who} />
      ) : mode === "months" ? (
        <MonthsView months={months} byDay={byDay} today={today} metric={metric} metricTabs={metricTabs} who={who} />
      ) : mode === "days" && ranges ? (
        <DaysView
          ranges={ranges}
          custom={preset === "custom"}
          byDay={byDay}
          metric={metric}
          metricTabs={metricTabs}
          who={who}
        />
      ) : mode === "years" ? (
        <YearsView years={chosenYears} toDate={toDate} byDay={byDay} today={today} metric={metric} metricTabs={metricTabs} who={who} />
      ) : (
        <SameMonthView
          monthNo={monthNo}
          years={chosenYears}
          toDate={toDate && monthNo === Number(thisMonth.slice(5))}
          byDay={byDay}
          today={today}
          metric={metric}
          metricTabs={metricTabs}
          who={who}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Mục tiêu & vinh danh                                                                             */
/* ------------------------------------------------------------------------------------------------ */

function GoalsView({
  month,
  today,
  staffId,
  who,
  isManager,
  targetsState,
  assignments,
  onEditTargets,
}: {
  month: string;
  today: string;
  staffId: string | null;
  who: string;
  isManager: boolean;
  targetsState: TargetsState;
  assignments: Parameters<typeof GoalTrackingSection>[0]["assignments"];
  onEditTargets?: () => void;
}) {
  const board = useLeaderboard(month);
  const elapsed = monthElapsed(month, today);
  return (
    <>
      <Leaderboard month={month} elapsed={elapsed} state={board} />
      <GoalTrackingSection
        staffId={staffId}
        who={who}
        targetsState={targetsState}
        assignments={assignments}
        today={today}
        onEditTargets={onEditTargets}
      />
      {isManager && staffId === null && <StaffProgress state={board} elapsed={elapsed} />}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Phần dùng chung                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

/** Cộng dồn từ đầu: [a, b, c] → [a, a+b, a+b+c] (null giữ nguyên = chưa tới / không có ngày đó). */
function cumulate(list: (Totals | null)[]) {
  let sum = zero();
  return list.map((t) => {
    if (t === null) return null;
    sum = add(sum, t);
    return sum;
  });
}

const titleFor = (title: string, who: string) => (who ? `${title} — ${who}` : title);

/**
 * Đường theo ngày trong tháng (ngày 1 → 31) của nhiều tháng, mặc định lũy kế để thấy tháng nào "chạy nhanh"
 * hơn ở cùng thời điểm.
 */
function MonthOverlayChart({
  months,
  byDay,
  today,
  metric,
  metricTabs,
  title,
  cutDay,
}: {
  months: string[];
  byDay: Map<string, Totals>;
  today: string;
  metric: Metric;
  metricTabs: React.ReactNode;
  title: string;
  /** Chỉ vẽ tới ngày này của mỗi tháng (so cùng kỳ). */
  cutDay?: number;
}) {
  const [cumulative, setCumulative] = useState(true);
  const length = cutDay ?? 31;
  const xLabels = Array.from({ length }, (_, i) => String(i + 1));
  const series = months.map((month) => {
    const last = Number(lastDayOf(month).slice(8));
    const daily = xLabels.map((_, i) => {
      const day = `${month}-${pad(i + 1)}`;
      return i + 1 > last || day > today ? null : (byDay.get(day) ?? zero());
    });
    return {
      key: `m${month.replace("-", "")}`,
      name: monthLabel(month),
      totals: cumulative ? cumulate(daily) : daily,
    };
  });

  return (
    <ChartCard
      title={title}
      note={
        (cumulative
          ? metric.kind === "sum"
            ? `${metric.label} cộng dồn từ ngày 1 tới từng ngày.`
            : `${metric.label} tính trên số cộng dồn từ ngày 1 tới từng ngày.`
          : `${metric.label} của từng ngày.`) +
        (months.length > MAX_SERIES ? ` Chỉ vẽ ${MAX_SERIES} tháng đầu.` : "")
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Cách vẽ"
            value={cumulative ? "sum" : "day"}
            onChange={(v) => setCumulative(v === "sum")}
            options={[
              { value: "sum", label: "Lũy kế" },
              { value: "day", label: "Từng ngày" },
            ]}
          />
          {metricTabs}
        </div>
      }
    >
      <CompareLineChart xLabels={xLabels.map((d) => `Ngày ${d}`)} series={series} metric={metric} />
    </ChartCard>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* So sánh tháng                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

function MonthsView({
  months,
  byDay,
  today,
  metric,
  metricTabs,
  who,
}: {
  months: string[];
  byDay: Map<string, Totals>;
  today: string;
  metric: Metric;
  metricTabs: React.ReactNode;
  who: string;
}) {
  const byMonth = totalsByMonth(byDay);
  const manyYears = new Set(months.map((m) => m.slice(0, 4))).size > 1;
  const rows: PeriodRow[] = months.map((month) => ({
    key: month,
    label: monthLabel(month),
    sub: month === today.slice(0, 7) ? `đến ${formatDay(today)}` : undefined,
    totals: byMonth.get(month) ?? zero(),
  }));

  return (
    <>
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">{titleFor("So sánh các tháng", who)}</h2>
          <p className="text-sm text-muted-foreground">Mũi tên: tăng / giảm so với tháng ở dòng trên (xanh = tốt hơn, đỏ = kém hơn).</p>
        </div>
        <PeriodTable firstHead="Tháng" rows={rows} showChange />
      </section>
      <ChartCard title={`${metric.label} theo tháng`} actions={metricTabs}>
        <TrendChart
          metric={metric}
          points={months.map((month) => ({
            key: month,
            label: manyYears ? `T${Number(month.slice(5))}/${month.slice(2, 4)}` : `T${Number(month.slice(5))}`,
            title: monthLabel(month),
            totals: byMonth.get(month) ?? zero(),
          }))}
        />
      </ChartCard>
      {months.length > 1 && (
        <MonthOverlayChart
          months={months}
          byDay={byDay}
          today={today}
          metric={metric}
          metricTabs={metricTabs}
          title={`${metric.label} từng ngày trong tháng — các tháng chồng lên nhau`}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* So sánh khoảng ngày                                                                              */
/* ------------------------------------------------------------------------------------------------ */

function DaysView({
  ranges,
  custom,
  byDay,
  metric,
  metricTabs,
  who,
}: {
  ranges: [DayRange, DayRange];
  custom: boolean;
  byDay: Map<string, Totals>;
  metric: Metric;
  metricTabs: React.ReactNode;
  who: string;
}) {
  const [cumulative, setCumulative] = useState(false);
  const [previous, current] = ranges;
  const names = custom ? ["Kỳ A", "Kỳ B"] : ["Kỳ trước", "Kỳ này"];
  const prevDays = daysBetween(previous.from, previous.to);
  const curDays = daysBetween(current.from, current.to);
  const rows: PeriodRow[] = [
    { key: "a", label: names[0], sub: `${rangeText(previous)} · ${prevDays.length} ngày`, totals: sumDays(byDay, prevDays) },
    { key: "b", label: names[1], sub: `${rangeText(current)} · ${curDays.length} ngày`, totals: sumDays(byDay, curDays) },
  ];
  const length = Math.max(prevDays.length, curDays.length);
  const at = (days: string[]) =>
    Array.from({ length }, (_, i) => (days[i] ? (byDay.get(days[i]) ?? zero()) : null));
  const short = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;
  const series = [
    { key: "b", name: names[1], totals: at(curDays), titles: curDays.map(short) },
    { key: "a", name: names[0], totals: at(prevDays), titles: prevDays.map(short), dashed: true },
  ].map((s) => ({ ...s, totals: cumulative ? cumulate(s.totals) : s.totals }));

  return (
    <>
      <KpiCards
        title={`${names[1]} · ${rangeText(current)}`}
        current={rows[1].totals}
        previous={rows[0].totals}
        compareLabel={`${names[0].toLowerCase()} (${rangeText(previous)})`}
        spark={curDays.map((d) => byDay.get(d) ?? zero())}
      />
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">
            {titleFor(custom ? "So sánh hai khoảng ngày" : `${curDays.length} ngày gần nhất so với ${prevDays.length} ngày liền trước`, who)}
          </h2>
          <p className="text-sm text-muted-foreground">Mũi tên ở dòng dưới: {names[1]} tăng / giảm so với {names[0]}.</p>
        </div>
        <PeriodTable firstHead="Kỳ" rows={rows} showChange />
        {lengthOf(previous) !== lengthOf(current) && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Hai kỳ dài khác nhau ({prevDays.length} ngày và {curDays.length} ngày) — nên so các chỉ số giá mess, giá data,
            tỉ lệ xin số; tổng chi tiêu / mess / data sẽ chênh vì số ngày.
          </p>
        )}
      </section>
      <ChartCard
        title={`${metric.label} theo ngày — ${names[1]} và ${names[0]}`}
        note={
          cumulative
            ? `Cộng dồn từ ngày đầu mỗi kỳ. Ngày thứ 1 của ${names[1]} đặt cạnh ngày thứ 1 của ${names[0]}.`
            : `Ngày thứ 1 của ${names[1]} đặt cạnh ngày thứ 1 của ${names[0]}.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Cách vẽ"
              value={cumulative ? "sum" : "day"}
              onChange={(v) => setCumulative(v === "sum")}
              options={[
                { value: "day", label: "Từng ngày" },
                { value: "sum", label: "Lũy kế" },
              ]}
            />
            {metricTabs}
          </div>
        }
      >
        <CompareLineChart
          xLabels={Array.from({ length }, (_, i) => `Ngày thứ ${i + 1}`)}
          series={series}
          metric={metric}
        />
      </ChartCard>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* So sánh năm                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

function YearsView({
  years,
  toDate,
  byDay,
  today,
  metric,
  metricTabs,
  who,
}: {
  years: number[];
  toDate: boolean;
  byDay: Map<string, Totals>;
  today: string;
  metric: Metric;
  metricTabs: React.ReactNode;
  who: string;
}) {
  const mmdd = today.slice(5);
  const rangeOf = (year: number): DayRange => {
    const last = toDate ? `${year}-${mmdd === "02-29" ? "02-28" : mmdd}` : `${year}-12-31`;
    return { from: `${year}-01-01`, to: last > today ? today : last };
  };
  const rows: PeriodRow[] = years.map((year) => {
    const r = rangeOf(year);
    return {
      key: String(year),
      label: `Năm ${year}`,
      sub: r.from > r.to ? "chưa tới" : rangeText(r),
      totals: r.from > r.to ? zero() : sumDays(byDay, daysBetween(r.from, r.to)),
    };
  });
  const byMonth = totalsByMonth(byDay);
  const thisMonth = today.slice(0, 7);
  const monthOf = (year: number, m: number) => `${year}-${pad(m)}`;
  const series = years.map((year) => ({
    key: `y${year}`,
    name: `Năm ${year}`,
    totals: Array.from({ length: 12 }, (_, i) =>
      monthOf(year, i + 1) > thisMonth ? null : (byMonth.get(monthOf(year, i + 1)) ?? zero()),
    ),
  }));

  return (
    <>
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">{titleFor("So sánh các năm", who)}</h2>
          <p className="text-sm text-muted-foreground">
            {toDate
              ? `Mỗi năm tính từ 01/01 tới ngày ${today.slice(8)}/${today.slice(5, 7)} để so cùng kỳ.`
              : "Mỗi năm tính cả năm (năm nay tính tới hôm nay)."}
          </p>
        </div>
        <PeriodTable firstHead="Năm" rows={rows} showChange />
      </section>
      <ChartCard
        title={`${metric.label} theo tháng — mỗi năm một đường`}
        note={series.length > MAX_SERIES ? `Chỉ vẽ ${MAX_SERIES} năm đầu.` : undefined}
        actions={metricTabs}
      >
        <CompareLineChart xLabels={Array.from({ length: 12 }, (_, i) => `T${i + 1}`)} series={series} metric={metric} />
      </ChartCard>
      <SameMonthGrid years={years} byMonth={byMonth} thisMonth={thisMonth} metric={metric} metricTabs={metricTabs} />
    </>
  );
}

/** Bảng tháng × năm của một chỉ số: so từng tháng với cùng tháng các năm khác. */
function SameMonthGrid({
  years,
  byMonth,
  thisMonth,
  metric,
  metricTabs,
}: {
  years: number[];
  byMonth: Map<string, Totals>;
  thisMonth: string;
  metric: Metric;
  metricTabs: React.ReactNode;
}) {
  const value = (year: number, m: number) => {
    const key = `${year}-${pad(m)}`;
    return key > thisMonth ? undefined : metric.value(byMonth.get(key) ?? zero());
  };
  const last = years.at(-1);
  const before = years.length > 1 ? years.at(-2) : undefined;

  return (
    <ChartCard
      title={`Tháng cùng kỳ các năm — ${metric.label}`}
      note={before && last ? `Cột cuối: ${last} so với ${before} (xanh = tốt hơn, đỏ = kém hơn).` : undefined}
      actions={metricTabs}
    >
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className={FIRST_TH}>Tháng</th>
              {years.map((y) => (
                <th key={y} className={cn(TH, "bg-muted")}>
                  {y}
                </th>
              ))}
              {before && last && <th className={cn(TH, "bg-muted")}>{last} so với {before}</th>}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <tr key={m} className="border-b last:border-0 hover:bg-muted/50">
                <td className="px-3 py-2 font-medium">Tháng {m}</td>
                {years.map((y) => {
                  const v = value(y, m);
                  return (
                    <td key={y} className={cn(TD, v === undefined && "text-muted-foreground/60")}>
                      {v === undefined ? "" : formatMetric(metric, v)}
                    </td>
                  );
                })}
                {before && last && (
                  <td className={TD}>
                    <Change metric={metric} current={value(last, m) ?? null} previous={value(before, m) ?? null} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Tháng cùng kỳ                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

function SameMonthView({
  monthNo,
  years,
  toDate,
  byDay,
  today,
  metric,
  metricTabs,
  who,
}: {
  monthNo: number;
  years: number[];
  toDate: boolean;
  byDay: Map<string, Totals>;
  today: string;
  metric: Metric;
  metricTabs: React.ReactNode;
  who: string;
}) {
  const months = years.map((y) => `${y}-${pad(monthNo)}`).filter((m) => m <= today.slice(0, 7));
  const cutDay = toDate ? Number(today.slice(8)) : undefined;
  const rows: PeriodRow[] = months.map((month) => {
    const lastDay = lastDayOf(month);
    const cut = cutDay ? `${month}-${pad(Math.min(cutDay, Number(lastDay.slice(8))))}` : lastDay;
    const r = { from: firstDayOf(month), to: cut > today ? today : cut };
    return { key: month, label: monthLabel(month), sub: rangeText(r), totals: sumDays(byDay, daysBetween(r.from, r.to)) };
  });

  return (
    <>
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">{titleFor(`Tháng ${monthNo} qua các năm`, who)}</h2>
          <p className="text-sm text-muted-foreground">Mũi tên: tăng / giảm so với cùng tháng năm ở dòng trên.</p>
        </div>
        <PeriodTable
          firstHead="Tháng"
          rows={rows}
          showChange
          empty={`Tháng ${monthNo} của các năm đã chọn chưa tới.`}
        />
      </section>
      {months.length > 0 && (
        <MonthOverlayChart
          months={months}
          byDay={byDay}
          today={today}
          metric={metric}
          metricTabs={metricTabs}
          cutDay={cutDay}
          title={`${metric.label} từng ngày — tháng ${monthNo} các năm`}
        />
      )}
    </>
  );
}
