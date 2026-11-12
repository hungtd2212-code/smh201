"use client";

import { useEffect, useState } from "react";
import { StaffAvatar } from "@/components/staff/staff-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { ONLINE_CHANNEL, onlinePeople, sinceLabel, type OnlineMeta, type OnlinePerson } from "@/lib/staff/online";
import { positionLabel } from "@/lib/staff/positions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const PILL =
  "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-background";

/**
 * Dãy ảnh đại diện những người đang mở phần mềm, cạnh nút sáng / tối. Bấm vào để xem cả danh sách.
 * Dùng kênh riêng tư của Supabase Realtime (supabase/019_online_presence.sql): không ghi gì vào cơ sở
 * dữ liệu, đóng trang là tự biến mất. Chưa chạy file 019 thì kênh từ chối → không hiện gì.
 */
export function OnlineUsers() {
  const staff = useCurrentStaff();
  const [online, setOnline] = useState<{ people: OnlinePerson[]; at: Date }>({ people: [], at: new Date(0) });

  const ok = staff.status === "ok";
  const userId = ok ? staff.userId : null;
  const name = ok ? staff.fullName : "";
  const avatarUrl = ok ? staff.avatarUrl : null;
  const position = ok ? positionLabel(staff.position, staff.role) : "";

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabaseBrowserClient();
    const meta: OnlineMeta = { name, avatar_url: avatarUrl, position, since: new Date().toISOString() };
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      // Kênh riêng tư: Realtime cần biết ai đang đăng nhập trước khi cho vào.
      await supabase.realtime.setAuth();
      if (cancelled) return;
      const ch = supabase.channel(ONLINE_CHANNEL, { config: { private: true, presence: { key: userId } } });
      channel = ch;
      ch.on("presence", { event: "sync" }, () => {
        setOnline({ people: onlinePeople(ch.presenceState(), userId), at: new Date() });
      }).subscribe((status) => {
        // Cũng chạy lại sau mỗi lần mất mạng rồi vào lại kênh.
        if (status === "SUBSCRIBED") void ch.track(meta);
      });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, name, avatarUrl, position]);

  const { people, at } = online;
  if (!userId || people.length === 0) return null;
  const names = people.map((p) => (p.me ? `${p.name} (bạn)` : p.name)).join(", ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${people.length} người đang online`}
          title={`Đang online: ${names}`}
          className="flex shrink-0 items-center -space-x-2 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {people.slice(0, 5).map((p, i) => (
            <StaffAvatar
              key={p.userId}
              name={p.name}
              url={p.avatarUrl}
              className={cn("size-7 ring-2 ring-background", i >= 3 && "max-sm:hidden")}
            />
          ))}
          {/* Điện thoại hiện 3 người, máy tính 5 người; còn lại gộp thành "+N". */}
          {people.length > 3 && <span className={cn(PILL, "sm:hidden")}>+{people.length - 3}</span>}
          {people.length > 5 && <span className={cn(PILL, "max-sm:hidden")}>+{people.length - 5}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">Đang online · {people.length} người</div>
        <ul className="max-h-80 overflow-y-auto p-1">
          {people.map((p) => (
            <li key={p.userId} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
              <span className="relative shrink-0">
                <StaffAvatar name={p.name} url={p.avatarUrl} />
                <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-popover" />
              </span>
              <span className="grid min-w-0 leading-tight">
                <span className="truncate text-sm font-medium">
                  {p.name}
                  {p.me && <span className="font-normal text-muted-foreground"> (bạn)</span>}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {[p.position, sinceLabel(p.since, at)].filter(Boolean).join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
