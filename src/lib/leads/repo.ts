import { APP } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { generateMockLeads } from "./mock";
import type { Lead, LeadInput } from "./types";

/**
 * Lớp truy cập dữ liệu leads. Toàn bộ giao diện chỉ gọi 3 hàm ở đây:
 * - đã cấu hình Supabase → đọc/ghi bảng `public.leads`
 * - chưa cấu hình        → dùng dữ liệu mẫu trong bộ nhớ (mất khi tải lại trang)
 */

const COLUMNS =
  "id, created_at, full_name, phone, service, source, ads_id, status, assignee, appointment_at, note";

/** Supabase trả tối đa 1000 dòng mỗi lần gọi → phải đọc theo trang. */
const PAGE_SIZE = 1000;

let mockStore: Lead[] | null = null;
function getMockStore() {
  mockStore ??= generateMockLeads(new Date());
  return mockStore;
}

/** Lấy các lead được tạo trong khoảng [from, to], mới nhất trước. */
export async function fetchLeads(from: Date, to: Date): Promise<Lead[]> {
  if (!isSupabaseConfigured) {
    const start = from.getTime();
    const end = to.getTime();
    return getMockStore().filter((lead) => {
      const t = new Date(lead.created_at).getTime();
      return t >= start && t <= end;
    });
  }

  const supabase = getSupabaseBrowserClient();
  const all: Lead[] = [];

  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("leads")
      .select(COLUMNS)
      .eq("branch", APP.branch.code)
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

export async function createLead(input: LeadInput): Promise<Lead> {
  if (!isSupabaseConfigured) {
    const lead: Lead = {
      ...input,
      id: `mau-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    getMockStore().unshift(lead);
    return lead;
  }

  const { data, error } = await getSupabaseBrowserClient()
    .from("leads")
    .insert({ ...input, branch: APP.branch.code })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as Lead;
}

export async function updateLead(
  id: string,
  patch: Partial<LeadInput>,
): Promise<Lead> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const index = store.findIndex((lead) => lead.id === id);
    if (index === -1) throw new Error("Không tìm thấy lead");
    store[index] = { ...store[index], ...patch };
    return store[index];
  }

  const { data, error } = await getSupabaseBrowserClient()
    .from("leads")
    .update(patch)
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as Lead;
}
