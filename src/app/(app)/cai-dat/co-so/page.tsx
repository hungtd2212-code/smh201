import type { Metadata } from "next";
import { BranchesManager } from "@/components/staff/branches-manager";

export const metadata: Metadata = { title: "Cài đặt — Danh sách cơ sở" };

export default function BranchesPage() {
  return <BranchesManager />;
}
