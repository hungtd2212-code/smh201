import type { Metadata } from "next";
import { TrashManager } from "@/components/safety/trash-manager";

export const metadata: Metadata = { title: "Cài đặt — Thùng rác" };

export default function TrashPage() {
  return <TrashManager />;
}
