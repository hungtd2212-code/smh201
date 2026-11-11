import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";
import type { AdsStats, DailyInput, DailyResult, DailySpend } from "./types";

/** Đọc / ghi số liệu ads hằng ngày. Quyền do Supabase kiểm soát (supabase/006_ads_daily_stats.sql). */

type QueryError = { message: string; code?: string };

/** Mỗi lần Supabase trả tối đa 1000 dòng → đọc từng trang cho tới khi hết. */
const PAGE = 1000;

async function fetchAll<T>(
  table: "ad_daily_spend" | "ads_daily_results",
  columns: string,
  from: string,
  to: string,
): Promise<{ rows: T[]; error: QueryError | null }> {
  const supabase = getSupabaseBrowserClient();
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .gte("stat_date", from)
      .lte("stat_date", to)
      .order("stat_date")
      .order("id")
      .range(start, start + PAGE - 1);
    if (error) return { rows: [], error };
    rows.push(...(data as T[]));
    if (data.length < PAGE) return { rows, error: null };
  }
}

/**
 * Số liệu từ ngày `from` đến hết ngày `to` (yyyy-MM-dd) mà tài khoản này được xem.
 * Trả về null nếu cơ sở dữ liệu chưa chạy file 006.
 */
export async function fetchAdsStats(from: string, to: string): Promise<AdsStats | null> {
  const [spend, results] = await Promise.all([
    fetchAll<DailySpend>("ad_daily_spend", "stat_date, ad_account_id, spend", from, to),
    fetchAll<DailyResult>(
      "ads_daily_results",
      "stat_date, ads_staff_id, messages, data_count, sales, revenue, q_potential, q_booked, q_wrong_area, q_no_response, note",
      from,
      to,
    ),
  ]);
  if (isNotMigrated(spend.error) || isNotMigrated(results.error)) return null;
  const error = spend.error ?? results.error;
  if (error) throw new Error(error.message);
  // Cột tiền có thể về dạng chữ khi số lớn → ép về số cho chắc.
  return {
    spend: spend.rows.map((row) => ({ ...row, spend: Number(row.spend) })),
    results: results.rows.map((row) => ({ ...row, sales: Number(row.sales), revenue: Number(row.revenue) })),
  };
}

/** Lưu số liệu một ngày của một nhân viên Ads. Gọi lại cho cùng ngày = sửa số. */
export async function saveAdsDaily(input: DailyInput): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("save_ads_daily", {
    p_date: input.date,
    p_ads_staff_id: input.adsStaffId,
    p_spend: input.spend,
    p_messages: input.messages,
    p_data: input.data,
    p_sales: input.sales,
    p_revenue: input.revenue,
    p_potential: input.potential,
    p_booked: input.booked,
    p_wrong_area: input.wrongArea,
    p_no_response: input.noResponse,
    p_note: input.note,
  });
  if (!error) return;
  if (isNotMigrated(error)) {
    throw new Error(
      "Cơ sở dữ liệu chưa được cập nhật cho chức năng này (file supabase/006_ads_daily_stats.sql chưa chạy).",
    );
  }
  throw new Error(error.message);
}
