"use client";

import { CheckCircle2, Download, FileSpreadsheet, ListChecks, TriangleAlert, Upload } from "lucide-react";
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
  isMatched,
  parseWorkbook,
  planImport,
  showDay,
  showMonth,
  type AccountMismatch,
  type ImportCatalog,
  type ImportPlan,
  type ParsedWorkbook,
  type WorkbookSheet,
} from "@/lib/ad-reports/import";
import {
  createAdAccount,
  createAdsStaff,
  downloadTemplate,
  loadExisting,
  loadImportCatalog,
  readWorkbook,
  runImport,
  type ImportProgress,
} from "@/lib/ad-reports/import-io";
import { cn } from "@/lib/utils";
import { MismatchList } from "./import-fixes";

/**
 * Marketing → Tổng quan → "Nhập từ Excel" (Quản trị / Trưởng Marketing): đưa số liệu quảng cáo cũ vào phần mềm.
 *   1. Tải file mẫu → điền số.
 *   2. Chọn file → bấm "Khớp dữ liệu": đối chiếu với phần mềm (TKQC theo ID tài khoản quảng cáo, nhân viên theo tên).
 *      Chỗ chưa khớp hiện kèm gợi ý và nút sửa ngay (dùng người có sẵn, tạo nhân viên Ads, tạo TKQC); sửa xong tự
 *      khớp lại.
 *   3. Khớp hết thì nút "Tải lên" mới bấm được. Số đã có trong phần mềm không bị ghi đè.
 */

type Match =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "error"; message: string }
  | { status: "done"; catalog: ImportCatalog; parsed: ParsedWorkbook; plan: ImportPlan };

const money = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const count = (n: number) => n.toLocaleString("vi-VN");
const MAX_ISSUES = 40;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ImportDialog({
  today,
  onClose,
  onImported,
  onCatalogChanged,
}: {
  today: string;
  onClose: () => void;
  onImported: () => void;
  /** Vừa tạo nhân viên / TKQC → tải lại danh mục của trang. */
  onCatalogChanged: () => void;
}) {
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(shiftMonth(thisMonth, -1));
  const [downloading, setDownloading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<WorkbookSheet[] | null>(null);
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  const [match, setMatch] = useState<Match>({ status: "idle" });
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = working || match.status === "checking" || progress !== null;
  const monthOptions = monthsBetween(shiftMonth(thisMonth, -23), thisMonth).reverse();

  async function download() {
    setDownloading(true);
    try {
      await downloadTemplate(month, await loadImportCatalog(today));
    } catch (error) {
      toast.error("Không tạo được file mẫu", { description: errorText(error) });
    } finally {
      setDownloading(false);
    }
  }

  function choose(next: File) {
    setFile(next);
    setSheets(null);
    setStaffMap({});
    setMatch({ status: "idle" });
    setUploadError(null);
  }

  /** Khớp dữ liệu: đọc file (một lần), đọc danh mục mới nhất, đối chiếu, tính trước những gì sẽ thêm. */
  async function runMatch(map = staffMap) {
    if (!file) return;
    setMatch({ status: "checking" });
    setUploadError(null);
    try {
      const workbook = sheets ?? (await readWorkbook(file));
      if (!sheets) setSheets(workbook);
      const catalog = await loadImportCatalog(today);
      const parsed = parseWorkbook(workbook, catalog, { staffMap: map });
      const plan = planImport(parsed, await loadExisting(parsed));
      setMatch({ status: "done", catalog, parsed, plan });
    } catch (error) {
      setMatch({ status: "error", message: errorText(error) });
    }
  }

  async function fix(action: () => Promise<Record<string, string> | void>, success: string) {
    setWorking(true);
    try {
      const map = (await action()) ?? staffMap;
      toast.success(success);
      onCatalogChanged();
      await runMatch(map);
    } catch (error) {
      toast.error("Chưa làm được", { description: errorText(error) });
    } finally {
      setWorking(false);
    }
  }

  function pickStaff(key: string, staffId: string) {
    const map = { ...staffMap, [key]: staffId };
    setStaffMap(map);
    void runMatch(map);
  }

  const createStaff = (key: string, name: string, active: boolean) =>
    fix(async () => {
      const id = await createAdsStaff(name, active);
      const map = { ...staffMap, [key]: id };
      setStaffMap(map);
      return map;
    }, `Đã tạo nhân viên Ads “${name.trim()}”`);

  const createAccount = (
    m: AccountMismatch,
    values: Omit<Parameters<typeof createAdAccount>[0], "name" | "adsStaffId">,
  ) =>
    fix(
      () => createAdAccount({ ...values, name: m.name, adsStaffId: m.staffId }),
      `Đã tạo TKQC “${m.name}” cho ${m.staffName}`,
    );

  async function upload() {
    if (match.status !== "done") return;
    const { plan } = match;
    setUploadError(null);
    try {
      await runImport(plan, setProgress);
      const parts = [
        plan.data.length > 0 && `${count(plan.data.length)} ngày số liệu`,
        plan.revenue.length > 0 && `${count(plan.revenue.length)} dòng doanh thu tháng`,
      ].filter(Boolean);
      toast.success(`Đã tải lên ${parts.join(" và ") || `${count(plan.reports.length)} dòng chi tiêu`}`);
      onImported();
    } catch (error) {
      setUploadError(errorText(error));
      setProgress(null);
    }
  }

  const done = match.status === "done" ? match : null;
  const plan = done?.plan;
  const matchedOk = done ? isMatched(done.parsed) : false;
  const nothingNew = plan ? plan.reports.length + plan.data.length + plan.revenue.length === 0 : true;
  const canUpload = matchedOk && !nothingNew && !busy;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nhập số liệu cũ từ Excel</DialogTitle>
          <DialogDescription>
            Đưa số liệu quảng cáo các tháng trước (chi tiêu từng TKQC, mess, data, doanh thu) vào phần mềm. TKQC được
            khớp theo ID tài khoản quảng cáo. Ngày đã có số trong phần mềm được giữ nguyên, không bị ghi đè.
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-2 rounded-lg border p-3">
          <h3 className="text-sm font-semibold">1. Tải file mẫu</h3>
          <p className="text-sm text-muted-foreground">
            Mỗi nhân viên Ads một tab, mỗi dòng một ngày, mỗi TKQC một cột (kèm ID tài khoản). Điền số — dán từ sheet cũ
            được — rồi lưu dạng .xlsx.
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

        <section className="grid gap-3 rounded-lg border p-3">
          <h3 className="text-sm font-semibold">2. Chọn file đã điền</h3>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => {
              const next = event.target.files?.[0];
              event.target.value = ""; // chọn lại cùng file (đã sửa) vẫn đọc lại
              if (next) choose(next);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
              <FileSpreadsheet />
              {file ? "Chọn file khác" : "Chọn file .xlsx"}
            </Button>
            {file && <span className="min-w-0 truncate text-sm text-muted-foreground">{file.name}</span>}
          </div>
          {file && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={matchedOk ? "outline" : "default"} onClick={() => void runMatch()} disabled={busy}>
                <ListChecks />
                {match.status === "checking" ? "Đang khớp…" : match.status === "done" ? "Khớp dữ liệu lại" : "Khớp dữ liệu"}
              </Button>
              <Button onClick={upload} disabled={!canUpload} title={matchedOk ? undefined : "Bấm Khớp dữ liệu trước"}>
                <Upload />
                {progress ? `Đang tải lên… ${count(progress.done)}/${count(progress.total)}` : "Tải lên"}
              </Button>
              {match.status === "idle" && (
                <span className="text-sm text-muted-foreground">Bấm “Khớp dữ liệu” trước để kiểm tra file.</span>
              )}
            </div>
          )}
          {match.status === "error" && <p className="text-sm text-destructive">{match.message}</p>}
          {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
        </section>

        {done && plan && (
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">3. Kết quả khớp dữ liệu</h3>

            {done.parsed.mismatches.length > 0 && (
              <div className="grid gap-2">
                <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
                  <TriangleAlert className="size-4 shrink-0" />
                  Còn {count(done.parsed.mismatches.length)} chỗ chưa khớp với phần mềm — sửa theo gợi ý bên dưới (phần mềm
                  tự khớp lại sau mỗi lần sửa).
                </p>
                <MismatchList
                  mismatches={done.parsed.mismatches}
                  busy={busy}
                  staff={done.catalog.staff}
                  onUseStaff={pickStaff}
                  onCreateStaff={createStaff}
                  onCreateAccount={createAccount}
                />
              </div>
            )}

            {done.parsed.issues.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="mb-1.5 flex items-center gap-1.5 font-medium text-destructive">
                  <TriangleAlert className="size-4 shrink-0" />
                  Còn {count(done.parsed.issues.length)} lỗi số liệu trong file — sửa file, lưu lại rồi bấm “Chọn file khác”.
                </p>
                <ul className="grid gap-1 pl-5 [list-style:disc]">
                  {done.parsed.issues.slice(0, MAX_ISSUES).map((issue, i) => (
                    <li key={i}>
                      <span className="font-medium">
                        Tab “{issue.sheet}”{issue.row !== null && `, dòng ${issue.row}`}:
                      </span>{" "}
                      {issue.message}
                    </li>
                  ))}
                  {done.parsed.issues.length > MAX_ISSUES && (
                    <li>… và {count(done.parsed.issues.length - MAX_ISSUES)} lỗi khác.</li>
                  )}
                </ul>
              </div>
            )}

            {done.parsed.notes.length > 0 && (
              <ul className="grid gap-1 rounded-lg border p-3 pl-8 text-sm text-muted-foreground [list-style:disc]">
                {done.parsed.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}

            {matchedOk && (
              <>
                <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <CheckCircle2 className="size-4 shrink-0" />
                  Đã khớp: {count(plan.people.length)} nhân viên
                  {done.parsed.matchedAccounts.byId + done.parsed.matchedAccounts.byName > 0 &&
                    `, ${count(done.parsed.matchedAccounts.byId + done.parsed.matchedAccounts.byName)} TKQC (${count(done.parsed.matchedAccounts.byId)} theo ID${
                      done.parsed.matchedAccounts.byName > 0 ? `, ${count(done.parsed.matchedAccounts.byName)} theo tên` : ""
                    })`}
                  .
                </p>
                {plan.people.length > 0 && <PeopleTable plan={plan} />}
                {plan.months.length > 0 && <MonthsTable plan={plan} />}
                <p className="rounded-lg bg-muted/60 p-3 text-sm">
                  {nothingNew ? (
                    plan.people.length + plan.months.length === 0 ? (
                      "File chưa có số nào để tải lên."
                    ) : (
                      "Mọi số trong file đã có trong phần mềm — không có gì để tải lên thêm."
                    )
                  ) : (
                    <>
                      Bấm <b>Tải lên</b> để thêm{" "}
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
                          .join(", ")}.`}{" "}
                      Hãy đối chiếu các tổng ở trên với file trước — sau khi tải lên, số không xoá được, chỉ sửa được
                      từng ngày ở Tổng quan.
                    </>
                  )}
                </p>
              </>
            )}
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const th = "px-2 py-1.5 text-right font-medium whitespace-nowrap";
const td = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

/** Tổng từng người trong file — để đối chiếu với sheet trước khi tải lên. */
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
