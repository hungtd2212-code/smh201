import type { Metadata } from "next";
import { LeadsDashboardLoader } from "@/components/telesale/leads-dashboard-loader";

export const metadata: Metadata = { title: "Telesale — Leads" };

export default function LeadsPage() {
  return <LeadsDashboardLoader />;
}
