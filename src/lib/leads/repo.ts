import { APP } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";
import type {
  AddLeadInput,
  AddLeadResult,
  AssignMode,
  ConsultVersion,
  Lead,
  LeadIntakeInput,
  LeadIntakeResult,
  LeadPatch,
  LeadStatusRow,
  LeadTouch,
  PhoneCheck,
  PhoneCheckV2,
} from "./types";

/**
 * Lớp truy cập dữ liệu leads (bảng `public.leads`, `public.lead_touches` và các hàm
 * trong supabase/002_marketing_lead.sql). Giao diện chỉ gọi các hàm ở đây.
 * Xoá lead (chuyển vào Thùng rác) nằm ở src/lib/safety/repo.ts.
 */

// Từ status_id trở đi là các cột của bảng Lead mới (supabase/020_telesale_crm.sql).
const LEAD_COLUMNS =
  "id, created_at, full_name, phone, service, service_id, source, channel_id, page_id, campaign_id, ads_id, status, assignee, assignee_id, assign_mode, appointment_at, note, pancake_url, touch_count, last_touch_at, recontacted_at, reopened_at, invalid_phone, status_id, status_changed_at, ad_post_id, ads_staff_id, consult_info, deal_amount, paid_amount, area, gender, age, budget, previous_assignee_id, transfer_count, transferred_at";

/** Supabase trả tối đa 1000 dòng mỗi lần gọi → phải đọc theo trang. */
const PAGE_SIZE = 1000;

/** Lấy các lead được tạo trong khoảng [from, to], mới nhất trước. */
export async function fetchLeads(from: Date, to: Date): Promise<Lead[]> {
  const supabase = getSupabaseBrowserClient();
  const all: Lead[] = [];

  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("branch", APP.branch.code)
      .is("deleted_at", null) // lead đã xoá nằm trong Thùng rác, không hiện ở đây
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw crmError(error);
    all.push(...(data as Lead[]));
    if (data.length < PAGE_SIZE) break;
  }

  return all;
}

/**
 * Nhân viên Ads của từng số tạo trong khoảng [from, to] (cột "NV ADS" của bảng Lead, supabase/035_lead_ads_staff.sql):
 * số Pancake kéo về tính theo quảng cáo khách bấm sau cùng → TKQC → nhân viên phụ trách hôm đó (như mục "SĐT theo nhân
 * viên"). Số không tìm ra nhân viên thì không có trong kết quả. null = chưa chạy file 035 → dùng cột ads_staff_id có sẵn.
 */
export async function fetchLeadsAdsStaff(from: Date, to: Date): Promise<Map<string, string> | null> {
  const { data, error } = await getSupabaseBrowserClient().rpc("leads_ads_staff", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (isNotMigrated(error)) return null;
  if (error) throw crmError(error);
  return new Map((data as { lead_id: string; ads_staff_id: string }[]).map((r) => [r.lead_id, r.ads_staff_id]));
}

export async function fetchLead(id: string): Promise<Lead | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw crmError(error);
  return data as Lead | null;
}

/** Kiểm tra nhanh một số vừa dán: số mới, trùng, sẽ mở lại hay khách cũ. Không lưu gì. */
export async function checkLeadPhone(phone: string): Promise<PhoneCheck> {
  const { data, error } = await getSupabaseBrowserClient().rpc("check_lead_phone", {
    p_phone: phone,
  });
  if (error) throw new Error(error.message);
  return data as PhoneCheck;
}

/**
 * Trực page dán một lead. Máy chủ chuẩn hoá SĐT, xử lý trùng theo quy tắc
 * "nguồn gần nhất" và chia telesale (xoay vòng hoặc chọn tay).
 */
export async function intakeLead(input: LeadIntakeInput): Promise<LeadIntakeResult> {
  const { data, error } = await getSupabaseBrowserClient().rpc("intake_lead", {
    p_phone: input.phone,
    p_full_name: input.full_name,
    p_channel_id: input.channel_id,
    p_page_id: input.page_id,
    p_campaign_id: input.campaign_id,
    p_service_id: input.service_id,
    p_ads_id: input.ads_id,
    p_branch: input.branch,
    p_note: input.note,
    p_pancake_url: input.pancake_url,
    p_assignee_id: input.assignee_id,
  });
  if (error) throw new Error(error.message);
  return data as LeadIntakeResult;
}

export async function updateLead(id: string, patch: LeadPatch): Promise<Lead> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("leads")
    .update(patch)
    .eq("id", id)
    .select(LEAD_COLUMNS)
    .single();

  if (error) throw crmError(error);
  return data as Lead;
}

/** Các lần tiếp cận của một lead, mới nhất trước. */
export async function fetchLeadTouches(leadId: string): Promise<LeadTouch[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("lead_touches")
    .select(
      "id, lead_id, created_at, created_by, channel_id, page_id, campaign_id, service_id, ads_id, note, pancake_url, result, is_invalid, assignee_id, assign_mode",
    )
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as LeadTouch[];
}

// ---------------------------------------------------------------------------
// Telesale CRM (supabase/020_telesale_crm.sql)
// ---------------------------------------------------------------------------

const NOT_READY = "Cơ sở dữ liệu chưa có phần Telesale mới: cần chạy file supabase/020_telesale_crm.sql trên Supabase.";

function crmError(error: { message: string; code?: string }): Error {
  if (isNotMigrated(error)) return new Error(NOT_READY);
  if (error.code === "23505") return new Error("Đã có trạng thái trùng tên.");
  if (error.code === "42501" && /row-level security/.test(error.message))
    return new Error("Bạn không có quyền sửa mục này.");
  return new Error(error.message);
}

/** Trạng thái khách hàng (cả trạng thái đã ẩn — để số cũ vẫn hiện đúng nhãn), theo thứ tự. */
export async function fetchLeadStatuses(): Promise<LeadStatusRow[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("lead_statuses")
    .select("id, name, color, text_color, sort_order, is_active, needs_appointment, needs_deal")
    .order("sort_order")
    .order("name");
  if (error) throw crmError(error);
  return data as LeadStatusRow[];
}

/** Thêm (id null) hoặc sửa một trạng thái. */
export async function saveLeadStatus(
  id: string | null,
  values: Partial<Omit<LeadStatusRow, "id">>,
): Promise<void> {
  const table = getSupabaseBrowserClient().from("lead_statuses");
  const { error } = id ? await table.update(values).eq("id", id) : await table.insert(values);
  if (error) throw crmError(error);
}

/** Lưu thứ tự mới (danh sách id từ trên xuống). */
export async function reorderLeadStatuses(ids: string[]): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("reorder_lead_statuses", { p_ids: ids });
  if (error) throw crmError(error);
}

/** Cách chia số mới: tự động xoay vòng hay để "Chưa chia". */
export async function fetchAssignMode(): Promise<AssignMode> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("app_settings")
    .select("value")
    .eq("key", "lead_assign_mode")
    .maybeSingle();
  if (error) throw crmError(error);
  return data?.value === "manual" ? "manual" : "auto";
}

export async function saveAssignMode(mode: AssignMode): Promise<void> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("app_settings")
    .update({ value: mode })
    .eq("key", "lead_assign_mode")
    .select("key");
  if (error) throw crmError(error);
  if (!data || data.length === 0) throw new Error("Bạn không có quyền đổi cách chia số, hoặc cơ sở dữ liệu chưa chạy file 020.");
}

/** Kiểm tra nhanh một số vừa nhập: số mới hay trùng. Không lưu gì. */
export async function checkLeadPhoneV2(phone: string): Promise<PhoneCheckV2> {
  const { data, error } = await getSupabaseBrowserClient().rpc("check_lead_phone_v2", { p_phone: phone });
  if (error) throw crmError(error);
  return data as PhoneCheckV2;
}

/** Nút "Thêm số": máy chủ chuẩn hoá số, xử lý số trùng, tự điền nguồn từ bài chạy và chia sale. */
export async function addLead(input: AddLeadInput): Promise<AddLeadResult> {
  const { data, error } = await getSupabaseBrowserClient().rpc("add_lead", {
    p_phone: input.phone,
    p_full_name: input.full_name,
    p_channel_id: input.channel_id,
    p_page_id: input.page_id,
    p_ad_post_id: input.ad_post_id,
    p_service_id: input.service_id,
    p_note: input.note,
    p_pancake_url: input.pancake_url,
    p_assignee_id: input.assignee_id,
    p_branch: input.branch,
  });
  if (error) throw crmError(error);
  return data as AddLeadResult;
}

/** Các lần sửa ô Khai thác thông tin khách hàng, mới nhất trước (lấy từ nhật ký thay đổi). */
export async function fetchConsultHistory(leadId: string): Promise<ConsultVersion[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("audit_log")
    .select("id, at, actor_id, new_data")
    .eq("table_name", "leads")
    .eq("record_id", leadId)
    .not("new_data->consult_info", "is", null)
    .order("id", { ascending: false })
    .limit(200);
  if (error) throw crmError(error);
  return (data as { id: number; at: string; actor_id: string | null; new_data: { consult_info?: unknown } | null }[])
    .map((row) => ({
      id: row.id,
      at: row.at,
      actor_id: row.actor_id,
      text: typeof row.new_data?.consult_info === "string" ? row.new_data.consult_info : "",
    }))
    .filter((row, index, all) => row.text !== "" || index < all.length - 1);
}
