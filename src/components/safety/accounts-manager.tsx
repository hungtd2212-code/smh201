"use client";

import { UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CatalogGate, PageHeader } from "@/components/catalog/shared";
import { useCatalogs } from "@/components/catalog-provider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/hooks/use-current-staff";
import type { StaffMember } from "@/lib/catalog/types";
import { setStaffCanDelete } from "@/lib/safety/repo";
import { AdminOnly, errorText, useRole } from "./shared";

/**
 * Cài đặt → Tài khoản & Phân quyền: danh sách tài khoản và ô tick quyền "Xoá dữ liệu".
 * Chỉ tài khoản được tick mới thấy nút "Chuyển vào thùng rác"; máy chủ cũng kiểm tra đúng ô này.
 */
export function AccountsManager() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={UserCog}
        title="Tài khoản & Phân quyền"
        description="Các tài khoản đang dùng hệ thống và quyền được tick riêng cho từng người."
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
  const { userId, isSuperAdmin } = useRole();
  const [saving, setSaving] = useState<string | null>(null);

  async function toggle(member: StaffMember) {
    const allowed = !member.can_delete;
    setSaving(member.user_id);
    try {
      await setStaffCanDelete(member.user_id, allowed);
      await reload();
      toast.success(
        `${member.full_name}: ${allowed ? "đã cấp quyền xoá dữ liệu" : "đã thu quyền xoá dữ liệu"}`,
        { description: "Có hiệu lực từ lần tải trang kế tiếp của người đó." },
      );
    } catch (error) {
      toast.error("Không đổi được quyền", { description: errorText(error) });
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      {!isSuperAdmin && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Bạn đang xem ở chế độ chỉ đọc: chỉ Quản trị cấp cao tick hoặc bỏ tick được.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Tài khoản</TableHead>
              <TableHead>Vai trò</TableHead>
              <TableHead>Xoá dữ liệu</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {catalogs.staff.map((member) => {
              const always = member.role === "super_admin";
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
                  <TableCell>{ROLE_LABELS[member.role]}</TableCell>
                  <TableCell>
                    <label className="flex w-fit items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        aria-label={`Quyền xoá dữ liệu: ${member.full_name}`}
                        checked={always || member.can_delete}
                        disabled={always || !isSuperAdmin || saving === member.user_id}
                        onChange={() => toggle(member)}
                      />
                      <span className="text-muted-foreground">
                        {always ? "Luôn có" : member.can_delete ? "Được xoá" : "Không"}
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
          • Chỉ tài khoản được tick mới thấy nút “Chuyển vào thùng rác”. Dữ liệu chuyển vào thùng
          rác không mất: Quản trị khôi phục được trong Cài đặt → Thùng rác.
        </li>
        <li>• Với danh mục (kênh, page, chiến dịch, dịch vụ), ngoài ô tick còn phải là Quản trị hoặc Lead.</li>
        <li>• Xoá vĩnh viễn không nằm trong quyền này: chỉ Quản trị cấp cao làm được, trong Thùng rác.</li>
        <li>• Mỗi lần tick hoặc bỏ tick đều được ghi vào Nhật ký hệ thống.</li>
        <li>• Thêm tài khoản mới và đổi vai trò hiện chưa làm được trên trang này.</li>
      </ul>
    </>
  );
}
