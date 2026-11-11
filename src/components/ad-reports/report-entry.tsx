"use client";

import { ArrowRight, ClipboardPenLine, Send } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { coversDay, useAdsScope } from "@/components/catalog/ads-scope";
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
import { formatClock, formatDay } from "@/lib/ad-reports/dates";
import { submitReports } from "@/lib/ad-reports/repo";
import { EMPTY_VALUES, type AdDailyReport, type ReportField, type ReportValues } from "@/lib/ad-reports/types";
import type { AdAccount, AdsStaff } from "@/lib/catalog/types";
import { SingleDayFilter } from "./date-filters";
import { useAdReports } from "./hooks";
import { ReportFields, allFilled, fieldKey, toNumbers, type FieldItem } from "./report-fields";
import { NotReady, ManagerLinks, StatsError } from "./shared";

/**
 * Marketing → Nhập liệu: mỗi ngày, nhân viên Ads gửi chi tiêu, số lượng tin nhắn, data xin được của
 * từng TK ADS mình phụ trách. Mỗi (ngày, TK ADS) gửi một lần; muốn sửa thì vào Tổng quan (trong 24 giờ).
 */
export function ReportEntry() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={ClipboardPenLine}
        title="Nhập liệu"
        description="Báo cáo chi tiêu, số lượng tin nhắn và data xin được của từng TK ADS mỗi ngày."
      />
      <CatalogGate>
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <EntryBody />
        </Suspense>
      </CatalogGate>
    </div>
  );
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Ngày nằm trong địa chỉ trang (?ngay=yyyy-mm-dd), vd khi bấm "Nhập" từ Tổng quan. */
function useDayParam() {
  const value = useSearchParams().get("ngay");
  return value && ISO_DAY.test(value) ? value : null;
}

function EntryBody() {
  const { catalogs } = useCatalogs();
  const staff = useCurrentStaff();
  const scope = useAdsScope();
  const today = useTodayVn();
  const params = useSearchParams();
  const dayParam = useDayParam();
  const [picked, setPicked] = useState<string | null>(dayParam);
  const [pickedStaff, setPickedStaff] = useState<string | null>(params.get("nv"));

  // Không cho ngày chưa tới, kể cả khi gõ thẳng vào địa chỉ trang.
  const day = picked && today && picked <= today ? picked : today;
  const { state, reload } = useAdReports(day, day);

  // Nhân viên Ads chỉ đọc được dòng ads_staff của chính mình.
  const me =
    scope.isAdsStaff && staff.status === "ok"
      ? catalogs.adsStaff.find((a) => a.user_id === staff.userId)
      : undefined;
  const accountsOf = (person: AdsStaff) =>
    catalogs.adAccounts.filter((account) =>
      catalogs.assignments.some(
        (x) => x.ad_account_id === account.id && x.ads_staff_id === person.id && coversDay(x, day),
      ),
    );
  // Quản trị / Trưởng Marketing không phụ trách TK ADS nào → chọn nhân viên để nhập thay.
  const people = scope.managesMarketing ? catalogs.adsStaff : me ? [me] : [];
  const person = scope.managesMarketing
    ? (people.find((p) => p.id === pickedStaff) ??
      people.find((p) => p.is_active && accountsOf(p).length > 0) ??
      people[0])
    : me;

  if (!catalogs.marketingReady) return <MarketingNotReady what="Màn Nhập liệu" />;
  if (staff.status === "loading") return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!scope.managesMarketing && !scope.isAdsStaff) {
    return (
      <ReadOnlyNote>
        Màn này dành cho Nhân viên Ads (gửi báo cáo TK ADS mình phụ trách), Trưởng Marketing và Quản trị.
      </ReadOnlyNote>
    );
  }
  if (state.status === "not-migrated") return <NotReady />;

  const accounts = person ? accountsOf(person) : [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SingleDayFilter value={day} today={today} onChange={setPicked} />
        {scope.managesMarketing && people.length > 0 && person && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Nhập thay cho
            <Select value={person.id} onValueChange={setPickedStaff}>
              <SelectTrigger className="w-48" aria-label="Nhân viên Ads">
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
          </label>
        )}
      </div>

      {!person ? (
        <ReadOnlyNote>
          {scope.isAdsStaff
            ? "Tài khoản của bạn chưa được gắn với một Nhân viên Ads nên chưa gửi được báo cáo. Nhờ Trưởng Marketing hoặc Quản trị gắn tài khoản ở trang Nhân viên Ads."
            : "Chưa có nhân viên Ads nào."}
        </ReadOnlyNote>
      ) : accounts.length === 0 ? (
        <ReadOnlyNote>
          Ngày {formatDay(day)} {scope.managesMarketing ? person.full_name : "bạn"} không phụ trách TK ADS nào nên không
          có gì để báo cáo.
        </ReadOnlyNote>
      ) : state.status === "error" ? (
        <StatsError message={state.message} />
      ) : state.status === "ready" ? (
        <EntryForm
          key={`${day}:${person.id}`}
          day={day}
          today={today}
          accounts={accounts}
          reports={state.reports}
          overviewHref={`/marketing/tong-quan?ngay=${day}${scope.managesMarketing ? `&nv=${person.id}` : ""}`}
          onSubmitted={reload}
        />
      ) : (
        <Skeleton className="h-40 w-full rounded-xl" />
      )}

      {scope.managesMarketing && <ManagerLinks />}
    </>
  );
}

function EntryForm({
  day,
  today,
  accounts,
  reports,
  overviewHref,
  onSubmitted,
}: {
  day: string;
  today: string;
  accounts: AdAccount[];
  reports: AdDailyReport[];
  overviewHref: string;
  onSubmitted: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, ReportValues>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const sentOf = (accountId: string) =>
    reports.find((r) => r.report_date === day && r.ad_account_id === accountId);
  const items: FieldItem[] = accounts.map((account, i) => {
    const sent = sentOf(account.id);
    return {
      account,
      index: i + 1,
      shown: sent,
      note: sent ? `Đã gửi lúc ${formatClock(sent.submitted_at, today)}` : undefined,
    };
  });
  const pending = items.filter((item) => !item.shown);
  const sent = items.map((item) => sentOf(item.account.id)).filter((r): r is AdDailyReport => Boolean(r));
  const ready = allFilled(items, values);
  const firstSent = sent.map((r) => r.submitted_at).sort()[0];

  const setValue = (accountId: string, field: ReportField, digits: string) =>
    setValues((prev) => ({ ...prev, [accountId]: { ...(prev[accountId] ?? EMPTY_VALUES), [field]: digits } }));
  const touch = (accountId: string, field: ReportField) =>
    setTouched((prev) => (prev.has(fieldKey(accountId, field)) ? prev : new Set(prev).add(fieldKey(accountId, field))));

  async function submit() {
    setSaving(true);
    try {
      await submitReports(
        pending.map((item) => ({
          report_date: day,
          ad_account_id: item.account.id,
          ...toNumbers(values[item.account.id] ?? EMPTY_VALUES),
        })),
      );
      toast.success(`Đã gửi báo cáo ngày ${formatDay(day)}`);
      await onSubmitted();
    } catch (error) {
      toast.error("Không gửi được báo cáo", { description: error instanceof Error ? error.message : String(error) });
      await onSubmitted(); // có thể đã có người gửi trước → hiện số đã gửi
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-4">
      {pending.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-50">
          <p>
            Báo cáo ngày <b>{formatDay(day)}</b> đã gửi lúc <b>{firstSent ? formatClock(firstSent, today) : "…"}</b>.
            Muốn sửa, vào Tổng quan.
          </p>
          <Button asChild variant="outline" className="bg-background">
            <Link href={overviewHref}>
              Đi tới Tổng quan
              <ArrowRight />
            </Link>
          </Button>
        </div>
      ) : (
        sent.length > 0 && (
          <ReadOnlyNote>
            Đã gửi {sent.length}/{items.length} TK ADS của ngày {formatDay(day)}. Điền nốt các TK ADS còn lại rồi bấm Gửi
            báo cáo.
          </ReadOnlyNote>
        )
      )}

      <ReportFields
        items={items}
        values={values}
        touched={touched}
        onChange={setValue}
        onTouch={touch}
        layout="table"
        dayLabel={formatDay(day)}
      />

      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" disabled={!ready || saving} onClick={submit}>
            <Send />
            {saving ? "Đang gửi…" : "Gửi báo cáo"}
          </Button>
          {!ready && (
            <span className="text-sm text-muted-foreground">
              Điền đủ tất cả các ô (không có thì nhập 0) để gửi.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
