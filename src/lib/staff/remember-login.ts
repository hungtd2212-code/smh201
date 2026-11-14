/**
 * "Nhớ đăng nhập trên máy này" ở trang đăng nhập.
 *
 * - Tên đăng nhập: nhớ ở máy (localStorage) để lần sau điền sẵn.
 * - Mật khẩu: ứng dụng KHÔNG tự cất ở đâu cả. Ứng dụng chỉ nhờ trình duyệt lưu vào trình quản lý mật khẩu của chính
 *   trình duyệt (Chrome / Edge: Credential Management API — hiện hộp "Lưu mật khẩu?"; Safari / Firefox: tự gợi ý lưu
 *   nhờ ô có autocomplete). Lần sau vào trang đăng nhập, Chrome / Edge đưa lại tài khoản đã lưu để đăng nhập luôn.
 * - Đăng xuất: dặn trình duyệt không tự đăng nhập lại khi chưa hỏi (preventSilentAccess) — phải bấm chọn tài khoản.
 */

const KEY = "smh.login.remember";

export type RememberedLogin = { remember: boolean; login: string };

const DEFAULT: RememberedLogin = { remember: true, login: "" };
let cache: { raw: string | null; value: RememberedLogin } | null = null;

/** Đọc lựa chọn đã nhớ (trả về cùng một đối tượng khi chưa đổi, để dùng được với useSyncExternalStore). */
export function readRememberedLogin(): RememberedLogin {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Trình duyệt chặn bộ nhớ (chế độ riêng tư…): coi như chưa nhớ gì.
  }
  if (cache && cache.raw === raw) return cache.value;
  let value = DEFAULT;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<RememberedLogin>) : null;
    if (parsed) {
      value = {
        remember: parsed.remember !== false,
        login: parsed.remember !== false && typeof parsed.login === "string" ? parsed.login : "",
      };
    }
  } catch {
    // Dữ liệu hỏng: bỏ qua.
  }
  cache = { raw, value };
  return value;
}

/** Bỏ chọn "Nhớ đăng nhập" thì xoá luôn tên đăng nhập đã nhớ. */
export function writeRememberedLogin(remember: boolean, login: string) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(remember ? { remember: true, login } : { remember: false }));
  } catch {
    // Không lưu được thì thôi — lần sau nhập lại.
  }
}

type PasswordCredentialData = { id: string; password: string; name?: string };
type PasswordCredentialCtor = new (data: PasswordCredentialData) => Credential;
type PasswordCredentialLike = Credential & { id: string; password?: string };

function passwordCredentialCtor(): PasswordCredentialCtor | null {
  if (typeof window === "undefined" || !navigator.credentials) return null;
  return (window as unknown as { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential ?? null;
}

/**
 * Nhờ trình duyệt lưu tài khoản vào trình quản lý mật khẩu của nó (chỉ Chrome / Edge có cách này; trình duyệt khác tự
 * gợi ý lưu). Không chờ quá 1,5 giây để không làm chậm việc vào trang.
 */
export async function askBrowserToSave(login: string, password: string, name?: string) {
  const Ctor = passwordCredentialCtor();
  if (!Ctor) return;
  try {
    await Promise.race([
      navigator.credentials.store(new Ctor({ id: login, password, name })),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Người dùng / trình duyệt từ chối: không sao.
  }
}

/**
 * Lấy tài khoản trình duyệt đã lưu cho trang này (Chrome / Edge). Có một tài khoản và chưa đăng xuất thì trình duyệt đưa
 * luôn; vừa đăng xuất thì trình duyệt hiện bảng chọn tài khoản, phải bấm chọn. null = không có / không chọn.
 */
export async function getSavedCredential(signal: AbortSignal): Promise<{ login: string; password: string } | null> {
  if (!passwordCredentialCtor()) return null;
  try {
    const cred = (await navigator.credentials.get({ password: true, mediation: "optional", signal } as CredentialRequestOptions)) as
      | PasswordCredentialLike
      | null;
    return cred?.id && cred.password ? { login: cred.id, password: cred.password } : null;
  } catch {
    return null;
  }
}

/** Khi đăng xuất: trình duyệt không được tự đăng nhập lại nếu chưa hỏi người dùng. */
export async function stopAutoSignIn() {
  try {
    await navigator.credentials?.preventSilentAccess?.();
  } catch {
    // Trình duyệt không hỗ trợ: không sao.
  }
}
