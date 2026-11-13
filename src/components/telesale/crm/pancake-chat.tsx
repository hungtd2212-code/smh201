"use client";

import { ExternalLink, Loader2, Paperclip, RefreshCw, SendHorizontal, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CHAT_MORE_THRESHOLD,
  chatDayLabel,
  chatDayTime,
  decodeChatText,
  explainChatError,
  hasPancakeConversation,
  lastCustomerMessage,
  mergeChatMessages,
  outsideMessengerWindow,
  safeHttpUrl,
  splitChatPhones,
  type PancakeChatAttachment,
  type PancakeChatMessage,
} from "@/lib/leads/pancake";
import { loadPancakeChat, sendPancakeReply } from "@/lib/leads/pancake-repo";
import { cn } from "@/lib/utils";

/** Tự tải tin mới khi cửa sổ đang mở. */
const REFRESH_MS = 30_000;
/** Hai tin cùng phía cách nhau dưới 5 phút thì gộp thành một cụm (một tên, một giờ, một ảnh đại diện). */
const GROUP_MS = 5 * 60_000;

// Màu như Pancake để nhân viên thấy quen: nền be, tin khách trắng, tin page xanh lá nhạt, số điện thoại tô màu.
const UI = {
  canvas: "bg-[#e7dfd8] dark:bg-[#1f1c1a]",
  customer: "bg-white text-[#1c1e21] shadow-[0_1px_1px_rgba(0,0,0,0.08)] dark:bg-[#303031] dark:text-[#e4e6eb]",
  page: "bg-[#dcf6c8] text-[#1c1e21] shadow-[0_1px_1px_rgba(0,0,0,0.08)] dark:bg-[#29462c] dark:text-[#e4e6eb]",
  chip: "bg-[#f4efeb] text-[#4b4b4b] shadow-[0_1px_1px_rgba(0,0,0,0.06)] dark:bg-white/10 dark:text-[#d0d0d0]",
  phoneOther: "bg-[#1fa3e5] text-white",
  phoneLead: "bg-[#ff7a00] text-white",
  meta: "text-[#7a7470] dark:text-[#a8a29e]",
};

type View =
  | { status: "loading" }
  | { status: "ready"; customer: string | null }
  | { status: "no_link" }
  | { status: "not_connected" }
  | { status: "error"; message: string };

/** Tin vừa gửi từ ô trả lời, hiện ngay trong lúc chờ Pancake / lần tải lại kế tiếp. */
type Outgoing = { key: number; text: string; status: "sending" | "sent" };

type Props = {
  leadId: string;
  pancakeUrl: string | null;
  /** Số của lead — trong cuộc chat tô cam (số khác tô xanh), như Pancake. */
  leadPhone: string | null;
  /** Tên page trong ERP — ô trả lời ghi "Trả lời từ <tên page>". */
  pageName: string | null;
  className?: string;
};

/**
 * Cuộc chat Pancake của khách ngay trong cửa sổ chi tiết lead, giao diện như Pancake: xem tin, ảnh, thẻ quảng
 * cáo và trả lời khách (Messenger hoặc trả lời bình luận) mà không phải mở tab Pancake.
 */
export function PancakeChat({ leadId, pancakeUrl, leadPhone, pageName, className }: Props) {
  const linked = hasPancakeConversation(pancakeUrl);
  const [view, setView] = useState<View>(linked ? { status: "loading" } : { status: "no_link" });
  const [messages, setMessages] = useState<PancakeChatMessage[]>([]);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
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
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
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
          if (stick && (mode === "first" || merged.length !== messagesRef.current.length)) scrollPlan.current = { kind: "bottom" };
          if (mode === "first") setHasMore(result.count >= CHAT_MORE_THRESHOLD);
          setMessages(merged);
          // Tin đã gửi xong giờ đã nằm trong cuộc chat Pancake trả về.
          setOutbox((items) => items.filter((o) => o.status === "sending"));
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

  /** Gửi một tin. Trả lời lỗi (để ô trả lời giữ lại chữ) hoặc null khi đã gửi. */
  async function send(text: string): Promise<string | null> {
    const last = lastCustomerMessage(messagesRef.current);
    const replyTo = last?.kind === "COMMENT" ? last.id : null;
    const key = Date.now();
    scrollPlan.current = { kind: "bottom" };
    setOutbox((items) => [...items, { key, text, status: "sending" }]);
    try {
      const result = await sendPancakeReply(leadId, text, replyTo);
      if (!alive.current) return null;
      if (result.state === "sent") {
        setOutbox((items) => items.map((o) => (o.key === key ? { ...o, status: "sent" } : o)));
        window.setTimeout(() => void loadLatest("silent"), 1500);
        return null;
      }
      setOutbox((items) => items.filter((o) => o.key !== key));
      return explainChatError(result.message);
    } catch (error) {
      if (alive.current) setOutbox((items) => items.filter((o) => o.key !== key));
      return explainChatError(error instanceof Error ? error.message : String(error));
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
  }, [messages, outbox, view.status]);

  const openUrl = safeHttpUrl(pancakeUrl);
  const customer = view.status === "ready" ? view.customer : null;
  const now = new Date();
  const lastCustomer = lastCustomerMessage(messages);

  return (
    <section className={cn("flex min-h-0 flex-col", UI.canvas, className)} aria-label="Cuộc chat Pancake">
      <header className="flex items-center gap-3 border-b bg-popover py-2 pr-11 pl-4">
        <Avatar name={customer} className="size-10 text-base" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{customer ?? "Cuộc chat Pancake"}</p>
          <p className="truncate text-xs text-muted-foreground">{pageName ? `Pancake · ${pageName}` : "Pancake"}</p>
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
        {openUrl && (
          <Button asChild variant="ghost" size="icon-sm" title="Mở trong Pancake">
            <a href={openUrl} target="_blank" rel="noreferrer" aria-label="Mở cuộc chat trong Pancake">
              <ExternalLink />
            </a>
          </Button>
        )}
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        {view.status === "loading" && (
          <Centered>
            <Loader2 className="size-5 animate-spin" />
            Đang tải cuộc chat từ Pancake…
          </Centered>
        )}
        {view.status === "no_link" && <Centered>Số này không có cuộc chat Pancake (thêm tay, hoặc chưa có link hội thoại).</Centered>}
        {view.status === "not_connected" && (
          <Centered>Page của cuộc chat này chưa kết nối Pancake trong ERP. Quản lý vào Telesale → Cài đặt → Kết nối Pancake.</Centered>
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
        {view.status === "ready" && messages.length === 0 && outbox.length === 0 && <Centered>Chưa có tin nhắn.</Centered>}
        {view.status === "ready" && (messages.length > 0 || outbox.length > 0) && (
          <div className="flex flex-col">
            {hasMore && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void loadOlder()}
                  className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium hover:opacity-80", UI.chip)}
                >
                  {busy === "older" && <Loader2 className="size-3.5 animate-spin" />}
                  Xem tin cũ hơn
                </button>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const label = chatDayLabel(m.at, now);
              const newDay = label !== null && label !== chatDayLabel(prev?.at, now);
              const first = !prev || newDay || prev.from_page !== m.from_page || gap(prev, m) > GROUP_MS;
              const nextNewDay = next && chatDayLabel(next.at, now) !== label;
              const last = !next || nextNewDay || next.from_page !== m.from_page || gap(m, next) > GROUP_MS;
              return (
                <div key={m.id} className={cn(first ? "mt-3" : "mt-0.5")}>
                  {newDay && (
                    <div className="flex justify-center pt-1 pb-3">
                      <span className={cn("rounded-full px-4 py-1 text-xs font-medium", UI.chip)}>{label}</span>
                    </div>
                  )}
                  <Message
                    message={m}
                    showSender={first}
                    showTail={last}
                    time={last ? chatDayTime(m.at)?.time ?? null : null}
                    customer={customer}
                    leadPhone={leadPhone}
                  />
                </div>
              );
            })}
            {outbox.map((o) => (
              <div key={o.key} className="mt-1.5 flex flex-col items-end">
                <div className={cn("max-w-[80%] rounded-[18px] px-3.5 py-2 text-sm", UI.page, o.status === "sending" && "opacity-70")}>
                  <p className="break-words whitespace-pre-wrap">{o.text}</p>
                </div>
                <span className={cn("px-1 pt-0.5 text-[11px]", UI.meta)}>{o.status === "sending" ? "Đang gửi…" : "Đã gửi"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {view.status === "ready" && (
        <Composer
          pageName={pageName}
          comment={lastCustomer?.kind === "COMMENT"}
          stale={outsideMessengerWindow(messages, now)}
          onSend={send}
        />
      )}
    </section>
  );
}

const gap = (a: PancakeChatMessage, b: PancakeChatMessage) =>
  a.at && b.at ? Math.abs(Date.parse(b.at) - Date.parse(a.at)) : 0;

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-[#5f5a56] dark:text-muted-foreground">
      {children}
    </div>
  );
}

/** Ảnh đại diện chữ cái đầu (Pancake không cho lấy ảnh Facebook của khách qua token page). */
function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  const letter = (name ?? "").trim().split(/\s+/).pop()?.[0]?.toUpperCase() ?? "?";
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-[#b9aea5] font-semibold text-white dark:bg-[#5a524c]", className)}
    >
      {letter}
    </span>
  );
}

function ChatText({ text, leadPhone, className }: { text: string; leadPhone: string | null; className?: string }) {
  return (
    <p className={cn("break-words whitespace-pre-wrap", className)}>
      {splitChatPhones(text, leadPhone).map((part, i) =>
        part.phone ? (
          <span
            key={i}
            className={cn("rounded px-1 py-px font-medium tabular-nums", part.phone === "lead" ? UI.phoneLead : UI.phoneOther)}
            title={part.phone === "lead" ? "Số của khách này" : "Số điện thoại"}
          >
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function Message({
  message: m,
  showSender,
  showTail,
  time,
  customer,
  leadPhone,
}: {
  message: PancakeChatMessage;
  showSender: boolean;
  showTail: boolean;
  time: string | null;
  customer: string | null;
  leadPhone: string | null;
}) {
  const text = decodeChatText(m.text).trim();
  const system = m.attachments.filter((a) => a.type === "system_message");
  const ads = m.attachments.filter((a) => a.type === "ad_click");
  const photos = m.attachments.filter((a) => (a.type === "photo" || a.type === "sticker" || a.type === "image") && safeHttpUrl(a.preview ?? a.url));
  const others = m.attachments.filter((a) => !system.includes(a) && !ads.includes(a) && !photos.includes(a));

  if (!text && ads.length === 0 && photos.length === 0 && others.length === 0) {
    if (system.length === 0) return null;
    return (
      <p className={cn("px-6 text-center text-xs", UI.meta)}>{system.map((a) => decodeChatText(a.text ?? a.title)).join(" · ")}</p>
    );
  }

  const side = m.from_page ? "items-end" : "items-start";
  const bubble = m.from_page ? UI.page : UI.customer;
  return (
    <div className={cn("flex gap-2", m.from_page ? "justify-end" : "justify-start")}>
      {!m.from_page && (
        <div className="flex w-8 shrink-0 items-end pb-4">{showTail && <Avatar name={customer} className="size-8 text-sm" />}</div>
      )}
      <div className={cn("flex max-w-[80%] min-w-0 flex-col gap-1", side)}>
        {m.from_page && showSender && m.sender && <span className={cn("px-1 text-[11px]", UI.meta)}>{m.sender}</span>}
        {ads.map((a, i) => (
          <AdCard key={`ad${i}`} attachment={a} />
        ))}
        {photos.length > 0 && (
          <div className={cn("flex flex-wrap gap-1", m.from_page && "justify-end")}>
            {photos.map((a, i) => (
              <Photo key={`p${i}`} attachment={a} />
            ))}
          </div>
        )}
        {(text || others.length > 0) && (
          <div className={cn("grid gap-1.5 rounded-[18px] px-3.5 py-2 text-sm", bubble, m.removed && "opacity-60")}>
            {others.map((a, i) => (
              <OtherAttachment key={`o${i}`} attachment={a} />
            ))}
            {text && <ChatText text={text} leadPhone={leadPhone} className={cn(m.removed && "line-through")} />}
          </div>
        )}
        {(time || m.removed || m.kind === "COMMENT") && (
          <span className={cn("px-1 text-[11px] tabular-nums", UI.meta)}>
            {time}
            {m.removed && " · đã gỡ"}
            {m.kind === "COMMENT" && " · bình luận"}
          </span>
        )}
      </div>
    </div>
  );
}

function Photo({ attachment: a }: { attachment: PancakeChatAttachment }) {
  const preview = safeHttpUrl(a.preview) ?? safeHttpUrl(a.url);
  if (!preview) return null;
  return (
    <a href={safeHttpUrl(a.url) ?? preview} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl">
      {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ máy chủ Facebook/Pancake, không qua Next */}
      <img
        src={preview}
        alt={a.title ?? "Ảnh trong cuộc chat"}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={cn("block object-cover", a.type === "sticker" ? "max-h-28 max-w-28 object-contain" : "max-h-60 max-w-[15rem]")}
      />
    </a>
  );
}

/** Thẻ quảng cáo khách bấm "Gửi tin nhắn": ảnh bài, nội dung (thu gọn 2 dòng, bấm "Xem thêm"). */
function AdCard({ attachment: a }: { attachment: PancakeChatAttachment }) {
  const [open, setOpen] = useState(false);
  const image = safeHttpUrl(a.ad_image);
  const link = safeHttpUrl(a.url);
  const text = decodeChatText(a.ad_text ?? a.title).trim();
  return (
    <div className={cn("w-80 max-w-full overflow-hidden rounded-2xl", UI.customer)}>
      {image &&
        (link ? (
          <a href={link} target="_blank" rel="noreferrer" title="Mở bài quảng cáo">
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh bài quảng cáo từ Pancake */}
            <img src={image} alt="Ảnh bài quảng cáo" loading="lazy" referrerPolicy="no-referrer" className="block max-h-56 w-full object-cover" />
          </a>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh bài quảng cáo từ Pancake
          <img src={image} alt="Ảnh bài quảng cáo" loading="lazy" referrerPolicy="no-referrer" className="block max-h-56 w-full object-cover" />
        ))}
      <div className="grid gap-1 px-3 py-2 text-sm">
        <span className={cn("text-[11px] font-medium tracking-wide uppercase", UI.meta)}>Khách nhắn từ quảng cáo</span>
        {text && <p className={cn("break-words whitespace-pre-wrap", !open && "line-clamp-2")}>{text}</p>}
        <div className="flex gap-3 text-[13px]">
          {text.length > 80 && (
            <button type="button" className="font-medium text-[#1877f2] hover:underline" onClick={() => setOpen((v) => !v)}>
              {open ? "Thu gọn" : "Xem thêm"}
            </button>
          )}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#1877f2] hover:underline">
              Mở bài
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function OtherAttachment({ attachment: a }: { attachment: PancakeChatAttachment }) {
  const url = safeHttpUrl(a.url);
  const link = safeHttpUrl(a.link) ?? url;
  if (a.type === "video" && url) {
    return (
      <video controls preload="metadata" src={url} className="max-h-60 max-w-full rounded-lg">
        <a href={url} target="_blank" rel="noreferrer">
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
        <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#1877f2] underline-offset-2 hover:underline">
          <Paperclip className="size-3.5" />
          {a.type === "template" ? "Mở liên kết" : "Mở tệp đính kèm"}
        </a>
      )}
    </div>
  );
}

/** Ô "Trả lời từ <tên page>" như Pancake: Enter gửi, Shift+Enter xuống dòng. */
function Composer({
  pageName,
  comment,
  stale,
  onSend,
}: {
  pageName: string | null;
  /** Tin cuối của khách là bình luận → trả lời bình luận đó. */
  comment: boolean;
  /** Khách nhắn lần cuối quá 24 giờ — Facebook có thể chặn. */
  stale: boolean;
  onSend: (text: string) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useLayoutEffect(grow, [text]);

  async function submit() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    setText("");
    const problem = await onSend(value);
    setSending(false);
    if (problem) {
      setError(problem);
      setText((current) => current || value); // giữ lại chữ để sửa / gửi lại
    }
    ref.current?.focus();
  }

  const from = pageName ?? "page";
  return (
    <div className="border-t bg-popover">
      {stale && !error && (
        <p className="flex items-start gap-1.5 px-4 pt-2 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          Khách nhắn lần cuối hơn 24 giờ trước — Facebook có thể không cho page nhắn tiếp. Nên gọi điện cho khách.
        </p>
      )}
      {error && <p className="px-4 pt-2 text-xs text-destructive">{error}</p>}
      <form
        className="flex items-end gap-2 px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Avatar name={pageName} className="mb-0.5 size-8 bg-[#1877f2] text-sm dark:bg-[#1877f2]" />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          maxLength={2000}
          aria-label={comment ? `Trả lời bình luận từ ${from}` : `Trả lời từ ${from}`}
          placeholder={comment ? `Trả lời bình luận từ ${from}` : `Trả lời từ ${from}`}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            // Bộ gõ tiếng Việt đang ghép chữ thì Enter là để chốt chữ, không phải để gửi.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              void submit();
            }
          }}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="icon" className="mb-0.5 rounded-full" disabled={!text.trim() || sending} aria-label="Gửi tin">
          {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
        </Button>
      </form>
      <p className="px-4 pb-1.5 text-[11px] text-muted-foreground">Enter để gửi · Shift + Enter để xuống dòng · khách nhận tin từ page qua Pancake</p>
    </div>
  );
}
