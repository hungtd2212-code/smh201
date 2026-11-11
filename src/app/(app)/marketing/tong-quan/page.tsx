import type { Metadata } from "next";
import { ReportOverview } from "@/components/ad-reports/report-overview";

export const metadata: Metadata = { title: "Marketing — Tổng quan" };

export default function ReportOverviewPage() {
  return <ReportOverview />;
}
