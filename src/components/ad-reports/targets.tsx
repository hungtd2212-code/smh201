"use client";

import { AlertTriangle, CheckCircle2, CircleAlert, Target } from "lucide-react";
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
import type { Alert, Status, TargetItem, TargetValues } from "@/lib/ad-reports/aggregate";
import { fetchTargets, saveTarget, type AdTarget } from "@/lib/ad-reports/targets";
import type { AdsStaff } from "@/lib/catalog/types";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { NumberInput } from "./number-input";

/** Mục tiêu quảng cáo: tải, đặt (quản lý), thanh tiến độ và cảnh báo. */

export type TargetsState =
  | { status: "loading" }
  | { status: "ready"; targets: AdTarget[] }
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
      .then((targets) => {
        if (!cancelled) setState(targets ? { status: "ready", targets } : { status: "not-migrated" });
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
const FIELDS: { key: keyof TargetValues; label: string; suffix?: string; digits: number }[] = [
  { key: "monthly_budget", label: "Ngân sách / tháng", suffix: "đ", digits: 13 },
  { key: "monthly_data", label: "Data / tháng", digits: 7 },
  { key: "max_cost_per_message", label: "Giá mess tối đa", suffix: "đ", digits: 9 },
  { key: "max_cost_per_data", label: "Giá data tối đa", suffix: "đ", digits: 9 },
];
const toDraft = (t: TargetValues | undefined): Draft =>
  Object.fromEntries(FIELDS.map((f) => [f.key, t?.[f.key] == null ? "" : String(t[f.key])])) as Draft;
const fromDraft = (d: Draft): TargetValues =>
  Object.fromEntries(FIELDS.map((f) => [f.key, d[f.key] === "" ? null : Number(d[f.key])])) as TargetValues;

export function TargetsDialog({
  open,
  onClose,
  people,
  targets,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  people: AdsStaff[];
  targets: AdTarget[];
  onSaved: () => Promise<void>;
}) {
  const idPrefix = useId();
  const rows: { key: string; staffId: string | null; name: string; existing?: AdTarget }[] = [
    { key: "team", staffId: null, name: "Cả nhóm", existing: targets.find((t) => t.ads_staff_id === null) },
    ...people
      .filter((p) => p.is_active || targets.some((t) => t.ads_staff_id === p.id))
      .map((p) => ({ key: p.id, staffId: p.id, name: p.full_name, existing: targets.find((t) => t.ads_staff_id === p.id) })),
  ];
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, toDraft(r.existing)])),
  );
  const [saving, setSaving] = useState(false);
  const changed = rows.filter((r) => JSON.stringify(drafts[r.key]) !== JSON.stringify(toDraft(r.existing)));

  async function save() {
    setSaving(true);
    try {
      for (const row of changed) {
        await saveTarget(row.existing?.id ?? null, row.staffId, fromDraft(drafts[row.key]));
      }
      toast.success("Đã lưu mục tiêu");
      onClose();
    } catch (error) {
      toast.error("Không lưu được", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
      await onSaved();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Mục tiêu quảng cáo</DialogTitle>
          <DialogDescription>
            Ô để trống = không đặt. Giá tối đa của nhân viên để trống thì dùng của cả nhóm. Ngân sách và data của
            cả nhóm là tổng của mọi người.
          </DialogDescription>
        </DialogHeader>
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
                <tr key={row.key} className={cn("border-b last:border-0", row.staffId === null && "bg-accent/50")}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{row.name}</td>
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
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={save} disabled={saving || changed.length === 0}>
            {saving ? "Đang lưu…" : `Lưu${changed.length > 0 ? ` (${changed.length} dòng)` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
