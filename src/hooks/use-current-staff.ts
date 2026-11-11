"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export type StaffRole = "admin" | "lead" | "sale";

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Quản trị",
  lead: "Lead",
  sale: "Sale",
};

export type CurrentStaff =
  /** Chưa kết nối Supabase — đang xem dữ liệu mẫu. */
  | { status: "demo" }
  | { status: "loading" }
  /** Đã đăng nhập và có tên trong bảng `staff`. */
  | { status: "ok"; email: string; fullName: string; role: StaffRole }
  /** Đã đăng nhập nhưng chưa được thêm vào bảng `staff` → chưa có quyền xem dữ liệu. */
  | { status: "no-access"; email: string }
  | { status: "error"; message: string };

async function loadCurrentStaff(): Promise<CurrentStaff> {
  const supabase = getSupabaseBrowserClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return { status: "error", message: authError?.message ?? "Chưa đăng nhập" };
  }
  const email = auth.user.email ?? "";

  // RLS chỉ cho mỗi người thấy đúng dòng staff của chính mình.
  const { data, error } = await supabase
    .from("staff")
    .select("full_name, role")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) return { status: "error", message: error.message };
  if (!data) return { status: "no-access", email };
  return {
    status: "ok",
    email,
    fullName: data.full_name as string,
    role: data.role as StaffRole,
  };
}

/** Người đang đăng nhập là ai và có vai trò gì. */
export function useCurrentStaff(): CurrentStaff {
  const [staff, setStaff] = useState<CurrentStaff>(
    isSupabaseConfigured ? { status: "loading" } : { status: "demo" },
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    loadCurrentStaff().then((result) => {
      if (!cancelled) setStaff(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return staff;
}
