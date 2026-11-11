import type { StaffRole } from "@/hooks/use-current-staff";

/**
 * Các bảng danh mục dùng chung: kênh, dịch vụ, page, chiến dịch (supabase/002_marketing_lead.sql)
 * và danh mục Marketing: Miền, nhân viên Ads, TKQC, phân công TKQC, bài post
 * (supabase/005_marketing_catalog.sql).
 */

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

/** Miền (Miền Bắc — HN, Miền Nam — HCM). Cột `branch` ở các bảng khác chứa `code` của Miền. */
export type Region = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
};

/** Page (fanpage, kênh TikTok…) nơi khách nhắn tin. */
export type Page = {
  id: string;
  name: string;
  channel_id: string;
  /** Mã Miền. */
  branch: string;
  url: string | null;
  /** Trực page phụ trách (staff.user_id). */
  page_staff_ids: string[];
  is_active: boolean;
  deleted_at: string | null;
};

/** Người chạy quảng cáo. Có thể chưa có tài khoản đăng nhập. */
export type AdsStaff = {
  id: string;
  full_name: string;
  /** Mã nhân viên nội bộ. */
  staff_code: string | null;
  /** Tài khoản đăng nhập gắn với người này (staff.user_id). */
  user_id: string | null;
  /** Mã Miền. */
  branch: string;
  /** true = Đang làm · false = Nghỉ. */
  is_active: boolean;
  note: string | null;
  deleted_at: string | null;
};

/** Tài khoản quảng cáo (TKQC). */
export type AdAccount = {
  id: string;
  name: string;
  /** ID tài khoản trên nền tảng quảng cáo. */
  account_id: string | null;
  channel_id: string;
  is_active: boolean;
  note: string | null;
  deleted_at: string | null;
};

/** Một đợt giao TKQC cho một nhân viên Ads. Số liệu ngày nào thuộc về người phụ trách ngày đó. */
export type AdAccountAssignment = {
  id: string;
  ad_account_id: string;
  ads_staff_id: string;
  from_date: string; // yyyy-MM-dd
  /** null = đang phụ trách. */
  to_date: string | null;
  note: string | null;
  deleted_at: string | null;
};

export type CampaignObjective = "messages" | "engagement" | "conversion";

export const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  messages: "Tin nhắn",
  engagement: "Tương tác",
  conversion: "Chuyển đổi",
};

export type Campaign = {
  id: string;
  name: string;
  channel_id: string;
  page_id: string | null;
  /** TKQC chạy chiến dịch. null = chiến dịch tạo trước khi có danh mục TKQC. */
  ad_account_id: string | null;
  objective: CampaignObjective | null;
  service_id: string | null;
  /** Mã Miền. */
  branch: string;
  start_date: string | null; // yyyy-MM-dd
  end_date: string | null;
  budget: number | null;
  owner_id: string | null;
  /** ID camp trên nền tảng quảng cáo. */
  ads_id: string | null;
  is_active: boolean;
  deleted_at: string | null;
};

/** active = Đang chạy · paused = Tạm dừng · undeclared = Chưa khai báo (chưa gắn chiến dịch). */
export type AdPostStatus = "active" | "paused" | "undeclared";

export const POST_STATUS_LABELS: Record<AdPostStatus, string> = {
  active: "Đang chạy",
  paused: "Tạm dừng",
  undeclared: "Chưa khai báo",
};

export type AdPost = {
  id: string;
  campaign_id: string | null;
  url: string;
  /** facebook | tiktok | other — hệ thống tự tách từ link. */
  platform: string | null;
  /** ID bài — hệ thống tự tách từ link (null nếu link rút gọn / không nhận ra). */
  post_id: string | null;
  ad_id: string | null;
  /** Khoá so khớp link, vd "fb:123…", "fbshare:…", "url:…". */
  post_key: string;
  title: string | null;
  media_type: "image" | "video" | null;
  start_date: string | null;
  status: AdPostStatus;
  note: string | null;
  deleted_at: string | null;
};

export type StaffMember = {
  user_id: string;
  full_name: string;
  role: StaffRole;
  /** Mã Miền. */
  branch: string;
  /** Đang bật nhận lead (được tính vào xoay vòng). */
  accepts_leads: boolean;
  last_assigned_at: string | null;
  /** Khác null = tài khoản đang bị khoá. */
  locked_at: string | null;
  /** Được tick quyền "Xoá dữ liệu" (chuyển vào Thùng rác). Quản trị cấp cao luôn có, không cần tick. */
  can_delete: boolean;
  /** Được tick quyền "Xuất file". Quản trị luôn có, không cần tick. */
  can_export: boolean;
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
  /** Danh mục Marketing (chỉ gồm dòng đang dùng, và chỉ những dòng tài khoản này được xem). */
  regions: Region[];
  adsStaff: AdsStaff[];
  adAccounts: AdAccount[];
  assignments: AdAccountAssignment[];
  adPosts: AdPost[];
  /**
   * false = cơ sở dữ liệu chưa có danh mục Marketing (chưa chạy supabase/005_marketing_catalog.sql).
   * Khi đó các phần cũ vẫn chạy bình thường; các trang Marketing mới báo là chưa dùng được.
   */
  marketingReady: boolean;
};

export const EMPTY_CATALOGS: Catalogs = {
  channels: [],
  services: [],
  pages: [],
  campaigns: [],
  staff: [],
  trashed: { channels: [], services: [], pages: [], campaigns: [] },
  regions: [],
  adsStaff: [],
  adAccounts: [],
  assignments: [],
  adPosts: [],
  marketingReady: false,
};
