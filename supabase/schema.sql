-- =====================================================================
-- SMH ERP — cơ sở dữ liệu cho phân hệ Telesale
--
-- Cách chạy: Supabase Dashboard → SQL Editor → New query → dán toàn bộ
-- file này vào → Run. Chạy lại nhiều lần cũng không sao.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Bảng STAFF — danh sách nhân viên được phép dùng hệ thống
--
-- Có tài khoản đăng nhập (Authentication → Users) là CHƯA đủ: tài khoản
-- phải có một dòng trong bảng này thì mới đọc/ghi được dữ liệu.
-- Nhờ vậy người lạ tự đăng ký tài khoản cũng không xem được gì.
-- ---------------------------------------------------------------------
create table if not exists public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  role       text not null default 'sale'
             check (role in ('admin', 'lead', 'sale')),
  created_at timestamptz not null default now()
);

alter table public.staff enable row level security;

-- Mỗi người chỉ xem được dòng của chính mình. Thêm / sửa / xoá nhân viên
-- thì làm trong Supabase Dashboard (Table Editor hoặc SQL Editor).
drop policy if exists staff_select_self on public.staff;
create policy staff_select_self on public.staff
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.staff from anon, authenticated;
grant select on public.staff to authenticated;


-- ---------------------------------------------------------------------
-- 2. Bảng LEADS — khách hàng tiềm năng của Telesale
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  branch         text not null default 'HN',          -- cơ sở (hiện chỉ có Hà Nội)
  full_name      text not null check (char_length(full_name) between 1 and 200),
  phone          text not null check (char_length(phone) between 8 and 20),
  service        text,                                -- dịch vụ quan tâm
  source         text,                                -- nguồn: Facebook Ads, Zalo...
  ads_id         text,
  status         text not null default 'so_moi'
                 check (status in (
                   'so_moi', 'chua_lien_he_duoc', 'goi_lai_sau', 'hen_lich',
                   'tiem_nang', 'tham_khao', 'da_lam_dich_vu', 'fail',
                   'so_het_nhu_cau', 'so_check_huy', 'so_huy', 'so_trung',
                   'trung_dich_vu_khac'
                 )),
  assignee       text,                                -- nhân viên phụ trách
  appointment_at timestamptz,                         -- lịch hẹn
  note           text,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null
);

create index if not exists leads_branch_created_at_idx
  on public.leads (branch, created_at desc);
create index if not exists leads_phone_idx on public.leads (phone);

-- Tự cập nhật cột updated_at mỗi khi sửa lead.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 3. Bảo mật (Row Level Security) cho LEADS
--    Chỉ người có tên trong bảng staff mới xem / thêm / sửa được lead.
--    Không ai xoá được lead qua ứng dụng (xoá thì làm trong Dashboard).
-- ---------------------------------------------------------------------
alter table public.leads enable row level security;

drop policy if exists leads_select_staff on public.leads;
create policy leads_select_staff on public.leads
  for select to authenticated
  using (exists (select 1 from public.staff s where s.user_id = (select auth.uid())));

drop policy if exists leads_insert_staff on public.leads;
create policy leads_insert_staff on public.leads
  for insert to authenticated
  with check (exists (select 1 from public.staff s where s.user_id = (select auth.uid())));

drop policy if exists leads_update_staff on public.leads;
create policy leads_update_staff on public.leads
  for update to authenticated
  using (exists (select 1 from public.staff s where s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.staff s where s.user_id = (select auth.uid())));

revoke all on public.leads from anon, authenticated;
grant select, insert, update on public.leads to authenticated;


-- =====================================================================
-- SAU KHI CHẠY FILE NÀY — cấp quyền cho chính bạn:
--
--   1. Tạo tài khoản: Authentication → Users → Add user → Create new user
--      (nhập email + mật khẩu, tick "Auto Confirm User").
--   2. Chạy lệnh dưới đây trong SQL Editor (đổi email và tên cho đúng):
--
--   insert into public.staff (user_id, full_name, role)
--   select id, 'Tên của bạn', 'admin'
--   from auth.users
--   where email = 'email-cua-ban@example.com';
--
-- Thêm nhân viên khác cũng làm 2 bước y như vậy, role là 'lead' hoặc 'sale'.
-- =====================================================================
