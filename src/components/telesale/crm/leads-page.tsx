"use client";

import { endOfMonth, format, startOfMonth } from "date-fns";
import { BellRing, ChevronLeft, ChevronRight, Phone, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessNotice } from "@/components/access-notice";
import { useCatalogNames } from "@/components/catalog-provider";
import { PageHeader } from "@/components/catalog/shared";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalogs } from "@/components/catalog-provider";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { APP } from "@/lib/config";
import { filterLeads, hasRole, missingForStatus, SEES_ALL_ROLES, staffHues, TRANSFER_ROLES, type LeadFilter } from "@/lib/leads/crm";
import { exportLeadsToExcel } from "@/lib/leads/export";
import { fetchAssignMode, fetchLead, fetchLeads, fetchLeadsAdsStaff, updateLead } from "@/lib/leads/repo";
import type { AddLeadResult, AssignMode, Lead } from "@/lib/leads/types";
import { logExport, softDeleteRecords } from "@/lib/safety/repo";
import { cn } from "@/lib/utils";
import { monthRange, type DayRange } from "../date-range";
import { LeadFilters } from "../lead-filters";
import { AddLeadDialog } from "./add-lead-dialog";
import { LeadDetailDialog } from "./lead-detail-dialog";
import { LeadsGrid } from "./leads-grid";
import { useLeadStatuses } from "./use-lead-statuses";

const PAGE_SIZE = 100;
/** Chuyển vào Thùng rác quá số này phải nhập lại mật khẩu (máy chủ kiểm tra lại theo cấu hình thật). */
const PASSWORD_OVER = 20;
const EMPTY_FILTER: LeadFilter = { query: "", status: "all", sale: "all", recontacted: false };

/** Telesale → Lead: bảng số kẻ ô, thêm số, đổi tình trạng, mở từng số để chăm sóc. */
export function LeadsPage() {
  const staff = useCurrentStaff();
  const { catalogs } = useCatalogs();
  const names = useCatalogNames();
  const { statuses, error: statusError } = useLeadStatuses();
  const me = staff.status === "ok" ? staff : null;
  const seesAll = hasRole(SEES_ALL_ROLES, me?.role);
  const canTransfer = hasRole(TRANSFER_ROLES, me?.role);
  const canAdd = me !== null && me.role !== "ads_staff";
  const canDelete = me?.canDelete ?? false;

  // ----- Tải số theo (các) tháng chứa khoảng đang lọc -----
  const [range, setRange] = useState<DayRange>(() => monthRange(new Date()));
  const windowFrom = startOfMonth(range.from);
  const windowTo = endOfMonth(range.to);
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = `${windowFrom.getTime()}-${windowTo.getTime()}-${reloadCount}`;
  const [loaded, setLoaded] = useState<{ key: string; leads: Lead[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLeads(windowFrom, windowTo)
      .then((leads) => !cancelled && setLoaded({ key: requestKey, leads }))
      .catch((error: unknown) => !cancelled && setFailure({ key: requestKey, message: error instanceof Error ? error.message : String(error) }));
    return () => {
      cancelled = true;
    };
    // requestKey đã bao gồm windowFrom, windowTo và reloadCount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // Cột NV ADS: nhân viên Ads của từng số (lỗi thì thôi, cột dùng số đã lưu sẵn trên lead).
  const [adsStaff, setAdsStaff] = useState<{ key: string; map: Map<string, string> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLeadsAdsStaff(windowFrom, windowTo)
      .then((map) => !cancelled && setAdsStaff({ key: requestKey, map: map ?? new Map() }))
      .catch(() => !cancelled && setAdsStaff({ key: requestKey, map: new Map() }));
    return () => {
      cancelled = true;
    };
    // requestKey đã bao gồm windowFrom, windowTo và reloadCount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);
  const adsStaffMap = adsStaff?.key === requestKey ? adsStaff.map : null;
  const adsStaffHues = useMemo(
    () =>
      staffHues(
        [...catalogs.adsStaff]
          .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id))
          .map((a) => a.id),
      ),
    [catalogs.adsStaff],
  );

  const [assignMode, setAssignMode] = useState<AssignMode>("auto");
  useEffect(() => {
    fetchAssignMode().then(setAssignMode).catch(() => {});
  }, []);

  const error = failure?.key === requestKey ? failure.message : null;
  const loading = loaded?.key !== requestKey && !error;
  const inRange = useMemo(() => {
    const start = range.from.getTime();
    const end = range.to.getTime();
    return (loaded?.leads ?? []).filter((l) => {
      const t = new Date(l.created_at).getTime();
      return t >= start && t <= end;
    });
  }, [loaded, range]);

  // ----- Lọc, phân trang, chọn -----
  const [filter, setFilter] = useState<LeadFilter>(EMPTY_FILTER);
  const [page, setPage] = useState(0);
  const shown = useMemo(() => filterLeads(inRange, filter), [inRange, filter]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = shown.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const recontacted = inRange.filter((l) => l.recontacted_at).length;
  const unassigned = inRange.filter((l) => !l.assignee_id).length;
  const setF = (patch: Partial<LeadFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPage(0);
  };

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = shown.filter((l) => selected.has(l.id));

  // ----- Cập nhật danh sách tại chỗ -----
  function merge(saved: Lead) {
    setLoaded((prev) => {
      if (!prev) return prev;
      if (prev.leads.some((l) => l.id === saved.id)) return { ...prev, leads: prev.leads.map((l) => (l.id === saved.id ? saved : l)) };
      const t = new Date(saved.created_at).getTime();
      return t >= windowFrom.getTime() && t <= windowTo.getTime() ? { ...prev, leads: [saved, ...prev.leads] } : prev;
    });
  }
  function remove(ids: string[]) {
    const gone = new Set(ids);
    setLoaded((prev) => prev && { ...prev, leads: prev.leads.filter((l) => !gone.has(l.id)) });
    setSelected(new Set());
  }

  // ----- Hộp thoại -----
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<{ lead: Lead; pendingStatusId: string | null } | null>(null);

  async function handleAdded(result: AddLeadResult) {
    try {
      const lead = await fetchLead(result.lead_id);
      if (lead) merge(lead);
    } catch {
      setReloadCount((n) => n + 1);
    }
  }

  async function pickStatus(lead: Lead, statusId: string) {
    const status = statuses.find((s) => s.id === statusId);
    const missing = missingForStatus(status, { appointment_at: lead.appointment_at, deal_amount: lead.deal_amount });
    if (missing.length > 0) {
      // Còn thiếu lịch hẹn / doanh số → mở số đó với trạng thái đã chọn sẵn để điền nốt.
      toast.info(`“${status?.name}” cần nhập ${missing.join(", ").toLowerCase()}`);
      setOpen({ lead, pendingStatusId: statusId });
      return;
    }
    try {
      const mine = me !== null && lead.assignee_id === me.userId;
      const saved = await updateLead(lead.id, { status_id: statusId, ...(mine && lead.recontacted_at ? { recontacted_at: null } : {}) });
      merge(saved);
      toast.success(`${saved.full_name}: ${status?.name ?? "đã đổi"}`);
    } catch (e) {
      toast.error("Không đổi được tình trạng", { description: e instanceof Error ? e.message : String(e) });
    }
  }

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    setExporting(true);
    try {
      const file = `lead-${APP.branch.code}-${format(range.from, "yyyyMMdd")}-${format(range.to, "yyyyMMdd")}.xlsx`;
      // Ghi sổ trước khi tạo file: tài khoản chưa được tick quyền "Xuất file" thì máy chủ từ chối ở đây.
      await logExport("leads", shown.length, { file, from: format(range.from, "yyyy-MM-dd"), to: format(range.to, "yyyy-MM-dd") });
      await exportLeadsToExcel(shown, file, statuses, {
        channel: names.channel,
        page: names.page,
        service: names.service,
        post: names.adPost,
        staff: names.staff,
      });
    } catch (e) {
      toast.error("Không xuất được file", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  }

  if (staff.status === "no-access" || staff.status === "locked") return <AccessNotice staff={staff} />;

  const telesales = catalogs.staff.filter((s) => s.role === "sale" || s.role === "lead");

  return (
    <div className="grid gap-4">
      <PageHeader
        icon={Phone}
        title="Lead"
        description={
          seesAll
            ? `Mọi số của cơ sở ${APP.branch.name}. Bấm vào một dòng để mở số đó.`
            : "Các số bạn đang quản lý. Bấm vào một dòng để mở số đó."
        }
      >
        {canAdd && (
          <Button onClick={() => setAdding(true)}>
            <Plus />
            Thêm số
          </Button>
        )}
      </PageHeader>

      <LeadFilters
        range={range}
        onRangeChange={(next) => {
          setRange(next);
          setPage(0);
        }}
        loading={loading}
        onRefresh={() => setReloadCount((n) => n + 1)}
        onExport={me?.canExport ? handleExport : undefined}
        exporting={exporting}
        canExport={me?.canExport ?? false}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Tìm tên, số, lưu ý, khai thác…"
            aria-label="Tìm số"
            className="pl-8"
            value={filter.query}
            onChange={(e) => setF({ query: e.target.value })}
          />
        </div>
        <Select value={filter.status} onValueChange={(status) => setF({ status })}>
          <SelectTrigger className="w-48" aria-label="Lọc theo tình trạng">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mọi tình trạng</SelectItem>
            <SelectItem value="none">Chưa xử lý</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {seesAll && (
          <Select value={filter.sale} onValueChange={(sale) => setF({ sale })}>
            <SelectTrigger className="w-48" aria-label="Lọc theo sale">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Mọi sale</SelectItem>
              <SelectItem value="unassigned">Chưa chia ({unassigned})</SelectItem>
              {telesales.map((s) => (
                <SelectItem key={s.user_id} value={s.user_id}>
                  {s.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {recontacted > 0 && (
          <Button
            variant="outline"
            aria-pressed={filter.recontacted}
            className={cn(filter.recontacted && "border-amber-400 bg-amber-50 dark:bg-amber-950/40")}
            onClick={() => setF({ recontacted: !filter.recontacted })}
          >
            <BellRing className="text-amber-600" />
            Khách nhắn lại ({recontacted})
          </Button>
        )}
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {shown.length.toLocaleString("vi-VN")} số
        </span>
      </div>

      {statusError && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {statusError}
        </p>
      )}

      {canDelete && chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-accent/40 px-3 py-2 text-sm">
          <span className="font-medium">Đã chọn {chosen.length} số</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </Button>
          <DeleteButton chosen={chosen} onDeleted={remove} />
        </div>
      )}

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Không tải được danh sách số: {error}
        </p>
      ) : loading && !loaded ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <LeadsGrid
          leads={rows}
          offset={currentPage * PAGE_SIZE}
          statuses={statuses}
          names={names}
          adsStaffOf={(lead) => adsStaffMap?.get(lead.id) ?? lead.ads_staff_id}
          adsStaffHues={adsStaffHues}
          canChangeStatus={me !== null && me.role !== "ads_staff"}
          onOpen={(lead) => setOpen({ lead, pendingStatusId: null })}
          onPickStatus={pickStatus}
          selectable={canDelete}
          selected={selected}
          onToggle={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onTogglePage={() =>
            setSelected((prev) => {
              const all = rows.every((l) => prev.has(l.id));
              const next = new Set(prev);
              for (const l of rows) {
                if (all) next.delete(l.id);
                else next.add(l.id);
              }
              return next;
            })
          }
        />
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          Trang {currentPage + 1}/{pageCount}
          <Button variant="outline" size="icon-sm" aria-label="Trang trước" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Trang sau"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}

      <AddLeadDialog open={adding} onOpenChange={setAdding} canPickSale={canTransfer} assignMode={assignMode} onAdded={handleAdded} />
      <LeadDetailDialog
        lead={open?.lead ?? null}
        pendingStatusId={open?.pendingStatusId ?? null}
        statuses={statuses}
        myId={me?.userId ?? null}
        canTransfer={canTransfer}
        canDelete={canDelete}
        onClose={() => setOpen(null)}
        onSaved={(saved) => {
          merge(saved);
          setOpen(null);
        }}
        onDeleted={(id) => {
          remove([id]);
          setOpen(null);
        }}
      />
    </div>
  );
}

function DeleteButton({ chosen, onDeleted }: { chosen: Lead[]; onDeleted: (ids: string[]) => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
        <Trash2 />
        Chuyển vào thùng rác
      </Button>
      <ConfirmActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Chuyển ${chosen.length} số vào thùng rác?`}
        description={
          <>
            <p>
              {chosen.length === 1 ? `${chosen[0].full_name} (${chosen[0].phone})` : `${chosen.length} số đã chọn`} sẽ không
              còn hiện trong bảng. Không số nào bị xoá: Quản trị khôi phục được trong Cài đặt → Thùng rác.
            </p>
            {chosen.length > PASSWORD_OVER && <p>Chuyển hơn {PASSWORD_OVER} số một lúc cần nhập lại mật khẩu của bạn.</p>}
          </>
        }
        confirmLabel="Chuyển vào Thùng rác"
        destructive
        needsPassword={chosen.length > PASSWORD_OVER}
        onConfirm={async () => {
          const ids = chosen.map((l) => l.id);
          const n = await softDeleteRecords("leads", ids);
          toast.success(`Đã chuyển ${n} số vào Thùng rác`, { description: "Quản trị có thể khôi phục trong Cài đặt → Thùng rác." });
          onDeleted(ids);
        }}
      />
    </>
  );
}
