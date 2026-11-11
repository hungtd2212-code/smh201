"use client";

import { format } from "date-fns";
import {
  CircleAlert,
  CircleCheck,
  ClipboardPaste,
  RotateCcw,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCatalogs } from "@/components/catalog-provider";
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
import { ROLE_LABELS } from "@/hooks/use-current-staff";
import { APP } from "@/lib/config";
import { isValidPhone, normalizePhone, parseChatSnippet } from "@/lib/leads/phone";
import { checkLeadPhone, intakeLead } from "@/lib/leads/repo";
import { getLeadStatus } from "@/lib/leads/status";
import type {
  LeadIntakeResult,
  PhoneCheck,
  TouchResult,
} from "@/lib/leads/types";
import { cn } from "@/lib/utils";

const NONE = "__none";
const ROUND_ROBIN = "__round_robin";

/** Phần "nguồn" được giữ lại giữa các lần dán liên tiếp (trực page thường dán nhiều số cùng nguồn). */
type SourceState = {
  channelId: string;
  pageId: string;
  campaignId: string;
  serviceId: string;
  adsId: string;
  assigneeId: string;
};

const EMPTY_SOURCE: SourceState = {
  channelId: NONE,
  pageId: NONE,
  campaignId: NONE,
  serviceId: NONE,
  adsId: "",
  assigneeId: ROUND_ROBIN,
};

const OUTCOME_STYLE: Record<TouchResult, { icon: typeof CircleCheck; className: string }> = {
  new: { icon: CircleCheck, className: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200" },
  duplicate: { icon: CircleAlert, className: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200" },
  reopened: { icon: RotateCcw, className: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200" },
  existing_customer: { icon: UserRoundCheck, className: "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-200" },
};

/** Câu báo trước khi lưu: số này sẽ được xử lý thế nào. */
function describeCheck(check: Extract<PhoneCheck, { valid: true }>): string {
  const lead = check.lead;
  if (check.outcome === "new" || !lead) return "Số mới — chưa có trong hệ thống.";
  const status = getLeadStatus(lead.status).label;
  const who = lead.assignee ? `telesale ${lead.assignee}` : "chưa có telesale";
  const since = format(new Date(lead.created_at), "dd/MM/yyyy");
  if (check.outcome === "duplicate")
    return `Số trùng — ${lead.full_name}, đang “${status}”, ${who} (tạo ${since}). Lưu sẽ cập nhật nguồn gần nhất, giữ telesale cũ và báo cho telesale đó.`;
  if (check.outcome === "reopened")
    return `Lead cũ đã “${status}” khá lâu — ${lead.full_name} (tạo ${since}). Lưu sẽ mở lại lead này và chia lại.`;
  return `Khách cũ — ${lead.full_name} đã làm dịch vụ. Lưu sẽ chuyển cho CSKH, không tính là lead marketing.`;
}

/** Câu báo sau khi lưu. */
function describeResult(result: LeadIntakeResult): string {
  const mode = result.assign_mode === "manual" ? "chia tay" : "xoay vòng";
  const assigned = result.assignee
    ? `Đã chia cho ${result.assignee} (${mode}).`
    : "Chưa chia được: chưa có telesale nào đang bật nhận lead.";
  switch (result.outcome) {
    case "new":
      return `Đã tạo lead mới ${result.full_name} — ${result.phone}. ${assigned}`;
    case "reopened":
      return `Đã mở lại lead ${result.full_name} — ${result.phone}. ${assigned}`;
    case "duplicate":
      return `Số trùng ${result.phone} (${result.full_name}). Đã cập nhật nguồn gần nhất; ${result.assignee ? `telesale ${result.assignee} được báo khách nhắn lại` : "lead chưa có telesale"}.`;
    case "existing_customer":
      return `Khách cũ ${result.full_name} — ${result.phone}. Đã ghi nhận để CSKH liên hệ, không tính là lead marketing.`;
  }
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Gọi sau mỗi lần lưu thành công để màn hình Leads cập nhật. */
  onSaved: (result: LeadIntakeResult) => void;
};

export function LeadIntakeDialog({ open, onOpenChange, onSaved }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        {open && <IntakeForm onSaved={onSaved} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function IntakeForm({
  onSaved,
  onClose,
}: {
  onSaved: Props["onSaved"];
  onClose: () => void;
}) {
  const { catalogs } = useCatalogs();
  const chatRef = useRef<HTMLTextAreaElement>(null);

  const [chat, setChat] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [pancakeUrl, setPancakeUrl] = useState("");
  const [source, setSource] = useState<SourceState>(EMPTY_SOURCE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState<LeadIntakeResult | null>(null);

  // ----- Danh sách lựa chọn, lọc theo cấp: Kênh → Page → Chiến dịch -----
  const channels = catalogs.channels.filter((c) => c.is_active);
  const pages = catalogs.pages.filter(
    (p) => p.is_active && p.channel_id === source.channelId,
  );
  const campaigns = catalogs.campaigns.filter(
    (c) =>
      c.is_active &&
      c.channel_id === source.channelId &&
      (source.pageId === NONE || c.page_id === null || c.page_id === source.pageId),
  );
  const services = catalogs.services.filter((s) => s.is_active);
  // Người có thể nhận lead: telesale, lead, và bất kỳ ai đang bật nhận lead (trừ tài khoản bị khoá).
  const assignees = catalogs.staff.filter(
    (s) => !s.locked_at && (s.accepts_leads || s.role === "sale" || s.role === "lead"),
  );

  // ----- Kiểm tra trùng ngay khi số hợp lệ -----
  const normalized = normalizePhone(phone);
  const phoneValid = isValidPhone(normalized);
  const [check, setCheck] = useState<{ phone: string; result: PhoneCheck | null; error?: string } | null>(null);

  useEffect(() => {
    if (!phoneValid) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkLeadPhone(normalized)
        .then((result) => !cancelled && setCheck({ phone: normalized, result }))
        .catch((error: unknown) =>
          !cancelled &&
          setCheck({
            phone: normalized,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalized, phoneValid]);

  // Chỉ dùng kết quả kiểm tra nếu nó đúng là của số đang nhập.
  const currentCheck = phoneValid && check?.phone === normalized ? check : null;
  const checkResult = currentCheck?.result?.valid ? currentCheck.result : null;

  // ----- Thao tác -----
  function handleChatChange(text: string) {
    setChat(text);
    const parsed = parseChatSnippet(text);
    if (parsed.phone) setPhone(parsed.phone);
    if (parsed.name) setName(parsed.name);
  }

  function pickChannel(channelId: string) {
    setSource((prev) => ({ ...prev, channelId, pageId: NONE, campaignId: NONE }));
  }

  function pickPage(pageId: string) {
    setSource((prev) => ({ ...prev, pageId, campaignId: NONE }));
  }

  /** Chọn chiến dịch thì tự điền page, dịch vụ và ID Ads của chiến dịch đó. */
  function pickCampaign(campaignId: string) {
    const campaign = catalogs.campaigns.find((c) => c.id === campaignId);
    setSource((prev) => ({
      ...prev,
      campaignId,
      pageId: campaign?.page_id ?? prev.pageId,
      serviceId: campaign?.service_id ?? prev.serviceId,
      adsId: campaign?.ads_id ?? prev.adsId,
    }));
  }

  const selectedAssignee = useMemo(
    () => catalogs.staff.find((s) => s.user_id === source.assigneeId),
    [catalogs.staff, source.assigneeId],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (!phoneValid) nextErrors.phone = "Số điện thoại không hợp lệ (vd: 0912345678)";
    if (!name.trim()) nextErrors.name = "Nhập họ tên hoặc tên Facebook";
    if (source.channelId === NONE) nextErrors.channel = "Chọn kênh";
    // Page và chiến dịch chỉ bắt buộc khi kênh đó có khai báo (vd “Giới thiệu” thì không có).
    if (source.channelId !== NONE && pages.length > 0 && source.pageId === NONE)
      nextErrors.page = "Chọn page";
    if (source.channelId !== NONE && campaigns.length > 0 && source.campaignId === NONE)
      nextErrors.campaign = "Chọn chiến dịch";
    if (source.serviceId === NONE) nextErrors.service = "Chọn dịch vụ quan tâm";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const result = await intakeLead({
        phone: normalized,
        full_name: name.trim(),
        channel_id: source.channelId,
        page_id: source.pageId === NONE ? null : source.pageId,
        campaign_id: source.campaignId === NONE ? null : source.campaignId,
        service_id: source.serviceId === NONE ? null : source.serviceId,
        ads_id: source.adsId.trim() || null,
        branch: APP.branch.code,
        note: note.trim() || null,
        pancake_url: pancakeUrl.trim() || null,
        assignee_id: source.assigneeId === ROUND_ROBIN ? null : source.assigneeId,
      });

      setLastResult(result);
      onSaved(result);

      // Giữ nguyên nguồn, xoá phần riêng của khách để dán số tiếp theo.
      setChat("");
      setPhone("");
      setName("");
      setNote("");
      setPancakeUrl("");
      setCheck(null);
      chatRef.current?.focus();
    } catch (error) {
      toast.error("Không lưu được lead", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  const resultStyle = lastResult ? OUTCOME_STYLE[lastResult.outcome] : null;
  const checkStyle = checkResult ? OUTCOME_STYLE[checkResult.outcome] : null;

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Thêm lead</DialogTitle>
        <DialogDescription>
          Dán số khách vừa xin được. Nguồn (kênh, page, chiến dịch) được giữ lại để
          dán liên tiếp nhiều số.
        </DialogDescription>
      </DialogHeader>

      {lastResult && resultStyle && (
        <div role="status" className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", resultStyle.className)}>
          <resultStyle.icon className="mt-0.5 size-4 shrink-0" />
          <span>{describeResult(lastResult)}</span>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="intake-chat" className="flex items-center gap-1.5">
          <ClipboardPaste className="size-3.5" />
          Dán đoạn chat (tự tách SĐT và tên)
        </Label>
        <Textarea
          id="intake-chat"
          ref={chatRef}
          rows={2}
          placeholder="Ví dụ: Nguyễn Lan: em tên Lan, sđt 0912 345 678 ạ"
          value={chat}
          onChange={(e) => handleChatChange(e.target.value)}
          autoFocus
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Số điện thoại *" htmlFor="intake-phone" error={errors.phone}>
          <Input
            id="intake-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => phoneValid && setPhone(normalized)}
            aria-invalid={Boolean(errors.phone)}
          />
        </Field>
        <Field label="Họ tên / tên Facebook *" htmlFor="intake-name" error={errors.name}>
          <Input
            id="intake-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(errors.name)}
          />
        </Field>

        {/* Kết quả kiểm tra trùng, hiện ngay khi số hợp lệ. */}
        {phoneValid && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm sm:col-span-2",
              checkStyle?.className ?? "border-border bg-muted/50 text-muted-foreground",
            )}
          >
            {checkStyle && <checkStyle.icon className="mt-0.5 size-4 shrink-0" />}
            <span>
              {checkResult
                ? describeCheck(checkResult)
                : currentCheck?.error
                  ? `Không kiểm tra được số trùng: ${currentCheck.error}`
                  : `Đang kiểm tra số ${normalized}…`}
            </span>
          </div>
        )}

        <Field label="Kênh *" error={errors.channel}>
          <Select value={source.channelId} onValueChange={pickChannel}>
            <SelectTrigger className="w-full" aria-label="Kênh" aria-invalid={Boolean(errors.channel)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Chọn kênh…</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={pages.length > 0 ? "Page / TKQC *" : "Page / TKQC"} error={errors.page}>
          <Select value={source.pageId} onValueChange={pickPage} disabled={pages.length === 0}>
            <SelectTrigger className="w-full" aria-label="Page" aria-invalid={Boolean(errors.page)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>
                {source.channelId === NONE
                  ? "Chọn kênh trước"
                  : pages.length === 0
                    ? "Kênh này chưa có page"
                    : "Chọn page…"}
              </SelectItem>
              {pages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={campaigns.length > 0 ? "Chiến dịch *" : "Chiến dịch"} error={errors.campaign}>
          <Select value={source.campaignId} onValueChange={pickCampaign} disabled={campaigns.length === 0}>
            <SelectTrigger className="w-full" aria-label="Chiến dịch" aria-invalid={Boolean(errors.campaign)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>
                {source.channelId === NONE
                  ? "Chọn kênh trước"
                  : campaigns.length === 0
                    ? "Chưa có chiến dịch phù hợp"
                    : "Chọn chiến dịch…"}
              </SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="ID Ads / bài QC" htmlFor="intake-ads">
          <Input
            id="intake-ads"
            value={source.adsId}
            onChange={(e) => setSource((prev) => ({ ...prev, adsId: e.target.value }))}
          />
        </Field>

        <Field label="Dịch vụ quan tâm *" error={errors.service}>
          <Select
            value={source.serviceId}
            onValueChange={(serviceId) => setSource((prev) => ({ ...prev, serviceId }))}
          >
            <SelectTrigger className="w-full" aria-label="Dịch vụ quan tâm" aria-invalid={Boolean(errors.service)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Chọn dịch vụ…</SelectItem>
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Cơ sở">
          <Input value={APP.branch.name} readOnly disabled aria-label="Cơ sở" />
        </Field>

        <Field label="Chia cho">
          <Select
            value={source.assigneeId}
            onValueChange={(assigneeId) => setSource((prev) => ({ ...prev, assigneeId }))}
          >
            <SelectTrigger className="w-full" aria-label="Chia cho">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ROUND_ROBIN}>Xoay vòng (mặc định)</SelectItem>
              {assignees.map((s) => (
                <SelectItem key={s.user_id} value={s.user_id}>
                  {s.full_name} — {ROLE_LABELS[s.role]}
                  {!s.accepts_leads && " (đang tắt nhận lead)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedAssignee && (
            <p className="text-xs text-muted-foreground">
              Chia tay cho {selectedAssignee.full_name}; vẫn tính một lượt xoay vòng.
            </p>
          )}
        </Field>
        <Field label="Link hội thoại Pancake" htmlFor="intake-url">
          <Input
            id="intake-url"
            type="url"
            placeholder="https://pancake.vn/…"
            value={pancakeUrl}
            onChange={(e) => setPancakeUrl(e.target.value)}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Ghi chú tư vấn" htmlFor="intake-note">
            <Textarea
              id="intake-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : "Lưu lead"}
        </Button>
      </DialogFooter>
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
