"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { MISSING_COLUMN } from "@/lib/supabase/errors";

export type StaffRole = "super_admin" | "admin" | "lead" | "sale" | "page";

export const ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: "Quản trị cấp cao",
  admin: "Quản trị",
  lead: "Lead",
  sale: "Telesale",
  page: "Trực page",
};

/** Quản trị cấp cao, Quản trị và Lead: sửa danh mục, hoàn tác lead, bật/tắt nhận lead của người khác. */
export const isManagerRole = (role: StaffRole) =>
  role === "super_admin" || role === "admin" || role === "lead";

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
       * false = cơ sở dữ liệu chưa có ô tick quyền (chưa chạy supabase/004_delete_permission.sql).
       * Khi đó mọi thứ vẫn chạy bình thường, chỉ riêng trang tick quyền báo là chưa dùng được.
       */
      permissionsReady: boolean;
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
};

/**
 * Dòng staff của chính người đang đăng nhập. Cột can_delete do file 004 thêm vào; cơ sở dữ liệu
 * chưa chạy file đó thì đọc lại không kèm cột này, để việc đăng nhập không bị hỏng theo.
 */
async function fetchOwnStaffRow(userId: string) {
  const supabase = getSupabaseBrowserClient();
  const full = await supabase
    .from("staff")
    .select("full_name, role, locked_at, locked_reason, can_delete")
    .eq("user_id", userId)
    .maybeSingle();
  if (full.error?.code !== MISSING_COLUMN) {
    return { row: full.data as OwnStaffRow | null, error: full.error, permissionsReady: true };
  }
  const basic = await supabase
    .from("staff")
    .select("full_name, role, locked_at, locked_reason")
    .eq("user_id", userId)
    .maybeSingle();
  return { row: basic.data as OwnStaffRow | null, error: basic.error, permissionsReady: false };
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
    permissionsReady,
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
