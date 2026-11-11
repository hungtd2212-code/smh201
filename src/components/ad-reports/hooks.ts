"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchReports } from "@/lib/ad-reports/repo";
import type { AdDailyReport } from "@/lib/ad-reports/types";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export type ReportsState =
  | { status: "loading" }
  | { status: "ready"; reports: AdDailyReport[] }
  /** Cơ sở dữ liệu chưa chạy supabase/006_ad_daily_reports.sql. */
  | { status: "not-migrated" }
  | { status: "error"; message: string };

const LOADING: ReportsState = { status: "loading" };

/** Báo cáo từ `from` đến hết `to` (yyyy-MM-dd). Đổi khoảng ngày thì tự tải lại; `reload()` sau khi lưu. */
export function useAdReports(from: string, to: string) {
  const key = `${from}:${to}`;
  const [loaded, setLoaded] = useState<{ key: string; state: ReportsState } | null>(null);
  // Khoảng ngày đang xem — để bỏ qua câu trả lời về muộn của khoảng ngày cũ.
  const latest = useRef(key);

  const reload = useCallback(async () => {
    if (!from || !to || !isSupabaseConfigured) return;
    const requested = `${from}:${to}`;
    let state: ReportsState;
    try {
      const reports = await fetchReports(from, to);
      state = reports ? { status: "ready", reports } : { status: "not-migrated" };
    } catch (error) {
      state = { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
    if (latest.current === requested) setLoaded({ key: requested, state });
  }, [from, to]);

  useEffect(() => {
    latest.current = key;
    // reload chỉ gọi setState sau khi máy chủ trả lời (không đồng bộ trong effect).
    void reload();
  }, [key, reload]);

  return { state: loaded?.key === key ? loaded.state : LOADING, reload };
}

const TICK = 30_000;
const everyTick = (notify: () => void) => {
  const timer = setInterval(notify, TICK);
  return () => clearInterval(timer);
};
const nowRounded = () => Math.floor(Date.now() / TICK) * TICK;
const unknownNow = () => 0;

/**
 * Giờ hiện tại (mili-giây), cập nhật mỗi 30 giây — cho dòng "Còn sửa được …". Lúc Next.js dựng sẵn
 * trang trên máy chủ thì trả về 0 (chưa biết giờ).
 */
export const useNow = () => useSyncExternalStore(everyTick, nowRounded, unknownNow);
