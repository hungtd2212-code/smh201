"use client";

import { endOfMonth, format, startOfMonth } from "date-fns";
import { Phone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessNotice } from "@/components/access-notice";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS, isManagerRole, useCurrentStaff } from "@/hooks/use-current-staff";
import { APP } from "@/lib/config";
import { exportLeadsToExcel } from "@/lib/leads/export";
import { fetchLead, fetchLeads } from "@/lib/leads/repo";
import { computeLeadStats } from "@/lib/leads/stats";
import type { Lead, LeadIntakeResult } from "@/lib/leads/types";
import { formatRange, monthRange, type DayRange } from "./date-range";
import { LeadCalendar } from "./lead-calendar";
import { LeadDialog } from "./lead-dialog";
import { LeadIntakeDialog } from "./lead-intake-dialog";
import { LeadFilters } from "./lead-filters";
import { LeadsTable } from "./leads-table";
import { StatCards } from "./stat-cards";
import { StatusBarChart, StatusPieChart } from "./status-charts";

export function LeadsDashboard() {
  const staff = useCurrentStaff();
  const [range, setRange] = useState<DayRange>(() => monthRange(new Date()));

  // Luôn tải trọn (các) tháng chứa khoảng đang lọc → lịch có chấm cho cả tháng,
  // và chuyển qua lại giữa các ngày trong tháng không phải gọi lại máy chủ.
  const windowFrom = startOfMonth(range.from);
  const windowTo = endOfMonth(range.to);
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = `${windowFrom.getTime()}-${windowTo.getTime()}-${reloadCount}`;

  const [loaded, setLoaded] = useState<{ key: string; leads: Lead[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLeads(windowFrom, windowTo)
      .then((leads) => {
        if (!cancelled) setLoaded({ key: requestKey, leads });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setFailure({
            key: requestKey,
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
    };
    // requestKey đã bao gồm windowFrom, windowTo và reloadCount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const error = failure?.key === requestKey ? failure.message : null;
  const loading = loaded?.key !== requestKey && !error;
  const windowLeads = useMemo(() => loaded?.leads ?? [], [loaded]);

  /** Lead thuộc đúng khoảng ngày đang lọc. */
  const leads = useMemo(() => {
    const start = range.from.getTime();
    const end = range.to.getTime();
    return windowLeads.filter((lead) => {
      const t = new Date(lead.created_at).getTime();
      return t >= start && t <= end;
    });
  }, [windowLeads, range]);

  const stats = useMemo(() => computeLeadStats(leads), [leads]);

  // Hộp thoại "Thêm lead" (trực page dán số) và hộp thoại telesale xử lý một lead.
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [editing, setEditing] = useState<{ open: boolean; lead: Lead | null }>({
    open: false,
    lead: null,
  });

  /** Đưa một lead vừa tạo / vừa sửa vào danh sách đang hiển thị mà không tải lại cả tháng. */
  function mergeLead(saved: Lead) {
    setLoaded((prev) => {
      if (!prev) return prev;
      if (prev.leads.some((lead) => lead.id === saved.id)) {
        return { ...prev, leads: prev.leads.map((lead) => (lead.id === saved.id ? saved : lead)) };
      }
      const created = new Date(saved.created_at).getTime();
      const inWindow = created >= windowFrom.getTime() && created <= windowTo.getTime();
      return inWindow ? { ...prev, leads: [saved, ...prev.leads] } : prev;
    });
  }

  function handleLeadSaved(saved: Lead) {
    mergeLead(saved);
    setEditing((prev) => ({ ...prev, open: false }));
  }

  /** Lead vừa được hoàn tác về phiên bản cũ: cập nhật cả danh sách lẫn hộp thoại đang mở. */
  function handleLeadChanged(changed: Lead) {
    mergeLead(changed);
    setEditing((prev) => ({ ...prev, lead: changed }));
  }

  /** Bỏ các lead vừa bị xoá (đã vào Thùng rác) khỏi danh sách đang hiển thị. */
  function removeLeads(ids: string[]) {
    const gone = new Set(ids);
    setLoaded((prev) => prev && { ...prev, leads: prev.leads.filter((lead) => !gone.has(lead.id)) });
  }

  /** Sau mỗi lần dán: lấy lại đúng lead đó từ máy chủ (lead mới, hoặc lead cũ vừa được cập nhật). */
  async function handleIntakeSaved(result: LeadIntakeResult) {
    try {
      const lead = await fetchLead(result.lead_id);
      if (lead) mergeLead(lead);
    } catch {
      setReloadCount((n) => n + 1);
    }
  }

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    setExporting(true);
    try {
      const name = `leads-${APP.branch.code}-${format(range.from, "yyyyMMdd")}-${format(range.to, "yyyyMMdd")}.xlsx`;
      await exportLeadsToExcel(leads, name);
    } catch (error) {
      toast.error("Không xuất được file Excel", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-linear-to-br from-brand-teal to-brand-blue text-white">
            <Phone className="size-4" />
          </span>
          Telesale
        </h1>
        <p className="text-sm text-muted-foreground">
          Quản lý leads cơ sở {APP.branch.name}
          {staff.status === "ok" && ` — vai trò: ${ROLE_LABELS[staff.role]}`}
        </p>
      </div>

      <AccessNotice staff={staff} />

      <LeadFilters
        range={range}
        onRangeChange={setRange}
        loading={loading}
        onRefresh={() => setReloadCount((n) => n + 1)}
        onExport={handleExport}
        exporting={exporting}
        canExport={!loading && leads.length > 0}
      />

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">Không tải được dữ liệu leads</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      ) : (
        <>
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-30 rounded-xl" />
              ))}
            </div>
          ) : (
            <StatCards stats={stats} />
          )}

          {/* ≥1280px: 3 cột (lịch | cột | vành khuyên). Hẹp hơn: lịch + vành khuyên, biểu đồ cột xuống dưới. */}
          <div className="grid gap-4 md:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card>
              <CardContent>
                <LeadCalendar
                  leads={windowLeads}
                  range={range}
                  onRangeChange={setRange}
                />
              </CardContent>
            </Card>

            <Card className="md:order-last md:col-span-2 xl:order-none xl:col-span-1">
              <CardHeader>
                <CardTitle>
                  Biểu đồ trạng thái — {APP.branch.name} ({formatRange(range)})
                </CardTitle>
                <CardDescription>Thống kê leads theo 13 trạng thái</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-80 w-full" />
                ) : (
                  <StatusBarChart byStatus={stats.byStatus} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tỷ lệ trạng thái</CardTitle>
                <CardDescription>Tỷ lệ phần trăm theo trạng thái</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-80 w-full" />
                ) : (
                  <StatusPieChart byStatus={stats.byStatus} total={stats.total} />
                )}
              </CardContent>
            </Card>
          </div>

          <LeadsTable
            leads={leads}
            loading={loading}
            onAdd={() => setIntakeOpen(true)}
            onEdit={(lead) => setEditing({ open: true, lead })}
            onLeadUpdated={mergeLead}
            canDelete={staff.status === "ok" && isManagerRole(staff.role)}
            onLeadsDeleted={removeLeads}
          />
        </>
      )}

      <LeadIntakeDialog
        open={intakeOpen}
        onOpenChange={setIntakeOpen}
        onSaved={handleIntakeSaved}
      />
      <LeadDialog
        open={editing.open}
        onOpenChange={(open) => setEditing((prev) => ({ ...prev, open }))}
        lead={editing.lead}
        onSaved={handleLeadSaved}
        onChanged={handleLeadChanged}
        onDeleted={(id) => removeLeads([id])}
      />
    </div>
  );
}
