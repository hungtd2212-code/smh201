import type { Lead, LeadStatusRow } from "./types";

/**
 * Phần tính toán của bảng Lead (Telesale CRM) — không phụ thuộc React / Supabase để kiểm thử riêng được
 * (tests/telesale-crm.test.mjs). Chỉ dùng import kiểu từ file khác.
 */

/** Vai trò được đổi sale quản lý số (giống private.can_transfer_leads trong supabase/020_telesale_crm.sql). */
export const TRANSFER_ROLES = ["super_admin", "admin", "lead", "page"] as const;
/** Vai trò thấy mọi số (Telesale chỉ thấy số mình quản lý). */
export const SEES_ALL_ROLES = ["super_admin", "admin", "lead", "page", "marketing_manager"] as const;
/** Vai trò chỉnh trạng thái khách hàng và cách chia số. */
export const MANAGER_ROLES = ["super_admin", "admin", "lead"] as const;

export const hasRole = (roles: readonly string[], role: string | null | undefined) =>
  role != null && roles.includes(role);

/** Bảng màu gợi ý cho nhãn trạng thái (nền, chữ) — giống các màu trong ảnh mẫu của chủ phòng khám. */
export const STATUS_PALETTE: { color: string; text_color: string; label: string }[] = [
  { color: "#3f9b35", text_color: "#ffffff", label: "Xanh lá" },
  { color: "#d5ecd0", text_color: "#25632a", label: "Xanh lá nhạt" },
  { color: "#1e4fa3", text_color: "#ffffff", label: "Xanh dương" },
  { color: "#dbeafe", text_color: "#1e40af", label: "Xanh dương nhạt" },
  { color: "#0f766e", text_color: "#ffffff", label: "Xanh ngọc" },
  { color: "#5b3c94", text_color: "#ffffff", label: "Tím" },
  { color: "#e9dcf6", text_color: "#5b3c94", label: "Tím nhạt" },
  { color: "#f6e05e", text_color: "#3f3200", label: "Vàng" },
  { color: "#f59e0b", text_color: "#ffffff", label: "Cam" },
  { color: "#b42318", text_color: "#ffffff", label: "Đỏ" },
  { color: "#9b1c1c", text_color: "#ffffff", label: "Đỏ đậm" },
  { color: "#f9cdc7", text_color: "#b42318", label: "Hồng" },
  { color: "#6b3a10", text_color: "#fde7cf", label: "Nâu" },
  { color: "#3a3a3a", text_color: "#ffffff", label: "Xám đậm" },
  { color: "#e5e7eb", text_color: "#374151", label: "Xám nhạt" },
];

/** Đưa trạng thái `id` lên (-1) hoặc xuống (+1) một bậc. Trả về thứ tự mới (không đổi nếu đã ở đầu / cuối). */
export function moveStatus(ids: string[], id: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Trạng thái để chọn: đang dùng, theo thứ tự; trạng thái hiện tại của số vẫn có dù đã bị ẩn. */
export function selectableStatuses(statuses: LeadStatusRow[], currentId: string | null): LeadStatusRow[] {
  return [...statuses]
    .filter((s) => s.is_active || s.id === currentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "vi"));
}

/** Những ô còn thiếu khi chọn một trạng thái (vd "Đặt lịch hẹn" phải có lịch hẹn). */
export function missingForStatus(
  status: LeadStatusRow | undefined,
  values: { appointment_at: string | null; deal_amount: number | null },
): string[] {
  if (!status) return [];
  const missing: string[] = [];
  if (status.needs_appointment && !values.appointment_at) missing.push("Lịch hẹn");
  if (status.needs_deal && (values.deal_amount == null || values.deal_amount <= 0)) missing.push("Doanh số");
  return missing;
}

/** Số lần khách quay lại (số trùng) = số lần số này được thêm, trừ lần đầu. */
export const duplicateCount = (lead: Pick<Lead, "touch_count">) => Math.max(0, (lead.touch_count ?? 1) - 1);

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

/** Ô tìm kiếm: tên, số (bỏ dấu cách / chấm), lưu ý, khai thác thông tin, khu vực — không phân biệt dấu. */
export function matchesQuery(
  lead: Pick<Lead, "full_name" | "phone" | "note" | "consult_info" | "area">,
  query: string,
): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const digits = query.replace(/[^0-9]/g, "");
  if (digits.length >= 3 && lead.phone.includes(digits.replace(/^84/, "0"))) return true;
  return [lead.full_name, lead.note, lead.consult_info, lead.area]
    .filter((v): v is string => Boolean(v))
    .some((v) => fold(v).includes(q));
}

/** Bộ lọc của bảng Lead. */
export type LeadFilter = {
  query: string;
  /** "all" | "none" (chưa xử lý) | id trạng thái. */
  status: string;
  /** "all" | "unassigned" (chưa chia) | user id của sale. */
  sale: string;
  /** Chỉ số khách vừa nhắn lại (số trùng chưa xử lý). */
  recontacted: boolean;
};

export function filterLeads<T extends Lead>(leads: T[], filter: LeadFilter): T[] {
  return leads.filter((lead) => {
    if (filter.status === "none" ? lead.status_id !== null : filter.status !== "all" && lead.status_id !== filter.status)
      return false;
    if (filter.sale === "unassigned" ? lead.assignee_id !== null : filter.sale !== "all" && lead.assignee_id !== filter.sale)
      return false;
    if (filter.recontacted && !lead.recontacted_at) return false;
    return matchesQuery(lead, filter.query);
  });
}

/** "45.000.000" — trống thì "". */
export const money = (value: number | null | undefined) =>
  value == null ? "" : new Intl.NumberFormat("vi-VN").format(value);

export const GENDER_LABELS: Record<"male" | "female", string> = { male: "Nam", female: "Nữ" };

/** Giờ Việt Nam của một mốc thời gian: { day: "13/11/2026", time: "14:05", short: "13/11 14:05" }. */
export function vnDateTime(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.day}/${p.month}/${p.year}`, time: `${p.hour}:${p.minute}`, short: `${p.day}/${p.month} ${p.hour}:${p.minute}` };
}
