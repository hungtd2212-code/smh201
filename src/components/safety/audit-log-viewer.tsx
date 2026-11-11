"use client";

import { format } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Lock,
  LockOpen,
  RefreshCw,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/catalog/shared";
import { useCatalogNames, useCatalogs, type CatalogNames } from "@/components/catalog-provider";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/hooks/use-current-staff";
import type { StaffMember } from "@/lib/catalog/types";
import { ACTION_LABELS, TABLE_LABELS, describeChanges, recordLabel, type AdsStatRef } from "@/lib/safety/labels";
import {
  fetchAuditLog,
  fetchAdsStatRefs,
  fetchLeadLabels,
  fetchOpenAlerts,
  resolveAlert,
  setStaffLock,
  undoChanges,
} from "@/lib/safety/repo";
import type { AuditAction, AuditEntry, SecurityAlert, UndoSummary } from "@/lib/safety/types";
import { cn } from "@/lib/utils";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { AdminOnly, errorText, useRole } from "./shared";

const ALL = "__all";
const SYSTEM = "system";
const PAGE_SIZE = 50;
const DAY_MS = 24 * 3600 * 1000;
/** Từ chừng này dòng cùng một thao tác trở lên thì gộp lại thành một dòng tóm tắt. */
const GROUP_FROM = 3;

const ACTIONS = Object.keys(ACTION_LABELS) as AuditAction[];
const toLocalInput = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm");

/** Cài đặt → Nhật ký hệ thống: ai đã thêm / sửa / xoá gì, lúc nào, từ đâu; hoàn tác theo lô. */
export function AuditLogViewer() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={History}
        title="Nhật ký hệ thống"
        description="Mọi lần thêm, sửa, chuyển vào thùng rác, khôi phục đều được ghi lại tự động: ai làm, lúc nào, từ địa chỉ IP nào."
      />
      <AdminOnly>
        <AuditContent />
      </AdminOnly>
    </div>
  );
}

type Filters = { actor: string; action: string; table: string; from: string; to: string };
const NO_FILTERS: Filters = { actor: ALL, action: ALL, table: ALL, from: "", to: "" };

type UndoPreset = { actor: string; from: string; to: string; key: number };

function AuditContent() {
  const { catalogs, reload: reloadCatalogs } = useCatalogs();
  const names = useCatalogNames();

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = JSON.stringify([filters, page, reloadCount]);

  const [loaded, setLoaded] = useState<{
    key: string;
    rows: AuditEntry[];
    total: number;
    leadLabels: Map<string, string>;
    adsStatRefs: Map<string, AdsStatRef>;
  } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [undoPreset, setUndoPreset] = useState<UndoPreset>({ actor: ALL, from: "", to: "", key: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchAuditLog(
        {
          actor: filters.actor === ALL ? null : filters.actor,
          action: filters.action === ALL ? null : (filters.action as AuditAction),
          table: filters.table === ALL ? null : filters.table,
          from: filters.from ? new Date(`${filters.from}T00:00:00`) : null,
          to: filters.to ? new Date(new Date(`${filters.to}T00:00:00`).getTime() + DAY_MS) : null,
        },
        page,
        PAGE_SIZE,
      );
      const leadLabels = await fetchLeadLabels(
        result.rows.filter((row) => row.table_name === "leads").map((row) => row.record_id),
      );
      const adsStatRefs = await fetchAdsStatRefs(result.rows);
      if (!cancelled) setLoaded({ key: requestKey, ...result, leadLabels, adsStatRefs });
    })().catch((error: unknown) => {
      if (!cancelled) setFailure({ key: requestKey, message: errorText(error) });
    });
    return () => {
      cancelled = true;
    };
    // requestKey đã bao gồm filters, page và reloadCount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  useEffect(() => {
    let cancelled = false;
    fetchOpenAlerts()
      .then((rows) => !cancelled && setAlerts(rows))
      .catch(() => undefined); // lỗi tải cảnh báo không chặn việc xem nhật ký
    return () => {
      cancelled = true;
    };
  }, [reloadCount]);

  const error = failure?.key === requestKey ? failure.message : null;
  const loading = loaded?.key !== requestKey && !error;
  const rows = useMemo(() => loaded?.rows ?? [], [loaded]);
  const total = loaded?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** Các dòng liền nhau thuộc cùng một thao tác (cùng txid, người, hành động, bảng). */
  const groups = useMemo(() => {
    const result: AuditEntry[][] = [];
    for (const row of rows) {
      const head = result.at(-1)?.[0];
      if (
        head &&
        head.txid === row.txid &&
        head.actor_id === row.actor_id &&
        head.action === row.action &&
        head.table_name === row.table_name
      ) {
        result.at(-1)?.push(row);
      } else {
        result.push([row]);
      }
    }
    return result;
  }, [rows]);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }

  const refresh = () => setReloadCount((n) => n + 1);

  async function handleAlert(alert: SecurityAlert, unlock: boolean) {
    try {
      await resolveAlert(alert.id, unlock);
      toast.success(unlock ? "Đã mở khoá tài khoản và đóng cảnh báo" : "Đã đóng cảnh báo");
      refresh();
      await reloadCatalogs();
    } catch (caught) {
      toast.error("Không xử lý được cảnh báo", { description: errorText(caught) });
    }
  }

  /** Mở sẵn bộ lọc và khung hoàn tác cho đúng tài khoản + khoảng thời gian của cảnh báo. */
  function inspectAlert(alert: SecurityAlert) {
    const at = new Date(alert.created_at);
    setFilters({ ...NO_FILTERS, actor: alert.user_id });
    setPage(0);
    setUndoPreset((prev) => ({
      actor: alert.user_id,
      from: toLocalInput(new Date(at.getTime() - 3600 * 1000)),
      to: toLocalInput(new Date(at.getTime() + 5 * 60 * 1000)),
      key: prev.key + 1,
    }));
  }

  return (
    <div className="grid gap-5">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex flex-wrap items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="grid min-w-60 flex-1 gap-0.5">
            <p className="font-medium">
              Thao tác bất thường: {names.staff(alert.user_id) ?? "một tài khoản"} đã sửa / chuyển vào thùng rác{" "}
              {alert.details.count ?? "nhiều"} bản ghi trong 1 giờ
              {alert.details.limit !== undefined && ` (ngưỡng ${alert.details.limit})`}
            </p>
            <p className="text-muted-foreground">
              Phát hiện lúc {format(new Date(alert.created_at), "dd/MM/yyyy HH:mm")}.{" "}
              {alert.locked
                ? "Hệ thống đã tự khoá tài khoản này."
                : "Tài khoản này không bị khoá tự động."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => inspectAlert(alert)}>
              Xem thay đổi
            </Button>
            {alert.locked && (
              <Button size="sm" variant="outline" onClick={() => handleAlert(alert, true)}>
                <LockOpen />
                Mở khoá và đóng
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => handleAlert(alert, false)}>
              Đóng cảnh báo
            </Button>
          </div>
        </div>
      ))}

      <BatchUndo
        key={undoPreset.key}
        preset={undoPreset}
        staff={catalogs.staff}
        onDone={async () => {
          refresh();
          await reloadCatalogs();
        }}
      />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filters.actor} onValueChange={(v) => setFilter("actor", v)}>
            <SelectTrigger className="w-52" aria-label="Lọc theo người thực hiện">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Mọi người thực hiện</SelectItem>
              {catalogs.staff.map((member) => (
                <SelectItem key={member.user_id} value={member.user_id}>
                  {member.full_name}
                </SelectItem>
              ))}
              <SelectItem value={SYSTEM}>Hệ thống / Supabase</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.action} onValueChange={(v) => setFilter("action", v)}>
            <SelectTrigger className="w-48" aria-label="Lọc theo hành động">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Mọi hành động</SelectItem>
              {ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>
                  {ACTION_LABELS[action]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.table} onValueChange={(v) => setFilter("table", v)}>
            <SelectTrigger className="w-44" aria-label="Lọc theo loại dữ liệu">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Mọi loại dữ liệu</SelectItem>
              {Object.entries(TABLE_LABELS).map(([table, label]) => (
                <SelectItem key={table} value={table}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Từ
            <Input
              type="date"
              className="w-38"
              value={filters.from}
              onChange={(e) => setFilter("from", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            đến
            <Input
              type="date"
              className="w-38"
              value={filters.to}
              onChange={(e) => setFilter("to", e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            size="icon"
            className="ml-auto"
            aria-label="Tải lại"
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium text-destructive">Không tải được nhật ký</p>
            <p className="mt-1 text-muted-foreground">{error}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Người thực hiện</TableHead>
                  <TableHead>Hành động</TableHead>
                  <TableHead>Bản ghi</TableHead>
                  <TableHead>Thay đổi</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 ? (
                  Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                      Không có dòng nhật ký nào khớp bộ lọc
                    </TableCell>
                  </TableRow>
                ) : (
                  groups.flatMap((group) => {
                    const head = group[0];
                    const groupKey = `${head.txid}:${head.id}`;
                    if (group.length < GROUP_FROM || expanded.has(groupKey)) {
                      return group.map((entry) => (
                        <EntryRow
                          key={entry.id}
                          entry={entry}
                          names={names}
                          leadLabels={loaded?.leadLabels}
                          adsStatRefs={loaded?.adsStatRefs}
                        />
                      ));
                    }
                    return [
                      <TableRow key={groupKey} className="bg-muted/30">
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {format(new Date(head.at), "dd/MM/yyyy HH:mm:ss")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{actorName(head, names)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <ActionPill action={head.action} />
                        </TableCell>
                        <TableCell className="font-medium">
                          {group.length} {TABLE_LABELS[head.table_name] ?? head.table_name} trong một thao tác
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0"
                            onClick={() => setExpanded((prev) => new Set(prev).add(groupKey))}
                          >
                            Xem từng dòng
                          </Button>
                          {head.note && <p className="text-xs text-muted-foreground">{head.note}</p>}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{head.ip ?? "—"}</TableCell>
                      </TableRow>,
                    ];
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total.toLocaleString("vi-VN")} dòng nhật ký</span>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">
              Trang {page + 1}/{pageCount}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Trang trước"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Trang sau"
              disabled={page >= pageCount - 1}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const actorName = (entry: AuditEntry, names: CatalogNames) =>
  entry.actor_id ? (names.staff(entry.actor_id) ?? "Tài khoản đã gỡ") : "Hệ thống / Supabase";

function ActionPill({ action }: { action: AuditAction }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        action === "insert" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
        action === "update" && "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
        action === "delete" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
        action === "restore" && "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
        action === "purge" && "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
      )}
    >
      {ACTION_LABELS[action]}
    </span>
  );
}

function EntryRow({
  entry,
  names,
  leadLabels,
  adsStatRefs,
}: {
  entry: AuditEntry;
  names: CatalogNames;
  leadLabels?: Map<string, string>;
  adsStatRefs?: Map<string, AdsStatRef>;
}) {
  const changes = describeChanges(entry, names);
  return (
    <TableRow>
      <TableCell className="align-top whitespace-nowrap tabular-nums text-muted-foreground">
        {format(new Date(entry.at), "dd/MM/yyyy HH:mm:ss")}
      </TableCell>
      <TableCell className="align-top whitespace-nowrap">{actorName(entry, names)}</TableCell>
      <TableCell className="align-top whitespace-nowrap">
        <ActionPill action={entry.action} />
      </TableCell>
      <TableCell className="align-top">
        <div className="text-xs text-muted-foreground">
          {TABLE_LABELS[entry.table_name] ?? entry.table_name}
        </div>
        <div className="font-medium">{recordLabel(entry, names, leadLabels, adsStatRefs)}</div>
      </TableCell>
      <TableCell className="max-w-96 align-top whitespace-normal">
        {entry.note && <p className="text-xs text-muted-foreground">{entry.note}</p>}
        {changes.length > 0 ? (
          <ul className="grid gap-0.5">
            {changes.map((change) => (
              <li key={change.key} className="break-words">
                <span className="text-muted-foreground">{change.label}: </span>
                <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                  {change.from}
                </span>
                {" → "}
                {change.to}
              </li>
            ))}
          </ul>
        ) : (
          !entry.note && <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="align-top tabular-nums text-muted-foreground">{entry.ip ?? "—"}</TableCell>
    </TableRow>
  );
}

/**
 * Hoàn tác theo lô: chọn một tài khoản và một khoảng thời gian, xem trước những gì sẽ được
 * trả về như cũ, rồi mới hoàn tác. Kèm nút khoá / mở khoá tài khoản đang chọn.
 */
function BatchUndo({
  preset,
  staff,
  onDone,
}: {
  preset: UndoPreset;
  staff: StaffMember[];
  onDone: () => Promise<void>;
}) {
  const { userId, isSuperAdmin } = useRole();
  const [actor, setActor] = useState(preset.actor);
  const [from, setFrom] = useState(preset.from);
  const [to, setTo] = useState(preset.to);
  const [preview, setPreview] = useState<UndoSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [locking, setLocking] = useState(false);

  const member = staff.find((s) => s.user_id === actor);
  const ready = Boolean(member && from && to && new Date(to) > new Date(from));
  const nothingToUndo = preview !== null && preview.records === 0 && preview.trashed === 0;
  // Tài khoản quản trị thì chỉ Quản trị cấp cao khoá / mở được; không ai tự khoá mình.
  const canLock =
    member !== undefined &&
    member.user_id !== userId &&
    (isSuperAdmin || (member.role !== "admin" && member.role !== "super_admin"));

  function change(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setPreview(null);
    };
  }

  async function runPreview() {
    if (!ready) return;
    setBusy(true);
    try {
      setPreview(await undoChanges(actor, new Date(from), new Date(to), false));
    } catch (caught) {
      toast.error("Không xem trước được", { description: errorText(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const result = await undoChanges(actor, new Date(from), new Date(to), true);
    toast.success(
      `Đã hoàn tác ${result.records} bản ghi` +
        (result.trashed > 0 ? `, đưa ${result.trashed} bản ghi vào thùng rác` : ""),
      {
        description:
          result.conflicts > 0
            ? `${result.conflicts} thông tin được giữ nguyên vì sau đó đã có người khác sửa tiếp.`
            : undefined,
      },
    );
    setPreview(null);
    await onDone();
  }

  async function toggleLock() {
    if (!member) return;
    const lock = !member.locked_at;
    await setStaffLock(member.user_id, lock, lock ? "Quản trị khoá từ Nhật ký hệ thống" : undefined);
    toast.success(lock ? `Đã khoá tài khoản ${member.full_name}` : `Đã mở khoá tài khoản ${member.full_name}`);
    await onDone();
  }

  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="grid gap-1">
        <h2 className="flex items-center gap-2 font-medium">
          <Undo2 className="size-4" />
          Hoàn tác theo lô
        </h2>
        <p className="text-sm text-muted-foreground">
          Gỡ mọi thay đổi của một tài khoản trong một khoảng thời gian, ví dụ khi tài khoản bị
          lộ mật khẩu hoặc nhân viên sửa nhầm hàng loạt.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label>Tài khoản</Label>
          <Select value={actor} onValueChange={change(setActor)}>
            <SelectTrigger className="w-56" aria-label="Tài khoản cần hoàn tác">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Chọn tài khoản…</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.user_id} value={s.user_id}>
                  {s.full_name} — {ROLE_LABELS[s.role]}
                  {s.locked_at && " (đang khoá)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="undo-from">Từ lúc</Label>
          <Input
            id="undo-from"
            type="datetime-local"
            className="w-52"
            value={from}
            onChange={(e) => change(setFrom)(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="undo-to">Đến lúc</Label>
          <Input
            id="undo-to"
            type="datetime-local"
            className="w-52"
            value={to}
            onChange={(e) => change(setTo)(e.target.value)}
          />
        </div>
        <Button variant="outline" disabled={!ready || busy} onClick={runPreview}>
          {busy ? "Đang kiểm tra…" : "Xem trước"}
        </Button>
        {canLock && member && (
          <Button variant="outline" className="ml-auto" onClick={() => setLocking(true)}>
            {member.locked_at ? <LockOpen /> : <Lock />}
            {member.locked_at ? "Mở khoá tài khoản" : "Khoá tài khoản này"}
          </Button>
        )}
      </div>

      {preview && (
        <div className="grid gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          {nothingToUndo ? (
            <p>Không có thay đổi nào của tài khoản này trong khoảng thời gian đã chọn cần hoàn tác.</p>
          ) : (
            <ul className="grid gap-0.5">
              <li>
                • Trả <strong>{preview.records}</strong> bản ghi về giá trị cũ ({preview.columns} thông tin).
              </li>
              <li>
                • Đưa <strong>{preview.trashed}</strong> bản ghi do tài khoản này tạo vào thùng rác.
              </li>
              {preview.conflicts > 0 && (
                <li>
                  • Giữ nguyên {preview.conflicts} thông tin vì sau đó đã có người khác sửa tiếp.
                </li>
              )}
              {preview.gone > 0 && (
                <li>• Bỏ qua {preview.gone} bản ghi đã bị xoá vĩnh viễn.</li>
              )}
            </ul>
          )}
          {!nothingToUndo && (
            <Button variant="destructive" className="w-fit" onClick={() => setConfirming(true)}>
              <Undo2 />
              Hoàn tác các thay đổi này
            </Button>
          )}
        </div>
      )}

      <ConfirmActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Hoàn tác thay đổi của ${member?.full_name ?? "tài khoản này"}?`}
        description={
          <p>
            {preview?.records ?? 0} bản ghi sẽ trở về giá trị trước khi bị sửa và{" "}
            {preview?.trashed ?? 0} bản ghi mới tạo sẽ vào thùng rác. Lần hoàn tác này được ghi
            vào nhật ký dưới tên bạn.
          </p>
        }
        confirmLabel="Hoàn tác"
        destructive
        onConfirm={apply}
      />
      <ConfirmActionDialog
        open={locking}
        onOpenChange={setLocking}
        title={member?.locked_at ? `Mở khoá ${member.full_name}?` : `Khoá tài khoản ${member?.full_name ?? ""}?`}
        description={
          <p>
            {member?.locked_at
              ? "Tài khoản sẽ xem và sửa dữ liệu lại được như trước."
              : "Tài khoản bị khoá vẫn đăng nhập được nhưng không xem hay sửa được dữ liệu nào, và không được chia lead."}
          </p>
        }
        confirmLabel={member?.locked_at ? "Mở khoá" : "Khoá tài khoản"}
        destructive={!member?.locked_at}
        onConfirm={toggleLock}
      />
    </section>
  );
}
