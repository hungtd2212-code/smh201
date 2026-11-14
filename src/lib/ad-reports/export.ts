import type { AdAccount, AdAccountAssignment, AdsStaff } from "../catalog/types";
import type { Entry, Totals } from "./aggregate";
import type { AdDailyData, AdDailyReport } from "./types";

/**
 * "Tải Excel" ở Marketing → Tổng quan / Phân tích: dựng nội dung file Excel cho đúng kỳ và đúng người đang xem.
 * Không gọi máy chủ, không phụ thuộc giao diện. Các tab:
 *   Tổng hợp (cả kỳ + từng kỳ so sánh) · Theo ngày · Theo tháng (khi nhiều tháng) · Theo thứ · Theo nhân viên (khi xem
 *   tất cả) · Theo TKQC · Chi tiết TKQC · Chi tiết Data.
 * Giá mess = chi tiêu / mess; giá data = chi tiêu / data; tỉ lệ xin số = data / mess; chia cho 0 → "–".
 */

export type XCell =
  | string
  | number
  | null
  | {
      value: string | number | Date;
      type?: StringConstructor | NumberConstructor | DateConstructor;
      format?: string;
      fontWeight?: "bold";
      backgroundColor?: string;
    };
export type XSheet = { sheet: string; data: XCell[][]; columns: { width: number }[]; stickyRowsCount?: number };

export type ExportInput = {
  /** vd "Tổng quan", "Phân tích · So sánh tháng". */
  title: string;
  /** vd "Tất cả nhân viên", "Dương Ads". */
  who: string;
  /** vd "Tháng 11/2026", "01/11/2026 – 13/11/2026". */
  periodLabel: string;
  /** Các ngày đang xem (yyyy-MM-dd). */
  days: string[];
  /** Các kỳ đang so sánh (vd từng tháng, Kỳ A / Kỳ B, từng năm). */
  groups?: { label: string; days: string[] }[];
  /** null = tất cả nhân viên. */
  staffId: string | null;
  /** entriesOf(reports, data, assignments). */
  entries: Entry[];
  reports: AdDailyReport[];
  data: AdDailyData[];
  staff: AdsStaff[];
  accounts: AdAccount[];
  assignments: AdAccountAssignment[];
  /** Lúc xuất, vd "13/11/2026 14:05". */
  exportedAt: string;
};

const WEEKDAY_NAMES = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
const showDay = (day: string) => day.split("-").reverse().join("/");
const showMonth = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

const bold = (value: string): XCell => ({ value, fontWeight: "bold" });
const head = (value: string): XCell => ({ value, fontWeight: "bold", backgroundColor: "#E8F1FB" });
const money = (value: number): XCell => ({ value, format: "#,##0" });
const whole = (value: number): XCell => ({ value, format: "#,##0" });
const date = (day: string): XCell => ({ value: new Date(`${day}T00:00:00Z`), type: Date, format: "dd/mm/yyyy" });
/** Chia cho 0 → "–" (như trên màn hình). */
const ratio = (a: number, b: number, format: string): XCell => (b > 0 ? { value: a / b, format } : "–");

const zero = (): Totals => ({ spend: 0, messages: 0, data: 0 });
const addTo = (t: Totals, x: Totals) => {
  t.spend += x.spend;
  t.messages += x.messages;
  t.data += x.data;
};

const METRIC_HEAD = ["Chi tiêu", "Mess", "Giá mess", "Data", "Giá data", "Tỉ lệ xin số", "Doanh số ngày"];
const METRIC_WIDTHS = [16, 9, 12, 9, 13, 12, 16];
const metricCells = (t: Totals, revenue: number): XCell[] => [
  money(t.spend),
  whole(t.messages),
  ratio(t.spend, t.messages, "#,##0"),
  whole(t.data),
  ratio(t.spend, t.data, "#,##0"),
  ratio(t.data, t.messages, "0.0%"),
  revenue > 0 ? money(revenue) : "–",
];

export function buildAdsExport(input: ExportInput): XSheet[] {
  const days = [...new Set(input.days)].sort();
  const daySet = new Set(days);
  const mine = (staffId: string | null) => input.staffId === null || staffId === input.staffId;
  const staffName = (id: string | null) =>
    id === null ? "Chưa có người phụ trách" : (input.staff.find((s) => s.id === id)?.full_name ?? "Nhân viên đã xoá");
  const ownerOf = (accountId: string, day: string) =>
    input.assignments.find(
      (x) => !x.deleted_at && x.ad_account_id === accountId && x.from_date <= day && (!x.to_date || x.to_date >= day),
    )?.ads_staff_id ?? null;

  // Cộng dồn theo ngày và theo người (chỉ các ngày đang xem, đúng người đang xem).
  const byDay = new Map<string, Totals>();
  const byStaff = new Map<string | null, Totals>();
  for (const e of input.entries) {
    if (!daySet.has(e.day) || !mine(e.staffId)) continue;
    const d = byDay.get(e.day) ?? zero();
    addTo(d, e.totals);
    byDay.set(e.day, d);
    const s = byStaff.get(e.staffId) ?? zero();
    addTo(s, e.totals);
    byStaff.set(e.staffId, s);
  }
  const dataRows = input.data.filter((d) => daySet.has(d.report_date) && mine(d.ads_staff_id));
  const revenueByDay = new Map<string, number>();
  const revenueByStaff = new Map<string, number>();
  for (const d of dataRows) {
    if (d.revenue === null) continue;
    revenueByDay.set(d.report_date, (revenueByDay.get(d.report_date) ?? 0) + d.revenue);
    revenueByStaff.set(d.ads_staff_id, (revenueByStaff.get(d.ads_staff_id) ?? 0) + d.revenue);
  }
  const reportRows = input.reports
    .filter((r) => daySet.has(r.report_date))
    .map((r) => ({ r, owner: ownerOf(r.ad_account_id, r.report_date) }))
    .filter(({ owner }) => mine(owner));

  const sumOf = (list: string[]) => {
    const t = zero();
    let revenue = 0;
    for (const day of list) {
      addTo(t, byDay.get(day) ?? zero());
      revenue += revenueByDay.get(day) ?? 0;
    }
    return { t, revenue };
  };

  const sheets: XSheet[] = [];

  // ---- Tổng hợp ----
  const all = sumOf(days);
  const groups = (input.groups ?? []).filter((g) => g.days.length > 0);
  sheets.push({
    sheet: "Tổng hợp",
    data: [
      [bold(`Báo cáo quảng cáo — ${input.title}`)],
      ["Nhân viên", input.who],
      ["Kỳ", input.periodLabel],
      ["Xuất lúc", input.exportedAt],
      [],
      [head("Kỳ"), ...METRIC_HEAD.map(head), head("Số ngày")],
      [bold("Cả kỳ đang xem"), ...metricCells(all.t, all.revenue), whole(days.length)],
      ...(groups.length > 1
        ? groups.map((g) => {
            const s = sumOf(g.days.filter((d) => daySet.has(d)));
            return [g.label, ...metricCells(s.t, s.revenue), whole(g.days.length)] as XCell[];
          })
        : []),
    ],
    columns: [{ width: 28 }, ...METRIC_WIDTHS.map((width) => ({ width })), { width: 9 }],
  });

  // ---- Theo ngày ----
  sheets.push({
    sheet: "Theo ngày",
    data: [
      [head("Ngày"), head("Thứ"), ...METRIC_HEAD.map(head)],
      ...days.map((day) => [date(day), WEEKDAY_NAMES[weekdayOf(day)], ...metricCells(byDay.get(day) ?? zero(), revenueByDay.get(day) ?? 0)]),
      [bold("Tổng"), "", ...metricCells(all.t, all.revenue)],
    ],
    columns: [{ width: 12 }, { width: 10 }, ...METRIC_WIDTHS.map((width) => ({ width }))],
    stickyRowsCount: 1,
  });

  // ---- Theo tháng (khi kỳ đang xem có nhiều tháng) ----
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  if (months.length > 1) {
    sheets.push({
      sheet: "Theo tháng",
      data: [
        [head("Tháng"), ...METRIC_HEAD.map(head), head("Số ngày")],
        ...months.map((m) => {
          const list = days.filter((d) => d.startsWith(m));
          const s = sumOf(list);
          return [showMonth(m), ...metricCells(s.t, s.revenue), whole(list.length)] as XCell[];
        }),
        [bold("Tổng"), ...metricCells(all.t, all.revenue), whole(days.length)],
      ],
      columns: [{ width: 10 }, ...METRIC_WIDTHS.map((width) => ({ width })), { width: 9 }],
      stickyRowsCount: 1,
    });
  }

  // ---- Theo thứ ----
  sheets.push({
    sheet: "Theo thứ",
    data: [
      [head("Thứ"), ...METRIC_HEAD.map(head), head("Số ngày")],
      ...WEEKDAY_NAMES.map((name, i) => {
        const list = days.filter((d) => weekdayOf(d) === i);
        const s = sumOf(list);
        return [name, ...metricCells(s.t, s.revenue), whole(list.length)] as XCell[];
      }),
    ],
    columns: [{ width: 11 }, ...METRIC_WIDTHS.map((width) => ({ width })), { width: 9 }],
    stickyRowsCount: 1,
  });

  // ---- Theo nhân viên (khi xem tất cả) ----
  if (input.staffId === null) {
    const ids = [
      ...input.staff
        .filter((p) => !p.deleted_at && (p.is_active || byStaff.has(p.id)))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "vi"))
        .map((p) => p.id as string | null),
      ...[...byStaff.keys()].filter((id) => id === null || !input.staff.some((p) => p.id === id && !p.deleted_at)),
    ];
    sheets.push({
      sheet: "Theo nhân viên",
      data: [
        [head("Nhân viên"), head("Trạng thái"), ...METRIC_HEAD.map(head)],
        ...ids.map((id) => {
          const p = input.staff.find((s) => s.id === id);
          return [
            staffName(id),
            id === null ? "" : p?.is_active ? "Đang làm" : "Nghỉ",
            ...metricCells(byStaff.get(id) ?? zero(), id === null ? 0 : (revenueByStaff.get(id) ?? 0)),
          ] as XCell[];
        }),
        [bold("Tổng"), "", ...metricCells(all.t, all.revenue)],
      ],
      columns: [{ width: 26 }, { width: 11 }, ...METRIC_WIDTHS.map((width) => ({ width }))],
      stickyRowsCount: 1,
    });
  }

  // ---- Theo TKQC ----
  const byAccount = new Map<string, { spend: number; messages: number; days: Set<string>; owners: Set<string | null> }>();
  for (const { r, owner } of reportRows) {
    const a = byAccount.get(r.ad_account_id) ?? { spend: 0, messages: 0, days: new Set(), owners: new Set() };
    a.spend += r.spend;
    a.messages += r.messages;
    if (r.spend > 0 || r.messages > 0) a.days.add(r.report_date);
    a.owners.add(owner);
    byAccount.set(r.ad_account_id, a);
  }
  const accountOf = (id: string) => input.accounts.find((a) => a.id === id);
  const accountRows = [...byAccount.entries()].sort((a, b) => b[1].spend - a[1].spend);
  sheets.push({
    sheet: "Theo TKQC",
    data: [
      [head("TKQC"), head("ID TKQC"), head("Người phụ trách"), head("Chi tiêu"), head("Mess"), head("Giá mess"), head("Số ngày chạy")],
      ...accountRows.map(([id, a]) => [
        accountOf(id)?.name ?? "TKQC đã xoá",
        { value: accountOf(id)?.account_id ?? "", type: String },
        [...a.owners].map(staffName).join(", "),
        money(a.spend),
        whole(a.messages),
        ratio(a.spend, a.messages, "#,##0"),
        whole(a.days.size),
      ] as XCell[]),
    ],
    columns: [{ width: 22 }, { width: 18 }, { width: 24 }, { width: 16 }, { width: 9 }, { width: 12 }, { width: 12 }],
    stickyRowsCount: 1,
  });

  // ---- Chi tiết ----
  sheets.push({
    sheet: "Chi tiết TKQC",
    data: [
      [head("Ngày"), head("Nhân viên"), head("TKQC"), head("ID TKQC"), head("Chi tiêu"), head("Mess")],
      ...[...reportRows]
        .sort((a, b) => a.r.report_date.localeCompare(b.r.report_date) || staffName(a.owner).localeCompare(staffName(b.owner), "vi"))
        .map(({ r, owner }) => [
          date(r.report_date),
          staffName(owner),
          accountOf(r.ad_account_id)?.name ?? "TKQC đã xoá",
          { value: accountOf(r.ad_account_id)?.account_id ?? "", type: String },
          money(r.spend),
          whole(r.messages),
        ] as XCell[]),
    ],
    columns: [{ width: 12 }, { width: 22 }, { width: 22 }, { width: 18 }, { width: 14 }, { width: 8 }],
    stickyRowsCount: 1,
  });
  sheets.push({
    sheet: "Chi tiết Data",
    data: [
      [head("Ngày"), head("Nhân viên"), head("Data"), head("Doanh số ngày")],
      ...[...dataRows]
        .sort((a, b) => a.report_date.localeCompare(b.report_date) || staffName(a.ads_staff_id).localeCompare(staffName(b.ads_staff_id), "vi"))
        .map((d) => [date(d.report_date), staffName(d.ads_staff_id), whole(d.data_count), d.revenue === null ? "" : money(d.revenue)] as XCell[]),
    ],
    columns: [{ width: 12 }, { width: 22 }, { width: 8 }, { width: 16 }],
    stickyRowsCount: 1,
  });

  return sheets;
}

/** Tên file: "bao-cao-ads-tong-quan_2026-11-01_2026-11-13.xlsx". */
export function exportFileName(view: string, days: string[]) {
  const slug = view
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const sorted = [...days].sort();
  const span = sorted.length > 0 ? `_${sorted[0]}_${sorted[sorted.length - 1]}` : "";
  return `bao-cao-ads-${slug}${span}.xlsx`;
}

/** "01/11/2026 – 13/11/2026" (một ngày → "13/11/2026"). */
export const daysLabel = (days: string[]) => {
  const sorted = [...days].sort();
  if (sorted.length === 0) return "";
  const [first, last] = [sorted[0], sorted[sorted.length - 1]];
  return first === last ? showDay(first) : `${showDay(first)} – ${showDay(last)}`;
};
