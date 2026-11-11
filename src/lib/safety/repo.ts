import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";
import type { AdReportRef } from "./labels";
import {
  DEFAULT_SAFETY_SETTINGS,
  type AuditAction,
  type AuditEntry,
  type BackupRun,
  type RestoreResult,
  type SafetySettings,
  type SecurityAlert,
  type SoftDeleteTable,
  type TrashItem,
  type UndoSummary,
} from "./types";

/**
 * Lớp truy cập dữ liệu cho Thùng rác, Nhật ký hệ thống, hoàn tác và theo dõi sao lưu.
 * Mọi kiểm tra quyền nằm ở Supabase (supabase/003_data_safety.sql); ở đây chỉ gọi và báo lỗi.
 */

/** Máy chủ yêu cầu nhập lại mật khẩu trước khi làm tiếp (xoá hàng loạt, xoá vĩnh viễn). */
export class PasswordRequiredError extends Error {
  constructor(message = "Thao tác này cần nhập lại mật khẩu để xác nhận.") {
    super(message);
    this.name = "PasswordRequiredError";
  }
}

type RpcError = { message: string; hint?: string | null };

function fail(error: RpcError): never {
  if (error.message === "PASSWORD_REQUIRED") {
    throw new PasswordRequiredError(error.hint ?? undefined);
  }
  throw new Error(error.message);
}

/** Mỗi lần gọi xoá / khôi phục gửi tối đa chừng này id. */
const CHUNK = 500;
const chunks = <T,>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) =>
    items.slice(i * CHUNK, (i + 1) * CHUNK),
  );

/**
 * Xác nhận lại mật khẩu của người đang đăng nhập. Mật khẩu chỉ gửi tới dịch vụ đăng nhập
 * của Supabase; sau đó máy chủ biết "vừa nhập mật khẩu" trong 5 phút.
 */
export async function confirmPassword(password: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) throw new Error("Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.code === "invalid_credentials" ? "Mật khẩu không đúng." : error.message);
  }
}

/** Chuyển bản ghi vào Thùng rác. Trả về số bản ghi đã xoá. */
export async function softDeleteRecords(table: SoftDeleteTable, ids: string[]): Promise<number> {
  const supabase = getSupabaseBrowserClient();
  let deleted = 0;
  for (const part of chunks(ids)) {
    const { data, error } = await supabase.rpc("soft_delete_records", { p_table: table, p_ids: part });
    if (error) fail(error);
    deleted += (data as { deleted: number }).deleted;
  }
  return deleted;
}

export async function restoreRecords(table: SoftDeleteTable, ids: string[]): Promise<RestoreResult> {
  const supabase = getSupabaseBrowserClient();
  const total: RestoreResult = { restored: 0, conflicts: 0, blocked: 0 };
  for (const part of chunks(ids)) {
    const { data, error } = await supabase.rpc("restore_records", { p_table: table, p_ids: part });
    if (error) fail(error);
    const result = data as RestoreResult;
    total.restored += result.restored;
    total.conflicts += result.conflicts;
    total.blocked += result.blocked;
  }
  return total;
}

/** Xoá vĩnh viễn (chỉ Quản trị cấp cao, luôn cần vừa nhập lại mật khẩu). */
export async function purgeRecords(table: SoftDeleteTable, ids: string[]): Promise<number> {
  const { data, error } = await getSupabaseBrowserClient().rpc("purge_records", {
    p_table: table,
    p_ids: ids,
  });
  if (error) fail(error);
  return (data as { purged: number }).purged;
}

/** Mọi thứ đang nằm trong Thùng rác, mới xoá nhất trước (tối đa 1000 dòng). */
export async function fetchTrash(): Promise<TrashItem[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("trash_items")
    .select("table_name, id, label, deleted_at, deleted_by")
    .order("deleted_at", { ascending: false })
    .limit(1000);
  if (error) fail(error);
  return data as TrashItem[];
}

const AUDIT_COLUMNS =
  "id, at, txid, actor_id, ip, table_name, record_id, action, old_data, new_data, note";

export type AuditFilter = {
  /** id nhân viên, hoặc "system" = thao tác trực tiếp trong Supabase. */
  actor?: string | null;
  action?: AuditAction | null;
  table?: string | null;
  from?: Date | null;
  to?: Date | null;
};

/** Một trang nhật ký hệ thống, mới nhất trước, kèm tổng số dòng khớp bộ lọc. */
export async function fetchAuditLog(
  filter: AuditFilter,
  page: number,
  pageSize: number,
): Promise<{ rows: AuditEntry[]; total: number }> {
  let query = getSupabaseBrowserClient()
    .from("audit_log")
    .select(AUDIT_COLUMNS, { count: "exact" });

  if (filter.actor === "system") query = query.is("actor_id", null);
  else if (filter.actor) query = query.eq("actor_id", filter.actor);
  if (filter.action) query = query.eq("action", filter.action);
  if (filter.table) query = query.eq("table_name", filter.table);
  if (filter.from) query = query.gte("at", filter.from.toISOString());
  if (filter.to) query = query.lt("at", filter.to.toISOString());

  const { data, error, count } = await query
    .order("id", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  if (error) fail(error);
  return { rows: data as AuditEntry[], total: count ?? 0 };
}

/** Lịch sử thay đổi của một bản ghi, mới nhất trước. */
export async function fetchRecordHistory(table: string, recordId: string): Promise<AuditEntry[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("audit_log")
    .select(AUDIT_COLUMNS)
    .eq("table_name", table)
    .eq("record_id", recordId)
    .order("id", { ascending: false })
    .limit(200);
  if (error) fail(error);
  return data as AuditEntry[];
}

/** Đưa bản ghi về trạng thái ngay sau dòng nhật ký `auditId`. Trả về số cột đã đổi. */
export async function revertToVersion(auditId: number): Promise<number> {
  const { data, error } = await getSupabaseBrowserClient().rpc("revert_record_to_version", {
    p_audit_id: auditId,
  });
  if (error) fail(error);
  return (data as { columns: number }).columns;
}

/** Hoàn tác mọi thay đổi của một tài khoản trong khoảng [from, to). apply = false: chỉ xem trước. */
export async function undoChanges(
  actorId: string,
  from: Date,
  to: Date,
  apply: boolean,
): Promise<UndoSummary> {
  const { data, error } = await getSupabaseBrowserClient().rpc("undo_changes", {
    p_actor: actorId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_apply: apply,
  });
  if (error) fail(error);
  return data as UndoSummary;
}

/** Tên hiển thị của các lead theo id (quản trị thấy cả lead trong thùng rác). */
export async function fetchLeadLabels(ids: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return labels;
  const { data, error } = await getSupabaseBrowserClient()
    .from("leads")
    .select("id, full_name, phone")
    .in("id", unique);
  if (error) fail(error);
  for (const row of data as { id: string; full_name: string; phone: string }[]) {
    labels.set(row.id, `${row.full_name} · ${row.phone}`);
  }
  return labels;
}

/**
 * Các báo cáo ads ngày theo id: ngày nào, của TK ADS nào — để nhật ký hiện "THE DUONG 01 · 05/10/2026"
 * thay cho một mã khó đọc.
 */
export async function fetchAdReportRefs(
  rows: { table_name: string; record_id: string }[],
): Promise<Map<string, AdReportRef>> {
  const refs = new Map<string, AdReportRef>();
  const supabase = getSupabaseBrowserClient();
  for (const [table, column] of [
    ["ad_daily_reports", "ad_account_id"],
    ["ads_daily_data", "ads_staff_id"],
  ] as const) {
    const ids = [...new Set(rows.filter((row) => row.table_name === table).map((row) => row.record_id))];
    if (ids.length === 0) continue;
    const { data, error } = await supabase.from(table).select(`id, report_date, ${column}`).in("id", ids);
    if (error) continue; // không đọc được thì nhật ký vẫn hiện, chỉ thiếu tên dễ đọc
    for (const row of data as unknown as ({ id: string } & AdReportRef)[]) refs.set(row.id, row);
  }
  return refs;
}

/** Các cảnh báo bất thường chưa xử lý, mới nhất trước. */
export async function fetchOpenAlerts(): Promise<SecurityAlert[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("security_alerts")
    .select("id, created_at, user_id, kind, details, locked, resolved_at")
    .is("resolved_at", null)
    .order("created_at", { ascending: false });
  if (error) fail(error);
  return data as SecurityAlert[];
}

export async function resolveAlert(id: string, unlock: boolean): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("resolve_security_alert", {
    p_id: id,
    p_unlock: unlock,
  });
  if (error) fail(error);
}

export async function setStaffLock(userId: string, locked: boolean, reason?: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("set_staff_lock", {
    p_user_id: userId,
    p_locked: locked,
    p_reason: reason ?? null,
  });
  if (error) fail(error);
}

/** Tick / bỏ tick quyền "Xoá dữ liệu" (chuyển vào Thùng rác) cho một tài khoản. Chỉ Quản trị cấp cao. */
export async function setStaffCanDelete(userId: string, allowed: boolean): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("set_staff_can_delete", {
    p_user_id: userId,
    p_allowed: allowed,
  });
  if (error) fail(error);
}

const SETTING_KEYS = Object.keys(DEFAULT_SAFETY_SETTINGS) as (keyof SafetySettings)[];

export async function fetchSafetySettings(): Promise<SafetySettings> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("app_settings")
    .select("key, value")
    .in("key", SETTING_KEYS);
  if (error) fail(error);

  const stored = new Map((data as { key: string; value: unknown }[]).map((row) => [row.key, row.value]));
  const int = (key: keyof SafetySettings) => {
    const value = Number(stored.get(key));
    return Number.isInteger(value) && value >= 0 ? value : (DEFAULT_SAFETY_SETTINGS[key] as number);
  };
  return {
    trash_min_days: int("trash_min_days"),
    bulk_delete_confirm_over: int("bulk_delete_confirm_over"),
    anomaly_max_changes_per_hour: int("anomaly_max_changes_per_hour"),
    anomaly_auto_lock:
      typeof stored.get("anomaly_auto_lock") === "boolean"
        ? (stored.get("anomaly_auto_lock") as boolean)
        : DEFAULT_SAFETY_SETTINGS.anomaly_auto_lock,
  };
}

/** Lưu các ngưỡng an toàn (chỉ Quản trị cấp cao; người khác lưu thì máy chủ bỏ qua). */
export async function saveSafetySettings(settings: SafetySettings): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  for (const key of SETTING_KEYS) {
    const { data, error } = await supabase
      .from("app_settings")
      .update({ value: settings[key] })
      .eq("key", key)
      .select("key");
    if (error) fail(error);
    if (data.length === 0) throw new Error("Chỉ Quản trị cấp cao được đổi các ngưỡng an toàn.");
  }
}

/** Các lần sao lưu và chạy thử khôi phục gần nhất. */
export async function fetchBackupRuns(): Promise<BackupRun[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("backup_runs")
    .select("id, kind, status, started_at, finished_at, size_bytes, location, detail, created_by")
    .order("started_at", { ascending: false })
    .limit(100);
  if (error) fail(error);
  return data as BackupRun[];
}

/** Ghi nhận một lần chạy thử khôi phục (kiểm tra định kỳ mỗi quý). */
export async function logRestoreTest(success: boolean, detail: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("log_restore_test", {
    p_success: success,
    p_detail: detail,
  });
  if (error) fail(error);
}

/** Vài con số cho trang tổng quan sao lưu: số mục trong thùng rác, số dòng nhật ký 7 ngày qua. */
export async function fetchSafetyCounts(): Promise<{ trash: number; auditWeek: number }> {
  const supabase = getSupabaseBrowserClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [trash, audit] = await Promise.all([
    supabase.from("trash_items").select("id", { count: "exact", head: true }),
    supabase.from("audit_log").select("id", { count: "exact", head: true }).gte("at", weekAgo),
  ]);
  if (trash.error) fail(trash.error);
  if (audit.error) fail(audit.error);
  return { trash: trash.count ?? 0, auditWeek: audit.count ?? 0 };
}

/** Đổi vai trò một tài khoản (Quản trị; cấp / thu vai trò Quản trị thì chỉ Quản trị cấp cao). */
export async function setStaffRole(userId: string, role: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("set_staff_role", {
    p_user_id: userId,
    p_role: role,
  });
  if (error) fail(error);
}

/** Tick / bỏ tick quyền "Xuất file" cho một tài khoản (chỉ Quản trị). */
export async function setStaffCanExport(userId: string, allowed: boolean): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("set_staff_can_export", {
    p_user_id: userId,
    p_allowed: allowed,
  });
  if (error) fail(error);
}

/**
 * Ghi sổ một lần xuất file. Gọi TRƯỚC khi tạo file: tài khoản chưa được tick quyền "Xuất file"
 * thì máy chủ từ chối và hàm này báo lỗi. Cơ sở dữ liệu chưa có sổ xuất file (chưa chạy file 005)
 * thì bỏ qua bước ghi sổ.
 */
export async function logExport(what: string, rowCount: number, details: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("log_export", {
    p_what: what,
    p_row_count: rowCount,
    p_details: details,
  });
  if (error && !isNotMigrated(error)) fail(error);
}
