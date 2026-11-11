"use client";

import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Pencil, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
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

const PAGE_SIZE = 20;
const ALL = "__all";

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
};

export function LeadsTable({ leads, loading, onAdd, onEdit, onLeadUpdated }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return leads.filter((lead) => {
      if (status !== ALL && lead.status !== status) return false;
      if (!q) return true;
      return [lead.full_name, lead.phone, lead.ads_id, lead.note, lead.service]
        .filter(Boolean)
        .some((field) => normalize(field as string).includes(q));
    });
  }, [leads, query, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

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
        <Button className="ml-auto" onClick={onAdd}>
          <Plus />
          Thêm lead
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
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
                  <TableCell colSpan={10}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="h-28 text-center text-muted-foreground"
                >
                  {leads.length === 0
                    ? "Chưa có lead nào trong khoảng thời gian này"
                    : "Không tìm thấy lead phù hợp"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {format(new Date(lead.created_at), "dd/MM HH:mm")}
                  </TableCell>
                  <TableCell className="font-medium whitespace-nowrap">
                    {lead.full_name}
                  </TableCell>
                  <TableCell className="tabular-nums">{lead.phone}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {lead.service ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div>{lead.source ?? "—"}</div>
                    {lead.ads_id && (
                      <div className="text-xs text-muted-foreground">{lead.ads_id}</div>
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
    </div>
  );
}
