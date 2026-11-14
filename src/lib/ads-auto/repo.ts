/**
 * Gọi cơ sở dữ liệu cho thử nghiệm "Ads tự động" (supabase/027_ads_auto_test.sql). Mọi việc đi qua các hàm của
 * Supabase; chỉ Quản trị và Trưởng Marketing dùng được. Token Facebook gửi đi một lần khi dán, không bao giờ
 * đọc lại được.
 */
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchDailyData } from "@/lib/ad-reports/repo";
import { isNotMigrated } from "@/lib/supabase/errors";
import { staffDataMap, type AutoStatus, type CompareRow, type PancakeUnassigned } from "./compare";

export const ADS_AUTO_NOT_READY =
  "Cơ sở dữ liệu chưa được cập nhật cho phần này (file supabase/027_ads_auto_test.sql chưa chạy).";

type RpcError = { message: string; code?: string };

function rpcError(error: RpcError): Error {
  if (isNotMigrated(error)) return new Error(ADS_AUTO_NOT_READY);
  if (/permission denied/i.test(error.message)) return new Error("Bạn không có quyền làm việc này.");
  return new Error(error.message);
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(fn, args);
  if (error) throw rpcError(error);
  return data as T;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** null = chưa chạy file 027. */
export async function fetchAutoStatus(): Promise<AutoStatus | null> {
  const { data, error } = await getSupabaseBrowserClient().rpc("ads_auto_status");
  if (error) {
    if (isNotMigrated(error)) return null;
    throw rpcError(error);
  }
  const s = data as AutoStatus;
  return {
    ...s,
    pending: Number(s.pending ?? 0),
    pancake_pending: Number(s.pancake_pending ?? 0),
    pancake_pages: s.pancake_pages ?? [],
    accounts: s.accounts ?? [],
  };
}

export const saveAutoToken = (token: string) => call<{ accounts: number }>("ads_auto_save_token", { p_token: token });
export const removeAutoToken = () => call<null>("ads_auto_remove_token");
export const setAutoEnabled = (enabled: boolean) => call<null>("ads_auto_set_enabled", { p_enabled: enabled });
export const pullAuto = (since: string, until: string) =>
  call<{ accounts: number }>("ads_auto_pull", { p_since: since, p_until: until });
export const collectAutoNow = () =>
  call<{ answers?: number; pending?: number; pancake_pending?: number; skipped?: boolean }>("ads_auto_collect_now");

/**
 * Đối chiếu từ ngày `from` tới hết ngày `to` (tối đa 93 ngày). Dòng không có TKQC (số Pancake của quảng cáo chưa
 * gắn được vào TKQC nào) không vào bảng mà cộng vào `unassigned`. `staffData` = số Data (SĐT) nhân viên tự báo ở
 * Nhập liệu theo (ngày, nhân viên) — xem staffDayKey.
 */
export async function fetchCompare(
  from: string,
  to: string,
): Promise<{ rows: CompareRow[]; unassigned: PancakeUnassigned; staffData: Map<string, number> }> {
  const [raw, daily] = await Promise.all([
    call<(Omit<CompareRow, "ad_account_id"> & { ad_account_id: string | null })[]>("ads_auto_compare", { p_from: from, p_to: to }),
    fetchDailyData(from, to),
  ]);
  const rows: CompareRow[] = [];
  const unassigned: PancakeUnassigned = { messages: 0, phones: 0 };
  for (const r of raw ?? []) {
    if (!r.ad_account_id) {
      unassigned.messages += num(r.pancake_messages) ?? 0;
      unassigned.phones += num(r.pancake_phones) ?? 0;
      continue;
    }
    rows.push({
      ...r,
      ad_account_id: r.ad_account_id,
      manual_spend: num(r.manual_spend),
      manual_messages: num(r.manual_messages),
      auto_spend: num(r.auto_spend),
      auto_conversations: num(r.auto_conversations),
      auto_new_contacts: num(r.auto_new_contacts),
      auto_connections: num(r.auto_connections),
      pancake_messages: num(r.pancake_messages),
      pancake_phones: num(r.pancake_phones),
    });
  }
  return { rows, unassigned, staffData: staffDataMap(daily?.rows ?? []) };
}
