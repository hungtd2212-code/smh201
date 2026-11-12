import type { AdAccountAssignment } from "../catalog/types";
import type { AdDailyData, AdDailyReport } from "./types";

/**
 * Cộng dồn số liệu ads (cho Tổng quan, biểu đồ và Phân tích). Không gọi máy chủ, không phụ thuộc giao diện.
 * Mọi ngày dạng yyyy-MM-dd, tháng dạng yyyy-MM.
 */

/** Các số cộng dồn được: chi tiêu, mess, data. */
export type Totals = { spend: number; messages: number; data: number };

export const zero = (): Totals => ({ spend: 0, messages: 0, data: 0 });
export const add = (a: Totals, b: Totals): Totals => ({
  spend: a.spend + b.spend,
  messages: a.messages + b.messages,
  data: a.data + b.data,
});
export const isEmpty = (t: Totals) => t.spend === 0 && t.messages === 0 && t.data === 0;

/** a / b, mẫu số bằng 0 thì null (màn hình hiện "–"). */
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export type MetricKey = "spend" | "messages" | "costPerMessage" | "data" | "costPerData" | "dataRate";

export type Metric = {
  key: MetricKey;
  label: string;
  /** "sum": cộng dồn được (vẽ cột); "ratio": tính ra từ các số khác (vẽ đường). */
  kind: "sum" | "ratio";
  unit: "đ" | "" | "%";
  /** Tăng là tốt ("up"), giảm là tốt ("down"), hay không tốt / xấu (null — ví dụ chi tiêu). */
  better: "up" | "down" | null;
  value: (t: Totals) => number | null;
};

/** Giá mess = chi tiêu / mess; giá data = chi tiêu / data; tỉ lệ xin số = data / mess. */
export const METRICS: Metric[] = [
  { key: "spend", label: "Chi tiêu", kind: "sum", unit: "đ", better: null, value: (t) => t.spend },
  { key: "messages", label: "Mess", kind: "sum", unit: "", better: "up", value: (t) => t.messages },
  { key: "costPerMessage", label: "Giá mess", kind: "ratio", unit: "đ", better: "down", value: (t) => ratio(t.spend, t.messages) },
  { key: "data", label: "Data", kind: "sum", unit: "", better: "up", value: (t) => t.data },
  { key: "costPerData", label: "Giá data", kind: "ratio", unit: "đ", better: "down", value: (t) => ratio(t.spend, t.data) },
  { key: "dataRate", label: "Tỉ lệ xin số", kind: "ratio", unit: "%", better: "up", value: (t) => ratio(t.data, t.messages) },
];

export const metricOf = (key: MetricKey) => METRICS.find((m) => m.key === key) ?? METRICS[0];

const group = (value: number) => Math.round(value).toLocaleString("vi-VN");

/** Giá trị của một chỉ số để hiện: 7.938.367 · 44,12% · "–" khi không tính được. `unit`: thêm "đ". */
export function formatMetric(metric: Metric, value: number | null, unit = false) {
  if (value === null || !Number.isFinite(value)) return "–";
  if (metric.unit === "%") {
    return `${(value * 100).toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }
  return unit && metric.unit === "đ" ? `${group(value)}đ` : group(value);
}

/** Số gọn cho trục biểu đồ: 7.938.367 → "7,9 tr"; 1.250.000.000 → "1,25 tỷ"; 0,44 (tỉ lệ) → "44%". */
export function compactMetric(metric: Metric, value: number) {
  if (metric.unit === "%") return `${Math.round(value * 100)}%`;
  const abs = Math.abs(value);
  const short = (n: number, digits: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: digits });
  if (abs >= 1e9) return `${short(value / 1e9, 2)} tỷ`;
  if (abs >= 1e6) return `${short(value / 1e6, 1)} tr`;
  if (abs >= 1e3) return `${short(value / 1e3, 0)}k`;
  return short(value, 0);
}

/**
 * Thay đổi so với kỳ trước: `pct` = (nay − trước) / trước (null khi kỳ trước bằng 0 hoặc không tính được);
 * `tone` = "good" / "bad" theo chiều tốt của chỉ số, "neutral" nếu không đổi hoặc chỉ số không có chiều tốt.
 */
export function change(metric: Metric, current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  const pct = previous === 0 ? null : diff / Math.abs(previous);
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : null;
  const tone: "good" | "bad" | "neutral" =
    direction === null || metric.better === null ? "neutral" : direction === metric.better ? "good" : "bad";
  return { diff, pct, direction, tone };
}

/* ------------------------------------------------------------------------------------------------ */
/* Ngày, tháng                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** addDays("2026-11-01", -1) → "2026-10-31". */
export function shiftDay(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Mọi ngày từ `from` tới `to` (gồm cả hai đầu). */
export function daysBetween(from: string, to: string) {
  const days: string[] = [];
  for (let day = from; day <= to && days.length < 4000; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/** "2026-11" → "2026-11-01"; lastDayOf("2026-11") → "2026-11-30". */
export const firstDayOf = (month: string) => `${month}-01`;
export function lastDayOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** shiftMonth("2026-01", -1) → "2025-12". */
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Các tháng từ `from` tới `to` (yyyy-MM). */
export function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  for (let month = from; month <= to && months.length < 600; month = shiftMonth(month, 1)) months.push(month);
  return months;
}

/* ------------------------------------------------------------------------------------------------ */
/* Cộng dồn                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

const coversDay = (x: AdAccountAssignment, day: string) => x.from_date <= day && (!x.to_date || x.to_date >= day);

/** Người phụ trách một TKQC vào một ngày (null = không ai). */
export const ownerOf = (assignments: AdAccountAssignment[], accountId: string, day: string) =>
  assignments.find((x) => x.ad_account_id === accountId && coversDay(x, day))?.ads_staff_id ?? null;

/** Một lượt cộng: ngày, người phụ trách (null = không ai), và các số. */
type Entry = { day: string; staffId: string | null; totals: Totals };

/**
 * Tách báo cáo TKQC + dòng "Data xin được" thành từng lượt cộng. Data nhập riêng theo từng TKQC ở báo cáo
 * cũ (trước khi có dòng chung) chỉ tính khi ngày đó người đó chưa có dòng Data chung.
 */
export function entriesOf(
  reports: AdDailyReport[],
  dailyData: AdDailyData[],
  assignments: AdAccountAssignment[],
): Entry[] {
  const dataDays = new Set(dailyData.map((d) => `${d.report_date}:${d.ads_staff_id}`));
  const entries: Entry[] = reports.map((r) => {
    const staffId = ownerOf(assignments, r.ad_account_id, r.report_date);
    const legacy = staffId !== null && dataDays.has(`${r.report_date}:${staffId}`) ? 0 : r.data_count;
    return { day: r.report_date, staffId, totals: { spend: r.spend, messages: r.messages, data: legacy } };
  });
  for (const d of dailyData) {
    entries.push({ day: d.report_date, staffId: d.ads_staff_id, totals: { spend: 0, messages: 0, data: d.data_count } });
  }
  return entries;
}

/** Tổng theo từng ngày. `staffId` = null → mọi nhân viên. `keep(day)` → chỉ lấy những ngày này. */
export function totalsByDay(entries: Entry[], staffId: string | null, keep: (day: string) => boolean = () => true) {
  const result = new Map<string, Totals>();
  for (const e of entries) {
    if ((staffId !== null && e.staffId !== staffId) || !keep(e.day)) continue;
    result.set(e.day, add(result.get(e.day) ?? zero(), e.totals));
  }
  return result;
}

/** Tổng theo từng nhân viên (khoá null = báo cáo của TKQC không ai phụ trách ngày đó). */
export function totalsByStaff(entries: Entry[], keep: (day: string) => boolean = () => true) {
  const result = new Map<string | null, Totals>();
  for (const e of entries) {
    if (!keep(e.day)) continue;
    result.set(e.staffId, add(result.get(e.staffId) ?? zero(), e.totals));
  }
  return result;
}

/** Cộng các ngày `days` của bảng tổng theo ngày. */
export const sumDays = (byDay: Map<string, Totals>, days: Iterable<string>) => {
  let total = zero();
  for (const day of days) {
    const t = byDay.get(day);
    if (t) total = add(total, t);
  }
  return total;
};

/** Gộp bảng tổng theo ngày thành theo tháng (yyyy-MM). */
export function totalsByMonth(byDay: Map<string, Totals>) {
  const result = new Map<string, Totals>();
  for (const [day, t] of byDay) {
    const month = day.slice(0, 7);
    result.set(month, add(result.get(month) ?? zero(), t));
  }
  return result;
}
