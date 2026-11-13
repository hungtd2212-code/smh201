"use client";

import { ExternalLink, Phone, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NumberInput } from "@/components/ad-reports/number-input";
import { useCatalogNames, useCatalogs } from "@/components/catalog-provider";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { duplicateCount, missingForStatus, vnDateTime } from "@/lib/leads/crm";
import { hasPancakeConversation, safeHttpUrl } from "@/lib/leads/pancake";
import { updateLead } from "@/lib/leads/repo";
import type { Lead, LeadPatch, LeadStatusRow } from "@/lib/leads/types";
import { softDeleteRecords } from "@/lib/safety/repo";
import { cn } from "@/lib/utils";
import { ConsultHistory } from "./consult-history";
import { PancakeChat } from "./pancake-chat";
import { StatusPicker } from "./status-chip";

const NONE = "__none";

type Form = {
  full_name: string;
  gender: string;
  age: string;
  area: string;
  budget: string;
  service_id: string;
  note: string;
  status_id: string | null;
  appointment_at: string; // <input type="datetime-local">
  deal_amount: string; // chỉ chữ số
  paid_amount: string;
  assignee_id: string;
  consult_info: string;
};

/** "2026-11-13T07:00:00Z" → "2026-11-13T14:00" theo giờ của máy (ô datetime-local). */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const toForm = (lead: Lead, statusId: string | null): Form => ({
  full_name: lead.full_name,
  gender: lead.gender ?? NONE,
  age: lead.age == null ? "" : String(lead.age),
  area: lead.area ?? "",
  budget: lead.budget ?? "",
  service_id: lead.service_id ?? NONE,
  note: lead.note ?? "",
  status_id: statusId,
  appointment_at: toLocalInput(lead.appointment_at),
  deal_amount: lead.deal_amount == null ? "" : String(lead.deal_amount),
  paid_amount: lead.paid_amount == null ? "" : String(lead.paid_amount),
  assignee_id: lead.assignee_id ?? NONE,
  consult_info: lead.consult_info ?? "",
});

const text = (value: string) => value.trim() || null;
const digits = (value: string) => (value === "" ? null : Number(value));

/** Chỉ gửi những ô đã đổi (mỗi lần lưu là một dòng nhật ký, không ghi đè ô người khác vừa sửa). */
function buildPatch(lead: Lead, form: Form, clearRecontacted: boolean): LeadPatch & { assignee_id?: string | null } {
  const next: LeadPatch & { assignee_id?: string | null } = {
    full_name: form.full_name.trim(),
    gender: form.gender === NONE ? null : (form.gender as "male" | "female"),
    age: form.age === "" ? null : Number(form.age),
    area: text(form.area),
    budget: text(form.budget),
    service_id: form.service_id === NONE ? null : form.service_id,
    note: text(form.note),
    status_id: form.status_id,
    appointment_at: form.appointment_at ? new Date(form.appointment_at).toISOString() : null,
    deal_amount: digits(form.deal_amount),
    paid_amount: digits(form.paid_amount),
    assignee_id: form.assignee_id === NONE ? null : form.assignee_id,
    consult_info: form.consult_info.trim() === "" ? null : form.consult_info,
  };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    const before = (lead as Record<string, unknown>)[key] ?? null;
    const same =
      key === "appointment_at"
        ? (before ? new Date(before as string).getTime() : null) === (value ? new Date(value as string).getTime() : null)
        : before === value;
    if (!same) patch[key] = value;
  }
  if (clearRecontacted && lead.recontacted_at) patch.recontacted_at = null;
  return patch;
}

type Props = {
  lead: Lead | null;
  /** Trạng thái vừa chọn ở bảng mà còn thiếu thông tin (vd lịch hẹn) → mở sẵn để điền. */
  pendingStatusId: string | null;
  statuses: LeadStatusRow[];
  myId: string | null;
  canTransfer: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
  onDeleted: (id: string) => void;
};

/**
 * Bấm vào một dòng của bảng Lead → cửa sổ gần kín màn hình: bên trái thông tin khách, chăm sóc, nguồn số, khai
 * thác thông tin; bên phải cuộc chat Pancake của khách (máy nhỏ: cuộc chat nằm dưới).
 */
export function LeadDetailDialog(props: Props) {
  return (
    <Dialog open={props.lead !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="h-[calc(100svh-2rem)] auto-rows-max gap-0 overflow-y-auto p-0 sm:max-w-[calc(100vw-2rem)] lg:grid-cols-[minmax(0,1fr)_minmax(24rem,40%)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden 2xl:max-w-[1600px]">
        {props.lead && (
          <>
            <div className="p-4 lg:min-h-0 lg:overflow-y-auto">
              <DetailForm key={`${props.lead.id}-${props.pendingStatusId}`} {...props} lead={props.lead} />
            </div>
            <LeadChat lead={props.lead} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Khung chat Pancake bên phải cửa sổ (tên page để ghi "Trả lời từ …"). */
function LeadChat({ lead }: { lead: Lead }) {
  const names = useCatalogNames();
  return (
    <PancakeChat
      key={lead.id}
      leadId={lead.id}
      pancakeUrl={lead.pancake_url}
      leadPhone={lead.phone}
      pageName={names.page(lead.page_id) ?? null}
      className="h-[80svh] border-t lg:h-auto lg:border-t-0 lg:border-l"
    />
  );
}

function DetailForm({
  lead,
  pendingStatusId,
  statuses,
  myId,
  canTransfer,
  canDelete,
  onClose,
  onSaved,
  onDeleted,
}: Props & { lead: Lead }) {
  const { catalogs } = useCatalogs();
  const names = useCatalogNames();
  const [form, setForm] = useState<Form>(() => toForm(lead, pendingStatusId ?? lead.status_id));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  };

  const status = statuses.find((s) => s.id === form.status_id);
  const created = vnDateTime(lead.created_at);
  const services = catalogs.services.filter((s) => s.is_active || s.id === lead.service_id);
  const telesales = catalogs.staff.filter(
    (s) => ((s.role === "sale" || s.role === "lead") && !s.locked_at && !s.deleted_at) || s.user_id === lead.assignee_id,
  );
  const post = catalogs.adPosts.find((p) => p.id === lead.ad_post_id);
  const dup = duplicateCount(lead);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!form.full_name.trim()) next.full_name = "Nhập tên khách";
    if (form.age !== "" && !(Number(form.age) >= 1 && Number(form.age) <= 120)) next.age = "Tuổi từ 1 đến 120";
    for (const field of missingForStatus(status, {
      appointment_at: form.appointment_at || null,
      deal_amount: digits(form.deal_amount),
    })) {
      if (field === "Lịch hẹn") next.appointment_at = `“${status?.name}” cần nhập lịch hẹn`;
      if (field === "Doanh số") next.deal_amount = `“${status?.name}” cần nhập doanh số`;
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    const patch = buildPatch(lead, form, myId !== null && lead.assignee_id === myId);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const saved = await updateLead(lead.id, patch);
      toast.success(`Đã lưu ${saved.full_name}`);
      onSaved(saved);
    } catch (error) {
      toast.error("Không lưu được", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {lead.full_name}
          <a
            href={`tel:${lead.phone}`}
            className="inline-flex items-center gap-1 text-base font-medium text-primary tabular-nums hover:underline"
          >
            <Phone className="size-4" />
            {lead.phone}
          </a>
        </DialogTitle>
        <DialogDescription className="flex flex-wrap gap-x-3 gap-y-1">
          <span>Ra số {created ? `${created.time} ${created.day}` : ""}</span>
          {dup > 0 && <span className="text-amber-700 dark:text-amber-300">Trùng {dup} lần</span>}
          {lead.recontacted_at && <span className="text-amber-700 dark:text-amber-300">Khách vừa nhắn lại</span>}
          {lead.transfer_count > 0 && (
            <span>
              Đảo số {lead.transfer_count} lần (sale trước: {names.staff(lead.previous_assignee_id) ?? "—"})
            </span>
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="grid content-start gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Thông tin khách</legend>
          <Field label="Tên khách hàng" htmlFor="d-name" error={errors.full_name}>
            <Input id="d-name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} maxLength={200} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Giới tính">
              <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
                <SelectTrigger className="w-full" aria-label="Giới tính">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  <SelectItem value="female">Nữ</SelectItem>
                  <SelectItem value="male">Nam</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tuổi" htmlFor="d-age" error={errors.age}>
              <Input
                id="d-age"
                inputMode="numeric"
                value={form.age}
                onChange={(e) => set("age", e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              />
            </Field>
            <Field label="Khu vực" htmlFor="d-area">
              <Input id="d-area" value={form.area} onChange={(e) => set("area", e.target.value)} maxLength={100} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dịch vụ">
              <Select value={form.service_id} onValueChange={(v) => set("service_id", v)}>
                <SelectTrigger className="w-full" aria-label="Dịch vụ">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Ngân sách" htmlFor="d-budget">
              <Input
                id="d-budget"
                placeholder="vd 20–30 triệu"
                value={form.budget}
                onChange={(e) => set("budget", e.target.value)}
                maxLength={100}
              />
            </Field>
          </div>
          <Field label="Lưu ý" htmlFor="d-note">
            <Textarea id="d-note" rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
        </fieldset>

        <fieldset className="grid content-start gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Chăm sóc</legend>
          <Field label="Tình trạng">
            <div className="flex min-h-9 items-center">
              <StatusPicker
                statuses={statuses}
                value={form.status_id}
                legacyStatus={lead.status}
                onPick={(id) => set("status_id", id)}
              />
            </div>
          </Field>
          <Field label="Lịch hẹn" htmlFor="d-appt" error={errors.appointment_at}>
            <Input
              id="d-appt"
              type="datetime-local"
              value={form.appointment_at}
              onChange={(e) => set("appointment_at", e.target.value)}
              aria-invalid={Boolean(errors.appointment_at)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Doanh số" htmlFor="d-deal" error={errors.deal_amount}>
              <NumberInput
                id="d-deal"
                value={form.deal_amount}
                onValueChange={(v) => set("deal_amount", v)}
                maxDigits={12}
                suffix="đ"
                placeholder="vd 45.000.000"
                invalid={Boolean(errors.deal_amount)}
              />
            </Field>
            <Field label="Doanh thu" htmlFor="d-paid">
              <NumberInput
                id="d-paid"
                value={form.paid_amount}
                onValueChange={(v) => set("paid_amount", v)}
                maxDigits={12}
                suffix="đ"
                placeholder="Khách đã trả"
              />
            </Field>
          </div>
          <Field label="Sale quản lý">
            {canTransfer ? (
              <Select value={form.assignee_id} onValueChange={(v) => set("assignee_id", v)}>
                <SelectTrigger className="w-full" aria-label="Sale quản lý">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} disabled={lead.assignee_id !== null}>
                    Chưa chia
                  </SelectItem>
                  {telesales.map((s) => (
                    <SelectItem key={s.user_id} value={s.user_id}>
                      {s.full_name}
                      {!s.accepts_leads && " (đang không nhận số)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="flex min-h-9 items-center text-sm">{lead.assignee ?? "Chưa chia"}</p>
            )}
            {form.assignee_id !== (lead.assignee_id ?? NONE) && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Lưu sẽ chuyển số này sang {names.staff(form.assignee_id) ?? "sale khác"} (tính một lần đảo số).
              </p>
            )}
          </Field>
        </fieldset>
      </div>

      <fieldset className="grid gap-2 rounded-lg border p-3 text-sm">
        <legend className="px-1 text-sm font-semibold">Nguồn số</legend>
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Nguồn">{names.channel(lead.channel_id) ?? lead.source}</Info>
          <Info label="Page">{names.page(lead.page_id)}</Info>
          <Info label="Bài chạy">
            {post ? (
              <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                {post.title ?? "Mở bài"}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </Info>
          <Info label="Chiến dịch">{names.campaign(lead.campaign_id)}</Info>
          <Info label="Nhân viên Ads">{names.adsStaff(lead.ads_staff_id)}</Info>
          <Info label="Hội thoại Pancake">
            {lead.pancake_url ? (hasPancakeConversation(lead.pancake_url) ? "Xem ở khung chat" : <PancakeLink url={lead.pancake_url} />) : null}
          </Info>
        </dl>
      </fieldset>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="d-consult">Khai thác thông tin khách hàng</Label>
          <ConsultHistory leadId={lead.id} />
        </div>
        <Textarea
          id="d-consult"
          rows={5}
          placeholder="Nhu cầu, tình trạng răng, lo lắng của khách, đã tư vấn gì…"
          value={form.consult_info}
          onChange={(e) => set("consult_info", e.target.value)}
          maxLength={5000}
        />
      </div>

      <DialogFooter className="sticky bottom-0 z-10 gap-2 bg-popover sm:justify-between lg:rounded-br-none">
        {canDelete ? (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirmingDelete(true)}>
            <Trash2 />
            Chuyển vào thùng rác
          </Button>
        ) : (
          <span />
        )}
        <span className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Đang lưu…" : "Lưu"}
          </Button>
        </span>
      </DialogFooter>

      <ConfirmActionDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Chuyển số này vào thùng rác?"
        description={
          <p>
            {lead.full_name} ({lead.phone}) sẽ không còn hiện trong bảng. Không số nào bị xoá: Quản trị khôi phục được
            trong Cài đặt → Thùng rác.
          </p>
        }
        confirmLabel="Chuyển vào Thùng rác"
        destructive
        onConfirm={async () => {
          await softDeleteRecords("leads", [lead.id]);
          toast.success(`Đã chuyển ${lead.full_name} vào Thùng rác`);
          onDeleted(lead.id);
        }}
      />
    </form>
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

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}:</dt>
      <dd className={cn("min-w-0 truncate", !children && "text-muted-foreground")}>{children || "—"}</dd>
    </div>
  );
}

/** Link Pancake không đúng dạng hội thoại (nhập tay) → vẫn cho mở như trước. */
function PancakeLink({ url }: { url: string }) {
  const href = safeHttpUrl(url);
  if (!href) return <>{url}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
      Mở
      <ExternalLink className="size-3" />
    </a>
  );
}
