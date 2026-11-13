import { redirect } from "next/navigation";

/** Địa chỉ cũ: trang TKQC & Page nay là một thẻ của Marketing → Cài đặt. */
export default function OldAddress() {
  redirect("/marketing/cai-dat?tab=tkqc");
}
