"use client";

import { format } from "date-fns";
import { Shuffle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CatalogGate, PageHeader, useCanManage } from "@/components/catalog/shared";
import { useCatalogs } from "@/components/catalog-provider";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS, useCurrentStaff } from "@/hooks/use-current-staff";
import { setAcceptsLeads } from "@/lib/catalog/repo";
import type { StaffMember } from "@/lib/catalog/types";
import { APP } from "@/lib/config";
import { cn } from "@/lib/utils";

/**
 * Telesale → Chia lead / Chia ca (đợt 1: bật / tắt nhận lead và thứ tự xoay vòng).
 * Phần xếp ca làm sẽ bổ sung ở đợt 2.
 */
export function LeadAssignment() {
  const { catalogs, reload } = useCatalogs();
  const canManage = useCanManage();
  const me = useCurrentStaff();
  const myId = me.status === "ok" ? me.userId : null;
  const [saving, setSaving] = useState<string | null>(null);

  const receiving = catalogs.staff.filter((s) => s.accepts_leads);

  // Thứ tự xoay vòng: ai lâu chưa được chia nhất (hoặc chưa từng được chia) thì nhận trước.
  const queue = [...receiving].sort((a, b) => {
    if (!a.last_assigned_at && !b.last_assigned_at) return a.full_name.localeCompare(b.full_name, "vi");
    if (!a.last_assigned_at) return -1;
    if (!b.last_assigned_at) return 1;
    return a.last_assigned_at.localeCompare(b.last_assigned_at);
  });
  const position = new Map(queue.map((s, i) => [s.user_id, i + 1]));

  async function toggle(member: StaffMember) {
    setSaving(member.user_id);
    try {
      await setAcceptsLeads(member.user_id, !member.accepts_leads);
      await reload();
      toast.success(
        `${member.full_name}: ${member.accepts_leads ? "đã tắt nhận lead" : "đã bật nhận lead"}`,
      );
    } catch (error) {
      toast.error("Không đổi được trạng thái nhận lead", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={Shuffle}
        title="Chia lead / Chia ca"
        description={`Lead mới của cơ sở ${APP.branch.name} được chia xoay vòng cho những người đang bật nhận lead.`}
      />

      <CatalogGate>
        {receiving.length === 0 && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            Chưa có ai bật nhận lead, nên lead mới sẽ <strong>chưa được chia</strong> cho
            telesale nào. Bật nhận lead cho ít nhất một người ở bảng dưới.
          </p>
        )}

        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Nhân viên</TableHead>
                <TableHead>Vai trò</TableHead>
                <TableHead>Nhận lead</TableHead>
                <TableHead>Lượt xoay vòng</TableHead>
                <TableHead>Được chia gần nhất</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogs.staff.map((member) => {
                const allowed = canManage || member.user_id === myId;
                return (
                  <TableRow key={member.user_id}>
                    <TableCell className="font-medium">
                      {member.full_name}
                      {member.user_id === myId && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">(bạn)</span>
                      )}
                      {member.locked_at && (
                        <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-800 dark:bg-red-900/50 dark:text-red-200">
                          Đang bị khoá
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{ROLE_LABELS[member.role]}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        role="switch"
                        aria-checked={member.accepts_leads}
                        aria-label={`Nhận lead: ${member.full_name}`}
                        disabled={!allowed || saving === member.user_id || Boolean(member.locked_at)}
                        onClick={() => toggle(member)}
                        className={cn(
                          "w-24 justify-start gap-2",
                          member.accepts_leads &&
                            "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
                        )}
                      >
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            member.accepts_leads ? "bg-emerald-500" : "bg-muted-foreground/40",
                          )}
                        />
                        {member.accepts_leads ? "Đang bật" : "Đang tắt"}
                      </Button>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {position.has(member.user_id) ? `Thứ ${position.get(member.user_id)}` : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {member.last_assigned_at
                        ? format(new Date(member.last_assigned_at), "dd/MM/yyyy HH:mm")
                        : "Chưa từng"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <ul className="grid gap-1 text-sm text-muted-foreground">
          <li>• Người ở “Thứ 1” sẽ nhận lead kế tiếp; nhận xong thì xuống cuối hàng.</li>
          <li>• Trực page chọn tay một telesale thì người đó vẫn tính một lượt, để số lượng không lệch.</li>
          <li>• Quản trị và Lead bật/tắt cho mọi người; nhân viên tự bật/tắt cho mình.</li>
          <li>• Xếp ca làm (chỉ chia cho người đang trong ca) sẽ có ở đợt 2; hiện chia cho mọi người đang bật.</li>
        </ul>
      </CatalogGate>
    </div>
  );
}
