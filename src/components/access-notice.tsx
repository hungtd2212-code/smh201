import { Lock, ShieldAlert } from "lucide-react";
import type { CurrentStaff } from "@/hooks/use-current-staff";

/**
 * Thông báo khi người đang đăng nhập không dùng được dữ liệu: chưa được cấp quyền,
 * hoặc tài khoản đang bị khoá. Trả về null nếu tài khoản bình thường.
 */
export function AccessNotice({ staff }: { staff: CurrentStaff }) {
  if (staff.status === "no-access") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>
          Tài khoản <strong>{staff.email}</strong> đã đăng nhập nhưng chưa được cấp quyền
          nên chưa xem được dữ liệu. Quản trị viên cần thêm tài khoản này vào bảng{" "}
          <code>staff</code> trong Supabase (xem cuối file supabase/schema.sql).
        </span>
      </div>
    );
  }

  if (staff.status === "locked") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
        <Lock className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>
          Tài khoản <strong>{staff.email}</strong> đang <strong>bị khoá</strong> nên không
          xem hay sửa được dữ liệu.
          {staff.reason && <> Lý do: {staff.reason}.</>} Hãy liên hệ Quản trị để được mở khoá.
        </span>
      </div>
    );
  }

  return null;
}
