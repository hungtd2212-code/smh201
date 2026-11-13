import { redirect } from "next/navigation";

/** Địa chỉ cũ: trang Chiến dịch & Bài post nay là một thẻ của Marketing → Cài đặt. */
export default function OldAddress() {
  redirect("/marketing/cai-dat?tab=chien-dich");
}
