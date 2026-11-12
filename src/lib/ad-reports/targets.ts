import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { MISSING_COLUMN, isNotMigrated } from "@/lib/supabase/errors";
import type { TargetValues } from "./aggregate";

/** Mục tiêu quảng cáo (supabase/012_ad_targets.sql). `ads_staff_id` = null → mục tiêu cả nhóm. */
export type AdTarget = TargetValues & { id: string; ads_staff_id: string | null; updated_at: string };

const BASE = "id, ads_staff_id, monthly_budget, monthly_data, max_cost_per_message, max_cost_per_data, updated_at";
// Hai cột doanh thu do bản mới của file 012 thêm vào; bản cũ chưa có thì đọc không kèm.
const ATTEMPTS = [`${BASE}, monthly_revenue, max_ad_revenue_pct`, BASE];
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Mọi mục tiêu tài khoản này được xem. Trả về null nếu cơ sở dữ liệu chưa chạy file 012. */
export async function fetchTargets(): Promise<AdTarget[] | null> {
  for (const [index, columns] of ATTEMPTS.entries()) {
    const { data, error } = await getSupabaseBrowserClient().from("ad_targets").select(columns);
    if (error?.code === MISSING_COLUMN && index < ATTEMPTS.length - 1) continue;
    if (error) {
      if (isNotMigrated(error)) return null;
      throw new Error(error.message);
    }
    return (data as unknown as AdTarget[]).map((t) => ({
      ...t,
      monthly_budget: num(t.monthly_budget),
      monthly_data: num(t.monthly_data),
      max_cost_per_message: num(t.max_cost_per_message),
      max_cost_per_data: num(t.max_cost_per_data),
      monthly_revenue: num(t.monthly_revenue),
      max_ad_revenue_pct: num(t.max_ad_revenue_pct),
    }));
  }
  return null;
}

/** Lưu mục tiêu của cả nhóm (staffId = null) hoặc của một nhân viên. */
export async function saveTarget(existingId: string | null, staffId: string | null, values: TargetValues) {
  const supabase = getSupabaseBrowserClient();
  if (existingId) {
    const { data, error } = await supabase.from("ad_targets").update(values).eq("id", existingId).select("id");
    if (error) throw new Error(error.message);
    if (data.length === 0) throw new Error("Không lưu được: chỉ Quản trị và Trưởng Marketing đặt được mục tiêu.");
    return;
  }
  const { error } = await supabase.from("ad_targets").insert({ ads_staff_id: staffId, ...values });
  if (error) {
    if (/row-level security|permission denied/i.test(error.message)) {
      throw new Error("Không lưu được: chỉ Quản trị và Trưởng Marketing đặt được mục tiêu.");
    }
    throw new Error(error.message);
  }
}

/**
 * Mục tiêu áp cho một người: ngân sách / data của riêng người đó; giá tối đa của người đó, để trống thì
 * lấy của cả nhóm. `staffId` = null → mục tiêu cả nhóm.
 */
export function targetFor(targets: AdTarget[], staffId: string | null): TargetValues | null {
  const team = targets.find((t) => t.ads_staff_id === null);
  if (staffId === null) return team ?? null;
  const own = targets.find((t) => t.ads_staff_id === staffId);
  if (!own && !team) return null;
  return {
    monthly_budget: own?.monthly_budget ?? null,
    monthly_data: own?.monthly_data ?? null,
    max_cost_per_message: own?.max_cost_per_message ?? team?.max_cost_per_message ?? null,
    max_cost_per_data: own?.max_cost_per_data ?? team?.max_cost_per_data ?? null,
    monthly_revenue: own?.monthly_revenue ?? null,
    max_ad_revenue_pct: own?.max_ad_revenue_pct ?? team?.max_ad_revenue_pct ?? null,
  };
}
