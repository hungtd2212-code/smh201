import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";
import type { Position } from "./positions";

/**
 * Danh sách cơ sở và quản lý tài khoản người dùng (supabase/008_staff_accounts.sql). Mọi kiểm tra quyền
 * nằm ở cơ sở dữ liệu; ở đây chỉ gọi và đổi lỗi sang lời dễ hiểu.
 */

type QueryError = { message: string; code?: string };

const NOT_READY =
  "Cơ sở dữ liệu chưa được cập nhật cho chức năng này (file supabase/008_staff_accounts.sql chưa chạy).";

function fail(error: QueryError, duplicate?: string): never {
  if (isNotMigrated(error)) throw new Error(NOT_READY);
  if (error.code === "23505" && duplicate) throw new Error(duplicate);
  if (/row-level security|permission denied/i.test(error.message)) {
    throw new Error("Bạn không có quyền làm việc này.");
  }
  throw new Error(error.message);
}

export type Branch = {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
};

/** Danh sách cơ sở; null nếu cơ sở dữ liệu chưa chạy file 008. */
export async function fetchBranches(): Promise<Branch[] | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("branches")
    .select("id, name, address, is_active")
    .order("created_at");
  if (isNotMigrated(error)) return null;
  if (error) fail(error);
  return data as Branch[];
}

export async function saveBranch(
  id: string | null,
  values: { name: string; address: string | null; is_active: boolean },
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const duplicate = "Đã có cơ sở tên này.";
  if (!id) {
    const { error } = await supabase.from("branches").insert(values);
    if (error) fail(error, duplicate);
    return;
  }
  const { data, error } = await supabase.from("branches").update(values).eq("id", id).select("id");
  if (error) fail(error, duplicate);
  if (data.length === 0) throw new Error("Không lưu được: bạn không có quyền sửa cơ sở này.");
}

/** Thêm người: tạo tài khoản đăng nhập và dòng nhân sự. Trả về id tài khoản. */
export async function createStaffAccount(values: {
  username: string;
  password: string;
  fullName: string;
  position: Position;
  branchId: string;
}): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient().rpc("create_staff_account", {
    p_username: values.username,
    p_password: values.password,
    p_full_name: values.fullName,
    p_position: values.position,
    p_branch_id: values.branchId,
  });
  if (error) fail(error);
  return data as string;
}

/** Sửa tên, vị trí (null = giữ nguyên), nơi làm việc. */
export async function updateStaffAccount(
  userId: string,
  values: { fullName: string; position: Position | null; branchId: string | null },
): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("update_staff_account", {
    p_user_id: userId,
    p_full_name: values.fullName,
    p_position: values.position,
    p_branch_id: values.branchId,
  });
  if (error) fail(error);
}

export async function resetStaffPassword(userId: string, password: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("reset_staff_password", {
    p_user_id: userId,
    p_password: password,
  });
  if (error) fail(error);
}

/** Xoá nhân sự: ẩn khỏi danh sách và cấm đăng nhập (không xoá hẳn). */
export async function removeStaffAccount(userId: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("remove_staff_account", { p_user_id: userId });
  if (error) fail(error);
}

/** Các trang người này được xem (hiện ở menu trái). */
export async function setStaffPageAccess(userId: string, pages: string[]): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("set_staff_page_access", {
    p_user_id: userId,
    p_pages: pages,
  });
  if (error) fail(error);
}

/** Email đăng nhập của từng tài khoản (chỉ Quản trị). Rỗng nếu chưa chạy file 008. */
export async function fetchStaffLogins(): Promise<Map<string, string>> {
  const { data, error } = await getSupabaseBrowserClient().rpc("list_staff_logins");
  if (error) return new Map();
  return new Map((data as { user_id: string; email: string }[]).map((row) => [row.user_id, row.email]));
}

/** Người đang đăng nhập tự đổi mật khẩu (phải nhập đúng mật khẩu hiện tại). */
export async function changeOwnPassword(current: string, next: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) throw new Error("Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.");
  const check = await supabase.auth.signInWithPassword({ email, password: current });
  if (check.error) {
    throw new Error(check.error.code === "invalid_credentials" ? "Mật khẩu hiện tại không đúng." : check.error.message);
  }
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    throw new Error(
      error.code === "same_password"
        ? "Mật khẩu mới phải khác mật khẩu hiện tại."
        : error.code === "weak_password"
          ? "Mật khẩu mới quá yếu — hãy dùng ít nhất 8 ký tự."
          : error.message,
    );
  }
}
