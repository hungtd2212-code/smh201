"use client";

import { ExternalLink, Loader2, MessageCircle, Paperclip, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CHAT_MORE_THRESHOLD,
  chatDayTime,
  decodeChatText,
  explainChatError,
  hasPancakeConversation,
  mergeChatMessages,
  safeHttpUrl,
  type PancakeChatAttachment,
  type PancakeChatMessage,
} from "@/lib/leads/pancake";
import { loadPancakeChat } from "@/lib/leads/pancake-repo";
import { cn } from "@/lib/utils";

/** Tự tải tin mới khi cửa sổ đang mở. */
const REFRESH_MS = 30_000;

type View =
  | { status: "loading" }
  | { status: "ready"; customer: string | null }
  | { status: "no_link" }
  | { status: "not_connected" }
  | { status: "error"; message: string };

/**
 * Cuộc chat Pancake của khách, hiện ngay trong cửa sổ chi tiết lead (chỉ xem). Trả lời khách vẫn làm trong
 * Pancake — nút "Trả lời trong Pancake" mở đúng cuộc chat.
 */
export function PancakeChat({ leadId, pancakeUrl, className }: { leadId: string; pancakeUrl: string | null; className?: string }) {
  const linked = hasPancakeConversation(pancakeUrl);
  const [view, setView] = useState<View>(linked ? { status: "loading" } : { status: "no_link" });
  const [messages, setMessages] = useState<PancakeChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<"refresh" | "older" | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const messagesRef = useRef<PancakeChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  // Sau khi vẽ lại: kéo xuống cuối (tin mới) hoặc giữ nguyên chỗ đang đọc (vừa thêm tin cũ ở trên).
  const scrollPlan = useRef<{ kind: "bottom" } | { kind: "keep"; fromBottom: number } | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const nearBottom = () => {
    const el = listRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  /** Tải 30 tin mới nhất: lần đầu thay cả danh sách, các lần sau ghép thêm tin mới. */
  const loadLatest = useCallback(
    async (mode: "first" | "refresh" | "silent") => {
      if (mode === "refresh") setBusy("refresh");
      try {
        const result = await loadPancakeChat(leadId);
        if (!alive.current) return;
        if (result.state === "ok") {
          const stick = mode === "first" || nearBottom();
          const merged = mode === "first" ? mergeChatMessages([], result.messages) : mergeChatMessages(messagesRef.current, result.messages);
          if (stick && merged.length !== messagesRef.current.length) scrollPlan.current = { kind: "bottom" };
          if (mode === "first") {
            scrollPlan.current = { kind: "bottom" };
            setHasMore(result.count >= CHAT_MORE_THRESHOLD);
          }
          setMessages(merged);
          setView({ status: "ready", customer: result.customer });
        } else if (result.state === "error") {
          // Đang xem được rồi mà lần tự tải sau bị lỗi thì giữ cuộc chat, không xoá màn hình.
          if (mode !== "silent" || messagesRef.current.length === 0) setView({ status: "error", message: explainChatError(result.message) });
        } else {
          setView({ status: result.state });
        }
      } catch (error) {
        if (!alive.current) return;
        if (mode !== "silent" || messagesRef.current.length === 0)
          setView({ status: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        if (alive.current && mode === "refresh") setBusy(null);
      }
    },
    [leadId],
  );

  async function loadOlder() {
    setBusy("older");
    try {
      const result = await loadPancakeChat(leadId, messagesRef.current.length);
      if (!alive.current) return;
      if (result.state === "ok") {
        const el = listRef.current;
        scrollPlan.current = { kind: "keep", fromBottom: el ? el.scrollHeight - el.scrollTop : 0 };
        setMessages((current) => mergeChatMessages(current, result.messages));
        setHasMore(result.count >= CHAT_MORE_THRESHOLD);
      } else if (result.state === "error") {
        setView({ status: "error", message: explainChatError(result.message) });
      }
    } catch (error) {
      if (alive.current) setView({ status: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  // Lần đầu mở cửa sổ.
  useEffect(() => {
    if (!linked) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải dữ liệu từ ngoài khi mở cửa sổ
    void loadLatest("first");
  }, [linked, loadLatest]);

  // Tự tải tin mới mỗi 30 giây khi đang xem được cuộc chat và tab đang mở.
  useEffect(() => {
    if (view.status !== "ready") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadLatest("silent");
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [view.status, loadLatest]);

  useLayoutEffect(() => {
    const el = listRef.current;
    const plan = scrollPlan.current;
    if (!el || !plan) return;
    el.scrollTop = plan.kind === "bottom" ? el.scrollHeight : el.scrollHeight - plan.fromBottom;
    scrollPlan.current = null;
  }, [messages, view.status]);

  const openUrl = safeHttpUrl(pancakeUrl);
  const title = view.status === "ready" && view.customer ? view.customer : "Cuộc chat Pancake";

  return (
    <section className={cn("flex min-h-0 flex-col bg-muted/30", className)} aria-label="Cuộc chat Pancake">
      <header className="flex items-center gap-2 border-b bg-popover py-2 pr-11 pl-4">
        <MessageCircle className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">Cuộc chat Pancake · chỉ xem, tự cập nhật</p>
        </div>
        {linked && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Tải lại cuộc chat"
            title="Tải lại"
            disabled={busy !== null || view.status === "loading"}
            onClick={() => void loadLatest(view.status === "ready" ? "refresh" : "first")}
          >
            <RefreshCw className={cn(busy === "refresh" && "animate-spin")} />
          </Button>
        )}
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {view.status === "loading" && (
          <Centered>
            <Loader2 className="size-5 animate-spin" />
            Đang tải cuộc chat từ Pancake…
          </Centered>
        )}
        {view.status === "no_link" && (
          <Centered>Số này không có cuộc chat Pancake (thêm tay, hoặc chưa có link hội thoại).</Centered>
        )}
        {view.status === "not_connected" && (
          <Centered>
            Page của cuộc chat này chưa kết nối Pancake trong ERP. Quản lý vào Telesale → Cài đặt → Kết nối Pancake.
          </Centered>
        )}
        {view.status === "error" && (
          <Centered>
            <span className="text-destructive">{view.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadLatest("first")}>
              <RefreshCw />
              Tải lại
            </Button>
          </Centered>
        )}
        {view.status === "ready" && messages.length === 0 && <Centered>Chưa có tin nhắn.</Centered>}
        {view.status === "ready" && messages.length > 0 && (
          <div className="grid gap-1.5">
            {hasMore && (
              <div className="flex justify-center pb-1">
                <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void loadOlder()}>
                  {busy === "older" ? <Loader2 className="animate-spin" /> : null}
                  Xem tin cũ hơn
                </Button>
              </div>
            )}
            {messages.map((m, i) => {
              const when = chatDayTime(m.at);
              const prevDay = i > 0 ? chatDayTime(messages[i - 1].at)?.day : null;
              return (
                <Fragment key={m.id}>
                  {when && when.day !== prevDay && (
                    <p className="py-1 text-center text-xs font-medium text-muted-foreground">{when.day}</p>
                  )}
                  <Bubble message={m} time={when?.time ?? null} />
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      {openUrl && (
        <footer className="border-t bg-popover px-4 py-2">
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Trả lời trong Pancake
            <ExternalLink className="size-3.5" />
          </a>
        </footer>
      )}
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Bubble({ message: m, time }: { message: PancakeChatMessage; time: string | null }) {
  const text = decodeChatText(m.text).trim();
  const system = m.attachments.filter((a) => a.type === "system_message");
  const media = m.attachments.filter((a) => a.type !== "system_message");
  if (!text && media.length === 0 && system.length > 0) {
    return (
      <p className="px-6 py-1 text-center text-xs text-muted-foreground">
        {system.map((a) => decodeChatText(a.text ?? a.title)).join(" · ")}
      </p>
    );
  }
  return (
    <div className={cn("flex flex-col gap-0.5", m.from_page ? "items-end" : "items-start")}>
      {m.from_page && m.sender && <span className="px-1 text-[11px] text-muted-foreground">{m.sender}</span>}
      <div
        className={cn(
          "grid max-w-[85%] gap-1.5 rounded-2xl px-3 py-2 text-sm",
          m.from_page ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-popover ring-1 ring-foreground/10",
          m.removed && "opacity-60",
        )}
      >
        {media.map((a, i) => (
          <Attachment key={i} attachment={a} onPage={m.from_page} />
        ))}
        {text && <p className={cn("break-words whitespace-pre-wrap", m.removed && "line-through")}>{text}</p>}
        {!text && media.length === 0 && <p className="italic opacity-70">(tin không có chữ)</p>}
      </div>
      <span className="px-1 text-[11px] text-muted-foreground tabular-nums">
        {time}
        {m.removed && " · đã gỡ"}
        {m.kind === "COMMENT" && " · bình luận"}
      </span>
    </div>
  );
}

function Attachment({ attachment: a, onPage }: { attachment: PancakeChatAttachment; onPage: boolean }) {
  const url = safeHttpUrl(a.url);
  const preview = safeHttpUrl(a.preview) ?? url;
  const link = safeHttpUrl(a.link) ?? url;
  const linkClass = cn("inline-flex items-center gap-1 underline underline-offset-2", onPage ? "text-primary-foreground" : "text-primary");

  if ((a.type === "photo" || a.type === "sticker" || a.type === "image") && preview) {
    return (
      <a href={url ?? preview} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ máy chủ Facebook/Pancake, không qua Next */}
        <img
          src={preview}
          alt={a.title ?? "Ảnh trong cuộc chat"}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={cn("max-h-64 rounded-lg object-contain", a.type === "sticker" ? "max-w-28" : "max-w-full")}
        />
      </a>
    );
  }
  if (a.type === "video" && url) {
    return (
      <video controls preload="metadata" src={url} className="max-h-64 max-w-full rounded-lg">
        <a href={url} target="_blank" rel="noreferrer" className={linkClass}>
          Xem video
        </a>
      </video>
    );
  }
  const label = decodeChatText(a.title ?? a.text ?? "").trim();
  if (!link && !label) return null;
  return (
    <div className="grid gap-0.5">
      {label && <p className="font-medium break-words whitespace-pre-wrap">{label}</p>}
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className={linkClass}>
          <Paperclip className="size-3.5" />
          {a.type === "template" ? "Mở liên kết" : "Mở tệp đính kèm"}
        </a>
      )}
    </div>
  );
}
