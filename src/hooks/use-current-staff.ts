"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export type StaffRole = "super_admin" | "admin" | "lead" | "sale" | "page";

export const ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: "Quản trị cấp cao",
  admin: "Quản trị",
  lead: "Lead",
  sale: "Telesale",
  page: "Trực page",
};

/** Quản trị cấp cao, Quản trị và Lead: sửa danh mục, chuyển lead vào Thùng rác, bật/tắt nhận lead của người khác. */
export const isManagerRole = (role: StaffRole) =>
  role === "super_admin" || role === "admin" || role === "lead";

/** Quản trị cấp cao và Quản trị: Thùng rác, Nhật ký hệ thống, khoá tài khoản. */
export const isAdminRole = (role: StaffRole) => role === "super_admin" || role === "admin";

export type CurrentStaff =
  /** Chưa kết nối Supabase — đang xem dữ liệu mẫu. */
  | { status: "demo" }
  | { status: "loading" }
  /** Đã đăng nhập và có tên trong bảng `staff`. */
  | { status: "ok"; userId: string; email: string; fullName: string; role: StaffRole }
  /** Đã đăng nhập nhưng chưa được thêm vào bảng `staff` → chưa có quyền xem dữ liệu. */
  | { status: "no-access"; email: string }
  /** Tài khoản đang bị khoá (quản trị khoá, hoặc hệ thống tự khoá vì thao tác bất thường). */
  | { status: "locked"; email: string; reason: string | null }
  | { status: "error"; message: string };

async function loadCurrentStaff(): Promise<CurrentStaff> {
  const supabase = getSupabaseBrowserClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return { status: "error", message: authError?.message ?? "Chưa đăng nhập" };
  }
  const email = auth.user.email ?? "";

  // RLS luôn cho mỗi người thấy dòng staff của chính mình (kể cả khi đang bị khoá).
  const { data, error } = await supabase
    .from("staff")
    .select("full_name, role, locked_at, locked_reason")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) return { status: "error", message: error.message };
  if (!data) return { status: "no-access", email };
  if (data.locked_at) {
    return { status: "locked", email, reason: (data.locked_reason as string | null) ?? null };
  }
  return {
    status: "ok",
    userId: auth.user.id,
    email,
    fullName: data.full_name as string,
    role: data.role as StaffRole,
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
