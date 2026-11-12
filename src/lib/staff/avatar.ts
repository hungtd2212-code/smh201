import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";

/** Ảnh đại diện (supabase/013_revenue_avatars.sql): kho ảnh "avatars", cột staff.avatar_url. */

const NOT_READY = "Chức năng ảnh đại diện chưa dùng được: cần chạy file supabase/013_revenue_avatars.sql trên Supabase.";
const SIZE = 320;

/** Cắt vuông ở giữa và thu nhỏ còn 320×320 JPG (vài chục KB) trước khi tải lên. */
export async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Hãy chọn một file ảnh (JPG, PNG…).");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Trình duyệt không đọc được ảnh này (ảnh HEIC của iPhone thì hãy chuyển sang JPG trước).");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Không xử lý được ảnh.");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("Không xử lý được ảnh.");
  return blob;
}

async function setAvatar(userId: string, url: string | null) {
  const { error } = await getSupabaseBrowserClient().rpc("set_staff_avatar", { p_user_id: userId, p_url: url });
  if (error) throw new Error(isNotMigrated(error) ? NOT_READY : error.message);
}

/** Tải ảnh lên kho rồi gắn vào tài khoản. Trả về đường link ảnh. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const blob = await shrinkImage(file);
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new Error(NOT_READY);
    if (/row-level security|unauthorized|403/i.test(error.message)) throw new Error("Bạn không có quyền đổi ảnh của người này.");
    throw new Error(error.message);
  }
  const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  await setAvatar(userId, url);
  return url;
}

/** Bỏ ảnh đại diện (về chữ cái đầu của tên). */
export const clearAvatar = (userId: string) => setAvatar(userId, null);
