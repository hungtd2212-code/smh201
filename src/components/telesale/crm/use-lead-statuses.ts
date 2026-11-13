"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchLeadStatuses } from "@/lib/leads/repo";
import type { LeadStatusRow } from "@/lib/leads/types";

/** Danh sách trạng thái khách hàng (Telesale → Cài đặt), tải một lần cho mỗi màn hình. */
export function useLeadStatuses() {
  const [state, setState] = useState<{ statuses: LeadStatusRow[]; ready: boolean; error: string | null }>({
    statuses: [],
    ready: false,
    error: null,
  });

  const reload = useCallback(async () => {
    try {
      setState({ statuses: await fetchLeadStatuses(), ready: true, error: null });
    } catch (error) {
      setState((prev) => ({ ...prev, ready: true, error: error instanceof Error ? error.message : String(error) }));
    }
  }, []);

  useEffect(() => {
    // reload chỉ gọi setState sau khi máy chủ trả lời (không đồng bộ trong effect).
    void reload();
  }, [reload]);

  return { ...state, reload };
}
