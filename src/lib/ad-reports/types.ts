/**
 * Báo cáo ads hằng ngày (supabase/006_ad_daily_reports.sql): mỗi (ngày, TK ADS) một báo cáo gồm chi tiêu,
 * số lượng tin nhắn, data xin được. Nhân viên gửi một lần ở Marketing → Nhập liệu; sửa ở Marketing →
 * Tổng quan trong 24 giờ kể từ lúc gửi (Quản trị, Trưởng Marketing sửa được bất kỳ lúc nào).
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
  /** Data xin được. */
  data_count: number;
  /** Lúc gửi lần đầu — mốc tính 24 giờ, không bao giờ đổi. */
  submitted_at: string;
  /** Lần sửa số gần nhất; bằng submitted_at nếu chưa sửa. */
  updated_at: string;
  updated_by: string | null;
};

export type ReportField = "spend" | "messages" | "data_count";

/** Giá trị đang gõ trong form: chuỗi chữ số, "" = chưa nhập. */
export type ReportValues = Record<ReportField, string>;

export const EMPTY_VALUES: ReportValues = { spend: "", messages: "", data_count: "" };

/** Ba ô của mỗi TK ADS, theo đúng thứ tự trên màn hình. */
export const REPORT_FIELDS: { key: ReportField; label: string; suffix?: string; maxDigits: number }[] = [
  { key: "spend", label: "Chi tiêu", suffix: "đ", maxDigits: 13 },
  { key: "messages", label: "Số lượng tin nhắn", maxDigits: 9 },
  { key: "data_count", label: "Data xin được", maxDigits: 9 },
];

/** Nhân viên sửa được báo cáo trong chừng này thời gian kể từ lúc gửi lần đầu. */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
