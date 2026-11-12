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

/* ------------------------------------------------------------------------------------------------ */
/* So với kỳ trước                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

const monthName = (month: string) => `tháng ${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

export type PreviousPeriod = {
  /** Các tháng của kỳ trước, cùng thứ tự với các tháng đang chọn. */
  months: string[];
  /** Ngày nào thuộc kỳ trước (tháng tương ứng với tháng hiện tại chỉ tính tới cùng ngày). */
  keep: (day: string) => boolean;
  /** "tháng 10/2026", "3 tháng liền trước", "năm 2025"… (đi sau chữ "so với"). */
  label: string;
};

/**
 * Kỳ để so với các tháng đang chọn:
 *   • chọn trọn năm (một hay nhiều năm) → cùng các tháng đó của năm trước;
 *   • các tháng liền nhau → cùng số tháng liền trước;
 *   • các tháng rời rạc → không so (null).
 * Nếu đang chọn cả tháng hiện tại (chưa hết tháng) thì tháng tương ứng của kỳ trước chỉ tính tới cùng ngày.
 */
export function previousOf(months: string[], today: string): PreviousPeriod | null {
  if (months.length === 0 || !today) return null;
  const thisMonth = today.slice(0, 7);
  const last = months.at(-1) ?? months[0];
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const wholeYears =
    months.length > 1 &&
    years.every((y) => monthsBetween(`${y}-01`, `${y}-12`).filter((m) => m <= thisMonth).every((m) => months.includes(m)));
  const contiguous = monthsBetween(months[0], last).length === months.length;
  let shift: number;
  let label: string;
  if (wholeYears) {
    shift = -12;
    label = years.length === 1 ? `năm ${Number(years[0]) - 1}` : "cùng các tháng năm trước";
  } else if (contiguous) {
    shift = -months.length;
    label = months.length === 1 ? monthName(shiftMonth(months[0], -1)) : `${months.length} tháng liền trước`;
  } else {
    return null;
  }
  const prev = months.map((m) => shiftMonth(m, shift));
  const set = new Set(prev);
  const cutMonth = months.includes(thisMonth) ? shiftMonth(thisMonth, shift) : null;
  const cutDay = today.slice(8);
  if (cutMonth) label += wholeYears ? ` (cùng kỳ tới ${cutDay}/${today.slice(5, 7)})` : ` (cùng kỳ tới ngày ${Number(cutDay)})`;
  return {
    months: prev,
    keep: (day) => set.has(day.slice(0, 7)) && (day.slice(0, 7) !== cutMonth || day.slice(8) <= cutDay),
    label,
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Mục tiêu & cảnh báo                                                                              */
/* ------------------------------------------------------------------------------------------------ */

export type TargetValues = {
  monthly_budget: number | null;
  monthly_data: number | null;
  max_cost_per_message: number | null;
  max_cost_per_data: number | null;
  /** Doanh thu mục tiêu / tháng (đ). */
  monthly_revenue?: number | null;
  /** Chi phí ads / doanh thu tối đa (%), vd 30. */
  max_ad_revenue_pct?: number | null;
};

export type Status = "ok" | "warning" | "critical";

export type TargetItem = {
  key: "budget" | "data" | "costPerMessage" | "costPerData";
  label: string;
  actual: number | null;
  goal: number;
  /** "progress": cộng dồn tới mục tiêu (ngân sách, data); "cap": không được vượt (giá). */
  kind: "progress" | "cap";
  status: Status;
  note: string;
};

/** Phần tháng đã trôi qua (0 → 1) — để biết "đúng nhịp" tới hôm nay là bao nhiêu. */
export function monthElapsed(month: string, today: string) {
  const thisMonth = today.slice(0, 7);
  if (month < thisMonth) return 1;
  if (month > thisMonth) return 0;
  return Number(today.slice(8)) / Number(lastDayOf(month).slice(8));
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** So số của tháng với mục tiêu. `elapsed`: phần tháng đã qua (monthElapsed). */
export function checkTargets(totals: Totals, target: TargetValues, elapsed: number): TargetItem[] {
  const items: TargetItem[] = [];
  if (target.monthly_budget) {
    const share = totals.spend / target.monthly_budget;
    const status: Status = share > 1 ? "critical" : share > elapsed + 0.1 ? "warning" : "ok";
    items.push({
      key: "budget",
      label: "Ngân sách tháng",
      actual: totals.spend,
      goal: target.monthly_budget,
      kind: "progress",
      status,
      note:
        status === "critical"
          ? `Vượt ngân sách ${percent(share - 1)}`
          : status === "warning"
            ? `Tiêu nhanh hơn kế hoạch (đã dùng ${percent(share)}, mới qua ${percent(elapsed)} tháng)`
            : `Đã dùng ${percent(share)} ngân sách`,
    });
  }
  if (target.monthly_data) {
    const share = totals.data / target.monthly_data;
    const status: Status = share >= 1 ? "ok" : elapsed >= 1 ? "critical" : share < elapsed - 0.1 ? "warning" : "ok";
    items.push({
      key: "data",
      label: "Data mục tiêu",
      actual: totals.data,
      goal: target.monthly_data,
      kind: "progress",
      status,
      note:
        share >= 1
          ? "Đã đạt mục tiêu"
          : status === "critical"
            ? `Không đạt (được ${percent(share)})`
            : status === "warning"
              ? `Chậm hơn kế hoạch (được ${percent(share)}, đã qua ${percent(elapsed)} tháng)`
              : `Đạt ${percent(share)} — đúng nhịp`,
    });
  }
  const caps: [TargetItem["key"], string, number | null, number | null][] = [
    ["costPerMessage", "Giá mess", target.max_cost_per_message, ratio(totals.spend, totals.messages)],
    ["costPerData", "Giá data", target.max_cost_per_data, ratio(totals.spend, totals.data)],
  ];
  for (const [key, label, cap, actual] of caps) {
    if (!cap) continue;
    const status: Status = actual === null ? "ok" : actual > cap ? "critical" : actual > cap * 0.9 ? "warning" : "ok";
    items.push({
      key,
      label: `${label} tối đa`,
      actual,
      goal: cap,
      kind: "cap",
      status,
      note:
        actual === null
          ? "Chưa có số"
          : status === "critical"
            ? `Vượt mục tiêu ${percent(actual / cap - 1)}`
            : status === "warning"
              ? "Sắp chạm mức tối đa"
              : `Thấp hơn mục tiêu ${percent(1 - actual / cap)}`,
    });
  }
  return items;
}

export type Alert = { level: "warning" | "critical"; text: string };

const money = (value: number) => `${group(value)}đ`;
const shortDay = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;

/**
 * Cảnh báo bất thường: ngày gần nhất có chi tiêu (trong 3 ngày gần đây) so với 7 ngày trước đó —
 * giá data / giá mess cao hơn từ 30%, hoặc tiêu tiền mà chưa có data.
 */
export function spikeAlerts(byDay: Map<string, Totals>, today: string): Alert[] {
  let day: string | null = null;
  for (let i = 0; i < 3; i++) {
    const d = shiftDay(today, -i);
    if ((byDay.get(d)?.spend ?? 0) > 0) {
      day = d;
      break;
    }
  }
  if (!day) return [];
  const current = byDay.get(day) ?? zero();
  const base = sumDays(byDay, daysBetween(shiftDay(day, -7), shiftDay(day, -1)));
  const alerts: Alert[] = [];
  const baseDays = daysBetween(shiftDay(day, -7), shiftDay(day, -1)).filter((d) => (byDay.get(d)?.spend ?? 0) > 0).length;
  if (current.data === 0 && baseDays > 0 && current.spend >= (base.spend / baseDays) * 0.5) {
    alerts.push({ level: "warning", text: `Ngày ${shortDay(day)} đã tiêu ${money(current.spend)} nhưng chưa có data (có thể chưa nhập Data xin được).` });
  }
  const checks: [string, number | null, number | null][] = [
    ["Giá data", ratio(current.spend, current.data), ratio(base.spend, base.data)],
    ["Giá mess", ratio(current.spend, current.messages), ratio(base.spend, base.messages)],
  ];
  for (const [label, now, before] of checks) {
    if (now === null || before === null || before === 0) continue;
    const rise = now / before - 1;
    if (rise >= 0.3) {
      alerts.push({
        level: rise >= 0.6 ? "critical" : "warning",
        text: `${label} ngày ${shortDay(day)} là ${money(now)}, cao hơn ${percent(rise)} so với 7 ngày trước đó (${money(before)}).`,
      });
    }
  }
  return alerts;
}

/* ------------------------------------------------------------------------------------------------ */
/* Theo thứ trong tuần, theo TKQC                                                                    */
/* ------------------------------------------------------------------------------------------------ */

/** 0 = thứ Hai … 6 = Chủ nhật. */
export const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
export const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** Tổng của từng thứ trong tuần trên các ngày `days`, kèm số ngày của thứ đó. */
export function totalsByWeekday(byDay: Map<string, Totals>, days: string[]) {
  const result = WEEKDAYS.map(() => ({ totals: zero(), days: 0 }));
  for (const day of days) {
    const slot = result[weekdayOf(day)];
    slot.days += 1;
    const t = byDay.get(day);
    if (t) slot.totals = add(slot.totals, t);
  }
  return result;
}

export type AccountTotals = { totals: Totals; activeDays: number; owners: Set<string | null> };

/**
 * Tổng theo từng TKQC (chi tiêu, mess; data không tách được theo TKQC nên = 0).
 * `staffId` = null → mọi người; `keep(day)` → chỉ những ngày này.
 */
export function totalsByAccount(
  reports: AdDailyReport[],
  assignments: AdAccountAssignment[],
  staffId: string | null,
  keep: (day: string) => boolean = () => true,
) {
  const result = new Map<string, AccountTotals>();
  for (const r of reports) {
    if (!keep(r.report_date)) continue;
    const owner = ownerOf(assignments, r.ad_account_id, r.report_date);
    if (staffId !== null && owner !== staffId) continue;
    const row = result.get(r.ad_account_id) ?? { totals: zero(), activeDays: 0, owners: new Set() };
    row.totals = add(row.totals, { spend: r.spend, messages: r.messages, data: 0 });
    if (r.spend > 0) row.activeDays += 1;
    row.owners.add(owner);
    result.set(r.ad_account_id, row);
  }
  return result;
}

/* ------------------------------------------------------------------------------------------------ */
/* Phễu khách hàng                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

/** Một lead Telesale rút gọn cho phễu. */
export type FunnelLead = {
  day: string;
  status: string;
  hasAppointment: boolean;
  invalidPhone: boolean;
  /** TKQC của chiến dịch gắn với lead (null = chưa gắn). */
  accountId: string | null;
};

export type FunnelCounts = { leads: number; booked: number; done: number };

/**
 * Đếm lead thật (bỏ số trùng / huỷ trong `excluded` và số sai), số đã hẹn lịch (đang ở trạng thái Hẹn lịch /
 * Đã làm dịch vụ, hoặc có ngày hẹn) và số đã làm dịch vụ.
 */
export function funnelCounts(leads: FunnelLead[], excluded: readonly string[]): FunnelCounts {
  const counts = { leads: 0, booked: 0, done: 0 };
  for (const lead of leads) {
    if (lead.invalidPhone || excluded.includes(lead.status)) continue;
    counts.leads += 1;
    if (lead.hasAppointment || lead.status === "hen_lich" || lead.status === "da_lam_dich_vu") counts.booked += 1;
    if (lead.status === "da_lam_dich_vu") counts.done += 1;
  }
  return counts;
}

/* ------------------------------------------------------------------------------------------------ */
/* Theo dõi mục tiêu tháng / quý / năm                                                               */
/* ------------------------------------------------------------------------------------------------ */

export type TrackKey = "budget" | "data" | "costPerData" | "costPerMessage" | "revenue" | "adRevenue";
export type TrackStatus = "good" | "warning" | "bad" | "none";

export type TrackItem = {
  key: TrackKey;
  label: string;
  unit: "money" | "count" | "percent";
  /** null = chưa tính được (vd chưa có mess để tính giá mess). */
  actual: number | null;
  /** null = chưa đặt mục tiêu. */
  goal: number | null;
  /** "progress": càng nhiều càng tốt (data, doanh thu); "budget": không vượt; "cap": không được cao hơn (giá, tỉ lệ). */
  kind: "progress" | "budget" | "cap";
  status: TrackStatus;
  note: string;
  /** Độ dài thanh (0 → 1, có thể > 1 khi vượt). */
  fill: number;
};

export type TrackPeriod = { key: "month" | "quarter" | "year"; label: string; from: string; to: string; months: number };

/** Tháng / quý / năm chứa ngày `today`. */
export function trackPeriods(today: string): TrackPeriod[] {
  const y = today.slice(0, 4);
  const m = Number(today.slice(5, 7));
  const q = Math.floor((m - 1) / 3);
  const qFrom = `${y}-${String(q * 3 + 1).padStart(2, "0")}`;
  const qTo = `${y}-${String(q * 3 + 3).padStart(2, "0")}`;
  return [
    { key: "month", label: "Tháng", from: firstDayOf(today.slice(0, 7)), to: lastDayOf(today.slice(0, 7)), months: 1 },
    { key: "quarter", label: "Quý", from: firstDayOf(qFrom), to: lastDayOf(qTo), months: 3 },
    { key: "year", label: "Năm", from: `${y}-01-01`, to: `${y}-12-31`, months: 12 },
  ];
}

/** Phần của kỳ đã trôi qua tới hết ngày `today` (0 → 1). */
export const periodElapsed = (period: TrackPeriod, today: string) => {
  const all = daysBetween(period.from, period.to).length;
  const passed = daysBetween(period.from, today < period.to ? today : period.to).length;
  return all > 0 ? passed / all : 0;
};

const pctText = (value: number) => `${Math.round(Math.abs(value) * 100)}%`;

/**
 * So số thực đạt của một kỳ với mục tiêu (mục tiêu tháng × số tháng của kỳ cho ngân sách / data / doanh thu;
 * giá và tỉ lệ thì giữ nguyên). `elapsed`: phần kỳ đã qua — để biết "kỳ vọng tới hôm nay".
 */
export function trackGoals(
  actual: Totals,
  revenue: number,
  target: TargetValues | null,
  months: number,
  elapsed: number,
): TrackItem[] {
  const progress = (key: TrackKey, label: string, unit: TrackItem["unit"], value: number, monthly: number | null | undefined): TrackItem => {
    if (!monthly) return { key, label, unit, actual: value, goal: null, kind: "progress", status: "none", note: "Chưa đặt mục tiêu", fill: 0 };
    const goal = monthly * months;
    const expected = goal * elapsed;
    const fill = value / goal;
    if (value >= goal) return { key, label, unit, actual: value, goal, kind: "progress", status: "good", note: "Đã đạt mục tiêu 🎉", fill };
    if (expected <= 0) return { key, label, unit, actual: value, goal, kind: "progress", status: "none", note: "Kỳ chưa bắt đầu", fill };
    const perf = value / expected - 1;
    if (perf > 0.05) return { key, label, unit, actual: value, goal, kind: "progress", status: "good", note: `Tốt hơn kỳ vọng ${pctText(perf)}`, fill };
    if (perf >= -0.05) return { key, label, unit, actual: value, goal, kind: "progress", status: "good", note: "Đúng kỳ vọng", fill };
    return { key, label, unit, actual: value, goal, kind: "progress", status: perf < -0.15 ? "bad" : "warning", note: `Kém hơn kỳ vọng ${pctText(perf)}`, fill };
  };
  const cap = (key: TrackKey, label: string, unit: TrackItem["unit"], value: number | null, limit: number | null | undefined, empty: string): TrackItem => {
    if (!limit) return { key, label, unit, actual: value, goal: null, kind: "cap", status: "none", note: "Chưa đặt mục tiêu", fill: 0 };
    if (value === null) return { key, label, unit, actual: null, goal: limit, kind: "cap", status: "none", note: empty, fill: 0 };
    const fill = value / limit;
    if (value > limit) return { key, label, unit, actual: value, goal: limit, kind: "cap", status: "bad", note: `Vượt mục tiêu ${pctText(fill - 1)}`, fill };
    if (fill > 0.9) return { key, label, unit, actual: value, goal: limit, kind: "cap", status: "warning", note: "Sát mức tối đa", fill };
    return { key, label, unit, actual: value, goal: limit, kind: "cap", status: "good", note: `Tốt hơn mục tiêu ${pctText(1 - fill)}`, fill };
  };

  const items: TrackItem[] = [];
  // Ngân sách: không vượt; tiêu nhanh hơn nhịp thì nhắc.
  if (target?.monthly_budget) {
    const goal = target.monthly_budget * months;
    const expected = goal * elapsed;
    const fill = actual.spend / goal;
    const perf = expected > 0 ? actual.spend / expected - 1 : 0;
    const [status, note]: [TrackStatus, string] =
      fill > 1
        ? ["bad", `Vượt ngân sách ${pctText(fill - 1)}`]
        : perf > 0.1
          ? ["warning", `Tiêu nhanh hơn kế hoạch ${pctText(perf)}`]
          : perf < -0.1
            ? ["good", `Tiêu chậm hơn kế hoạch ${pctText(perf)}`]
            : ["good", "Đúng kế hoạch"];
    items.push({ key: "budget", label: "Ngân sách", unit: "money", actual: actual.spend, goal, kind: "budget", status, note, fill });
  } else {
    items.push({ key: "budget", label: "Ngân sách", unit: "money", actual: actual.spend, goal: null, kind: "budget", status: "none", note: "Chưa đặt mục tiêu", fill: 0 });
  }
  items.push(progress("data", "Số điện thoại", "count", actual.data, target?.monthly_data));
  items.push(cap("costPerData", "Giá số", "money", ratio(actual.spend, actual.data), target?.max_cost_per_data, "Chưa có data"));
  items.push(cap("costPerMessage", "Giá mess", "money", ratio(actual.spend, actual.messages), target?.max_cost_per_message, "Chưa có mess"));
  items.push(progress("revenue", "Doanh thu", "money", revenue, target?.monthly_revenue));
  items.push(
    cap("adRevenue", "Ads / doanh thu", "percent", revenue > 0 ? (actual.spend / revenue) * 100 : null, target?.max_ad_revenue_pct, "Chưa có doanh thu"),
  );
  return items;
}

/* ------------------------------------------------------------------------------------------------ */
/* Vinh danh                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

export type BoardInput = { id: string; spend: number; data: number; revenue: number; dataTarget: number | null };
export type BoardScore = {
  id: string;
  /** Chi phí ads / doanh thu (%); null = chưa có doanh thu. */
  adRevenuePct: number | null;
  /** Giá mỗi số (đ); null = chưa có data. */
  costPerData: number | null;
  /** Số đạt so với target tới hôm nay (1 = đúng nhịp); null = chưa đặt target. */
  targetPace: number | null;
  /** Điểm 0 → 100 (trung bình các tiêu chí có số). */
  score: number;
};

/**
 * Điểm vinh danh: mỗi tiêu chí chấm 0 → 100 (người tốt nhất nhóm = 100):
 *   • tỉ lệ ads / doanh thu: thấp nhất nhóm = 100, người khác = thấp nhất ÷ của mình × 100;
 *   • giá số: rẻ nhất nhóm = 100, tương tự;
 *   • số điện thoại so với target (theo nhịp tới hôm nay): đạt / vượt = 100, chưa đạt = tỉ lệ đạt × 100.
 * Tiêu chí nào cả nhóm chưa có số (vd chưa nhập doanh thu) thì bỏ qua; người thiếu số ở một tiêu chí được 0 điểm
 * tiêu chí đó. Chỉ xếp hạng người chi tiêu từ 30% mức trung bình của nhóm trở lên — để người chạy rất ít tiền
 * (vd vài nghìn đồng ra 1 số) không "rẻ nhất" một cách ảo.
 */
export const BOARD_MIN_SHARE = 0.3;

export function scoreBoard(rows: BoardInput[], elapsed: number): BoardScore[] {
  const spenders = rows.filter((r) => r.spend > 0);
  const average = spenders.length > 0 ? spenders.reduce((s, r) => s + r.spend, 0) / spenders.length : 0;
  const scored = spenders
    .filter((r) => r.spend >= average * BOARD_MIN_SHARE)
    .map((r) => ({
      id: r.id,
      adRevenuePct: r.revenue > 0 ? (r.spend / r.revenue) * 100 : null,
      costPerData: r.data > 0 ? r.spend / r.data : null,
      targetPace: r.dataTarget && elapsed > 0 ? r.data / (r.dataTarget * elapsed) : null,
    }));
  const minOf = (values: (number | null)[]) => {
    const known = values.filter((v): v is number => v !== null && v > 0);
    return known.length > 0 ? Math.min(...known) : null;
  };
  const bestRatio = minOf(scored.map((s) => s.adRevenuePct));
  const bestCost = minOf(scored.map((s) => s.costPerData));
  const hasTarget = scored.some((s) => s.targetPace !== null);
  return scored
    .map((s) => {
      const parts: number[] = [];
      if (bestRatio !== null) parts.push(s.adRevenuePct ? (bestRatio / s.adRevenuePct) * 100 : 0);
      if (bestCost !== null) parts.push(s.costPerData ? (bestCost / s.costPerData) * 100 : 0);
      if (hasTarget) parts.push(s.targetPace === null ? 0 : Math.min(1, s.targetPace) * 100);
      const score = parts.length > 0 ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
      return { ...s, score: Math.round(score * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score);
}
