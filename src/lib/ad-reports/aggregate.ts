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
export type Entry = { day: string; staffId: string | null; totals: Totals };

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

/**
 * Khoảng ngày liền trước, cùng độ dài, để so (vd tuần này ↔ tuần trước). Khoảng đang chạy (có ngày sau hôm nay) thì
 * kỳ trước cũng chỉ tính tới cùng số ngày đã qua.
 */
export function previousRange(from: string, to: string, today: string) {
  const length = daysBetween(from, to).length;
  const end = today && today < to ? today : to;
  const used = Math.max(1, daysBetween(from, end).length);
  const prevFrom = shiftDay(from, -length);
  const prevTo = shiftDay(prevFrom, used - 1);
  const short = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;
  return {
    from: prevFrom,
    to: prevTo,
    label: prevFrom === prevTo ? `ngày ${short(prevFrom)}` : `${short(prevFrom)} – ${short(prevTo)}`,
    keep: (day: string) => day >= prevFrom && day <= prevTo,
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

/** Mục tiêu cộng dồn của một kỳ: tổng mục tiêu các tháng, và phần "kỳ vọng" tới hôm nay. */
export type Goal = { goal: number; expected: number };

/** Kế hoạch của một kỳ (tháng / quý / năm) dựng từ mục tiêu từng tháng. */
export type Plan = {
  budget: Goal | null;
  data: Goal | null;
  revenue: Goal | null;
  maxCostPerData: number | null;
  maxCostPerMessage: number | null;
  maxAdRevenuePct: number | null;
};

/**
 * Kế hoạch của một kỳ: ngân sách / số điện thoại / doanh thu = cộng mục tiêu của từng tháng trong kỳ; "kỳ vọng tới
 * hôm nay" = tháng đã qua tính đủ, tháng này tính theo số ngày đã qua, tháng sau chưa tính. Giá tối đa và tỉ lệ
 * ads / doanh thu lấy của tháng hiện tại (kỳ đã qua hết thì của tháng cuối kỳ). `targetOf(tháng)` trả mục tiêu
 * của tháng đó (null = chưa đặt).
 */
export function planFor(period: TrackPeriod, today: string, targetOf: (month: string) => TargetValues | null): Plan {
  const thisMonth = today.slice(0, 7);
  const months = monthsBetween(period.from.slice(0, 7), period.to.slice(0, 7));
  const sums = { budget: zeroGoal(), data: zeroGoal(), revenue: zeroGoal() };
  const has = { budget: false, data: false, revenue: false };
  for (const month of months) {
    const t = targetOf(month);
    if (!t) continue;
    const elapsed = monthElapsed(month, today);
    const parts: [keyof typeof sums, number | null | undefined][] = [
      ["budget", t.monthly_budget],
      ["data", t.monthly_data],
      ["revenue", t.monthly_revenue],
    ];
    for (const [key, value] of parts) {
      if (!value) continue;
      has[key] = true;
      sums[key].goal += value;
      sums[key].expected += value * elapsed;
    }
  }
  const capMonth = months.includes(thisMonth) ? thisMonth : (months.filter((m) => m < thisMonth).at(-1) ?? months[0]);
  const caps = targetOf(capMonth);
  return {
    budget: has.budget ? sums.budget : null,
    data: has.data ? sums.data : null,
    revenue: has.revenue ? sums.revenue : null,
    maxCostPerData: caps?.max_cost_per_data ?? null,
    maxCostPerMessage: caps?.max_cost_per_message ?? null,
    maxAdRevenuePct: caps?.max_ad_revenue_pct ?? null,
  };
}
const zeroGoal = (): Goal => ({ goal: 0, expected: 0 });

/**
 * So số thực đạt của một kỳ với kế hoạch. Thanh tiến độ (`fill`): phần tô màu = đã hoàn thành, phần trắng = chưa.
 *   • Số điện thoại, doanh thu: đã đạt / mục tiêu; so với "kỳ vọng tới hôm nay" để báo tốt / kém hơn bao nhiêu %.
 *   • Ngân sách: đã tiêu / ngân sách; tiêu nhanh hơn nhịp thì nhắc, vượt thì đỏ.
 *   • Giá số, giá mess, ads / doanh thu (không được cao hơn mức tối đa): trong mức → đầy thanh (đạt); vượt → thanh
 *     chỉ tô tới (mức tối đa ÷ thực tế), phần trắng là phần còn phải giảm.
 */
export function trackGoals(actual: Totals, revenue: number, plan: Plan): TrackItem[] {
  const progress = (key: TrackKey, label: string, unit: TrackItem["unit"], value: number, g: Goal | null): TrackItem => {
    if (!g) return { key, label, unit, actual: value, goal: null, kind: "progress", status: "none", note: "Chưa đặt mục tiêu", fill: 0 };
    const fill = value / g.goal;
    const base = { key, label, unit, actual: value, goal: g.goal, kind: "progress" as const, fill };
    if (value >= g.goal) return { ...base, status: "good", note: "Đã đạt mục tiêu 🎉" };
    if (g.expected <= 0) return { ...base, status: "none", note: "Kỳ chưa bắt đầu" };
    const perf = value / g.expected - 1;
    if (perf > 0.05) return { ...base, status: "good", note: `Tốt hơn kỳ vọng ${pctText(perf)}` };
    if (perf >= -0.05) return { ...base, status: "good", note: "Đúng kỳ vọng" };
    return { ...base, status: perf < -0.15 ? "bad" : "warning", note: `Kém hơn kỳ vọng ${pctText(perf)}` };
  };
  const cap = (key: TrackKey, label: string, unit: TrackItem["unit"], value: number | null, limit: number | null, empty: string): TrackItem => {
    if (!limit) return { key, label, unit, actual: value, goal: null, kind: "cap", status: "none", note: "Chưa đặt mục tiêu", fill: 0 };
    if (value === null) return { key, label, unit, actual: null, goal: limit, kind: "cap", status: "none", note: empty, fill: 0 };
    const base = { key, label, unit, actual: value, goal: limit, kind: "cap" as const };
    if (value > limit) return { ...base, status: "bad", note: `Vượt mục tiêu ${pctText(value / limit - 1)}`, fill: limit / value };
    if (value / limit > 0.9) return { ...base, status: "warning", note: "Sát mức tối đa", fill: 1 };
    return { ...base, status: "good", note: `Tốt hơn mục tiêu ${pctText(1 - value / limit)}`, fill: 1 };
  };

  const items: TrackItem[] = [];
  if (plan.budget) {
    const { goal, expected } = plan.budget;
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
  items.push(progress("data", "Số điện thoại", "count", actual.data, plan.data));
  items.push(cap("costPerData", "Giá số", "money", ratio(actual.spend, actual.data), plan.maxCostPerData, "Chưa có data"));
  items.push(cap("costPerMessage", "Giá mess", "money", ratio(actual.spend, actual.messages), plan.maxCostPerMessage, "Chưa có mess"));
  items.push(progress("revenue", "Doanh thu", "money", revenue, plan.revenue));
  items.push(
    cap("adRevenue", "Ads / doanh thu", "percent", revenue > 0 ? (actual.spend / revenue) * 100 : null, plan.maxAdRevenuePct, "Chưa có doanh thu"),
  );
  return items;
}

/**
 * Chia một tổng cho nhiều người theo trọng số (trọng số đều 0 → chia đều), làm tròn theo `step` (vd 1.000đ) và dồn
 * phần lẻ cho người có phần dư lớn nhất — tổng sau khi chia luôn đúng bằng `total`.
 */
export function splitTotal(total: number, weights: number[], step = 1): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wSum = sum > 0 ? sum : weights.length;
  const raw = w.map((x) => (total * x) / wSum);
  const parts = raw.map((x) => Math.floor(x / step) * step);
  let left = Math.round((total - parts.reduce((a, b) => a + b, 0)) / step);
  const order = raw.map((x, i) => ({ i, rest: x - parts[i] })).sort((a, b) => b.rest - a.rest);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) parts[order[k].i] += step;
  // Nếu tổng không chia hết cho step, phần lẻ cuối cùng cộng vào người đầu tiên.
  const diff = total - parts.reduce((a, b) => a + b, 0);
  if (diff !== 0) parts[order[0].i] += diff;
  return parts;
}

/* ------------------------------------------------------------------------------------------------ */
/* Về đích theo ngày / tuần: mục tiêu tháng chia xuống từng ngày                                     */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Một tuần của tháng: thứ Hai → Chủ nhật, cắt ở đầu / cuối tháng (như sheet "Báo cáo tuần": 1–4, 5–11…). Tuần lẻ ở
 * đầu / cuối tháng ngắn hơn 4 ngày thì gộp vào tuần kế bên (vd tháng 11/2026 bắt đầu Chủ nhật: 1–8, 9–15, 16–22,
 * 23–30) — mỗi tháng 4 hoặc 5 tuần.
 */
export type Week = { index: number; from: string; to: string; days: string[] };

const MIN_WEEK_DAYS = 4;

export function weeksOfMonth(month: string): Week[] {
  const chunks: string[][] = [];
  for (const day of daysBetween(firstDayOf(month), lastDayOf(month))) {
    const last = chunks.at(-1);
    if (!last || weekdayOf(day) === 0) chunks.push([day]);
    else last.push(day);
  }
  if (chunks.length > 1 && chunks[0].length < MIN_WEEK_DAYS) chunks.splice(0, 2, [...chunks[0], ...chunks[1]]);
  const n = chunks.length;
  if (n > 1 && chunks[n - 1].length < MIN_WEEK_DAYS) chunks.splice(n - 2, 2, [...chunks[n - 2], ...chunks[n - 1]]);
  return chunks.map((days, i) => ({ index: i + 1, from: days[0], to: days[days.length - 1], days }));
}

/** Mục tiêu của một ngày (hoặc cộng của nhiều ngày). null = chưa đặt. */
export type DayGoal = { budget: number | null; data: number | null };

/**
 * Chia mục tiêu tháng đều cho từng ngày của tháng: số nguyên (ngân sách làm tròn 1.000đ), cộng các ngày đúng bằng
 * mục tiêu tháng. Mục tiêu tuần = cộng các ngày của tuần — ngày về đích thì tuần về đích, tuần về đích thì tháng về đích.
 */
export function dailyGoals(target: TargetValues | null, month: string): Map<string, DayGoal> {
  const days = daysBetween(firstDayOf(month), lastDayOf(month));
  const ones = days.map(() => 1);
  const budget = target?.monthly_budget ? splitTotal(target.monthly_budget, ones, 1000) : null;
  const data = target?.monthly_data ? splitTotal(target.monthly_data, ones) : null;
  return new Map(days.map((day, i) => [day, { budget: budget ? budget[i] : null, data: data ? data[i] : null }]));
}

/** Cộng mục tiêu của các ngày `days`. */
export function goalOf(goals: Map<string, DayGoal>, days: Iterable<string>): DayGoal {
  const sum: DayGoal = { budget: null, data: null };
  for (const day of days) {
    const g = goals.get(day);
    if (!g) continue;
    if (g.budget !== null) sum.budget = (sum.budget ?? 0) + g.budget;
    if (g.data !== null) sum.data = (sum.data ?? 0) + g.data;
  }
  return sum;
}

export type KpiCheck = {
  key: "data" | "costPerData" | "costPerMessage" | "budget";
  label: string;
  /** null = chưa tính được (vd tiêu tiền mà chưa có data → giá số "vô cùng"). */
  actual: number | null;
  goal: number;
  /** "min": phải đạt ít nhất; "max": không được vượt. */
  kind: "min" | "max";
  met: boolean;
};

export type Verdict = {
  checks: KpiCheck[];
  /**
   * Về đích: số điện thoại đủ mục tiêu VÀ giá số / giá mess không vượt mức tối đa (cái nào đã đặt mới xét).
   * null = chưa đặt mục tiêu nào để xét.
   */
  met: boolean | null;
  /** Chi tiêu vượt ngân sách của kỳ — chỉ nhắc, không tính vào về đích (tiêu thêm mà giá vẫn tốt là được). */
  overBudget: boolean;
};

/** Xét một kỳ (ngày / tuần / tháng) có về đích không: `totals` thực đạt, `goal` mục tiêu kỳ, `target` để lấy giá tối đa. */
export function judge(totals: Totals, goal: DayGoal, target: TargetValues | null): Verdict {
  const checks: KpiCheck[] = [];
  if (goal.data) {
    checks.push({ key: "data", label: "Số điện thoại", actual: totals.data, goal: goal.data, kind: "min", met: totals.data >= goal.data });
  }
  const caps: [KpiCheck["key"], string, number | null | undefined, number][] = [
    ["costPerData", "Giá số", target?.max_cost_per_data, totals.data],
    ["costPerMessage", "Giá mess", target?.max_cost_per_message, totals.messages],
  ];
  for (const [key, label, cap, count] of caps) {
    // Chưa tiêu đồng nào thì chưa có giá để xét.
    if (!cap || totals.spend === 0) continue;
    const actual = ratio(totals.spend, count);
    checks.push({ key, label, actual, goal: cap, kind: "max", met: actual !== null && actual <= cap });
  }
  const met = checks.length > 0 ? checks.every((c) => c.met) : null;
  const overBudget = goal.budget !== null && totals.spend > goal.budget;
  if (goal.budget !== null) {
    checks.push({ key: "budget", label: "Ngân sách", actual: totals.spend, goal: goal.budget, kind: "max", met: !overBudget });
  }
  return { checks, met, overBudget };
}

/** Kỳ đã qua, đang chạy (có ngày hôm nay) hay chưa tới. */
export type Phase = "past" | "current" | "future";
export const phaseOf = (from: string, to: string, today: string): Phase =>
  today > to ? "past" : today < from ? "future" : "current";

/** Tuần đã qua mà chưa đủ số: "next" = dồn hết sang tuần sau; "spread" = chia đều cho các tuần còn lại (theo số ngày). */
export type CarryMode = "next" | "spread";

/** Mục tiêu số điện thoại của một tuần: phần chia đều đầu tháng + phần thiếu dồn từ các tuần trước. */
export type WeekPlan = { week: Week; base: number | null; carriedIn: number; goal: number | null };

/**
 * Mục tiêu số điện thoại có dồn phần thiếu: đầu tháng chia đều; mỗi tuần đã qua hết mà chưa đủ số thì phần còn thiếu
 * dồn sang tuần sau (mode "next") hoặc chia đều cho các tuần còn lại theo số ngày (mode "spread"). Tuần vượt mục tiêu
 * thì KHÔNG trừ bớt các tuần sau. Tuần cuối tháng không đủ thì không còn tuần nào để dồn.
 * Trả về mục tiêu từng ngày mới (số điện thoại của tuần chia đều cho các ngày trong tuần; ngân sách giữ nguyên) và kế
 * hoạch từng tuần. `dataOf(days)` = số điện thoại thực đạt của các ngày đó.
 */
export function carryGoals(
  base: Map<string, DayGoal>,
  weeks: Week[],
  dataOf: (days: string[]) => number,
  today: string,
  mode: CarryMode,
): { goals: Map<string, DayGoal>; plans: WeekPlan[] } {
  const plans: WeekPlan[] = weeks.map((week) => {
    const b = goalOf(base, week.days).data;
    return { week, base: b, carriedIn: 0, goal: b };
  });
  for (const [i, plan] of plans.entries()) {
    if (plan.base === null || plan.week.to >= today) continue; // chưa đặt mục tiêu, hoặc tuần chưa qua hết
    const short = plan.base + plan.carriedIn - dataOf(plan.week.days);
    const rest = plans.slice(i + 1);
    if (short <= 0 || rest.length === 0) continue;
    if (mode === "next") {
      rest[0].carriedIn += short;
    } else {
      const parts = splitTotal(short, rest.map((r) => r.week.days.length));
      for (const [j, part] of parts.entries()) rest[j].carriedIn += part;
    }
  }
  const goals = new Map(base);
  for (const plan of plans) {
    if (plan.base === null) continue;
    plan.goal = plan.base + plan.carriedIn;
    if (plan.carriedIn === 0) continue;
    const parts = splitTotal(plan.goal, plan.week.days.map(() => 1));
    for (const [k, day] of plan.week.days.entries()) goals.set(day, { budget: base.get(day)?.budget ?? null, data: parts[k] });
  }
  return { goals, plans };
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

/* ------------------------------------------------------------------------------------------------ */
/* Doanh thu theo tháng: số quản lý nhập là chính, chưa có thì cộng doanh thu theo ngày                 */
/* ------------------------------------------------------------------------------------------------ */

/** Doanh thu tháng quản lý nhập (bảng ad_revenue, file 013). `month` dạng yyyy-MM-01. */
export type MonthlyRevenueRow = { month: string; ads_staff_id: string | null; amount: number };
/** Doanh thu theo ngày nhân viên tự nhập (cột revenue của ads_daily_data, file 018). */
export type DailyRevenueRow = { report_date: string; ads_staff_id: string; revenue: number | null };

/**
 * Doanh thu của từng tháng (yyyy-MM) — như bảng vinh danh trên Supabase (file 018):
 *   • nhân viên nào trong tháng đó đã có số quản lý nhập (> 0) → dùng số của quản lý;
 *   • chưa có (hoặc quản lý để 0) → cộng doanh thu theo ngày nhân viên đã nhập.
 * Không bao giờ cộng cả hai (không tính trùng). `staffId` null = cả công ty: cộng từng người, thêm dòng
 * "Chưa rõ nhân viên" của quản lý.
 */
export function revenueMonths(monthly: MonthlyRevenueRow[], daily: DailyRevenueRow[], staffId: string | null) {
  const manager = new Map<string, number>();
  const fromDays = new Map<string, number>();
  const result = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value);
  for (const r of monthly) {
    const month = r.month.slice(0, 7);
    if (r.ads_staff_id === null) {
      if (staffId === null) bump(result, month, r.amount);
    } else if (staffId === null || r.ads_staff_id === staffId) {
      bump(manager, `${month}|${r.ads_staff_id}`, r.amount);
    }
  }
  for (const d of daily) {
    if (d.revenue === null || (staffId !== null && d.ads_staff_id !== staffId)) continue;
    bump(fromDays, `${d.report_date.slice(0, 7)}|${d.ads_staff_id}`, d.revenue);
  }
  for (const key of new Set([...manager.keys(), ...fromDays.keys()])) {
    const set = manager.get(key) ?? 0;
    bump(result, key.slice(0, 7), set > 0 ? set : (fromDays.get(key) ?? 0));
  }
  return result;
}
