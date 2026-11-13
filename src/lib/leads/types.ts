import type { LeadStatusKey } from "./status";

/** Một dòng trong bảng `public.leads` của Supabase. */
export type Lead = {
  id: string;
  created_at: string;
  full_name: string;
  phone: string;
  /** Tên dịch vụ khách quan tâm (bản chụp tại lúc dán). */
  service: string | null;
  service_id: string | null;
  /** Tên kênh của lần tiếp cận gần nhất (bản chụp). */
  source: string | null;
  channel_id: string | null;
  page_id: string | null;
  campaign_id: string | null;
  ads_id: string | null;
  status: LeadStatusKey;
  /** Tên telesale phụ trách (bản chụp) và id của người đó. */
  assignee: string | null;
  assignee_id: string | null;
  /** round_robin = xoay vòng, manual = chia tay. */
  assign_mode: "round_robin" | "manual" | null;
  appointment_at: string | null;
  note: string | null;
  /** Link hội thoại Pancake. */
  pancake_url: string | null;
  /** Số lần trực page đã dán số này. */
  touch_count: number;
  last_touch_at: string | null;
  /** Khác null = khách vừa nhắn lại, telesale chưa xử lý. */
  recontacted_at: string | null;
  reopened_at: string | null;
  /** Telesale đánh dấu "số sai". */
  invalid_phone: boolean;
  // ----- Các cột của bảng Lead mới (supabase/020_telesale_crm.sql) -----
  /** TÌNH TRẠNG (bảng lead_statuses). null = chưa xử lý (lead cũ thì xem cột `status`). */
  status_id: string | null;
  status_changed_at: string;
  /** BÀI CHẠY và nhân viên Ads phụ trách TKQC của bài vào ngày số về. */
  ad_post_id: string | null;
  ads_staff_id: string | null;
  /** KHAI THÁC THÔNG TIN KHÁCH HÀNG / NHẬT KÝ TƯ VẤN (lịch sử sửa nằm trong nhật ký thay đổi). */
  consult_info: string | null;
  /** DOANH SỐ / DOANH THU (đ). */
  deal_amount: number | null;
  paid_amount: number | null;
  area: string | null;
  gender: "male" | "female" | null;
  age: number | null;
  budget: string | null;
  /** ĐẢO SỐ: sale quản lý trước đó, số lần đã đảo, lần đảo gần nhất. */
  previous_assignee_id: string | null;
  transfer_count: number;
  transferred_at: string | null;
};

/** Một trạng thái khách hàng do quản lý tự đặt (Telesale → Cài đặt). */
export type LeadStatusRow = {
  id: string;
  name: string;
  /** Màu nền và màu chữ của nhãn, dạng #rrggbb. */
  color: string;
  text_color: string;
  sort_order: number;
  /** false = đã ẩn: không hiện trong ô chọn, số đang ở trạng thái này vẫn giữ. */
  is_active: boolean;
  /** Chọn trạng thái này thì phải nhập lịch hẹn / doanh số. */
  needs_appointment: boolean;
  needs_deal: boolean;
};

/** auto = tự động xoay vòng · manual = số mới để "Chưa chia", người có quyền tự chia. */
export type AssignMode = "auto" | "manual";

/** Dữ liệu nút "Thêm số" gửi lên hàm add_lead(). */
export type AddLeadInput = {
  phone: string;
  full_name: string;
  channel_id: string | null;
  page_id: string | null;
  ad_post_id: string | null;
  service_id: string | null;
  note: string | null;
  pancake_url: string | null;
  /** null = theo cài đặt (tự động xoay vòng / để chưa chia). */
  assignee_id: string | null;
  branch: string;
};

export type AddLeadResult = {
  outcome: "new" | "duplicate";
  lead_id: string;
  phone: string;
  full_name: string;
  assignee: string | null;
  assign_mode: "round_robin" | "manual" | "kept" | null;
};

/** Kiểm tra nhanh một số vừa nhập (hàm check_lead_phone_v2). */
export type PhoneCheckV2 =
  | { valid: false; phone: string }
  | {
      valid: true;
      phone: string;
      outcome: "new" | "duplicate";
      lead?: {
        id: string;
        full_name: string;
        created_at: string;
        assignee: string | null;
        touch_count: number;
        status_name: string | null;
      };
    };

/** Một lần sửa ô Khai thác thông tin khách hàng. */
export type ConsultVersion = {
  id: number;
  at: string;
  actor_id: string | null;
  text: string;
};

/** Các cột telesale được sửa trên một lead. */
export type LeadPatch = Partial<
  Pick<
    Lead,
    | "full_name"
    | "service"
    | "service_id"
    | "status"
    | "assignee"
    | "assignee_id"
    | "assign_mode"
    | "appointment_at"
    | "note"
    | "invalid_phone"
    | "recontacted_at"
    | "status_id"
    | "consult_info"
    | "deal_amount"
    | "paid_amount"
    | "area"
    | "gender"
    | "age"
    | "budget"
  >
>;

/** Kết quả một lần dán: số mới hợp lệ / số trùng / số mở lại / khách cũ. */
export type TouchResult = "new" | "duplicate" | "reopened" | "existing_customer";

export const TOUCH_RESULT_LABELS: Record<TouchResult, string> = {
  new: "Số mới",
  duplicate: "Số trùng",
  reopened: "Số mở lại",
  existing_customer: "Khách cũ",
};

/** Một lần trực page dán số ("lần tiếp cận"). */
export type LeadTouch = {
  id: string;
  lead_id: string;
  created_at: string;
  created_by: string | null;
  channel_id: string | null;
  page_id: string | null;
  campaign_id: string | null;
  service_id: string | null;
  ads_id: string | null;
  note: string | null;
  pancake_url: string | null;
  result: TouchResult;
  is_invalid: boolean;
  assignee_id: string | null;
  assign_mode: "round_robin" | "manual" | "kept" | null;
};

/** Dữ liệu form Thêm lead gửi lên hàm intake_lead(). */
export type LeadIntakeInput = {
  phone: string;
  full_name: string;
  channel_id: string;
  page_id: string | null;
  campaign_id: string | null;
  service_id: string | null;
  ads_id: string | null;
  branch: string;
  note: string | null;
  pancake_url: string | null;
  /** null = xoay vòng. */
  assignee_id: string | null;
};

export type LeadIntakeResult = {
  outcome: TouchResult;
  lead_id: string;
  phone: string;
  full_name: string | null;
  assignee: string | null;
  assign_mode: "round_robin" | "manual" | "kept" | null;
  previous_status: LeadStatusKey | null;
};

/** Kết quả kiểm tra nhanh một số điện thoại trước khi lưu. */
export type PhoneCheck =
  | { valid: false; phone: string }
  | {
      valid: true;
      phone: string;
      outcome: TouchResult;
      lead?: {
        id: string;
        full_name: string;
        status: LeadStatusKey;
        assignee: string | null;
        created_at: string;
        status_changed_at: string;
        touch_count: number;
      };
    };
