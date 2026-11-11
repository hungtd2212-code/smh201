import type { Metadata } from "next";
import { PerformanceReport } from "@/components/ads-stats/performance-report";

export const metadata: Metadata = { title: "Marketing — Báo cáo hiệu suất" };

export default function PerformanceReportPage() {
  return <PerformanceReport />;
}
