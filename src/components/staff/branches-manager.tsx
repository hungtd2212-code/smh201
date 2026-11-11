"use client";

import { Building2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ActivePill, PageHeader } from "@/components/catalog/shared";
import { useCatalogs } from "@/components/catalog-provider";
import { FormDialog, toText, type FieldDef, type FormValues } from "@/components/form-dialog";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
import { AdminOnly, useRole } from "@/components/safety/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteBranch, fetchBranches, saveBranch, type Branch } from "@/lib/staff/repo";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** Danh sách cơ sở (null = chưa chạy file 008). `reload()` tải lại sau khi thêm / sửa. */
export function useBranches() {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ branches: Branch[] | null; loaded: boolean; error: string | null }>({
    branches: [],
    loaded: false,
    error: null,
  });
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    fetchBranches().then(
      (branches) => {
        if (!cancelled) setState({ branches, loaded: true, error: null });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ branches: [], loaded: true, error: error instanceof Error ? error.message : String(error) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

export function BranchesNotReady() {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      Chức năng này chưa dùng được: cơ sở dữ liệu chưa được cập nhật (file <code>supabase/008_staff_accounts.sql</code>{" "}
      chưa chạy).
    </p>
  );
}

const EDIT_FIELDS: FieldDef[] = [
  { name: "name", label: "Tên cơ sở", type: "text", required: true, wide: true },
  { name: "address", label: "Địa chỉ cơ sở", type: "text", wide: true },
  { name: "is_active", label: "Trạng thái", type: "checkbox", text: "Đang dùng (hiện ở ô Nơi làm việc khi thêm người)", wide: true },
];

/** Cài đặt → Danh sách cơ sở: các nơi làm việc để chọn khi thêm người. */
export function BranchesManager() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={Building2}
        title="Danh sách cơ sở"
        description="Các cơ sở làm việc. Khi thêm người ở Tài khoản & Phân quyền, ô “Nơi làm việc” lấy từ danh sách này."
      />
      <AdminOnly>
        <BranchesBody />
      </AdminOnly>
    </div>
  );
}

function BranchesBody() {
  const { catalogs } = useCatalogs();
  const { branches, loaded, error, reload } = useBranches();
  const { isSuperAdmin } = useRole();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [removing, setRemoving] = useState<Branch | null>(null);

  if (!loaded) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (branches === null) return <BranchesNotReady />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  const staffCount = (id: string) => catalogs.staff.filter((s) => s.branch_id === id && !s.deleted_at).length;

  async function saveEdit(values: FormValues) {
    if (!editing) return;
    await saveBranch(editing.id, {
      name: toText(values.name) ?? "",
      address: toText(values.address),
      is_active: Boolean(values.is_active),
    });
    reload();
    toast.success("Đã cập nhật cơ sở");
  }

  return (
    <section className="grid gap-4">
      <div>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus />
            Thêm cơ sở
          </Button>
        )}
      </div>

      {adding && (
        <AddBranchForm
          onCancel={() => setAdding(false)}
          onSaved={async (name) => {
            reload();
            setAdding(false);
            toast.success(`Đã thêm cơ sở ${name}`);
          }}
        />
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted text-left">
              <th className="w-10 px-3 py-2 text-right font-medium">#</th>
              <th className="px-3 py-2 font-medium">Tên cơ sở</th>
              <th className="px-3 py-2 font-medium">Địa chỉ</th>
              <th className="px-3 py-2 text-right font-medium">Nhân sự</th>
              <th className="px-3 py-2 font-medium">Trạng thái</th>
              <th className="w-20 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {branches.length === 0 ? (
              <tr>
                <td colSpan={6} className="h-20 text-center text-muted-foreground">
                  Chưa có cơ sở nào. Bấm “Thêm cơ sở”.
                </td>
              </tr>
            ) : (
              branches.map((branch, i) => (
                <tr key={branch.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{branch.name}</td>
                  <td className="px-3 py-2">{branch.address ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{staffCount(branch.id)}</td>
                  <td className="px-3 py-2">
                    <ActivePill active={branch.is_active} />
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Sửa cơ sở ${branch.name}`}
                      title="Sửa"
                      onClick={() => setEditing(branch)}
                    >
                      <Pencil />
                    </Button>
                    {isSuperAdmin && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Xoá cơ sở ${branch.name}`}
                        title="Xoá"
                        onClick={() => setRemoving(branch)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmActionDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Xác nhận xoá?"
        description={
          <>
            <p>
              Xoá cơ sở <b>{removing?.name}</b>?
            </p>
            <p>Chỉ xoá được cơ sở chưa có nhân sự nào. Muốn tạm ngừng thì bấm Sửa rồi bỏ tick “Đang dùng”.</p>
          </>
        }
        cancelLabel="Không"
        confirmLabel="Có, xoá"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await deleteBranch(removing.id);
          reload();
          toast.success(`Đã xoá cơ sở ${removing.name}`);
        }}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Sửa cơ sở"
        fields={EDIT_FIELDS}
        initialValues={{
          name: editing?.name ?? "",
          address: editing?.address ?? "",
          is_active: editing?.is_active ?? true,
        }}
        onSubmit={saveEdit}
      />
    </section>
  );
}

function AddBranchForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await saveBranch(null, { name: name.trim(), address: address.trim() || null, is_active: true });
      await onSaved(name.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4 rounded-xl border bg-card p-4" noValidate>
      <h3 className="font-medium">Thêm cơ sở</h3>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid gap-1.5">
          <Label htmlFor="branch-name">
            Tên cơ sở<span className="text-destructive"> *</span>
          </Label>
          <Input id="branch-name" autoFocus maxLength={120} placeholder="vd 201 Trường Chinh" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="branch-address">Địa chỉ cơ sở</Label>
          <Input id="branch-address" maxLength={300} placeholder="Số nhà, đường, quận, thành phố" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!name.trim() || saving}>
          <Save />
          {saving ? "Đang lưu…" : "Lưu"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Huỷ
        </Button>
      </div>
    </form>
  );
}
