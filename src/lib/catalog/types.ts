import type { StaffRole } from "@/hooks/use-current-staff";

/** Các bảng danh mục của phân hệ Marketing → Lead (xem supabase/002_marketing_lead.sql). */

export type Channel = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  /** Khác null = đã xoá (đang nằm trong Thùng rác). */
  deleted_at: string | null;
};

export type Service = {
  id: string;
  name: string;
  price: number | null;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
};

/** Page / tài khoản quảng cáo. */
export type Page = {
  id: string;
  name: string;
  channel_id: string;
  branch: string;
  is_active: boolean;
  deleted_at: string | null;
};

export type Campaign = {
  id: string;
  name: string;
  channel_id: string;
  page_id: string | null;
  service_id: string | null;
  branch: string;
  start_date: string | null; // yyyy-MM-dd
  end_date: string | null;
  budget: number | null;
  owner_id: string | null;
  ads_id: string | null;
  is_active: boolean;
  deleted_at: string | null;
};

export type StaffMember = {
  user_id: string;
  full_name: string;
  role: StaffRole;
  branch: string;
  /** Đang bật nhận lead (được tính vào xoay vòng). */
  accepts_leads: boolean;
  last_assigned_at: string | null;
  /** Khác null = tài khoản đang bị khoá. */
  locked_at: string | null;
};

type CatalogRows = {
  channels: Channel[];
  services: Service[];
  pages: Page[];
  campaigns: Campaign[];
};

export type Catalogs = CatalogRows & {
  staff: StaffMember[];
  /** Các dòng đã xoá — chỉ dùng để tra tên cho dữ liệu cũ, không hiện trong form hay bảng danh mục. */
  trashed: CatalogRows;
};

export const EMPTY_CATALOGS: Catalogs = {
  channels: [],
  services: [],
  pages: [],
  campaigns: [],
  staff: [],
  trashed: { channels: [], services: [], pages: [], campaigns: [] },
};
