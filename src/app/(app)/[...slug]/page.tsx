import { Construction } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NAV_PAGES } from "@/lib/nav";

/**
 * Trang giữ chỗ cho các mục có trong menu nhưng chưa xây.
 * Khi làm một trang, tạo thư mục riêng cho nó, ví dụ src/app/(app)/lich-hen/check-in/page.tsx
 * — Next.js sẽ ưu tiên trang đó thay cho trang giữ chỗ này.
 */

/** Các trang đã xây thật (có thư mục riêng) — không dựng trang giữ chỗ cho chúng. */
const BUILT_PAGES = new Set([
  "/telesale/leads",
  "/telesale/chia-lead",
  "/marketing/nhap-so-lieu",
  "/marketing/bao-cao",
  "/marketing/chien-dich",
  "/marketing/tkqc-page",
  "/marketing/nhan-vien-ads",
  "/cai-dat/dich-vu",
  "/cai-dat/tai-khoan",
  "/cai-dat/nhat-ky",
  "/cai-dat/thung-rac",
  "/cai-dat/sao-luu",
]);

const PLACEHOLDER_PAGES = NAV_PAGES.filter((p) => !BUILT_PAGES.has(p.href));

const findPage = (slug: string[]) =>
  PLACEHOLDER_PAGES.find((p) => p.href === `/${slug.join("/")}`);

// Trang giữ chỗ không cần tối ưu "điều hướng tức thì" của Next.js.
export const instant = false;

export function generateStaticParams() {
  return PLACEHOLDER_PAGES.map((p) => ({ slug: p.href.slice(1).split("/") }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[...slug]">): Promise<Metadata> {
  const page = findPage((await params).slug);
  return { title: page ? `${page.module} — ${page.title}` : undefined };
}

export default async function PlaceholderPage({
  params,
}: PageProps<"/[...slug]">) {
  const page = findPage((await params).slug);
  if (!page) notFound();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Construction className="size-6" />
      </span>
      <p className="text-sm text-muted-foreground">
        {[page.section, page.module].filter(Boolean).join(" › ")}
      </p>
      <h1 className="text-xl font-semibold">{page.title}</h1>
      {page.hint && (
        <p className="max-w-md text-sm text-muted-foreground">
          Dự kiến gồm: {page.hint}
        </p>
      )}
      <p className="max-w-sm text-sm text-muted-foreground">
        Trang này chưa được xây dựng.
      </p>
      <Button asChild variant="outline">
        <Link href="/telesale/leads">Về trang Leads</Link>
      </Button>
    </div>
  );
}
