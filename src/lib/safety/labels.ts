import { format } from "date-fns";
import type { CatalogNames } from "@/components/catalog-provider";
import { ROLE_LABELS, type StaffRole } from "@/hooks/use-current-staff";
import { APP } from "@/lib/config";
import { getLeadStatus } from "@/lib/leads/status";
import type { AuditAction, AuditEntry } from "./types";

/** Tên tiếng Việt cho bảng, hành động, cột và giá trị trong nhật ký thay đổi. */

export const TABLE_LABELS: Record<string, string> = {
  leads: "Lead",
  channels: "Kênh",
  pages: "Page / TKQC",
  campaigns: "Chiến dịch",
  services: "Dịch vụ",
  staff: "Nhân viên",
  staff_shifts: "Ca làm",
  app_settings: "Cấu hình",
};

export const ACTION_LABELS: Record<AuditAction, string> = {
  insert: "Thêm mới",
  update: "Sửa",
  delete: "Chuyển vào thùng rác",
  restore: "Khôi phục",
  purge: "Xoá vĩnh viễn",
};

export const SETTING_LABELS: Record<string, string> = {
  lead_reopen_days: "Số ngày mở lại lead",
  trash_min_days: "Số ngày tối thiểu trong thùng rác",
  bulk_delete_confirm_over: "Ngưỡng chuyển vào thùng rác cần nhập mật khẩu",
  anomaly_max_changes_per_hour: "Ngưỡng cảnh báo bất thường",
  anomaly_auto_lock: "Tự khoá khi bất thường",
};

const FIELD_LABELS: Record<string, string> = {
  full_name: "Họ tên",
  phone: "SĐT",
  status: "Trạng thái",
  service: "Dịch vụ",
  service_id: "Dịch vụ",
  source: "Kênh",
  channel_id: "Kênh",
  page_id: "Page",
  campaign_id: "Chiến dịch",
  ads_id: "ID Ads",
  assignee: "Telesale phụ trách",
  assignee_id: "Telesale phụ trách",
  assign_mode: "Cách chia",
  appointment_at: "Lịch hẹn",
  note: "Ghi chú",
  pancake_url: "Link Pancake",
  invalid_phone: "Số sai",
  recontacted_at: "Khách nhắn lại",
  reopened_at: "Mở lại",
  branch: "Cơ sở",
  name: "Tên",
  sort_order: "Thứ tự",
  is_active: "Đang dùng",
  price: "Giá niêm yết",
  start_date: "Ngày bắt đầu",
  end_date: "Ngày kết thúc",
  budget: "Ngân sách",
  owner_id: "Người phụ trách",
  role: "Vai trò",
  accepts_leads: "Nhận lead",
  locked_at: "Khoá tài khoản",
  locked_reason: "Lý do khoá",
  value: "Giá trị",
  user_id: "Nhân viên",
  work_date: "Ngày làm",
  start_time: "Giờ bắt đầu",
  end_time: "Giờ kết thúc",
};

/** Cột do hệ thống tự tính — không hiện trong danh sách thay đổi. */
const HIDDEN_FIELDS = new Set([
  "deleted_at",
  "deleted_by",
  "status_changed_at",
  "last_touch_at",
  "touch_count",
  "updated_at",
  "created_at",
  "created_by",
  "last_assigned_at",
]);

/** Cột chữ là "bản chụp" của một cột id — ẩn đi khi cột id cũng đổi trong cùng lần sửa. */
const SNAPSHOT_OF: Record<string, string> = {
  service: "service_id",
  source: "channel_id",
  assignee: "assignee_id",
};

function formatValue(key: string, value: unknown, names: CatalogNames): string {
  if (value === null || value === undefined || value === "") return "(trống)";
  const text = String(value);

  switch (key) {
    case "status":
      return getLeadStatus(text).label;
    case "service_id":
      return names.service(text) ?? "(không rõ)";
    case "channel_id":
      return names.channel(text) ?? "(không rõ)";
    case "page_id":
      return names.page(text) ?? "(không rõ)";
    case "campaign_id":
      return names.campaign(text) ?? "(không rõ)";
    case "assignee_id":
    case "owner_id":
    case "user_id":
      return names.staff(text) ?? "(không rõ)";
    case "assign_mode":
      return value === "manual" ? "Chia tay" : value === "round_robin" ? "Xoay vòng" : text;
    case "role":
      return ROLE_LABELS[value as StaffRole] ?? text;
    case "price":
    case "budget":
      return `${Number(value).toLocaleString("vi-VN")} ₫`;
    case "branch":
      return value === APP.branch.code ? APP.branch.name : text;
  }

  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "string" && key.endsWith("_at")) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? text : format(date, "dd/MM/yyyy HH:mm");
  }
  if (typeof value === "string" && key.endsWith("_date")) return value.split("-").reverse().join("/");
  if (typeof value === "object") return JSON.stringify(value);
  return text;
}

export type FieldChange = { key: string; label: string; from: string; to: string };

/** Các cột bị đổi trong một dòng nhật ký, đã đổi sang tên và giá trị dễ đọc. */
export function describeChanges(entry: AuditEntry, names: CatalogNames): FieldChange[] {
  if (entry.action === "purge" || !entry.new_data) return [];
  const changed = entry.new_data;

  return Object.keys(changed)
    .filter((key) => !HIDDEN_FIELDS.has(key))
    .filter((key) => !(key in SNAPSHOT_OF && SNAPSHOT_OF[key] in changed))
    .map((key) => ({
      key,
      label: FIELD_LABELS[key] ?? key,
      from: formatValue(key, entry.old_data?.[key], names),
      to: formatValue(key, changed[key], names),
    }));
}

/** Tên dễ đọc của bản ghi mà dòng nhật ký nói tới. */
export function recordLabel(
  entry: AuditEntry,
  names: CatalogNames,
  leadLabels?: Map<string, string>,
): string {
  const old = entry.old_data ?? {};
  switch (entry.table_name) {
    case "leads":
      return (
        leadLabels?.get(entry.record_id) ??
        (old.full_name && old.phone ? `${String(old.full_name)} · ${String(old.phone)}` : "Lead đã xoá vĩnh viễn")
      );
    case "channels":
      return names.channel(entry.record_id) ?? (old.name ? String(old.name) : "Kênh đã xoá vĩnh viễn");
    case "pages":
      return names.page(entry.record_id) ?? (old.name ? String(old.name) : "Page đã xoá vĩnh viễn");
    case "campaigns":
      return names.campaign(entry.record_id) ?? (old.name ? String(old.name) : "Chiến dịch đã xoá vĩnh viễn");
    case "services":
      return names.service(entry.record_id) ?? (old.name ? String(old.name) : "Dịch vụ đã xoá vĩnh viễn");
    case "staff":
      return names.staff(entry.record_id) ?? "Nhân viên";
    case "app_settings":
      return SETTING_LABELS[entry.record_id] ?? entry.record_id;
    default:
      return entry.record_id.slice(0, 8);
  }
}
