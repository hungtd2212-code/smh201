"use client";

import { Pencil, Plus, UserCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { byId, useCatalogNames, useCatalogs } from "@/components/catalog-provider";
import { FormDialog, NONE, toText, type FieldDef, type FormValues } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assignAdAccount, saveCatalogRow } from "@/lib/catalog/repo";
import type { AdAccount, AdAccountAssignment } from "@/lib/catalog/types";
import { coversDay } from "./ads-scope";
import { ActivePill, DeleteRowButton, formatDate, useTodayVn, useManagesMarketing } from "./shared";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Bảng TKQC (tài khoản quảng cáo) và việc giao TKQC cho nhân viên Ads theo từng khoảng ngày. */
export function AdAccountsSection() {
  const { catalogs, reload } = useCatalogs();
  const canManage = useManagesMarketing();
  const names = useCatalogNames();
  const [editing, setEditing] = useState<{ open: boolean; row: AdAccount | null }>({ open: false, row: null });
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const row = editing.row;

  const today = useTodayVn();
  const currentOf = (accountId: string) =>
    catalogs.assignments.find((x) => x.ad_account_id === accountId && coversDay(x, today));
  // Lấy từ danh mục mỗi lần vẽ lại, để hộp thoại phân công luôn thấy dữ liệu mới nhất.
  const assigning = assigningId ? byId(catalogs.adAccounts).get(assigningId) : undefined;

  const fields: FieldDef[] = [
    { name: "name", label: "Tên TKQC", type: "text", required: true, placeholder: "vd THE DUONG 01" },
    { name: "account_id", label: "ID tài khoản quảng cáo", type: "text", placeholder: "vd 1234567890" },
    {
      name: "channel_id",
      label: "Kênh",
      type: "select",
      required: true,
      options: catalogs.channels
        .filter((c) => c.is_active || c.id === row?.channel_id)
        .map((c) => ({ value: c.id, label: c.name })),
    },
    { name: "note", label: "Ghi chú", type: "text" },
    { name: "is_active", label: "Trạng thái", type: "checkbox", text: "Đang dùng", wide: true },
  ];

  async function save(values: FormValues) {
    await saveCatalogRow(
      "ad_accounts",
      row?.id ?? null,
      {
        name: toText(values.name),
        account_id: toText(values.account_id),
        channel_id: values.channel_id,
        note: toText(values.note),
        is_active: Boolean(values.is_active),
      },
      "Đã có TKQC trùng tên, hoặc trùng ID tài khoản trong cùng kênh.",
    );
    await reload();
    toast.success(row ? "Đã cập nhật TKQC" : "Đã thêm TKQC");
  }

  return (
    <section className="grid content-start gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Tài khoản quảng cáo (TKQC)</h2>
        {canManage && (
          <Button onClick={() => setEditing({ open: true, row: null })}>
            <Plus />
            Thêm TKQC
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>TKQC</TableHead>
              <TableHead>ID tài khoản</TableHead>
              <TableHead>Kênh</TableHead>
              <TableHead>Đang phụ trách</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {catalogs.adAccounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {canManage
                    ? "Chưa có TKQC nào. Thêm TKQC rồi giao cho nhân viên Ads phụ trách."
                    : "Bạn chưa được giao TKQC nào."}
                </TableCell>
              </TableRow>
            ) : (
              catalogs.adAccounts.map((account) => {
                const current = currentOf(account.id);
                return (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="font-medium">{account.name}</div>
                      {account.note && <div className="text-xs text-muted-foreground">{account.note}</div>}
                    </TableCell>
                    <TableCell className="tabular-nums">{account.account_id ?? "—"}</TableCell>
                    <TableCell>{names.channel(account.channel_id) ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {current ? (
                        <>
                          {names.adsStaff(current.ads_staff_id) ?? "…"}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            từ {formatDate(current.from_date)}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Chưa giao</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ActivePill active={account.is_active} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Phân công TKQC ${account.name}`}
                          title="Phân công / lịch sử phụ trách"
                          onClick={() => setAssigningId(account.id)}
                        >
                          <UserCheck />
                        </Button>
                        {canManage && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Sửa TKQC ${account.name}`}
                              onClick={() => setEditing({ open: true, row: account })}
                            >
                              <Pencil />
                            </Button>
                            <DeleteRowButton table="ad_accounts" id={account.id} what={`TKQC ${account.name}`} />
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <FormDialog
        open={editing.open}
        onOpenChange={(open) => setEditing((prev) => ({ ...prev, open }))}
        title={row ? "Sửa TKQC" : "Thêm TKQC"}
        fields={fields}
        initialValues={{
          name: row?.name ?? "",
          account_id: row?.account_id ?? "",
          channel_id: row?.channel_id ?? NONE,
          note: row?.note ?? "",
          is_active: row?.is_active ?? true,
        }}
        onSubmit={save}
      />

      <Dialog open={Boolean(assigning)} onOpenChange={(open) => !open && setAssigningId(null)}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
          {assigning && <AssignmentsBody account={assigning} canManage={canManage} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Lịch sử phụ trách của một TKQC và form giao cho người mới. */
function AssignmentsBody({ account, canManage }: { account: AdAccount; canManage: boolean }) {
  const { catalogs, reload } = useCatalogs();
  const names = useCatalogNames();
  const today = useTodayVn();

  const history = catalogs.assignments.filter((x) => x.ad_account_id === account.id);
  const activeStaff = catalogs.adsStaff.filter((a) => a.is_active);

  const [staffId, setStaffId] = useState(NONE);
  const [fromDate, setFromDate] = useState(today);
  const [ending, setEnding] = useState<{ row: AdAccountAssignment; date: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function assign(event: React.FormEvent) {
    event.preventDefault();
    if (staffId === NONE || !fromDate) {
      toast.error("Hãy chọn nhân viên Ads và ngày bắt đầu phụ trách.");
      return;
    }
    setBusy(true);
    try {
      const closedOld = await assignAdAccount(account.id, staffId, fromDate, null);
      await reload();
      toast.success(`Đã giao ${account.name} cho ${names.adsStaff(staffId) ?? "nhân viên Ads"} từ ${formatDate(fromDate)}`, {
        description: closedOld ? "Phân công trước đó tự kết thúc vào hôm trước." : undefined,
      });
      setStaffId(NONE);
    } catch (error) {
      toast.error("Không giao được TKQC", { description: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!ending) return;
    if (ending.date < ending.row.from_date) {
      toast.error("Ngày kết thúc phải từ ngày bắt đầu trở đi.");
      return;
    }
    setBusy(true);
    try {
      await saveCatalogRow("ad_account_assignments", ending.row.id, { to_date: ending.date });
      await reload();
      toast.success(`Đã kết thúc phân công vào ${formatDate(ending.date)}`);
      setEnding(null);
    } catch (error) {
      toast.error("Không kết thúc được phân công", { description: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Phân công TKQC {account.name}</DialogTitle>
        <DialogDescription>
          Mỗi ngày một TKQC chỉ có một người phụ trách. Số liệu của ngày nào được tính cho người phụ trách ngày đó.
        </DialogDescription>
      </DialogHeader>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Nhân viên Ads</TableHead>
              <TableHead>Từ ngày</TableHead>
              <TableHead>Đến ngày</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                  TKQC này chưa được giao cho ai.
                </TableCell>
              </TableRow>
            ) : (
              history.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{names.adsStaff(item.ads_staff_id) ?? "…"}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(item.from_date)}</TableCell>
                  <TableCell className="tabular-nums">
                    {item.to_date ? (
                      formatDate(item.to_date)
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-300">
                        {item.from_date > today ? "Chưa bắt đầu" : "Đang phụ trách"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canManage && (
                      <div className="flex items-center justify-end gap-1">
                        {!item.to_date && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEnding({ row: item, date: item.from_date > today ? item.from_date : today })}
                          >
                            Kết thúc…
                          </Button>
                        )}
                        <DeleteRowButton
                          table="ad_account_assignments"
                          id={item.id}
                          what={`phân công ${names.adsStaff(item.ads_staff_id) ?? ""} (từ ${formatDate(item.from_date)})`}
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {ending && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="assignment-end">
              {names.adsStaff(ending.row.ads_staff_id) ?? "Người này"} phụ trách đến hết ngày
            </Label>
            <Input
              id="assignment-end"
              type="date"
              min={ending.row.from_date}
              value={ending.date}
              onChange={(e) => setEnding({ row: ending.row, date: e.target.value })}
              className="w-44"
            />
          </div>
          <Button onClick={end} disabled={busy || !ending.date}>
            Xác nhận kết thúc
          </Button>
          <Button variant="ghost" onClick={() => setEnding(null)}>
            Thôi
          </Button>
        </div>
      )}

      {canManage && (
        <form onSubmit={assign} className="grid gap-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Giao cho người khác</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-52 flex-1 gap-1.5">
              <Label htmlFor="assign-staff">Nhân viên Ads</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger id="assign-staff" className="w-full">
                  <SelectValue placeholder="Chọn…" />
                </SelectTrigger>
                <SelectContent>
                  {activeStaff.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="assign-from">Phụ trách từ ngày</Label>
              <Input
                id="assign-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-44"
              />
            </div>
            <Button type="submit" disabled={busy}>
              Giao TKQC
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Người đang phụ trách (nếu có) sẽ tự kết thúc vào hôm trước ngày bạn chọn.
            {activeStaff.length === 0 && " Chưa có nhân viên Ads nào đang làm — thêm ở trang Nhân viên Ads."}
          </p>
        </form>
      )}
    </div>
  );
}
