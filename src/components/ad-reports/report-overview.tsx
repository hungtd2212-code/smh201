"use client";

import { ChartColumn, Lock, Pencil } from "lucide-react";
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
import { daysDesc, durationText, editDeadline, formatClock, formatDay, wasEdited } from "@/lib/ad-reports/dates";
import { formatNumber } from "@/lib/ad-reports/number";
import { updateDailyData, updateReport } from "@/lib/ad-reports/repo";
import {
  REPORT_FIELDS,
  type AdDailyData,
  type AdDailyReport,
  type ReportField,
  type ReportValues,
} from "@/lib/ad-reports/types";
import type { AdAccount, AdAccountAssignment, AdsStaff } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { RangeFilter, type DayRange } from "./date-filters";
import { useAdReports, useNow } from "./hooks";
import { ReportFields, allFilled, fieldKey, toNumbers, type FieldItem } from "./report-fields";
import { useAccountOwner } from "./account-setup";
import { NotReady, StatsError } from "./shared";

const ALL = "__all";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Marketing → Tổng quan: các báo cáo đã gửi, mỗi dòng một ngày, mỗi nhóm cột một TK ADS. Nhân viên
 * thấy báo cáo của mình và sửa được trong 24 giờ kể từ lúc gửi; Quản trị / Trưởng Marketing thấy tất
 * cả, lọc theo nhân viên, sửa bất kỳ lúc nào.
 */
export function ReportOverview() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={ChartColumn}
        title="Tổng quan"
        description="Các báo cáo đã gửi theo từng ngày và từng TK ADS. Nhân viên sửa được trong 24 giờ kể từ lúc gửi."
      />
      <CatalogGate>
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <OverviewBody />
        </Suspense>
      </CatalogGate>
    </div>
  );
}

function OverviewBody() {
  const { catalogs } = useCatalogs();
  const staff = useCurrentStaff();
  const scope = useAdsScope();
  const today = useTodayVn();
  const params = useSearchParams();
  // Mở từ màn Nhập liệu ("Đi tới Tổng quan") → đúng báo cáo ngày đó.
  const focusDay = ISO_DAY.test(params.get("ngay") ?? "") ? params.get("ngay") : null;
  const [picked, setPicked] = useState<DayRange | null>(focusDay ? { from: focusDay, to: focusDay } : null);
  const [staffFilter, setStaffFilter] = useState(params.get("nv") ?? ALL);
  const [accountFilter, setAccountFilter] = useState(ALL);
  const ownerOf = useAccountOwner();

  const range = picked ?? { from: today, to: today };
  const { state, reload } = useAdReports(range.from, range.to);

  const me =
    scope.isAdsStaff && staff.status === "ok"
      ? catalogs.adsStaff.find((a) => a.user_id === staff.userId)
      : undefined;
  const people: AdsStaff[] = scope.managesMarketing
    ? catalogs.adsStaff.filter((p) => staffFilter === ALL || p.id === staffFilter)
    : me
      ? [me]
      : [];

  // Ô "Tài khoản quảng cáo": TKQC của nhân viên đang lọc (nhân viên Ads: chỉ của mình).
  const accountChoices = catalogs.adAccounts.filter((a) =>
    scope.managesMarketing ? staffFilter === ALL || ownerOf(a.id) === staffFilter : me !== undefined && ownerOf(a.id) === me.id,
  );

  if (!catalogs.marketingReady) return <MarketingNotReady what="Màn Tổng quan" />;
  if (staff.status === "loading") return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!scope.managesMarketing && !scope.isAdsStaff) {
    return (
      <ReadOnlyNote>
        Màn này dành cho Nhân viên Ads (xem báo cáo của mình), Trưởng Marketing và Quản trị (xem tất cả).
      </ReadOnlyNote>
    );
  }
  if (state.status === "not-migrated") return <NotReady />;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangeFilter value={range} today={today} onChange={setPicked} />
        <div className="flex flex-wrap gap-2">
          {scope.managesMarketing && (
            <Select
              value={staffFilter}
              onValueChange={(value) => {
                setStaffFilter(value);
                setAccountFilter(ALL);
              }}
            >
              <SelectTrigger className="w-56" aria-label="Lọc theo nhân viên quảng cáo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tất cả nhân viên quảng cáo</SelectItem>
                {catalogs.adsStaff.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name}
                    {!p.is_active && " (đã nghỉ)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {accountChoices.length > 0 && (
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger className="w-52" aria-label="Lọc theo tài khoản quảng cáo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tất cả TKQC ({accountChoices.length})</SelectItem>
                {accountChoices.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                    {!a.is_active && " (ngừng dùng)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {scope.isAdsStaff && !me ? (
        <ReadOnlyNote>
          Tài khoản của bạn chưa được gắn với một Nhân viên Ads. Nhờ Trưởng Marketing hoặc Quản trị gắn tài khoản ở
          trang Nhân viên Ads.
        </ReadOnlyNote>
      ) : state.status === "error" ? (
        <StatsError message={state.message} />
      ) : state.status === "ready" && range.from ? (
        <Sections
          people={people}
          range={range}
          today={today}
          reports={state.reports}
          dailyData={state.data}
          accounts={catalogs.adAccounts}
          assignments={
            accountFilter === ALL ? catalogs.assignments : catalogs.assignments.filter((x) => x.ad_account_id === accountFilter)
          }
          canAlwaysEdit={scope.managesMarketing}
          showNames={scope.managesMarketing}
          focusDay={focusDay}
          onSaved={reload}
        />
      ) : (
        <Skeleton className="h-64 w-full rounded-xl" />
      )}

    </>
  );
}

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

/** Những thứ đã gửi của một dòng (báo cáo TKQC + dòng Data chung) — để tính giờ gửi, hạn sửa. */
const sentOf = (row: Row) => [...row.reports, ...(row.data ? [row.data] : [])];

/** Số "Data xin được" của dòng: dòng chung nếu có, không thì cộng từ báo cáo cũ. */
const dataOf = (row: Row) => row.data?.data_count ?? (row.legacyData > 0 ? row.legacyData : null);

type Group = { person: AdsStaff; accounts: AdAccount[]; rows: Row[] };

function buildGroups(
  people: AdsStaff[],
  days: string[],
  reports: AdDailyReport[],
  dailyData: AdDailyData[],
  accounts: AdAccount[],
  assignments: AdAccountAssignment[],
): Group[] {
  const byKey = new Map(reports.map((r) => [`${r.report_date}:${r.ad_account_id}`, r]));
  const dataByKey = new Map(dailyData.map((d) => [`${d.report_date}:${d.ads_staff_id}`, d]));
  return people
    .map((person) => {
      const mine = assignments.filter((x) => x.ads_staff_id === person.id);
      const rows: Row[] = [];
      const used = new Set<string>();
      for (const day of days) {
        const cells = new Map<string, AdDailyReport | null>();
        for (const x of mine) {
          if (!coversDay(x, day)) continue;
          cells.set(x.ad_account_id, byKey.get(`${day}:${x.ad_account_id}`) ?? null);
          used.add(x.ad_account_id);
        }
        const data = dataByKey.get(`${day}:${person.id}`) ?? null;
        if (cells.size === 0 && !data) continue;
        const sent = [...cells.values()].filter((r): r is AdDailyReport => r !== null);
        rows.push({ day, cells, reports: sent, data, legacyData: sent.reduce((sum, r) => sum + r.data_count, 0) });
      }
      return { person, accounts: accounts.filter((a) => used.has(a.id)), rows };
    })
    .filter((group) => group.rows.length > 0);
}

function Sections({
  people,
  range,
  today,
  reports,
  dailyData,
  accounts,
  assignments,
  canAlwaysEdit,
  showNames,
  focusDay,
  onSaved,
}: {
  people: AdsStaff[];
  range: DayRange;
  today: string;
  reports: AdDailyReport[];
  /** null = chưa chạy file 010. */
  dailyData: AdDailyData[] | null;
  accounts: AdAccount[];
  assignments: AdAccountAssignment[];
  canAlwaysEdit: boolean;
  showNames: boolean;
  focusDay: string | null;
  onSaved: () => Promise<void>;
}) {
  const days = useMemo(() => daysDesc(range.from, range.to), [range.from, range.to]);
  const groups = useMemo(
    () => buildGroups(people, days, reports, dailyData ?? [], accounts, assignments),
    [people, days, reports, dailyData, accounts, assignments],
  );
  const [editing, setEditing] = useState<{ group: Group; row: Row } | null>(null);

  if (groups.length === 0) {
    return (
      <ReadOnlyNote>
        {showNames
          ? "Trong khoảng ngày này không có nhân viên nào phụ trách TK ADS."
          : "Trong khoảng ngày này bạn không phụ trách TK ADS nào."}
      </ReadOnlyNote>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.person.id} className="grid gap-2">
          {showNames && <h2 className="font-medium">{group.person.full_name}</h2>}
          <GroupTable
            group={group}
            today={today}
            dataReady={dailyData !== null}
            canAlwaysEdit={canAlwaysEdit}
            focusDay={focusDay}
            entryHref={(day) => `/marketing/nhap-lieu?ngay=${day}${showNames ? `&nv=${group.person.id}` : ""}`}
            onEdit={(row) => setEditing({ group, row })}
          />
        </section>
      ))}
      {editing && (
        <EditDialog
          key={`${editing.group.person.id}:${editing.row.day}`}
          group={editing.group}
          row={editing.row}
          today={today}
          canAlwaysEdit={canAlwaysEdit}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

const head = "px-2.5 py-1.5 text-right text-xs font-medium whitespace-nowrap";
const cell = "px-2.5 py-2 text-right whitespace-nowrap tabular-nums";
const SHORT_LABELS: Record<ReportField, string> = { spend: "Chi tiêu", messages: "Tin nhắn" };

function GroupTable({
  group,
  today,
  dataReady,
  canAlwaysEdit,
  focusDay,
  entryHref,
  onEdit,
}: {
  group: Group;
  today: string;
  /** false = chưa chạy file 010: không nhắc "thiếu Data". */
  dataReady: boolean;
  canAlwaysEdit: boolean;
  focusDay: string | null;
  entryHref: (day: string) => string;
  onEdit: (row: Row) => void;
}) {
  const now = useNow();
  const totals = (account: AdAccount, field: ReportField) =>
    group.rows.reduce((sum, row) => sum + (row.cells.get(account.id)?.[field] ?? 0), 0);
  const dataTotal = group.rows.reduce((sum, row) => sum + (dataOf(row) ?? 0), 0);

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th rowSpan={2} className="sticky left-0 z-10 border-b bg-muted px-3 py-2 text-left align-bottom font-medium">
              Ngày
            </th>
            {group.accounts.map((account, i) => (
              <th
                key={account.id}
                colSpan={REPORT_FIELDS.length}
                className="border-b border-l bg-emerald-100 px-3 py-1.5 text-left font-normal text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-50"
              >
                <div className="text-[11px] font-semibold tracking-wide uppercase opacity-75">TK ADS {i + 1}</div>
                <div className="font-semibold whitespace-nowrap">{account.name}</div>
              </th>
            ))}
            <th
              rowSpan={2}
              className="border-b border-l bg-sky-100 px-3 py-2 text-right align-bottom font-medium whitespace-nowrap text-sky-950 dark:bg-sky-900/50 dark:text-sky-50"
              title="Chung cho tất cả TKQC"
            >
              Data xin được
            </th>
            <th rowSpan={2} className="border-b border-l bg-muted px-3 py-2 text-left align-bottom font-medium">
              Gửi lúc
            </th>
            <th rowSpan={2} className="border-b bg-muted px-3 py-2 text-left align-bottom font-medium">
              Thao tác
            </th>
          </tr>
          <tr className="border-b bg-emerald-50 dark:bg-emerald-950/40">
            {group.accounts.flatMap((account) =>
              REPORT_FIELDS.map((field, j) => (
                <th key={`${account.id}-${field.key}`} className={cn(head, j === 0 && "border-l")}>
                  {SHORT_LABELS[field.key]}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {group.rows.length > 1 && (
            <tr className="border-b bg-accent font-semibold text-accent-foreground">
              <td className="sticky left-0 z-10 bg-accent px-3 py-2 text-left">Tổng</td>
              {group.accounts.flatMap((account) =>
                REPORT_FIELDS.map((field, j) => (
                  <td key={`${account.id}-${field.key}`} className={cn(cell, j === 0 && "border-l")}>
                    {formatNumber(totals(account, field.key))}
                  </td>
                )),
              )}
              <td className={cn(cell, "border-l")}>{formatNumber(dataTotal)}</td>
              <td className="border-l" />
              <td />
            </tr>
          )}
          {group.rows.map((row) => {
            const sent = sentOf(row);
            const missing = [...row.cells.values()].filter((r) => r === null).length;
            const missingData = dataReady && !row.data && row.legacyData === 0;
            const missingText = [missing > 0 && `${missing} TK ADS`, missingData && "Data"].filter(Boolean).join(", ");
            const firstSent = sent.map((r) => r.submitted_at).sort()[0];
            const lastEdit = sent.filter(wasEdited).map((r) => r.updated_at).sort().at(-1);
            // Nhân viên: sửa được những gì còn trong 24 giờ kể từ lúc gửi; quản lý: luôn sửa được.
            const openDeadlines = sent.map(editDeadline).filter((d) => now > 0 && d > now);
            const editable = sent.length > 0 && (canAlwaysEdit || openDeadlines.length > 0);
            const data = dataOf(row);
            const focused = row.day === focusDay;
            return (
              <tr key={row.day} className={cn("border-b last:border-0", focused ? "bg-muted" : "bg-card hover:bg-muted")}>
                <td
                  className={cn(
                    "sticky left-0 z-10 bg-inherit px-3 py-2 text-left font-medium whitespace-nowrap tabular-nums",
                    focused && "shadow-[inset_3px_0_0_var(--primary)]",
                  )}
                >
                  {formatDay(row.day)}
                </td>
                {group.accounts.flatMap((account) =>
                  REPORT_FIELDS.map((field, j) => {
                    const assigned = row.cells.has(account.id);
                    const report = row.cells.get(account.id);
                    return (
                      <td key={`${account.id}-${field.key}`} className={cn(cell, j === 0 && "border-l")}>
                        {!assigned ? (
                          ""
                        ) : report ? (
                          formatNumber(report[field.key])
                        ) : (
                          <span className="text-muted-foreground/60" title="Chưa gửi">
                            –
                          </span>
                        )}
                      </td>
                    );
                  }),
                )}
                <td
                  className={cn(cell, "border-l")}
                  title={!row.data && data !== null ? "Cộng từ data nhập theo từng TKQC (báo cáo cũ)" : undefined}
                >
                  {data === null ? (
                    <span className="text-muted-foreground/60" title="Chưa gửi">
                      –
                    </span>
                  ) : (
                    formatNumber(data)
                  )}
                </td>
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
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      Chưa gửi
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-top whitespace-nowrap">
                  {sent.length === 0 ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={entryHref(row.day)}>Nhập</Link>
                    </Button>
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
          <p className="text-sm text-muted-foreground">
            Ngày này chưa gửi “Data xin được” — gửi ở màn Nhập liệu.
          </p>
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
