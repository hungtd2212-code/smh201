-- =====================================================================
-- Smile Hub ERP — PHÒNG HÀNH CHÍNH NHÂN SỰ: THÊM 2 CHỨC VỤ KHI THÊM NGƯỜI
--
-- Chạy SAU supabase/019_online_presence.sql, và SAU 021_accounting_positions.sql
-- nếu có dùng file đó (chạy trước hay sau file 020 đều được). Chạy lại file này
-- nhiều lần cũng không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì
-- không thay đổi gì.
-- Đã chạy file này thì KHÔNG chạy lại 005, 008, 015, 021 nữa: các file đó đặt
-- lại danh sách vai trò / vị trí theo bản cũ, làm mất 2 chức vụ HCNS. Lỡ chạy
-- thì chạy lại file này là đủ.
--
-- File này KHÔNG xoá và KHÔNG sửa dữ liệu đang có. Quyền của mọi tài khoản
-- đang có giữ nguyên như trước.
--
-- Thêm 2 vị trí ở Cài đặt → Tài khoản & Phân quyền → Thêm người
-- (chủ phòng khám, 13/11/2026):
--   • Trưởng phòng HCNS → vai trò mới Trưởng phòng HCNS (hr_manager)
--   • Nhân viên HCNS    → vai trò mới Nhân viên HCNS    (hr_staff)
-- Các vị trí đã có (kể cả 2 chức vụ Kế toán của file 021, nếu đã chạy) được
-- giữ nguyên: file này đọc danh sách đang có rồi thêm vào, không đặt lại.
--
-- Quyền của 2 vai trò mới — lúc này phân hệ Hành chính Nhân sự chưa có màn
-- hình nào có dữ liệu:
--   • Như mọi tài khoản mới: chưa thấy trang nào cho tới khi được tick trang.
--   • KHÔNG vào được dữ liệu khách hàng và Marketing: lead, lịch sử lead, kiểm
--     tra / thêm số điện thoại, chiến dịch, bài post, kênh, page, dịch vụ &
--     bảng giá, cấu hình, báo cáo quảng cáo — kể cả khi được tick các trang đó.
--   • Không bật "nhận lead" được, nên không bao giờ được chia số.
--   • Vẫn xem được danh sách nhân sự, danh sách cơ sở và ai đang online.
--   • Thêm / khoá / phân quyền tài khoản vẫn chỉ Quản trị làm (như trước).
--
-- Cách chặn: hàm private.is_staff() — cánh cửa chung của mọi dữ liệu khách hàng
-- và Marketing — từ nay không tính 2 vai trò HCNS. Nhờ vậy cả những hàm chỉ hỏi
-- "có phải nhân viên không" (check_lead_phone, intake_lead, và add_lead của
-- file 020) cũng từ chối HCNS. Những thứ HCNS được xem dùng hàm mới
-- private.is_member() = mọi tài khoản đang làm việc, bất kể phòng ban.
-- Về sau làm dữ liệu riêng cho HCNS (hồ sơ nhân viên, chấm công…): dùng
-- is_member() hoặc hàm riêng theo vai trò, không dùng is_staff().
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. VAI TRÒ: thêm Trưởng phòng HCNS, Nhân viên HCNS vào danh sách đang có
-- ---------------------------------------------------------------------
do $$
declare
  v_roles text[];
begin
  -- Danh sách vai trò đang được phép (đọc từ ràng buộc hiện có) + 7 vai trò gốc + 2 vai trò mới.
  select array(
    select distinct r from (
      select m[1] as r
      from pg_catalog.pg_constraint c,
           regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
      where c.conrelid = 'public.staff'::regclass and c.contype = 'c' and c.conname = 'staff_role_check'
      union all
      select unnest(array['super_admin', 'admin', 'marketing_manager', 'ads_staff', 'lead', 'sale', 'page',
                          'hr_manager', 'hr_staff'])
    ) x order by r)
  into v_roles;

  alter table public.staff drop constraint if exists staff_role_check;
  execute format('alter table public.staff add constraint staff_role_check check (role in (%s))',
                 (select string_agg(quote_literal(r), ', ') from unnest(v_roles) r));
end $$;


-- ---------------------------------------------------------------------
-- 2. VỊ TRÍ: thêm 2 vị trí HCNS vào danh sách đang có; vị trí → vai trò
-- ---------------------------------------------------------------------
do $$
declare
  c           record;
  v_positions text[];
  v_cases     text;
begin
  -- Danh sách vị trí đang được phép (đọc từ ràng buộc hiện có) + 6 vị trí gốc + 2 vị trí mới.
  select array(
    select distinct p from (
      select m[1] as p
      from pg_catalog.pg_constraint k,
           regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([a-z_]+)''', 'g') m
      where k.conrelid = 'public.staff'::regclass and k.contype = 'c'
        and pg_catalog.pg_get_constraintdef(k.oid) like '%lead_ads%'
      union all
      select unnest(array['coo', 'lead_ads', 'ads_staff', 'page', 'lead_telesale', 'telesale',
                          'hr_manager', 'hr_staff'])
    ) x order by p)
  into v_positions;

  -- Vị trí → vai trò: 8 dòng của file này, cộng mọi vị trí khác đang dùng được (giữ đúng vai trò đang có).
  with known (p, r) as (
    values ('coo', 'admin'), ('lead_ads', 'marketing_manager'), ('ads_staff', 'ads_staff'), ('page', 'page'),
           ('lead_telesale', 'lead'), ('telesale', 'sale'),
           ('hr_manager', 'hr_manager'), ('hr_staff', 'hr_staff')
  ), merged as (
    select p, r from known
    union all
    select e.p, private.role_of_position(e.p)
    from unnest(v_positions) e (p)
    where e.p not in (select k.p from known k) and private.role_of_position(e.p) is not null
  )
  select string_agg(format('when %L then %L', p, r), ' ' order by p) into v_cases from merged;

  -- Bỏ ràng buộc danh sách vị trí cũ, đặt ràng buộc mới.
  for c in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.staff'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) like '%lead_ads%'
  loop
    execute format('alter table public.staff drop constraint %I', c.conname);
  end loop;
  execute format(
    'alter table public.staff add constraint staff_position_check check (position is null or position in (%s))',
    (select string_agg(quote_literal(p), ', ') from unnest(v_positions) p));

  execute format($f$
    create or replace function private.role_of_position(p_position text)
    returns text language sql immutable set search_path = '' as $body$
      select case p_position %s end;
    $body$
  $f$, v_cases);
end $$;
revoke all on function private.role_of_position(text) from public;


-- ---------------------------------------------------------------------
-- 3. AI LÀ "NHÂN VIÊN" KHI XÉT QUYỀN
-- ---------------------------------------------------------------------
-- Mọi tài khoản đang làm việc (có tên trong danh sách nhân sự, không bị khoá), bất kể phòng ban.
create or replace function private.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null);
$$;
revoke all on function private.is_member() from public;
grant execute on function private.is_member() to authenticated;

-- Nhân viên khối khách hàng – kinh doanh: như trước, trừ 2 vai trò Hành chính Nhân sự.
-- (Tài khoản bị khoá vẫn coi như không còn là nhân viên.)
create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null
      and s.role not in ('hr_manager', 'hr_staff'));
$$;


-- ---------------------------------------------------------------------
-- 4. NHỮNG THỨ MỌI TÀI KHOẢN ĐANG LÀM VIỆC ĐỀU XEM ĐƯỢC (kể cả HCNS)
--    Với các tài khoản đang có thì không đổi gì: is_member() đúng bằng is_staff() cũ.
-- ---------------------------------------------------------------------
-- Danh sách nhân sự và danh sách cơ sở.
alter policy staff_select_staff on public.staff using ((select private.is_member()));
alter policy branches_select on public.branches using ((select private.is_member()));

-- Ai đang online (file 019). Bỏ qua khi chạy thử ngoài Supabase (không có Realtime).
do $$
begin
  if to_regclass('realtime.messages') is null then
    return;
  end if;
  if exists (select 1 from pg_policies
             where schemaname = 'realtime' and tablename = 'messages' and policyname = 'smh_online_read') then
    execute $p$
      alter policy smh_online_read on realtime.messages
        using (extension = 'presence' and (select realtime.topic()) = 'smh-online' and (select private.is_member()))$p$;
  end if;
  if exists (select 1 from pg_policies
             where schemaname = 'realtime' and tablename = 'messages' and policyname = 'smh_online_track') then
    execute $p$
      alter policy smh_online_track on realtime.messages
        with check (extension = 'presence' and (select realtime.topic()) = 'smh-online' and (select private.is_member()))$p$;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 5. HCNS KHÔNG NẰM TRONG VÒNG CHIA LEAD
--    (số chia cho người không xem được lead là mất số)
-- ---------------------------------------------------------------------
alter table public.staff drop constraint if exists staff_hr_no_leads_check;
alter table public.staff add constraint staff_hr_no_leads_check
  check (not (accepts_leads and role in ('hr_manager', 'hr_staff')));

commit;
