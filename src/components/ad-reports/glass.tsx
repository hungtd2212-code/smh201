"use client";

import { cn } from "@/lib/utils";

/**
 * Mảnh giao diện kính mờ (kiểu Liquid Glass của iPhone 17) dùng chung cho Theo dõi mục tiêu và Về đích theo tuần:
 * thanh tiến độ mảnh — phần tô màu bóng như giọt nước = đã hoàn thành, rãnh trắng trong = chưa hoàn thành.
 * Lớp CSS `glass`, `glass-stage`, `glass-track`, `glass-fill` ở src/app/globals.css.
 */

export type Tone = "good" | "warning" | "bad" | "running" | "none";

const FILL: Record<Tone, { className: string; glow: string }> = {
  good: { className: "bg-linear-to-r from-emerald-400 to-teal-500", glow: "oklch(0.72 0.15 170 / 0.75)" },
  warning: { className: "bg-linear-to-r from-amber-300 to-orange-400", glow: "oklch(0.8 0.15 70 / 0.75)" },
  bad: { className: "bg-linear-to-r from-rose-400 to-red-500", glow: "oklch(0.64 0.2 22 / 0.65)" },
  running: { className: "bg-linear-to-r from-sky-400 to-indigo-500", glow: "oklch(0.65 0.16 255 / 0.65)" },
  none: { className: "bg-linear-to-r from-slate-300 to-slate-400 dark:from-slate-500 dark:to-slate-400", glow: "transparent" },
};

/** Màu chữ ghi chú theo trạng thái (luôn đi kèm chữ, không chỉ dựa vào màu). */
export const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-700 dark:text-amber-300",
  bad: "text-rose-700 dark:text-rose-300",
  running: "text-sky-700 dark:text-sky-300",
  none: "text-muted-foreground",
};

export const TONE_DOT: Record<Tone, string> = {
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  bad: "bg-rose-500",
  running: "bg-sky-500",
  none: "bg-slate-400",
};

/**
 * Thanh tiến độ kính. `fill` 0 → 1 (lớn hơn 1 thì vẽ đầy). `pace` (0 → 1): vạch mức cần đạt tới hôm nay.
 * `size`: "sm" cao 6px (ô nhỏ), "md" cao 8px.
 */
export function GlassBar({
  fill,
  tone,
  pace,
  size = "md",
  label,
  className,
}: {
  fill: number;
  tone: Tone;
  pace?: number | null;
  size?: "sm" | "md";
  /** Mô tả cho trình đọc màn hình. */
  label: string;
  className?: string;
}) {
  const width = Math.min(100, Math.max(fill * 100, fill > 0 ? 3 : 0));
  return (
    <div
      className={cn("glass-track relative w-full overflow-hidden rounded-full", size === "sm" ? "h-1.5" : "h-2", className)}
      role="progressbar"
      aria-valuenow={Math.round(fill * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn("glass-fill h-full rounded-full transition-[width] duration-700 ease-out", FILL[tone].className)}
        style={{ width: `${width}%`, ["--glow" as string]: FILL[tone].glow }}
      />
      {pace != null && pace > 0 && pace < 1 && (
        <span
          className="absolute inset-y-0 w-px bg-slate-900/45 dark:bg-white/60"
          style={{ left: `${pace * 100}%` }}
          title="Mức cần đạt tới hôm nay"
        />
      )}
    </div>
  );
}

/** Tiền gọn: 17.079.080 → "17,1 tr"; 1.400.000.000 → "1,4 tỷ"; dưới 1 triệu giữ đủ số ("172.516đ"). */
export function shortMoney(value: number) {
  const abs = Math.abs(value);
  const short = (n: number, digits: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: digits });
  if (abs >= 1e9) return `${short(value / 1e9, 2)} tỷ`;
  if (abs >= 1e6) return `${short(value / 1e6, 1)} tr`;
  return `${Math.round(value).toLocaleString("vi-VN")}đ`;
}
