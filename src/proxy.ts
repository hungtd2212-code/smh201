import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  SUPABASE_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

/**
 * Chạy trước mọi request (Next.js 16 gọi là "proxy", trước đây là "middleware"):
 * - làm mới phiên đăng nhập Supabase lưu trong cookie
 * - chưa đăng nhập → chuyển về /login
 *
 * Đây chỉ là lớp điều hướng. Lớp bảo vệ dữ liệu thật sự là Row Level Security
 * trong Supabase (xem supabase/schema.sql).
 */
export async function proxy(request: NextRequest) {
  // Chưa kết nối Supabase → chế độ xem thử, không yêu cầu đăng nhập.
  if (!isSupabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers ?? {}).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  // getClaims() kiểm tra chữ ký của token chứ không tin cookie mù quáng, và tự
  // làm mới phiên khi sắp hết hạn. Với khoá ký bất đối xứng (mặc định của dự án
  // Supabase mới) việc kiểm tra chạy tại chỗ, không phải gọi mạng ở mỗi request.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");

  if (!isSignedIn && !isLoginPage) return redirectTo("/login", request, response);
  if (isSignedIn && isLoginPage) return redirectTo("/", request, response);

  return response;
}

/** Chuyển hướng nhưng vẫn giữ các cookie phiên vừa được làm mới. */
function redirectTo(pathname: string, request: NextRequest, from: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  matcher: [
    {
      // Bỏ qua file tĩnh và ảnh.
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
      // Bỏ qua các lượt tải trước (prefetch) của menu: chúng chỉ chứa khung trang,
      // không chứa dữ liệu — dữ liệu luôn được Supabase kiểm tra quyền riêng.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
