"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginEmail } from "@/lib/staff/positions";
import {
  askBrowserToSave,
  getSavedCredential,
  readRememberedLogin,
  stopAutoSignIn,
  writeRememberedLogin,
  type RememberedLogin,
} from "@/lib/staff/remember-login";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const noSubscribe = () => () => {};
const notReadYet = () => null;

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // "Nhớ đăng nhập trên máy này": null lúc dựng trang trên máy chủ (chưa đọc được bộ nhớ của trình duyệt).
  const saved = useSyncExternalStore<RememberedLogin | null>(noSubscribe, readRememberedLogin, notReadYet);
  const [rememberChoice, setRememberChoice] = useState<boolean | null>(null);
  const remember = rememberChoice ?? saved?.remember ?? true;
  const formRef = useRef<HTMLFormElement>(null);

  // Chrome / Edge đã lưu tài khoản cho trang này → điền sẵn và đăng nhập luôn (vừa đăng xuất thì trình duyệt hiện bảng
  // chọn tài khoản, phải bấm chọn). Đã bỏ chọn "Nhớ đăng nhập" thì không hỏi trình duyệt.
  const autoFill = Boolean(saved?.remember);
  useEffect(() => {
    if (!isSupabaseConfigured || !autoFill) return;
    const controller = new AbortController();
    void getSavedCredential(controller.signal).then((cred) => {
      const form = formRef.current;
      if (!cred || !form || controller.signal.aborted) return;
      (form.elements.namedItem("login") as HTMLInputElement).value = cred.login;
      (form.elements.namedItem("password") as HTMLInputElement).value = cred.password;
      form.requestSubmit();
    });
    return () => controller.abort();
  }, [autoFill]);

  if (!isSupabaseConfigured) {
    return (
      <div className="grid gap-4 text-sm">
        <p className="text-muted-foreground">
          Ứng dụng chưa kết nối Supabase nên chưa cần đăng nhập. Làm theo mục
          “Kết nối Supabase” trong README.md để bật đăng nhập.
        </p>
        <Button asChild>
          <Link href="/">Vào xem thử với dữ liệu mẫu</Link>
        </Button>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const login = String(form.get("login") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setError(null);
    setSubmitting(true);

    // Gõ tên đăng nhập (vd thu.hoa) hoặc email (tài khoản cũ).
    const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
      email: loginEmail(login),
      password,
    });

    if (error) {
      setSubmitting(false);
      setError(
        error.code === "invalid_credentials"
          ? "Tên đăng nhập hoặc mật khẩu không đúng."
          : error.code === "user_banned"
            ? "Tài khoản đang bị khoá — hãy liên hệ Quản trị."
            : error.message,
      );
      return;
    }

    if (remember) {
      writeRememberedLogin(true, login);
      await askBrowserToSave(login, password);
    } else {
      writeRememberedLogin(false, "");
      await stopAutoSignIn();
    }

    // Tải lại toàn trang (không chuyển trang kiểu SPA) để mọi dữ liệu còn nhớ
    // trong bộ nhớ từ phiên trước bị xoá sạch, và ô mật khẩu không còn giữ giá trị.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- cố ý tải lại toàn trang
    window.location.assign("/");
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="login">Tên đăng nhập</Label>
        <Input
          // Đọc xong tên đã nhớ thì dựng lại ô để điền sẵn.
          key={saved ? "saved" : "server"}
          id="login"
          name="login"
          defaultValue={saved?.login ?? ""}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="vd thu.hoa (tài khoản cũ: nhập email)"
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Mật khẩu</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="remember"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={remember}
          onChange={(e) => setRememberChoice(e.target.checked)}
        />
        <span>
          Nhớ đăng nhập trên máy này
          <span className="block text-xs text-muted-foreground">
            Lần sau vào lại không phải gõ lại. Máy dùng chung nhiều người thì bỏ chọn.
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Tài khoản do Quản trị tạo ở Cài đặt → Tài khoản &amp; Phân quyền. Quên mật khẩu thì nhờ Quản trị đặt lại.
      </p>
    </form>
  );
}
