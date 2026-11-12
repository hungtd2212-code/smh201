import { APP } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { dayOf } from "./dates";

/** Lead Telesale rút gọn cho Phân tích → Phễu khách hàng (chỉ đọc). */
export type FunnelLeadRow = {
  day: string;
  status: string;
  hasAppointment: boolean;
  invalidPhone: boolean;
  campaignId: string | null;
  channelId: string | null;
};

const PAGE = 1000;

/** Các lead được tạo từ ngày `from` tới hết ngày `to` (giờ Việt Nam), bỏ lead đã chuyển vào Thùng rác. */
export async function fetchFunnelLeads(from: string, to: string): Promise<FunnelLeadRow[]> {
  const supabase = getSupabaseBrowserClient();
  const rows: FunnelLeadRow[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, created_at, status, appointment_at, invalid_phone, campaign_id, channel_id")
      .eq("branch", APP.branch.code)
      .is("deleted_at", null)
      .gte("created_at", `${from}T00:00:00+07:00`)
      .lte("created_at", `${to}T23:59:59.999+07:00`)
      .order("created_at")
      .order("id")
      .range(start, start + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const lead of data) {
      rows.push({
        day: dayOf(lead.created_at),
        status: lead.status,
        hasAppointment: lead.appointment_at !== null,
        invalidPhone: Boolean(lead.invalid_phone),
        campaignId: lead.campaign_id,
        channelId: lead.channel_id,
      });
    }
    if (data.length < PAGE) return rows;
  }
}
