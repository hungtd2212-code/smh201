/**
 * Báo cáo ads hằng ngày. Nhân viên gửi một lần ở Marketing → Nhập liệu; sửa ở Marketing → Tổng quan trong
 * 24 giờ kể từ lúc gửi (Quản trị, Trưởng Marketing sửa được bất kỳ lúc nào).
 *   • Mỗi (ngày, TK ADS) một báo cáo: chi tiêu, số lượng tin nhắn (supabase/006_ad_daily_reports.sql).
 *   • Mỗi (ngày, nhân viên Ads) một dòng "Data xin được" chung cho mọi TKQC — số điện thoại lấy từ trực
 *     page nên không tách được theo TKQC (supabase/010_ads_daily_data.sql).
 */
export type AdDailyReport = {
  id: string;
  report_date: string; // yyyy-MM-dd
  ad_account_id: string;
  /** Tài khoản đã bấm Gửi. */
  user_id: string | null;
  /** Chi tiêu (đồng). */
  spend: number;
  /** Số lượng tin nhắn. */
  messages: number;
  /** Data xin được theo TKQC — chỉ có ở báo cáo gửi trước khi tách thành dòng chung (file 010); nay luôn 0. */
  data_count: number;
  /** Lúc gửi lần đầu — mốc tính 24 giờ, không bao giờ đổi. */
  submitted_at: string;
  /** Lần sửa số gần nhất; bằng submitted_at nếu chưa sửa. */
  updated_at: string;
  updated_by: string | null;
};

/** "Data xin được" của một nhân viên Ads trong một ngày (chung cho mọi TKQC). */
export type AdDailyData = {
  id: string;
  report_date: string; // yyyy-MM-dd
  ads_staff_id: string;
  data_count: number;
  user_id: string | null;
  submitted_at: string;
  updated_at: string;
  updated_by: string | null;
};

export type ReportField = "spend" | "messages";

/** Giá trị đang gõ trong form: chuỗi chữ số, "" = chưa nhập. */
export type ReportValues = Record<ReportField, string>;

export const EMPTY_VALUES: ReportValues = { spend: "", messages: "" };

/** Hai ô của mỗi TK ADS, theo đúng thứ tự trên màn hình. */
export const REPORT_FIELDS: { key: ReportField; label: string; suffix?: string; maxDigits: number }[] = [
  { key: "spend", label: "Chi tiêu", suffix: "đ", maxDigits: 13 },
  { key: "messages", label: "Số lượng tin nhắn", maxDigits: 9 },
];

/** Dòng "Data xin được" chung bên dưới các TKQC. */
export const DATA_MAX_DIGITS = 9;

/** Nhân viên sửa được báo cáo trong chừng này thời gian kể từ lúc gửi lần đầu. */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
