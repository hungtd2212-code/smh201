import type { Metadata } from "next";
import { AuditLogViewer } from "@/components/safety/audit-log-viewer";

export const metadata: Metadata = { title: "Cài đặt — Nhật ký hệ thống" };

export default function AuditLogPage() {
  return <AuditLogViewer />;
}
