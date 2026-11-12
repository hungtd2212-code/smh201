"use client";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { monthsBetween, shiftMonth } from "@/lib/ad-reports/aggregate";
import { monthLabel } from "@/lib/ad-reports/dates";
import { fetchRevenue, saveRevenue, type AdRevenue } from "@/lib/ad-reports/revenue";
import type { AdsStaff } from "@/lib/catalog/types";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { NumberInput } from "./number-input";

/** Doanh thu tháng mang về từ quảng cáo: tải và nhập (Quản trị / Trưởng Marketing). */

export type RevenueState =
  | { status: "loading" }
  | { status: "ready"; rows: AdRevenue[] }
  /** Chưa chạy supabase/013_revenue_avatars.sql. */
  | { status: "not-migrated" }
  | { status: "error"; message: string };

export function useRevenue(fromMonth: string, toMonth: string) {
  const key = `${fromMonth}:${toMonth}`;
  const [loaded, setLoaded] = useState<{ key: string; state: RevenueState } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!fromMonth || !toMonth || !isSupabaseConfigured) return;
    let cancelled = false;
    fetchRevenue(fromMonth, toMonth)
      .then((rows) => {
        if (!cancelled) setLoaded({ key, state: rows ? { status: "ready", rows } : { status: "not-migrated" } });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoaded({ key, state: { status: "error", message: error instanceof Error ? error.message : String(error) } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, fromMonth, toMonth, version]);
  const reload = useCallback(async () => setVersion((v) => v + 1), []);
  return { state: loaded?.key === key ? loaded.state : ({ status: "loading" } as RevenueState), reload };
}

/** Tổng doanh thu theo tháng của một người (staffId) hoặc của tất cả (null, gồm cả dòng chưa rõ nhân viên). */
export function revenueByMonth(rows: AdRevenue[], staffId: string | null) {
  const result = new Map<string, number>();
  for (const r of rows) {
    if (staffId !== null && r.ads_staff_id !== staffId) continue;
    const month = r.month.slice(0, 7);
    result.set(month, (result.get(month) ?? 0) + r.amount);
  }
  return result;
}

export function RevenueDialog({
  people,
  today,
  onClose,
  onSaved,
}: {
  people: AdsStaff[];
  today: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const { state } = useRevenue(month, month);
  const options = monthsBetween(shiftMonth(thisMonth, -11), thisMonth).reverse();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Doanh thu từ quảng cáo</DialogTitle>
          <DialogDescription>
            Doanh thu tháng do khách đến từ quảng cáo mang về, ghi cho nhân viên Ads phụ trách. Dùng để tính tỉ lệ chi phí
            ads / doanh thu, so mục tiêu doanh thu và xếp hạng vinh danh. (Khi có phân hệ Thu ngân sẽ tự tính.)
          </DialogDescription>
        </DialogHeader>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-48" aria-label="Tháng">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((m) => (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {state.status === "loading" ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : state.status === "not-migrated" ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Chức năng này cần chạy file supabase/013_revenue_avatars.sql trên Supabase trước.
          </p>
        ) : state.status === "error" ? (
          <p className="text-sm text-destructive">{state.message}</p>
        ) : (
          <RevenueForm key={month} month={month} people={people} rows={state.rows} onClose={onClose} onSaved={onSaved} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevenueForm({
  month,
  people,
  rows,
  onClose,
  onSaved,
}: {
  month: string;
  people: AdsStaff[];
  rows: AdRevenue[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const idPrefix = useId();
  const lines: { key: string; staffId: string | null; name: string; existing?: AdRevenue }[] = [
    ...people
      .filter((p) => p.is_active || rows.some((r) => r.ads_staff_id === p.id))
      .map((p) => ({ key: p.id, staffId: p.id, name: p.full_name, existing: rows.find((r) => r.ads_staff_id === p.id) })),
    { key: "none", staffId: null, name: "Chưa rõ nhân viên", existing: rows.find((r) => r.ads_staff_id === null) },
  ];
  const initial = (l: (typeof lines)[number]) => (l.existing ? String(l.existing.amount) : "");
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.key, initial(l)])));
  const [saving, setSaving] = useState(false);
  const changed = lines.filter((l) => drafts[l.key] !== initial(l) && !(drafts[l.key] === "" && !l.existing));
  const total = lines.reduce((s, l) => s + Number(drafts[l.key] || 0), 0);

  async function save() {
    setSaving(true);
    try {
      for (const l of changed) {
        await saveRevenue(l.existing?.id ?? null, month, l.staffId, Number(drafts[l.key] || 0));
      }
      toast.success(`Đã lưu doanh thu ${monthLabel(month).toLowerCase()}`);
      await onSaved();
      onClose();
    } catch (error) {
      toast.error("Không lưu được", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className={cn("border-b last:border-0", l.staffId === null && "bg-muted/50")}>
                <td className="px-3 py-1.5 font-medium">{l.name}</td>
                <td className="w-56 border-l px-2 py-1.5">
                  <NumberInput
                    id={`${idPrefix}-${l.key}`}
                    value={drafts[l.key]}
                    onValueChange={(digits) => setDrafts((prev) => ({ ...prev, [l.key]: digits }))}
                    maxDigits={13}
                    suffix="đ"
                    label={`Doanh thu ${l.name}`}
                  />
                </td>
              </tr>
            ))}
            <tr className="bg-accent font-semibold text-accent-foreground">
              <td className="px-3 py-2">Tổng</td>
              <td className="border-l px-3 py-2 text-right tabular-nums">{total.toLocaleString("vi-VN")}đ</td>
            </tr>
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
    </>
  );
}
