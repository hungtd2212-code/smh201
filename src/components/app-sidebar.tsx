"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BrandLockup } from "@/components/brand-logo";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/components/user-menu";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { APP } from "@/lib/config";
import { navSectionsFor } from "@/lib/nav";

/**
 * Menu trái: Nhóm → Phân hệ (bấm để mở/đóng) → Trang.
 * Nội dung menu lấy từ src/lib/nav.ts.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const staff = useCurrentStaff();
  // Mỗi vai trò chỉ thấy các mục dành cho mình (vd Nhân viên Ads chỉ thấy phân hệ Marketing).
  const sections = navSectionsFor(staff.status === "ok" ? staff.role : null);

  // Phân hệ chứa trang đang xem thì tự mở; các lần người dùng tự bấm mở/đóng được nhớ ở đây.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" aria-label={`${APP.name} — trang chủ`} className="rounded-md p-2">
          <BrandLockup />
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 pb-2">
        {sections.map((section) => (
          <SidebarGroup key={section.label ?? "tong-quan"} className="py-1">
            {section.label && (
              <SidebarGroupLabel className="h-7 text-[0.6875rem] font-semibold tracking-wider text-sidebar-foreground/55 uppercase">
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.modules.map((mod) => {
                  const hasCurrentPage = mod.pages.some((p) => p.href === pathname);
                  const open = toggled[mod.title] ?? hasCurrentPage;

                  return (
                    <Collapsible
                      key={mod.title}
                      asChild
                      open={open}
                      onOpenChange={(next) =>
                        setToggled((prev) => ({ ...prev, [mod.title]: next }))
                      }
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          {/* Khi đang đóng mà chứa trang hiện tại thì tô sáng để biết mình đang ở đâu. */}
                          <SidebarMenuButton isActive={hasCurrentPage && !open}>
                            <mod.icon />
                            <span>{mod.title}</span>
                            <ChevronRight className="ml-auto text-sidebar-foreground/50 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {mod.pages.map((page) => (
                              <SidebarMenuSubItem key={page.href}>
                                {/* Tên dài thì xuống dòng thay vì bị cắt "…". */}
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={pathname === page.href}
                                  className="h-auto min-h-7 py-1 [&>span:last-child]:whitespace-normal"
                                >
                                  <Link href={page.href} title={page.title}>
                                    <span>{page.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
