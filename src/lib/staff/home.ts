import type { StaffRole } from "@/hooks/use-current-staff";
import type { Position } from "./positions";

/**
 * Màn hình làm việc đầu tiên sau khi đăng nhập (và khi bấm logo về trang chủ "/").
 * Chủ phòng khám, 12/11/2026:
 *   • Lead Ads và Nhân viên quảng cáo → Marketing › Nhập liệu.
 *   • Admin (Quản trị cấp cao, Quản trị) và COO → Marketing › Tổng quan — "giai đoạn này", khi Dashboard chung
 *     của công ty (Tổng quan › Dashboard) chưa làm.
 *   • Còn lại (Trực page, Telesale…) giữ như cũ: Telesale › Leads.
 *
 * Không phụ thuộc React / Next để kiểm thử riêng được (tests/staff-home.test.mjs).
 */

export const DEFAULT_HOME = "/telesale/leads";
const OVERVIEW = "/marketing/tong-quan";

/** Theo vị trí công việc — được ưu tiên trước vai trò. */
export const HOME_BY_POSITION: Partial<Record<Position, string>> = {
  lead_ads: "/marketing/nhap-lieu",
  ads_staff: "/marketing/nhap-lieu",
  coo: OVERVIEW,
};

/** Theo vai trò — cho tài khoản không có vị trí riêng ở trên (ví dụ tài khoản admin của chủ phòng khám). */
export const HOME_BY_ROLE: Partial<Record<StaffRole, string>> = {
  super_admin: OVERVIEW,
  admin: OVERVIEW,
};

/**
 * Trang đầu tiên của một người. `allowed` = các trang người đó được xem (theo vai trò / ô tick quyền), null = không
 * giới hạn (Quản trị cấp cao). Trang chọn ra mà người đó không được xem → Leads nếu được xem, không thì trang đầu
 * tiên trên menu của người đó.
 */
export function homeFor(position: Position | null, role: StaffRole, allowed: string[] | null): string {
  const wanted = (position && HOME_BY_POSITION[position]) || HOME_BY_ROLE[role];
  if (allowed === null) return wanted ?? DEFAULT_HOME;
  if (wanted && allowed.includes(wanted)) return wanted;
  if (allowed.includes(DEFAULT_HOME)) return DEFAULT_HOME;
  return allowed[0] ?? DEFAULT_HOME;
}
