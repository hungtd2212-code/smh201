import { format } from "date-fns";
import type { CatalogNames } from "@/components/catalog-provider";
import { ROLE_LABELS, type StaffRole } from "@/hooks/use-current-staff";
import { APP } from "@/lib/config";
import {
  ACCOUNT_KIND_LABELS,
  OBJECTIVE_LABELS,
  PAYMENT_KIND_LABELS,
  POST_STATUS_LABELS,
  type AdAccountKind,
  type AdPaymentKind,
  type AdPostStatus,
  type CampaignObjective,
} from "@/lib/catalog/types";
import { getLeadStatus } from "@/lib/leads/status";
import type { AuditAction, AuditEntry } from "./types";

/** Tên tiếng Việt cho bảng, hành động, cột và giá trị trong nhật ký thay đổi. */

export const TABLE_LABELS: Record<string, string> = {
  leads: "Lead",
  channels: "Kênh",
  pages: "Page",
  campaigns: "Chiến dịch",
  ad_posts: "Bài post",
  ad_accounts: "TKQC",
  ad_account_assignments: "Phân công TKQC",
  ads_staff: "Nhân viên Ads",
  ad_daily_reports: "Báo cáo ads ngày",
  ads_daily_data: "Data xin được theo ngày",
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
  ads_id: "ID camp",
  ad_account_id: "TKQC",
  ads_staff_id: "Nhân viên Ads",
  objective: "Mục tiêu",
  url: "Link",
  page_staff_ids: "Trực page phụ trách",
  account_id: "ID tài khoản",
  staff_code: "Mã nhân viên",
  from_date: "Từ ngày",
  to_date: "Đến ngày",
  post_id: "ID bài",
  ad_id: "ID ads",
  platform: "Nền tảng",
  title: "Tên bài",
  media_type: "Loại nội dung",
  code: "Mã",
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
  can_delete: "Quyền xoá dữ liệu",
  can_export: "Quyền xuất file",
  locked_at: "Khoá tài khoản",
  locked_reason: "Lý do khoá",
  value: "Giá trị",
  user_id: "Nhân viên",
  work_date: "Ngày làm",
  report_date: "Ngày báo cáo",
  account_kind: "Loại tài khoản",
  payment_kind: "Thanh toán",
  spend: "Chi tiêu",
  messages: "Số lượng tin nhắn",
  data_count: "Data xin được",
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
  "post_key",
  "submitted_at",
  "updated_by",
]);

/** Cột chữ là "bản chụp" của một cột id — ẩn đi khi cột id cũng đổi trong cùng lần sửa. */
const SNAPSHOT_OF: Record<string, string> = {
  service: "service_id",
  source: "channel_id",
  assignee: "assignee_id",
};

function formatValue(table: string, key: string, value: unknown, names: CatalogNames): string {
  if (value === null || value === undefined || value === "") return "(trống)";
  if (Array.isArray(value) && value.length === 0) return "(trống)";
  const text = String(value);

  switch (key) {
    case "status":
      return table === "ad_posts"
        ? (POST_STATUS_LABELS[text as AdPostStatus] ?? text)
        : getLeadStatus(text).label;
    case "is_active":
      if (table === "ads_staff") return value ? "Đang làm" : "Nghỉ";
      break;
    case "ad_account_id":
      return names.adAccount(text) ?? "(không rõ)";
    case "ads_staff_id":
      return names.adsStaff(text) ?? "(không rõ)";
    case "objective":
      return OBJECTIVE_LABELS[text as CampaignObjective] ?? text;
    case "media_type":
      return value === "image" ? "Hình" : value === "video" ? "Video" : text;
    case "page_staff_ids":
      return Array.isArray(value)
        ? value.map((id) => names.staff(String(id)) ?? "(không rõ)").join(", ")
        : text;
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
    case "spend":
      return `${Number(value).toLocaleString("vi-VN")} ₫`;
    case "branch":
      return text === APP.branch.code ? APP.branch.name : text;
    case "account_kind":
      return ACCOUNT_KIND_LABELS[text as AdAccountKind] ?? text;
    case "payment_kind":
      return PAYMENT_KIND_LABELS[text as AdPaymentKind] ?? text;
    case "messages":
    case "data_count":
      return Number(value).toLocaleString("vi-VN");
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
      from: formatValue(entry.table_name, key, entry.old_data?.[key], names),
      to: formatValue(entry.table_name, key, changed[key], names),
    }));
}

/** Báo cáo ads ngày mà một dòng nhật ký nói tới: ngày nào, của TK ADS nào (hoặc nhân viên nào). */
export type AdReportRef = { report_date: string; ad_account_id?: string; ads_staff_id?: string };

/** Tên dễ đọc của bản ghi mà dòng nhật ký nói tới. */
export function recordLabel(
  entry: AuditEntry,
  names: CatalogNames,
  leadLabels?: Map<string, string>,
  adReportRefs?: Map<string, AdReportRef>,
): string {
  const old = entry.old_data ?? {};
  const report = adReportRefs?.get(entry.record_id);
  switch (entry.table_name) {
    case "ad_daily_reports":
      return report
        ? `${names.adAccount(report.ad_account_id) ?? "TK ADS"} · ${report.report_date.split("-").reverse().join("/")}`
        : "Báo cáo ads ngày";
    case "ads_daily_data":
      return report
        ? `Data · ${names.adsStaff(report.ads_staff_id) ?? "Nhân viên Ads"} · ${report.report_date.split("-").reverse().join("/")}`
        : "Data xin được theo ngày";
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
    case "ad_accounts":
      return names.adAccount(entry.record_id) ?? (old.name ? String(old.name) : "TKQC");
    case "ads_staff":
      return names.adsStaff(entry.record_id) ?? (old.full_name ? String(old.full_name) : "Nhân viên Ads");
    case "ad_posts":
      return names.adPost(entry.record_id) ?? (old.title ? String(old.title) : old.url ? String(old.url) : "Bài post");
    case "ad_account_assignments":
      return names.assignment(entry.record_id) ?? "Phân công TKQC";
    case "staff":
      return names.staff(entry.record_id) ?? "Nhân viên";
    case "app_settings":
      return SETTING_LABELS[entry.record_id] ?? entry.record_id;
    default:
      return entry.record_id.slice(0, 8);
  }
}
