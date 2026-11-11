"use client";

import { format } from "date-fns";
import { ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCatalogNames, useCatalogs } from "@/components/catalog-provider";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
import { RecordHistory } from "@/components/safety/record-history";
import { useRole } from "@/components/safety/shared";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchLead, fetchLeadTouches, updateLead } from "@/lib/leads/repo";
import { LEAD_STATUSES, type LeadStatusKey } from "@/lib/leads/status";
import {
  TOUCH_RESULT_LABELS,
  type Lead,
  type LeadPatch,
  type LeadTouch,
} from "@/lib/leads/types";
import { softDeleteRecords } from "@/lib/safety/repo";
import { cn } from "@/lib/utils";

/** Giá trị đại diện cho "không chọn" (Select không nhận chuỗi rỗng). */
const NONE = "__none";

type FormState = {
  full_name: string;
  service_id: string;
  status: LeadStatusKey;
  assignee_id: string;
  appointment_at: string; // định dạng của <input type="datetime-local">
  note: string;
  invalid_phone: boolean;
};

const toFormState = (lead: Lead): FormState => ({
  full_name: lead.full_name,
  service_id: lead.service_id ?? NONE,
  status: lead.status,
  assignee_id: lead.assignee_id ?? NONE,
  appointment_at: lead.appointment_at
    ? format(new Date(lead.appointment_at), "yyyy-MM-dd'T'HH:mm")
    : "",
  note: lead.note ?? "",
  invalid_phone: lead.invalid_phone,
});

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  /** Telesale bấm Lưu: nơi dùng cập nhật danh sách và đóng hộp thoại. */
  onSaved: (lead: Lead) => void;
  /** Lead vừa được hoàn tác về một phiên bản cũ: cập nhật danh sách, hộp thoại vẫn mở. */
  onChanged: (lead: Lead) => void;
  /** Lead vừa được chuyển vào Thùng rác. */
  onDeleted: (id: string) => void;
};

/** Hộp thoại telesale xử lý một lead: trạng thái, lịch hẹn, ghi chú, đánh dấu số sai, lịch sử. */
export function LeadDialog({ open, onOpenChange, lead, ...handlers }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h + cuộn: trên màn hình thấp, form dài hơn màn hình vẫn dùng được. */}
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        {/* key: mỗi lần mở cho một lead khác thì mọi thứ được khởi tạo lại. */}
        {open && lead && (
          <LeadPanel
            key={lead.id}
            lead={lead}
            onClose={() => onOpenChange(false)}
            {...handlers}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Tab = "form" | "history";

function LeadPanel({
  lead,
  onSaved,
  onChanged,
  onDeleted,
  onClose,
}: Omit<Props, "open" | "onOpenChange" | "lead"> & { lead: Lead; onClose: () => void }) {
  const { isManager, canDelete } = useRole();
  const [tab, setTab] = useState<Tab>("form");
  /** Tăng lên sau mỗi lần hoàn tác để form nạp lại giá trị mới của lead. */
  const [revision, setRevision] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleReverted() {
    const fresh = await fetchLead(lead.id);
    if (fresh) onChanged(fresh);
    setRevision((n) => n + 1);
  }

  async function handleDelete() {
    await softDeleteRecords("leads", [lead.id]);
    toast.success(`Đã chuyển lead ${lead.full_name} vào Thùng rác`, {
      description: "Quản trị có thể khôi phục trong Cài đặt → Thùng rác.",
    });
    onDeleted(lead.id);
    onClose();
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Xử lý lead — {lead.phone}</DialogTitle>
        <DialogDescription>
          Tạo {format(new Date(lead.created_at), "dd/MM/yyyy HH:mm")}
          {lead.reopened_at &&
            ` · mở lại ${format(new Date(lead.reopened_at), "dd/MM/yyyy")}`}
          {lead.recontacted_at &&
            ` · khách nhắn lại ${format(new Date(lead.recontacted_at), "dd/MM HH:mm")}`}
        </DialogDescription>
      </DialogHeader>

      <div role="tablist" aria-label="Nội dung lead" className="flex w-fit gap-1 rounded-lg bg-muted p-1 text-sm">
        {(
          [
            ["form", "Xử lý"],
            ["history", "Lịch sử thay đổi"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-md px-3 py-1 font-medium text-muted-foreground transition-colors",
              tab === key && "bg-background text-foreground shadow-xs",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Form luôn được giữ (chỉ ẩn đi) để chuyển tab không làm mất những gì đang nhập dở. */}
      <div className={tab === "form" ? undefined : "hidden"}>
        <LeadForm
          key={revision}
          lead={lead}
          onSaved={onSaved}
          onCancel={onClose}
          onDelete={canDelete ? () => setConfirmingDelete(true) : undefined}
        />
      </div>
      {tab === "history" && (
        <RecordHistory
          table="leads"
          recordId={lead.id}
          canRevert={isManager}
          onReverted={handleReverted}
        />
      )}

      <ConfirmActionDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Chuyển lead này vào thùng rác?"
        description={
          <p>
            Lead {lead.full_name} ({lead.phone}) sẽ được chuyển vào Thùng rác và không còn hiện
            trong danh sách. Số này không bị xoá: Quản trị có thể khôi phục trong Cài đặt → Thùng
            rác.
          </p>
        }
        confirmLabel="Chuyển vào Thùng rác"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}

function LeadForm({
  lead,
  onSaved,
  onCancel,
  onDelete,
}: {
  lead: Lead;
  onSaved: Props["onSaved"];
  onCancel: () => void;
  /** Có giá trị = người dùng được tick quyền Xoá dữ liệu, nên thấy nút Chuyển vào thùng rác. */
  onDelete?: () => void;
}) {
  const { catalogs } = useCatalogs();
  const names = useCatalogNames();
  const [form, setForm] = useState(() => toFormState(lead));
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Luôn giữ dịch vụ / người phụ trách hiện tại trong danh sách dù đã bị tắt.
  const services = catalogs.services.filter((s) => s.is_active || s.id === lead.service_id);
  const assignees = catalogs.staff.filter(
    (s) =>
      s.user_id === lead.assignee_id ||
      (!s.locked_at && (s.accepts_leads || s.role === "sale" || s.role === "lead")),
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const fullName = form.full_name.trim();
    if (!fullName) {
      setNameError("Nhập tên khách hàng");
      return;
    }

    const serviceId = form.service_id === NONE ? null : form.service_id;
    const assigneeId = form.assignee_id === NONE ? null : form.assignee_id;

    const patch: LeadPatch = {
      full_name: fullName,
      status: form.status,
      appointment_at: form.appointment_at ? new Date(form.appointment_at).toISOString() : null,
      note: form.note.trim() || null,
      invalid_phone: form.invalid_phone,
      // Telesale đã mở và lưu lead → coi như đã xử lý việc khách nhắn lại.
      recontacted_at: null,
    };
    if (serviceId !== lead.service_id) {
      patch.service_id = serviceId;
      patch.service = catalogs.services.find((s) => s.id === serviceId)?.name ?? null;
    }
    if (assigneeId !== lead.assignee_id) {
      patch.assignee_id = assigneeId;
      patch.assignee = catalogs.staff.find((s) => s.user_id === assigneeId)?.full_name ?? null;
      patch.assign_mode = assigneeId ? "manual" : null;
    }

    setSaving(true);
    try {
      onSaved(await updateLead(lead.id, patch));
      toast.success("Đã cập nhật lead");
    } catch (error) {
      toast.error("Không lưu được lead", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  const sourceParts = [
    names.channel(lead.channel_id) ?? lead.source,
    names.page(lead.page_id),
    names.campaign(lead.campaign_id),
  ].filter(Boolean);

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
        <div>
          <span className="text-muted-foreground">Nguồn gần nhất: </span>
          {sourceParts.length > 0 ? sourceParts.join(" › ") : "Chưa rõ"}
          {lead.ads_id && <span className="text-muted-foreground"> · ID Ads {lead.ads_id}</span>}
        </div>
        {lead.pancake_url && /^https?:\/\//i.test(lead.pancake_url) && (
          <a
            href={lead.pancake_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex w-fit items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            Mở hội thoại Pancake <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tên khách hàng *" htmlFor="lead-name" error={nameError ?? undefined}>
          <Input
            id="lead-name"
            value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            aria-invalid={Boolean(nameError)}
          />
        </Field>
        <Field label="Dịch vụ quan tâm">
          <Select value={form.service_id} onValueChange={(v) => set("service_id", v)}>
            <SelectTrigger className="w-full" aria-label="Dịch vụ quan tâm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{lead.service && !lead.service_id ? lead.service : "Chưa rõ"}</SelectItem>
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Trạng thái">
          <Select value={form.status} onValueChange={(v) => set("status", v as LeadStatusKey)}>
            <SelectTrigger className="w-full" aria-label="Trạng thái">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUSES.map((status) => (
                <SelectItem key={status.key} value={status.key}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Telesale phụ trách">
          <Select value={form.assignee_id} onValueChange={(v) => set("assignee_id", v)}>
            <SelectTrigger className="w-full" aria-label="Telesale phụ trách">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{lead.assignee && !lead.assignee_id ? lead.assignee : "Chưa chia"}</SelectItem>
              {assignees.map((s) => (
                <SelectItem key={s.user_id} value={s.user_id}>
                  {s.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Lịch hẹn" htmlFor="lead-appointment">
          <Input
            id="lead-appointment"
            type="datetime-local"
            value={form.appointment_at}
            onChange={(e) => set("appointment_at", e.target.value)}
          />
        </Field>
        <div className="grid content-end pb-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={form.invalid_phone}
              onChange={(e) => set("invalid_phone", e.target.checked)}
            />
            Số sai (sai số, không liên lạc được)
          </label>
        </div>

        <div className="sm:col-span-2">
          <Field label="Ghi chú" htmlFor="lead-note">
            <Textarea
              id="lead-note"
              rows={3}
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
            />
          </Field>
        </div>
      </div>

      <TouchHistory leadId={lead.id} />

      <DialogFooter>
        {onDelete && (
          <Button type="button" variant="ghost" className="text-destructive sm:mr-auto" onClick={onDelete}>
            <Trash2 />
            Chuyển vào thùng rác
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel}>
          Huỷ
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : "Lưu thay đổi"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Danh sách các lần trực page đã dán số này (lần tiếp cận), mới nhất trước. */
function TouchHistory({ leadId }: { leadId: string }) {
  const names = useCatalogNames();
  const [state, setState] = useState<{ touches: LeadTouch[] } | { error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLeadTouches(leadId)
      .then((touches) => !cancelled && setState({ touches }))
      .catch((error: unknown) =>
        !cancelled && setState({ error: error instanceof Error ? error.message : String(error) }),
      );
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  return (
    <div className="grid gap-1.5">
      <h3 className="text-sm font-medium">Các lần tiếp cận</h3>
      {state === null ? (
        <p className="text-sm text-muted-foreground">Đang tải…</p>
      ) : "error" in state ? (
        <p className="text-sm text-destructive">Không tải được: {state.error}</p>
      ) : state.touches.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có lần tiếp cận nào.</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {state.touches.map((touch) => {
            const where = [
              names.channel(touch.channel_id),
              names.page(touch.page_id),
              names.campaign(touch.campaign_id),
            ].filter(Boolean);
            return (
              <li key={touch.id} className="rounded-md border px-2.5 py-1.5">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="tabular-nums text-muted-foreground">
                    {format(new Date(touch.created_at), "dd/MM/yyyy HH:mm")}
                  </span>
                  <span className="font-medium">
                    {touch.is_invalid ? "Số sai" : TOUCH_RESULT_LABELS[touch.result]}
                  </span>
                  <span>{where.length > 0 ? where.join(" › ") : "Chưa rõ nguồn"}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Người dán: {names.staff(touch.created_by) ?? "—"}
                  {touch.assignee_id &&
                    ` · ${touch.assign_mode === "kept" ? "giữ" : touch.assign_mode === "manual" ? "chia tay cho" : "xoay vòng cho"} ${names.staff(touch.assignee_id) ?? "—"}`}
                  {touch.note && ` · ${touch.note}`}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
