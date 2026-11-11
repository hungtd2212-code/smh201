import type { Metadata } from "next";
import { LeadAssignment } from "@/components/telesale/lead-assignment";

export const metadata: Metadata = { title: "Telesale — Chia lead" };

export default function LeadAssignmentPage() {
  return <LeadAssignment />;
}
