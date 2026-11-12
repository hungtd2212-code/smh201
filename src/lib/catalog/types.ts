import type { StaffRole } from "@/hooks/use-current-staff";

/**
 * Các bảng danh mục dùng chung: kênh, dịch vụ, page, chiến dịch (supabase/002_marketing_lead.sql)
 * và danh mục Marketing: nhân viên Ads, TKQC, phân công TKQC, bài post
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

/** Page (fanpage, kênh TikTok…) nơi khách nhắn tin. */
export type Page = {
  id: string;
  name: string;
  channel_id: string;
  /** Mã cơ sở (hiện chỉ có một cơ sở; cột này chưa hiện trên form). */
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
  /** true = Đang làm · false = Nghỉ. */
  is_active: boolean;
  note: string | null;
  deleted_at: string | null;
};

/** Loại TKQC: thuê hay tự build. */
export type AdAccountKind = "rented" | "self_built";
export const ACCOUNT_KIND_LABELS: Record<AdAccountKind, string> = { rented: "TK thuê", self_built: "Tự build" };

/** TKQC trả tiền bằng gì: tài khoản cá nhân hay thẻ công ty. */
export type AdPaymentKind = "personal" | "company_card";
export const PAYMENT_KIND_LABELS: Record<AdPaymentKind, string> = {
  personal: "Tài khoản cá nhân",
  company_card: "Thẻ công ty",
};

/** Tài khoản quảng cáo (TKQC). */
export type AdAccount = {
  id: string;
  name: string;
  /** ID tài khoản trên nền tảng quảng cáo. */
  account_id: string | null;
  channel_id: string;
  /** null = TKQC tạo trước khi có mục này (file 007). */
  account_kind: AdAccountKind | null;
  payment_kind: AdPaymentKind | null;
  /** false = Ngừng dùng (vd nhân viên đã bấm xoá một TKQC có báo cáo cũ). */
  is_active: boolean;
  note: string | null;
  /** Lúc TKQC được khai báo trong hệ thống. */
  created_at: string;
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
  /** Mã cơ sở (hiện chỉ có một cơ sở; cột này chưa hiện trên form). */
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
  /** Mã cơ sở (hiện chỉ có một cơ sở; cột này chưa hiện trên form). */
  branch: string;
  /** Đang bật nhận lead (được tính vào xoay vòng). */
  accepts_leads: boolean;
  last_assigned_at: string | null;
  /** Khác null = tài khoản đang bị khoá. */
  locked_at: string | null;
  /** Lý do khoá (vd "Quản trị khoá", "Đã xoá khỏi danh sách nhân sự"). */
  locked_reason: string | null;
  /** Được tick quyền "Xoá dữ liệu" (chuyển vào Thùng rác). Quản trị cấp cao luôn có, không cần tick. */
  can_delete: boolean;
  /** Được tick quyền "Xuất file". Quản trị luôn có, không cần tick. */
  can_export: boolean;
  /** Tên đăng nhập (null = tài khoản cũ đăng nhập bằng email). Các cột dưới do file 008 thêm vào. */
  username: string | null;
  /** Vị trí: coo | lead_ads | ads_staff | page; null = tài khoản tạo trước khi có vị trí. */
  position: "coo" | "lead_ads" | "ads_staff" | "page" | null;
  /** Nơi làm việc (branches.id). */
  branch_id: string | null;
  /** Trang được xem; null = menu theo vai trò như trước. */
  page_access: string[] | null;
  /** Ảnh đại diện (Supabase Storage, file 013); null = chưa có ảnh. */
  avatar_url: string | null;
  /** Khác null = đã xoá khỏi danh sách nhân sự (vẫn giữ tên trong dữ liệu cũ). */
  deleted_at: string | null;
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
  adsStaff: AdsStaff[];
  adAccounts: AdAccount[];
  assignments: AdAccountAssignment[];
  adPosts: AdPost[];
  /**
   * false = cơ sở dữ liệu chưa có danh mục Marketing (chưa chạy supabase/005_marketing_catalog.sql).
   * Khi đó các phần cũ vẫn chạy bình thường; các trang Marketing mới báo là chưa dùng được.
   */
  marketingReady: boolean;
  /** false = chưa chạy supabase/007_ad_account_setup.sql (chưa có màn Cài đặt TKQC). */
  adAccountSetupReady: boolean;
};

export const EMPTY_CATALOGS: Catalogs = {
  channels: [],
  services: [],
  pages: [],
  campaigns: [],
  staff: [],
  trashed: { channels: [], services: [], pages: [], campaigns: [] },
  adsStaff: [],
  adAccounts: [],
  assignments: [],
  adPosts: [],
  marketingReady: false,
  adAccountSetupReady: false,
};
