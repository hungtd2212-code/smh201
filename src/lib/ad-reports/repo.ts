import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { MISSING_COLUMN, isNotMigrated } from "@/lib/supabase/errors";
import type { AdDailyData, AdDailyReport, ReportField } from "./types";

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

const DAILY_COLUMNS = "id, report_date, ads_staff_id, data_count, user_id, submitted_at, updated_at, updated_by";

export type DailyDataResult = {
  rows: AdDailyData[];
  /** false = chưa chạy file 018 (chưa có cột "Doanh thu theo ngày") → ẩn ô doanh thu, đọc kiểu cũ. */
  revenueReady: boolean;
};

/**
 * Dòng "Data xin được" (kèm "Doanh thu theo ngày") chung của mỗi nhân viên trong khoảng ngày. Trả về null nếu
 * cơ sở dữ liệu chưa chạy file 010.
 */
export async function fetchDailyData(from: string, to: string): Promise<DailyDataResult | null> {
  const supabase = getSupabaseBrowserClient();
  const rows: AdDailyData[] = [];
  let revenueReady = true;
  // Xem nhiều tháng / nhiều năm có thể quá 1000 dòng → đọc từng trang.
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase
      .from("ads_daily_data")
      .select(revenueReady ? `${DAILY_COLUMNS}, revenue` : DAILY_COLUMNS)
      .gte("report_date", from)
      .lte("report_date", to)
      .order("report_date", { ascending: false })
      .order("id")
      .range(start, start + PAGE - 1);
    if (error) {
      // Chưa chạy file 018: đọc lại trang này không có cột doanh thu.
      if (error.code === MISSING_COLUMN && revenueReady) {
        revenueReady = false;
        start -= PAGE;
        continue;
      }
      if (isNotMigrated(error)) return null;
      throw reportError(error);
    }
    // Cột bigint có thể về dạng chữ khi số lớn → ép về số cho chắc.
    for (const row of data as unknown as (Omit<AdDailyData, "revenue"> & { revenue?: number | string | null })[]) {
      rows.push({ ...row, revenue: row.revenue === null || row.revenue === undefined ? null : Number(row.revenue) });
    }
    if (data.length < PAGE) return { rows, revenueReady };
  }
}

/** Gửi "Data xin được" (kèm doanh thu nếu có) chung của một ngày. */
export async function submitDailyData(row: {
  report_date: string;
  ads_staff_id: string;
  data_count: number;
  /** null = không nhập (để trống). Không gửi cột này khi để trống — chạy được cả khi chưa có file 018. */
  revenue: number | null;
}) {
  const { revenue, ...rest } = row;
  const { error } = await getSupabaseBrowserClient()
    .from("ads_daily_data")
    .insert(revenue === null ? rest : row);
  if (error) throw reportError(error);
}

/** Sửa "Data xin được" / "Doanh thu theo ngày" đã gửi. `revenue` undefined = không đụng tới cột doanh thu. */
export async function updateDailyData(id: string, dataCount: number, revenue?: number | null): Promise<void> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("ads_daily_data")
    .update(revenue === undefined ? { data_count: dataCount } : { data_count: dataCount, revenue })
    .eq("id", id)
    .select("id");
  if (error) throw reportError(error);
  if (data.length === 0) throw new Error("Không lưu được: đây không phải số liệu của bạn.");
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
