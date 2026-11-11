"use client";

import { Pencil, Plus, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCatalogNames, useCatalogs } from "@/components/catalog-provider";
import { FormDialog, NONE, toId, toText, type FieldDef, type FormValues } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/hooks/use-current-staff";
import { saveCatalogRow } from "@/lib/catalog/repo";
import type { AdsStaff } from "@/lib/catalog/types";
import { coversDay } from "./ads-scope";
import {
  ActivePill,
  CatalogGate,
  DeleteRowButton,
  MarketingNotReady,
  PageHeader,
  ReadOnlyNote,
  useTodayVn,
  useManagesMarketing,
} from "./shared";

/**
 * Marketing → Nhân viên Ads: những người chạy quảng cáo. Mỗi TKQC được giao cho một người theo
 * từng khoảng ngày (ở trang TKQC & Page); số liệu của ngày nào thuộc về người phụ trách ngày đó.
 */
export function AdsStaffManager() {
  const { catalogs, reload } = useCatalogs();
  const canManage = useManagesMarketing();
  const names = useCatalogNames();
  const [editing, setEditing] = useState<{ open: boolean; row: AdsStaff | null }>({ open: false, row: null });
  const row = editing.row;

  const today = useTodayVn();
  const currentAccounts = (adsStaffId: string) =>
    catalogs.assignments
      .filter((x) => x.ads_staff_id === adsStaffId && coversDay(x, today))
      .map((x) => names.adAccount(x.ad_account_id))
      .filter(Boolean);

  // Mỗi tài khoản đăng nhập chỉ gắn với một nhân viên Ads.
  const linkedElsewhere = new Set(
    catalogs.adsStaff.filter((a) => a.user_id && a.id !== row?.id).map((a) => a.user_id),
  );

  const fields: FieldDef[] = [
    { name: "full_name", label: "Họ tên", type: "text", required: true },
    { name: "staff_code", label: "Mã nhân viên nội bộ", type: "text", placeholder: "vd MKT01" },
    {
      name: "user_id",
      label: "Tài khoản đăng nhập",
      type: "select",
      emptyLabel: "Chưa có tài khoản",
      options: catalogs.staff
        .filter((s) => !linkedElsewhere.has(s.user_id) && (!s.locked_at || s.user_id === row?.user_id))
        .map((s) => ({ value: s.user_id, label: `${s.full_name} — ${ROLE_LABELS[s.role]}` })),
    },
    { name: "note", label: "Ghi chú", type: "text", wide: true },
    {
      name: "is_active",
      label: "Trạng thái",
      type: "checkbox",
      text: "Đang làm (bỏ tick = đã nghỉ; số liệu cũ vẫn giữ nguyên)",
      wide: true,
    },
  ];

  async function save(values: FormValues) {
    await saveCatalogRow(
      "ads_staff",
      row?.id ?? null,
      {
        full_name: toText(values.full_name),
        staff_code: toText(values.staff_code),
        user_id: toId(values.user_id),
        note: toText(values.note),
        is_active: Boolean(values.is_active),
      },
      "Đã có nhân viên Ads trùng tên hoặc trùng mã, hoặc tài khoản đăng nhập này đã gắn với người khác.",
    );
    await reload();
    toast.success(row ? "Đã cập nhật nhân viên Ads" : "Đã thêm nhân viên Ads");
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={UsersRound}
        title="Nhân viên Ads"
        description="Những người chạy quảng cáo. Giao TKQC cho từng người ở trang TKQC & Page."
      >
        {canManage && catalogs.marketingReady && (
          <Button onClick={() => setEditing({ open: true, row: null })}>
            <Plus />
            Thêm nhân viên Ads
          </Button>
        )}
      </PageHeader>

      <CatalogGate>
        <MarketingNotReady what="Danh sách nhân viên Ads" />
        {catalogs.marketingReady && !canManage && (
          <ReadOnlyNote>
            Danh sách đầy đủ chỉ Quản trị và Trưởng Marketing xem được. Nhân viên Ads chỉ thấy dòng của mình.
          </ReadOnlyNote>
        )}

        {catalogs.marketingReady && (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Họ tên</TableHead>
                  <TableHead>Mã NV</TableHead>
                  <TableHead>Tài khoản đăng nhập</TableHead>
                  <TableHead>TKQC đang phụ trách</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogs.adsStaff.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {canManage ? "Chưa có nhân viên Ads nào." : "Không có dòng nào bạn được xem."}
                    </TableCell>
                  </TableRow>
                ) : (
                  catalogs.adsStaff.map((member) => {
                    const accounts = currentAccounts(member.id);
                    return (
                      <TableRow key={member.id}>
                        <TableCell>
                          <div className="font-medium">{member.full_name}</div>
                          {member.note && <div className="text-xs text-muted-foreground">{member.note}</div>}
                        </TableCell>
                        <TableCell className="tabular-nums">{member.staff_code ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {names.staff(member.user_id) ?? <span className="text-muted-foreground">Chưa có</span>}
                        </TableCell>
                        <TableCell>
                          {accounts.length > 0 ? accounts.join(", ") : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <ActivePill active={member.is_active} onLabel="Đang làm" offLabel="Nghỉ" />
                        </TableCell>
                        <TableCell>
                          {canManage && (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Sửa nhân viên Ads ${member.full_name}`}
                                onClick={() => setEditing({ open: true, row: member })}
                              >
                                <Pencil />
                              </Button>
                              <DeleteRowButton table="ads_staff" id={member.id} what={`nhân viên Ads ${member.full_name}`} />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {catalogs.marketingReady && canManage && (
          <ul className="grid gap-1 text-sm text-muted-foreground">
            <li>• Người đã nghỉ: bỏ tick “Đang làm” thay vì chuyển vào thùng rác, để số liệu cũ vẫn tính cho đúng người.</li>
            <li>
              • Gắn “Tài khoản đăng nhập” có vai trò Nhân viên Ads thì người đó chỉ thấy TKQC, chiến dịch, bài post
              của mình. Đổi vai trò ở Cài đặt → Tài khoản &amp; Phân quyền.
            </li>
          </ul>
        )}
      </CatalogGate>

      <FormDialog
        open={editing.open}
        onOpenChange={(open) => setEditing((prev) => ({ ...prev, open }))}
        title={row ? "Sửa nhân viên Ads" : "Thêm nhân viên Ads"}
        fields={fields}
        initialValues={{
          full_name: row?.full_name ?? "",
          staff_code: row?.staff_code ?? "",
          user_id: row?.user_id ?? NONE,
          note: row?.note ?? "",
          is_active: row?.is_active ?? true,
        }}
        onSubmit={save}
      />
    </div>
  );
}
