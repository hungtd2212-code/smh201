"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPassword } from "@/lib/staff/repo";

/** Người đang đăng nhập tự đổi mật khẩu (mở từ menu tên ở cuối thanh bên trái). */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open && <Body onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function Body({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next.length < 8) return setError("Mật khẩu mới tối thiểu 8 ký tự.");
    if (next !== again) return setError("Hai lần nhập mật khẩu mới không khớp.");
    setSaving(true);
    setError(null);
    try {
      await changeOwnPassword(current, next);
      toast.success("Đã đổi mật khẩu", { description: "Lần đăng nhập sau dùng mật khẩu mới." });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Đổi mật khẩu</DialogTitle>
        <DialogDescription>Mật khẩu mới tối thiểu 8 ký tự.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="pw-current">Mật khẩu hiện tại</Label>
        <Input id="pw-current" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pw-next">Mật khẩu mới</Label>
        <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pw-again">Nhập lại mật khẩu mới</Label>
        <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={saving}>
          Huỷ
        </Button>
        <Button type="submit" disabled={saving || !current || !next || !again}>
          {saving ? "Đang lưu…" : "Đổi mật khẩu"}
        </Button>
      </DialogFooter>
    </form>
  );
}
