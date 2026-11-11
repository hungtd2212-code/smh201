import type { Metadata } from "next";
import { DailyEntry } from "@/components/ads-stats/daily-entry";

export const metadata: Metadata = { title: "Marketing — Nhập số liệu ngày" };

export default function DailyEntryPage() {
  return <DailyEntry />;
}
