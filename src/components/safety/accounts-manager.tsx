"use client";

import { Lock, LockOpen, Pencil, Plus, Save, ShieldCheck, Trash2, UserCog } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CatalogGate, PageHeader } from "@/components/catalog/shared";
import { useCatalogs } from "@/components/catalog-provider";
import { ConfirmActionDialog } from "@/components/safety/confirm-action-dialog";
import { BranchesNotReady, useBranches } from "@/components/staff/branches-manager";
import { PermissionDialog } from "@/components/staff/permission-dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS } from "@/hooks/use-current-staff";
import type { StaffMember } from "@/lib/catalog/types";
import { setStaffLock } from "@/lib/safety/repo";
import {
  DEFAULT_PASSWORD,
  POSITION_LABELS,
  POSITION_ORDER,
  loginName,
  positionLabel,
  type Position,
} from "@/lib/staff/positions";
import {
  createStaffAccount,
  fetchStaffLogins,
  removeStaffAccount,
  resetStaffPassword,
  updateStaffAccount,
  type Branch,
} from "@/lib/staff/repo";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { AdminOnly, errorText, useRole } from "./shared";

const ALL = "__all";
const KEEP = "__keep";
const USERNAME = /^[a-z0-9][a-z0-9._]{2,29}$/;

/**
 * Cài đặt → Tài khoản & Phân quyền: thêm người (tạo luôn tài khoản đăng nhập), sửa, xoá, khoá / mở khoá,
 * và phân quyền xem từng trang. Mọi quy tắc được kiểm tra lại ở cơ sở dữ liệu (file 008).
 */
export function AccountsManager() {
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={UserCog}
        title="Tài khoản & Phân quyền"
        description="Danh sách nhân sự dùng hệ thống: thêm người, đặt vị trí, nơi làm việc và các trang mỗi người được xem."
      />
      <AdminOnly>
        <CatalogGate>
          <AccountsBody />
        </CatalogGate>
      </AdminOnly>
    </div>
  );
}

/** Email đăng nhập của các tài khoản cũ (chưa có tên đăng nhập). */
function useLogins() {
  const [version, setVersion] = useState(0);
  const [logins, setLogins] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void fetchStaffLogins().then((next) => {
      if (!cancelled) setLogins(next);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { logins, reload };
}

function AccountsBody() {
  const { catalogs, reload } = useCatalogs();
  const { userId, isSuperAdmin, canDelete } = useRole();
  const { branches, loaded } = useBranches();
  const { logins, reload: reloadLogins } = useLogins();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState(ALL);
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [permissionFor, setPermissionFor] = useState<string | null>(null);
  const [locking, setLocking] = useState<StaffMember | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);

  if (!loaded) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (branches === null) return <BranchesNotReady />;

  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const loginOf = (member: StaffMember) =>
    member.username ?? (logins.get(member.user_id) ? loginName(logins.get(member.user_id) ?? "") : "—");
  /** Người đang đăng nhập có được sửa / khoá / xoá / phân quyền tài khoản này không (máy chủ kiểm tra lại). */
  const canManage = (member: StaffMember) =>
    member.user_id !== userId && member.role !== "super_admin" && (isSuperAdmin || member.role !== "admin");

  const query = search.trim().toLowerCase();
  const people = catalogs.staff
    .filter((m) => !m.deleted_at)
    .filter((m) => !query || m.full_name.toLowerCase().includes(query) || loginOf(m).toLowerCase().includes(query))
    .filter((m) => positionFilter === ALL || m.position === positionFilter)
    .filter((m) => branchFilter === ALL || m.branch_id === branchFilter)
    .filter((m) => statusFilter === ALL || (statusFilter === "locked") === Boolean(m.locked_at));
  const permissionMember = catalogs.staff.find((m) => m.user_id === permissionFor) ?? null;

  async function refresh() {
    reloadLogins();
    await reload();
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-64"
          placeholder="Tìm theo tên, tên đăng nhập…"
          aria-label="Tìm nhân sự"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={positionFilter} onValueChange={setPositionFilter}>
          <SelectTrigger className="w-44" aria-label="Lọc theo vị trí">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả vị trí</SelectItem>
            {POSITION_ORDER.map((p) => (
              <SelectItem key={p} value={p}>
                {POSITION_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-48" aria-label="Lọc theo nơi làm việc">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả nơi làm việc</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" aria-label="Lọc theo trạng thái">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi trạng thái</SelectItem>
            <SelectItem value="active">Đang hoạt động</SelectItem>
            <SelectItem value="locked">Đang khoá</SelectItem>
          </SelectContent>
        </Select>
        {!adding && (
          <Button className="ml-auto" onClick={() => setAdding(true)}>
            <Plus />
            Thêm người
          </Button>
        )}
      </div>

      {adding && (
        <AddPersonForm
          branches={branches.filter((b) => b.is_active)}
          isSuperAdmin={isSuperAdmin}
          onCancel={() => setAdding(false)}
          onSaved={async (id, name, username) => {
            await refresh();
            setAdding(false);
            toast.success(`Đã thêm ${name}`, {
              description: `Đăng nhập bằng tên “${username}”. Người này chưa xem được trang nào — hãy phân quyền.`,
              action: { label: "Phân quyền", onClick: () => setPermissionFor(id) },
              duration: 10000,
            });
          }}
        />
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted text-left">
              <th className="w-10 px-3 py-2 text-right font-medium">TT</th>
              <th className="px-3 py-2 font-medium">Tên đăng nhập</th>
              <th className="px-3 py-2 font-medium">Tên nhân viên</th>
              <th className="px-3 py-2 font-medium">Vị trí</th>
              <th className="px-3 py-2 font-medium">Nơi làm việc</th>
              <th className="px-3 py-2 font-medium">Trạng thái</th>
              <th className="px-3 py-2 text-right font-medium">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr>
                <td colSpan={7} className="h-20 text-center text-muted-foreground">
                  Không có nhân sự nào khớp bộ lọc.
                </td>
              </tr>
            ) : (
              people.map((member, i) => {
                const manageable = canManage(member);
                const locked = Boolean(member.locked_at);
                return (
                  <tr key={member.user_id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{loginOf(member)}</td>
                    <td className="px-3 py-2">
                      {member.full_name}
                      {member.user_id === userId && <span className="ml-1.5 text-xs text-muted-foreground">(bạn)</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{positionLabel(member.position, member.role)}</td>
                    <td className="px-3 py-2">
                      {member.branch_id ? (branchName.get(member.branch_id) ?? "…") : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                          locked
                            ? "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
                        )}
                        title={locked ? (member.locked_reason ?? undefined) : undefined}
                      >
                        {locked ? "Đang khoá" : "Hoạt động"}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      {member.role === "super_admin" ? (
                        <p className="px-1 text-right text-xs text-muted-foreground">Toàn quyền</p>
                      ) : (
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-1"
                            disabled={!manageable}
                            onClick={() => setPermissionFor(member.user_id)}
                          >
                            <ShieldCheck />
                            Phân quyền
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Sửa ${member.full_name}`}
                            title="Sửa"
                            disabled={!manageable}
                            onClick={() => setEditing(member)}
                          >
                            <Pencil />
                          </Button>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Xoá ${member.full_name}`}
                              title="Xoá"
                              disabled={!manageable}
                              onClick={() => setRemoving(member)}
                            >
                              <Trash2 />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={locked ? `Mở khoá ${member.full_name}` : `Khoá ${member.full_name}`}
                            title={locked ? "Đang khoá — bấm để mở khoá" : "Đang hoạt động — bấm để khoá"}
                            disabled={!manageable}
                            onClick={() => setLocking(member)}
                            className={locked ? "text-red-600 dark:text-red-400" : undefined}
                          >
                            {locked ? <Lock /> : <LockOpen />}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-1 text-sm text-muted-foreground">
        <li>
          • Người mới thêm chưa xem được trang nào: bấm <b>Phân quyền</b> để tick các trang hiện ở menu trái của người đó.
        </li>
        <li>
          • Vị trí quyết định được đọc / sửa dữ liệu gì: COO = Quản trị, Lead Ads = quản lý Marketing, Nhân viên quảng cáo
          = chỉ TKQC của mình, Trực page = nhập lead. Thêm / sửa người ở vị trí COO chỉ Quản trị cấp cao làm được.
        </li>
        <li>
          • <Lock className="inline size-3.5" /> khoá đang đóng = cấm đăng nhập; <LockOpen className="inline size-3.5" />{" "}
          khoá mở = hoạt động bình thường. Xoá nhân sự chỉ ẩn khỏi danh sách và cấm đăng nhập, dữ liệu cũ giữ nguyên.
        </li>
        <li>
          • Nơi làm việc lấy từ{" "}
          <Link href="/cai-dat/co-so" className="font-medium text-foreground underline underline-offset-2">
            Cài đặt → Danh sách cơ sở
          </Link>
          . Mọi lần thêm, sửa, khoá, phân quyền đều được ghi vào Nhật ký hệ thống.
        </li>
      </ul>

      {editing && (
        <EditPersonDialog
          key={editing.user_id}
          member={editing}
          login={loginOf(editing)}
          branches={branches}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {permissionMember && (
        <PermissionDialog
          key={permissionMember.user_id}
          member={permissionMember}
          onClose={() => setPermissionFor(null)}
          onSaved={refresh}
        />
      )}
      <ConfirmActionDialog
        open={locking !== null}
        onOpenChange={(open) => !open && setLocking(null)}
        title={locking?.locked_at ? `Mở khoá ${locking?.full_name}?` : `Khoá ${locking?.full_name}?`}
        description={
          locking?.locked_at ? (
            <p>Người này sẽ đăng nhập và dùng hệ thống lại bình thường.</p>
          ) : (
            <p>Người này sẽ không đăng nhập được nữa cho tới khi được mở khoá. Dữ liệu của họ giữ nguyên.</p>
          )
        }
        cancelLabel="Không"
        confirmLabel={locking?.locked_at ? "Mở khoá" : "Khoá"}
        destructive={!locking?.locked_at}
        onConfirm={async () => {
          if (!locking) return;
          await setStaffLock(locking.user_id, !locking.locked_at, "Quản trị khoá");
          await refresh();
          toast.success(locking.locked_at ? `Đã mở khoá ${locking.full_name}` : `Đã khoá ${locking.full_name}`);
        }}
      />
      <ConfirmActionDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Xác nhận xoá?"
        description={
          <>
            <p>
              Xoá <b>{removing?.full_name}</b> khỏi danh sách nhân sự?
            </p>
            <p>Người này sẽ không đăng nhập được nữa. Lead, báo cáo, nhật ký cũ của họ vẫn giữ nguyên.</p>
          </>
        }
        cancelLabel="Không"
        confirmLabel="Có, xoá"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await removeStaffAccount(removing.user_id);
          await refresh();
          toast.success(`Đã xoá ${removing.full_name} khỏi danh sách nhân sự`);
        }}
      />
    </section>
  );
}

function Required() {
  return <span className="text-destructive"> *</span>;
}

/** Form "Thêm người": hiện ngay trên trang; lưu xong người mới xuống bảng bên dưới. */
function AddPersonForm({
  branches,
  isSuperAdmin,
  onCancel,
  onSaved,
}: {
  branches: Branch[];
  isSuperAdmin: boolean;
  onCancel: () => void;
  onSaved: (id: string, name: string, username: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState<Position | "">("");
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const badUsername = username !== "" && !USERNAME.test(username);
  const complete =
    USERNAME.test(username) && password.length >= 8 && fullName.trim() !== "" && position !== "" && branchId !== "";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!complete) return;
    setSaving(true);
    setError(null);
    try {
      const id = await createStaffAccount({ username, password, fullName: fullName.trim(), position, branchId });
      await onSaved(id, fullName.trim(), username);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4 rounded-xl border bg-card p-4" noValidate>
      <h3 className="font-medium">Thêm người</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="new-username">
            Tên đăng nhập
            <Required />
          </Label>
          <Input
            id="new-username"
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={30}
            placeholder="vd thu.hoa"
            value={username}
            aria-invalid={badUsername || undefined}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
          />
          <p className={cn("text-xs", badUsername ? "text-destructive" : "text-muted-foreground")}>
            3–30 ký tự: chữ thường không dấu, số, dấu chấm, gạch dưới.
          </p>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="new-password">
            Mật khẩu
            <Required />
          </Label>
          <Input
            id="new-password"
            type="text"
            autoComplete="new-password"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className={cn("text-xs", password.length < 8 ? "text-destructive" : "text-muted-foreground")}>
            Không đổi thì mật khẩu là {DEFAULT_PASSWORD}. Tối thiểu 8 ký tự; nhân viên tự đổi sau khi đăng nhập.
          </p>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="new-fullname">
            Tên nhân viên
            <Required />
          </Label>
          <Input id="new-fullname" maxLength={120} placeholder="vd Đinh Thị Diệu Linh" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="new-position">
            Vị trí
            <Required />
          </Label>
          <Select value={position} onValueChange={(value) => setPosition(value as Position)}>
            <SelectTrigger id="new-position" className="w-full">
              <SelectValue placeholder="Chọn vị trí" />
            </SelectTrigger>
            <SelectContent>
              {POSITION_ORDER.filter((p) => isSuperAdmin || p !== "coo").map((p) => (
                <SelectItem key={p} value={p}>
                  {POSITION_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="new-branch">
            Nơi làm việc
            <Required />
          </Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger id="new-branch" className="w-full">
              <SelectValue placeholder="Chọn cơ sở" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {branches.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Chưa có cơ sở nào —{" "}
              <Link href="/cai-dat/co-so" className="underline underline-offset-2">
                thêm ở Danh sách cơ sở
              </Link>
              .
            </p>
          )}
        </div>
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

/** Nút bút: sửa tên, vị trí, nơi làm việc; đặt lại mật khẩu nếu điền. */
function EditPersonDialog({
  member,
  login,
  branches,
  isSuperAdmin,
  onClose,
  onSaved,
}: {
  member: StaffMember;
  login: string;
  branches: Branch[];
  isSuperAdmin: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState(member.full_name);
  const [position, setPosition] = useState<string>(member.position ?? KEEP);
  const [branchId, setBranchId] = useState(member.branch_id ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (password && password.length < 8) return setError("Mật khẩu mới tối thiểu 8 ký tự.");
    setSaving(true);
    setError(null);
    try {
      await updateStaffAccount(member.user_id, {
        fullName: fullName.trim(),
        position: position === KEEP ? null : (position as Position),
        branchId: branchId || null,
      });
      if (password) await resetStaffPassword(member.user_id, password);
      await onSaved();
      toast.success(`Đã cập nhật ${fullName.trim()}`, password ? { description: "Đã đặt mật khẩu mới." } : undefined);
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Sửa nhân sự</DialogTitle>
            <DialogDescription>Tên đăng nhập: {login}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-fullname">Tên nhân viên</Label>
            <Input id="edit-fullname" maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-position">Vị trí</Label>
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger id="edit-position" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!member.position && <SelectItem value={KEEP}>Giữ: {ROLE_LABELS[member.role]}</SelectItem>}
                  {POSITION_ORDER.filter((p) => isSuperAdmin || p !== "coo").map((p) => (
                    <SelectItem key={p} value={p}>
                      {POSITION_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-branch">Nơi làm việc</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="edit-branch" className="w-full">
                  <SelectValue placeholder="Chọn cơ sở" />
                </SelectTrigger>
                <SelectContent>
                  {branches
                    .filter((b) => b.is_active || b.id === member.branch_id)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-password">Đặt lại mật khẩu</Label>
            <div className="flex gap-2">
              <Input
                id="edit-password"
                type="text"
                autoComplete="new-password"
                spellCheck={false}
                placeholder="Để trống = giữ mật khẩu cũ"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={() => setPassword(DEFAULT_PASSWORD)}>
                Mặc định
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Huỷ
            </Button>
            <Button type="submit" disabled={saving || !fullName.trim()}>
              {saving ? "Đang lưu…" : "Lưu thay đổi"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
