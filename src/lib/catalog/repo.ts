import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  Campaign,
  Catalogs,
  Channel,
  Page,
  Service,
  StaffMember,
} from "./types";

/** Đọc / ghi các bảng danh mục. Quyền ghi do Supabase kiểm soát (chỉ quản trị và lead). */

type CatalogTable = "channels" | "services" | "pages" | "campaigns";

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

/** Tách dòng đang dùng và dòng đã xoá (nằm trong Thùng rác). */
function split<T extends { deleted_at: string | null }>(rows: T[]) {
  return {
    live: rows.filter((row) => !row.deleted_at),
    trashed: rows.filter((row) => row.deleted_at),
  };
}

export async function fetchCatalogs(): Promise<Catalogs> {
  const supabase = getSupabaseBrowserClient();
  const [channels, services, pages, campaigns, staff] = await Promise.all([
    supabase.from("channels").select("id, name, sort_order, is_active, deleted_at").order("sort_order").order("name"),
    supabase.from("services").select("id, name, price, sort_order, is_active, deleted_at").order("sort_order").order("name"),
    supabase.from("pages").select("id, name, channel_id, branch, is_active, deleted_at").order("name"),
    supabase
      .from("campaigns")
      .select("id, name, channel_id, page_id, service_id, branch, start_date, end_date, budget, owner_id, ads_id, is_active, deleted_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("staff")
      .select("user_id, full_name, role, branch, accepts_leads, last_assigned_at, locked_at, can_delete")
      .order("full_name"),
  ]);

  const c = split(unwrap(channels) as Channel[]);
  const s = split(unwrap(services) as Service[]);
  const p = split(unwrap(pages) as Page[]);
  const g = split(unwrap(campaigns) as Campaign[]);

  return {
    channels: c.live,
    services: s.live,
    pages: p.live,
    campaigns: g.live,
    staff: unwrap(staff) as StaffMember[],
    trashed: { channels: c.trashed, services: s.trashed, pages: p.trashed, campaigns: g.trashed },
  };
}

/** Thêm mới (không có id) hoặc cập nhật (có id) một dòng danh mục. */
export async function saveCatalogRow(
  table: CatalogTable,
  id: string | null,
  values: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = id
    ? await supabase.from(table).update(values).eq("id", id)
    : await supabase.from(table).insert(values);

  if (!error) return;
  if (error.code === "23505") throw new Error("Tên này đã tồn tại.");
  if (error.code === "42501")
    throw new Error("Bạn không có quyền sửa danh mục (cần vai trò Quản trị hoặc Lead).");
  throw new Error(error.message);
}

/** Bật / tắt nhận lead cho một nhân viên. */
export async function setAcceptsLeads(userId: string, value: boolean): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("set_accepts_leads", {
    p_user_id: userId,
    p_value: value,
  });
  if (error) throw new Error(error.message);
}
