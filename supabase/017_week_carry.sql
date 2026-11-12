-- =====================================================================
-- Smile Hub ERP — CÁCH DỒN PHẦN THIẾU CỦA TUẦN KHÔNG ĐẠT (quản lý chốt)
--
-- Chạy SAU supabase/014_monthly_targets.sql. Chạy lại nhiều lần cũng không
-- sao. Chỉ THÊM một cột mới — không sửa, không xoá dữ liệu đang có.
--
-- Lý do (chủ phòng khám, 12/11/2026): đầu tháng mục tiêu chia đều theo
-- tuần; tuần đã qua mà không đạt thì phần thiếu dồn sang tuần sau, hoặc
-- chia đều cho các tuần còn lại. Quản trị / Trưởng Marketing chốt MỘT cách
-- cho cả công ty (theo từng tháng); nhân viên chỉ xem, không đổi được.
--
--   • ad_targets.week_carry (chỉ ở dòng "Cả nhóm" của tháng):
--       'spread' = chia đều các tuần còn lại, 'next' = dồn sang tuần sau.
--     Để trống = theo tháng gần nhất trước đó đã chốt; chưa chốt bao giờ
--     thì chia đều các tuần còn lại.
--   • Đổi cách dồn được ghi vào Lịch sử chỉnh sửa (ai, lúc nào) như các
--     mục tiêu khác (trigger nhật ký có sẵn ghi mọi cột thay đổi).
-- =====================================================================
begin;

alter table public.ad_targets add column if not exists week_carry text;
alter table public.ad_targets drop constraint if exists ad_targets_week_carry_check;
alter table public.ad_targets add constraint ad_targets_week_carry_check
  check (week_carry is null or (week_carry in ('next', 'spread') and ads_staff_id is null));

-- Quyền ghi theo cột (thêm vào quyền đã có của 012 / 014; RLS vẫn chỉ cho Quản trị / Trưởng Marketing).
grant insert (week_carry) on public.ad_targets to authenticated;
grant update (week_carry) on public.ad_targets to authenticated;

notify pgrst, 'reload schema';

commit;
