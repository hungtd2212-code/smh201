import type { Metadata } from "next";
import { MarketingSettings } from "@/components/catalog/marketing-settings";

export const metadata: Metadata = { title: "Marketing — Cài đặt" };

export default function MarketingSettingsPage() {
  return <MarketingSettings />;
}
