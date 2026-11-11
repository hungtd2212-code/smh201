// Phần dùng chung của các file kiểm thử SQL: dựng một Postgres chạy ngay trong bộ nhớ (PGlite),
// giả lập các thứ Supabase cung cấp sẵn (role anon / authenticated, schema auth, auth.uid(),
// auth.jwt()) và các hàm tiện ích để chạy lệnh "như thể người dùng X gọi qua API".
// Không đụng tới cơ sở dữ liệu thật.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function createTestDb() {
  const db = new PGlite();
  /** Đọc một file SQL trong thư mục supabase/. */
  const read = (name) => readFileSync(join(dir, name), "utf8");

  let passed = 0;
  let failed = 0;
  function ok(cond, label, extra) {
    if (cond) {
      passed++;
      console.log(`  ok   ${label}`);
    } else {
      failed++;
      console.log(`  FAIL ${label}${extra !== undefined ? " → " + JSON.stringify(extra) : ""}`);
    }
  }
  const section = (name) => console.log(`\n== ${name}`);

  // --- Giả lập Supabase: role, schema auth, quyền mặc định -------------------
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                      nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);

  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const all = async (sql, params) => (await db.query(sql, params)).rows;

  /** Tạo một người dùng đăng nhập (chưa có tên trong bảng staff). Trả về id. */
  const addUser = async (name) =>
    (await one(`insert into auth.users (email) values ($1) returning id`, [`${name}@test`])).id;

  /** Chạy một lệnh như thể người dùng `uid` gọi qua API (role authenticated + JWT). */
  async function as(uid, sql, params = [], { pwAgo = 3600 } = {}) {
    const claims = {
      sub: uid,
      role: "authenticated",
      amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - pwAgo }],
    };
    await db.exec("begin");
    try {
      await db.exec("set local role authenticated");
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await db.query(`select set_config('request.headers', $1, true)`, [
        JSON.stringify({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1, 10.0.0.2" }),
      ]);
      const result = await db.query(sql, params);
      await db.exec("commit");
      return result.rows;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }

  /** Như `as` nhưng trả về thông báo lỗi (hoặc null nếu không lỗi). */
  async function errOf(uid, sql, params, opts) {
    try {
      await as(uid, sql, params, opts);
      return null;
    } catch (error) {
      return error.message;
    }
  }

  const arr = (ids) => `{${ids.join(",")}}`;
  const pause = (ms) => new Promise((res) => setTimeout(res, ms));

  /**
   * Một mốc giờ của cơ sở dữ liệu, dùng làm đầu / cuối khoảng thời gian khi thử hoàn tác theo lô
   * (khoảng tính từ mốc "từ" đến TRƯỚC mốc "đến"). Đồng hồ của PGlite chỉ chính xác tới
   * mili-giây, nên phải nghỉ vài mili-giây trước và sau khi lấy mốc; nếu không, thao tác ngay
   * sát mốc có thể mang đúng giờ của mốc và rơi ra ngoài khoảng. Postgres thật chính xác tới
   * micro-giây nên không gặp chuyện này. Trả về dạng chữ để JavaScript không làm tròn.
   */
  const dbNow = async () => {
    await pause(5);
    const { t } = await one(`select clock_timestamp()::text as t`);
    await pause(5);
    return t;
  };

  /** In tổng kết và thoát (mã 1 nếu có phép thử lỗi). */
  function finish() {
    console.log(`\n${passed} đạt, ${failed} lỗi`);
    process.exit(failed ? 1 : 0);
  }

  return { db, read, ok, section, one, all, addUser, as, errOf, arr, pause, dbNow, finish };
}
