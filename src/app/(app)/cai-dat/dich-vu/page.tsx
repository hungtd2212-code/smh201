import type { Metadata } from "next";
import { ServicesManager } from "@/components/catalog/services-manager";

export const metadata: Metadata = { title: "Cài đặt — Dịch vụ & Bảng giá" };

export default function ServicesPage() {
  return <ServicesManager />;
}
