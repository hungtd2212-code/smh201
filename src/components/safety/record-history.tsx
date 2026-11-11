"use client";

import { format } from "date-fns";
import { Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCatalogNames } from "@/components/catalog-provider";
import { Button } from "@/components/ui/button";
import { ACTION_LABELS, describeChanges } from "@/lib/safety/labels";
import { fetchRecordHistory, revertToVersion } from "@/lib/safety/repo";
import type { AuditEntry } from "@/lib/safety/types";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { errorText } from "./shared";

type Props = {
  table: string;
  recordId: string;
  /** Hiện nút "Hoàn tác về phiên bản này". */
  canRevert: boolean;
  /** Gọi sau khi hoàn tác xong để nơi dùng tải lại bản ghi. */
  onReverted?: () => void | Promise<void>;
};

/** Lịch sử thay đổi của một bản ghi (mới nhất trước), kèm nút hoàn tác về từng phiên bản. */
export function RecordHistory({ table, recordId, canRevert, onReverted }: Props) {
  const names = useCatalogNames();
  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState<{ entries: AuditEntry[] } | { error: string } | null>(null);
  const [target, setTarget] = useState<AuditEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecordHistory(table, recordId)
      .then((entries) => !cancelled && setState({ entries }))
      .catch((error: unknown) => !cancelled && setState({ error: errorText(error) }));
    return () => {
      cancelled = true;
    };
  }, [table, recordId, reloadCount]);

  async function revert(entry: AuditEntry) {
    const columns = await revertToVersion(entry.id);
    if (columns === 0) toast.info("Bản ghi đã ở đúng phiên bản này, không có gì để hoàn tác");
    else toast.success(`Đã hoàn tác ${columns} thông tin về phiên bản đã chọn`);
    setReloadCount((n) => n + 1);
    await onReverted?.();
  }

  if (state === null) return <p className="text-sm text-muted-foreground">Đang tải lịch sử…</p>;
  if ("error" in state) {
    return <p className="text-sm text-destructive">Không tải được lịch sử: {state.error}</p>;
  }
  if (state.entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Chưa có thay đổi nào được ghi lại. Nhật ký bắt đầu ghi từ khi bật tính năng này, nên
        các thay đổi trước đó không có ở đây.
      </p>
    );
  }

  return (
    <>
      <ol className="grid gap-2 text-sm">
        {state.entries.map((entry, index) => {
          const changes = describeChanges(entry, names);
          return (
            <li key={entry.id} className="rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="tabular-nums text-muted-foreground">
                  {format(new Date(entry.at), "dd/MM/yyyy HH:mm")}
                </span>
                <span className="font-medium">{ACTION_LABELS[entry.action]}</span>
                <span className="text-muted-foreground">
                  bởi {entry.actor_id ? (names.staff(entry.actor_id) ?? "tài khoản đã gỡ") : "hệ thống"}
                </span>
                {index === 0 ? (
                  <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                    Hiện tại
                  </span>
                ) : (
                  canRevert &&
                  entry.action !== "delete" &&
                  entry.action !== "purge" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="ml-auto"
                      onClick={() => setTarget(entry)}
                    >
                      <Undo2 />
                      Hoàn tác về phiên bản này
                    </Button>
                  )
                )}
              </div>
              {entry.note && <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>}
              {changes.length > 0 && (
                <ul className="mt-1.5 grid gap-0.5">
                  {changes.map((change) => (
                    <li key={change.key} className="break-words">
                      <span className="text-muted-foreground">{change.label}: </span>
                      <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                        {change.from}
                      </span>
                      {" → "}
                      <span>{change.to}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <ConfirmActionDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Hoàn tác về phiên bản này?"
        description={
          target && (
            <p>
              Bản ghi sẽ trở về đúng như ngay sau thay đổi lúc{" "}
              <strong>{format(new Date(target.at), "dd/MM/yyyy HH:mm")}</strong>. Mọi chỉnh sửa
              sau thời điểm đó sẽ bị gỡ. Lần hoàn tác này cũng được ghi vào lịch sử, nên vẫn
              hoàn tác lại được.
            </p>
          )
        }
        confirmLabel="Hoàn tác"
        destructive
        onConfirm={() => (target ? revert(target) : Promise.resolve())}
      />
    </>
  );
}
