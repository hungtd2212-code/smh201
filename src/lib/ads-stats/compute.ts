import type { AdAccountAssignment } from "@/lib/catalog/types";
import type { AdsStats, DailyResult } from "./types";

/** Cộng dồn và tính chỉ số từ số liệu ads hằng ngày. Không gọi máy chủ. */

/** Các số cộng dồn được. */
export type Totals = {
  spend: number;
  messages: number;
  data: number;
  sales: number;
  revenue: number;
  potential: number;
  booked: number;
  wrongArea: number;
  noResponse: number;
};

export const emptyTotals = (): Totals => ({
  spend: 0,
  messages: 0,
  data: 0,
  sales: 0,
  revenue: 0,
  potential: 0,
  booked: 0,
  wrongArea: 0,
  noResponse: 0,
});

function addResult(into: Totals, row: DailyResult) {
  into.messages += row.messages;
  into.data += row.data_count;
  into.sales += row.sales;
  into.revenue += row.revenue;
  into.potential += row.q_potential;
  into.booked += row.q_booked;
  into.wrongArea += row.q_wrong_area;
  into.noResponse += row.q_no_response;
}

/** a / b; mẫu số bằng 0 thì trả về null (màn hình hiện "–"). */
export const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Các chỉ số tính ra (không lưu trong cơ sở dữ liệu). */
export const metricsOf = (t: Totals) => ({
  /** Giá mess = chi tiêu / mess. */
  costPerMessage: ratio(t.spend, t.messages),
  /** Giá data = chi tiêu / data. */
  costPerData: ratio(t.spend, t.data),
  /** Tỉ lệ xin số = data / mess. */
  dataRate: ratio(t.data, t.messages),
  /** Ads / doanh số = chi tiêu / doanh số. */
  adsOverSales: ratio(t.spend, t.sales),
});

/** Mã dùng cho phần chi tiêu của TKQC không có ai phụ trách vào ngày đó. */
export const NO_OWNER = "__no_owner";

/** Ai phụ trách TKQC nào vào ngày nào: (id TKQC, ngày) → id nhân viên Ads, hoặc NO_OWNER. */
export function ownerLookup(assignments: AdAccountAssignment[]) {
  const byAccount = new Map<string, AdAccountAssignment[]>();
  for (const item of assignments) {
    const list = byAccount.get(item.ad_account_id);
    if (list) list.push(item);
    else byAccount.set(item.ad_account_id, [item]);
  }
  return (adAccountId: string, day: string) =>
    byAccount
      .get(adAccountId)
      ?.find((x) => x.from_date <= day && (!x.to_date || x.to_date >= day))?.ads_staff_id ?? NO_OWNER;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10" → ["2026-10-01", …, "2026-10-31"] */
export function daysOfMonth(month: string): string[] {
  const [year, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${pad(i + 1)}`);
}

/** Tháng liền trước / liền sau: shiftMonth("2026-01", -1) → "2025-12". */
export function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + by, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

export type Period = { key: string; label: string; from: string; to: string };

const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/**
 * Các tuần của một tháng, tính từ thứ Hai đến Chủ nhật và cắt theo đầu / cuối tháng — giống sheet
 * "BÁO CÁO TUẦN": tháng 10/2026 → 1–4/10, 5–11/10, 12–18/10, 19–25/10, 26–31/10.
 */
export function weeksOfMonth(month: string): Period[] {
  const days = daysOfMonth(month);
  const weeks: Period[] = [];
  let from = days[0];
  for (const [index, day] of days.entries()) {
    const isSunday = new Date(`${day}T00:00:00Z`).getUTCDay() === 0;
    if (isSunday || index === days.length - 1) {
      weeks.push({ key: from, label: `${Number(from.slice(8, 10))}–${dayMonth(day)}`, from, to: day });
      from = days[index + 1];
    }
  }
  return weeks;
}

/** Số liệu đã cộng theo ngày, trong phạm vi một nhóm nhân viên (hoặc tất cả). */
export type DayRow = {
  day: string;
  totals: Totals;
  /** Chi tiêu từng TKQC trong ngày. */
  spendByAccount: Map<string, number>;
  /** Ngày này đã có số (chi tiêu hoặc kết quả) hay chưa. */
  entered: boolean;
  note: string | null;
};

export type Summary = {
  days: DayRow[];
  total: Totals;
  /** Tổng chi tiêu từng TKQC trong cả khoảng. */
  spendByAccount: Map<string, number>;
};

/**
 * Cộng số liệu theo từng ngày trong danh sách `days`.
 * `staffId` = null → mọi nhân viên; có giá trị → chỉ kết quả của người đó và chi tiêu của các TKQC
 * người đó phụ trách vào từng ngày.
 */
export function summarize(
  stats: AdsStats,
  days: string[],
  ownerOf: ReturnType<typeof ownerLookup>,
  staffId: string | null,
): Summary {
  const rows = new Map<string, DayRow>(
    days.map((day) => [day, { day, totals: emptyTotals(), spendByAccount: new Map(), entered: false, note: null }]),
  );
  const total = emptyTotals();
  const spendByAccount = new Map<string, number>();

  for (const item of stats.spend) {
    const row = rows.get(item.stat_date);
    if (!row || (staffId !== null && ownerOf(item.ad_account_id, item.stat_date) !== staffId)) continue;
    row.totals.spend += item.spend;
    total.spend += item.spend;
    row.entered = true;
    row.spendByAccount.set(item.ad_account_id, (row.spendByAccount.get(item.ad_account_id) ?? 0) + item.spend);
    spendByAccount.set(item.ad_account_id, (spendByAccount.get(item.ad_account_id) ?? 0) + item.spend);
  }
  for (const item of stats.results) {
    const row = rows.get(item.stat_date);
    if (!row || (staffId !== null && item.ads_staff_id !== staffId)) continue;
    addResult(row.totals, item);
    addResult(total, item);
    row.entered = true;
    if (staffId !== null) row.note = item.note;
  }
  return { days: [...rows.values()], total, spendByAccount };
}

/** Tổng của từng nhân viên trong khoảng [from, to]. Khoá NO_OWNER = chi tiêu chưa có người phụ trách. */
export function totalsByStaff(
  stats: AdsStats,
  from: string,
  to: string,
  ownerOf: ReturnType<typeof ownerLookup>,
): Map<string, Totals> {
  const byStaff = new Map<string, Totals>();
  const get = (id: string) => {
    let totals = byStaff.get(id);
    if (!totals) byStaff.set(id, (totals = emptyTotals()));
    return totals;
  };
  for (const item of stats.spend) {
    if (item.stat_date < from || item.stat_date > to) continue;
    get(ownerOf(item.ad_account_id, item.stat_date)).spend += item.spend;
  }
  for (const item of stats.results) {
    if (item.stat_date < from || item.stat_date > to) continue;
    addResult(get(item.ads_staff_id), item);
  }
  return byStaff;
}

/** Cộng nhiều bộ tổng lại thành một. */
export function sumTotals(list: Iterable<Totals>): Totals {
  const sum = emptyTotals();
  for (const item of list) {
    for (const key of Object.keys(sum) as (keyof Totals)[]) sum[key] += item[key];
  }
  return sum;
}
