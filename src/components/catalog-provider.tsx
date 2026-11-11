"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { fetchCatalogs } from "@/lib/catalog/repo";
import { EMPTY_CATALOGS, type Catalogs } from "@/lib/catalog/types";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type CatalogContextValue = {
  catalogs: Catalogs;
  /** false cho tới khi tải xong lần đầu. */
  ready: boolean;
  error: string | null;
  /** Tải lại sau khi thêm / sửa danh mục. */
  reload: () => Promise<void>;
};

const CatalogContext = createContext<CatalogContextValue>({
  catalogs: EMPTY_CATALOGS,
  ready: false,
  error: null,
  reload: async () => {},
});

/**
 * Tải các danh mục dùng chung (kênh, page, chiến dịch, dịch vụ, nhân viên) một lần
 * cho mọi trang, để các form và bảng tra tên từ id mà không phải gọi lại máy chủ.
 */
export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    catalogs: Catalogs;
    ready: boolean;
    error: string | null;
  }>({ catalogs: EMPTY_CATALOGS, ready: false, error: null });

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const catalogs = await fetchCatalogs();
      setState({ catalogs, ready: true, error: null });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        ready: true,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  useEffect(() => {
    // reload chỉ gọi setState sau khi máy chủ trả lời (không đồng bộ trong effect).
    void reload();
  }, [reload]);

  const value = useMemo(() => ({ ...state, reload }), [state, reload]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalogs() {
  return useContext(CatalogContext);
}

/** Tra dòng theo id: byId(catalogs.channels).get(id) — chỉ gồm các dòng đang dùng. */
export function byId<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

type Named = { id: string; name: string };

function nameIndex(live: Named[], trashed: Named[]) {
  const names = new Map<string, string>();
  for (const row of trashed) names.set(row.id, `${row.name} (trong thùng rác)`);
  for (const row of live) names.set(row.id, row.name);
  return (id: string | null | undefined) => (id ? names.get(id) : undefined);
}

/**
 * Tra TÊN theo id cho dữ liệu đang hiển thị (lead, lần tiếp cận, nhật ký). Khác với byId:
 * tra được cả các dòng danh mục đã xoá, để lead cũ vẫn hiện đúng tên nguồn kèm chữ "(trong thùng rác)".
 */
export function useCatalogNames() {
  const { catalogs } = useCatalogs();
  return useMemo(() => {
    const staff = new Map(catalogs.staff.map((s) => [s.user_id, s.full_name]));
    return {
      channel: nameIndex(catalogs.channels, catalogs.trashed.channels),
      page: nameIndex(catalogs.pages, catalogs.trashed.pages),
      campaign: nameIndex(catalogs.campaigns, catalogs.trashed.campaigns),
      service: nameIndex(catalogs.services, catalogs.trashed.services),
      staff: (id: string | null | undefined) => (id ? staff.get(id) : undefined),
    };
  }, [catalogs]);
}

export type CatalogNames = ReturnType<typeof useCatalogNames>;
