import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  dataKey,
  reportKey,
  revenueKey,
  templateSheets,
  type Cell,
  type ExistingKeys,
  type ImportCatalog,
  type ImportPlan,
  type ParsedWorkbook,
  type WorkbookSheet,
} from "./import";
import { fetchDailyData, fetchReports } from "./repo";
import { fetchRevenue } from "./revenue";

/** Nhập từ Excel — phần tải file mẫu, đọc file, đọc số đã có và ghi vào Supabase. */

/** Tải file mẫu của một tháng (yyyy-MM): mỗi nhân viên Ads một tab, cột là TKQC họ phụ trách tháng đó. */
export async function downloadTemplate(month: string, catalog: ImportCatalog) {
  // Chỉ tải thư viện khi người dùng bấm.
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  await writeExcelFile(templateSheets(month, catalog)).toFile(`mau-nhap-ads-${month}.xlsx`);
}

/** Đọc mọi tab của file .xlsx người dùng chọn. */
export async function readWorkbook(file: File): Promise<WorkbookSheet[]> {
  const { default: readExcelFile } = await import("read-excel-file/browser");
  try {
    const sheets = await readExcelFile(file);
    return sheets.map(({ sheet, data }) => ({ sheet, data: data as unknown as Cell[][] }));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "XLS_FILE_NOT_SUPPORTED") {
      throw new Error("Đây là file .xls kiểu cũ — mở bằng Excel rồi Lưu thành (Save As) dạng .xlsx.");
    }
    if (code === "FILE_NOT_SUPPORTED" || code === "INVALID_ZIP" || code === "NO_DATA") {
      throw new Error("Không đọc được file này — chỉ nhận file Excel .xlsx.");
    }
    throw new Error(`Không đọc được file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const NOT_READY = "Cơ sở dữ liệu chưa có đủ bảng báo cáo quảng cáo — chưa nhập được.";

/** Số đã có trong phần mềm trong khoảng ngày / tháng của file (để bỏ qua, không ghi đè). */
export async function loadExisting(parsed: ParsedWorkbook): Promise<ExistingKeys> {
  const days = parsed.dayRange;
  const months = parsed.monthRange;
  const [reports, daily, revenue] = await Promise.all([
    days ? fetchReports(days.from, days.to) : Promise.resolve([]),
    days ? fetchDailyData(days.from, days.to) : Promise.resolve({ rows: [], revenueReady: true }),
    months ? fetchRevenue(months.from, months.to) : Promise.resolve([]),
  ]);
  if (reports === null || daily === null || revenue === null) throw new Error(NOT_READY);
  return {
    reports: new Set(reports.map((r) => reportKey(r.report_date, r.ad_account_id))),
    data: new Set(daily.rows.map((r) => dataKey(r.report_date, r.ads_staff_id))),
    revenue: new Set(revenue.map((r) => revenueKey(r.month.slice(0, 7), r.ads_staff_id))),
  };
}

/** Mỗi lượt gửi tối đa 500 dòng; mỗi lượt được cả hoặc không được gì. */
const CHUNK = 500;

export type ImportProgress = { done: number; total: number };

/**
 * Ghi các dòng mới vào Supabase: chi tiêu TKQC → Data / doanh thu ngày → doanh thu tháng. Quyền và các luật
 * (ngày chưa tới, TKQC phải có người phụ trách…) do Supabase kiểm tra lại. Lỗi giữa chừng: phần đã ghi giữ
 * nguyên, chọn lại file để nhập tiếp — phần đã có tự bỏ qua.
 */
export async function runImport(plan: ImportPlan, onProgress: (progress: ImportProgress) => void) {
  const supabase = getSupabaseBrowserClient();
  const steps = [
    { table: "ad_daily_reports", rows: plan.reports as object[] },
    { table: "ads_daily_data", rows: plan.data as object[] },
    { table: "ad_revenue", rows: plan.revenue as object[] },
  ] as const;
  const total = steps.reduce((s, step) => s + step.rows.length, 0);
  let done = 0;
  onProgress({ done, total });
  for (const step of steps) {
    for (let i = 0; i < step.rows.length; i += CHUNK) {
      const chunk = step.rows.slice(i, i + CHUNK);
      const { error } = await supabase.from(step.table).insert(chunk);
      if (error) {
        const reason =
          error.code === "23505"
            ? "có số vừa được người khác nhập trong lúc bạn xem trước"
            : /row-level security|permission denied/i.test(error.message)
              ? "tài khoản này không có quyền nhập số liệu đó"
              : error.message;
        throw new Error(
          `Dừng ở ${done}/${total} dòng: ${reason}. Phần đã nhập được giữ nguyên — chọn lại file để nhập tiếp (phần đã có tự bỏ qua).`,
        );
      }
      done += chunk.length;
      onProgress({ done, total });
    }
  }
}
