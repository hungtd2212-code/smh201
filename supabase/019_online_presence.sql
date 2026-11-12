-- =====================================================================
-- Smile Hub ERP — AI ĐANG ONLINE (dãy ảnh đại diện cạnh nút sáng / tối)
--
-- Chạy SAU supabase/018_daily_revenue.sql. Chạy lại nhiều lần cũng không sao.
-- Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu nào: chỉ thêm 2 quy tắc quyền cho
-- kênh "smh-online" của Supabase Realtime. Không có bảng mới, không ghi gì.
--
-- Lý do (chủ phòng khám, 13/11/2026): cạnh nút mặt trăng / mặt trời hiện ảnh
-- đại diện của những người đang mở phần mềm.
--
-- Cách làm: mỗi trình duyệt đang mở phần mềm báo "tôi đang online" vào kênh
-- riêng tư "smh-online" (Realtime Presence); đóng trang là tự rời kênh. Chỉ
-- nhân viên đang làm (không bị khoá) mới vào và xem được kênh này — người
-- ngoài cầm khoá công khai của trang web cũng không biết được ai đang online.
-- =====================================================================
begin;

do $$
begin
  -- Xem ai đang online.
  if not exists (select 1 from pg_policies
                 where schemaname = 'realtime' and tablename = 'messages' and policyname = 'smh_online_read') then
    create policy smh_online_read on realtime.messages for select to authenticated
      using (extension = 'presence' and (select realtime.topic()) = 'smh-online' and (select private.is_staff()));
  end if;
  -- Báo "tôi đang online".
  if not exists (select 1 from pg_policies
                 where schemaname = 'realtime' and tablename = 'messages' and policyname = 'smh_online_track') then
    create policy smh_online_track on realtime.messages for insert to authenticated
      with check (extension = 'presence' and (select realtime.topic()) = 'smh-online' and (select private.is_staff()));
  end if;
end $$;

commit;
