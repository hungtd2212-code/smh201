"use client";

import { ExternalLink, Pause, Pencil, Play, Plug, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useCatalogs } from "@/components/catalog-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { vnDateTime } from "@/lib/leads/crm";
import {
  IMPORT_OUTCOMES,
  PANCAKE_ID_HINT,
  pancakeConversationUrl,
  pancakeHealth,
  pancakeProblems,
  pancakeTokenProblem,
  parsePancakePageId,
  type PancakeImport,
  type PancakePage,
} from "@/lib/leads/pancake";
import { fetchPancakeImports, fetchPancakePages, pancakeSyncNow, savePancakePage, setPancakeActive } from "@/lib/leads/pancake-repo";
import { cn } from "@/lib/utils";

const NONE = "__none";
const REFRESH_MS = 30_000;
/** Pancake trả lời sau vài giây (gọi nền), nên "Đồng bộ ngay" hỏi rồi chờ chừng này mới đọc câu trả lời. */
const ANSWER_WAIT_MS = 5_000;

const HEALTH_DOT = {
  ok: "bg-emerald-500",
  waiting: "bg-sky-500 animate-pulse",
  warn: "bg-amber-500",
  error: "bg-red-500",
  paused: "bg-muted-foreground/40",
} as const;
const HEALTH_TEXT = {
  ok: "text-muted-foreground",
  waiting: "text-sky-700 dark:text-sky-300",
  warn: "text-amber-700 dark:text-amber-300",
  error: "text-red-700 dark:text-red-300",
  paused: "text-muted-foreground",
} as const;
const OUTCOME_STYLE = {
  ok: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  muted: "bg-muted text-muted-foreground",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  error: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
} as const;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Telesale → Cài đặt → Kết nối Pancake (Admin, COO, Trưởng Telesale). Mỗi phút hệ thống hỏi Pancake các hội
 * thoại vừa có hoạt động; số điện thoại khách để lại tự vào bảng Lead và được chia như nút "Thêm số".
 */
export function PancakeSettings() {
  const { catalogs } = useCatalogs();
  const [conns, setConns] = useState<PancakePage[] | null>(null);
  const [imports, setImports] = useState<PancakeImport[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PancakePage | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextConns, nextImports] = await Promise.all([fetchPancakePages(), fetchPancakeImports(30)]);
      setConns(nextConns);
      setImports(nextImports);
      setLoadError(null);
      return nextConns;
    } catch (error) {
      setLoadError(message(error));
      return null;
    }
  }, []);

  useEffect(() => {
    // Lần tải đầu chạy sau khi gắn vào trang; sau đó tự làm mới để thấy số mới và tình trạng kết nối.
    const first = setTimeout(load, 0);
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const pageName = (id: string) =>
    catalogs.pages.find((p) => p.id === id)?.name ?? catalogs.trashed.pages.find((p) => p.id === id)?.name ?? "Page đã xoá";
  const connName = (pancakePageId: string) => {
    const conn = conns?.find((c) => c.pancake_page_id === pancakePageId);
    return conn ? pageName(conn.page_id) : pancakePageId;
  };

  /** Hỏi Pancake ngay, chờ câu trả lời rồi báo kết quả. checkId: kết nối vừa lưu, báo lỗi nếu có. */
  async function syncNow(checkId?: string) {
    setBusy("sync");
    try {
      const first = await pancakeSyncNow();
      await wait(ANSWER_WAIT_MS);
      const second = await pancakeSyncNow();
      const fresh = await load();
      const added = (first.added ?? 0) + (second.added ?? 0);
      const checked = checkId ? fresh?.find((c) => c.id === checkId) : undefined;
      if (checked?.last_error) {
        toast.error("Pancake chưa nhận kết nối", { description: pancakeHealth(checked).label });
      } else if (checked && !checked.last_ok_at) {
        toast.message("Đã lưu — Pancake trả lời chậm", { description: "Tình trạng sẽ tự cập nhật trong 1–2 phút." });
      } else {
        toast.success(added > 0 ? `Đã kéo về ${added} số` : checkId ? "Kết nối được với Pancake" : "Đã hỏi Pancake — chưa có số mới");
      }
    } catch (error) {
      toast.error("Không đồng bộ được", { description: message(error) });
    } finally {
      setBusy(null);
    }
  }

  async function toggle(conn: PancakePage) {
    setBusy(conn.id);
    try {
      await setPancakeActive(conn.id, !conn.is_active);
      await load();
      toast.success(conn.is_active ? `${pageName(conn.page_id)}: đã tạm dừng` : `${pageName(conn.page_id)}: chạy lại, lấy số từ bây giờ`);
    } catch (error) {
      toast.error("Không đổi được", { description: message(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4 xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="font-semibold">Kết nối Pancake</h2>
          <p className="text-sm text-muted-foreground">
            Số điện thoại khách để lại trong tin nhắn / bình luận trên Pancake tự vào bảng Lead sau 1–2 phút, chia sale
            theo cách chia số ở trên. Số đã có thì giữ sale cũ và báo khách nhắn lại.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {conns && conns.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => syncNow()} disabled={busy !== null}>
              <RefreshCw className={cn(busy === "sync" && "animate-spin")} />
              {busy === "sync" ? "Đang hỏi Pancake…" : "Đồng bộ ngay"}
            </Button>
          )}
          <Button size="sm" onClick={() => setEditing("new")} disabled={busy !== null || conns === null}>
            <Plug />
            Kết nối page
          </Button>
        </div>
      </div>

      {conns && <LostConnections conns={conns} pageName={pageName} />}

      {loadError ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {loadError}
        </p>
      ) : conns === null ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : conns.length === 0 ? (
        <HowTo noPages={!catalogs.pages.some((p) => p.is_active && !p.deleted_at)} />
      ) : (
        <ul className="grid divide-y rounded-lg border">
          {conns.map((conn) => {
            const health = pancakeHealth(conn);
            return (
              <li key={conn.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className={cn("size-2.5 shrink-0 rounded-full", HEALTH_DOT[health.tone])} aria-hidden />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-medium">{pageName(conn.page_id)}</span>
                  <span className="text-xs text-muted-foreground">
                    Pancake {conn.pancake_page_id}
                    {conn.token_hint && ` · token …${conn.token_hint}`}
                  </span>
                  <span className={cn("text-xs", HEALTH_TEXT[health.tone])}>{health.label}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setEditing(conn)}>
                    <Pencil />
                    Sửa
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => toggle(conn)}>
                    {conn.is_active ? <Pause /> : <Play />}
                    {conn.is_active ? "Tạm dừng" : "Chạy lại"}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {conns && conns.length > 0 && <ImportLog imports={imports} connName={connName} />}

      <ConnectDialog
        editing={editing}
        conns={conns ?? []}
        onClose={() => setEditing(null)}
        onSaved={async (id) => {
          setEditing(null);
          await load();
          await syncNow(id);
        }}
      />
    </section>
  );
}

/** Cảnh báo đỏ khi có page mất kết nối: số mới của page đó đang không tự về bảng Lead. */
function LostConnections({ conns, pageName }: { conns: PancakePage[]; pageName: (id: string) => string }) {
  const problems = pancakeProblems(conns);
  if (problems.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex gap-2.5 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="grid gap-1">
        <p className="font-semibold">
          Mất kết nối Pancake ở {problems.length} page — số điện thoại mới của {problems.length > 1 ? "các page này" : "page này"} đang
          KHÔNG tự về bảng Lead
        </p>
        <ul className="grid gap-0.5">
          {problems.map(({ conn, health }) => (
            <li key={conn.id}>
              <span className="font-medium">{pageName(conn.page_id)}</span>: {health.label}
            </li>
          ))}
        </ul>
        <p className="text-xs opacity-80">
          Bấm “Đồng bộ ngay” để thử lại. Vẫn lỗi thì bấm Sửa ở page đó và dán lại Page Access Token (Pancake → page → Cài đặt
          → Công cụ).
        </p>
      </div>
    </div>
  );
}

function HowTo({ noPages }: { noPages: boolean }) {
  return (
    <div className="grid gap-1 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
      {noPages && (
        <p className="mb-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Trong ERP chưa có page nào. Thêm page trước ở{" "}
          <Link href="/marketing/cai-dat?tab=tkqc" className="font-medium underline">
            Marketing → Cài đặt → TKQC &amp; Page
          </Link>
          , rồi quay lại đây kết nối.
        </p>
      )}
      <p className="font-medium text-foreground">Chưa kết nối page nào. Cần 2 thứ cho mỗi page:</p>
      <ol className="ml-4 list-decimal space-y-0.5">
        <li>
          <strong>Page Access Token</strong>: mở Pancake, chọn page → Cài đặt → Công cụ → copy “Page Access Token”.
        </li>
        <li>
          <strong>ID page</strong>: tự điền khi chọn page đã thêm ở TKQC &amp; Page. Nếu phải gõ thì là dãy số ID của
          page (vd 1500650126455233), không phải tên page.
        </li>
      </ol>
      <p>Token như mật khẩu của page: chỉ dán vào đây, không gửi qua tin nhắn.</p>
    </div>
  );
}

function ImportLog({ imports, connName }: { imports: PancakeImport[]; connName: (pancakePageId: string) => string }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Số kéo về gần đây</h3>
      {imports.length === 0 ? (
        <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">
          Chưa có số nào. Khi khách để lại số trong tin nhắn / bình luận, số sẽ hiện ở đây.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="border-b px-3 py-1.5 font-medium">Lúc</th>
                <th className="border-b px-3 py-1.5 font-medium">Page</th>
                <th className="border-b px-3 py-1.5 font-medium">Khách</th>
                <th className="border-b px-3 py-1.5 font-medium">Số</th>
                <th className="border-b px-3 py-1.5 font-medium">Kết quả</th>
                <th className="border-b px-3 py-1.5 font-medium">
                  <span className="sr-only">Mở hội thoại</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {imports.map((row) => {
                const outcome = IMPORT_OUTCOMES[row.outcome];
                return (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{vnDateTime(row.created_at)?.short}</td>
                    <td className="px-3 py-1.5">{connName(row.pancake_page_id)}</td>
                    <td className="px-3 py-1.5">
                      {row.full_name}
                      {row.conversation_type === "COMMENT" && <span className="ml-1 text-xs text-muted-foreground">(bình luận)</span>}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{row.phone}</td>
                    <td className="px-3 py-1.5">
                      <span className={cn("rounded px-1.5 py-0.5 text-xs whitespace-nowrap", OUTCOME_STYLE[outcome.tone])} title={row.error ?? undefined}>
                        {outcome.label}
                      </span>
                      {row.error && <span className="ml-1 text-xs text-muted-foreground">{row.error}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <a
                        href={pancakeConversationUrl(row.pancake_page_id, row.conversation_id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Pancake
                        <ExternalLink className="size-3" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConnectDialog({
  editing,
  conns,
  onClose,
  onSaved,
}: {
  editing: PancakePage | "new" | null;
  conns: PancakePage[];
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {editing && (
          <ConnectForm
            key={editing === "new" ? "new" : editing.id}
            conn={editing === "new" ? null : editing}
            others={conns.filter((c) => editing === "new" || c.id !== editing.id)}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConnectForm({
  conn,
  others,
  onClose,
  onSaved,
}: {
  conn: PancakePage | null;
  /** Các kết nối khác: để ẩn page đã kết nối và bắt lỗi dán lại token của page khác. */
  others: PancakePage[];
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const { catalogs } = useCatalogs();
  const connectedPageIds = new Set(others.map((c) => c.page_id));
  const pages = catalogs.pages.filter(
    (p) => !p.deleted_at && (p.is_active || p.id === conn?.page_id) && !connectedPageIds.has(p.id),
  );
  const channelName = (id: string) => catalogs.channels.find((c) => c.id === id)?.name;
  const [pageId, setPageId] = useState(conn?.page_id ?? NONE);
  const [rawId, setRawId] = useState(conn?.pancake_page_id ?? "");
  const [token, setToken] = useState("");
  const [fromToday, setFromToday] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsedId = parsePancakePageId(rawId);
  const showParsed = parsedId !== null && parsedId !== rawId.trim();
  // Mỗi page có token riêng: 4 ký tự cuối trùng token của page khác = gần như chắc chắn dán lại token cũ.
  const reused =
    token.trim().length >= 20 ? others.find((c) => c.token_hint && c.token_hint === token.trim().slice(-4)) : undefined;
  const tokenProblem =
    pancakeTokenProblem(token) ??
    (reused
      ? `Token này là của page “${catalogs.pages.find((p) => p.id === reused.page_id)?.name ?? reused.pancake_page_id}” (dán lại token cũ). Mỗi page có token riêng — copy lại ở đúng page này.`
      : null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pageId === NONE) return setError("Chọn page trong ERP");
    if (!parsedId) return setError(PANCAKE_ID_HINT);
    if (!conn && !token.trim()) return setError("Dán Page Access Token của page");
    if (tokenProblem) return setError(tokenProblem);
    setSaving(true);
    setError(null);
    try {
      const id = await savePancakePage({
        id: conn?.id ?? null,
        pancakePageId: parsedId,
        pageId,
        token: token.trim() || null,
        fromToday: !conn && fromToday,
      });
      toast.success(conn ? "Đã lưu kết nối" : "Đã kết nối — đang hỏi Pancake lần đầu…");
      await onSaved(id);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{conn ? "Sửa kết nối Pancake" : "Kết nối page Pancake"}</DialogTitle>
        <DialogDescription>
          Lấy token ở Pancake: chọn page → Cài đặt → Công cụ → “Page Access Token”. Token được cất riêng, sau khi lưu
          không ai xem lại được.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label>Page trong ERP</Label>
        <Select
          value={pageId}
          onValueChange={(value) => {
            setPageId(value);
            setError(null);
            // Page có link Facebook dạng số thì điền đúng ID của page đó (thay cả chữ đang có trong ô).
            const url = catalogs.pages.find((p) => p.id === value)?.url;
            const guess = url ? parsePancakePageId(url) : null;
            if (guess && /^\d{6,}$/.test(guess)) setRawId(guess);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Page trong ERP">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{pages.length === 0 ? "Chưa có page — thêm ở Marketing → TKQC & Page" : "Chọn page…"}</SelectItem>
            {pages.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {channelName(p.channel_id) && <span className="text-muted-foreground"> · {channelName(p.channel_id)}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Số kéo về được ghi nguồn là page này.</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="pancake-id">ID page trên Pancake</Label>
        <Input
          id="pancake-id"
          value={rawId}
          placeholder="Tự điền khi chọn page — hoặc gõ dãy số, vd 1500650126455233"
          autoComplete="off"
          onChange={(e) => {
            setRawId(e.target.value);
            setError(null);
          }}
        />
        {showParsed && <p className="text-xs text-muted-foreground">ID nhận được: {parsedId}</p>}
        {rawId.trim() !== "" && parsedId === null && <p className="text-xs text-destructive">{PANCAKE_ID_HINT}</p>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="pancake-token">Page Access Token</Label>
        <Input
          id="pancake-token"
          type="password"
          value={token}
          autoComplete="off"
          spellCheck={false}
          placeholder={conn?.token_hint ? `Để trống để giữ token cũ (…${conn.token_hint})` : "Dán token của page"}
          onChange={(e) => {
            setToken(e.target.value);
            setError(null);
          }}
          aria-invalid={Boolean(tokenProblem)}
        />
        {tokenProblem && <p className="text-xs text-destructive">{tokenProblem}</p>}
      </div>

      {!conn && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={fromToday}
            onChange={(e) => setFromToday(e.target.checked)}
          />
          <span>
            Lấy cả số khách để lại <strong>từ đầu hôm nay</strong>
            <span className="block text-xs text-muted-foreground">Không tick thì chỉ lấy số từ lúc kết nối trở đi.</span>
          </span>
        </label>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Huỷ
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : conn ? "Lưu" : "Kết nối"}
        </Button>
      </DialogFooter>
    </form>
  );
}
