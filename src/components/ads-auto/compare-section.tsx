"use client";

import { vi } from "date-fns/locale";
import { CalendarDays, DownloadCloud, Loader2, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { useCatalogNames } from "@/components/catalog-provider";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, dateToIso, formatDay, isoToDate } from "@/lib/ad-reports/dates";
import { formatNumber } from "@/lib/ad-reports/number";
import {
  METRIC_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
  compareRow,
  defaultRange,
  needsLook,
  summarize,
  type AutoStatus,
  type CompareRow,
  type ComparedRow,
  type MatchStatus,
  type MessageMetric,
  type Verdict,
} from "@/lib/ads-auto/compare";
import { fetchCompare, pullAuto } from "@/lib/ads-auto/repo";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<MatchStatus, { dot: string; chip: string }> = {
  match: { dot: "bg-emerald-500", chip: "text-emerald-800 dark:text-emerald-200" },
  near: { dot: "bg-amber-400", chip: "text-amber-800 dark:text-amber-200" },
  off: { dot: "bg-red-500", chip: "text-red-800 dark:text-red-200" },
  no_manual: { dot: "bg-violet-500", chip: "text-violet-800 dark:text-violet-200" },
  no_auto: { dot: "bg-sky-500", chip: "text-sky-800 dark:text-sky-200" },
  idle: { dot: "bg-slate-300 dark:bg-slate-600", chip: "text-muted-foreground" },
  other_currency: { dot: "bg-slate-400", chip: "text-muted-foreground" },
  not_facebook: { dot: "bg-slate-400", chip: "text-muted-foreground" },
};
const VERDICT_TEXT: Record<Verdict, string> = {
  match: "text-muted-foreground",
  near: "text-amber-700 dark:text-amber-300",
  off: "font-semibold text-red-700 dark:text-red-300",
};

const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dayLabel = (iso: string) => `${WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()]}, ${formatDay(iso)}`;
const money = (v: number | null, currency: string | null = null) =>
  v === null ? "—" : currency && currency.toUpperCase() !== "VND" ? `${v.toLocaleString("vi-VN")} ${currency}` : formatNumber(v);
const signed = (v: number | null, fmt: (n: number) => string = formatNumber) =>
  v === null ? "" : v === 0 ? "0" : `${v > 0 ? "+" : "−"}${fmt(Math.abs(v))}`;

type Filter = "all" | "look" | MatchStatus;
const MAX_DAYS = 93;

/**
 * Đối chiếu hằng ngày: mỗi (ngày, TKQC) so số nhân viên nhập tay ở Nhập liệu với số Facebook tự kéo về.
 * `version` đổi = vừa có số Facebook mới → tải lại.
 */
export function CompareSection({
  status,
  today,
  version,
  onPulled,
}: {
  status: AutoStatus;
  today: string;
  version: number;
  onPulled: () => void;
}) {
  const names = useCatalogNames();
  const [range, setRange] = useState(() => defaultRange(today, 7));
  const [metric, setMetric] = useState<MessageMetric>("conversations");
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      fetchCompare(range.from, range.to)
        .then((data) => alive && (setRows(data), setError(null)))
        .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [range.from, range.to, version]);

  const accounts = useMemo(() => new Map(status.accounts.map((a) => [a.ad_account_id, a])), [status.accounts]);
  const compared = useMemo(
    () => (rows ?? []).map((r) => compareRow(r, metric, accounts.get(r.ad_account_id)?.is_facebook ?? true)),
    [rows, metric, accounts],
  );
  const summary = useMemo(() => summarize(compared), [compared]);
  const shown = compared.filter((r) =>
    filter === "all" ? r.status !== "idle" : filter === "look" ? needsLook(r.status) : r.status === filter,
  );
  const accountName = (id: string) => accounts.get(id)?.name ?? names.adAccount(id) ?? "TKQC đã xoá";
  // Nhóm theo ngày (ngày mới nhất trước, như thứ tự cơ sở dữ liệu trả về), trong ngày xếp theo tên TKQC.
  const groups = new Map<string, ComparedRow[]>();
  for (const r of shown) groups.set(r.report_date, [...(groups.get(r.report_date) ?? []), r]);
  const byDay = [...groups.entries()].map(
    ([day, list]) => [day, list.sort((a, b) => accountName(a.ad_account_id).localeCompare(accountName(b.ad_account_id), "vi"))] as const,
  );

  async function pull() {
    setPulling(true);
    try {
      const until = range.to > today ? today : range.to;
      const result = await pullAuto(range.from, until);
      toast.success(`Đang kéo lại số ${formatDay(range.from)} → ${formatDay(until)} của ${result.accounts} TKQC…`);
      onPulled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(false);
    }
  }

  const spendGap = summary.fbSpend - summary.manualSpend;
  const msgGap = summary.fbMessages - summary.manualMessages;

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <Scale className="size-4 text-muted-foreground" />
            Đối chiếu hằng ngày
          </h2>
          <p className="text-sm text-muted-foreground">
            Số nhân viên nhập ở Nhập liệu so với số Facebook, theo từng ngày và từng TKQC. Chỉ xem, không sửa số nhân viên.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={!status.has_token || pulling || status.pending > 0} onClick={() => void pull()}>
          {pulling || status.pending > 0 ? <Loader2 className="animate-spin" /> : <DownloadCloud />}
          Kéo lại số khoảng này
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <RangePicker today={today} value={range} onChange={setRange} />
        <Select value={metric} onValueChange={(v) => setMetric(v as MessageMetric)}>
          <SelectTrigger className="w-auto max-w-full" aria-label="So số tin nhắn với">
            <span className="text-muted-foreground">Tin nhắn FB:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(METRIC_LABELS) as MessageMetric[]).map((m) => (
              <SelectItem key={m} value={m}>
                {METRIC_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : rows === null ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo kết quả">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="Tất cả" count={compared.length - summary.counts.idle} />
            <FilterChip
              active={filter === "look"}
              onClick={() => setFilter("look")}
              label="Cần xem lại"
              count={summary.counts.off + summary.counts.near + summary.counts.no_manual + summary.counts.no_auto}
            />
            {STATUS_ORDER.filter((s) => summary.counts[s] > 0).map((s) => (
              <FilterChip
                key={s}
                active={filter === s}
                onClick={() => setFilter(s)}
                label={STATUS_LABELS[s]}
                count={summary.counts[s]}
                dot={STATUS_STYLE[s].dot}
              />
            ))}
          </div>

          {summary.compared > 0 && (
            <dl className="grid gap-2 sm:grid-cols-2">
              <Totals label="Chi tiêu" unit="đ" manual={summary.manualSpend} fb={summary.fbSpend} gap={spendGap} />
              <Totals label="Tin nhắn" manual={summary.manualMessages} fb={summary.fbMessages} gap={msgGap} />
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Tổng trên {summary.compared} dòng có cả số nhân viên và số Facebook (tính bằng đồng).
              </p>
            </dl>
          )}

          {byDay.length === 0 ? (
            <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">
              {compared.length === 0
                ? status.has_token
                  ? "Chưa có số nào trong khoảng ngày này."
                  : "Chưa có số Facebook: dán token ở phần Kết nối Facebook. Số nhân viên nhập tay sẽ hiện ở đây khi có."
                : "Không có dòng nào khớp bộ lọc."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th rowSpan={2} className="px-3 py-2 text-left font-medium">TKQC</th>
                    <th rowSpan={2} className="px-3 py-2 text-left font-medium">NV Ads</th>
                    <th colSpan={3} className="border-l px-3 pt-2 pb-0.5 text-center font-medium">Chi tiêu (đ)</th>
                    <th colSpan={3} className="border-l px-3 pt-2 pb-0.5 text-center font-medium">Tin nhắn</th>
                    <th rowSpan={2} className="border-l px-3 py-2 text-left font-medium">Kết quả</th>
                  </tr>
                  <tr>
                    <th className="border-l px-3 pb-2 text-right font-normal">NV nhập</th>
                    <th className="px-3 pb-2 text-right font-normal">Facebook</th>
                    <th className="px-3 pb-2 text-right font-normal">Lệch</th>
                    <th className="border-l px-3 pb-2 text-right font-normal">NV nhập</th>
                    <th className="px-3 pb-2 text-right font-normal">Facebook</th>
                    <th className="px-3 pb-2 text-right font-normal">Lệch</th>
                  </tr>
                </thead>
                {byDay.map(([day, list]) => (
                  <tbody key={day} className="border-t">
                    <tr>
                      <th colSpan={9} className="bg-muted/25 px-3 py-1.5 text-left text-xs font-semibold tabular-nums">
                        {dayLabel(day)}
                      </th>
                    </tr>
                    {list.map((r) => (
                      <tr key={r.ad_account_id} className="border-t border-border/60 tabular-nums">
                        <td className="max-w-48 truncate px-3 py-2 font-medium">{accountName(r.ad_account_id)}</td>
                        <td className="max-w-36 truncate px-3 py-2 text-muted-foreground">{names.adsStaff(r.ads_staff_id) ?? "—"}</td>
                        <td className="border-l px-3 py-2 text-right">{money(r.manual_spend)}</td>
                        <td className="px-3 py-2 text-right">{money(r.auto_spend, r.auto_currency)}</td>
                        <td className={cn("px-3 py-2 text-right", r.spend_verdict && VERDICT_TEXT[r.spend_verdict])}>{signed(r.spend_diff)}</td>
                        <td className="border-l px-3 py-2 text-right">{r.manual_messages ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{r.fb_messages ?? "—"}</td>
                        <td className={cn("px-3 py-2 text-right", r.messages_verdict && VERDICT_TEXT[r.messages_verdict])}>
                          {signed(r.messages_diff, String)}
                        </td>
                        <td className="border-l px-3 py-2">
                          <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", STATUS_STYLE[r.status].chip)}>
                            <span className={cn("size-2 rounded-full", STATUS_STYLE[r.status].dot)} aria-hidden />
                            {STATUS_LABELS[r.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Khớp: chi tiêu lệch ≤ 1.000đ hoặc ≤ 0,5% và tin nhắn bằng nhau. Lệch nhẹ: chi tiêu lệch ≤ 3%, tin nhắn lệch 1 hoặc
            ≤ 5% (thường do Facebook cập nhật số sau khi nhân viên đã nhập). “Lệch” = Facebook trừ số nhân viên. Ẩn các ngày
            TKQC không chạy (0đ, nhân viên không nhập).
          </p>
        </>
      )}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dot?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
        active ? "border-foreground/30 bg-foreground text-background" : "bg-background hover:bg-muted",
      )}
    >
      {dot && <span className={cn("size-2 rounded-full", dot)} aria-hidden />}
      {label}
      <span className={cn("tabular-nums", active ? "text-background/70" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}

function Totals({ label, unit = "", manual, fb, gap }: { label: string; unit?: string; manual: number; fb: number; gap: number }) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg border px-3 py-2">
      <div>
        <dt className="text-xs text-muted-foreground">{label} · NV nhập</dt>
        <dd className="font-semibold tabular-nums">
          {formatNumber(manual)}
          {unit}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Facebook</dt>
        <dd className="font-semibold tabular-nums">
          {formatNumber(fb)}
          {unit}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Lệch</dt>
        <dd className={cn("font-semibold tabular-nums", gap !== 0 && "text-amber-700 dark:text-amber-300")}>
          {signed(gap)}
          {gap !== 0 && unit}
        </dd>
      </div>
    </div>
  );
}

/** Chọn khoảng ngày: nút nhanh + lịch tuỳ chỉnh (tối đa 93 ngày). */
function RangePicker({
  today,
  value,
  onChange,
}: {
  today: string;
  value: { from: string; to: string };
  onChange: (next: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthEnd = addDays(monthStart, -1);
  const presets = [
    { label: "7 ngày", ...defaultRange(today, 7) },
    { label: "30 ngày", ...defaultRange(today, 30) },
    { label: "Tháng này", from: monthStart, to: today },
    { label: "Tháng trước", from: `${prevMonthEnd.slice(0, 7)}-01`, to: prevMonthEnd },
  ];
  const isPreset = presets.some((p) => p.from === value.from && p.to === value.to);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <Button
          key={p.label}
          size="sm"
          variant={p.from === value.from && p.to === value.to ? "default" : "outline"}
          onClick={() => onChange({ from: p.from, to: p.to })}
        >
          {p.label}
        </Button>
      ))}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setDraft({ from: isoToDate(value.from), to: isoToDate(value.to) });
        }}
      >
        <PopoverTrigger asChild>
          <Button size="sm" variant={isPreset ? "outline" : "default"}>
            <CalendarDays />
            {isPreset ? "Tuỳ chỉnh" : `${formatDay(value.from)} → ${formatDay(value.to)}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <Calendar
            mode="range"
            locale={vi}
            defaultMonth={isoToDate(value.from)}
            selected={draft}
            disabled={{ after: isoToDate(today) }}
            onSelect={(next) => {
              setDraft(next);
              if (next?.from && next.to && next.from.getTime() !== next.to.getTime()) {
                const from = dateToIso(next.from);
                let to = dateToIso(next.to);
                if (addDays(from, MAX_DAYS - 1) < to) {
                  to = addDays(from, MAX_DAYS - 1);
                  toast.info("Mỗi lần xem tối đa 93 ngày");
                }
                onChange({ from, to });
                setOpen(false);
              }
            }}
          />
        </PopoverContent>
      </Popover>
      <span className="text-sm text-muted-foreground tabular-nums">
        {formatDay(value.from)} → {formatDay(value.to)}
      </span>
    </div>
  );
}
