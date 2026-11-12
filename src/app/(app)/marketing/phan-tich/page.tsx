import type { Metadata } from "next";
import { ReportAnalysis } from "@/components/ad-reports/report-analysis";

export const metadata: Metadata = { title: "Marketing — Phân tích" };

export default function ReportAnalysisPage() {
  return <ReportAnalysis />;
}
