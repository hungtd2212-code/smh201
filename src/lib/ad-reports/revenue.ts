import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";

/** Doanh thu tháng mang về từ quảng cáo (supabase/013_revenue_avatars.sql). */
export type AdRevenue = {
  id: string;
  /** yyyy-MM-01 */
  month: string;
  /** null = chưa rõ nhân viên. */
  ads_staff_id: string | null;
  amount: number;
};

/** Doanh thu các tháng từ `fromMonth` tới `toMonth` (yyyy-MM). null = chưa chạy file 013. */
export async function fetchRevenue(fromMonth: string, toMonth: string): Promise<AdRevenue[] | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("ad_revenue")
    .select("id, month, ads_staff_id, amount")
    .gte("month", `${fromMonth}-01`)
    .lte("month", `${toMonth}-01`)
    .limit(5000);
  if (error) {
    if (isNotMigrated(error)) return null;
    throw new Error(error.message);
  }
  return (data as AdRevenue[]).map((r) => ({ ...r, amount: Number(r.amount) }));
}

/** Lưu doanh thu một tháng của một nhân viên (hoặc dòng chưa rõ nhân viên). */
export async function saveRevenue(existingId: string | null, month: string, staffId: string | null, amount: number) {
  const supabase = getSupabaseBrowserClient();
  const denied = "Không lưu được: chỉ Quản trị và Trưởng Marketing nhập được doanh thu.";
  if (existingId) {
    const { data, error } = await supabase.from("ad_revenue").update({ amount }).eq("id", existingId).select("id");
    if (error) throw new Error(error.message);
    if (data.length === 0) throw new Error(denied);
    return;
  }
  const { error } = await supabase.from("ad_revenue").insert({ month: `${month}-01`, ads_staff_id: staffId, amount });
  if (error) throw new Error(/row-level security|permission denied/i.test(error.message) ? denied : error.message);
}
