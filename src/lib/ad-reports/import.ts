import type { AdAccount, AdAccountAssignment, AdsStaff } from "../catalog/types";

/**
 * Nhập số liệu quảng cáo cũ từ file Excel (.xlsx) — phần đọc và khớp dữ liệu, không gọi máy chủ.
 *
 * File (xem "File mẫu" ở Marketing → Tổng quan → Nhập từ Excel):
 *   • Mỗi tab một nhân viên Ads: ô "Nhân viên Ads:" ghi tên (không có thì lấy tên tab); dòng "ID TKQC:" ghi ID tài
 *     khoản quảng cáo của từng cột; dòng tiêu đề bắt đầu bằng ô "Ngày", sau đó mỗi cột một TKQC (ghi chi tiêu, đồng),
 *     rồi các cột "Mess", "Data", "Doanh số". Mỗi dòng một ngày — giống sheet báo cáo tháng đang dùng.
 *   • Tab "Doanh số tháng": Tháng | Nhân viên Ads | Doanh số. (File cũ ghi "Doanh thu" thay cho "Doanh số" vẫn đọc được.)
 *   • Tab "Hướng dẫn" và các tab không có dòng tiêu đề như trên được bỏ qua.
 *
 * Khớp dữ liệu: TKQC khớp theo ID tài khoản quảng cáo (không có ID thì theo tên); nhân viên khớp theo tên (người
 * dùng chọn được người có sẵn cho một tên trong file). Chỗ chưa khớp trả về `mismatches` kèm gợi ý.
 *
 * Sheet cũ chỉ có tổng mess cả ngày, còn phần mềm ghi mess theo từng TKQC → mess của ngày ghi vào TKQC chi
 * nhiều nhất hôm đó (tổng của từng người vẫn đúng).
 *
 * Mọi ngày dạng yyyy-MM-dd, tháng dạng yyyy-MM.
 */

/** Một ô đọc từ file .xlsx: chữ, số, đúng / sai, ngày hoặc trống. */
export type Cell = string | number | boolean | Date | null;
export type WorkbookSheet = { sheet: string; data: Cell[][] };

export type ImportCatalog = {
  staff: AdsStaff[];
  accounts: AdAccount[];
  assignments: AdAccountAssignment[];
  /** Hôm nay theo giờ Việt Nam (yyyy-MM-dd). */
  today: string;
};

export type ParseOptions = {
  /** Tên nhân viên trong file (khoá `nameKey`) → id nhân viên Ads có sẵn mà người dùng đã chọn. */
  staffMap?: Record<string, string>;
};

/** Lỗi số liệu phải sửa trong file. `row` = số dòng như Excel hiện (bắt đầu từ 1). */
export type ImportIssue = { sheet: string; row: number | null; message: string };

/** Tên nhân viên trong file chưa có trong phần mềm. */
export type StaffMismatch = {
  kind: "staff";
  /** nameKey của tên trong file — dùng làm khoá cho `staffMap`. */
  key: string;
  name: string;
  sheets: string[];
  /** Nhân viên có sẵn có tên gần giống (vd "Dương" → "Dương Ads"). */
  suggestions: { id: string; name: string }[];
};

/** TKQC trong file chưa có trong phần mềm (không thấy ID, hoặc không thấy tên khi file không có ID). */
export type AccountMismatch = {
  kind: "account";
  key: string;
  name: string;
  /** ID tài khoản quảng cáo ghi trong file (null = file không ghi ID). */
  accountNo: string | null;
  staffId: string;
  staffName: string;
  sheets: string[];
  days: string[];
};

/** TKQC có trong phần mềm nhưng ngày đó không do người ở tab này phụ trách. */
export type OwnerMismatch = {
  kind: "owner";
  key: string;
  accountName: string;
  accountNo: string | null;
  staffName: string;
  /** null = ngày đó TKQC chưa có ai phụ trách. */
  ownerName: string | null;
  sheets: string[];
  days: string[];
};

export type Mismatch = StaffMismatch | AccountMismatch | OwnerMismatch;

export type DayRow = {
  sheet: string;
  row: number;
  day: string;
  /** Các TKQC có ghi chi tiêu hôm đó (ô trống = TKQC không chạy). */
  spends: { accountId: string; spend: number }[];
  /** Tổng mess cả ngày (ô trống = 0). */
  messages: number;
  /** Data xin được cả ngày (ô trống = 0). */
  data: number;
  /** Doanh số theo ngày (ô trống = không nhập). */
  revenue: number | null;
};

export type StaffDays = { staff: AdsStaff; sheets: string[]; days: DayRow[] };

export type MonthRow = {
  sheet: string;
  row: number;
  month: string;
  /** null = "Chưa rõ nhân viên". */
  staffId: string | null;
  staffName: string;
  amount: number;
};

export type ParsedWorkbook = {
  people: StaffDays[];
  months: MonthRow[];
  /** Chỗ chưa khớp với phần mềm (nhân viên, TKQC, người phụ trách) — kèm gợi ý cách sửa. */
  mismatches: Mismatch[];
  /** Lỗi số liệu trong file (ngày sai, ô không phải số…). */
  issues: ImportIssue[];
  /** Ghi chú không chặn việc nhập (vd tab bị bỏ qua, TKQC khớp theo ID nhưng khác tên). */
  notes: string[];
  /** Số TKQC trong file đã khớp (theo ID / theo tên). */
  matchedAccounts: { byId: number; byName: number };
  /** Khoảng ngày trong file — để tải số đã có trong phần mềm. null = không có ngày nào. */
  dayRange: { from: string; to: string } | null;
  monthRange: { from: string; to: string } | null;
};

/** Số đã có trong phần mềm: `ngày|TKQC`, `ngày|nhân viên`, `tháng|nhân viên` (nhân viên trống = chưa rõ). */
export type ExistingKeys = { reports: Set<string>; data: Set<string>; revenue: Set<string> };

export type NewReportRow = { report_date: string; ad_account_id: string; spend: number; messages: number };
export type NewDataRow = { report_date: string; ads_staff_id: string; data_count: number; revenue: number | null };
export type NewRevenueRow = { month: string; ads_staff_id: string | null; amount: number };

export type StaffSummary = {
  staffId: string;
  name: string;
  sheets: string[];
  from: string;
  to: string;
  days: number;
  spend: number;
  messages: number;
  data: number;
  revenue: number;
  /** Số ngày sẽ thêm mới / bỏ qua vì đã có. */
  newDays: number;
  existingDays: number;
};

export type ImportPlan = {
  reports: NewReportRow[];
  data: NewDataRow[];
  revenue: NewRevenueRow[];
  skipped: { reports: number; data: number; revenue: number };
  people: StaffSummary[];
  months: (MonthRow & { exists: boolean })[];
};

export const SPEND_MAX = 9_999_999_999_999; // 13 chữ số, như ô nhập ở Nhập liệu
export const COUNT_MAX = 999_999_999; // 9 chữ số
export const REVENUE_MAX = 9_999_999_999_999;

// ---------------------------------------------------------------------------
// Chữ và số
// ---------------------------------------------------------------------------

/** Bỏ dấu, chữ thường, gộp khoảng trắng — chỉ dùng để nhận ra tiêu đề cột cố định và gợi ý tên gần giống. */
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[:*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Khoá so tên người / TKQC: GIỮ dấu (Hưng ≠ Hùng), không phân biệt hoa thường và khoảng trắng thừa. */
export const nameKey = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

const cellText = (cell: Cell) =>
  cell === null ? "" : cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell).trim();

const isBlank = (cell: Cell | undefined) => cell === null || cell === undefined || cellText(cell) === "";

/** "A", "B", …, "Z", "AA" — tên cột như Excel. */
export function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * Đọc một ô số: 1526706, "1.526.706", "1,526,706", "1.526.706 đ". Trống hoặc "-" → null. Không đọc được → "bad".
 * Số âm / số lẻ trả nguyên để nơi gọi báo lỗi cho rõ.
 */
export function toNumber(cell: Cell | undefined): number | null | "bad" {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : "bad";
  if (typeof cell !== "string") return "bad";
  let text = cell.replace(/[\s ]/g, "").replace(/(đ|₫|vnđ|vnd)$/i, "");
  if (text === "" || text === "-") return null;
  const negative = text.startsWith("-");
  if (negative) text = text.slice(1);
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  else if (/^\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, "");
  if (!/^\d+$/.test(text)) return "bad";
  return negative ? -Number(text) : Number(text);
}

/**
 * ID tài khoản quảng cáo như phần mềm lưu: chỉ chữ số (5–30 số), bỏ khoảng trắng và tiền tố "act_" (giống
 * add_ad_account). Trống → null. Sai → "bad".
 */
export function toAccountNo(cell: Cell | undefined): string | null | "bad" {
  if (isBlank(cell ?? null)) return null;
  let text: string;
  if (typeof cell === "number") {
    if (!Number.isFinite(cell) || cell < 0 || !Number.isInteger(cell)) return "bad";
    text = Number.isSafeInteger(cell) ? String(cell) : cell.toFixed(0);
  } else if (typeof cell === "string") {
    text = cell.toLowerCase().replace(/[\s '’]/g, "").replace(/^act_/, "");
  } else return "bad";
  return /^\d{5,30}$/.test(text) ? text : "bad";
}

const pad = (n: number) => String(n).padStart(2, "0");

function validDay(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100
    ? `${y}-${pad(m)}-${pad(d)}`
    : null;
}

/** Số ngày kiểu Excel (1 = 01/01/1900) → Date. Chỉ nhận khoảng năm 2000–2100. */
const fromSerial = (serial: number) =>
  serial >= 36526 && serial <= 73051 ? new Date(Math.round((serial - 25569) * 86_400_000)) : null;

/** Đọc ô ngày: ô ngày của Excel, "01/10/2026", "1/10/2026", "2026-10-01". Trống → null. Không đọc được → "bad". */
export function toDay(cell: Cell | undefined): string | null | "bad" {
  if (isBlank(cell ?? null)) return null;
  let date: Date | null = null;
  if (cell instanceof Date) date = cell;
  else if (typeof cell === "number") date = fromSerial(cell);
  if (date) {
    if (Number.isNaN(date.getTime())) return "bad";
    return validDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) ?? "bad";
  }
  if (typeof cell !== "string") return "bad";
  const text = cell.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return validDay(Number(m[3]), Number(m[2]), Number(m[1])) ?? "bad";
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3])) ?? "bad";
  return "bad";
}

/** Đọc ô tháng: "10/2026", "T10/2026", "Tháng 10/2026", "2026-10", ô ngày của Excel. */
export function toMonth(cell: Cell | undefined): string | null | "bad" {
  if (isBlank(cell ?? null)) return null;
  if (cell instanceof Date || typeof cell === "number") {
    const day = toDay(cell);
    return day === null || day === "bad" ? "bad" : day.slice(0, 7);
  }
  if (typeof cell !== "string") return "bad";
  const text = fold(cell).replace(/^(thang|t)\s*/, "");
  let m = /^(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec(text);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${pad(Number(m[1]))}`;
  m = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${pad(Number(m[2]))}`;
  const day = toDay(cell);
  return day === null || day === "bad" ? "bad" : day.slice(0, 7);
}

/** "2026-10-05" → "05/10/2026". */
export const showDay = (day: string) => day.split("-").reverse().join("/");
/** "2026-10" → "10/2026". */
export const showMonth = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

/** Gộp các ngày liền nhau: "01/10/2026 – 05/10/2026, 07/10/2026". */
export function dayRanges(days: string[]) {
  const sorted = [...new Set(days)].sort();
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  const next = (day: string) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  for (const day of [...sorted.slice(1), null]) {
    if (day !== null && day === next(prev)) {
      prev = day;
      continue;
    }
    if (start) parts.push(start === prev ? showDay(start) : `${showDay(start)} – ${showDay(prev)}`);
    if (day !== null) start = prev = day;
  }
  return parts.join(", ");
}

// Từ không mang nghĩa khi so tên gần giống: "A Hưng", "Dương Ads", "C Hằng"…
const NAME_STOP = new Set(["ads", "ad", "a", "anh", "c", "chi", "e", "em", "mkt", "nv", "marketing"]);
const nameTokens = (name: string) => fold(name).split(/[^a-z0-9]+/).filter((t) => t !== "" && !NAME_STOP.has(t));

/** Nhân viên có sẵn có tên gần giống `name` (chung ít nhất một chữ, không kể dấu), tối đa 3 người. */
export function similarStaff(name: string, staff: AdsStaff[]) {
  const wanted = nameTokens(name);
  if (wanted.length === 0) return [];
  return staff
    .filter((p) => !p.deleted_at)
    .map((p) => ({ p, score: nameTokens(p.full_name).filter((t) => wanted.includes(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.full_name.localeCompare(b.p.full_name, "vi"))
    .slice(0, 3)
    .map(({ p }) => ({ id: p.id, name: p.full_name }));
}

// ---------------------------------------------------------------------------
// Đọc và khớp file
// ---------------------------------------------------------------------------

type Role = "day" | "messages" | "data" | "revenue" | "ignore" | "account";

const MESSAGE_HEADERS = ["mess", "tong mess", "so mess", "tin nhan", "so tin nhan", "so luong tin nhan", "tong tin nhan"];
const DATA_HEADERS = ["data", "data xin duoc", "so data", "tong data"];
const REVENUE_HEADERS = ["doanh thu", "doanh thu theo ngay", "doanh thu ngay"];
// Cột "Doanh thu theo ngày" đã đổi tên thành "Doanh số theo ngày" (file mẫu mới ghi "Doanh số"). Sheet cũ có cả cột
// "Doanh số" tính sẵn bên cạnh cột "Doanh thu" → tab có cột "Doanh thu" thì vẫn đọc cột đó và bỏ qua "Doanh số" như
// trước; tab không có cột "Doanh thu" thì đọc cột "Doanh số".
const SALES_HEADERS = ["doanh so", "doanh so theo ngay", "doanh so ngay"];
const MONTH_TABS = ["doanh so thang", "doanh thu thang"];
const MONTH_AMOUNT_HEADERS = ["doanh so", "doanh so thang", "doanh thu", "doanh thu thang"];
// Cột tính sẵn trong sheet cũ (tổng, giá, tỉ lệ…) → bỏ qua, phần mềm tự tính lại.
const IGNORED = /^(tong |gia |ti le|ty le|doanh so|chi tieu|ghi chu|ho va ten|ho ten|ma nhan vien|nhan vien|ads ?\/)/;
const ID_ROW_LABELS = ["id tkqc", "id tk qc", "id tai khoan", "id tai khoan quang cao", "id tk ads", "id"];

/** Vai trò của một cột theo chữ ở dòng tiêu đề. Còn lại là tên TKQC. */
export function columnRole(header: Cell | undefined): Role {
  const h = fold(cellText(header ?? null));
  if (h === "") return "ignore";
  if (h === "ngay") return "day";
  if (MESSAGE_HEADERS.includes(h)) return "messages";
  if (DATA_HEADERS.includes(h)) return "data";
  if (REVENUE_HEADERS.includes(h)) return "revenue";
  if (h === "thu" || h === "stt" || h === "tuan" || IGNORED.test(`${h} `)) return "ignore";
  return "account";
}

const firstFilled = (row: Cell[] | undefined) => (row ?? []).findIndex((cell) => !isBlank(cell));

/** Dòng (trong 20 dòng đầu) có ô đầu tiên khác trống thuộc `words` (bỏ dấu). -1 = không có. */
function rowStartingWith(data: Cell[][], words: string[], before = 20) {
  for (let r = 0; r < Math.min(data.length, before); r++) {
    const c = firstFilled(data[r]);
    if (c >= 0 && words.includes(fold(cellText(data[r][c])))) return r;
  }
  return -1;
}

/** Tên nhân viên ghi ở ô sau "Nhân viên Ads:" phía trên dòng tiêu đề. */
function staffNameAbove(data: Cell[][], header: number) {
  const r = rowStartingWith(data, ["nhan vien ads", "nhan vien"], header);
  if (r < 0) return null;
  const row = data[r] ?? [];
  const name = row.slice(firstFilled(row) + 1).find((cell) => !isBlank(cell));
  return name === undefined ? null : cellText(name);
}

/** Excel không cho tên tab có [ ] : * ? / \ và dài quá 31 ký tự. */
export const safeSheetName = (name: string) => name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);

/** TKQC của một cột: đã khớp, chưa có trong phần mềm, hoặc ID sai. */
type ColumnAccount =
  | { status: "ok"; account: AdAccount }
  | { status: "missing"; name: string; accountNo: string | null }
  | { status: "bad" };

export function parseWorkbook(sheets: WorkbookSheet[], catalog: ImportCatalog, options: ParseOptions = {}): ParsedWorkbook {
  const issues: ImportIssue[] = [];
  const notes: string[] = [];
  const liveStaff = catalog.staff.filter((s) => !s.deleted_at);
  const staffByName = new Map(liveStaff.map((p) => [nameKey(p.full_name), p]));
  const liveAccounts = catalog.accounts.filter((a) => !a.deleted_at);
  const accountByName = new Map(liveAccounts.map((a) => [nameKey(a.name), a]));
  const accountByNo = new Map(liveAccounts.flatMap((a) => (a.account_id ? [[a.account_id, a] as const] : [])));
  const assignments = catalog.assignments.filter((x) => !x.deleted_at);
  const ownerOn = (accountId: string, day: string) =>
    assignments.find((x) => x.ad_account_id === accountId && x.from_date <= day && (!x.to_date || x.to_date >= day))
      ?.ads_staff_id ?? null;
  const staffName = (id: string) => catalog.staff.find((s) => s.id === id)?.full_name ?? "người khác";

  const staffMismatches = new Map<string, StaffMismatch>();
  const accountMismatches = new Map<string, AccountMismatch>();
  const ownerMismatches = new Map<string, OwnerMismatch>();
  const matched = { byId: new Set<string>(), byName: new Set<string>() };
  const addSheet = (list: string[], sheet: string) => {
    if (!list.includes(sheet)) list.push(sheet);
  };

  /** Nhân viên Ads của một tên trong file: người dùng đã chọn → đúng tên → chưa khớp (ghi gợi ý). */
  const findStaff = (sheet: string, name: string) => {
    const key = nameKey(name);
    const mapped = options.staffMap?.[key];
    const person = (mapped ? liveStaff.find((s) => s.id === mapped) : undefined) ?? staffByName.get(key);
    if (person) return person;
    const entry = staffMismatches.get(key) ?? { kind: "staff", key, name, sheets: [], suggestions: similarStaff(name, liveStaff) };
    addSheet(entry.sheets, sheet);
    staffMismatches.set(key, entry);
    return null;
  };

  const people = new Map<string, StaffDays>();
  const seenDay = new Map<string, { sheet: string; row: number }>();
  const months: MonthRow[] = [];
  const seenMonth = new Map<string, { sheet: string; row: number }>();

  for (const { sheet, data } of sheets) {
    const name = fold(sheet);
    if (name.startsWith("huong dan")) continue;

    // ---- Tab "Doanh số tháng" (file cũ: "Doanh thu tháng") ----
    if (MONTH_TABS.some((tab) => name.includes(tab))) {
      const header = rowStartingWith(data, ["thang"]);
      if (header < 0) {
        notes.push(`Bỏ qua tab "${sheet}": không thấy dòng tiêu đề bắt đầu bằng ô "Tháng".`);
        continue;
      }
      const roles = (data[header] ?? []).map((cell) => fold(cellText(cell)));
      const monthCol = roles.indexOf("thang");
      const staffCol = roles.findIndex((h) => h === "nhan vien ads" || h === "nhan vien");
      const amountCol = roles.findIndex((h) => MONTH_AMOUNT_HEADERS.includes(h));
      if (staffCol < 0 || amountCol < 0) {
        issues.push({ sheet, row: header + 1, message: 'Cần đủ 3 cột "Tháng", "Nhân viên Ads", "Doanh số"' });
        continue;
      }
      for (let r = header + 1; r < data.length; r++) {
        const row = data[r] ?? [];
        const rowNo = r + 1;
        const amount = toNumber(row[amountCol]);
        const month = toMonth(row[monthCol]);
        const who = cellText(row[staffCol] ?? null);
        if (amount === null || amount === 0) continue; // trống / 0 = dùng doanh số theo ngày
        if (amount === "bad" || amount < 0 || !Number.isInteger(amount) || amount > REVENUE_MAX) {
          issues.push({ sheet, row: rowNo, message: `Doanh số "${cellText(row[amountCol] ?? null)}" không phải số tiền hợp lệ` });
          continue;
        }
        if (month === null || month === "bad") {
          issues.push({ sheet, row: rowNo, message: `Tháng "${cellText(row[monthCol] ?? null)}" không đọc được — ghi dạng 10/2026` });
          continue;
        }
        if (month > catalog.today.slice(0, 7)) {
          issues.push({ sheet, row: rowNo, message: `Tháng ${showMonth(month)} chưa tới` });
          continue;
        }
        const unassigned = who === "" || ["chua ro", "chua ro nhan vien"].includes(fold(who));
        const person = unassigned ? null : findStaff(sheet, who);
        if (!unassigned && !person) continue;
        const key = `${month}|${person?.id ?? ""}`;
        const before = seenMonth.get(key);
        if (before) {
          issues.push({
            sheet,
            row: rowNo,
            message: `Doanh số tháng ${showMonth(month)} của ${person?.full_name ?? "Chưa rõ nhân viên"} bị ghi hai lần (tab "${before.sheet}" dòng ${before.row})`,
          });
          continue;
        }
        seenMonth.set(key, { sheet, row: rowNo });
        months.push({ sheet, row: rowNo, month, staffId: person?.id ?? null, staffName: person?.full_name ?? "Chưa rõ nhân viên", amount });
      }
      continue;
    }

    // ---- Tab của một nhân viên Ads ----
    const header = rowStartingWith(data, ["ngay"]);
    if (header < 0) {
      notes.push(`Bỏ qua tab "${sheet}": không thấy dòng tiêu đề bắt đầu bằng ô "Ngày" (dùng đúng file mẫu).`);
      continue;
    }
    const titles = data[header] ?? [];
    const roles = titles.map(columnRole);
    const dayCol = roles.indexOf("day");
    const messagesCol = roles.indexOf("messages");
    const dataCol = roles.indexOf("data");
    const revenueCol = roles.includes("revenue")
      ? roles.indexOf("revenue")
      : titles.findIndex((title) => SALES_HEADERS.includes(fold(cellText(title ?? null))));
    const accountCols = roles.flatMap((role, c) => (role === "account" ? [c] : []));
    const staff = findStaff(sheet, staffNameAbove(data, header) ?? sheet);
    if (!staff) continue; // khớp nhân viên trước, rồi mới kiểm tra được TKQC của người đó
    if (messagesCol < 0) notes.push(`Tab "${sheet}" không có cột "Mess" — mess được tính là 0.`);
    if (dataCol < 0) notes.push(`Tab "${sheet}" không có cột "Data" — data được tính là 0.`);

    const person = people.get(staff.id) ?? { staff, sheets: [], days: [] };
    addSheet(person.sheets, sheet);
    people.set(staff.id, person);

    // TKQC của từng cột: theo ID ở dòng "ID TKQC" (nếu có), không có ID thì theo tên ở dòng tiêu đề.
    const idRowIndex = rowStartingWith(data, ID_ROW_LABELS, header);
    const idRow = idRowIndex >= 0 ? (data[idRowIndex] ?? []) : [];
    const columnAccount = new Map<number, ColumnAccount>();
    const usedBy = new Map<string, number>();
    for (const c of accountCols) {
      const title = cellText(titles[c] ?? null);
      const no = toAccountNo(idRow[c]);
      let found: AdAccount | undefined;
      if (no === "bad") {
        // Chỉ báo khi cột có số (cột trống không nhập gì).
        columnAccount.set(c, { status: "bad" });
        if (data.slice(header + 1).some((row) => toNumber(row?.[c]) !== null)) {
          issues.push({
            sheet,
            row: idRowIndex + 1,
            message: `Ô ${columnName(c)}${idRowIndex + 1}: ID TKQC "${cellText(idRow[c] ?? null)}" không hợp lệ — ID chỉ gồm chữ số, vd 123456789012345`,
          });
        }
        continue;
      }
      if (no) {
        found = accountByNo.get(no);
        if (found) {
          matched.byId.add(found.id);
          if (nameKey(found.name) !== nameKey(title)) {
            notes.push(`Tab "${sheet}", cột "${title}": khớp theo ID ${no} với TKQC "${found.name}" trong phần mềm.`);
          }
        }
      } else {
        found = accountByName.get(nameKey(title));
        if (found) matched.byName.add(found.id);
      }
      if (!found) {
        columnAccount.set(c, { status: "missing", name: title, accountNo: no });
        continue;
      }
      const other = usedBy.get(found.id);
      if (other !== undefined) {
        issues.push({ sheet, row: header + 1, message: `Cột ${columnName(other)} và cột ${columnName(c)} cùng là TKQC "${found.name}"` });
        columnAccount.set(c, { status: "bad" });
        continue;
      }
      usedBy.set(found.id, c);
      columnAccount.set(c, { status: "ok", account: found });
    }

    for (let r = header + 1; r < data.length; r++) {
      const row = data[r] ?? [];
      const rowNo = r + 1;
      const filled = [...accountCols, messagesCol, dataCol, revenueCol].some((c) => c >= 0 && toNumber(row[c]) !== null);
      const dayCell = row[dayCol] ?? null;
      if (typeof dayCell === "string" && fold(dayCell).startsWith("tong")) continue; // dòng tổng của sheet cũ
      const day = toDay(dayCell);
      if (!filled) continue;
      if (day === null) {
        issues.push({ sheet, row: rowNo, message: "Dòng có số nhưng thiếu ngày" });
        continue;
      }
      if (day === "bad") {
        issues.push({ sheet, row: rowNo, message: `Ngày "${cellText(dayCell)}" không đọc được — ghi dạng ngày/tháng/năm, vd 01/10/2026` });
        continue;
      }
      if (day > catalog.today) {
        issues.push({ sheet, row: rowNo, message: `Ngày ${showDay(day)} chưa tới` });
        continue;
      }
      const dupKey = `${staff.id}|${day}`;
      const before = seenDay.get(dupKey);
      if (before) {
        issues.push({
          sheet,
          row: rowNo,
          message: `Ngày ${showDay(day)} của ${staff.full_name} bị ghi hai lần (tab "${before.sheet}" dòng ${before.row})`,
        });
        continue;
      }
      seenDay.set(dupKey, { sheet, row: rowNo });

      let ok = true;
      const number = (c: number, label: string, max: number, whole: boolean) => {
        if (c < 0) return null;
        const value = toNumber(row[c]);
        if (value === null) return null;
        const where = `Ô ${columnName(c)}${rowNo} (${label})`;
        if (value === "bad") {
          issues.push({ sheet, row: rowNo, message: `${where} không phải số: "${cellText(row[c] ?? null)}"` });
          ok = false;
          return null;
        }
        if (value < 0) {
          issues.push({ sheet, row: rowNo, message: `${where} là số âm` });
          ok = false;
          return null;
        }
        if (whole && !Number.isInteger(value)) {
          issues.push({ sheet, row: rowNo, message: `${where} phải là số nguyên` });
          ok = false;
          return null;
        }
        const rounded = Math.round(value);
        if (rounded > max) {
          issues.push({ sheet, row: rowNo, message: `${where} lớn quá` });
          ok = false;
          return null;
        }
        return rounded;
      };

      const spends: DayRow["spends"] = [];
      for (const c of accountCols) {
        if (toNumber(row[c]) === null) continue;
        const col = columnAccount.get(c);
        if (!col || col.status === "bad") {
          ok = false;
          continue;
        }
        if (col.status === "missing") {
          const key = `${col.accountNo ?? nameKey(col.name)}|${staff.id}`;
          const entry = accountMismatches.get(key) ?? {
            kind: "account",
            key,
            name: col.name,
            accountNo: col.accountNo,
            staffId: staff.id,
            staffName: staff.full_name,
            sheets: [],
            days: [],
          };
          addSheet(entry.sheets, sheet);
          entry.days.push(day);
          accountMismatches.set(key, entry);
          ok = false;
          continue;
        }
        const { account } = col;
        const spend = number(c, `chi tiêu ${account.name}`, SPEND_MAX, false);
        if (spend === null) continue;
        const owner = ownerOn(account.id, day);
        if (owner !== staff.id) {
          const key = `${account.id}|${staff.id}|${owner ?? ""}`;
          const entry = ownerMismatches.get(key) ?? {
            kind: "owner",
            key,
            accountName: account.name,
            accountNo: account.account_id,
            staffName: staff.full_name,
            ownerName: owner === null ? null : staffName(owner),
            sheets: [],
            days: [],
          };
          addSheet(entry.sheets, sheet);
          entry.days.push(day);
          ownerMismatches.set(key, entry);
          ok = false;
          continue;
        }
        spends.push({ accountId: account.id, spend });
      }
      const messages = number(messagesCol, "Mess", COUNT_MAX, true) ?? 0;
      const dataCount = number(dataCol, "Data", COUNT_MAX, true) ?? 0;
      const revenue = number(revenueCol, "Doanh số", REVENUE_MAX, false);
      if (ok && messages > 0 && spends.length === 0) {
        issues.push({ sheet, row: rowNo, message: `Ngày ${showDay(day)} có mess nhưng không TKQC nào có chi tiêu` });
        ok = false;
      }
      if (ok) person.days.push({ sheet, row: rowNo, day, spends, messages, data: dataCount, revenue });
    }
  }

  const list = [...people.values()].filter((p) => p.days.length > 0);
  const blocked = new Set([
    ...issues.map((i) => i.sheet),
    ...[...accountMismatches.values(), ...ownerMismatches.values()].flatMap((m) => m.sheets),
  ]);
  for (const p of people.values()) {
    if (p.days.length === 0 && !p.sheets.some((s) => blocked.has(s))) {
      notes.push(`Tab "${p.sheets.join('", "')}" của ${p.staff.full_name} chưa có số nào.`);
    }
  }
  const allDays = list.flatMap((p) => p.days.map((d) => d.day)).sort();
  const allMonths = months.map((m) => m.month).sort();
  return {
    people: list,
    months,
    mismatches: [...staffMismatches.values(), ...accountMismatches.values(), ...ownerMismatches.values()],
    issues,
    notes,
    matchedAccounts: { byId: matched.byId.size, byName: [...matched.byName].filter((id) => !matched.byId.has(id)).length },
    dayRange: allDays.length > 0 ? { from: allDays[0], to: allDays[allDays.length - 1] } : null,
    monthRange: allMonths.length > 0 ? { from: allMonths[0], to: allMonths[allMonths.length - 1] } : null,
  };
}

/** Đã khớp hết (không còn chỗ chưa khớp, không còn lỗi số liệu) → được tải lên. */
export const isMatched = (parsed: ParsedWorkbook) => parsed.mismatches.length === 0 && parsed.issues.length === 0;

// ---------------------------------------------------------------------------
// Tính trước những gì sẽ thêm
// ---------------------------------------------------------------------------

export const reportKey = (day: string, accountId: string) => `${day}|${accountId}`;
export const dataKey = (day: string, staffId: string) => `${day}|${staffId}`;
export const revenueKey = (month: string, staffId: string | null) => `${month}|${staffId ?? ""}`;

/**
 * Các dòng sẽ thêm. Số đã có trong phần mềm (cùng ngày + TKQC, cùng ngày + người, cùng tháng + người) được giữ
 * nguyên — không ghi đè. Mess cả ngày ghi vào TKQC chi nhiều nhất hôm đó (bằng nhau thì TKQC đứng trước).
 */
export function planImport(parsed: ParsedWorkbook, existing: ExistingKeys): ImportPlan {
  const reports: NewReportRow[] = [];
  const data: NewDataRow[] = [];
  const revenue: NewRevenueRow[] = [];
  const skipped = { reports: 0, data: 0, revenue: 0 };
  const people: StaffSummary[] = [];

  for (const { staff, sheets, days } of parsed.people) {
    const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
    const summary: StaffSummary = {
      staffId: staff.id,
      name: staff.full_name,
      sheets,
      from: sorted[0].day,
      to: sorted[sorted.length - 1].day,
      days: sorted.length,
      spend: 0,
      messages: 0,
      data: 0,
      revenue: 0,
      newDays: 0,
      existingDays: 0,
    };
    for (const d of sorted) {
      summary.spend += d.spends.reduce((s, x) => s + x.spend, 0);
      summary.messages += d.messages;
      summary.data += d.data;
      summary.revenue += d.revenue ?? 0;
      let top = d.spends[0];
      for (const x of d.spends) if (x.spend > top.spend) top = x;
      let fresh = false;
      for (const x of d.spends) {
        if (existing.reports.has(reportKey(d.day, x.accountId))) {
          skipped.reports++;
          continue;
        }
        reports.push({ report_date: d.day, ad_account_id: x.accountId, spend: x.spend, messages: x === top ? d.messages : 0 });
        fresh = true;
      }
      if (existing.data.has(dataKey(d.day, staff.id))) skipped.data++;
      else {
        data.push({ report_date: d.day, ads_staff_id: staff.id, data_count: d.data, revenue: d.revenue });
        fresh = true;
      }
      if (fresh) summary.newDays++;
      else summary.existingDays++;
    }
    people.push(summary);
  }

  const months = parsed.months.map((m) => {
    const exists = existing.revenue.has(revenueKey(m.month, m.staffId));
    if (exists) skipped.revenue++;
    else revenue.push({ month: `${m.month}-01`, ads_staff_id: m.staffId, amount: m.amount });
    return { ...m, exists };
  });

  people.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  months.sort((a, b) => a.month.localeCompare(b.month) || a.staffName.localeCompare(b.staffName, "vi"));
  return { reports, data, revenue, skipped, people, months };
}

// ---------------------------------------------------------------------------
// File mẫu
// ---------------------------------------------------------------------------

export type TemplateCell =
  | string
  | null
  | { value: string; type?: StringConstructor; fontWeight?: "bold"; backgroundColor?: string; textColor?: string };
export type TemplateSheet = { sheet: string; data: TemplateCell[][]; columns: { width: number }[]; stickyRowsCount?: number };

const bold = (value: string) => ({ value, fontWeight: "bold" as const });
const text = (value: string) => ({ value, type: String });

/**
 * Nội dung file mẫu của một tháng (yyyy-MM): tab Hướng dẫn, mỗi nhân viên Ads một tab (dòng ID TKQC, dòng tiêu đề
 * Ngày | các TKQC | Mess | Data | Doanh số, mỗi ngày đã qua một dòng), tab Doanh số tháng. Ngày và ID ghi dạng
 * chữ để Excel / Google Sheet không tự đổi kiểu hay làm tròn số dài.
 */
export function templateSheets(month: string, catalog: ImportCatalog): TemplateSheet[] {
  const label = showMonth(month);
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    if (`${month}-${pad(d)}` <= catalog.today) days.push(`${pad(d)}/${pad(mon)}/${year}`);
  }
  const guide = [
    `NHẬP SỐ LIỆU QUẢNG CÁO CŨ — FILE MẪU THÁNG ${label}`,
    "",
    "1. Mỗi tab là một nhân viên Ads. Tên ở ô B1 phải đúng tên trong phần mềm (Marketing → Nhân viên Ads) — chưa đúng thì bước Khớp dữ liệu sẽ gợi ý.",
    "2. Dòng \"ID TKQC\": ID tài khoản quảng cáo của từng cột. Phần mềm khớp TKQC theo ID này (ô ID trống thì khớp theo tên cột).",
    "   Thêm cột TKQC mới: ghi tên ở dòng tiêu đề và ID ở dòng ID TKQC. Ghi ID dạng chữ (gõ dấu ' phía trước) để Excel không làm tròn số dài.",
    "3. Mỗi dòng là một ngày. Cột TKQC: ghi số tiền đã chi của TKQC đó (đồng). Ô trống = TKQC không chạy hôm đó.",
    "4. Mess: tổng mess cả ngày — phần mềm ghi vào TKQC chi nhiều nhất hôm đó. Data: data xin được cả ngày. Doanh số: không bắt buộc.",
    "5. Dán số dạng 1.526.706 hay 1526706 đều được. Ngày ghi dạng ngày/tháng/năm, vd 01/10/2026.",
    "6. Ngày đã có số trong phần mềm được giữ nguyên, không bị ghi đè.",
    '7. Tab "Doanh số tháng": chỉ điền khi có doanh số cả tháng của từng người. Để trống thì phần mềm cộng "Doanh số theo ngày".',
    "8. Thêm được tab cho tháng khác (giữ dòng ID TKQC và dòng tiêu đề bắt đầu bằng ô Ngày).",
    "9. Lưu dạng .xlsx (Google Sheet: Tệp → Tải xuống → Microsoft Excel). Ở phần mềm: chọn file → Khớp dữ liệu → Tải lên.",
  ];
  const sheets: TemplateSheet[] = [
    { sheet: "Hướng dẫn", data: guide.map((line, i) => [i === 0 ? bold(line) : line]), columns: [{ width: 130 }] },
  ];
  const used = new Set(["hướng dẫn", "doanh số tháng"]);
  const tabs = templateTabs(month, catalog);
  const head = (title: string) => ({ ...bold(title), backgroundColor: "#E8F1FB" });
  for (const { staff, accounts } of tabs) {
    const base = safeSheetName(staff.full_name) || "Nhân viên";
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 26)} (${n})`;
    used.add(name.toLowerCase());
    sheets.push({
      sheet: name,
      data: [
        [bold("Nhân viên Ads:"), bold(staff.full_name)],
        ["Tháng:", text(label)],
        [{ value: "Cột TKQC: số tiền đã chi (đồng). Mess, Data: cả ngày. Doanh số: không bắt buộc. Ô trống = không có số.", textColor: "#666666" }],
        [{ value: "ID TKQC:", textColor: "#666666" }, ...accounts.map((a) => ({ value: a.account_id ?? "", type: String, textColor: "#666666" }))],
        [head("Ngày"), ...accounts.map((a) => head(a.name)), head("Mess"), head("Data"), head("Doanh số")],
        ...days.map((day) => [text(day)]),
      ],
      columns: [{ width: 13 }, ...accounts.map(() => ({ width: 20 })), { width: 9 }, { width: 9 }, { width: 16 }],
      stickyRowsCount: 5,
    });
  }
  sheets.push({
    sheet: "Doanh số tháng",
    data: [
      ["Tháng", "Nhân viên Ads", "Doanh số"].map(bold),
      ...tabs.map(({ staff }) => [text(label), staff.full_name, null]),
      [text(label), "Chưa rõ nhân viên", null],
    ],
    columns: [{ width: 10 }, { width: 26 }, { width: 18 }],
    stickyRowsCount: 1,
  });
  return sheets;
}

export type TemplateTab = { staff: AdsStaff; accounts: AdAccount[] };

/**
 * Các tab của file mẫu cho một tháng: mỗi nhân viên Ads đang làm (hoặc có phụ trách TKQC trong tháng đó) một tab,
 * cột là các TKQC người đó phụ trách trong tháng (theo thứ tự tạo TKQC).
 */
export function templateTabs(month: string, catalog: ImportCatalog): TemplateTab[] {
  const from = `${month}-01`;
  const to = `${month}-31`;
  const live = catalog.assignments.filter((x) => !x.deleted_at && x.from_date <= to && (!x.to_date || x.to_date >= from));
  const accounts = [...catalog.accounts]
    .filter((a) => !a.deleted_at)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  return catalog.staff
    .filter((p) => !p.deleted_at && (p.is_active || live.some((x) => x.ads_staff_id === p.id)))
    .map((staff) => ({
      staff,
      accounts: accounts.filter((a) => live.some((x) => x.ad_account_id === a.id && x.ads_staff_id === staff.id)),
    }))
    .sort((a, b) => a.staff.full_name.localeCompare(b.staff.full_name, "vi"));
}
