"use client";

import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useCatalogs } from "@/components/catalog-provider";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adsRunners } from "@/lib/catalog/ads-runners";
import { addAdAccount, removeAdAccount, updateAdAccount } from "@/lib/catalog/repo";
import {
  ACCOUNT_KIND_LABELS,
  PAYMENT_KIND_LABELS,
  type AdAccount,
  type AdAccountKind,
  type AdPaymentKind,
  type AdsStaff,
} from "@/lib/catalog/types";

const ALL = "__all";

/** Người đang giữ TKQC: phân công mới nhất của TKQC đó (danh sách phân công đã xếp mới nhất trước). */
export function useAccountOwner() {
  const { catalogs } = useCatalogs();
  return (accountId: string) => catalogs.assignments.find((x) => x.ad_account_id === accountId)?.ads_staff_id ?? null;
}

/**
 * Nhập liệu → Cài đặt TKQC. Nhân viên Ads tự khai báo các TKQC mình đang cầm (nút "+ Thêm TKQC"), sửa bằng nút
 * bút, xoá bằng nút thùng rác. Quản lý thấy TKQC của mọi người, lọc theo nhân viên / TKQC, thêm / sửa cho bất kỳ ai.
 */
export function AccountSetup({ isManager, me }: { isManager: boolean; me: AdsStaff | undefined }) {
  const { catalogs, reload } = useCatalogs();
  const ownerOf = useAccountOwner();
  const [staffFilter, setStaffFilter] = useState(ALL);
  const [accountFilter, setAccountFilter] = useState(ALL);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AdAccount | null>(null);
  const [editing, setEditing] = useState<AdAccount | null>(null);

  if (!catalogs.adAccountSetupReady) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
        Phần Cài đặt TKQC chưa dùng được: cơ sở dữ liệu chưa được cập nhật (file{" "}
        <code>supabase/007_ad_account_setup.sql</code> chưa chạy).
      </p>
    );
  }

  const names = new Map(catalogs.adsStaff.map((p) => [p.id, p.full_name]));
  // Ô chọn nhân viên (lọc, thêm TKQC): chỉ người có tài khoản ở vị trí Nhân viên quảng cáo hoặc Lead Ads.
  const runners = adsRunners(catalogs.adsStaff, catalogs.staff);
  // TKQC đang dùng: nhân viên chỉ thấy của mình; quản lý thấy tất cả.
  const mine = catalogs.adAccounts.filter(
    (a) => a.is_active && (isManager || (me !== undefined && ownerOf(a.id) === me.id)),
  );
  const byStaff = mine.filter((a) => staffFilter === ALL || ownerOf(a.id) === staffFilter);
  const rows = byStaff.filter((a) => accountFilter === ALL || a.id === accountFilter);

  async function remove(account: AdAccount) {
    const result = await removeAdAccount(account.id);
    await reload();
    if (result === "trashed") {
      toast.success(`Đã xoá TKQC ${account.name}`, { description: "Quản trị khôi phục được trong Cài đặt → Thùng rác." });
    } else {
      toast.success(`Đã xoá TKQC ${account.name} khỏi danh sách`, {
        description: "TKQC này đã có báo cáo nên được chuyển sang Ngừng dùng để giữ nguyên số liệu cũ.",
      });
    }
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">{isManager ? "TKQC của tất cả nhân viên" : "TKQC của bạn"}</h2>
          <p className="text-sm text-muted-foreground">
            {isManager
              ? "Mỗi TKQC thuộc một nhân viên quảng cáo; ở màn Nhập số liệu, nhân viên chỉ thấy TKQC của mình."
              : "Khai báo các TKQC bạn đang chạy. Ở màn Nhập số liệu bạn chỉ thấy các TKQC này."}
          </p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus />
            Thêm TKQC
          </Button>
        )}
      </div>

      {adding && (
        <AddForm
          isManager={isManager}
          people={runners.filter((p) => p.is_active)}
          defaultStaff={staffFilter === ALL ? null : staffFilter}
          onCancel={() => setAdding(false)}
          onSaved={async (name) => {
            await reload();
            setAdding(false);
            toast.success(`Đã thêm TKQC ${name}`);
          }}
        />
      )}

      {isManager && (
        <div className="flex flex-wrap gap-2">
          <Select
            value={staffFilter}
            onValueChange={(value) => {
              setStaffFilter(value);
              setAccountFilter(ALL);
            }}
          >
            <SelectTrigger className="w-56" aria-label="Lọc theo nhân viên quảng cáo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tất cả nhân viên quảng cáo</SelectItem>
              {runners.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-56" aria-label="Lọc theo tài khoản quảng cáo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tất cả TKQC ({byStaff.length})</SelectItem>
              {byStaff.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted text-left">
              <th className="w-10 px-3 py-2 text-right font-medium">#</th>
              <th className="px-3 py-2 font-medium">Tên tài khoản</th>
              <th className="px-3 py-2 font-medium">ID tài khoản</th>
              <th className="px-3 py-2 font-medium">Loại tài khoản</th>
              <th className="px-3 py-2 font-medium">Thanh toán</th>
              {isManager && <th className="px-3 py-2 font-medium">Nhân viên quảng cáo</th>}
              <th className="w-24 px-3 py-2">
                <span className="sr-only">Sửa / xoá</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={isManager ? 7 : 6} className="h-20 px-3 text-center text-muted-foreground">
                  {mine.length === 0
                    ? isManager
                      ? "Chưa có TKQC nào. Bấm “Thêm TKQC” để khai báo."
                      : "Bạn chưa có TKQC nào. Bấm “Thêm TKQC” để khai báo TKQC đầu tiên."
                    : "Không có TKQC nào khớp bộ lọc."}
                </td>
              </tr>
            ) : (
              rows.map((account, i) => {
                const owner = ownerOf(account.id);
                return (
                  <tr key={account.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{account.name}</td>
                    <td className="px-3 py-2 tabular-nums">{account.account_id ?? "—"}</td>
                    <td className="px-3 py-2">{account.account_kind ? ACCOUNT_KIND_LABELS[account.account_kind] : "—"}</td>
                    <td className="px-3 py-2">{account.payment_kind ? PAYMENT_KIND_LABELS[account.payment_kind] : "—"}</td>
                    {isManager && (
                      <td className="px-3 py-2">
                        {owner ? (names.get(owner) ?? "…") : <span className="text-muted-foreground">Chưa giao</span>}
                      </td>
                    )}
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Sửa TKQC ${account.name}`}
                        title="Sửa thông tin"
                        onClick={() => setEditing(account)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Xoá TKQC ${account.name}`}
                        title="Xoá"
                        onClick={() => setRemoving(account)}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {isManager && (
        <p className="text-sm text-muted-foreground">
          Chuyển một TKQC sang nhân viên khác (từ một ngày nhất định): trang{" "}
          <Link href="/marketing/cai-dat?tab=tkqc" className="font-medium text-foreground underline underline-offset-2">
            TKQC &amp; Page
          </Link>
          . Danh sách nhân viên quảng cáo:{" "}
          <Link href="/marketing/cai-dat?tab=nhan-vien-ads" className="font-medium text-foreground underline underline-offset-2">
            Nhân viên Ads
          </Link>
          .
        </p>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <EditForm
              account={editing}
              ownerName={isManager ? (names.get(ownerOf(editing.id) ?? "") ?? null) : null}
              onCancel={() => setEditing(null)}
              onSaved={async (name) => {
                await reload();
                setEditing(null);
                toast.success(`Đã lưu TKQC ${name}`);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Xác nhận xoá?"
        description={
          <>
            <p>
              Xoá TKQC <b>{removing?.name}</b> khỏi danh sách?
            </p>
            <p>
              Nếu TKQC đã có báo cáo, các báo cáo cũ vẫn được giữ nguyên. Quản trị khôi phục được trong Cài đặt → Thùng
              rác.
            </p>
          </>
        }
        cancelLabel="Không"
        confirmLabel="Có, xoá"
        destructive
        onConfirm={async () => {
          if (removing) await remove(removing);
        }}
      />
    </section>
  );
}

/** Form "+ Thêm TKQC": hiện ngay trên trang, lưu xong thì TKQC mới xuống bảng bên dưới. */
function AddForm({
  isManager,
  people,
  defaultStaff,
  onCancel,
  onSaved,
}: {
  isManager: boolean;
  people: AdsStaff[];
  defaultStaff: string | null;
  onCancel: () => void;
  onSaved: (name: string) => Promise<void>;
}) {
  const [staffId, setStaffId] = useState<string>(defaultStaff ?? "");
  const [values, setValues] = useState<FieldValues>(EMPTY_FIELDS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = fieldsComplete(values) && (!isManager || staffId !== "");
  const { name, accountId, kind, payment } = values;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!complete) return;
    setSaving(true);
    setError(null);
    try {
      await addAdAccount({
        name: name.trim(),
        accountId: accountId.trim(),
        accountKind: kind as AdAccountKind,
        paymentKind: payment as AdPaymentKind,
        adsStaffId: isManager ? staffId : null,
      });
      await onSaved(name.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4 rounded-xl border bg-card p-4" noValidate>
      <h3 className="font-medium">Thêm TKQC</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isManager && (
          <div className="grid gap-1.5 sm:col-span-2 lg:col-span-4">
            <Label htmlFor="new-account-staff">Nhân viên quảng cáo{required}</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger id="new-account-staff" className="w-full sm:w-72">
                <SelectValue placeholder="Chọn nhân viên" />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <AccountFields idPrefix="new-account" autoFocus values={values} onChange={setValues} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!complete || saving}>
          <Save />
          {saving ? "Đang lưu…" : "Lưu"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Huỷ
        </Button>
        {!complete && <span className="text-sm text-muted-foreground">Điền đủ các ô có dấu * để lưu.</span>}
      </div>
    </form>
  );
}

const required = (
  <span className="text-destructive" aria-hidden>
    {" "}
    *
  </span>
);

type FieldValues = { name: string; accountId: string; kind: AdAccountKind | ""; payment: AdPaymentKind | "" };
const EMPTY_FIELDS: FieldValues = { name: "", accountId: "", kind: "", payment: "" };
const fieldsComplete = (v: FieldValues) => v.name.trim() !== "" && v.accountId.trim() !== "" && v.kind !== "" && v.payment !== "";

/** Bốn ô thông tin TKQC, dùng chung cho form Thêm và hộp Sửa. */
function AccountFields({
  idPrefix,
  values,
  onChange,
  autoFocus = false,
}: {
  idPrefix: string;
  values: FieldValues;
  onChange: (next: FieldValues) => void;
  autoFocus?: boolean;
}) {
  const set = (patch: Partial<FieldValues>) => onChange({ ...values, ...patch });
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Tên tài khoản{required}</Label>
        <Input
          id={`${idPrefix}-name`}
          autoFocus={autoFocus}
          maxLength={120}
          placeholder="vd THE DUONG 03"
          value={values.name}
          onChange={(event) => set({ name: event.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-id`}>ID tài khoản{required}</Label>
        <Input
          id={`${idPrefix}-id`}
          inputMode="numeric"
          autoComplete="off"
          maxLength={40}
          placeholder="vd 123456789012345"
          value={values.accountId}
          onChange={(event) => set({ accountId: event.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-kind`}>Loại tài khoản{required}</Label>
        <Select value={values.kind} onValueChange={(value) => set({ kind: value as AdAccountKind })}>
          <SelectTrigger id={`${idPrefix}-kind`} className="w-full">
            <SelectValue placeholder="Chọn loại" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACCOUNT_KIND_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-payment`}>Thanh toán{required}</Label>
        <Select value={values.payment} onValueChange={(value) => set({ payment: value as AdPaymentKind })}>
          <SelectTrigger id={`${idPrefix}-payment`} className="w-full">
            <SelectValue placeholder="Chọn" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PAYMENT_KIND_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

/** Hộp "Sửa TKQC" (nút bút): sửa tên, ID, loại, thanh toán. Người phụ trách đổi ở trang TKQC & Page. */
function EditForm({
  account,
  ownerName,
  onCancel,
  onSaved,
}: {
  account: AdAccount;
  /** Tên nhân viên đang giữ TKQC (chỉ hiện cho quản lý). */
  ownerName: string | null;
  onCancel: () => void;
  onSaved: (name: string) => Promise<void>;
}) {
  const [values, setValues] = useState<FieldValues>({
    name: account.name,
    accountId: account.account_id ?? "",
    kind: account.account_kind ?? "",
    payment: account.payment_kind ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = fieldsComplete(values);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!complete) return;
    setSaving(true);
    setError(null);
    try {
      await updateAdAccount(account.id, {
        name: values.name.trim(),
        accountId: values.accountId.trim(),
        accountKind: values.kind as AdAccountKind,
        paymentKind: values.payment as AdPaymentKind,
      });
      await onSaved(values.name.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Sửa TKQC {account.name}</DialogTitle>
        <DialogDescription>
          {ownerName ? `Nhân viên phụ trách: ${ownerName}. ` : ""}Báo cáo đã gửi của TKQC này vẫn giữ nguyên.
          {ownerName ? " Đổi người phụ trách ở trang TKQC & Page." : ""}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <AccountFields idPrefix="edit-account" values={values} onChange={setValues} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Huỷ
        </Button>
        <Button type="submit" disabled={!complete || saving}>
          <Save />
          {saving ? "Đang lưu…" : "Lưu"}
        </Button>
      </DialogFooter>
    </form>
  );
}
