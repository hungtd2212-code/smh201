import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";
import type { TargetValues } from "./aggregate";

/** Mục tiêu quảng cáo (supabase/012_ad_targets.sql). `ads_staff_id` = null → mục tiêu cả nhóm. */
export type AdTarget = TargetValues & { id: string; ads_staff_id: string | null; updated_at: string };

const COLUMNS = "id, ads_staff_id, monthly_budget, monthly_data, max_cost_per_message, max_cost_per_data, updated_at";
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Mọi mục tiêu tài khoản này được xem. Trả về null nếu cơ sở dữ liệu chưa chạy file 012. */
export async function fetchTargets(): Promise<AdTarget[] | null> {
  const { data, error } = await getSupabaseBrowserClient().from("ad_targets").select(COLUMNS);
  if (error) {
    if (isNotMigrated(error)) return null;
    throw new Error(error.message);
  }
  return (data as AdTarget[]).map((t) => ({
    ...t,
    monthly_budget: num(t.monthly_budget),
    monthly_data: num(t.monthly_data),
    max_cost_per_message: num(t.max_cost_per_message),
    max_cost_per_data: num(t.max_cost_per_data),
  }));
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
  };
}
