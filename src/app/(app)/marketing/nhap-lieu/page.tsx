import type { Metadata } from "next";
import { ReportEntry } from "@/components/ad-reports/report-entry";

export const metadata: Metadata = { title: "Marketing — Nhập liệu" };

export default function ReportEntryPage() {
  return <ReportEntry />;
}
