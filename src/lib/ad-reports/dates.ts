import { format } from "date-fns";
import { EDIT_WINDOW_MS } from "./types";

/** Một thứ đã gửi (báo cáo TKQC hoặc dòng Data xin được chung): có mốc gửi lần đầu và lần sửa gần nhất. */
type Sent = { submitted_at: string; updated_at: string };

/** Ngày giờ cho các màn báo cáo ads. Mọi ngày dạng yyyy-MM-dd, tính theo giờ Việt Nam. */

/** addDays("2026-11-01", -1) → "2026-10-31". Chuỗi rỗng giữ nguyên. */
export function addDays(iso: string, days: number) {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "2026-11-11" → Date 11/11/2026 0:00 theo giờ máy (cho ô lịch). */
export function isoToDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Date (từ ô lịch) → "yyyy-MM-dd". */
export const dateToIso = (date: Date) => format(date, "yyyy-MM-dd");

/** Các ngày từ `to` lùi về `from` (mới nhất trước). */
export function daysDesc(from: string, to: string) {
  const days: string[] = [];
  for (let day = to; day && day >= from; day = addDays(day, -1)) days.push(day);
  return days;
}

/** "yyyy-MM-dd" → "dd/MM/yyyy" */
export const formatDay = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");

const clock = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const vnDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });

/**
 * Giờ của một mốc thời gian: "09:15" nếu là hôm nay; ngày khác thì "09:15 ngày 10/11/2026"
 * (`short`: "09:15 · 10/11" — cho cột bảng).
 */
export function formatClock(iso: string, today: string, short = false) {
  const date = new Date(iso);
  const time = clock.format(date);
  const day = vnDay.format(date);
  if (day === today) return time;
  if (short) return `${time} · ${day.slice(8, 10)}/${day.slice(5, 7)}${day.slice(0, 4) === today.slice(0, 4) ? "" : `/${day.slice(0, 4)}`}`;
  return `${time} ngày ${formatDay(day)}`;
}

/** Hạn chót nhân viên còn sửa được báo cáo (mili-giây). */
export const editDeadline = (sent: Sent) => Date.parse(sent.submitted_at) + EDIT_WINDOW_MS;

/** Báo cáo đã từng được sửa số chưa (lúc gửi, hai mốc giờ bằng nhau). */
export const wasEdited = (sent: Sent) => Date.parse(sent.updated_at) - Date.parse(sent.submitted_at) > 1000;

/** 18_720_000 → "5 giờ 12 phút" */
export function durationText(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "dưới 1 phút";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} phút`;
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest} phút`;
}
