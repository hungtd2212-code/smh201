import { cn } from "@/lib/utils";

/** "Nguyễn Văn Bê" → "NB"; "An" → "AN". */
export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

// Màu nền chữ cái đầu (khi chưa có ảnh): cố định theo tên để mỗi người luôn một màu.
const TONES = [
  "bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-100",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-100",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-100",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-100",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-100",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-100",
];
const toneOf = (name: string) => TONES[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % TONES.length];

/** Ảnh đại diện tròn; chưa có ảnh thì hiện chữ cái đầu của tên. */
export function StaffAvatar({
  name,
  url,
  className,
}: {
  name: string;
  url?: string | null;
  /** Kích thước, vd "size-8" (mặc định), "size-16". */
  className?: string;
}) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- ảnh từ Supabase Storage, đã thu nhỏ khi tải lên
    return <img src={url} alt={name} className={cn("size-8 shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold select-none",
        toneOf(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
