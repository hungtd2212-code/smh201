import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { MISSING_COLUMN, isNotMigrated } from "@/lib/supabase/errors";
import type {
  AdAccount,
  AdAccountKind,
  AdPaymentKind,
  AdAccountAssignment,
  AdPost,
  AdsStaff,
  Campaign,
  Catalogs,
  Channel,
  Page,
  Service,
  StaffMember,
} from "./types";

/** Đọc / ghi các bảng danh mục. Quyền đọc và ghi do Supabase kiểm soát (xem supabase/005_marketing_catalog.sql). */

export type CatalogTable =
  | "channels"
  | "services"
  | "pages"
  | "campaigns"
  | "ads_staff"
  | "ad_accounts"
  | "ad_account_assignments"
  | "ad_posts";

type QueryError = { message: string; code?: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

function unwrap<T>(result: QueryResult<T>): T {
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

/**
 * Danh sách nhân viên. Cột can_delete do file 004 thêm vào, can_export do file 005, tên đăng nhập /
 * vị trí / nơi làm việc / trang được xem do file 008; cơ sở dữ liệu chưa chạy file nào thì đọc không
 * kèm cột đó (coi như để trống).
 */
async function fetchStaff(): Promise<StaffMember[]> {
  const supabase = getSupabaseBrowserClient();
  const base = "user_id, full_name, role, branch, accepts_leads, last_assigned_at, locked_at, locked_reason";
  const attempts = [
    `${base}, can_delete, can_export, username, position, branch_id, page_access, deleted_at`,
    `${base}, can_delete, can_export`,
    `${base}, can_delete`,
    base,
  ];

  for (const [index, columns] of attempts.entries()) {
    const result = await supabase.from("staff").select(columns).order("full_name");
    if (result.error?.code === MISSING_COLUMN && index < attempts.length - 1) continue;
    const rows = unwrap(result as QueryResult<Partial<StaffMember>[]>);
    return rows.map((row) => ({
      can_delete: false,
      can_export: false,
      username: null,
      position: null,
      branch_id: null,
      page_access: null,
      deleted_at: null,
      ...row,
    })) as StaffMember[];
  }
  return [];
}

const CAMPAIGN_COLUMNS =
  "id, name, channel_id, page_id, service_id, branch, start_date, end_date, budget, owner_id, ads_id, is_active, deleted_at";
const PAGE_COLUMNS = "id, name, channel_id, branch, is_active, deleted_at";

const AD_ACCOUNT_COLUMNS = "id, name, account_id, channel_id, is_active, note, deleted_at";

/**
 * TKQC đang dùng. Hai cột "loại tài khoản", "thanh toán" do file 007 thêm vào; chưa chạy file đó thì
 * đọc không kèm hai cột này (để trống) và báo setupReady = false.
 */
async function fetchAdAccounts(): Promise<{ result: QueryResult<AdAccount[]>; setupReady: boolean }> {
  const supabase = getSupabaseBrowserClient();
  const query = (columns: string) =>
    supabase.from("ad_accounts").select(columns).is("deleted_at", null).order("name");
  const full = await query(`${AD_ACCOUNT_COLUMNS}, account_kind, payment_kind`);
  if (full.error?.code !== MISSING_COLUMN) {
    return { result: full as unknown as QueryResult<AdAccount[]>, setupReady: !full.error };
  }
  const basic = await query(AD_ACCOUNT_COLUMNS);
  return {
    result: {
      data: basic.data
        ? (basic.data as unknown as Omit<AdAccount, "account_kind" | "payment_kind">[]).map((row) => ({
            ...row,
            account_kind: null,
            payment_kind: null,
          }))
        : null,
      error: basic.error,
    },
    setupReady: false,
  };
}

type MarketingRows = {
  pages: Page[];
  campaigns: Campaign[];
  adsStaff: AdsStaff[];
  adAccounts: AdAccount[];
  assignments: AdAccountAssignment[];
  adPosts: AdPost[];
  adAccountSetupReady: boolean;
};

/** Danh mục Marketing theo cấu trúc của file 005. Trả về null nếu cơ sở dữ liệu chưa chạy file đó. */
async function fetchMarketing(): Promise<MarketingRows | null> {
  const supabase = getSupabaseBrowserClient();
  const [accounts, ...results] = await Promise.all([
    fetchAdAccounts(),
    supabase.from("pages").select(`${PAGE_COLUMNS}, url, page_staff_ids`).order("name"),
    supabase
      .from("campaigns")
      .select(`${CAMPAIGN_COLUMNS}, ad_account_id, objective`)
      .order("created_at", { ascending: false }),
    supabase
      .from("ads_staff")
      .select("id, full_name, staff_code, user_id, is_active, note, deleted_at")
      .is("deleted_at", null)
      .order("full_name"),
    supabase
      .from("ad_account_assignments")
      .select("id, ad_account_id, ads_staff_id, from_date, to_date, note, deleted_at")
      .is("deleted_at", null)
      .order("from_date", { ascending: false }),
    supabase
      .from("ad_posts")
      .select("id, campaign_id, url, platform, post_id, ad_id, post_key, title, media_type, start_date, status, note, deleted_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ] as const);

  if ([...results, accounts.result].some((result) => isNotMigrated(result.error))) return null;
  const [pages, campaigns, adsStaff, assignments, adPosts] = results;
  const adAccounts = accounts.result;
  return {
    pages: unwrap(pages) as Page[],
    campaigns: unwrap(campaigns) as Campaign[],
    adsStaff: unwrap(adsStaff) as AdsStaff[],
    adAccounts: unwrap(adAccounts) as AdAccount[],
    assignments: unwrap(assignments) as AdAccountAssignment[],
    adPosts: unwrap(adPosts) as AdPost[],
    adAccountSetupReady: accounts.setupReady,
  };
}

/** Page và chiến dịch theo cấu trúc cũ (trước file 005): các cột mới coi như để trống. */
async function fetchLegacyPagesAndCampaigns(): Promise<Pick<MarketingRows, "pages" | "campaigns">> {
  const supabase = getSupabaseBrowserClient();
  const [pages, campaigns] = await Promise.all([
    supabase.from("pages").select(PAGE_COLUMNS).order("name"),
    supabase.from("campaigns").select(CAMPAIGN_COLUMNS).order("created_at", { ascending: false }),
  ]);
  return {
    pages: (unwrap(pages) as Omit<Page, "url" | "page_staff_ids">[]).map((row) => ({
      ...row,
      url: null,
      page_staff_ids: [],
    })),
    campaigns: (unwrap(campaigns) as Omit<Campaign, "ad_account_id" | "objective">[]).map((row) => ({
      ...row,
      ad_account_id: null,
      objective: null,
    })),
  };
}

export async function fetchCatalogs(): Promise<Catalogs> {
  const supabase = getSupabaseBrowserClient();
  const [channels, services, staff, marketing] = await Promise.all([
    supabase.from("channels").select("id, name, sort_order, is_active, deleted_at").order("sort_order").order("name"),
    supabase.from("services").select("id, name, price, sort_order, is_active, deleted_at").order("sort_order").order("name"),
    fetchStaff(),
    fetchMarketing(),
  ]);
  const legacy = marketing ?? (await fetchLegacyPagesAndCampaigns());

  const c = split(unwrap(channels) as Channel[]);
  const s = split(unwrap(services) as Service[]);
  const p = split(legacy.pages);
  const g = split(legacy.campaigns);

  return {
    channels: c.live,
    services: s.live,
    pages: p.live,
    campaigns: g.live,
    staff,
    trashed: { channels: c.trashed, services: s.trashed, pages: p.trashed, campaigns: g.trashed },
    adsStaff: marketing?.adsStaff ?? [],
    adAccounts: marketing?.adAccounts ?? [],
    assignments: marketing?.assignments ?? [],
    adPosts: marketing?.adPosts ?? [],
    marketingReady: marketing !== null,
    adAccountSetupReady: marketing?.adAccountSetupReady ?? false,
  };
}

/** Lời báo lỗi dễ hiểu cho các lỗi hay gặp khi lưu danh mục. */
function saveError(error: QueryError, duplicateMessage: string): Error {
  if (error.code === "23505") return new Error(duplicateMessage);
  if (error.code === "42501") return new Error("Bạn không có quyền thêm hoặc sửa mục này.");
  if (isNotMigrated(error)) {
    return new Error("Cơ sở dữ liệu chưa được cập nhật cho chức năng này (file supabase/005_marketing_catalog.sql chưa chạy).");
  }
  return new Error(error.message);
}

/**
 * Thêm mới (không có id) hoặc cập nhật (có id) một dòng danh mục.
 * `duplicateMessage` là lời báo khi trùng tên / trùng mã.
 */
export async function saveCatalogRow(
  table: CatalogTable,
  id: string | null,
  values: Record<string, unknown>,
  duplicateMessage = "Tên này đã tồn tại.",
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!id) {
    const { error } = await supabase.from(table).insert(values);
    if (error) throw saveError(error, duplicateMessage);
    return;
  }
  // Sửa mà máy chủ không cho thì không báo lỗi, chỉ là "0 dòng được sửa" → phải tự kiểm tra.
  const { data, error } = await supabase.from(table).update(values).eq("id", id).select("id");
  if (error) throw saveError(error, duplicateMessage);
  if (data.length === 0) {
    throw new Error("Không lưu được: bạn không có quyền sửa mục này, hoặc mục đã nằm trong Thùng rác.");
  }
}

/** Lưu một bài post và trả về dòng đã lưu (kèm ID bài, ID ads hệ thống vừa tách từ link). */
export async function saveAdPost(id: string | null, values: Record<string, unknown>): Promise<AdPost> {
  const supabase = getSupabaseBrowserClient();
  const columns =
    "id, campaign_id, url, platform, post_id, ad_id, post_key, title, media_type, start_date, status, note, deleted_at";
  const duplicate = "Bài này đã được khai báo rồi (trùng link hoặc trùng ID bài với một bài khác).";

  const { data, error } = id
    ? await supabase.from("ad_posts").update(values).eq("id", id).select(columns)
    : await supabase.from("ad_posts").insert(values).select(columns);
  if (error) throw saveError(error, duplicate);
  if (data.length === 0) {
    throw new Error("Không lưu được: bạn không có quyền sửa bài này, hoặc bài đã nằm trong Thùng rác.");
  }
  return data[0] as AdPost;
}

/**
 * Giao một TKQC cho một nhân viên Ads kể từ `fromDate` (yyyy-MM-dd). Phân công đang mở của TKQC
 * tự kết thúc vào hôm trước. Trả về true nếu có phân công cũ vừa được kết thúc.
 */
export async function assignAdAccount(
  adAccountId: string,
  adsStaffId: string,
  fromDate: string,
  note: string | null,
): Promise<boolean> {
  const { data, error } = await getSupabaseBrowserClient().rpc("assign_ad_account", {
    p_ad_account_id: adAccountId,
    p_ads_staff_id: adsStaffId,
    p_from_date: fromDate,
    p_note: note,
  });
  if (error) throw saveError(error, error.message);
  return (data as { closed: number }).closed > 0;
}

/** Lỗi của hai hàm Cài đặt TKQC: câu báo của cơ sở dữ liệu đã là tiếng Việt, giữ nguyên. */
function setupError(error: QueryError): Error {
  if (isNotMigrated(error)) {
    return new Error("Cơ sở dữ liệu chưa được cập nhật cho chức năng này (file supabase/007_ad_account_setup.sql chưa chạy).");
  }
  return new Error(error.message);
}

/**
 * Thêm một TKQC (màn Nhập liệu → Cài đặt TKQC). Nhân viên Ads thêm cho chính mình (`adsStaffId` = null);
 * quản lý thêm cho nhân viên được chọn.
 */
export async function addAdAccount(values: {
  name: string;
  accountId: string;
  accountKind: AdAccountKind;
  paymentKind: AdPaymentKind;
  adsStaffId: string | null;
}): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("add_ad_account", {
    p_name: values.name,
    p_account_id: values.accountId,
    p_account_kind: values.accountKind,
    p_payment_kind: values.paymentKind,
    p_ads_staff_id: values.adsStaffId,
  });
  if (error) throw setupError(error);
}

/**
 * Nút thùng rác ở Cài đặt TKQC. Trả về "trashed" (đã chuyển vào Thùng rác) hoặc "deactivated"
 * (TKQC đã có báo cáo → chỉ chuyển sang Ngừng dùng để giữ số liệu cũ).
 */
export async function removeAdAccount(id: string): Promise<"trashed" | "deactivated"> {
  const { data, error } = await getSupabaseBrowserClient().rpc("remove_ad_account", { p_id: id });
  if (error) throw setupError(error);
  return data as "trashed" | "deactivated";
}

/** Bật / tắt nhận lead cho một nhân viên. */
export async function setAcceptsLeads(userId: string, value: boolean): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("set_accepts_leads", {
    p_user_id: userId,
    p_value: value,
  });
  if (error) throw new Error(error.message);
}
