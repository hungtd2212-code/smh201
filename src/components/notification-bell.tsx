"use client";

import { Bell, CheckCheck, Wifi, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRole } from "@/components/safety/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { vnDateTime } from "@/lib/leads/crm";
import { fetchNotifications, markNotificationsRead, safeInternalLink, type AppNotification } from "@/lib/notifications";
import { cn } from "@/lib/utils";

/** Hỏi thông báo mới mỗi phút (và khi quay lại tab). */
const POLL_MS = 60_000;

/**
 * Nút chuông trên thanh trên cùng: số đỏ = thông báo chưa đọc (vd mất kết nối Pancake). Bấm để xem; bấm một
 * thông báo để tới đúng trang và đánh dấu đã đọc. Thông báo mới tới trong lúc đang dùng thì hiện thêm một dòng
 * nổi ở góc màn hình. Chỉ Admin, COO, Trưởng Telesale.
 */
export function NotificationBell() {
  const { isManager } = useRole();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [open, setOpen] = useState(false);
  const seenIds = useRef<Set<number> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchNotifications();
      if (next === null) {
        setItems(null); // chưa chạy file 026 → ẩn nút
        return;
      }
      // Thông báo mới tới (không phải lần tải đầu) → báo nổi một lần.
      if (seenIds.current) {
        for (const n of next) {
          if (seenIds.current.has(n.id) || n.read) continue;
          const show = n.kind === "pancake_down" ? toast.error : toast.success;
          const link = safeInternalLink(n.link);
          show(n.title, {
            description: n.body ?? undefined,
            duration: 15_000,
            action: link ? { label: "Xem", onClick: () => router.push(link) } : undefined,
          });
        }
      }
      seenIds.current = new Set(next.map((n) => n.id));
      setItems(next);
    } catch {
      // Không tải được thì thôi, lần sau thử lại; không chặn màn hình đang dùng.
    }
  }, [router]);

  useEffect(() => {
    if (!isManager) return;
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [isManager, load]);

  if (!isManager || items === null) return null;
  const unread = items.filter((n) => !n.read).length;

  async function readOne(n: AppNotification) {
    setOpen(false);
    if (!n.read) {
      setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? list);
      void markNotificationsRead([n.id]).catch(() => undefined);
    }
    const link = safeInternalLink(n.link);
    if (link) router.push(link);
  }

  async function readAll() {
    setItems((list) => list?.map((x) => ({ ...x, read: true })) ?? list);
    await markNotificationsRead().catch(() => undefined);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Thông báo: ${unread} chưa đọc` : "Thông báo"}
          title="Thông báo"
        >
          <Bell className={cn(unread > 0 && "text-foreground")} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-none font-bold text-white tabular-nums ring-2 ring-background">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="font-semibold">
            Thông báo
            {unread > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{unread} chưa đọc</span>}
          </p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void readAll()}>
              <CheckCheck />
              Đọc hết
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Chưa có thông báo nào.</p>
        ) : (
          <ul className="max-h-[min(28rem,70svh)] overflow-y-auto py-1">
            {items.map((n) => {
              const when = vnDateTime(n.created_at);
              const down = n.kind === "pancake_down";
              const Icon = down ? WifiOff : Wifi;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void readOne(n)}
                    className={cn(
                      "flex w-full gap-3 px-3 py-2.5 text-left hover:bg-muted/60",
                      !n.read && (down ? "bg-red-50/70 dark:bg-red-950/20" : "bg-emerald-50/70 dark:bg-emerald-950/20"),
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                        down ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className={cn("text-sm", n.read ? "font-medium text-muted-foreground" : "font-semibold")}>{n.title}</span>
                      {n.body && <span className="line-clamp-3 text-xs text-muted-foreground">{n.body}</span>}
                      {when && (
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {when.time} {when.day}
                        </span>
                      )}
                    </span>
                    {!n.read && <span aria-label="Chưa đọc" className="mt-2 size-2 shrink-0 rounded-full bg-red-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
