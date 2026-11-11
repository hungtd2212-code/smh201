import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "@/components/login-form";
import { APP } from "@/lib/config";

export const metadata: Metadata = { title: "Đăng nhập" };

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-linear-to-br from-brand-teal/12 via-background to-brand-blue/12 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border bg-card shadow-sm">
        {/* Dải màu thương hiệu mảnh ở mép trên. */}
        <div className="h-1 bg-linear-to-r from-brand-teal to-brand-blue" />
        <div className="p-6">
          <div className="mb-6 grid justify-items-center gap-2">
            <BrandLogo />
            <span className="text-sm text-muted-foreground">{APP.tagline}</span>
          </div>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
