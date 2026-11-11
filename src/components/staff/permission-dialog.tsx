"use client";

import { useState } from "react";
import { toast } from "sonner";
import { errorText, useRole } from "@/components/safety/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isAdminRole } from "@/hooks/use-current-staff";
import type { StaffMember } from "@/lib/catalog/types";
import { NAV_SECTIONS, visiblePages } from "@/lib/nav";
import { setStaffCanDelete, setStaffCanExport } from "@/lib/safety/repo";
import { positionLabel } from "@/lib/staff/positions";
import { setStaffPageAccess } from "@/lib/staff/repo";

const ALL_PAGES = NAV_SECTIONS.flatMap((s) => s.modules.flatMap((m) => m.pages.map((p) => p.href)));
/** Số thứ tự của từng trang trong bảng phân quyền. */
const PAGE_NUMBER = new Map(ALL_PAGES.map((href, i) => [href, i + 1]));

/** Ô tick có trạng thái "một phần" (tick một vài trang trong phân hệ). */
function Tick({
  checked,
  partly = false,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  partly?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      className="size-4 accent-primary"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      ref={(el) => {
        if (el) el.indeterminate = partly && !checked;
      }}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/**
 * Nút "Phân quyền": tick trang nào thì trang đó hiện ở menu trái của người này (và mở được); không tick thì
 * ẩn. Kèm hai quyền riêng: Xoá dữ liệu (chuyển vào thùng rác), Xuất file.
 */
export function PermissionDialog({
  member,
  onClose,
  onSaved,
}: {
  member: StaffMember;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { isSuperAdmin } = useRole();
  const adminRole = isAdminRole(member.role);
  // Tài khoản cũ chưa phân quyền: tick sẵn đúng các trang đang thấy theo vai trò.
  const [pages, setPages] = useState<Set<string>>(() => new Set(member.page_access ?? visiblePages(member.role, null)));
  const [canDelete, setCanDelete] = useState(member.can_delete);
  const [canExport, setCanExport] = useState(member.can_export);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setMany = (hrefs: string[], on: boolean) =>
    setPages((prev) => {
      const next = new Set(prev);
      for (const href of hrefs) {
        if (on) next.add(href);
        else next.delete(href);
      }
      return next;
    });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setStaffPageAccess(member.user_id, ALL_PAGES.filter((href) => pages.has(href)));
      if (isSuperAdmin && canDelete !== member.can_delete) await setStaffCanDelete(member.user_id, canDelete);
      if (!adminRole && canExport !== member.can_export) await setStaffCanExport(member.user_id, canExport);
      await onSaved();
      toast.success(`Đã lưu phân quyền của ${member.full_name}`, {
        description: "Có hiệu lực từ lần tải trang kế tiếp của người đó.",
      });
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Phân quyền — {member.full_name}</DialogTitle>
          <DialogDescription>
            Vị trí: {positionLabel(member.position, member.role)}. Tick trang nào thì trang đó hiện ở menu trái của người
            này; không tick thì ẩn. Dữ liệu người này đọc / sửa được vẫn theo vị trí.
          </DialogDescription>
        </DialogHeader>

        {member.page_access === null && (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Tài khoản này đang thấy menu theo vai trò (đã tick sẵn các trang đó). Bấm Lưu để chuyển sang đúng các ô đã
            tick.
          </p>
        )}

        <section className="grid gap-2 rounded-lg border p-3">
          <h3 className="text-sm font-medium">Quyền riêng</h3>
          <label className="flex items-center gap-2 text-sm">
            <Tick
              checked={canDelete}
              disabled={!isSuperAdmin}
              label="Xoá dữ liệu"
              onChange={setCanDelete}
            />
            Xoá dữ liệu (thấy nút “Chuyển vào thùng rác”)
            {!isSuperAdmin && <span className="text-xs text-muted-foreground">— chỉ Quản trị cấp cao đổi được</span>}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Tick checked={adminRole || canExport} disabled={adminRole} label="Xuất file" onChange={setCanExport} />
            Xuất file (thấy nút “Tải Excel”)
            {adminRole && <span className="text-xs text-muted-foreground">— Quản trị luôn có</span>}
          </label>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Đang tick <b className="text-foreground">{pages.size}</b>/{ALL_PAGES.length} trang
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setMany(ALL_PAGES, true)}>
              Chọn tất cả
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setMany(ALL_PAGES, false)}>
              Bỏ chọn tất cả
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted text-left">
                <th className="w-10 px-3 py-2 text-right font-medium">TT</th>
                <th className="px-3 py-2 font-medium">Chức năng</th>
                <th className="w-16 px-3 py-2 text-center font-medium">Xem</th>
              </tr>
            </thead>
            <tbody>
              {NAV_SECTIONS.flatMap((section) =>
                section.modules.map((mod) => {
                  const hrefs = mod.pages.map((p) => p.href);
                  const ticked = hrefs.filter((h) => pages.has(h)).length;
                  return (
                    <ModuleRows
                      key={mod.title}
                      title={section.label ? `${section.label} › ${mod.title}` : mod.title}
                      all={ticked === hrefs.length}
                      partly={ticked > 0}
                      onAll={(on) => setMany(hrefs, on)}
                    >
                      {mod.pages.map((page) => {
                        return (
                          <tr key={page.href} className="border-b last:border-0 hover:bg-muted/40">
                            <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                              {PAGE_NUMBER.get(page.href)}
                            </td>
                            <td className="px-3 py-1.5 pl-6">{page.title}</td>
                            <td className="px-3 py-1.5 text-center">
                              <Tick
                                checked={pages.has(page.href)}
                                label={`Xem ${mod.title} › ${page.title}`}
                                onChange={(on) => setMany([page.href], on)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </ModuleRows>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Đang lưu…" : "Lưu phân quyền"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModuleRows({
  title,
  all,
  partly,
  onAll,
  children,
}: {
  title: string;
  all: boolean;
  partly: boolean;
  onAll: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="border-b bg-muted/60">
        <td />
        <td className="px-3 py-1.5 font-semibold">{title}</td>
        <td className="px-3 py-1.5 text-center">
          <Tick checked={all} partly={partly} label={`Xem toàn bộ ${title}`} onChange={onAll} />
        </td>
      </tr>
      {children}
    </>
  );
}
