"use client";

import { ChartColumn, CircleCheck, ClipboardPenLine, Save } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { coversDay, useAdsScope } from "@/components/catalog/ads-scope";
import {
  CatalogGate,
  MarketingNotReady,
  PageHeader,
  ReadOnlyNote,
  formatDate,
  useTodayVn,
} from "@/components/catalog/shared";
import { useCatalogs } from "@/components/catalog-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { daysOfMonth, emptyTotals, metricsOf, ownerLookup, summarize } from "@/lib/ads-stats/compute";
import { formatMoney, formatPercent, monthLabel } from "@/lib/ads-stats/format";
import { saveAdsDaily } from "@/lib/ads-stats/repo";
import type { AdsStats, DailyResult } from "@/lib/ads-stats/types";
import type { AdAccount, AdsStaff } from "@/lib/catalog/types";
import { AdsStatsNotReady, DailyStatsTable, StatsError } from "./stats-table";
import { useAdsStats } from "./use-ads-stats";

/**
 * Marketing → Nhập số liệu ngày: mỗi nhân viên Ads điền chi tiêu từng TKQC mình phụ trách và kết
 * quả trong ngày (mess, data, doanh số, doanh thu, chất lượng data). Số nhập ở đây tự cộng vào
 * Báo cáo hiệu suất.
 */
export function DailyEntry() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={ClipboardPenLine}
        title="Nhập số liệu ngày"
        description="Chi tiêu từng TKQC và kết quả mỗi ngày của từng nhân viên Ads. Số nhập ở đây tự cộng vào Báo cáo hiệu suất."
      >
        <Button asChild variant="outline">
          <Link href="/marketing/bao-cao">
            <ChartColumn />
            Xem báo cáo
          </Link>
        </Button>
      </PageHeader>
      <CatalogGate>
        <EntryBody />
      </CatalogGate>
    </div>
  );
}

/** Lùi `days` ngày: addDays("2026-11-01", -1) → "2026-10-31". */
function addDays(iso: string, days: number) {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function EntryBody() {
  const { catalogs } = useCatalogs();
  const staff = useCurrentStaff();
  const scope = useAdsScope();
  const today = useTodayVn();
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [pickedStaff, setPickedStaff] = useState<string | null>(null);

  // Nhân viên Ads chỉ đọc được dòng ads_staff của chính mình.
  const me =
    scope.isAdsStaff && staff.status === "ok"
      ? catalogs.adsStaff.find((a) => a.user_id === staff.userId)
      : undefined;
  const people = scope.managesMarketing ? catalogs.adsStaff : me ? [me] : [];
  const person = scope.managesMarketing
    ? (people.find((p) => p.id === pickedStaff) ?? people.find((p) => p.is_active) ?? people[0])
    : me;

  const day = pickedDay ?? today;
  const month = day.slice(0, 7);
  const days = useMemo(() => (month ? daysOfMonth(month).filter((d) => d <= today) : []), [month, today]);
  const { state, reload } = useAdsStats(month ? `${month}-01` : "", days.at(-1) ?? "");
  const ownerOf = useMemo(() => ownerLookup(catalogs.assignments), [catalogs.assignments]);

  if (!catalogs.marketingReady) return <MarketingNotReady what="Việc nhập số liệu ngày" />;
  if (staff.status === "loading") return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!scope.managesMarketing && !scope.isAdsStaff) {
    return (
      <ReadOnlyNote>
        Trang này dành cho Nhân viên Ads (nhập số của mình), Trưởng Marketing và Quản trị (nhập cho mọi người).
      </ReadOnlyNote>
    );
  }
  if (state.status === "not-migrated") return <AdsStatsNotReady />;
  if (!person) {
    return (
      <ReadOnlyNote>
        {scope.isAdsStaff
          ? "Tài khoản của bạn chưa được gắn với một Nhân viên Ads nên chưa nhập được số liệu. Nhờ Trưởng Marketing hoặc Quản trị gắn tài khoản ở trang Nhân viên Ads."
          : "Chưa có nhân viên Ads nào. Hãy thêm ở trang Nhân viên Ads, rồi giao TKQC ở trang TKQC & Page."}
      </ReadOnlyNote>
    );
  }

  const future = Boolean(today) && day > today;
  // Các TKQC người này phụ trách vào ngày đang chọn.
  const accounts = catalogs.adAccounts.filter((account) =>
    catalogs.assignments.some(
      (x) => x.ad_account_id === account.id && x.ads_staff_id === person.id && coversDay(x, day),
    ),
  );

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="entry-day">Ngày</Label>
          <Input
            id="entry-day"
            type="date"
            className="w-40"
            value={day}
            max={today || undefined}
            onChange={(event) => setPickedDay(event.target.value || null)}
          />
        </div>
        <div className="flex gap-1.5">
          <Button
            variant={day === addDays(today, -1) ? "secondary" : "outline"}
            onClick={() => setPickedDay(addDays(today, -1))}
            disabled={!today}
          >
            Hôm qua
          </Button>
          <Button variant={day === today ? "secondary" : "outline"} onClick={() => setPickedDay(null)}>
            Hôm nay
          </Button>
        </div>
        {scope.managesMarketing && (
          <div className="grid gap-1.5">
            <Label htmlFor="entry-staff">Nhân viên Ads</Label>
            <Select value={person.id} onValueChange={setPickedStaff}>
              <SelectTrigger id="entry-staff" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name}
                    {!p.is_active && " (đã nghỉ)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {future ? (
        <ReadOnlyNote>Ngày {formatDate(day)} chưa tới — chỉ nhập được số liệu đến hết hôm nay.</ReadOnlyNote>
      ) : state.status === "error" ? (
        <StatsError message={state.message} />
      ) : state.status === "ready" ? (
        <>
          <EntryForm
            key={`${day}:${person.id}`}
            day={day}
            person={person}
            accounts={accounts}
            stats={state.stats}
            onSaved={reload}
          />
          <MonthOfPerson
            month={month}
            days={days}
            person={person}
            stats={state.stats}
            ownerOf={ownerOf}
            accounts={catalogs.adAccounts.filter((account) =>
              catalogs.assignments.some(
                (x) =>
                  x.ad_account_id === account.id &&
                  x.ads_staff_id === person.id &&
                  days.some((d) => coversDay(x, d)),
              ),
            )}
            selectedDay={day}
            onSelectDay={setPickedDay}
          />
        </>
      ) : (
        <Skeleton className="h-72 w-full rounded-xl" />
      )}
    </>
  );
}

/** Bảng cả tháng của một người, bấm vào ngày để xem / sửa ngày đó. */
export function MonthOfPerson({
  month,
  days,
  person,
  stats,
  ownerOf,
  accounts,
  selectedDay,
  onSelectDay,
}: {
  month: string;
  days: string[];
  person: AdsStaff;
  stats: AdsStats;
  ownerOf: ReturnType<typeof ownerLookup>;
  accounts: AdAccount[];
  selectedDay: string;
  onSelectDay: (day: string) => void;
}) {
  const summary = useMemo(() => summarize(stats, days, ownerOf, person.id), [stats, days, ownerOf, person.id]);
  const missing = summary.days.filter((row) => !row.entered).length;
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">
          {monthLabel(month)} của {person.full_name}
        </h2>
        <p className="text-sm text-muted-foreground">
          Bấm vào một ngày để xem / sửa số ngày đó.
          {missing > 0 && ` Còn ${missing} ngày chưa nhập.`}
        </p>
      </div>
      <DailyStatsTable
        summary={summary}
        accounts={accounts}
        totalLabel={`Tổng ${monthLabel(month).toLowerCase()}`}
        selectedDay={selectedDay}
        onSelectDay={onSelectDay}
        markMissing
      />
    </section>
  );
}

/** Giữ lại chữ số, bỏ số 0 thừa ở đầu: "1.500.000 ₫" → "1500000". */
const digits = (text: string, max: number) => text.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, max);
const toNumber = (text: string) => (text === "" ? 0 : Number(text));
const show = (value: number | undefined) => (value === undefined ? "" : String(value));

const RESULT_FIELDS = [
  { name: "messages", label: "Tổng mess", column: "messages" },
  { name: "data", label: "Data (số điện thoại)", column: "data_count" },
  { name: "sales", label: "Doanh số", column: "sales", money: true },
  { name: "revenue", label: "Doanh thu", column: "revenue", money: true },
] as const;

const QUALITY_FIELDS = [
  { name: "potential", label: "KHTN (tiềm năng)", column: "q_potential" },
  { name: "booked", label: "Đặt lịch hẹn", column: "q_booked" },
  { name: "wrongArea", label: "Lạc tỉnh", column: "q_wrong_area" },
  { name: "noResponse", label: "Không tương tác", column: "q_no_response" },
] as const;

type FieldName = (typeof RESULT_FIELDS)[number]["name"] | (typeof QUALITY_FIELDS)[number]["name"];

/** Ô nhập số: tự thêm dấu chấm ngăn hàng nghìn, chỉ nhận chữ số. */
function NumberField({
  id,
  label,
  value,
  onChange,
  money = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  money?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder="0"
          className={money ? "pr-6 text-right tabular-nums" : "text-right tabular-nums"}
          value={value === "" ? "" : Number(value).toLocaleString("vi-VN")}
          onChange={(event) => onChange(digits(event.target.value, money ? 13 : 7))}
        />
        {money && (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
            đ
          </span>
        )}
      </div>
    </div>
  );
}

function Computed({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

export function EntryForm({
  day,
  person,
  accounts,
  stats,
  onSaved,
}: {
  day: string;
  person: AdsStaff;
  accounts: AdAccount[];
  stats: AdsStats;
  onSaved: () => Promise<void>;
}) {
  const existing: DailyResult | undefined = stats.results.find(
    (row) => row.stat_date === day && row.ads_staff_id === person.id,
  );
  const [spend, setSpend] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      accounts.map((account) => [
        account.id,
        show(stats.spend.find((row) => row.stat_date === day && row.ad_account_id === account.id)?.spend),
      ]),
    ),
  );
  const [values, setValues] = useState<Record<FieldName, string>>(() => ({
    messages: show(existing?.messages),
    data: show(existing?.data_count),
    sales: show(existing?.sales),
    revenue: show(existing?.revenue),
    potential: show(existing?.q_potential),
    booked: show(existing?.q_booked),
    wrongArea: show(existing?.q_wrong_area),
    noResponse: show(existing?.q_no_response),
  }));
  // Đã có số của ngày này chưa (kết quả, hoặc chi tiêu của một TKQC người này phụ trách).
  const entered =
    Boolean(existing) ||
    accounts.some((account) =>
      stats.spend.some((row) => row.stat_date === day && row.ad_account_id === account.id),
    );
  const [note, setNote] = useState(existing?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const setValue = (name: FieldName) => (value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setDirty(true);
  };

  const totals = {
    ...emptyTotals(),
    spend: accounts.reduce((sum, account) => sum + toNumber(spend[account.id] ?? ""), 0),
    messages: toNumber(values.messages),
    data: toNumber(values.data),
    sales: toNumber(values.sales),
    revenue: toNumber(values.revenue),
  };
  const metrics = metricsOf(totals);
  const quality = QUALITY_FIELDS.reduce((sum, field) => sum + toNumber(values[field.name]), 0);

  const warnings = [
    totals.data > totals.messages && `Số data (${totals.data}) đang lớn hơn tổng mess (${totals.messages}).`,
    quality > totals.data && `Tổng 4 ô chất lượng data (${quality}) đang lớn hơn số data (${totals.data}).`,
    totals.revenue > totals.sales && "Doanh thu đang lớn hơn doanh số.",
  ].filter(Boolean);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await saveAdsDaily({
        date: day,
        adsStaffId: person.id,
        spend: accounts.map((account) => ({ ad_account_id: account.id, spend: toNumber(spend[account.id] ?? "") })),
        messages: totals.messages,
        data: totals.data,
        sales: totals.sales,
        revenue: totals.revenue,
        potential: toNumber(values.potential),
        booked: toNumber(values.booked),
        wrongArea: toNumber(values.wrongArea),
        noResponse: toNumber(values.noResponse),
        note: note.trim() || null,
      });
      await onSaved();
      setDirty(false);
      toast.success(`Đã lưu số liệu ngày ${formatDate(day)} của ${person.full_name}`, {
        description: "Báo cáo hiệu suất đã được cập nhật.",
      });
    } catch (error) {
      toast.error("Không lưu được số liệu", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5 rounded-xl border bg-card p-4" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">
          Số liệu ngày {formatDate(day)} — {person.full_name}
        </h2>
        {entered ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            <CircleCheck className="size-3.5" />
            Đã nhập — lưu lại sẽ sửa số
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            Chưa nhập
          </span>
        )}
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-medium text-muted-foreground">Chi tiêu ads theo TKQC</legend>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ngày này {person.full_name} không phụ trách TKQC nào nên không có ô chi tiêu. Giao TKQC ở trang{" "}
            <Link href="/marketing/tkqc-page" className="underline underline-offset-2">
              TKQC &amp; Page
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {accounts.map((account) => (
              <NumberField
                key={account.id}
                id={`spend-${account.id}`}
                label={account.name}
                money
                value={spend[account.id] ?? ""}
                onChange={(value) => {
                  setSpend((prev) => ({ ...prev, [account.id]: value }));
                  setDirty(true);
                }}
              />
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-medium text-muted-foreground">Kết quả trong ngày</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {RESULT_FIELDS.map((field) => (
            <NumberField
              key={field.name}
              id={`result-${field.name}`}
              label={field.label}
              money={"money" in field}
              value={values[field.name]}
              onChange={setValue(field.name)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-medium text-muted-foreground">Chất lượng data</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUALITY_FIELDS.map((field) => (
            <NumberField
              key={field.name}
              id={`quality-${field.name}`}
              label={field.label}
              value={values[field.name]}
              onChange={setValue(field.name)}
            />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="entry-note">Ghi chú</Label>
        <Input
          id="entry-note"
          maxLength={500}
          placeholder="Không bắt buộc — vd: TKQC bị khoá buổi chiều"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setDirty(true);
          }}
        />
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium text-muted-foreground">Hệ thống tự tính</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Computed label="Chi tiêu ads" value={formatMoney(totals.spend)} />
          <Computed label="Giá mess" value={formatMoney(metrics.costPerMessage)} />
          <Computed label="Giá data" value={formatMoney(metrics.costPerData)} />
          <Computed label="Tỉ lệ xin số" value={formatPercent(metrics.dataRate)} />
          <Computed label="Ads / Doanh số" value={formatPercent(metrics.adsOverSales)} />
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="grid gap-0.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {warnings.map((text) => (
            <li key={String(text)}>Kiểm tra lại: {text}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          <Save />
          {saving ? "Đang lưu…" : entered ? "Lưu thay đổi" : "Lưu số liệu"}
        </Button>
        {dirty && !saving && <span className="text-sm text-muted-foreground">Có thay đổi chưa lưu.</span>}
      </div>
    </form>
  );
}
