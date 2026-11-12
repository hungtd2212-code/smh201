import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { MISSING_COLUMN, isNotMigrated } from "@/lib/supabase/errors";
import type { TargetValues } from "./aggregate";

/**
 * Mục tiêu quảng cáo theo tháng (supabase/012_ad_targets.sql + 014_monthly_targets.sql).
 * `ads_staff_id` = null → mục tiêu cả nhóm (cả công ty). `month` = "yyyy-MM-01"; null = đặt trước khi có 014.
 */
export type AdTarget = TargetValues & { id: string; ads_staff_id: string | null; month: string | null; updated_at: string };

const BASE = "id, ads_staff_id, monthly_budget, monthly_data, max_cost_per_message, max_cost_per_data, updated_at";
// Cột doanh thu do bản mới của 012 thêm, cột tháng do 014 thêm; chưa có thì đọc không kèm.
const ATTEMPTS = [`${BASE}, monthly_revenue, max_ad_revenue_pct, month`, `${BASE}, monthly_revenue, max_ad_revenue_pct`, BASE];
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
      month: t.month ?? null,
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

const DENIED = "Không lưu được: chỉ Quản trị và Trưởng Marketing đặt được mục tiêu.";

/** Lưu mục tiêu một tháng (`month` = "yyyy-MM") của cả nhóm (staffId = null) hoặc của một nhân viên. */
export async function saveTarget(existingId: string | null, staffId: string | null, month: string, values: TargetValues) {
  const supabase = getSupabaseBrowserClient();
  if (existingId) {
    const { data, error } = await supabase.from("ad_targets").update(values).eq("id", existingId).select("id");
    if (error) throw new Error(error.message);
    if (data.length === 0) throw new Error(DENIED);
    return;
  }
  const { error } = await supabase.from("ad_targets").insert({ ads_staff_id: staffId, month: `${month}-01`, ...values });
  if (error) {
    if (/row-level security|permission denied/i.test(error.message)) throw new Error(DENIED);
    if (error.code === MISSING_COLUMN || error.code === "PGRST204") {
      throw new Error("Cần chạy file supabase/014_monthly_targets.sql trên Supabase trước.");
    }
    throw new Error(error.message);
  }
}

/** Dòng mục tiêu áp cho tháng `month` (yyyy-MM): đúng tháng đó, chưa đặt thì tháng gần nhất trước đó. */
export function rowFor(targets: AdTarget[], staffId: string | null, month: string) {
  return targets
    .filter((t) => t.ads_staff_id === staffId && (!t.month || t.month.slice(0, 7) <= month))
    .sort((a, b) => (b.month ?? "").localeCompare(a.month ?? ""))[0];
}

/**
 * Mục tiêu áp cho một người trong tháng `month`: ngân sách / data / doanh thu của riêng người đó; giá tối đa và tỉ lệ
 * ads / doanh thu của người đó, để trống thì lấy của cả nhóm. `staffId` = null → mục tiêu cả nhóm.
 */
export function targetFor(targets: AdTarget[], staffId: string | null, month: string): TargetValues | null {
  const team = rowFor(targets, null, month);
  if (staffId === null) return team ?? null;
  const own = rowFor(targets, staffId, month);
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

/** Một lần đặt / sửa mục tiêu trong Nhật ký hệ thống. */
export type TargetHistoryEntry = {
  id: number;
  at: string;
  action: "insert" | "update" | "delete" | "restore" | "purge";
  actor_name: string;
  target_id: string | null;
  month: string | null;
  ads_staff_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

/** Lịch sử đặt / sửa mục tiêu, mới nhất trước. null = chưa chạy file 014. */
export async function fetchTargetHistory(): Promise<TargetHistoryEntry[] | null> {
  const { data, error } = await getSupabaseBrowserClient().rpc("ad_targets_history", { p_limit: 300 });
  if (error) {
    if (isNotMigrated(error)) return null;
    throw new Error(error.message);
  }
  return data as TargetHistoryEntry[];
}
