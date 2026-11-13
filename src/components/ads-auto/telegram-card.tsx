"use client";

import { ChevronDown, CircleHelp, KeyRound, Loader2, RefreshCw, Search, Send, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { isAdminRole, useCurrentStaff } from "@/hooks/use-current-staff";
import { addDays, formatDay } from "@/lib/ad-reports/dates";
import {
  TELEGRAM_NOT_READY,
  cleanBotToken,
  collectTelegramNow,
  fetchTelegramStatus,
  findTelegramChats,
  lastBatch,
  previewTelegramReport,
  removeTelegramToken,
  saveTelegramToken,
  sendTelegramReport,
  setTelegramChat,
  setTelegramEnabled,
  type ReportPreview,
  type TelegramStatus,
} from "@/lib/ads-auto/telegram";
import { vnDateTime } from "@/lib/leads/crm";
import { cn } from "@/lib/utils";

const WATCH_MS = 3_000;
const WATCH_LIMIT_MS = 90_000;

const when = (iso: string | null) => {
  const t = vnDateTime(iso);
  return t ? `${t.time} ${t.day}` : null;
};

/**
 * "Báo cáo Telegram": mỗi sáng (10h) gửi vào nhóm báo cáo ngày hôm qua, mỗi nhân viên Ads một tin theo mẫu nhân
 * viên đang tự báo, bản chi tiết (file 033): Chi tiêu + Mess trình theo Facebook · Mess pan, Data theo Pancake · giá · tỷ lệ xin số.
 * Nút cài đặt chỉ Quản trị thấy.
 */
export function TelegramCard({ today }: { today: string }) {
  const staff = useCurrentStaff();
  const isAdmin = staff.status === "ok" && isAdminRole(staff.role);
  const [status, setStatus] = useState<TelegramStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [pickChat, setPickChat] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchTelegramStatus();
      setStatus(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  // Đang chờ Telegram (tìm nhóm / gửi tin) thì 3 giây đọc câu trả lời một lần.
  const waiting = (status?.pending ?? 0) > 0;
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        await collectTelegramNow();
      } catch {
        // Lịch chạy 20 giây một lần cũng tự đọc.
      }
      const next = await load();
      if (!next || next.pending === 0 || Date.now() - started > WATCH_LIMIT_MS) clearInterval(timer);
    }, WATCH_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function run(key: string, action: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await action();
      if (done) toast.success(done);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (status === undefined) {
    return error ? <CardShell><p className="text-sm text-destructive">{error}</p></CardShell> : <Skeleton className="h-28 w-full rounded-xl" />;
  }
  if (status === null) {
    return (
      <CardShell>
        <p className="text-sm text-muted-foreground">
          Phần này chưa dùng được: {TELEGRAM_NOT_READY.charAt(0).toLowerCase() + TELEGRAM_NOT_READY.slice(1)}
        </p>
      </CardShell>
    );
  }

  const batch = lastBatch(status.recent);
  const yesterday = addDays(today, -1);
  const showChats = status.has_token && (!status.chat_id || pickChat);

  return (
    <CardShell
      actions={
        isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {status.has_token && status.chat_id && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                aria-pressed={status.enabled}
                onClick={() =>
                  void run("toggle", () => setTelegramEnabled(!status.enabled), status.enabled ? "Đã tắt tự gửi" : "Đã bật tự gửi")
                }
              >
                <RefreshCw className={cn(busy === "toggle" && "animate-spin")} />
                Tự gửi {status.send_hour}h: {status.enabled ? "Bật" : "Tắt"}
              </Button>
            )}
            <Button size="sm" variant={status.has_token ? "outline" : "default"} onClick={() => setTokenOpen(true)}>
              <KeyRound />
              {status.has_token ? "Đổi token bot" : "Dán token bot"}
            </Button>
            {status.has_token && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoveOpen(true)}>
                <Unplug />
                Gỡ bot
              </Button>
            )}
          </div>
        )
      }
    >
      {/* Tình trạng */}
      {!status.has_token ? (
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Chưa kết nối: tạo một bot Telegram, dán token bot vào đây rồi chọn nhóm nhận báo cáo."
            : "Chưa kết nối: nhờ Quản trị cài bot Telegram."}
        </p>
      ) : (
        <div className="grid gap-1 text-sm">
          <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
            <span className="font-medium text-foreground">{status.bot_username ? `@${status.bot_username}` : "Đã có bot"}</span>
            <span className="font-mono text-xs">…{status.token_hint}</span>
            {status.token_set_at && <span>· dán lúc {when(status.token_set_at)}{status.token_set_by && ` bởi ${status.token_set_by}`}</span>}
          </p>
          {status.chat_id ? (
            <p>
              Gửi vào nhóm <span className="font-medium">{status.chat_title ?? status.chat_id}</span>{" "}
              {status.enabled ? (
                <>
                  lúc <span className="font-medium">{status.send_hour}:00 mỗi sáng</span>: báo cáo ngày hôm qua, mỗi nhân viên Ads một tin.
                </>
              ) : (
                <span className="text-muted-foreground">— đang tắt tự gửi.</span>
              )}
              {isAdmin && !pickChat && (
                <button type="button" className="ml-1.5 text-primary underline-offset-2 hover:underline" onClick={() => setPickChat(true)}>
                  Đổi nhóm
                </button>
              )}
            </p>
          ) : (
            <p className="text-amber-700 dark:text-amber-300">Chưa chọn nhóm nhận báo cáo.</p>
          )}
        </div>
      )}

      {status.pending > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          <Loader2 className="size-4 animate-spin" />
          Đang chờ Telegram… {batch && batch.waiting > 0 && `còn ${batch.waiting} tin chưa gửi`}
        </p>
      )}
      {status.last_error && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {status.last_error}
        </p>
      )}
      {batch && (
        <p className="text-xs text-muted-foreground">
          Lần gửi gần nhất: báo cáo {formatDay(batch.reportDate)} ({batch.kind === "auto" ? "tự gửi" : "gửi tay"}) · {batch.sent}/{batch.total} tin đã
          tới nhóm
          {batch.lastSentAt && ` lúc ${when(batch.lastSentAt)}`}
          {batch.failed > 0 && ` · ${batch.failed} tin lỗi${batch.error ? `: ${batch.error}` : ""}`}
        </p>
      )}

      {/* Chọn nhóm */}
      {isAdmin && showChats && (
        <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-medium">Chọn nhóm nhận báo cáo</p>
          <p className="text-muted-foreground">
            Thêm bot {status.bot_username ? <span className="font-mono text-foreground">@{status.bot_username}</span> : "vừa tạo"} vào nhóm báo cáo,
            trong nhóm gõ{" "}
            <span className="font-mono text-foreground">/start{status.bot_username ? `@${status.bot_username}` : ""}</span>, rồi bấm Tìm nhóm.
          </p>
          {status.chats.length > 0 && (
            <ul className="divide-y rounded-md border bg-background">
              {status.chats.map((c) => (
                <li key={c.chat_id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate">{c.title ?? c.chat_id}</span>
                  {c.chat_id === status.chat_id ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-300">Đang gửi vào nhóm này</span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void run("chat", async () => {
                          await setTelegramChat(c.chat_id);
                          setPickChat(false);
                        }, `Đã chọn nhóm ${c.title ?? c.chat_id}`)
                      }
                    >
                      Chọn
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null || status.pending > 0} onClick={() => void run("find", findTelegramChats)}>
              {busy === "find" || status.pending > 0 ? <Loader2 className="animate-spin" /> : <Search />}
              Tìm nhóm
            </Button>
            {status.chat_id && (
              <Button size="sm" variant="ghost" onClick={() => setPickChat(false)}>
                Xong
              </Button>
            )}
          </div>
          {status.chats.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Chưa thấy nhóm nào. Telegram chỉ giữ tin 24 giờ: nếu bot đã ở trong nhóm từ trước, gõ lệnh trên trong nhóm rồi bấm Tìm nhóm.
            </p>
          )}
        </div>
      )}

      {isAdmin && !status.has_token && <BotGuide />}

      <Preview
        defaultDay={yesterday}
        today={today}
        canSend={isAdmin && status.has_token && !!status.chat_id && status.pending === 0}
        chatTitle={status.chat_title}
        onSent={() => void load()}
      />

      {isAdmin && (
        <>
          <TokenDialog open={tokenOpen} onOpenChange={setTokenOpen} replacing={status.has_token} onSaved={() => void load()} />
          <ConfirmActionDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            title="Gỡ bot Telegram?"
            description="Hệ thống ngừng gửi báo cáo vào nhóm; tin chưa gửi bị huỷ. Bot vẫn nằm trong nhóm (xoá bot khỏi nhóm trên Telegram nếu muốn). Muốn gửi tiếp thì dán lại token bot."
            confirmLabel="Gỡ bot"
            destructive
            onConfirm={async () => {
              await removeTelegramToken();
              toast.success("Đã gỡ bot Telegram");
              await load();
            }}
          />
        </>
      )}
    </CardShell>
  );
}

function CardShell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Send className="size-4 text-muted-foreground" />
          Báo cáo Telegram
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Xem trước các tin của một ngày (đúng nội dung sẽ gửi) + nút gửi ngay. */
function Preview({
  defaultDay,
  today,
  canSend,
  chatTitle,
  onSent,
}: {
  defaultDay: string;
  today: string;
  canSend: boolean;
  chatTitle: string | null;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(defaultDay);
  const [data, setData] = useState<ReportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(() => {
      setData(null);
      previewTelegramReport(day)
        .then((d) => alive && (setData(d), setError(null)))
        .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, day]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium">
          Xem trước báo cáo
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 px-3 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="tg-day" className="text-sm text-muted-foreground">
            Ngày
          </Label>
          <Input
            id="tg-day"
            type="date"
            className="w-auto"
            value={day}
            max={addDays(today, -1)}
            onChange={(e) => e.target.value && setDay(e.target.value)}
          />
          {canSend && data && !data.missing && data.messages.length > 0 && (
            <Button size="sm" onClick={() => setConfirmOpen(true)}>
              <Send />
              Gửi ngay vào nhóm
            </Button>
          )}
        </div>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data === null ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : data.missing ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">{data.missing}: chưa soạn được báo cáo ngày này.</p>
        ) : data.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ngày {formatDay(day)} không có nhân viên nào chạy quảng cáo.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.messages.map((m) => (
              <pre
                key={m.title}
                className="rounded-2xl rounded-bl-sm border bg-emerald-50/60 px-3 py-2 font-sans text-sm leading-relaxed whitespace-pre-wrap dark:bg-emerald-950/30"
              >
                {m.body}
              </pre>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Chi tiêu và Mess trình theo trình quản lý quảng cáo Facebook (lượt bắt đầu trò chuyện qua tin nhắn); Mess pan và Data (số
          điện thoại) theo thống kê quảng cáo của Pancake. Số gộp theo nhân viên đang cầm TKQC ngày đó. Giá = chi tiêu chia cho số
          tương ứng; tỷ lệ xin số = Data / Mess trình.
        </p>
        {data && (
          <ConfirmActionDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={`Gửi báo cáo ${formatDay(day)} vào nhóm?`}
            description={`Gửi ${data.messages.length} tin (mỗi nhân viên một tin) vào nhóm ${chatTitle ?? "đã chọn"}. Tin đã gửi không thu hồi được từ đây.`}
            confirmLabel="Gửi"
            onConfirm={async () => {
              const n = await sendTelegramReport(day);
              toast.success(`Đang gửi ${n} tin vào nhóm…`);
              onSent();
            }}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Cách tạo bot Telegram (làm một lần). */
function BotGuide() {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-muted/30">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium">
          <span className="flex items-center gap-2">
            <CircleHelp className="size-4 text-muted-foreground" />
            Cách tạo bot Telegram (khoảng 3 phút, làm một lần)
          </span>
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="grid list-decimal gap-2 px-3 pb-3 pl-8 text-sm text-muted-foreground marker:text-foreground">
          <li>
            Trong Telegram, tìm <span className="font-mono text-foreground">@BotFather</span> (có dấu tick xanh) → gửi{" "}
            <span className="font-mono text-foreground">/newbot</span>.
          </li>
          <li>
            Đặt tên hiển thị (vd <span className="font-medium text-foreground">SMH Báo cáo Ads</span>), rồi tên đăng nhập kết thúc
            bằng <span className="font-mono text-foreground">bot</span> (vd <span className="font-mono text-foreground">smh_baocao_bot</span>).
          </li>
          <li>
            BotFather gửi lại token dạng <span className="font-mono text-foreground">123456789:AAH…</span> → sao chép, bấm “Dán token
            bot” ở trên và dán vào.
          </li>
          <li>Thêm bot vào nhóm báo cáo (Thêm thành viên → tìm tên đăng nhập của bot).</li>
          <li>
            Trong nhóm gõ <span className="font-mono text-foreground">/start@tên_bot</span>, rồi bấm “Tìm nhóm” ở đây và chọn nhóm.
          </li>
        </ol>
        <p className="mx-3 mb-3 rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">
          Bot chỉ gửi báo cáo, không đọc tin nhắn trong nhóm. Token lưu trong cơ sở dữ liệu, không ai xem lại được.
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
    const { token, ok } = cleanBotToken(value);
    if (!ok) {
      setError("Token bot không đúng dạng: token Telegram có dạng 123456789:AAH… (lấy ở @BotFather). Kiểm tra lại, đừng copy thừa chữ.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveTelegramToken(token);
      setValue("");
      toast.success("Đã lưu token bot", { description: "Đang tìm các nhóm bot đã được thêm vào…" });
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
        <DialogTitle>{replacing ? "Đổi token bot Telegram" : "Dán token bot Telegram"}</DialogTitle>
        <DialogDescription>
          Token BotFather gửi khi tạo bot. Lưu xong không ai xem lại được, kể cả Quản trị.{replacing && " Đổi token thì phải chọn lại nhóm."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="tg-token">Token bot</Label>
        <Input
          id="tg-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="123456789:AAH…"
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
