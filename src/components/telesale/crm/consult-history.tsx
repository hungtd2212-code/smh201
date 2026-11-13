"use client";

import { History } from "lucide-react";
import { useState } from "react";
import { useCatalogNames } from "@/components/catalog-provider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { vnDateTime } from "@/lib/leads/crm";
import { fetchConsultHistory } from "@/lib/leads/repo";
import type { ConsultVersion } from "@/lib/leads/types";

/** Nút đồng hồ cạnh ô Khai thác thông tin: mở danh sách các lần sửa (ai, lúc nào, nội dung lúc đó). */
export function ConsultHistory({ leadId }: { leadId: string }) {
  const names = useCatalogNames();
  const [state, setState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "ready"; rows: ConsultVersion[] } | { status: "error"; message: string }
  >({ status: "idle" });

  function load() {
    setState({ status: "loading" });
    fetchConsultHistory(leadId)
      .then((rows) => setState({ status: "ready", rows }))
      .catch((error: unknown) =>
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) }),
      );
  }

  return (
    <Popover onOpenChange={(open) => open && load()}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
          <History />
          Lịch sử
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">Lịch sử khai thác thông tin</div>
        <div className="max-h-96 overflow-y-auto p-2">
          {state.status === "loading" && <p className="px-1 py-2 text-sm text-muted-foreground">Đang tải…</p>}
          {state.status === "error" && <p className="px-1 py-2 text-sm text-destructive">{state.message}</p>}
          {state.status === "ready" && state.rows.length === 0 && (
            <p className="px-1 py-2 text-sm text-muted-foreground">Chưa có lần sửa nào.</p>
          )}
          {state.status === "ready" && (
            <ol className="grid gap-2">
              {state.rows.map((row, index) => {
                const at = vnDateTime(row.at);
                return (
                  <li key={row.id} className="grid gap-1 rounded-lg border px-2.5 py-2">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-muted-foreground">
                      <span>
                        <span className="font-medium text-foreground">
                          {row.actor_id ? (names.staff(row.actor_id) ?? "Người dùng khác") : "Hệ thống"}
                        </span>
                        {index === 0 && " · bản hiện tại"}
                      </span>
                      <span className="tabular-nums">{at ? `${at.time} ${at.day}` : ""}</span>
                    </span>
                    <p className="text-sm whitespace-pre-wrap">
                      {row.text || <span className="text-muted-foreground italic">(để trống)</span>}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
