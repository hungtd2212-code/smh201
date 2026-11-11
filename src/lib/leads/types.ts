import type { LeadStatusKey } from "./status";

/** Một dòng trong bảng `public.leads` của Supabase. */
export type Lead = {
  id: string;
  created_at: string;
  full_name: string;
  phone: string;
  /** Dịch vụ khách quan tâm */
  service: string | null;
  /** Nguồn lead: Facebook Ads, Zalo, ... */
  source: string | null;
  ads_id: string | null;
  status: LeadStatusKey;
  /** Nhân viên telesale phụ trách */
  assignee: string | null;
  /** Lịch hẹn đến phòng khám */
  appointment_at: string | null;
  note: string | null;
};

/** Dữ liệu nhập từ form thêm / sửa lead. */
export type LeadInput = Omit<Lead, "id" | "created_at">;

export const DENTAL_SERVICES = [
  "Niềng răng",
  "Bọc răng sứ",
  "Dán sứ Veneer",
  "Cấy ghép Implant",
  "Tẩy trắng răng",
  "Nhổ răng khôn",
  "Trám răng",
  "Lấy cao răng",
  "Điều trị tuỷ",
  "Khám tổng quát",
] as const;

export const LEAD_SOURCES = [
  "Facebook Ads",
  "TikTok",
  "Zalo",
  "Google",
  "Website",
  "Giới thiệu",
  "Khách vãng lai",
] as const;
