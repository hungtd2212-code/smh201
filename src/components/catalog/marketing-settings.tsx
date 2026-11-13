"use client";

import { Megaphone, Share2, UsersRound } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AdsStaffManager } from "./ads-staff-manager";
import { CampaignsManager } from "./campaigns-manager";
import { TkqcPageManager } from "./tkqc-page-manager";

/** Các thẻ của Marketing → Cài đặt. `?tab=` trên địa chỉ giữ thẻ đang mở (gửi link cho người khác vẫn đúng thẻ). */
const MARKETING_SETTINGS_TABS = [
  { key: "tkqc", label: "TKQC & Page", icon: Share2 },
  { key: "chien-dich", label: "Chiến dịch & Bài post", icon: Megaphone },
  { key: "nhan-vien-ads", label: "Nhân viên Ads", icon: UsersRound },
] as const;

/**
 * Marketing → Cài đặt: gom ba trang danh mục Marketing vào một mục menu (chủ phòng khám, 13/11/2026) —
 * TKQC & Page, Chiến dịch & Bài post, Nhân viên Ads. Mỗi thẻ là nguyên trang cũ; địa chỉ cũ tự chuyển về đây.
 */
export function MarketingSettings() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <Tabs />
    </Suspense>
  );
}

function Tabs() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = MARKETING_SETTINGS_TABS.find((t) => t.key === params.get("tab"))?.key ?? "tkqc";

  return (
    <div className="grid gap-5">
      <div role="tablist" aria-label="Cài đặt Marketing" className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1">
        {MARKETING_SETTINGS_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={current === key}
            onClick={() => router.replace(`${pathname}?tab=${key}`, { scroll: false })}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              current === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      {current === "tkqc" ? <TkqcPageManager /> : current === "chien-dich" ? <CampaignsManager /> : <AdsStaffManager />}
    </div>
  );
}
