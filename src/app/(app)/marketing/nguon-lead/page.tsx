import type { Metadata } from "next";
import { SourcesManager } from "@/components/catalog/sources-manager";

export const metadata: Metadata = { title: "Marketing — Nguồn lead & Trang" };

export default function SourcesPage() {
  return <SourcesManager />;
}
