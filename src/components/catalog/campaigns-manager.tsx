"use client";

import { Megaphone, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { byId, useCatalogNames, useCatalogs } from "@/components/catalog-provider";
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
import { OBJECTIVE_LABELS, type Campaign } from "@/lib/catalog/types";
import { AdPostsSection } from "./ad-posts-section";
import { coversDay, useAdsScope } from "./ads-scope";
import {
  ActivePill,
  CatalogGate,
  DeleteRowButton,
  MarketingNotReady,
  PageHeader,
  ReadOnlyNote,
  formatDate,
  formatVnd,
  useTodayVn,
} from "./shared";

/**
 * Marketing → Chiến dịch & Bài post. Mỗi chiến dịch chạy trong một TKQC; mỗi bài post thuộc một
 * chiến dịch. Trực page dán link bài → hệ thống biết lead đến từ Bài → Chiến dịch → TKQC → Nhân viên Ads nào.
 */
export function CampaignsManager() {
  const { catalogs, reload } = useCatalogs();
  const scope = useAdsScope();
  const names = useCatalogNames();
  const [editing, setEditing] = useState<{ open: boolean; row: Campaign | null }>({ open: false, row: null });
  const row = editing.row;
  const ready = catalogs.marketingReady;

  const accounts = byId(catalogs.adAccounts);
  const today = useTodayVn();
  /** Người đang phụ trách TKQC của chiến dịch (chiến dịch cũ chưa gắn TKQC thì lấy "người phụ trách" cũ). */
  const ownerOf = (campaign: Campaign) => {
    if (!campaign.ad_account_id) return names.staff(campaign.owner_id);
    const current = catalogs.assignments.find(
      (x) => x.ad_account_id === campaign.ad_account_id && coversDay(x, today),
    );
    return current ? names.adsStaff(current.ads_staff_id) : undefined;
  };
  const postCount = (campaignId: string) => catalogs.adPosts.filter((p) => p.campaign_id === campaignId).length;

  const fields: FieldDef[] = [
    { name: "name", label: "Tên chiến dịch", type: "text", required: true, wide: true },
    {
      name: "ad_account_id",
      label: "TKQC",
      type: "select",
      required: true,
      resets: ["page_id"],
      options: catalogs.adAccounts
        .filter((a) => (a.is_active && scope.canEditAccount(a.id)) || a.id === row?.ad_account_id)
        .map((a) => ({ value: a.id, label: `${a.name} — ${names.channel(a.channel_id) ?? "?"}` })),
    },
    {
      name: "objective",
      label: "Mục tiêu",
      type: "select",
      emptyLabel: "Chưa chọn",
      options: Object.entries(OBJECTIVE_LABELS).map(([value, label]) => ({ value, label })),
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
      name: "page_id",
      label: "Chạy trên page",
      type: "select",
      emptyLabel: "Không gắn page",
      options: (values) => {
        const channelId = accounts.get(String(values.ad_account_id))?.channel_id;
        return catalogs.pages
          .filter((p) => p.channel_id === channelId && (p.is_active || p.id === row?.page_id))
          .map((p) => ({ value: p.id, label: p.name }));
      },
    },
    { name: "ads_id", label: "ID camp", type: "text" },
    { name: "start_date", label: "Ngày bắt đầu chạy", type: "date" },
    { name: "end_date", label: "Ngày kết thúc", type: "date" },
    { name: "budget", label: "Ngân sách (đ)", type: "number" },
    { name: "is_active", label: "Trạng thái", type: "checkbox", text: "Đang chạy", wide: true },
  ];

  async function save(values: FormValues) {
    const start = toText(values.start_date);
    const end = toText(values.end_date);
    if (start && end && end < start) throw new Error("Ngày kết thúc phải sau ngày bắt đầu.");
    const account = accounts.get(String(values.ad_account_id));
    if (!account) throw new Error("Hãy chọn TKQC.");

    await saveCatalogRow("campaigns", row?.id ?? null, {
      name: toText(values.name),
      ad_account_id: account.id,
      channel_id: account.channel_id, // kênh của chiến dịch đi theo kênh của TKQC
      objective: toId(values.objective),
      service_id: toId(values.service_id),
      page_id: toId(values.page_id),
      ads_id: toText(values.ads_id),
      start_date: start,
      end_date: end,
      budget: toNumber(values.budget),
      is_active: Boolean(values.is_active),
    });
    await reload();
    toast.success(row ? "Đã cập nhật chiến dịch" : "Đã thêm chiến dịch");
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={Megaphone}
        title="Chiến dịch & Bài post"
        description="Chiến dịch quảng cáo theo từng TKQC và các bài post đang chạy trong mỗi chiến dịch."
      >
        {ready && scope.canAddCampaign && (
          <Button onClick={() => setEditing({ open: true, row: null })}>
            <Plus />
            Thêm chiến dịch
          </Button>
        )}
      </PageHeader>

      <CatalogGate>
        <MarketingNotReady what="Việc thêm / sửa chiến dịch và danh mục bài post" />
        {ready && !scope.managesMarketing && !scope.isAdsStaff && (
          <ReadOnlyNote>
            Bạn đang xem ở chế độ chỉ đọc: chiến dịch và bài post do Quản trị, Trưởng Marketing và Nhân viên Ads
            (trong TKQC của mình) thêm / sửa.
          </ReadOnlyNote>
        )}
        {ready && scope.isAdsStaff && (
          <ReadOnlyNote>
            Bạn thấy các chiến dịch và bài post thuộc TKQC được giao, và thêm / sửa được trong các TKQC đang phụ trách.
            {!scope.canAddCampaign && " Hiện bạn chưa được giao TKQC nào."}
          </ReadOnlyNote>
        )}

        <section className="grid gap-3">
          <h2 className="font-medium">Chiến dịch</h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Chiến dịch</TableHead>
                  <TableHead>TKQC › Phụ trách</TableHead>
                  <TableHead>Mục tiêu</TableHead>
                  <TableHead>Dịch vụ</TableHead>
                  <TableHead>Ngày chạy</TableHead>
                  <TableHead className="text-right">Ngân sách</TableHead>
                  <TableHead className="text-right">Bài post</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogs.campaigns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                      Chưa có chiến dịch nào. Tạo TKQC ở “TKQC &amp; Page” trước, rồi thêm chiến dịch.
                    </TableCell>
                  </TableRow>
                ) : (
                  catalogs.campaigns.map((campaign) => (
                    <TableRow key={campaign.id}>
                      <TableCell>
                        <div className="font-medium">{campaign.name}</div>
                        {campaign.ads_id && (
                          <div className="text-xs text-muted-foreground">ID camp {campaign.ads_id}</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {campaign.ad_account_id ? (
                          (names.adAccount(campaign.ad_account_id) ?? "…")
                        ) : (
                          <span className="text-muted-foreground">Chưa gắn TKQC</span>
                        )}
                        {ownerOf(campaign) && ` › ${ownerOf(campaign)}`}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {campaign.objective ? OBJECTIVE_LABELS[campaign.objective] : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{names.service(campaign.service_id) ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDate(campaign.start_date)}
                        {campaign.end_date && ` → ${formatDate(campaign.end_date)}`}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {formatVnd(campaign.budget)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{ready ? postCount(campaign.id) : "—"}</TableCell>
                      <TableCell>
                        <ActivePill active={campaign.is_active} onLabel="Đang chạy" />
                      </TableCell>
                      <TableCell>
                        {ready && scope.canEditAccount(campaign.ad_account_id) && (
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
        </section>

        {ready && <AdPostsSection />}
      </CatalogGate>

      <FormDialog
        open={editing.open}
        onOpenChange={(open) => setEditing((prev) => ({ ...prev, open }))}
        title={row ? "Sửa chiến dịch" : "Thêm chiến dịch"}
        fields={fields}
        initialValues={{
          name: row?.name ?? "",
          ad_account_id: row?.ad_account_id ?? NONE,
          objective: row?.objective ?? NONE,
          service_id: row?.service_id ?? NONE,
          page_id: row?.page_id ?? NONE,
          ads_id: row?.ads_id ?? "",
          start_date: row?.start_date ?? "",
          end_date: row?.end_date ?? "",
          budget: row?.budget?.toString() ?? "",
          is_active: row?.is_active ?? true,
        }}
        onSubmit={save}
      />
    </div>
  );
}
