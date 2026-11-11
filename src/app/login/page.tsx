import { Stethoscope } from "lucide-react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { APP } from "@/lib/config";

export const metadata: Metadata = { title: "Đăng nhập" };

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Stethoscope className="size-5" />
          </span>
          <div className="grid leading-tight">
            <span className="font-semibold">{APP.name}</span>
            <span className="text-sm text-muted-foreground">{APP.tagline}</span>
          </div>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
