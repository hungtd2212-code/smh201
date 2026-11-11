"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchOpenAlerts } from "@/lib/safety/repo";
import { useRole } from "./shared";

/**
 * Nút cảnh báo trên thanh trên cùng: chỉ hiện với Quản trị, và chỉ khi đang có cảnh báo
 * thao tác bất thường chưa xử lý. Bấm vào để tới Nhật ký hệ thống.
 */
export function SecurityAlertBell() {
  const { isAdmin } = useRole();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetchOpenAlerts()
      .then((alerts) => !cancelled && setCount(alerts.length))
      .catch(() => undefined); // không tải được thì thôi, không chặn màn hình đang dùng
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!isAdmin || count === 0) return null;

  return (
    <Button asChild variant="destructive" size="sm">
      <Link href="/cai-dat/nhat-ky">
        <ShieldAlert />
        {count} cảnh báo bất thường
      </Link>
    </Button>
  );
}
