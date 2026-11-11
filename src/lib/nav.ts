import {
  CalendarDays,
  ChartColumn,
  ChartLine,
  ClipboardList,
  Coins,
  HeartHandshake,
  LayoutGrid,
  Megaphone,
  Phone,
  Rocket,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  icon: LucideIcon;
  /** Có `href` → là một trang. Có `children` → là nhóm mở ra được. */
  href?: string;
  children?: { title: string; href: string }[];
};

/**
 * Menu bên trái. Hiện chỉ có 1 cơ sở (Hà Nội) nên không tách menu theo cơ sở.
 * Thêm phân hệ mới: thêm 1 dòng ở đây rồi tạo trang tương ứng trong src/app/(app)/.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    title: "Telesale",
    icon: Phone,
    children: [
      { title: "Leads", href: "/telesale/leads" },
      { title: "Nhắc hẹn", href: "/telesale/nhac-hen" },
      { title: "Nhân viên", href: "/telesale/nhan-vien" },
      { title: "Chia ca", href: "/telesale/chia-ca" },
      { title: "Báo cáo", href: "/telesale/bao-cao" },
    ],
  },
  { title: "Phân tích Telesale", icon: ChartLine, href: "/phan-tich-telesale" },
  { title: "Lịch hẹn", icon: CalendarDays, href: "/lich-hen" },
  { title: "Báo cáo cơ sở", icon: ClipboardList, href: "/bao-cao-co-so" },
  { title: "Doanh số", icon: Coins, href: "/doanh-so" },
  {
    title: "CSKH",
    icon: HeartHandshake,
    children: [
      { title: "Khách hàng", href: "/cskh/khach-hang" },
      { title: "Chăm sóc sau dịch vụ", href: "/cskh/cham-soc" },
      { title: "Nhắc tái khám", href: "/cskh/tai-kham" },
    ],
  },
  { title: "Tài khoản", icon: ShieldCheck, href: "/tai-khoan" },
  { title: "Marketing", icon: Megaphone, href: "/marketing" },
  { title: "Báo cáo bài hiệu quả", icon: ChartColumn, href: "/marketing/bai-hieu-qua" },
  { title: "Phân tích Marketing", icon: TrendingUp, href: "/marketing/phan-tich" },
  { title: "Tổng hợp page", icon: LayoutGrid, href: "/marketing/tong-hop-page" },
  { title: "Lên camp", icon: Rocket, href: "/marketing/len-camp" },
];

/** Danh sách phẳng mọi trang trong menu: { href, title, group }. */
export const NAV_PAGES = NAV_ITEMS.flatMap((item) =>
  item.children
    ? item.children.map((child) => ({ ...child, group: item.title }))
    : [{ title: item.title, href: item.href!, group: null as string | null }],
);
