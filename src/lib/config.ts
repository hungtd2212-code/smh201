/**
 * Thông tin chung của ứng dụng. Đổi tên phòng khám / cơ sở ở đây.
 */
export const APP = {
  name: "Smile Hub",
  tagline: "Nha khoa · 201 Trường Chinh",
  /** Hiện tại chỉ có 1 cơ sở. Khi mở thêm cơ sở, thêm vào bảng `leads.branch`. */
  branch: { code: "HN", name: "201 Trường Chinh" },
} as const;
