import type { Metadata } from "next";
import { AdsAutoPage } from "@/components/ads-auto/ads-auto-page";

export const metadata: Metadata = { title: "Marketing — Ads tự động (thử nghiệm)" };

export default function AdsAutoRoute() {
  return <AdsAutoPage />;
}
