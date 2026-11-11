import { ROLE_LABELS, type StaffRole } from "@/hooks/use-current-staff";

/**
 * Vị trí công việc khi thêm người (Cài đặt → Tài khoản & Phân quyền). Mỗi vị trí đi kèm một vai trò
 * quyết định được đọc / ghi dữ liệu nào (supabase/008_staff_accounts.sql, hàm role_of_position).
 */
export type Position = "coo" | "lead_ads" | "ads_staff" | "page";

export const POSITION_ORDER: Position[] = ["coo", "lead_ads", "ads_staff", "page"];

export const POSITION_LABELS: Record<Position, string> = {
  coo: "COO",
  lead_ads: "Lead Ads",
  ads_staff: "Nhân viên quảng cáo",
  page: "Trực page",
};

export const POSITION_ROLE: Record<Position, StaffRole> = {
  coo: "admin",
  lead_ads: "marketing_manager",
  ads_staff: "ads_staff",
  page: "page",
};

/** Tên hiện ở cột "Vị trí": vị trí nếu có, không thì vai trò (tài khoản tạo trước khi có vị trí). */
export const positionLabel = (position: Position | null, role: StaffRole) =>
  position ? POSITION_LABELS[position] : ROLE_LABELS[role];

/** Mật khẩu điền sẵn khi thêm người. */
export const DEFAULT_PASSWORD = "123456789@";

/** Tên đăng nhập → email đăng nhập trong Supabase Auth (giống hàm login_email trong cơ sở dữ liệu). */
export const loginEmail = (login: string) => {
  const value = login.trim();
  return value.includes("@") ? value : `${value.toLowerCase()}@smilehub.local`;
};

/** Ngược lại: email đăng nhập → tên hiển thị ("dieu.linh@smilehub.local" → "dieu.linh"). */
export const loginName = (email: string) => email.replace(/@smilehub\.local$/i, "");
