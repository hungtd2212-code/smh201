import type { Metadata } from "next";
import { AccountsManager } from "@/components/safety/accounts-manager";

export const metadata: Metadata = { title: "Cài đặt — Tài khoản & Phân quyền" };

export default function AccountsPage() {
  return <AccountsManager />;
}
