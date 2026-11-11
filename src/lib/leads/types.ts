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
