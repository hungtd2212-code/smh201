"use client";

import { format } from "date-fns";
import { Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CatalogGate, PageHeader } from "@/components/catalog/shared";
import { useCatalogs } from "@/components/catalog-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS, useCurrentStaff } from "@/hooks/use-current-staff";
import { setAcceptsLeads } from "@/lib/catalog/repo";
import type { StaffMember } from "@/lib/catalog/types";
import { hasRole, MANAGER_ROLES } from "@/lib/leads/crm";
import { fetchAssignMode, saveAssignMode } from "@/lib/leads/repo";
import type { AssignMode } from "@/lib/leads/types";
import { cn } from "@/lib/utils";
import { StatusSettings } from "./status-settings";
import { useLeadStatuses } from "./use-lead-statuses";

/** Telesale → Cài đặt: trạng thái khách hàng và cách chia số. */
export function TelesaleSettings() {
  const staff = useCurrentStaff();
  const canManage = staff.status === "ok" && hasRole(MANAGER_ROLES, staff.role);
  const { statuses, ready, error, reload } = useLeadStatuses();

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={Settings2}
        title="Cài đặt Telesale"
        description="Trạng thái khách hàng và cách chia số cho nhân viên Telesale."
      />
      <CatalogGate>
        {!canManage && (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Bạn đang xem. Chỉ Quản trị, COO và Trưởng Telesale được sửa phần này.
          </p>
        )}
        {error ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            {error}
          </p>
        ) : !ready ? (
          <Skeleton className="h-80 w-full rounded-xl" />
        ) : (
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <StatusSettings statuses={statuses} canManage={canManage} onChanged={reload} />
            <AssignSettings canManage={canManage} />
          </div>
        )}
      </CatalogGate>
    </div>
  );
}

/** Cách chia số mới + ai đang nhận số (chỉ nhân viên Telesale / Trưởng Telesale). */
function AssignSettings({ canManage }: { canManage: boolean }) {
  const { catalogs, reload } = useCatalogs();
  const me = useCurrentStaff();
  const myId = me.status === "ok" ? me.userId : null;
  const [mode, setMode] = useState<AssignMode | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAssignMode()
      .then((m) => !cancelled && setMode(m))
      .catch(() => !cancelled && setMode("auto"));
    return () => {
      cancelled = true;
    };
  }, []);

  const telesales = catalogs.staff.filter((s) => (s.role === "sale" || s.role === "lead") && !s.deleted_at);
  const receiving = telesales.filter((s) => s.accepts_leads && !s.locked_at);
  // Thứ tự xoay vòng: ai lâu chưa được chia nhất (hoặc chưa từng được chia) thì nhận trước.
  const queue = [...receiving].sort((a, b) => {
    if (!a.last_assigned_at && !b.last_assigned_at) return a.full_name.localeCompare(b.full_name, "vi");
    if (!a.last_assigned_at) return -1;
    if (!b.last_assigned_at) return 1;
    return a.last_assigned_at.localeCompare(b.last_assigned_at);
  });
  const position = new Map(queue.map((s, i) => [s.user_id, i + 1]));

  async function pickMode(next: AssignMode) {
    if (next === mode) return;
    setSaving("mode");
    try {
      await saveAssignMode(next);
      setMode(next);
      toast.success(next === "auto" ? "Số mới sẽ được chia tự động" : "Số mới sẽ để “Chưa chia” cho quản lý tự chia");
    } catch (error) {
      toast.error("Không đổi được cách chia", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(null);
    }
  }

  async function toggle(member: StaffMember) {
    setSaving(member.user_id);
    try {
      await setAcceptsLeads(member.user_id, !member.accepts_leads);
      await reload();
      toast.success(`${member.full_name}: ${member.accepts_leads ? "đã tắt nhận số" : "đã bật nhận số"}`);
    } catch (error) {
      toast.error("Không đổi được", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="grid gap-0.5">
        <h2 className="font-semibold">Chia số</h2>
        <p className="text-sm text-muted-foreground">
          Số chỉ được chia cho nhân viên Telesale và Trưởng Telesale. Admin, COO, Trưởng Telesale và Trực page đổi được
          sale quản lý của từng số.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Cách chia số mới">
        {(
          [
            ["auto", "Tự động", "Số mới chia lần lượt cho người đang bật nhận số."],
            ["manual", "Thủ công", "Số mới để “Chưa chia”; quản lý hoặc trực page tự chọn sale."],
          ] as const
        ).map(([value, title, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={!canManage || mode === null || saving === "mode"}
            onClick={() => pickMode(value)}
            className={cn(
              "grid gap-0.5 rounded-lg border px-3 py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default",
              mode === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50",
            )}
          >
            <span className="font-medium">{title}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </button>
        ))}
      </div>

      {mode === "auto" && receiving.length === 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Chưa có ai bật nhận số, nên số mới sẽ <strong>chưa được chia</strong>. Bật cho ít nhất một người ở dưới.
        </p>
      )}

      <ul className="grid divide-y rounded-lg border">
        {telesales.map((member) => (
          <li key={member.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{member.full_name}</span>
              {member.user_id === myId && <span className="ml-1 text-xs text-muted-foreground">(bạn)</span>}
              <span className="block text-xs text-muted-foreground">
                {ROLE_LABELS[member.role]}
                {" · "}
                {member.locked_at
                  ? "Đang bị khoá"
                  : position.has(member.user_id)
                    ? `Lượt thứ ${position.get(member.user_id)}`
                    : "Không trong vòng chia"}
                {" · được chia gần nhất "}
                {member.last_assigned_at ? format(new Date(member.last_assigned_at), "dd/MM HH:mm") : "chưa từng"}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              role="switch"
              aria-checked={member.accepts_leads}
              aria-label={`Nhận số: ${member.full_name}`}
              disabled={!canManage || saving === member.user_id || Boolean(member.locked_at)}
              onClick={() => toggle(member)}
              className={cn(
                "w-28 justify-start gap-2",
                member.accepts_leads &&
                  "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
              )}
            >
              <span className={cn("size-2 rounded-full", member.accepts_leads ? "bg-emerald-500" : "bg-muted-foreground/40")} />
              {member.accepts_leads ? "Đang nhận" : "Không nhận"}
            </Button>
          </li>
        ))}
        {telesales.length === 0 && (
          <li className="px-3 py-4 text-sm text-muted-foreground">
            Chưa có nhân viên Telesale nào. Thêm ở Cài đặt → Tài khoản &amp; Phân quyền (vị trí Telesale / Trưởng
            Telesale).
          </li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground">
        Người ở “Lượt thứ 1” nhận số kế tiếp, nhận xong thì xuống cuối hàng. Chia tay cho ai thì người đó cũng tính một
        lượt.
      </p>
    </section>
  );
}
