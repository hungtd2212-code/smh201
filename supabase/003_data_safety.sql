-- =====================================================================
-- Smile Hub ERP — SAO LƯU & KHÔI PHỤC DỮ LIỆU (lớp 1 và lớp 2)
--
-- Chạy SAU supabase/002_marketing_lead.sql. Chạy lại file này nhiều lần cũng
-- không sao. Toàn bộ nằm trong một giao dịch: lỗi ở đâu thì không thay đổi gì.
-- LƯU Ý: sau khi đã chạy file này thì KHÔNG chạy lại schema.sql và 002 nữa
-- (hai file đó sẽ ghi đè các hàm phân quyền bằng bản cũ).
--
-- Lớp 1 — Không ai xoá được dữ liệu: ứng dụng không có quyền DELETE trên bảng
--          nào chứa lead; số điện thoại đã thêm thì không sửa hay gỡ được;
--          Lead (trưởng nhóm) trở lên chỉ CHUYỂN VÀO THÙNG RÁC (deleted_at /
--          deleted_by); xoá vĩnh viễn chỉ dành cho Quản trị cấp cao
--          (super_admin), sau tối thiểu 90 ngày nằm trong thùng rác.
-- Lớp 2 — Nhật ký thay đổi: trigger ghi mọi thêm / sửa / xoá (giá trị cũ, mới,
--          ai, lúc nào, từ IP nào); hoàn tác một bản ghi hoặc theo lô;
--          cảnh báo bất thường và tự khoá tài khoản.
-- Kèm:   bảng backup_runs cho trang theo dõi sao lưu (lớp 3, 4 làm sau);
--          bản sửa nhỏ "mở lại lead không xoá dấu số sai của lần dán cũ".
-- =====================================================================
begin;


-- ---------------------------------------------------------------------
-- 0. VAI TRÒ VÀ KHOÁ TÀI KHOẢN
--    super_admin = Quản trị cấp cao (chủ phòng khám): được xoá vĩnh viễn,
--    đổi các ngưỡng an toàn, khoá / mở khoá cả tài khoản quản trị.
-- ---------------------------------------------------------------------
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('super_admin', 'admin', 'lead', 'sale', 'page'));

alter table public.staff
  add column if not exists locked_at     timestamptz,   -- khác null = tài khoản đang bị khoá
  add column if not exists locked_reason text;

-- Chưa có Quản trị cấp cao nào → nâng tài khoản Quản trị được tạo sớm nhất.
update public.staff s
set role = 'super_admin'
where not exists (select 1 from public.staff x where x.role = 'super_admin')
  and s.user_id = (
    select x.user_id from public.staff x where x.role = 'admin' order by x.created_at limit 1);

-- Tài khoản bị khoá coi như không còn là nhân viên: mọi quyền đọc / ghi đều mất.
create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null);
$$;

-- Quản lý = Quản trị cấp cao, Quản trị hoặc Lead.
create or replace function private.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null
      and s.role in ('super_admin', 'admin', 'lead'));
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null
      and s.role in ('super_admin', 'admin'));
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.locked_at is null
      and s.role = 'super_admin');
$$;

-- Người dùng vừa nhập lại mật khẩu trong vòng p_seconds giây?
-- (Ứng dụng đăng nhập lại bằng mật khẩu; Supabase ghi thời điểm đó vào mục "amr" của phiên.)
create or replace function private.password_confirmed_recently(p_seconds int default 300)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
    where e ->> 'method' = 'password'
      and (e ->> 'timestamp') ~ '^[0-9]{1,12}$'
      and (e ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - p_seconds);
$$;

-- Đọc cấu hình; giá trị sai định dạng thì dùng mặc định (không bao giờ báo lỗi).
create or replace function private.setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when (s.value #>> '{}') ~ '^[0-9]{1,9}$' then (s.value #>> '{}')::int end
     from public.app_settings s where s.key = p_key),
    p_default);
$$;

create or replace function private.setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case lower(s.value #>> '{}') when 'true' then true when 'false' then false end
     from public.app_settings s where s.key = p_key),
    p_default);
$$;

-- Cột khoá chính của từng bảng được ghi nhật ký.
create or replace function private.pk_col(p_table text)
returns text language sql immutable set search_path = '' as $$
  select case p_table when 'staff' then 'user_id' when 'app_settings' then 'key' else 'id' end;
$$;

-- Bảng có Thùng rác (xoá mềm) và bảng được phép hoàn tác.
create or replace function private.soft_delete_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['leads', 'channels', 'services', 'pages', 'campaigns'];
$$;

create or replace function private.undoable_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['leads', 'channels', 'services', 'pages', 'campaigns', 'staff_shifts'];
$$;

-- Cột không bao giờ hoàn tác (do hệ thống tự tính).
create or replace function private.undo_excluded(p_table text)
returns text[] language sql immutable set search_path = '' as $$
  select array['id', 'created_at', 'created_by', 'updated_at']
      || case p_table when 'leads' then array['touch_count', 'last_touch_at'] else array[]::text[] end;
$$;

revoke all on function private.is_staff() from public;
revoke all on function private.is_manager() from public;
revoke all on function private.is_admin() from public;
revoke all on function private.is_super_admin() from public;
revoke all on function private.password_confirmed_recently(int) from public;
revoke all on function private.setting_int(text, int) from public;
revoke all on function private.setting_bool(text, boolean) from public;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.is_manager() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_super_admin() to authenticated;


-- ---------------------------------------------------------------------
-- 1. LỚP 1 — XOÁ MỀM
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array private.soft_delete_tables() loop
    execute format(
      'alter table public.%I
         add column if not exists deleted_at timestamptz,
         add column if not exists deleted_by uuid references auth.users (id) on delete set null', t);
    execute format(
      'create index if not exists %I on public.%I (deleted_at) where deleted_at is not null',
      t || '_deleted_idx', t);
  end loop;
end $$;

-- "Không trùng tên / trùng số" chỉ áp dụng cho bản ghi chưa xoá: xoá một lead rồi
-- dán lại số đó thì tạo lead mới; bản trong thùng rác vẫn nằm yên.
alter table public.channels drop constraint if exists channels_name_key;
create unique index if not exists channels_name_live_key
  on public.channels (name) where deleted_at is null;

alter table public.services drop constraint if exists services_name_key;
create unique index if not exists services_name_live_key
  on public.services (name) where deleted_at is null;

alter table public.pages drop constraint if exists pages_channel_id_name_key;
create unique index if not exists pages_channel_name_live_key
  on public.pages (channel_id, name) where deleted_at is null;

drop index if exists public.leads_phone_key;
create unique index if not exists leads_phone_live_key
  on public.leads (phone) where deleted_at is null;

-- Không ai tự sửa deleted_at / deleted_by qua ứng dụng: xoá và khôi phục phải đi
-- qua các hàm bên dưới (nơi kiểm tra quyền, mật khẩu và ghi nhật ký).
create or replace function private.guard_soft_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null
     or coalesce(current_setting('app.soft_delete', true), '') = 'on' then
    return new;   -- thao tác trực tiếp trong Supabase, hoặc đang ở trong hàm xoá / khôi phục
  end if;
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.deleted_by is not null then
      raise exception 'Không được tạo bản ghi nằm sẵn trong thùng rác' using errcode = '42501';
    end if;
  elsif new.deleted_at is distinct from old.deleted_at
     or new.deleted_by is distinct from old.deleted_by then
    raise exception 'Chuyển vào thùng rác / khôi phục phải thực hiện bằng nút trong ứng dụng' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array private.soft_delete_tables() loop
    execute format(
      'create or replace trigger guard_soft_delete
         before insert or update on public.%I
         for each row execute function private.guard_soft_delete()', t);
  end loop;
end $$;

-- SỐ ĐIỆN THOẠI ĐÃ THÊM THÌ KHÔNG AI SỬA HAY GỠ ĐƯỢC qua ứng dụng, trừ Quản trị cấp cao.
-- (Form trong ứng dụng vốn không có ô sửa số; đây là chốt chặn ở tầng cơ sở dữ liệu, phòng khi
-- có người gọi thẳng API.) Số sai thì telesale đánh dấu "Số sai", không sửa đè lên.
-- Hoàn tác (apply_patch) được đi qua, vì nó chỉ trả lead về đúng số đã có trước đó.
create or replace function private.guard_lead_phone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null
     or coalesce(current_setting('app.soft_delete', true), '') = 'on'
     or private.is_super_admin() then
    return new;
  end if;
  raise exception 'Số điện thoại đã thêm thì không sửa hay gỡ được. Nếu số sai, hãy đánh dấu "Số sai".'
    using errcode = '42501';
end;
$$;

create or replace trigger guard_lead_phone
  before update on public.leads
  for each row when (new.phone is distinct from old.phone)
  execute function private.guard_lead_phone();

-- LEADS: nhân viên chỉ thấy và sửa lead chưa xoá; Quản trị thấy cả lead trong thùng rác.
drop policy if exists leads_select_staff on public.leads;
create policy leads_select_staff on public.leads
  for select to authenticated
  using ((select private.is_staff()) and (deleted_at is null or (select private.is_admin())));

drop policy if exists leads_update_staff on public.leads;
create policy leads_update_staff on public.leads
  for update to authenticated
  using ((select private.is_staff()) and deleted_at is null)
  with check ((select private.is_staff()));

-- DANH MỤC: bản đã xoá vẫn đọc được (để lead cũ còn hiện đúng tên nguồn) nhưng không sửa được.
do $$
declare t text;
begin
  foreach t in array array['channels', 'services', 'pages', 'campaigns'] loop
    execute format('drop policy if exists %I on public.%I', t || '_update_manager', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using ((select private.is_manager()) and deleted_at is null)
         with check ((select private.is_manager()))', t || '_update_manager', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 2. LỚP 2 — NHẬT KÝ THAY ĐỔI
--    Mỗi dòng = một lần thêm / sửa / xoá trên một bản ghi.
--    old_data / new_data chỉ chứa các cột bị đổi (riêng "purge" giữ nguyên cả
--    bản ghi cũ để còn cứu được sau khi xoá vĩnh viễn).
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default clock_timestamp(),
  txid       bigint not null default txid_current(),   -- cùng txid = cùng một thao tác
  actor_id   uuid,                                     -- null = làm trực tiếp trong Supabase / hệ thống
  ip         text,
  table_name text not null,
  record_id  text not null,
  action     text not null check (action in ('insert', 'update', 'delete', 'restore', 'purge')),
  old_data   jsonb,
  new_data   jsonb,
  note       text                                      -- vd "Hoàn tác về phiên bản #12"
);
create index if not exists audit_log_record_idx on public.audit_log (table_name, record_id, id desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

alter table public.audit_log enable row level security;
-- Quản trị xem toàn bộ; nhân viên xem lịch sử của những lead mình nhìn thấy.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    (select private.is_admin())
    or case
         when table_name = 'leads' and (select private.is_staff())
           then exists (select 1 from public.leads l where l.id = audit_log.record_id::uuid)
         else false
       end
  );
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;   -- ghi chỉ do trigger thực hiện

-- Cảnh báo bất thường (một tài khoản sửa / xoá quá nhiều bản ghi trong 1 giờ).
create table if not exists public.security_alerts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null,
  kind        text not null,
  details     jsonb not null default '{}'::jsonb,
  locked      boolean not null default false,          -- hệ thống đã tự khoá tài khoản
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists security_alerts_open_idx
  on public.security_alerts (created_at desc) where resolved_at is null;

alter table public.security_alerts enable row level security;
drop policy if exists security_alerts_select_admin on public.security_alerts;
create policy security_alerts_select_admin on public.security_alerts
  for select to authenticated using ((select private.is_admin()));
revoke all on public.security_alerts from anon, authenticated;
grant select on public.security_alerts to authenticated;

-- Đếm số bản ghi một tài khoản đã sửa / xoá trong 1 giờ qua; vượt ngưỡng thì
-- báo quản trị và (nếu bật) tự khoá tài khoản. Không bao giờ tự khoá Quản trị cấp cao.
create or replace function private.check_anomaly(p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_limit int := private.setting_int('anomaly_max_changes_per_hour', 150);
  v_count int;
  v_role  text;
  v_lock  boolean;
  v_note  text;
begin
  if v_limit <= 0 then return; end if;   -- 0 = tắt cảnh báo

  select count(distinct a.table_name || ':' || a.record_id) into v_count
  from public.audit_log a
  where a.actor_id = p_actor
    and a.at > clock_timestamp() - interval '1 hour'
    and a.action in ('update', 'delete', 'purge')
    and a.note is null;                  -- không tính các lần hoàn tác
  if v_count <= v_limit then return; end if;

  if exists (
    select 1 from public.security_alerts s
    where s.user_id = p_actor and s.resolved_at is null
      and s.created_at > now() - interval '1 hour') then
    return;                              -- đã báo rồi
  end if;

  select s.role into v_role from public.staff s where s.user_id = p_actor;
  v_lock := private.setting_bool('anomaly_auto_lock', true)
            and v_role is not null and v_role <> 'super_admin';

  insert into public.security_alerts (user_id, kind, details, locked)
  values (p_actor, 'too_many_changes', jsonb_build_object('count', v_count, 'limit', v_limit), v_lock);

  if v_lock then
    v_note := current_setting('app.audit_note', true);
    perform set_config('app.audit_note', 'Hệ thống tự khoá tài khoản', true);
    update public.staff
    set locked_at = now(),
        locked_reason = format('Tự khoá: sửa / xoá %s bản ghi trong 1 giờ (ngưỡng %s)', v_count, v_limit),
        accepts_leads = false
    where user_id = p_actor and locked_at is null;
    perform set_config('app.audit_note', coalesce(v_note, ''), true);
  end if;
end;
$$;
revoke all on function private.check_anomaly(uuid) from public;

-- Trigger ghi nhật ký. Tham số: [0] tên cột khoá chính, [1] các cột bỏ qua (cách nhau dấu phẩy).
create or replace function private.audit_row()
returns trigger language plpgsql security definer
set search_path = '' set timezone = 'UTC' as $$
declare
  v_pk      text   := tg_argv[0];
  v_ignore  text[] := string_to_array(coalesce(tg_argv[1], ''), ',');
  v_actor   uuid   := (select auth.uid());
  v_note    text   := nullif(current_setting('app.audit_note', true), '');
  v_headers jsonb  := nullif(current_setting('request.headers', true), '')::jsonb;
  v_old     jsonb;
  v_new     jsonb;
  v_before  jsonb;
  v_after   jsonb;
  v_action  text;
  v_id      text;
begin
  if tg_op = 'INSERT' then
    v_action := 'insert';
    v_id := to_jsonb(new) ->> v_pk;
  elsif tg_op = 'DELETE' then
    v_action := 'purge';
    v_before := to_jsonb(old);
    v_id := v_before ->> v_pk;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_id := v_new ->> v_pk;
    select jsonb_object_agg(n.key, v_old -> n.key), jsonb_object_agg(n.key, n.value)
      into v_before, v_after
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key) and n.key <> all (v_ignore);
    if v_after is null then
      return null;                       -- không có gì đổi (hoặc chỉ đổi cột bỏ qua)
    end if;
    v_action := case
      when (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then 'delete'
      when (v_old ->> 'deleted_at') is not null and (v_new ->> 'deleted_at') is null then 'restore'
      else 'update'
    end;
  end if;

  insert into public.audit_log (actor_id, ip, table_name, record_id, action, old_data, new_data, note)
  values (
    v_actor,
    coalesce(
      v_headers ->> 'cf-connecting-ip',
      v_headers ->> 'x-real-ip',
      nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '')),
    tg_table_name, v_id, v_action, v_before, v_after, v_note);

  if v_actor is not null and v_note is null and v_action in ('update', 'delete', 'purge') then
    perform private.check_anomaly(v_actor);
  end if;
  return null;
end;
$$;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('leads',        'id',      'updated_at'),
      ('channels',     'id',      ''),
      ('services',     'id',      ''),
      ('pages',        'id',      ''),
      ('campaigns',    'id',      ''),
      ('staff_shifts', 'id',      ''),
      ('staff',        'user_id', 'last_assigned_at'),   -- lượt xoay vòng đổi liên tục, không ghi
      ('app_settings', 'key',     'updated_at')
    ) as t (tbl, pk, ignored)
  loop
    execute format(
      'create or replace trigger zz_audit
         after insert or update or delete on public.%I
         for each row execute function private.audit_row(%L, %L)', r.tbl, r.pk, r.ignored);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 3. XOÁ, KHÔI PHỤC, XOÁ VĨNH VIỄN
-- ---------------------------------------------------------------------

-- Chuyển bản ghi vào Thùng rác. Quản trị và Lead được xoá; telesale, trực page thì không.
-- Xoá quá 20 bản ghi (tính cả những lần xoá trong 10 phút vừa qua) phải nhập lại mật khẩu.
create or replace function public.soft_delete_records(p_table text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_n      int  := coalesce(cardinality(p_ids), 0);
  v_recent int;
  v_done   int;
begin
  if p_table is null or p_table <> all (private.soft_delete_tables()) then
    raise exception 'Loại dữ liệu này không có thùng rác' using errcode = '22023';
  end if;
  if not private.is_manager() then
    raise exception 'Bạn không có quyền chuyển vào thùng rác (cần vai trò Quản trị hoặc Lead)' using errcode = '42501';
  end if;
  if v_n = 0 then
    return jsonb_build_object('deleted', 0);
  end if;
  if v_n > 1000 then
    raise exception 'Mỗi lần chỉ chuyển được tối đa 1000 bản ghi vào thùng rác' using errcode = '22023';
  end if;

  select count(*) into v_recent
  from public.audit_log a
  where a.actor_id = v_uid and a.action = 'delete' and a.at > now() - interval '10 minutes';
  if v_n + v_recent > private.setting_int('bulk_delete_confirm_over', 20)
     and not private.password_confirmed_recently() then
    raise exception 'PASSWORD_REQUIRED'
      using errcode = 'P0001', hint = 'Xoá nhiều bản ghi cần nhập lại mật khẩu để xác nhận';
  end if;

  if p_table = 'channels' and exists (
       select 1 from public.pages p where p.channel_id = any (p_ids) and p.deleted_at is null) then
    raise exception 'Kênh còn page đang dùng — hãy chuyển các page của kênh vào thùng rác trước' using errcode = '23503';
  end if;
  if p_table = 'channels' and exists (
       select 1 from public.campaigns c where c.channel_id = any (p_ids) and c.deleted_at is null) then
    raise exception 'Kênh còn chiến dịch — hãy chuyển các chiến dịch của kênh vào thùng rác trước' using errcode = '23503';
  end if;
  if p_table = 'pages' and exists (
       select 1 from public.campaigns c where c.page_id = any (p_ids) and c.deleted_at is null) then
    raise exception 'Page còn chiến dịch — hãy chuyển các chiến dịch của page vào thùng rác trước' using errcode = '23503';
  end if;

  perform set_config('app.soft_delete', 'on', true);
  execute format(
    'update public.%I set deleted_at = now(), deleted_by = $1 where id = any ($2) and deleted_at is null',
    p_table) using v_uid, p_ids;
  get diagnostics v_done = row_count;
  perform set_config('app.soft_delete', 'off', true);

  return jsonb_build_object('deleted', v_done);
end;
$$;

-- Khôi phục từ Thùng rác (chỉ Quản trị). Trả về số đã khôi phục, số bị trùng
-- (đã có bản ghi khác cùng số / cùng tên) và số bị chặn (bản ghi cha còn trong thùng rác).
create or replace function public.restore_records(p_table text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id        uuid;
  v_n         int;
  v_restored  int := 0;
  v_conflicts int := 0;
  v_blocked   int := 0;
begin
  if p_table is null or p_table <> all (private.soft_delete_tables()) then
    raise exception 'Loại dữ liệu này không có thùng rác' using errcode = '22023';
  end if;
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị được khôi phục dữ liệu' using errcode = '42501';
  end if;

  perform set_config('app.soft_delete', 'on', true);
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    if p_table = 'pages' and exists (
         select 1 from public.pages p join public.channels c on c.id = p.channel_id
         where p.id = v_id and c.deleted_at is not null) then
      v_blocked := v_blocked + 1;
      continue;
    end if;
    if p_table = 'campaigns' and exists (
         select 1 from public.campaigns x
         join public.channels c on c.id = x.channel_id
         left join public.pages p on p.id = x.page_id
         where x.id = v_id and (c.deleted_at is not null or p.deleted_at is not null)) then
      v_blocked := v_blocked + 1;
      continue;
    end if;

    begin
      execute format(
        'update public.%I set deleted_at = null, deleted_by = null where id = $1 and deleted_at is not null',
        p_table) using v_id;
      get diagnostics v_n = row_count;
      v_restored := v_restored + v_n;
    exception when unique_violation then
      v_conflicts := v_conflicts + 1;
    end;
  end loop;
  perform set_config('app.soft_delete', 'off', true);

  return jsonb_build_object('restored', v_restored, 'conflicts', v_conflicts, 'blocked', v_blocked);
end;
$$;

-- Xoá vĩnh viễn: chỉ Quản trị cấp cao, luôn phải nhập lại mật khẩu, và chỉ với
-- bản ghi đã nằm trong thùng rác đủ số ngày tối thiểu (mặc định 90).
create or replace function public.purge_records(p_table text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_days  int := private.setting_int('trash_min_days', 90);
  v_early int;
  v_done  int;
begin
  if p_table is null or p_table <> all (private.soft_delete_tables()) then
    raise exception 'Loại dữ liệu này không có thùng rác' using errcode = '22023';
  end if;
  if not private.is_super_admin() then
    raise exception 'Chỉ Quản trị cấp cao được xoá vĩnh viễn' using errcode = '42501';
  end if;
  if not private.password_confirmed_recently() then
    raise exception 'PASSWORD_REQUIRED'
      using errcode = 'P0001', hint = 'Xoá vĩnh viễn cần nhập lại mật khẩu để xác nhận';
  end if;

  execute format(
    'select count(*) from public.%I
     where id = any ($1) and deleted_at is not null and deleted_at > now() - make_interval(days => $2)',
    p_table) into v_early using p_ids, v_days;
  if v_early > 0 then
    raise exception 'Có % bản ghi nằm trong thùng rác chưa đủ % ngày nên chưa được xoá vĩnh viễn', v_early, v_days
      using errcode = '22023';
  end if;

  begin
    execute format('delete from public.%I where id = any ($1) and deleted_at is not null', p_table)
      using p_ids;
    get diagnostics v_done = row_count;
  exception when foreign_key_violation then
    raise exception 'Không xoá vĩnh viễn được: còn dữ liệu khác đang dùng bản ghi này' using errcode = '23503';
  end;

  return jsonb_build_object('purged', v_done);
end;
$$;

-- Thùng rác: một danh sách chung cho mọi loại dữ liệu (chỉ Quản trị thấy).
create or replace view public.trash_items with (security_invoker = true) as
  select 'leads'::text as table_name, l.id, l.full_name || ' · ' || l.phone as label, l.deleted_at, l.deleted_by
  from public.leads l where l.deleted_at is not null and (select private.is_admin())
  union all
  select 'channels', c.id, c.name, c.deleted_at, c.deleted_by
  from public.channels c where c.deleted_at is not null and (select private.is_admin())
  union all
  select 'pages', p.id, p.name, p.deleted_at, p.deleted_by
  from public.pages p where p.deleted_at is not null and (select private.is_admin())
  union all
  select 'campaigns', g.id, g.name, g.deleted_at, g.deleted_by
  from public.campaigns g where g.deleted_at is not null and (select private.is_admin())
  union all
  select 'services', s.id, s.name, s.deleted_at, s.deleted_by
  from public.services s where s.deleted_at is not null and (select private.is_admin());
revoke all on public.trash_items from anon, authenticated;
grant select on public.trash_items to authenticated;


-- ---------------------------------------------------------------------
-- 4. HOÀN TÁC
-- ---------------------------------------------------------------------

-- Ghi một nhóm cột (dạng jsonb) vào một bản ghi. Trả về số cột đã ghi.
create or replace function private.apply_patch(p_table text, p_record_id text, p_patch jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_cols text;
  v_n    int;
begin
  select string_agg(quote_ident(k.key), ', '), count(*) into v_cols, v_n
  from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as k (key)
  where exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = p_table and c.column_name = k.key);
  if v_cols is null then
    return 0;
  end if;

  perform set_config('app.soft_delete', 'on', true);
  execute format(
    'update public.%1$I t set (%2$s) = (select %2$s from jsonb_populate_record(null::public.%1$I, $1))
     where t.%3$I::text = $2',
    p_table, v_cols, private.pk_col(p_table)) using p_patch, p_record_id;
  perform set_config('app.soft_delete', 'off', true);
  return v_n;
end;
$$;
revoke all on function private.apply_patch(text, text, jsonb) from public;

-- "Hoàn tác về phiên bản này": đưa bản ghi về đúng trạng thái ngay sau dòng nhật ký p_audit_id
-- (tức là gỡ mọi thay đổi xảy ra sau đó). Quản trị làm được với mọi bảng; Lead chỉ với lead.
create or replace function public.revert_record_to_version(p_audit_id bigint)
returns jsonb language plpgsql security definer
set search_path = '' set timezone = 'UTC' as $$
declare
  e       public.audit_log%rowtype;
  v_cur   jsonb;
  v_patch jsonb;
  v_n     int;
begin
  if not private.is_manager() then
    raise exception 'Bạn không có quyền hoàn tác' using errcode = '42501';
  end if;
  select * into e from public.audit_log where id = p_audit_id;
  if not found then
    raise exception 'Không tìm thấy phiên bản này' using errcode = '22023';
  end if;
  if e.table_name <> all (private.undoable_tables()) then
    raise exception 'Loại dữ liệu này không hỗ trợ hoàn tác' using errcode = '22023';
  end if;
  if e.table_name <> 'leads' and not private.is_admin() then
    raise exception 'Chỉ Quản trị được hoàn tác dữ liệu này' using errcode = '42501';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1',
    e.table_name, private.pk_col(e.table_name)) into v_cur using e.record_id;
  if v_cur is null then
    raise exception 'Bản ghi không còn tồn tại (đã bị xoá vĩnh viễn)' using errcode = '22023';
  end if;
  if (v_cur ->> 'deleted_at') is not null then
    raise exception 'Bản ghi đang nằm trong Thùng rác — hãy khôi phục trước' using errcode = '22023';
  end if;

  -- Với mỗi cột bị đổi sau phiên bản này: lấy giá trị của nó ngay trước lần đổi đầu tiên.
  select jsonb_object_agg(x.key, x.value) into v_patch
  from (
    select distinct on (d.key) d.key, d.value
    from public.audit_log a, jsonb_each(a.old_data) d
    where a.table_name = e.table_name and a.record_id = e.record_id
      and a.id > e.id and a.action in ('update', 'delete', 'restore')
    order by d.key, a.id
  ) x
  where x.key <> all (private.undo_excluded(e.table_name) || array['deleted_at', 'deleted_by'])
    and x.value is distinct from (v_cur -> x.key);

  if v_patch is null then
    return jsonb_build_object('columns', 0);
  end if;

  perform set_config('app.audit_note', format('Hoàn tác về phiên bản #%s', e.id), true);
  begin
    v_n := private.apply_patch(e.table_name, e.record_id, v_patch);
  exception when unique_violation then
    raise exception 'Không hoàn tác được: đã có bản ghi khác đang dùng cùng số điện thoại / cùng tên'
      using errcode = '23505';
  end;
  return jsonb_build_object('columns', v_n);
end;
$$;

-- "Hoàn tác theo lô": gỡ mọi thay đổi của một tài khoản trong một khoảng thời gian.
--   • Bản ghi tài khoản đó TẠO trong khoảng này → chuyển vào thùng rác.
--   • Cột tài khoản đó ĐÃ SỬA (kể cả xoá) → trả về giá trị trước khi sửa, trừ khi
--     sau đó có người khác sửa tiếp cột ấy (tính là "xung đột", giữ nguyên).
-- p_apply = false: chỉ đếm xem sẽ hoàn tác những gì (xem trước), không đổi dữ liệu.
create or replace function public.undo_changes(
  p_actor uuid, p_from timestamptz, p_to timestamptz, p_apply boolean default false)
returns jsonb language plpgsql security definer
set search_path = '' set timezone = 'UTC' as $$
declare
  r           record;
  k           record;
  v_cur       jsonb;
  v_patch     jsonb;
  v_name      text;
  v_records   int := 0;
  v_columns   int := 0;
  v_conflicts int := 0;
  v_trashed   int := 0;
  v_gone      int := 0;
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị được hoàn tác theo lô' using errcode = '42501';
  end if;
  if p_actor is null or p_from is null or p_to is null or p_to <= p_from then
    raise exception 'Chọn tài khoản và khoảng thời gian hợp lệ' using errcode = '22023';
  end if;
  if p_to - p_from > interval '31 days' then
    raise exception 'Mỗi lần chỉ hoàn tác trong khoảng tối đa 31 ngày' using errcode = '22023';
  end if;

  if p_apply then
    select s.full_name into v_name from public.staff s where s.user_id = p_actor;
    perform set_config('app.audit_note',
      format('Hoàn tác theo lô: thay đổi của %s từ %s đến %s (giờ Việt Nam)',
        coalesce(v_name, p_actor::text),
        to_char(p_from at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'),
        to_char(p_to at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')), true);
  end if;

  for r in
    select a.table_name, a.record_id, bool_or(a.action = 'insert') as created
    from public.audit_log a
    where a.actor_id = p_actor and a.at >= p_from and a.at < p_to
      and a.table_name = any (private.undoable_tables())
      and a.action in ('insert', 'update', 'delete', 'restore')
    group by a.table_name, a.record_id
  loop
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1',
      r.table_name, private.pk_col(r.table_name)) into v_cur using r.record_id;
    if v_cur is null then
      v_gone := v_gone + 1;              -- đã bị xoá vĩnh viễn
      continue;
    end if;

    if r.created then
      if r.table_name = any (private.soft_delete_tables()) and (v_cur ->> 'deleted_at') is null then
        v_trashed := v_trashed + 1;
        if p_apply then
          perform private.apply_patch(r.table_name, r.record_id,
            jsonb_build_object('deleted_at', now(), 'deleted_by', (select auth.uid())));
        end if;
      end if;
      continue;
    end if;

    v_patch := '{}'::jsonb;
    for k in
      select c.key,
        (select d.value from public.audit_log a, jsonb_each(a.old_data) d
         where a.actor_id = p_actor and a.at >= p_from and a.at < p_to
           and a.table_name = r.table_name and a.record_id = r.record_id
           and a.action in ('update', 'delete', 'restore') and d.key = c.key
         order by a.id limit 1) as first_old,
        (select d.value from public.audit_log a, jsonb_each(a.new_data) d
         where a.actor_id = p_actor and a.at >= p_from and a.at < p_to
           and a.table_name = r.table_name and a.record_id = r.record_id
           and a.action in ('update', 'delete', 'restore') and d.key = c.key
         order by a.id desc limit 1) as last_new
      from (
        select distinct d.key
        from public.audit_log a, jsonb_each(a.new_data) d
        where a.actor_id = p_actor and a.at >= p_from and a.at < p_to
          and a.table_name = r.table_name and a.record_id = r.record_id
          and a.action in ('update', 'delete', 'restore')
      ) c
      where c.key <> all (private.undo_excluded(r.table_name))
    loop
      if (v_cur -> k.key) is not distinct from k.first_old then
        continue;                         -- đã về giá trị cũ rồi
      end if;
      if (v_cur -> k.key) is distinct from k.last_new then
        v_conflicts := v_conflicts + 1;   -- người khác đã sửa tiếp cột này
        continue;
      end if;
      v_patch := v_patch || jsonb_build_object(k.key, k.first_old);
    end loop;

    if v_patch <> '{}'::jsonb then
      if p_apply then
        begin
          perform private.apply_patch(r.table_name, r.record_id, v_patch);
        exception when unique_violation then
          v_conflicts := v_conflicts + 1;  -- vd số điện thoại cũ nay đã thuộc lead khác
          continue;
        end;
      end if;
      v_records := v_records + 1;
      v_columns := v_columns + (select count(*)::int from jsonb_object_keys(v_patch));
    end if;
  end loop;

  return jsonb_build_object(
    'applied', p_apply, 'records', v_records, 'columns', v_columns,
    'trashed', v_trashed, 'conflicts', v_conflicts, 'gone', v_gone);
end;
$$;


-- ---------------------------------------------------------------------
-- 5. KHOÁ / MỞ KHOÁ TÀI KHOẢN, XỬ LÝ CẢNH BÁO
-- ---------------------------------------------------------------------
-- Quản trị khoá / mở khoá Lead, Telesale, Trực page. Tài khoản quản trị thì chỉ
-- Quản trị cấp cao khoá / mở được. Không ai tự khoá / mở khoá chính mình.
create or replace function public.set_staff_lock(p_user_id uuid, p_locked boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị được khoá / mở khoá tài khoản' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'Không tự khoá / mở khoá chính mình' using errcode = '22023';
  end if;
  select s.role into v_role from public.staff s where s.user_id = p_user_id;
  if v_role is null then
    raise exception 'Không tìm thấy tài khoản' using errcode = '22023';
  end if;
  if v_role in ('super_admin', 'admin') and not private.is_super_admin() then
    raise exception 'Chỉ Quản trị cấp cao được khoá / mở khoá tài khoản quản trị' using errcode = '42501';
  end if;

  update public.staff
  set locked_at     = case when p_locked then coalesce(locked_at, now()) end,
      locked_reason = case when p_locked then coalesce(nullif(btrim(p_reason), ''), locked_reason, 'Quản trị khoá') end,
      accepts_leads = case when p_locked then false else accepts_leads end
  where user_id = p_user_id;
end;
$$;

-- Đánh dấu một cảnh báo là đã xử lý; p_unlock = true thì mở khoá luôn tài khoản đó.
create or replace function public.resolve_security_alert(p_id uuid, p_unlock boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị được xử lý cảnh báo' using errcode = '42501';
  end if;
  update public.security_alerts
  set resolved_at = now(), resolved_by = (select auth.uid())
  where id = p_id and resolved_at is null
  returning user_id into v_user;
  if p_unlock and v_user is not null then
    perform public.set_staff_lock(v_user, false);
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. THEO DÕI SAO LƯU (dùng cho trang Cài đặt → Sao lưu & Khôi phục)
--    Tác vụ sao lưu hằng đêm (lớp 4) sẽ ghi một dòng sau mỗi lần chạy.
--    kind: database = sao lưu cơ sở dữ liệu · storage = sao lưu file ·
--          restore_test = lần chạy thử khôi phục định kỳ
-- ---------------------------------------------------------------------
create table if not exists public.backup_runs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('database', 'storage', 'restore_test')),
  status      text not null check (status in ('success', 'failed')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  size_bytes  bigint,
  location    text,          -- nơi lưu bản sao
  detail      text,          -- ghi chú hoặc thông báo lỗi
  created_by  uuid
);
create index if not exists backup_runs_kind_idx on public.backup_runs (kind, started_at desc);

alter table public.backup_runs enable row level security;
drop policy if exists backup_runs_select_admin on public.backup_runs;
create policy backup_runs_select_admin on public.backup_runs
  for select to authenticated using ((select private.is_admin()));
revoke all on public.backup_runs from anon, authenticated;
grant select on public.backup_runs to authenticated;

-- Quản trị ghi nhận một lần chạy thử khôi phục (kiểm tra định kỳ mỗi quý).
create or replace function public.log_restore_test(p_success boolean, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị được ghi nhận lần chạy thử khôi phục' using errcode = '42501';
  end if;
  insert into public.backup_runs (kind, status, finished_at, detail, created_by)
  values ('restore_test', case when p_success then 'success' else 'failed' end, now(),
          nullif(btrim(coalesce(p_detail, '')), ''), (select auth.uid()));
end;
$$;


-- ---------------------------------------------------------------------
-- 7. CẤU HÌNH AN TOÀN
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('trash_min_days', '90'::jsonb),                  -- số ngày tối thiểu nằm trong thùng rác trước khi được xoá vĩnh viễn
  ('bulk_delete_confirm_over', '20'::jsonb),        -- xoá quá số này phải nhập lại mật khẩu
  ('anomaly_max_changes_per_hour', '150'::jsonb),   -- N bản ghi sửa / xoá trong 1 giờ (0 = tắt cảnh báo)
  ('anomaly_auto_lock', 'true'::jsonb)              -- vượt ngưỡng thì tự khoá tài khoản
on conflict (key) do nothing;

-- "Số ngày mở lại lead" do quản lý chỉnh; các ngưỡng an toàn chỉ Quản trị cấp cao chỉnh.
drop policy if exists app_settings_update_manager on public.app_settings;
create policy app_settings_update_manager on public.app_settings
  for update to authenticated
  using (case when key = 'lead_reopen_days' then (select private.is_manager()) else (select private.is_super_admin()) end)
  with check (case when key = 'lead_reopen_days' then (select private.is_manager()) else (select private.is_super_admin()) end);
revoke update on public.app_settings from authenticated;
grant update (value) on public.app_settings to authenticated;   -- chỉ sửa giá trị, không đổi tên khoá

create or replace trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 8. CẬP NHẬT CÁC HÀM CỦA PHÂN HỆ LEAD cho khớp với xoá mềm và khoá tài khoản
-- ---------------------------------------------------------------------

-- Đổi trạng thái thì ghi lại thời điểm — trừ khi lệnh sửa đã tự đặt thời điểm đó
-- (trường hợp hoàn tác: phải trả lại đúng mốc thời gian cũ).
create or replace function public.leads_track_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status_changed_at is not distinct from old.status_changed_at then
    new.status_changed_at = now();
  end if;
  return new;
end;
$$;

-- Bản sửa: lead từng bị đánh dấu "số sai" được MỞ LẠI thì bỏ dấu trên lead, nhưng
-- KHÔNG xoá dấu "số sai" của lần dán cũ (lần đó vẫn tính là số sai khi tính lương trực page).
create or replace trigger leads_sync_invalid_phone
  after update of invalid_phone on public.leads
  for each row
  when (
    new.invalid_phone is distinct from old.invalid_phone
    and new.reopened_at is not distinct from old.reopened_at
  )
  execute function public.leads_sync_invalid_phone();

-- Kiểm tra nhanh một số vừa dán — bỏ qua lead đã nằm trong thùng rác.
create or replace function public.check_lead_phone(p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_lead  public.leads%rowtype;
begin
  if not private.is_staff() then
    raise exception 'Tài khoản chưa được cấp quyền' using errcode = '42501';
  end if;
  if v_phone !~ '^0[0-9]{9,10}$' then
    return jsonb_build_object('valid', false, 'phone', v_phone);
  end if;

  select * into v_lead from public.leads where phone = v_phone and deleted_at is null;
  if not found then
    return jsonb_build_object('valid', true, 'phone', v_phone, 'outcome', 'new');
  end if;

  return jsonb_build_object(
    'valid', true,
    'phone', v_phone,
    'outcome', private.lead_touch_outcome(v_lead.status, v_lead.status_changed_at),
    'lead', jsonb_build_object(
      'id', v_lead.id, 'full_name', v_lead.full_name, 'status', v_lead.status,
      'assignee', v_lead.assignee, 'created_at', v_lead.created_at,
      'status_changed_at', v_lead.status_changed_at, 'touch_count', v_lead.touch_count)
  );
end;
$$;

-- Trực page dán một số. So với bản trong 002: bỏ qua lead / kênh đã xoá,
-- không chia cho tài khoản đang bị khoá.
create or replace function public.intake_lead(
  p_phone       text,
  p_full_name   text,
  p_channel_id  uuid,
  p_page_id     uuid default null,
  p_campaign_id uuid default null,
  p_service_id  uuid default null,
  p_ads_id      text default null,
  p_branch      text default 'HN',
  p_note        text default null,
  p_pancake_url text default null,
  p_assignee_id uuid default null          -- null = xoay vòng; có giá trị = chia tay
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_phone   text := public.normalize_phone(p_phone);
  v_name    text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_url     text := nullif(btrim(coalesce(p_pancake_url, '')), '');
  v_ads     text := nullif(btrim(coalesce(p_ads_id, '')), '');
  v_branch  text := coalesce(nullif(btrim(coalesce(p_branch, '')), ''), 'HN');
  v_today   date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_time    time := (now() at time zone 'Asia/Ho_Chi_Minh')::time;
  v_lead    public.leads%rowtype;
  v_outcome text;
  v_lead_id uuid;
  v_channel_name  text;
  v_service_name  text;
  v_assignee_id   uuid;
  v_assignee_name text;
  v_mode          text;
begin
  if not private.is_staff() then
    raise exception 'Tài khoản chưa được cấp quyền' using errcode = '42501';
  end if;
  if v_phone !~ '^0[0-9]{9,10}$' then
    raise exception 'Số điện thoại không hợp lệ' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'Thiếu họ tên khách' using errcode = '22023';
  end if;

  select c.name into v_channel_name
  from public.channels c where c.id = p_channel_id and c.deleted_at is null;
  if v_channel_name is null then
    raise exception 'Chưa chọn kênh' using errcode = '22023';
  end if;
  select s.name into v_service_name from public.services s where s.id = p_service_id;

  -- Xử lý lần lượt từng lần dán: không chia trùng lượt, không tạo hai lead cùng số.
  perform pg_advisory_xact_lock(hashtext('public.intake_lead'));

  select * into v_lead from public.leads where phone = v_phone and deleted_at is null for update;
  if not found then
    v_outcome := 'new';
  else
    v_outcome := private.lead_touch_outcome(v_lead.status, v_lead.status_changed_at);
    v_lead_id := v_lead.id;
  end if;

  -- Chỉ lead mới và lead mở lại mới được chia (lead đang xử lý giữ telesale cũ).
  if v_outcome in ('new', 'reopened') then
    if p_assignee_id is not null then
      select s.user_id, s.full_name into v_assignee_id, v_assignee_name
      from public.staff s where s.user_id = p_assignee_id and s.locked_at is null;
      if v_assignee_id is null then
        raise exception 'Không tìm thấy telesale được chọn (hoặc tài khoản đang bị khoá)' using errcode = '22023';
      end if;
      v_mode := 'manual';
    else
      -- Xoay vòng: người đang bật nhận lead, cùng cơ sở, không bị khoá, đang trong ca
      -- (ngày chưa xếp ca nào thì bỏ qua điều kiện ca); ai lâu chưa được chia nhất thì nhận.
      select s.user_id, s.full_name into v_assignee_id, v_assignee_name
      from public.staff s
      where s.accepts_leads
        and s.locked_at is null
        and s.branch = v_branch
        and (
          not exists (select 1 from public.staff_shifts x where x.work_date = v_today)
          or exists (
            select 1 from public.staff_shifts x
            where x.user_id = s.user_id and x.work_date = v_today
              and v_time >= x.start_time and v_time < x.end_time)
        )
      order by s.last_assigned_at asc nulls first, s.created_at asc
      limit 1;
      v_mode := 'round_robin';
    end if;

    -- Chia tay cũng tính một lượt, để số lượng giữa các telesale không lệch.
    if v_assignee_id is not null then
      update public.staff set last_assigned_at = clock_timestamp() where user_id = v_assignee_id;
    end if;
  end if;

  if v_outcome = 'new' then
    insert into public.leads (
      branch, full_name, phone, service, service_id, source, channel_id, page_id, campaign_id,
      ads_id, status, assignee, assignee_id, assign_mode, note, pancake_url,
      last_touch_at, touch_count, created_by)
    values (
      v_branch, v_name, v_phone, v_service_name, p_service_id, v_channel_name, p_channel_id, p_page_id, p_campaign_id,
      v_ads, 'so_moi', v_assignee_name, v_assignee_id, case when v_assignee_id is null then null else v_mode end, v_note, v_url,
      now(), 1, v_uid)
    returning id into v_lead_id;

  elsif v_outcome = 'reopened' then
    update public.leads set
      status = 'so_moi', full_name = v_name,
      service = coalesce(v_service_name, service), service_id = coalesce(p_service_id, service_id),
      source = v_channel_name, channel_id = p_channel_id, page_id = p_page_id, campaign_id = p_campaign_id,
      ads_id = v_ads, branch = v_branch,
      assignee = v_assignee_name, assignee_id = v_assignee_id,
      assign_mode = case when v_assignee_id is null then null else v_mode end,
      note = coalesce(v_note, note), pancake_url = coalesce(v_url, pancake_url),
      appointment_at = null, invalid_phone = false, recontacted_at = null,
      reopened_at = now(), last_touch_at = now(), touch_count = touch_count + 1
    where id = v_lead_id;

  elsif v_outcome = 'duplicate' then
    -- Lead đang xử lý: cập nhật nguồn gần nhất, giữ telesale cũ, báo cho telesale đó.
    update public.leads set
      source = v_channel_name, channel_id = p_channel_id, page_id = p_page_id, campaign_id = p_campaign_id,
      ads_id = coalesce(v_ads, ads_id), pancake_url = coalesce(v_url, pancake_url),
      recontacted_at = now(), last_touch_at = now(), touch_count = touch_count + 1
    where id = v_lead_id;

  else
    -- Khách cũ: không tính là lead marketing, chỉ đánh dấu để CSKH liên hệ.
    update public.leads set
      recontacted_at = now(), last_touch_at = now(), touch_count = touch_count + 1
    where id = v_lead_id;
  end if;

  insert into public.lead_touches (
    lead_id, created_by, phone, full_name, channel_id, page_id, campaign_id, service_id,
    ads_id, branch, note, pancake_url, result, assignee_id, assign_mode)
  values (
    v_lead_id, v_uid, v_phone, v_name, p_channel_id, p_page_id, p_campaign_id, p_service_id,
    v_ads, v_branch, v_note, v_url, v_outcome,
    case when v_outcome in ('new', 'reopened') then v_assignee_id else v_lead.assignee_id end,
    case when v_outcome in ('new', 'reopened') then (case when v_assignee_id is null then null else v_mode end) else 'kept' end);

  return jsonb_build_object(
    'outcome', v_outcome,
    'lead_id', v_lead_id,
    'phone', v_phone,
    'full_name', case when v_outcome in ('new', 'reopened') then v_name else v_lead.full_name end,
    'assignee', case when v_outcome in ('new', 'reopened') then v_assignee_name else v_lead.assignee end,
    'assign_mode', case when v_outcome in ('new', 'reopened') then v_mode else 'kept' end,
    'previous_status', v_lead.status
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 9. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function public.soft_delete_records(text, uuid[]) from public, anon;
revoke all on function public.restore_records(text, uuid[]) from public, anon;
revoke all on function public.purge_records(text, uuid[]) from public, anon;
revoke all on function public.revert_record_to_version(bigint) from public, anon;
revoke all on function public.undo_changes(uuid, timestamptz, timestamptz, boolean) from public, anon;
revoke all on function public.set_staff_lock(uuid, boolean, text) from public, anon;
revoke all on function public.resolve_security_alert(uuid, boolean) from public, anon;
revoke all on function public.log_restore_test(boolean, text) from public, anon;
revoke all on function public.check_lead_phone(text) from public, anon;
revoke all on function public.intake_lead(text, text, uuid, uuid, uuid, uuid, text, text, text, text, uuid) from public, anon;

grant execute on function public.soft_delete_records(text, uuid[]) to authenticated;
grant execute on function public.restore_records(text, uuid[]) to authenticated;
grant execute on function public.purge_records(text, uuid[]) to authenticated;
grant execute on function public.revert_record_to_version(bigint) to authenticated;
grant execute on function public.undo_changes(uuid, timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.set_staff_lock(uuid, boolean, text) to authenticated;
grant execute on function public.resolve_security_alert(uuid, boolean) to authenticated;
grant execute on function public.log_restore_test(boolean, text) to authenticated;
grant execute on function public.check_lead_phone(text) to authenticated;
grant execute on function public.intake_lead(text, text, uuid, uuid, uuid, uuid, text, text, text, text, uuid) to authenticated;

-- Báo cho API của Supabase nạp lại cấu trúc mới.
notify pgrst, 'reload schema';

commit;
