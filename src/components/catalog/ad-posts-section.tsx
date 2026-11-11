"use client";

import { ExternalLink, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCatalogNames, useCatalogs } from "@/components/catalog-provider";
import { FormDialog, NONE, toId, toText, type FieldDef, type FormValues } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveAdPost } from "@/lib/catalog/repo";
import { POST_STATUS_LABELS, type AdPost } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { useAdsScope } from "./ads-scope";
import { DeleteRowButton, formatDate } from "./shared";

const ALL = "__all";
const UNDECLARED = "__undeclared";

const PLATFORM_LABELS: Record<string, string> = { facebook: "Facebook", tiktok: "TikTok", other: "Khác" };

/** Lời giải thích khi hệ thống không tách được ID bài từ link. */
const NO_POST_ID =
  "Link này không chứa ID bài (link rút gọn hoặc link chia sẻ), nên hệ thống chỉ so khớp được khi trực page dán đúng link này. Nên dùng link đầy đủ của bài.";

/** Tên hiển thị của một bài: tên gợi nhớ, hoặc link rút gọn cho dễ nhìn. */
const postLabel = (post: AdPost) => post.title ?? post.url.replace(/^https?:\/\/(www\.)?/, "");

function StatusPill({ status }: { status: AdPost["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        status === "active" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
        status === "paused" && "bg-muted text-muted-foreground",
        status === "undeclared" && "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
      )}
    >
      {POST_STATUS_LABELS[status]}
    </span>
  );
}

/** Bảng bài post: mỗi bài thuộc một chiến dịch; ID bài và ID ads do hệ thống tự tách từ link. */
export function AdPostsSection() {
  const { catalogs, reload } = useCatalogs();
  const scope = useAdsScope();
  const names = useCatalogNames();
  const [filter, setFilter] = useState(ALL);
  const [editing, setEditing] = useState<{ open: boolean; row: AdPost | null }>({ open: false, row: null });
  const row = editing.row;

  const editableCampaigns = catalogs.campaigns.filter((c) => c.ad_account_id && scope.canEditAccount(c.ad_account_id));
  const undeclaredCount = catalogs.adPosts.filter((p) => p.status === "undeclared").length;
  const posts = catalogs.adPosts.filter((post) =>
    filter === ALL ? true : filter === UNDECLARED ? post.status === "undeclared" : post.campaign_id === filter,
  );
  // Bài "Chưa khai báo" thì Nhân viên Ads nào cũng được nhận về chiến dịch của mình.
  const canEdit = (post: AdPost) =>
    post.campaign_id ? scope.canEditCampaign(post.campaign_id) : scope.managesMarketing || scope.isAdsStaff;

  const fields: FieldDef[] = [
    {
      name: "url",
      label: "Link bài post",
      type: "text",
      required: true,
      wide: true,
      placeholder: "Dán link bài trên Facebook / TikTok",
    },
    {
      name: "campaign_id",
      label: "Thuộc chiến dịch",
      type: "select",
      required: true,
      wide: true,
      options: editableCampaigns
        .filter((c) => c.is_active || c.id === row?.campaign_id)
        .map((c) => ({ value: c.id, label: `${c.name} — ${names.adAccount(c.ad_account_id) ?? "?"}` })),
    },
    { name: "title", label: "Tên gợi nhớ", type: "text", placeholder: "vd Video niềng răng 01" },
    {
      name: "media_type",
      label: "Loại nội dung",
      type: "select",
      emptyLabel: "Chưa chọn",
      options: [
        { value: "image", label: "Hình" },
        { value: "video", label: "Video" },
      ],
    },
    { name: "start_date", label: "Ngày bắt đầu chạy", type: "date" },
    { name: "ad_id", label: "ID ads (nếu link không kèm)", type: "text" },
    { name: "note", label: "Ghi chú", type: "text", wide: true },
    { name: "is_running", label: "Trạng thái", type: "checkbox", text: "Đang chạy (bỏ tick = tạm dừng)", wide: true },
  ];

  async function save(values: FormValues) {
    const saved = await saveAdPost(row?.id ?? null, {
      url: toText(values.url),
      campaign_id: toId(values.campaign_id),
      title: toText(values.title),
      media_type: toId(values.media_type),
      start_date: toText(values.start_date),
      ad_id: toText(values.ad_id),
      note: toText(values.note),
      status: values.is_running ? "active" : "paused",
    });
    await reload();
    const done = row ? (row.status === "undeclared" ? "Đã khai báo bài post" : "Đã cập nhật bài post") : "Đã thêm bài post";
    if (saved.post_id) {
      toast.success(done, {
        description: `ID bài ${saved.post_id}${saved.ad_id ? ` · ID ads ${saved.ad_id}` : ""}`,
      });
    } else {
      toast.warning(done, { description: NO_POST_ID, duration: 10000 });
    }
  }

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">
          Bài post
          {undeclaredCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter(UNDECLARED)}
              className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200"
            >
              {undeclaredCount} bài chưa khai báo
            </button>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-64" aria-label="Lọc bài post theo chiến dịch">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tất cả chiến dịch</SelectItem>
              <SelectItem value={UNDECLARED}>Bài chưa khai báo</SelectItem>
              {catalogs.campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editableCampaigns.length > 0 && (
            <Button onClick={() => setEditing({ open: true, row: null })}>
              <Plus />
              Thêm bài post
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Bài post</TableHead>
              <TableHead>Chiến dịch</TableHead>
              <TableHead>ID bài</TableHead>
              <TableHead>ID ads</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead>Ngày chạy</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {catalogs.adPosts.length === 0
                    ? "Chưa có bài post nào. Thêm chiến dịch (có gắn TKQC) trước, rồi thêm bài post."
                    : "Không có bài post nào khớp bộ lọc."}
                </TableCell>
              </TableRow>
            ) : (
              posts.map((post) => (
                <TableRow key={post.id}>
                  <TableCell>
                    <div className="max-w-80 truncate font-medium" title={postLabel(post)}>
                      {postLabel(post)}
                    </div>
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-80 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <span className="truncate">{post.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                      <ExternalLink className="size-3 shrink-0" />
                    </a>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {names.campaign(post.campaign_id) ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {post.post_id ? (
                      <>
                        <div className="tabular-nums">{post.post_id}</div>
                        <div className="text-xs text-muted-foreground">
                          {PLATFORM_LABELS[post.platform ?? "other"] ?? post.platform}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-amber-700 dark:text-amber-300" title={NO_POST_ID}>
                        Không tách được
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{post.ad_id ?? "—"}</TableCell>
                  <TableCell>
                    {post.media_type === "image" ? "Hình" : post.media_type === "video" ? "Video" : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatDate(post.start_date)}</TableCell>
                  <TableCell>
                    <StatusPill status={post.status} />
                  </TableCell>
                  <TableCell>
                    {canEdit(post) && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Sửa bài post ${postLabel(post)}`}
                          title={post.status === "undeclared" ? "Khai báo bài này vào chiến dịch" : "Sửa"}
                          onClick={() => setEditing({ open: true, row: post })}
                        >
                          <Pencil />
                        </Button>
                        <DeleteRowButton table="ad_posts" id={post.id} what={`bài post ${postLabel(post)}`} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <FormDialog
        open={editing.open}
        onOpenChange={(open) => setEditing((prev) => ({ ...prev, open }))}
        title={row ? (row.status === "undeclared" ? "Khai báo bài post" : "Sửa bài post") : "Thêm bài post"}
        description="Hệ thống tự tách ID bài và ID ads từ link sau khi lưu."
        fields={fields}
        initialValues={{
          url: row?.url ?? "",
          campaign_id: row?.campaign_id ?? (filter !== ALL && filter !== UNDECLARED ? filter : NONE),
          title: row?.title ?? "",
          media_type: row?.media_type ?? NONE,
          start_date: row?.start_date ?? "",
          ad_id: row?.ad_id ?? "",
          note: row?.note ?? "",
          is_running: row ? row.status !== "paused" : true,
        }}
        onSubmit={save}
      />
    </section>
  );
}
