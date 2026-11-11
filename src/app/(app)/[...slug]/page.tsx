import { Construction } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NAV_PAGES } from "@/lib/nav";

/**
 * Trang giữ chỗ cho các phân hệ có trong menu nhưng chưa xây.
 * Khi làm một phân hệ, tạo thư mục riêng cho nó, ví dụ src/app/(app)/lich-hen/page.tsx
 * — Next.js sẽ ưu tiên trang đó thay cho trang giữ chỗ này.
 */

const PLACEHOLDER_PAGES = NAV_PAGES.filter((p) => p.href !== "/telesale/leads");

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
  return { title: page?.title };
}

export default async function PlaceholderPage({
  params,
}: PageProps<"/[...slug]">) {
  const page = findPage((await params).slug);
  if (!page) notFound();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Construction className="size-6" />
      </span>
      <h1 className="text-xl font-semibold">
        {page.group ? `${page.group} — ${page.title}` : page.title}
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Phân hệ này chưa được xây dựng. Hiện mới có màn hình Telesale → Leads.
      </p>
      <Button asChild variant="outline">
        <Link href="/telesale/leads">Về trang Leads</Link>
      </Button>
    </div>
  );
}
