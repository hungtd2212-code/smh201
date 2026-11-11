"use client";

import { format } from "date-fns";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  DatabaseBackup,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/catalog/shared";
import { FormDialog, type FieldDef, type FormValues } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  fetchBackupRuns,
  fetchSafetyCounts,
  fetchSafetySettings,
  logRestoreTest,
  saveSafetySettings,
} from "@/lib/safety/repo";
import type { BackupRun, SafetySettings } from "@/lib/safety/types";
import { SUPABASE_URL } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { AdminOnly, errorText, useRole } from "./shared";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Sao lưu chạy hằng đêm → quá 26 giờ chưa có bản mới là có vấn đề. */
const BACKUP_STALE_MS = 26 * HOUR_MS;
/** Chạy thử khôi phục mỗi quý → quá 92 ngày là đã trễ. */
const RESTORE_TEST_STALE_MS = 92 * DAY_MS;

type Tone = "ok" | "warn" | "todo";

const KIND_LABELS: Record<BackupRun["kind"], string> = {
  database: "Sao lưu cơ sở dữ liệu",
  storage: "Sao lưu file",
  restore_test: "Chạy thử khôi phục",
};

/** 1536000 → "1,5 MB" */
function formatSize(bytes: number | null) {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

const formatTime = (iso: string) => format(new Date(iso), "dd/MM/yyyy HH:mm");

/** Địa chỉ trang quản lý sao lưu của đúng project Supabase đang dùng. */
const supabaseBackupsUrl = () => {
  const ref = SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  return ref
    ? `https://supabase.com/dashboard/project/${ref}/database/backups/scheduled`
    : "https://supabase.com/dashboard";
};

/** Cài đặt → Sao lưu & Khôi phục: tình trạng 4 lớp bảo vệ dữ liệu và các ngưỡng an toàn. */
export function BackupStatus() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={DatabaseBackup}
        title="Sao lưu & Khôi phục"
        description="Bốn lớp bảo vệ dữ liệu của phòng khám và tình trạng hiện tại của từng lớp."
      />
      <AdminOnly>
        <BackupContent />
      </AdminOnly>
    </div>
  );
}

type Loaded = {
  runs: BackupRun[];
  settings: SafetySettings;
  counts: { trash: number; auditWeek: number };
  loadedAt: number;
};

const RESTORE_TEST_FIELDS: FieldDef[] = [
  {
    name: "success",
    label: "Kết quả",
    type: "checkbox",
    text: "Khôi phục thành công, dữ liệu đầy đủ và dùng được",
    wide: true,
  },
  {
    name: "detail",
    label: "Ghi chú (bản sao lưu ngày nào, khôi phục ra đâu, kiểm tra những gì)",
    type: "text",
    wide: true,
  },
];

function BackupContent() {
  const { isSuperAdmin } = useRole();
  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState<{ data?: Loaded; error?: string } | null>(null);
  const [logging, setLogging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBackupRuns(), fetchSafetySettings(), fetchSafetyCounts()])
      .then(([runs, settings, counts]) => {
        if (!cancelled) setState({ data: { runs, settings, counts, loadedAt: Date.now() } });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ error: errorText(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadCount]);

  if (state === null) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    );
  }
  if (!state.data) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
        <p className="font-medium text-destructive">Không tải được tình trạng sao lưu</p>
        <p className="mt-1 text-muted-foreground">{state.error}</p>
      </div>
    );
  }

  const { runs, settings, counts, loadedAt } = state.data;
  const latest = (kind: BackupRun["kind"]) => runs.find((run) => run.kind === kind);
  const latestOk = (kind: BackupRun["kind"]) =>
    runs.find((run) => run.kind === kind && run.status === "success");
  const age = (run: BackupRun | undefined) =>
    run ? loadedAt - new Date(run.started_at).getTime() : Number.POSITIVE_INFINITY;

  const dbRun = latest("database");
  const dbOk = latestOk("database");
  const dbTone: Tone = !dbRun
    ? "todo"
    : dbRun.status === "success" && age(dbRun) < BACKUP_STALE_MS
      ? "ok"
      : "warn";

  const testRun = latest("restore_test");
  const testTone: Tone = !testRun
    ? "todo"
    : testRun.status === "success" && age(testRun) < RESTORE_TEST_STALE_MS
      ? "ok"
      : "warn";

  async function saveRestoreTest(values: FormValues) {
    await logRestoreTest(Boolean(values.success), typeof values.detail === "string" ? values.detail : "");
    toast.success("Đã ghi nhận lần chạy thử khôi phục");
    setReloadCount((n) => n + 1);
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <LayerCard
          tone="ok"
          title="Lớp 1 — Không ai xoá được"
          status="Đang hoạt động"
        >
          <p>
            Nhân viên chỉ chuyển được vào thùng rác; chỉ Quản trị cấp cao xoá vĩnh viễn. Hiện có{" "}
            <strong>{counts.trash.toLocaleString("vi-VN")}</strong> mục trong thùng rác, được giữ tối
            thiểu {settings.trash_min_days} ngày.
          </p>
          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link href="/cai-dat/thung-rac">Mở Thùng rác</Link>
          </Button>
        </LayerCard>

        <LayerCard
          tone="ok"
          title="Lớp 2 — Nhật ký thay đổi"
          status="Đang hoạt động"
        >
          <p>
            Mọi lần thêm, sửa, chuyển vào thùng rác đều được ghi lại và hoàn tác được.{" "}
            <strong>{counts.auditWeek.toLocaleString("vi-VN")}</strong> thay đổi trong 7 ngày qua.
          </p>
          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link href="/cai-dat/nhat-ky">Mở Nhật ký hệ thống</Link>
          </Button>
        </LayerCard>

        <LayerCard
          tone="todo"
          title="Lớp 3 — Sao lưu của Supabase"
          status="Cần kiểm tra trong Supabase"
        >
          <p>
            Sao lưu tự động hằng ngày chỉ có ở gói trả phí của Supabase; khôi phục về đúng từng
            phút (PITR) là tuỳ chọn mua thêm. Ứng dụng không tự biết gói nào đang bật — hãy xem
            ở trang Backups của Supabase.
          </p>
          <p className="text-muted-foreground">
            Lưu ý: bản sao lưu này khôi phục <strong>toàn bộ</strong> cơ sở dữ liệu. Muốn cứu một
            phần thì khôi phục ra project tạm rồi chép phần cần lấy về.
          </p>
          <Button asChild variant="outline" size="sm" className="w-fit">
            <a href={supabaseBackupsUrl()} target="_blank" rel="noreferrer noopener">
              Mở trang Backups của Supabase <ExternalLink />
            </a>
          </Button>
        </LayerCard>

        <LayerCard
          tone={dbTone}
          title="Lớp 4 — Sao lưu riêng, ngoài Supabase"
          status={
            dbTone === "todo"
              ? "Chưa thiết lập"
              : dbTone === "ok"
                ? "Bản mới nhất còn trong 26 giờ"
                : dbRun?.status === "failed"
                  ? "Lần chạy gần nhất bị lỗi"
                  : "Quá 26 giờ chưa có bản mới"
          }
        >
          {dbRun ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-muted-foreground">Lần chạy gần nhất</dt>
              <dd>
                {formatTime(dbRun.started_at)} — {dbRun.status === "success" ? "thành công" : "lỗi"}
              </dd>
              <dt className="text-muted-foreground">Bản thành công gần nhất</dt>
              <dd>{dbOk ? `${formatTime(dbOk.started_at)} · ${formatSize(dbOk.size_bytes)}` : "chưa có"}</dd>
              {dbRun.status === "failed" && dbRun.detail && (
                <>
                  <dt className="text-muted-foreground">Lỗi</dt>
                  <dd className="text-destructive">{dbRun.detail}</dd>
                </>
              )}
            </dl>
          ) : (
            <p>
              Chưa có tác vụ sao lưu hằng đêm nào ghi kết quả về đây. Khi thiết lập xong, mỗi đêm
              hệ thống xuất toàn bộ cơ sở dữ liệu, mã hoá, đẩy sang nơi lưu trữ riêng và báo kết
              quả ở ô này.
            </p>
          )}
        </LayerCard>
      </div>

      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="flex items-center gap-2 font-medium">
              <ToneIcon tone={testTone} />
              Kiểm tra định kỳ — chạy thử khôi phục mỗi quý
            </h2>
            <p className="text-sm text-muted-foreground">
              {testRun
                ? `Lần gần nhất: ${formatTime(testRun.started_at)} — ${testRun.status === "success" ? "thành công" : "không đạt"}${testRun.detail ? ` · ${testRun.detail}` : ""}`
                : "Chưa ghi nhận lần chạy thử nào. Bản sao lưu chưa từng khôi phục thử thì chưa chắc dùng được."}
              {testRun && testTone === "warn" && testRun.status === "success" && " (đã quá 3 tháng)"}
            </p>
          </div>
          <Button variant="outline" onClick={() => setLogging(true)}>
            Ghi nhận một lần chạy thử
          </Button>
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="font-medium">Các lần sao lưu gần đây</h2>
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Thời gian</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>Kết quả</TableHead>
                <TableHead className="text-right">Dung lượng</TableHead>
                <TableHead>Nơi lưu / ghi chú</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    Chưa có lần sao lưu nào được ghi nhận
                  </TableCell>
                </TableRow>
              ) : (
                runs.slice(0, 30).map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatTime(run.started_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{KIND_LABELS[run.kind]}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                          run.status === "success"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                            : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
                        )}
                      >
                        {run.status === "success" ? "Thành công" : "Lỗi"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatSize(run.size_bytes)}</TableCell>
                    <TableCell className="max-w-96 whitespace-normal text-muted-foreground">
                      {[run.location, run.detail].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <SafetySettingsForm
        key={reloadCount}
        settings={settings}
        editable={isSuperAdmin}
        onSaved={() => setReloadCount((n) => n + 1)}
      />

      <FormDialog
        open={logging}
        onOpenChange={setLogging}
        title="Ghi nhận lần chạy thử khôi phục"
        description="Khôi phục một bản sao lưu ra project thử, kiểm tra dữ liệu dùng được, rồi ghi lại kết quả ở đây."
        fields={RESTORE_TEST_FIELDS}
        initialValues={{ success: true, detail: "" }}
        onSubmit={saveRestoreTest}
        submitLabel="Ghi nhận"
      />
    </div>
  );
}

function ToneIcon({ tone }: { tone: Tone }) {
  const Icon: LucideIcon = tone === "ok" ? CircleCheck : tone === "warn" ? CircleAlert : CircleDashed;
  return (
    <Icon
      className={cn(
        "size-4 shrink-0",
        tone === "ok" && "text-emerald-600",
        tone === "warn" && "text-destructive",
        tone === "todo" && "text-amber-600",
      )}
    />
  );
}

function LayerCard({
  tone,
  title,
  status,
  children,
}: {
  tone: Tone;
  title: string;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid content-start gap-2 rounded-xl border bg-card p-4 text-sm">
      <div className="grid gap-0.5">
        <h2 className="text-base font-medium">{title}</h2>
        <p
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium",
            tone === "ok" && "text-emerald-700 dark:text-emerald-300",
            tone === "warn" && "text-destructive",
            tone === "todo" && "text-amber-700 dark:text-amber-300",
          )}
        >
          <ToneIcon tone={tone} />
          {status}
        </p>
      </div>
      {children}
    </section>
  );
}

/** Các ngưỡng an toàn. Ai là Quản trị cũng xem được; chỉ Quản trị cấp cao sửa được. */
function SafetySettingsForm({
  settings,
  editable,
  onSaved,
}: {
  settings: SafetySettings;
  editable: boolean;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    trash_min_days: String(settings.trash_min_days),
    bulk_delete_confirm_over: String(settings.bulk_delete_confirm_over),
    anomaly_max_changes_per_hour: String(settings.anomaly_max_changes_per_hour),
    anomaly_auto_lock: settings.anomaly_auto_lock,
  });
  const [saving, setSaving] = useState(false);

  const numbers = [form.trash_min_days, form.bulk_delete_confirm_over, form.anomaly_max_changes_per_hour];
  const valid = numbers.every((value) => /^\d{1,6}$/.test(value.trim()));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await saveSafetySettings({
        trash_min_days: Number(form.trash_min_days),
        bulk_delete_confirm_over: Number(form.bulk_delete_confirm_over),
        anomaly_max_changes_per_hour: Number(form.anomaly_max_changes_per_hour),
        anomaly_auto_lock: form.anomaly_auto_lock,
      });
      toast.success("Đã lưu các ngưỡng an toàn");
      onSaved();
    } catch (error) {
      toast.error("Không lưu được", { description: errorText(error) });
    } finally {
      setSaving(false);
    }
  }

  const number = (
    name: "trash_min_days" | "bulk_delete_confirm_over" | "anomaly_max_changes_per_hour",
    label: string,
    hint: string,
  ) => (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={`setting-${name}`}>{label}</Label>
      <Input
        id={`setting-${name}`}
        type="number"
        min={0}
        inputMode="numeric"
        className="w-32"
        disabled={!editable}
        value={form[name]}
        onChange={(e) => setForm((prev) => ({ ...prev, [name]: e.target.value }))}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 rounded-xl border bg-card p-4" noValidate>
      <div className="grid gap-1">
        <h2 className="font-medium">Ngưỡng an toàn</h2>
        <p className="text-sm text-muted-foreground">
          {editable
            ? "Chỉ Quản trị cấp cao đổi được các ngưỡng này; mỗi lần đổi đều được ghi vào nhật ký."
            : "Chỉ Quản trị cấp cao đổi được các ngưỡng này."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {number(
          "trash_min_days",
          "Số ngày giữ trong thùng rác",
          "Chưa đủ số ngày này thì chưa ai xoá vĩnh viễn được.",
        )}
        {number(
          "bulk_delete_confirm_over",
          "Chuyển vào thùng rác cần mật khẩu khi quá",
          "Tính cả các lần chuyển trong 10 phút gần nhất.",
        )}
        {number(
          "anomaly_max_changes_per_hour",
          "Cảnh báo khi sửa / bỏ quá (bản ghi / giờ)",
          "Đặt 0 để tắt cảnh báo bất thường.",
        )}
        <div className="grid content-start gap-1.5">
          <Label htmlFor="setting-auto-lock">Khi vượt ngưỡng</Label>
          <label className="flex h-8 items-center gap-2 text-sm">
            <input
              id="setting-auto-lock"
              type="checkbox"
              className="size-4 accent-primary"
              disabled={!editable}
              checked={form.anomaly_auto_lock}
              onChange={(e) => setForm((prev) => ({ ...prev, anomaly_auto_lock: e.target.checked }))}
            />
            Tự khoá tài khoản đó
          </label>
          <p className="text-xs text-muted-foreground">Không bao giờ tự khoá Quản trị cấp cao.</p>
        </div>
      </div>

      {editable && (
        <Button type="submit" className="w-fit" disabled={saving || !valid}>
          {saving ? "Đang lưu…" : "Lưu ngưỡng an toàn"}
        </Button>
      )}
    </form>
  );
}
