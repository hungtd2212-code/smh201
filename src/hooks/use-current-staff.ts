"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { MISSING_COLUMN } from "@/lib/supabase/errors";

/**
 * Vai trò của một tài khoản. Mã giữ nguyên như trong cơ sở dữ liệu:
 * lead = Trưởng Telesale, sale = Telesale, page = Trực page.
 */
export type StaffRole =
  | "super_admin"
  | "admin"
  | "marketing_manager"
  | "ads_staff"
  | "lead"
  | "sale"
  | "page";

export const ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: "Quản trị cấp cao",
  admin: "Quản trị",
  marketing_manager: "Trưởng Marketing",
  ads_staff: "Nhân viên Ads",
  lead: "Trưởng Telesale",
  sale: "Telesale",
  page: "Trực page",
};

/** Thứ tự hiển thị các vai trò trong ô chọn. */
export const ROLE_ORDER: StaffRole[] = [
  "super_admin",
  "admin",
  "marketing_manager",
  "ads_staff",
  "lead",
  "sale",
  "page",
];

/** Quản trị cấp cao, Quản trị và Trưởng Telesale: hoàn tác lead, bật/tắt nhận lead của người khác, sửa dịch vụ. */
export const isManagerRole = (role: StaffRole) =>
  role === "super_admin" || role === "admin" || role === "lead";

/** Quản trị cấp cao, Quản trị và Trưởng Marketing: quản lý danh mục Marketing (kênh, page, TKQC, chiến dịch, bài post, nhân viên Ads). */
export const managesMarketingRole = (role: StaffRole) =>
  role === "super_admin" || role === "admin" || role === "marketing_manager";

/** Quản trị cấp cao và Quản trị: Thùng rác, Nhật ký hệ thống, khoá tài khoản. */
export const isAdminRole = (role: StaffRole) => role === "super_admin" || role === "admin";

export type CurrentStaff =
  /** Chưa kết nối Supabase — đang xem dữ liệu mẫu. */
  | { status: "demo" }
  | { status: "loading" }
  /** Đã đăng nhập và có tên trong bảng `staff`. */
  | {
      status: "ok";
      userId: string;
      email: string;
      fullName: string;
      role: StaffRole;
      /**
       * Được chuyển dữ liệu vào Thùng rác: Quản trị cấp cao luôn có; người khác chỉ khi được
       * tick ở Cài đặt → Tài khoản & Phân quyền. Nút "Chuyển vào thùng rác" chỉ hiện khi true.
       */
      canDelete: boolean;
      /**
       * Được xuất file: Quản trị luôn có; người khác chỉ khi được tick ở Cài đặt → Tài khoản &
       * Phân quyền. Nút "Tải Excel" chỉ hiện khi true.
       */
      canExport: boolean;
      /**
       * false = cơ sở dữ liệu chưa có ô tick quyền (chưa chạy supabase/004_delete_permission.sql).
       * Khi đó mọi thứ vẫn chạy bình thường, chỉ riêng trang tick quyền báo là chưa dùng được.
       */
      permissionsReady: boolean;
      /** Tên đăng nhập (null = tài khoản cũ đăng nhập bằng email). */
      username: string | null;
      /** Vị trí công việc (COO, Lead Ads…); null = tài khoản tạo trước khi có vị trí. */
      position: "coo" | "lead_ads" | "ads_staff" | "page" | null;
      /**
       * Các trang được xem (hiện ở menu trái). null = tài khoản cũ: menu theo vai trò như trước.
       * Quản trị cấp cao luôn thấy mọi trang.
       */
      pageAccess: string[] | null;
    }
  /** Đã đăng nhập nhưng chưa được thêm vào bảng `staff` → chưa có quyền xem dữ liệu. */
  | { status: "no-access"; email: string }
  /** Tài khoản đang bị khoá (quản trị khoá, hoặc hệ thống tự khoá vì thao tác bất thường). */
  | { status: "locked"; email: string; reason: string | null }
  | { status: "error"; message: string };

type OwnStaffRow = {
  full_name: string;
  role: StaffRole;
  locked_at: string | null;
  locked_reason: string | null;
  can_delete?: boolean;
  can_export?: boolean;
  username?: string | null;
  position?: "coo" | "lead_ads" | "ads_staff" | "page" | null;
  page_access?: string[] | null;
};

/**
 * Dòng staff của chính người đang đăng nhập. Cột can_delete do file 004 thêm vào, can_export do
 * file 005; cơ sở dữ liệu chưa chạy file nào thì đọc lại không kèm cột đó, để việc đăng nhập
 * không bị hỏng theo.
 */
async function fetchOwnStaffRow(userId: string) {
  const supabase = getSupabaseBrowserClient();
  const attempts = [
    "full_name, role, locked_at, locked_reason, can_delete, can_export, username, position, page_access",
    "full_name, role, locked_at, locked_reason, can_delete, can_export",
    "full_name, role, locked_at, locked_reason, can_delete",
    "full_name, role, locked_at, locked_reason",
  ];
  for (const [index, columns] of attempts.entries()) {
    const result = await supabase.from("staff").select(columns).eq("user_id", userId).maybeSingle();
    const isLast = index === attempts.length - 1;
    if (result.error?.code === MISSING_COLUMN && !isLast) continue;
    return {
      row: result.data as OwnStaffRow | null,
      error: result.error,
      permissionsReady: columns.includes("can_delete"),
    };
  }
  throw new Error("unreachable");
}

async function loadCurrentStaff(): Promise<CurrentStaff> {
  const supabase = getSupabaseBrowserClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return { status: "error", message: authError?.message ?? "Chưa đăng nhập" };
  }
  const email = auth.user.email ?? "";

  // RLS luôn cho mỗi người thấy dòng staff của chính mình (kể cả khi đang bị khoá).
  const { row: data, error, permissionsReady } = await fetchOwnStaffRow(auth.user.id);

  if (error) return { status: "error", message: error.message };
  if (!data) return { status: "no-access", email };
  if (data.locked_at) {
    return { status: "locked", email, reason: data.locked_reason ?? null };
  }
  return {
    status: "ok",
    userId: auth.user.id,
    email,
    fullName: data.full_name,
    role: data.role,
    canDelete: data.role === "super_admin" || data.can_delete === true,
    canExport: isAdminRole(data.role) || data.can_export === true,
    permissionsReady,
    username: data.username ?? null,
    position: data.position ?? null,
    pageAccess: data.page_access ?? null,
  };
}

// Nhiều thành phần trên cùng một trang cùng hỏi "tôi là ai" → chỉ gọi máy chủ một lần.
// (Đăng nhập / đăng xuất đều tải lại toàn trang nên bộ nhớ này tự được làm mới.)
let pending: Promise<CurrentStaff> | null = null;
function loadOnce(): Promise<CurrentStaff> {
  pending ??= loadCurrentStaff().then((result) => {
    if (result.status === "error") pending = null; // lỗi mạng → lần sau thử lại
    return result;
  });
  return pending;
}

/** Người đang đăng nhập là ai và có vai trò gì. */
export function useCurrentStaff(): CurrentStaff {
  const [staff, setStaff] = useState<CurrentStaff>(
    isSupabaseConfigured ? { status: "loading" } : { status: "demo" },
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    loadOnce().then((result) => {
      if (!cancelled) setStaff(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return staff;
}
