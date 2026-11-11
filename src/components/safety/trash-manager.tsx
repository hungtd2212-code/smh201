"use client";

import { format } from "date-fns";
import { ArchiveRestore, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/catalog/shared";
import { useCatalogNames, useCatalogs } from "@/components/catalog-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TABLE_LABELS } from "@/lib/safety/labels";
import {
  fetchSafetySettings,
  fetchTrash,
  purgeRecords,
  restoreRecords,
} from "@/lib/safety/repo";
import type { SoftDeleteTable, TrashItem } from "@/lib/safety/types";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { AdminOnly, errorText, useRole } from "./shared";

const ALL = "__all";
const DAY_MS = 24 * 3600 * 1000;
const TRASH_TABLES: SoftDeleteTable[] = ["leads", "channels", "pages", "campaigns", "services"];

const keyOf = (item: TrashItem) => `${item.table_name}:${item.id}`;

/** Gom các mục theo bảng để gọi máy chủ mỗi bảng một lần. */
function groupByTable(items: TrashItem[]) {
  const groups = new Map<SoftDeleteTable, string[]>();
  for (const item of items) {
    groups.set(item.table_name, [...(groups.get(item.table_name) ?? []), item.id]);
  }
  return groups;
}

/** Cài đặt → Thùng rác: mọi thứ đã bị chuyển vào đây, lọc theo loại / người chuyển / ngày, khôi phục. */
export function TrashManager() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={Trash2}
        title="Thùng rác"
        description="Không ai xoá hẳn được dữ liệu: thứ gì bị bỏ đi đều nằm ở đây. Quản trị khôi phục được bất cứ lúc nào; chỉ Quản trị cấp cao mới xoá vĩnh viễn."
      />
      <AdminOnly>
        <TrashContent />
      </AdminOnly>
    </div>
  );
}

type Loaded = { items: TrashItem[]; minDays: number; loadedAt: number };

function TrashContent() {
  const { isSuperAdmin } = useRole();
  const { reload: reloadCatalogs } = useCatalogs();
  const names = useCatalogNames();

  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState<{ key: number; data?: Loaded; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTrash(), fetchSafetySettings()])
      .then(([items, settings]) => {
        if (!cancelled)
          setState({ key: reloadCount, data: { items, minDays: settings.trash_min_days, loadedAt: Date.now() } });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ key: reloadCount, error: errorText(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadCount]);

  const loading = state?.key !== reloadCount;
  const data = state?.data;

  const [type, setType] = useState(ALL);
  const [deleter, setDeleter] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [purging, setPurging] = useState<TrashItem[] | null>(null);

  const items = useMemo(() => data?.items ?? [], [data]);
  const deleters = useMemo(
    () => [...new Set(items.map((item) => item.deleted_by).filter((id): id is string => Boolean(id)))],
    [items],
  );

  const rows = useMemo(() => {
    const start = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const end = to ? new Date(`${to}T00:00:00`).getTime() + DAY_MS : null;
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (type !== ALL && item.table_name !== type) return false;
      if (deleter !== ALL && item.deleted_by !== deleter) return false;
      const at = new Date(item.deleted_at).getTime();
      if (start !== null && at < start) return false;
      if (end !== null && at >= end) return false;
      return !q || item.label.toLowerCase().includes(q);
    });
  }, [items, type, deleter, from, to, query]);

  const chosen = rows.filter((item) => selected.has(keyOf(item)));
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  /** Còn bao nhiêu ngày nữa mới được xoá vĩnh viễn (≤ 0 = đã đủ điều kiện). */
  const daysLeft = (item: TrashItem) =>
    data ? Math.ceil(data.minDays - (data.loadedAt - new Date(item.deleted_at).getTime()) / DAY_MS) : 0;

  function toggle(item: TrashItem) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = keyOf(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function restore(targets: TrashItem[]) {
    setBusy(true);
    try {
      const total = { restored: 0, conflicts: 0, blocked: 0 };
      for (const [table, ids] of groupByTable(targets)) {
        const result = await restoreRecords(table, ids);
        total.restored += result.restored;
        total.conflicts += result.conflicts;
        total.blocked += result.blocked;
      }
      const problems = [
        total.conflicts > 0 &&
          `${total.conflicts} mục không khôi phục được vì đã có bản ghi khác đang dùng cùng số điện thoại / cùng tên`,
        total.blocked > 0 &&
          `${total.blocked} mục cần khôi phục kênh hoặc page chứa nó trước`,
      ].filter(Boolean);

      if (total.restored > 0) {
        toast.success(`Đã khôi phục ${total.restored} mục`, {
          description: problems.join(". ") || undefined,
        });
      } else {
        toast.error("Không khôi phục được mục nào", { description: problems.join(". ") || undefined });
      }
      setSelected(new Set());
      setReloadCount((n) => n + 1);
      await reloadCatalogs();
    } catch (error) {
      toast.error("Không khôi phục được", { description: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function purge(targets: TrashItem[]) {
    let purged = 0;
    for (const [table, ids] of groupByTable(targets)) purged += await purgeRecords(table, ids);
    toast.success(`Đã xoá vĩnh viễn ${purged} mục`);
    setSelected(new Set());
    setReloadCount((n) => n + 1);
    await reloadCatalogs();
  }

  if (state?.error && !loading) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
        <p className="font-medium text-destructive">Không tải được thùng rác</p>
        <p className="mt-1 text-muted-foreground">{state.error}</p>
      </div>
    );
  }

  const purgeable = chosen.filter((item) => daysLeft(item) <= 0);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Tìm tên, SĐT…"
            aria-label="Tìm trong thùng rác"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-44" aria-label="Lọc theo loại dữ liệu">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi loại dữ liệu</SelectItem>
            {TRASH_TABLES.map((table) => (
              <SelectItem key={table} value={table}>
                {TABLE_LABELS[table]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={deleter} onValueChange={setDeleter}>
          <SelectTrigger className="w-48" aria-label="Lọc theo người chuyển vào">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi người chuyển vào</SelectItem>
            {deleters.map((id) => (
              <SelectItem key={id} value={id}>
                {names.staff(id) ?? "Tài khoản đã gỡ"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Chuyển vào từ
          <Input type="date" className="w-38" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          đến
          <Input type="date" className="w-38" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button
          variant="outline"
          size="icon"
          className="ml-auto"
          aria-label="Tải lại"
          disabled={loading}
          onClick={() => setReloadCount((n) => n + 1)}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-accent/40 px-3 py-2 text-sm">
          <span className="font-medium">Đã chọn {chosen.length} mục</span>
          <Button size="sm" disabled={busy} onClick={() => restore(chosen)}>
            <ArchiveRestore />
            Khôi phục
          </Button>
          {isSuperAdmin && (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || purgeable.length === 0}
              title={purgeable.length === 0 ? "Chưa mục nào đủ số ngày trong thùng rác" : undefined}
              onClick={() => setPurging(purgeable)}
            >
              <Trash2 />
              Xoá vĩnh viễn ({purgeable.length})
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label="Chọn tất cả"
                  checked={allChosen}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(rows.map(keyOf)))}
                />
              </TableHead>
              <TableHead>Loại</TableHead>
              <TableHead>Bản ghi</TableHead>
              <TableHead>Người chuyển vào</TableHead>
              <TableHead>Ngày chuyển vào</TableHead>
              {isSuperAdmin && <TableHead>Xoá vĩnh viễn</TableHead>}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data ? (
              Array.from({ length: 4 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                  {items.length === 0 ? "Thùng rác đang trống" : "Không có mục nào khớp bộ lọc"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((item) => {
                const left = daysLeft(item);
                return (
                  <TableRow key={keyOf(item)}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        aria-label={`Chọn ${item.label}`}
                        checked={selected.has(keyOf(item))}
                        onChange={() => toggle(item)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{TABLE_LABELS[item.table_name]}</TableCell>
                    <TableCell className="font-medium">{item.label}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {(item.deleted_by && names.staff(item.deleted_by)) || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {format(new Date(item.deleted_at), "dd/MM/yyyy HH:mm")}
                    </TableCell>
                    {isSuperAdmin && (
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {left > 0 ? `Sau ${left} ngày nữa` : "Đã đủ điều kiện"}
                      </TableCell>
                    )}
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Khôi phục ${item.label}`}
                        title="Khôi phục"
                        disabled={busy}
                        onClick={() => restore([item])}
                      >
                        <ArchiveRestore />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-1 text-sm text-muted-foreground">
        <li>• Dữ liệu trong thùng rác được giữ tối thiểu {data?.minDays ?? 90} ngày và không tự mất đi.</li>
        <li>• Chỉ Quản trị cấp cao được xoá vĩnh viễn, sau khi đủ số ngày trên và nhập lại mật khẩu.</li>
        <li>• Số điện thoại của lead trong thùng rác coi như chưa có: dán lại số đó sẽ tạo lead mới.</li>
      </ul>

      <ConfirmActionDialog
        open={purging !== null}
        onOpenChange={(open) => !open && setPurging(null)}
        title={`Xoá vĩnh viễn ${purging?.length ?? 0} mục?`}
        description={
          <>
            <p>
              Sau bước này <strong>không khôi phục được nữa</strong> từ trong ứng dụng. Với lead,
              toàn bộ các lần tiếp cận của lead đó cũng bị xoá.
            </p>
            <p>Nhật ký hệ thống vẫn giữ một bản chụp của dữ liệu đã xoá.</p>
          </>
        }
        confirmLabel="Xoá vĩnh viễn"
        destructive
        needsPassword
        onConfirm={() => purge(purging ?? [])}
      />
    </div>
  );
}
