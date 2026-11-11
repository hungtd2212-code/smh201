import {
  Banknote,
  CalendarDays,
  ChartColumn,
  CreditCard,
  FlaskConical,
  House,
  Landmark,
  Megaphone,
  MessageCircleHeart,
  Package,
  Phone,
  Settings,
  Stethoscope,
  UserRound,
  Users,
} from "lucide-react";
import { ToothIcon } from "@/components/icons/tooth";

/**
 * Cấu trúc menu bên trái: Nhóm → Phân hệ → Trang.
 *
 * Thêm / đổi tên / sắp xếp lại menu thì chỉ sửa ở file này.
 * `hint` là ghi chú trang đó dự kiến gồm gì — hiện ở trang giữ chỗ khi phân hệ chưa được xây.
 * Khi xây một trang, tạo file tương ứng trong src/app/(app)/, ví dụ
 * href "/lich-hen/check-in" → src/app/(app)/lich-hen/check-in/page.tsx
 */

export type NavPage = { title: string; href: string; hint?: string };

export type NavModule = {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  pages: NavPage[];
};

export type NavSection = {
  /** Tên nhóm hiện phía trên các phân hệ; null = không có tiêu đề nhóm. */
  label: string | null;
  modules: NavModule[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    modules: [
      {
        title: "Tổng quan",
        icon: House,
        pages: [
          { title: "Dashboard", href: "/tong-quan/dashboard", hint: "KPI, việc cần làm, thông báo" },
          { title: "Công việc & Phê duyệt", href: "/tong-quan/cong-viec", hint: "Task, duyệt chi, duyệt giảm giá" },
        ],
      },
    ],
  },
  {
    label: "Khách hàng & Kinh doanh",
    modules: [
      {
        title: "Marketing",
        icon: Megaphone,
        pages: [
          { title: "Chiến dịch / Lên camp", href: "/marketing/chien-dich" },
          { title: "Nguồn lead & Trang", href: "/marketing/nguon-lead", hint: "Nguồn lead và các trang (page)" },
          { title: "Hiệu quả nội dung", href: "/marketing/hieu-qua-noi-dung", hint: "Hiệu quả từng bài viết" },
          { title: "Chi phí quảng cáo & ROI", href: "/marketing/chi-phi-roi" },
        ],
      },
      {
        title: "Telesale",
        icon: Phone,
        pages: [
          { title: "Leads", href: "/telesale/leads" },
          { title: "Nhắc gọi lại", href: "/telesale/nhac-goi-lai" },
          { title: "Chia lead / Chia ca", href: "/telesale/chia-lead" },
        ],
      },
      {
        title: "Lịch hẹn",
        icon: CalendarDays,
        pages: [
          { title: "Lịch theo bác sĩ / ghế / phòng", href: "/lich-hen/lich" },
          { title: "Check-in & hàng chờ", href: "/lich-hen/check-in", hint: "Dành cho lễ tân" },
          { title: "Khách không đến", href: "/lich-hen/khach-khong-den" },
        ],
      },
      {
        title: "Khách hàng",
        icon: UserRound,
        pages: [
          { title: "Danh sách khách hàng", href: "/khach-hang/danh-sach" },
          { title: "Hồ sơ bệnh án", href: "/khach-hang/benh-an", hint: "Tiền sử, sơ đồ răng, ảnh, X-quang" },
          { title: "Lịch sử điều trị & thanh toán", href: "/khach-hang/lich-su" },
        ],
      },
      {
        title: "CSKH",
        icon: MessageCircleHeart,
        pages: [
          { title: "Chăm sóc sau điều trị", href: "/cskh/sau-dieu-tri" },
          { title: "Nhắc tái khám / định kỳ", href: "/cskh/tai-kham" },
          { title: "Khảo sát hài lòng", href: "/cskh/khao-sat" },
          { title: "Khiếu nại", href: "/cskh/khieu-nai" },
        ],
      },
    ],
  },
  {
    label: "Phòng khám",
    modules: [
      {
        title: "Tư vấn",
        icon: Stethoscope,
        pages: [
          { title: "Kế hoạch điều trị & báo giá", href: "/tu-van/ke-hoach-bao-gia" },
          { title: "Hợp đồng / Gói trả góp", href: "/tu-van/hop-dong" },
        ],
      },
      {
        title: "Điều trị",
        icon: ToothIcon,
        pages: [
          { title: "Phiếu điều trị & tiến độ", href: "/dieu-tri/phieu-dieu-tri" },
          { title: "Đơn thuốc", href: "/dieu-tri/don-thuoc" },
        ],
      },
      {
        title: "Labo",
        icon: FlaskConical,
        pages: [
          { title: "Đặt labo & giao nhận", href: "/labo/dat-labo" },
          { title: "Nhà cung cấp labo", href: "/labo/nha-cung-cap" },
        ],
      },
    ],
  },
  {
    label: "Tài chính",
    modules: [
      {
        title: "Thu ngân",
        icon: Banknote,
        pages: [
          { title: "Thu tiền / Đặt cọc / Hoàn tiền", href: "/thu-ngan/thu-tien" },
          { title: "Hóa đơn", href: "/thu-ngan/hoa-don" },
        ],
      },
      {
        title: "Công nợ",
        icon: CreditCard,
        pages: [
          { title: "Công nợ khách hàng", href: "/cong-no/khach-hang", hint: "Các khoản trả góp" },
          { title: "Công nợ nhà cung cấp & labo", href: "/cong-no/nha-cung-cap" },
        ],
      },
      {
        title: "Thu chi & Quỹ",
        icon: Landmark,
        pages: [
          { title: "Phiếu thu / Phiếu chi", href: "/thu-chi/phieu-thu-chi" },
          { title: "Sổ quỹ tiền mặt & ngân hàng", href: "/thu-chi/so-quy" },
        ],
      },
    ],
  },
  {
    label: "Vận hành",
    modules: [
      {
        title: "Kho & Mua hàng",
        icon: Package,
        pages: [
          { title: "Vật tư / Thuốc / Thiết bị", href: "/kho/vat-tu" },
          { title: "Đề nghị mua & Đơn mua", href: "/kho/mua-hang" },
          { title: "Nhập / Xuất / Chuyển kho", href: "/kho/nhap-xuat" },
          { title: "Kiểm kê & tồn kho", href: "/kho/kiem-ke" },
          { title: "Định mức vật tư theo dịch vụ", href: "/kho/dinh-muc" },
        ],
      },
      {
        title: "Nhân sự",
        icon: Users,
        pages: [
          { title: "Nhân viên", href: "/nhan-su/nhan-vien", hint: "Bác sĩ, phụ tá, tư vấn, sale…" },
          { title: "Ca làm & Chấm công", href: "/nhan-su/cham-cong" },
          { title: "Lương", href: "/nhan-su/luong" },
          { title: "Hoa hồng & KPI", href: "/nhan-su/hoa-hong-kpi" },
        ],
      },
    ],
  },
  {
    label: "Báo cáo",
    modules: [
      {
        title: "Báo cáo",
        icon: ChartColumn,
        pages: [
          { title: "Doanh số & Thực thu", href: "/bao-cao/doanh-so" },
          { title: "Theo cơ sở", href: "/bao-cao/co-so" },
          { title: "Theo nhân viên / bác sĩ", href: "/bao-cao/nhan-vien" },
          { title: "Theo nguồn & Marketing", href: "/bao-cao/marketing" },
          { title: "Telesale & tỷ lệ chốt", href: "/bao-cao/telesale" },
          { title: "Kho & Tài chính", href: "/bao-cao/kho-tai-chinh" },
        ],
      },
    ],
  },
  {
    label: "Hệ thống",
    modules: [
      {
        title: "Cài đặt",
        icon: Settings,
        pages: [
          { title: "Tài khoản & Phân quyền", href: "/cai-dat/tai-khoan" },
          { title: "Cơ sở / Phòng / Ghế", href: "/cai-dat/co-so" },
          { title: "Dịch vụ & Bảng giá", href: "/cai-dat/dich-vu" },
          { title: "Danh mục chung", href: "/cai-dat/danh-muc", hint: "Nguồn, trạng thái lead, lý do huỷ…" },
          { title: "Mẫu tin nhắn / Zalo / SMS", href: "/cai-dat/mau-tin-nhan" },
          { title: "Nhật ký hệ thống", href: "/cai-dat/nhat-ky" },
          { title: "Thùng rác", href: "/cai-dat/thung-rac" },
          { title: "Sao lưu & Khôi phục", href: "/cai-dat/sao-luu" },
        ],
      },
    ],
  },
];

/** Danh sách phẳng mọi trang, kèm tên phân hệ và nhóm chứa nó. */
export const NAV_PAGES = NAV_SECTIONS.flatMap((section) =>
  section.modules.flatMap((mod) =>
    mod.pages.map((page) => ({
      ...page,
      module: mod.title,
      section: section.label,
    })),
  ),
);
