import { APP } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  Lead,
  LeadIntakeInput,
  LeadIntakeResult,
  LeadPatch,
  LeadTouch,
  PhoneCheck,
} from "./types";

/**
 * Lớp truy cập dữ liệu leads (bảng `public.leads`, `public.lead_touches` và các hàm
 * trong supabase/002_marketing_lead.sql). Giao diện chỉ gọi các hàm ở đây.
 * Xoá lead (chuyển vào Thùng rác) nằm ở src/lib/safety/repo.ts.
 */

const LEAD_COLUMNS =
  "id, created_at, full_name, phone, service, service_id, source, channel_id, page_id, campaign_id, ads_id, status, assignee, assignee_id, assign_mode, appointment_at, note, pancake_url, touch_count, last_touch_at, recontacted_at, reopened_at, invalid_phone";

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

    if (error) throw new Error(error.message);
    all.push(...(data as Lead[]));
    if (data.length < PAGE_SIZE) break;
  }

  return all;
}

export async function fetchLead(id: string): Promise<Lead | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
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

  if (error) throw new Error(error.message);
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
