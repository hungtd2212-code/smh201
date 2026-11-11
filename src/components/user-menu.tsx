"use client";

import { EllipsisVertical, LogOut } from "lucide-react";
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
import { ROLE_LABELS, useCurrentStaff } from "@/hooks/use-current-staff";
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

/** Ô người dùng ở cuối menu trái: tên, vai trò và nút đăng xuất. */
export function UserMenu() {
  const staff = useCurrentStaff();

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
  const detail =
    staff.status === "ok"
      ? ROLE_LABELS[staff.role]
      : staff.status === "no-access"
        ? "Chưa được cấp quyền"
        : staff.status === "locked"
          ? "Tài khoản bị khoá"
          : staff.status === "error"
            ? "Lỗi tải tài khoản"
            : "Đang tải…";
  const email =
    staff.status === "ok" || staff.status === "no-access" || staff.status === "locked"
      ? staff.email
      : null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <Avatar className="size-8">
                <AvatarFallback>{initials(name)}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 leading-tight">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{detail}</span>
              </span>
              <EllipsisVertical className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="min-w-52">
            {email && (
              <>
                <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={signOut}>
              <LogOut />
              Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
