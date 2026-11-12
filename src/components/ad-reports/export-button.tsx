"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { buildAdsExport, exportFileName, type ExportInput } from "@/lib/ad-reports/export";
import { logExport } from "@/lib/safety/repo";

/** Giờ Việt Nam lúc bấm, vd "13/11/2026 14:05". */
function nowVn() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/**
 * Nút "Tải Excel" của Tổng quan / Phân tích: xuất đúng kỳ, đúng người đang xem. Chỉ hiện với tài khoản được tick
 * quyền "Xuất file" (Quản trị luôn có). Mỗi lần xuất được ghi sổ trước — máy chủ từ chối nếu chưa được cấp quyền.
 * `getInput` trả null khi số liệu chưa tải xong.
 */
export function ExportButton({
  getInput,
  className,
}: {
  getInput: () => Omit<ExportInput, "exportedAt"> | null;
  className?: string;
}) {
  const staff = useCurrentStaff();
  const [busy, setBusy] = useState(false);
  if (staff.status !== "ok" || !staff.canExport) return null;

  async function download() {
    const input = getInput();
    if (!input) {
      toast.error("Số liệu đang tải — thử lại sau giây lát");
      return;
    }
    if (input.days.length === 0) {
      toast.error("Kỳ đang xem chưa có ngày nào để xuất");
      return;
    }
    setBusy(true);
    try {
      const days = [...input.days].sort();
      const file = exportFileName(input.title, days);
      // Ghi sổ trước khi tạo file: tài khoản chưa được tick quyền "Xuất file" thì máy chủ từ chối ở đây.
      await logExport("ads_reports", days.length, {
        file,
        view: input.title,
        who: input.who,
        from: days[0],
        to: days[days.length - 1],
      });
      const sheets = buildAdsExport({ ...input, exportedAt: nowVn() });
      const { default: writeExcelFile } = await import("write-excel-file/browser");
      await writeExcelFile(sheets as Parameters<typeof writeExcelFile>[0]).toFile(file);
    } catch (error) {
      toast.error("Không xuất được file Excel", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" className={className} onClick={download} disabled={busy}>
      <Download />
      {busy ? "Đang tạo file…" : "Tải Excel"}
    </Button>
  );
}
