"use client";

import { format } from "date-fns";
import { BellRing, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useCatalogNames } from "@/components/catalog-provider";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { updateLead } from "@/lib/leads/repo";
import {
  LEAD_STATUSES,
  getLeadStatus,
  type LeadStatusKey,
} from "@/lib/leads/status";
import type { Lead } from "@/lib/leads/types";
import { softDeleteRecords } from "@/lib/safety/repo";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const ALL = "__all";
/** Chuyển vào Thùng rác quá số này phải nhập lại mật khẩu (máy chủ kiểm tra lại theo cấu hình thật). */
const PASSWORD_OVER = 20;

/** Bỏ dấu tiếng Việt để tìm "ha" ra cả "Hà". */
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: getLeadStatus(status).color }}
    />
  );
}

type Props = {
  leads: Lead[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (lead: Lead) => void;
  onLeadUpdated: (lead: Lead) => void;
  /** Người được tick quyền Xoá dữ liệu mới thấy ô chọn và nút Chuyển vào thùng rác. */
  canDelete: boolean;
  onLeadsDeleted: (ids: string[]) => void;
};

export function LeadsTable({
  leads,
  loading,
  onAdd,
  onEdit,
  onLeadUpdated,
  canDelete,
  onLeadsDeleted,
}: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  /** Chỉ xem lead mà khách vừa nhắn lại, telesale chưa xử lý. */
  const [onlyRecontacted, setOnlyRecontacted] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const names = useCatalogNames();
  const recontactedCount = useMemo(
    () => leads.filter((lead) => lead.recontacted_at).length,
    [leads],
  );

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return leads.filter((lead) => {
      if (onlyRecontacted && !lead.recontacted_at) return false;
      if (status !== ALL && lead.status !== status) return false;
      if (!q) return true;
      return [lead.full_name, lead.phone, lead.ads_id, lead.note, lead.service]
        .filter(Boolean)
        .some((field) => normalize(field as string).includes(q));
    });
  }, [leads, query, status, onlyRecontacted]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Chỉ tính những lead đang chọn mà còn nằm trong kết quả lọc hiện tại.
  const chosen = filtered.filter((lead) => selected.has(lead.id));
  const pageChosen = rows.length > 0 && rows.every((lead) => selected.has(lead.id));
  const columnCount = canDelete ? 11 : 10;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const lead of rows) {
        if (pageChosen) next.delete(lead.id);
        else next.add(lead.id);
      }
      return next;
    });
  }

  async function changeStatus(lead: Lead, next: LeadStatusKey) {
    if (next === lead.status) return;
    try {
      onLeadUpdated(await updateLead(lead.id, { status: next }));
      toast.success(`${lead.full_name}: ${getLeadStatus(next).label}`);
    } catch (error) {
      toast.error("Không đổi được trạng thái", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function deleteChosen() {
    const ids = chosen.map((lead) => lead.id);
    const deleted = await softDeleteRecords("leads", ids);
    toast.success(`Đã chuyển ${deleted} lead vào Thùng rác`, {
      description: "Quản trị có thể khôi phục trong Cài đặt → Thùng rác.",
    });
    setSelected(new Set());
    onLeadsDeleted(ids);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-96">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Tìm tên, SĐT, ID Ads, ghi chú..."
            aria-label="Tìm lead"
            className="pl-8"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-52" aria-label="Lọc theo trạng thái">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả trạng thái</SelectItem>
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                <StatusDot status={s.key} />
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {recontactedCount > 0 && (
          <Button
            variant="outline"
            aria-pressed={onlyRecontacted}
            className={cn(onlyRecontacted && "border-amber-400 bg-amber-50 dark:bg-amber-950/40")}
            onClick={() => {
              setOnlyRecontacted((v) => !v);
              setPage(0);
            }}
          >
            <BellRing className="text-amber-600" />
            Khách nhắn lại ({recontactedCount})
          </Button>
        )}
        <Button className="ml-auto" onClick={onAdd}>
          <Plus />
          Thêm lead
        </Button>
      </div>

      {canDelete && chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-accent/40 px-3 py-2 text-sm">
          <span className="font-medium">Đã chọn {chosen.length} lead</span>
          {chosen.length < filtered.length && (
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0"
              onClick={() => setSelected(new Set(filtered.map((lead) => lead.id)))}
            >
              Chọn cả {filtered.length.toLocaleString("vi-VN")} lead đang lọc
            </Button>
          )}
          <Button size="sm" variant="destructive" onClick={() => setConfirmingDelete(true)}>
            <Trash2 />
            Chuyển vào thùng rác
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </Button>
        </div>
      )}

      {/* Điện thoại: mỗi lead một thẻ (bấm số để gọi). Màn hình rộng: bảng đầy đủ cột. */}
      <div className="grid gap-2 md:hidden">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)
        ) : rows.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            {leads.length === 0 ? "Chưa có lead nào trong khoảng thời gian này" : "Không tìm thấy lead phù hợp"}
          </p>
        ) : (
          rows.map((lead) => (
            <article
              key={lead.id}
              className={cn("grid gap-2 rounded-xl border bg-card p-3", selected.has(lead.id) && "border-primary/60 bg-primary/5")}
            >
              <div className="flex items-start gap-2.5">
                {canDelete && (
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    aria-label={`Chọn lead ${lead.full_name}`}
                    checked={selected.has(lead.id)}
                    onChange={() => toggle(lead.id)}
                  />
                )}
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{lead.full_name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {format(new Date(lead.created_at), "dd/MM HH:mm")}
                    </span>
                  </div>
                  <a href={`tel:${lead.phone}`} className="w-fit text-sm font-medium text-primary tabular-nums underline-offset-2 hover:underline">
                    {lead.phone}
                  </a>
                  <span className="truncate text-xs text-muted-foreground">
                    {[lead.service, names.channel(lead.channel_id) ?? lead.source, lead.page_id ? names.page(lead.page_id) : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                  {(lead.recontacted_at || lead.invalid_phone || lead.reopened_at) && (
                    <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
                      {lead.recontacted_at && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">Nhắn lại</span>
                      )}
                      {lead.reopened_at && (
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">Mở lại</span>
                      )}
                      {lead.invalid_phone && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-900/50 dark:text-red-200">Số sai</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={lead.status} onValueChange={(v) => changeStatus(lead, v as LeadStatusKey)}>
                  <SelectTrigger className="h-9 min-w-0 flex-1" aria-label={`Trạng thái của ${lead.full_name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        <StatusDot status={s.key} />
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" className="size-9 shrink-0" aria-label={`Sửa lead ${lead.full_name}`} onClick={() => onEdit(lead)}>
                  <Pencil />
                </Button>
              </div>
              {(lead.assignee || lead.appointment_at || lead.note) && (
                <div className="grid gap-0.5 text-xs text-muted-foreground">
                  {(lead.assignee || lead.appointment_at) && (
                    <span>
                      {lead.assignee ?? "Chưa giao"}
                      {lead.appointment_at && ` · Hẹn ${format(new Date(lead.appointment_at), "dd/MM HH:mm")}`}
                    </span>
                  )}
                  {lead.note && <span className="line-clamp-2">{lead.note}</span>}
                </div>
              )}
            </article>
          ))
        )}
      </div>

      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {canDelete && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    aria-label="Chọn mọi lead trên trang này"
                    checked={pageChosen}
                    disabled={rows.length === 0}
                    onChange={togglePage}
                  />
                </TableHead>
              )}
              <TableHead>Ngày tạo</TableHead>
              <TableHead>Khách hàng</TableHead>
              <TableHead>SĐT</TableHead>
              <TableHead>Dịch vụ</TableHead>
              <TableHead>Nguồn</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead>Nhân viên</TableHead>
              <TableHead>Lịch hẹn</TableHead>
              <TableHead>Ghi chú</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columnCount}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columnCount}
                  className="h-28 text-center text-muted-foreground"
                >
                  {leads.length === 0
                    ? "Chưa có lead nào trong khoảng thời gian này"
                    : "Không tìm thấy lead phù hợp"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((lead) => (
                <TableRow key={lead.id} data-state={selected.has(lead.id) ? "selected" : undefined}>
                  {canDelete && (
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        aria-label={`Chọn lead ${lead.full_name}`}
                        checked={selected.has(lead.id)}
                        onChange={() => toggle(lead.id)}
                      />
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {format(new Date(lead.created_at), "dd/MM HH:mm")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="font-medium">{lead.full_name}</div>
                    {(lead.recontacted_at || lead.invalid_phone || lead.reopened_at) && (
                      <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
                        {lead.recontacted_at && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                            Nhắn lại
                          </span>
                        )}
                        {lead.reopened_at && (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
                            Mở lại
                          </span>
                        )}
                        {lead.invalid_phone && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-900/50 dark:text-red-200">
                            Số sai
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{lead.phone}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {lead.service ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-56">
                    <div className="truncate">
                      {names.channel(lead.channel_id) ?? lead.source ?? "—"}
                      {lead.page_id && ` › ${names.page(lead.page_id) ?? "…"}`}
                    </div>
                    {(lead.campaign_id || lead.ads_id) && (
                      <div className="truncate text-xs text-muted-foreground">
                        {[names.campaign(lead.campaign_id), lead.ads_id]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={lead.status}
                      onValueChange={(v) => changeStatus(lead, v as LeadStatusKey)}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-44"
                        aria-label={`Trạng thái của ${lead.full_name}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_STATUSES.map((s) => (
                          <SelectItem key={s.key} value={s.key}>
                            <StatusDot status={s.key} />
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {lead.assignee ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {lead.appointment_at
                      ? format(new Date(lead.appointment_at), "dd/MM/yyyy HH:mm")
                      : "—"}
                  </TableCell>
                  <TableCell
                    className="max-w-56 truncate text-muted-foreground"
                    title={lead.note ?? undefined}
                  >
                    {lead.note ?? ""}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Sửa lead ${lead.full_name}`}
                      onClick={() => onEdit(lead)}
                    >
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {filtered.length.toLocaleString("vi-VN")} lead
          {filtered.length !== leads.length &&
            ` (lọc từ ${leads.length.toLocaleString("vi-VN")})`}
        </span>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            Trang {currentPage + 1}/{pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Trang trước"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
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
      </div>

      <ConfirmActionDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Chuyển ${chosen.length} lead vào thùng rác?`}
        description={
          <>
            <p>
              {chosen.length === 1
                ? `Lead ${chosen[0].full_name} (${chosen[0].phone})`
                : `${chosen.length} lead đã chọn`}{" "}
              sẽ được chuyển vào Thùng rác và không còn hiện trong danh sách. Không số nào bị
              xoá: Quản trị có thể khôi phục trong Cài đặt → Thùng rác.
            </p>
            {chosen.length > PASSWORD_OVER && (
              <p>Chuyển hơn {PASSWORD_OVER} bản ghi một lúc cần nhập lại mật khẩu của bạn.</p>
            )}
          </>
        }
        confirmLabel="Chuyển vào Thùng rác"
        destructive
        needsPassword={chosen.length > PASSWORD_OVER}
        onConfirm={deleteChosen}
      />
    </div>
  );
}
