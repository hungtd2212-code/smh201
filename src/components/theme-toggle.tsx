"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setDarkMode } from "@/hooks/use-theme";

export function ThemeToggle() {
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Đổi giao diện sáng / tối"
      onClick={() =>
        setDarkMode(!document.documentElement.classList.contains("dark"))
      }
    >
      {/* Dùng CSS để chọn icon → không lệch giữa server và trình duyệt. */}
      <Moon className="dark:hidden" />
      <Sun className="hidden dark:block" />
    </Button>
  );
}
