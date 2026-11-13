"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus } from "lucide-react";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { moveStatus, STATUS_PALETTE } from "@/lib/leads/crm";
import { reorderLeadStatuses, saveLeadStatus } from "@/lib/leads/repo";
import type { LeadStatusRow } from "@/lib/leads/types";
import { cn } from "@/lib/utils";
import { StatusChip } from "./status-chip";

type Draft = Pick<LeadStatusRow, "name" | "color" | "text_color" | "needs_appointment" | "needs_deal">;

const NEW_DRAFT: Draft = {
  name: "",
  color: STATUS_PALETTE[0].color,
  text_color: STATUS_PALETTE[0].text_color,
  needs_appointment: false,
  needs_deal: false,
};

/**
 * Trạng thái khách hàng: thêm, đổi tên, đổi màu, ẩn / hiện, nút ↑ ↓ để đổi thứ tự. Thứ tự ở đây chính là thứ tự
 * trong ô chọn Tình trạng của mỗi số. Không xoá được (số cũ có thể đang dùng) — chỉ ẩn.
 */
export function StatusSettings({
  statuses,
  canManage,
  onChanged,
}: {
  statuses: LeadStatusRow[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const ordered = [...statuses].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "vi"));

  async function run(action: () => Promise<void>, failMessage: string) {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (error) {
      toast.error(failMessage, { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const move = (id: string, direction: -1 | 1) =>
    run(() => reorderLeadStatuses(moveStatus(ordered.map((s) => s.id), id, direction)), "Không đổi được thứ tự");

  const toggle = (status: LeadStatusRow) =>
    run(async () => {
      await saveLeadStatus(status.id, { is_active: !status.is_active });
      toast.success(`${status.name}: ${status.is_active ? "đã ẩn" : "đã hiện lại"}`);
    }, "Không đổi được");

  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="font-semibold">Trạng thái khách hàng</h2>
          <p className="text-sm text-muted-foreground">
            Thứ tự ở đây là thứ tự trong ô chọn Tình trạng của mỗi số. Trạng thái không dùng nữa thì ẩn đi.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setEditing({ id: null, draft: NEW_DRAFT })} disabled={busy}>
            <Plus />
            Thêm trạng thái
          </Button>
        )}
      </div>

      <ul className="grid divide-y rounded-lg border">
        {ordered.map((status, index) => (
          <li key={status.id} className={cn("flex items-center gap-2 px-2 py-2", !status.is_active && "opacity-55")}>
            {canManage && (
              <span className="flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Đưa ${status.name} lên`}
                  disabled={busy || index === 0}
                  onClick={() => move(status.id, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Đưa ${status.name} xuống`}
                  disabled={busy || index === ordered.length - 1}
                  onClick={() => move(status.id, 1)}
                >
                  <ArrowDown />
                </Button>
              </span>
            )}
            <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
            <StatusChip status={status} className="shrink-0" />
            <span className="flex min-w-0 flex-1 flex-wrap gap-1 text-xs text-muted-foreground">
              {status.needs_appointment && <span className="rounded bg-muted px-1.5 py-0.5">Bắt nhập lịch hẹn</span>}
              {status.needs_deal && <span className="rounded bg-muted px-1.5 py-0.5">Bắt nhập doanh số</span>}
              {!status.is_active && <span className="rounded bg-muted px-1.5 py-0.5">Đang ẩn</span>}
            </span>
            {canManage && (
              <span className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setEditing({
                      id: status.id,
                      draft: {
                        name: status.name,
                        color: status.color,
                        text_color: status.text_color,
                        needs_appointment: status.needs_appointment,
                        needs_deal: status.needs_deal,
                      },
                    })
                  }
                >
                  <Pencil />
                  Sửa
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggle(status)}>
                  {status.is_active ? <EyeOff /> : <Eye />}
                  {status.is_active ? "Ẩn" : "Hiện lại"}
                </Button>
              </span>
            )}
          </li>
        ))}
        {ordered.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">Chưa có trạng thái nào.</li>}
      </ul>

      <StatusDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={(id, draft) =>
          run(async () => {
            await saveLeadStatus(id, id ? draft : { ...draft, sort_order: ordered.length + 1 });
            toast.success(id ? `Đã lưu “${draft.name}”` : `Đã thêm “${draft.name}”`);
            setEditing(null);
          }, "Không lưu được trạng thái")
        }
        busy={busy}
      />
    </section>
  );
}

function StatusDialog({
  editing,
  onClose,
  onSave,
  busy,
}: {
  editing: { id: string | null; draft: Draft } | null;
  onClose: () => void;
  onSave: (id: string | null, draft: Draft) => void;
  busy: boolean;
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {editing && <StatusForm key={editing.id ?? "new"} editing={editing} onClose={onClose} onSave={onSave} busy={busy} />}
      </DialogContent>
    </Dialog>
  );
}

function StatusForm({
  editing,
  onClose,
  onSave,
  busy,
}: {
  editing: { id: string | null; draft: Draft };
  onClose: () => void;
  onSave: (id: string | null, draft: Draft) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(editing.draft);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const name = draft.name.trim();
        if (!name) {
          setError("Nhập tên trạng thái");
          return;
        }
        onSave(editing.id, { ...draft, name });
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing.id ? "Sửa trạng thái" : "Thêm trạng thái"}</DialogTitle>
        <DialogDescription>Tên ngắn gọn như trong bảng tính, ví dụ “KNM”, “Đặt lịch hẹn”.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="status-name">Tên trạng thái</Label>
        <Input
          id="status-name"
          value={draft.name}
          maxLength={60}
          autoFocus
          onChange={(e) => {
            setDraft((d) => ({ ...d, name: e.target.value }));
            setError(null);
          }}
          aria-invalid={Boolean(error)}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="grid gap-1.5">
        <Label>Màu</Label>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_PALETTE.map((p) => {
            const picked = p.color === draft.color && p.text_color === draft.text_color;
            return (
              <button
                key={p.color}
                type="button"
                title={p.label}
                aria-label={`Màu ${p.label}`}
                aria-pressed={picked}
                className={cn(
                  "size-8 rounded-full border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  picked && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundColor: p.color }}
                onClick={() => setDraft((d) => ({ ...d, color: p.color, text_color: p.text_color }))}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
          Xem trước: <StatusChip status={{ ...draft, name: draft.name.trim() || "Tên trạng thái" }} />
        </div>
      </div>

      <div className="grid gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={draft.needs_appointment}
            onChange={(e) => setDraft((d) => ({ ...d, needs_appointment: e.target.checked }))}
          />
          Chọn trạng thái này thì phải nhập lịch hẹn
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={draft.needs_deal}
            onChange={(e) => setDraft((d) => ({ ...d, needs_deal: e.target.checked }))}
          />
          Chọn trạng thái này thì phải nhập doanh số
        </label>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Huỷ
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu"}
        </Button>
      </DialogFooter>
    </form>
  );
}
