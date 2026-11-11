"use client";

import { ChartColumn, ChevronLeft, ChevronRight, ClipboardPenLine } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
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
  NO_OWNER,
  daysOfMonth,
  emptyTotals,
  metricsOf,
  ownerLookup,
  shiftMonth,
  sumTotals,
  summarize,
  totalsByStaff,
  weeksOfMonth,
  type Period,
  type Totals,
} from "@/lib/ads-stats/compute";
import { formatMoney, formatNumber, formatPercent, monthLabel } from "@/lib/ads-stats/format";
import type { AdsStats } from "@/lib/ads-stats/types";
import type { AdAccount, AdsStaff } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { AdsStatsNotReady, DailyStatsTable, StatsError, TotalsTable, type TotalsRow } from "./stats-table";
import { useAdsStats } from "./use-ads-stats";

const ALL = "__all";

/**
 * Marketing → Báo cáo hiệu suất: bảng tổng theo ngày, theo tuần và theo từng nhân viên Ads —
 * cùng bộ cột với file Google Sheet "BC ads". Số lấy từ trang Nhập số liệu ngày.
 */
export function PerformanceReport() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={ChartColumn}
        title="Báo cáo hiệu suất"
        description="Chi tiêu ads, mess, data, doanh số theo ngày, theo tuần và theo từng nhân viên Ads."
      >
        <Button asChild variant="outline">
          <Link href="/marketing/nhap-so-lieu">
            <ClipboardPenLine />
            Nhập số liệu ngày
          </Link>
        </Button>
      </PageHeader>
      <CatalogGate>
        <ReportBody />
      </CatalogGate>
    </div>
  );
}

function ReportBody() {
  const { catalogs } = useCatalogs();
  const staff = useCurrentStaff();
  const scope = useAdsScope();
  const today = useTodayVn();
  const thisMonth = today.slice(0, 7);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const [pickedStaff, setPickedStaff] = useState(ALL);
  const [showAccounts, setShowAccounts] = useState(true);

  const month = pickedMonth ?? thisMonth;
  // Chỉ tính tới hôm nay: các ngày chưa tới không có dòng trong bảng.
  const days = useMemo(() => (month ? daysOfMonth(month).filter((d) => d <= today) : []), [month, today]);
  const { state } = useAdsStats(month ? `${month}-01` : "", days.at(-1) ?? "");
  const ownerOf = useMemo(() => ownerLookup(catalogs.assignments), [catalogs.assignments]);

  // Nhân viên Ads chỉ xem báo cáo của chính mình (máy chủ cũng chỉ trả về số của người đó).
  const me =
    scope.isAdsStaff && staff.status === "ok"
      ? catalogs.adsStaff.find((a) => a.user_id === staff.userId)
      : undefined;
  const staffId = scope.managesMarketing ? (pickedStaff === ALL ? null : pickedStaff) : (me?.id ?? null);
  const who = staffId ? catalogs.adsStaff.find((a) => a.id === staffId)?.full_name : undefined;

  if (!catalogs.marketingReady) return <MarketingNotReady what="Báo cáo hiệu suất" />;
  if (staff.status === "loading") return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!scope.managesMarketing && !scope.isAdsStaff) {
    return (
      <ReadOnlyNote>
        Báo cáo này dành cho Quản trị, Trưởng Marketing (xem tất cả) và Nhân viên Ads (xem số của mình).
      </ReadOnlyNote>
    );
  }
  if (state.status === "not-migrated") return <AdsStatsNotReady />;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Tháng trước"
            disabled={!month}
            onClick={() => setPickedMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-36 text-center font-medium">{month ? monthLabel(month) : "…"}</span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Tháng sau"
            disabled={!month || month >= thisMonth}
            onClick={() => setPickedMonth(shiftMonth(month, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        {month !== thisMonth && (
          <Button variant="ghost" onClick={() => setPickedMonth(null)}>
            Về tháng này
          </Button>
        )}
        {scope.managesMarketing && (
          <Select value={pickedStaff} onValueChange={setPickedStaff}>
            <SelectTrigger className="w-52" aria-label="Lọc theo nhân viên Ads">
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

      {state.status === "error" ? (
        <StatsError message={state.message} />
      ) : state.status === "ready" ? (
        <Report
          month={month}
          days={days}
          stats={state.stats}
          ownerOf={ownerOf}
          staffId={staffId}
          who={who}
          people={catalogs.adsStaff}
          allAccounts={catalogs.adAccounts}
          showStaffTable={scope.managesMarketing && staffId === null}
          showAccounts={showAccounts}
          onShowAccounts={setShowAccounts}
        />
      ) : (
        <Skeleton className="h-96 w-full rounded-xl" />
      )}
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

/** Phần thân báo cáo của một tháng: chỉ nhận số liệu qua tham số, không tự gọi máy chủ. */
export function Report({
  month,
  days,
  stats,
  ownerOf,
  staffId,
  who,
  people,
  allAccounts,
  showStaffTable,
  showAccounts,
  onShowAccounts,
}: {
  month: string;
  days: string[];
  stats: AdsStats;
  ownerOf: ReturnType<typeof ownerLookup>;
  /** null = tất cả nhân viên. */
  staffId: string | null;
  who: string | undefined;
  people: AdsStaff[];
  allAccounts: AdAccount[];
  showStaffTable: boolean;
  showAccounts: boolean;
  onShowAccounts: (show: boolean) => void;
}) {
  const [periodKey, setPeriodKey] = useState("month");

  const summary = useMemo(() => summarize(stats, days, ownerOf, staffId), [stats, days, ownerOf, staffId]);
  const total = summary.total;
  const m = metricsOf(total);

  const periods: Period[] = useMemo(
    () => [
      { key: "month", label: "Cả tháng", from: `${month}-01`, to: `${month}-31` },
      ...weeksOfMonth(month),
    ],
    [month],
  );

  // Theo tuần: cộng các ngày của bảng theo ngày (đã lọc theo nhân viên đang chọn).
  const weekRows: TotalsRow[] = periods.map((period) => ({
    key: period.key,
    label: period.key === "month" ? monthLabel(month) : `Tuần ${period.label}`,
    strong: period.key === "month",
    totals: sumTotals(
      summary.days.filter((row) => row.day >= period.from && row.day <= period.to).map((row) => row.totals),
    ),
  }));

  // Theo nhân viên, trong khoảng đang chọn.
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];
  const byStaff = useMemo(
    () => totalsByStaff(stats, period.from, period.to, ownerOf),
    [stats, period.from, period.to, ownerOf],
  );
  const hasNumbers = (t: Totals | undefined) => Boolean(t && Object.values(t).some((v) => v > 0));
  const staffRows: TotalsRow[] = [
    { key: "total", label: "Tổng", strong: true, totals: sumTotals(byStaff.values()) },
    ...people
      .filter((p) => p.is_active || hasNumbers(byStaff.get(p.id)))
      .map((p) => ({ key: p.id, label: p.full_name, totals: byStaff.get(p.id) ?? emptyTotals() })),
    ...(hasNumbers(byStaff.get(NO_OWNER))
      ? [
          {
            key: NO_OWNER,
            label: "Chưa có người phụ trách",
            hint: "Chi tiêu của TKQC không được giao cho ai vào ngày đó — kiểm tra phân công ở trang TKQC & Page",
            totals: byStaff.get(NO_OWNER) ?? emptyTotals(),
          },
        ]
      : []),
  ];

  // Cột TKQC: những TKQC có chi tiêu trong tháng (trong phạm vi đang lọc).
  const accounts = allAccounts.filter((account) => (summary.spendByAccount.get(account.id) ?? 0) > 0);
  const scopeLabel = who ? `của ${who}` : "toàn bộ";
  const qualityTotal = total.potential + total.booked + total.wrongArea + total.noResponse;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Tile label="Chi tiêu ads" value={formatMoney(total.spend)} />
        <Tile label="Tổng mess" value={formatNumber(total.messages)} sub={`Giá mess ${formatMoney(m.costPerMessage)}`} />
        <Tile
          label="Data"
          value={formatNumber(total.data)}
          sub={`Giá data ${formatMoney(m.costPerData)} · xin số ${formatPercent(m.dataRate)}`}
        />
        <Tile label="Doanh số" value={formatMoney(total.sales)} sub={`Ads / Doanh số ${formatPercent(m.adsOverSales)}`} />
        <Tile label="Doanh thu" value={formatMoney(total.revenue)} />
      </div>
      {qualityTotal > 0 && (
        <p className="text-sm text-muted-foreground">
          Chất lượng data: <b className="font-medium text-foreground">{total.potential}</b> KHTN ·{" "}
          <b className="font-medium text-foreground">{total.booked}</b> đặt lịch hẹn ·{" "}
          <b className="font-medium text-foreground">{total.wrongArea}</b> lạc tỉnh ·{" "}
          <b className="font-medium text-foreground">{total.noResponse}</b> không tương tác
        </p>
      )}

      <section className="grid gap-3">
        <h2 className="font-medium">Theo tuần — {scopeLabel}</h2>
        <TotalsTable firstColumn="Khoảng ngày" rows={weekRows} empty="Chưa có số liệu." />
      </section>

      {showStaffTable && (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Theo nhân viên Ads</h2>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Chọn khoảng ngày">
              {periods.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={p.key === period.key}
                  onClick={() => setPeriodKey(p.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
                    p.key === period.key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <TotalsTable firstColumn="Nhân viên" rows={staffRows} empty="Chưa có nhân viên Ads nào." />
        </section>
      )}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Theo ngày — {scopeLabel}</h2>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={showAccounts}
              onChange={(event) => onShowAccounts(event.target.checked)}
            />
            Hiện chi tiêu từng TKQC
          </label>
        </div>
        <DailyStatsTable
          summary={summary}
          accounts={showAccounts ? accounts : []}
          totalLabel={`Tổng ${monthLabel(month).toLowerCase()}`}
        />
      </section>
    </>
  );
}
