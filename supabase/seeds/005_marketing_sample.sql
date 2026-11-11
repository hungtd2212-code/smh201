-- =====================================================================
-- Smile Hub ERP — DỮ LIỆU KHỞI ĐẦU / MẪU cho Marketing giai đoạn 1
--
-- Chạy SAU supabase/005_marketing_catalog.sql. Chạy lại nhiều lần cũng không
-- sao: dòng nào đã có thì bỏ qua. Không sửa, không xoá dữ liệu đang có.
--
-- Thêm:
--   • 7 nhân viên Ads: Dương, Nam, An, Sang, A Hưng, Trung, Hằng (Miền Bắc).
--   • 2 TKQC lấy tên từ ví dụ: "THE DUONG 01" (Dương), "An 02" (An), giao từ
--     01/09/2026. Danh sách TKQC đầy đủ sẽ nhập từ file Google Sheet ở giai
--     đoạn 6 — phân công ở đây chỉ để có dữ liệu xem thử, cần rà lại.
--   • 1 chiến dịch và 1 bài post có chữ "(mẫu)" để xem thử màn hình. Không
--     cần nữa thì chuyển vào Thùng rác.
-- =====================================================================
begin;

insert into public.ads_staff (full_name, branch)
select v.name, 'HN'
from (values ('Dương'), ('Nam'), ('An'), ('Sang'), ('A Hưng'), ('Trung'), ('Hằng')) as v (name)
where not exists (
  select 1 from public.ads_staff a
  where lower(a.full_name) = lower(v.name) and a.deleted_at is null);

insert into public.ad_accounts (name, channel_id)
select v.name, c.id
from (values ('THE DUONG 01'), ('An 02')) as v (name)
join public.channels c on c.name = 'Facebook' and c.deleted_at is null
where not exists (
  select 1 from public.ad_accounts a
  where lower(a.name) = lower(v.name) and a.deleted_at is null);

-- Chỉ giao khi TKQC chưa có phân công nào.
insert into public.ad_account_assignments (ad_account_id, ads_staff_id, from_date)
select a.id, s.id, date '2026-09-01'
from (values ('THE DUONG 01', 'Dương'), ('An 02', 'An')) as v (account, staff)
join public.ad_accounts a on lower(a.name) = lower(v.account) and a.deleted_at is null
join public.ads_staff s on lower(s.full_name) = lower(v.staff) and s.deleted_at is null
where not exists (
  select 1 from public.ad_account_assignments x
  where x.ad_account_id = a.id and x.deleted_at is null);

insert into public.campaigns (name, channel_id, ad_account_id, objective, service_id, branch, start_date, budget)
select 'Niềng răng HN — Tin nhắn (mẫu)', a.channel_id, a.id, 'messages', sv.id, 'HN', date '2026-11-01', 30000000
from public.ad_accounts a
left join public.services sv on sv.name = 'Niềng răng' and sv.deleted_at is null
where lower(a.name) = 'the duong 01' and a.deleted_at is null
  and not exists (select 1 from public.campaigns c where c.name = 'Niềng răng HN — Tin nhắn (mẫu)');

insert into public.ad_posts (campaign_id, url, title, media_type, start_date)
select c.id, 'https://www.facebook.com/smilehub.mau/posts/1000000000000001',
       'Video niềng răng 01 (mẫu)', 'video', date '2026-11-01'
from public.campaigns c
where c.name = 'Niềng răng HN — Tin nhắn (mẫu)' and c.deleted_at is null
  and not exists (select 1 from public.ad_posts p where p.post_key = 'fb:1000000000000001');

commit;
