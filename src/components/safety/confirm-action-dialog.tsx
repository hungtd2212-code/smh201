"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";
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
import { PasswordRequiredError, confirmPassword } from "@/lib/safety/repo";
import { errorText } from "./shared";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  /** Chữ trên nút không đồng ý (mặc định "Huỷ"). */
  cancelLabel?: string;
  /** Nút xác nhận màu đỏ (xoá, hoàn tác). */
  destructive?: boolean;
  /** Hỏi mật khẩu ngay từ đầu (xoá quá 20 bản ghi, xoá vĩnh viễn). */
  needsPassword?: boolean;
  onConfirm: () => Promise<void>;
};

/**
 * Hộp thoại xác nhận trước khi làm một việc khó quay lại. Nếu máy chủ đòi nhập lại
 * mật khẩu (kể cả khi ban đầu không hỏi) thì hiện ô mật khẩu và thử lại.
 */
export function ConfirmActionDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mỗi lần mở là một form mới: không giữ lại mật khẩu hay lỗi của lần trước. */}
        {props.open && <Body {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Huỷ",
  destructive,
  needsPassword = false,
  onConfirm,
}: Props) {
  const [askPassword, setAskPassword] = useState(needsPassword);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (askPassword && !password) {
      setError("Nhập mật khẩu của bạn để xác nhận.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (askPassword) await confirmPassword(password);
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof PasswordRequiredError) {
        setAskPassword(true);
        setError(askPassword ? caught.message : null);
      } else {
        setError(errorText(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="grid gap-2">{description}</div>
        </DialogDescription>
      </DialogHeader>

      {askPassword && (
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-password" className="flex items-center gap-1.5">
            <KeyRound className="size-3.5" />
            Nhập lại mật khẩu của bạn để xác nhận
          </Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(error)}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {cancelLabel}
        </Button>
        <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy}>
          {busy ? "Đang xử lý…" : confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
