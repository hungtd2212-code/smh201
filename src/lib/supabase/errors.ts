/**
 * Mã lỗi Postgres "không có cột này". Gặp khi mã mới chạy trên cơ sở dữ liệu chưa được cập nhật
 * (một file trong supabase/ chưa chạy). Chỗ nào đọc cột mới thêm thì bắt mã này để đọc lại theo
 * kiểu cũ, thay vì làm hỏng cả màn hình.
 */
export const MISSING_COLUMN = "42703";
