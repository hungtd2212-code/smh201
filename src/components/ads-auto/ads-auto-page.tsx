"use client";

import { FlaskConical } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CatalogGate, PageHeader, ReadOnlyNote, useManagesMarketing, useTodayVn } from "@/components/catalog/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import type { AutoStatus } from "@/lib/ads-auto/compare";
import { ADS_AUTO_NOT_READY, collectAutoNow, fetchAutoStatus } from "@/lib/ads-auto/repo";
import { CompareSection } from "./compare-section";
import { ConnectionCard } from "./connection-card";

/**
 * Marketing → Ads tự động (THỬ NGHIỆM). Tự kéo chi tiêu + số tin nhắn của từng TKQC từ Facebook về một khu riêng
 * (supabase/027_ads_auto_test.sql) và so với số nhân viên nhập tay ở Nhập liệu. Không ghi gì vào số nhân viên.
 * Chỉ Quản trị và Trưởng Marketing.
 */
export function AdsAutoPage() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={FlaskConical}
        title="Ads tự động"
        description="Thử nghiệm: tự kéo chi tiêu và tin nhắn từ Facebook về một chỗ riêng, rồi so với số nhân viên nhập tay mỗi ngày. Không sửa số nhân viên đã nhập."
      >
        <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Thử nghiệm
        </span>
      </PageHeader>
      <CatalogGate>
        <Body />
      </CatalogGate>
    </div>
  );
}

/** Đang chờ Facebook trả lời thì cứ 3 giây đọc câu trả lời một lần, tối đa 2 phút. */
const WATCH_MS = 3_000;
const WATCH_LIMIT_MS = 120_000;

function Body() {
  const staff = useCurrentStaff();
  const allowed = useManagesMarketing();
  const today = useTodayVn();
  const [status, setStatus] = useState<AutoStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  /** Tăng mỗi khi có số Facebook mới → bảng đối chiếu tải lại. */
  const [version, setVersion] = useState(0);
  const pendingRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const next = await fetchAutoStatus();
      const total = next ? next.pending + next.pancake_pending : 0;
      if (next && total < pendingRef.current) setVersion((v) => v + 1);
      pendingRef.current = total;
      setStatus(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [allowed, load]);

  const waiting = (status?.pending ?? 0) + (status?.pancake_pending ?? 0) > 0;
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const r = await collectAutoNow();
        if ((r.answers ?? 0) > 0) setVersion((v) => v + 1);
      } catch {
        // Không đọc được lúc này thì lần sau thử lại; lịch chạy mỗi phút cũng tự đọc.
      }
      const next = await load();
      if (!next || next.pending + next.pancake_pending === 0 || Date.now() - started > WATCH_LIMIT_MS) clearInterval(timer);
    }, WATCH_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  if (staff.status === "ok" && !allowed) {
    return <ReadOnlyNote>Chỉ Quản trị và Trưởng Marketing xem được phần thử nghiệm này.</ReadOnlyNote>;
  }
  if (error && !status) {
    return <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>;
  }
  if (status === undefined || !today) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }
  if (status === null) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
        Phần này chưa dùng được: {ADS_AUTO_NOT_READY.charAt(0).toLowerCase() + ADS_AUTO_NOT_READY.slice(1)} Các phần khác
        vẫn chạy bình thường.
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <ConnectionCard status={status} onChanged={() => void load()} />
      <CompareSection status={status} today={today} version={version} onPulled={() => void load()} />
    </div>
  );
}
