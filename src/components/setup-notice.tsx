import { Info } from "lucide-react";

/** Hiện khi ứng dụng chưa có thông tin kết nối Supabase (thiếu .env.local). */
export function SetupNotice() {
  return (
    <div className="mx-auto mt-10 flex max-w-xl items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <Info className="mt-0.5 size-4 shrink-0" />
      <div className="grid gap-1">
        <p className="font-medium">Ứng dụng chưa kết nối Supabase</p>
        <p>
          Chạy lệnh <code>npm run setup:supabase</code> trong thư mục dự án rồi khởi
          động lại ứng dụng. Hướng dẫn chi tiết ở mục “Kết nối Supabase” trong
          README.md.
        </p>
      </div>
    </div>
  );
}
