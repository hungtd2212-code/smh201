import {
  endOfDay,
  endOfMonth,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
} from "date-fns";

/** Khoảng ngày đang lọc, tính cả hai đầu. */
export type DayRange = { from: Date; to: Date };

export const dayRange = (day: Date): DayRange => ({
  from: startOfDay(day),
  to: endOfDay(day),
});

export const monthRange = (day: Date): DayRange => ({
  from: startOfMonth(day),
  to: endOfMonth(day),
});

export const isSingleDay = (range: DayRange) => isSameDay(range.from, range.to);

export const isWholeMonth = (range: DayRange) =>
  isSameDay(range.from, startOfMonth(range.from)) &&
  isSameDay(range.to, endOfMonth(range.from));

export const formatDay = (day: Date) => format(day, "dd/MM/yyyy");

export const formatRange = (range: DayRange) =>
  isSingleDay(range)
    ? formatDay(range.from)
    : `${formatDay(range.from)} - ${formatDay(range.to)}`;

/** Khoá tháng dạng "2026-11", dùng cho ô chọn tháng. */
export const monthKey = (day: Date) => format(day, "yyyy-MM");
