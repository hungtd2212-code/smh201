"use client";

import { Download, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { monthsBetween, shiftMonth } from "@/lib/ad-reports/aggregate";
import { monthLabel } from "@/lib/ad-reports/dates";
import {
  parseWorkbook,
  planImport,
  showDay,
  showMonth,
  type ImportCatalog,
  type ImportPlan,
  type ParsedWorkbook,
} from "@/lib/ad-reports/import";
import { downloadTemplate, loadExisting, readWorkbook, runImport, type ImportProgress } from "@/lib/ad-reports/import-io";
import { cn } from "@/lib/utils";

/**
 * Marketing → Tổng quan → "Nhập từ Excel" (Quản trị / Trưởng Marketing): đưa số liệu quảng cáo cũ vào phần mềm.
 * Tải file mẫu → điền → chọn file → xem trước (lỗi, tổng từng người để đối chiếu) → tick xác nhận → nhập.
 * Số đã có trong phần mềm không bị ghi đè.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "error"; fileName: string | null; message: string }
  | { kind: "ready"; fileName: string; parsed: ParsedWorkbook; plan: ImportPlan }
  | { kind: "importing"; fileName: string; parsed: ParsedWorkbook; plan: ImportPlan; progress: ImportProgress };

const money = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const count = (n: number) => n.toLocaleString("vi-VN");
const MAX_ISSUES = 40;

export function ImportDialog({
  catalog,
  onClose,
  onImported,
}: {
  catalog: ImportCatalog;
  onClose: () => void;
  onImported: () => void;
}) {
  const thisMonth = catalog.today.slice(0, 7);
  const [month, setMonth] = useState(shiftMonth(thisMonth, -1));
  const [downloading, setDownloading] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [checked, setChecked] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = phase.kind === "reading" || phase.kind === "importing";
  const monthOptions = monthsBetween(shiftMonth(thisMonth, -23), thisMonth).reverse();

  async function download() {
    setDownloading(true);
    try {
      await downloadTemplate(month, catalog);
    } catch (error) {
      toast.error("Không tạo được file mẫu", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setDownloading(false);
    }
  }

  async function pick(file: File) {
    setChecked(false);
    setPhase({ kind: "reading", fileName: file.name });
    try {
      const parsed = parseWorkbook(await readWorkbook(file), catalog);
      const plan = planImport(parsed, await loadExisting(parsed));
      setPhase({ kind: "ready", fileName: file.name, parsed, plan });
    } catch (error) {
      setPhase({ kind: "error", fileName: file.name, message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function start() {
    if (phase.kind !== "ready") return;
    const { fileName, parsed, plan } = phase;
    try {
      await runImport(plan, (progress) => setPhase({ kind: "importing", fileName, parsed, plan, progress }));
      const parts = [
        plan.data.length > 0 && `${count(plan.data.length)} ngày số liệu`,
        plan.revenue.length > 0 && `${count(plan.revenue.length)} dòng doanh thu tháng`,
      ].filter(Boolean);
      toast.success(`Đã nhập ${parts.join(" và ") || `${count(plan.reports.length)} dòng chi tiêu`}`);
      onImported();
    } catch (error) {
      setPhase({ kind: "error", fileName, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const view = phase.kind === "ready" || phase.kind === "importing" ? phase : null;
  const plan = view?.plan;
  const issues = view?.parsed.issues ?? [];
  const nothingNew = plan ? plan.reports.length + plan.data.length + plan.revenue.length === 0 : true;
  const canImport = phase.kind === "ready" && issues.length === 0 && !nothingNew && checked;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nhập số liệu cũ từ Excel</DialogTitle>
          <DialogDescription>
            Đưa số liệu quảng cáo các tháng trước (chi tiêu từng TKQC, mess, data, doanh thu) vào phần mềm. Ngày đã có số
            trong phần mềm được giữ nguyên, không bị ghi đè.
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-2 rounded-lg border p-3">
          <h3 className="text-sm font-semibold">1. Tải file mẫu</h3>
          <p className="text-sm text-muted-foreground">
            Mỗi nhân viên Ads một tab, mỗi dòng một ngày, cột là các TKQC người đó phụ trách trong tháng. Điền số (dán từ
            sheet cũ được) rồi lưu dạng .xlsx.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-44" aria-label="Tháng của file mẫu">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {monthLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={download} disabled={downloading}>
              <Download />
              {downloading ? "Đang tạo…" : "Tải file mẫu"}
            </Button>
          </div>
        </section>

        <section className="grid gap-2 rounded-lg border p-3">
          <h3 className="text-sm font-semibold">2. Chọn file đã điền</h3>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = ""; // chọn lại cùng file vẫn đọc lại
              if (file) void pick(file);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Upload />
              {phase.kind === "idle" ? "Chọn file .xlsx" : "Chọn lại file"}
            </Button>
            {phase.kind !== "idle" && phase.fileName && (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                <FileSpreadsheet className="size-4 shrink-0" />
                <span className="truncate">{phase.fileName}</span>
              </span>
            )}
          </div>
          {phase.kind === "reading" && <p className="text-sm text-muted-foreground">Đang đọc file và đối chiếu số đã có…</p>}
          {phase.kind === "error" && <p className="text-sm text-destructive">{phase.message}</p>}
        </section>

        {view && plan && (
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">3. Kiểm tra trước khi nhập</h3>

            {issues.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="mb-1.5 flex items-center gap-1.5 font-medium text-destructive">
                  <TriangleAlert className="size-4 shrink-0" />
                  Còn {count(issues.length)} lỗi — sửa trong file rồi bấm “Chọn lại file”. Chưa nhập gì.
                </p>
                <ul className="grid gap-1 pl-5 [list-style:disc]">
                  {issues.slice(0, MAX_ISSUES).map((issue, i) => (
                    <li key={i}>
                      <span className="font-medium">
                        Tab “{issue.sheet}”{issue.row !== null && `, dòng ${issue.row}`}:
                      </span>{" "}
                      {issue.message}
                    </li>
                  ))}
                  {issues.length > MAX_ISSUES && <li>… và {count(issues.length - MAX_ISSUES)} lỗi khác.</li>}
                </ul>
              </div>
            )}

            {view.parsed.notes.length > 0 && (
              <ul className="grid gap-1 rounded-lg border border-amber-300/60 bg-amber-50 p-3 pl-8 text-sm text-amber-900 [list-style:disc] dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                {view.parsed.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}

            {plan.people.length > 0 && <PeopleTable plan={plan} />}
            {plan.months.length > 0 && <MonthsTable plan={plan} />}

            {issues.length === 0 &&
              (nothingNew ? (
                <p className="text-sm text-muted-foreground">
                  {plan.people.length + plan.months.length === 0
                    ? "File chưa có số nào để nhập."
                    : "Mọi số trong file đã có trong phần mềm — không có gì để nhập thêm."}
                </p>
              ) : (
                <div className="grid gap-2 rounded-lg bg-muted/60 p-3 text-sm">
                  <p>
                    Sẽ thêm{" "}
                    <b>
                      {[
                        plan.reports.length > 0 && `${count(plan.reports.length)} dòng chi tiêu TKQC`,
                        plan.data.length > 0 && `${count(plan.data.length)} ngày Data / doanh thu`,
                        plan.revenue.length > 0 && `${count(plan.revenue.length)} dòng doanh thu tháng`,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </b>
                    .
                    {plan.skipped.reports + plan.skipped.data + plan.skipped.revenue > 0 &&
                      ` Giữ nguyên số đã có: ${[
                        plan.skipped.reports > 0 && `${count(plan.skipped.reports)} dòng chi tiêu`,
                        plan.skipped.data > 0 && `${count(plan.skipped.data)} ngày Data`,
                        plan.skipped.revenue > 0 && `${count(plan.skipped.revenue)} dòng doanh thu tháng`,
                      ]
                        .filter(Boolean)
                        .join(", ")}.`}
                  </p>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      checked={checked}
                      disabled={phase.kind !== "ready"}
                      onChange={(event) => setChecked(event.target.checked)}
                    />
                    <span>
                      Tôi đã đối chiếu các tổng ở trên khớp với file. Sau khi nhập, số không xoá được — chỉ sửa được từng
                      ngày ở Tổng quan.
                    </span>
                  </label>
                </div>
              ))}
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Đóng
          </Button>
          <Button onClick={start} disabled={!canImport}>
            {phase.kind === "importing"
              ? `Đang nhập… ${count(phase.progress.done)}/${count(phase.progress.total)}`
              : "Nhập vào phần mềm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const th = "px-2 py-1.5 text-right font-medium whitespace-nowrap";
const td = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

/** Tổng từng người trong file — để đối chiếu với sheet trước khi nhập. */
function PeopleTable({ plan }: { plan: ImportPlan }) {
  const total = plan.people.reduce(
    (s, p) => ({
      days: s.days + p.days,
      spend: s.spend + p.spend,
      messages: s.messages + p.messages,
      data: s.data + p.data,
      revenue: s.revenue + p.revenue,
    }),
    { days: 0, spend: 0, messages: 0, data: 0, revenue: 0 },
  );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className={cn(th, "text-left")}>Nhân viên</th>
            <th className={cn(th, "text-left")}>Ngày</th>
            <th className={th}>Chi tiêu</th>
            <th className={th}>Mess</th>
            <th className={th}>Data</th>
            <th className={th}>Doanh thu ngày</th>
            <th className={th}>Thêm mới</th>
          </tr>
        </thead>
        <tbody>
          {plan.people.map((p) => (
            <tr key={p.staffId} className="border-t">
              <td className="px-2 py-1.5 font-medium whitespace-nowrap">{p.name}</td>
              <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                {p.from === p.to ? showDay(p.from) : `${showDay(p.from).slice(0, 5)} – ${showDay(p.to)}`} ({count(p.days)}{" "}
                ngày)
              </td>
              <td className={td}>{money(p.spend)}</td>
              <td className={td}>{count(p.messages)}</td>
              <td className={td}>{count(p.data)}</td>
              <td className={td}>{p.revenue > 0 ? money(p.revenue) : "–"}</td>
              <td className={cn(td, p.newDays === 0 && "text-muted-foreground")}>
                {count(p.newDays)} ngày
                {p.existingDays > 0 && <span className="text-muted-foreground"> · {count(p.existingDays)} đã có</span>}
              </td>
            </tr>
          ))}
          {plan.people.length > 1 && (
            <tr className="border-t bg-accent font-semibold text-accent-foreground">
              <td className="px-2 py-1.5">Tổng</td>
              <td className="px-2 py-1.5">{count(total.days)} ngày</td>
              <td className={td}>{money(total.spend)}</td>
              <td className={td}>{count(total.messages)}</td>
              <td className={td}>{count(total.data)}</td>
              <td className={td}>{total.revenue > 0 ? money(total.revenue) : "–"}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MonthsTable({ plan }: { plan: ImportPlan }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className={cn(th, "text-left")}>Doanh thu tháng</th>
            <th className={cn(th, "text-left")}>Nhân viên</th>
            <th className={th}>Doanh thu</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {plan.months.map((m) => (
            <tr key={`${m.month}|${m.staffId}`} className="border-t">
              <td className="px-2 py-1.5">{showMonth(m.month)}</td>
              <td className="px-2 py-1.5">{m.staffName}</td>
              <td className={td}>{money(m.amount)}</td>
              <td className={cn(td, "text-muted-foreground")}>{m.exists ? "Đã có — giữ nguyên" : "Thêm mới"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
