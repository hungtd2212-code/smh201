import {
  LEAD_STATUSES,
  NOT_RECEIVED_STATUSES,
  type LeadStatusKey,
} from "./status";
import type { Lead } from "./types";

export type StatusCount = {
  key: LeadStatusKey;
  label: string;
  color: string;
  count: number;
  /** Phần trăm trên tổng số lead (0–100). */
  percent: number;
};

export type LeadStats = {
  /** Tổng số lead trong kỳ */
  total: number;
  /** Số sale thực nhận = tổng − số trùng − số huỷ */
  received: number;
  /** Số lead đã có lịch hẹn */
  appointments: number;
  /** Số lead ở trạng thái Tiềm năng */
  potential: number;
  byStatus: StatusCount[];
};

export function computeLeadStats(leads: Lead[]): LeadStats {
  const counts = new Map<string, number>();
  let appointments = 0;

  for (const lead of leads) {
    counts.set(lead.status, (counts.get(lead.status) ?? 0) + 1);
    if (lead.appointment_at) appointments += 1;
  }

  const total = leads.length;
  const notReceived = NOT_RECEIVED_STATUSES.reduce(
    (sum, key) => sum + (counts.get(key) ?? 0),
    0,
  );

  return {
    total,
    received: total - notReceived,
    appointments,
    potential: counts.get("tiem_nang") ?? 0,
    byStatus: LEAD_STATUSES.map((status) => {
      const count = counts.get(status.key) ?? 0;
      return {
        key: status.key,
        label: status.label,
        color: status.color,
        count,
        percent: total ? (count / total) * 100 : 0,
      };
    }),
  };
}

/** 12.345 → "12%"; 0.4 → "<1%"; 0 → "0%". */
export function formatPercent(value: number) {
  if (value > 0 && value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

export function ratio(part: number, whole: number) {
  return whole ? formatPercent((part / whole) * 100) : "0%";
}
