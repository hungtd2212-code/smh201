/**
 * Số liệu ads hằng ngày (supabase/006_ads_daily_stats.sql) — thay cho file Google Sheet "BC ads":
 *   • chi tiêu ghi theo TỪNG TKQC mỗi ngày;
 *   • mess, data, doanh số, doanh thu, chất lượng data ghi theo TỪNG NHÂN VIÊN ADS mỗi ngày.
 * Chi tiêu của ngày nào thuộc về người phụ trách TKQC ngày đó (bảng phân công TKQC).
 */

/** Chi tiêu của một TKQC trong một ngày. */
export type DailySpend = {
  stat_date: string; // yyyy-MM-dd
  ad_account_id: string;
  spend: number;
};

/** Kết quả của một nhân viên Ads trong một ngày. */
export type DailyResult = {
  stat_date: string; // yyyy-MM-dd
  ads_staff_id: string;
  /** Tổng mess. */
  messages: number;
  /** Data: số điện thoại xin được. */
  data_count: number;
  /** Doanh số (đ). */
  sales: number;
  /** Doanh thu (đ). */
  revenue: number;
  /** Chất lượng data: khách hàng tiềm năng. */
  q_potential: number;
  /** … đặt lịch hẹn. */
  q_booked: number;
  /** … lạc tỉnh. */
  q_wrong_area: number;
  /** … không tương tác. */
  q_no_response: number;
  note: string | null;
};

export type AdsStats = {
  spend: DailySpend[];
  results: DailyResult[];
};

/** Số liệu một ngày của một nhân viên, để gửi lên máy chủ. */
export type DailyInput = {
  date: string; // yyyy-MM-dd
  adsStaffId: string;
  /** Chi tiêu từng TKQC người đó phụ trách ngày hôm ấy. */
  spend: { ad_account_id: string; spend: number }[];
  messages: number;
  data: number;
  sales: number;
  revenue: number;
  potential: number;
  booked: number;
  wrongArea: number;
  noResponse: number;
  note: string | null;
};
