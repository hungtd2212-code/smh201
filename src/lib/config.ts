/**
 * Thông tin chung của ứng dụng. Đổi tên phòng khám / cơ sở ở đây.
 */
export const APP = {
  name: "SMH ERP",
  tagline: "Nha khoa · Hà Nội",
  /** Hiện tại chỉ có 1 cơ sở. Khi mở thêm cơ sở, thêm vào bảng `leads.branch`. */
  branch: { code: "HN", name: "Hà Nội" },
} as const;
