"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAdsStats } from "@/lib/ads-stats/repo";
import type { AdsStats } from "@/lib/ads-stats/types";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export type AdsStatsState =
  | { status: "loading" }
  | { status: "ready"; stats: AdsStats }
  /** Cơ sở dữ liệu chưa chạy supabase/006_ads_daily_stats.sql. */
  | { status: "not-migrated" }
  | { status: "error"; message: string };

const LOADING: AdsStatsState = { status: "loading" };

/**
 * Số liệu ads hằng ngày từ `from` đến hết `to` (yyyy-MM-dd). Đổi khoảng ngày thì tự tải lại;
 * gọi `reload()` sau khi lưu để lấy số mới.
 */
export function useAdsStats(from: string, to: string) {
  const key = `${from}:${to}`;
  const [loaded, setLoaded] = useState<{ key: string; state: AdsStatsState } | null>(null);
  // Khoảng ngày đang xem — để bỏ qua câu trả lời về muộn của khoảng ngày cũ.
  const latest = useRef(key);

  const reload = useCallback(async () => {
    if (!from || !to || !isSupabaseConfigured) return;
    const requested = `${from}:${to}`;
    let state: AdsStatsState;
    try {
      const stats = await fetchAdsStats(from, to);
      state = stats ? { status: "ready", stats } : { status: "not-migrated" };
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
