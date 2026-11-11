"use client";

import { Pencil, Plus, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { byId, useCatalogs } from "@/components/catalog-provider";
import { FormDialog, toNumber, toText, type FieldDef, type FormValues } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveCatalogRow } from "@/lib/catalog/repo";
import type { Channel, Page } from "@/lib/catalog/types";
import { APP } from "@/lib/config";
import { ActivePill, CatalogGate, DeleteRowButton, PageHeader, useCanManage } from "./shared";

const CHANNEL_FIELDS: FieldDef[] = [
  { name: "name", label: "Tên kênh", type: "text", required: true },
  { name: "sort_order", label: "Thứ tự hiển thị", type: "number" },
  { name: "is_active", label: "Trạng thái", type: "checkbox", text: "Đang dùng (hiện trong form Thêm lead)", wide: true },
];

/** Marketing → Nguồn lead & Trang: danh mục Kênh và Page / tài khoản quảng cáo. */
export function SourcesManager() {
  const { catalogs, reload } = useCatalogs();
  const canManage = useCanManage();
  const [channelDialog, setChannelDialog] = useState<{ open: boolean; row: Channel | null }>({ open: false, row: null });
  const [pageDialog, setPageDialog] = useState<{ open: boolean; row: Page | null }>({ open: false, row: null });

  const channels = byId(catalogs.channels);
  const pageCount = (channelId: string) => catalogs.pages.filter((p) => p.channel_id === channelId).length;

  const pageFields: FieldDef[] = [
    { name: "name", label: "Tên page / tài khoản QC", type: "text", required: true, wide: true },
    {
      name: "channel_id",
      label: "Thuộc kênh",
      type: "select",
      required: true,
      options: catalogs.channels
        .filter((c) => c.is_active || c.id === pageDialog.row?.channel_id)
        .map((c) => ({ value: c.id, label: c.name })),
    },
    { name: "is_active", label: "Trạng thái", type: "checkbox", text: "Đang dùng" },
  ];

  async function saveChannel(values: FormValues) {
    await saveCatalogRow("channels", channelDialog.row?.id ?? null, {
      name: toText(values.name),
      sort_order: toNumber(values.sort_order) ?? 0,
      is_active: Boolean(values.is_active),
    });
    await reload();
    toast.success(channelDialog.row ? "Đã cập nhật kênh" : "Đã thêm kênh");
  }

  async function savePage(values: FormValues) {
    await saveCatalogRow("pages", pageDialog.row?.id ?? null, {
      name: toText(values.name),
      channel_id: values.channel_id,
      branch: APP.branch.code,
      is_active: Boolean(values.is_active),
    });
    await reload();
    toast.success(pageDialog.row ? "Đã cập nhật page" : "Đã thêm page");
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={Share2}
        title="Nguồn lead & Trang"
        description="Kênh quảng cáo và các page / tài khoản quảng cáo đang chạy cho từng kênh."
      />

      <CatalogGate>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section className="grid content-start gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Kênh</h2>
              {canManage && (
                <Button variant="outline" onClick={() => setChannelDialog({ open: true, row: null })}>
                  <Plus />
                  Thêm kênh
                </Button>
              )}
            </div>
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Kênh</TableHead>
                    <TableHead className="text-right">Số page</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalogs.channels.map((channel) => (
                    <TableRow key={channel.id}>
                      <TableCell className="font-medium">{channel.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{pageCount(channel.id)}</TableCell>
                      <TableCell>
                        <ActivePill active={channel.is_active} />
                      </TableCell>
                      <TableCell>
                        {canManage && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Sửa kênh ${channel.name}`}
                              onClick={() => setChannelDialog({ open: true, row: channel })}
                            >
                              <Pencil />
                            </Button>
                            <DeleteRowButton table="channels" id={channel.id} what={`kênh ${channel.name}`} />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="grid content-start gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Page / Tài khoản quảng cáo</h2>
              {canManage && (
                <Button onClick={() => setPageDialog({ open: true, row: null })}>
                  <Plus />
                  Thêm page
                </Button>
              )}
            </div>
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Page / TKQC</TableHead>
                    <TableHead>Kênh</TableHead>
                    <TableHead>Cơ sở</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalogs.pages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        Chưa có page nào. Thêm page để trực page chọn khi dán lead.
                      </TableCell>
                    </TableRow>
                  ) : (
                    catalogs.pages.map((page) => (
                      <TableRow key={page.id}>
                        <TableCell className="font-medium">{page.name}</TableCell>
                        <TableCell>{channels.get(page.channel_id)?.name ?? "—"}</TableCell>
                        <TableCell>{page.branch === APP.branch.code ? APP.branch.name : page.branch}</TableCell>
                        <TableCell>
                          <ActivePill active={page.is_active} />
                        </TableCell>
                        <TableCell>
                          {canManage && (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Sửa page ${page.name}`}
                                onClick={() => setPageDialog({ open: true, row: page })}
                              >
                                <Pencil />
                              </Button>
                              <DeleteRowButton table="pages" id={page.id} what={`page ${page.name}`} />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      </CatalogGate>

      <FormDialog
        open={channelDialog.open}
        onOpenChange={(open) => setChannelDialog((prev) => ({ ...prev, open }))}
        title={channelDialog.row ? "Sửa kênh" : "Thêm kênh"}
        fields={CHANNEL_FIELDS}
        initialValues={{
          name: channelDialog.row?.name ?? "",
          sort_order: (channelDialog.row?.sort_order ?? catalogs.channels.length + 1).toString(),
          is_active: channelDialog.row?.is_active ?? true,
        }}
        onSubmit={saveChannel}
      />
      <FormDialog
        open={pageDialog.open}
        onOpenChange={(open) => setPageDialog((prev) => ({ ...prev, open }))}
        title={pageDialog.row ? "Sửa page" : "Thêm page / tài khoản QC"}
        fields={pageFields}
        initialValues={{
          name: pageDialog.row?.name ?? "",
          channel_id: pageDialog.row?.channel_id ?? "__none",
          is_active: pageDialog.row?.is_active ?? true,
        }}
        onSubmit={savePage}
      />
    </div>
  );
}
