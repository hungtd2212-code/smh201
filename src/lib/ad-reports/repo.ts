import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";
import type { AdDailyReport, ReportField } from "./types";

/** Đọc / gửi / sửa báo cáo ads hằng ngày. Quyền do Supabase kiểm soát (supabase/006_ad_daily_reports.sql). */

type QueryError = { message: string; code?: string };

const COLUMNS = "id, report_date, ad_account_id, user_id, spend, messages, data_count, submitted_at, updated_at, updated_by";
const NOT_READY =
  "Cơ sở dữ liệu chưa được cập nhật cho chức năng này (file supabase/006_ad_daily_reports.sql chưa chạy).";

/** Lời báo dễ hiểu cho các lỗi hay gặp. Câu báo của cơ sở dữ liệu (đã là tiếng Việt) giữ nguyên. */
function reportError(error: QueryError): Error {
  if (isNotMigrated(error)) return new Error(NOT_READY);
  if (error.code === "23505") {
    return new Error("Báo cáo của TK ADS này cho ngày đó đã được gửi rồi. Trang sẽ hiện số đã gửi.");
  }
  if (/row-level security/i.test(error.message)) {
    return new Error("Bạn không phụ trách TK ADS này vào ngày đó.");
  }
  if (/permission denied/i.test(error.message)) return new Error("Bạn không có quyền làm việc này.");
  return new Error(error.message);
}

/** Mỗi lần Supabase trả tối đa 1000 dòng → đọc từng trang cho tới khi hết. */
const PAGE = 1000;

/**
 * Các báo cáo từ ngày `from` đến hết ngày `to` (yyyy-MM-dd) mà tài khoản này được xem.
 * Trả về null nếu cơ sở dữ liệu chưa chạy file 006.
 */
export async function fetchReports(from: string, to: string): Promise<AdDailyReport[] | null> {
  const supabase = getSupabaseBrowserClient();
  const rows: AdDailyReport[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase
      .from("ad_daily_reports")
      .select(COLUMNS)
      .gte("report_date", from)
      .lte("report_date", to)
      .order("report_date", { ascending: false })
      .order("id")
      .range(start, start + PAGE - 1);
    if (error) {
      if (isNotMigrated(error)) return null;
      throw reportError(error);
    }
    // Cột bigint có thể về dạng chữ khi số lớn → ép về số cho chắc.
    rows.push(...(data as AdDailyReport[]).map((row) => ({ ...row, spend: Number(row.spend) })));
    if (data.length < PAGE) return rows;
  }
}

export type NewReport = { report_date: string; ad_account_id: string } & Record<ReportField, number>;

/** Gửi báo cáo của một hoặc nhiều TK ADS trong một lần: được cả hoặc không được gì. */
export async function submitReports(rows: NewReport[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getSupabaseBrowserClient().from("ad_daily_reports").insert(rows);
  if (error) throw reportError(error);
}

/** Sửa số của một báo cáo đã gửi. */
export async function updateReport(id: string, values: Record<ReportField, number>): Promise<void> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("ad_daily_reports")
    .update(values)
    .eq("id", id)
    .select("id");
  if (error) throw reportError(error);
  // Máy chủ không cho sửa thì không báo lỗi, chỉ là "0 dòng được sửa" → phải tự kiểm tra.
  if (data.length === 0) throw new Error("Không lưu được: bạn không phụ trách TK ADS này vào ngày đó.");
}
