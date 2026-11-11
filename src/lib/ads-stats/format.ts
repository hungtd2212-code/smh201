/** Cách hiện số trong các bảng số liệu ads. Phép chia cho 0 (giá trị null) hiện "–". */

export const DASH = "–";

/** 1234567 → "1.234.567" (làm tròn tới đơn vị). */
export const formatNumber = (value: number | null) =>
  value === null ? DASH : Math.round(value).toLocaleString("vi-VN");

/** 1234567 → "1.234.567đ" */
export const formatMoney = (value: number | null) => (value === null ? DASH : `${formatNumber(value)}đ`);

/** 0.3299 → "32,99%" */
export const formatPercent = (value: number | null) =>
  value === null
    ? DASH
    : `${(value * 100).toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/** "2026-10" → "Tháng 10/2026" */
export const monthLabel = (month: string) => `Tháng ${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

/** "2026-10-05" → "05/10" */
export const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** "2026-10-05" → "T2" */
export const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
