"use client";

import { Megaphone, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCatalogNames, useCatalogs } from "@/components/catalog-provider";
import {
  FormDialog,
  NONE,
  toId,
  toNumber,
  toText,
  type FieldDef,
  type FormValues,
} from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveCatalogRow } from "@/lib/catalog/repo";
import type { Campaign } from "@/lib/catalog/types";
import { APP } from "@/lib/config";
import {
  ActivePill,
  CatalogGate,
  DeleteRowButton,
  PageHeader,
  formatDate,
  formatVnd,
  useCanManage,
} from "./shared";

/** Marketing → Chiến dịch / Lên camp. Trực page chọn chiến dịch khi dán lead; chiến dịch tự điền page, dịch vụ, ID Ads. */
export function CampaignsManager() {
  const { catalogs, reload } = useCatalogs();
  const canManage = useCanManage();
  const [editing, setEditing] = useState<{ open: boolean; row: Campaign | null }>({ open: false, row: null });

  const names = useCatalogNames();
  const row = editing.row;

  const fields: FieldDef[] = [
    { name: "name", label: "Tên chiến dịch", type: "text", required: true, wide: true },
    {
      name: "channel_id",
      label: "Kênh",
      type: "select",
      required: true,
      resets: ["page_id"],
      options: catalogs.channels
        .filter((c) => c.is_active || c.id === row?.channel_id)
        .map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: "page_id",
      label: "Page / TKQC",
      type: "select",
      emptyLabel: "Không gắn page",
      options: (values) =>
        catalogs.pages
          .filter((p) => p.channel_id === values.channel_id && (p.is_active || p.id === row?.page_id))
          .map((p) => ({ value: p.id, label: p.name })),
    },
    {
      name: "service_id",
      label: "Dịch vụ",
      type: "select",
      emptyLabel: "Nhiều dịch vụ / chưa rõ",
      options: catalogs.services
        .filter((s) => s.is_active || s.id === row?.service_id)
        .map((s) => ({ value: s.id, label: s.name })),
    },
    {
      name: "owner_id",
      label: "Người phụ trách",
      type: "select",
      emptyLabel: "Chưa phân công",
      options: catalogs.staff.map((s) => ({ value: s.user_id, label: s.full_name })),
    },
    { name: "start_date", label: "Ngày bắt đầu chạy", type: "date" },
    { name: "end_date", label: "Ngày kết thúc", type: "date" },
    { name: "budget", label: "Ngân sách (₫)", type: "number" },
    { name: "ads_id", label: "ID Ads", type: "text" },
    { name: "is_active", label: "Trạng thái", type: "checkbox", text: "Đang chạy (hiện trong form Thêm lead)", wide: true },
  ];

  async function save(values: FormValues) {
    const start = toText(values.start_date);
    const end = toText(values.end_date);
    if (start && end && end < start) throw new Error("Ngày kết thúc phải sau ngày bắt đầu.");

    await saveCatalogRow("campaigns", row?.id ?? null, {
      name: toText(values.name),
      channel_id: values.channel_id,
      page_id: toId(values.page_id),
      service_id: toId(values.service_id),
      owner_id: toId(values.owner_id),
      branch: APP.branch.code,
      start_date: start,
      end_date: end,
      budget: toNumber(values.budget),
      ads_id: toText(values.ads_id),
      is_active: Boolean(values.is_active),
    });
    await reload();
    toast.success(row ? "Đã cập nhật chiến dịch" : "Đã thêm chiến dịch");
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={Megaphone}
        title="Chiến dịch / Lên camp"
        description={`Các chiến dịch quảng cáo của cơ sở ${APP.branch.name}. Lead được ghi nhận theo chiến dịch của lần tiếp cận gần nhất.`}
      >
        {canManage && (
          <Button onClick={() => setEditing({ open: true, row: null })}>
            <Plus />
            Thêm chiến dịch
          </Button>
        )}
      </PageHeader>

      <CatalogGate>
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Chiến dịch</TableHead>
                <TableHead>Kênh › Page</TableHead>
                <TableHead>Dịch vụ</TableHead>
                <TableHead>Ngày chạy</TableHead>
                <TableHead className="text-right">Ngân sách</TableHead>
                <TableHead>Phụ trách</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogs.campaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    Chưa có chiến dịch nào. Tạo page ở “Nguồn lead & Trang” trước, rồi thêm chiến dịch.
                  </TableCell>
                </TableRow>
              ) : (
                catalogs.campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <div className="font-medium">{campaign.name}</div>
                      {campaign.ads_id && (
                        <div className="text-xs text-muted-foreground">ID Ads {campaign.ads_id}</div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {names.channel(campaign.channel_id) ?? "—"}
                      {campaign.page_id && ` › ${names.page(campaign.page_id) ?? "…"}`}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {names.service(campaign.service_id) ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDate(campaign.start_date)}
                      {campaign.end_date && ` → ${formatDate(campaign.end_date)}`}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {formatVnd(campaign.budget)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {names.staff(campaign.owner_id) ?? "—"}
                    </TableCell>
                    <TableCell>
                      <ActivePill active={campaign.is_active} />
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Sửa chiến dịch ${campaign.name}`}
                            onClick={() => setEditing({ open: true, row: campaign })}
                          >
                            <Pencil />
                          </Button>
                          <DeleteRowButton table="campaigns" id={campaign.id} what={`chiến dịch ${campaign.name}`} />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CatalogGate>

      <FormDialog
        open={editing.open}
        onOpenChange={(open) => setEditing((prev) => ({ ...prev, open }))}
        title={row ? "Sửa chiến dịch" : "Thêm chiến dịch"}
        fields={fields}
        initialValues={{
          name: row?.name ?? "",
          channel_id: row?.channel_id ?? NONE,
          page_id: row?.page_id ?? NONE,
          service_id: row?.service_id ?? NONE,
          owner_id: row?.owner_id ?? NONE,
          start_date: row?.start_date ?? "",
          end_date: row?.end_date ?? "",
          budget: row?.budget?.toString() ?? "",
          ads_id: row?.ads_id ?? "",
          is_active: row?.is_active ?? true,
        }}
        onSubmit={save}
      />
    </div>
  );
}
