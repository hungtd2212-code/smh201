import type { Position } from "./positions";

/**
 * Màn hình làm việc đầu tiên sau khi đăng nhập (và khi bấm logo về trang chủ "/"), theo vị trí công việc.
 * Chủ phòng khám, 12/11/2026: Lead Ads và Nhân viên quảng cáo vào thẳng Marketing → Nhập liệu; COO vào
 * Marketing → Tổng quan. Vị trí khác (Trực page, Telesale…) và tài khoản chưa có vị trí giữ như cũ: Telesale → Leads.
 *
 * Không phụ thuộc React / Next để kiểm thử riêng được (tests/staff-home.test.mjs).
 */

export const DEFAULT_HOME = "/telesale/leads";

export const HOME_BY_POSITION: Partial<Record<Position, string>> = {
  lead_ads: "/marketing/nhap-lieu",
  ads_staff: "/marketing/nhap-lieu",
  coo: "/marketing/tong-quan",
};

/**
 * Trang đầu tiên của một người. `allowed` = các trang người đó được xem (theo vai trò / ô tick quyền), null = không
 * giới hạn (Quản trị cấp cao). Trang theo vị trí mà người đó không được xem → Leads nếu được xem, không thì trang đầu
 * tiên trên menu của người đó.
 */
export function homeFor(position: Position | null, allowed: string[] | null): string {
  const wanted = position ? HOME_BY_POSITION[position] : undefined;
  if (allowed === null) return wanted ?? DEFAULT_HOME;
  if (wanted && allowed.includes(wanted)) return wanted;
  if (allowed.includes(DEFAULT_HOME)) return DEFAULT_HOME;
  return allowed[0] ?? DEFAULT_HOME;
}
