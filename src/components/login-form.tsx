"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    setError(null);
    setSubmitting(true);

    const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });

    if (error) {
      setSubmitting(false);
      setError(
        error.code === "invalid_credentials"
          ? "Email hoặc mật khẩu không đúng."
          : error.message,
      );
      return;
    }

    // Tải lại toàn trang (không chuyển trang kiểu SPA) để mọi dữ liệu còn nhớ
    // trong bộ nhớ từ phiên trước bị xoá sạch, và ô mật khẩu không còn giữ giá trị.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- cố ý tải lại toàn trang
    window.location.assign("/");
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
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
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Tài khoản do quản trị viên tạo trong Supabase → Authentication → Users.
      </p>
    </form>
  );
}
