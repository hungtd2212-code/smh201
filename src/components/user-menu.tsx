"use client";

import { EllipsisVertical, ImageUp, KeyRound, LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { AvatarPicker, type AvatarChoice } from "@/components/staff/avatar-picker";
import { ChangePasswordDialog } from "@/components/staff/change-password-dialog";
import { StaffAvatar } from "@/components/staff/staff-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clearAvatar, uploadAvatar } from "@/lib/staff/avatar";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { loginName, positionLabel } from "@/lib/staff/positions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Lấy 2 chữ cái đầu để làm ảnh đại diện: "Thu Hà" → "TH". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "?";

/** Ô người dùng ở cuối menu trái: tên, tên đăng nhập, vị trí; bấm "⋮" để đổi mật khẩu / đăng xuất. */
export function UserMenu() {
  const staff = useCurrentStaff();
  const [changingPassword, setChangingPassword] = useState(false);
  const [changingAvatar, setChangingAvatar] = useState(false);

  if (staff.status === "demo") {
    return (
      <div className="flex items-center gap-2.5 p-2">
        <Avatar className="size-8">
          <AvatarFallback>XT</AvatarFallback>
        </Avatar>
        <div className="grid leading-tight">
          <span className="text-sm font-medium">Chưa kết nối</span>
          <span className="text-xs text-muted-foreground">Chưa kết nối Supabase</span>
        </div>
      </div>
    );
  }

  async function signOut() {
    const { error } = await getSupabaseBrowserClient().auth.signOut();
    if (error) {
      toast.error("Không đăng xuất được", { description: error.message });
      return;
    }
    // Tải lại toàn trang để xoá sạch dữ liệu của phiên vừa đăng xuất khỏi bộ nhớ.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- cố ý tải lại toàn trang
    window.location.assign("/login");
  }

  const name =
    staff.status === "ok"
      ? staff.fullName
      : staff.status === "no-access" || staff.status === "locked"
        ? staff.email.split("@")[0]
        : "…";
  const login =
    staff.status === "ok" ? (staff.username ?? loginName(staff.email)) : null;
  const position = staff.status === "ok" ? positionLabel(staff.position, staff.role) : null;
  const detail =
    staff.status === "ok"
      ? `${login} · ${position}`
      : staff.status === "no-access"
        ? "Chưa được cấp quyền"
        : staff.status === "locked"
          ? "Tài khoản bị khoá"
          : staff.status === "error"
            ? "Lỗi tải tài khoản"
            : "Đang tải…";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              {staff.status === "ok" && staff.avatarUrl ? (
                <StaffAvatar name={name} url={staff.avatarUrl} />
              ) : (
                <Avatar className="size-8">
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
              )}
              <span className="grid flex-1 leading-tight">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{detail}</span>
              </span>
              <EllipsisVertical className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="min-w-56">
            {staff.status === "ok" && (
              <>
                <DropdownMenuLabel className="grid gap-0.5 font-normal">
                  <span className="truncate font-medium">{name}</span>
                  <span className="truncate text-xs text-muted-foreground">Tên đăng nhập: {login}</span>
                  <span className="truncate text-xs text-muted-foreground">Vị trí: {position}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setChangingPassword(true)}>
                  <KeyRound />
                  Đổi mật khẩu
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setChangingAvatar(true)}>
                  <ImageUp />
                  Đổi ảnh đại diện
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onSelect={signOut}>
              <LogOut />
              Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ChangePasswordDialog open={changingPassword} onOpenChange={setChangingPassword} />
        {staff.status === "ok" && changingAvatar && (
          <OwnAvatarDialog
            userId={staff.userId}
            name={staff.fullName}
            current={staff.avatarUrl}
            onClose={() => setChangingAvatar(false)}
          />
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Tự đổi ảnh đại diện của mình (menu tên ở cuối menu trái). */
function OwnAvatarDialog({
  userId,
  name,
  current,
  onClose,
}: {
  userId: string;
  name: string;
  current: string | null;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<AvatarChoice>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      if (choice instanceof File) await uploadAvatar(userId, choice);
      else if (choice === "remove") await clearAvatar(userId);
      toast.success("Đã lưu ảnh đại diện");
      // Tải lại để mọi chỗ hiện ảnh mới.
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      toast.error("Không lưu được ảnh", { description: error instanceof Error ? error.message : String(error) });
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ảnh đại diện</DialogTitle>
          <DialogDescription>Ảnh hiện ở menu, báo cáo và bảng vinh danh.</DialogDescription>
        </DialogHeader>
        <AvatarPicker name={name} current={current} value={choice} onChange={setChoice} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={save} disabled={saving || choice === null}>
            {saving ? "Đang lưu…" : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
