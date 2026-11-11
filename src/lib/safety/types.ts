/** Kiểu dữ liệu của phần Sao lưu & Khôi phục (xem supabase/003_data_safety.sql). */

/** Các bảng có Thùng rác (xoá mềm). */
export type SoftDeleteTable =
  | "leads"
  | "channels"
  | "services"
  | "pages"
  | "campaigns"
  | "ads_staff"
  | "ad_accounts"
  | "ad_account_assignments"
  | "ad_posts";

/** delete = chuyển vào thùng rác · restore = khôi phục · purge = xoá vĩnh viễn. */
export type AuditAction = "insert" | "update" | "delete" | "restore" | "purge";

/** Một dòng nhật ký: một lần thêm / sửa / xoá trên một bản ghi. */
export type AuditEntry = {
  id: number;
  at: string;
  /** Các dòng cùng txid thuộc cùng một thao tác (vd một lần xoá hàng loạt). */
  txid: number;
  /** null = thao tác trực tiếp trong Supabase hoặc do hệ thống. */
  actor_id: string | null;
  ip: string | null;
  table_name: string;
  record_id: string;
  action: AuditAction;
  /** Giá trị cũ / mới của các cột bị đổi (riêng "purge": cả bản ghi cũ). */
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  note: string | null;
};

export type TrashItem = {
  table_name: SoftDeleteTable;
  id: string;
  label: string;
  deleted_at: string;
  deleted_by: string | null;
};

export type RestoreResult = {
  restored: number;
  /** Đã có bản ghi khác đang dùng cùng số điện thoại / cùng tên. */
  conflicts: number;
  /** Bản ghi cha (kênh, page) còn nằm trong thùng rác. */
  blocked: number;
};

/** Kết quả (hoặc bản xem trước) của một lần hoàn tác theo lô. */
export type UndoSummary = {
  applied: boolean;
  /** Số bản ghi được trả về giá trị cũ. */
  records: number;
  /** Tổng số ô dữ liệu được trả về. */
  columns: number;
  /** Số bản ghi do tài khoản đó tạo, được chuyển vào thùng rác. */
  trashed: number;
  /** Số ô bỏ qua vì sau đó đã có người khác sửa tiếp. */
  conflicts: number;
  /** Số bản ghi đã bị xoá vĩnh viễn nên không hoàn tác được. */
  gone: number;
};

export type SecurityAlert = {
  id: string;
  created_at: string;
  user_id: string;
  kind: string;
  details: { count?: number; limit?: number };
  /** Hệ thống đã tự khoá tài khoản. */
  locked: boolean;
  resolved_at: string | null;
};

export type BackupRun = {
  id: string;
  kind: "database" | "storage" | "restore_test";
  status: "success" | "failed";
  started_at: string;
  finished_at: string | null;
  size_bytes: number | null;
  location: string | null;
  detail: string | null;
  created_by: string | null;
};

/** Các ngưỡng an toàn trong bảng app_settings. */
export type SafetySettings = {
  /** Số ngày tối thiểu nằm trong thùng rác trước khi được xoá vĩnh viễn. */
  trash_min_days: number;
  /** Xoá quá số bản ghi này phải nhập lại mật khẩu. */
  bulk_delete_confirm_over: number;
  /** Một tài khoản sửa / xoá quá số bản ghi này trong 1 giờ thì cảnh báo (0 = tắt). */
  anomaly_max_changes_per_hour: number;
  /** Vượt ngưỡng thì tự khoá tài khoản. */
  anomaly_auto_lock: boolean;
};

export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  trash_min_days: 90,
  bulk_delete_confirm_over: 20,
  anomaly_max_changes_per_hour: 150,
  anomaly_auto_lock: true,
};
