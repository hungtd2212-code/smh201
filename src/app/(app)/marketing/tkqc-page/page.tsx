import type { Metadata } from "next";
import { TkqcPageManager } from "@/components/catalog/tkqc-page-manager";

export const metadata: Metadata = { title: "Marketing — TKQC & Page" };

export default function TkqcPagePage() {
  return <TkqcPageManager />;
}
