"use client";

import { CircleAlert, CircleCheck, ClipboardPaste } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APP } from "@/lib/config";
import { vnDateTime } from "@/lib/leads/crm";
import { isValidPhone, normalizePhone, parseChatSnippet } from "@/lib/leads/phone";
import { addLead, checkLeadPhoneV2 } from "@/lib/leads/repo";
import type { AddLeadResult, AssignMode, PhoneCheckV2 } from "@/lib/leads/types";
import { cn } from "@/lib/utils";

const NONE = "__none";
const AUTO = "__auto";

/** Phần nguồn được giữ lại giữa các lần thêm liên tiếp (trực page thường thêm nhiều số cùng bài). */
type Source = { channelId: string; pageId: string; postId: string; serviceId: string; assigneeId: string };
const EMPTY: Source = { channelId: NONE, pageId: NONE, postId: NONE, serviceId: NONE, assigneeId: AUTO };

const OK_STYLE = "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200";
const WARN_STYLE = "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200";

function describeResult(r: AddLeadResult) {
  if (r.outcome === "duplicate") {
    return `Số trùng ${r.phone} (${r.full_name}) — ${r.assignee ? `giữ sale ${r.assignee}, đã báo khách nhắn lại` : "chưa có sale"}.`;
  }
  const who = r.assignee
    ? `chia cho ${r.assignee}${r.assign_mode === "manual" ? " (chọn tay)" : " (tự động)"}`
    : "chưa chia sale";
  return `Đã thêm ${r.full_name} — ${r.phone}, ${who}.`;
}

/** Nút "Thêm số" ở bảng Lead (trực page, quản lý). Chọn bài chạy là tự biết page, chiến dịch, nhân viên Ads. */
export function AddLeadDialog({
  open,
  onOpenChange,
  canPickSale,
  assignMode,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Admin, COO, Trưởng Telesale, Trực page được chọn sale ngay khi thêm. */
  canPickSale: boolean;
  assignMode: AssignMode;
  onAdded: (result: AddLeadResult) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        {open && (
          <AddForm canPickSale={canPickSale} assignMode={assignMode} onAdded={onAdded} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddForm({
  canPickSale,
  assignMode,
  onAdded,
  onClose,
}: {
  canPickSale: boolean;
  assignMode: AssignMode;
  onAdded: (result: AddLeadResult) => void;
  onClose: () => void;
}) {
  const { catalogs } = useCatalogs();
  const chatRef = useRef<HTMLTextAreaElement>(null);
  const [chat, setChat] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [pancakeUrl, setPancakeUrl] = useState("");
  const [source, setSource] = useState<Source>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [last, setLast] = useState<AddLeadResult | null>(null);

  // ----- Danh sách chọn: Nguồn → Page → Bài chạy -----
  const channels = catalogs.channels.filter((c) => c.is_active);
  const pages = catalogs.pages.filter((p) => p.is_active && p.channel_id === source.channelId);
  const campaignOf = new Map(catalogs.campaigns.map((c) => [c.id, c]));
  const posts = catalogs.adPosts.filter((p) => {
    const camp = p.campaign_id ? campaignOf.get(p.campaign_id) : undefined;
    if (!camp || p.status === "undeclared") return false;
    if (source.channelId !== NONE && camp.channel_id !== source.channelId) return false;
    if (source.pageId !== NONE && camp.page_id && camp.page_id !== source.pageId) return false;
    return true;
  });
  const services = catalogs.services.filter((s) => s.is_active);
  const telesales = catalogs.staff.filter((s) => (s.role === "sale" || s.role === "lead") && !s.locked_at && !s.deleted_at);

  // ----- Kiểm tra trùng ngay khi số hợp lệ -----
  const normalized = normalizePhone(phone);
  const phoneValid = isValidPhone(normalized);
  const [check, setCheck] = useState<{ phone: string; result: PhoneCheckV2 | null; error?: string } | null>(null);
  useEffect(() => {
    if (!phoneValid) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkLeadPhoneV2(normalized)
        .then((result) => !cancelled && setCheck({ phone: normalized, result }))
        .catch((error: unknown) =>
          !cancelled && setCheck({ phone: normalized, result: null, error: error instanceof Error ? error.message : String(error) }),
        );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalized, phoneValid]);
  const current = phoneValid && check?.phone === normalized ? check : null;
  const checked = current?.result?.valid ? current.result : null;

  function pickPost(postId: string) {
    const post = catalogs.adPosts.find((p) => p.id === postId);
    const camp = post?.campaign_id ? campaignOf.get(post.campaign_id) : undefined;
    setSource((prev) => ({
      ...prev,
      postId,
      channelId: camp?.channel_id ?? prev.channelId,
      pageId: camp?.page_id ?? prev.pageId,
      serviceId: camp?.service_id ?? prev.serviceId,
    }));
    setErrors((e) => ({ ...e, channel: "" }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!phoneValid) next.phone = "Số điện thoại không hợp lệ (vd: 0912345678)";
    if (!name.trim()) next.name = "Nhập tên khách hoặc tên Facebook";
    if (source.channelId === NONE && source.postId === NONE) next.channel = "Chọn nguồn (hoặc chọn bài chạy)";
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    setSaving(true);
    try {
      const result = await addLead({
        phone: normalized,
        full_name: name.trim(),
        channel_id: source.channelId === NONE ? null : source.channelId,
        page_id: source.pageId === NONE ? null : source.pageId,
        ad_post_id: source.postId === NONE ? null : source.postId,
        service_id: source.serviceId === NONE ? null : source.serviceId,
        note: note.trim() || null,
        pancake_url: pancakeUrl.trim() || null,
        assignee_id: canPickSale && source.assigneeId !== AUTO ? source.assigneeId : null,
        branch: APP.branch.code,
      });
      setLast(result);
      onAdded(result);
      // Giữ nguồn, xoá phần riêng của khách để thêm số tiếp theo.
      setChat("");
      setPhone("");
      setName("");
      setNote("");
      setPancakeUrl("");
      setCheck(null);
      chatRef.current?.focus();
    } catch (error) {
      toast.error("Không thêm được số", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  const autoLabel = assignMode === "auto" ? "Tự động (xoay vòng)" : "Để Chưa chia (đang chia thủ công)";

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Thêm số</DialogTitle>
        <DialogDescription>
          Nguồn, page, bài chạy được giữ lại để thêm liên tiếp nhiều số. Chọn bài chạy là tự biết nhân viên Ads.
        </DialogDescription>
      </DialogHeader>

      {last && (
        <div role="status" className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", last.outcome === "new" ? OK_STYLE : WARN_STYLE)}>
          {last.outcome === "new" ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
          <span>{describeResult(last)}</span>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="add-chat" className="flex items-center gap-1.5">
          <ClipboardPaste className="size-3.5" />
          Dán đoạn chat (tự tách số và tên)
        </Label>
        <Textarea
          id="add-chat"
          ref={chatRef}
          rows={2}
          placeholder="Ví dụ: Nguyễn Lan: em tên Lan, sđt 0912 345 678 ạ"
          value={chat}
          onChange={(e) => {
            setChat(e.target.value);
            const parsed = parseChatSnippet(e.target.value);
            if (parsed.phone) setPhone(parsed.phone);
            if (parsed.name) setName(parsed.name);
          }}
          autoFocus
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Số điện thoại *" htmlFor="add-phone" error={errors.phone}>
          <Input
            id="add-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => phoneValid && setPhone(normalized)}
            aria-invalid={Boolean(errors.phone)}
          />
        </Field>
        <Field label="Tên khách / tên Facebook *" htmlFor="add-name" error={errors.name}>
          <Input id="add-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name)} />
        </Field>

        {phoneValid && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm sm:col-span-2",
              checked ? (checked.outcome === "new" ? OK_STYLE : WARN_STYLE) : "border-border bg-muted/50 text-muted-foreground",
            )}
          >
            <span>
              {checked
                ? checked.outcome === "new" || !checked.lead
                  ? "Số mới — chưa có trong hệ thống."
                  : `Số trùng — ${checked.lead.full_name}, ${checked.lead.status_name ? `đang “${checked.lead.status_name}”` : "chưa xử lý"}, ${checked.lead.assignee ? `sale ${checked.lead.assignee}` : "chưa chia"} (ra số ${vnDateTime(checked.lead.created_at)?.day ?? ""}). Lưu sẽ giữ sale cũ và báo khách nhắn lại.`
                : current?.error
                  ? `Không kiểm tra được số trùng: ${current.error}`
                  : `Đang kiểm tra số ${normalized}…`}
            </span>
          </div>
        )}

        <Field label="Nguồn *" error={errors.channel}>
          <Select
            value={source.channelId}
            onValueChange={(channelId) => {
              setSource((prev) => ({ ...prev, channelId, pageId: NONE, postId: NONE }));
              setErrors((e) => ({ ...e, channel: "" }));
            }}
          >
            <SelectTrigger className="w-full" aria-label="Nguồn" aria-invalid={Boolean(errors.channel)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Chọn nguồn…</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Page">
          <Select
            value={source.pageId}
            onValueChange={(pageId) => setSource((prev) => ({ ...prev, pageId, postId: NONE }))}
            disabled={pages.length === 0}
          >
            <SelectTrigger className="w-full" aria-label="Page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{source.channelId === NONE ? "Chọn nguồn trước" : pages.length === 0 ? "Nguồn này chưa có page" : "Chọn page…"}</SelectItem>
              {pages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Bài chạy">
          <Select value={source.postId} onValueChange={pickPost} disabled={posts.length === 0}>
            <SelectTrigger className="w-full" aria-label="Bài chạy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{posts.length === 0 ? "Chưa có bài phù hợp" : "Chọn bài…"}</SelectItem>
              {posts.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title ?? p.post_id ?? p.url}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Dịch vụ">
          <Select value={source.serviceId} onValueChange={(serviceId) => setSource((prev) => ({ ...prev, serviceId }))}>
            <SelectTrigger className="w-full" aria-label="Dịch vụ">
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

        <Field label="Chia cho">
          {canPickSale ? (
            <Select value={source.assigneeId} onValueChange={(assigneeId) => setSource((prev) => ({ ...prev, assigneeId }))}>
              <SelectTrigger className="w-full" aria-label="Chia cho">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{autoLabel}</SelectItem>
                {telesales.map((s) => (
                  <SelectItem key={s.user_id} value={s.user_id}>
                    {s.full_name}
                    {!s.accepts_leads && " (đang không nhận số)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="flex min-h-9 items-center text-sm text-muted-foreground">{autoLabel}</p>
          )}
        </Field>
        <Field label="Link hội thoại Pancake" htmlFor="add-url">
          <Input id="add-url" type="url" placeholder="https://pancake.vn/…" value={pancakeUrl} onChange={(e) => setPancakeUrl(e.target.value)} />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Lưu ý" htmlFor="add-note">
            <Textarea id="add-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : "Lưu số"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({ label, htmlFor, error, children }: { label: string; htmlFor?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
