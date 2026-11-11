"use client";

import { UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CatalogGate, PageHeader } from "@/components/catalog/shared";
import { useCatalogs } from "@/components/catalog-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS, ROLE_ORDER, isAdminRole, type StaffRole } from "@/hooks/use-current-staff";
import type { StaffMember } from "@/lib/catalog/types";
import { setStaffCanDelete, setStaffCanExport, setStaffRole } from "@/lib/safety/repo";
import { AdminOnly, errorText, useRole } from "./shared";

/**
 * Cài đặt → Tài khoản & Phân quyền: vai trò của từng tài khoản và hai quyền tick riêng
 * ("Xoá dữ liệu", "Xuất file"). Máy chủ kiểm tra đúng các ô này, không chỉ ẩn nút trên màn hình.
 */
export function AccountsManager() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={UserCog}
        title="Tài khoản & Phân quyền"
        description="Các tài khoản đang dùng hệ thống, vai trò và quyền được tick riêng cho từng người."
      />
      <AdminOnly>
        <CatalogGate>
          <AccountsTable />
        </CatalogGate>
      </AdminOnly>
    </div>
  );
}

function AccountsTable() {
  const { catalogs, reload } = useCatalogs();
  const { userId, isSuperAdmin, permissionsReady } = useRole();
  const [saving, setSaving] = useState<string | null>(null);
  // Đổi vai trò và quyền "Xuất file" cần cơ sở dữ liệu đã chạy file 005.
  const rolesReady = catalogs.marketingReady;

  async function run(member: StaffMember, action: () => Promise<void>, done: string, failed: string) {
    setSaving(member.user_id);
    try {
      await action();
      await reload();
      toast.success(`${member.full_name}: ${done}`, {
        description: "Có hiệu lực từ lần tải trang kế tiếp của người đó.",
      });
    } catch (error) {
      toast.error(failed, { description: errorText(error) });
    } finally {
      setSaving(null);
    }
  }

  const toggleDelete = (member: StaffMember) =>
    run(
      member,
      () => setStaffCanDelete(member.user_id, !member.can_delete),
      member.can_delete ? "đã thu quyền xoá dữ liệu" : "đã cấp quyền xoá dữ liệu",
      "Không đổi được quyền",
    );

  const toggleExport = (member: StaffMember) =>
    run(
      member,
      () => setStaffCanExport(member.user_id, !member.can_export),
      member.can_export ? "đã thu quyền xuất file" : "đã cấp quyền xuất file",
      "Không đổi được quyền",
    );

  const changeRole = (member: StaffMember, role: StaffRole) =>
    run(member, () => setStaffRole(member.user_id, role), `đã đổi vai trò thành ${ROLE_LABELS[role]}`, "Không đổi được vai trò");

  /** Người đang đăng nhập có được đổi vai trò của tài khoản này không (máy chủ kiểm tra lại đúng như vậy). */
  const canChangeRole = (member: StaffMember) =>
    rolesReady &&
    member.user_id !== userId &&
    member.role !== "super_admin" &&
    (isSuperAdmin || member.role !== "admin");

  return (
    <>
      {!permissionsReady && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Ô tick “Xoá dữ liệu” chưa dùng được: cơ sở dữ liệu chưa được cập nhật cho chức năng này (file{" "}
          <code>supabase/004_delete_permission.sql</code> chưa chạy). Cho tới lúc đó, nút “Chuyển vào thùng
          rác” chỉ hiện với Quản trị cấp cao.
        </p>
      )}
      {!rolesReady && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Đổi vai trò và ô tick “Xuất file” chưa dùng được: cơ sở dữ liệu chưa được cập nhật cho phân hệ
          Marketing (file <code>supabase/005_marketing_catalog.sql</code> chưa chạy). Cho tới lúc đó, nút “Tải
          Excel” chỉ hiện với Quản trị.
        </p>
      )}
      {permissionsReady && !isSuperAdmin && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Ô “Xoá dữ liệu” và vai trò Quản trị chỉ Quản trị cấp cao đổi được. Bạn đổi được các vai trò khác và ô
          “Xuất file”.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Tài khoản</TableHead>
              <TableHead>Vai trò</TableHead>
              <TableHead>Xoá dữ liệu</TableHead>
              <TableHead>Xuất file</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {catalogs.staff.map((member) => {
              const alwaysDelete = member.role === "super_admin";
              const alwaysExport = isAdminRole(member.role);
              const busy = saving === member.user_id;
              return (
                <TableRow key={member.user_id}>
                  <TableCell className="font-medium">
                    {member.full_name}
                    {member.user_id === userId && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">(bạn)</span>
                    )}
                    {member.locked_at && (
                      <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-800 dark:bg-red-900/50 dark:text-red-200">
                        Đang bị khoá
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canChangeRole(member) ? (
                      <Select
                        value={member.role}
                        disabled={busy}
                        onValueChange={(role) => {
                          if (role !== member.role) void changeRole(member, role as StaffRole);
                        }}
                      >
                        <SelectTrigger className="w-48" aria-label={`Vai trò của ${member.full_name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_ORDER.filter(
                            (role) => role !== "super_admin" && (isSuperAdmin || role !== "admin"),
                          ).map((role) => (
                            <SelectItem key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      ROLE_LABELS[member.role]
                    )}
                  </TableCell>
                  <TableCell>
                    <label className="flex w-fit items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        aria-label={`Quyền xoá dữ liệu: ${member.full_name}`}
                        checked={alwaysDelete || member.can_delete}
                        disabled={alwaysDelete || !isSuperAdmin || !permissionsReady || busy}
                        onChange={() => toggleDelete(member)}
                      />
                      <span className="text-muted-foreground">
                        {alwaysDelete ? "Luôn có" : member.can_delete ? "Được xoá" : "Không"}
                      </span>
                    </label>
                  </TableCell>
                  <TableCell>
                    <label className="flex w-fit items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        aria-label={`Quyền xuất file: ${member.full_name}`}
                        checked={alwaysExport || member.can_export}
                        disabled={alwaysExport || !rolesReady || busy}
                        onChange={() => toggleExport(member)}
                      />
                      <span className="text-muted-foreground">
                        {alwaysExport ? "Luôn có" : member.can_export ? "Được xuất" : "Không"}
                      </span>
                    </label>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-1 text-sm text-muted-foreground">
        <li>
          • Vai trò quyết định mỗi người thấy và làm được gì: Trưởng Marketing quản lý toàn bộ Marketing; Nhân viên
          Ads chỉ thấy TKQC, chiến dịch, bài post của mình; Telesale chỉ thấy lead của mình; Trực page nhập lead.
        </li>
        <li>
          • Chỉ tài khoản được tick “Xoá dữ liệu” mới thấy nút “Chuyển vào thùng rác”. Dữ liệu chuyển vào thùng
          rác không mất: Quản trị khôi phục được trong Cài đặt → Thùng rác.
        </li>
        <li>
          • Với danh mục, ngoài ô tick còn phải đúng vai trò quản lý: Quản trị hoặc Trưởng Marketing (kênh, page,
          TKQC, chiến dịch, bài post, nhân viên Ads); Quản trị hoặc Trưởng Telesale (dịch vụ).
        </li>
        <li>• Xoá vĩnh viễn không nằm trong quyền này: chỉ Quản trị cấp cao làm được, trong Thùng rác.</li>
        <li>
          • Chỉ tài khoản được tick “Xuất file” (và Quản trị) mới thấy nút “Tải Excel”. Mỗi lần xuất file đều
          được ghi sổ: ai xuất, lúc nào, bao nhiêu dòng.
        </li>
        <li>• Mỗi lần đổi vai trò, tick hoặc bỏ tick đều được ghi vào Nhật ký hệ thống.</li>
        <li>• Tạo tài khoản đăng nhập mới hiện vẫn làm trong Supabase; sau đó đổi vai trò ở trang này.</li>
      </ul>
    </>
  );
}
