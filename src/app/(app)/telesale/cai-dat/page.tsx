import type { Metadata } from "next";
import { TelesaleSettings } from "@/components/telesale/crm/telesale-settings";

export const metadata: Metadata = { title: "Telesale — Cài đặt" };

export default function TelesaleSettingsPage() {
  return <TelesaleSettings />;
}
