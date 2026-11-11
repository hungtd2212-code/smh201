"use client";

import { ExternalLink, Pencil, Plus, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCatalogNames, useCatalogs } from "@/components/catalog-provider";
import {
  FormDialog,
  NONE,
  toIds,
  toNumber,
  toText,
  type FieldDef,
  type FormValues,
} from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveCatalogRow } from "@/lib/catalog/repo";
import type { Channel, Page } from "@/lib/catalog/types";
import { AdAccountsSection } from "./ad-accounts-section";
import {
  ActivePill,
  CatalogGate,
  DeleteRowButton,
  MarketingNotReady,
  PageHeader,
  ReadOnlyNote,
  useManagesMarketing,
} from "./shared";

const CHANNEL_FIELDS: FieldDef[] = [
  { name: "name", label: "Tên kênh", type: "text", required: true },
  { name: "sort_order", label: "Thứ tự hiển thị", type: "number" },
  { name: "is_active", label: "Trạng thái", type: "checkbox", text: "Đang dùng (hiện trong form Thêm lead)", wide: true },
];

/** Marketing → TKQC & Page: tài khoản quảng cáo (và ai phụ trách), page, kênh. */
export function TkqcPageManager() {
  const { catalogs, reload } = useCatalogs();
  const managesMarketing = useManagesMarketing();
  // Cơ sở dữ liệu chưa cập nhật thì trang này chỉ để xem (form mới ghi các cột chưa có).
  const canManage = managesMarketing && catalogs.marketingReady;
  const names = useCatalogNames();
  const [channelDialog, setChannelDialog] = useState<{ open: boolean; row: Channel | null }>({ open: false, row: null });
  const [pageDialog, setPageDialog] = useState<{ open: boolean; row: Page | null }>({ open: false, row: null });
  const page = pageDialog.row;

  const count = (channelId: string) => ({
    accounts: catalogs.adAccounts.filter((a) => a.channel_id === channelId).length,
    pages: catalogs.pages.filter((p) => p.channel_id === channelId).length,
  });

  const pageFields: FieldDef[] = [
    { name: "name", label: "Tên page", type: "text", required: true, wide: true },
    {
      name: "channel_id",
      label: "Thuộc kênh",
      type: "select",
      required: true,
      options: catalogs.channels
        .filter((c) => c.is_active || c.id === page?.channel_id)
        .map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: "branch",
      label: "Miền",
      type: "select",
      required: true,
      options: catalogs.regions
        .filter((r) => r.is_active || r.code === page?.branch)
        .map((r) => ({ value: r.code, label: r.name })),
    },
    { name: "url", label: "Link page", type: "text", placeholder: "https://www.facebook.com/…", wide: true },
    {
      name: "page_staff_ids",
      label: "Trực page phụ trách",
      type: "checks",
      wide: true,
      emptyText: "Chưa có tài khoản nào có vai trò Trực page.",
      options: catalogs.staff
        .filter((s) => (s.role === "page" && !s.locked_at) || page?.page_staff_ids.includes(s.user_id))
        .map((s) => ({ value: s.user_id, label: s.full_name })),
    },
    { name: "is_active", label: "Trạng thái", type: "checkbox", text: "Đang dùng", wide: true },
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
    const url = toText(values.url);
    if (url && !/^https?:\/\//i.test(url)) throw new Error("Link page phải bắt đầu bằng https://");
    await saveCatalogRow(
      "pages",
      page?.id ?? null,
      {
        name: toText(values.name),
        channel_id: values.channel_id,
        branch: values.branch,
        url,
        page_staff_ids: toIds(values.page_staff_ids),
        is_active: Boolean(values.is_active),
      },
      "Kênh này đã có page trùng tên.",
    );
    await reload();
    toast.success(page ? "Đã cập nhật page" : "Đã thêm page");
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={Share2}
        title="TKQC & Page"
        description="Tài khoản quảng cáo và người phụ trách theo từng khoảng ngày; các page nhận tin nhắn; kênh quảng cáo."
      />

      <CatalogGate>
        <MarketingNotReady what="Danh mục TKQC, và việc thêm / sửa page, kênh ở trang này," />
        {catalogs.marketingReady && !managesMarketing && (
          <ReadOnlyNote>
            Bạn đang xem ở chế độ chỉ đọc: chỉ Quản trị và Trưởng Marketing thêm / sửa được TKQC, page, kênh.
            Nhân viên Ads chỉ thấy các TKQC được giao.
          </ReadOnlyNote>
        )}

        {catalogs.marketingReady && <AdAccountsSection />}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="grid content-start gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Page</h2>
              {canManage && (
                <Button variant="outline" onClick={() => setPageDialog({ open: true, row: null })}>
                  <Plus />
                  Thêm page
                </Button>
              )}
            </div>
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Page</TableHead>
                    <TableHead>Kênh</TableHead>
                    <TableHead>Miền</TableHead>
                    <TableHead>Trực page phụ trách</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalogs.pages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        Chưa có page nào.
                      </TableCell>
                    </TableRow>
                  ) : (
                    catalogs.pages.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.name}</div>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-64 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              <span className="truncate">{item.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                              <ExternalLink className="size-3 shrink-0" />
                            </a>
                          )}
                        </TableCell>
                        <TableCell>{names.channel(item.channel_id) ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{names.region(item.branch) ?? item.branch}</TableCell>
                        <TableCell>
                          {item.page_staff_ids.length > 0 ? (
                            item.page_staff_ids.map((id) => names.staff(id) ?? "…").join(", ")
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ActivePill active={item.is_active} />
                        </TableCell>
                        <TableCell>
                          {canManage && (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Sửa page ${item.name}`}
                                onClick={() => setPageDialog({ open: true, row: item })}
                              >
                                <Pencil />
                              </Button>
                              <DeleteRowButton table="pages" id={item.id} what={`page ${item.name}`} />
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
                    <TableHead className="text-right">TKQC</TableHead>
                    <TableHead className="text-right">Page</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalogs.channels.map((channel) => {
                    const n = count(channel.id);
                    return (
                      <TableRow key={channel.id}>
                        <TableCell className="font-medium">{channel.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{n.accounts}</TableCell>
                        <TableCell className="text-right tabular-nums">{n.pages}</TableCell>
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
                    );
                  })}
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
        title={page ? "Sửa page" : "Thêm page"}
        fields={pageFields}
        initialValues={{
          name: page?.name ?? "",
          channel_id: page?.channel_id ?? NONE,
          branch: page?.branch ?? catalogs.regions[0]?.code ?? NONE,
          url: page?.url ?? "",
          page_staff_ids: (page?.page_staff_ids ?? []).join(","),
          is_active: page?.is_active ?? true,
        }}
        onSubmit={savePage}
      />
    </div>
  );
}
