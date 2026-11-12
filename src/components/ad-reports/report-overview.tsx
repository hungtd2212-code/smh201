"use client";

import { BadgeDollarSign, LayoutDashboard, Lock, Pencil, Target } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { coversDay, useAdsScope } from "@/components/catalog/ads-scope";
import { CatalogGate, MarketingNotReady, PageHeader, ReadOnlyNote, useTodayVn } from "@/components/catalog/shared";
import { useCatalogs } from "@/components/catalog-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  checkTargets,
  daysBetween,
  entriesOf,
  firstDayOf,
  isEmpty,
  lastDayOf,
  metricOf,
  monthElapsed,
  monthsBetween,
  previousOf,
  previousRange,
  shiftDay,
  spikeAlerts,
  weeksOfMonth,
  totalsByDay,
  totalsByMonth,
  totalsByStaff,
  zero,
  type Alert,
  type MetricKey,
  type PreviousPeriod,
  type TargetValues,
  type Totals,
} from "@/lib/ad-reports/aggregate";
import {
  durationText,
  editDeadline,
  formatClock,
  dayOf,
  formatDay,
  monthDays,
  monthLabel,
  wasEdited,
} from "@/lib/ad-reports/dates";
import { formatNumber, formatPercent, ratio } from "@/lib/ad-reports/number";
import { updateDailyData, updateReport } from "@/lib/ad-reports/repo";
import { targetFor } from "@/lib/ad-reports/targets";
import type { AdDailyData, AdDailyReport, ReportValues } from "@/lib/ad-reports/types";
import type { AdAccount, AdAccountAssignment, AdsStaff } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { ChartCard, MetricTabs, StaffChart, TrendChart } from "./charts";
import { useAdReports, useNow } from "./hooks";
import { KpiCards } from "./kpi-cards";
import { MonthsPicker, monthsLabel, yearOptions, type DayRange } from "./period-picker";
import { LIME, ORANGE, PeriodTable, TD, TH, YELLOW, type PeriodRow } from "./period-table";
import { ReportFields, allFilled, fieldKey, toNumbers, type FieldItem } from "./report-fields";
import { NotReady, StatsError } from "./shared";
import { GoalTrackingSection } from "./goal-tracking";
import { RevenueDialog } from "./revenue";
import { AlertsPanel, TargetsDialog, useAdTargets } from "./targets";
import { DayFilter, WeekGoals } from "./week-goals";

const ALL = "__all";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** "Tháng 11/2026" → "tháng 11/2026" (chỉ chữ đầu, để "T11" vẫn viết hoa). */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Tên khoảng ngày đang lọc: "Ngày 12/11/2026", "Tuần 2 (05/10 – 11/10)", "03/11/2026 – 09/11/2026". */
function rangeLabel(range: DayRange) {
  if (range.from === range.to) return `Ngày ${formatDay(range.from)}`;
  const week = weeksOfMonth(range.from.slice(0, 7)).find((w) => w.from === range.from && w.to === range.to);
  const short = (day: string) => formatDay(day).slice(0, 5);
  if (week) return `Tuần ${week.index} (${short(week.from)} – ${short(week.to)}/${range.to.slice(0, 4)})`;
  return `${formatDay(range.from)} – ${formatDay(range.to)}`;
}

/**
 * Marketing → Tổng quan: số liệu ads theo tháng, nhiều tháng, cả năm hoặc nhiều năm, kèm biểu đồ.
 *   • Chọn MỘT tháng: bảng cả tháng — mỗi dòng một ngày, chi tiêu từng TK ADS, tổng chi tiêu ngày, tổng mess,
 *     giá mess, data, giá data, tỉ lệ xin số (như sheet "bảng dữ liệu quảng cáo theo tháng"). Nhân viên sửa
 *     được trong 24 giờ kể từ lúc gửi; quản lý sửa bất kỳ lúc nào.
 *   • Chọn NHIỀU tháng (hoặc cả năm, nhiều năm): mỗi dòng một tháng, có tổng từng năm.
 *   • Một tháng: lọc tiếp theo tuần (T2 → CN, như sheet "Báo cáo tuần"), hôm qua / hôm nay hoặc một khoảng ngày; có
 *     bảng "Về đích theo tuần & ngày" (mục tiêu tháng chia xuống từng ngày).
 *   • Quản trị / Trưởng Marketing: "Tất cả nhân viên" (tổng của mọi người + so sánh từng người) hoặc một người.
 */
export function ReportOverview() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={LayoutDashboard}
        title="Tổng quan"
        description="Số liệu quảng cáo theo ngày, tuần, tháng, nhiều tháng hoặc cả năm: chi tiêu, mess, data, mục tiêu và về đích."
      />
      <CatalogGate>
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <OverviewBody />
        </Suspense>
      </CatalogGate>
    </div>
  );
}

/** Giá mess = chi tiêu / mess; giá data = chi tiêu / data; tỉ lệ xin số = data / mess. Chia cho 0 → "–". */
const metrics = (t: Totals) => ({
  costPerMessage: ratio(t.spend, t.messages),
  costPerData: ratio(t.spend, t.data),
  dataRate: ratio(t.data, t.messages),
});

/** Năm đầu tiên có TKQC trong hệ thống (để biết cho chọn từ năm nào). */
const firstYearOf = (accounts: AdAccount[], fallback: number) =>
  Math.min(fallback, ...accounts.map((a) => (a.created_at ? Number(a.created_at.slice(0, 4)) : fallback)));

function OverviewBody() {
  const { catalogs } = useCatalogs();
  const staff = useCurrentStaff();
  const scope = useAdsScope();
  const today = useTodayVn();
  const params = useSearchParams();
  // Mở từ màn Nhập liệu ("Đi tới Tổng quan") → đúng tháng, đúng người, tô sáng ngày đó.
  const focusDay = ISO_DAY.test(params.get("ngay") ?? "") ? params.get("ngay") : null;
  const [pickedMonths, setPickedMonths] = useState<string[] | null>(focusDay ? [focusDay.slice(0, 7)] : null);
  const [staffFilter, setStaffFilter] = useState(params.get("nv") ?? ALL);
  const [metricKey, setMetricKey] = useState<MetricKey>("spend");
  // Lọc theo tuần / ngày (null = cả các tháng đang chọn).
  const [range, setRange] = useState<DayRange | null>(null);
  const pickMonths = (next: string[]) => {
    setPickedMonths(next);
    setRange(null);
  };
  const pickRange = (next: DayRange | null) => {
    if (!next) {
      setRange(null);
      return;
    }
    const covered = monthsBetween(next.from.slice(0, 7), next.to.slice(0, 7));
    setPickedMonths(covered);
    const wholeMonth = covered.length === 1 && next.from === firstDayOf(covered[0]) && next.to === lastDayOf(covered[0]);
    setRange(wholeMonth ? null : next);
  };

  const months = useMemo(() => pickedMonths ?? (today ? [today.slice(0, 7)] : []), [pickedMonths, today]);
  // Kỳ để so (tháng trước / các tháng liền trước / năm trước; lọc ngày thì khoảng liền trước cùng độ dài) — tải
  // luôn để so trên thẻ và biểu đồ.
  const prevMonths = useMemo(() => previousOf(months, today), [months, today]);
  const prevRange = useMemo(() => (range ? previousRange(range.from, range.to, today) : null), [range, today]);
  const monthsFrom = months.length > 0 ? firstDayOf(prevMonths ? prevMonths.months[0] : months[0]) : "";
  const from = prevRange && prevRange.from < monthsFrom ? prevRange.from : monthsFrom;
  const to = months.length > 0 ? lastDayOf(months.at(-1) ?? months[0]) : "";
  const { state, reload } = useAdReports(from, to);
  const thisYear = Number((today || "2026").slice(0, 4));
  const years = yearOptions(thisYear, firstYearOf(catalogs.adAccounts, thisYear));

  const entries = useMemo(
    () => (state.status === "ready" ? entriesOf(state.reports, state.data ?? [], catalogs.assignments) : []),
    [state, catalogs.assignments],
  );
  const monthSet = useMemo(() => new Set(months), [months]);
  const keep = useMemo(
    () => (range ? (day: string) => day >= range.from && day <= range.to : (day: string) => monthSet.has(day.slice(0, 7))),
    [monthSet, range],
  );

  const me =
    scope.isAdsStaff && staff.status === "ok"
      ? catalogs.adsStaff.find((a) => a.user_id === staff.userId)
      : undefined;
  const person = scope.managesMarketing ? catalogs.adsStaff.find((p) => p.id === staffFilter) : me;
  const staffId = person ? person.id : null;
  // Tổng theo ngày của mọi ngày đã tải (gồm cả kỳ trước) — rồi tách ra kỳ đang xem / kỳ trước.
  const allByDay = useMemo(() => totalsByDay(entries, staffId), [entries, staffId]);
  const { state: targetsState, reload: reloadTargets } = useAdTargets();
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [revenueOpen, setRevenueOpen] = useState(false);

  if (!catalogs.marketingReady) return <MarketingNotReady what="Màn Tổng quan" />;
  if (staff.status === "loading") return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!scope.managesMarketing && !scope.isAdsStaff) {
    return (
      <ReadOnlyNote>
        Màn này dành cho nhân viên chạy quảng cáo (xem số của mình), Trưởng Marketing và Quản trị (xem tất cả).
      </ReadOnlyNote>
    );
  }
  if (state.status === "not-migrated") return <NotReady />;

  const single = months.length === 1 ? months[0] : null;
  const metricTabs = <MetricTabs value={metricKey} onChange={setMetricKey} />;
  const periodName = range ? rangeLabel(range) : single ? monthLabel(single) : monthsLabel(months, today);
  const pick = (keepDay: (day: string) => boolean) => new Map([...allByDay].filter(([day]) => keepDay(day)));
  const curByDay = pick(keep);
  const prev = prevRange ?? prevMonths;
  const prevByDay = prev ? pick(prev.keep) : null;
  const current = [...curByDay.values()].reduce(add, zero());
  const previous = prevByDay ? [...prevByDay.values()].reduce(add, zero()) : null;
  const thisMonth = today.slice(0, 7);
  const curByMonth = totalsByMonth(curByDay);
  // Các ngày đang xem (lọc ngày, hoặc cả một tháng); null = nhiều tháng.
  const viewDays = range ? daysBetween(range.from, range.to) : single ? monthDays(single) : null;
  const periodFrom = range ? range.from : firstDayOf(months[0] ?? thisMonth);
  const periodTo = range ? range.to : lastDayOf(months.at(-1) ?? thisMonth);
  const spark = viewDays
    ? viewDays.filter((d) => d <= today).map((d) => curByDay.get(d) ?? zero())
    : months.map((m) => curByMonth.get(m) ?? zero());
  const avatarOf = (p: { user_id: string | null }) =>
    catalogs.staff.find((s) => s.user_id === p.user_id)?.avatar_url ?? null;

  // Mục tiêu tháng (chỉ khi xem một tháng) và cảnh báo.
  const targets = targetsState.status === "ready" ? targetsState.targets : null;
  const target = targets && single ? targetFor(targets, staffId, single) : null;
  const elapsed = single ? monthElapsed(single, today) : 0;
  const alerts: Alert[] = [];
  if (single === thisMonth) {
    alerts.push(...spikeAlerts(allByDay, today));
    if (!person && targets) {
      // Xem tất cả: nhắc từng người đang vượt ngân sách / giá tối đa của mình.
      const byStaff = totalsByStaff(entries, keep);
      for (const p of catalogs.adsStaff) {
        const t = targetFor(targets, p.id, thisMonth);
        const totals = byStaff.get(p.id);
        if (!t || !totals) continue;
        for (const item of checkTargets(totals, t, elapsed)) {
          if (item.status === "critical" && item.key !== "data") {
            alerts.push({ level: "critical", text: `${p.full_name}: ${item.label.toLowerCase()} — ${item.note.toLowerCase()}.` });
          }
        }
      }
    }
  }
  const editTargets = scope.managesMarketing && targets !== null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <MonthsPicker value={months} today={today} years={years} onChange={pickMonths} />
        {scope.managesMarketing && (
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
        {single && today && single !== today.slice(0, 7) && (
          <Button variant="ghost" onClick={() => pickMonths([today.slice(0, 7)])}>
            Về tháng này
          </Button>
        )}
        {range && !single && (
          <Button variant="ghost" onClick={() => setRange(null)}>
            Bỏ lọc ngày ({rangeLabel(range)})
          </Button>
        )}
        {scope.managesMarketing && (
          <Button
            variant="outline"
            className="ml-auto"
            disabled={!editTargets}
            title={
              targetsState.status === "not-migrated"
                ? "Cần chạy file supabase/012_ad_targets.sql trên Supabase trước"
                : undefined
            }
            onClick={() => setTargetsOpen(true)}
          >
            <Target />
            Mục tiêu
          </Button>
        )}
        {scope.managesMarketing && (
          <Button variant="outline" onClick={() => setRevenueOpen(true)}>
            <BadgeDollarSign />
            Doanh thu
          </Button>
        )}
      </div>
      {single && today && <DayFilter month={single} today={today} range={range} onChange={pickRange} />}
      {revenueOpen && (
        <RevenueDialog
          people={catalogs.adsStaff}
          today={today}
          onClose={() => setRevenueOpen(false)}
          onSaved={async () => {
            // Theo dõi mục tiêu tự tải lại doanh thu khi mở lại trang; tải lại ngay cho chắc.
            window.location.reload();
          }}
        />
      )}
      {editTargets && targetsOpen && (
        <TargetsDialog
          open
          onClose={() => setTargetsOpen(false)}
          people={catalogs.adsStaff}
          targets={targets}
          carryReady={targetsState.status === "ready" && targetsState.carryReady}
          assignments={catalogs.assignments}
          today={today}
          onSaved={reloadTargets}
        />
      )}

      {scope.isAdsStaff && !me ? (
        <ReadOnlyNote>
          Bạn chưa có TKQC nào. Vào Nhập liệu → Cài đặt TKQC để khai báo các TKQC bạn đang chạy.
        </ReadOnlyNote>
      ) : state.status === "error" ? (
        <StatsError message={state.message} />
      ) : state.status !== "ready" || months.length === 0 ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <>
          <AlertsPanel alerts={alerts} />
          {months.includes(thisMonth) && (
            <GoalTrackingSection
              staffId={staffId}
              who={person ? person.full_name : "cả công ty"}
              targetsState={targetsState}
              assignments={catalogs.assignments}
              today={today}
              onEditTargets={editTargets ? () => setTargetsOpen(true) : undefined}
            />
          )}
          {single && (
            <WeekGoals
              month={single}
              today={today}
              entries={entries}
              people={catalogs.adsStaff}
              assignments={catalogs.assignments}
              avatarOf={avatarOf}
              staffId={staffId}
              who={person ? person.full_name : "cả công ty"}
              targetsState={targetsState}
              range={range}
              onPickRange={pickRange}
              onEditTargets={editTargets ? () => setTargetsOpen(true) : undefined}
            />
          )}
          <KpiCards
            title={`${single && !range ? "Tổng " + lowerFirst(periodName) : periodName} — ${person ? person.full_name : "tất cả nhân viên"}`}
            current={current}
            previous={previous}
            compareLabel={prev?.label}
            spark={spark}
            oneMonth={single !== null && !range}
          />
          {viewDays ? (
            viewDays.length > 1 && (
              <DailyChart
                days={viewDays}
                title={lowerFirst(periodName)}
                currentLabel={periodName}
                byDay={curByDay}
                previousByDay={prev ? allByDay : null}
                previousDays={
                  prevRange && range
                    ? viewDays.map((_, i) => shiftDay(prevRange.from, i))
                    : prevMonths && single
                      ? monthDays(prevMonths.months[0])
                      : null
                }
                previousLabel={prevRange ? `Kỳ trước (${prevRange.label})` : prevMonths ? monthLabel(prevMonths.months[0]) : ""}
                target={target}
                metricTabs={metricTabs}
                metricKey={metricKey}
              />
            )
          ) : (
            <PeriodSummary
              months={months}
              byDay={curByDay}
              prev={prevMonths}
              prevByDay={prevByDay}
              metricTabs={metricTabs}
              metricKey={metricKey}
              onPickMonth={(month) => pickMonths([month])}
            />
          )}
          {viewDays && person && (
            <PersonMonth
              person={person}
              days={viewDays}
              label={periodName}
              today={today}
              reports={state.reports}
              dailyData={state.data}
              accounts={catalogs.adAccounts}
              assignments={catalogs.assignments}
              canAlwaysEdit={scope.managesMarketing}
              showEntryStaff={scope.managesMarketing}
              focusDay={focusDay}
              onSaved={reload}
            />
          )}
          {!person && (
            <StaffSection
              periodName={periodName}
              from={periodFrom}
              to={periodTo}
              oneMonth={single !== null && !range}
              people={catalogs.adsStaff}
              byStaff={totalsByStaff(entries, keep)}
              assignments={catalogs.assignments}
              metricTabs={metricTabs}
              metricKey={metricKey}
              onPick={setStaffFilter}
            />
          )}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Thẻ tổng + biểu đồ + bảng theo tháng                                                            */
/* ------------------------------------------------------------------------------------------------ */

const shortMonth = (month: string, withYear: boolean) =>
  withYear ? `T${Number(month.slice(5))}/${month.slice(2, 4)}` : `T${Number(month.slice(5))}`;

/** Giá tối đa của mục tiêu ứng với chỉ số đang vẽ (để kẻ đường đỏ trên biểu đồ). */
const targetLine = (key: MetricKey, target: TargetValues | null) => {
  const cap = key === "costPerMessage" ? target?.max_cost_per_message : key === "costPerData" ? target?.max_cost_per_data : null;
  return cap ? { value: cap, label: "Mục tiêu tối đa" } : null;
};

/**
 * Biểu đồ theo ngày (một tháng, một tuần hay một khoảng ngày), kèm nét đứt của kỳ trước (ngày tương ứng) và đường
 * mục tiêu. `previousDays[i]` là ngày của kỳ trước ứng với `days[i]`.
 */
function DailyChart({
  days,
  title,
  currentLabel,
  byDay,
  previousByDay,
  previousDays,
  previousLabel,
  target,
  metricTabs,
  metricKey,
}: {
  days: string[];
  title: string;
  currentLabel: string;
  byDay: Map<string, Totals>;
  previousByDay: Map<string, Totals> | null;
  previousDays: string[] | null;
  previousLabel: string;
  target: TargetValues | null;
  metricTabs: React.ReactNode;
  metricKey: MetricKey;
}) {
  const metric = metricOf(metricKey);
  const manyMonths = new Set(days.map((d) => d.slice(0, 7))).size > 1;
  const points = days.map((day) => ({
    key: day,
    label: manyMonths ? formatDay(day).slice(0, 5) : String(Number(day.slice(8))),
    title: formatDay(day),
    totals: byDay.get(day) ?? zero(),
  }));
  const prevDays = previousDays ?? [];
  const previous =
    previousByDay && previousDays
      ? {
          label: previousLabel,
          totals: days.map((_, i) => (prevDays[i] ? (previousByDay.get(prevDays[i]) ?? zero()) : null)),
          titles: days.map((_, i) => (prevDays[i] ? formatDay(prevDays[i]) : "")),
        }
      : undefined;
  return (
    <ChartCard title={`${metric.label} theo ngày — ${title}`} actions={metricTabs}>
      <TrendChart
        points={points}
        metric={metric}
        height="h-64"
        currentLabel={currentLabel}
        previous={previous}
        target={targetLine(metricKey, target)}
      />
    </ChartCard>
  );
}

/**
 * Tổng của cả khoảng đã chọn: thẻ tổng, biểu đồ (theo ngày nếu một tháng, theo tháng nếu nhiều tháng) và —
 * khi nhiều tháng — bảng mỗi dòng một tháng (có tổng từng năm nếu chọn nhiều năm).
 */
function PeriodSummary({
  months,
  byDay,
  prev,
  prevByDay,
  metricTabs,
  metricKey,
  onPickMonth,
}: {
  months: string[];
  byDay: Map<string, Totals>;
  prev: PreviousPeriod | null;
  prevByDay: Map<string, Totals> | null;
  metricTabs: React.ReactNode;
  metricKey: MetricKey;
  onPickMonth: (month: string) => void;
}) {
  const metric = metricOf(metricKey);
  const byMonth = totalsByMonth(byDay);
  const prevByMonth = prevByDay ? totalsByMonth(prevByDay) : null;
  const total = [...byMonth.values()].reduce(add, zero());
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const manyYears = years.length > 1;

  const rows: PeriodRow[] = [{ key: "total", label: "Tổng", totals: total, kind: "total" }];
  for (const year of years) {
    const inYear = months.filter((m) => m.startsWith(year));
    for (const month of inYear) {
      rows.push({
        key: month,
        label: (
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            title="Xem bảng từng ngày của tháng này"
            onClick={() => onPickMonth(month)}
          >
            {monthLabel(month)}
          </button>
        ),
        totals: byMonth.get(month) ?? zero(),
      });
    }
    if (manyYears) {
      rows.push({
        key: `year-${year}`,
        label: inYear.length === 12 ? `Cả năm ${year}` : `Tổng ${year} (${inYear.length} tháng)`,
        totals: inYear.map((m) => byMonth.get(m) ?? zero()).reduce(add, zero()),
        kind: "subtotal",
      });
    }
  }

  return (
    <>
      <ChartCard title={`${metric.label} theo tháng`} actions={metricTabs}>
        <TrendChart
          metric={metric}
          currentLabel="Các tháng đang chọn"
          previous={
            prev && prevByMonth
              ? {
                  label: `Kỳ trước (${prev.label})`,
                  totals: prev.months.map((m) => prevByMonth.get(m) ?? zero()),
                  titles: prev.months.map((m) => monthLabel(m)),
                }
              : undefined
          }
          points={months.map((month) => ({
            key: month,
            label: shortMonth(month, manyYears),
            title: monthLabel(month),
            totals: byMonth.get(month) ?? zero(),
          }))}
        />
      </ChartCard>
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Theo tháng</h2>
          <p className="text-sm text-muted-foreground">
            Mũi tên: tăng / giảm so với tháng ở dòng trên. Bấm tên tháng để xem từng ngày.
          </p>
        </div>
        <PeriodTable firstHead="Tháng" rows={rows} showChange />
      </section>
      {isEmpty(total) && (
        <p className="text-sm text-muted-foreground">Khoảng thời gian này chưa có báo cáo nào.</p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Quản lý: tổng của từng nhân viên trong khoảng đã chọn                                             */
/* ------------------------------------------------------------------------------------------------ */

function StaffSection({
  periodName,
  from,
  to,
  oneMonth,
  people,
  byStaff,
  assignments,
  metricTabs,
  metricKey,
  onPick,
}: {
  periodName: string;
  from: string;
  to: string;
  oneMonth: boolean;
  people: AdsStaff[];
  byStaff: Map<string | null, Totals>;
  assignments: AdAccountAssignment[];
  metricTabs: React.ReactNode;
  metricKey: MetricKey;
  onPick: (staffId: string) => void;
}) {
  const metric = metricOf(metricKey);
  // Người có TKQC trong khoảng đã chọn hoặc đã có số; người đã nghỉ mà không có số thì bỏ.
  const accountCount = (id: string) =>
    new Set(
      assignments
        .filter((x) => x.ads_staff_id === id && x.from_date <= to && (!x.to_date || x.to_date >= from))
        .map((x) => x.ad_account_id),
    ).size;
  const rows = people
    .map((p) => ({ person: p, totals: byStaff.get(p.id) ?? zero(), accounts: accountCount(p.id) }))
    .filter((row) => row.accounts > 0 || !isEmpty(row.totals));
  const unowned = byStaff.get(null);
  const total = [...byStaff.values()].reduce(add, zero());

  return (
    <>
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Theo nhân viên — {lowerFirst(periodName)}</h2>
          <p className="text-sm text-muted-foreground">
            Bấm vào tên để xem {oneMonth ? "bảng cả tháng" : "số liệu"} của người đó.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="table-pin w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium">Nhân viên</th>
                <th className={cn(TH, "bg-muted")}>Số TKQC</th>
                <th className={cn(TH, ORANGE)}>{oneMonth ? "Tổng chi tiêu tháng" : "Tổng chi tiêu"}</th>
                <MetricHeads />
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-accent font-semibold text-accent-foreground">
                <td className="sticky left-0 z-10 bg-accent px-3 py-2">Tổng</td>
                <td className={TD}>{formatNumber(rows.reduce((s, r) => s + r.accounts, 0))}</td>
                <td className={TD}>{formatNumber(total.spend)}</td>
                <MetricCells totals={total} />
              </tr>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="h-20 text-center text-muted-foreground">
                    Khoảng thời gian này chưa có nhân viên nào có TKQC.
                  </td>
                </tr>
              ) : (
                rows.map(({ person, totals, accounts }) => (
                  <tr key={person.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="font-medium underline-offset-2 hover:underline"
                        onClick={() => onPick(person.id)}
                      >
                        {person.full_name}
                      </button>
                      {!person.is_active && <span className="ml-1.5 text-xs text-muted-foreground">(đã nghỉ)</span>}
                    </td>
                    <td className={TD}>{formatNumber(accounts)}</td>
                    <td className={cn(TD, "font-medium")}>{formatNumber(totals.spend)}</td>
                    <MetricCells totals={totals} />
                  </tr>
                ))
              )}
              {unowned && (
                <tr className="border-b text-muted-foreground last:border-0">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 whitespace-nowrap" title="Báo cáo của TKQC không có người phụ trách vào ngày đó">
                    Chưa có người phụ trách
                  </td>
                  <td className={TD} />
                  <td className={TD}>{formatNumber(unowned.spend)}</td>
                  <MetricCells totals={unowned} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {rows.length > 1 && (
        <ChartCard title={`${metric.label} theo nhân viên`} actions={metricTabs}>
          <StaffChart
            metric={metric}
            rows={rows.map(({ person, totals }) => ({ key: person.id, name: person.full_name, totals }))}
          />
        </ChartCard>
      )}
    </>
  );
}

const dash = <span className="text-muted-foreground/60">–</span>;
const num = (value: number | null) => (value === null ? dash : formatNumber(value));

/** 5 ô chỉ số (Tổng mess, Giá mess, Data, Giá data, Tỉ lệ xin số) của một dòng. */
function MetricCells({ totals, empty = false }: { totals: Totals; empty?: boolean }) {
  const m = metrics(totals);
  if (empty) {
    return (
      <>
        {Array.from({ length: 5 }, (_, i) => (
          <td key={i} className={TD}>
            {dash}
          </td>
        ))}
      </>
    );
  }
  return (
    <>
      <td className={TD}>{formatNumber(totals.messages)}</td>
      <td className={TD}>{num(m.costPerMessage)}</td>
      <td className={TD}>{formatNumber(totals.data)}</td>
      <td className={TD}>{num(m.costPerData)}</td>
      <td className={TD}>{formatPercent(m.dataRate)}</td>
    </>
  );
}

/** Tiêu đề 5 cột chỉ số; `rowSpan` = 2 khi bảng có thêm dòng tên TK ADS. */
function MetricHeads({ rowSpan = 1 }: { rowSpan?: number }) {
  const base = cn(TH, rowSpan > 1 && "border-b align-bottom");
  return (
    <>
      <th rowSpan={rowSpan} className={cn(base, YELLOW)}>
        Tổng mess
      </th>
      <th rowSpan={rowSpan} className={cn(base, LIME)}>
        Giá mess
      </th>
      <th rowSpan={rowSpan} className={cn(base, YELLOW)}>
        Data
      </th>
      <th rowSpan={rowSpan} className={cn(base, LIME)}>
        Giá data
      </th>
      <th rowSpan={rowSpan} className={cn(base, YELLOW)}>
        Tỉ lệ xin số
      </th>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Bảng cả tháng của một nhân viên (như sheet)                                                       */
/* ------------------------------------------------------------------------------------------------ */

/** Một dòng của bảng: một ngày của một nhân viên. */
type Row = {
  day: string;
  /** Các TK ADS người này phụ trách ngày đó, kèm báo cáo (nếu đã gửi). */
  cells: Map<string, AdDailyReport | null>;
  reports: AdDailyReport[];
  /** Dòng "Data xin được" chung của ngày đó (null = chưa gửi). */
  data: AdDailyData | null;
  /** Data nhập theo từng TKQC ở các báo cáo cũ (trước khi có dòng chung). */
  legacyData: number;
};

type Group = { person: AdsStaff; accounts: AdAccount[]; rows: Row[] };

/** Những thứ đã gửi của một dòng (báo cáo TKQC + dòng Data chung) — để tính giờ gửi, hạn sửa. */
const sentOf = (row: Row) => [...row.reports, ...(row.data ? [row.data] : [])];

/** Tổng của một dòng: chi tiêu, mess cộng từ các TKQC; data lấy dòng chung (hoặc cộng từ báo cáo cũ). */
const rowTotals = (row: Row): Totals => ({
  spend: row.reports.reduce((s, r) => s + r.spend, 0),
  messages: row.reports.reduce((s, r) => s + r.messages, 0),
  data: row.data?.data_count ?? row.legacyData,
});

function buildGroup(
  person: AdsStaff,
  days: string[],
  reports: AdDailyReport[],
  dailyData: AdDailyData[],
  accounts: AdAccount[],
  assignments: AdAccountAssignment[],
): Group {
  const byKey = new Map(reports.map((r) => [`${r.report_date}:${r.ad_account_id}`, r]));
  const dataByDay = new Map(dailyData.filter((d) => d.ads_staff_id === person.id).map((d) => [d.report_date, d]));
  const mine = assignments.filter((x) => x.ads_staff_id === person.id);
  // Trước ngày TKQC được khai báo trong hệ thống thì không coi là "chưa gửi" (trừ khi đã có báo cáo).
  const createdDay = new Map(accounts.map((a) => [a.id, a.created_at ? dayOf(a.created_at) : ""]));
  const assigned = new Set<string>();
  const reported = new Set<string>();
  const rows = days.map((day) => {
    const cells = new Map<string, AdDailyReport | null>();
    for (const x of mine) {
      if (!coversDay(x, day)) continue;
      const report = byKey.get(`${day}:${x.ad_account_id}`) ?? null;
      if (!report && day < (createdDay.get(x.ad_account_id) ?? "")) continue;
      cells.set(x.ad_account_id, report);
      assigned.add(x.ad_account_id);
      if (report) reported.add(x.ad_account_id);
    }
    const sent = [...cells.values()].filter((r): r is AdDailyReport => r !== null);
    return {
      day,
      cells,
      reports: sent,
      data: dataByDay.get(day) ?? null,
      legacyData: sent.reduce((s, r) => s + r.data_count, 0),
    };
  });
  // Chỉ hiện cột các TKQC có chạy (đã gửi số) trong tháng — người cầm nhiều TKQC nhưng chỉ chạy vài cái.
  // Cả tháng chưa gửi gì thì hiện mọi TKQC đang cầm.
  const used = reported.size > 0 ? reported : assigned;
  return { person, accounts: accounts.filter((a) => used.has(a.id)), rows };
}

function PersonMonth({
  person,
  days,
  label,
  today,
  reports,
  dailyData,
  accounts,
  assignments,
  canAlwaysEdit,
  showEntryStaff,
  focusDay,
  onSaved,
}: {
  person: AdsStaff;
  /** Các ngày của bảng: cả một tháng, một tuần hay một khoảng ngày. */
  days: string[];
  /** "Tháng 11/2026", "Tuần 2 (09/11 – 15/11/2026)"… */
  label: string;
  today: string;
  reports: AdDailyReport[];
  /** null = chưa chạy file 010. */
  dailyData: AdDailyData[] | null;
  accounts: AdAccount[];
  assignments: AdAccountAssignment[];
  canAlwaysEdit: boolean;
  /** Quản lý: link "Nhập" mở Nhập liệu đúng người này. */
  showEntryStaff: boolean;
  focusDay: string | null;
  onSaved: () => Promise<void>;
}) {
  const group = useMemo(
    () => buildGroup(person, days, reports, dailyData ?? [], accounts, assignments),
    [person, days, reports, dailyData, accounts, assignments],
  );
  const [editing, setEditing] = useState<Row | null>(null);
  const total = group.rows.map(rowTotals).reduce(add, zero());

  return (
    <>
      {group.accounts.length === 0 && isEmpty(total) ? (
        <ReadOnlyNote>
          {label} {person.full_name} không có TKQC nào nên chưa có số liệu.
        </ReadOnlyNote>
      ) : (
        <MonthTable
          group={group}
          totalLabel={/^Tháng/.test(label) ? "Tổng tháng" : "Tổng"}
          today={today}
          dataReady={dailyData !== null}
          canAlwaysEdit={canAlwaysEdit}
          focusDay={focusDay}
          entryHref={(day) => `/marketing/nhap-lieu?ngay=${day}${showEntryStaff ? `&nv=${person.id}` : ""}`}
          onEdit={setEditing}
        />
      )}
      {editing && (
        <EditDialog
          key={editing.day}
          group={group}
          row={editing}
          today={today}
          canAlwaysEdit={canAlwaysEdit}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function MonthTable({
  group,
  totalLabel,
  today,
  dataReady,
  canAlwaysEdit,
  focusDay,
  entryHref,
  onEdit,
}: {
  group: Group;
  totalLabel: string;
  today: string;
  /** false = chưa chạy file 010: không nhắc "thiếu Data". */
  dataReady: boolean;
  canAlwaysEdit: boolean;
  focusDay: string | null;
  entryHref: (day: string) => string;
  onEdit: (row: Row) => void;
}) {
  const now = useNow();
  const spendTotal = (account: AdAccount) =>
    group.rows.reduce((sum, row) => sum + (row.cells.get(account.id)?.spend ?? 0), 0);
  const total = group.rows.map(rowTotals).reduce(add, zero());

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="table-pin w-full border-collapse text-sm">
        <thead>
          <tr>
            <th rowSpan={2} className="sticky left-0 z-10 border-b bg-muted px-3 py-2 text-left align-bottom font-medium">
              Ngày
            </th>
            {group.accounts.map((account, i) => (
              <th
                key={account.id}
                className="border-l bg-emerald-100 px-2.5 pt-1.5 pb-0.5 text-right text-[11px] font-semibold tracking-wide whitespace-nowrap text-emerald-950 uppercase dark:bg-emerald-900/50 dark:text-emerald-50"
              >
                TK ADS {i + 1}
              </th>
            ))}
            <th rowSpan={2} className={cn(TH, "border-b align-bottom", ORANGE)}>
              Tổng chi tiêu ngày
            </th>
            <MetricHeads rowSpan={2} />
            <th rowSpan={2} className="border-b border-l bg-muted px-3 py-2 text-left align-bottom text-xs font-medium">
              Gửi lúc
            </th>
            <th rowSpan={2} className="border-b border-l bg-muted px-3 py-2 text-left align-bottom text-xs font-medium">
              Thao tác
            </th>
          </tr>
          <tr className="border-b">
            {group.accounts.map((account) => (
              <th
                key={account.id}
                className="border-l bg-emerald-50 px-2.5 pt-0.5 pb-1.5 text-right text-xs font-medium whitespace-nowrap dark:bg-emerald-950/40"
              >
                {account.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b bg-accent font-semibold text-accent-foreground">
            <td className="sticky left-0 z-10 bg-accent px-3 py-2 text-left whitespace-nowrap">{totalLabel}</td>
            {group.accounts.map((account) => (
              <td key={account.id} className={TD}>
                {formatNumber(spendTotal(account))}
              </td>
            ))}
            <td className={TD}>{formatNumber(total.spend)}</td>
            <MetricCells totals={total} />
            <td className="border-l" />
            <td className="border-l" />
          </tr>
          {group.rows.map((row) => {
            const sent = sentOf(row);
            const future = Boolean(today) && row.day > today;
            const assigned = row.cells.size > 0;
            // Không nhắc "thiếu TK ADS": nhân viên chỉ gửi số các TKQC đang chạy (tick chọn ở Nhập liệu).
            const missingData = dataReady && assigned && !row.data && row.legacyData === 0;
            const missingText = missingData ? "Data" : "";
            const firstSent = sent.map((r) => r.submitted_at).sort()[0];
            const lastEdit = sent.filter(wasEdited).map((r) => r.updated_at).sort().at(-1);
            // Nhân viên: sửa được những gì còn trong 24 giờ kể từ lúc gửi; quản lý: luôn sửa được.
            const openDeadlines = sent.map(editDeadline).filter((d) => now > 0 && d > now);
            const editable = sent.length > 0 && (canAlwaysEdit || openDeadlines.length > 0);
            const totals = rowTotals(row);
            const focused = row.day === focusDay;
            return (
              <tr
                key={row.day}
                className={cn(
                  "border-b last:border-0",
                  focused ? "bg-muted" : "bg-card hover:bg-muted",
                  (future || !assigned) && sent.length === 0 && "text-muted-foreground",
                )}
              >
                <td
                  className={cn(
                    "sticky left-0 z-10 bg-inherit px-3 py-2 text-left font-medium whitespace-nowrap tabular-nums",
                    focused && "shadow-[inset_3px_0_0_var(--primary)]",
                  )}
                >
                  {formatDay(row.day)}
                </td>
                {group.accounts.map((account) => {
                  const report = row.cells.get(account.id);
                  return (
                    <td key={account.id} className={TD}>
                      {!row.cells.has(account.id) ? "" : report ? formatNumber(report.spend) : dash}
                    </td>
                  );
                })}
                <td className={cn(TD, "font-medium")}>{sent.length > 0 ? formatNumber(totals.spend) : dash}</td>
                <MetricCells totals={totals} empty={sent.length === 0} />
                <td className="border-l px-3 py-2 align-top text-xs whitespace-nowrap">
                  {firstSent ? (
                    <div className="grid gap-1">
                      <span className="text-sm tabular-nums">{formatClock(firstSent, today, true)}</span>
                      {missingText && <span className="text-amber-700 dark:text-amber-300">Thiếu {missingText}</span>}
                      {lastEdit && (
                        <span className="w-fit rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-900 dark:bg-sky-900/40 dark:text-sky-100">
                          Đã sửa lúc {formatClock(lastEdit, today, true)}
                        </span>
                      )}
                    </div>
                  ) : assigned && !future ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      Chưa gửi
                    </span>
                  ) : null}
                </td>
                <td className="border-l px-3 py-1.5 align-top whitespace-nowrap">
                  {sent.length === 0 ? (
                    assigned && !future ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={entryHref(row.day)}>Nhập</Link>
                      </Button>
                    ) : null
                  ) : (
                    <div className="grid justify-items-start gap-1">
                      {editable ? (
                        <Button variant="outline" size="sm" onClick={() => onEdit(row)}>
                          <Pencil />
                          Sửa
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" disabled title="Đã quá 24 giờ kể từ lúc gửi">
                          <Lock />
                          Đã khoá
                        </Button>
                      )}
                      {!canAlwaysEdit && editable && (
                        <span className="text-xs text-muted-foreground">
                          Còn sửa được {durationText(Math.min(...openDeadlines) - now)}
                        </span>
                      )}
                      {missingText && (
                        <Link href={entryHref(row.day)} className="text-xs text-muted-foreground underline underline-offset-2">
                          Gửi nốt phần còn thiếu
                        </Link>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Hộp Sửa                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

const toValues = (report: AdDailyReport): ReportValues => ({
  spend: String(report.spend),
  messages: String(report.messages),
});

function EditDialog({
  group,
  row,
  today,
  canAlwaysEdit,
  onClose,
  onSaved,
}: {
  group: Group;
  row: Row;
  today: string;
  canAlwaysEdit: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const now = useNow();
  const [values, setValues] = useState<Record<string, ReportValues>>(() =>
    Object.fromEntries(row.reports.map((r) => [r.ad_account_id, toValues(r)])),
  );
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [dataValue, setDataValue] = useState(row.data ? String(row.data.data_count) : "");
  const [dataTouched, setDataTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const isOpen = (sent: { submitted_at: string; updated_at: string }) =>
    canAlwaysEdit || (now > 0 && editDeadline(sent) > now);
  const dataOpen = row.data !== null && isOpen(row.data);
  const dataChanged = dataOpen && row.data !== null && dataValue !== String(row.data.data_count);
  const items: FieldItem[] = group.accounts.flatMap((account, i) => {
    const report = row.cells.get(account.id);
    if (!report) return [];
    const open = isOpen(report);
    return [{ account, index: i + 1, shown: open ? undefined : report, note: open ? undefined : "Đã khoá (quá 24 giờ)" }];
  });
  const openReports = row.reports.filter(isOpen);
  const changed = openReports.filter(
    (r) => JSON.stringify(values[r.ad_account_id]) !== JSON.stringify(toValues(r)),
  );
  const openSent = sentOf(row).filter(isOpen);
  const deadline = openSent.length > 0 ? Math.min(...openSent.map(editDeadline)) : 0;

  async function save() {
    setSaving(true);
    try {
      for (const report of changed) {
        await updateReport(report.id, toNumbers(values[report.ad_account_id]));
      }
      if (dataChanged && row.data) await updateDailyData(row.data.id, Number(dataValue));
      toast.success(`Đã cập nhật báo cáo ngày ${formatDay(row.day)}`);
      onClose();
    } catch (error) {
      toast.error("Không lưu được", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
      await onSaved();
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sửa báo cáo ngày {formatDay(row.day)}</DialogTitle>
          <DialogDescription>
            {group.person.full_name} ·{" "}
            {canAlwaysEdit
              ? "Bạn là quản lý nên sửa được bất kỳ lúc nào."
              : deadline > 0
                ? `Còn sửa được ${durationText(deadline - now)}. Sửa không làm mới mốc 24 giờ.`
                : "Đã quá 24 giờ kể từ lúc gửi."}
          </DialogDescription>
        </DialogHeader>

        <ReportFields
          items={items}
          values={values}
          touched={touched}
          onChange={(accountId, field, digits) =>
            setValues((prev) => ({ ...prev, [accountId]: { ...prev[accountId], [field]: digits } }))
          }
          onTouch={(accountId, field) => setTouched((prev) => new Set(prev).add(fieldKey(accountId, field)))}
          layout="cards"
          dayLabel={formatDay(row.day)}
          data={
            row.data
              ? {
                  value: dataValue,
                  shown: dataOpen ? undefined : row.data.data_count,
                  note: dataOpen
                    ? `Gửi lúc ${formatClock(row.data.submitted_at, today)} · chung cho tất cả TKQC`
                    : "Đã khoá (quá 24 giờ)",
                  touched: dataTouched,
                  onChange: setDataValue,
                  onTouch: () => setDataTouched(true),
                }
              : undefined
          }
        />
        {!row.data && (
          <p className="text-sm text-muted-foreground">Ngày này chưa gửi “Data xin được” — gửi ở màn Nhập liệu.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button
            onClick={save}
            disabled={
              saving || (changed.length === 0 && !dataChanged) || !allFilled(items, values) || (dataOpen && dataValue === "")
            }
          >
            {saving ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
