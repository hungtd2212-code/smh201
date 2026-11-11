import type { Metadata } from "next";
import { BackupStatus } from "@/components/safety/backup-status";

export const metadata: Metadata = { title: "Cài đặt — Sao lưu & Khôi phục" };

export default function BackupPage() {
  return <BackupStatus />;
}
