import type { AdsStaff, StaffMember } from "./types";

/** Vai trò chạy quảng cáo: Nhân viên quảng cáo và Lead Ads (Lead Ads vẫn cầm TKQC và gửi báo cáo như nhân viên). */
const RUNS_ADS: ReadonlySet<StaffMember["role"]> = new Set(["ads_staff", "marketing_manager"]);

/**
 * Những người để chọn ở "Nhập thay cho" (Nhập liệu) và ô nhân viên của "Thêm TKQC": chỉ người có tài khoản
 * trong Cài đặt → Tài khoản & Phân quyền ở vị trí Nhân viên quảng cáo hoặc Lead Ads.
 *
 * Danh mục Nhân viên Ads còn chứa tên chưa có tài khoản (tên nhập tay, tên của số liệu cũ) và tên của tài
 * khoản đã xoá — các tên đó không hiện ở hai ô chọn này; số liệu cũ của họ vẫn xem được ở Tổng quan.
 */
export function adsRunners(
  adsStaff: AdsStaff[],
  staff: Pick<StaffMember, "user_id" | "role" | "deleted_at">[],
): AdsStaff[] {
  const accounts = new Set(staff.filter((s) => !s.deleted_at && RUNS_ADS.has(s.role)).map((s) => s.user_id));
  return adsStaff.filter((a) => !a.deleted_at && a.user_id !== null && accounts.has(a.user_id));
}
