import type { Metadata } from "next";
import { CampaignsManager } from "@/components/catalog/campaigns-manager";

export const metadata: Metadata = { title: "Marketing — Chiến dịch & Bài post" };

export default function CampaignsPage() {
  return <CampaignsManager />;
}
