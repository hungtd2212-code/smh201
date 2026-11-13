import type { Metadata } from "next";
import { LeadsPageLoader } from "@/components/telesale/crm/leads-page-loader";

export const metadata: Metadata = { title: "Telesale — Lead" };

export default function LeadsPage() {
  return <LeadsPageLoader />;
}
