"use client";

import { ChevronDown, CircleHelp, KeyRound, Loader2, Plug, RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { formatDay } from "@/lib/ad-reports/dates";
import {
  accountHealth,
  accountWarnings,
  cleanToken,
  type AutoAccount,
  type AutoStatus,
  type HealthTone,
} from "@/lib/ads-auto/compare";
import { removeAutoToken, saveAutoToken, setAutoEnabled } from "@/lib/ads-auto/repo";
import { vnDateTime } from "@/lib/leads/crm";
import { cn } from "@/lib/utils";

const DOT: Record<HealthTone, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  idle: "bg-slate-300 dark:bg-slate-600",
};
const TEXT: Record<HealthTone, string> = {
  good: "text-emerald-700 dark:text-emerald-300",
  warn: "text-amber-700 dark:text-amber-300",
  bad: "text-red-700 dark:text-red-300",
  idle: "text-muted-foreground",
};

const when = (iso: string | null) => {
  const t = vnDateTime(iso);
  return t ? `${t.time} ${t.day}` : null;
};

/**
 * Phần "Kết nối Facebook": dán / đổi / gỡ token, bật tắt tự kéo mỗi giờ, tình trạng từng TKQC.
 * `onChanged` = tải lại tình trạng (và theo dõi các lượt hỏi Facebook vừa gửi).
 */
export function ConnectionCard({ status, onChanged }: { status: AutoStatus; onChanged: () => void }) {
  const [tokenOpen, setTokenOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  const facebook = status.accounts.filter((a) => a.is_facebook);
  const others = status.accounts.filter((a) => !a.is_facebook);
  const ready = facebook.filter((a) => a.fb_account_id && a.is_active);

  async function toggleAuto() {
    setToggling(true);
    try {
      await setAutoEnabled(!status.auto_enabled);
      toast.success(status.auto_enabled ? "Đã tắt tự kéo mỗi giờ" : "Đã bật tự kéo mỗi giờ");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setToggling(false);
    }
  }

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <Plug className="size-4 text-muted-foreground" />
            Kết nối Facebook
          </h2>
          {status.has_token ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
              <span className="font-medium text-foreground">Đã có token</span>
              <span className="font-mono text-xs">…{status.token_hint}</span>
              {status.token_set_at && (
                <span>
                  · dán lúc {when(status.token_set_at)}
                  {status.token_set_by && ` bởi ${status.token_set_by}`}
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Chưa kết nối: dán token Facebook (chỉ quyền xem số) để hệ thống tự kéo.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status.has_token && (
            <Button variant="outline" size="sm" disabled={toggling} onClick={() => void toggleAuto()} aria-pressed={status.auto_enabled}>
              <RefreshCw className={cn(toggling && "animate-spin")} />
              Tự kéo mỗi giờ: {status.auto_enabled ? "Bật" : "Tắt"}
            </Button>
          )}
          <Button size="sm" variant={status.has_token ? "outline" : "default"} onClick={() => setTokenOpen(true)}>
            <KeyRound />
            {status.has_token ? "Đổi token" : "Dán token Facebook"}
          </Button>
          {status.has_token && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoveOpen(true)}>
              <Unplug />
              Gỡ token
            </Button>
          )}
        </div>
      </div>

      {status.pending > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          <Loader2 className="size-4 animate-spin" />
          Đang chờ Facebook trả lời {status.pending} lượt hỏi… (thường dưới 1 phút)
        </p>
      )}
      {status.has_token && status.auto_enabled && status.last_auto_at && (
        <p className="text-xs text-muted-foreground">
          Lần tự kéo gần nhất: {when(status.last_auto_at)} · mỗi giờ hỏi lại số của 3 ngày gần nhất (Facebook còn cập nhật số
          tin nhắn vài ngày sau).
        </p>
      )}

      {!status.has_token && <TokenGuide defaultOpen />}

      <div className="grid gap-2">
        <p className="text-sm font-medium">
          TKQC Facebook <span className="font-normal text-muted-foreground">· {ready.length} TKQC sẽ được kéo số</span>
        </p>
        {facebook.length === 0 ? (
          <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">
            Chưa có TKQC Facebook nào. Thêm TKQC ở Marketing → Nhập liệu → Cài đặt TKQC.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {facebook.map((acc) => (
              <AccountRow key={acc.ad_account_id} acc={acc} hasToken={status.has_token} />
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Không kéo {others.length} TKQC không phải Facebook: {others.map((a) => a.name).join(", ")}.
          </p>
        )}
      </div>

      <TokenDialog open={tokenOpen} onOpenChange={setTokenOpen} replacing={status.has_token} onSaved={onChanged} />
      <ConfirmActionDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Gỡ token Facebook?"
        description="Hệ thống sẽ ngừng hỏi Facebook. Số đã kéo về vẫn giữ để xem lại; số nhân viên nhập tay không bị ảnh hưởng. Muốn kéo tiếp thì dán lại token."
        confirmLabel="Gỡ token"
        destructive
        onConfirm={async () => {
          await removeAutoToken();
          toast.success("Đã gỡ token Facebook");
          onChanged();
        }}
      />
    </section>
  );
}

function AccountRow({ acc, hasToken }: { acc: AutoAccount; hasToken: boolean }) {
  const health = accountHealth(acc, hasToken);
  const warnings = hasToken ? accountWarnings(acc) : [];
  const facts = [acc.currency, acc.timezone].filter(Boolean).join(" · ");
  return (
    <li className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-start sm:gap-4">
      <div className="min-w-0">
        <p className={cn("truncate font-medium", !acc.is_active && "text-muted-foreground")}>{acc.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">{acc.fb_account_id ? `act_${acc.fb_account_id}` : acc.account_id || "—"}</p>
      </div>
      <div className="min-w-0">
        <p className={cn("flex items-start gap-1.5", TEXT[health.tone])}>
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[health.tone])} aria-hidden />
          <span>
            {health.text}
            {health.tone === "good" && acc.last_ok_at && <span className="text-muted-foreground"> · {when(acc.last_ok_at)}</span>}
          </span>
        </p>
        {(acc.fb_name || facts) && (
          <p className="truncate text-xs text-muted-foreground">
            Trên Facebook: {[acc.fb_name, facts].filter(Boolean).join(" · ")}
          </p>
        )}
        {warnings.map((w) => (
          <p key={w} className="text-xs text-amber-700 dark:text-amber-300">
            {w}
          </p>
        ))}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums sm:text-right">
        {acc.first_day && acc.last_day ? `Có số ${formatDay(acc.first_day)} → ${formatDay(acc.last_day)}` : "Chưa có số"}
      </p>
    </li>
  );
}

/** Hướng dẫn lấy token Facebook (người dùng hệ thống, chỉ quyền xem số). */
function TokenGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-muted/30">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium">
          <span className="flex items-center gap-2">
            <CircleHelp className="size-4 text-muted-foreground" />
            Cách lấy token Facebook (khoảng 10 phút, làm một lần)
          </span>
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="grid list-decimal gap-2 px-3 pb-3 pl-8 text-sm text-muted-foreground marker:text-foreground">
          <li>
            Mở <span className="font-medium text-foreground">business.facebook.com/settings</span> (Cài đặt doanh nghiệp) bằng
            tài khoản quản trị của Business đang giữ các TKQC.
          </li>
          <li>
            <span className="font-medium text-foreground">Người dùng → Người dùng hệ thống → Thêm</span>: đặt tên vd
            “SMH ERP”, vai trò <span className="font-medium text-foreground">Nhân viên</span>.
          </li>
          <li>
            Chọn người dùng vừa tạo → <span className="font-medium text-foreground">Gán tài sản → Tài khoản quảng cáo</span>{" "}
            → tick các TKQC → chỉ bật quyền <span className="font-medium text-foreground">Xem hiệu quả</span> → Lưu.
          </li>
          <li>
            Bấm <span className="font-medium text-foreground">Tạo mã</span>: chọn ứng dụng của Business (chưa có thì tạo ở
            developers.facebook.com → Ứng dụng của tôi → Tạo ứng dụng, loại Doanh nghiệp), thời hạn{" "}
            <span className="font-medium text-foreground">Không bao giờ</span>, tick quyền{" "}
            <span className="font-mono text-xs text-foreground">ads_read</span> → Tạo mã → Sao chép.
          </li>
          <li>Bấm “Dán token Facebook” ở trên và dán vào. Xong là hệ thống tự kiểm tra từng TKQC và kéo 7 ngày gần nhất.</li>
        </ol>
        <p className="mx-3 mb-3 rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">
          Token chỉ có quyền <span className="font-medium text-foreground">xem số</span>, không sửa / tắt quảng cáo được; lưu
          trong cơ sở dữ liệu, không ai xem lại được. TKQC thuê hoặc nằm ở Business khác: nhờ bên giữ TKQC chia sẻ cho
          Business của mình (thêm làm đối tác), nếu không TKQC đó sẽ báo lỗi quyền.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TokenDialog({
  open,
  onOpenChange,
  replacing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replacing: boolean;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Mỗi lần mở là một form mới: không giữ token của lần trước trong bộ nhớ. */}
        {open && <TokenForm replacing={replacing} onDone={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function TokenForm({ replacing, onDone, onSaved }: { replacing: boolean; onDone: () => void; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const { token, ok } = cleanToken(value);
    if (!ok) {
      setError('Token không đúng dạng: token Facebook bắt đầu bằng "EAA" và chỉ gồm chữ và số. Kiểm tra lại, đừng copy thừa chữ.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await saveAutoToken(token);
      setValue("");
      toast.success("Đã lưu token Facebook", {
        description: result.accounts
          ? `Đang kiểm tra và kéo 7 ngày gần nhất của ${result.accounts} TKQC…`
          : "Chưa có TKQC Facebook nào có ID để kéo — điền ID TKQC ở trang TKQC & Page.",
      });
      onSaved();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{replacing ? "Đổi token Facebook" : "Dán token Facebook"}</DialogTitle>
        <DialogDescription>
          Token của người dùng hệ thống, quyền <span className="font-mono">ads_read</span> (chỉ xem số). Lưu xong không ai xem lại
          được, kể cả Quản trị.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="fb-token">Token</Label>
        <Input
          id="fb-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="EAA…"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          className="font-mono"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={saving}>
          Huỷ
        </Button>
        <Button type="submit" disabled={saving || !value.trim()}>
          {saving && <Loader2 className="animate-spin" />}
          Lưu token
        </Button>
      </DialogFooter>
    </form>
  );
}
