"use client";

import { AlertTriangle, CheckCircle2, CircleAlert, Copy, Split, Target } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  monthsBetween,
  shiftMonth,
  splitTotal,
  type Alert,
  type CarryMode,
  type Status,
  type TargetItem,
  type TargetValues,
} from "@/lib/ad-reports/aggregate";
import {
  carryModeFor,
  fetchTargetHistory,
  fetchTargets,
  saveTarget,
  type AdTarget,
  type TargetHistoryEntry,
} from "@/lib/ad-reports/targets";
import type { AdAccountAssignment, AdsStaff } from "@/lib/catalog/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { NumberInput } from "./number-input";

/** Mục tiêu quảng cáo: tải, đặt (quản lý), thanh tiến độ và cảnh báo. */

export type TargetsState =
  | { status: "loading" }
  /** `carryReady`: đã chạy file 017 (lưu được cách dồn tuần không đạt). */
  | { status: "ready"; targets: AdTarget[]; carryReady: boolean }
  /** Chưa chạy supabase/012_ad_targets.sql. */
  | { status: "not-migrated" }
  | { status: "error"; message: string };

export function useAdTargets() {
  const [state, setState] = useState<TargetsState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    // Chỉ đặt state khi máy chủ đã trả lời (không đồng bộ trong effect).
    fetchTargets()
      .then((data) => {
        if (!cancelled) {
          setState(data ? { status: "ready", targets: data.targets, carryReady: data.carryReady } : { status: "not-migrated" });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [version]);
  const reload = useCallback(async () => setVersion((v) => v + 1), []);
  return { state, reload };
}

const money = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
const plain = (n: number) => Math.round(n).toLocaleString("vi-VN");

const TONE: Record<Status, { bar: string; text: string; icon: typeof CheckCircle2 }> = {
  ok: { bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", icon: CheckCircle2 },
  warning: { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", icon: AlertTriangle },
  critical: { bar: "bg-red-500", text: "text-red-700 dark:text-red-400", icon: CircleAlert },
};

/** Thanh tiến độ / so mức tối đa của từng mục tiêu. `elapsed`: phần tháng đã qua (vạch "đúng nhịp"). */
export function TargetPanel({
  title,
  items,
  elapsed,
  action,
}: {
  title: string;
  items: TargetItem[];
  elapsed: number;
  action?: React.ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Target className="size-4 text-muted-foreground" />
          {title}
        </h2>
        {action}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const tone = TONE[item.status];
          const Icon = tone.icon;
          const isMoney = item.key !== "data";
          const fmt = isMoney ? money : plain;
          const share = item.actual === null ? 0 : item.actual / item.goal;
          return (
            <div key={item.key} className="grid content-start gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {item.kind === "cap" ? "tối đa " : "mục tiêu "}
                  {fmt(item.goal)}
                </span>
              </div>
              <div className="text-lg font-semibold tabular-nums">{item.actual === null ? "–" : fmt(item.actual)}</div>
              <div className="relative h-2 rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", tone.bar)}
                  style={{ width: `${Math.min(100, Math.max(share * 100, item.actual ? 2 : 0))}%` }}
                />
                {item.kind === "progress" && elapsed > 0 && elapsed < 1 && (
                  <span
                    className="absolute -top-1 h-4 w-0.5 rounded bg-foreground/60"
                    style={{ left: `${elapsed * 100}%` }}
                    title="Mức đúng nhịp tới hôm nay"
                  />
                )}
              </div>
              <span className={cn("flex items-start gap-1 text-xs font-medium", tone.text)}>
                <Icon className="mt-px size-3.5 shrink-0" />
                {item.note}
              </span>
            </div>
          );
        })}
      </div>
      {items.some((i) => i.kind === "progress") && (
        <p className="text-xs text-muted-foreground">Vạch đứng trên thanh: mức đúng nhịp tới hôm nay.</p>
      )}
    </section>
  );
}

/** Danh sách cảnh báo (đỏ = nghiêm trọng, vàng = cần để ý). Không có gì thì không hiện. */
export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;
  const critical = alerts.some((a) => a.level === "critical");
  return (
    <section
      className={cn(
        "grid gap-1.5 rounded-xl border px-4 py-3",
        critical
          ? "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30"
          : "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30",
      )}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="size-4" />
        Cảnh báo ({alerts.length})
      </h2>
      <ul className="grid gap-1 text-sm">
        {alerts.map((a, i) => {
          const Icon = a.level === "critical" ? CircleAlert : AlertTriangle;
          return (
            <li key={i} className="flex items-start gap-2">
              <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[a.level].text)} />
              <span>{a.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Hộp đặt mục tiêu (Quản trị / Trưởng Marketing)                                                    */
/* ------------------------------------------------------------------------------------------------ */

type Draft = Record<keyof TargetValues, string>;
const FIELDS: { key: keyof TargetValues; label: string; suffix?: string; digits: number; total?: boolean }[] = [
  { key: "monthly_budget", label: "Ngân sách / tháng", suffix: "đ", digits: 13, total: true },
  { key: "monthly_data", label: "Số điện thoại (data) / tháng", digits: 7, total: true },
  { key: "max_cost_per_data", label: "Giá số tối đa", suffix: "đ", digits: 9 },
  { key: "max_cost_per_message", label: "Giá mess tối đa", suffix: "đ", digits: 9 },
  { key: "monthly_revenue", label: "Doanh số / tháng", suffix: "đ", digits: 13, total: true },
  { key: "max_ad_revenue_pct", label: "Ads / doanh số tối đa", suffix: "%", digits: 3 },
];
const FIELD_LABEL = new Map(FIELDS.map((f) => [f.key as string, f]));
const toDraft = (t: TargetValues | undefined): Draft =>
  Object.fromEntries(FIELDS.map((f) => [f.key, t?.[f.key] == null ? "" : String(t[f.key])])) as Draft;
const fromDraft = (d: Draft): TargetValues =>
  Object.fromEntries(FIELDS.map((f) => [f.key, d[f.key] === "" ? null : Number(d[f.key])])) as TargetValues;
const emptyDraft = (d: Draft) => FIELDS.every((f) => d[f.key] === "");
const monthText = (month: string) => `tháng ${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;
/** Cách dồn phần thiếu của tuần không đạt (quản lý chốt, lưu ở dòng cả nhóm). */
const CARRY_LABEL: Record<CarryMode, string> = {
  spread: "Chia đều các tuần còn lại",
  next: "Dồn sang tuần sau",
};
const CARRY_FIELD = "Tuần không đạt thì phần thiếu";
const fieldValue = (key: string, value: unknown) => {
  if (key === "week_carry") return value === "next" || value === "spread" ? CARRY_LABEL[value].toLowerCase() : "theo tháng trước";
  if (value === null || value === undefined || value === "") return "trống";
  const f = FIELD_LABEL.get(key);
  const n = Number(value);
  return `${n.toLocaleString("vi-VN")}${f?.suffix ?? ""}`;
};

export function TargetsDialog({
  open,
  onClose,
  people,
  targets,
  carryReady,
  assignments,
  today,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  people: AdsStaff[];
  targets: AdTarget[];
  /** Đã chạy file 017: chốt được cách dồn tuần không đạt. */
  carryReady: boolean;
  assignments: AdAccountAssignment[];
  today: string;
  onSaved: () => Promise<void>;
}) {
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const options = monthsBetween(shiftMonth(thisMonth, -3), shiftMonth(thisMonth, 2));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Mục tiêu quảng cáo</DialogTitle>
          <DialogDescription>
            Đặt từ đầu mỗi tháng: nhập dòng “Cả nhóm” (mục tiêu chung của công ty) rồi bấm “Tự động phân bổ” để chia xuống
            từng nhân viên, sau đó sửa lại tuỳ ý. Ô trống = không đặt. Giá tối đa / tỉ lệ ads / doanh số của nhân viên để
            trống thì dùng của cả nhóm. Chốt luôn cách dồn phần thiếu khi một tuần không đạt — cả công ty dùng chung một cách.
            Mọi lần đặt / sửa đều được ghi lại (ai, lúc nào, số cũ → số mới).
          </DialogDescription>
        </DialogHeader>
        <div role="tablist" className="flex w-fit gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ["edit", "Đặt mục tiêu"],
              ["history", "Lịch sử chỉnh sửa"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "edit" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Tháng</span>
              <div className="flex flex-wrap gap-1">
                {options.map((m) => (
                  <Button key={m} size="sm" variant={m === month ? "default" : "outline"} onClick={() => setMonth(m)}>
                    T{Number(m.slice(5))}/{m.slice(2, 4)}
                    {m === thisMonth && " (này)"}
                  </Button>
                ))}
              </div>
            </div>
            <TargetsForm
              key={month}
              month={month}
              people={people}
              targets={targets}
              carryReady={carryReady}
              assignments={assignments}
              onClose={onClose}
              onSaved={onSaved}
            />
          </>
        ) : (
          <TargetHistory people={people} targets={targets} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TargetsForm({
  month,
  people,
  targets,
  carryReady,
  assignments,
  onClose,
  onSaved,
}: {
  month: string;
  people: AdsStaff[];
  targets: AdTarget[];
  carryReady: boolean;
  assignments: AdAccountAssignment[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const idPrefix = useId();
  const exact = (staffId: string | null) =>
    targets.find((t) => t.ads_staff_id === staffId && (!t.month || t.month.slice(0, 7) === month));
  const from = `${month}-01`;
  const to = `${month}-31`;
  // Người được phân bổ: đang làm và có TKQC trong tháng này.
  const running = people.filter(
    (p) => p.is_active && assignments.some((x) => x.ads_staff_id === p.id && x.from_date <= to && (!x.to_date || x.to_date >= from)),
  );
  const rows: { key: string; staffId: string | null; name: string; existing?: AdTarget; runs: boolean }[] = [
    { key: "team", staffId: null, name: "Cả nhóm (chung)", existing: exact(null), runs: false },
    ...people
      .filter((p) => p.is_active || exact(p.id))
      .map((p) => ({ key: p.id, staffId: p.id, name: p.full_name, existing: exact(p.id), runs: running.includes(p) })),
  ];
  const initial = Object.fromEntries(rows.map((r) => [r.key, toDraft(r.existing)])) as Record<string, Draft>;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);
  const [method, setMethod] = useState<"equal" | "last-month">("equal");
  const [busy, setBusy] = useState(false);
  // Cách dồn phần thiếu của tuần không đạt: lưu ở dòng cả nhóm của tháng; null = theo tháng trước / mặc định.
  const initialCarry = exact(null)?.week_carry ?? null;
  const [carry, setCarry] = useState<CarryMode | null>(initialCarry);
  const inherited = carryModeFor(
    targets.filter((t) => !(t.ads_staff_id === null && t.month?.slice(0, 7) === month)),
    month,
  );
  const shownCarry = carry ?? inherited.mode;
  const carryChanged = carryReady && carry !== initialCarry;
  const changed = rows.filter(
    (r) =>
      (JSON.stringify(drafts[r.key]) !== JSON.stringify(initial[r.key]) && !(emptyDraft(drafts[r.key]) && !r.existing)) ||
      (r.staffId === null && carryChanged),
  );
  // Tháng này chưa đặt dòng nào → gợi ý chép từ tháng gần nhất đã đặt.
  const source = rows.every((r) => !r.existing)
    ? targets
        .filter((t) => t.month && t.month.slice(0, 7) < month)
        .map((t) => (t.month ?? "").slice(0, 7))
        .sort()
        .at(-1)
    : undefined;
  const staffRows = rows.filter((r) => r.staffId !== null);
  const eligible = staffRows.filter((r) => r.runs).length > 0 ? staffRows.filter((r) => r.runs) : staffRows;

  function copyFrom(sourceMonth: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const t = targets.find((x) => x.ads_staff_id === r.staffId && x.month?.slice(0, 7) === sourceMonth);
        if (t) next[r.key] = toDraft(t);
      }
      return next;
    });
    const sourceCarry = targets.find((x) => x.ads_staff_id === null && x.month?.slice(0, 7) === sourceMonth)?.week_carry;
    if (carryReady && sourceCarry) setCarry(sourceCarry);
    toast.info(`Đã chép mục tiêu ${monthText(sourceMonth)} — kiểm tra rồi bấm Lưu`);
  }

  async function allocate() {
    const team = drafts.team;
    if (FIELDS.filter((f) => f.total).every((f) => team[f.key] === "")) {
      toast.error("Hãy nhập dòng “Cả nhóm” trước (ngân sách, số điện thoại hoặc doanh số).");
      return;
    }
    let weights = eligible.map(() => ({ spend: 1, data: 1, revenue: 1 }));
    if (method === "last-month") {
      setBusy(true);
      const { data, error } = await getSupabaseBrowserClient().rpc("ads_leaderboard", { p_month: `${shiftMonth(month, -1)}-01` });
      setBusy(false);
      if (error) {
        toast.error("Không lấy được kết quả tháng trước", { description: error.message });
        return;
      }
      const last = new Map((data as { ads_staff_id: string; spend: number; data_count: number; revenue: number }[]).map((r) => [r.ads_staff_id, r]));
      weights = eligible.map((r) => {
        const x = last.get(r.staffId ?? "");
        return { spend: Number(x?.spend ?? 0), data: Number(x?.data_count ?? 0), revenue: Number(x?.revenue ?? x?.spend ?? 0) };
      });
    }
    const plan: [keyof TargetValues, "spend" | "data" | "revenue", number][] = [
      ["monthly_budget", "spend", 1000],
      ["monthly_data", "data", 1],
      ["monthly_revenue", "revenue", 1000],
    ];
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of eligible) next[r.key] = { ...next[r.key] };
      for (const [field, weightKey, step] of plan) {
        if (team[field] === "") continue;
        const parts = splitTotal(Number(team[field]), weights.map((w) => w[weightKey]), step);
        eligible.forEach((r, i) => {
          next[r.key][field] = String(parts[i]);
        });
      }
      // Giá tối đa / tỉ lệ: nhân viên chưa có thì lấy theo cả nhóm.
      for (const f of FIELDS.filter((x) => !x.total)) {
        if (team[f.key] === "") continue;
        for (const r of eligible) if (next[r.key][f.key] === "") next[r.key][f.key] = team[f.key];
      }
      return next;
    });
    toast.success(`Đã phân bổ cho ${eligible.length} nhân viên — sửa lại nếu cần rồi bấm Lưu`);
  }

  async function save() {
    setBusy(true);
    try {
      for (const row of changed) {
        const values = fromDraft(drafts[row.key]);
        await saveTarget(
          row.existing?.id ?? null,
          row.staffId,
          month,
          row.staffId === null && carryReady ? { ...values, week_carry: carry } : values,
        );
      }
      toast.success(`Đã lưu mục tiêu ${monthText(month)}`);
      await onSaved();
      onClose();
    } catch (error) {
      toast.error("Không lưu được", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const staffSum = (key: keyof TargetValues) => staffRows.reduce((s, r) => s + Number(drafts[r.key][key] || 0), 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
        <span className="text-sm font-medium">Tự động phân bổ từ dòng “Cả nhóm” cho {eligible.length} nhân viên đang có TKQC:</span>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={method}
          onChange={(e) => setMethod(e.target.value as "equal" | "last-month")}
          aria-label="Cách phân bổ"
        >
          <option value="equal">Chia đều</option>
          <option value="last-month">Theo kết quả tháng trước</option>
        </select>
        <Button size="sm" onClick={allocate} disabled={busy}>
          <Split />
          Tự động phân bổ
        </Button>
        {source && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => copyFrom(source)}>
            <Copy />
            Chép từ {monthText(source)}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2" role="group" aria-label={CARRY_FIELD}>
        <span className="text-sm font-medium">{CARRY_FIELD}:</span>
        {(["spread", "next"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={shownCarry === key ? "default" : "outline"}
            aria-pressed={shownCarry === key}
            disabled={!carryReady || busy}
            onClick={() => setCarry(key)}
          >
            {CARRY_LABEL[key]}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground">
          {!carryReady
            ? "Cần chạy file supabase/017_week_carry.sql trên Supabase trước — hiện đang tạm chia đều."
            : carry === null
              ? inherited.from
                ? `Tháng này chưa chốt — đang theo ${monthText(inherited.from)}.`
                : "Chưa chốt — mặc định chia đều các tuần còn lại."
              : "Cả công ty dùng chung cách này cho tháng đang chọn; nhân viên chỉ xem."}
        </span>
      </div>
      {source && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {monthText(month)[0].toUpperCase() + monthText(month).slice(1)} chưa đặt mục tiêu — màn hình đang tạm dùng mục tiêu{" "}
          {monthText(source)}.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted">
              <th className="px-3 py-2 text-left text-xs font-medium">Áp cho</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="border-l px-2 py-2 text-left text-xs font-medium whitespace-nowrap">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={cn("border-b", row.staffId === null && "bg-accent/60 font-medium")}>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.name}
                  {row.staffId !== null && !row.runs && <span className="ml-1 text-xs text-muted-foreground">(chưa có TKQC)</span>}
                </td>
                {FIELDS.map((f) => (
                  <td key={f.key} className="min-w-36 border-l px-2 py-1.5">
                    <NumberInput
                      id={`${idPrefix}-${row.key}-${f.key}`}
                      value={drafts[row.key][f.key]}
                      onValueChange={(digits) =>
                        setDrafts((prev) => ({ ...prev, [row.key]: { ...prev[row.key], [f.key]: digits } }))
                      }
                      maxDigits={f.digits}
                      suffix={f.suffix}
                      label={`${f.label} — ${row.name}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-muted/60 text-xs">
              <td className="px-3 py-2 font-medium">Tổng các nhân viên</td>
              {FIELDS.map((f) => {
                if (!f.total) return <td key={f.key} className="border-l" />;
                const sum = staffSum(f.key);
                const team = Number(drafts.team[f.key] || 0);
                const off = drafts.team[f.key] !== "" && sum !== team;
                return (
                  <td key={f.key} className={cn("border-l px-3 py-2 text-right tabular-nums", off && "font-semibold text-amber-700 dark:text-amber-300")}>
                    {sum.toLocaleString("vi-VN")}
                    {f.suffix ?? ""}
                    {off && <div className="font-normal">lệch {(sum - team).toLocaleString("vi-VN")} so với chung</div>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Huỷ
        </Button>
        <Button onClick={save} disabled={busy || changed.length === 0}>
          {busy ? "Đang lưu…" : `Lưu ${monthText(month)}${changed.length > 0 ? ` (${changed.length} dòng)` : ""}`}
        </Button>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Lịch sử chỉnh sửa mục tiêu                                                                        */
/* ------------------------------------------------------------------------------------------------ */

type HistoryState =
  | { status: "loading" }
  | { status: "ready"; entries: TargetHistoryEntry[] }
  | { status: "not-migrated" }
  | { status: "error"; message: string };

const when = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function TargetHistory({ people, targets }: { people: AdsStaff[]; targets: AdTarget[] }) {
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetchTargetHistory()
      .then((entries) => {
        if (!cancelled) setState(entries ? { status: "ready", entries } : { status: "not-migrated" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <Skeleton className="h-48 w-full rounded-lg" />;
  if (state.status === "not-migrated") {
    return <p className="text-sm text-muted-foreground">Lịch sử chỉnh sửa cần chạy file supabase/014_monthly_targets.sql trước.</p>;
  }
  if (state.status === "error") return <p className="text-sm text-destructive">{state.message}</p>;
  if (state.entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Chưa có lần đặt / sửa mục tiêu nào.</p>;
  }

  // Số lúc đặt lần đầu = số hiện tại, lùi ngược qua các lần sửa (nhật ký chỉ ghi phần thay đổi).
  const values = new Map(targets.map((t) => [t.id, { ...t } as Record<string, unknown>]));
  const initialOf = new Map<number, Record<string, unknown>>();
  for (const e of state.entries) {
    const current = e.target_id ? values.get(e.target_id) : undefined;
    if (!current) continue;
    if (e.action === "update" && e.old_data) Object.assign(current, e.old_data);
    if (e.action === "insert") initialOf.set(e.id, { ...current });
  }
  const nameOf = (staffId: string | null) =>
    staffId === null ? "Cả nhóm" : (people.find((p) => p.id === staffId)?.full_name ?? "Nhân viên đã xoá");

  return (
    <ol className="grid max-h-[60svh] gap-2 overflow-y-auto">
      {state.entries.map((e) => {
        const set = e.action === "insert" ? initialOf.get(e.id) : null;
        const changes =
          e.action === "update"
            ? Object.keys(e.new_data ?? {})
                .filter((k) => FIELD_LABEL.has(k) || k === "week_carry")
                .map(
                  (k) =>
                    `${FIELD_LABEL.get(k)?.label ?? CARRY_FIELD}: ${fieldValue(k, e.old_data?.[k])} → ${fieldValue(k, e.new_data?.[k])}`,
                )
            : set
              ? [
                  ...FIELDS.filter((f) => set[f.key] !== null && set[f.key] !== undefined).map(
                    (f) => `${f.label}: ${fieldValue(f.key, set[f.key])}`,
                  ),
                  ...(set.week_carry ? [`${CARRY_FIELD}: ${fieldValue("week_carry", set.week_carry)}`] : []),
                ]
              : [];
        return (
          <li key={e.id} className="rounded-lg border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="font-semibold">{e.actor_name}</span> {e.action === "insert" ? "đặt" : "sửa"} mục tiêu{" "}
                {e.month ? monthText(e.month.slice(0, 7)) : ""} — <span className="font-medium">{nameOf(e.ads_staff_id)}</span>
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{when.format(new Date(e.at))}</span>
            </div>
            {changes.length > 0 && (
              <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                {changes.map((c) => (
                  <li key={c}>• {c}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
