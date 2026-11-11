/**
 * Mã lỗi Postgres "không có cột này". Gặp khi mã mới chạy trên cơ sở dữ liệu chưa được cập nhật
 * (một file trong supabase/ chưa chạy). Chỗ nào đọc cột mới thêm thì bắt mã này để đọc lại theo
 * kiểu cũ, thay vì làm hỏng cả màn hình.
 */
export const MISSING_COLUMN = "42703";

/** Các mã lỗi "cơ sở dữ liệu chưa có cột / bảng / hàm này" (Postgres và lớp API của Supabase). */
const NOT_MIGRATED_CODES = new Set([
  MISSING_COLUMN,
  "42P01", // không có bảng
  "42883", // không có hàm
  "PGRST200", // không thấy quan hệ giữa hai bảng
  "PGRST202", // không thấy hàm
  "PGRST204", // không thấy cột
  "PGRST205", // không thấy bảng
]);

/**
 * true nếu lỗi này là do cơ sở dữ liệu chưa chạy file cập nhật mới nhất trong supabase/.
 * Dùng để ứng dụng vẫn chạy theo kiểu cũ và báo rõ "chưa dùng được", thay vì hỏng màn hình.
 */
export const isNotMigrated = (error: { code?: string } | null | undefined) =>
  Boolean(error?.code && NOT_MIGRATED_CODES.has(error.code));
