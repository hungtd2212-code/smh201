"use client";

import { format } from "date-fns";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createLead, updateLead } from "@/lib/leads/repo";
import { LEAD_STATUSES, type LeadStatusKey } from "@/lib/leads/status";
import {
  DENTAL_SERVICES,
  LEAD_SOURCES,
  type Lead,
  type LeadInput,
} from "@/lib/leads/types";

/** Giá trị đại diện cho "không chọn" (Select không nhận chuỗi rỗng). */
const NONE = "__none";

/** Số Việt Nam: bắt đầu bằng 0 hoặc +84, theo sau là 9–10 chữ số. */
const PHONE_PATTERN = /^(0|\+?84)\d{9,10}$/;

type FormState = {
  full_name: string;
  phone: string;
  service: string;
  source: string;
  ads_id: string;
  status: LeadStatusKey;
  assignee: string;
  appointment_at: string; // định dạng của <input type="datetime-local">
  note: string;
};

function toFormState(lead: Lead | null): FormState {
  return {
    full_name: lead?.full_name ?? "",
    phone: lead?.phone ?? "",
    service: lead?.service ?? NONE,
    source: lead?.source ?? NONE,
    ads_id: lead?.ads_id ?? "",
    status: lead?.status ?? "so_moi",
    assignee: lead?.assignee ?? "",
    appointment_at: lead?.appointment_at
      ? format(new Date(lead.appointment_at), "yyyy-MM-dd'T'HH:mm")
      : "",
    note: lead?.note ?? "",
  };
}

function toLeadInput(form: FormState): LeadInput {
  const text = (value: string) => value.trim() || null;
  return {
    full_name: form.full_name.trim(),
    phone: form.phone.replace(/[\s.-]/g, ""),
    service: form.service === NONE ? null : form.service,
    source: form.source === NONE ? null : form.source,
    ads_id: text(form.ads_id),
    status: form.status,
    assignee: text(form.assignee),
    appointment_at: form.appointment_at
      ? new Date(form.appointment_at).toISOString()
      : null,
    note: text(form.note),
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = thêm lead mới; có lead = sửa lead đó. */
  lead: Lead | null;
  onSaved: (lead: Lead, isNew: boolean) => void;
};

export function LeadDialog({ open, onOpenChange, lead, onSaved }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {/* key: mỗi lần mở cho một lead khác thì form được khởi tạo lại. */}
        {open && (
          <LeadForm
            key={lead?.id ?? "new"}
            lead={lead}
            onSaved={onSaved}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LeadForm({
  lead,
  onSaved,
  onCancel,
}: {
  lead: Lead | null;
  onSaved: Props["onSaved"];
  onCancel: () => void;
}) {
  const [form, setForm] = useState(() => toFormState(lead));
  const [errors, setErrors] = useState<{ full_name?: string; phone?: string }>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const input = toLeadInput(form);

    const nextErrors: typeof errors = {};
    if (!input.full_name) nextErrors.full_name = "Nhập tên khách hàng";
    if (!PHONE_PATTERN.test(input.phone))
      nextErrors.phone = "Số điện thoại không hợp lệ (vd: 0912345678)";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const saved = lead
        ? await updateLead(lead.id, input)
        : await createLead(input);
      toast.success(lead ? "Đã cập nhật lead" : "Đã thêm lead mới");
      onSaved(saved, !lead);
    } catch (error) {
      toast.error("Không lưu được lead", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{lead ? "Sửa lead" : "Thêm lead"}</DialogTitle>
        <DialogDescription>
          {lead
            ? "Cập nhật thông tin và trạng thái chăm sóc."
            : "Nhập thông tin khách hàng tiềm năng mới."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tên khách hàng *" htmlFor="lead-name" error={errors.full_name}>
          <Input
            id="lead-name"
            value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            aria-invalid={Boolean(errors.full_name)}
            autoFocus
          />
        </Field>
        <Field label="Số điện thoại *" htmlFor="lead-phone" error={errors.phone}>
          <Input
            id="lead-phone"
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            aria-invalid={Boolean(errors.phone)}
          />
        </Field>

        <Field label="Dịch vụ quan tâm">
          <Select value={form.service} onValueChange={(v) => set("service", v)}>
            <SelectTrigger className="w-full" aria-label="Dịch vụ quan tâm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Chưa rõ</SelectItem>
              {withCurrent(DENTAL_SERVICES, lead?.service).map((service) => (
                <SelectItem key={service} value={service}>
                  {service}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Nguồn">
          <Select value={form.source} onValueChange={(v) => set("source", v)}>
            <SelectTrigger className="w-full" aria-label="Nguồn">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Chưa rõ</SelectItem>
              {withCurrent(LEAD_SOURCES, lead?.source).map((source) => (
                <SelectItem key={source} value={source}>
                  {source}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Trạng thái">
          <Select
            value={form.status}
            onValueChange={(v) => set("status", v as LeadStatusKey)}
          >
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
        <Field label="Nhân viên phụ trách" htmlFor="lead-assignee">
          <Input
            id="lead-assignee"
            value={form.assignee}
            onChange={(e) => set("assignee", e.target.value)}
          />
        </Field>

        <Field label="Lịch hẹn" htmlFor="lead-appointment">
          <Input
            id="lead-appointment"
            type="datetime-local"
            value={form.appointment_at}
            onChange={(e) => set("appointment_at", e.target.value)}
          />
        </Field>
        <Field label="ID Ads" htmlFor="lead-ads">
          <Input
            id="lead-ads"
            value={form.ads_id}
            onChange={(e) => set("ads_id", e.target.value)}
          />
        </Field>

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

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Huỷ
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : lead ? "Lưu thay đổi" : "Thêm lead"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Giữ lại giá trị cũ của lead nếu nó không nằm trong danh sách chuẩn. */
function withCurrent(options: readonly string[], current?: string | null) {
  return current && !options.includes(current) ? [...options, current] : options;
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
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
