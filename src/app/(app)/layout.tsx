import { AppSidebar } from "@/components/app-sidebar";
import { CatalogProvider } from "@/components/catalog-provider";
import { SecurityAlertBell } from "@/components/safety/security-alert-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { APP } from "@/lib/config";

/** Khung chung của mọi trang sau đăng nhập: menu trái + thanh trên cùng. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    // Menu rộng hơn mặc định một chút (17rem) vì nhiều tên mục khá dài.
    <SidebarProvider style={{ "--sidebar-width": "17rem" } as React.CSSProperties}>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-13 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
          <SidebarTrigger aria-label="Ẩn / hiện menu" />
          <Separator orientation="vertical" className="mx-1 h-4!" />
          <span className="text-sm text-muted-foreground">
            Cơ sở {APP.branch.name}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <SecurityAlertBell />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <CatalogProvider>{children}</CatalogProvider>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
