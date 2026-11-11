import type { Metadata } from "next";
import { AdsStaffManager } from "@/components/catalog/ads-staff-manager";

export const metadata: Metadata = { title: "Marketing — Nhân viên Ads" };

export default function AdsStaffPage() {
  return <AdsStaffManager />;
}
